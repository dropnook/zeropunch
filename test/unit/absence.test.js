// Absences (time.js, store.js, listview.js) and the week/month sheets (time.js periodSheet, sheet.js).
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  buildDays,
  zonedToEpoch,
  balance,
  weeklyHours,
  monthlyHours,
  groupWeeks,
  absenceCredit,
  creditByDay,
  withAbsences,
  absenceDays,
  absenceType,
  isDayKey,
  weekRange,
  monthRange,
  periodSheet,
  directions,
  currentState,
  dayView,
} from '../../public/js/time.js';
import { Store, MAX_PER_DAY, isAbsence, DEFAULT_SETTINGS, ABSENCE_AHEAD_DAYS } from '../../public/js/store.js';
import { absenceRows, absenceLabel, deleteAbsence } from '../../public/js/listview.js';
import { periodOptions, pairsText, sheetHeading } from '../../public/js/sheet.js';
import { setLang, t } from '../../public/js/i18n.js';
import { ApiError, OfflineError } from '../../public/js/api.js';
import { createAccount, decryptRecord, newId, SETTINGS_ID } from '../../public/js/crypto.js';

const TZ = 'Europe/Zurich';
const H = 3600_000;
const DAY = 86_400_000;
const at = (y, m, d, h, mi = 0) => zonedToEpoch(y, m, d, h, mi, TZ);
let n = 0;
const p = (ts) => ({ id: `p${String(++n).padStart(4, '0')}`, ts, tz: TZ, note: '', del: false, mod: 1 });
const abs = (day, extra = {}) => ({ id: `a-${day}-${++n}`, kind: 'absence', day, type: 'vacation', half: false, note: '', ...extra });

afterEach(() => setLang('en'));

describe('absence credit (time.js)', () => {
  it('a whole weekday = weekly target / 5, a half day half of it, a weekend nothing', () => {
    expect(absenceCredit({ day: '2026-11-23' }, 42)).toBe(8.4 * H); // Monday
    expect(absenceCredit({ day: '2026-11-27', half: true }, 42)).toBe(4.2 * H); // Friday, half
    expect(absenceCredit({ day: '2026-11-28' }, 42)).toBe(0); // Saturday
    expect(absenceCredit({ day: '2026-11-29', half: true }, 42)).toBe(0); // Sunday
    expect(absenceCredit({ day: '2026-11-23' }, 0)).toBe(0);
    expect(absenceCredit({ day: 'nonsense' }, 42)).toBe(0);
  });

  it('two absences on one day (two devices at once) never credit more than the larger one', () => {
    const c = creditByDay([abs('2026-11-23', { half: true }), abs('2026-11-23'), abs('2026-11-24', { half: true })], 40);
    expect(c.get('2026-11-23')).toBe(8 * H);
    expect(c.get('2026-11-24')).toBe(4 * H);
  });

  it('types: the five kinds, anything else is «other»; day keys are checked', () => {
    expect(['vacation', 'sick', 'holiday', 'comp', 'other', 'x', undefined].map(absenceType)).toEqual(['vacation', 'sick', 'holiday', 'comp', 'other', 'other', 'other']);
    // time off in lieu credits nothing (the balance pays for it), whole or half
    expect(absenceCredit({ day: '2026-11-23', type: 'comp' }, 42)).toBe(0);
    expect(absenceCredit({ day: '2026-11-23', type: 'comp', half: true }, 42)).toBe(0);
    expect(absenceCredit({ day: '2026-11-23', type: 'vacation' }, 42)).toBe(8.4 * 3_600_000);
    expect(isDayKey('2026-11-23')).toBe(true);
    expect(isDayKey('2026-02-30')).toBe(false);
    expect(isDayKey('2026-1-3')).toBe(false);
    expect(isDayKey(20261123)).toBe(false);
  });

  it('a from–until range: one day per weekday, the weekend left out; a single day as it is', () => {
    expect(absenceDays('2026-11-26', '2026-12-01')).toEqual(['2026-11-26', '2026-11-27', '2026-11-30', '2026-12-01']);
    expect(absenceDays('2026-11-28', '')).toEqual(['2026-11-28']); // a single Saturday stays (a holiday on a weekend: credits nothing)
    expect(absenceDays('2026-11-28', '2026-11-28')).toEqual(['2026-11-28']);
    expect(absenceDays('2026-11-28', '2026-11-29')).toEqual([]);
  });
});

describe('balance with absences', () => {
  const now = at(2026, 11, 27, 20); // Friday evening
  // Mon 8 h, Tue vacation (whole), Wed half sick + 4 h work, Thu public holiday + 2 h work, Fri 8 h.
  const punches = [
    p(at(2026, 11, 23, 8)), p(at(2026, 11, 23, 16)),
    p(at(2026, 11, 25, 8)), p(at(2026, 11, 25, 12)),
    p(at(2026, 11, 26, 9)), p(at(2026, 11, 26, 11)),
    p(at(2026, 11, 27, 8)), p(at(2026, 11, 27, 16)),
  ];
  const absences = [abs('2026-11-24'), abs('2026-11-25', { type: 'sick', half: true }), abs('2026-11-26', { type: 'holiday' }), abs('2026-11-28', { type: 'holiday' })];
  const days = buildDays(punches, now, 0, TZ);
  const credits = creditByDay(absences, 40);

  it('whole, half and weekend: worked + credit − target', () => {
    const b = balance(days, 40, '2026-11-23', '2026-11-27', credits);
    expect(b.worked).toBe(22 * H);
    expect(b.credit).toBe((8 + 4 + 8 + 0) * H); // the Saturday holiday counts nothing
    expect(b.target).toBe(5 * 8 * H);
    expect(b.diff).toBe(2 * H); // 22 + 20 − 40: the holiday plus 2 h of work is overtime
  });

  it('without credits, as before (the nerd mode of a day without absences is unchanged)', () => {
    const b = balance(days, 40, '2026-11-23', '2026-11-27');
    expect(b).toMatchObject({ worked: 22 * H, credit: 0, target: 40 * H, diff: -18 * H });
  });

  it('a period starting with an absence (no punch yet) counts from the absence', () => {
    const b = balance(buildDays([p(at(2026, 11, 26, 8)), p(at(2026, 11, 26, 16))], now, 0, TZ), 40, '2026-11-01', '2026-11-27', creditByDay([abs('2026-11-25')], 40));
    expect(b.from).toBe('2026-11-25');
    expect(b).toMatchObject({ worked: 8 * H, credit: 8 * H, target: 3 * 8 * H, diff: -8 * H });
  });

  it('a planned absence after today counts nothing yet', () => {
    const b = balance(days, 40, '2026-11-23', '2026-11-27', creditByDay([abs('2026-11-30')], 40));
    expect(b.credit).toBe(0);
    expect(weeklyHours(days, '2026-11-27', 2, creditByDay([abs('2026-11-30')], 40)).map((w) => w.credit)).toEqual([0, 0]);
  });

  it('week and month totals carry the credit', () => {
    const w = weeklyHours(days, '2026-11-27', 2, credits);
    expect(w[1]).toMatchObject({ sum: 22 * H, credit: 20 * H });
    const m = monthlyHours(days, '2026-11-27', 1, 40, credits);
    expect(m[0]).toMatchObject({ month: '2026-11', sum: 22 * H, credit: 20 * H });
  });

  it('the list: absence days join the punch days, an absence-only day is an empty day; the week sums the credit', () => {
    const list = withAbsences(days, absences, 40);
    expect(list.map((d) => d.day)).toEqual(['2026-11-28', '2026-11-27', '2026-11-26', '2026-11-25', '2026-11-24', '2026-11-23']);
    const tue = list.find((d) => d.day === '2026-11-24');
    expect(tue).toMatchObject({ punches: [], pairs: [], sum: 0, credit: 8 * H });
    expect(list.find((d) => d.day === '2026-11-25')).toMatchObject({ sum: 4 * H, credit: 4 * H });
    expect(list.find((d) => d.day === '2026-11-25').punches).toHaveLength(2);
    const [week] = groupWeeks(list);
    expect(week.sum).toBe(22 * H);
    expect(week.credit).toBe(20 * H);
  });

  it('pairing, directions, the day view and the start state never see an absence', () => {
    // Even if one slipped into the punch list: absences are always written with del: true.
    const recs = [...punches, ...absences.map((a) => ({ ...a, ts: at(2026, 11, 24, 12), tz: TZ, del: true }))];
    expect(buildDays(recs, now, 0, TZ).map((d) => d.day)).toEqual(buildDays(punches, now, 0, TZ).map((d) => d.day));
    expect(directions(recs).size).toBe(punches.length);
    const sat = at(2026, 11, 28, 15);
    const v = dayView(recs, sat, { day: '2026-11-24', oldest: '2025-11-01', tz: TZ });
    expect(v).toMatchObject({ day: '2026-11-24', punches: [], sum: 0 });
    expect(currentState(recs, sat, TZ).punchesToday).toBe(0);
  });
});

describe('week and month sheets', () => {
  const now = at(2026, 11, 25, 12); // Wednesday
  const punches = [p(at(2026, 11, 23, 8)), p(at(2026, 11, 23, 12, 30)), p(at(2026, 11, 23, 13)), p(at(2026, 11, 23, 17)), p(at(2026, 11, 25, 7, 45))];
  const days = withAbsences(buildDays(punches, now, 0, TZ), [abs('2026-11-24', { half: true }), abs('2026-11-27')], 40);

  it('ranges: ISO week Monday–Sunday, calendar month', () => {
    expect(weekRange('2026-11-25')).toEqual({ from: '2026-11-23', to: '2026-11-29' });
    expect(weekRange('2027-01-01')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
    expect(monthRange('2026-02-14')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02-29')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('one row per day; totals up to and including today for a week that is not over', () => {
    const s = periodSheet(days, '2026-11-23', '2026-11-29', '2026-11-25', 40);
    expect(s.rows.map((r) => r.day)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
    expect(s.rows[0]).toMatchObject({ wd: 0, worked: 8.5 * H, credit: 0 });
    expect(pairsText(s.rows[0].pairs)).toBe('08:00–12:30, 13:00–17:00');
    expect(s.rows[1]).toMatchObject({ worked: 0, credit: 4 * H });
    expect(s.rows[1].absences).toHaveLength(1);
    expect(pairsText(s.rows[2].pairs)).toBe('07:45–…');
    expect(s.rows[4].credit).toBe(8 * H); // planned, shown in its row …
    // … but the totals stop at today: Mon–Wed (Wednesday's punch runs until now, 12:00)
    expect(s.totals).toMatchObject({ worked: 12.75 * H, credit: 4 * H, target: 24 * H, diff: -7.25 * H, end: '2026-11-25', partial: true });
  });

  it('a past period counts in full; a future one counts nothing', () => {
    const past = periodSheet(days, '2026-11-01', '2026-11-30', '2026-12-15', 40);
    expect(past.rows).toHaveLength(30);
    expect(past.totals).toMatchObject({ worked: 12.75 * H, credit: 12 * H, target: 21 * 8 * H, partial: false, end: '2026-11-30' });
    const future = periodSheet(days, '2026-12-07', '2026-12-13', '2026-11-25', 40);
    expect(future.totals).toMatchObject({ worked: 0, credit: 0, target: 0, diff: 0 });
  });

  it('night shifts: the sheet follows the logical day, as the list does', () => {
    const night = [p(at(2026, 11, 23, 22)), p(at(2026, 11, 24, 3))];
    const d = withAbsences(buildDays(night, now, 240, TZ), [], 40);
    const s = periodSheet(d, '2026-11-23', '2026-11-29', '2026-11-25', 40);
    expect(s.rows[0].worked).toBe(5 * H);
    expect(pairsText(s.rows[0].pairs)).toBe('22:00–03:00');
    expect(s.rows[1].worked).toBe(0);
  });

  it('the periods to choose from reach back to the retention bound, newest first, in both languages', () => {
    setLang('en');
    const weeks = periodOptions('week', '2026-11-25', '2025-10-25');
    expect(weeks[0]).toMatchObject({ from: '2026-11-23', to: '2026-11-29' });
    expect(weeks[0].label).toMatch(/^W48 · /);
    expect(weeks[weeks.length - 1].to >= '2025-10-25').toBe(true);
    expect(weeks[weeks.length - 1].from <= '2025-10-25').toBe(true);
    expect(weeks).toHaveLength(58); // 23 Nov 2026 back to the week of 25 Oct 2025
    const months = periodOptions('month', '2026-11-25', '2025-10-25');
    expect(months.map((m) => m.from)).toHaveLength(14);
    expect(months[0].label).toBe('November 2026');
    expect(months[13].from).toBe('2025-10-01');
    expect(sheetHeading('week', '2026-11-23')).toBe('Week sheet · W48 2026');
    setLang('de');
    expect(periodOptions('week', '2026-11-25', '2026-11-01')[0].label).toMatch(/^KW 48 · /);
    expect(sheetHeading('month', '2026-11-01')).toBe('Monatsblatt · November 2026');
  });
});

describe('list rows of an absence', () => {
  it('label with «half day», the credited time and one delete control (EN and DE)', () => {
    setLang('en');
    const d = withAbsences([], [abs('2026-11-24', { type: 'sick', half: true, note: 'Arzt' })], 42)[0];
    const [r] = absenceRows(d, 42);
    expect(r).toMatchObject({ label: 'Sick · half day', credit: 4.2 * H, note: 'Arzt' });
    expect(r.controls).toEqual([{ kind: 'delete', aria: 'Delete Sick · half day' }]);
    setLang('de');
    expect(absenceLabel({ type: 'holiday' })).toBe('Feiertag');
    expect(absenceRows(d, 42)[0].controls[0].aria).toBe('Krank · halber Tag löschen');
  });

  it('delete asks first, naming day and kind', async () => {
    setLang('en');
    const log = { removed: [], confirm: [], toasts: [] };
    const store = { remove: async (id) => void log.removed.push(id) };
    const ui = (answer) => ({ confirm: async (title, text) => (log.confirm.push({ title, text }), answer), toast: (m) => log.toasts.push(m), message: () => 'error' });
    const a = abs('2026-11-24');
    expect(await deleteAbsence(store, a, 'Tue 24 Nov', ui(false))).toBe(false);
    expect(log.removed).toEqual([]);
    expect(await deleteAbsence(store, a, 'Tue 24 Nov', ui(true))).toBe(true);
    expect(log.removed).toEqual([a.id]);
    expect(log.confirm[0]).toEqual({ title: 'Delete absence?', text: 'Vacation on Tue 24 Nov will be deleted.' });
    expect(log.toasts).toEqual(['Deleted: Vacation, Tue 24 Nov']);
  });
});

// ------------------------------------------------------------ store

const USER = 'absence.test';
let KEY;
beforeAll(async () => {
  KEY = (await createAccount(USER, 'eine-lange-passphrase', { iterations: 1000 })).key;
});

function fakeDb() {
  const s = { kv: new Map(), records: new Map(), outbox: new Map() };
  const put = (st, v, k) => void s[st].set(st === 'kv' ? k : v.id, v);
  return {
    s,
    get: async (st, k) => s[st].get(k),
    put: async (st, v, k) => put(st, v, k),
    del: async (st, k) => void s[st].delete(k),
    all: async (st) => [...s[st].values()],
    kvGet: async (k) => s.kv.get(k),
    kvSet: async (k, v) => void s.kv.set(k, v),
  };
}

function fakeServer(clock) {
  const records = new Map();
  let seq = 0;
  const deleted = [];
  return {
    records,
    deleted,
    api: {
      ApiError,
      OfflineError,
      async putRecord(id, data) {
        records.set(id, { data, seq: ++seq });
        return { ok: true, seq };
      },
      async deleteRecord(id) {
        deleted.push(id);
        records.delete(id);
        return { ok: true };
      },
      async getRecords(since) {
        const all = [...records].map(([id, r]) => ({ id, ...r })).filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
        return { records: all, seq: Math.max(since, seq), more: false, now: clock.now };
      },
    },
  };
}

async function idle(st) {
  for (let i = 0; i < 500; i++) {
    await new Promise((r) => setTimeout(r, 2));
    if (!st.syncing && !st.again) return;
  }
  throw new Error('store never became idle');
}

function device(clock, server) {
  return new Store(USER, KEY, { db: fakeDb(), api: server.api, now: () => clock.now, tz: () => TZ });
}

describe('absences in the store', () => {
  it('an own record kind: synced to another device, kept apart from the punches, deleted with a tombstone', async () => {
    const clock = { now: at(2026, 11, 24, 12) };
    const server = fakeServer(clock);
    const a = device(clock, server);
    await a.sync();
    await a.punch();
    const v = await a.addAbsence({ day: '2026-11-20', type: 'holiday', half: false, note: 'Brückentag' });
    await idle(a);
    expect(a.list()).toHaveLength(1);
    expect(a.absences().map((x) => x.id)).toEqual([v.id]);
    // the record has the one fixed size and holds no punch for anyone who reads it
    const rec = server.records.get(v.id).data;
    expect(rec).toHaveLength(379);
    const plain = await decryptRecord(KEY, USER, v.id, rec);
    expect(plain).toMatchObject({ kind: 'absence', day: '2026-11-20', type: 'holiday', half: false, del: true, gone: false });
    expect(isAbsence(plain)).toBe(true);

    const b = device(clock, server);
    await b.sync();
    expect(b.absences()).toHaveLength(1);
    expect(b.absences()[0]).toMatchObject({ day: '2026-11-20', note: 'Brückentag' });
    expect(b.list()).toHaveLength(1);
    expect(b.countDay('2026-11-20')).toBe(0);

    await b.remove(v.id);
    await idle(b);
    await a.sync();
    expect(a.absences()).toEqual([]);
    expect(a.entries.get(v.id)).toMatchObject({ gone: true, del: true, note: '' });
  });

  it('what a 2.7.0 client sees: a tombstone (never listed, paired, counted or rewritten), expiring on the same day', async () => {
    const clock = { now: at(2026, 11, 24, 12) };
    const server = fakeServer(clock);
    const a = device(clock, server);
    await a.sync();
    const v = await a.addAbsence({ day: '2026-11-23', type: 'vacation' });
    await idle(a);
    const plain = await decryptRecord(KEY, USER, v.id, server.records.get(v.id).data);
    // 2.7.0: list() = entries without del; countDay and buildDays skip del; expiry by ts.
    const old = [{ ...plain, id: v.id }];
    expect(old.filter((e) => !e.del)).toEqual([]);
    expect(buildDays(old, clock.now, 0, TZ)).toEqual([]);
    expect(new Date(plain.ts).toISOString()).toBe('2026-11-23T11:00:00.000Z'); // noon of that day, Zurich
  });

  it('every record stays one fixed-size packet: the longest notes in letters fit, a note of emoji that would not is refused before anything is written', async () => {
    const clock = { now: at(2026, 11, 24, 20) };
    const server = fakeServer(clock);
    const st = device(clock, server);
    await st.sync();
    // the form's limits: 60 characters for an absence, 120 for a punch; in plain letters both fit
    const abs = await st.addAbsence({ day: '2026-11-23', type: 'vacation', note: 'x'.repeat(60) });
    await st.write(newId(), { ts: at(2026, 11, 24, 7), tz: 'America/Argentina/ComodRivadavia', note: 'x'.repeat(120), del: false });
    await idle(st);
    // every packet on the server has the same length
    const lens = new Set([...server.records.values()].map((r) => r.data.length));
    expect(lens.size).toBe(1);
    // 60 emoji (4 bytes each in UTF-8) would not fit: refused, nothing written, the old record stays
    const before = server.records.size;
    await expect(st.addAbsence({ day: '2026-11-20', type: 'vacation', note: '🏖️'.repeat(30) })).rejects.toThrow('too_long');
    await expect(st.write(newId(), { ts: at(2026, 11, 24, 8), tz: TZ, note: '😀'.repeat(60), del: false })).rejects.toThrow('too_long');
    await idle(st);
    expect(server.records.size).toBe(before);
    expect(st.absences().map((a) => a.id)).toEqual([abs.id]);
  });

  it('one absence per day; an absence takes one of the day\'s 12 places', async () => {
    const clock = { now: at(2026, 11, 24, 20) };
    const server = fakeServer(clock);
    const st = device(clock, server);
    await st.sync();
    await st.addAbsence({ day: '2026-11-24', type: 'sick', half: true });
    await expect(st.addAbsence({ day: '2026-11-24', type: 'vacation' })).rejects.toThrow('absence_exists');
    for (let i = 0; i < MAX_PER_DAY - 1; i++) await st.write(newId(), { ts: at(2026, 11, 24, 6) + i * 60_000, tz: TZ, note: '', del: false });
    expect(st.todayFull()).toBe(true);
    await expect(st.punch()).rejects.toThrow('day_full_abs');
    expect(st.countDay('2026-11-24')).toBe(MAX_PER_DAY - 1);
    // a day with 12 punches has no room for an absence
    for (let i = 0; i < MAX_PER_DAY; i++) await st.write(newId(), { ts: at(2026, 11, 23, 6) + i * 60_000, tz: TZ, note: '', del: false });
    await expect(st.addAbsence({ day: '2026-11-23', type: 'vacation' })).rejects.toThrow('no_room');
    // deleting the absence frees its place
    const [own] = st.absencesOn('2026-11-24');
    await st.remove(own.id);
    expect(st.todayFull()).toBe(false);
    await st.punch();
    await idle(st);
  });

  it('13 months, like a punch: an old absence is refused, an expired one goes on the next sync', async () => {
    const clock = { now: at(2026, 11, 24, 12) };
    const server = fakeServer(clock);
    const st = device(clock, server);
    await st.sync();
    await expect(st.addAbsence({ day: '2025-10-24', type: 'vacation' })).rejects.toThrow('too_old');
    const v = await st.addAbsence({ day: '2025-10-25', type: 'vacation' });
    await idle(st);
    clock.now += DAY;
    await st.sync();
    await idle(st);
    expect(st.entries.has(v.id)).toBe(false);
    expect(server.deleted).toContain(v.id);
  });

  it('settings stay apart: the settings record is no absence', async () => {
    const clock = { now: at(2026, 11, 24, 12) };
    const st = device(clock, fakeServer(clock));
    await st.sync();
    await st.saveSettings({ weekHours: 40 });
    expect(st.absences()).toEqual([]);
    expect(st.entries.has(SETTINGS_ID)).toBe(false);
    expect(DEFAULT_SETTINGS.kind).toBe('settings');
  });
});

describe('absences ahead (2.9.4)', () => {
  it('at most 31 days ahead (the server deletes a record 396 days after it was written)', async () => {
    expect(ABSENCE_AHEAD_DAYS).toBe(31);
    const clock = { now: at(2026, 11, 24, 12) };
    const st = device(clock, fakeServer(clock));
    await st.sync();
    await st.addAbsence({ day: '2026-12-25', type: 'vacation' });
    await expect(st.addAbsence({ day: '2026-12-26', type: 'vacation' })).rejects.toThrow('too_far');
    // an absence already further ahead (made before 2.9.4) can still be changed and deleted
    const id = newId();
    const far = { kind: 'absence', day: '2027-06-01', type: 'vacation', half: false, note: '', ts: at(2027, 6, 1, 12), tz: TZ, del: true, gone: false, v: 1, mod: 1 };
    st.entries.set(id, { ...far, id });
    await st.write(id, { ...far, note: 'Reise' });
    await st.remove(id);
    await idle(st);
  });

  it('the dialog says so, in both languages', () => {
    setLang('en');
    expect(t('err_abs_future', { n: 31 })).toMatch(/^At most 31 days ahead/);
    expect(t('absence_range_hint', { weeks: 6, days: 31 })).toMatch(/up to 31 days ahead/);
    setLang('de');
    expect(t('err_abs_future', { n: 31 })).toMatch(/^Höchstens 31 Tage im Voraus/);
    expect(t('absence_range_hint', { weeks: 6, days: 31 })).toMatch(/bis 31 Tage im Voraus/);
    setLang('en');
  });
});
