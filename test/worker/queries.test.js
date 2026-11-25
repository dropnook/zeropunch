// D1 limits the number of queries per Worker invocation; the smallest documented limit is 50. Every
// route and the daily cron are counted here in their worst case (each statement of a batch counts as
// one query) and must stay far below it.
import { describe, it, expect, afterAll } from 'vitest';
import { createExecutionContext, waitOnExecutionContext, createScheduledController } from 'cloudflare:test';
import { call, register, key32, env, worker, BLOB, wrap, fakeRecord, rid, pow, uniqueName, counting } from './helpers.js';
import { accountId, acctKey, UPGRADE_PER_RUN } from '../../src/api.js';
import { utcDay, DAY } from '../../src/limits.js';
import { sealKeys, hmacHex } from '../../src/util.js';

const BUDGET = 25; // our own ceiling, half the smallest platform limit
const LIMIT = 50;

/** @type {Record<string, number>} */
const seen = {};
/** @param {string} name @param {(e: any) => Promise<any>} fn */
async function measure(name, fn, base = env) {
  const { env: e, c } = counting(base);
  await fn(e);
  seen[name] = Math.max(seen[name] ?? 0, c.n);
  expect(c.n, name).toBeLessThanOrEqual(BUDGET);
  return c.n;
}

afterAll(() => {
  const worst = Object.entries(seen).sort((a, b) => b[1] - a[1]);
  console.log('[queries] worst case per invocation (limit 50):\n' + worst.map(([k, v]) => `  ${String(v).padStart(3)}  ${k}`).join('\n'));
});

/** A session that was last used yesterday and an account whose key blob still has the 2.3 `rec` part: the most work loadSession does. */
async function staleAccount() {
  const a = await register();
  const uid = await accountId(env, a.username);
  await env.DB.prepare('UPDATE users SET keys = ?2, last_seen = ?3 WHERE id = ?1')
    .bind(uid, await sealKeys(env.PEPPER, uid, JSON.stringify({ ...BLOB, rec: wrap() })), utcDay(Date.now()) - DAY)
    .run();
  await env.DB.prepare('UPDATE sessions SET touched = ?2 WHERE user_id = ?1').bind(uid, utcDay(Date.now()) - DAY).run();
  return a;
}

describe('queries per invocation (D1 limit)', () => {
  it('registration, all paths', async () => {
    await measure('GET /api/auth/challenge', (e) => call('GET', '/api/auth/challenge', { env: e }));
    const ip = '2001:db8:4444:1::1';
    const name = uniqueName('q');
    const p1 = await pow(ip);
    await measure('POST /api/auth/register (new)', (e) => call('POST', '/api/auth/register', { env: e, ip, body: { username: name, auth: key32(), keys: BLOB, pow: p1 } }));
    const p2 = await pow(ip);
    await measure('POST /api/auth/register (name taken)', (e) => call('POST', '/api/auth/register', { env: e, ip, body: { username: name, auth: key32(), keys: BLOB, pow: p2 } }));
  });

  it('registration before migration 0003 (insert retried with the old column)', async () => {
    const PRE = { ...env, DB: env.PRE_DB };
    const { applyD1Migrations } = await import('cloudflare:test');
    await applyD1Migrations(env.PRE_DB, env.TEST_MIGRATIONS.filter((m) => !m.name.startsWith('0003')));
    const ip = '2001:db8:4444:2::1';
    const ch = await (await call('GET', '/api/auth/challenge', { ip, env: PRE })).json();
    const { solve } = await import('../../public/js/pow.js');
    const { nonce } = await solve(ch.challenge, ch.bits);
    await measure(
      'POST /api/auth/register (before 0003)',
      (e) => call('POST', '/api/auth/register', { env: e, ip, body: { username: uniqueName('qpre'), auth: key32(), keys: BLOB, pow: { challenge: ch.challenge, nonce } } }),
      PRE,
    );
  });

  it('login: success with a key upgrade, failure, proof of work on an attacked account', async () => {
    const a = await staleAccount();
    await measure('POST /api/auth/login (ok, key upgrade)', (e) => call('POST', '/api/auth/login', { env: e, ip: '2001:db8:4444:3::1', body: { username: a.username, auth: a.auth } }));
    await measure('POST /api/auth/login (failure)', (e) => call('POST', '/api/auth/login', { env: e, ip: '2001:db8:4444:3::1', body: { username: a.username, auth: key32() } }));
    const fa = await acctKey(env, await accountId(env, a.username));
    await env.DB.prepare('INSERT INTO limits (key, win, n) VALUES (?, ?, 99) ON CONFLICT (key, win) DO UPDATE SET n = 99')
      .bind(`fa|${fa}`, Math.floor(Date.now() / 3600_000) * 3600_000)
      .run();
    const p = await pow('2001:db8:4444:3::1', '?for=login');
    await measure('POST /api/auth/login (pow required, ok)', (e) =>
      call('POST', '/api/auth/login', { env: e, ip: '2001:db8:4444:3::1', body: { username: a.username, auth: a.auth, pow: p } }),
    );
  });

  it('every authenticated route, with the daily session work and a key upgrade on top', async () => {
    const routes = [
      ['GET /api/keys', (a) => ['GET', '/api/keys']],
      ['GET /api/records', (a) => ['GET', '/api/records?since=0']],
      ['PUT /api/records/:id', (a) => ['PUT', `/api/records/${rid()}`, { data: fakeRecord() }]],
      ['DELETE /api/records/:id', (a) => ['DELETE', `/api/records/${rid()}`, {}]],
      ['POST /api/auth/passphrase (wrong)', (a) => ['POST', '/api/auth/passphrase', { auth: key32(), newAuth: key32(), keys: BLOB, version: 1 }]],
      ['POST /api/auth/passphrase (ok)', (a) => ['POST', '/api/auth/passphrase', { auth: a.auth, newAuth: key32(), keys: BLOB, version: 1 }]],
      ['POST /api/auth/logout', (a) => ['POST', '/api/auth/logout', {}]],
      ['POST /api/auth/logout-all', (a) => ['POST', '/api/auth/logout-all', {}]],
      ['DELETE /api/account (wrong proof)', (a) => ['DELETE', '/api/account', { auth: key32() }]],
      ['DELETE /api/account', (a) => ['DELETE', '/api/account', { auth: a.auth }]],
    ];
    for (const [name, make] of routes) {
      const a = await staleAccount();
      const [m, path, body] = make(a);
      await measure(`${name} (+ daily session work)`, (e) => call(m, path, { env: e, jar: a.jar, body }));
    }
    // a gone and an unknown cookie
    const g = await register();
    const cookie = g.jar.header();
    await call('DELETE', '/api/account', { jar: g.jar, body: { auth: g.auth } });
    await measure('any route, deleted account (410)', (e) => call('GET', '/api/keys', { env: e, headers: { Cookie: cookie } }));
    await measure('any route, unknown cookie (401)', (e) => call('GET', '/api/keys', { env: e, headers: { Cookie: '__Host-zp=nope' } }));
  });

  it('operator statistics', async () => {
    const e0 = { ...env, STATS_TOKEN: 'q-token-0123456789' };
    await measure('GET /api/admin/stats (ok)', (e) => call('GET', '/api/admin/stats', { env: e, headers: { Authorization: 'Bearer q-token-0123456789' } }), e0);
    await measure('GET /api/admin/stats (wrong token)', (e) => call('GET', '/api/admin/stats', { env: e, headers: { Authorization: 'Bearer wrong' } }), e0);
    await measure('GET /api/admin/stats (no token)', (e) => call('GET', '/api/admin/stats', { env: e }), e0);
  });

  it('the daily cron, with more key blobs to upgrade than one run takes', async () => {
    const stmts = [];
    for (let i = 0; i < UPGRADE_PER_RUN + 15; i++) {
      const uid = await hmacHex(env.PEPPER, `user|qcron${i}`);
      stmts.push(
        env.DB.prepare('INSERT INTO users (id, auth, keys, created, last_seen) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING').bind(
          uid,
          'x',
          JSON.stringify({ ...BLOB, rec: wrap() }),
          utcDay(Date.now()),
          utcDay(Date.now()),
        ),
      );
    }
    await env.DB.batch(stmts);
    const n = await measure('scheduled() (retention + key upgrades)', async (e) => {
      const ctx = createExecutionContext();
      await worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: '17 3 * * *' }), e, ctx);
      await waitOnExecutionContext(ctx);
    });
    expect(n).toBeLessThan(LIMIT);
  });

  it('one unreadable key blob does not stop the cron upgrading the others', async () => {
    const { upgradeKeyBlobs } = await import('../../src/api.js');
    // leftovers of other tests first
    while ((await upgradeKeyBlobs(env)) > 0);
    const bad = await hmacHex(env.PEPPER, 'user|qbroken');
    await env.DB.prepare('INSERT INTO users (id, auth, keys, created, last_seen) VALUES (?, ?, ?, ?, ?)').bind(bad, 'x', 'e1.broken.blob', 0, utcDay(Date.now())).run();
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const uid = await hmacHex(env.PEPPER, `user|qgood${i}`);
      ids.push(uid);
      await env.DB.prepare('INSERT INTO users (id, auth, keys, created, last_seen) VALUES (?, ?, ?, ?, ?)').bind(uid, 'x', JSON.stringify({ ...BLOB, rec: wrap() }), 0, utcDay(Date.now())).run();
    }
    expect(await upgradeKeyBlobs(env)).toBe(3);
    for (const uid of ids) expect(String((await env.DB.prepare('SELECT keys FROM users WHERE id = ?').bind(uid).first()).keys).startsWith('e1.')).toBe(true);
    expect(await upgradeKeyBlobs(env)).toBe(0); // only the broken one is left, and it is skipped again
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(bad).run();
  });

  it('an account that only uses its session loses the 2.3 `rec` part on its first request of a day', async () => {
    const a = await staleAccount();
    const uid = await accountId(env, a.username);
    const { openKeys } = await import('../../src/util.js');
    expect(JSON.parse(await openKeys(env.PEPPER, uid, String((await env.DB.prepare('SELECT keys FROM users WHERE id = ?').bind(uid).first()).keys)))).toHaveProperty('rec');
    expect((await call('GET', '/api/records?since=0', { jar: a.jar })).status).toBe(200);
    const k = JSON.parse(await openKeys(env.PEPPER, uid, String((await env.DB.prepare('SELECT keys FROM users WHERE id = ?').bind(uid).first()).keys)));
    expect(k).toEqual(BLOB);
  });
});
