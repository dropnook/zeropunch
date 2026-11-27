// Public-holiday calendars: a small rule engine and the data table. Loaded lazily (dynamic import in
// app.js) only when a calendar is set in the settings or the settings open, so nobody else pays for it.
// A calendar day is never stored: the settings record keeps only the calendar's key (settings.holidays),
// the days are computed here for any year and credited like an absence of type «holiday» (time.js).
//
// Rules (one string per holiday):
//   'M-D'      a fixed date, e.g. '12-25'
//   'E'        Gregorian Easter Sunday; with an offset 'E-2' (Good Friday), 'E+39' (Ascension)
//   'M/W#N'    the Nth weekday W of month M (W: 0 = Sunday … 6 = Saturday; N = -1: the last one),
//              e.g. '11/4#4' = fourth Thursday of November; an offset may follow: '9/0#1+4'
//   'M-D/W'    the first weekday W on or after M-D, e.g. '11-16/3' = Wednesday 16–22 November
// Flags after a space:
//   'obs'      US federal observance: on a Saturday the Friday before, on a Sunday the Monday after
//   'on:15'    only when the day falls on one of these weekdays (digits as W)
//   'not:26'   not when the day falls on one of these weekdays
//   'hw'       moved one week later when it falls in Holy Week (Näfelser Fahrt)
//
// Sources (checked 2026-11): Switzerland: SECO, «Feiertage Schweiz», annex to the labour-law guide, as of
// 12 Dec 2024 (the days each canton equates with Sundays, Art. 20a ArG), plus the further public rest
// days that cantonal law declares for the whole canton (overview in the German Wikipedia article
// «Feiertage in der Schweiz»; Ticino: Decreto legislativo concernente i giorni festivi, Art. 1).
// Liechtenstein: Arbeitsgesetz Art. 18 Abs. 2. Austria: Arbeitsruhegesetz § 7 Abs. 2. Germany: the
// Länder holiday laws as summarised in the German Wikipedia article «Feiertag (Deutschland)». USA:
// 5 U.S.C. 6103 and OPM's federal holiday list (observance rule). Rules describe the law as of 2026; the
// app looks at 13 months at most, so changes of earlier years (e.g. Reformationstag in the north since
// 2018) are not modelled.

/** id → [rule, German name, English name (if different)] */
const H = /** @type {Record<string, [string, string, string?]>} */ ({
  ny: ['1-1', 'Neujahr', "New Year's Day"],
  b2: ['1-2', 'Berchtoldstag', "St Berchtold's Day"],
  b2m: ['1-2 on:1', 'Berchtoldstag', "St Berchtold's Day"],
  ep: ['1-6', 'Dreikönigstag', 'Epiphany'],
  ep3: ['1-6', 'Heilige Drei Könige', 'Epiphany'],
  ne: ['3-1', 'Jahrestag der Republik', 'Republic Day'],
  fw: ['3-8', 'Internationaler Frauentag', "International Women's Day"],
  jo: ['3-19', 'Josefstag', "St Joseph's Day"],
  gf: ['E-2', 'Karfreitag', 'Good Friday'],
  em: ['E+1', 'Ostermontag', 'Easter Monday'],
  nf: ['4/4#1 hw', 'Näfelser Fahrt', 'Näfels Pilgrimage'],
  may: ['5-1', 'Tag der Arbeit', 'Labour Day'],
  sfa: ['5-1', 'Staatsfeiertag', 'Labour Day'],
  asc: ['E+39', 'Auffahrt', 'Ascension Day'],
  cha: ['E+39', 'Christi Himmelfahrt', 'Ascension Day'],
  wm: ['E+50', 'Pfingstmontag', 'Whit Monday'],
  cc: ['E+60', 'Fronleichnam', 'Corpus Christi'],
  ju: ['6-23', 'Fest der Unabhängigkeit', 'Jura Independence Day'],
  pp: ['6-29', 'Peter und Paul', 'Saints Peter and Paul'],
  ch: ['8-1', 'Nationalfeiertag', 'Swiss National Day'],
  ass: ['8-15', 'Mariä Himmelfahrt', 'Assumption Day'],
  lis: ['8-15', 'Staatsfeiertag', 'National Day'],
  mg: ['9-8', 'Mariä Geburt', 'Nativity of Mary'],
  jg: ['9/0#1+4', 'Jeûne genevois', 'Geneva Fast Day'],
  wk: ['9-20', 'Weltkindertag', "World Children's Day"],
  bk: ['9-25', 'Bruder Klaus', 'St Nicholas of Flüe'],
  lj: ['9/0#3+1', 'Bettagsmontag', 'Federal Fast Monday'],
  de: ['10-3', 'Tag der Deutschen Einheit', 'German Unity Day'],
  at: ['10-26', 'Nationalfeiertag', 'Austrian National Day'],
  ref: ['10-31', 'Reformationstag', 'Reformation Day'],
  ah: ['11-1', 'Allerheiligen', "All Saints' Day"],
  bb: ['11-16/3', 'Buss- und Bettag', 'Day of Repentance and Prayer'],
  im: ['12-8', 'Mariä Empfängnis', 'Immaculate Conception'],
  xe: ['12-24', 'Heiligabend', 'Christmas Eve'],
  xm: ['12-25', 'Weihnachten', 'Christmas Day'],
  ct: ['12-25', 'Christtag', 'Christmas Day'],
  x1: ['12-25', '1. Weihnachtstag', 'Christmas Day'],
  st: ['12-26', 'Stephanstag', "St Stephen's Day"],
  // AR: not when Christmas falls on a Monday or Friday; AI and UR: not when it would make three rest
  // days in a row. Both come down to: not on a Tuesday or Saturday.
  stx: ['12-26 not:26', 'Stephanstag', "St Stephen's Day"],
  stm: ['12-26 on:1', 'Stephanstag', "St Stephen's Day"],
  sti: ['12-26', 'Stefanitag', "St Stephen's Day"],
  x2: ['12-26', '2. Weihnachtstag', 'Boxing Day'],
  sy: ['12-31', 'Silvester', "New Year's Eve"],
  rr: ['12-31', 'Restauration de la République', 'Restoration of the Republic'],
  // USA (federal)
  uny: ['1-1 obs', 'Neujahr', "New Year's Day"],
  mlk: ['1/1#3', 'Martin Luther King Jr. Day'],
  was: ['2/1#3', "Washington's Birthday"],
  mem: ['5/1#-1', 'Memorial Day'],
  jun: ['6-19 obs', 'Juneteenth'],
  ind: ['7-4 obs', 'Unabhängigkeitstag', 'Independence Day'],
  lab: ['9/1#1', 'Labor Day'],
  col: ['10/1#2', 'Columbus Day'],
  vet: ['11-11 obs', 'Veterans Day'],
  tg: ['11/4#4', 'Thanksgiving'],
  uxm: ['12-25 obs', 'Weihnachten', 'Christmas Day'],
});

// Swiss cantons: New Year, Ascension, 1 August and Christmas everywhere. Where the holidays differ by
// district or commune, the list holds only the days of the whole canton (a manual absence adds a local
// one; a calendar day cannot be taken away), as noted per canton.
const CH0 = 'ny asc ch xm';
const DE0 = 'ny gf em may cha wm de x1 x2';

/** key → [group, German label, English label (if different), holiday ids («:h» = half day)] */
const C = /** @type {Record<string, [string, string, string | null, string]>} */ ({
  // AG: the holidays besides these differ by district (e.g. Easter Monday and St Stephen not in Bremgarten, Laufenburg, Muri).
  'CH-AG': ['ch', 'Aargau', null, `${CH0} gf`],
  'CH-AR': ['ch', 'Appenzell Ausserrhoden', null, `${CH0} gf em wm stx`],
  'CH-AI': ['ch', 'Appenzell Innerrhoden', null, `${CH0} gf em wm cc ass ah im stx`],
  'CH-BL': ['ch', 'Basel-Landschaft', null, `${CH0} gf em may wm st`],
  'CH-BS': ['ch', 'Basel-Stadt', null, `${CH0} gf em may wm st`],
  'CH-BE': ['ch', 'Bern', null, `${CH0} b2 gf em wm st`],
  // FR: Catholic communes add Corpus Christi, Assumption, All Saints, Immaculate Conception; reformed ones 2 Jan, Easter and Whit Monday, St Stephen.
  'CH-FR': ['ch', 'Freiburg', 'Fribourg', `${CH0} gf`],
  'CH-GE': ['ch', 'Genf', 'Geneva', `${CH0} gf em wm jg rr`],
  // GL: Näfelser Fahrt on the first Thursday of April, a week later when that falls in Holy Week.
  'CH-GL': ['ch', 'Glarus', null, `${CH0} nf gf em wm ah st`],
  // GR: the Catholic holidays only in some communes.
  'CH-GR': ['ch', 'Graubünden', 'Grisons', `${CH0} gf em wm st`],
  'CH-JU': ['ch', 'Jura', null, `${CH0} b2 gf em may wm cc ju ass ah`],
  // LU: the canton's list plus the days off customary throughout the canton: 2 Jan, Easter Monday, Whit
  // Monday, and the afternoons of 24 and 31 December (half days).
  'CH-LU': ['ch', 'Luzern', 'Lucerne', `${CH0} b2 gf em wm cc ass ah im st xe:h sy:h`],
  // NE: 2 Jan and St Stephen only when they fall on a Monday; Corpus Christi only in Le Landeron.
  'CH-NE': ['ch', 'Neuenburg', 'Neuchâtel', `${CH0} b2m ne gf may stm`],
  'CH-NW': ['ch', 'Nidwalden', null, `${CH0} jo gf cc ass ah im`],
  'CH-OW': ['ch', 'Obwalden', null, `${CH0} gf cc ass bk ah im`],
  'CH-SH': ['ch', 'Schaffhausen', null, `${CH0} gf em may wm st`],
  'CH-SZ': ['ch', 'Schwyz', null, `${CH0} ep jo gf em wm cc ass ah im st`],
  // SO: 1 May from noon (a half day); the Bucheggberg district has neither Corpus Christi, Assumption nor All Saints.
  'CH-SO': ['ch', 'Solothurn', null, `${CH0} gf may:h cc ass ah`],
  'CH-SG': ['ch', 'St. Gallen', null, `${CH0} gf em wm ah st`],
  // TI: no Good Friday.
  'CH-TI': ['ch', 'Tessin', 'Ticino', `${CH0} ep jo em may wm cc pp ass ah im st`],
  'CH-TG': ['ch', 'Thurgau', null, `${CH0} b2 gf em may wm st`],
  'CH-UR': ['ch', 'Uri', null, `${CH0} ep jo gf em wm cc ass ah im stx`],
  'CH-VD': ['ch', 'Waadt', 'Vaud', `${CH0} b2 gf em wm lj`],
  'CH-VS': ['ch', 'Wallis', 'Valais', `${CH0} jo cc ass ah im`],
  'CH-ZG': ['ch', 'Zug', null, `${CH0} gf cc ass ah im`],
  'CH-ZH': ['ch', 'Zürich', 'Zurich', `${CH0} gf em may wm st`],
  LI: ['ll', 'Liechtenstein', null, 'ny ep3 em may asc wm cc lis mg ah im xm st'],
  AT: ['ll', 'Österreich', 'Austria', 'ny ep3 em sfa cha wm cc ass at ah im ct sti'],
  DE: ['ll', 'Deutschland (bundesweit)', 'Germany (nationwide)', DE0],
  US: ['ll', 'USA (Bundesfeiertage)', 'USA (federal holidays)', 'uny mlk was mem jun ind lab col vet tg uxm'],
  'DE-BW': ['de', 'Baden-Württemberg', null, `${DE0} ep3 cc ah`],
  // BY: Assumption only in communes with a mainly Catholic population (about 1700 of 2056; most of the
  // Land), the Augsburg peace festival only in Augsburg (left out).
  'DE-BY': ['de', 'Bayern', 'Bavaria', `${DE0} ep3 cc ass ah`],
  'DE-BE': ['de', 'Berlin', null, `${DE0} fw`],
  // BB and HE also keep Easter and Whit Sunday (always a Sunday: no credit, left out).
  'DE-BB': ['de', 'Brandenburg', null, `${DE0} ref`],
  'DE-HB': ['de', 'Bremen', null, `${DE0} ref`],
  'DE-HH': ['de', 'Hamburg', null, `${DE0} ref`],
  'DE-HE': ['de', 'Hessen', 'Hesse', `${DE0} cc`],
  'DE-MV': ['de', 'Mecklenburg-Vorpommern', 'Mecklenburg-Western Pomerania', `${DE0} fw ref`],
  'DE-NI': ['de', 'Niedersachsen', 'Lower Saxony', `${DE0} ref`],
  'DE-NW': ['de', 'Nordrhein-Westfalen', 'North Rhine-Westphalia', `${DE0} cc ah`],
  'DE-RP': ['de', 'Rheinland-Pfalz', 'Rhineland-Palatinate', `${DE0} cc ah`],
  'DE-SL': ['de', 'Saarland', null, `${DE0} cc ass ah`],
  // SN and TH: Corpus Christi only in some communes (left out).
  'DE-SN': ['de', 'Sachsen', 'Saxony', `${DE0} ref bb`],
  'DE-ST': ['de', 'Sachsen-Anhalt', 'Saxony-Anhalt', `${DE0} ep3 ref`],
  'DE-SH': ['de', 'Schleswig-Holstein', null, `${DE0} ref`],
  'DE-TH': ['de', 'Thüringen', 'Thuringia', `${DE0} wk ref`],
});

/** Groups of the picker, in order. */
const GROUPS = /** @type {const} */ ([
  ['ch', 'Schweiz', 'Switzerland'],
  ['ll', 'Weitere Länder', 'Other countries'],
  ['de', 'Deutschland: Bundesländer', 'Germany: federal states'],
]);

/** The calendar keys, in the picker's order. */
export const CALENDAR_KEYS = Object.keys(C);

/** The stored value as a known calendar key, or '' (none). @param {unknown} v settings.holidays */
export const calendarKey = (v) => (typeof v === 'string' && Object.hasOwn(C, v) ? v : '');

/**
 * The picker's groups with their calendars, labelled in one language.
 * @param {'en' | 'de'} lang @returns {{ label: string, items: { key: string, label: string }[] }[]}
 */
export function calendarGroups(lang) {
  const de = lang === 'de';
  return GROUPS.map(([g, gde, gen]) => ({
    label: de ? gde : gen,
    items: CALENDAR_KEYS.filter((k) => C[k][0] === g).map((k) => ({ key: k, label: de ? C[k][1] : C[k][2] || C[k][1] })),
  }));
}

// ------------------------------------------------------------ dates as day numbers (UTC, no time zone)

const DAY = 86_400_000;
/** @param {number} y @param {number} m 1–12 @param {number} d */
const dn = (y, m, d) => Date.UTC(y, m - 1, d) / DAY;
/** 0 = Sunday … 6 = Saturday. @param {number} n */
const wd = (n) => new Date(n * DAY).getUTCDay();
/** @param {number} n */
const key = (n) => new Date(n * DAY).toISOString().slice(0, 10);

/** Gregorian Easter Sunday as a day number (anonymous Gregorian algorithm, «Meeus/Jones/Butcher»). @param {number} y */
function easterDn(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return dn(y, month, ((h + l - 7 * m + 114) % 31) + 1);
}

/** Easter Sunday of a year as "YYYY-MM-DD". @param {number} y */
export const easter = (y) => key(easterDn(y));

const RULE = /^(?:(E)|(\d+)-(\d+)(?:\/(\d))?|(\d+)\/(\d)#(-?\d))([+-]\d+)?((?: [a-z]+(?::\d+)?)*)$/;

/**
 * The day a rule gives in year y (a day number), and whether it moved (observed), or null when the
 * rule skips that year. @param {string} rule @param {number} y @returns {{ n: number, moved: boolean } | null}
 */
export function ruleDay(rule, y) {
  const m = RULE.exec(rule);
  if (!m) throw new Error(`bad rule ${rule}`);
  let n;
  if (m[1]) n = easterDn(y);
  else if (m[2]) {
    n = dn(y, +m[2], +m[3]);
    if (m[4]) n += (+m[4] - wd(n) + 7) % 7; // first weekday W on or after
  } else {
    const month = +m[5], w = +m[6], nth = +m[7];
    if (nth > 0) {
      const first = dn(y, month, 1);
      n = first + ((w - wd(first) + 7) % 7) + 7 * (nth - 1);
    } else {
      const last = dn(y, month + 1, 1) - 1; // Date.UTC handles month 13
      n = last - ((wd(last) - w + 7) % 7);
    }
  }
  if (m[8]) n += +m[8];
  let moved = false;
  for (const f of m[9].trim().split(' ').filter(Boolean)) {
    const [flag, arg = ''] = f.split(':');
    if (flag === 'obs') {
      const d = wd(n);
      if (d === 6) (n -= 1), (moved = true);
      else if (d === 0) (n += 1), (moved = true);
    } else if (flag === 'on' && !arg.includes(String(wd(n)))) return null;
    else if (flag === 'not' && arg.includes(String(wd(n)))) return null;
    else if (flag === 'hw') {
      const e = easterDn(y);
      if (n >= e - 7 && n < e) n += 7; // Holy Week: Palm Sunday up to Holy Saturday
    }
  }
  return { n, moved };
}

/** @typedef {{ day: string, half: boolean, de: string, en: string }} Holiday */

/** @type {Map<string, Holiday[]>} calendar|year → its days */
const cache = new Map();

/**
 * The days of one calendar whose rules fall in year y (an observed day may lie in the year before,
 * e.g. New Year's Day on a Saturday is observed on 31 December). @param {string} cal @param {number} y
 * @returns {Holiday[]}
 */
function yearDays(cal, y) {
  const ck = `${cal}|${y}`;
  let out = cache.get(ck);
  if (out) return out;
  out = [];
  for (const item of C[cal][3].split(' ')) {
    const [id, mod] = item.split(':');
    const [rule, de, en = de] = H[id];
    const r = ruleDay(rule, y);
    if (!r) continue;
    out.push({ day: key(r.n), half: mod === 'h', de: r.moved ? `${de} (verschoben)` : de, en: r.moved ? `${en} (observed)` : en });
  }
  cache.set(ck, out);
  return out;
}

/**
 * The holidays of a calendar from `from` to `to` (both "YYYY-MM-DD", included), oldest first, at most
 * one per day (a whole day wins over a half one). Unknown or empty key: none.
 * @param {string} cal @param {string} from @param {string} to @returns {Holiday[]}
 */
export function holidays(cal, from, to) {
  if (!calendarKey(cal) || !(from <= to)) return [];
  /** @type {Map<string, Holiday>} */
  const byDay = new Map();
  for (let y = +from.slice(0, 4) - 1; y <= +to.slice(0, 4) + 1; y++) {
    for (const h of yearDays(cal, y)) {
      if (h.day < from || h.day > to) continue;
      const prev = byDay.get(h.day);
      if (!prev || (prev.half && !h.half)) byDay.set(h.day, h);
    }
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

/**
 * The holidays as absences (time.js): type «holiday», `cal: true` (from the calendar, not a record:
 * no id in the store, never deleted or written) and the holiday's name in both languages.
 * @param {string} cal @param {string} from @param {string} to
 */
export function holidayAbsences(cal, from, to) {
  return holidays(cal, from, to).map((h) => ({ id: `cal:${h.day}`, kind: 'absence', day: h.day, type: 'holiday', half: h.half, cal: true, name: { de: h.de, en: h.en } }));
}
