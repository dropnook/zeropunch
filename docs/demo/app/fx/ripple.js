// Ripple (Jurassic Park): night, rain on the windscreen, a glass of water on a car's dashboard at the
// jungle's edge. Two heavy, distant thumps: each sends rings across the water (a tilted ellipse), the
// glass trembles, the gauges twitch. Nothing else is shown, on purpose.
import { s, g, path, vars, uid } from '../js/punchfx.js';

const CX = 80;
// the glass: rim, foot, their radii; the water surface and its radii; the view's tilt
const TOP = 9;
const FOOT = 62;
const RT = 19;
const RB = 14;
const WY = 27;
const WR = 16;
const WRY = 4.4;
const TILT = 0.27;

/** @param {string} d @param {string} stroke @param {number} w @param {Record<string, any>} [a] */
const line = (d, stroke, w, a = {}) => path(d, { stroke, 'stroke-width': w, 'stroke-linecap': 'round', ...a });
/** @param {number} cy @param {number} rx @param {number} ry @param {Record<string, any>} a */
const oval = (cy, rx, ry, a) => s('ellipse', { cx: CX, cy, rx, ry, ...a });
/** A cup outline from the rim (y0, r0) down to the foot (y1, r1). @param {number} y0 @param {number} r0 @param {number} y1 @param {number} r1 */
const cup = (y0, r0, y1, r1) => `M${CX - r0} ${y0} L${CX - r1} ${y1} A${r1} ${r1 * TILT} 0 0 0 ${CX + r1} ${y1} L${CX + r0} ${y0}`;

/** A dashboard gauge whose needle twitches with the thumps. @param {number} x @param {string} cls */
const gauge = (x, cls) => [
  s('circle', { cx: x, cy: 73, r: 6, fill: '#0b1113', stroke: '#5f6d75', 'stroke-width': 1 }),
  line(`M${x - 4.2} 75.5 A4.6 4.6 0 1 1 ${x + 4.2} 75.5`, '#3fae8a', 0.8, { 'stroke-opacity': 0.75 }),
  g(cls, line(`M${x} 73 L${x - 3.2} 70.4`, '#FF6B4A', 1.1)),
  s('circle', { cx: x, cy: 73, r: 1, fill: '#c8ced6' }),
];

export default () => {
  const id = { sky: uid('rp-sky'), clip: uid('rp-clip') };
  const stop = (/** @type {number} */ at, /** @type {string} */ c) => s('stop', { offset: `${at}%`, 'stop-color': c });
  const wb = FOOT - 4.5;
  const rings = [];
  // three rings per thump, the second thump 404 ms after the first (the buzz's second pulse)
  for (const t of [0, 404])
    for (const k of [0, 95, 190])
      rings.push(
        vars(g('pfx-rp-r', oval(WY, WR, WRY, { fill: 'none', stroke: '#f4feff', 'stroke-width': 1.1 }), oval(WY, WR * 0.86, WRY * 0.86, { fill: 'none', stroke: '#2c7385', 'stroke-width': 0.9 })), {
          lag: `calc(var(--pfx-hit) + ${t + k}ms)`,
        }),
      );
  return [
    s(
      'defs',
      {},
      s('linearGradient', { id: id.sky, x1: 0, y1: 0, x2: 0, y2: 1 }, stop(0, '#28494c'), stop(100, '#10262a')),
      s('clipPath', { id: id.clip }, oval(WY, WR, WRY, {})),
    ),
    g(
      'pfx-rp-k pfx-rp-all',
      // the night outside (past the viewBox: dark at any stage shape), the tree line, big leaves, rain
      s('rect', { x: -160, y: -80, width: 480, height: 240, fill: `url(#${id.sky})` }),
      s('path', { d: 'M-10 62 V48 Q4 40 14 46 Q22 36 34 43 Q44 37 52 44 L108 45 Q118 36 128 43 Q140 35 150 44 Q160 40 170 47 V62 Z', fill: '#0d1d1d' }),
      g(
        'pfx-rp-k pfx-rp-leaf',
        s('path', { d: 'M-6 -4 Q18 4 30 22 Q10 18 -6 8 Z M-8 16 Q8 20 16 34 Q2 32 -8 26 Z M166 -4 Q140 2 128 20 Q148 18 166 8 Z M168 18 Q152 22 145 33 Q158 32 168 27 Z', fill: '#0a1616' }),
        line('M-4 2 Q16 10 28 21 M164 2 Q144 8 130 19', '#1b3433', 0.7),
      ),
      line('M24 9 l-1.5 4 M44 24 l-1.2 3.2 M58 6 l-1.4 3.8 M110 8 l-1.4 3.8 M121 27 l-1.2 3.2 M139 13 l-1.5 4 M33 33 l-1 2.6 M104 33 l-1 2.6', '#a9cfd3', 0.7, { 'stroke-opacity': 0.4 }),
      // the dashboard: its top, the padded edge, the front with two gauges, the glass's shadow
      s('path', { d: 'M-10 59 Q80 55 170 59 V68 H-10 Z', fill: '#323b42' }),
      s('rect', { x: -10, y: 66, width: 180, height: 16, fill: '#1c2226' }),
      line('M-10 66.5 H170', '#46525a', 1.4),
      ...gauge(30, 'pfx-rp-k pfx-rp-n'),
      ...gauge(130, 'pfx-rp-k pfx-rp-n pfx-rp-n2'),
      oval(FOOT + 0.3, 20, 3.2, { fill: '#0b1012', 'fill-opacity': 0.6 }),
      // the glass of water (it trembles as one)
      g(
        'pfx-rp-k pfx-rp-cup',
        s('path', { d: cup(TOP, RT, FOOT, RB), fill: '#dff3f6', 'fill-opacity': 0.14, stroke: '#e2f4f7', 'stroke-width': 1.1, 'stroke-linejoin': 'round' }),
        s('path', { d: `${cup(WY, WR, wb, RB - 1.4)} Z`, fill: '#4f9fb0', 'fill-opacity': 0.7 }),
        oval(wb + 0.4, RB - 1.4, (RB - 1.4) * TILT, { fill: '#cdebf0', 'fill-opacity': 0.22 }),
        g(
          'pfx-rp-k pfx-rp-face',
          oval(WY, WR, WRY, { fill: '#6dbccb' }),
          s('g', { 'clip-path': `url(#${id.clip})` }, ...rings),
          oval(WY, WR, WRY, { fill: 'none', stroke: '#d8f6fb', 'stroke-width': 0.6 }),
        ),
        oval(TOP, RT, RT * TILT, { fill: 'none', stroke: '#eefbfd', 'stroke-width': 1.1 }),
        line(`M${CX - RT + 3} ${TOP + 5} L${CX - RB + 2.2} ${FOOT - 6}`, '#fff', 1.6, { 'stroke-opacity': 0.5 }),
        line(`M${CX + RT - 3.5} ${TOP + 6} L${CX + RT - 4.2} ${TOP + 14}`, '#fff', 1, { 'stroke-opacity': 0.3 }),
      ),
    ),
  ];
};
