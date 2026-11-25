import { describe, it, expect } from 'vitest';
import {
  buildDays,
  dayView,
  logicalDay,
  buildPairs,
  directions,
  groupWeeks,
  currentState,
  zonedToEpoch,
  dayKey,
  timeOfDay,
  isoWeek,
  formatDur,
  balance,
  workdays,
  stats,
  weeklyHours,
  zoned,
  calendarDate,
  parseHours,
  editedTs,
  entryEpoch,
} from '../../public/js/time.js';

const TZ = 'Europe/Zurich';
const H = 3600_000;
let n = 0;
const at = (y, m, d, h, mi = 0) => zonedToEpoch(y, m, d, h, mi, TZ);
const e = (ts, extra = {}) => ({ id: String(++n).padStart(4, '0'), ts, tz: TZ, note: '', del: false, mod: 1, ...extra });

describe('time zone', () => {
  it('local time there and back', () => {
    const ts = at(2026, 11, 24, 7, 42);
    expect(dayKey(ts, TZ)).toBe('2026-11-24');
    expect(timeOfDay(ts, TZ)).toBe('07:42');
    expect(new Date(ts).toISOString()).toBe('2026-11-24T06:42:00.000Z');
  });

  it('DST gap (29.3.2026, 02:30 does not exist) → 03:30', () => {
    const ts = at(2026, 3, 29, 2, 30);
    expect(timeOfDay(ts, TZ)).toBe('03:30');
  });

  it('doubled hour (25.10.2026, 02:30) → valid time 02:30', () => {
    const ts = at(2026, 10, 25, 2, 30);
    expect(timeOfDay(ts, TZ)).toBe('02:30');
  });

  it('ISO week', () => {
    expect(isoWeek('2026-11-24')).toEqual({ year: 2026, week: 48 });
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 });
    expect(isoWeek('2026-01-01')).toEqual({ year: 2026, week: 1 });
  });

  it('formatDur', () => {
    expect(formatDur(0)).toBe('0:00');
    expect(formatDur(8 * H + 24 * 60_000)).toBe('8:24');
    expect(formatDur(-90 * 60_000)).toBe('−1:30');
  });
});

describe('pairing: order within the local day', () => {
  const now = at(2026, 11, 30, 12);

  it('even count: pairs (1,2), (3,4); break between pairs', () => {
    const list = [e(at(2026, 11, 24, 7, 30)), e(at(2026, 11, 24, 12)), e(at(2026, 11, 24, 12, 45)), e(at(2026, 11, 24, 17, 15))];
    const days = buildDays(list, now);
    expect(days).toHaveLength(1);
    expect(days[0].pairs.map((p) => p.status)).toEqual(['ok', 'ok']);
    expect(days[0].sum).toBe(9 * H);
    expect(days[0].open).toBe(false);
    const s = stats(list, days);
    expect(s.avgBreak).toBe(45 * 60_000);
    expect(s.avgFirst).toBe(7 * 60 + 30);
    expect(s.avgLast).toBe(17 * 60 + 15);
  });

  it('three punches on a past day: last one open, counts 0, day marked open', () => {
    const list = [e(at(2026, 11, 24, 8)), e(at(2026, 11, 24, 12)), e(at(2026, 11, 24, 13))];
    const [d] = buildDays(list, now);
    expect(d.pairs.map((p) => p.status)).toEqual(['ok', 'open']);
    expect(d.pairs[1].out).toBeNull();
    expect(d.sum).toBe(4 * H);
    expect(d.open).toBe(true);
    expect(currentState(list, now, TZ).openDays).toEqual(['2026-11-24']);
  });

  it('an open day older than the retention keeps is never reported (expired records not yet removed)', () => {
    const list = [e(at(2026, 11, 20, 22)), e(at(2026, 11, 24, 8))];
    expect(currentState(list, now, TZ, 0, '2026-11-21').openDays).toEqual(['2026-11-24']);
    expect(currentState(list, now, TZ, 0, '2026-11-20').openDays).toEqual(['2026-11-20', '2026-11-24']);
  });

  it('odd count today: the last punch runs until now', () => {
    const t0 = at(2026, 11, 24, 8);
    const list = [e(t0)];
    const s1 = currentState(list, t0 + 2 * H, TZ);
    expect(s1.in).toBe(true);
    expect(s1.since).toBe(t0);
    expect(s1.todaySum).toBe(2 * H);
    expect(s1.punchesToday).toBe(1);
    const s2 = currentState([...list, e(t0 + 3 * H)], t0 + 5 * H, TZ);
    expect(s2.in).toBe(false);
    expect(s2.todaySum).toBe(3 * H);
    expect(currentState([], t0, TZ)).toMatchObject({ in: false, punchesToday: 0, todaySum: 0 });
  });

  it('the next day the unpaired punch is open, not running', () => {
    const list = [e(at(2026, 11, 24, 8))];
    const s = currentState(list, at(2026, 11, 25, 1), TZ);
    expect(s.in).toBe(false);
    expect(s.todaySum).toBe(0);
    expect(s.openDays).toEqual(['2026-11-24']);
  });

  it('unsorted input is sorted by time', () => {
    const list = [e(at(2026, 11, 24, 17)), e(at(2026, 11, 24, 8)), e(at(2026, 11, 24, 12, 30)), e(at(2026, 11, 24, 12))];
    const [d] = buildDays(list, now);
    expect(d.pairs.map((p) => [timeOfDay(p.start, TZ), timeOfDay(p.end, TZ)])).toEqual([
      ['08:00', '12:00'],
      ['12:30', '17:00'],
    ]);
    expect(d.sum).toBe(8.5 * H);
  });

  it('editing a time so the order changes re-pairs the day', () => {
    const a = e(at(2026, 11, 24, 8));
    const b = e(at(2026, 11, 24, 12));
    const c = e(at(2026, 11, 24, 13));
    const d0 = e(at(2026, 11, 24, 17));
    expect(buildDays([a, b, c, d0], now)[0].sum).toBe(8 * H);
    const moved = { ...b, ts: at(2026, 11, 24, 16) }; // 12:00 → 16:00
    const [d] = buildDays([a, moved, c, d0], now);
    expect(d.pairs.map((p) => [timeOfDay(p.start, TZ), timeOfDay(p.end, TZ)])).toEqual([
      ['08:00', '13:00'],
      ['16:00', '17:00'],
    ]);
    expect(directions([a, moved, c, d0]).get(c.id)).toBe('out');
    expect(directions([a, moved, c, d0]).get(moved.id)).toBe('in');
  });

  it('deleting one punch (tombstone) re-pairs the rest', () => {
    const list = [e(at(2026, 11, 24, 8)), e(at(2026, 11, 24, 9), { del: true }), e(at(2026, 11, 24, 10))];
    const [d] = buildDays(list, now);
    expect(d.punches).toHaveLength(2);
    expect(d.sum).toBe(2 * H);
  });

  it('23:59 and 00:01 belong to different days (no pairing across midnight)', () => {
    const list = [e(at(2026, 11, 24, 23, 59)), e(at(2026, 11, 25, 0, 1))];
    const days = buildDays(list, now);
    expect(days.map((d) => d.day)).toEqual(['2026-11-25', '2026-11-24']);
    expect(days.every((d) => d.open && d.sum === 0)).toBe(true);
  });

  it('the day comes from the punch’s own time zone', () => {
    const ts = Date.UTC(2026, 10, 24, 23, 30); // 00:30 in Zurich, 23:30 in London
    expect(buildDays([{ ...e(ts), tz: 'Europe/London' }], now)[0].day).toBe('2026-11-24');
    expect(buildDays([e(ts)], now)[0].day).toBe('2026-11-25');
  });

  it('DST forward: 01:00–04:00 are 2 hours', () => {
    expect(buildDays([e(at(2026, 3, 29, 1)), e(at(2026, 3, 29, 4))], now)[0].sum).toBe(2 * H);
  });

  it('DST back: 01:00–04:00 are 4 hours', () => {
    expect(buildDays([e(at(2026, 10, 25, 1)), e(at(2026, 10, 25, 4))], now)[0].sum).toBe(4 * H);
  });

  it('same time twice: stable order by id', () => {
    const ts = at(2026, 11, 24, 8);
    const [d] = buildDays([e(ts, { id: 'b' }), e(ts, { id: 'a' })], now);
    expect(d.punches.map((p) => p.id)).toEqual(['a', 'b']);
    expect(d.sum).toBe(0);
  });

  it('weekly totals, newest first; buildPairs oldest first', () => {
    const list = [
      e(at(2026, 11, 17, 8)),
      e(at(2026, 11, 17, 16)),
      e(at(2026, 11, 24, 8)),
      e(at(2026, 11, 24, 12)),
      e(at(2026, 11, 25, 8)),
      e(at(2026, 11, 25, 9)),
    ];
    const weeks = groupWeeks(buildDays(list, now));
    expect(weeks.map((w) => w.week)).toEqual([48, 47]);
    expect(weeks[0].sum).toBe(5 * H);
    expect(weeks[0].days.map((d) => d.day)).toEqual(['2026-11-25', '2026-11-24']);
    expect(weeks[1].sum).toBe(8 * H);
    expect(buildPairs(list, now).map((p) => p.day)).toEqual(['2026-11-17', '2026-11-24', '2026-11-25']);
  });
});

describe('nerd mode', () => {
  it('working days and balance', () => {
    expect(workdays('2026-11-23', '2026-11-29')).toBe(5);
    const list = [e(at(2026, 11, 23, 8)), e(at(2026, 11, 23, 17))];
    const days = buildDays(list, at(2026, 11, 24, 20));
    const b = balance(days, 42, '2026-11-23', '2026-11-24');
    expect(b.target).toBe(2 * 8.4 * H);
    expect(b.worked).toBe(9 * H);
    expect(Math.round(b.diff / 60_000)).toBe(9 * 60 - 2 * 504);
    expect(balance(days, 42, '2026-08-27', '2026-11-24').from).toBe('2026-11-23');
  });

  it('week bars include empty weeks', () => {
    const days = buildDays([e(at(2026, 11, 10, 8)), e(at(2026, 11, 10, 10))], at(2026, 11, 24, 20));
    const w = weeklyHours(days, '2026-11-24', 3);
    expect(w.map((x) => x.week)).toEqual([46, 47, 48]);
    expect(w.map((x) => x.sum)).toEqual([2 * H, 0, 0]);
    expect(weeklyHours(days, '2026-11-24', 13)).toHaveLength(13);
  });

  it('heatmap of punches by weekday × hour', () => {
    const list = [e(at(2026, 11, 24, 7, 5)), e(at(2026, 11, 24, 7, 55))];
    const s = stats(list, buildDays(list, at(2026, 11, 25, 0)));
    expect(s.heat[1][7]).toBe(2); // Tuesday, 7 h
  });
});

describe('night shifts: the day changes at dayStart', () => {
  const now = at(2026, 11, 30, 12);
  const NIGHT = 4 * 60; // 04:00

  it('dayStart 0 behaves exactly like midnight', () => {
    const list = [e(at(2026, 11, 24, 22)), e(at(2026, 11, 25, 2, 10)), e(at(2026, 11, 25, 8)), e(at(2026, 11, 25, 12))];
    expect(buildDays(list, now, 0)).toEqual(buildDays(list, now));
    expect(logicalDay(at(2026, 11, 25, 0, 1), TZ, 0)).toBe('2026-11-25');
  });

  it('with 04:00 a 22:00 + 02:10 pair is one day with 4:10 h, shown with real clock times', () => {
    const list = [e(at(2026, 11, 23, 22)), e(at(2026, 11, 24, 2, 10))];
    const days = buildDays(list, now, NIGHT);
    expect(days).toHaveLength(1);
    expect(days[0].day).toBe('2026-11-23');
    expect(days[0].sum).toBe(4 * H + 10 * 60_000);
    expect(days[0].open).toBe(false);
    expect([timeOfDay(days[0].pairs[0].start, TZ), timeOfDay(days[0].pairs[0].end, TZ)]).toEqual(['22:00', '02:10']);
    const s = stats(list, days);
    expect(s.avgLast).toBe(26 * 60 + 10); // after midnight counts > 24 h
    expect(s.heat[0][2]).toBe(1); // Monday (logical), 2 h
  });

  it('boundary: exactly at dayStart starts the new day, one minute before belongs to the previous one', () => {
    expect(logicalDay(at(2026, 11, 24, 4, 0), TZ, NIGHT)).toBe('2026-11-24');
    expect(logicalDay(at(2026, 11, 24, 3, 59), TZ, NIGHT)).toBe('2026-11-23');
    expect(logicalDay(at(2026, 11, 24, 0, 0), TZ, NIGHT)).toBe('2026-11-23');
  });

  it('DST nights: wall-clock based', () => {
    // spring forward 29.3.2026 (02:00 → 03:00): 22:00–03:30 are 4:30 real hours, one day
    let d = buildDays([e(at(2026, 3, 28, 22)), e(at(2026, 3, 29, 3, 30))], now, NIGHT);
    expect(d).toHaveLength(1);
    expect(d[0].day).toBe('2026-03-28');
    expect(d[0].sum).toBe(4.5 * H);
    expect(logicalDay(at(2026, 3, 29, 4, 0), TZ, NIGHT)).toBe('2026-03-29');
    expect(logicalDay(at(2026, 3, 29, 3, 30), TZ, NIGHT)).toBe('2026-03-28');
    // fall back 25.10.2026 (03:00 → 02:00): 22:00–03:30 are 6:30 real hours
    d = buildDays([e(at(2026, 10, 24, 22)), e(at(2026, 10, 25, 3, 30))], now, NIGHT);
    expect(d).toHaveLength(1);
    expect(d[0].day).toBe('2026-10-24');
    expect(d[0].sum).toBe(6.5 * H);
  });

  it('week boundary: a Sunday night shift counts to Sunday’s week', () => {
    // Sunday 29.11.2026 22:00 → Monday 30.11. 03:00
    const list = [e(at(2026, 11, 29, 22)), e(at(2026, 11, 30, 3))];
    const weeks = groupWeeks(buildDays(list, at(2026, 12, 2, 12), NIGHT));
    expect(weeks).toHaveLength(1);
    expect(weeks[0].week).toBe(48);
    expect(weeks[0].sum).toBe(5 * H);
    // without the setting: two open days in two weeks
    expect(groupWeeks(buildDays(list, at(2026, 12, 2, 12))).map((w) => w.week)).toEqual([49, 48]);
  });

  it('running shift after midnight is still "in" today (logical)', () => {
    const list = [e(at(2026, 11, 24, 22))];
    const s = currentState(list, at(2026, 11, 25, 1), TZ, NIGHT);
    expect(s.in).toBe(true);
    expect(s.today).toBe('2026-11-24');
    expect(s.todaySum).toBe(3 * H);
    expect(currentState(list, at(2026, 11, 25, 1), TZ, 0).in).toBe(false);
  });
});

describe('zonedToEpoch in every kind of zone (2026–27)', () => {
  const ZONES = [
    'America/New_York', 'America/Los_Angeles', 'America/St_Johns', 'America/Santiago', 'America/Havana',
    'Europe/Zurich', 'Asia/Kolkata', 'Australia/Lord_Howe', 'Pacific/Chatham', 'Pacific/Apia',
  ];
  const wall = (ts, tz) => {
    const z = zoned(ts, tz);
    return `${z.y}-${String(z.m).padStart(2, '0')}-${String(z.d).padStart(2, '0')} ${String(z.h).padStart(2, '0')}:${String(z.mi).padStart(2, '0')}`;
  };
  const back = (w, tz) => {
    const [d, t] = w.split(' ');
    const [y, m, dd] = d.split('-').map(Number);
    const [h, mi] = t.split(':').map(Number);
    return zonedToEpoch(y, m, dd, h, mi, tz);
  };

  it.each([
    // [zone, local date/time asked, expected local result, expected UTC]
    ['America/New_York', '2026-03-08 02:30', '2026-03-08 03:30', '2026-03-08T07:30:00.000Z'],
    ['America/Los_Angeles', '2026-03-08 02:30', '2026-03-08 03:30', '2026-03-08T10:30:00.000Z'],
    ['America/St_Johns', '2026-03-08 02:30', '2026-03-08 03:30', '2026-03-08T06:00:00.000Z'],
    ['America/Santiago', '2026-09-06 00:30', '2026-09-06 01:30', '2026-09-06T04:30:00.000Z'],
    ['America/Havana', '2026-03-08 00:15', '2026-03-08 01:15', '2026-03-08T05:15:00.000Z'],
    ['America/New_York', '2026-11-01 01:30', '2026-11-01 01:30', '2026-11-01T06:30:00.000Z'], // doubled: the later one (EST)
    ['America/Los_Angeles', '2026-11-01 01:30', '2026-11-01 01:30', '2026-11-01T09:30:00.000Z'],
    ['Europe/Zurich', '2026-03-29 02:30', '2026-03-29 03:30', '2026-03-29T01:30:00.000Z'],
    ['Europe/Zurich', '2026-10-25 02:30', '2026-10-25 02:30', '2026-10-25T01:30:00.000Z'],
    ['Australia/Lord_Howe', '2026-10-04 02:15', '2026-10-04 02:45', '2026-10-03T15:45:00.000Z'], // 30-minute shift
    ['Asia/Kolkata', '2026-06-01 09:00', '2026-06-01 09:00', '2026-06-01T03:30:00.000Z'],
  ])('%s %s → %s', (tz, asked, local, iso) => {
    const ts = back(asked, tz);
    expect(wall(ts, tz)).toBe(local);
    expect(new Date(ts).toISOString()).toBe(iso);
  });

  it('every quarter hour around every transition: round trip, later instant when doubled, forward in gaps', () => {
    let transitions = 0;
    for (const tz of ZONES) {
      const start = Date.UTC(2026, 0, 1);
      const end = Date.UTC(2028, 0, 1);
      const offset = (t) => {
        const z = zoned(t, tz);
        return Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi) - Math.floor(t / 60_000) * 60_000;
      };
      for (let t = start + H; t < end; t += H) {
        if (offset(t) === offset(t - H)) continue;
        transitions++;
        for (let u = t - 4 * H; u <= t + 4 * H; u += 15 * 60_000) {
          const w = wall(u, tz);
          const r = back(w, tz);
          expect(wall(r, tz), `${tz} ${w}`).toBe(w); // the wall time comes back
          expect(r, `${tz} ${w}`).toBeGreaterThanOrEqual(u); // doubled → the later instant
        }
      }
    }
    // New York, LA, St John's, Santiago, Havana, Zurich, Lord Howe, Chatham: 2 a year each
    expect(transitions).toBe(8 * 2 * 2);
  });

  it('wall times inside a gap move forward by the gap, on the same date', () => {
    for (const [tz, y, m, d, h, mi] of [
      ['America/New_York', 2027, 3, 14, 2, 15],
      ['America/Santiago', 2027, 9, 5, 0, 45],
      ['America/Havana', 2027, 3, 14, 0, 30],
      ['Pacific/Chatham', 2026, 9, 27, 2, 50],
    ]) {
      const ts = zonedToEpoch(y, m, d, h, mi, tz);
      const z = zoned(ts, tz);
      expect([z.y, z.m, z.d], tz).toEqual([y, m, d]);
      expect(z.h * 60 + z.mi, tz).toBeGreaterThan(h * 60 + mi);
    }
  });
});

describe('travel, minutes, night-shift dates, target input (B5, B7)', () => {
  it('an odd last punch made in another zone runs on the start screen when it is today on the device', () => {
    // Punched in Zurich at 23:00, then flew to New York; it is 18:00 there on the same date.
    const punch = { id: 'x1', ts: zonedToEpoch(2026, 11, 24, 23, 0, 'Europe/Zurich'), tz: 'Europe/Zurich', note: '', del: false, mod: 1 };
    const now = zonedToEpoch(2026, 11, 24, 18, 0, 'America/New_York');
    const cur = currentState([punch], now, 'America/New_York');
    expect(cur.in).toBe(true);
    expect(cur.punchesToday).toBe(1);
    const [d] = buildDays([punch], now, 0, 'America/New_York');
    expect(d.pairs[0].status).toBe('running');
  });

  it('durations match the HH:MM shown (minute-truncated)', () => {
    const a = e(at(2026, 11, 24, 8, 0) + 59_000); // shows 08:00
    const b = e(at(2026, 11, 24, 9, 0)); // shows 09:00
    const [d] = buildDays([a, b], at(2026, 11, 30, 12));
    expect(timeOfDay(a.ts, TZ)).toBe('08:00');
    expect(formatDur(d.sum)).toBe('1:00');
  });

  it('with night shifts a time before the day change lands on the next calendar date', () => {
    expect(calendarDate('2026-11-24', '02:30', 240)).toBe('2026-11-25');
    expect(calendarDate('2026-11-24', '04:00', 240)).toBe('2026-11-24');
    expect(calendarDate('2026-11-24', '22:00', 240)).toBe('2026-11-24');
    expect(calendarDate('2026-11-30', '01:00', 240)).toBe('2026-12-01');
    expect(calendarDate('2026-11-24', '02:30', 0)).toBe('2026-11-24');
    // and it stays in that logical day
    const ts = zonedToEpoch(2026, 11, 25, 2, 30, TZ);
    expect(logicalDay(ts, TZ, 240)).toBe('2026-11-24');
  });

  it('target hours: empty or nonsense is an error, not 0', () => {
    expect(parseHours('')).toBeNull();
    expect(parseHours('   ')).toBeNull();
    expect(parseHours('abc')).toBeNull();
    expect(parseHours('81')).toBeNull();
    expect(parseHours('-1')).toBeNull();
    expect(parseHours('0')).toBe(0);
    expect(parseHours('42,5')).toBe(42.5);
    expect(parseHours(' 40 ')).toBe(40);
  });
});

describe('dayView: one day at a time on the start screen', () => {
  const now = at(2026, 11, 30, 12); // Monday
  const oldest = '2025-11-01';
  const v = (list, day, o = {}) => dayView(list, now, { day, oldest, tz: TZ, ...o });

  it('default is today: its punches in order with in/out, the running total, no newer day', () => {
    const list = [e(at(2026, 11, 30, 11)), e(at(2026, 11, 30, 7, 30)), e(at(2026, 11, 30, 9)), e(at(2026, 11, 29, 8))];
    const r = v(list, null);
    expect(r).toMatchObject({ day: '2026-11-30', today: '2026-11-30', isToday: true, running: true, prev: '2026-11-29', next: null });
    expect(r.punches.map((p) => [timeOfDay(p.ts), p.dir])).toEqual([['07:30', 'in'], ['09:00', 'out'], ['11:00', 'in']]);
    expect(r.sum).toBe(1.5 * H + 1 * H); // 07:30–09:00 plus 11:00 until now (12:00)
    // a day outside the bounds (future, too old, nonsense) also means today
    for (const d of ['2026-12-01', '2025-10-31', 'x', undefined]) expect(v(list, d).day, String(d)).toBe('2026-11-30');
  });

  it('yesterday: its own punches only, closed total, both neighbours', () => {
    const list = [e(at(2026, 11, 29, 8)), e(at(2026, 11, 29, 12)), e(at(2026, 11, 29, 13)), e(at(2026, 11, 29, 17, 15)), e(at(2026, 11, 30, 8))];
    const r = v(list, '2026-11-29');
    expect(r).toMatchObject({ day: '2026-11-29', isToday: false, running: false, prev: '2026-11-28', next: '2026-11-30' });
    expect(r.punches.map((p) => p.dir)).toEqual(['in', 'out', 'in', 'out']);
    expect(r.sum).toBe(8.25 * H);
  });

  it('an empty day is a day like any other (no skipping), deleted punches do not count', () => {
    const list = [e(at(2026, 11, 26, 8)), { ...e(at(2026, 11, 27, 9)), del: true }, e(at(2026, 11, 29, 8))];
    const r = v(list, '2026-11-27');
    expect(r).toMatchObject({ day: '2026-11-27', punches: [], sum: 0, running: false, prev: '2026-11-26', next: '2026-11-28' });
    expect(v(list, '2026-11-28').punches).toEqual([]);
    expect(v([], null)).toMatchObject({ day: '2026-11-30', punches: [], sum: 0, prev: '2026-11-29', next: null });
  });

  it('12 punches (the daily maximum): all of them, in order, six pairs', () => {
    const list = [];
    for (let i = 0; i < 12; i++) list.push(e(at(2026, 11, 27, 6 + i, i % 2 ? 50 : 0)));
    list.reverse();
    const r = v(list, '2026-11-27');
    expect(r.punches).toHaveLength(12);
    expect(r.punches.map((p) => p.dir)).toEqual(Array.from({ length: 12 }, (_, i) => (i % 2 ? 'out' : 'in')));
    expect(r.punches.map((p) => p.ts)).toEqual([...r.punches.map((p) => p.ts)].sort((a, b) => a - b));
    expect(r.sum).toBe(6 * (H + 50 * 60_000));
  });

  it('night shifts: after midnight still the previous day; «today» starts only at the day change', () => {
    const list = [e(at(2026, 11, 27, 22)), e(at(2026, 11, 28, 2, 10)), e(at(2026, 11, 28, 8))];
    const r = v(list, '2026-11-27', { dayStart: 4 * 60 });
    expect(r.punches.map((p) => [timeOfDay(p.ts), p.dir])).toEqual([['22:00', 'in'], ['02:10', 'out']]);
    expect(r.sum).toBe(4 * H + 10 * 60_000);
    expect(v(list, '2026-11-28', { dayStart: 4 * 60 }).punches.map((p) => timeOfDay(p.ts))).toEqual(['08:00']);
    // at 03:00 on the 30th the logical today is still the 29th
    const early = dayView(list, at(2026, 11, 30, 3), { day: null, oldest, tz: TZ, dayStart: 4 * 60 });
    expect(early).toMatchObject({ day: '2026-11-29', today: '2026-11-29', next: null });
    expect(dayView(list, at(2026, 11, 30, 3), { day: '2026-11-30', oldest, tz: TZ, dayStart: 4 * 60 }).day).toBe('2026-11-29');
  });

  it('bounds: no newer day than today, no older day than the retention keeps', () => {
    expect(v([], null).next).toBeNull();
    const last = v([e(at(2025, 11, 1, 9))], '2025-11-01');
    expect(last).toMatchObject({ day: '2025-11-01', prev: null, next: '2025-11-02' });
    expect(last.punches).toHaveLength(1);
    expect(v([], '2025-11-02').prev).toBe('2025-11-01');
    // an «oldest» after today (nothing kept yet) collapses to today
    expect(dayView([], now, { day: null, oldest: '2027-01-01', tz: TZ })).toMatchObject({ day: '2026-11-30', prev: null, next: null });
  });

  it('daylight saving: the 23-hour day keeps real durations, the neighbours are calendar days', () => {
    // 29 March 2026, Europe/Zurich: 02:00 → 03:00
    const list = [e(at(2026, 3, 29, 1, 30)), e(at(2026, 3, 29, 3, 30)), e(at(2026, 10, 25, 1, 30)), e(at(2026, 10, 25, 3, 30))];
    const spring = v(list, '2026-03-29');
    expect(spring.sum).toBe(1 * H);
    expect(spring).toMatchObject({ prev: '2026-03-28', next: '2026-03-30' });
    // 25 October 2026: 03:00 → 02:00, the 25-hour day
    const autumn = v(list, '2026-10-25');
    expect(autumn.sum).toBe(3 * H);
    expect(autumn).toMatchObject({ prev: '2026-10-24', next: '2026-10-26' });
    // walking day by day over both changes never skips or repeats a day
    let d = '2026-03-27';
    const seen = [];
    for (let i = 0; i < 4; i++) d = (seen.push(d), v(list, d).next);
    expect(seen).toEqual(['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30']);
  });
});

describe('13 months in nerd mode', () => {
  it('addMonths clamps to the month end', async () => {
    const { addMonths } = await import('../../public/js/time.js');
    expect(addMonths('2026-11-24', -12)).toBe('2025-11-24');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
    expect(addMonths('2026-01-15', -13)).toBe('2024-12-15');
  });

  it('monthlyHours: 13 months oldest first, empty ones included, target from the workdays', async () => {
    const { monthlyHours, buildDays, zonedToEpoch } = await import('../../public/js/time.js');
    const TZ = 'Europe/Zurich';
    const e = [
      { id: 'a', ts: zonedToEpoch(2026, 11, 2, 8, 0, TZ), tz: TZ },
      { id: 'b', ts: zonedToEpoch(2026, 11, 2, 16, 0, TZ), tz: TZ },
      { id: 'c', ts: zonedToEpoch(2025, 11, 3, 8, 0, TZ), tz: TZ },
      { id: 'd', ts: zonedToEpoch(2025, 11, 3, 9, 30, TZ), tz: TZ },
    ];
    const now = zonedToEpoch(2026, 11, 24, 12, 0, TZ);
    const m = monthlyHours(buildDays(e, now, 0, TZ), '2026-11-24', 13, 40);
    expect(m).toHaveLength(13);
    expect(m[0]).toMatchObject({ month: '2025-11', sum: 90 * 60_000 });
    expect(m[12]).toMatchObject({ month: '2026-11', sum: 8 * 3600_000 });
    expect(m[6].sum).toBe(0);
    // November 2026 up to Tue 24th: 17 workdays × 8 h
    expect(m[12].target).toBe(17 * 8 * 3600_000);
    // February 2026: 20 workdays
    expect(m.find((x) => x.month === '2026-02').target).toBe(20 * 8 * 3600_000);
  });
});

describe('a punch on a logical day after the device\'s today (N6)', () => {
  // Punched in at 09:00 in Auckland on 25 Nov; the device is now in Los Angeles, where it is still 24 Nov.
  const AKL = 'Pacific/Auckland';
  const LA = 'America/Los_Angeles';
  const punch = { id: 'akl1', ts: zonedToEpoch(2026, 11, 25, 9, 0, AKL), tz: AKL, note: '', del: false, mod: 1 };
  const now = punch.ts + 2 * H;
  const today = dayKey(now, LA);

  it('the setup: the punch counts to 25 Nov, the device\'s today is 24 Nov', () => {
    expect(today).toBe('2026-11-24');
    expect(logicalDay(punch.ts, AKL)).toBe('2026-11-25');
  });

  it('the day browser reaches that day (next from today), and no further', () => {
    const v0 = dayView([punch], now, { tz: LA, oldest: '2026-01-01' });
    expect(v0.day).toBe(today);
    expect(v0.next).toBe('2026-11-25');
    const v1 = dayView([punch], now, { tz: LA, oldest: '2026-01-01', day: '2026-11-25' });
    expect(v1.day).toBe('2026-11-25');
    expect(v1.isToday).toBe(false);
    expect(v1.punches.map((p) => p.id)).toEqual(['akl1']);
    expect(v1.running).toBe(true);
    expect(v1.next).toBeNull();
    expect(v1.prev).toBe(today);
    // beyond the newest day with punches: back to today
    expect(dayView([punch], now, { tz: LA, oldest: '2026-01-01', day: '2026-11-26' }).day).toBe(today);
    // without such a punch, nothing after today
    expect(dayView([], now, { tz: LA, oldest: '2026-01-01' }).next).toBeNull();
  });

  it('the start screen: «in» since that punch, no «open day» warning for a future day', () => {
    const cur = currentState([punch], now, LA);
    expect(cur.in).toBe(true);
    expect(cur.since).toBe(punch.ts);
    expect(cur.openDays).toEqual([]);
    const [d] = buildDays([punch], now, 0, LA);
    expect(d.pairs[0].status).toBe('running');
    expect(d.open).toBe(false);
    // a real past open day is still reported
    const old = { id: 'old1', ts: zonedToEpoch(2026, 11, 20, 8, 0, LA), tz: LA, note: '', del: false, mod: 1 };
    expect(currentState([punch, old], now, LA).openDays).toEqual(['2026-11-20']);
  });
});

describe('editing a punch keeps its timestamp when date and time are unchanged (P4)', () => {
  // 25 Oct 2026, Zurich: 02:00–02:59 happens twice (CEST, then CET).
  const first = Date.UTC(2026, 9, 25, 0, 30); // 02:30 CEST, the first of the two
  it('the setup: 02:30 entered by hand means the later one', () => {
    expect(timeOfDay(first, TZ)).toBe('02:30');
    expect(entryEpoch('2026-10-25', '02:30', TZ)).toBe(first + H);
  });
  it('only the note changed: the punch does not move by an hour', () => {
    const opened = { day: '2026-10-25', time: '02:30' };
    expect(editedTs({ ts: first }, opened, '2026-10-25', '02:30', TZ)).toBe(first);
  });
  it('time or date changed, or a new punch: the entered values count', () => {
    const opened = { day: '2026-10-25', time: '02:30' };
    expect(editedTs({ ts: first }, opened, '2026-10-25', '02:31', TZ)).toBe(entryEpoch('2026-10-25', '02:31', TZ));
    expect(editedTs({ ts: first }, opened, '2026-10-24', '02:30', TZ)).toBe(entryEpoch('2026-10-24', '02:30', TZ));
    expect(editedTs(null, null, '2026-10-25', '02:30', TZ)).toBe(first + H);
    expect(editedTs({ ts: first }, opened, '', '02:30', TZ)).toBeNull();
  });
});
