// CSV import (importcsv.js): the own export round-trips, simple «date;time» files, quotes and BOM, and
// the plan (duplicates, future, too old, full days).
import { describe, it, expect } from 'vitest';
import { splitCsv, parseDate, parseTime, readCsv, planImport } from '../../public/js/importcsv.js';
import { zonedToEpoch } from '../../public/js/time.js';

const Z = 'Europe/Zurich';
const at = (/** @type {number} */ d, /** @type {number} */ h, /** @type {number} */ mi) => zonedToEpoch(2026, 11, d, h, mi, Z);

describe('reading', () => {
  it('fields: delimiter guessed, quotes and doubled quotes, CRLF, BOM, empty lines', () => {
    expect(splitCsv('﻿a;b;"c;d"\r\n\r\n1;"x ""y""";3\n')).toEqual([['a', 'b', 'c;d'], ['1', 'x "y"', '3']]);
    expect(splitCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(splitCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('dates and times in the usual Swiss and ISO forms', () => {
    expect(parseDate('2026-11-24')).toBe('2026-11-24');
    expect(parseDate('24.11.2026')).toBe('2026-11-24');
    expect(parseDate('4.1.26')).toBe('2026-01-04');
    expect(parseDate('31.02.2026')).toBeNull();
    expect(parseTime('7:30')).toBe(450);
    expect(parseTime('07:30:15')).toBe(450);
    expect(parseTime('24:00')).toBeNull();
  });

  it('Zeropunch’s own export: the calendar date and zone of each punch, absence rows left out', () => {
    const csv = [
      'Tag (zählt zu);Kalenderdatum;Zeit;Zeitzone;Notiz;Drin/draussen;Tagestotal;Abwesenheit;Gutschrift',
      '2026-11-24;2026-11-24;;Europe/Zurich;;;;Ferien;8:24',
      '2026-11-23;2026-11-23;22:00;Europe/Zurich;Nacht;drin;;;',
      '2026-11-23;2026-11-24;02:00;Europe/Zurich;;draussen;4:00;;',
    ].join('\r\n');
    const r = readCsv(csv);
    expect(r.punches.map((p) => [p.ts, p.note])).toEqual([[at(23, 22, 0), 'Nacht'], [at(24, 2, 0), '']]);
    expect(r.skipped).toBe(1);
    expect(r.unreadable).toEqual([]);
  });

  it('simple files: date and time in two fields or one, a note after; a header is fine, junk is reported', () => {
    const r = readCsv('Datum;Zeit;Notiz\n24.11.2026;07:30;früh\n2026-11-24 12:00\nkaputt;12\n', Z);
    expect(r.punches.map((p) => [p.ts, p.tz, p.note])).toEqual([[at(24, 7, 30), Z, 'früh'], [at(24, 12, 0), Z, '']]);
    expect(r.unreadable).toEqual([4]);
  });
});

describe('the plan', () => {
  const o = { now: at(28, 12, 0), oldestDay: '2025-10-28', dayStart: 0, maxPerDay: 12, placesTaken: () => 0 };
  const p = (/** @type {number} */ ts) => ({ ts, tz: Z, note: '' });

  it('duplicates (at the same minute, also within the file), future, too old', () => {
    const plan = planImport([p(at(24, 7, 30)), p(at(24, 7, 30) + 20_000), p(at(24, 8, 0)), p(at(29, 8, 0)), p(zonedToEpoch(2025, 1, 2, 8, 0, Z))], [{ ts: at(24, 8, 0) }], o);
    expect(plan.add.map((x) => x.ts)).toEqual([at(24, 7, 30)]);
    expect(plan).toMatchObject({ dup: 2, future: 1, old: 1, full: 0, days: 1 });
  });

  it('a day takes 12 places with what it already holds', () => {
    const many = Array.from({ length: 6 }, (_, i) => p(at(25, 8 + i, 0)));
    const plan = planImport(many, [], { ...o, placesTaken: (day) => (day === '2026-11-25' ? 9 : 0) });
    expect(plan.add).toHaveLength(3);
    expect(plan.full).toBe(3);
  });
});
