import { describe, it, expect } from 'vitest';
import { call, register, env, fakeRecord, rid, SETTINGS_ID } from './helpers.js';
import { accountId, VERSION, MAX_RECORDS } from '../../src/api.js';
import { DAY, utcDay } from '../../src/limits.js';

const TOKEN = 'stats-token-for-tests-0123456789';
const withToken = { ...env, STATS_TOKEN: TOKEN };
const today = () => utcDay(Date.now());

/** @param {string | null} token @param {{ env?: any, ip?: string, method?: string }} [o] */
function stats(token, o = {}) {
  const headers = token == null ? {} : { Authorization: `Bearer ${token}` };
  return call(o.method || 'GET', '/api/admin/stats', { env: o.env || withToken, ip: o.ip || '192.0.2.200', origin: null, headers });
}

describe('GET /api/admin/stats', () => {
  it('is a plain 404 like an unknown route without the secret, without or with a wrong token', async () => {
    const unknown = await call('GET', '/api/admin/nothing-here', { origin: null });
    const unknownBody = await unknown.text();
    expect(unknown.status).toBe(404);
    for (const res of [
      await stats(TOKEN, { env }), // secret not set
      await stats(null), // no header
      await stats('wrong-token'),
      await stats(`${TOKEN}x`),
      await stats(TOKEN.slice(0, -1)),
    ]) {
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(unknownBody);
    }
    // a cookie session does not open it either
    const a = await register();
    expect((await call('GET', '/api/admin/stats', { jar: a.jar, env: withToken })).status).toBe(404);
    // other methods end like any unknown route
    expect((await call('POST', '/api/admin/stats', { env: withToken, body: {}, headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(404);
  });

  it('needs https except on localhost', async () => {
    const res = await call('GET', '/api/admin/stats', { env: withToken, origin: null, host: 'http://example.org', headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(403);
  });

  it('wrong tokens are limited per network (10 an hour), then even the right one gets 404 there', async () => {
    const ip = '192.0.2.201';
    for (let i = 0; i < 10; i++) expect((await stats(`nope${i}`, { ip })).status).toBe(404);
    expect((await stats(TOKEN, { ip })).status).toBe(404);
    expect((await stats(TOKEN, { ip: '192.0.2.202' })).status).toBe(200);
  });

  it('a parallel burst of wrong tokens from one network counts no more than the limit', async () => {
    const ip = '192.0.2.203';
    const { hmacHex, clientNet } = await import('../../src/util.js');
    const k = (await hmacHex(env.PEPPER, `ip|${clientNet(ip)}`)).slice(0, 32);
    const st = (await Promise.all(Array.from({ length: 30 }, (_, i) => stats(`burst${i}`, { ip })))).map((r) => r.status);
    expect(new Set(st)).toEqual(new Set([404]));
    const row = await env.DB.prepare('SELECT n FROM limits WHERE key = ? AND win = ?').bind(`sf|${k}`, Math.floor(Date.now() / 3600_000) * 3600_000).first();
    expect(Number(row.n)).toBe(10);
    expect((await stats(TOKEN, { ip })).status).toBe(404);
  });

  it('no token and a wrong token do the same database work (the answer time tells nothing)', async () => {
    const { counting } = await import('./helpers.js');
    const run = async (token, ip) => {
      const { env: e, c } = counting(withToken);
      const r = await stats(token, { ip, env: e });
      return { status: r.status, body: await r.text(), sql: c.sql };
    };
    const none = await run(null, '192.0.2.204');
    const malformed = await run('', '192.0.2.205');
    const wrong = await run('wrong-token', '192.0.2.206');
    expect(none.sql.length).toBeGreaterThan(0);
    expect(malformed.sql).toEqual(none.sql);
    expect(wrong.sql).toEqual(none.sql);
    expect(new Set([none.status, malformed.status, wrong.status])).toEqual(new Set([404]));
    expect(new Set([none.body, malformed.body, wrong.body]).size).toBe(1);
    // the right token gives its unit back: the operator's own checks never use up the budget
    for (let i = 0; i < 12; i++) expect((await stats(TOKEN, { ip: '192.0.2.207' })).status).toBe(200);
  });

  it('counts correctly and returns no identifiers', async () => {
    const before = await (await stats(TOKEN)).json();
    const a = await register();
    const b = await register();
    const c = await register();
    for (let i = 0; i < 3; i++) await call('PUT', `/api/records/${rid()}`, { jar: a.jar, body: { data: fakeRecord() } });
    await call('PUT', `/api/records/${SETTINGS_ID}`, { jar: b.jar, body: { data: fakeRecord() } });
    // c was last seen 50 days ago (idle over 45, not seen in 30)
    await env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(today() - 50 * DAY, await accountId(env, c.username)).run();

    const res = await stats(TOKEN);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const s = await res.json();
    expect(Object.keys(s).sort()).toEqual(
      [
        'day', 'users', 'usersSeen7d', 'usersSeen30d', 'usersIdleOver45d', 'records', 'recordsPerUserAvg', 'recordsPerUserMax',
        'sessions', 'registrationsToday', 'dbSizeBytes', 'limits', 'version',
      ].sort(),
    );
    expect(s.day).toBe(new Date(today()).toISOString().slice(0, 10));
    expect(s.users - before.users).toBe(3);
    expect(s.usersSeen7d - before.usersSeen7d).toBe(2);
    expect(s.usersSeen30d - before.usersSeen30d).toBe(2);
    expect(s.usersIdleOver45d - before.usersIdleOver45d).toBe(1);
    expect(s.records - before.records).toBe(4);
    expect(s.recordsPerUserMax).toBeGreaterThanOrEqual(3);
    expect(s.recordsPerUserAvg).toBe(Math.round((s.records / s.users) * 10) / 10);
    expect(s.sessions - before.sessions).toBe(3);
    expect(s.registrationsToday - before.registrationsToday).toBe(3);
    expect(s.dbSizeBytes).toBeGreaterThan(0);
    expect(s.limits).toEqual({ recordsPerAccount: MAX_RECORDS });
    expect(s.version).toBe(VERSION);
    // nothing that identifies anyone: no hex ids, no hashes, no usernames
    const text = JSON.stringify(s);
    expect(text).not.toMatch(/[0-9a-f]{16,}/);
    for (const x of [a, b, c]) {
      expect(text).not.toContain(x.username);
      expect(text).not.toContain((await accountId(env, x.username)).slice(0, 16));
    }
    for (const v of Object.values(s)) expect(Array.isArray(v)).toBe(false);
  });
});

describe('login tells the previous last-seen day', () => {
  it('returns last_seen as it was before this login, then moves it to today', async () => {
    const a = await register();
    const uid = await accountId(env, a.username);
    const before = today() - 40 * DAY;
    await env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(before, uid).run();
    const r = await call('POST', '/api/auth/login', { body: { username: a.username, auth: a.auth } });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.lastSeen).toBe(before);
    expect(Math.floor((utcDay(body.now) - body.lastSeen) / DAY)).toBe(40);
    expect((await env.DB.prepare('SELECT last_seen FROM users WHERE id = ?').bind(uid).first()).last_seen).toBe(today());
    // a second login the same day reports today
    const again = await (await call('POST', '/api/auth/login', { body: { username: a.username, auth: a.auth } })).json();
    expect(again.lastSeen).toBe(today());
  });
});
