import { describe, it, expect, afterEach } from 'vitest';
import { dayBlocks, deletePunch, deleteDay, withoutWeekendHolidays, aheadUntil, aheadMode, filterDays, listFilter, breakNeeded, breakRule, parsePause, encodePause, ruleText } from '../../public/js/listview.js';
import { buildDays, zonedToEpoch, withAbsences } from '../../public/js/time.js';
import { setLang } from '../../public/js/i18n.js';

describe('the list: holidays ahead as the funnel says, none on a weekend', () => {
  it('a calendar day on a Saturday or Sunday is left out, a stored absence on a weekend stays', () => {
    const abs = [
      { day: '2026-12-25', cal: true }, // Friday
      { day: '2026-12-26', cal: true }, // Saturday
      { day: '2027-08-01', cal: true }, // Sunday
      { day: '2026-12-26', type: 'vacation' }, // stored: stays
    ];
    expect(withoutWeekendHolidays(abs)).toEqual([abs[0], abs[3]]);
  });

  it('none, 14 days (default) or to the end of the year, never less than 14 days', () => {
    expect(aheadUntil('2026-11-27', 'none')).toBe('2026-11-27');
    expect(aheadUntil('2026-11-27', '14')).toBe('2026-12-11');
    expect(aheadUntil('2026-11-27', 'year')).toBe('2026-12-31');
    expect(aheadUntil('2026-03-02', 'year')).toBe('2026-12-31');
    expect(aheadUntil('2026-12-24', 'year')).toBe('2027-01-07'); // the last two weeks: 14 days
    for (const v of [null, '', 'bogus', 7]) expect(aheadMode(v), String(v)).toBe('14');
    expect(aheadUntil('2026-11-27', 'bogus')).toBe('2026-12-11');
  });
});

describe('the funnel: day filters', () => {
  const Z = 'Europe/Zurich';
  let k = 0;
  /** Punches on a day of Nov 2026 at "HH:MM" times. @param {number} d @param {string[]} times */
  const punches = (d, times) => times.map((s) => ({ id: `p${++k}`, ts: zonedToEpoch(2026, 11, d, +s.slice(0, 2), +s.slice(3), Z), tz: Z }));
  const now = zonedToEpoch(2026, 11, 28, 12, 0, Z);
  const build = (/** @type {any[]} */ list, /** @type {any[]} */ abs = []) => withAbsences(buildDays(list, now, 0, Z), abs, 42);
  const keys = (/** @type {any[]} */ ds) => ds.map((d) => d.day).sort();

  it('break too short by the labour law: 7 h 40 with a 20-min lunch, 8 h straight; not 5 h straight, not a 30-min lunch', () => {
    const days = build([
      ...punches(16, ['07:30', '12:00', '12:20', '15:30']), // 7:50 h, 20 min: too short (needs 30)
      ...punches(17, ['08:00', '16:00']), // 8 h, no break at all
      ...punches(18, ['08:00', '13:00']), // 5 h: no break needed
      ...punches(19, ['07:30', '12:00', '12:30', '16:00']), // 8 h, 30 min: fine
      ...punches(20, ['07:00', '12:00', '12:30', '17:00']), // 9:30 h, 30 min: needs one hour
      ...punches(23, ['08:00']), // open: not judged
    ]);
    expect(keys(filterDays(days, 'pause'))).toEqual(['2026-11-16', '2026-11-17', '2026-11-20']);
    expect(breakNeeded(5.5 * 3_600_000)).toBe(0);
    expect(breakNeeded(5.5 * 3_600_000 + 60_000)).toBe(15 * 60_000);
  });

  it('a punch missing, rest under 11 h, over 10 h, weekend or holiday, absences', () => {
    const days = build(
      [
        ...punches(16, ['08:00', '22:30']), // 14:30 h: long
        ...punches(17, ['07:00', '12:00']), // starts 8:30 h after the 16th: rest too short
        ...punches(18, ['08:00']), // open
        ...punches(21, ['09:00', '11:00']), // Saturday
        ...punches(24, ['08:00', '12:00']), // a holiday (own absence of type holiday)
      ],
      [
        { id: 'h', kind: 'absence', day: '2026-11-24', type: 'holiday' },
        { id: 'v', kind: 'absence', day: '2026-11-25', type: 'vacation' },
        { id: 'c', kind: 'absence', day: '2026-11-26', cal: true, type: 'holiday' },
      ],
    );
    expect(keys(filterDays(days, 'open'))).toEqual(['2026-11-18']);
    expect(keys(filterDays(days, 'rest'))).toEqual(['2026-11-17']);
    expect(keys(filterDays(days, 'long'))).toEqual(['2026-11-16']);
    expect(keys(filterDays(days, 'weekend'))).toEqual(['2026-11-21', '2026-11-24']);
    expect(keys(filterDays(days, 'absent'))).toEqual(['2026-11-24', '2026-11-25']); // not the calendar's day
    expect(filterDays(days, 'all')).toBe(days);
    expect(listFilter('bogus')).toBe('all');
  });

  it('break rules: by country, own rules, paid short breaks; the stored string stays short', () => {
    // the country of the holiday calendar decides when the rule is automatic
    expect(breakRule('', 'CH-LU').key).toBe('ch');
    expect(breakRule('', '').key).toBe('ch');
    expect(breakRule('', 'LI').key).toBe('ch');
    expect(breakRule('', 'DE-BY').key).toBe('de');
    expect(breakRule('', 'AT').key).toBe('at');
    expect(breakRule('', 'US').steps).toEqual([]);
    expect(breakRule('de', 'CH-LU').key).toBe('de'); // chosen beats the calendar
    // paid short breaks: the 15-min step is not checked
    expect(breakRule('-ch', '').steps).toEqual([[7, 30], [9, 60]]);
    expect(breakRule('-', 'CH-ZH').steps).toEqual([[7, 30], [9, 60]]);
    // own rules: one or two steps, half hours, in one piece
    expect(parsePause('6-30')).toEqual({ mode: 'custom', steps: [[6, 30]], paid: false });
    expect(parsePause('-5.5-15,9.5-60')).toEqual({ mode: 'custom', steps: [[5.5, 15], [9.5, 60]], paid: true });
    for (const bad of ['6-30,5-15', '6-30,7-30,9-60', '0-30', '6-0', '6.3-30', 'x', 7]) expect(parsePause(bad).mode, String(bad)).toBe('auto');
    expect(encodePause({ mode: 'custom', steps: [[6, 30], [9, 45]], paid: true })).toBe('-6-30,9-45');
    expect(encodePause({ mode: 'auto', paid: false })).toBe('');
    expect(encodePause({ mode: 'at', paid: true })).toBe('-at');
    expect(breakRule('6-30', '').steps).toEqual([[6, 30]]);
    setLang('de');
    expect(ruleText(breakRule('', 'CH-LU'))).toBe('ab 5½ h 15 Min., ab 7 h 30 Min., ab 9 h 1 h, aufteilbar in Pausen ab 30 Min.');
    expect(ruleText(breakRule('6-30', ''))).toBe('ab 6 h 30 Min., am Stück');
    expect(ruleText(breakRule('off', ''))).toBe('');
  });

  it('the filter follows the rule: Germany counts 2 × 15 min, Switzerland wants 30 min in one piece; an own rule from 6 h', () => {
    const days = build([
      ...punches(16, ['07:30', '10:00', '10:15', '12:15', '12:30', '15:45']), // 7:45 h, two breaks of 15 min
      ...punches(17, ['08:00', '14:10']), // 6:10 h straight
    ]);
    expect(keys(filterDays(days, 'pause', breakRule('ch', '')))).toEqual(['2026-11-16', '2026-11-17']);
    expect(keys(filterDays(days, 'pause', breakRule('de', '')))).toEqual(['2026-11-17']);
    expect(keys(filterDays(days, 'pause', breakRule('-ch', '')))).toEqual(['2026-11-16']); // 6:10 h: only the paid 15 min due
    expect(keys(filterDays(days, 'pause', breakRule('6-30', '')))).toEqual(['2026-11-16', '2026-11-17']);
    expect(keys(filterDays(days, 'pause', breakRule('off', '')))).toEqual([]);
  });
});


const TZ = 'Europe/Zurich';
const at = (h, m) => zonedToEpoch(2026, 11, 23, h, m, TZ);
const entries = [
  { id: 'a', ts: at(8, 2), tz: TZ },
  { id: 'b', ts: at(12, 1), tz: TZ },
  { id: 'c', ts: at(12, 48), tz: TZ, note: 'Büro' },
];
const day = () => buildDays(entries, zonedToEpoch(2026, 11, 24, 12, 0, TZ), 0, TZ)[0];

afterEach(() => setLang('en'));

describe('list: one edit and one delete control per punch', () => {
  it('builds pair blocks with a row per punch and the right labels (EN)', () => {
    setLang('en');
    const blocks = dayBlocks(day());
    expect(blocks).toHaveLength(2);
    const rows = blocks.flatMap((b) => b.rows).filter((r) => r.entry);
    expect(rows.map((r) => r.time)).toEqual(['08:02', '12:01', '12:48']);
    expect(rows.map((r) => r.dir)).toEqual(['in', 'out', 'in']);
    for (const r of rows) {
      expect(r.controls.map((c) => c.kind)).toEqual(['edit', 'delete']);
      expect(r.controls[0].aria).toBe(`Edit punch ${r.time}`);
      expect(r.controls[1].aria).toBe(`Delete punch ${r.time}`);
    }
    // the unpaired last punch (a past day: open) gets an empty second row without controls
    expect(blocks[1].status).toBe('open');
    expect(blocks[1].rows[1]).toMatchObject({ entry: null, controls: [] });
    expect(blocks[1].notes).toEqual(['Büro']);
  });

  it('German labels', () => {
    setLang('de');
    const r = dayBlocks(day())[0].rows[0];
    expect(r.controls.map((c) => c.aria)).toEqual(['Punch 08:02 bearbeiten', 'Punch 08:02 löschen']);
  });
});

describe('list: delete goes through the confirmation', () => {
  /** @param {boolean} answer */
  function fakes(answer) {
    const log = { confirm: [], removed: [], toasts: [] };
    const store = { remove: async (id) => void log.removed.push(id) };
    const ui = {
      confirm: async (title, text, opt) => (log.confirm.push({ title, text, opt }), answer),
      toast: (m) => log.toasts.push(m),
      message: () => 'error',
    };
    return { log, store, ui };
  }

  it('cancel: nothing is deleted', async () => {
    setLang('en');
    const { log, store, ui } = fakes(false);
    expect(await deletePunch(store, entries[1], 'Mon 23 Nov', ui)).toBe(false);
    expect(log.removed).toEqual([]);
    expect(log.confirm[0].text).toBe('Delete punch 12:01 on Mon 23 Nov? The day is paired anew.');
    expect(log.confirm[0].opt).toEqual({ ok: 'Delete' }); // a plain confirmation, no typed word
  });

  it('confirm: tombstone via store.remove, then a toast', async () => {
    setLang('de');
    const { log, store, ui } = fakes(true);
    expect(await deletePunch(store, entries[1], 'Mo., 23. Nov.', ui)).toBe(true);
    expect(log.removed).toEqual(['b']);
    expect(log.confirm[0].title).toBe('Punch löschen?');
    expect(log.confirm[0].text).toBe('Punch 12:01 am Mo., 23. Nov. löschen? Der Tag wird neu gepaart.');
    expect(log.toasts).toEqual(['Punch 12:01 gelöscht.']);
  });

  it('a failing delete shows the error instead', async () => {
    const { log, ui } = fakes(true);
    const store = { remove: async () => { throw new Error('too_old'); } };
    expect(await deletePunch(store, entries[0], 'x', ui)).toBe(false);
    expect(log.toasts).toEqual(['error']);
  });
});

describe('list: delete a whole day', () => {
  const ui = (answer) => {
    const log = { confirm: [], toasts: [], removed: [] };
    return { log, store: { remove: async (id) => void log.removed.push(id) }, ui: { confirm: async (title, text, opt) => (log.confirm.push({ title, text, opt }), answer), toast: (m) => log.toasts.push(m), message: () => 'error' } };
  };

  it('asks once with day and number, then removes every punch of that day', async () => {
    setLang('de');
    const f = ui(true);
    expect(await deleteDay(f.store, entries, 'Mo., 23. Nov.', f.ui)).toBe(3);
    expect(f.log.confirm).toHaveLength(1);
    expect(f.log.confirm[0].text).toBe('Alle 3 Punches vom Mo., 23. Nov. löschen?');
    expect(f.log.removed).toEqual(['a', 'b', 'c']);
    expect(f.log.toasts).toEqual(['3 Punches gelöscht.']);
  });

  it('cancel removes nothing; an empty day asks nothing', async () => {
    setLang('en');
    const f = ui(false);
    expect(await deleteDay(f.store, entries, 'Mon 23 Nov', f.ui)).toBe(0);
    expect(f.log.removed).toEqual([]);
    expect(await deleteDay(f.store, [], 'Mon 23 Nov', f.ui)).toBe(0);
    expect(f.log.confirm).toHaveLength(1);
  });

  it('stops at the first failure and reports how far it got', async () => {
    const f = ui(true);
    let n = 0;
    const store = { remove: async () => { if (++n === 2) throw new Error('daily'); } };
    expect(await deleteDay(store, entries, 'x', f.ui)).toBe(1);
    expect(f.log.toasts).toEqual(['error']);
  });
});
