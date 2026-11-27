// CSV import for the nerd view, without the DOM: read punches from a file and plan what to add. All on
// the device: the file is never sent anywhere; the punches it adds are encrypted and synced like any.
//
// Formats read (a header row is optional; «;», «,» or tab between the fields; quotes as in RFC 4180):
//   - Zeropunch's own CSV export: calendar date, time and time zone of each punch row (absence rows,
//     which have no time, are left out)
//   - simple: a date and a time, in two fields or one («2026-11-24;07:30», «24.11.2026 07:30»); a
//     third field is taken as a note
// Dates as 2026-11-24 or 24.11.2026 (also 24.11.26); times as 7:30, 07:30 or 07:30:15.

import { zonedToEpoch, logicalDay, isDayKey, DEFAULT_TZ } from './time.js';

/** Split CSV text into rows of fields: quotes, doubled quotes, CRLF, a BOM; the delimiter is guessed. @param {string} text */
export function splitCsv(text) {
  const src = text.replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] || '';
  const count = (/** @type {string} */ c) => first.split(c).length - 1;
  const delim = count(';') >= count(',') && count(';') >= count('\t') ? ';' : count('\t') > count(',') ? '\t' : ',';
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

/** «2026-11-24», «24.11.2026», «24.11.26» → "YYYY-MM-DD", or null. @param {string} s */
export function parseDate(s) {
  const v = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  /** @type {string | null} */
  let key = null;
  if (m) key = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(v);
  if (m) key = `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return key && isDayKey(key) ? key : null;
}

/** «7:30», «07:30», «07:30:15» → minutes after midnight, or null. @param {string} s */
export function parseTime(s) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

/** A field that is a valid IANA time zone. @param {string} s */
function isZone(s) {
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+)+$|^UTC$/.test(s.trim())) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: s.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * The punches in a CSV text. Each row: its date and time (and zone and note where the format has them);
 * a row with a date but no time (an absence of the export) is skipped, a row without a date is a header
 * or not readable.
 * @param {string} text @param {string} [tz] the device's zone, for rows without one
 * @returns {{ punches: { ts: number, tz: string, note: string, line: number }[], unreadable: number[], skipped: number }}
 */
export function readCsv(text, tz = DEFAULT_TZ) {
  /** @type {{ ts: number, tz: string, note: string, line: number }[]} */
  const punches = [];
  /** @type {number[]} */
  const unreadable = [];
  let skipped = 0;
  splitCsv(text).forEach((raw, i) => {
    const line = i + 1;
    const f = raw.map((x) => x.trim());
    // One field «date time»: split it.
    if (f.length >= 1 && /\s/.test(f[0]) && parseDate(f[0].split(/\s+/)[0])) f.splice(0, 1, ...f[0].split(/\s+/).slice(0, 2));
    const dates = f.map(parseDate);
    const di = dates.findIndex(Boolean);
    if (di < 0) {
      if (i > 0) unreadable.push(line); // the first row may be a header
      return;
    }
    // Zeropunch's export: «day (counts to); calendar date; time; zone; note; …» → the calendar date.
    const second = dates[di + 1];
    const dateAt = second ? di + 1 : di;
    const day = /** @type {string} */ (dates[dateAt]);
    // The time is the field right after the date (in the export an absence row has none there, and its
    // credit further right must not pass for a time).
    const ti = dateAt + 1;
    if (f[ti] == null || parseTime(f[ti]) == null) {
      skipped++; // a date without a time: an absence row of the export
      return;
    }
    const min = /** @type {number} */ (parseTime(f[ti]));
    const zone = f[ti + 1] && isZone(f[ti + 1]) ? f[ti + 1] : tz;
    const noteAt = zone === f[ti + 1] ? ti + 2 : ti + 1;
    const note = (f[noteAt] || '').replace(/^'/, '').slice(0, 120);
    const [y, m, d] = day.split('-').map(Number);
    punches.push({ ts: zonedToEpoch(y, m, d, Math.floor(min / 60), min % 60, zone), tz: zone, note, line });
  });
  return { punches, unreadable, skipped };
}

/**
 * What an import would add: new punches only (one already there at the same minute is a duplicate, also
 * within the file), none in the future or older than kept, at most `maxPerDay` places a day together
 * with what the day already holds.
 * @param {{ ts: number, tz: string, note: string }[]} punches from readCsv
 * @param {{ ts: number, tz?: string }[]} existing the account's punches
 * @param {{ now: number, oldestDay: string, dayStart: number, maxPerDay: number, placesTaken: (day: string) => number }} o
 */
export function planImport(punches, existing, o) {
  const minuteOf = (/** @type {number} */ ts) => Math.floor(ts / 60_000);
  const have = new Set(existing.map((e) => minuteOf(e.ts)));
  /** @type {Map<string, number>} */
  const added = new Map();
  /** @type {{ ts: number, tz: string, note: string }[]} */
  const add = [];
  let dup = 0;
  let future = 0;
  let old = 0;
  let full = 0;
  for (const p of [...punches].sort((a, b) => a.ts - b.ts)) {
    if (have.has(minuteOf(p.ts))) {
      dup++;
      continue;
    }
    if (p.ts > o.now) {
      future++;
      continue;
    }
    const day = logicalDay(p.ts, p.tz, o.dayStart);
    if (day < o.oldestDay) {
      old++;
      continue;
    }
    const n = added.get(day) || 0;
    if (o.placesTaken(day) + n >= o.maxPerDay) {
      full++;
      continue;
    }
    added.set(day, n + 1);
    have.add(minuteOf(p.ts));
    add.push(p);
  }
  return { add, dup, future, old, full, days: added.size };
}
