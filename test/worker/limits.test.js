import { describe, it, expect } from 'vitest';
import { call, register, key32, uniqueName, env, fakeRecord, rid, SETTINGS_ID, BLOB, pow } from './helpers.js';
import { limits, DAY, HOUR } from '../../src/limits.js';
import { accountId, acctKey } from '../../src/api.js';

const L = limits({});
const login = (username, auth, ip) => call('POST', '/api/auth/login', { ip, body: { username, auth } });

/** Key of a per-network counter (its /64 or IPv4 address, or with `wide` its /48), as src/api.js makes it. */
async function netKey(ip, wide = false) {
  const { hmacHex, clientNet, clientNet48 } = await import('../../src/util.js');
  return (await hmacHex(env.PEPPER, `ip|${wide ? clientNet48(ip) : clientNet(ip)}`)).slice(0, 32);
}
/** Set a counter of the current window to n (instead of hundreds of real requests). */
async function seed(name, key, n, win) {
  const w = Math.floor(Date.now() / win) * win;
  await env.DB.prepare('INSERT INTO limits (key, win, n) VALUES (?, ?, ?) ON CONFLICT (key, win) DO UPDATE SET n = excluded.n').bind(`${name}|${key}`, w, n).run();
}
/** Current value of a counter. */
async function counter(name, key, win) {
  const w = Math.floor(Date.now() / win) * win;
  return Number((await env.DB.prepare('SELECT n FROM limits WHERE key = ? AND win = ?').bind(`${name}|${key}`, w).first())?.n ?? 0);
}

describe('registration limits', () => {
  it('5 per IP per day', async () => {
    const st = [];
    for (let i = 0; i < 6; i++) st.push((await register({ ip: '10.0.2.1' })).res.status);
    expect(st).toEqual([200, 200, 200, 200, 200, 429]);
    expect((await register({ ip: '10.0.2.2' })).res.status).toBe(200);
  });

  it('above REG_GLOBAL_DAY a day the proof of work gets harder instead of blocking; the hard ceiling blocks', async () => {
    const soft = limits(env).regGlobal.max;
    const win = Math.floor(Date.now() / DAY) * DAY;
    const setGlobal = (n) =>
      env.DB.prepare('INSERT INTO limits (key, win, n) VALUES (?, ?, ?) ON CONFLICT (key, win) DO UPDATE SET n = excluded.n').bind('rg|global', win, n).run();
    try {
      const base = (await (await call('GET', '/api/auth/challenge')).json()).bits;
      const weak = await pow('10.0.3.1'); // base difficulty, fetched before the rush
      await setGlobal(soft);
      expect((await (await call('GET', '/api/auth/challenge')).json()).bits).toBe(base + 1);
      await setGlobal(2 * soft);
      expect((await (await call('GET', '/api/auth/challenge')).json()).bits).toBe(base + 2);
      await setGlobal(10 ** 6);
      expect((await (await call('GET', '/api/auth/challenge')).json()).bits).toBe(base + 6); // capped
      expect((await (await call('GET', '/api/auth/challenge?for=login')).json()).bits).toBe(base);
      await setGlobal(soft);
      const r = await call('POST', '/api/auth/register', {
        ip: '10.0.3.1',
        body: { username: uniqueName('busy'), auth: key32(), keys: BLOB, pow: weak },
      });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toBe('pow_weak');
      expect((await register({ ip: '10.0.3.1' })).res.status).toBe(200); // fresh, harder challenge
      await setGlobal(limits(env).regGlobalMax.max);
      expect((await register({ ip: '10.0.3.2' })).res.status).toBe(429);
    } finally {
      await env.DB.prepare('DELETE FROM limits WHERE key = ?').bind('rg|global').run();
    }
    expect((await register({ ip: '10.0.3.3' })).res.status).toBe(200);
  });

  it('parallel registrations never get past the per-network limit', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => register({ ip: '10.0.4.1' })));
    const st = results.map((r) => r.res.status);
    expect(st.filter((x) => x === 200)).toHaveLength(5);
    expect(st.filter((x) => x === 429)).toHaveLength(7);
  });

  it('«name taken» answers count against a probe budget of 200 per network and day', async () => {
    const a = await register();
    await seed('pb', await netKey('10.0.5.1'), L.probePerIp.max - 3, DAY);
    for (let i = 0; i < 3; i++) {
      const r = await call('POST', '/api/auth/register', {
        ip: '10.0.5.1',
        body: { username: a.username, auth: key32(), keys: BLOB, pow: await pow('10.0.5.1') },
      });
      expect(r.status).toBe(409);
    }
    // budget used up: even a free name is refused today from this network, another network is fine
    expect((await register({ ip: '10.0.5.1' })).res.status).toBe(429);
    expect((await register({ ip: '10.0.5.2' })).res.status).toBe(200);
    expect(L.probePerIp.max).toBe(200);
  });

  it('parallel «name taken» probes never get past the probe budget', async () => {
    const a = await register();
    const ip = '10.0.5.3';
    await seed('pb', await netKey(ip), L.probePerIp.max - 3, DAY);
    const pows = await Promise.all(Array.from({ length: 12 }, () => pow(ip)));
    const st = (
      await Promise.all(pows.map((p) => call('POST', '/api/auth/register', { ip, body: { username: a.username, auth: key32(), keys: BLOB, pow: p } })))
    ).map((r) => r.status);
    expect(st.filter((x) => x !== 429)).toHaveLength(3);
    expect(st.filter((x) => x === 409)).toHaveLength(3);
    expect(await counter('pb', await netKey(ip), DAY)).toBe(L.probePerIp.max);
  });

  it('a free name gives its probe unit back', async () => {
    const ip = '10.0.5.4';
    await seed('pb', await netKey(ip), L.probePerIp.max - 1, DAY);
    expect((await register({ ip })).res.status).toBe(200);
    expect((await register({ ip })).res.status).toBe(200);
    expect(await counter('pb', await netKey(ip), DAY)).toBe(L.probePerIp.max - 1);
  });

  it('limits come from vars', () => {
    const v = limits({ REG_PER_IP_DAY: '7', REG_GLOBAL_DAY: '99', REG_GLOBAL_MAX_DAY: '999' });
    expect(v.regPerIp.max).toBe(7);
    expect(v.regGlobal.max).toBe(99);
    expect(v.regGlobalMax.max).toBe(999);
    expect(L.regPerIp.max).toBe(100); // built-in default
    expect(L.regPerNet48.max).toBe(1000);
    expect(L.probePerIp.max).toBe(200);
    expect(L.probePerNet48.max).toBe(2000);
    expect(L.loginFailIp.max).toBe(300);
    expect(L.loginFailNet48.max).toBe(3000);
    // per account, unchanged
    expect(L.loginFailAccount.max).toBe(20);
    expect(L.sessionFail.max).toBe(10);
    expect(L.writesPerDay.max).toBe(100);
    expect(L.settingsPerDay.max).toBe(200);
    expect(L.requestsPerDay.max).toBe(50000);
    expect(L.statsFail.max).toBe(10);
    expect(L.regGlobal.max).toBe(1000);
    expect(L.regGlobalMax.max).toBe(5000);
    expect(L.regPerNet48.max).toBe(10 * L.regPerIp.max);
    expect(v.regPerNet48.max).toBe(70);
  });
});

describe('login limits', () => {
  it('failed logins lock only the attacking network; the owner elsewhere gets in', async () => {
    const a = await register();
    for (let i = 0; i < 20; i++) expect((await login(a.username, key32(), '10.5.0.1')).status).toBe(401);
    for (let i = 0; i < 10; i++) expect((await login(uniqueName('spray'), key32(), '10.5.0.1')).status).toBe(401);
    expect(await counter('fi', await netKey('10.5.0.1'), HOUR)).toBe(30);
    await seed('fi', await netKey('10.5.0.1'), L.loginFailIp.max, HOUR); // the rest of the spray
    expect((await login(a.username, a.auth, '10.5.0.1')).status).toBe(429); // attacker's network
    const ok = await call('POST', '/api/auth/login', { ip: '10.5.50.1', body: { username: a.username, auth: a.auth, pow: await pow('10.5.50.1', '?for=login') } });
    expect(ok.status).toBe(200); // victim, another network (with the proof of work of an attacked account)
  });

  it('an IPv6 /64 counts as one network', async () => {
    await seed('fi', await netKey('2001:db8:5:6::1'), L.loginFailIp.max - 30, HOUR);
    for (let i = 1; i <= 30; i++) expect((await login(uniqueName('v6'), key32(), `2001:db8:5:6::${i.toString(16)}`)).status).toBe(401);
    const a = await register();
    expect((await login(a.username, a.auth, '2001:db8:5:6:ffff:1:2:3')).status).toBe(429);
    expect((await login(a.username, a.auth, '2001:0db8:0005:0007::1')).status).toBe(200);
  });

  it('an IPv6 /48 has a second, ten times higher limit: rotating /64s inside it does not help', async () => {
    // the /48 counter nearly used up, then 10 failures from 10 different /64s of it = the /48 limit
    await seed('fw', await netKey('2001:db8:48::1', true), L.loginFailNet48.max - 10, HOUR);
    for (let n = 0; n < 10; n++) expect((await login(uniqueName('w48'), key32(), `2001:db8:48:${n.toString(16)}::1`)).status).toBe(401);
    const a = await register();
    // an eleventh /64 of the same /48 is refused, another /48 is not
    expect((await login(a.username, a.auth, '2001:db8:48:ff::1')).status).toBe(429);
    expect((await login(a.username, a.auth, '2001:db8:49:ff::1')).status).toBe(200);
    expect(L.loginFailNet48.max).toBe(10 * L.loginFailIp.max);
  });

  it('a failed login writes at most one new counter row (plus two shared ones)', async () => {
    const before = Number((await env.DB.prepare('SELECT COUNT(*) AS n FROM limits').first()).n);
    for (let i = 0; i < 10; i++) await login(uniqueName('rows'), key32(), '2001:db8:77:1::1');
    const after = Number((await env.DB.prepare('SELECT COUNT(*) AS n FROM limits').first()).n);
    expect(after - before).toBe(10 + 2); // one per sprayed name, one for the /64, one for the /48
  });

  it('registrations and name probes are also counted per IPv6 /48 (ten times the /64 limits)', async () => {
    const win = Math.floor(Date.now() / DAY) * DAY;
    const { hmacHex } = await import('../../src/util.js');
    const k48 = (await hmacHex(env.PEPPER, 'ip|2001:db8:99::/48')).slice(0, 32);
    await env.DB.prepare('INSERT INTO limits (key, win, n) VALUES (?, ?, ?)').bind(`rw|${k48}`, win, limits(env).regPerNet48.max).run();
    expect((await register({ ip: '2001:db8:99:1234::1' })).res.status).toBe(429);
    expect((await register({ ip: '2001:db8:98:1234::1' })).res.status).toBe(200);
    await env.DB.prepare('DELETE FROM limits WHERE key = ?').bind(`rw|${k48}`).run();
    await seed('pw', k48, L.probePerNet48.max, DAY);
    expect((await register({ ip: '2001:db8:99:1234::1' })).res.status).toBe(429);
    expect(L.probePerNet48.max).toBe(10 * L.probePerIp.max);
  });

  it('20 failures from everywhere never lock the account: the right passphrase plus a proof of work gets in', async () => {
    const a = await register();
    for (let i = 0; i < 25; i++) expect((await login(a.username, key32(), `10.8.${i}.1`)).status).toBe(i < 20 ? 401 : 428);
    const r = await login(a.username, a.auth, '10.8.200.1');
    expect(r.status).toBe(428);
    expect(await r.json()).toEqual({ error: 'pow_required' });
    const ok = await call('POST', '/api/auth/login', { ip: '10.8.200.1', body: { username: a.username, auth: a.auth, pow: await pow('10.8.200.1', '?for=login') } });
    expect(ok.status).toBe(200);
    // the proof of work is single-use
    const p = await pow('10.8.201.1', '?for=login');
    expect((await call('POST', '/api/auth/login', { ip: '10.8.201.1', body: { username: a.username, auth: a.auth, pow: p } })).status).toBe(200);
    expect((await call('POST', '/api/auth/login', { ip: '10.8.201.1', body: { username: a.username, auth: a.auth, pow: p } })).status).toBe(428);
  });

  it('changing the passphrase from a valid session ignores the login counters and has its own', async () => {
    const a = await register();
    for (let i = 0; i < 25; i++) await login(a.username, key32(), `10.9.${i}.1`);
    for (let i = 0; i < 12; i++) await login(a.username, key32(), a.ip);
    const body = (auth) => ({ auth, newAuth: key32(), keys: BLOB, version: 1 });
    // wrong current passphrase: counted per session, 10 an hour
    for (let i = 0; i < 10; i++) expect((await call('POST', '/api/auth/passphrase', { jar: a.jar, body: body(key32()) })).status).toBe(400);
    expect((await call('POST', '/api/auth/passphrase', { jar: a.jar, body: body(a.auth) })).status).toBe(429);
    // another session of the same account is not affected
    const dev2 = (await call('POST', '/api/auth/login', { ip: '10.9.250.1', body: { username: a.username, auth: a.auth, pow: await pow('10.9.250.1', '?for=login') } }));
    expect(dev2.status).toBe(200);
    const { Jar } = await import('./helpers.js');
    const j2 = new Jar();
    j2.take(dev2);
    expect((await call('POST', '/api/auth/passphrase', { jar: j2, body: body(a.auth) })).status).toBe(200);
  });

  it('300 failed logins per IP per hour (across accounts)', async () => {
    await seed('fi', await netKey('10.6.0.1'), L.loginFailIp.max - 5, HOUR);
    for (let i = 0; i < 5; i++) expect((await login(uniqueName('spray'), key32(), '10.6.0.1')).status).toBe(401);
    const a = await register();
    expect((await login(a.username, a.auth, '10.6.0.1')).status).toBe(429);
    expect((await login(a.username, a.auth, '10.6.0.2')).status).toBe(200);
  });

  it('successful logins do not count', async () => {
    const a = await register();
    for (let i = 0; i < 15; i++) expect((await login(a.username, a.auth, '10.7.0.1')).status).toBe(200);
    expect(await counter('fi', await netKey('10.7.0.1'), HOUR)).toBe(0);
    expect(await counter('fa', await acctKey(env, await accountId(env, a.username)), HOUR)).toBe(0);
  });

  it('a parallel burst of failed logins from one network never gets past the limit', async () => {
    const ip = '10.7.1.1';
    await seed('fi', await netKey(ip), L.loginFailIp.max - 10, HOUR);
    const st = (await Promise.all(Array.from({ length: 60 }, () => login(uniqueName('burst'), key32(), ip)))).map((r) => r.status);
    expect(st.filter((x) => x !== 429)).toHaveLength(10);
    expect(await counter('fi', await netKey(ip), HOUR)).toBe(L.loginFailIp.max);
  });

  it('a parallel burst from one IPv6 /48 never gets past the /48 limit', async () => {
    await seed('fw', await netKey('2001:db8:4b::1', true), L.loginFailNet48.max - 5, HOUR);
    const st = (await Promise.all(Array.from({ length: 30 }, (_, i) => login(uniqueName('b48'), key32(), `2001:db8:4b:${i.toString(16)}::1`)))).map(
      (r) => r.status,
    );
    expect(st.filter((x) => x !== 429)).toHaveLength(5);
    // the /64s refused by the /48 counter got their unit back: only the 5 failures are counted per /64
    let sum = 0;
    for (let i = 0; i < 30; i++) sum += await counter('fi', await netKey(`2001:db8:4b:${i.toString(16)}::1`), HOUR);
    expect(sum).toBe(5);
  });

  it('a parallel burst of wrong proofs on one session never gets past the session limit', async () => {
    const a = await register();
    const st = (await Promise.all(Array.from({ length: 30 }, () => call('DELETE', '/api/account', { jar: a.jar, body: { auth: key32() } })))).map(
      (r) => r.status,
    );
    expect(st.filter((x) => x === 400)).toHaveLength(L.sessionFail.max);
    expect(st.filter((x) => x === 429)).toHaveLength(30 - L.sessionFail.max);
    // and the right proof is refused too now, on this session only
    expect((await call('DELETE', '/api/account', { jar: a.jar, body: { auth: a.auth } })).status).toBe(429);
  });

  it('counters contain neither IP nor username', async () => {
    await login('klartextname', key32(), '10.9.8.7');
    const all = JSON.stringify((await env.DB.prepare('SELECT key FROM limits').all()).results);
    expect(all).not.toContain('10.9.8.7');
    expect(all).not.toContain('klartext');
  });

  it('per-account counters cannot be joined to users: no part of the account id in any key', async () => {
    const a = await register();
    const uid = await accountId(env, a.username);
    await login(a.username, key32(), '10.9.8.6'); // failed login: per-account counter
    await call('PUT', `/api/records/${rid()}`, { jar: a.jar, body: { data: fakeRecord() } }); // requests + writes
    const keys = (await env.DB.prepare('SELECT key FROM limits').all()).results.map((r) => String(r.key));
    for (const k of keys) expect(k.includes(uid.slice(0, 16)), k).toBe(false);
    const ak = await acctKey(env, uid);
    for (const name of ['aq', 'wd', 'fa']) expect(keys).toContain(`${name}|${ak}`);
    // and that key is not derivable from the stored id without PEPPER
    expect((await acctKey({ PEPPER: 'another-pepper' }, uid)) === ak).toBe(false);
  });

  it('the cron keeps no counter row longer than two days (hourly ones included)', async () => {
    const { runRetention } = await import('../../src/retention.js');
    const now = Date.now();
    const hourWin = Math.floor(now / HOUR) * HOUR;
    const put = (key, win) => env.DB.prepare('INSERT INTO limits (key, win, n) VALUES (?, ?, 1)').bind(key, win).run();
    await put('t|hour-25h', hourWin - 25 * HOUR);
    await put('t|hour-23h', hourWin - 23 * HOUR);
    await put('t|day-yesterday', Math.floor(now / DAY) * DAY - DAY);
    await put('t|day-today', Math.floor(now / DAY) * DAY);
    await runRetention(env.DB, now);
    const left = (await env.DB.prepare("SELECT key FROM limits WHERE key LIKE 't|%'").all()).results.map((r) => r.key).sort();
    // a window that started more than a day ago is over (no window is longer than a day); with one run
    // a day, a row lives at most 1 day + the time to the next run < 2 days
    expect(left).toContain('t|hour-23h');
    expect(left).toContain('t|day-today');
    expect(left).not.toContain('t|hour-25h');
    if (now - (Math.floor(now / DAY) * DAY - DAY) > DAY) expect(left).not.toContain('t|day-yesterday');
    await env.DB.prepare("DELETE FROM limits WHERE key LIKE 't|%'").run();
  });
});

describe('writes', () => {
  it('server: 100 record writes per account and UTC day (above the 12 a day in the app), then 429 daily_limit', async () => {
    const a = await register();
    for (let i = 0; i < 100; i++) {
      expect((await call('PUT', `/api/records/${rid()}`, { jar: a.jar, body: { data: fakeRecord() } })).status).toBe(200);
    }
    const r = await call('PUT', `/api/records/${rid()}`, { jar: a.jar, body: { data: fakeRecord() } });
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe('daily_limit');
    expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(Number(r.headers.get('Retry-After'))).toBeLessThanOrEqual(86_400);
    // The settings record is not counted
    expect((await call('PUT', `/api/records/${SETTINGS_ID}`, { jar: a.jar, body: { data: fakeRecord() } })).status).toBe(200);
    // Hard deletes are not counted and still work
    const { records } = await (await call('GET', '/api/records?since=0', { jar: a.jar })).json();
    const d = await call('DELETE', `/api/records/${records[0].id}`, { jar: a.jar, body: {} });
    expect(d.status).toBe(200);
    expect((await d.json()).deleted).toBe(1);
    // Another account is not affected
    const b = await register();
    expect((await call('PUT', `/api/records/${rid()}`, { jar: b.jar, body: { data: fakeRecord() } })).status).toBe(200);
    // Next UTC day: allowed again (simulate by moving the counter window back)
    const uid = await acctKey(env, await accountId(env, a.username));
    await env.DB.prepare('UPDATE limits SET win = win - ? WHERE key = ?').bind(DAY, `wd|${uid}`).run();
    expect((await call('PUT', `/api/records/${rid()}`, { jar: a.jar, body: { data: fakeRecord() } })).status).toBe(200);
  });

  it('no hourly limit fires before the daily one', async () => {
    // Fill every hourly counter that could be keyed by this account to its maximum: stamps still go through.
    const a = await register();
    const uid = await acctKey(env, await accountId(env, a.username));
    const win = Math.floor(Date.now() / HOUR) * HOUR;
    for (const l of Object.values(L).filter((x) => x.win === HOUR)) {
      await env.DB.prepare('INSERT INTO limits (key, win, n) VALUES (?, ?, ?)').bind(`${l.name}|${uid}`, win, l.max + 5).run();
    }
    for (let i = 0; i < 3; i++) expect((await call('PUT', `/api/records/${rid()}`, { jar: a.jar, body: { data: fakeRecord() } })).status).toBe(200);
    expect(L.writesPerDay).toMatchObject({ max: 100, win: DAY });
  });

  it('the settings record has its own daily budget', async () => {
    const a = await register();
    const win = Math.floor(Date.now() / DAY) * DAY;
    const uid = await acctKey(env, await accountId(env, a.username));
    await env.DB.prepare('INSERT INTO limits (key, win, n) VALUES (?, ?, ?)').bind(`sd|${uid}`, win, L.settingsPerDay.max).run();
    const r = await call('PUT', `/api/records/${SETTINGS_ID}`, { jar: a.jar, body: { data: fakeRecord() } });
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe('rate_limited');
    expect((await call('PUT', `/api/records/${rid()}`, { jar: a.jar, body: { data: fakeRecord() } })).status).toBe(200);
  });

  it('record size, id and body are checked; the settings record cannot be hard-deleted', async () => {
    const a = await register();
    expect((await call('PUT', `/api/records/${rid()}`, { jar: a.jar, body: { data: fakeRecord(513) } })).status).toBe(413);
    expect((await call('PUT', `/api/records/${rid()}`, { jar: a.jar, body: { data: 'not base64!' } })).status).toBe(400);
    // every client record has exactly one length (12 + 256 + 16 bytes as base64url = 379): nothing else
    for (const n of [1, 378, 380, 512]) {
      const r = await call('PUT', `/api/records/${rid()}`, { jar: a.jar, body: { data: fakeRecord(n) } });
      expect(r.status, String(n)).toBe(400);
      expect((await r.json()).error).toBe('data');
    }
    expect((await call('PUT', `/api/records/${rid()}`, { jar: a.jar, body: { data: fakeRecord(379) } })).status).toBe(200);
    expect((await call('PUT', '/api/records/xyz', { jar: a.jar, body: { data: fakeRecord() } })).status).toBe(400);
    expect((await call('PUT', `/api/records/${rid()}`, { jar: a.jar, raw: 'x'.repeat(9000) })).status).toBe(413);
    expect((await call('DELETE', `/api/records/${SETTINGS_ID}`, { jar: a.jar, body: {} })).status).toBe(400);
  });

  it('at most 5000 records per account', async () => {
    const a = await register();
    const uid = await accountId(env, a.username);
    const stmts = [];
    for (let i = 0; i < 5000; i++) {
      stmts.push(
        env.DB.prepare('INSERT INTO records (user_id, id, seq, data, written) VALUES (?, ?, ?, ?, 0)').bind(
          uid,
          (i + 1).toString(16).padStart(32, '0'),
          i + 1,
          'A',
        ),
      );
    }
    for (let i = 0; i < stmts.length; i += 1000) await env.DB.batch(stmts.slice(i, i + 1000));
    await env.DB.prepare('UPDATE users SET nrec = 5000 WHERE id = ?').bind(uid).run();
    expect((await call('PUT', `/api/records/${rid()}`, { jar: a.jar, body: { data: fakeRecord() } })).status).toBe(413);
    // Changing an existing one still works
    expect((await call('PUT', `/api/records/${(5).toString(16).padStart(32, '0')}`, { jar: a.jar, body: { data: fakeRecord() } })).status).toBe(200);
  });

  it('sync pages through records', async () => {
    const a = await register();
    const uid = await accountId(env, a.username);
    const stmts = [];
    for (let i = 0; i < 1200; i++) {
      stmts.push(env.DB.prepare('INSERT INTO records (user_id, id, seq, data, written) VALUES (?, ?, ?, ?, 0)').bind(uid, rid(), i + 1, 'A'));
    }
    await env.DB.batch(stmts);
    await env.DB.prepare('UPDATE users SET seq = 1200 WHERE id = ?').bind(uid).run();
    let since = 0;
    let total = 0;
    for (let page = 0; page < 5; page++) {
      const body = await (await call('GET', `/api/records?since=${since}`, { jar: a.jar })).json();
      total += body.records.length;
      since = body.seq;
      if (!body.more) break;
    }
    expect(total).toBe(1200);
    expect(since).toBe(1200);
  });
});
