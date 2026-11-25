// API under /api/*. The server only ever sees HMACs, hashes and fixed-size ciphertext.

import { hmacHex, randomToken, sha256Hex, safeEqual, clientNet, clientNet48, sealKeys, openKeys, SEALED } from './util.js';
import { limits, hit, hitCount, unhit, count, take, regExtraBits, DAY, utcDay } from './limits.js';
import { makeChallenge, checkSolution, powBits } from './pow.js';
import { SETTINGS_ID, IDLE_DAYS, COOKIE_GRACE_DAYS, rememberGone } from './retention.js';

/** Shown in /api/admin/stats; kept equal to package.json and the client by a unit test. */
export const VERSION = '2026.11.25';

export const SESSION_COOKIE = '__Host-zp';
/** Sliding session lifetime: as long as an unused account lives, not longer. */
export const SESSION_TTL = IDLE_DAYS * DAY;
/**
 * Max-Age of the session cookie, in seconds: well beyond the server-side life, so that a device whose
 * account was deleted (also by the idle purge at last_seen + 62 days) still presents the cookie and
 * learns «account deleted» (410). The server's expiry stays authoritative.
 */
export const COOKIE_MAX_AGE = (SESSION_TTL + COOKIE_GRACE_DAYS * DAY) / 1000;
/** Upper bound of a record (base64url) that the route accepts at all; real records have RECORD_LEN. */
export const MAX_RECORD_BYTES = 512;
/**
 * Every record the client writes has exactly this length: base64url (no padding) of 12 bytes IV,
 * 256 bytes padded plaintext and 16 bytes tag (public/js/crypto.js PLAINTEXT_SIZE, the same in every
 * version). Anything else is refused.
 */
export const RECORD_LEN = Math.ceil(((12 + 256 + 16) * 4) / 3);
export const MAX_RECORDS = 5000;
export const MAX_KEYS_BYTES = 4096;
export const MAX_SESSIONS = 20;
export const MAX_BODY = 8192;
const PAGE_SIZE = 500;
const RECORD_ID = /^[0-9a-f]{32}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
/** 32 bytes as base64url without padding. */
const KEY32 = /^[A-Za-z0-9_-]{43}$/;
export const USERNAME = /^[a-z0-9._-]{3,32}$/;
const NO_MATCH = '0'.repeat(64);
/** Shapes produced by public/js/crypto.js: 12-byte IV, 32-byte key + 16-byte tag, base64url. */
const WRAP_IV = /^[A-Za-z0-9_-]{16}$/;
const WRAP_CT = /^[A-Za-z0-9_-]{64}$/;
/** Hosts on which the API also answers plain http (local development). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * 2.4 is deployed before migration 0003 runs (see README). Until then the database still has the
 * column users.rec_auth (NOT NULL) and no table gone_sessions; these two checks let exactly those
 * errors pass, so nothing fails in between. Any other error is thrown as usual.
 */
const beforeMigration3 = {
  recAuth: (/** @type {any} */ e) => /NOT NULL constraint failed: users\.rec_auth/.test(String(e?.message ?? e)),
  goneTable: (/** @type {any} */ e) => /no such table: gone_sessions/.test(String(e?.message ?? e)),
};

/** @param {number} status @param {unknown} body @param {Headers | Record<string,string>} [headers] */
function json(status, body, headers) {
  const h = new Headers(headers);
  h.set('Content-Type', 'application/json; charset=utf-8');
  h.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers: h });
}

/** @param {number} status @param {string} code @param {Record<string,string>} [headers] */
const err = (status, code, headers) => json(status, { error: code }, headers);

/** Same status, same body for unknown user and wrong secret. */
const loginFailed = () => err(401, 'login_failed');

/** @param {Request} req @param {string} name */
function getCookie(req, name) {
  const raw = req.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** @param {string} name @param {string} value @param {number} maxAgeSec */
function cookie(name, value, maxAgeSec) {
  return `${name}=${value}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=Strict`;
}

/**
 * Read the body as UTF-8, at most MAX_BODY bytes. Refuses early on a too large Content-Length and
 * cancels the stream as soon as more bytes arrive than allowed (also if the header is missing or lies).
 * @param {Request} req @returns {Promise<string | null>} null = too large
 */
async function readLimited(req) {
  const cl = req.headers.get('Content-Length');
  if (cl !== null && (!/^\d{1,15}$/.test(cl.trim()) || Number(cl) > MAX_BODY)) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    buf.set(c, o);
    o += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

/** @param {Request} req */
async function readJson(req) {
  const ct = req.headers.get('Content-Type') || '';
  if (!ct.toLowerCase().startsWith('application/json')) return { error: err(415, 'content_type') };
  const text = await readLimited(req);
  if (text === null) return { error: err(413, 'too_large') };
  try {
    const body = text ? JSON.parse(text) : {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: err(400, 'bad_json') };
    return { body };
  } catch {
    return { error: err(400, 'bad_json') };
  }
}

/**
 * The IP is used only transiently, as a keyed hash for rate limiting. Grouped by client network
 * (IPv4 address, IPv6 /64), so one subscriber cannot rotate through its own IPv6 addresses.
 * @param {Request} req @param {Record<string, any>} env
 */
async function ipKey(req, env) {
  return (await hmacHex(env.PEPPER, `ip|${clientNet(req.headers.get('CF-Connecting-IP'))}`)).slice(0, 32);
}

/** The keyed hash of the client's IPv6 /48 for the coarser limits; null for IPv4. @param {Request} req @param {Record<string, any>} env */
async function net48Key(req, env) {
  const net = clientNet48(req.headers.get('CF-Connecting-IP'));
  return net ? (await hmacHex(env.PEPPER, `ip|${net}`)).slice(0, 32) : null;
}

/**
 * Key of the per-account counters (requests, writes, failed logins): its own HMAC of the account id,
 * so the counter rows cannot be joined to `users` without PEPPER. @param {Record<string, any>} env @param {string} userId
 */
export async function acctKey(env, userId) {
  return (await hmacHex(env.PEPPER, `acct|${userId}`)).slice(0, 32);
}

/** @param {unknown} u */
export function normalizeUsername(u) {
  if (typeof u !== 'string') return null;
  const s = u.trim().toLowerCase();
  return USERNAME.test(s) ? s : null;
}

/** Account id = HMAC(PEPPER, username). The username itself is never stored. @param {Record<string, any>} env @param {string} username */
export function accountId(env, username) {
  return hmacHex(env.PEPPER, `user|${username}`);
}

/** @param {Record<string, any>} env @param {string} kind @param {string} secret */
const secretHash = (env, kind, secret) => hmacHex(env.PEPPER, `${kind}|${secret}`);

/** @param {unknown} o @param {string[]} keys */
const exactKeys = (o, keys) =>
  !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));

/** One wrapping of the master key, exactly as crypto.js makes it: { iv, ct }. @param {unknown} w */
export function validWrap(w) {
  return exactKeys(w, ['iv', 'ct']) && typeof w.iv === 'string' && WRAP_IV.test(w.iv) && typeof w.ct === 'string' && WRAP_CT.test(w.ct);
}

/** The stored key blob: { v: 1, pass: {iv, ct} }. @param {{ iv: string, ct: string }} pass */
const keysJson = (pass) => JSON.stringify({ v: 1, pass: { iv: pass.iv, ct: pass.ct } });

/**
 * The key blob { v: 1, pass: {iv, ct} }, nothing else. Returns its JSON or null.
 * Clients before 2.4 also send a `rec` wrapping (the recovery key, gone since 2.4): accepted in its
 * old shape and dropped, so a cached old app keeps working.
 * @param {unknown} keys
 */
export function validKeys(keys) {
  const k = /** @type {any} */ (keys);
  if (!exactKeys(keys, ['v', 'pass']) && !(exactKeys(keys, ['v', 'pass', 'rec']) && validWrap(k.rec))) return null;
  if (k.v !== 1 || !validWrap(k.pass)) return null;
  const text = keysJson(k.pass);
  return text.length <= MAX_KEYS_BYTES ? text : null;
}

/**
 * Length of a sealed blob without the old `rec` part (all parts have fixed sizes). Longer sealed rows
 * still carry `rec` from before 2.4 and are rewritten by upgradeKeys.
 */
const SEALED_LEN = (() => {
  const plain = keysJson({ iv: 'A'.repeat(16), ct: 'A'.repeat(64) }).length;
  return SEALED.length + 16 + 1 + Math.ceil(((plain + 16) * 4) / 3);
})();

/**
 * Stored users.keys → { blob (always { v, pass }), clean }. Decrypts; old plain rows are read as they
 * are. `clean` = already sealed and without the old `rec` part, so nothing needs rewriting.
 * @param {Record<string, any>} env @param {string} userId @param {unknown} stored
 */
async function readKeys(env, userId, stored) {
  const text = String(stored);
  const k = JSON.parse(await openKeys(env.PEPPER, userId, text));
  return { blob: { v: k.v, pass: k.pass }, clean: text.startsWith(SEALED) && !Object.hasOwn(k, 'rec') };
}

/**
 * Bring a stored blob to the current form: sealed at rest (rows from before 2.1) and without the
 * `rec` wrapping of the recovery key (rows from before 2.4). Called on login and by the daily cron;
 * only replaces exactly the value it read, so a concurrent passphrase change wins.
 * @param {Record<string, any>} env @param {string} userId @param {string} stored
 */
async function upgradeKeys(env, userId, stored) {
  const u = await upgradeStatement(env, userId, stored);
  if (u) await u.run();
}

/** The UPDATE that upgradeKeys would run, or null if the row is already clean. @param {Record<string, any>} env @param {string} userId @param {string} stored */
async function upgradeStatement(env, userId, stored) {
  const { blob, clean } = await readKeys(env, userId, stored);
  if (clean) return null;
  const sealed = await sealKeys(env.PEPPER, userId, keysJson(blob.pass));
  return env.DB.prepare('UPDATE users SET keys = ?3 WHERE id = ?1 AND keys = ?2').bind(userId, stored, sealed);
}

/** A stored blob that still needs upgradeKeys (plain, or sealed with the old `rec` part), judged by its shape alone. @param {unknown} stored */
const needsUpgrade = (stored) => {
  const text = String(stored);
  return !text.startsWith(SEALED) || text.length !== SEALED_LEN;
};

/**
 * Key blobs upgraded per cron run. D1 limits the queries per Worker invocation (the smallest
 * documented limit is 50, each statement of a batch counted): 1 SELECT + 1 batch of at most this many
 * UPDATEs keeps the whole cron run (retention included) far below it. Active accounts are upgraded on
 * their first request of a day anyway (loadSession), so the cron only has to reach the quiet ones.
 */
export const UPGRADE_PER_RUN = 10;

/**
 * Cron: upgrade up to `max` key blobs that are still plain (before 2.1) or still carry the `rec`
 * part (before 2.4; recognised by their length, so no row has to be decrypted to find them). A row that
 * cannot be read (e.g. corrupt) is skipped and logged, it never stops the others; the rows are picked
 * in random order, so a few unreadable ones cannot hold up the rest run after run.
 * @param {Record<string, any>} env @param {number} [max]
 * @returns {Promise<number>} rows upgraded
 */
export async function upgradeKeyBlobs(env, max = UPGRADE_PER_RUN) {
  const { results } = await env.DB.prepare(
    "SELECT id, keys FROM users WHERE keys NOT LIKE 'e1.%' OR length(keys) <> ?2 ORDER BY random() LIMIT ?1",
  )
    .bind(Math.min(max, UPGRADE_PER_RUN), SEALED_LEN)
    .all();
  /** @type {D1PreparedStatement[]} */
  const updates = [];
  for (const r of results) {
    try {
      const u = await upgradeStatement(env, String(r.id), String(r.keys));
      if (u) updates.push(u);
    } catch (e) {
      console.error('[keys] cannot upgrade one row:', e && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : 'unknown');
    }
  }
  if (updates.length) await env.DB.batch(updates);
  return updates.length;
}

/** Session times are stored as UTC days only. Expiry: the day after SESSION_TTL. @param {number} now */
const sessionExpires = (now) => utcDay(now) + SESSION_TTL + DAY;

/**
 * New session; returns the Set-Cookie value, or null if the account no longer exists.
 * Keeps at most MAX_SESSIONS per account (oldest go); `dropOthers` ends all other sessions.
 * @param {Record<string, any>} env @param {string} userId @param {number} now @param {boolean} [dropOthers]
 */
async function newSession(env, userId, now, dropOthers = false) {
  const token = randomToken(32); // 256 bit
  const hash = await sha256Hex(token);
  const day = utcDay(now);
  const stmts = [
    env.DB.prepare(
      'INSERT INTO sessions (hash, user_id, expires, touched) SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM users WHERE id = ?2)',
    ).bind(hash, userId, sessionExpires(now), day),
    env.DB.prepare('UPDATE users SET last_seen = ?2 WHERE id = ?1 AND last_seen < ?2').bind(userId, day),
    env.DB.prepare(
      'DELETE FROM sessions WHERE user_id = ?1 AND hash NOT IN (SELECT hash FROM sessions WHERE user_id = ?1 ORDER BY touched DESC, rowid DESC LIMIT ?2)',
    ).bind(userId, MAX_SESSIONS),
  ];
  if (dropOthers) stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1 AND hash <> ?2').bind(userId, hash));
  const out = await env.DB.batch(stmts);
  if (!Number(out[0].meta?.changes ?? 0)) return null;
  return cookie(SESSION_COOKIE, token, COOKIE_MAX_AGE);
}

/**
 * Load the session; slides the expiry (at most once a day), marks the account as seen today and
 * counts the request against the account's daily budget. A cookie of a deleted account gives
 * { gone: true } (the caller answers 410), any other unknown or expired one null (401).
 * @param {Request} req @param {Record<string, any>} env
 * @returns {Promise<null | { gone: true } | { userId: string, setCookie?: string, hash: string, limited?: boolean }>}
 */
async function loadSession(req, env) {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const hash = await sha256Hex(token);
  const now = Date.now();
  const row = await env.DB.prepare(
    'SELECT s.user_id, s.touched, u.last_seen, u.keys FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ?1 AND s.expires > ?2',
  )
    .bind(hash, now)
    .first();
  if (!row) {
    try {
      const gone = await env.DB.prepare('SELECT 1 FROM gone_sessions WHERE hash = ?1 AND expires > ?2').bind(hash, now).first();
      return gone ? { gone: true } : null;
    } catch (e) {
      if (beforeMigration3.goneTable(e)) return null;
      throw e;
    }
  }
  /** @type {{ userId: string, setCookie?: string, hash: string, limited?: boolean }} */
  const s = { userId: String(row.user_id), hash };
  if (await hit(env.DB, await acctKey(env, s.userId), limits(env).requestsPerDay, now)) {
    s.limited = true;
    return s;
  }
  const today = utcDay(now);
  if (Number(row.last_seen) < today) {
    await env.DB.prepare('UPDATE users SET last_seen = ?2 WHERE id = ?1').bind(s.userId, today).run();
  }
  if (Number(row.touched) < today) {
    await env.DB.prepare('UPDATE sessions SET touched = ?2, expires = ?3 WHERE hash = ?1').bind(hash, today, sessionExpires(now)).run();
    s.setCookie = cookie(SESSION_COOKIE, token, COOKIE_MAX_AGE);
    // At most once a day per session: a key blob from before 2.4 loses its `rec` part (an account that
    // only ever uses its session would otherwise wait for the cron). Never fails the request.
    if (needsUpgrade(row.keys)) await upgradeKeys(env, s.userId, String(row.keys)).catch(() => {});
  }
  return s;
}

// ---------------------------------------------------------------- accounts

/** Proof-of-work bits a registration needs right now (rises with today's registrations). @param {Record<string, any>} env @param {number} now */
async function regBits(env, now) {
  const L = limits(env);
  const n = await count(env.DB, 'global', L.regGlobal, now);
  return Math.min(32, powBits(env) + regExtraBits(n + 1, L.regGlobal.max));
}

/** `?for=login`: the plain POW_BITS challenge for a login that answered 428. @param {URL} url @param {Record<string, any>} env */
async function challenge(url, env) {
  const now = Date.now();
  const bits = url.searchParams.get('for') === 'login' ? powBits(env) : await regBits(env, now);
  return json(200, await makeChallenge(env, now, bits));
}

/** @param {Request} req @param {Record<string, any>} env */
async function register(req, env) {
  const { body, error } = await readJson(req);
  if (error) return error;
  // Clients before 2.4 also send `recAuth` (recovery key): ignored.
  const { auth, keys, pow } = body;
  if (typeof auth !== 'string' || !KEY32.test(auth)) return err(400, 'bad_request');
  // A cached 2.3 app (first load after the update) would show its user a recovery key that does not
  // exist any more: refuse before anything is spent; the 2.4 service worker reloads such pages.
  if (Object.hasOwn(body, 'recAuth')) return err(400, 'update_required');
  const keysText = validKeys(keys);
  if (!keysText) return err(400, 'keys');
  const now = Date.now();
  const sol = await checkSolution(env, pow?.challenge, pow?.nonce, now);
  if (!sol.ok) return err(400, sol.error);
  const username = normalizeUsername(body.username);
  if (!username) return err(400, 'username');
  // Busy day: the challenge must carry today's (higher) difficulty. Not spent, the client fetches a new one.
  if (sol.bits < (await regBits(env, now))) return err(400, 'pow_weak');

  const L = limits(env);
  const ip = await ipKey(req, env);
  const n48 = await net48Key(req, env);
  // A network that probed too many taken names today cannot register any more today. Every attempt
  // takes one probe unit first (atomic, so parallel attempts cannot all pass a nearly used-up budget);
  // it is given back unless the name turns out to be taken.
  if (!(await take(env.DB, ip, L.probePerIp, now))) return err(429, 'rate_limited');
  if (n48 && !(await take(env.DB, n48, L.probePerNet48, now))) {
    await unhit(env.DB, ip, L.probePerIp, now);
    return err(429, 'rate_limited');
  }
  const giveProbe = async () => {
    await unhit(env.DB, ip, L.probePerIp, now);
    if (n48) await unhit(env.DB, n48, L.probePerNet48, now);
  };
  // Increment first, then check: parallel requests cannot get past the limits together.
  const nIp = await hitCount(env.DB, ip, L.regPerIp, now);
  const n48n = n48 ? await hitCount(env.DB, n48, L.regPerNet48, now) : 0;
  const nAll = await hitCount(env.DB, 'global', L.regGlobalMax, now);
  const giveBack = async () => {
    await unhit(env.DB, ip, L.regPerIp, now);
    if (n48) await unhit(env.DB, n48, L.regPerNet48, now);
    await unhit(env.DB, 'global', L.regGlobalMax, now);
  };
  if (nIp > L.regPerIp.max || n48n > L.regPerNet48.max || nAll > L.regGlobalMax.max) {
    await giveBack();
    await giveProbe();
    return err(429, 'rate_limited');
  }

  // The challenge is spent before anything is revealed, also when the name turns out to be taken.
  const spent = await env.DB.prepare('INSERT INTO pow_used (id, expires) VALUES (?1, ?2) ON CONFLICT (id) DO NOTHING RETURNING id')
    .bind(sol.id, sol.expires)
    .first();
  if (!spent) {
    await giveBack();
    await giveProbe();
    return err(400, 'pow_used');
  }

  const userId = await accountId(env, username);
  const day = utcDay(now);
  const row = [userId, await secretHash(env, 'auth', auth), await sealKeys(env.PEPPER, userId, keysText), day];
  const insert = (/** @type {string} */ cols, /** @type {string} */ vals) =>
    env.DB.prepare(`INSERT INTO users (${cols}) VALUES (${vals}) ON CONFLICT (id) DO NOTHING RETURNING id`).bind(...row).first();
  let created;
  try {
    created = await insert('id, auth, keys, created, last_seen', '?1, ?2, ?3, ?4, ?4');
  } catch (e) {
    // Database not migrated yet: the old column still wants a value; an empty one is never used.
    if (!beforeMigration3.recAuth(e)) throw e;
    created = await insert("id, auth, rec_auth, keys, created, last_seen", "?1, ?2, '', ?3, ?4, ?4");
  }
  if (!created) {
    // Taken: say so (accepted leak), but it costs a solved challenge and keeps its probe unit.
    await giveBack();
    return err(409, 'username_taken');
  }
  await giveProbe();
  const setCookie = await newSession(env, userId, now);
  if (!setCookie) return err(500, 'server');
  return json(200, { ok: true, version: 1, now }, { 'Set-Cookie': setCookie });
}

/**
 * Login with the passphrase-derived authKey. Unknown username and wrong secret take the same path:
 * same queries, same HMAC work, same counters, same response.
 * @param {Request} req @param {Record<string, any>} env
 */
async function login(req, env) {
  const { body, error } = await readJson(req);
  if (error) return error;
  const secret = body.auth;
  if (typeof body.username !== 'string' || body.username.length > 64 || typeof secret !== 'string' || !KEY32.test(secret)) {
    return err(400, 'bad_request');
  }
  const now = Date.now();
  const L = limits(env);
  const username = normalizeUsername(body.username) ?? `invalid|${body.username}`;
  const userId = await accountId(env, username);
  const ip = await ipKey(req, env);
  const n48 = await net48Key(req, env);
  const acct = await acctKey(env, userId);
  // Count first, check later: every attempt is counted as a failure before anything is verified, so
  // parallel attempts cannot get past the limits together; a successful login gives its units back.
  // Hard limits only per client network (and its IPv6 /48): someone else's failures never lock you out elsewhere.
  if (!(await take(env.DB, ip, L.loginFailIp, now))) return err(429, 'rate_limited');
  if (n48 && !(await take(env.DB, n48, L.loginFailNet48, now))) {
    await unhit(env.DB, ip, L.loginFailIp, now);
    return err(429, 'rate_limited');
  }
  const nAcct = await hitCount(env.DB, acct, L.loginFailAccount, now);
  const giveBack = async () => {
    await unhit(env.DB, ip, L.loginFailIp, now);
    if (n48) await unhit(env.DB, n48, L.loginFailNet48, now);
    await unhit(env.DB, acct, L.loginFailAccount, now);
  };
  // Many failures on this account from everywhere: no lock, but every attempt costs a proof of work.
  // Unknown names have the same counters, so they get the same 428. A 428 does not count as a failure.
  if (nAcct > L.loginFailAccount.max) {
    const sol = await checkSolution(env, body.pow?.challenge, body.pow?.nonce, now);
    const spent =
      sol.ok &&
      (await env.DB.prepare('INSERT INTO pow_used (id, expires) VALUES (?1, ?2) ON CONFLICT (id) DO NOTHING RETURNING id')
        .bind(sol.id, sol.expires)
        .first());
    if (!spent) {
      await giveBack();
      return err(428, 'pow_required');
    }
  }
  const row = await env.DB.prepare('SELECT auth, keys, keys_version, last_seen FROM users WHERE id = ?1').bind(userId).first();
  const given = await secretHash(env, 'auth', secret);
  const stored = row ? String(row.auth) : NO_MATCH;
  const match = safeEqual(given, stored);
  // A failure keeps the units counted above. Two shared rows (network, /48) and one per account: a
  // sprayed name costs one new row, not three.
  if (!row || !match) return loginFailed();
  await giveBack();
  if (await hit(env.DB, acct, L.requestsPerDay, now)) return err(429, 'rate_limited', { 'Retry-After': untilTomorrow(now) });
  const { blob: keys } = await readKeys(env, userId, row.keys);
  await upgradeKeys(env, userId, String(row.keys));
  // The UTC day of the previous authenticated request, read before newSession() moves it to today:
  // the app tells people who were away long that unused accounts are deleted after IDLE_DAYS.
  const lastSeen = Number(row.last_seen);
  const setCookie = await newSession(env, userId, now);
  if (!setCookie) return loginFailed(); // account deleted in the meantime
  return json(200, { ok: true, keys, version: Number(row.keys_version), now, lastSeen }, { 'Set-Cookie': setCookie });
}

/**
 * Proof with the current authKey on an authenticated route. Wrong guesses count per session only,
 * never against the login counters. @returns {Promise<Response | null>} error response or null
 * @param {Record<string, any>} env @param {string} sessionHash @param {string} proof @param {any} row
 */
async function checkProof(env, sessionHash, proof, row) {
  const L = limits(env);
  const sk = sessionHash.slice(0, 32);
  const now = Date.now();
  // Counted before the check (atomic), given back when the proof is right.
  if (!(await take(env.DB, sk, L.sessionFail, now))) return err(429, 'rate_limited');
  const given = await secretHash(env, 'auth', proof);
  if (!safeEqual(given, String(row.auth))) return err(400, 'wrong_auth');
  await unhit(env.DB, sk, L.sessionFail, now);
  return null;
}

/** @param {Record<string, any>} env @param {string} userId */
async function conflict(env, userId) {
  const cur = await env.DB.prepare('SELECT keys_version FROM users WHERE id = ?1').bind(userId).first();
  return json(409, { error: 'conflict', version: Number(cur?.keys_version ?? 0) });
}

/**
 * Change the passphrase: needs the session plus proof (the current authKey). The stored blob loses
 * the old `rec` part on the way. Ends all other sessions of the account in the same batch.
 * @param {Request} req @param {Record<string, any>} env @param {{ userId: string, hash: string }} s
 */
async function changePassphrase(req, env, s) {
  const { body, error } = await readJson(req);
  if (error) return error;
  const { auth, newAuth, version } = body;
  if (typeof auth !== 'string' || !KEY32.test(auth) || typeof newAuth !== 'string' || !KEY32.test(newAuth)) {
    return err(400, 'bad_request');
  }
  if (!Number.isInteger(version) || version < 1) return err(400, 'version');
  const keysText = validKeys(body.keys);
  if (!keysText) return err(400, 'keys');
  const row = await env.DB.prepare('SELECT auth FROM users WHERE id = ?1').bind(s.userId).first();
  if (!row) return err(401, 'unauthorized');
  const bad = await checkProof(env, s.hash, auth, row);
  if (bad) return bad;
  const out = await env.DB.batch([
    env.DB.prepare(
      'UPDATE users SET auth = ?2, keys = ?3, keys_version = keys_version + 1 WHERE id = ?1 AND keys_version = ?4 RETURNING keys_version',
    ).bind(s.userId, await secretHash(env, 'auth', newAuth), await sealKeys(env.PEPPER, s.userId, keysText), version),
    env.DB.prepare(
      'DELETE FROM sessions WHERE user_id = ?1 AND hash <> ?2 AND (SELECT keys_version FROM users WHERE id = ?1) = ?3',
    ).bind(s.userId, s.hash, version + 1),
  ]);
  const res = /** @type {any} */ (out[0].results?.[0]);
  if (!res) return conflict(env, s.userId);
  return json(200, { ok: true, version: Number(res.keys_version) });
}

/** @param {Record<string, any>} env @param {{hash: string, userId: string}} s @param {boolean} all */
async function logout(env, s, all) {
  if (all) await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(s.userId).run();
  else await env.DB.prepare('DELETE FROM sessions WHERE hash = ?1').bind(s.hash).run();
  return json(200, { ok: true }, { 'Set-Cookie': cookie(SESSION_COOKIE, '', 0) });
}

/** @param {Record<string, any>} env @param {string} userId */
async function getKeys(env, userId) {
  const row = await env.DB.prepare('SELECT keys, keys_version, seq FROM users WHERE id = ?1').bind(userId).first();
  if (!row) return err(401, 'unauthorized');
  return json(200, { version: Number(row.keys_version), keys: (await readKeys(env, userId, row.keys)).blob, seq: Number(row.seq), now: Date.now() });
}

// ---------------------------------------------------------------- records

/** @param {URL} url @param {Record<string, any>} env @param {string} userId */
async function getRecords(url, env, userId) {
  const sinceRaw = url.searchParams.get('since') ?? '0';
  if (!/^\d{1,15}$/.test(sinceRaw)) return err(400, 'since');
  const since = Number(sinceRaw);
  // One snapshot: records and the account's seq in the same batch (transaction), so a write that lands
  // in between cannot be skipped by a seq that is already past it.
  const [rs, us] = await env.DB.batch([
    env.DB.prepare('SELECT id, seq, data FROM records WHERE user_id = ?1 AND seq > ?2 ORDER BY seq LIMIT ?3').bind(userId, since, PAGE_SIZE + 1),
    env.DB.prepare('SELECT seq FROM users WHERE id = ?1').bind(userId),
  ]);
  const results = /** @type {any[]} */ (rs.results ?? []);
  const more = results.length > PAGE_SIZE;
  const records = results.slice(0, PAGE_SIZE).map((r) => ({ id: r.id, seq: Number(r.seq), data: r.data }));
  const user = /** @type {any} */ (us.results?.[0]);
  const seq = more ? records[records.length - 1].seq : Math.max(since, Number(user?.seq ?? 0));
  return json(200, { records, seq, more, now: Date.now() });
}

/** Seconds until the next UTC day. @param {number} now */
const untilTomorrow = (now) => String(Math.ceil((utcDay(now) + DAY - now) / 1000));

/** @param {Request} req @param {Record<string, any>} env @param {string} userId @param {string} id */
async function putRecord(req, env, userId, id) {
  if (!RECORD_ID.test(id)) return err(400, 'id');
  const { body, error } = await readJson(req);
  if (error) return error;
  const data = body.data;
  if (typeof data !== 'string' || !B64URL.test(data)) return err(400, 'data');
  if (data.length > MAX_RECORD_BYTES) return err(413, 'too_large');
  if (data.length !== RECORD_LEN) return err(400, 'data');
  const now = Date.now();
  const L = limits(env);
  const acct = await acctKey(env, userId);
  if (id === SETTINGS_ID) {
    if (await hit(env.DB, acct, L.settingsPerDay, now)) return err(429, 'rate_limited', { 'Retry-After': untilTomorrow(now) });
  } else if (await hit(env.DB, acct, L.writesPerDay, now)) {
    return err(429, 'daily_limit', { 'Retry-After': untilTomorrow(now) });
  }

  // users.nrec counts the account's records (kept up to date on put, delete, cron), no COUNT(*) here.
  const info = await env.DB.prepare(
    'SELECT nrec AS n, EXISTS (SELECT 1 FROM records WHERE user_id = ?1 AND id = ?2) AS ex FROM users WHERE id = ?1',
  )
    .bind(userId, id)
    .first();
  if (!info) return err(401, 'unauthorized');
  if (!info.ex && Number(info.n ?? 0) >= MAX_RECORDS) return err(413, 'too_many');

  const out = await env.DB.batch([
    env.DB.prepare(
      'UPDATE users SET seq = seq + 1, nrec = nrec + NOT EXISTS (SELECT 1 FROM records WHERE user_id = ?1 AND id = ?2) WHERE id = ?1',
    ).bind(userId, id),
    env.DB.prepare(
      'INSERT INTO records (user_id, id, seq, data, written) VALUES (?1, ?2, (SELECT seq FROM users WHERE id = ?1), ?3, ?4) ' +
        'ON CONFLICT (user_id, id) DO UPDATE SET seq = excluded.seq, data = excluded.data, written = excluded.written',
    ).bind(userId, id, data, utcDay(now)),
    env.DB.prepare('SELECT seq FROM users WHERE id = ?1').bind(userId),
  ]);
  const seq = Number(/** @type {any} */ (out[2].results?.[0])?.seq ?? 0);
  return json(200, { ok: true, seq });
}

/** Hard delete (retention). Not counted against any write limit. @param {Record<string, any>} env @param {string} userId @param {string} id */
async function deleteRecord(env, userId, id) {
  if (!RECORD_ID.test(id) || id === SETTINGS_ID) return err(400, 'id');
  const out = await env.DB.batch([
    env.DB.prepare('UPDATE users SET nrec = nrec - (SELECT COUNT(*) FROM records WHERE user_id = ?1 AND id = ?2) WHERE id = ?1').bind(userId, id),
    env.DB.prepare('DELETE FROM records WHERE user_id = ?1 AND id = ?2').bind(userId, id),
  ]);
  return json(200, { ok: true, deleted: Number(out[1].meta?.changes ?? 0) });
}

/**
 * Delete the account with everything in it: needs the session plus proof, body { auth } (the current
 * authKey, as sent at login), checked like on the passphrase change. The hashes of its sessions are
 * remembered as «gone» (nothing else), so its other devices get 410 and remove their local copy.
 * @param {Request} req @param {Record<string, any>} env @param {{ userId: string, hash: string }} s
 */
async function deleteAccount(req, env, s) {
  const { body, error } = await readJson(req);
  // No body (no JSON Content-Type) is a bad request here, not 415.
  if (error) return error.status === 415 ? err(400, 'bad_request') : error;
  if (typeof body.auth !== 'string' || !KEY32.test(body.auth)) return err(400, 'bad_request');
  const userId = s.userId;
  const row = await env.DB.prepare('SELECT auth FROM users WHERE id = ?1').bind(userId).first();
  if (!row) return err(401, 'unauthorized');
  const bad = await checkProof(env, s.hash, body.auth, row);
  if (bad) return bad;
  const del = [
    env.DB.prepare('DELETE FROM records WHERE user_id = ?1').bind(userId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(userId),
    env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(userId),
  ];
  // «Gone» and the deletion in ONE batch (a transaction): if it fails, the account lives on and no
  // session of it is marked gone (a later ordinary 401 must not make a device wipe itself).
  try {
    await env.DB.batch([rememberGone(env.DB, 'user_id = ?3', Date.now(), userId), ...del]);
  } catch (e) {
    // Before migration 0003 there is no table to remember them in: delete only.
    if (!beforeMigration3.goneTable(e)) throw e;
    await env.DB.batch(del);
  }
  return json(200, { ok: true }, { 'Set-Cookie': cookie(SESSION_COOKIE, '', 0) });
}

// ---------------------------------------------------------------- operator statistics


/**
 * GET /api/admin/stats for the operator's daily check: counts only, never an id, hash or per-account row.
 * Bearer token compared in constant time (SHA-256 of both) against the secret STATS_TOKEN. No secret,
 * no or a wrong token or too many wrong tokens from this network: the same 404 as an
 * unknown route (other methods are routed like an unknown path). Requests without the right token
 * count per client network (limits.statsFail).
 * @param {Request} req @param {Record<string, any>} env
 */
async function adminStats(req, env) {
  const notFound = () => err(404, 'not_found');
  const secret = typeof env.STATS_TOKEN === 'string' ? env.STATS_TOKEN : '';
  if (!secret) return notFound();
  const now = Date.now();
  const L = limits(env);
  const ip = await ipKey(req, env);
  // Every request counts as a failure first (atomic) and the right token gives it back: no, a malformed
  // and a wrong token take the same path (same database work, same hashing), so the answer time tells nothing.
  if (!(await take(env.DB, ip, L.statsFail, now))) return notFound();
  const m = /^Bearer ([\x21-\x7e]{1,512})$/.exec(req.headers.get('Authorization') || '');
  const given = await sha256Hex(m ? m[1] : '');
  if (!m || !safeEqual(given, await sha256Hex(secret))) return notFound();
  await unhit(env.DB, ip, L.statsFail, now);
  const today = utcDay(now);
  // One pass over users (rows read = number of accounts); record totals from the users.nrec counter
  // instead of scanning records; sessions counted once.
  const [u, s, size] = await env.DB.batch([
    env.DB.prepare(
      'SELECT COUNT(*) AS users, SUM(last_seen > ?1) AS seen7, SUM(last_seen > ?2) AS seen30, SUM(last_seen < ?3) AS idle45, ' +
        'SUM(nrec) AS records, MAX(nrec) AS maxrec, SUM(created = ?4) AS regToday FROM users',
    ).bind(today - 7 * DAY, today - 30 * DAY, today - 45 * DAY, today),
    env.DB.prepare('SELECT COUNT(*) AS n FROM sessions'),
    // Cheapest possible statement, only for meta.size_after (database size in bytes after the query).
    env.DB.prepare('SELECT 1'),
  ]);
  const r = /** @type {any} */ (u.results?.[0] ?? {});
  const users = Number(r.users ?? 0);
  const records = Number(r.records ?? 0);
  const body = {
    day: new Date(today).toISOString().slice(0, 10),
    users,
    usersSeen7d: Number(r.seen7 ?? 0),
    usersSeen30d: Number(r.seen30 ?? 0),
    usersIdleOver45d: Number(r.idle45 ?? 0),
    records,
    recordsPerUserAvg: users ? Math.round((records / users) * 10) / 10 : 0,
    recordsPerUserMax: Number(r.maxrec ?? 0),
    sessions: Number(/** @type {any} */ (s.results?.[0])?.n ?? 0),
    registrationsToday: Number(r.regToday ?? 0),
    dbSizeBytes: Number(/** @type {any} */ (size.meta)?.size_after ?? 0),
    limits: { recordsPerAccount: MAX_RECORDS },
    version: VERSION,
  };
  return json(200, body);
}

// ---------------------------------------------------------------- router

/** @param {Request} req @param {Record<string, any>} env */
export async function handleApi(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // Plain http only for local development; anything else must come over https.
  if (url.protocol !== 'https:' && !LOCAL_HOSTS.has(url.hostname)) return err(403, 'https_required');

  // Operator statistics: bearer token only (called by curl), no cookie, no Origin; 404 unless authorised.
  // Other methods take the normal path below and end like any unknown route.
  if (path === '/api/admin/stats' && method === 'GET') return adminStats(req, env);

  // Origin check on everything except GET/HEAD, against the request's own origin. No CORS.
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = req.headers.get('Origin');
    if (!origin || origin !== url.origin) return err(403, 'origin');
  }

  if (path === '/api/auth/challenge' && method === 'GET') return challenge(url, env);
  if (path === '/api/auth/register' && method === 'POST') return register(req, env);
  if (path === '/api/auth/login' && method === 'POST') return login(req, env);

  const known =
    path === '/api/auth/logout' ||
    path === '/api/auth/logout-all' ||
    path === '/api/auth/passphrase' ||
    path === '/api/keys' ||
    path === '/api/records' ||
    path === '/api/account' ||
    path.startsWith('/api/records/');
  if (!known) return err(404, 'not_found');

  const s = await loadSession(req, env);
  if (!s) return err(401, 'unauthorized');
  // The account was deleted (on another device, or for being unused): tell the device. The cookie is
  // not cleared: this answer can arrive late, after another tab of the same browser has logged in with a
  // new cookie, and clearing would log that one out. The dead cookie only ever gets 410 and expires.
  if ('gone' in s) return err(410, 'account_deleted');
  if (s.limited) return err(429, 'rate_limited', { 'Retry-After': untilTomorrow(Date.now()) });

  /** @type {Response} */
  let res;
  const recId = path.slice('/api/records/'.length);
  if (path === '/api/auth/logout' && method === 'POST') res = await logout(env, s, false);
  else if (path === '/api/auth/logout-all' && method === 'POST') res = await logout(env, s, true);
  else if (path === '/api/auth/passphrase' && method === 'POST') res = await changePassphrase(req, env, s);
  else if (path === '/api/keys' && method === 'GET') res = await getKeys(env, s.userId);
  else if (path === '/api/records' && method === 'GET') res = await getRecords(url, env, s.userId);
  else if (path.startsWith('/api/records/') && method === 'PUT') res = await putRecord(req, env, s.userId, recId);
  else if (path.startsWith('/api/records/') && method === 'DELETE') res = await deleteRecord(env, s.userId, recId);
  else if (path === '/api/account' && method === 'DELETE') res = await deleteAccount(req, env, s);
  else res = err(405, 'method');

  if (s.setCookie && !res.headers.get('Set-Cookie')) res.headers.append('Set-Cookie', s.setCookie);
  return res;
}
