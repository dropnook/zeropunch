// The live demo on the product site (docs/demo/): the copies of the app's animation code, the
// stand-in for store.js, the demo's logic and its texts.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { check, copyList, SHIMS } from '../../scripts/sync-demo.mjs';
import * as core from '../../docs/demo/demo-core.js';
import * as shim from '../../docs/demo/app/js/store.js';
import { FX_NAMES, FX_FILM, pickFx, MAX_PER_DAY } from '../../public/js/store.js';
import { DICT } from '../../public/js/i18n.js';

const root = new URL('../../', import.meta.url).pathname;
const read = (/** @type {string} */ p) => readFileSync(join(root, p), 'utf8');

describe('demo: copies of the app files', () => {
  it('every copy exists and is byte-identical to its source; nothing else lies in docs/demo/app', () => {
    expect(check()).toEqual([]);
  });

  it('the copies are the animation core, the runner, the DOM helpers and every scene', () => {
    const dst = copyList().map(([, d]) => d.replace('docs/demo/app/', ''));
    for (const f of ['js/punchfx.js', 'js/fx.js', 'js/dom.js', 'punchfx.css']) expect(dst).toContain(f);
    for (const n of FX_NAMES) {
      expect(dst).toContain(`fx/${n}.js`);
      expect(dst).toContain(`fx/${n}.css`);
    }
    for (const [src, d] of copyList()) expect(src.replace(/^public\//, ''), d).toBe(d.replace(/^docs\/demo\/app\//, ''));
  });

  it('every static import of a copied module resolves to a copy or a stand-in', () => {
    const known = new Set([...copyList().map(([, d]) => d), ...SHIMS.map((s) => `docs/demo/app/${s}`)]);
    for (const [, d] of copyList().filter(([, f]) => f.endsWith('.js'))) {
      for (const m of read(d).matchAll(/^import .* from '(\.[^']+)';$/gm)) {
        const target = join(dirname(d), m[1]);
        expect(known.has(target), `${d} → ${m[1]}`).toBe(true);
        expect(existsSync(join(root, target)), target).toBe(true);
      }
    }
  });

  it('the stand-in for store.js picks like the real one (same list, random never repeats)', () => {
    expect([...shim.FX_NAMES]).toEqual([...FX_NAMES]);
    expect([...shim.FX_FILM].sort()).toEqual([...FX_FILM].sort());
    for (const v of ['random', 'random-film', 'random-std', 'constructor'])
      for (const prev of [null, ...FX_NAMES])
        for (const r of [0, 0.13, 0.5, 0.77, 0.999]) expect(shim.pickFx(v, prev, () => r), `${v} ${prev} ${r}`).toBe(pickFx(v, prev, () => r));
    expect(shim.pickFx('off', null)).toBeNull();
    expect(shim.pickFx('stamp', null)).toBe('stamp');
    expect(shim.pickFx('nonsense', 'stamp', () => 0)).toBe(pickFx('nonsense', 'stamp', () => 0));
    // the stand-in imports nothing: no database, API or crypto on the site
    expect(read('docs/demo/app/js/store.js')).not.toMatch(/^import /m);
  });
});

describe('demo: logic', () => {
  const EXPECT = [
    // time, day it counts to, dir, state line (as status), today total
    ['18:15', '2009-01-03', 'in', { in: true, since: '18:15' }, '0:00'],
    ['02:54', '2009-01-03', 'out', { in: false }, '128:39'],
    ['02:55', '2009-01-09', 'in', { in: true, since: '02:55' }, '0:00'],
    ['03:02', '2009-01-09', 'out', { in: false }, '0:07'],
    ['03:16', '2009-01-09', 'in', { in: true, since: '03:16' }, '0:07'],
    ['03:23', '2009-01-09', 'out', { in: false }, '0:14'],
    ['03:29', '2009-01-09', 'in', { in: true, since: '03:29' }, '0:14'],
    ['03:39', '2009-01-09', 'out', { in: false }, '0:24'],
    ['03:45', '2009-01-09', 'in', { in: true, since: '03:45' }, '0:24'],
    ['03:54', '2009-01-09', 'out', { in: false }, '0:33'],
    ['04:05', '2009-01-09', 'in', { in: true, since: '04:05' }, '0:33'],
    ['04:12', '2009-01-09', 'out', { in: false }, '0:40'],
    ['04:21', '2009-01-09', 'in', { in: true, since: '04:21' }, '0:40'],
  ];

  it('the table of fixed times: 13, UTC, in order', () => {
    expect(core.TIMES).toHaveLength(13);
    expect(new Date(core.TIMES[0]).toISOString()).toBe('2009-01-03T18:15:05.000Z');
    expect(new Date(core.TIMES[12]).toISOString()).toBe('2009-01-09T04:21:28.000Z');
    for (let i = 1; i < 13; i++) expect(core.TIMES[i]).toBeGreaterThan(core.TIMES[i - 1]);
  });

  it('before the first tap: 3 Jan 2009, no punch, the clock at 18:15:05 and ticking', () => {
    const st = core.initial();
    expect(core.hms(core.now(st, 0))).toBe('18:15:05');
    expect(core.hms(core.now(st, 61_000))).toBe('18:16:06');
    const v = core.view(st, core.now(st, 0));
    expect(v.day).toBe('2009-01-03');
    expect(core.longDate(v.day, 'en')).toBe('Sat 3 Jan 2009');
    expect(core.longDate(v.day, 'de')).toBe('Sa., 3. Jan. 2009');
    expect(core.longDate('2009-01-09', 'en')).toBe('Fri 9 Jan 2009');
    expect(core.longDate('2009-01-09', 'de')).toBe('Fr., 9. Jan. 2009');
    expect(v.punches).toEqual([]);
    expect(core.dur(v.sum)).toBe('0:00');
    expect([v.prev, v.next]).toEqual([null, null]);
    expect(core.status(st, core.now(st, 0))).toMatchObject({ in: false, punchesToday: 0, todaySum: 0, full: false });
  });

  it('13 taps: the fixed times, pairing strictly in order, state and today total after each', () => {
    let st = core.initial();
    EXPECT.forEach(([time, day, dir, state, total], i) => {
      const r = core.tap(st);
      expect(r.punch, `tap ${i + 1}`).toMatchObject({ time, day, dir });
      st = r.state;
      const at = core.now(st, 0);
      expect(core.hms(at)).toBe(new Date(core.TIMES[i]).toISOString().slice(11, 19));
      const s = core.status(st, at);
      expect(s, `tap ${i + 1}`).toMatchObject(state);
      expect(core.dur(s.todaySum), `tap ${i + 1}`).toBe(total);
      const v = core.view(st, at);
      expect(v.day).toBe(day);
      expect(v.punches.map((p) => p.dir)).toEqual(v.punches.map((_, k) => (k % 2 ? 'out' : 'in')));
      expect(s.full).toBe(i === 12);
    });
    const v = core.view(st, core.now(st, 0));
    expect(v.punches.map((p) => p.time)).toEqual(EXPECT.slice(2).map((e) => e[0]));
  });

  it('a running pair grows with the demo clock (whole minutes, as in the app)', () => {
    const st = core.tap(core.initial()).state;
    expect(core.dur(core.status(st, core.now(st, 54_000)).todaySum)).toBe('0:00'); // 18:15:59
    expect(core.dur(core.status(st, core.now(st, 55_000)).todaySum)).toBe('0:01'); // 18:16:00
    expect(core.dur(core.status(st, core.now(st, 3_600_000)).todaySum)).toBe('1:00');
  });

  it('the first two times are one shift of 128:39 h on 3 Jan; it stays reachable with ‹ from 9 Jan', () => {
    let st = core.initial();
    for (let i = 0; i < 2; i++) st = core.tap(st).state;
    let at = core.now(st, 5_000);
    let v = core.view(st, at);
    expect(v).toMatchObject({ day: '2009-01-03', prev: null, next: null, isToday: true, running: false });
    expect(core.dur(v.sum)).toBe('128:39');
    expect(v.punches).toEqual([expect.objectContaining({ time: '18:15', dir: 'in', plus: 0 }), expect.objectContaining({ time: '02:54', dir: 'out', plus: 6 })]);
    st = core.tap(st).state; // the third time starts 9 Jan
    at = core.now(st, 5_000);
    v = core.view(st, at);
    expect(v).toMatchObject({ day: '2009-01-09', prev: '2009-01-03', next: null, isToday: true, running: true });
    expect(v.punches).toEqual([expect.objectContaining({ time: '02:55', dir: 'in', plus: 0 })]);
    st = core.step(st, -1);
    v = core.view(st, at);
    expect(v).toMatchObject({ day: '2009-01-03', prev: null, next: '2009-01-09', isToday: false, running: false });
    expect(core.dur(v.sum)).toBe('128:39');
    // the bound: ‹ again changes nothing
    expect(core.step(st, -1)).toBe(st);
    // › and «Today» both go back
    expect(core.view(core.step(st, 1), at).day).toBe('2009-01-09');
    expect(core.view(core.step(st, 0), at).day).toBe('2009-01-09');
    // at today › changes nothing
    const back = core.step(st, 1);
    expect(core.step(back, 1)).toBe(back);
    // the state line is about today only
    expect(core.status(st, at)).toMatchObject({ in: true, since: '02:55', punchesToday: 1 });
    // a punch brings the view back to today
    const r = core.tap(st);
    expect(r.state.view).toBeNull();
    expect(core.view(r.state, core.now(r.state, 0)).day).toBe('2009-01-09');
  });

  it('the end: after the 13th tap the times are used up and a further tap does nothing', () => {
    let st = core.initial();
    for (let i = 0; i < 13; i++) st = core.tap(st).state;
    const s = core.status(st, core.now(st, 0));
    expect(s.punchesToday).toBe(11);
    expect(s.full).toBe(true);
    const r = core.tap(st);
    expect(r.punch).toBeNull();
    expect(r.state).toBe(st);
    expect(core.view(st, core.now(st, 0)).punches).toHaveLength(11);
  });

  it('«Start again» is the state before the first tap', () => {
    let st = core.initial();
    for (let i = 0; i < 13; i++) st = core.tap(st).state;
    st = core.step(st, -1);
    const fresh = core.reset();
    expect(fresh).toEqual(core.initial());
    expect(core.hms(core.now(fresh, 0))).toBe('18:15:05');
    expect(core.tap(fresh).punch).toMatchObject({ time: '18:15', dir: 'in' });
  });
});

describe('demo: time travel', () => {
  it('a second table of two times on one day in 1955; the main table is untouched', () => {
    expect(core.TRIP.map((ts) => new Date(ts).toISOString())).toEqual(['1955-11-12T01:21:00.000Z', '1955-11-12T22:04:00.000Z']);
    expect(core.TIMES).toHaveLength(13);
    expect(core.timesOf(core.initial())).toBe(core.TIMES);
    expect(core.timesOf(core.trip())).toBe(core.TRIP);
  });

  it('before the first tap: 12 Nov 1955, no punch, the clock at 01:21:00', () => {
    const st = core.trip();
    expect(core.today(st)).toBe('1955-11-12');
    expect(core.longDate(core.today(st), 'de')).toBe('Sa., 12. Nov. 1955');
    expect(core.hms(core.now(st, 0))).toBe('01:21:00');
    expect(core.status(st, core.now(st, 0))).toMatchObject({ in: false, punchesToday: 0, full: false });
  });

  it('two taps: in at 01:21, out at 22:04, 20:43 h on that day, then the table is used up', () => {
    let st = core.trip();
    const a = core.tap(st);
    expect(a.punch).toMatchObject({ time: '01:21', dir: 'in', day: '1955-11-12' });
    st = a.state;
    expect(st.trip).toBe(true);
    expect(core.status(st, core.now(st, 0))).toMatchObject({ in: true, since: '01:21', full: false });
    const b = core.tap(st);
    expect(b.punch).toMatchObject({ time: '22:04', dir: 'out', day: '1955-11-12' });
    st = b.state;
    const s = core.status(st, core.now(st, 0));
    expect(s).toMatchObject({ in: false, punchesToday: 2, full: true });
    expect(core.dur(s.todaySum)).toBe('20:43');
    expect(core.days(st)).toEqual(['1955-11-12']);
    expect(core.tap(st).punch).toBeNull();
  });

  it('browsing keeps the table: a step never drops out of the time travel', () => {
    const st = core.tap(core.trip()).state;
    expect(core.step(st, -1)).toBe(st);
    expect(core.step({ ...st, view: '1955-11-12' }, 0).trip).toBe(true);
  });
});

describe('demo: texts', () => {
  it('English and German have the same keys and no empty text', () => {
    expect(Object.keys(core.TEXTS.de).sort()).toEqual(Object.keys(core.TEXTS.en).sort());
    for (const l of /** @type {const} */ (['en', 'de'])) for (const [k, v] of Object.entries(core.TEXTS[l])) expect(v.trim(), `${l}.${k}`).not.toBe('');
  });

  it('where the app says the same thing, the wording is the app’s', () => {
    for (const l of /** @type {const} */ (['en', 'de'])) {
      const app = /** @type {Record<string, string>} */ (DICT[l]);
      let shared = 0;
      for (const [k, v] of Object.entries(core.TEXTS[l])) {
        if (!(k in app)) continue;
        shared++;
        expect(v, `${l}.${k}`).toBe(app[k].replace('{perday}', String(MAX_PER_DAY)));
      }
      expect(shared).toBeGreaterThanOrEqual(16);
    }
  });

  it('German in Swiss spelling: no ß, «» quotes', () => {
    for (const [k, v] of Object.entries(core.TEXTS.de)) {
      expect(v, k).not.toMatch(/ß/);
      expect(v, k).not.toMatch(/[„“”"]/);
    }
    expect(core.text('de', 'caption')).toBe('Demo – nichts wird gespeichert.');
    expect(core.text('en', 'caption')).toBe('Demo – nothing is stored.');
    expect(core.text('en', 'state_in', { time: '18:15', dur: '0:00' })).toBe('In since 18:15 · 0:00 h');
  });
});

describe('demo: on the pages', () => {
  it('both pages keep the screenshot and load the demo as a module from the site itself', () => {
    for (const [p, src] of [['docs/index.html', 'demo/boot.js'], ['docs/de/index.html', '../demo/boot.js']]) {
      const html = read(p);
      expect(html).toContain(`<script type="module" src="${src}"></script>`);
      expect(html).toMatch(/<section class="hero">[\s\S]*<picture class="phone">[\s\S]*<\/picture>/);
    }
  });

  it('no network, no storage, no inline styles in the demo code', () => {
    for (const f of ['boot.js', 'demo.js', 'demo-core.js']) {
      const s = read(`docs/demo/${f}`);
      expect(s, f).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|document\.cookie/);
      expect(s, f).not.toMatch(/setAttribute\('style'|\.style\.(?!setProperty|removeProperty)|innerHTML|https?:\/\//);
    }
  });

  it('_headers: the demo revalidates like every other file', () => {
    expect(read('docs/_headers')).toMatch(/^\/demo\/\*\n {2}Cache-Control: public, max-age=0, must-revalidate$/m);
  });
});
