// The list without the DOM: which rows and controls a day gets, and deleting a punch through a
// confirmation. Pure enough to test in Node (test/unit/listview.test.js); app.js turns it into elements.

import { t, tn, getLang } from './i18n.js';
import { timeOfDay, absenceType, absenceCredit, weekday, addDays, isHoliday, formatDur, DEFAULT_TZ } from './time.js';

/**
 * @typedef {{ kind: 'edit' | 'delete', aria: string }} Control
 * @typedef {{ dir: 'in' | 'out', entry: any | null, time: string, controls: Control[] }} PunchRow
 * @typedef {{ status: string, dur: number, rows: PunchRow[], notes: string[] }} PairBlock
 * @typedef {{ absence: any, label: string, credit: number, shown: string, note: string, cal: boolean, controls: Control[] }} AbsenceRow
 */

/**
 * «Vacation» / «Vacation · half day»; a day of the holiday calendar (holidays.js) by its name:
 * «Ascension Day», «Christmas Eve · half day».
 * @param {{ type: string, half?: boolean, name?: { de: string, en: string } }} a
 */
export function absenceLabel(a) {
  const name = a.name ? a.name[getLang()] || a.name.en : t(`abs_${absenceType(a.type)}`);
  return a.half ? t('abs_half_label', { name }) : name;
}

/**
 * The list leaves out a day of the holiday calendar that falls on a Saturday or Sunday: it credits
 * nothing and only takes room. Stored absences always stay.
 * @template {{ day: string, cal?: boolean }} A @param {A[]} absences @returns {A[]}
 */
export function withoutWeekendHolidays(absences) {
  return absences.filter((a) => !(a.cal && weekday(a.day) >= 5));
}

/** How far ahead the list shows the calendar's holidays (the funnel in the list; kept on the device). */
export const AHEAD_MODES = /** @type {const} */ (['none', '14', 'year']);
export const AHEAD_DEFAULT = '14';
/** A stored value as one of AHEAD_MODES. @param {unknown} v */
export const aheadMode = (v) => (AHEAD_MODES.includes(/** @type {any} */ (v)) ? /** @type {(typeof AHEAD_MODES)[number]} */ (v) : AHEAD_DEFAULT);

/**
 * The last day the list shows the calendar's holidays up to: today («none»), 14 days ahead, or the end
 * of the year (in its last two weeks: 14 days ahead, so «until the end of the year» never shows less).
 * Planned absences of your own always show.
 * @param {string} today @param {string} mode one of AHEAD_MODES
 */
export function aheadUntil(today, mode) {
  const m = aheadMode(mode);
  if (m === 'none') return today;
  const d14 = addDays(today, 14);
  if (m === '14') return d14;
  const end = `${today.slice(0, 4)}-12-31`;
  return end > d14 ? end : d14;
}

// ------------------------------------------------------------ day filters (the funnel)

const MIN = 60_000;
const HOUR = 60 * MIN;

// ------------------------------------------------------------ break rules (settings.pause)

/**
 * The break rules: after more than `h` hours of work at least `m` minutes of break; `piece` = the
 * shortest break that counts towards it (a longer break may be split into pieces of at least this).
 *   ch – Switzerland and Liechtenstein, ArG Art. 15 / ArGV 1 Art. 18: 15 min (5½ h), 30 min (7 h),
 *        one hour (9 h); 15 and 30 min in one piece, the hour in pieces of 30 min
 *   de – Germany, ArbZG § 4: 30 min (6 h), 45 min (9 h), in pieces of 15 min
 *   at – Austria, AZG § 11: 30 min (6 h), in pieces of 10 min
 * A custom rule has one or two steps, each in one piece. «off»: no rule (the filter finds nothing).
 * @typedef {{ steps: [number, number][], piece: number }} BreakRule  steps: [hours, minutes], ascending
 */
export const BREAK_RULES = /** @type {Record<string, BreakRule>} */ ({
  ch: { steps: [[5.5, 15], [7, 30], [9, 60]], piece: 30 },
  de: { steps: [[6, 30], [9, 45]], piece: 15 },
  at: { steps: [[6, 30]], piece: 10 },
  off: { steps: [], piece: 0 },
});

/**
 * settings.pause, one short string (the settings record has little room):
 *   ''            automatic: the rule of the holiday calendar's country (Switzerland without one)
 *   'ch' 'de' 'at' 'off'   a country's rule, or none
 *   '6-30' / '6-30,9-45'   a custom rule: after h hours (whole or half) m minutes, one or two steps
 * A leading '-' (e.g. '-', '-ch'): short breaks up to 15 min are paid, so steps of 15 min or less are
 * not checked. Anything else reads as automatic.
 * @param {unknown} v @returns {{ mode: 'auto' | 'ch' | 'de' | 'at' | 'off' | 'custom', steps: [number, number][], paid: boolean }}
 */
export function parsePause(v) {
  let s = typeof v === 'string' ? v : '';
  const paid = s.startsWith('-');
  if (paid) s = s.slice(1);
  if (s === '') return { mode: 'auto', steps: [], paid };
  if (s === 'ch' || s === 'de' || s === 'at' || s === 'off') return { mode: s, steps: [], paid };
  const steps = /** @type {[number, number][]} */ ([]);
  for (const part of s.split(',')) {
    const m = /^(\d{1,2}(?:\.5)?)-(\d{1,3})$/.exec(part);
    if (!m) return { mode: 'auto', steps: [], paid };
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 1 || h > 16 || min < 1 || min > 180) return { mode: 'auto', steps: [], paid };
    steps.push([h, min]);
  }
  if (steps.length > 2 || (steps.length === 2 && steps[1][0] <= steps[0][0])) return { mode: 'auto', steps: [], paid };
  return { mode: 'custom', steps, paid };
}

/** The short string for settings.pause. @param {{ mode: string, steps?: [number, number][], paid?: boolean }} p */
export function encodePause(p) {
  const body = p.mode === 'custom' ? (p.steps || []).map(([h, m]) => `${h}-${m}`).join(',') : p.mode === 'auto' ? '' : p.mode;
  return `${p.paid ? '-' : ''}${body}`;
}

/** The country rule of a holiday calendar key: CH-… and LI Swiss, DE… German, AT Austrian, US none. @param {string} cal */
export function countryRule(cal) {
  if (cal.startsWith('DE')) return 'de';
  if (cal === 'AT') return 'at';
  if (cal === 'US') return 'off';
  return 'ch';
}

/**
 * The rule in force: the chosen one, or the calendar's country; paid short breaks drop the steps of
 * 15 min or less. @param {unknown} pause settings.pause @param {string} cal settings.holidays
 * @returns {BreakRule & { key: string }}
 */
export function breakRule(pause, cal) {
  const p = parsePause(pause);
  const key = p.mode === 'auto' ? countryRule(String(cal || '')) : p.mode;
  const base = p.mode === 'custom' ? { steps: p.steps, piece: 0 } : BREAK_RULES[key];
  const steps = p.paid ? base.steps.filter(([, m]) => m > 15) : base.steps;
  return { key, steps, piece: base.piece };
}

/** The break a rule asks for after this much work (ms; 0: none). @param {number} worked @param {BreakRule} [rule] */
export function breakNeeded(worked, rule = BREAK_RULES.ch) {
  let need = 0;
  for (const [h, m] of rule.steps) if (worked > h * HOUR) need = m * MIN;
  return need;
}

/** A rule in words: «ab 5½ h 15 Min., ab 7 h 30 Min., ab 9 h 1 h, aufteilbar in Pausen ab 30 Min.»; '' without steps. @param {BreakRule} rule */
export function ruleText(rule) {
  if (!rule.steps.length) return '';
  const hours = (/** @type {number} */ h) => (h % 1 ? `${Math.floor(h)}½` : String(h));
  const mins = (/** @type {number} */ m) => (m % 60 === 0 ? `${m / 60} h` : `${m} ${t('pause_minutes')}`);
  const steps = rule.steps.map(([h, m]) => t('pause_step', { h: hours(h), m: mins(m) })).join(', ');
  return steps + (rule.piece ? t('pause_split', { m: rule.piece }) : t('pause_whole'));
}

/**
 * The break a day has that counts: the breaks between its pairs of at least `piece` (or the needed
 * break itself, when the rule has no smaller piece) added up.
 * @param {{ pairs: { start: number, end: number | null }[] }} d @param {number} need @param {BreakRule} rule
 */
export function breakTaken(d, need, rule) {
  const piece = rule.piece ? Math.min(need, rule.piece * MIN) : need;
  const done = d.pairs.filter((p) => p.end != null).sort((a, b) => a.start - b.start);
  let sum = 0;
  for (let i = 1; i < done.length; i++) {
    const gap = done[i].start - /** @type {number} */ (done[i - 1].end);
    if (gap >= piece) sum += gap;
  }
  return sum;
}

/**
 * The funnel's day filters: all days, or only the days that
 *   pause   – lack the break of the break rule in force (breakRule; Switzerland by default)
 *   open    – miss a punch (an odd number on a past day)
 *   rest    – started less than 11 h after the last punch of the day before (ArG Art. 15a)
 *   long    – have more than 10 h of work
 *   weekend – have work on a Saturday, a Sunday or a public holiday
 *   absent  – have an absence of your own (vacation, sick, time off in lieu, …)
 */
export const LIST_FILTERS = /** @type {const} */ (['all', 'pause', 'open', 'rest', 'long', 'weekend', 'absent']);
/** A value as one of LIST_FILTERS. @param {unknown} v */
export const listFilter = (v) => (LIST_FILTERS.includes(/** @type {any} */ (v)) ? /** @type {(typeof LIST_FILTERS)[number]} */ (v) : 'all');

/**
 * The days a filter keeps, in the given order. A day still running or missing a punch is left out of
 * «pause» (its break is not known yet).
 * @template {import('./time.js').Day} D @param {D[]} days @param {string} filter one of LIST_FILTERS
 * @param {BreakRule} [rule] for «pause» (breakRule), Swiss by default
 * @returns {D[]}
 */
export function filterDays(days, filter, rule = BREAK_RULES.ch) {
  const f = listFilter(filter);
  if (f === 'all') return days;
  if (f === 'rest') {
    /** @type {Set<string>} */
    const hit = new Set();
    let prevEnd = null;
    for (const d of [...days].sort((a, b) => (a.day < b.day ? -1 : 1))) {
      if (!d.pairs.length) continue;
      const first = Math.min(...d.pairs.map((p) => p.start));
      if (prevEnd != null && first - prevEnd < 11 * HOUR) hit.add(d.day);
      const ends = d.pairs.map((p) => p.end).filter((e) => e != null);
      if (ends.length) prevEnd = Math.max(.../** @type {number[]} */ (ends));
    }
    return days.filter((d) => hit.has(d.day));
  }
  return days.filter((d) => {
    const worked = d.pairs.length > 0;
    if (f === 'open') return d.open;
    if (f === 'long') return d.sum > 10 * HOUR;
    if (f === 'weekend') return worked && d.sum > 0 && (weekday(d.day) >= 5 || (d.absences || []).some(isHoliday));
    if (f === 'absent') return (d.absences || []).some((a) => !a.cal);
    // pause
    if (d.open || d.running) return false;
    const need = breakNeeded(d.sum, rule);
    return need > 0 && breakTaken(d, need, rule) < need;
  });
}

/**
 * The absence rows of a day (usually one): label, the credited time and a delete control. A day of the
 * holiday calendar is marked as such and has no delete control (it is no record: the settings choose it).
 * @param {import('./time.js').Day} d @param {number} weekHours @returns {AbsenceRow[]}
 */
export function absenceRows(d, weekHours) {
  return (d.absences || []).map((a) => {
    const label = absenceLabel(a);
    const cal = !!a.cal;
    /** @type {Control[]} */
    const controls = cal ? [] : [{ kind: 'delete', aria: t('delete_absence_aria', { what: label }) }];
    const credit = absenceCredit(a, weekHours);
    const dayTarget = absenceCredit({ day: a.day }, weekHours);
    /** @type {string} */
    let shown;
    if (isHoliday(a)) {
      // A holiday shows the day's target that is left (25 Dec: «Target 0:00», 24 Dec: «Target 4:12»).
      shown = t('target_left', { dur: formatDur(dayTarget - credit) });
    } else if (absenceType(a.type) === 'comp') {
      // Time off in lieu: what it takes from the balance, the target not worked, at most its share of
      // the day (a whole day −8:24; with 2 h worked −6:24; a half day at most −4:12).
      const share = a.half ? Math.round(dayTarget / 2) : dayTarget;
      const taken = Math.max(0, Math.min(share, dayTarget - (d.sum || 0)));
      shown = taken ? `−${formatDur(taken)}` : formatDur(0);
    } else shown = formatDur(credit); // vacation, sick, other: the time it credits
    return { absence: a, label, credit, shown, note: a.note || '', cal, controls };
  });
}

/**
 * Delete an absence from the list: ask first (naming day and kind), then write its tombstone, then tell.
 * @param {{ remove: (id: string) => Promise<any> }} store
 * @param {{ id: string, type: string, half?: boolean }} absence
 * @param {string} dayText the day as shown to people
 * @param {{ confirm: (title: string, text: string, opt: { ok: string }) => Promise<boolean>, toast: (msg: string) => void, message: (e: any) => string }} ui
 * @returns {Promise<boolean>} deleted
 */
export async function deleteAbsence(store, absence, dayText, ui) {
  const what = absenceLabel(absence);
  const ok = await ui.confirm(t('delete_absence_title'), t('delete_absence_text', { what, day: dayText }), { ok: t('delete') });
  if (!ok) return false;
  try {
    await store.remove(absence.id);
  } catch (e) {
    ui.toast(ui.message(e));
    return false;
  }
  ui.toast(t('absence_deleted', { what, day: dayText }));
  return true;
}

/**
 * One block per pair, one row per punch with an edit and a delete control. An unpaired last punch gets
 * a second row without entry (the «…» to add the missing punch on that day).
 * @param {import('./time.js').Day} d @returns {PairBlock[]}
 */
export function dayBlocks(d) {
  return d.pairs.map((p) => {
    /** @param {'in'|'out'} dir @param {any} e @returns {PunchRow} */
    const row = (dir, e) => {
      if (!e) return { dir, entry: null, time: '…', controls: [] };
      const time = timeOfDay(e.ts, e.tz || DEFAULT_TZ);
      return {
        dir,
        entry: e,
        time,
        controls: [
          { kind: 'edit', aria: t('edit_aria', { time }) },
          { kind: 'delete', aria: t('delete_aria', { time }) },
        ],
      };
    };
    return {
      status: p.status,
      dur: p.dur,
      rows: [row('in', p.in), row('out', p.out)],
      notes: [p.in?.note, p.out?.note].filter(Boolean),
    };
  });
}

/**
 * Delete one punch from the list: ask first (naming day and time), then write the tombstone, then tell.
 * @param {{ remove: (id: string) => Promise<any> }} store
 * @param {{ id: string, ts: number, tz?: string }} entry
 * @param {string} dayText the day as shown to people, e.g. «Mon 23 Nov»
 * @param {{ confirm: (title: string, text: string, opt: { ok: string }) => Promise<boolean>, toast: (msg: string) => void, message: (e: any) => string }} ui
 * @returns {Promise<boolean>} deleted
 */
export async function deletePunch(store, entry, dayText, ui) {
  const time = timeOfDay(entry.ts, entry.tz || DEFAULT_TZ);
  const ok = await ui.confirm(t('delete_punch_title'), t('delete_punch_text', { time, day: dayText }), { ok: t('delete') });
  if (!ok) return false;
  try {
    await store.remove(entry.id);
  } catch (e) {
    ui.toast(ui.message(e));
    return false;
  }
  ui.toast(t('punch_deleted', { time }));
  return true;
}

/**
 * Delete all punches of one day from the list: ask once (naming the day and the number), then write
 * the tombstones one after the other, then tell how many went.
 * @param {{ remove: (id: string) => Promise<any> }} store
 * @param {{ id: string }[]} punches the day's punches
 * @param {string} dayText the day as shown to people
 * @param {{ confirm: (title: string, text: string, opt: { ok: string }) => Promise<boolean>, toast: (msg: string) => void, message: (e: any) => string }} ui
 * @returns {Promise<number>} how many were deleted
 */
export async function deleteDay(store, punches, dayText, ui) {
  if (!punches.length) return 0;
  const ok = await ui.confirm(t('delete_day_title'), tn('delete_day_text', punches.length, { day: dayText }), { ok: t('delete') });
  if (!ok) return 0;
  let done = 0;
  try {
    for (const p of punches) {
      await store.remove(p.id);
      done++;
    }
  } catch (e) {
    ui.toast(ui.message(e));
    return done;
  }
  ui.toast(tn('day_deleted', done));
  return done;
}
