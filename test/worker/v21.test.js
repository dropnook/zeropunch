// 2.1: key blob at rest, stored times, body limit, sessions, https, sync snapshot.
import { describe, it, expect } from 'vitest';
import { createExecutionContext, waitOnExecutionContext, createScheduledController } from 'cloudflare:test';
import { call, register, key32, Jar, env, worker, BLOB, wrap, fakeRecord, rid, pow, ORIGIN, uniqueName } from './helpers.js';
import { acctKey, accountId, MAX_SESSIONS, MAX_BODY } from '../../src/api.js';
import { runRetention } from '../../src/retention.js';
import { DAY, utcDay, limits } from '../../src/limits.js';
import { clientNet } from '../../src/util.js';
import { createAccount, passphraseKeys, unlock, rewrapPassphrase } from '../../public/js/crypto.js';

const FAST = { iterations: 1000 };
const login = (username, auth, o = {}) => call('POST', '/api/auth/login', { ...o, body: { username, auth } });
const userRow = async (username) => env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(await accountId(env, username)).first();

describe('client network', () => {
  it('IPv4 as is, IPv6 as /64, mapped IPv4 as IPv4', () => {
    expect(clientNet('203.0.113.7')).toBe('203.0.113.7');
    expect(clientNet('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(clientNet('2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(clientNet('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientNet('::ffff:198.51.100.4')).toBe('198.51.100.4');
    expect(clientNet(null)).toBe('local');
  });
});

describe('key blob at rest (A2)', () => {
  it('is stored encrypted under PEPPER; login and /api/keys return it in clear', async () => {
    const blob = { v: 1, pass: wrap() };
    const a = await register({ keys: blob });
    const row = await userRow(a.username);
    expect(String(row.keys).startsWith('e1.')).toBe(true);
    for (const part of [blob.pass.iv, blob.pass.ct]) expect(String(row.keys)).not.toContain(part);
    expect((await (await call('GET', '/api/keys', { jar: a.jar })).json()).keys).toEqual(blob);
    expect((await (await login(a.username, a.auth)).json()).keys).toEqual(blob);
  });

  it('an account from before 2.1 (plain blob, still with the old rec part) logs in, and the blob is encrypted on that login', async () => {
    const username = uniqueName('legacy');
    const made = await createAccount(username, 'eine-alte-passphrase', FAST);
    const uid = await accountId(env, username);
    const { hmacHex } = await import('../../src/util.js');
    await env.DB.prepare('INSERT INTO users (id, auth, keys, created, last_seen) VALUES (?, ?, ?, ?, ?)')
      .bind(uid, await hmacHex(env.PEPPER, `auth|${made.auth}`), JSON.stringify({ ...made.blob, rec: wrap() }), utcDay(Date.now()), utcDay(Date.now()))
      .run();
    const r = await login(username, made.auth);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.keys).toEqual(made.blob);
    const k = await passphraseKeys(username, 'eine-alte-passphrase', FAST.iterations);
    expect((await unlock(body.keys, k.wrapKey, username)).fingerprint).toBe(made.fingerprint);
    expect(String((await userRow(username)).keys).startsWith('e1.')).toBe(true);
    expect((await login(username, made.auth)).status).toBe(200);
  });

  it('the daily cron encrypts the remaining plain blobs', async () => {
    const a = await register();
    const uid = await accountId(env, a.username);
    await env.DB.prepare('UPDATE users SET keys = ? WHERE id = ?').bind(JSON.stringify(BLOB), uid).run();
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: '17 3 * * *' }), env, ctx);
    await waitOnExecutionContext(ctx);
    const row = await userRow(a.username);
    expect(String(row.keys).startsWith('e1.')).toBe(true);
    expect((await (await call('GET', '/api/keys', { jar: a.jar })).json()).keys).toEqual(BLOB);
  });

  it('only the exact blob shape from crypto.js is accepted (register and passphrase change)', async () => {
    const REC = wrap();
    const bad = [
      { ...BLOB, extra: 1 },
      { v: 2, pass: BLOB.pass },
      { v: 1 },
      { v: 1, rec: wrap() },
      { v: 1, pass: { iv: 'short', ct: BLOB.pass.ct } },
      { v: 1, pass: { ...BLOB.pass, x: 'y' } },
      // the old `rec` part (clients before 2.4) only in its exact old shape
      { v: 1, pass: BLOB.pass, rec: { iv: REC.iv, ct: REC.ct + 'AAAA' } },
      { v: 1, pass: BLOB.pass, rec: { iv: REC.iv, ct: 'x'.repeat(1000) } },
      { v: 1, pass: BLOB.pass, rec: null },
      'string',
      [BLOB],
    ];
    for (const keys of bad) {
      const r = await register({ keys });
      expect(r.res.status, JSON.stringify(keys).slice(0, 60)).toBe(400);
      expect((await r.res.json()).error).toBe('keys');
    }
    const a = await register();
    for (const keys of bad.slice(0, 3)) {
      const r = await call('POST', '/api/auth/passphrase', { jar: a.jar, body: { auth: a.auth, newAuth: key32(), keys, version: 1 } });
      expect(r.status).toBe(400);
    }
  });
});

describe('stored times and counters (A3)', () => {
  it('sessions keep only UTC days; sliding expiry still works', async () => {
    const a = await register();
    const uid = await accountId(env, a.username);
    const s = await env.DB.prepare('SELECT touched, expires FROM sessions WHERE user_id = ?').bind(uid).first();
    expect(s.touched % DAY).toBe(0);
    expect(s.expires % DAY).toBe(0);
    expect(s.touched).toBe(utcDay(Date.now()));
    // a day later the session slides (new expiry, again a whole day)
    await env.DB.prepare('UPDATE sessions SET touched = touched - ?, expires = expires - ? WHERE user_id = ?').bind(DAY, DAY, uid).run();
    const r = await call('GET', '/api/keys', { jar: a.jar });
    expect(r.headers.getSetCookie().some((c) => c.startsWith('__Host-zp='))).toBe(true);
    const s2 = await env.DB.prepare('SELECT touched, expires FROM sessions WHERE user_id = ?').bind(uid).first();
    expect(s2).toEqual(s);
  });

  it('users.nrec follows puts, upserts, deletes and the cron', async () => {
    const a = await register();
    const uid = await accountId(env, a.username);
    const n = async () => Number((await userRow(a.username)).nrec);
    const real = async () => Number((await env.DB.prepare('SELECT COUNT(*) AS c FROM records WHERE user_id = ?').bind(uid).first()).c);
    const ids = [rid(), rid(), rid()];
    for (const id of ids) await call('PUT', `/api/records/${id}`, { jar: a.jar, body: { data: fakeRecord() } });
    expect(await n()).toBe(3);
    await call('PUT', `/api/records/${ids[0]}`, { jar: a.jar, body: { data: fakeRecord(379, 'C') } }); // upsert
    expect(await n()).toBe(3);
    await call('DELETE', `/api/records/${ids[1]}`, { jar: a.jar, body: {} });
    await call('DELETE', `/api/records/${ids[1]}`, { jar: a.jar, body: {} }); // again: no change
    expect(await n()).toBe(2);
    await env.DB.prepare('UPDATE records SET written = ? WHERE user_id = ? AND id = ?').bind(utcDay(Date.now()) - 400 * DAY, uid, ids[2]).run();
    await runRetention(env.DB);
    expect(await n()).toBe(1);
    expect(await real()).toBe(1);
  });

  it('migration 0002 back-fills the counter and rounds old session times', async () => {
    const a = await register();
    const uid = await accountId(env, a.username);
    for (let i = 0; i < 4; i++) await call('PUT', `/api/records/${rid()}`, { jar: a.jar, body: { data: fakeRecord() } });
    // state as left by 2.0: counter 0, session times to the millisecond, an orphaned session
    const t = Date.now();
    await env.DB.prepare('UPDATE users SET nrec = 0 WHERE id = ?').bind(uid).run();
    await env.DB.prepare('UPDATE sessions SET touched = ?, expires = ? WHERE user_id = ?').bind(t, t + 90 * DAY, uid).run();
    await env.DB.prepare('INSERT INTO sessions (hash, user_id, expires, touched) VALUES (?, ?, ?, ?)').bind(`orphan${rid()}`, 'gone', t + DAY, t).run();
    const m = env.TEST_MIGRATIONS.find((x) => x.name.startsWith('0002'));
    for (const q of m.queries.filter((q) => !/ALTER TABLE/i.test(q))) await env.DB.prepare(q).run();
    expect(Number((await userRow(a.username)).nrec)).toBe(4);
    const s = await env.DB.prepare('SELECT touched, expires FROM sessions WHERE user_id = ?').bind(uid).first();
    expect(s.touched).toBe(utcDay(t));
    expect(s.expires).toBeGreaterThanOrEqual(t + 90 * DAY);
    expect(s.expires % DAY).toBe(0);
    expect(await env.DB.prepare("SELECT 1 FROM sessions WHERE user_id = 'gone'").first()).toBeNull();
    expect((await call('GET', '/api/keys', { jar: a.jar })).status).toBe(200);
  });
});

describe('request body limit (A4)', () => {
  it('a Content-Length above the limit is refused before reading', async () => {
    const a = await register();
    const r = await call('PUT', `/api/records/${rid()}`, { jar: a.jar, raw: '{}', headers: { 'Content-Length': String(80 * 1024 * 1024) } });
    expect(r.status).toBe(413);
  });

  it('counts bytes, not UTF-16 characters', async () => {
    const a = await register();
    const raw = JSON.stringify({ data: 'A', pad: '€'.repeat(3000) }); // ~3000 chars, ~9000 bytes
    expect(raw.length).toBeLessThan(MAX_BODY);
    const r = await call('PUT', `/api/records/${rid()}`, { jar: a.jar, raw });
    expect(r.status).toBe(413);
  });

  it('a stream without Content-Length is cancelled right after 8 KiB', async () => {
    const a = await register();
    let sent = 0;
    let cancelled = false;
    const chunk = new Uint8Array(1024).fill(32);
    const body = new ReadableStream({
      pull(c) {
        if (sent >= 80 * 1024 * 1024) return c.close();
        sent += chunk.length;
        c.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const h = new Headers({ Origin: ORIGIN, 'Content-Type': 'application/json', Cookie: a.jar.header(), 'CF-Connecting-IP': '203.0.113.9' });
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request(`${ORIGIN}/api/records/${rid()}`, { method: 'PUT', headers: h, body, duplex: 'half' }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(64 * 1024);
    expect(cancelled || sent < 64 * 1024).toBe(true);
  });
});

describe('sessions (A6)', () => {
  it('a passphrase change ends all other sessions, the own one stays', async () => {
    const username = uniqueName('sess');
    const made = await createAccount(username, 'alte-lange-passphrase', FAST);
    const jar = new Jar();
    await call('POST', '/api/auth/register', { jar, ip: '192.0.2.150', body: { username, auth: made.auth, keys: made.blob, pow: await pow('192.0.2.150') } });
    const other = new Jar();
    expect((await login(username, made.auth, { jar: other })).status).toBe(200);
    const k = await passphraseKeys(username, 'alte-lange-passphrase', FAST.iterations);
    const re = await rewrapPassphrase(made.blob, k.wrapKey, username, 'neue-lange-passphrase', FAST);
    const r = await call('POST', '/api/auth/passphrase', { jar, body: { auth: made.auth, newAuth: re.auth, keys: re.blob, version: 1 } });
    expect(r.status).toBe(200);
    expect((await call('GET', '/api/keys', { jar })).status).toBe(200);
    expect((await call('GET', '/api/keys', { jar: other })).status).toBe(401);
  });

  it(`at most ${MAX_SESSIONS} sessions per account: the oldest go`, async () => {
    const a = await register();
    const jars = [a.jar];
    for (let i = 0; i < MAX_SESSIONS + 2; i++) {
      const j = new Jar();
      expect((await login(a.username, a.auth, { jar: j, ip: `10.20.${i}.1` })).status).toBe(200);
      jars.push(j);
    }
    const uid = await accountId(env, a.username);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').bind(uid).first()).n).toBe(MAX_SESSIONS);
    expect((await call('GET', '/api/keys', { jar: jars[0] })).status).toBe(401);
    expect((await call('GET', '/api/keys', { jar: jars[2] })).status).toBe(401);
    expect((await call('GET', '/api/keys', { jar: jars[3] })).status).toBe(200);
    expect((await call('GET', '/api/keys', { jar: jars.at(-1) })).status).toBe(200);
  });

  it('a login that races an account deletion creates no session; the cron removes orphans', async () => {
    const a = await register();
    const uid = await accountId(env, a.username);
    // Delete the account right after the login has read the user row.
    const DB = {
      prepare(sql) {
        const st = env.DB.prepare(sql);
        if (!sql.startsWith('SELECT auth, keys, keys_version, last_seen FROM users')) return st;
        return {
          bind: (...args) => {
            const b = st.bind(...args);
            return {
              first: async () => {
                const row = await b.first();
                await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(uid), env.DB.prepare('DELETE FROM users WHERE id = ?').bind(uid)]);
                return row;
              },
            };
          },
        };
      },
      batch: (s) => env.DB.batch(s),
    };
    const r = await call('POST', '/api/auth/login', { env: { ...env, DB }, body: { username: a.username, auth: a.auth } });
    expect(r.status).toBe(401);
    expect(r.headers.getSetCookie()).toEqual([]);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').bind(uid).first()).n).toBe(0);
    await env.DB.prepare('INSERT INTO sessions (hash, user_id, expires, touched) VALUES (?, ?, ?, ?)').bind(`o${rid()}`, uid, Date.now() + DAY, 0).run();
    await runRetention(env.DB);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').bind(uid).first()).n).toBe(0);
  });

  it('authenticated requests have a daily budget per account (successful logins included)', async () => {
    const a = await register();
    const L = limits(env);
    const uid = await acctKey(env, await accountId(env, a.username));
    await env.DB.prepare('INSERT INTO limits (key, win, n) VALUES (?, ?, ?) ON CONFLICT (key, win) DO UPDATE SET n = excluded.n')
      .bind(`aq|${uid}`, utcDay(Date.now()), L.requestsPerDay.max)
      .run();
    const r = await call('GET', '/api/records?since=0', { jar: a.jar });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await login(a.username, a.auth)).status).toBe(429);
    expect(L.requestsPerDay.max).toBeGreaterThan((24 * 3600) / 2); // 2-second polling all day fits
  });
});

describe('https only (A8)', () => {
  it('plain http is refused except on localhost', async () => {
    for (const host of ['http://zeropunch.app', 'http://punch.example.org']) {
      const r = await call('GET', '/api/auth/challenge', { host });
      expect(r.status, host).toBe(403);
      expect((await r.json()).error).toBe('https_required');
      expect((await call('POST', '/api/auth/login', { host, body: { username: 'x.y.z', auth: key32() } })).status).toBe(403);
    }
    for (const host of ['http://localhost:8787', 'http://127.0.0.1:8787', 'http://[::1]:8787', 'https://zeropunch.app']) {
      expect((await call('GET', '/api/auth/challenge', { host })).status, host).toBe(200);
    }
  });
});

describe('sync snapshot (B4)', () => {
  it('a write landing between reading the records and reading seq is not skipped', async () => {
    const a = await register();
    const uid = await accountId(env, a.username);
    const first = rid();
    await call('PUT', `/api/records/${first}`, { jar: a.jar, body: { data: fakeRecord() } });
    const late = rid();
    let done = false;
    // A concurrent PUT that lands right after the records were read.
    const concurrent = async () => {
      if (done) return;
      done = true;
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET seq = seq + 1, nrec = nrec + 1 WHERE id = ?1').bind(uid),
        env.DB.prepare('INSERT INTO records (user_id, id, seq, data, written) VALUES (?1, ?2, (SELECT seq FROM users WHERE id = ?1), ?3, 0)').bind(uid, late, 'B'),
      ]);
    };
    const isRead = (sql) => sql.startsWith('SELECT id, seq, data FROM records');
    const DB = {
      prepare(sql) {
        const st = env.DB.prepare(sql);
        if (!isRead(sql)) return st;
        return {
          sql,
          bind: (...args) => {
            const b = st.bind(...args);
            b.__read = true;
            const all = b.all.bind(b);
            b.all = async () => {
              const r = await all();
              await concurrent();
              return r;
            };
            return b;
          },
        };
      },
      async batch(stmts) {
        const out = await env.DB.batch(stmts);
        if (stmts.some((s) => s.__read)) await concurrent();
        return out;
      },
    };
    const g1 = await (await call('GET', '/api/records?since=0', { jar: a.jar, env: { ...env, DB } })).json();
    expect(g1.records.map((r) => r.id)).toEqual([first]);
    expect(Number.isFinite(g1.now)).toBe(true);
    const g2 = await (await call('GET', `/api/records?since=${g1.seq}`, { jar: a.jar })).json();
    expect(g2.records.map((r) => r.id)).toEqual([late]);
  });
});
