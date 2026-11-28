// Modern Times: sepia silent film. Wheels drive a rack that pushes a time card into a time clock,
// which thumps and prints the time; then an intertitle (our own frame and words).
import { s, g, path, text, vars, uid } from '../js/punchfx.js';

const INK = '#2a2016';
const RIM = '#8d7250';
const GOLD = '#cbbb94';
const R = Math.PI / 180;
/** @param {number} n */
const f = (n) => n.toFixed(1);
/** x y of a polar step, 0° up. @param {number} a @param {number} l */
const pol = (a, l) => `${f(l * Math.sin(a * R))} ${f(-l * Math.cos(a * R))}`;
/** A circle as a sub-path. @param {number} x @param {number} y @param {number} r */
const ring = (x, y, r) => `M${f(x - r)} ${y}a${r} ${r} 0 1 0 ${f(2 * r)} 0a${r} ${r} 0 1 0 ${f(-2 * r)} 0Z`;
/** @param {string} d @param {string} c @param {number} w */
const line = (d, c, w) => path(d, { stroke: c, 'stroke-width': w, 'stroke-linecap': 'round' });
/** @param {number} cx @param {number} cy @param {number} r @param {number} w */
const rim = (cx, cy, r, w) => s('circle', { cx, cy, r, fill: 'none', stroke: RIM, 'stroke-width': w });

/** The intertitle. @param {boolean} [out] */
export const caption = (out) => (out ? 'Closing time!' : 'Back to the machines!');

/** A wheel: n teeth (even: turns about its centre; pitch 10: they mesh), tooth 0 at `at`°, turns by `t`°. @param {number} cx @param {number} cy @param {number} n @param {number} at @param {number} t */
function wheel(cx, cy, n, at, t) {
  const r = (n * 5) / Math.PI;
  const st = 360 / n;
  /** @param {number} a @param {number} q */
  const pt = (a, q) => `${f(cx + q * Math.cos(a * R))} ${f(cy + q * Math.sin(a * R))}`;
  let d = '';
  for (let a = at; a < at + 359; a += st) d += `${d ? 'L' : 'M'}${pt(a - st * 0.3, r - 2.8)}L${pt(a - st * 0.15, r + 2.8)}L${pt(a + st * 0.15, r + 2.8)}L${pt(a + st * 0.3, r - 2.8)}`;
  d += `Z${ring(cx, cy, 2)}`;
  // the big wheel has five windows
  if (n > 12) for (let a = 8; a < 360; a += 72) d += ring(cx + 12 * Math.cos(a * R), f(cy + 12 * Math.sin(a * R)), 3.6);
  return vars(g('pfx-gw', path(d, { fill: '#5e4833', 'fill-rule': 'evenodd', stroke: INK, 'stroke-width': 0.7 }), rim(cx, cy, r - 4.6, 0.8), rim(cx, cy, 4, 1.2)), { m: `rotate(${t}deg)`, o: `rotate(${f(t * -0.07)}deg)` });
}

export default (/** @type {string} */ time, /** @type {{ out?: boolean }} */ o = {}) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(time || '') || [0, 10, 10];
  const vig = uid('gr-vig');
  // the rack meshes with the pinion (pitch line x 83.1) and carries the arm
  let rack = 'M85.7 -60H90V50H85.7ZM89 3H137V8.5H89Z';
  for (let y = -24.4; y < 45; y += 10) rack += `M85.9 ${f(y)}l-5.6 1.5v3l5.6 1.5Z`;
  let dial = '';
  for (let a = 0; a < 360; a += 30) dial += `M120 55m${pol(a, 7)}l${pol(a, 1.6)}`;
  /** @param {string} fill */
  const big = (fill, cls = '') => s('rect', { class: cls, x: -160, y: -80, width: 480, height: 240, fill });
  return [
    s('defs', {}, s('radialGradient', { id: vig }, s('stop', { offset: '58%', 'stop-color': INK, 'stop-opacity': 0 }), s('stop', { offset: 1, 'stop-color': INK, 'stop-opacity': 0.6 }))),
    big('#e2d0aa'),
    s('rect', { x: -160, y: 76, width: 480, height: 20, fill: '#7a6141' }),
    g('pfx-grack', path(rack, { fill: '#46362a', stroke: INK, 'stroke-width': 0.6 })),
    // 14, 8 and 6 teeth, each tooth in a gap of its neighbour; the pinion moves the rack 22 down
    wheel(38, 47, 14, -22.5, -56.6),
    wheel(70.35, 33.6, 8, 0, 99),
    wheel(61.73, 68.22, 6, 41.79, 132),
    g(
      'pfx-gcard',
      s('rect', { x: 105, y: 8.5, width: 30, height: 30, rx: 1, fill: '#f6ecd6', stroke: INK, 'stroke-width': 0.7 }),
      line('M108.5 13h23M108.5 16.5h13M108 22.5h24M108 34.5h24', '#b9a07a', 0.8),
      g('pfx-gst', text(120, 31.2, time || '12:00', INK, 8, { 'font-family': 'ui-monospace, monospace', 'font-weight': 700 })),
    ),
    g(
      'pfx-gclk',
      s('rect', { x: 97, y: 36, width: 46, height: 41, rx: 2, fill: '#6b5338', stroke: INK }),
      s('rect', { x: 101.5, y: 34, width: 37, height: 3.6, rx: 1, fill: INK }),
      s('circle', { cx: 120, cy: 55, r: 10.5, fill: '#efe2c4', stroke: INK, 'stroke-width': 1.4 }),
      line(dial, INK, 0.9),
      line(`M120 55l${pol(((m[1] % 12) + m[2] / 60) * 30, 4.6)}M120 55l${pol(m[2] * 6, 7)}`, INK, 1.3),
      s('rect', { x: 110, y: 69.5, width: 20, height: 3, rx: 1, fill: RIM }),
    ),
    g('pfx-gbang', line('M146 34l5-4M147 41h6M146 48l5 3M94 33l-2-4', INK, 1.4)),
    g(
      'pfx-gtitle',
      big('#16110b'),
      line('M14 9H146V71H14ZM22.5 12.5H137.5A5 5 0 0 0 142.5 17.5V62.5A5 5 0 0 0 137.5 67.5H22.5A5 5 0 0 0 17.5 62.5V17.5A5 5 0 0 0 22.5 12.5ZM62 21H75M85 21H98M62 59H75M85 59H98', GOLD, 0.8),
      path(`${[17.5, 142.5].map((x) => ring(x, 12.5, 1.2) + ring(x, 67.5, 1.2)).join('')}M80 18.5l2.5 2.5-2.5 2.5-2.5-2.5ZM80 56.5l2.5 2.5-2.5 2.5-2.5-2.5Z`, { fill: GOLD }),
      text(80, o.out ? 44.8 : 43.6, caption(o.out), '#f1e8d4', o.out ? 14 : 10.5, { 'font-family': 'Georgia, serif', 'font-weight': 400 }),
    ),
    g('pfx-gdust', line('M30 20h0M95 64h0M131 15h0M58 41h0M147 52h0', INK, 0.9), line('M44 60h0M118 23h0M76 9h0M140 70h0M22 33h0', '#fff4da', 0.9), line('M52 -30V110', '#9c8a66', 0.4)),
    big('#fff6dc', 'pfx-a pfx-gflk'),
    s('rect', { width: 160, height: 80, fill: `url(#${vig})` }),
    // the round gate
    s('rect', { x: -39, y: -39, width: 238, height: 158, rx: 50, fill: 'none', stroke: '#0d0a06', 'stroke-width': 80 }),
  ];
};
