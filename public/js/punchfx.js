// Punch animations, «stamping through the ages». Decoration only: loaded lazily by the app when an
// animation is about to play (after the punch is written) or when the picker in the settings opens.
// This core holds the list, the timing and the stage; each drawing lives in its own module
// /fx/<name>.js with its keyframes in /fx/<name>.css, loaded only when that one plays (or the picker
// shows its still). One layer (aria-hidden, no pointer events) over the punch button, removed at the
// end or on cancel. Drawn with the DOM helpers, animated by CSS keyframes only (no inline styles: CSP;
// only CSSOM custom properties and box sizes). Every scene has three beats: anticipation, the impact
// at `hit` (where the stage gives a small shake and the phone a short buzz), and the settle.

import { h, s } from './dom.js';

/**
 * Every animation, oldest idea first (the picker's order): duration (600–1100 ms), the impact as a
 * share of it, the vibration pattern played at the impact, and whether the stage shakes there.
 * @type {Record<string, { d: number, hit: number, buzz: number[], shake?: false }>}
 */
const FX = {
  sundial: { d: 1100, hit: 0.62, buzz: [12], shake: false },
  hourglass: { d: 1100, hit: 0.3, buzz: [14, 620, 10] },
  tally: { d: 800, hit: 0.42, buzz: [14] },
  seal: { d: 950, hit: 0.4, buzz: [26] },
  stamp: { d: 900, hit: 0.4, buzz: [22] },
  typewriter: { d: 1100, hit: 0.16, buzz: [6, 126, 6, 126, 6, 126, 6, 126, 6, 150, 18] },
  clock: { d: 1000, hit: 0.44, buzz: [12, 70, 16] },
  card: { d: 850, hit: 0.44, buzz: [12] },
  turnstile: { d: 950, hit: 0.56, buzz: [8, 60, 18] },
  flip: { d: 1000, hit: 0.32, buzz: [5, 75, 5, 75, 5, 75, 8], shake: false },
  validator: { d: 1000, hit: 0.42, buzz: [10, 40, 20] },
  badge: { d: 900, hit: 0.4, buzz: [8, 50, 8] },
  finger: { d: 1000, hit: 0.58, buzz: [10], shake: false },
  iris: { d: 1100, hit: 0.6, buzz: [6, 110, 14], shake: false },
  nfc: { d: 900, hit: 0.4, buzz: [8, 60, 8] },
  button: { d: 700, hit: 0.3, buzz: [16] },
};

export const NAMES = Object.freeze(Object.keys(FX));
/** Duration of each animation in ms. */
export const DURATION = Object.freeze(Object.fromEntries(NAMES.map((n) => [n, FX[n].d])));
/** When the impact happens, in ms from the start. */
export const IMPACT = Object.freeze(Object.fromEntries(NAMES.map((n) => [n, Math.round(FX[n].d * FX[n].hit)])));
/** The vibration pattern at the impact. */
export const BUZZ = Object.freeze(Object.fromEntries(NAMES.map((n) => [n, Object.freeze([...FX[n].buzz])])));

// ------------------------------------------------------------ drawing kit for the scene modules

/** Brand and drawing colours (the scenes sit on a light «paper» panel in both themes). */
export const C = Object.freeze({
  coral: '#FF6B4A',
  coralDark: '#c9452c',
  slate: '#2B3238',
  slateLight: '#55606b',
  steel: '#c8ced6',
  paper: '#f4eee0',
  edge: '#c9bea6',
  ink: '#6b3fa0',
  wood: '#b98149',
  woodDark: '#5b3a1a',
  woodLight: '#d9a066',
  ok: 'var(--in, #1a7f47)',
  white: '#ffffff',
});

export { s };

/** A group. @param {string} cls @param {...any} kids */
export const g = (cls, ...kids) => s('g', { class: cls }, ...kids);
/** @param {string} d @param {Record<string, any>} [a] */
export const path = (d, a = {}) => s('path', { d, fill: 'none', ...a });
/** @param {number} x @param {number} y @param {string} str @param {string} fill @param {number} [size] @param {Record<string, any>} [a] */
export const text = (x, y, str, fill, size = 15, a = {}) =>
  s('text', { x, y, fill, 'font-size': size, 'font-weight': 800, 'text-anchor': 'middle', 'font-family': 'system-ui, sans-serif', ...a }, str);
/** A check mark drawn by stroke-dashoffset. @param {string} d @param {string} [stroke] @param {number} [w] */
export const check = (d, stroke = C.ok, w = 7) =>
  path(d, { class: 'pfx-a pfx-check', stroke, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1 });

/**
 * Set CSS custom properties through the CSSOM (allowed by the CSP, unlike style attributes).
 * @template {Element} T @param {T} el @param {Record<string, string | number>} vars @returns {T}
 */
export function vars(el, vars) {
  for (const [k, v] of Object.entries(vars)) /** @type {any} */ (el).style?.setProperty(`--${k}`, String(v));
  return el;
}

/**
 * Bits that fly off at the impact on a small arc (wood chips, chad, ink, wax): each is
 * [shape, dx, rise, fall, turn°]: out by dx, up by rise, then down to fall (user units).
 * @param {[any, number, number, number, number][]} list @param {string} [cls]
 */
export const bits = (list, cls = '') =>
  list.map(([el, dx, rise, fall, turn]) =>
    vars(g(`pfx-bx ${cls}`, vars(g('pfx-by', g('pfx-br', el)), { rise: `${-rise}px`, fall: `${fall}px`, turn: `${turn}deg` })), { dx: `${dx}px` }),
  );

let uidN = 0;
/** A document-unique id for clip paths and gradients (scenes can be on the page several times). @param {string} p */
export const uid = (p) => `pfx-${p}-${++uidN}`;

// ------------------------------------------------------------ loading

/** @type {Map<string, Promise<void>>} */
const sheets = new Map();
/** Load a stylesheet once; resolves when it applies (no unstyled frame). @param {string} href */
function sheet(href) {
  if (typeof document === 'undefined') return Promise.resolve();
  let p = sheets.get(href);
  if (!p) {
    p = new Promise((ok, fail) => {
      const old = document.querySelector(`link[data-punchfx="${href}"]`);
      if (old) return ok();
      const link = h('link', { rel: 'stylesheet', href, 'data-punchfx': href });
      link.addEventListener('load', () => ok());
      link.addEventListener('error', () => {
        link.remove();
        fail(new Error(`css ${href}`));
      });
      document.head.append(link);
    });
    sheets.set(href, p);
    p.catch(() => sheets.delete(href));
  }
  return p;
}

/** @typedef {(time: string, o: { mini?: boolean }) => any[]} Build */
/** @type {Map<string, Promise<Build>>} */
const scenes = new Map();

/** The scene module and its stylesheet (and the core one), once. @param {string} name @returns {Promise<Build>} */
export function load(name) {
  if (!(name in FX)) return Promise.reject(new Error(`unknown ${name}`));
  let p = scenes.get(name);
  if (!p) {
    p = Promise.all([import(`../fx/${name}.js`), sheet('/punchfx.css'), sheet(`/fx/${name}.css`)]).then(([m]) => m.default);
    scenes.set(name, p);
    p.catch(() => scenes.delete(name));
  }
  return p;
}

// ------------------------------------------------------------ playing

/** @param {string} name @param {HTMLElement | SVGElement} el */
const timing = (name, el) => vars(el, { 'pfx-d': `${FX[name].d}ms`, 'pfx-hit': `${IMPACT[name]}ms` });

/** Scene SVG. @param {string} name @param {Build} build @param {string} time @param {boolean} [mini] */
const svgFor = (name, build, time, mini = false) =>
  s(
    'svg',
    {
      class: `pfx-svg pfx-${name}`,
      viewBox: '0 0 160 80',
      'aria-hidden': 'true',
      focusable: 'false',
      preserveAspectRatio: name === 'button' && !mini ? 'xMaxYMid meet' : null,
    },
    build(time || '', { mini }),
  );

const noop = () => ({ cancel() {}, done: Promise.resolve() });

/** @type {null | { cancel(): void }} */
let current = null;
/** @type {null | { cancel(): void }} */
let currentPreview = null;

/**
 * Play one animation over the punch button. Cancels a running one first. Never throws.
 * `buzz` (navigator.vibrate, when there is one) is called once with the pattern at the impact.
 * @param {string} name one of NAMES @param {{ anchor: HTMLElement, time?: string, buzz?: ((p: number[]) => void) | null }} o
 * @returns {{ cancel(): void, done: Promise<void> }}
 */
export function play(name, o) {
  try {
    current?.cancel();
    current = null;
    const anchor = o?.anchor;
    const area = anchor?.parentElement;
    if (!area || !(name in FX)) return noop();
    const f = FX[name];
    /** @type {HTMLElement | null} */
    let layer = null;
    /** @type {any[]} */
    const timers = [];
    let over = false;
    /** @type {() => void} */
    let finish = () => {};
    const done = new Promise((r) => (finish = /** @type {() => void} */ (r)));
    const buzz = (/** @type {number[]} */ p) => {
      try {
        o.buzz?.(p);
      } catch {
        /* decoration only */
      }
    };
    const end = () => {
      if (over) return;
      over = true;
      for (const t of timers) clearTimeout(t);
      layer?.remove();
      anchor.classList.remove('pfx-recoil');
      if (current === handle) current = null;
      finish();
    };
    const handle = { cancel: end, done };
    current = handle;
    load(name).then(
      (build) => {
        if (over) return;
        layer = timing(name, h('div', { class: `pfx-layer pfx-run pfx-on-${name === 'button' ? 'button' : 'stage'}`, 'aria-hidden': 'true' }));
        // Exactly over the button (the area is position: relative): no layout shift, nothing outside it.
        for (const [k, v] of /** @type {[string, number][]} */ ([
          ['top', anchor.offsetTop],
          ['left', anchor.offsetLeft],
          ['width', anchor.offsetWidth],
          ['height', anchor.offsetHeight],
        ]))
          layer.style.setProperty(k, `${v}px`);
        const svg = svgFor(name, build, o.time || '');
        if (name === 'button') {
          layer.append(svg);
          anchor.classList.remove('pfx-recoil');
          void anchor.offsetWidth; // restart the button's own animation
          anchor.classList.add('pfx-recoil');
        } else layer.append(h('div', { class: 'pfx-stage' }, h('div', { class: f.shake === false ? 'pfx-shake pfx-calm' : 'pfx-shake' }, svg)));
        area.append(layer);
        timers.push(setTimeout(end, f.d + 60));
        if (o.buzz) timers.push(setTimeout(() => buzz(f.buzz), IMPACT[name]));
      },
      () => {
        // The scene could not be loaded: no picture, but the punch still gets its plain buzz.
        if (over) return;
        buzz([15]);
        end();
      },
    );
    return handle;
  } catch {
    return noop();
  }
}

/**
 * Play a larger preview once inside `box` (its content is replaced when the scene is ready; the last
 * frame stays, so the settings do not jump). One preview at a time. Never throws.
 * @param {string} name @param {HTMLElement} box @param {{ time?: string }} [o]
 * @returns {{ cancel(): void, done: Promise<void> }}
 */
export function preview(name, box, o = {}) {
  try {
    currentPreview?.cancel();
    currentPreview = null;
    if (!box || !(name in FX)) return noop();
    const f = FX[name];
    let over = false;
    /** @type {any} */
    let timer = null;
    /** @type {HTMLElement | null} */
    let layer = null;
    /** @type {() => void} */
    let finish = () => {};
    const done = new Promise((r) => (finish = /** @type {() => void} */ (r)));
    const end = () => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      layer?.classList.remove('pfx-run');
      if (currentPreview === handle) currentPreview = null;
      finish();
    };
    const handle = { cancel: end, done };
    currentPreview = handle;
    load(name).then(
      (build) => {
        if (over) return;
        layer = timing(name, h('div', { class: 'pfx-preview pfx-run', 'aria-hidden': 'true' }));
        layer.append(h('div', { class: f.shake === false ? 'pfx-shake pfx-calm' : 'pfx-shake' }, svgFor(name, build, o.time || '', true)));
        box.replaceChildren(layer);
        timer = setTimeout(end, f.d + 60);
      },
      () => end(),
    );
    return handle;
  } catch {
    return noop();
  }
}

/**
 * A still drawing of one animation (its impact or settle frame), e.g. for the picker's tiles.
 * Resolves to an SVG element, or null when it cannot be drawn.
 * @param {string} name @param {{ time?: string }} [o] @returns {Promise<SVGElement | null>}
 */
export async function still(name, o = {}) {
  try {
    const build = await load(name);
    const svg = timing(name, svgFor(name, build, o.time || '', true));
    svg.classList.add('pfx-still');
    return svg;
  } catch {
    return null;
  }
}

/** Stop the preview (its last frame stays). */
export function cancelPreview() {
  currentPreview?.cancel();
  currentPreview = null;
}

/** Stop everything (e.g. when leaving the start screen). */
export function cancelAll() {
  current?.cancel();
  currentPreview?.cancel();
  current = currentPreview = null;
}
