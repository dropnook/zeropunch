import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { FX_NAMES, FX_FILM } from '../../public/js/store.js';
import { installFakeDom, removeFakeDom } from './fakedom.js';

const read = (/** @type {string} */ p) => readFileSync(new URL(`../../public/${p}`, import.meta.url), 'utf8');
const size = (/** @type {string} */ p) => statSync(new URL(`../../public/${p}`, import.meta.url)).size;

/** A fresh copy of the module (its caches empty) on a fresh fake document. */
async function fresh(/** @type {{ failCss?: RegExp }} */ o = {}) {
  const doc = installFakeDom(o);
  vi.resetModules();
  const m = await import('../../public/js/punchfx.js');
  const area = doc.createElement('div');
  const anchor = doc.createElement('button');
  anchor.setAttribute('class', 'punch');
  area.append(anchor);
  doc.body.append(area);
  return { m, doc, area, anchor };
}
/** Let the scene module and its stylesheet load (dynamic import + link «load»). */
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};
const layers = (/** @type {any} */ area) => area.childNodes.filter((/** @type {any} */ c) => c.classList?.contains('pfx-layer'));

afterEach(() => {
  vi.useRealTimers();
  removeFakeDom();
});

describe('punch animations: the list', () => {
  it('the core lists twenty-seven animations, the same as the setting, each 600–1100 ms (film homages up to 3000 ms) with its impact inside', async () => {
    const { NAMES, DURATION, IMPACT, BUZZ } = await import('../../public/js/punchfx.js');
    expect(NAMES).toHaveLength(27);
    expect([...NAMES]).toEqual([...FX_NAMES]);
    expect(NAMES.at(-1)).toBe('answer'); // the newest idea is last
    for (const n of NAMES) {
      expect(DURATION[n], n).toBeGreaterThanOrEqual(600);
      // a film homage may have a line to read (HAL does): it may run longer, still at most 3 s (the punch is never held up)
      expect(DURATION[n], n).toBeLessThanOrEqual(FX_FILM.has(n) ? 3000 : 1100);
      expect(IMPACT[n], n).toBeGreaterThan(80);
      expect(IMPACT[n], n).toBeLessThan(DURATION[n] * 0.75);
      // a short buzz: a few pulses, nothing that outlasts the animation
      expect(BUZZ[n].length, n).toBeGreaterThan(0);
      for (const p of BUZZ[n]) expect(Number.isInteger(p) && p > 0, n).toBe(true);
      expect(IMPACT[n] + BUZZ[n].reduce((a, b) => a + b, 0), n).toBeLessThanOrEqual(DURATION[n]);
      for (let i = 0; i < BUZZ[n].length; i += 2) expect(BUZZ[n][i], `${n} pulse`).toBeLessThanOrEqual(30);
    }
  });

  it('every animation has its own module and stylesheet, and nothing else is in public/fx', () => {
    const files = readdirSync(new URL('../../public/fx', import.meta.url)).sort();
    expect(files).toEqual(FX_NAMES.flatMap((n) => [`${n}.css`, `${n}.js`]).sort());
  });

  it('size: the core stays within its budget; each scene is small and loaded on its own', () => {
    const core = size('js/punchfx.js') + size('punchfx.css');
    expect(core).toBeLessThanOrEqual(45 * 1024);
    for (const n of FX_NAMES) expect(size(`fx/${n}.js`) + size(`fx/${n}.css`), n).toBeLessThanOrEqual(8 * 1024);
    // the core never imports a scene statically
    expect(read('js/punchfx.js')).not.toMatch(/^import .*\.\.\/fx\//m);
  });

  it('CSS: a rule per scene, reduced motion, no external resources, and only cheap properties animated', () => {
    const core = read('punchfx.css');
    expect(core).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.pfx-layer/);
    for (const css of [core, ...FX_NAMES.map((n) => read(`fx/${n}.css`))]) {
      expect(css).not.toMatch(/url\(|@import|@font-face|filter\s*:/);
      // keyframes animate transform, opacity and stroke-dashoffset only (no layout, no paint-heavy properties)
      for (const [, body] of css.matchAll(/@keyframes [\w-]+ \{([\s\S]*?\})\s*\}/g)) {
        for (const [, prop] of body.matchAll(/([a-z-]+)\s*:/g)) expect(['transform', 'opacity', 'stroke-dashoffset', 'animation-timing-function'], prop).toContain(prop);
      }
    }
    for (const n of FX_NAMES) {
      const css = read(`fx/${n}.css`);
      expect(css, n).toContain(`.pfx-${n} `);
      // scenes never use the animation shorthand on their parts (it would undo the timing and the stills)
      expect(css.replace(/\.punch\.pfx-recoil \{[^}]*\}/, ''), n).not.toMatch(/[{;]\s*animation\s*:/);
    }
  });

  it('CSP: no style attributes, no innerHTML, nothing from other origins', () => {
    for (const f of ['js/punchfx.js', 'js/fx.js', ...FX_NAMES.map((n) => `fx/${n}.js`)]) {
      const js = read(f);
      expect(js, f).not.toMatch(/setAttribute\(\s*['"]style|innerHTML|['"]style['"]\s*:|https?:\/\//);
    }
  });
});

describe('punch animations: playing', () => {
  it('never throws, also without a DOM or with an unknown name', async () => {
    const { play, preview, cancelAll, still } = await import('../../public/js/punchfx.js');
    expect(() => play('card', { anchor: /** @type {any} */ (null), time: '08:02' })).not.toThrow();
    const hnd = play('nope', /** @type {any} */ ({}));
    await expect(hnd.done).resolves.toBeUndefined();
    expect(() => preview('card', /** @type {any} */ (null))).not.toThrow();
    expect(await still('nope')).toBeNull();
    expect(() => cancelAll()).not.toThrow();
  });

  it('every animation builds its layer without throwing, buzzes once at the impact, and cleans up after its duration', async () => {
    const { m, area, anchor } = await fresh();
    for (const n of m.NAMES) {
      await m.load(n); // module + stylesheets ready, so the fake timers below see the whole run
      vi.useFakeTimers();
      const buzz = vi.fn();
      const hnd = m.play(n, { anchor, time: '08:02', buzz });
      await vi.advanceTimersByTimeAsync(0);
      const [layer] = layers(area);
      expect(layer, n).toBeTruthy();
      expect(layer.getAttribute('aria-hidden'), n).toBe('true');
      expect(layer.style.getPropertyValue('--pfx-d'), n).toBe(`${m.DURATION[n]}ms`);
      expect(layer.style.getPropertyValue('--pfx-hit'), n).toBe(`${m.IMPACT[n]}ms`);
      expect(layer.style.getPropertyValue('top'), n).toBe('10px'); // placed over the button
      const svg = layer.all().find((/** @type {any} */ e) => e.tagName === 'svg');
      expect(svg.getAttribute('class'), n).toContain(`pfx-${n}`);
      expect(svg.all().length, n).toBeGreaterThan(3);
      if (n === 'button') expect(anchor.classList.contains('pfx-recoil')).toBe(true);
      await vi.advanceTimersByTimeAsync(m.IMPACT[n] - 1);
      expect(buzz, n).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(buzz, n).toHaveBeenCalledTimes(1);
      expect(buzz, n).toHaveBeenCalledWith(m.BUZZ[n]);
      await vi.advanceTimersByTimeAsync(m.DURATION[n] - m.IMPACT[n] + 100);
      expect(layers(area), n).toHaveLength(0);
      expect(anchor.classList.contains('pfx-recoil'), n).toBe(false);
      await expect(hnd.done).resolves.toBeUndefined();
      expect(buzz, n).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    }
  });

  it('the time clock, the rubber stamp, the flip clock, the validator and the typewriter show the real time', async () => {
    const { m, area, anchor } = await fresh();
    for (const n of ['clock', 'stamp', 'validator', 'sundial', 'tower']) {
      m.play(n, { anchor, time: '17:42' });
      await settle();
      const texts = layers(area)[0].all().filter((/** @type {any} */ e) => e.tagName === 'text').map((/** @type {any} */ e) => e.textContent);
      expect(texts, n).toContain('17:42');
    }
    m.play('flip', { anchor, time: '07:05' });
    await settle();
    const flip = layers(area)[0].all().filter((/** @type {any} */ e) => e.tagName === 'text').map((/** @type {any} */ e) => e.textContent).join('');
    for (const d of '0705') expect(flip).toContain(d);
    m.play('typewriter', { anchor, time: '07:05' });
    await settle();
    const typed = layers(area)[0].all().filter((/** @type {any} */ e) => e.tagName === 'text').map((/** @type {any} */ e) => e.textContent);
    expect(typed.join('')).toBe('07:05');
    m.cancelAll();
  });

  it('a second punch cancels the first cleanly (layer gone, no late buzz), one layer at a time', async () => {
    const { m, area, anchor } = await fresh();
    await m.load('seal');
    await m.load('button');
    vi.useFakeTimers();
    const b1 = vi.fn();
    const b2 = vi.fn();
    const first = m.play('button', { anchor, time: '08:00', buzz: b1 });
    await vi.advanceTimersByTimeAsync(50);
    expect(anchor.classList.contains('pfx-recoil')).toBe(true);
    const second = m.play('seal', { anchor, time: '08:01', buzz: b2 });
    await expect(first.done).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(layers(area)).toHaveLength(1);
    expect(anchor.classList.contains('pfx-recoil')).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(b1).not.toHaveBeenCalled();
    expect(b2).toHaveBeenCalledTimes(1);
    expect(layers(area)).toHaveLength(0);
    await expect(second.done).resolves.toBeUndefined();
  });

  it('a punch cancelled while its scene is still loading never shows up', async () => {
    const { m, area, anchor } = await fresh();
    const buzz = vi.fn();
    const hnd = m.play('hourglass', { anchor, time: '08:00', buzz });
    hnd.cancel();
    await settle();
    expect(layers(area)).toHaveLength(0);
    expect(buzz).not.toHaveBeenCalled();
  });

  it('lazy: a punch loads the core stylesheet and only its own scene', async () => {
    const { m, doc, anchor } = await fresh();
    expect(doc.head.childNodes).toHaveLength(0); // importing the core loads nothing yet
    m.play('tally', { anchor, time: '08:00' });
    await settle();
    expect(doc.head.childNodes.map((/** @type {any} */ l) => l.getAttribute('href'))).toEqual(['/punchfx.css', '/fx/tally.css']);
    m.play('stamp', { anchor, time: '08:00' });
    await settle();
    expect(doc.head.childNodes.map((/** @type {any} */ l) => l.getAttribute('href'))).toEqual(['/punchfx.css', '/fx/tally.css', '/fx/stamp.css']);
    m.play('tally', { anchor, time: '08:00' });
    await settle();
    expect(doc.head.childNodes).toHaveLength(3); // loaded once
    m.cancelAll();
  });

  it('a scene that cannot load shows nothing, but the punch still gets its plain buzz', async () => {
    const { m, area, anchor } = await fresh({ failCss: /typewriter/ });
    const buzz = vi.fn();
    const hnd = m.play('typewriter', { anchor, time: '08:00', buzz });
    await settle();
    await expect(hnd.done).resolves.toBeUndefined();
    expect(layers(area)).toHaveLength(0);
    expect(buzz).toHaveBeenCalledWith([15]);
  });

  it('preview: plays in the box, keeps its last frame; still: a frozen drawing for every animation', async () => {
    const { m, doc } = await fresh();
    const box = doc.createElement('div');
    doc.body.append(box);
    const hnd = m.preview('validator', box, { time: '08:02' });
    await settle();
    expect(box.childNodes[0].getAttribute('class')).toContain('pfx-preview');
    await new Promise((r) => setTimeout(r, m.DURATION.validator + 100));
    await expect(hnd.done).resolves.toBeUndefined();
    expect(box.childNodes).toHaveLength(1); // the last frame stays
    expect(box.childNodes[0].getAttribute('class')).not.toContain('pfx-run'); // will-change only while running
    for (const n of m.NAMES) {
      const el = await m.still(n, { time: '08:02' });
      expect(el?.getAttribute('class'), n).toContain('pfx-still');
      expect(el?.style.getPropertyValue('--pfx-d'), n).toBe(`${m.DURATION[n]}ms`);
    }
  });

  it('HAL speaks to the user by name: as text nodes, cut to 14 characters, «Dave» without one', async () => {
    const { m, area, anchor } = await fresh();
    const said = () => layers(area)[0].all().filter((/** @type {any} */ e) => e.tagName === 'text').map((/** @type {any} */ e) => e.textContent);
    m.play('hal', { anchor, time: '08:02', user: 'benj' });
    await settle();
    expect(said()).toEqual(["I'm sorry, benj.", "I'm afraid I can't do that."]);
    m.play('hal', { anchor, time: '08:02', user: 'a.very.long.username-32-chars.xx' });
    await settle();
    expect(layers(area)).toHaveLength(1);
    expect(said()[0]).toBe("I'm sorry, a.very.long.us….");
    m.play('hal', { anchor, time: '08:02' });
    await settle();
    expect(said()[0]).toBe("I'm sorry, Dave.");
    const el = await m.still('hal', { user: '<b>x</b>' });
    expect(el?.all().filter((/** @type {any} */ e) => e.tagName === 'text')[0].textContent).toBe("I'm sorry, <b>x</b>."); // text, never markup
    m.cancelAll();
  });

  it('HAL runs longest, but a punch while it speaks still cancels it like any other (one layer, no late buzz)', async () => {
    const { m, area, anchor } = await fresh();
    await m.load('hal');
    await m.load('stamp');
    vi.useFakeTimers();
    const b1 = vi.fn();
    const first = m.play('hal', { anchor, time: '08:00', user: 'benj', buzz: b1 });
    await vi.advanceTimersByTimeAsync(m.DURATION.hal - 600); // the quote is up
    expect(b1).toHaveBeenCalledTimes(1);
    m.play('stamp', { anchor, time: '08:01' });
    await expect(first.done).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(layers(area)).toHaveLength(1);
    expect(layers(area)[0].all().some((/** @type {any} */ e) => e.getAttribute('class')?.includes('pfx-stamp'))).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(layers(area)).toHaveLength(0);
    expect(b1).toHaveBeenCalledTimes(1);
  });

  it('HAL: the name rules and a quote that fits the stage with the widest 14-character name', async () => {
    installFakeDom();
    const { quoteName, quote, fitSize, NAME_MAX } = await import('../../public/fx/hal.js');
    expect(NAME_MAX).toBe(14);
    expect(quoteName('benj')).toBe('benj');
    expect(quoteName('  benj ')).toBe('benj');
    expect(quoteName('abcdefghijklmn')).toBe('abcdefghijklmn'); // exactly 14: whole
    expect(quoteName('abcdefghijklmno')).toBe('abcdefghijklmn…');
    for (const v of [undefined, null, '', '   ', 42]) expect(quoteName(v), String(v)).toBe('Dave');
    expect(quote('dave')).toEqual(["I'm sorry, dave.", "I'm afraid I can't do that."]);
    // the base size for an ordinary name; smaller for the widest one, never so small it cannot be read
    expect(fitSize(quote('benj')[0])).toBe(10.5);
    expect(fitSize(quote('benj')[1])).toBe(10.5);
    const wide = fitSize(quote('m'.repeat(32))[0]);
    expect(wide).toBeLessThan(10.5);
    expect(wide).toBeGreaterThanOrEqual(6.5);
  });

  it('the sundial puts the shadow on the hour (night hours rest at the edge)', async () => {
    installFakeDom();
    const { hourAngle } = await import('../../public/fx/sundial.js');
    expect(hourAngle('06:00')).toBe(-90);
    expect(hourAngle('12:00')).toBe(0);
    expect(hourAngle('15:30')).toBe(52.5);
    expect(hourAngle('23:10')).toBe(90);
    expect(hourAngle('02:00')).toBe(-90);
  });

  it('the clock tower sets its hands to the time of the punch', async () => {
    installFakeDom();
    const { hands } = await import('../../public/fx/tower.js');
    expect(hands('22:04')).toEqual({ hour: 302, minute: 24 });
    expect(hands('06:30')).toEqual({ hour: 195, minute: 180 });
    expect(hands('12:00')).toEqual({ hour: 0, minute: 0 });
    expect(hands('')).toEqual({ hour: 305, minute: 60 });
  });
});

beforeEach(() => {
  vi.useRealTimers();
});
