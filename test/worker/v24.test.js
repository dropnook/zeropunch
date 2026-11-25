// 2.4: the recovery key is gone. Old accounts (2.3 shape: `rec` wrapping in the key blob, `rec_auth`
// column) keep working and lose both: migration 0003, login, passphrase change, daily cron.
import { describe, it, expect, beforeAll } from 'vitest';
import { applyD1Migrations, createExecutionContext, waitOnExecutionContext, createScheduledController } from 'cloudflare:test';
import { call, register, key32, Jar, env, worker, wrap, uniqueName, rid, pow } from './helpers.js';
import { accountId } from '../../src/api.js';
import { hmacHex, sealKeys, openKeys, sha256Hex } from '../../src/util.js';
import { utcDay, DAY } from '../../src/limits.js';
import { runRetention } from '../../src/retention.js';
import { createAccount, passphraseKeys, unlock, rewrapPassphrase } from '../../public/js/crypto.js';

const FAST = { iterations: 1000 };
const OLD = { ...env, DB: env.OLD_DB };
const columns = async (db) => (await db.prepare('PRAGMA table_info(users)').all()).results.map((c) => c.name);
const stored = async (db, username) => String((await db.prepare('SELECT keys FROM users WHERE id = ?').bind(await accountId(env, username)).first()).keys);
const opened = async (db, username) => JSON.parse(await openKeys(env.PEPPER, await accountId(env, username), await stored(db, username)));

/** An account exactly as 2.3 stored it: hash of recAuth in rec_auth, blob with a `rec` wrapping. */
async function oldAccount(username, pass, { sealed = true } = {}) {
  const made = await createAccount(username, pass, FAST);
  const uid = await accountId(env, username);
  const recAuth = key32();
  const text = JSON.stringify({ v: 1, pass: made.blob.pass, rec: wrap() });
  const day = utcDay(Date.now());
  await env.OLD_DB.prepare('INSERT INTO users (id, auth, rec_auth, keys, created, last_seen) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(uid, await hmacHex(env.PEPPER, `auth|${made.auth}`), await hmacHex(env.PEPPER, `rec|${recAuth}`), sealed ? await sealKeys(env.PEPPER, uid, text) : text, day, day)
    .run();
  return { made, recAuth };
}

describe('2.4: accounts from 2.3 on a database migrated with 0003', () => {
  const names = { login: uniqueName('old.login'), plain: uniqueName('old.plain'), cron: uniqueName('old.cron') };
  /** @type {Record<string, any>} */
  const acc = {};

  beforeAll(async () => {
    // The database as 2.3 left it: migrations 0001 and 0002, accounts with rec_auth and `rec`.
    await applyD1Migrations(env.OLD_DB, env.TEST_MIGRATIONS.filter((m) => !m.name.startsWith('0003')));
    expect(await columns(env.OLD_DB)).toContain('rec_auth');
    acc.login = await oldAccount(names.login, 'alte-passphrase-eins');
    acc.plain = await oldAccount(names.plain, 'alte-passphrase-zwei', { sealed: false });
    acc.cron = await oldAccount(names.cron, 'alte-passphrase-drei');
    await applyD1Migrations(env.OLD_DB, env.TEST_MIGRATIONS);
  });

  it('migration 0003 drops rec_auth and strips `rec` from plain blobs; sealed blobs wait for the Worker', async () => {
    const cols = await columns(env.OLD_DB);
    expect(cols).not.toContain('rec_auth');
    expect(cols).toEqual(['id', 'auth', 'keys', 'keys_version', 'seq', 'created', 'last_seen', 'nrec']);
    expect(JSON.parse(await stored(env.OLD_DB, names.plain))).toEqual(acc.plain.made.blob);
    expect(await stored(env.OLD_DB, names.plain)).toBe(JSON.stringify(acc.plain.made.blob));
    expect(await opened(env.OLD_DB, names.login)).toHaveProperty('rec');
  });

  it('an old account logs in, changes its passphrase and keeps no `rec` and no usable recovery', async () => {
    const { made, recAuth } = acc.login;
    const jar = new Jar();
    let r = await call('POST', '/api/auth/login', { jar, env: OLD, body: { username: names.login, auth: made.auth } });
    expect(r.status).toBe(200);
    const body = await r.json();
    // never handed out any more, and removed from the stored blob on this login
    expect(body.keys).toEqual(made.blob);
    expect(await opened(env.OLD_DB, names.login)).toEqual(made.blob);
    const k = await passphraseKeys(names.login, 'alte-passphrase-eins', FAST.iterations);
    expect((await unlock(body.keys, k.wrapKey, names.login)).fingerprint).toBe(made.fingerprint);

    const other = new Jar();
    expect((await call('POST', '/api/auth/login', { jar: other, env: OLD, body: { username: names.login, auth: made.auth } })).status).toBe(200);
    const re = await rewrapPassphrase(body.keys, k.wrapKey, names.login, 'neue-passphrase-eins', FAST);
    r = await call('POST', '/api/auth/passphrase', { jar, env: OLD, body: { auth: k.auth, newAuth: re.auth, keys: re.blob, version: body.version } });
    expect(r.status).toBe(200);
    expect(await opened(env.OLD_DB, names.login)).toEqual(re.blob);
    expect(Object.keys(await opened(env.OLD_DB, names.login))).toEqual(['v', 'pass']);
    // the other device is logged out, the new passphrase works, the old one does not
    expect((await call('GET', '/api/keys', { jar: other, env: OLD })).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { env: OLD, body: { username: names.login, auth: made.auth } })).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { env: OLD, body: { username: names.login, auth: re.auth } })).status).toBe(200);
    // the recovery key of 2.3 opens nothing: the route is gone and so is the stored hash
    r = await call('POST', '/api/auth/recover', { env: OLD, body: { username: names.login, recAuth } });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'not_found' });
    const row = await env.OLD_DB.prepare('SELECT * FROM users WHERE id = ?').bind(await accountId(env, names.login)).first();
    expect(Object.keys(row)).not.toContain('rec_auth');
    expect(JSON.stringify(row)).not.toContain(await hmacHex(env.PEPPER, `rec|${recAuth}`));
  });

  it('the daily cron strips `rec` from all remaining sealed blobs and seals the plain ones', async () => {
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: '17 3 * * *' }), OLD, ctx);
    await waitOnExecutionContext(ctx);
    for (const n of ['cron', 'plain']) {
      expect((await stored(env.OLD_DB, names[n])).startsWith('e1.'), n).toBe(true);
      expect(await opened(env.OLD_DB, names[n]), n).toEqual(acc[n].made.blob);
    }
    // nothing left for the next run
    const { upgradeKeyBlobs } = await import('../../src/api.js');
    expect(await upgradeKeyBlobs(OLD)).toBe(0);
    // and the accounts still log in
    const r = await call('POST', '/api/auth/login', { env: OLD, body: { username: names.cron, auth: acc.cron.made.auth } });
    expect(r.status).toBe(200);
    expect((await r.json()).keys).toEqual(acc.cron.made.blob);
  });
});

describe('2.4: new accounts', () => {
  it('a fresh blob has the length the cron treats as clean, so the cron never touches it', async () => {
    const { upgradeKeyBlobs } = await import('../../src/api.js');
    const a = await register();
    const before = await stored(env.DB, a.username);
    // run until the main database has no leftovers from other tests, then check this row is untouched
    while ((await upgradeKeyBlobs(env)) > 0);
    expect(await stored(env.DB, a.username)).toBe(before);
  });

  it('the removed recovery routes answer exactly like unknown routes (with and without a session)', async () => {
    const a = await register();
    const unknown = await call('POST', '/api/auth/nothing-here', { jar: a.jar, body: {} });
    for (const path of ['/api/auth/recover', '/api/auth/recovery']) {
      for (const jar of [a.jar, undefined]) {
        const r = await call('POST', path, { jar, body: { username: a.username, recAuth: key32() } });
        expect(r.status, path).toBe(unknown.status);
        expect(await r.text()).toBe('{"error":"not_found"}');
      }
    }
    expect(unknown.status).toBe(404);
  });
});

describe('2.4: other devices learn that the account was deleted', () => {
  const gone = async (jar) => {
    const r = await call('GET', '/api/records?since=0', { jar });
    return { status: r.status, body: await r.json(), cookie: r.headers.getSetCookie().join(';') };
  };

  it('delete on device A → device B gets 410 account_deleted on every authenticated route (cookie left alone)', async () => {
    const a = await register();
    const b = new Jar();
    expect((await call('POST', '/api/auth/login', { jar: b, body: { username: a.username, auth: a.auth } })).status).toBe(200);
    const bCookie = b.header();
    expect((await call('DELETE', '/api/account', { jar: a.jar, body: { auth: a.auth } })).status).toBe(200);
    const g = await gone(b);
    expect(g.status).toBe(410);
    expect(g.body).toEqual({ error: 'account_deleted' });
    // not cleared: a late 410 must not log out a new session another tab of this browser just made
    expect(g.cookie).toBe('');
    for (const [m, path, body] of [['GET', '/api/keys'], ['PUT', `/api/records/${rid()}`, { data: 'AAAA' }], ['POST', '/api/auth/logout', {}]]) {
      const r = await call(m, path, { headers: { Cookie: bCookie }, body });
      expect(r.status, path).toBe(410);
    }
    // only hashes and a day are kept: no account id, no username
    const cols = (await env.DB.prepare('PRAGMA table_info(gone_sessions)').all()).results.map((c) => c.name);
    expect(cols).toEqual(['hash', 'expires']);
    const row = await env.DB.prepare('SELECT * FROM gone_sessions ORDER BY expires DESC LIMIT 1').first();
    expect(row.expires % DAY).toBe(0);
    // until the browser has dropped the cookie: the session's expiry day + 64 days of cookie grace
    expect(row.expires).toBe(utcDay(Date.now()) + (62 + 64) * DAY);
    expect(JSON.stringify(row)).not.toContain(a.username);
  });

  it('«log out all devices», a passphrase change and an expired session still answer 401', async () => {
    const a = await register();
    const other = new Jar();
    await call('POST', '/api/auth/login', { jar: other, body: { username: a.username, auth: a.auth } });
    expect((await call('POST', '/api/auth/logout-all', { jar: a.jar })).status).toBe(200);
    expect((await gone(other)).status).toBe(401);

    const username = uniqueName('pwchange');
    const made = await createAccount(username, 'erste-passphrase-x', FAST);
    const jar = new Jar();
    await call('POST', '/api/auth/register', { jar, ip: '192.0.2.171', body: { username, auth: made.auth, keys: made.blob, pow: await pow('192.0.2.171') } });
    const second = new Jar();
    await call('POST', '/api/auth/login', { jar: second, body: { username, auth: made.auth } });
    const k = await passphraseKeys(username, 'erste-passphrase-x', FAST.iterations);
    const re = await rewrapPassphrase(made.blob, k.wrapKey, username, 'zweite-passphrase-x', FAST);
    expect((await call('POST', '/api/auth/passphrase', { jar, body: { auth: made.auth, newAuth: re.auth, keys: re.blob, version: 1 } })).status).toBe(200);
    expect((await gone(second)).status).toBe(401);

    const c = await register();
    await env.DB.prepare('UPDATE sessions SET expires = 1 WHERE user_id = ?').bind(await accountId(env, c.username)).run();
    expect((await gone(c.jar)).status).toBe(401);
  });

  it('the gone entries expire (then 401) and the cron removes them', async () => {
    const a = await register();
    const hash = await sha256Hex(a.jar.map.get('__Host-zp'));
    await call('DELETE', '/api/account', { jar: new Jar(), headers: { Cookie: a.jar.header() }, body: { auth: a.auth } });
    expect((await gone(a.jar)).status).toBe(410);
    await env.DB.prepare('UPDATE gone_sessions SET expires = ? WHERE hash = ?').bind(utcDay(Date.now()) - DAY, hash).run();
    expect((await gone(a.jar)).status).toBe(401);
    const r = await runRetention(env.DB);
    expect(r.goneExpired).toBeGreaterThanOrEqual(1);
    expect(await env.DB.prepare('SELECT 1 FROM gone_sessions WHERE hash = ?').bind(hash).first()).toBeNull();
  });

  it('re-registering the same username does not let the old cookie in', async () => {
    const a = await register();
    const old = new Jar();
    await call('POST', '/api/auth/login', { jar: old, body: { username: a.username, auth: a.auth } });
    await call('DELETE', '/api/account', { jar: a.jar, body: { auth: a.auth } });
    const again = await register({ username: a.username });
    expect(again.res.status).toBe(200);
    expect((await gone(old)).status).toBe(410);
    expect((await call('GET', '/api/keys', { jar: again.jar })).status).toBe(200);
  });

  it('the idle purge: a device that comes back after it, cookie still in the browser, is told 410', async () => {
    const a = await register();
    const uid = await accountId(env, a.username);
    // As it really happens: last use 62 days ago, so the session expired today at 00:00 UTC (61 days
    // sliding + the rest of that day) and the account is idle; the browser set the cookie back then.
    const last = utcDay(Date.now()) - 62 * DAY;
    const hash = await sha256Hex(a.jar.map.get('__Host-zp'));
    await env.DB.prepare('UPDATE users SET last_seen = ?2, created = ?2 WHERE id = ?1').bind(uid, last).run();
    await env.DB.prepare('UPDATE sessions SET touched = ?2, expires = ?3 WHERE user_id = ?1').bind(uid, last, last + 62 * DAY).run();
    a.jar.advance(Date.now() - last);
    const r = await runRetention(env.DB);
    expect(r.gone).toBeGreaterThanOrEqual(1);
    expect(await env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(uid).first()).toBeNull();
    // The browser still holds the cookie (Max-Age 61 + 64 days) and gets 410, not a silent 401.
    expect(a.jar.map.size).toBe(1);
    expect((await gone(a.jar)).status).toBe(410);
    // the browser keeps it until 125 days after it was set (62 more days here), then drops it
    a.jar.advance(62 * DAY);
    expect(a.jar.map.size).toBe(1);
    a.jar.advance(DAY);
    expect(a.jar.map.size).toBe(0);
    // (the server's clock does not move in this test, so the gone entry is checked by its expiry day)
    const e = await env.DB.prepare('SELECT expires FROM gone_sessions WHERE hash = ?').bind(hash).first();
    expect(e.expires).toBe(last + (62 + 64) * DAY);
    expect(e.expires).toBeGreaterThanOrEqual(last + 125 * DAY); // ≥ when the browser drops the cookie
  });

  it('a deletion remembers only sessions that are still valid (an expired cookie keeps answering 401)', async () => {
    const a = await register();
    const old = new Jar();
    await call('POST', '/api/auth/login', { jar: old, body: { username: a.username, auth: a.auth } });
    const oldHash = await sha256Hex(old.map.get('__Host-zp'));
    await env.DB.prepare('UPDATE sessions SET expires = ? WHERE hash = ?').bind(utcDay(Date.now()), oldHash).run();
    expect((await call('DELETE', '/api/account', { jar: a.jar, body: { auth: a.auth } })).status).toBe(200);
    expect(await env.DB.prepare('SELECT 1 FROM gone_sessions WHERE hash = ?').bind(oldHash).first()).toBeNull();
    expect((await gone(old)).status).toBe(401);
  });

  it('a failed deletion marks nothing as gone: «gone» and the deletion are one batch', async () => {
    const a = await register();
    const hash = await sha256Hex(a.jar.map.get('__Host-zp'));
    // the database fails on the DELETE FROM users of the batch
    const failing = new Proxy(env.DB, {
      get(t, k) {
        if (k === 'batch') {
          return async (stmts) => {
            if (stmts.length === 4) throw new Error('D1_ERROR: injected failure');
            return t.batch(stmts);
          };
        }
        const v = Reflect.get(t, k);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    const r = await call('DELETE', '/api/account', { jar: a.jar, env: { ...env, DB: failing }, body: { auth: a.auth } });
    expect(r.status).toBe(500);
    expect(await env.DB.prepare('SELECT 1 FROM gone_sessions WHERE hash = ?').bind(hash).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(await accountId(env, a.username)).first()).toBeTruthy();
    // the account lives on: the session works, and a normal logout later is a 401, never a 410
    expect((await call('GET', '/api/keys', { jar: a.jar })).status).toBe(200);
    const cookieCopy = a.jar.header();
    expect((await call('POST', '/api/auth/logout', { jar: a.jar })).status).toBe(200);
    expect((await call('GET', '/api/keys', { headers: { Cookie: cookieCopy } })).status).toBe(401);
  });
});

describe('2.4 deployed before migration 0003 has run', () => {
  const PRE = { ...env, DB: env.PRE_DB };
  beforeAll(async () => {
    await applyD1Migrations(env.PRE_DB, env.TEST_MIGRATIONS.filter((m) => !m.name.startsWith('0003')));
  });

  it('registers, logs in, answers 401 to an unknown cookie and deletes an account without errors', async () => {
    expect(await columns(env.PRE_DB)).toContain('rec_auth');
    const username = uniqueName('pre');
    const made = await createAccount(username, 'vor-der-migration', FAST);
    const jar = new Jar();
    const ip = '192.0.2.181';
    // the challenge is checked against PRE's counters, so fetch it there
    const ch = await (await call('GET', '/api/auth/challenge', { ip, env: PRE })).json();
    const { solve } = await import('../../public/js/pow.js');
    const { nonce } = await solve(ch.challenge, ch.bits);
    let r = await call('POST', '/api/auth/register', { jar, ip, env: PRE, body: { username, auth: made.auth, keys: made.blob, pow: { challenge: ch.challenge, nonce } } });
    expect(r.status).toBe(200);
    expect((await env.PRE_DB.prepare('SELECT rec_auth FROM users WHERE id = ?').bind(await accountId(env, username)).first()).rec_auth).toBe('');
    expect((await call('POST', '/api/auth/login', { env: PRE, body: { username, auth: made.auth } })).status).toBe(200);
    expect((await call('GET', '/api/keys', { env: PRE, headers: { Cookie: '__Host-zp=unknown-token' } })).status).toBe(401);
    expect((await call('DELETE', '/api/account', { jar, env: PRE, body: { auth: made.auth } })).status).toBe(200);
    expect((await call('POST', '/api/auth/login', { env: PRE, body: { username, auth: made.auth } })).status).toBe(401);
  });

  it('the daily cron runs completely before the migration (no gone_sessions table yet)', async () => {
    const username = uniqueName('precron');
    const made = await createAccount(username, 'vor-der-migration-2', FAST);
    const uid = await accountId(env, username);
    const day = utcDay(Date.now());
    await env.PRE_DB.prepare("INSERT INTO users (id, auth, rec_auth, keys, created, last_seen) VALUES (?, ?, '', ?, ?, ?)")
      .bind(uid, await hmacHex(env.PEPPER, `auth|${made.auth}`), JSON.stringify(made.blob), day - 70 * DAY, day - 70 * DAY)
      .run();
    await env.PRE_DB.prepare('INSERT INTO sessions (hash, user_id, expires, touched) VALUES (?, ?, ?, ?)').bind('pre-session', uid, day - 8 * DAY, day - 70 * DAY).run();
    await env.PRE_DB.prepare('INSERT INTO limits (key, win, n) VALUES (?, ?, 1)').bind('x|old', day - 3 * DAY).run();
    const r = await runRetention(env.PRE_DB);
    expect(r.goneTable).toBe(false);
    expect(r.users).toBeGreaterThanOrEqual(1);
    expect(r.limits).toBeGreaterThanOrEqual(1);
    expect(await env.PRE_DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(uid).first()).toBeNull();
    // and the scheduled() handler as a whole (retention + key upgrades) does not throw there
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: '17 3 * * *' }), PRE, ctx);
    await waitOnExecutionContext(ctx);
  });
});
