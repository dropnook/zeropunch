import { describe, it, expect } from 'vitest';
import { call, register, pow, key32, uniqueName, Jar, env, BLOB, wrap, fakeRecord, rid } from './helpers.js';
import { accountId } from '../../src/api.js';
import { makeChallenge, POW_TTL } from '../../src/pow.js';
import { solve } from '../../public/js/pow.js';
import { createAccount, passphraseKeys, unlock, rewrapPassphrase, encryptRecord, decryptRecord } from '../../public/js/crypto.js';

const FAST = { iterations: 1000 };
const login = (username, auth, o = {}) => call('POST', '/api/auth/login', { ...o, body: { username, auth } });

describe('register, log in, change passphrase (real client crypto)', () => {
  it('full flow', async () => {
    const username = uniqueName('anna');
    const made = await createAccount(username, 'richtig-lange-passphrase', FAST);
    const jar = new Jar();
    const ip = '192.0.2.10';
    let res = await call('POST', '/api/auth/register', {
      jar,
      ip,
      body: { username, auth: made.auth, keys: made.blob, pow: await pow(ip) },
    });
    expect(made.blob).toEqual({ v: 1, pass: { iv: expect.any(String), ct: expect.any(String) } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, version: 1, now: expect.any(Number) });
    const sc = res.headers.getSetCookie()[0];
    expect(sc).toMatch(/^__Host-zp=/);
    // the cookie outlives the server-side session (61 days) by 64 days, see COOKIE_MAX_AGE
    expect(sc).toMatch(/Max-Age=10800000; HttpOnly; Secure; SameSite=Strict/);

    // The server never stores the username or the auth keys in clear.
    const dump = JSON.stringify((await env.DB.prepare('SELECT * FROM users').all()).results);
    expect(dump).not.toContain(username);
    expect(dump).not.toContain(made.auth);
    const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(await accountId(env, username)).first();
    expect(row).toBeTruthy();

    // Write a record with the real key
    const id = rid();
    const data = await encryptRecord(made.key, username, id, { v: 1, ts: Date.now(), note: '' });
    expect((await call('PUT', `/api/records/${id}`, { jar, body: { data } })).status).toBe(200);
    expect((await call('POST', '/api/auth/logout', { jar })).status).toBe(200);
    expect(jar.map.size).toBe(0);
    expect((await call('GET', '/api/keys', { jar })).status).toBe(401);

    // Second device: username + passphrase
    const dev2 = new Jar();
    const k = await passphraseKeys(username, 'richtig-lange-passphrase', FAST.iterations);
    res = await login(username, k.auth, { jar: dev2 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(1);
    const un = await unlock(body.keys, k.wrapKey, username);
    expect(un.fingerprint).toBe(made.fingerprint);
    const g = await (await call('GET', '/api/records?since=0', { jar: dev2 })).json();
    expect((await decryptRecord(un.key, username, id, g.records[0].data)).note).toBe('');

    // Passphrase change with the current authKey
    expect(body.keys).toEqual(made.blob);
    const re = await rewrapPassphrase(body.keys, k.wrapKey, username, 'zweite-lange-passphrase', FAST);
    res = await call('POST', '/api/auth/passphrase', { jar: dev2, body: { auth: k.auth, newAuth: re.auth, keys: re.blob, version: 1 } });
    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe(2);
    // stale version → conflict
    res = await call('POST', '/api/auth/passphrase', { jar: dev2, body: { auth: re.auth, newAuth: key32(), keys: re.blob, version: 1 } });
    expect(res.status).toBe(409);
    // wrong current authKey → refused
    res = await call('POST', '/api/auth/passphrase', { jar: dev2, body: { auth: key32(), newAuth: key32(), keys: re.blob, version: 2 } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('wrong_auth');
    // without a session → 401
    res = await call('POST', '/api/auth/passphrase', { body: { auth: re.auth, newAuth: key32(), keys: re.blob, version: 2 } });
    expect(res.status).toBe(401);
    // old passphrase no longer works, new one does
    expect((await login(username, k.auth)).status).toBe(401);
    expect((await login(username, re.auth)).status).toBe(200);

    // The recovery routes of 2.3 are gone: they answer like any unknown route.
    for (const path of ['/api/auth/recover', '/api/auth/recovery']) {
      res = await call('POST', path, { jar: dev2, body: { username, recAuth: key32() } });
      expect(res.status, path).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }

    // Delete the account: everything is gone
    // ... which needs proof of the passphrase: without a body, with a malformed or a wrong one it is refused
    res = await call('DELETE', '/api/account', { jar: dev2 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_request' });
    for (const bad of [{}, { auth: 'short' }, { auth: 42 }]) {
      res = await call('DELETE', '/api/account', { jar: dev2, body: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_request' });
    }
    res = await call('DELETE', '/api/account', { jar: dev2, raw: '{not json' });
    expect(res.status).toBe(400);
    res = await call('DELETE', '/api/account', { jar: dev2, body: { auth: k.auth } }); // the old passphrase
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'wrong_auth' });
    expect((await login(username, re.auth)).status).toBe(200); // nothing deleted
    res = await call('DELETE', '/api/account', { jar: dev2, body: { auth: re.auth } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await login(username, re.auth)).status).toBe(401);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM records WHERE user_id = ?').bind(await accountId(env, username)).first()).toEqual({ n: 0 });
    expect((await call('GET', '/api/keys', { jar: dev2 })).status).toBe(401);
  });

  it('an old client (2.3 app shell): its registration is refused before anything is spent, its passphrase change works', async () => {
    const username = uniqueName('alt');
    const made = await createAccount(username, 'alte-app-passphrase', FAST);
    const oldBlob = { ...made.blob, rec: wrap() };
    const jar = new Jar();
    const ip = '192.0.2.12';
    // 2.3 would show a recovery key that no longer exists: refused, the challenge stays unspent
    const p = await pow(ip);
    let res = await call('POST', '/api/auth/register', { jar, ip, body: { username, auth: made.auth, recAuth: key32(), keys: oldBlob, pow: p } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'update_required' });
    expect(jar.map.size).toBe(0);
    // the same challenge and the name are still available to the updated app; a `rec` part (2.3 blob) is dropped
    res = await call('POST', '/api/auth/register', { jar, ip, body: { username, auth: made.auth, keys: oldBlob, pow: p } });
    expect(res.status).toBe(200);
    // stored and handed out without `rec`
    expect((await (await call('GET', '/api/keys', { jar })).json()).keys).toEqual(made.blob);
    const k = await passphraseKeys(username, 'alte-app-passphrase', FAST.iterations);
    const re = await rewrapPassphrase(made.blob, k.wrapKey, username, 'neue-app-passphrase', FAST);
    res = await call('POST', '/api/auth/passphrase', {
      jar,
      body: { auth: k.auth, newAuth: re.auth, keys: { ...re.blob, rec: oldBlob.rec }, version: 1 },
    });
    expect(res.status).toBe(200);
    const body = await (await login(username, re.auth)).json();
    expect(body.keys).toEqual(re.blob);
    expect(Object.keys(body.keys)).toEqual(['v', 'pass']);
    // a malformed `rec` is still refused (the old shape only)
    res = await call('POST', '/api/auth/passphrase', {
      jar,
      body: { auth: re.auth, newAuth: key32(), keys: { ...re.blob, rec: { iv: 'x', ct: 'y' } }, version: 2 },
    });
    expect(res.status).toBe(400);
  });

  it('username is lowercased and validated; taken names are reported', async () => {
    const name = uniqueName('Bert').toUpperCase();
    const a = await register({ username: name });
    expect(a.res.status).toBe(200);
    // Same name in other case → taken
    const b = await register({ username: name.toLowerCase() });
    expect(b.res.status).toBe(409);
    expect((await b.res.json()).error).toBe('username_taken');
    // Login works with any case
    expect((await login(name.toLowerCase(), a.auth)).status).toBe(200);
    for (const bad of ['ab', 'x'.repeat(33), 'mit leerzeichen', 'ümlaut', 'a/b']) {
      const r = await register({ username: bad });
      expect(r.res.status, bad).toBe(400);
      expect((await r.res.json()).error).toBe('username');
    }
  });

  it('a taken name spends the proof of work (probing costs a solved challenge each time)', async () => {
    const a = await register();
    const p = await pow('192.0.2.77');
    let r = await call('POST', '/api/auth/register', {
      ip: '192.0.2.77',
      body: { username: a.username, auth: key32(), keys: BLOB, pow: p },
    });
    expect(r.status).toBe(409);
    r = await call('POST', '/api/auth/register', {
      ip: '192.0.2.77',
      body: { username: uniqueName('frei'), auth: key32(), keys: BLOB, pow: p },
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('pow_used');
    // a taken name does not use up one of the network's registrations
    for (let i = 0; i < 5; i++) expect((await register({ ip: '192.0.2.77' })).res.status).toBe(200);
  });

  it('session slides and marks the account as seen', async () => {
    const a = await register();
    const uid = await accountId(env, a.username);
    await env.DB.prepare('UPDATE users SET last_seen = 0 WHERE id = ?').bind(uid).run();
    await env.DB.prepare('UPDATE sessions SET touched = 0 WHERE user_id = ?').bind(uid).run();
    const r = await call('GET', '/api/keys', { jar: a.jar });
    expect(r.status).toBe(200);
    expect(r.headers.getSetCookie().some((c) => c.startsWith('__Host-zp='))).toBe(true);
    const row = await env.DB.prepare('SELECT last_seen FROM users WHERE id = ?').bind(uid).first();
    expect(row.last_seen).toBe(Math.floor(Date.now() / 86_400_000) * 86_400_000);
  });

  it('log out all devices', async () => {
    const a = await register();
    const dev2 = new Jar();
    expect((await login(a.username, a.auth, { jar: dev2 })).status).toBe(200);
    expect((await call('POST', '/api/auth/logout-all', { jar: a.jar })).status).toBe(200);
    expect((await call('GET', '/api/keys', { jar: dev2 })).status).toBe(401);
  });
});

describe('login failures are indistinguishable', () => {
  it('unknown user and wrong passphrase: same status, same body, same headers', async () => {
    const a = await register();
    const unknown = await login(uniqueName('niemand'), key32(), { ip: '192.0.2.31' });
    const wrong = await login(a.username, key32(), { ip: '192.0.2.32' });
    const invalidName = await login('NO SUCH NAME!', key32(), { ip: '192.0.2.33' });
    for (const r of [unknown, wrong, invalidName]) {
      expect(r.status).toBe(401);
      expect(r.headers.getSetCookie()).toEqual([]);
    }
    const bodies = await Promise.all([unknown.text(), wrong.text(), invalidName.text()]);
    expect(new Set(bodies).size).toBe(1);
    expect([...unknown.headers.keys()].sort()).toEqual([...wrong.headers.keys()].sort());
  });

  it('same work on both paths: unknown name and wrong passphrase run the same queries in the same order', async () => {
    // A timing assertion in a test runtime can hardly fail; the queries are what an observer could time.
    const { counting } = await import('./helpers.js');
    const a = await register();
    const run = async (username, ip) => {
      const { env: e, c } = counting();
      const r = await login(username, key32(), { ip, env: e });
      return { status: r.status, body: await r.text(), sql: c.sql };
    };
    const unknown = await run(uniqueName('nobody'), '192.0.3.1');
    const wrong = await run(a.username, '192.0.4.1');
    const invalid = await run('NOT A VALID NAME', '192.0.5.1');
    expect(unknown.sql.length).toBeGreaterThanOrEqual(3);
    expect(wrong.sql).toEqual(unknown.sql);
    expect(invalid.sql).toEqual(unknown.sql);
    expect(new Set([unknown.body, wrong.body, invalid.body]).size).toBe(1);
    // and the user row is looked up on both paths (a missing row is not a shortcut)
    expect(unknown.sql.filter((q) => q.startsWith('SELECT auth, keys'))).toHaveLength(1);
  });

  it('accounts under attack: unknown and known names answer the same 428, then the same way with a proof of work', async () => {
    const a = await register();
    const ghost = uniqueName('ghost');
    for (let i = 0; i < 20; i++) {
      await login(a.username, key32(), { ip: `10.1.${i}.1` });
      await login(ghost, key32(), { ip: `10.2.${i}.1` });
    }
    const r1 = await login(a.username, key32(), { ip: '10.1.99.1' });
    const r2 = await login(ghost, key32(), { ip: '10.2.99.1' });
    expect(r1.status).toBe(428);
    expect(r2.status).toBe(428);
    const [b1, b2] = [await r1.text(), await r2.text()];
    expect(b1).toBe(b2);
    expect(b1).toBe('{"error":"pow_required"}');
    // with a proof of work: wrong key → the usual 401 for both
    const w1 = await call('POST', '/api/auth/login', { ip: '10.1.98.1', body: { username: a.username, auth: key32(), pow: await pow('10.1.98.1', '?for=login') } });
    const w2 = await call('POST', '/api/auth/login', { ip: '10.2.98.1', body: { username: ghost, auth: key32(), pow: await pow('10.2.98.1', '?for=login') } });
    expect(w1.status).toBe(401);
    expect(w2.status).toBe(401);
    expect(await w1.text()).toBe(await w2.text());
  });
});

describe('proof of work', () => {
  const body = (p) => ({ username: uniqueName('pow'), auth: key32(), keys: BLOB, pow: p });

  it('missing, forged or wrong solution is refused', async () => {
    const ip = '192.0.2.90';
    let r = await call('POST', '/api/auth/register', { ip, body: body(undefined) });
    expect((await r.json()).error).toBe('pow_invalid');
    const ch = await (await call('GET', '/api/auth/challenge', { ip })).json();
    expect(ch.bits).toBe(4);
    // wrong nonce: find one that does NOT satisfy the target
    let bad = 0;
    const { leadingZeroBits } = await import('../../src/pow.js');
    for (;; bad++) {
      const hsh = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ch.challenge}:${bad}`)));
      if (leadingZeroBits(hsh) < ch.bits) break;
    }
    r = await call('POST', '/api/auth/register', { ip, body: body({ challenge: ch.challenge, nonce: String(bad) }) });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('pow_invalid');
    // tampered challenge (lower bits) → signature fails
    const parts = ch.challenge.split('.');
    const forged = [parts[0], parts[1], '0', parts[3]].join('.');
    r = await call('POST', '/api/auth/register', { ip, body: body({ challenge: forged, nonce: '0' }) });
    expect((await r.json()).error).toBe('pow_invalid');
    // challenge signed with another secret
    const other = await makeChallenge({ PEPPER: 'other', POW_BITS: '4' });
    const s = await solve(other.challenge, other.bits);
    r = await call('POST', '/api/auth/register', { ip, body: body({ challenge: other.challenge, nonce: s.nonce }) });
    expect((await r.json()).error).toBe('pow_invalid');
  });

  it('expired challenge is refused', async () => {
    const old = await makeChallenge(env, Date.now() - POW_TTL - 1000);
    const s = await solve(old.challenge, old.bits);
    const r = await call('POST', '/api/auth/register', { ip: '192.0.2.91', body: body({ challenge: old.challenge, nonce: s.nonce }) });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('pow_expired');
  });

  it('a solution works only once', async () => {
    const p = await pow('192.0.2.92');
    expect((await call('POST', '/api/auth/register', { ip: '192.0.2.92', body: body(p) })).status).toBe(200);
    const r = await call('POST', '/api/auth/register', { ip: '192.0.2.93', body: body(p) });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('pow_used');
  });
});
