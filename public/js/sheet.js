// Week and month sheets for printing: the periods to choose from and the sheet itself (a table, one
// row per day). The numbers come from time.js periodSheet(); this module only lays them out. The print
// layout (A4 portrait, black on white, no app chrome) is the @media print part of app.css.

import { h } from './dom.js';
import { t, locale, num, APP_NAME } from './i18n.js';
import { addDays, addMonths, weekRange, monthRange, isoWeek, parseDay, timeOfDay, formatDur, minutesToClock, DEFAULT_TZ } from './time.js';
import { absenceLabel } from './listview.js';

/** @typedef {'week' | 'month'} SheetKind */

/** A day key as a Date at noon UTC (for Intl, which then never slips a day). @param {string} key */
const noon = (key) => {
  const { y, m, d } = parseDay(key);
  return Date.UTC(y, m - 1, d, 12);
};

/** @param {string} key @param {Intl.DateTimeFormatOptions} opt */
const fmt = (key, opt) => new Intl.DateTimeFormat(locale(), { ...opt, timeZone: 'UTC' }).format(noon(key));

/** «23 Nov 2026 – 29 Nov 2026» shortened to «23–29 Nov 2026» where the parts agree. @param {string} from @param {string} to */
export function rangeText(from, to) {
  try {
    return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).formatRange(noon(from), noon(to));
  } catch {
    return `${fmt(from, { day: 'numeric', month: 'short', year: 'numeric' })} – ${fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
}

/** «November 2026». @param {string} key */
export const monthText = (key) => fmt(key, { month: 'long', year: 'numeric' });

/**
 * The periods to choose from, newest first: every ISO week or calendar month from the one holding
 * `newest` back to the one holding `oldest` (the retention's oldest day).
 * @param {SheetKind} kind @param {string} newest @param {string} oldest
 * @returns {{ from: string, to: string, label: string }[]}
 */
export function periodOptions(kind, newest, oldest) {
  const out = [];
  if (kind === 'week') {
    for (let r = weekRange(newest); r.to >= oldest; r = weekRange(addDays(r.from, -7))) {
      out.push({ ...r, label: `${t('week', { n: isoWeek(r.from).week })} · ${rangeText(r.from, r.to)}` });
    }
  } else {
    for (let r = monthRange(newest); r.to >= oldest; r = monthRange(addMonths(r.from, -1))) out.push({ ...r, label: monthText(r.from) });
  }
  return out;
}

/** The sheet's heading. @param {SheetKind} kind @param {string} from */
export function sheetHeading(kind, from) {
  if (kind === 'week') {
    const { year, week } = isoWeek(from);
    return t('sheet_h_week', { n: week, year });
  }
  return t('sheet_h_month', { month: monthText(from) });
}

/** In–out pairs of a day as text: «08:02–12:01, 12:48–…». @param {import('./time.js').Pair[]} pairs */
export function pairsText(pairs) {
  return pairs
    .map((p) => {
      const a = timeOfDay(p.in.ts, p.in.tz || DEFAULT_TZ);
      const b = p.out ? timeOfDay(p.out.ts, p.out.tz || DEFAULT_TZ) : '…';
      return `${a}–${b}`;
    })
    .join(', ');
}

/** Signed duration «+1:30» / «−0:45». @param {number} ms */
const signed = (ms) => (ms >= 0 ? `+${formatDur(ms)}` : formatDur(ms));

/**
 * The sheet as elements.
 * @param {ReturnType<typeof import('./time.js').periodSheet>} sheet
 * @param {{ kind: SheetKind, username: string, weekHours: number, dayStart: number, today: string }} o
 */
export function renderSheet(sheet, o) {
  const tot = sheet.totals;
  const meta = [t('sheet_user', { user: o.username }), t('sheet_target', { h: num(o.weekHours) })];
  if (o.dayStart > 0) meta.push(t('sheet_night', { time: minutesToClock(o.dayStart) }));
  const cell = (/** @type {string} */ tag, /** @type {string} */ cls, /** @type {any} */ v) => h(tag, { class: cls }, v);
  return h(
    'article',
    { class: 'paper' },
    h(
      'header',
      { class: 'pp-head' },
      h('h1', {}, sheetHeading(o.kind, sheet.from)),
      h('p', { class: 'pp-range' }, rangeText(sheet.from, sheet.to)),
      h('p', { class: 'pp-meta' }, meta.join(' · ')),
    ),
    h(
      'table',
      { class: 'pp-table' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          cell('th', 'pp-date', t('date')),
          cell('th', 'pp-wd', t('sheet_c_day')),
          cell('th', 'pp-times', t('sheet_c_times')),
          cell('th', 'pp-abs', t('csv_absence')),
          cell('th', 'pp-num', t('sheet_c_total')),
        ),
      ),
      h(
        'tbody',
        {},
        sheet.rows.map((r) => {
          const total = r.worked + r.credit;
          const has = r.pairs.length || r.absences.length;
          return h(
            'tr',
            { class: [r.wd > 4 && 'pp-we', r.day === o.today && 'pp-today', r.open && 'pp-open'] },
            cell('td', 'pp-date', fmt(r.day, { day: 'numeric', month: 'numeric' })),
            cell('td', 'pp-wd', fmt(r.day, { weekday: 'short' })),
            cell('td', 'pp-times', pairsText(r.pairs)),
            cell('td', 'pp-abs', r.absences.map((a) => absenceLabel(a)).join(', ')),
            cell('td', 'pp-num', has ? formatDur(total) : ''),
          );
        }),
      ),
    ),
    h(
      'dl',
      { class: 'pp-totals' },
      h('dt', {}, t('sheet_worked')),
      h('dd', {}, `${formatDur(tot.worked)} h`),
      h('dt', {}, t('sheet_credit')),
      h('dd', {}, `${formatDur(tot.credit)} h`),
      h('dt', {}, t('sheet_soll')),
      h('dd', {}, `${formatDur(tot.target)} h`),
      h('dt', { class: 'pp-bal' }, t('sheet_balance')),
      h('dd', { class: 'pp-bal' }, `${signed(tot.diff)} h`),
    ),
    tot.partial ? h('p', { class: 'pp-note' }, t('sheet_partial', { date: fmt(tot.end, { day: 'numeric', month: 'long', year: 'numeric' }) })) : null,
    h('p', { class: 'pp-note' }, t('sheet_created', { date: fmt(o.today, { day: 'numeric', month: 'long', year: 'numeric' }), app: APP_NAME })),
  );
}
