// Fixed-window counters in D1. Identifiers are hashed, rows expire: the daily job deletes every row
// whose window started more than a day ago, so no row is older than two days (src/retention.js).
// Per-account counters are keyed with their own HMAC (api.js acctKey), never with the account id, so
// the counters cannot be joined to `users` without PEPPER.

export const HOUR = 3600_000;
export const DAY = 86_400_000;

/** Start of the UTC day containing `now` (ms). @param {number} now */
export const utcDay = (now) => Math.floor(now / DAY) * DAY;

/** @typedef {{ name: string, max: number, win: number }} Limit */

/** @param {Record<string, any>} env */
export function limits(env) {
  const num = (/** @type {any} */ v, /** @type {number} */ d) => {
    const n = Number.parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  return {
    // Registrations per client network (IPv4 address, IPv6 /64) and day. Generous on purpose: a whole
    // office or a mobile carrier can share one address (the operator watches the daily statistics).
    regPerIp: { name: 'ri', max: num(env.REG_PER_IP_DAY, 300), win: DAY },
    // The same per IPv6 /48 (65 536 /64s), ten times higher: one routed /48 cannot multiply the /64 limit.
    regPerNet48: { name: 'rw', max: 10 * num(env.REG_PER_IP_DAY, 300), win: DAY },
    // Soft global threshold: above it the proof of work gets harder (see regExtraBits), nobody is blocked.
    regGlobal: { name: 'rg', max: num(env.REG_GLOBAL_DAY, 1000), win: DAY },
    // Hard global ceiling per day (same counter as regGlobal). Near plausible demand (see README).
    regGlobalMax: { name: 'rg', max: num(env.REG_GLOBAL_MAX_DAY, 5000), win: DAY },
    // «Name taken» answers per client network and day (username probing), and per IPv6 /48.
    probePerIp: { name: 'pb', max: 200, win: DAY },
    probePerNet48: { name: 'pw', max: 2000, win: DAY },
    // Failed logins per client network across accounts: hard 429 for that network only.
    loginFailIp: { name: 'fi', max: 300, win: HOUR },
    // The same per IPv6 /48, ten times higher.
    loginFailNet48: { name: 'fw', max: 3000, win: HOUR },
    // Failed logins per account from everywhere: never locks; above it a proof of work is required.
    loginFailAccount: { name: 'fa', max: 20, win: HOUR },
    // Wrong current passphrase (passphrase change, account deletion), per session.
    sessionFail: { name: 'ps', max: 10, win: HOUR },
    // Authenticated requests per account and UTC day (incl. successful logins). 2-second polling all
    // day is 43 200 requests; 50 000 leaves room for stamps, settings, paging and logins on top.
    requestsPerDay: { name: 'aq', max: 50000, win: DAY },
    // Record writes per account and UTC day. Far above the app's 12 punches per day: back-entries, edits
    // and a CSV import of several months must fit into one sitting. The settings record has its own budget.
    writesPerDay: { name: 'wd', max: 1000, win: DAY },
    // Unauthorised requests (no, a malformed or a wrong token) on /api/admin/stats per client network.
    statsFail: { name: 'sf', max: 10, win: HOUR },
    settingsPerDay: { name: 'sd', max: 200, win: DAY },
  };
}

/** Extra proof-of-work bits for registration: +1 per doubling above the soft threshold, at most +6. @param {number} n @param {number} threshold */
export function regExtraBits(n, threshold) {
  if (threshold <= 0 || n <= threshold) return 0;
  return Math.min(6, Math.ceil(Math.log2(n / threshold)));
}

/** @param {Limit} limit @param {string} id @param {number} now */
const keyOf = (limit, id, now) => [`${limit.name}|${id}`, Math.floor(now / limit.win) * limit.win];

/**
 * Increment and return the new count (atomic in D1, so parallel requests get distinct numbers).
 * @param {D1Database} db @param {string} id already hashed @param {Limit} limit @param {number} [now]
 */
export async function hitCount(db, id, limit, now = Date.now()) {
  const [key, win] = keyOf(limit, id, now);
  const row = await db
    .prepare('INSERT INTO limits (key, win, n) VALUES (?1, ?2, 1) ON CONFLICT (key, win) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(key, win)
    .first();
  return Number(row?.n ?? 0);
}

/**
 * Increment and check. Returns true when the limit is exceeded (this hit included).
 * @param {D1Database} db @param {string} id already hashed @param {Limit} limit @param {number} [now]
 */
export async function hit(db, id, limit, now = Date.now()) {
  return (await hitCount(db, id, limit, now)) > limit.max;
}

/** Give back one hit (an attempt that did not happen after all). @param {D1Database} db @param {string} id @param {Limit} limit @param {number} [now] */
export async function unhit(db, id, limit, now = Date.now()) {
  const [key, win] = keyOf(limit, id, now);
  await db.prepare('UPDATE limits SET n = n - 1 WHERE key = ?1 AND win = ?2 AND n > 0').bind(key, win).run();
}

/** Current count without incrementing. @param {D1Database} db @param {string} id @param {Limit} limit @param {number} [now] */
export async function count(db, id, limit, now = Date.now()) {
  const [key, win] = keyOf(limit, id, now);
  const row = await db.prepare('SELECT n FROM limits WHERE key = ?1 AND win = ?2').bind(key, win).first();
  return Number(row?.n ?? 0);
}

/**
 * Take one unit if the limit is not used up yet, in ONE conditional statement (atomic in D1): parallel
 * requests can never take more than `limit.max` together. Returns false (nothing counted) when it is
 * used up. Count first, check later is the rule for every limit that blocks; give a unit back with
 * unhit() when the attempt turns out not to count (a successful login, say).
 * @param {D1Database} db @param {string} id already hashed @param {Limit} limit @param {number} [now]
 */
export async function take(db, id, limit, now = Date.now()) {
  const [key, win] = keyOf(limit, id, now);
  const row = await db
    .prepare(
      'INSERT INTO limits (key, win, n) SELECT ?1, ?2, 1 WHERE ?3 > 0 ' +
        'ON CONFLICT (key, win) DO UPDATE SET n = n + 1 WHERE limits.n < ?3 RETURNING n',
    )
    .bind(key, win, limit.max)
    .first();
  return row != null;
}
