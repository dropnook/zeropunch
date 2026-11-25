// Daily server-side retention (a scheduled job). The server cannot see a stamp's time, so this is a
// backstop: the client already deletes its own entries RETENTION_DAYS after their timestamp.

import { DAY, utcDay } from './limits.js';

/** 13 months: how long a record may live (client side: public/js/store.js has the same number). */
export const RETENTION_DAYS = 396;
/** Accounts without any authenticated request for this many days are deleted (also the session lifetime). */
export const IDLE_DAYS = 61;
export const SETTINGS_ID = '0'.repeat(32);

/**
 * The session cookie lives this many days longer in the browser than the session on the server
 * (api.js COOKIE_MAX_AGE): a device whose account was deleted, also by the idle purge, still presents
 * its cookie and is told «account deleted» (410). The server's expiry stays authoritative.
 */
export const COOKIE_GRACE_DAYS = 64;

/**
 * Statement that remembers the session hashes of the accounts selected by `where` (SQL on `user_id`)
 * as «gone»: only sessions whose expiry is after `minExpires`. The account deletion passes «now»
 * (an already expired session keeps answering 401). The idle purge passes two days earlier: an account
 * becomes idle exactly when its sessions expire (both 61 days after the last use), so its sessions have
 * just run out when the purge runs, and their devices are the ones that must learn «deleted».
 * Each entry lives as long as the browser can still hold that session's cookie: the session's own
 * expiry day plus COOKIE_GRACE_DAYS (at most 61 + 1 + 64 = 126 days after a deletion by the user;
 * after the idle purge about 64 days).
 * @param {D1Database} db @param {string} where @param {number} minExpires @param {...unknown} binds for ?3, ?4, …
 */
export function rememberGone(db, where, minExpires, ...binds) {
  return db
    .prepare(
      `INSERT INTO gone_sessions (hash, expires) SELECT hash, expires + ?1 FROM sessions WHERE expires > ?2 AND (${where}) ` +
        'ON CONFLICT (hash) DO NOTHING',
    )
    .bind(COOKIE_GRACE_DAYS * DAY, minExpires, ...binds);
}

/** Whether migration 0003 (table gone_sessions) has run: 2.4 is deployed before it. @param {D1Database} db */
export async function hasGoneTable(db) {
  const row = await db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'gone_sessions'").first();
  return !!row;
}

/** @param {D1Database} db @param {number} [now] */
export async function runRetention(db, now = Date.now()) {
  // Records written before this UTC day go: at the latest ~RETENTION_DAYS + 1 days after their last write.
  const cutoff = utcDay(now) - RETENTION_DAYS * DAY;
  const idleCutoff = utcDay(now) - IDLE_DAYS * DAY;
  const idle = 'SELECT id FROM users WHERE last_seen < ?1';
  const old = 'written < ?1 AND id <> ?2';
  // Before migration 0003 there is no gone_sessions table: everything else still runs.
  const gone = await hasGoneTable(db);
  /** @type {[string, D1PreparedStatement][]} */
  const steps = [
    // Records not written for RETENTION_DAYS (the settings record lives as long as its account); the
    // per-account record counter goes down by the same number first.
    [
      'nrec',
      db.prepare(
        `UPDATE users SET nrec = nrec - (SELECT COUNT(*) FROM records r WHERE r.user_id = users.id AND ${old}) ` +
          `WHERE id IN (SELECT user_id FROM records WHERE ${old})`,
      ).bind(cutoff, SETTINGS_ID),
    ],
    ['oldRecords', db.prepare(`DELETE FROM records WHERE ${old}`).bind(cutoff, SETTINGS_ID)],
    // Accounts without an authenticated request for IDLE_DAYS, with everything that belongs to them.
    ['idleRecords', db.prepare(`DELETE FROM records WHERE user_id IN (${idle})`).bind(idleCutoff)],
    // Their devices are told the account is gone (only the session hashes are kept, see rememberGone),
    // in the same batch (one transaction) as the deletion itself.
    ...(gone ? /** @type {[string, D1PreparedStatement][]} */ ([['gone', rememberGone(db, `user_id IN (${idle.replace('?1', '?3')})`, now - 2 * DAY, idleCutoff)]]) : []),
    ['idleSessions', db.prepare(`DELETE FROM sessions WHERE user_id IN (${idle})`).bind(idleCutoff)],
    ['users', db.prepare('DELETE FROM users WHERE last_seen < ?1').bind(idleCutoff)],
    // Housekeeping.
    ['expiredSessions', db.prepare('DELETE FROM sessions WHERE expires < ?1').bind(now)],
    // Counter rows whose window started more than a day ago: no window is longer than a day, so these
    // are over; the daily run keeps every row at most two days.
    ['limits', db.prepare('DELETE FROM limits WHERE win < ?1').bind(now - DAY)],
    ['pow', db.prepare('DELETE FROM pow_used WHERE expires < ?1').bind(now)],
    // Sessions whose account is gone (e.g. a login that raced an account deletion).
    ['orphans', db.prepare('DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users)')],
    ...(gone ? /** @type {[string, D1PreparedStatement][]} */ ([['goneExpired', db.prepare('DELETE FROM gone_sessions WHERE expires < ?1').bind(now)]]) : []),
  ];
  const out = await db.batch(steps.map((s) => s[1]));
  /** @type {Record<string, number>} */
  const n = {};
  steps.forEach(([k], i) => (n[k] = Number(out[i].meta?.changes ?? 0)));
  return {
    records: n.oldRecords + n.idleRecords,
    users: n.users,
    sessions: n.idleSessions + n.expiredSessions + n.orphans,
    limits: n.limits,
    pow: n.pow,
    gone: n.gone ?? 0,
    goneExpired: n.goneExpired ?? 0,
    goneTable: gone,
  };
}
