// Pairing, totals, calendar arithmetic. Pure functions (tested in test/unit).
//
// One kind of stamp only: a punch is a point in time. Meaning comes from the order within the
// punch's LOCAL calendar day (in its own tz): 1st = in, 2nd = out, 3rd = in, … Pairs are (1,2),
// (3,4), …; the day total is the sum of the pairs. An odd last punch is an open "in": today it runs
// until now, on a past day it is shown as open and counts 0.
// The day changes at local midnight, or – with the "night shifts" setting – at `dayStart` minutes
// after midnight: the logical day of a punch is the local date of (wall-clock time − dayStart), so a
// shift over midnight stays one day. Clock times shown stay the real ones.
// Durations are real elapsed time (epoch ms), so daylight-saving changes are right by themselves.
// They are computed on minute-truncated timestamps, so they always match the HH:MM shown.

export const DEFAULT_TZ = 'Europe/Zurich';
const MIN = 60_000;
const HOUR = 3600_000;

/** @type {Map<string, Intl.DateTimeFormat>} */
const fmtCache = new Map();
const WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** @param {string} tz */
function fmt(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/**
 * Local time parts. wd: 0 = Monday … 6 = Sunday.
 * @param {number} ts @param {string} [tz]
 */
export function zoned(ts, tz = DEFAULT_TZ) {
  // Intl is the slow part with a full account (13 months × 12 punches): results are cached per zone and
  // second. The cache is bounded; it is simply emptied when full (the clock adds one key per second).
  const key = `${tz}|${Math.floor(ts / 1000)}`;
  const hit = zonedCache.get(key);
  if (hit) return hit;
  /** @type {Record<string, string>} */
  const p = {};
  for (const part of fmt(tz).formatToParts(new Date(ts))) p[part.type] = part.value;
  const z = Object.freeze({
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour) % 24,
    mi: Number(p.minute),
    s: Number(p.second),
    wd: WD[/** @type {keyof typeof WD} */ (p.weekday)],
  });
  if (zonedCache.size >= ZONED_CACHE_MAX) zonedCache.clear();
  zonedCache.set(key, z);
  return z;
}

/** @type {Map<string, Readonly<{y: number, m: number, d: number, h: number, mi: number, s: number, wd: number}>>} */
const zonedCache = new Map();
const ZONED_CACHE_MAX = 20_000;

const pad2 = (/** @type {number} */ n) => String(n).padStart(2, '0');

/** @param {number} ts @param {string} [tz] */
export function dayKey(ts, tz = DEFAULT_TZ) {
  const z = zoned(ts, tz);
  return `${z.y}-${pad2(z.m)}-${pad2(z.d)}`;
}

/**
 * Logical day of a moment: its local date, or the previous date if the local wall-clock time is
 * before `dayStart` minutes after midnight. Computed on wall-clock time, so DST nights are right.
 * @param {number} ts @param {string} [tz] @param {number} [dayStart] minutes after midnight
 */
export function logicalDay(ts, tz = DEFAULT_TZ, dayStart = 0) {
  const z = zoned(ts, tz);
  const key = `${z.y}-${pad2(z.m)}-${pad2(z.d)}`;
  return dayStart > 0 && z.h * 60 + z.mi < dayStart ? addDays(key, -1) : key;
}

/** @param {number} ts @param {string} [tz] */
export function timeOfDay(ts, tz = DEFAULT_TZ) {
  const z = zoned(ts, tz);
  return `${pad2(z.h)}:${pad2(z.mi)}`;
}

/** Offset of the zone to UTC in ms at time ts. @param {number} ts @param {string} tz */
export function tzOffset(ts, tz = DEFAULT_TZ) {
  const z = zoned(ts, tz);
  const asUtc = Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi, z.s);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/**
 * Local time → epoch. A time that does not exist (spring forward) moves forward,
 * a doubled time (fall back) takes the later one.
 * Tries the offsets in force a day before and a day after (transitions are months apart) and keeps
 * the candidate whose wall-clock time comes back unchanged; if both do (doubled) or none does (gap),
 * the later one. Works for negative and positive offsets and for transitions at midnight.
 * @param {number} y @param {number} m 1–12 @param {number} d @param {number} h @param {number} mi @param {string} [tz]
 */
export function zonedToEpoch(y, m, d, h, mi, tz = DEFAULT_TZ) {
  const wall = Date.UTC(y, m - 1, d, h, mi);
  const offsets = new Set([tzOffset(wall - 86_400_000, tz), tzOffset(wall, tz), tzOffset(wall + 86_400_000, tz)]);
  const all = [...offsets].map((o) => wall - o);
  const ok = all.filter((t) => tzOffset(t, tz) === wall - t);
  return Math.max(...(ok.length ? ok : all));
}

/** "YYYY-MM-DD" → {y,m,d} @param {string} key */
export function parseDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}

/** @param {string} key @param {number} n */
export function addDays(key, n) {
  const { y, m, d } = parseDay(key);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** 0 = Monday. @param {string} key */
export function weekday(key) {
  const { y, m, d } = parseDay(key);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Monday of the week. @param {string} key */
export function weekStart(key) {
  return addDays(key, -weekday(key));
}

/** ISO calendar week. @param {string} key */
export function isoWeek(key) {
  const thu = addDays(key, 3 - weekday(key));
  const { y } = parseDay(thu);
  const jan4 = `${y}-01-04`;
  const week1 = weekStart(jan4);
  const diff = (Date.UTC(...ymd(thu)) - Date.UTC(...ymd(week1))) / 86400_000;
  return { year: y, week: Math.floor(diff / 7) + 1 };
}

/** @param {string} key @returns {[number, number, number]} */
function ymd(key) {
  const { y, m, d } = parseDay(key);
  return [y, m - 1, d];
}

/** Days between two days (b - a). @param {string} a @param {string} b */
export function daysBetween(a, b) {
  return Math.round((Date.UTC(...ymd(b)) - Date.UTC(...ymd(a))) / 86400_000);
}

/** Duration as "H:MM". @param {number} ms */
export function formatDur(ms) {
  const neg = ms < 0;
  const total = Math.floor(Math.abs(ms) / MIN);
  const s = `${Math.floor(total / 60)}:${pad2(total % 60)}`;
  return neg ? `−${s}` : s;
}

/**
 * @typedef {{ id: string, ts: number, tz?: string, note?: string, del?: boolean, mod?: number }} Entry
 * @typedef {{ in: Entry, out: Entry|null, start: number, end: number|null, dur: number,
 *             day: string, status: 'ok'|'running'|'open' }} Pair
 * @typedef {{ day: string, pairs: Pair[], punches: Entry[], sum: number, open: boolean, running: boolean,
 *             absences?: Absence[], credit?: number }} Day
 *   sum = worked time; absences and credit are added by withAbsences()
 * @typedef {{ key: string, year: number, week: number, start: string, sum: number, credit: number, days: Day[] }} Week
 */

/** Timestamp cut to the whole minute (what HH:MM shows). @param {number} ts */
const minute = (ts) => Math.floor(ts / MIN) * MIN;

/** @param {Entry} a @param {Entry} b */
const byTime = (a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Punches by logical day (in each punch's tz), paired in order. Tombstones do not count.
 * «Today» (where an odd last punch runs until now) is judged in the device's zone `tz`, the same
 * way as on the start screen, also for punches made in another zone.
 * @param {Entry[]} entries @param {number} now @param {number} [dayStart] minutes after midnight
 * @param {string} [tz] device time zone
 * @returns {Day[]} newest first
 */
export function buildDays(entries, now, dayStart = 0, tz = DEFAULT_TZ) {
  const today = logicalDay(now, tz, dayStart);
  /** @type {Map<string, Entry[]>} */
  const byDay = new Map();
  for (const e of entries) {
    if (e.del || !Number.isFinite(e.ts)) continue;
    const k = logicalDay(e.ts, e.tz || DEFAULT_TZ, dayStart);
    let list = byDay.get(k);
    if (!list) byDay.set(k, (list = []));
    list.push(e);
  }
  /** @type {Day[]} */
  const days = [];
  for (const [day, list] of byDay) {
    list.sort(byTime);
    /** @type {Pair[]} */
    const pairs = [];
    for (let i = 0; i < list.length; i += 2) {
      const a = list[i];
      const b = list[i + 1] || null;
      if (b) {
        pairs.push({ in: a, out: b, start: a.ts, end: b.ts, dur: minute(b.ts) - minute(a.ts), day, status: 'ok' });
        continue;
      }
      // A logical day after the device's today (a punch made in a zone ahead of this one) is as
      // current as today: its odd last punch runs, it is not «open».
      const isToday = day >= today;
      if (isToday && now >= a.ts) pairs.push({ in: a, out: null, start: a.ts, end: null, dur: minute(now) - minute(a.ts), day, status: 'running' });
      else pairs.push({ in: a, out: null, start: a.ts, end: null, dur: 0, day, status: isToday ? 'running' : 'open' });
    }
    days.push({
      day,
      pairs,
      punches: list,
      sum: pairs.reduce((s, p) => s + p.dur, 0),
      open: pairs.some((p) => p.status === 'open'),
      running: pairs.some((p) => p.status === 'running'),
    });
  }
  return days.sort((a, b) => (a.day < b.day ? 1 : -1));
}

/**
 * One logical day for the start screen: its punches in order with in/out, its total and the days
 * before and after it. `day` = null (or anything outside the bounds) means today; days without
 * punches are ordinary days (browsing never skips them). Browsing goes back to `oldest` and forward to
 * today, or further to the newest day that has punches (a punch made in a zone ahead of the device's
 * can lie on a logical day after the device's today).
 * @param {Entry[]} entries
 * @param {number} now
 * @param {{ day?: string|null, dayStart?: number, tz?: string, oldest: string }} o
 *   tz = device zone (judges «today»), oldest = the oldest logical day the retention keeps
 * @returns {{ day: string, today: string, isToday: boolean, punches: { id: string, ts: number, tz: string, dir: 'in'|'out' }[],
 *   sum: number, running: boolean, prev: string|null, next: string|null }}
 */
export function dayView(entries, now, o) {
  const dayStart = o.dayStart || 0;
  const tz = o.tz || DEFAULT_TZ;
  const today = logicalDay(now, tz, dayStart);
  const oldest = o.oldest < today ? o.oldest : today;
  const newest = newestDay(entries, dayStart, today);
  const day = o.day && o.day >= oldest && o.day <= newest ? o.day : today;
  // Only this day's punches are paired (pairing is per day, so the result is the same as for all).
  const mine = entries.filter((e) => !e.del && Number.isFinite(e.ts) && logicalDay(e.ts, e.tz || DEFAULT_TZ, dayStart) === day);
  const d = buildDays(mine, now, dayStart, tz)[0];
  return {
    day,
    today,
    isToday: day === today,
    punches: d ? d.punches.map((e, i) => ({ id: e.id, ts: e.ts, tz: e.tz || DEFAULT_TZ, dir: /** @type {'in'|'out'} */ (i % 2 ? 'out' : 'in') })) : [],
    sum: d ? d.sum : 0,
    running: d ? d.running : false,
    prev: day > oldest ? addDays(day, -1) : null,
    next: day < newest ? addDays(day, 1) : null,
  };
}

/** The later of `today` and the newest logical day with a live punch. @param {Entry[]} entries @param {number} dayStart @param {string} today */
function newestDay(entries, dayStart, today) {
  let newest = today;
  for (const e of entries) {
    if (e.del || !Number.isFinite(e.ts)) continue;
    const k = logicalDay(e.ts, e.tz || DEFAULT_TZ, dayStart);
    if (k > newest) newest = k;
  }
  return newest;
}

/** All pairs, oldest first. @param {Entry[]} entries @param {number} now @param {number} [dayStart] */
export function buildPairs(entries, now, dayStart = 0, tz = DEFAULT_TZ) {
  return buildDays(entries, now, dayStart, tz)
    .reverse()
    .flatMap((d) => d.pairs);
}

/** Days by ISO week, newest first. @param {Day[]} days @returns {Week[]} */
export function groupWeeks(days) {
  /** @type {Map<string, Week>} */
  const map = new Map();
  for (const d of days) {
    const start = weekStart(d.day);
    let w = map.get(start);
    if (!w) {
      const { year, week } = isoWeek(d.day);
      map.set(start, (w = { key: start, year, week, start, sum: 0, credit: 0, days: [] }));
    }
    w.days.push(d);
    w.sum += d.sum;
    w.credit += d.credit || 0;
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}

/**
 * Direction of every punch ('in' | 'out') after pairing.
 * @param {Entry[]} entries @param {number} [dayStart] @returns {Map<string, 'in'|'out'>}
 */
export function directions(entries, dayStart = 0) {
  /** @type {Map<string, 'in'|'out'>} */
  const out = new Map();
  for (const d of buildDays(entries, 0, dayStart)) d.punches.forEach((p, i) => out.set(p.id, i % 2 === 0 ? 'in' : 'out'));
  return out;
}

/**
 * State for the start screen.
 * @param {Entry[]} entries @param {number} now @param {string} [tz] device time zone @param {number} [dayStart]
 * @param {string} [oldest] oldest logical day the retention keeps: older days are never reported as
 *   open (before the first sync of a session, expired records can still be on the device)
 */
export function currentState(entries, now, tz = DEFAULT_TZ, dayStart = 0, oldest = '') {
  const days = buildDays(entries, now, dayStart, tz);
  const today = logicalDay(now, tz, dayStart);
  // The current day: today, or a later logical day that holds the latest punch (made in a zone ahead).
  const current = days.filter((x) => x.day >= today);
  const latest = (/** @type {Day} */ x) => Math.max(...x.punches.map((p) => p.ts));
  const d = current.length ? current.reduce((a, b) => (latest(b) > latest(a) ? b : a)) : null;
  const running = d ? d.pairs.find((p) => p.status === 'running') || null : null;
  return {
    in: !!running,
    since: running ? running.start : null,
    today,
    todaySum: d ? d.sum : 0,
    punchesToday: d ? d.punches.length : 0,
    openDays: days.filter((x) => x.open && x.day < today && x.day >= oldest).map((x) => x.day).sort(),
  };
}

// ------------------------------------------------------------ nerd mode

/** Working days Mon–Fri between a and b (both included). @param {string} a @param {string} b */
export function workdays(a, b) {
  let n = 0;
  for (let k = a; k <= b; k = addDays(k, 1)) if (weekday(k) < 5) n++;
  return n;
}

/**
 * Balance = worked + absence credit − target, from max(period start, first day) up to and including
 * today. The first day is the oldest day with a punch or an absence. `credits` (creditByDay) is
 * optional: without it nothing is credited.
 * @param {Day[]} days @param {number} weekHours @param {string} periodStart @param {string} today
 * @param {Map<string, number>} [credits] day → credited ms
 */
export function balance(days, weekHours, periodStart, today, credits = new Map()) {
  let first = days.length ? days[days.length - 1].day : today;
  for (const k of credits.keys()) if (k < first) first = k;
  const from = first > periodStart ? first : periodStart;
  if (from > today) return { worked: 0, credit: 0, target: 0, diff: 0, from };
  const worked = days.filter((d) => d.day >= from && d.day <= today).reduce((s, d) => s + d.sum, 0);
  let credit = 0;
  for (const [k, ms] of credits) if (k >= from && k <= today) credit += ms;
  const target = workdays(from, today) * (weekHours / 5) * HOUR;
  return { worked, credit, target, diff: worked + credit - target, from };
}

/**
 * Weekly totals of the last n weeks (oldest first), empty weeks included; `credit` = the absence
 * credit of the week up to and including today.
 * @param {Day[]} days @param {string} today @param {number} n @param {Map<string, number>} [credits] day → ms
 */
export function weeklyHours(days, today, n, credits = new Map()) {
  const cur = weekStart(today);
  const sums = new Map();
  for (const d of days) {
    const ws = weekStart(d.day);
    sums.set(ws, (sums.get(ws) || 0) + d.sum);
  }
  const cred = new Map();
  for (const [k, ms] of credits) if (k <= today) cred.set(weekStart(k), (cred.get(weekStart(k)) || 0) + ms);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const ws = addDays(cur, -7 * i);
    out.push({ start: ws, week: isoWeek(ws).week, sum: sums.get(ws) || 0, credit: cred.get(ws) || 0 });
  }
  return out;
}

/** Same day n months later (negative: earlier), clamped to the month's last day. @param {string} key @param {number} n */
export function addMonths(key, n) {
  const { y, m, d } = parseDay(key);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${pad2(first.getUTCMonth() + 1)}-${pad2(Math.min(d, last))}`;
}

/**
 * Monthly totals of the last n calendar months (oldest first), empty months included, each with its
 * target (Mon–Fri × weekHours / 5, the current month up to and including today) and its absence
 * credit (up to and including today).
 * @param {Day[]} days @param {string} today @param {number} n @param {number} weekHours @param {Map<string, number>} [credits] day → ms
 * @returns {{ month: string, start: string, sum: number, credit: number, target: number }[]}
 */
export function monthlyHours(days, today, n, weekHours, credits = new Map()) {
  const sums = new Map();
  for (const d of days) {
    const mk = d.day.slice(0, 7);
    sums.set(mk, (sums.get(mk) || 0) + d.sum);
  }
  const cred = new Map();
  for (const [k, ms] of credits) if (k <= today) cred.set(k.slice(0, 7), (cred.get(k.slice(0, 7)) || 0) + ms);
  const out = [];
  const cur = `${today.slice(0, 7)}-01`;
  for (let i = n - 1; i >= 0; i--) {
    const start = addMonths(cur, -i);
    const end = addDays(addMonths(start, 1), -1);
    const month = start.slice(0, 7);
    const target = workdays(start, end < today ? end : today) * (weekHours / 5) * HOUR;
    out.push({ month, start, sum: sums.get(month) || 0, credit: cred.get(month) || 0, target });
  }
  return out;
}

/**
 * Averages, longest day, breaks (gaps between pairs), heatmap of punches (logical weekday × hour).
 * @param {Entry[]} entries @param {Day[]} days
 */
export function stats(entries, days) {
  const firsts = [], lasts = [], breaks = [];
  let longest = null;
  for (const d of days) {
    if (!d.punches.length) continue;
    const first = d.punches[0];
    const last = d.punches[d.punches.length - 1];
    const zf = zoned(first.ts, first.tz || DEFAULT_TZ);
    const zl = zoned(last.ts, last.tz || DEFAULT_TZ);
    // A punch on the next calendar date (night shift) counts as > 24 h, so averages stay right.
    const after = (/** @type {Entry} */ p, /** @type {{y:number,m:number,d:number}} */ z) =>
      `${z.y}-${pad2(z.m)}-${pad2(z.d)}` !== d.day ? 1440 : 0;
    firsts.push(zf.h * 60 + zf.mi + after(first, zf));
    lasts.push(zl.h * 60 + zl.mi + after(last, zl));
    const ok = d.pairs.filter((p) => p.status === 'ok');
    if (ok.length > 1) {
      let br = 0;
      for (let i = 1; i < ok.length; i++) br += minute(ok[i].start) - minute(/** @type {number} */ (ok[i - 1].end));
      breaks.push(br);
    }
    if (d.sum > 0 && (!longest || d.sum > longest.sum)) longest = { day: d.day, sum: d.sum };
  }
  const avg = (/** @type {number[]} */ a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  /** @type {number[][]} */
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const d of days) {
    for (const e of d.punches) heat[weekday(d.day)][zoned(e.ts, e.tz || DEFAULT_TZ).h]++;
  }
  return {
    avgFirst: avg(firsts),
    avgLast: avg(lasts),
    longest,
    avgBreak: avg(breaks),
    breakDays: breaks.length,
    workedDays: firsts.length,
    heat,
  };
}

/** Minutes since midnight → "HH:MM". @param {number|null} min */
export function minutesToClock(min) {
  if (min == null) return '–';
  const m = Math.round(min) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** "HH:MM" → minutes after midnight, or null. @param {string} time */
export function clockToMinutes(time) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(time));
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Calendar date of a punch entered for a logical day: with night shifts, a time before `dayStart`
 * belongs to the next calendar date (so it stays in that logical day).
 * @param {string} day logical day "YYYY-MM-DD" @param {string} time "HH:MM" @param {number} dayStart
 */
export function calendarDate(day, time, dayStart) {
  const min = clockToMinutes(time);
  return dayStart > 0 && min != null && min < dayStart ? addDays(day, 1) : day;
}

/** Target hours per week from user input ("42", "42.5", "42,5"); null if empty or not a number 0–80. @param {string} text */
export function parseHours(text) {
  const s = String(text ?? '').trim().replace(',', '.');
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(s)) return null;
  const v = Number(s);
  return v >= 0 && v <= 80 ? Math.round(v * 100) / 100 : null;
}

/**
 * Logical day "YYYY-MM-DD" + "HH:MM" in zone tz → epoch (with night shifts a time before the day
 * change lands on the next calendar date). null for incomplete input.
 * @param {string} day @param {string} time @param {string} tz @param {number} [dayStart]
 */
export function entryEpoch(day, time, tz, dayStart = 0) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || clockToMinutes(time) == null) return null;
  const { y, m, d } = parseDay(calendarDate(day, time, dayStart));
  const [hh, mm] = time.split(':').map(Number);
  return zonedToEpoch(y, m, d, hh, mm, tz);
}

/**
 * Time of a punch after the edit dialog. If date and time are what the dialog was opened with, the
 * original timestamp stays exactly as it was: a punch in a repeated hour (daylight saving ends) is not
 * moved by an hour when only the note changes. Otherwise the entered day and time count.
 * @param {{ ts: number } | null} original the punch being edited (null: a new one)
 * @param {{ day: string, time: string } | null} opened what the dialog showed when it opened
 * @param {string} day @param {string} time @param {string} tz @param {number} [dayStart]
 */
export function editedTs(original, opened, day, time, tz, dayStart = 0) {
  if (original && Number.isFinite(original.ts) && opened && opened.day === day && opened.time === time) return original.ts;
  return entryEpoch(day, time, tz, dayStart);
}

// ------------------------------------------------------------ absences

/**
 * An absence is a whole or half logical day off: vacation, sick, public holiday, other. It is its own
 * record (kind 'absence', see store.js); it never takes part in pairing. It credits the day's target
 * time: weekHours / 5 for a whole day, half of that for a half day, nothing on a Saturday or Sunday
 * (those have no target either).
 * @typedef {{ id: string, kind: 'absence', day: string, type: string, half?: boolean, note?: string, ts?: number, tz?: string }} Absence
 */
export const ABSENCE_TYPES = /** @type {const} */ (['vacation', 'sick', 'holiday', 'other']);

/** The stored type as one of ABSENCE_TYPES (unknown = other). @param {unknown} v */
export const absenceType = (v) => (ABSENCE_TYPES.includes(/** @type {any} */ (v)) ? /** @type {(typeof ABSENCE_TYPES)[number]} */ (v) : 'other');

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A valid day key "YYYY-MM-DD". @param {unknown} v */
export const isDayKey = (v) => typeof v === 'string' && DAY_KEY_RE.test(v) && addDays(v, 0) === v;

/** Credited time of one absence in ms. @param {{ day: string, half?: boolean }} a @param {number} weekHours */
export function absenceCredit(a, weekHours) {
  if (!isDayKey(a.day) || weekday(a.day) > 4) return 0;
  const h = Number(weekHours);
  return Number.isFinite(h) && h > 0 ? Math.round(((a.half ? 0.5 : 1) * h * HOUR) / 5) : 0;
}

/**
 * Credit per day. Two absences on one day (written on two devices at once) never credit more than
 * the larger of them.
 * @param {{ day: string, half?: boolean }[]} absences @param {number} weekHours @returns {Map<string, number>}
 */
export function creditByDay(absences, weekHours) {
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const a of absences) {
    const c = absenceCredit(a, weekHours);
    if (!isDayKey(a.day)) continue;
    out.set(a.day, Math.max(out.get(a.day) || 0, c));
  }
  return out;
}

/**
 * The days of the list: buildDays() plus the absences, each day with its `absences` and `credit`;
 * a day with an absence and no punch becomes an empty day. Newest first.
 * @param {Day[]} days @param {Absence[]} absences @param {number} weekHours @returns {Day[]}
 */
export function withAbsences(days, absences, weekHours) {
  /** @type {Map<string, Day>} */
  const map = new Map(days.map((d) => [d.day, { ...d, absences: [], credit: 0 }]));
  const credits = creditByDay(absences, weekHours);
  for (const a of absences) {
    if (!isDayKey(a.day)) continue;
    let d = map.get(a.day);
    if (!d) map.set(a.day, (d = { day: a.day, pairs: [], punches: [], sum: 0, open: false, running: false, absences: [], credit: 0 }));
    /** @type {Absence[]} */ (d.absences).push(a);
    d.credit = credits.get(a.day) || 0;
  }
  return [...map.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}

/**
 * The days an absence entry creates: the one day, or every Monday–Friday from `from` to `to` (both
 * included; a range over a weekend leaves the weekend out).
 * @param {string} from @param {string} [to]
 */
export function absenceDays(from, to) {
  if (!to || to === from) return [from];
  const out = [];
  for (let k = from; k <= to; k = addDays(k, 1)) if (weekday(k) < 5) out.push(k);
  return out;
}

// ------------------------------------------------------------ week and month sheets

/** The ISO week (Monday–Sunday) of a day. @param {string} key @returns {{ from: string, to: string }} */
export function weekRange(key) {
  const from = weekStart(key);
  return { from, to: addDays(from, 6) };
}

/** The calendar month of a day. @param {string} key @returns {{ from: string, to: string }} */
export function monthRange(key) {
  const from = `${key.slice(0, 7)}-01`;
  return { from, to: addDays(addMonths(from, 1), -1) };
}

/**
 * A printable sheet for a period: one row per calendar day (empty days included) and the totals.
 * The totals count up to and including today (a period that is not over yet: `partial`), the target
 * is weekHours / 5 per Monday–Friday of that span, the balance = worked + credit − target.
 * @param {Day[]} days from withAbsences() (newest first or in any order)
 * @param {string} from @param {string} to @param {string} today @param {number} weekHours
 */
export function periodSheet(days, from, to, today, weekHours) {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const rows = [];
  for (let k = from; k <= to; k = addDays(k, 1)) {
    const d = byDay.get(k);
    rows.push({
      day: k,
      wd: weekday(k),
      pairs: d ? d.pairs : [],
      absences: (d && d.absences) || [],
      worked: d ? d.sum : 0,
      credit: (d && d.credit) || 0,
      open: d ? d.open : false,
    });
  }
  const end = to < today ? to : today;
  const counted = rows.filter((r) => r.day <= end);
  const worked = counted.reduce((s, r) => s + r.worked, 0);
  const credit = counted.reduce((s, r) => s + r.credit, 0);
  const target = from <= end ? workdays(from, end) * (weekHours / 5) * HOUR : 0;
  return { from, to, rows, totals: { worked, credit, target, diff: worked + credit - target, end, partial: to > today } };
}
