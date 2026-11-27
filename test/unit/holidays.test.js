// Public-holiday calendars (holidays.js): the rule engine, the data, the credit they give (time.js) and
// how they show (listview.js), the settings record that holds the choice, and that the module stays lazy.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { holidays, holidayAbsences, easter, ruleDay, calendarKey, calendarGroups, CALENDAR_KEYS } from '../../public/js/holidays.js';
import { creditByDay, offByDay, withAbsences, workdays, balance, periodSheet } from '../../public/js/time.js';
import { absenceRows, absenceLabel } from '../../public/js/listview.js';
import { DEFAULT_SETTINGS, FX_NAMES } from '../../public/js/store.js';
import { jsonSize, PLAINTEXT_SIZE } from '../../public/js/crypto.js';
import { setLang } from '../../public/js/i18n.js';

const root = new URL('../../', import.meta.url).pathname;
const read = (/** @type {string} */ p) => readFileSync(join(root, p), 'utf8');
const H = 3600_000;

/** The days of a calendar in a span: "YYYY-MM-DD" with «/2» for a half day. */
const days = (/** @type {string} */ cal, /** @type {string} */ from, /** @type {string} */ to) => holidays(cal, from, to).map((h) => (h.half ? `${h.day}/2` : h.day));
const year = (/** @type {string} */ cal, /** @type {number} */ y) => days(cal, `${y}-01-01`, `${y}-12-31`);
/** The name of the holiday a calendar has on a day (English), or undefined. */
const nameOn = (/** @type {string} */ cal, /** @type {string} */ day) => holidays(cal, day, day)[0]?.en;

afterEach(() => setLang('en'));

describe('rule engine', () => {
  it('Gregorian Easter Sunday', () => {
    const known = { 2000: '2000-04-23', 2008: '2008-03-23', 2019: '2019-04-21', 2024: '2024-03-31', 2025: '2025-04-20', 2026: '2026-04-05', 2027: '2027-03-28', 2038: '2038-04-25', 2285: '2285-03-22' };
    for (const [y, d] of Object.entries(known)) expect(easter(+y), y).toBe(d);
  });

  it('fixed dates, Easter offsets, nth and last weekdays, «first weekday on or after»', () => {
    const k = (/** @type {string} */ rule, /** @type {number} */ y) => new Date(/** @type {any} */ (ruleDay(rule, y)).n * 86_400_000).toISOString().slice(0, 10);
    expect(k('12-25', 2026)).toBe('2026-12-25');
    expect(k('E-2', 2026)).toBe('2026-04-03');
    expect(k('E+60', 2027)).toBe('2027-05-27');
    expect(k('11/4#4', 2026)).toBe('2026-11-26'); // Thanksgiving
    expect(k('5/1#-1', 2027)).toBe('2027-05-31'); // last Monday of May
    expect(k('9/0#1+4', 2026)).toBe('2026-09-10'); // Thursday after the first Sunday of September
    expect(k('11-16/3', 2026)).toBe('2026-11-18'); // Wednesday 16–22 November
    expect(() => ruleDay('bogus', 2026)).toThrow();
  });

  it('every rule of every calendar works for a century, one holiday per day at most', () => {
    for (const cal of CALENDAR_KEYS) {
      for (let y = 2000; y <= 2100; y++) {
        const list = holidays(cal, `${y}-01-01`, `${y}-12-31`);
        expect(list.length, `${cal} ${y}`).toBeGreaterThan(3);
        expect(new Set(list.map((h) => h.day)).size).toBe(list.length);
        for (const h of list) expect(h.day.slice(0, 4)).toBe(String(y));
      }
    }
  });

  it('unknown calendars give nothing; the stored key is checked', () => {
    expect(holidays('XX', '2026-01-01', '2026-12-31')).toEqual([]);
    expect(holidays('', '2026-01-01', '2026-12-31')).toEqual([]);
    expect(holidays('CH-ZH', '2026-12-31', '2026-01-01')).toEqual([]);
    expect(calendarKey('CH-LU')).toBe('CH-LU');
    expect(calendarKey('CH-XX')).toBe('');
    for (const v of ['', 'XX', 'toString', 'constructor', null, undefined, 42]) expect(calendarKey(v), String(v)).toBe('');
  });

  it('names in both languages, German in Swiss spelling', () => {
    for (const cal of CALENDAR_KEYS) {
      for (const h of holidays(cal, '2026-01-01', '2027-12-31')) {
        expect(h.de.trim()).not.toBe('');
        expect(h.en.trim()).not.toBe('');
        expect(h.de, h.de).not.toMatch(/ß/);
      }
    }
  });
});

describe('Luzern: the canton with the days off customary there', () => {
  it('2026 and 2027', () => {
    expect(year('CH-LU', 2026)).toEqual([
      '2026-01-01', '2026-01-02', '2026-04-03', '2026-04-06', '2026-05-14', '2026-05-25', '2026-06-04', '2026-08-01',
      '2026-08-15', '2026-11-01', '2026-12-08', '2026-12-24/2', '2026-12-25', '2026-12-26', '2026-12-31/2',
    ]);
    expect(year('CH-LU', 2027)).toEqual([
      '2027-01-01', '2027-01-02', '2027-03-26', '2027-03-29', '2027-05-06', '2027-05-17', '2027-05-27', '2027-08-01',
      '2027-08-15', '2027-11-01', '2027-12-08', '2027-12-24/2', '2027-12-25', '2027-12-26', '2027-12-31/2',
    ]);
    setLang('de');
    expect(holidays('CH-LU', '2026-05-14', '2026-05-14')[0].de).toBe('Auffahrt');
    expect(holidays('CH-LU', '2026-05-14', '2026-05-14')[0].en).toBe('Ascension Day');
  });

  it('annual target at 42 h/week: 2026 = 2108.40 h, 2027 = 2116.80 h (working days × 8.40 h − credits)', () => {
    for (const [y, want] of [[2026, 2108.4], [2027, 2116.8]]) {
      const from = `${y}-01-01`, to = `${y}-12-31`;
      const credits = creditByDay(holidayAbsences('CH-LU', from, to), 42);
      const credit = [...credits.values()].reduce((s, ms) => s + ms, 0);
      const target = workdays(from, to) * (42 / 5) * H;
      expect((target - credit) / H, String(y)).toBeCloseTo(want, 6);
      // the same through the balance: nothing worked, the whole year as the period
      const b = balance([], 42, from, to, credits);
      expect((b.target - b.credit) / H).toBeCloseTo(want, 6);
    }
    // the half days credit 4:12 h, a holiday on a weekend nothing
    const dec = creditByDay(holidayAbsences('CH-LU', '2026-12-24', '2026-12-26'), 42);
    expect(dec.get('2026-12-24')).toBe(4.2 * H);
    expect(dec.get('2026-12-25')).toBe(8.4 * H);
    expect(dec.get('2026-12-26')).toBe(0); // Saturday
  });
});

describe('Swiss cantons', () => {
  it('Geneva: Jeûne genevois (Thursday after the first Sunday of September) and Restauration de la République (31 Dec)', () => {
    expect(nameOn('CH-GE', '2026-09-10')).toBe('Geneva Fast Day');
    expect(nameOn('CH-GE', '2027-09-09')).toBe('Geneva Fast Day');
    expect(nameOn('CH-GE', '2026-12-31')).toBe('Restoration of the Republic');
    expect(nameOn('CH-GE', '2026-12-26')).toBeUndefined(); // no St Stephen in Geneva
  });

  it('Vaud: Lundi du Jeûne (Monday after the third Sunday of September), Berchtoldstag', () => {
    expect(nameOn('CH-VD', '2026-09-21')).toBe('Federal Fast Monday');
    expect(nameOn('CH-VD', '2027-09-20')).toBe('Federal Fast Monday');
    expect(nameOn('CH-VD', '2026-01-02')).toBe("St Berchtold's Day");
  });

  it('Glarus: Näfelser Fahrt on the first Thursday of April, a week later in Holy Week', () => {
    expect(days('CH-GL', '2026-03-01', '2026-04-30')).toContain('2026-04-09'); // 2 April is Maundy Thursday
    expect(days('CH-GL', '2026-03-01', '2026-04-30')).not.toContain('2026-04-02');
    expect(nameOn('CH-GL', '2027-04-01')).toBe('Näfels Pilgrimage'); // after Easter: stays
    expect(nameOn('CH-GL', '2028-04-06')).toBe('Näfels Pilgrimage');
  });

  it('Neuchâtel: 1 March; 2 January and St Stephen only on a Monday', () => {
    expect(nameOn('CH-NE', '2026-03-01')).toBe('Republic Day');
    expect(nameOn('CH-NE', '2026-01-02')).toBeUndefined(); // a Friday
    expect(nameOn('CH-NE', '2034-01-02')).toBe("St Berchtold's Day"); // a Monday
    expect(nameOn('CH-NE', '2033-12-26')).toBe("St Stephen's Day"); // a Monday
    expect(nameOn('CH-NE', '2026-04-06')).toBeUndefined(); // no Easter Monday
  });

  it('Appenzell Ausserrhoden: no St Stephen when Christmas is on a Monday or a Friday', () => {
    expect(nameOn('CH-AR', '2025-12-26')).toBe("St Stephen's Day"); // Christmas on a Thursday
    expect(nameOn('CH-AR', '2023-12-26')).toBeUndefined(); // Christmas on a Monday
    expect(nameOn('CH-AR', '2026-12-26')).toBeUndefined(); // Christmas on a Friday
  });

  it('Ticino has no Good Friday but Peter and Paul; Solothurn has 1 May afternoon as a half day; Jura 23 June', () => {
    expect(nameOn('CH-TI', '2026-04-03')).toBeUndefined();
    expect(nameOn('CH-TI', '2026-06-29')).toBe('Saints Peter and Paul');
    expect(days('CH-SO', '2026-05-01', '2026-05-01')).toEqual(['2026-05-01/2']);
    expect(nameOn('CH-JU', '2026-06-23')).toBe('Jura Independence Day');
  });

  it('every canton has New Year, Ascension, 1 August and Christmas', () => {
    const cantons = CALENDAR_KEYS.filter((k) => k.startsWith('CH-'));
    expect(cantons).toHaveLength(26);
    for (const c of cantons) for (const d of ['2026-01-01', '2026-05-14', '2026-08-01', '2026-12-25']) expect(nameOn(c, d), `${c} ${d}`).toBeDefined();
  });
});

describe('other countries', () => {
  it('Germany: Easter-relative days in two years, Länder days', () => {
    expect(nameOn('DE', '2026-04-03')).toBe('Good Friday');
    expect(nameOn('DE', '2027-03-26')).toBe('Good Friday');
    expect(nameOn('DE', '2026-05-14')).toBe('Ascension Day');
    expect(nameOn('DE', '2027-05-17')).toBe('Whit Monday');
    expect(nameOn('DE', '2026-10-03')).toBe('German Unity Day');
    expect(nameOn('DE', '2026-06-04')).toBeUndefined(); // Corpus Christi is not nationwide
    expect(nameOn('DE-BY', '2026-06-04')).toBe('Corpus Christi');
    expect(nameOn('DE-BY', '2026-08-15')).toBe('Assumption Day');
    for (const l of ['DE-BB', 'DE-HB', 'DE-HH', 'DE-MV', 'DE-NI', 'DE-SN', 'DE-ST', 'DE-SH', 'DE-TH']) expect(nameOn(l, '2026-10-31'), l).toBe('Reformation Day');
    for (const l of ['DE-BW', 'DE-BY', 'DE-NW', 'DE-HE']) expect(nameOn(l, '2026-10-31'), l).toBeUndefined();
    expect(nameOn('DE-SN', '2026-11-18')).toBe('Day of Repentance and Prayer');
    expect(nameOn('DE-SN', '2027-11-17')).toBe('Day of Repentance and Prayer');
    expect(nameOn('DE-BY', '2026-11-18')).toBeUndefined();
    expect(nameOn('DE-BE', '2027-03-08')).toBe("International Women's Day");
    expect(nameOn('DE-TH', '2026-09-20')).toBe("World Children's Day");
    expect(year('DE-HB', 2026)).toHaveLength(10);
  });

  it('Austria: no Good Friday, Corpus Christi, National Day 26 October', () => {
    expect(nameOn('AT', '2026-04-03')).toBeUndefined();
    expect(nameOn('AT', '2026-06-04')).toBe('Corpus Christi');
    expect(nameOn('AT', '2027-05-27')).toBe('Corpus Christi');
    expect(nameOn('AT', '2026-10-26')).toBe('Austrian National Day');
    expect(year('AT', 2026)).toHaveLength(13);
  });

  it('Liechtenstein: the 13 days of the Arbeitsgesetz (Art. 18), no Good Friday', () => {
    expect(year('LI', 2026)).toHaveLength(13);
    expect(nameOn('LI', '2026-09-08')).toBe('Nativity of Mary');
    expect(nameOn('LI', '2026-08-15')).toBe('National Day');
    expect(nameOn('LI', '2026-04-03')).toBeUndefined();
  });

  it('USA: federal holidays with the observed day (as OPM lists them for 2026 and 2027)', () => {
    expect(year('US', 2026)).toEqual([
      '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25',
    ]);
    // New Year's Day 2028 is a Saturday: observed on Friday 31 December 2027
    expect(year('US', 2027)).toEqual([
      '2027-01-01', '2027-01-18', '2027-02-15', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-10-11', '2027-11-11', '2027-11-25', '2027-12-24', '2027-12-31',
    ]);
    expect(nameOn('US', '2026-11-26')).toBe('Thanksgiving');
    expect(nameOn('US', '2027-11-25')).toBe('Thanksgiving');
    expect(nameOn('US', '2026-07-03')).toBe('Independence Day (observed)');
  });
});

describe('credits and the list', () => {
  const manual = (/** @type {string} */ day, half = false) => ({ id: `a-${day}`, kind: 'absence', day, type: 'vacation', half, note: '' });

  it('one credit per day: a manual absence on a holiday never credits twice, the larger wins', () => {
    // Solothurn: 1 May from noon, a half day
    const so = holidayAbsences('CH-SO', '2026-04-27', '2026-05-03');
    let c = creditByDay([...so, manual('2026-05-01')], 42);
    expect(c.get('2026-05-01')).toBe(8.4 * H);
    const cal = holidayAbsences('CH-LU', '2026-12-21', '2026-12-31');
    // a half day off on Christmas (a whole holiday): still the whole day, not one and a half
    c = creditByDay([...cal, manual('2026-12-25', true)], 42);
    expect(c.get('2026-12-25')).toBe(8.4 * H);
    const days = withAbsences([], [...cal, manual('2026-12-25', true)], 42);
    const xmas = days.find((d) => d.day === '2026-12-25');
    expect(xmas?.absences).toHaveLength(2);
    expect(xmas?.credit).toBe(8.4 * H);
    expect(days.find((d) => d.day === '2026-12-26')?.credit).toBe(0);
  });

  it('the week sheet counts them like absences', () => {
    const cal = holidayAbsences('CH-SO', '2026-04-27', '2026-05-03');
    const sheet = periodSheet(withAbsences([], cal, 42), '2026-04-27', '2026-05-03', '2026-05-31', 42);
    expect(sheet.totals.credit).toBe(4.2 * H);
    expect(sheet.totals.target).toBe(42 * H);
    expect(sheet.rows.find((r) => r.day === '2026-05-01')?.absences[0]).toMatchObject({ half: true, cal: true });
  });

  it('list rows: named after the holiday, marked as from the calendar, no delete control', () => {
    const days = withAbsences([], holidayAbsences('CH-SO', '2026-05-01', '2026-05-01'), 42);
    const may = /** @type {any} */ (days.find((d) => d.day === '2026-05-01'));
    const [row] = absenceRows(may, 42);
    expect(row).toMatchObject({ label: 'Labour Day · half day', cal: true, controls: [], credit: 4.2 * H });
    setLang('de');
    expect(absenceRows(may, 42)[0].label).toBe('Tag der Arbeit · halber Tag');
    expect(absenceLabel(holidayAbsences('CH-LU', '2026-05-14', '2026-05-14')[0])).toBe('Auffahrt');
    // a stored absence keeps its bin
    expect(absenceRows(/** @type {any} */ ({ day: '2026-12-23', absences: [manual('2026-12-23')] }), 42)[0].controls.map((x) => x.kind)).toEqual(['delete']);
  });

  it('time off in lieu shows what it takes from the balance: −8:24, with 2 h worked −6:24, a half day at most −4:12', () => {
    const comp = (/** @type {string} */ day, half = false) => ({ id: `c-${day}`, kind: 'absence', day, type: 'comp', half, note: '' });
    const row = (/** @type {any} */ d) => absenceRows(d, 42)[0].shown;
    expect(row({ day: '2026-11-25', sum: 0, absences: [comp('2026-11-25')] })).toBe('−8:24');
    expect(row({ day: '2026-11-25', sum: 2 * H, absences: [comp('2026-11-25')] })).toBe('−6:24');
    expect(row({ day: '2026-11-25', sum: 0, absences: [comp('2026-11-25', true)] })).toBe('−4:12');
    expect(row({ day: '2026-11-25', sum: 4.2 * H, absences: [comp('2026-11-25', true)] })).toBe('−4:12');
    expect(row({ day: '2026-11-25', sum: 9 * H, absences: [comp('2026-11-25')] })).toBe('0:00'); // worked anyway
    // the balance itself: worked − target, the comp day credits nothing
    const credits = creditByDay([comp('2026-11-25')], 42);
    const days = [{ day: '2026-11-25', pairs: [], punches: [], sum: 2 * H, open: false, running: false }];
    expect(balance(/** @type {any} */ (days), 42, '2026-11-25', '2026-11-25', credits).diff).toBe(-6.4 * H);
  });

  it('a holiday shows as a lower target, not as time: 25 Dec target 0:00, 24 Dec 4:12; the balance is unchanged', () => {
    const cal = holidayAbsences('CH-LU', '2026-12-21', '2026-12-27');
    const days = withAbsences([], [...cal, manual('2026-12-21')], 42);
    const day = (/** @type {string} */ k) => /** @type {any} */ (days.find((d) => d.day === k));
    // the holiday's part of the credit is `off`; vacation stays credit
    expect(day('2026-12-25')).toMatchObject({ credit: 8.4 * H, off: 8.4 * H });
    expect(day('2026-12-24')).toMatchObject({ credit: 4.2 * H, off: 4.2 * H });
    expect(day('2026-12-21')).toMatchObject({ credit: 8.4 * H, off: 0 });
    setLang('de');
    expect(absenceRows(day('2026-12-25'), 42)[0].shown).toBe('Soll 0:00');
    expect(absenceRows(day('2026-12-24'), 42)[0].shown).toBe('Soll 4:12');
    expect(absenceRows(day('2026-12-21'), 42)[0].shown).toBe('8:24'); // vacation: the credited time
    // the week: target 42 h − 12:36 h holidays = 29:24 h; time 8:24 h (the vacation day)
    const sheet = periodSheet(days, '2026-12-21', '2026-12-27', '2026-12-31', 42);
    expect(sheet.totals.target - sheet.totals.off).toBe(29.4 * H);
    expect(sheet.totals.credit - sheet.totals.off).toBe(8.4 * H);
    expect(sheet.totals.diff).toBe(8.4 * H + 12.6 * H - 42 * H); // as before
    const credits = creditByDay([...cal, manual('2026-12-21')], 42);
    const b = balance([], 42, '2026-12-21', '2026-12-27', credits, offByDay([...cal, manual('2026-12-21')], 42));
    expect(b.off).toBe(12.6 * H);
    expect(b.diff).toBe(21 * H - 42 * H);
  });
});

describe('settings and loading', () => {
  it('the calendar is a short key in the settings record (none by default); the largest settings record fits', () => {
    expect(DEFAULT_SETTINGS.holidays).toBe('');
    const longestKey = CALENDAR_KEYS.reduce((a, b) => (b.length > a.length ? b : a));
    const longestFx = FX_NAMES.reduce((a, b) => (b.length > a.length ? b : a));
    const largest = {
      ...DEFAULT_SETTINGS,
      weekHours: 79.75,
      nerd: false,
      dayStart: 1439,
      button: 'inout',
      fx: longestFx,
      badge: 365,
      badgeAt: '2026-11-24',
      linkPunch: false,
      color: 'graphite', // the longest colour key
      holidays: longestKey,
      pause: '-5.5-15,9.5-60', // the longest break rule
      mod: 9_999_999_999_999,
    };
    expect(jsonSize(largest)).toBeLessThanOrEqual(PLAINTEXT_SIZE);
    // Room left for one more short field later. «delayed» (up to 2.8) is no longer written (store.test.js).
    expect(PLAINTEXT_SIZE - jsonSize(largest)).toBeGreaterThanOrEqual(10);
    // An old record that still carries «delayed» and every other field at its longest also fits.
    expect(jsonSize({ ...largest, pause: '', delayed: false })).toBeLessThanOrEqual(PLAINTEXT_SIZE);
  });

  it('the picker: «None» first (in index.html), Switzerland with the cantons by German name, then the countries', () => {
    expect(read('public/index.html')).toMatch(/<select id="s-holidays"[^>]*>\s*<option value="" data-i18n="holidays_none"><\/option>\s*<\/select>/);
    for (const lang of /** @type {const} */ (['de', 'en'])) {
      const groups = calendarGroups(lang);
      expect(groups).toHaveLength(3);
      const [ch, other, de] = groups;
      expect(ch.items).toHaveLength(26);
      const deNames = calendarGroups('de')[0].items.map((i) => i.label);
      expect(deNames).toEqual([...deNames].sort((a, b) => a.localeCompare(b, 'de')));
      expect(other.items.map((i) => i.key)).toEqual(['LI', 'AT', 'DE', 'US']);
      expect(de.items).toHaveLength(16);
      for (const g of groups) for (const i of g.items) expect(i.label.trim()).not.toBe('');
    }
    expect(calendarGroups('de')[0].items[0].label).toBe('Aargau');
    expect(calendarGroups('en')[0].label).toBe('Switzerland');
  });

  it('holidays.js is loaded lazily: no static import anywhere, a dynamic one in app.js, cached by the service worker, small', () => {
    const files = readdirSync(join(root, 'public/js')).filter((f) => f.endsWith('.js'));
    for (const f of files) expect(read(`public/js/${f}`), f).not.toMatch(/^\s*import[^;(]*from\s*['"]\.\/holidays\.js['"]/m);
    expect(read('public/js/app.js')).toMatch(/import\('\.\/holidays\.js'\)/);
    expect(read('public/sw.js')).toContain("'/js/holidays.js',");
    // the module has no imports of its own and stays small (uncompressed)
    expect(read('public/js/holidays.js')).not.toMatch(/^import /m);
    expect(statSync(join(root, 'public/js/holidays.js')).size).toBeLessThan(20 * 1024);
  });
});
