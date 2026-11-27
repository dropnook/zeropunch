// The nerd view's statistics (stats.js): medians, records, series, rule breaks, absences, and the data of
// the heatmaps (presence by weekday and hour, balance per day).
import { describe, it, expect } from 'vitest';
import { median, nerdStats, presenceMatrix, dayBalances, sickRate } from '../../public/js/stats.js';
import { buildDays, withAbsences, zonedToEpoch } from '../../public/js/time.js';
import { BREAK_RULES } from '../../public/js/listview.js';

const Z = 'Europe/Zurich';
const H = 3_600_000;
let k = 0;
/** Punches on a day of Nov 2026 at "HH:MM". @param {number} d @param {string[]} times */
const punches = (d, times) => times.map((s) => ({ id: `p${++k}`, ts: zonedToEpoch(2026, 11, d, +s.slice(0, 2), +s.slice(3), Z), tz: Z }));
const now = zonedToEpoch(2026, 11, 28, 12, 0, Z);
const build = (/** @type {any[]} */ list, /** @type {any[]} */ abs = []) => withAbsences(buildDays(list, now, 0, Z), abs, 42);

describe('nerd statistics', () => {
  it('median: odd, even, none', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('typical day as medians; records; a weekend does not break a series of working days', () => {
    const days = build([
      ...punches(19, ['08:00', '12:00', '12:30', '17:00']), // Thu 8:30 h, 30 min break
      ...punches(20, ['07:00', '11:00', '12:00', '16:00']), // Fri 8:00 h, 60 min break
      ...punches(23, ['09:00', '18:00']), // Mon 9:00 h, no break
    ]);
    const n = nerdStats(days, BREAK_RULES.ch);
    expect(n.workedDays).toBe(3);
    expect(n.medianFirst).toBe(8 * 60);
    expect(n.medianLast).toBe(17 * 60);
    expect(n.medianDay).toBe(8.5 * H);
    expect(n.medianLunch).toBe(45 * 60_000);
    expect(n.earliest).toEqual({ day: '2026-11-20', min: 7 * 60 });
    expect(n.latest).toEqual({ day: '2026-11-23', min: 18 * 60 });
    expect(n.longest).toEqual({ day: '2026-11-23', ms: 9 * H });
    expect(n.bestRun).toBe(3); // Thu, Fri, (weekend), Mon
    expect(n.rules.pause).toBe(1); // Monday: 9 h without a break
    expect(n.weekdays[0]).toEqual({ days: 1, median: 9 * H, lunch: null, lunchAt: null }); // Monday: no break
    // the lunch break: the longest break of the day, its length and start (median)
    expect(n.medianLunchAt).toBe(11.5 * 60); // Thursday from 12:00, Friday from 11:00
    expect(n.weekdays[3]).toMatchObject({ lunch: 30 * 60_000, lunchAt: 12 * 60 });
  });

  it('absences by kind, a half day counts half; the calendar counts its weekdays only', () => {
    const days = build(
      [],
      [
        { id: 'a', kind: 'absence', day: '2026-11-16', type: 'sick' },
        { id: 'b', kind: 'absence', day: '2026-11-17', type: 'vacation', half: true },
        { id: 'c', kind: 'absence', day: '2026-11-18', type: 'comp' },
        { id: 'd', kind: 'absence', day: '2026-11-19', cal: true, type: 'holiday' },
      ],
    );
    expect(nerdStats(days, BREAK_RULES.ch).absent).toEqual({ vacation: 0.5, sick: 1, comp: 1, holiday: 1, other: 0 });
    expect(sickRate(1, 20)).toBe(5);
    expect(sickRate(1, 0)).toBeNull();
  });
});

describe('heatmap data', () => {
  it('presence: minutes per hour as the median of the days with punches', () => {
    const days = build([
      ...punches(16, ['08:30', '12:00', '13:00', '17:00']), // Monday
      ...punches(23, ['08:00', '12:00', '12:30', '17:00']), // Monday
    ]);
    const p = presenceMatrix(days, now);
    expect(p.days[0]).toBe(2);
    expect(p.median[0][8]).toBe(45); // 30 and 60 minutes
    expect(p.median[0][12]).toBe(15); // 0 and 30
    expect(p.median[0][16]).toBe(60);
    expect(p.median[0][17]).toBe(0);
    expect(p.median[1][9]).toBe(0); // no Tuesday
  });

  it('balance per day: weeks newest first, from the first day with data, the week summed', () => {
    const days = build([
      ...punches(19, ['08:00', '17:00']), // Thu: 9 h → +0:36
      ...punches(20, ['08:00', '16:00']), // Fri: 8 h → −0:24
    ]);
    const weeks = dayBalances(days, 42, '2026-11-01', '2026-11-24');
    expect(weeks.map((w) => w.start)).toEqual(['2026-11-23', '2026-11-16']);
    expect(weeks[1].cells).toEqual([null, null, null, 36, -24, 0, 0]);
    expect(weeks[1].sum).toBe(12);
    expect(weeks[0].cells).toEqual([-504, -504, null, null, null, null, null]);
    expect(dayBalances([], 42, '2026-11-01', '2026-11-24')).toEqual([]);
  });
});
