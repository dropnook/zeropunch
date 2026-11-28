// Digital rain: a black plate, a few columns of green glyphs (digits, some maths and latin signs,
// every other column mirrored) fall fast, slow down, and the punch time resolves in the middle out of
// two flickering scrambles, bright white-green. Our own glyph set in the system monospace face.
import { s, g, vars, uid } from '../js/punchfx.js';

const MONO = 'ui-monospace, Menlo, Consolas, "DejaVu Sans Mono", "Roboto Mono", monospace';
const GLYPHS = '0123456789Z∑πΔ±≡÷<>*=+¦T7314';
const STEP = 8.4;
const GREEN = '#22d65a';
const HEAD = '#d6ffe2';
const BRIGHT = '#effff3';
/** Columns: x, glyphs, where the head starts and ends (user units; it slows down on the way). */
const COLS = [
  [9, 5, -10, 96],
  [26, 4, 30, 84],
  [43, 6, -34, 66],
  [60, 4, 14, 104],
  [77, 5, -26, 58],
  [94, 4, 40, 92],
  [111, 6, -18, 72],
  [128, 4, 6, 100],
  [147, 5, -40, 80],
];

/** A small deterministic generator, seeded by the time (each punch rains a little differently). @param {string} seed */
function rng(seed) {
  let n = 7;
  for (const ch of seed) n = (n * 31 + ch.charCodeAt(0)) % 2147483647;
  return () => (n = (n * 16807) % 2147483647) / 2147483647;
}

export default (/** @type {string} */ time, /** @type {{ mini?: boolean }} */ _o = {}) => {
  const t = /^\d{1,2}:\d{2}$/.test(time) ? time.padStart(5, '0') : '00:00';
  const r = rng(t);
  const pick = () => GLYPHS[Math.floor(r() * GLYPHS.length)];
  const scramble = () => [...t].map((ch) => (ch === ':' ? ':' : pick())).join('');
  const font = { 'font-family': MONO, 'text-anchor': 'middle' };
  const id = uid('rain-hush');
  const cols = COLS.map(([x, n, a, b], i) => {
    const spans = [];
    for (let k = 0; k < n; k++) {
      const head = k === n - 1;
      spans.push(s('tspan', { x, dy: k ? STEP : 0, fill: head ? HEAD : GREEN, 'fill-opacity': head ? 1 : (0.22 + (0.7 * k) / (n - 1)).toFixed(2) }, pick()));
    }
    const mirror = i % 2 ? { transform: `matrix(-1 0 0 1 ${2 * x} 0)` } : {};
    return vars(g('pfx-rcol', s('text', { y: -(n - 1) * STEP, 'font-size': 7.4, 'font-weight': 600, ...font, ...mirror }, ...spans)), {
      a: `${a}px`,
      m: `${a + (b - a) * 0.82}px`,
      b: `${b}px`,
    });
  });
  const word = (/** @type {string} */ str, /** @type {Record<string, any>} */ a) => s('text', { x: 80, y: 49, 'font-size': 25, 'font-weight': 700, ...font, ...a }, str);
  return [
    s('defs', {}, s('radialGradient', { id, cx: '50%', cy: '50%', r: '50%' }, s('stop', { offset: '0%', 'stop-color': '#000', 'stop-opacity': 0.92 }), s('stop', { offset: '100%', 'stop-color': '#000', 'stop-opacity': 0 }))),
    // the plate reaches past the viewBox: the whole stage is black at any shape
    s('rect', { x: -160, y: -80, width: 480, height: 240, fill: '#020804' }),
    g('pfx-rrain', ...cols),
    // a soft dark hush behind the time, so it reads over the rain
    g('pfx-rhush', s('rect', { x: 22, y: 14, width: 116, height: 50, fill: `url(#${id})` })),
    g('pfx-rs1', word(scramble(), { fill: GREEN })),
    g('pfx-rs2', word(scramble(), { fill: GREEN })),
    g('pfx-rtime', word(t, { fill: 'none', stroke: '#57ff8e', 'stroke-width': 2.4, 'stroke-opacity': 0.5, 'stroke-linejoin': 'round' }), word(t, { fill: BRIGHT })),
  ];
};
