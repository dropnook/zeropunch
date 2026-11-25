// The hero demo's logic, without the DOM: the fixed times, pairing, totals, day browsing and reset.
// Pure functions on a small state { n, view }: n = punches made (0–13), view = the day shown (null = the
// demo's today). The punches pair up strictly in order: 1st in, 2nd out, 3rd in, … A pair counts whole
// minutes (as the app's formatDur) and belongs to the day it started on, like a night shift in the app:
// time 0 → time 1 is one long shift of 128:39 h on 3 Jan 2009, although time 1 falls on 9 Jan. The
// last odd punch runs until now. Every time is UTC wall-clock time, shown the same for every visitor.

/** The demo's thirteen fixed times: the 1st punch carries the first, every further punch the next one. */
export const TIMES = Object.freeze(
  [
    '2009-01-03T18:15:05Z',
    '2009-01-09T02:54:25Z',
    '2009-01-09T02:55:44Z',
    '2009-01-09T03:02:53Z',
    '2009-01-09T03:16:28Z',
    '2009-01-09T03:23:48Z',
    '2009-01-09T03:29:49Z',
    '2009-01-09T03:39:29Z',
    '2009-01-09T03:45:43Z',
    '2009-01-09T03:54:39Z',
    '2009-01-09T04:05:52Z',
    '2009-01-09T04:12:40Z',
    '2009-01-09T04:21:28Z',
  ].map((s) => Date.parse(s)),
);

const MIN = 60_000;
const p2 = (/** @type {number} */ n) => String(n).padStart(2, '0');
const minute = (/** @type {number} */ ts) => Math.floor(ts / MIN) * MIN;

/** "YYYY-MM-DD" of a timestamp, in UTC. @param {number} ts */
export const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10);
/** "HH:MM" in UTC. @param {number} ts */
export const hm = (ts) => new Date(ts).toISOString().slice(11, 16);
/** "HH:MM:SS" in UTC. @param {number} ts */
export const hms = (ts) => new Date(ts).toISOString().slice(11, 19);
/** "6:52" from milliseconds (whole minutes), as the app's formatDur. @param {number} ms */
export const dur = (ms) => {
  const m = Math.max(0, Math.floor(ms / MIN));
  return `${Math.floor(m / 60)}:${p2(m % 60)}`;
};

const DATE = {
  en: { wd: 'Sun,Mon,Tue,Wed,Thu,Fri,Sat', mo: 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec' },
  de: { wd: 'So.,Mo.,Di.,Mi.,Do.,Fr.,Sa.', mo: 'Jan.,Feb.,März,Apr.,Mai,Juni,Juli,Aug.,Sept.,Okt.,Nov.,Dez.' },
};
/** «Sat 3 Jan 2009» / «Sa., 3. Jan. 2009» (the app's long date, with the year). @param {string} day @param {'en'|'de'} lang */
export function longDate(day, lang) {
  const d = new Date(`${day}T12:00:00Z`);
  const f = DATE[lang] || DATE.en;
  const wd = f.wd.split(',')[d.getUTCDay()];
  const mo = f.mo.split(',')[d.getUTCMonth()];
  return lang === 'de' ? `${wd}, ${d.getUTCDate()}. ${mo} ${d.getUTCFullYear()}` : `${wd} ${d.getUTCDate()} ${mo} ${d.getUTCFullYear()}`;
}

/** @typedef {{ n: number, view: string | null }} State */

/** @returns {State} */
export const initial = () => ({ n: 0, view: null });

/** The punches made so far. @param {State} st */
export const punches = (st) => TIMES.slice(0, st.n);

/** The time the demo clock started from: the last punch, or the first time before the first punch. @param {State} st */
export const base = (st) => TIMES[Math.max(0, st.n - 1)];

/** The demo clock: `base` plus the real time since then (ms). @param {State} st @param {number} elapsed */
export const now = (st, elapsed) => base(st) + Math.max(0, elapsed);

/** The day punch i counts to: the day its pair started on. @param {number} i index into TIMES */
export const dayOfPunch = (i) => dayOf(TIMES[i - (i % 2)]);

/** The demo's today: the day the last punch counts to (the first time's day before the first punch). @param {State} st */
export const today = (st) => dayOfPunch(Math.max(0, st.n - 1));

/** Days that have punches, plus today, oldest first: browsing goes through these (empty days between are skipped). @param {State} st */
export function days(st) {
  const set = new Set(punches(st).map((_, i) => dayOfPunch(i)));
  set.add(today(st));
  return [...set].sort();
}

/** One day: its punches in order with in/out, the total, and whether its last punch runs. @param {State} st @param {string} day @param {number} nowTs */
export function dayInfo(st, day, nowTs) {
  const list = punches(st).filter((_, i) => dayOfPunch(i) === day);
  const isToday = day === today(st);
  let sum = 0;
  for (let i = 0; i < list.length; i += 2) {
    if (i + 1 < list.length) sum += minute(list[i + 1]) - minute(list[i]);
    else if (isToday && nowTs >= list[i]) sum += minute(nowTs) - minute(list[i]);
  }
  const odd = list.length % 2 === 1;
  return {
    day,
    isToday,
    // plus: calendar days after `day` (the second time closes the 3 Jan shift six days later)
    punches: list.map((ts, i) => ({ ts, time: hm(ts), dir: /** @type {'in'|'out'} */ (i % 2 ? 'out' : 'in'), plus: Math.round((Date.parse(dayOf(ts)) - Date.parse(day)) / 86_400_000) })),
    sum,
    running: odd && isToday,
  };
}

/** The day shown, with its neighbours for ‹ ›. @param {State} st @param {number} nowTs */
export function view(st, nowTs) {
  const all = days(st);
  const day = st.view && all.includes(st.view) ? st.view : today(st);
  const i = all.indexOf(day);
  return { ...dayInfo(st, day, nowTs), prev: i > 0 ? all[i - 1] : null, next: i < all.length - 1 ? all[i + 1] : null };
}

/** The status line and today's total. @param {State} st @param {number} nowTs */
export function status(st, nowTs) {
  const d = dayInfo(st, today(st), nowTs);
  const last = d.punches[d.punches.length - 1];
  return {
    in: d.running,
    since: d.running ? last.time : null,
    todaySum: d.sum,
    punchesToday: d.punches.length,
    full: st.n >= TIMES.length,
  };
}

/** One day back (-1) or forward (+1), or back to today (0); at a bound nothing changes. @param {State} st @param {-1|0|1} dir @returns {State} */
export function step(st, dir) {
  if (dir === 0) return { ...st, view: null };
  const v = view(st, base(st));
  const target = dir < 0 ? v.prev : v.next;
  if (!target) return st;
  return { ...st, view: target === today(st) ? null : target };
}

/**
 * A tap on «Punch in/out»: the next fixed time. The view goes back to today, as in the app.
 * After the 13th tap the times are used up and nothing happens: `punch` is null.
 * @param {State} st @returns {{ state: State, punch: null | { ts: number, time: string, dir: 'in'|'out', day: string } }}
 */
export function tap(st) {
  if (status(st, base(st)).full) return { state: st, punch: null };
  const next = { n: st.n + 1, view: null };
  const ts = TIMES[st.n];
  return { state: next, punch: { ts, time: hm(ts), dir: /** @type {'in'|'out'} */ (st.n % 2 ? 'out' : 'in'), day: dayOfPunch(st.n) } };
}

/** «Start again». @returns {State} */
export const reset = () => initial();

// ------------------------------------------------------------ texts

/**
 * Texts of the demo, by page language. Where the app says the same thing, the wording is the app's
 * (public/js/i18n.js, same key; test/unit/demo.test.js compares them). Swiss spelling: ss, «».
 */
export const TEXTS = {
  en: {
    today: 'Today',
    state_in: 'In since {time} · {dur} h',
    state_out: 'Out · today {dur} h',
    state_none: 'No punch yet today',
    punched: 'Punch {time} · {dir}',
    dir_in: 'in',
    dir_out: 'out',
    punch_inout: 'Punch in/out',
    dayview_aria: 'Punches of one day. Swipe sideways or use the arrow keys for other days.',
    day_prev: 'Previous day',
    day_next: 'Next day',
    back_today: 'Back to today',
    day_empty: 'No punches',
    nav: 'Main navigation',
    tab_start: 'Start',
    tab_list: 'List',
    tab_nerd: 'Nerd',
    tab_settings: 'Settings',
    // demo only
    demo: 'Demo',
    phone_aria: 'Try it: the Zeropunch start screen',
    chip: '{time}, {dir}',
    badge_plus: '+{n} d',
    demo_done: 'That was the demo.',
    restart: 'Start again',
    caption: 'Demo – nothing is stored.',
    try_me: 'This is a demo, tap me!',
  },
  de: {
    today: 'Heute',
    state_in: 'Drin seit {time} · {dur} h',
    state_out: 'Draussen · heute {dur} h',
    state_none: 'Heute noch kein Punch',
    punched: 'Punch {time} · {dir}',
    dir_in: 'drin',
    dir_out: 'draussen',
    punch_inout: 'Punch in/out',
    dayview_aria: 'Punches eines Tages. Zur Seite wischen oder Pfeiltasten für andere Tage.',
    day_prev: 'Vorheriger Tag',
    day_next: 'Nächster Tag',
    back_today: 'Zurück zu heute',
    day_empty: 'Keine Punches',
    nav: 'Hauptnavigation',
    tab_start: 'Start',
    tab_list: 'Liste',
    tab_nerd: 'Nerd',
    tab_settings: 'Einstellungen',
    demo: 'Demo',
    phone_aria: 'Zum Ausprobieren: der Startbildschirm von Zeropunch',
    chip: '{time}, {dir}',
    badge_plus: '+{n} T',
    demo_done: 'Das war die Demo.',
    restart: 'Nochmals von vorn',
    caption: 'Demo – nichts wird gespeichert.',
    try_me: 'Hier Demo, klick mich!',
  },
};

/** A text with {placeholders}. @param {'en'|'de'} lang @param {string} key @param {Record<string, string|number>} [params] */
export function text(lang, key, params = {}) {
  const dict = /** @type {Record<string, string>} */ (TEXTS[lang] || TEXTS.en);
  return dict[key].replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}
