import { describe, it, expect, beforeAll } from 'vitest';
import { Store, MAX_PER_DAY, RETENTION_DAYS, RETENTION_MONTHS, IDLE_DAYS, AWAY_NOTICE_DAYS, awayDays, showAwayNotice, isExpired, oldestDay, oldestLogicalDay, csvCell, buttonLabelKey, buttonLabel, DEFAULT_SETTINGS, badgeDays, badgeDue, badgeNextDay, BADGE_DAYS_DEFAULT, FX_NAMES, FX_CHOICES, fxSetting, pickFx, COLORS, colorSetting, syncStatus } from '../../public/js/store.js';
import { MAX_RECORDS } from '../../src/api.js';
import { RETENTION_DAYS as SERVER_RETENTION_DAYS, IDLE_DAYS as SERVER_IDLE_DAYS } from '../../src/retention.js';
import { limits } from '../../src/limits.js';
import { ApiError, OfflineError } from '../../public/js/api.js';
import { createAccount, encryptRecord, decryptRecord, passphraseKeys, newId, SETTINGS_ID } from '../../public/js/crypto.js';
import { deleteAccountWith, isWrongAuth } from '../../public/js/flow.js';
import { zonedToEpoch } from '../../public/js/time.js';

const TZ = 'Europe/Zurich';
const USER = 'store.test';
const DAY = 86_400_000;
let KEY;
beforeAll(async () => {
  KEY = (await createAccount(USER, 'eine-lange-passphrase', { iterations: 1000 })).key;
});

/** In-memory stand-in for db.js. `tx` applies all changes or none, like one IndexedDB transaction. */
function fakeDb() {
  const s = { kv: new Map(), records: new Map(), outbox: new Map() };
  const put = (st, v, k) => void s[st].set(st === 'kv' ? k : v.id, v);
  return {
    s,
    get: async (st, k) => s[st].get(k),
    put: async (st, v, k) => put(st, v, k),
    del: async (st, k) => void s[st].delete(k),
    tx: async (ops) => {
      for (const o of ops) if (o.op === 'put') put(o.store, o.value, o.key);
      else s[o.store].delete(o.key);
    },
    all: async (st) => [...s[st].values()],
    count: async (st) => s[st].size,
    kvGet: async (k) => s.kv.get(k),
    kvSet: async (k, v) => void s.kv.set(k, v),
    wipe: async () => Object.values(s).forEach((m) => m.clear()),
  };
}

/**
 * In-memory server with a configurable daily write limit (UTC day, settings excluded). Pages like the
 * real one (records + seq from one snapshot); `onPage` runs after a page was taken (to simulate a
 * concurrent write); `fail` makes every call answer with that HTTP status, `failPut` only the writes.
 */
class FakeServer {
  constructor(clock, max = 50, pageSize = 500) {
    this.clock = clock;
    this.max = max;
    this.pageSize = pageSize;
    this.onPage = null;
    /** Runs at the start of every putRecord (e.g. to hold it until a test lets it go). */
    this.onPut = null;
    /** The auth value of the account (deleteAccount checks it, like the real server). */
    this.auth = null;
    this.accountDeleted = false;
    this.fail = 0;
    this.failPut = 0;
    this.failSettings = 0;
    /** Body of the `fail` answers. */
    this.failBody = { error: 'x' };
    this.getCalls = 0;
    this.records = new Map();
    this.seq = 0;
    this.writes = new Map();
    this.putCalls = 0;
    this.deleted = [];
    this.offline = false;
    const self = this;
    this.api = {
      ApiError,
      OfflineError,
      async putRecord(id, data) {
        self.putCalls++;
        if (self.onPut) await self.onPut(id);
        if (self.offline) throw new OfflineError();
        if (self.fail || self.failPut) throw new ApiError(self.fail || self.failPut, self.failBody);
        if (id === SETTINGS_ID && self.failSettings) throw new ApiError(self.failSettings, { error: 'rate_limited' });
        if (id !== SETTINGS_ID) {
          const day = Math.floor(self.clock.now / DAY);
          const n = (self.writes.get(day) || 0) + 1;
          self.writes.set(day, n);
          if (n > self.max) throw new ApiError(429, { error: 'daily_limit' });
        }
        self.records.set(id, { data, seq: ++self.seq });
        return { ok: true, seq: self.seq };
      },
      async deleteAccount(auth) {
        if (self.offline) throw new OfflineError();
        if (auth !== self.auth) throw new ApiError(400, { error: 'wrong_auth' });
        self.accountDeleted = true;
        self.records.clear();
        return { ok: true };
      },
      async deleteRecord(id) {
        if (self.offline) throw new OfflineError();
        self.deleted.push(id);
        self.records.delete(id);
        return { ok: true };
      },
      async getRecords(since) {
        self.getCalls++;
        if (self.offline) throw new OfflineError();
        if (self.fail) throw new ApiError(self.fail, self.failBody);
        const all = [...self.records].map(([id, r]) => ({ id, ...r })).filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
        const records = all.slice(0, self.pageSize);
        const more = all.length > self.pageSize;
        const seq = more ? records[records.length - 1].seq : Math.max(since, self.seq);
        const page = { records, seq, more, now: self.clock.now };
        if (self.onPage) await self.onPage(page);
        return page;
      },
    };
  }
}

/** o.deviceAhead: the device clock runs this many ms ahead of the server's. */
function setup(o = {}) {
  const clock = { now: o.now ?? zonedToEpoch(2026, 11, 24, 12, 0, TZ) };
  const server = o.server || new FakeServer(clock, o.max, o.pageSize);
  if (o.server) server.clock = clock;
  const db = o.db || fakeDb();
  const ahead = o.deviceAhead || 0;
  const st = new Store(USER, KEY, { db, api: server.api, now: () => clock.now + ahead, tz: () => TZ, random: o.random, guard: o.guard });
  return { clock, server, db, st };
}

/** Wait until background syncs are done. */
async function idle(st) {
  for (let i = 0; i < 500; i++) {
    await new Promise((r) => setTimeout(r, 2));
    if (!st.syncing && !st.again) return;
  }
  throw new Error('store never became idle');
}

const at = (clock, daysAgo, h = 9) => {
  const d = new Date(clock.now - daysAgo * DAY);
  return zonedToEpoch(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h, 0, TZ);
};

describe('retention (client)', () => {
  it('13 months: keeps today and the 395 days before, nothing older', () => {
    const now = zonedToEpoch(2026, 11, 24, 12, 0, TZ);
    expect(RETENTION_DAYS).toBe(396);
    expect(RETENTION_MONTHS).toBe(13);
    expect(oldestDay(now, TZ)).toBe('2025-10-25');
    // the start screen and the edit dialog go back as far as that, also with night shifts (whole
    // logical days expire: see «night shifts expire as a whole»)
    expect(oldestLogicalDay(now, TZ, 0)).toBe('2025-10-25');
    expect(oldestLogicalDay(now, TZ, 4 * 60)).toBe('2025-10-25');
    expect(isExpired({ ts: zonedToEpoch(2025, 10, 25, 0, 1, TZ) }, now, TZ)).toBe(false);
    expect(isExpired({ ts: zonedToEpoch(2025, 10, 24, 23, 59, TZ) }, now, TZ)).toBe(true);
  });

  it('client and server agree on 396 days and 61 idle days', () => {
    expect(SERVER_RETENTION_DAYS).toBe(RETENTION_DAYS);
    expect(SERVER_IDLE_DAYS).toBe(IDLE_DAYS);
  });

  it('a full account fits the server cap: 12 punches × 396 days + the settings record ≤ 5000 records', () => {
    // Raise MAX_PER_DAY or RETENTION_DAYS only together with MAX_RECORDS (src/api.js).
    expect(MAX_PER_DAY).toBe(12);
    expect(MAX_PER_DAY * RETENTION_DAYS + 1).toBeLessThanOrEqual(MAX_RECORDS);
    expect(MAX_RECORDS).toBe(5000);
  });

  it('refuses entries older than 396 days', async () => {
    const { st, clock } = setup();
    await expect(st.write(newId(), { ts: at(clock, 396), tz: TZ, note: '', del: false })).rejects.toThrow('too_old');
    await st.write(newId(), { ts: at(clock, 395), tz: TZ, note: '', del: false });
    await idle(st);
    expect(st.list()).toHaveLength(1);
  });

  it('drops expired entries on sync and hard-deletes them on the server', async () => {
    const { st, clock, server, db } = setup();
    const id = newId();
    await st.write(id, { ts: at(clock, 10), tz: TZ, note: 'alt', del: false });
    const keep = newId();
    await st.write(keep, { ts: at(clock, 0), tz: TZ, note: '', del: false });
    await idle(st);
    expect(server.records.has(id)).toBe(true);

    clock.now += 387 * DAY; // the first entry is now 397 days old
    await st.sync();
    await idle(st);
    expect(st.entries.has(id)).toBe(false);
    expect(db.s.records.has(id)).toBe(false);
    expect(server.records.has(id)).toBe(false);
    expect(server.deleted).toContain(id);
    expect(db.s.outbox.size).toBe(0);
    expect(st.entries.has(keep)).toBe(true);
  });

  it('a device offline for long cannot re-upload expired entries', async () => {
    const shared = setup();
    const { st: b, clock, server } = setup({ server: shared.server });
    server.offline = true;
    const id = newId();
    await b.write(id, { ts: at(clock, 5), tz: TZ, note: '', del: false });
    await idle(b);
    expect(b.outbox).toBe(1);
    server.offline = false;
    clock.now += 400 * DAY;
    const putsBefore = server.putCalls;
    await b.sync();
    await idle(b);
    expect(server.putCalls).toBe(putsBefore); // never sent
    expect(server.records.has(id)).toBe(false);
    expect(b.entries.has(id)).toBe(false);
  });

  it('an expired record that reaches the server anyway is not resurrected and gets deleted', async () => {
    const { st, clock, server } = setup();
    const id = newId();
    const data = await encryptRecord(KEY, USER, id, { v: 1, ts: at(clock, 400), tz: TZ, note: '', del: false, mod: 1 });
    server.records.set(id, { data, seq: ++server.seq }); // e.g. uploaded by an outdated client
    await st.sync();
    await idle(st);
    expect(st.entries.has(id)).toBe(false);
    expect(server.records.has(id)).toBe(false);
  });

  it('expired records kept on the device go at the first sync, not before the clock was checked', async () => {
    const { st, clock, db, server } = setup();
    const id = newId();
    db.s.records.set(id, { id, data: await encryptRecord(KEY, USER, id, { v: 1, ts: at(clock, 500), tz: TZ, mod: 1 }) });
    server.offline = true;
    await st.load();
    await st.sync();
    expect(st.entries.has(id)).toBe(true); // offline: clock unchecked, nothing deleted
    server.offline = false;
    await st.sync();
    await idle(st);
    expect(st.entries.has(id)).toBe(false);
    expect(db.s.records.has(id)).toBe(false);
    expect(server.deleted).toContain(id);
  });

  it('the settings record never expires', async () => {
    const { st, clock, server } = setup();
    await st.saveSettings({ weekHours: 40 });
    await idle(st);
    clock.now += 800 * DAY;
    await st.sync();
    await idle(st);
    expect(server.records.has(SETTINGS_ID)).toBe(true);
    expect(st.settings.weekHours).toBe(40);
  });
});

describe('12 punches per day (client)', () => {
  it('blocks the 13th punch of a local day', async () => {
    const { st, clock } = setup({ max: 1000 });
    for (let i = 0; i < MAX_PER_DAY; i++) {
      await st.punch(clock.now + i * 60_000);
    }
    await idle(st);
    expect(st.todayFull()).toBe(true);
    await expect(st.punch(clock.now + (MAX_PER_DAY + 1) * 60_000)).rejects.toThrow('day_full');
    // editing an existing entry is still possible
    const [e] = st.list();
    await st.write(e.id, { ...e, note: 'geändert' });
    // another day is not affected
    await st.write(newId(), { ts: at(clock, 1), tz: TZ, note: '', del: false });
    await idle(st);
  });

  it('the app stops at 12 a day, while the server (1000 writes a day) still takes back-entries for other days', async () => {
    const { st, clock, server } = setup({ max: limits({}).writesPerDay.max });
    expect(limits({}).writesPerDay.max).toBe(1000);
    for (let i = 0; i < MAX_PER_DAY; i++) await st.punch(clock.now - (MAX_PER_DAY - i) * 60_000);
    await expect(st.punch(clock.now)).rejects.toThrow('day_full');
    // back-entries for three past days in the same sitting: 36 more writes, all accepted by the server
    for (let d = 1; d <= 3; d++) for (let i = 0; i < MAX_PER_DAY; i++) await st.write(newId(), { ts: at(clock, d, 6) + i * 60_000, tz: TZ, note: '', del: false });
    await idle(st);
    expect(server.records.size).toBe(4 * MAX_PER_DAY);
    expect(st.dailyLimited).toBe(false);
  });

  it('outbox items refused with daily_limit wait for the next day, without a retry loop', async () => {
    const { st, clock, server, db } = setup({ max: 3 });
    for (let i = 0; i < 5; i++) await st.write(newId(), { ts: at(clock, 1, 8 + i), tz: TZ, note: '', del: false });
    await idle(st);
    expect(server.records.size).toBe(3);
    expect(db.s.outbox.size).toBe(2);
    expect(st.dailyLimited).toBe(true);
    const calls = server.putCalls;
    for (let i = 0; i < 5; i++) await st.sync();
    await idle(st);
    expect(server.putCalls).toBe(calls); // no hammering
    // settings still go through
    await st.saveSettings({ nerd: true });
    await idle(st);
    expect(server.records.has(SETTINGS_ID)).toBe(true);
    expect(db.s.outbox.size).toBe(2);
    // next UTC day: sent
    clock.now += DAY;
    await st.sync();
    await idle(st);
    expect(db.s.outbox.size).toBe(0);
    expect(server.records.size).toBe(6);
    expect(st.dailyLimited).toBe(false);
  });

  it('the blocked day survives a reload', async () => {
    const { st, clock, server, db } = setup({ max: 0 });
    await st.punch(clock.now);
    await idle(st);
    const st2 = new Store(USER, KEY, { db, api: server.api, now: () => clock.now, tz: () => TZ });
    await st2.load();
    expect(st2.dailyLimited).toBe(true);
    const calls = server.putCalls;
    await st2.sync();
    expect(server.putCalls).toBe(calls);
  });
});

describe('sync between two devices', () => {
  it('a record written on A shows up on B', async () => {
    const a = setup();
    const b = setup({ server: a.server });
    b.clock.now = a.clock.now;
    const entry = await a.st.punch();
    await idle(a.st);
    await b.st.sync();
    await idle(b.st);
    expect(entry.ts).toBeGreaterThan(0);
    expect(b.st.list().map((e) => e.ts)).toEqual([entry.ts]);
  });
});

describe('night shifts in the store', () => {
  it('the 12-per-day count uses the logical day; changing the setting regroups without rewriting', async () => {
    const { st, clock, server } = setup({ max: 1000, now: zonedToEpoch(2026, 11, 25, 2, 0, TZ) });
    await st.write(newId(), { ts: zonedToEpoch(2026, 11, 24, 22, 0, TZ), tz: TZ, note: '', del: false });
    await idle(st);
    expect(st.countDay('2026-11-25')).toBe(0);
    const writes = server.putCalls;
    await st.saveSettings({ dayStart: 240 });
    await idle(st);
    expect(server.putCalls).toBe(writes + 1); // only the settings record
    expect(st.dayStart).toBe(240);
    expect(st.dayOf(clock.now)).toBe('2026-11-24');
    expect(st.countDay('2026-11-24')).toBe(1);
  });
});

describe('wrong device clock (B1)', () => {
  it('a device one year ahead logs in: the server keeps every record, nothing is purged, a banner shows', async () => {
    const a = setup();
    for (let i = 0; i < 5; i++) await a.st.write(newId(), { ts: at(a.clock, i * 10), tz: TZ, note: '', del: false });
    await a.st.saveSettings({ weekHours: 40 });
    await idle(a.st);
    const before = [...a.server.records.keys()].sort();
    expect(before).toHaveLength(6);

    const b = setup({ server: a.server, deviceAhead: 365 * DAY });
    b.clock.now = a.clock.now;
    await b.st.load();
    await b.st.sync();
    await idle(b.st);
    expect(b.st.clockBad).toBe(true);
    expect(a.server.deleted).toEqual([]);
    expect([...a.server.records.keys()].sort()).toEqual(before);
    expect(b.st.list()).toHaveLength(5); // pulled records are kept, not purged
    expect(b.db.s.outbox.size).toBe(0);
    // A write from the wrong clock gets a mod from the server-corrected time, not a year ahead.
    const e = b.st.list()[0];
    const rec = await b.st.write(e.id, { ...e, note: 'x' });
    expect(rec.mod).toBeLessThan(a.clock.now + DAY);
    // Expiry would have used the device time: nothing goes on further syncs either.
    await b.st.sync();
    await idle(b.st);
    expect(a.server.deleted).toEqual([]);
  });

  it('with a correct clock the skew is ~0 and expiry runs', async () => {
    const { st } = setup();
    await st.sync();
    expect(st.clockBad).toBe(false);
    expect(Math.abs(st.skew)).toBeLessThan(1000);
    expect(st.timeOk).toBe(true);
  });
});

describe('sync paging and concurrent writes (B4)', () => {
  it('pages through all records; a write that lands while paging arrives with the next sync', async () => {
    const a = setup({ pageSize: 3, max: 1000 });
    for (let i = 0; i < 7; i++) await a.st.write(newId(), { ts: at(a.clock, 1, 8) + i * 60_000, tz: TZ, note: '', del: false });
    await idle(a.st);
    const b = setup({ server: a.server });
    b.clock.now = a.clock.now;
    let injected = false;
    const lateId = newId();
    a.server.onPage = async (page) => {
      if (injected || !page.more) return;
      injected = true;
      // another device writes right after this page was read
      const data = await encryptRecord(KEY, USER, lateId, { v: 1, ts: at(a.clock, 0, 7), tz: TZ, note: '', del: false, mod: a.clock.now });
      a.server.records.set(lateId, { data, seq: ++a.server.seq });
    };
    await b.st.sync();
    await idle(b.st);
    expect(a.server.getCalls).toBeGreaterThanOrEqual(3); // really paged
    a.server.onPage = null;
    await b.st.sync();
    await idle(b.st);
    expect(b.st.list()).toHaveLength(8);
    expect(b.st.entries.has(lateId)).toBe(true);
  });
});

describe('no delayed sync any more (removed in 2.9)', () => {
  it('a punch is sent at once, also on an account that still has the old setting switched on', async () => {
    const { st, clock, server, db } = setup({ random: () => 0.9 });
    await st.saveSettings({ delayed: true });
    await idle(st);
    const puts = server.putCalls;
    await st.punch(clock.now);
    await idle(st);
    expect(server.putCalls).toBe(puts + 1);
    expect(db.s.outbox.size).toBe(0);
  });

  it('the old field «delayed» is dropped from the settings record with the next change (room for newer fields)', async () => {
    const { st } = setup();
    await st.saveSettings({ delayed: true });
    expect(/** @type {any} */ (st.settings).delayed).toBe(true);
    await st.saveSettings({ pause: 'de' });
    await idle(st);
    expect(/** @type {any} */ (st.settings).delayed).toBeUndefined();
    expect(st.settings.pause).toBe('de');
  });

  it('a record still waiting with a time from the old setting goes with the next sync', async () => {
    const { st, clock, server, db } = setup();
    await idle(st);
    server.failPut = 503; // keep the punch in the outbox
    await st.punch(clock.now);
    await idle(st);
    expect(db.s.outbox.size).toBe(1);
    // as a client up to 2.8 left it: not before six hours from now
    const [item] = [...db.s.outbox.values()];
    await db.put('outbox', { ...item, notBefore: clock.now + 6 * 3600_000 });
    server.failPut = 0;
    await st.sync();
    await idle(st);
    expect(db.s.outbox.size).toBe(0);
  });

  it('automatic syncs are not held back', async () => {
    const { st, server } = setup();
    await idle(st);
    const gets = server.getCalls;
    await st.autoSync();
    expect(server.getCalls).toBe(gets + 1);
  });
});

describe('outbox and local writes (B7)', () => {
  it('403 and 5xx are transient: the item stays, the store says «not synced»', async () => {
    for (const status of [403, 500, 503]) {
      for (const where of ['fail', 'failPut']) {
        const { st, server, db } = setup();
        server[where] = status;
        await st.punch();
        await idle(st);
        expect(db.s.outbox.size, `${where} ${status}`).toBe(1);
        expect(st.syncFailed).toBe(true);
        server[where] = 0;
        await st.sync();
        await idle(st);
        expect(db.s.outbox.size).toBe(0);
        expect(st.syncFailed).toBe(false);
      }
    }
  });

  it('a settings 429 is skipped (kept), the other items still go out', async () => {
    const { st, server, db } = setup();
    await st.sync();
    server.failSettings = 429;
    await st.saveSettings({ weekHours: 30 });
    await st.punch();
    await idle(st);
    expect(db.s.outbox.has(SETTINGS_ID)).toBe(true);
    expect(db.s.outbox.size).toBe(1);
    expect(server.records.size).toBe(1);
    expect(st.syncFailed).toBe(false);
  });

  it('record and outbox item are written in one transaction', async () => {
    const db = fakeDb();
    db.put = async (st, v, k) => {
      if (st === 'outbox') throw new Error('crash between the two writes');
      db.s[st].set(st === 'kv' ? k : v.id, v);
    };
    const { st, server } = setup({ db });
    server.offline = true;
    const e = await st.punch();
    await idle(st);
    expect(db.s.records.has(e.id)).toBe(true);
    expect(db.s.outbox.has(e.id)).toBe(true);
  });

  it('settings wait for the first pull: a stale device does not overwrite newer settings', async () => {
    const a = setup();
    await a.st.saveSettings({ weekHours: 40 });
    await idle(a.st);
    const b = setup({ server: a.server });
    b.clock.now = a.clock.now + 1000;
    await b.st.load(); // no sync yet: b still has the defaults
    expect(b.st.settings.weekHours).toBe(42);
    await b.st.saveSettings({ nerd: true });
    await idle(b.st);
    expect(b.st.settings).toMatchObject({ weekHours: 40, nerd: true });
  });

  it('button label: «Punch in/out» by default, three choices, kept in the settings record, unknown values fall back', async () => {
    expect(DEFAULT_SETTINGS.button).toBe('inout');
    expect(buttonLabelKey(DEFAULT_SETTINGS.button)).toBe('punch_inout');
    // missing (2.3 records and older) or unknown → the new default
    for (const v of [undefined, null, '', 'PUNCH', 'nope', 1, {}]) expect(buttonLabelKey(v), String(v)).toBe('punch_inout');
    // stored values of the 2.4 drafts keep their meaning
    expect(buttonLabelKey('now')).toBe('punch_now');
    expect(buttonLabelKey('punch')).toBe('punch');
    expect(buttonLabel('inout')).toBe('inout');
    const a = setup();
    await a.st.sync();
    expect(buttonLabel(a.st.settings.button)).toBe('inout');
    await a.st.saveSettings({ button: 'now' });
    await idle(a.st);
    // another device (or a reload) reads it back from the encrypted settings record
    const b = setup({ server: a.server });
    b.clock.now = a.clock.now + 1000;
    await b.st.load();
    await b.st.sync();
    expect(b.st.settings.button).toBe('now');
    // a later change of another setting keeps it (the same merge an older client does: it spreads
    // the decrypted record, so a field it does not know survives its writes)
    await b.st.saveSettings({ weekHours: 38 });
    await idle(b.st);
    await a.st.sync();
    expect(a.st.settings).toMatchObject({ button: 'now', weekHours: 38 });
    await a.st.saveSettings({ button: 'punch' });
    await idle(a.st);
    expect(buttonLabelKey(a.st.settings.button)).toBe('punch');
  });

  it('punch animation setting: «random» by default, each by name, «off»; unknown → random; survives other writes', async () => {
    expect(DEFAULT_SETTINGS.fx).toBe('random');
    // the picker's order: «Off» first, «Random» (the default) second
    expect(FX_CHOICES).toEqual([
      'off',
      'random',
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
    // every value a 2.4 client could store is still valid (and keeps meaning the same animation)
    for (const v of ['random', 'tally', 'seal', 'card', 'clock', 'stamp', 'badge', 'finger', 'button', 'off']) expect(fxSetting(v), v).toBe(v);
    for (const v of [undefined, null, '', 'RANDOM', 'laser', 3]) expect(fxSetting(v), String(v)).toBe('random');
    for (const v of FX_CHOICES) expect(fxSetting(v)).toBe(v);
    const a = setup();
    await a.st.sync();
    await a.st.saveSettings({ fx: 'seal' });
    await idle(a.st);
    const b = setup({ server: a.server });
    b.clock.now = a.clock.now + 1000;
    await b.st.load();
    await b.st.sync();
    expect(b.st.settings.fx).toBe('seal');
    // an older client keeps the field it does not know: it writes back the spread decrypted record
    const old = { ...b.st.settings, weekHours: 30 };
    delete old.button;
    await b.st.saveSettings(old);
    await idle(b.st);
    await a.st.sync();
    expect(a.st.settings).toMatchObject({ fx: 'seal', weekHours: 30 });
  });

  it('highlight colour: orange by default and for anything unknown; syncs to another device; other writes keep it', async () => {
    expect(DEFAULT_SETTINGS.color).toBe('orange');
    expect(COLORS[0]).toBe('orange');
    expect(new Set(COLORS).size).toBe(COLORS.length);
    for (const c of COLORS) expect(colorSetting(c)).toBe(c);
    // a newer client's colour, a typo, a value of another type: orange
    for (const v of [undefined, null, '', 'ORANGE', 'magenta', '#ff0000', 3, {}]) expect(colorSetting(v), String(v)).toBe('orange');
    const a = setup();
    await a.st.sync();
    // a settings record written before the colour existed reads as orange
    expect(colorSetting(a.st.settings.color)).toBe('orange');
    await a.st.saveSettings({ color: 'teal' });
    await idle(a.st);
    const b = setup({ server: a.server });
    b.clock.now = a.clock.now + 1000;
    await b.st.load();
    await b.st.sync();
    expect(b.st.settings.color).toBe('teal');
    // an older client spreads the decrypted record, so the field it does not know survives its writes
    await b.st.saveSettings({ ...b.st.settings, weekHours: 31 });
    await idle(b.st);
    await a.st.sync();
    expect(a.st.settings).toMatchObject({ color: 'teal', weekHours: 31 });
  });

  it('random never plays the same animation twice in a row; a chosen one always plays; off plays nothing', () => {
    let prev = null;
    let seen = new Set();
    let r = 0;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280), r / 233280);
    for (let i = 0; i < 2000; i++) {
      const n = pickFx('random', prev, rnd);
      expect(FX_NAMES).toContain(n);
      expect(n).not.toBe(prev);
      seen.add(n);
      prev = n;
    }
    expect(seen.size).toBe(FX_NAMES.length);
    // also at the edges of random()
    for (const x of [0, 0.999999]) for (const p of FX_NAMES) expect(pickFx(undefined, p, () => x)).not.toBe(p);
    expect(pickFx('stamp', 'stamp')).toBe('stamp');
    expect(pickFx('off', null)).toBeNull();
  });

  it('a write the server refuses for good stays in a visible «not accepted» state; retry or discard', async () => {
    const { st, server } = setup();
    await st.sync();
    const kept = await st.punch();
    await idle(st);
    expect(server.records.has(kept.id)).toBe(true);
    // the account is full on the server: 413 too_many
    server.failPut = 413;
    server.failBody = { error: 'too_many' };
    const p = await st.punch(st.now() + 60_000);
    await idle(st);
    expect(st.rejected).toBe(1);
    expect(st.rejectedCode).toBe('too_many');
    expect(st.outbox).toBe(0);
    expect(st.unsynced).toBe(1);
    // never «Synced» while something was refused
    expect(syncStatus(st, true)).toEqual({ key: 'not_accepted', cls: 'warn', n: 1 });
    // not retried by itself
    const calls = server.putCalls;
    await st.sync({ force: true });
    expect(server.putCalls).toBe(calls);
    // retry once there is room again
    server.failPut = 0;
    await st.retryRejected();
    await idle(st);
    expect(st.rejected).toBe(0);
    expect(server.records.has(p.id)).toBe(true);
    expect(syncStatus(st, true).key).toBe('synced');
    // refused again, then discarded: local copy goes, the device shows what the server has
    server.failPut = 400;
    server.failBody = { error: 'data' };
    const q = await st.punch(st.now() + 120_000);
    await idle(st);
    expect(st.rejected).toBe(1);
    await st.discardRejected();
    await idle(st);
    expect(st.rejected).toBe(0);
    expect(st.entries.has(q.id)).toBe(false);
    expect(st.list().map((e) => e.id).sort()).toEqual([kept.id, p.id].sort());
  });

  it('two tabs: once another tab put a different account on the device, this Store writes nothing anywhere', async () => {
    let owner = 'me';
    const a = setup({ guard: async () => owner === 'me' });
    await a.st.sync();
    await a.st.punch();
    await idle(a.st);
    const seqBefore = a.db.s.kv.get('seq');
    let stale = 0;
    a.st.addEventListener('stale', () => stale++);
    // the other tab logs out and in as someone else (same IndexedDB, same cookie jar)
    owner = 'other';
    a.db.s.kv.set('seq', 777);
    const puts = a.server.putCalls;
    const gets = a.server.getCalls;
    await a.st.sync({ force: true });
    await expect(a.st.punch()).rejects.toThrow('stale');
    expect(stale).toBe(1);
    expect(a.st.stale).toBe(true);
    expect(a.server.putCalls).toBe(puts); // nothing sent with the new account's cookie
    expect(a.server.getCalls).toBe(gets);
    expect(a.db.s.kv.get('seq')).toBe(777); // the new account's sync state is untouched
    expect(seqBefore).not.toBe(777);
  });

  it('sync status texts in order of importance', () => {
    const base = { authLost: false, syncing: false, online: true, syncFailed: false, outbox: 0, rejected: 0 };
    expect(syncStatus(base, true).key).toBe('synced');
    expect(syncStatus({ ...base, outbox: 2 }, true)).toEqual({ key: 'waiting', cls: 'busy', n: 2 });
    expect(syncStatus({ ...base, outbox: 2 }, false)).toEqual({ key: 'offline_waiting', cls: 'warn', n: 2 });
    expect(syncStatus({ ...base, rejected: 1, syncFailed: true }, true).key).toBe('not_accepted');
    expect(syncStatus({ ...base, authLost: true, rejected: 1 }, true).key).toBe('logged_out');
  });

  it('account deleted elsewhere (410): the store reports «gone» and drops nothing itself; a 401 only means logged out', async () => {
    const { st, server } = setup();
    await st.sync();
    await st.punch();
    await idle(st);
    // logged out (expired, «log out all», passphrase changed elsewhere): local data stays, no «gone»
    let gone = 0;
    st.addEventListener('gone', () => gone++);
    server.fail = 401;
    server.offline = false;
    await st.punch(st.now() + 60_000);
    await st.sync();
    expect(st.authLost).toBe(true);
    expect(gone).toBe(0);
    expect(st.list()).toHaveLength(2);
    expect(st.outbox).toBe(1);
    // deleted: one «gone» event; the outbox item is not thrown away as «refused for good»
    server.fail = 410;
    server.failBody = { error: 'account_deleted' };
    await st.sync({ force: true });
    expect(gone).toBe(1);
    expect(st.accountGone).toBe(true);
    expect(st.outbox).toBe(1);
  });

  it('two quick settings changes both survive', async () => {
    const { st } = setup();
    await st.sync();
    await Promise.all([st.saveSettings({ weekHours: 80 }), st.saveSettings({ nerd: true })]);
    await idle(st);
    expect(st.settings).toMatchObject({ weekHours: 80, nerd: true });
  });

  it('moving a punch onto a day that already has 12 is refused', async () => {
    const { st, clock } = setup({ max: 1000 });
    for (let i = 0; i < MAX_PER_DAY; i++) await st.write(newId(), { ts: at(clock, 1, 6) + i * 60_000, tz: TZ, note: '', del: false });
    const other = await st.punch(clock.now);
    await expect(st.write(other.id, { ...other, ts: at(clock, 1, 20) })).rejects.toThrow('day_full');
    // moving within its own day stays possible
    await st.write(other.id, { ...other, ts: clock.now - 60_000 });
    await idle(st);
  });
});

describe('away notice after a long absence', () => {
  it('counts whole UTC days since the previous last-seen day; shown above 30 days', () => {
    const now = Date.UTC(2026, 10, 24, 15, 30);
    const day = (n) => Date.UTC(2026, 10, 24) - n * DAY;
    expect(awayDays(day(40), now)).toBe(40);
    expect(awayDays(day(0), now)).toBe(0);
    expect(awayDays(undefined, now)).toBeNull();
    expect(awayDays('x', now)).toBeNull();
    expect(AWAY_NOTICE_DAYS).toBe(30);
    expect(showAwayNotice(awayDays(day(30), now))).toBe(false);
    expect(showAwayNotice(awayDays(day(31), now))).toBe(true);
    expect(showAwayNotice(null)).toBe(false);
  });
});

describe('CSV cells', () => {
  it('formula-like cells are neutralised, separators quoted', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    for (const c of ['+1', '-1', '@a', '\tx']) expect(csvCell(c).replace(/^"/, '').startsWith("'")).toBe(true);
    expect(csvCell('Büro; spät')).toBe('"Büro; spät"');
    expect(csvCell('normal')).toBe('normal');
  });
});

describe('badge reminder', () => {
  it('off by default; the interval is whole days from 1 to 365, default 25 when switched on', () => {
    expect(DEFAULT_SETTINGS.badge).toBe(0);
    expect(BADGE_DAYS_DEFAULT).toBe(25);
    for (const [v, n] of [[0, 0], [undefined, 0], ['', 0], ['x', 0], [-3, 0], [1, 1], ['25', 25], [25.9, 25], [999, 365]]) expect(badgeDays(v), String(v)).toBe(n);
  });

  it('shows with the first punch of a day once the interval has passed, never when off', () => {
    const s = { badge: 25, badgeAt: '2026-11-01' };
    expect(badgeDue({ badge: 0, badgeAt: '2026-01-01' }, '2026-11-26', 1)).toBe(false);
    expect(badgeDue(s, '2026-11-25', 1)).toBe(false); // 24 days
    expect(badgeDue(s, '2026-11-26', 1)).toBe(true); // 25 days
    expect(badgeDue(s, '2026-11-26', 2)).toBe(false); // not the first punch
    expect(badgeDue(s, '2026-11-26', 0)).toBe(false);
  });

  it('a day without a punch is simply made up on the next day; after showing, the count starts again', () => {
    const s = { badge: 25, badgeAt: '2026-11-01' };
    expect(badgeDue(s, '2026-11-30', 1)).toBe(true); // nobody punched on the 26th–29th
    const shown = { ...s, badgeAt: '2026-11-30' };
    expect(badgeDue(shown, '2026-11-30', 1)).toBe(false); // e.g. the punch was deleted and made again
    expect(badgeDue(shown, '2026-12-24', 1)).toBe(false);
    expect(badgeDue(shown, '2026-12-25', 1)).toBe(true);
    expect(badgeNextDay(shown)).toBe('2026-12-25');
  });

  it('no date yet or a date in the future: due at once; month and year ends count as calendar days', () => {
    expect(badgeDue({ badge: 25 }, '2026-11-26', 1)).toBe(true);
    expect(badgeDue({ badge: 25, badgeAt: 'nonsense' }, '2026-11-26', 1)).toBe(true);
    expect(badgeDue({ badge: 25, badgeAt: '2027-03-01' }, '2026-11-26', 1)).toBe(true);
    expect(badgeNextDay({ badge: 25 })).toBeNull();
    expect(badgeNextDay({ badge: 0, badgeAt: '2026-11-01' })).toBeNull();
    expect(badgeNextDay({ badge: 25, badgeAt: '2026-12-20' })).toBe('2027-01-14');
    expect(badgeDue({ badge: 7, badgeAt: '2028-02-25' }, '2028-03-02', 1)).toBe(false); // leap year: 6 days
    expect(badgeDue({ badge: 7, badgeAt: '2028-02-25' }, '2028-03-03', 1)).toBe(true);
  });
});

describe('2.9.4 fixes (store)', () => {
  it('«send now» after the daily limit lifts the block on the device too: a reload does not block again', async () => {
    const { st, clock, server, db } = setup({ max: 0 });
    await st.punch(clock.now);
    await idle(st);
    expect(st.dailyLimited).toBe(true);
    server.max = 50; // e.g. the limit was raised
    await st.sync({ force: true });
    await idle(st);
    expect(st.outbox).toBe(0);
    expect(st.dailyLimited).toBe(false);
    const st2 = new Store(USER, KEY, { db, api: server.api, now: () => clock.now, tz: () => TZ });
    await st2.load();
    expect(st2.dailyLimited).toBe(false);
    // the next punch after the reload is sent at once
    const p = await st2.punch(clock.now + 60_000);
    await idle(st2);
    expect(server.records.has(p.id)).toBe(true);
  });

  it('«send now» while offline: the lifted block is kept on the device as well', async () => {
    const { st, clock, server, db } = setup({ max: 0 });
    await st.punch(clock.now);
    await idle(st);
    server.offline = true;
    await st.sync({ force: true });
    await idle(st);
    const st2 = new Store(USER, KEY, { db, api: server.api, now: () => clock.now, tz: () => TZ });
    await st2.load();
    expect(st2.dailyLimited).toBe(false);
  });

  it('a stamp the server accepts clears a block left in the local data', async () => {
    const { st, clock, server, db } = setup();
    await db.kvSet('dailyBlocked', Math.floor(clock.now / DAY) * DAY - DAY); // yesterday's
    await st.load();
    await st.punch(clock.now);
    await idle(st);
    expect(server.records.size).toBe(1);
    expect(db.s.kv.get('dailyBlocked')).toBe(0);
  });

  for (const how of ['offline', '401', '503']) {
    it(`a settings change while the first sync failed (${how}) keeps the other device's newer settings`, async () => {
      const a = setup();
      await a.st.sync();
      await a.st.saveSettings({ weekHours: 40, button: 'now' });
      await idle(a.st);
      const b = setup({ server: a.server });
      b.clock.now = a.clock.now + 1000;
      await b.st.load(); // this device has never seen the change above
      if (how === 'offline') a.server.offline = true;
      else a.server.fail = Number(how);
      // e.g. the badge reminder noting its day, or a switch the user flips
      await b.st.saveSettings({ badgeAt: '2026-11-24' });
      await b.st.saveSettings({ nerd: true });
      expect(b.st.settings).toMatchObject({ badgeAt: '2026-11-24', nerd: true });
      a.server.offline = false;
      a.server.fail = 0;
      await b.st.sync();
      await idle(b.st);
      expect(b.st.settings).toMatchObject({ weekHours: 40, button: 'now', badgeAt: '2026-11-24', nerd: true });
      await a.st.sync();
      await idle(a.st);
      expect(a.st.settings).toMatchObject({ weekHours: 40, button: 'now', badgeAt: '2026-11-24', nerd: true });
    });
  }

  it('a settings change before the first pull wins over an older value of the same field', async () => {
    const a = setup();
    await a.st.sync();
    await a.st.saveSettings({ weekHours: 40 });
    await idle(a.st);
    const b = setup({ server: a.server });
    b.clock.now = a.clock.now + 1000;
    await b.st.load();
    a.server.offline = true;
    await b.st.saveSettings({ weekHours: 30 });
    a.server.offline = false;
    await b.st.sync();
    await idle(b.st);
    await a.st.sync();
    expect(a.st.settings.weekHours).toBe(30);
    expect(b.st.settings.weekHours).toBe(30);
  });

  it('awaiting sync() during a running sync resolves only once a record written meanwhile is sent', async () => {
    const { st, clock, server } = setup();
    await st.sync();
    /** @type {() => void} */
    let release = () => {};
    const gate = new Promise((r) => (release = () => r(undefined)));
    server.onPut = async () => {
      server.onPut = null;
      await gate;
    };
    const first = await st.punch(clock.now - 120_000); // its sync now hangs in the put
    await new Promise((r) => setTimeout(r, 10));
    expect(st.syncing).toBe(true);
    const second = await st.punch(clock.now - 60_000); // written while that sync is sending
    const done = st.sync({ force: true });
    release();
    await done;
    expect(server.records.has(first.id)).toBe(true);
    expect(server.records.has(second.id)).toBe(true);
    expect(st.outbox).toBe(0);
  });

  it('two tabs on one device: a newer change waiting from the other tab is not dropped for an older remote one', async () => {
    const clock = { now: zonedToEpoch(2026, 11, 24, 12, 0, TZ) };
    const server = new FakeServer(clock);
    const db = fakeDb();
    const mk = (d) => new Store(USER, KEY, { db: d, api: server.api, now: () => clock.now, tz: () => TZ });
    const tabA = mk(db);
    await tabA.sync();
    const e = await tabA.punch(clock.now - 3600_000);
    await idle(tabA);
    const tabB = mk(db);
    await tabB.load();
    await tabB.sync();
    const other = mk(fakeDb()); // another device
    await other.sync();
    clock.now += 1000;
    await other.write(e.id, { ...other.entries.get(e.id), note: 'other device' });
    await idle(other);
    server.offline = true;
    clock.now += 1000;
    await tabB.write(e.id, { ...tabB.entries.get(e.id), note: 'tab B' }); // newest, waits in the shared outbox
    await idle(tabB);
    server.offline = false;
    await tabA.sync(); // tab A still holds the first version in its memory
    await idle(tabA);
    const plain = await decryptRecord(KEY, USER, e.id, server.records.get(e.id).data);
    expect(plain.note).toBe('tab B');
    expect(db.s.outbox.size).toBe(0);
  });

  it('night shifts expire as a whole: the «in» before midnight and the «out» after it go together', async () => {
    const { st, clock } = setup({ max: 1000 });
    await st.sync();
    await st.saveSettings({ dayStart: 6 * 60 });
    const inId = newId();
    const outId = newId();
    await st.write(inId, { ts: zonedToEpoch(2026, 1, 10, 22, 0, TZ), tz: TZ, note: '', del: false });
    await st.write(outId, { ts: zonedToEpoch(2026, 1, 11, 5, 0, TZ), tz: TZ, note: '', del: false });
    await idle(st);
    // the day the «in» reaches the 396 days (the server deletes it now, by its write time)
    clock.now = zonedToEpoch(2027, 2, 10, 12, 0, TZ);
    expect(oldestDay(clock.now, TZ)).toBe('2026-01-11');
    await st.sync();
    await idle(st);
    expect(st.entries.has(inId)).toBe(false);
    expect(st.entries.has(outId)).toBe(false); // not left alone as an «open day»
    // the day before, both were still there
    expect(isExpired({ ts: zonedToEpoch(2026, 1, 11, 5, 0, TZ) }, zonedToEpoch(2027, 2, 9, 12, 0, TZ), TZ, 360)).toBe(false);
    // a punch after the day change on the oldest kept date stays
    expect(isExpired({ ts: zonedToEpoch(2026, 1, 11, 7, 0, TZ) }, clock.now, TZ, 360)).toBe(false);
    expect(isExpired({ ts: zonedToEpoch(2026, 1, 11, 5, 0, TZ) }, clock.now, TZ, 360)).toBe(true);
    expect(isExpired({ ts: zonedToEpoch(2026, 1, 11, 5, 0, TZ) }, clock.now, TZ, 0)).toBe(false);
  });

  it('the nerd outbox detail has no «due» count any more', () => {
    const st = new Store(USER, KEY, { db: fakeDb(), api: new FakeServer({ now: 0 }).api });
    expect('outboxDue' in st).toBe(false);
  });
});

describe('deleting the account needs the passphrase (2.9.4)', () => {
  const keys = (u, p) => passphraseKeys(u, p, 1000);

  it('sends the same auth value as the login; a wrong passphrase is refused with wrong_auth', async () => {
    const { server } = setup();
    server.auth = (await keys(USER, 'eine-lange-passphrase')).auth;
    await expect(deleteAccountWith({ api: server.api, keys }, USER, 'falsch')).rejects.toMatchObject({ status: 400, body: { error: 'wrong_auth' } });
    expect(server.accountDeleted).toBe(false);
    expect(isWrongAuth(await deleteAccountWith({ api: server.api, keys }, USER, 'falsch').catch((e) => e))).toBe(true);
    await deleteAccountWith({ api: server.api, keys }, USER, 'eine-lange-passphrase');
    expect(server.accountDeleted).toBe(true);
  });

});

describe('two tabs on one device: refreshFromDb', () => {
  /** Two Stores on the same local database (two tabs), each with its own memory. */
  function twoTabs(o = {}) {
    const a = setup(o);
    const b = new Store(USER, KEY, { db: a.db, api: a.server.api, now: () => a.clock.now, tz: () => TZ, guard: o.guardB });
    return { ...a, a: a.st, b };
  }
  /** Counts the events of one type a Store emits. */
  const count = (st, type) => {
    const n = { v: 0 };
    st.addEventListener(type, () => n.v++);
    return n;
  };

  it('a punch, an absence and a settings change of tab A show up in tab B without any sync', async () => {
    const { a, b, server, clock } = twoTabs();
    server.offline = true; // no sync can carry anything
    await b.load();
    const announced = count(a, 'records');
    const p = await a.punch(clock.now - 3600_000);
    expect(announced.v).toBe(1); // right after the local write
    const abs = await a.addAbsence({ day: '2026-11-25', type: 'vacation' });
    await a.saveSettings({ weekHours: 40 });
    await idle(a);
    const gets = server.getCalls;
    const changes = count(b, 'change');
    const bAnnounced = count(b, 'records');
    expect(b.list()).toEqual([]);
    expect(await b.refreshFromDb()).toBe(true);
    expect(b.list().map((e) => e.id)).toEqual([p.id]);
    expect(b.absences().map((e) => e.id)).toEqual([abs.id]);
    expect(b.settings.weekHours).toBe(40);
    expect(b.outbox).toBe(a.outbox);
    expect(changes.v).toBe(1);
    expect(bAnnounced.v).toBe(0); // receiving never announces again (no loop between tabs)
    expect(server.getCalls).toBe(gets);
  });

  it('a refresh with nothing new emits nothing', async () => {
    const { a, b, clock } = twoTabs();
    await a.sync();
    await a.punch(clock.now - 3600_000);
    await idle(a);
    await b.load();
    const changes = count(b, 'change');
    expect(await b.refreshFromDb()).toBe(false);
    expect(await b.refreshFromDb()).toBe(false);
    expect(changes.v).toBe(0);
  });

  it("the receiving tab's own waiting write is neither overwritten nor dropped", async () => {
    const { a, b, server, db, clock } = twoTabs();
    await a.sync();
    const p = await a.punch(clock.now - 3600_000);
    await idle(a);
    await b.load();
    server.offline = true;
    await b.write(p.id, { ...b.entries.get(p.id), note: 'tab B' });
    await idle(b);
    expect(db.s.outbox.get(p.id).data).toBe(b.raw.get(p.id));
    // another version of that record lands in the local database while B's write still waits
    const { id: _id, ...plain } = a.entries.get(p.id);
    const other = await encryptRecord(KEY, USER, p.id, { ...plain, note: 'elsewhere', mod: plain.mod + 1 });
    db.s.records.set(p.id, { id: p.id, data: other });
    expect(await b.refreshFromDb()).toBe(false);
    expect(b.entries.get(p.id).note).toBe('tab B');
    db.s.records.delete(p.id);
    expect(await b.refreshFromDb()).toBe(false);
    expect(b.entries.get(p.id).note).toBe('tab B');
  });

  it('a record another tab removed from the database (retention, discard) goes here too', async () => {
    const { a, b, db, clock } = twoTabs();
    await a.sync();
    const p = await a.punch(clock.now - 3600_000);
    const q = await a.punch(clock.now - 1800_000);
    await idle(a);
    await b.load();
    db.s.records.delete(q.id); // as tab A's purge does, with a hard delete waiting
    db.s.outbox.set(q.id, { id: q.id, op: 'delete', notBefore: 0 });
    expect(await b.refreshFromDb()).toBe(true);
    expect(b.list().map((e) => e.id)).toEqual([p.id]);
  });

  it('a tab whose account is no longer the one on the device reads nothing', async () => {
    let owner = 'me';
    const { a, b, clock, server } = twoTabs({ guardB: async () => owner === 'me' });
    server.offline = true;
    await b.load();
    owner = 'other';
    await a.punch(clock.now - 3600_000);
    await idle(a);
    const stale = count(b, 'stale');
    expect(await b.refreshFromDb()).toBe(false);
    expect(b.list()).toEqual([]);
    expect(stale.v).toBe(1);
  });

  it("'records' is emitted after a pull that brought something, not after a sync that changed nothing", async () => {
    const { a, server, clock } = twoTabs();
    await a.sync();
    await idle(a);
    const announced = count(a, 'records');
    await a.sync();
    await idle(a);
    expect(announced.v).toBe(0);
    const elsewhere = setup({ server });
    elsewhere.clock.now = clock.now;
    await elsewhere.st.punch(clock.now - 3600_000);
    await idle(elsewhere.st);
    await a.sync();
    await idle(a);
    expect(announced.v).toBe(1);
  });
});
