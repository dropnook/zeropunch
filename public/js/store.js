// Data in the browser: decrypted entries in memory, ciphertext in IndexedDB, an outbox for offline
// writes and deletes, sync with the server, retention (13 months) and the daily punch limit (12).

import * as realDb from './db.js';
import * as realApi from './api.js';
import { encryptRecord, decryptRecord, newId, SETTINGS_ID, jsonSize, PLAINTEXT_SIZE } from './crypto.js';
import { mergeDecision, nextMod } from './merge.js';
import { dayKey, logicalDay, addDays, parseDay, zonedToEpoch, isDayKey, absenceType, DEFAULT_TZ } from './time.js';

/** dayStart: minutes after local midnight at which the day changes (0 = midnight; night shifts e.g. 240). */
export const DEFAULT_SETTINGS = { v: 1, kind: 'settings', weekHours: 42, nerd: false, dayStart: 0, button: 'inout', fx: 'random', badge: 0, badgeAt: '', linkPunch: true, mod: 0 };

/**
 * Labels for the big button (settings.button): «Punch in/out» (default, both languages), «Punch», or a
 * worded one per language («Clock in/out» / «Jetzt stempeln»; stored as `now` since 2.4's first draft).
 */
export const BUTTON_LABELS = /** @type {const} */ (['inout', 'punch', 'now']);

/** The stored value as one of BUTTON_LABELS: anything unknown or missing is the default. @param {unknown} value settings.button */
export const buttonLabel = (value) => (value === 'punch' || value === 'now' ? value : 'inout');

/** Text key of the big button's label. @param {unknown} value settings.button */
export const buttonLabelKey = (value) => ({ inout: 'punch_inout', punch: 'punch', now: 'punch_now' })[buttonLabel(value)];

/** Badge reminder (settings.badge): the default interval in calendar days when it is switched on. */
export const BADGE_DAYS_DEFAULT = 25;
export const BADGE_DAYS_MAX = 365;
/** settings.badge as whole days: 0 = off, else 1–365. @param {unknown} value */
export function badgeDays(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, BADGE_DAYS_MAX) : 0;
}
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayDiff = (/** @type {string} */ a, /** @type {string} */ b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/**
 * Whether the badge reminder shows now: switched on, this is the day's first punch, and the last
 * reminder (settings.badgeAt; set to the day it was switched on) is at least `badge` calendar days
 * back. A day without a punch shows nothing, so the reminder simply comes with the next first punch.
 * @param {{ badge?: unknown, badgeAt?: unknown }} settings @param {string} today "YYYY-MM-DD" @param {number} punchesToday including the punch just made
 */
export function badgeDue(settings, today, punchesToday) {
  const days = badgeDays(settings.badge);
  if (!days || punchesToday !== 1) return false;
  const at = String(settings.badgeAt || '');
  if (!DAY_RE.test(at)) return true;
  const d = dayDiff(at, today);
  return d >= days || d < 0; // a date in the future (wrong clock once): start over
}
/** The earliest day of the next reminder, or null when off or due at once. @param {{ badge?: unknown, badgeAt?: unknown }} settings */
export function badgeNextDay(settings) {
  const days = badgeDays(settings.badge);
  const at = String(settings.badgeAt || '');
  if (!days || !DAY_RE.test(at)) return null;
  const d = new Date(Date.parse(`${at}T00:00:00Z`) + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** The punch animations, oldest idea first (public/js/punchfx.js NAMES, same order; a unit test ties them together). */
export const FX_NAMES = /** @type {const} */ ([
  'sundial',
  'hourglass',
  'tower',
  'tally',
  'seal',
  'stamp',
  'typewriter',
  'clock',
  'card',
  'turnstile',
  'flip',
  'validator',
  'badge',
  'finger',
  'iris',
  'nfc',
  'button',
]);
/** settings.fx: «random» (default: another one each punch), «off», or one of FX_NAMES (the picker's order). */
export const FX_CHOICES = /** @type {const} */ (['random', 'off', ...FX_NAMES]);

/** The stored value as one of FX_CHOICES: unknown or missing is «random». @param {unknown} value settings.fx */
export const fxSetting = (value) => (FX_CHOICES.includes(/** @type {any} */ (value)) ? /** @type {(typeof FX_CHOICES)[number]} */ (value) : 'random');

/**
 * Which animation a punch plays: null for «off», the chosen one, or for «random» one of FX_NAMES that
 * is not the previous one. @param {unknown} value settings.fx @param {string | null} prev @param {() => number} [random]
 */
export function pickFx(value, prev, random = Math.random) {
  const v = fxSetting(value);
  if (v === 'off') return null;
  if (v !== 'random') return v;
  const pool = FX_NAMES.filter((n) => n !== prev);
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}
/** 13 months: a punch lives this many days from its timestamp (server: src/retention.js, same number). */
export const RETENTION_DAYS = 396;
/** The same span in months, for texts (396 days ≈ 13 months). */
export const RETENTION_MONTHS = Math.round((RETENTION_DAYS * 12) / 365.25);
/**
 * Absences (time.js): their own record kind in the same store. Plaintext:
 *   { v, kind: 'absence', day, type, half, note, ts, tz, del: true, gone, mod }
 * `day` is the logical day it covers; `ts` is noon of that day in `tz` and serves the retention only (an
 * absence expires like a punch on that day). `del` is always true: a client before 2.8 knows no kinds
 * and sees a tombstone it never shows, counts, pairs or rewrites, and it still expires it on time.
 * Whether the absence itself is deleted is `gone` (the absence's own tombstone).
 * @param {any} e
 */
export const isAbsence = (e) => !!e && e.kind === 'absence';

/** Punches per logical day in the app (an absence on that day takes one of these places, see write()). The server accepts up to 50 record writes per account and UTC day,
 * so back-entries and edits for several past days still fit into one sitting. */
export const MAX_PER_DAY = 12;
/** Accounts without any use for this many days are deleted on the server (src/retention.js IDLE_DAYS). */
export const IDLE_DAYS = 61;
/** After a login, people who were away longer than this are told about IDLE_DAYS. */
export const AWAY_NOTICE_DAYS = 30;
const DAY = 86_400_000;
/** Device clock off by more than this against the server: no expiry, no hard deletes. */
export const MAX_SKEW = 12 * 3600_000;

export const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ;

/** Oldest local day that is still kept: today and the RETENTION_DAYS − 1 days before. @param {number} now @param {string} tz */
export function oldestDay(now, tz) {
  return addDays(dayKey(now, tz), -(RETENTION_DAYS - 1));
}

/**
 * Oldest logical day that is still kept. Retention cuts whole logical days (isExpired): a night shift
 * from 22:00 to 03:00 goes as one, on the day its «in» reaches the 396 days (the server deletes that
 * record then, by its write time). Its «out» after midnight goes the same day, a day early, rather
 * than being left alone as an «open day». So with or without night shifts this is oldestDay().
 * @param {number} now @param {string} tz @param {number} _dayStart kept for the callers
 */
export function oldestLogicalDay(now, tz, _dayStart) {
  return oldestDay(now, tz);
}

/**
 * Whole UTC days between the server's previous «last seen» day (from the login answer) and now; null if
 * unknown. @param {unknown} lastSeen UTC day start in ms @param {number} now server time
 */
export function awayDays(lastSeen, now) {
  const seen = Number(lastSeen);
  if (lastSeen == null || !Number.isFinite(seen) || seen <= 0 || !Number.isFinite(now)) return null;
  return Math.max(0, Math.floor((Math.floor(now / DAY) * DAY - seen) / DAY));
}

/** Show the away notice after this login? @param {number | null} days */
export const showAwayNotice = (days) => days != null && days > AWAY_NOTICE_DAYS;

/**
 * CSV cell: cells starting with = + - @ (or tab/CR) are prefixed with ' so spreadsheets do not run them
 * as formulas; quotes where needed.
 * @param {string} v
 */
export function csvCell(v) {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Expired: the record's logical day (an absence: its own day) is older than oldestDay(). Whole logical
 * days go together, so a night shift is never cut in half. @param {{ ts: number, kind?: string }} e
 * @param {number} now @param {string} tz @param {number} [dayStart] minutes after midnight (settings)
 */
export function isExpired(e, now, tz, dayStart = 0) {
  if (!Number.isFinite(e.ts)) return true;
  const day = isAbsence(e) ? dayKey(e.ts, tz) : logicalDay(e.ts, tz, dayStart);
  return day < oldestDay(now, tz);
}

/** Absences can be entered at most this many days ahead: the server deletes a record 396 days after it
 * was written, so an absence planned further ahead would vanish before its 13 months are over. */
export const ABSENCE_AHEAD_DAYS = 31;

/**
 * guard: resolves false when the device's local data no longer belongs to this Store (another tab
 * logged out or in as someone else); then nothing is read from or written to the server or the local
 * database any more, and the Store emits 'stale' (the app reloads).
 * @typedef {{ db?: typeof realDb, api?: typeof realApi, now?: () => number, tz?: () => string, random?: () => number, guard?: () => Promise<boolean> }} Deps
 */

/**
 * What the sync indicator says, in order of importance. A refused write is never «synced».
 * @param {{ authLost: boolean, syncing: boolean, online: boolean, syncFailed: boolean, outbox: number, rejected: number }} st
 * @param {boolean} navOnline navigator.onLine
 * @returns {{ key: string, cls: 'ok'|'busy'|'warn', n: number }}
 */
export function syncStatus(st, navOnline) {
  if (st.authLost) return { key: 'logged_out', cls: 'warn', n: 0 };
  if (st.syncing) return { key: 'syncing', cls: 'busy', n: 0 };
  if (!st.online || !navOnline) return st.outbox ? { key: 'offline_waiting', cls: 'warn', n: st.outbox } : { key: 'offline', cls: 'warn', n: 0 };
  if (st.rejected) return { key: 'not_accepted', cls: 'warn', n: st.rejected };
  if (st.syncFailed) return { key: 'not_synced', cls: 'warn', n: 0 };
  if (st.outbox) return { key: 'waiting', cls: 'busy', n: st.outbox };
  return { key: 'synced', cls: 'ok', n: 0 };
}

export class Store extends EventTarget {
  /** @param {string} username @param {CryptoKey} key @param {Deps} [deps] */
  constructor(username, key, deps = {}) {
    super();
    this.username = username;
    this.key = key;
    this.db = deps.db || realDb;
    this.api = deps.api || realApi;
    this.now = deps.now || (() => Date.now());
    this.tz = deps.tz || localTz;
    this.random = deps.random || Math.random;
    this.guard = deps.guard || null;
    /** The local data belongs to another account now (see Deps.guard). */
    this.stale = false;
    /** Writes the server refused for good (400/404/405/413/415): kept, shown, retried or discarded by hand. */
    this.rejected = 0;
    /** Error code of the last refusal (e.g. too_many). @type {string | null} */
    this.rejectedCode = null;
    /** @type {Map<string, any>} id → plaintext entry */
    this.entries = new Map();
    /** @type {Map<string, string>} id → ciphertext (as the server sees it) */
    this.raw = new Map();
    this.settings = { ...DEFAULT_SETTINGS };
    this.seq = 0;
    this.lastSync = 0;
    this.outbox = 0;
    this.unreadable = 0;
    this.syncing = false;
    this.authLost = false;
    this.online = true;
    /** UTC day (ms) on which the server refused more stamps; nothing more is sent before the next day. */
    this.dailyBlocked = 0;
    this.again = false;
    this.againForce = false;
    this.purgedInPull = false;
    /** Server time − device time (ms), measured on the last pull; null = unknown. */
    this.skew = null;
    /** The skew was measured in this session (only then is expiry allowed). */
    this.skewFresh = false;
    /** The last sync failed for another reason than offline/401 (e.g. 403, 5xx). */
    this.syncFailed = false;
    /** A sync of this session has ended (with or without success). */
    this.firstSyncDone = false;
    /** A pull of this session went through: the local settings are the account's current ones. */
    this.pulled = false;
    /**
     * Settings changes made before that (offline, logged out, server trouble): they are written at once,
     * but they were applied to settings that may be stale. When the pull brings the account's settings,
     * these fields are applied again on top of them, so neither this change nor another device's
     * newer, unrelated fields are lost. `base` is the local settings record before the first such change.
     * @type {null | { patch: Record<string, any>, base: { had: boolean, mod: number } }}
     */
    this.prePull = null;
    /** @type {Promise<any>} settings writes run one after the other */
    this.settingsQueue = Promise.resolve();
    /** @type {Promise<void> | null} */
    this.current = null;
    /** Resolves when the rerun asked for during a running sync is done. @type {Promise<void> | null} */
    this.next = null;
    /** @type {null | (() => void)} */
    this.nextDone = null;
  }

  /** Device time corrected by the server's clock (when known). */
  trueNow() {
    return this.now() + (this.skew ?? 0);
  }

  /** The device clock is off by more than 12 h. */
  get clockBad() {
    return this.skew != null && Math.abs(this.skew) > MAX_SKEW;
  }

  /** Expiry and hard deletes only with a fresh, plausible clock. */
  get timeOk() {
    return this.skewFresh && !this.clockBad;
  }

  /**
   * Several IndexedDB changes in one transaction (falls back to one by one for simple stand-ins).
   * @param {{ store: string, op: 'put'|'del', value?: any, key?: IDBValidKey }[]} ops
   */
  async #tx(ops) {
    if (this.db.tx) return this.db.tx(ops);
    for (const o of ops) {
      if (o.op === 'put') await this.db.put(o.store, o.value, o.key);
      else await this.db.del(o.store, /** @type {IDBValidKey} */ (o.key));
    }
  }

  emit(type = 'change') {
    this.dispatchEvent(new Event(type));
  }

  async load() {
    this.seq = (await this.db.kvGet('seq')) || 0;
    this.lastSync = (await this.db.kvGet('lastSync')) || 0;
    this.dailyBlocked = (await this.db.kvGet('dailyBlocked')) || 0;
    const skew = await this.db.kvGet('skew');
    if (typeof skew === 'number') this.skew = skew; // for the banner only; expiry waits for a fresh pull
    const rows = await this.db.all('records');
    for (const r of rows) await this.#absorb(r.id, r.data);
    await this.#countOutbox();
    this.emit();
  }

  /** @param {string} id @param {string} data */
  async #absorb(id, data) {
    try {
      const obj = await decryptRecord(this.key, this.username, id, data);
      this.raw.set(id, data);
      if (id === SETTINGS_ID) this.settings = { ...DEFAULT_SETTINGS, ...obj };
      else this.entries.set(id, { ...obj, id });
      return obj;
    } catch {
      this.unreadable++;
      return null;
    }
  }

  async #countOutbox() {
    const items = await this.db.all('outbox');
    const refused = items.filter((i) => i.rejected);
    const waiting = items.filter((i) => !i.rejected);
    this.outbox = waiting.length;
    this.rejected = refused.length;
    this.rejectedCode = refused.length ? String(refused[refused.length - 1].rejected.code || '') : null;
  }

  /** Still the account whose data is on this device? Sets `stale` and emits 'stale' once if not. */
  async #ours() {
    if (this.stale) return false;
    if (!this.guard) return true;
    let ok = false;
    try {
      ok = await this.guard();
    } catch {
      ok = false;
    }
    if (!ok) {
      this.stale = true;
      this.emit('stale');
    }
    return ok;
  }

  /** Changes not on the server: waiting plus refused ones (for «log out anyway?»). */
  get unsynced() {
    return this.outbox + this.rejected;
  }


  /** All live punches (no tombstones, no absences). */
  list() {
    return [...this.entries.values()].filter((e) => !e.del && !isAbsence(e));
  }

  /** All live absences (not deleted), oldest day first. */
  absences() {
    return [...this.entries.values()].filter((e) => isAbsence(e) && !e.gone && isDayKey(e.day)).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  }

  /** Live absences on a logical day (except the record `except`). @param {string} day @param {string} [except] */
  absencesOn(day, except) {
    return this.absences().filter((a) => a.day === day && a.id !== except);
  }

  /** Records that hold a place of the day's MAX_PER_DAY: its punches and its absence. @param {string} day */
  dayRecords(day) {
    return this.countDay(day) + this.absencesOn(day).length;
  }

  /** Minutes after midnight at which the day changes (settings). */
  get dayStart() {
    const v = Number(this.settings.dayStart);
    return Number.isInteger(v) && v > 0 && v < 1440 ? v : 0;
  }

  /** Logical day of a moment. @param {number} ts @param {string} [tz] */
  dayOf(ts, tz) {
    return logicalDay(ts, tz || this.tz(), this.dayStart);
  }

  /** Live punches on a logical day. @param {string} day */
  countDay(day) {
    let n = 0;
    for (const e of this.entries.values()) if (!e.del && !isAbsence(e) && this.dayOf(e.ts, e.tz) === day) n++;
    return n;
  }

  todayFull() {
    return this.dayRecords(this.dayOf(this.now())) >= MAX_PER_DAY;
  }

  /** Server refused stamps today (UTC); they wait in the outbox. */
  get dailyLimited() {
    return this.dailyBlocked === Math.floor(this.trueNow() / DAY) * DAY;
  }

  /**
   * Write an entry (new or changed). Always local first, then into the outbox.
   * @param {string} id @param {Record<string, any>} obj
   */
  async write(id, obj) {
    if (!(await this.#ours())) throw new Error('stale');
    const isSettings = id === SETTINGS_ID;
    const prev = isSettings ? this.settings : this.entries.get(id);
    const { id: _drop, ...plain } = obj;
    if (!isSettings && isAbsence(plain)) {
      if (!isDayKey(plain.day)) throw new Error('bad_day');
      plain.del = true; // always: older clients must see a tombstone
      if (isExpired(plain, this.trueNow(), this.tz())) throw new Error('too_old');
      // A new absence (or one moved to another day) needs a day without one and a free place of the 12.
      const moved = !prev || !!prev.gone || prev.day !== plain.day;
      if (!plain.gone && moved) {
        if (plain.day > addDays(this.dayOf(this.trueNow()), ABSENCE_AHEAD_DAYS)) throw new Error('too_far');
        if (this.absencesOn(plain.day, id).length) throw new Error('absence_exists');
        if (this.dayRecords(plain.day) >= MAX_PER_DAY) throw new Error('no_room');
      }
    } else if (!isSettings) {
      if (isExpired(plain, this.trueNow(), this.tz(), this.dayStart)) throw new Error('too_old');
      const day = this.dayOf(plain.ts, plain.tz);
      // A new punch, or one moved onto another day, needs room on that day (an absence takes a place).
      const moved = !prev || prev.del || this.dayOf(prev.ts, prev.tz) !== day;
      if (!plain.del && moved && this.dayRecords(day) >= MAX_PER_DAY) throw new Error(this.absencesOn(day).length ? 'day_full_abs' : 'day_full');
    }
    // mod from the corrected clock: a device far ahead must not win every later merge.
    const rec = { ...plain, v: 1, mod: nextMod(prev, this.trueNow()) };
    if (jsonSize(rec) > PLAINTEXT_SIZE) throw new Error('too_long');
    const data = await encryptRecord(this.key, this.username, id, rec);
    await this.#tx([
      { store: 'records', op: 'put', value: { id, data } },
      { store: 'outbox', op: 'put', value: { id, op: 'put', data, notBefore: 0 } },
    ]);
    this.raw.set(id, data);
    if (isSettings) this.settings = { ...DEFAULT_SETTINGS, ...rec };
    else this.entries.set(id, { ...rec, id });
    await this.#countOutbox();
    this.emit();
    this.sync();
    return rec;
  }

  /** One punch now. Whether it is an "in" or an "out" follows from its place in the day. */
  async punch(now = this.now()) {
    const id = newId();
    const entry = { ts: now, tz: this.tz(), note: '', del: false };
    await this.write(id, entry);
    return { ...entry, id };
  }

  /**
   * Settings: wait for the first pull of this session, then apply the patch to what is current
   * (otherwise a stale local object would overwrite newer settings from another device).
   * @param {Partial<typeof DEFAULT_SETTINGS>} patch
   */
  saveSettings(patch) {
    // One after the other: each change is applied to the result of the previous one.
    const run = async () => {
      // Wait for the first sync of the session (once: offline, a change must not wait for each attempt).
      if (!this.pulled && !this.firstSyncDone) await this.sync();
      if (!this.pulled) {
        // Still no pull: keep the change to apply it again onto the account's settings later.
        if (!this.prePull) this.prePull = { patch: {}, base: { had: this.raw.has(SETTINGS_ID), mod: Number(this.settings.mod) || 0 } };
        Object.assign(this.prePull.patch, patch);
      }
      return this.write(SETTINGS_ID, { ...this.settings, ...patch, kind: 'settings' });
    };
    const next = this.settingsQueue.then(run, run);
    this.settingsQueue = next.catch(() => {});
    return next;
  }

  /**
   * A whole or half day off on a logical day. @param {{ day: string, type: string, half?: boolean, note?: string }} a
   * @returns {Promise<any>} the absence as stored (with its id)
   */
  async addAbsence(a) {
    if (!isDayKey(a.day)) throw new Error('bad_day');
    const tz = this.tz();
    const { y, m, d } = parseDay(a.day);
    const entry = { kind: 'absence', day: a.day, type: absenceType(a.type), half: !!a.half, note: String(a.note || ''), ts: zonedToEpoch(y, m, d, 12, 0, tz), tz, del: true, gone: false };
    const id = newId();
    await this.write(id, entry);
    return { ...entry, id };
  }

  /** Delete = write a tombstone (an absence: `gone`, it stays `del` for old clients). @param {string} id */
  async remove(id) {
    const e = this.entries.get(id);
    if (!e) return;
    if (isAbsence(e)) await this.write(id, { ...e, gone: true, note: '' });
    else await this.write(id, { ...e, del: true, note: '' });
  }

  /** Forget an entry here and queue a hard delete on the server (replaces any pending write). @param {string} id */
  async #purge(id) {
    this.entries.delete(id);
    this.raw.delete(id);
    await this.#tx([
      { store: 'records', op: 'del', key: id },
      { store: 'outbox', op: 'put', value: { id, op: 'delete', notBefore: 0 } },
    ]);
  }

  /**
   * Retention: drop own entries (and tombstones) older than RETENTION_DAYS, here and on the server.
   * Only with a clock checked against the server in this session; a wrong device clock deletes nothing.
   */
  async expire() {
    if (!this.timeOk) return 0;
    const now = this.trueNow();
    const tz = this.tz();
    let n = 0;
    for (const [id, e] of [...this.entries]) {
      if (isExpired(e, now, tz, this.dayStart)) {
        await this.#purge(id);
        n++;
      }
    }
    if (n) this.emit();
    return n;
  }

  /** Automatic sync (timer, app visible again, network back). */
  autoSync() {
    return this.sync();
  }

  /**
   * Sync: fetch new records first (this also measures the clock skew), then expire, then send due
   * outbox items. Resolves when the sync is done; asked for while one runs, when the rerun after it
   * is done (so a record written meanwhile has been sent, or has failed like the rest).
   * @param {{ force?: boolean }} [opt] force: by hand; lifts the «no more stamps today» block. Everything
   *   due is sent either way (records from the former «delayed sync», up to 2.8, may still carry a
   *   waiting time: it is ignored)
   * @returns {Promise<void>}
   */
  sync(opt = {}) {
    if (this.syncing) {
      // The running sync may have read the outbox already: run once more afterwards, and resolve only
      // when that rerun is done, so whatever was written meanwhile has been sent.
      this.again = true;
      if (opt.force) this.againForce = true; // a «send now» asked for during a running sync is not lost
      if (!this.next) this.next = new Promise((r) => (this.nextDone = r));
      return this.next;
    }
    this.syncing = true;
    this.current = this.#run(opt);
    return this.current;
  }

  /** @param {{ force?: boolean }} opt */
  async #run(opt) {
    this.emit('sync');
    try {
      // Another tab may have logged out or in as someone else: then this Store must neither send its
      // old records with the new cookie nor write its seq into the new account's local data.
      if (!(await this.#ours())) return;
      // Asked for by hand: try again even if the server said «no more today» earlier (the limit may
      // have been raised, or it was another day's count). Also on the device, or a reload blocks again.
      if (opt.force && this.dailyBlocked) await this.#setDailyBlocked(0);
      this.purgedInPull = false;
      await this.#pull();
      this.pulled = true;
      await this.#reapplyPrePull();
      if (!(await this.#ours())) return;
      await this.expire();
      await this.#push(!!opt.force);
      this.online = true;
      this.authLost = false;
      this.syncFailed = false;
      this.lastSync = this.now();
      await this.db.kvSet('lastSync', this.lastSync);
    } catch (e) {
      if (e instanceof this.api.OfflineError) this.online = false;
      else if (e instanceof this.api.ApiError && e.status === 410 && e.body?.error === 'account_deleted') {
        // Deleted on another device (or for being unused): the app wipes this device.
        this.accountGone = true;
        this.emit('gone');
      } else if (e instanceof this.api.ApiError && e.status === 401) {
        this.authLost = true;
        this.emit('auth');
      } else this.syncFailed = true;
    } finally {
      this.syncing = false;
      this.firstSyncDone = true;
      await this.#countOutbox();
      this.emit();
      this.emit('sync');
      if (this.again) {
        this.again = false;
        const force = !!this.againForce;
        this.againForce = false;
        const done = this.nextDone;
        this.next = null;
        this.nextDone = null;
        setTimeout(() => {
          const p = this.sync({ force });
          if (done) p.then(done, done);
        }, 0);
      }
    }
  }

  /** @param {number} day UTC day start (ms), 0 = not blocked */
  async #setDailyBlocked(day) {
    this.dailyBlocked = day;
    await this.db.kvSet('dailyBlocked', day);
  }

  /** After the first pull: apply settings changes made before it onto what is current now. */
  async #reapplyPrePull() {
    const pre = this.prePull;
    this.prePull = null;
    if (!pre) return;
    const cur = /** @type {Record<string, any>} */ (this.settings);
    if (Object.keys(pre.patch).every((k) => cur[k] === pre.patch[k])) return; // ours won the merge
    await this.write(SETTINGS_ID, { ...this.settings, ...pre.patch, kind: 'settings' });
  }

  /** @param {any} e */
  #permanent(e) {
    // 401 (session), 403 (e.g. a proxy or Origin trouble), 429 and 5xx are transient: keep the item.
    // 410 (account deleted) stops the sync; the app then wipes this device.
    return e instanceof this.api.ApiError && e.status >= 400 && e.status < 500 && ![401, 403, 410, 429].includes(e.status);
  }

  /** @param {boolean} force */
  async #push(force) {
    const items = await this.db.all('outbox');
    const now = this.now();
    const today = Math.floor(this.trueNow() / DAY) * DAY;
    for (const item of items) {
      if (item.rejected) continue; // refused for good: waits for «retry» or «discard»
      if (item.op === 'delete') {
        // Hard deletes only with a plausible clock (they are retention deletes).
        if (!this.timeOk) continue;
        try {
          await this.api.deleteRecord(item.id);
        } catch (e) {
          if (!this.#permanent(e)) throw e;
        }
        const cur = await this.db.get('outbox', item.id);
        if (cur && cur.op === 'delete') await this.db.del('outbox', item.id);
        continue;
      }
      // Daily limit reached on the server: stamps wait for the next UTC day, no retry loop.
      if (item.id !== SETTINGS_ID && this.dailyBlocked === today) continue;
      try {
        await this.api.putRecord(item.id, item.data);
      } catch (e) {
        if (e instanceof this.api.ApiError && e.status === 429 && e.body?.error === 'daily_limit') {
          await this.#setDailyBlocked(today);
          continue;
        }
        // Settings budget used up for today: keep it in the outbox and go on with the rest.
        if (e instanceof this.api.ApiError && e.status === 429 && item.id === SETTINGS_ID) continue;
        if (this.#permanent(e)) {
          // Refused for good (e.g. 413 too_many: the account holds the maximum of records). Not retried
          // in a loop, but kept and shown («not accepted by the server») until retried or discarded.
          const cur = await this.db.get('outbox', item.id);
          if (cur && cur.data === item.data) {
            const err = /** @type {any} */ (e);
            await this.db.put('outbox', { ...cur, rejected: { status: err.status, code: String(err.body?.error || '') } });
          }
          continue;
        }
        throw e;
      }
      // The server takes stamps again (e.g. its limit was raised): nothing is blocked any more.
      if (item.id !== SETTINGS_ID && this.dailyBlocked) await this.#setDailyBlocked(0);
      // Only remove if nothing newer is waiting for this id.
      const cur = await this.db.get('outbox', item.id);
      if (cur && cur.data === item.data) await this.db.del('outbox', item.id);
    }
  }

  /** Send the refused writes again (e.g. after making room). */
  async retryRejected() {
    for (const item of await this.db.all('outbox')) {
      if (!item.rejected) continue;
      const { rejected: _r, ...rest } = item;
      await this.db.put('outbox', rest);
    }
    await this.#countOutbox();
    this.emit();
    return this.sync({ force: true });
  }

  /**
   * Give up the refused writes: they leave the outbox and their local versions are dropped; the whole
   * account is then fetched again, so this device shows exactly what the server has.
   */
  async discardRejected() {
    const ids = (await this.db.all('outbox')).filter((i) => i.rejected).map((i) => i.id);
    if (!ids.length) return;
    /** @type {{ store: string, op: 'put'|'del', value?: any, key?: IDBValidKey }[]} */
    const ops = [];
    for (const id of ids) {
      ops.push({ store: 'outbox', op: 'del', key: id }, { store: 'records', op: 'del', key: id });
      this.entries.delete(id);
      this.raw.delete(id);
      if (id === SETTINGS_ID) this.settings = { ...DEFAULT_SETTINGS };
    }
    await this.#tx(ops);
    this.seq = 0;
    await this.db.kvSet('seq', 0);
    await this.#countOutbox();
    this.emit();
    return this.sync();
  }

  async #pull() {
    for (let guard = 0; guard < 100; guard++) {
      const asked = this.now();
      const res = await this.api.getRecords(this.seq);
      if (guard === 0 && Number.isFinite(res.now)) {
        // Skew = server time − device time (half the round trip does not matter at 12 h).
        this.skew = Number(res.now) - Math.round((asked + this.now()) / 2);
        this.skewFresh = true;
        await this.db.kvSet('skew', this.skew);
      }
      for (const r of res.records) await this.#merge(r.id, r.data);
      this.seq = res.seq;
      await this.db.kvSet('seq', this.seq);
      if (!res.more) break;
    }
  }

  /** @param {string} id @param {string} data */
  async #merge(id, data) {
    if (this.raw.get(id) === data) return; // own record coming back
    let remote;
    try {
      remote = await decryptRecord(this.key, this.username, id, data);
    } catch {
      this.unreadable++;
      return;
    }
    // Expired on the server side (e.g. re-uploaded by a device that was offline): never resurrect.
    // Judged on the corrected clock only; with a wrong device clock nothing is purged.
    if (id !== SETTINGS_ID && this.timeOk && isExpired(remote, this.trueNow(), this.tz(), this.dayStart)) {
      await this.#purge(id);
      this.purgedInPull = true;
      return;
    }
    let local = id === SETTINGS_ID ? (this.raw.has(id) ? this.settings : null) : this.entries.get(id);
    const pendingItem = await this.db.get('outbox', id);
    if (pendingItem && pendingItem.op === 'delete') return;
    const pending = !!pendingItem;
    if (id === SETTINGS_ID && this.prePull) {
      // Settings changed before this pull: judge the version they were applied to; the change itself
      // is applied again on top of the winner (#reapplyPrePull).
      const { base } = this.prePull;
      local = base.had ? { mod: base.mod } : null;
    } else if (pendingItem && pendingItem.data && pendingItem.data !== this.raw.get(id)) {
      // Another tab of this device wrote the waiting change (same outbox, own memory): decide against
      // that version, or taking the remote one would throw away its newer write.
      try {
        local = await decryptRecord(this.key, this.username, id, pendingItem.data);
      } catch {
        /* unreadable: decide on what this tab has */
      }
    }
    const decision = mergeDecision(local, pending, remote);
    if (decision === 'take-remote') {
      /** @type {{ store: string, op: 'put'|'del', value?: any, key?: IDBValidKey }[]} */
      const ops = [{ store: 'records', op: 'put', value: { id, data } }];
      if (pending) ops.push({ store: 'outbox', op: 'del', key: id });
      await this.#tx(ops);
      await this.#absorb(id, data);
    } else if (decision === 'repush-local') {
      const mine = this.raw.get(id);
      if (mine) await this.db.put('outbox', { id, op: 'put', data: mine, notBefore: 0 });
    }
  }
}
