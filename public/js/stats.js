// The nerd view's statistics, without the DOM: typical times as medians (a few odd days do not pull
// them), the day by weekday, series, rule breaks and absences. Everything is computed on the device from
// the days it already has; nothing is asked from the server.

import { zoned, weekday, absenceType, isHoliday, DEFAULT_TZ } from './time.js';
import { filterDays } from './listview.js';

const MIN = 60_000;

/** The median of numbers (the mean of the two middle ones for an even count); null for none. @param {number[]} a */
export function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Minutes after midnight of the day a punch counts to: a punch on the next calendar date (night shift)
 * counts past 24 h, so 01:30 after a late shift is 25:30, not the morning's earliest.
 * @param {{ ts: number, tz?: string }} e @param {string} day
 */
function minutesOf(e, day) {
  const z = zoned(e.ts, e.tz || DEFAULT_TZ);
  const date = `${z.y}-${String(z.m).padStart(2, '0')}-${String(z.d).padStart(2, '0')}`;
  return z.h * 60 + z.mi + (date !== day ? 1440 : 0);
}

/**
 * @typedef {import('./time.js').Day} Day
 * @typedef {{ day: string, min: number }} DayMin
 * @typedef {{ day: string, ms: number }} DayMs
 */

/**
 * Statistics of the days in a range (the list's days: withAbsences(), newest first or any order).
 * Times in minutes after midnight, durations in ms.
 * @param {Day[]} days @param {import('./listview.js').BreakRule} rule the break rule in force (breakRule)
 */
export function nerdStats(days, rule) {
  const worked = days.filter((d) => d.punches.length && d.sum > 0);
  /** @type {number[]} */ const firsts = [];
  /** @type {number[]} */ const lasts = [];
  /** @type {number[]} */ const breaksTotal = [];
  /** @type {number[]} */ const breaksLongest = [];
  /** @type {DayMin | null} */ let earliest = null;
  /** @type {DayMin | null} */ let latest = null;
  /** @type {DayMs | null} */ let longest = null;
  /** @type {DayMs | null} */ let shortest = null;
  /** @type {number[][]} */ const byWeekday = Array.from({ length: 7 }, () => []);
  // The lunch break: the day's longest break, its length and its start (minutes after midnight), per weekday too.
  /** @type {number[]} */ const lunchAt = [];
  /** @type {number[][]} */ const lunchByWd = Array.from({ length: 7 }, () => []);
  /** @type {number[][]} */ const lunchAtByWd = Array.from({ length: 7 }, () => []);
  for (const d of worked) {
    const f = minutesOf(d.punches[0], d.day);
    const l = minutesOf(d.punches[d.punches.length - 1], d.day);
    firsts.push(f);
    lasts.push(l);
    if (!earliest || f < earliest.min) earliest = { day: d.day, min: f };
    if (!latest || l > latest.min) latest = { day: d.day, min: l };
    if (!longest || d.sum > longest.ms) longest = { day: d.day, ms: d.sum };
    if (!d.running && !d.open && (!shortest || d.sum < shortest.ms)) shortest = { day: d.day, ms: d.sum };
    byWeekday[weekday(d.day)].push(d.sum);
    // Breaks: the gaps between the day's complete pairs (a day of one pair has none).
    const ok = d.pairs.filter((p) => p.status === 'ok').sort((a, b) => a.start - b.start);
    if (ok.length > 1) {
      let sum = 0;
      let max = 0;
      let maxAt = 0;
      for (let i = 1; i < ok.length; i++) {
        const gap = ok[i].start - /** @type {number} */ (ok[i - 1].end);
        sum += gap;
        if (gap > max) {
          max = gap;
          maxAt = minutesOf({ ts: /** @type {number} */ (ok[i - 1].end), tz: ok[i - 1].out?.tz || ok[i - 1].in.tz }, d.day);
        }
      }
      breaksTotal.push(sum);
      breaksLongest.push(max);
      lunchAt.push(maxAt);
      lunchByWd[weekday(d.day)].push(max);
      lunchAtByWd[weekday(d.day)].push(maxAt);
    }
  }
  const sums = worked.map((d) => d.sum);
  const total = sums.reduce((s, x) => s + x, 0);

  // The longest series of working days (Monday to Friday) with work: a weekend does not end it, a
  // weekday without work does.
  const workedSet = new Set(worked.map((d) => d.day));
  const keys = [...new Set(days.map((d) => d.day))].sort();
  let run = 0;
  let best = 0;
  if (keys.length) {
    for (let k = keys[0]; k <= keys[keys.length - 1]; k = nextDay(k)) {
      if (weekday(k) >= 5) continue;
      run = workedSet.has(k) ? run + 1 : 0;
      best = Math.max(best, run);
    }
  }

  // Absences of your own by kind (a half day counts half) and the calendar's holidays on weekdays.
  /** @type {Record<string, number>} */
  const absent = { vacation: 0, sick: 0, comp: 0, holiday: 0, other: 0 };
  for (const d of days) {
    for (const a of d.absences || []) {
      if (a.cal) {
        if (weekday(a.day) < 5) absent.holiday += a.half ? 0.5 : 1;
        continue;
      }
      absent[absenceType(a.type)] += a.half ? 0.5 : 1;
    }
  }

  return {
    workedDays: worked.length,
    total,
    medianFirst: median(firsts),
    medianLast: median(lasts),
    earliest,
    latest,
    medianDay: median(sums),
    avgDay: sums.length ? total / sums.length : null,
    longest,
    shortest,
    medianBreak: median(breaksTotal),
    medianLunch: median(breaksLongest),
    medianLunchAt: median(lunchAt),
    breakDays: breaksTotal.length,
    medianPunches: median(worked.map((d) => d.punches.length)),
    weekdays: byWeekday.map((a, w) => ({ days: a.length, median: median(a), lunch: median(lunchByWd[w]), lunchAt: median(lunchAtByWd[w]) })),
    bestRun: best,
    weekendDays: worked.filter((d) => weekday(d.day) >= 5 || (d.absences || []).some(isHoliday)).length,
    rules: {
      pause: filterDays(days, 'pause', rule).length,
      rest: filterDays(days, 'rest', rule).length,
      long: filterDays(days, 'long', rule).length,
      open: filterDays(days, 'open', rule).length,
    },
    absent,
  };
}

/** @param {string} k "YYYY-MM-DD" */
const nextDay = (k) => plusDays(k, 1);

/**
 * The share of sick days among the working days of a range, in percent (one decimal); null without
 * working days. @param {number} sick @param {number} workdayCount
 */
export const sickRate = (sick, workdayCount) => (workdayCount > 0 ? Math.round((sick / workdayCount) * 1000) / 10 : null);

/** Milliseconds → whole minutes (for medians of durations). @param {number | null} ms */
export const toMin = (ms) => (ms == null ? null : Math.round(ms / MIN));

/**
 * The heatmap «presence»: for each weekday and hour, the median of the minutes present in that hour,
 * over the days of that weekday with punches (days off do not pull it to 0). A pair is spread over the
 * clock hours it covers (from its start's local time); a running pair counts up to `now`.
 * @param {Day[]} days @param {number} now
 * @returns {{ median: number[][], days: number[] }} median[weekday][hour] in whole minutes; days[weekday]
 */
export function presenceMatrix(days, now) {
  /** @type {number[][][]} */
  const per = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => []));
  const count = Array(7).fill(0);
  for (const d of days) {
    if (!d.punches.length) continue;
    const w = weekday(d.day);
    count[w]++;
    const mins = Array(24).fill(0);
    for (const p of d.pairs) {
      const end = p.end ?? (p.status === 'running' ? now : null);
      if (end == null || end <= p.start) continue;
      const z = zoned(p.start, p.in.tz || DEFAULT_TZ);
      let m = z.h * 60 + z.mi;
      let left = Math.round((end - p.start) / MIN);
      while (left > 0) {
        const take = Math.min(60 - (m % 60), left);
        mins[Math.floor(m / 60) % 24] += take;
        m += take;
        left -= take;
      }
    }
    for (let h = 0; h < 24; h++) per[w][h].push(Math.min(60, mins[h]));
  }
  return { median: per.map((row) => row.map((a) => Math.round(median(a) ?? 0))), days: count };
}

/**
 * The heatmap «balance per day»: one row per ISO week (newest first) from the first day with data in
 * the range, seven cells (Monday–Sunday) with worked + credit − target in minutes (null outside the
 * range or after today) and the week's sum. Holidays lower the target (withAbsences: credit/off).
 * @param {Day[]} days withAbsences() @param {number} weekHours @param {string} from @param {string} today
 * @returns {{ start: string, cells: (number | null)[], sum: number }[]}
 */
export function dayBalances(days, weekHours, from, today) {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const withData = days.filter((d) => d.punches.length || (d.absences || []).length).map((d) => d.day).sort();
  const first = withData.find((k) => k >= from);
  if (!first) return [];
  const target = (weekHours / 5) * 60;
  /** @type {{ start: string, cells: (number | null)[], sum: number }[]} */
  const out = [];
  for (let ws = weekOf(first); ws <= today; ws = plusDays(ws, 7)) {
    /** @type {(number | null)[]} */
    const cells = [];
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      const k = plusDays(ws, i);
      if (k < first || k > today) {
        cells.push(null);
        continue;
      }
      const d = byDay.get(k);
      const v = Math.round(((d ? d.sum + (d.credit || 0) : 0) / MIN) - (i < 5 ? target : 0));
      cells.push(v);
      sum += v;
    }
    out.push({ start: ws, cells, sum });
  }
  return out.reverse();
}

/**
 * The heatmap «breaks»: for each weekday and hour, the median of the minutes of break in that hour (the
 * gaps between a day's complete pairs), over the days of that weekday with punches. Shows when the lunch
 * break typically is.
 * @param {Day[]} days @returns {{ median: number[][], days: number[] }}
 */
export function breakMatrix(days) {
  /** @type {number[][][]} */
  const per = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => []));
  const count = Array(7).fill(0);
  for (const d of days) {
    if (!d.punches.length) continue;
    const w = weekday(d.day);
    count[w]++;
    const mins = Array(24).fill(0);
    const ok = d.pairs.filter((p) => p.status === 'ok').sort((a, b) => a.start - b.start);
    for (let i = 1; i < ok.length; i++) {
      const from = /** @type {number} */ (ok[i - 1].end);
      const z = zoned(from, ok[i - 1].out?.tz || DEFAULT_TZ);
      let m = z.h * 60 + z.mi;
      let left = Math.round((ok[i].start - from) / MIN);
      while (left > 0) {
        const take = Math.min(60 - (m % 60), left);
        mins[Math.floor(m / 60) % 24] += take;
        m += take;
        left -= take;
      }
    }
    for (let h = 0; h < 24; h++) per[w][h].push(Math.min(60, mins[h]));
  }
  return { median: per.map((row) => row.map((a) => Math.round(median(a) ?? 0))), days: count };
}

/**
 * The heatmap «balance per month»: one row per month (newest first) from the first day with data in the
 * range, seven cells with the month's balance on that weekday (minutes) and the month's sum.
 * @param {Day[]} days withAbsences() @param {number} weekHours @param {string} from @param {string} today
 * @returns {{ month: string, cells: number[], sum: number }[]}
 */
export function monthBalances(days, weekHours, from, today) {
  /** @type {Map<string, { month: string, cells: number[], sum: number }>} */
  const byMonth = new Map();
  for (const w of dayBalances(days, weekHours, from, today)) {
    w.cells.forEach((v, i) => {
      if (v == null) return;
      const month = plusDays(w.start, i).slice(0, 7);
      let r = byMonth.get(month);
      if (!r) byMonth.set(month, (r = { month, cells: Array(7).fill(0), sum: 0 }));
      r.cells[i] += v;
      r.sum += v;
    });
  }
  return [...byMonth.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
}

/** Monday of a day's week. @param {string} k */
function weekOf(k) {
  return plusDays(k, -weekday(k));
}

/** @param {string} k @param {number} n */
function plusDays(k, n) {
  const d = new Date(`${k}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
