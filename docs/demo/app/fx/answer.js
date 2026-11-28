// «The Hitchhiker's Guide», by allusion only: a vast, calm computer of our own design thinks, answers
// 42, glitches and corrects itself to the time of the punch (impact). Then its own line.
import { s, g, path, text, vars, uid } from '../js/punchfx.js';

const MINT = '#8affd8';
const DARK = '#14181c';
const ROUND = { 'stroke-linecap': 'round' };
/** English in every language, in and out. */
export const LINES = ['The right answer would be 42.', 'But nobody\u2019s perfect.'];

/** Dots: zero-length round strokes. @param {number[]} xy */
const dots = (xy) => xy.map((v, i) => (i % 2 ? `${v}h.01` : `M${v} `)).join('');
const STARS = [3, 8, 24, 1.5, 47, 3, 62, 4, 81, 2.2, 97, 6.5, 109, 4.5, 138, 1.2, 157, 12, 5, 40, 155, 48, -14, 30, -30, 6, 176, 26, 192, 4, -8, 66, 170, 70, -22, 50, 184, 46];
/** Lamps lit after the answer (3 × 4 per tower). */
const LIT = [1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 0, 1];
const COLORS = ['#ff6b4a', '#ffc24a', MINT];

export default (/** @type {string} */ time) => {
  const t = /^\d{1,2}:\d{2}$/.test(time) ? time : '12:00';
  const [sky, cab, glow, scan] = ['s', 'c', 'g', 'l'].map((p) => uid(`ans-${p}`));
  const stop = (/** @type {number} */ at, /** @type {string} */ c, op = 1) => s('stop', { offset: `${at}%`, 'stop-color': c, 'stop-opacity': op });
  const scr = { x: 51.5, y: 15.5, width: 57, height: 27, rx: 1.5 };
  const big = (/** @type {string} */ str, /** @type {string} */ fill, size = 22, y = 37) =>
    text(80, y, str, fill, size, { 'font-family': 'ui-monospace, Menlo, Consolas, monospace', 'font-weight': 700 });
  const line = (/** @type {number} */ y, /** @type {any} */ str) => text(80, y, str, '#ece7de', 8.4, { 'font-weight': 400 });
  const lamps = [];
  const sockets = [];
  for (let i = 0; i < 24; i++) {
    const [k, r, c] = [i >= 12 ? 1 : 0, Math.floor(i / 3) % 4, i % 3];
    const [x, y] = [(k ? 125 : 17) + c * 9, 12 + r * 7.5];
    sockets.push(x, y);
    const lamp = s('circle', { class: `pfx-a pfx-alamp${LIT[i % 12] ? ' pfx-alit' : ''}`, cx: x, cy: y, r: 2, fill: COLORS[(r + (k ? 2 - c : c)) % 3] });
    lamps.push(vars(lamp, { lag: `${((i * 7) % 24) * 15}ms` }));
  }
  return [
    s(
      'defs',
      {},
      s('linearGradient', { id: sky, x2: 0, y2: 1 }, stop(0, '#1a2136'), stop(100, '#06080f')),
      s('linearGradient', { id: cab, x2: 0, y2: 1 }, stop(0, '#3a434b'), stop(100, '#1c2126')),
      s('radialGradient', { id: glow, r: '55%' }, stop(0, MINT, 0.32), stop(100, MINT, 0)),
      s('pattern', { id: scan, width: 4, height: 1.5, patternUnits: 'userSpaceOnUse' }, s('rect', { width: 4, height: 0.5, 'fill-opacity': 0.28 })),
    ),
    // past the viewBox: dark at any stage shape
    s('rect', { x: -160, y: -80, width: 480, height: 240, fill: `url(#${sky})` }),
    g('pfx-astars', path(dots(STARS), { stroke: '#fff', 'stroke-width': 0.8, ...ROUND })),
    // the machine (the picker's tile shows it alone)
    g(
      'pfx-amach',
      path('M11 4H41Q44 4 44 7V10H116V7Q116 4 119 4H149Q152 4 152 7V54H8V7Q8 4 11 4Z', { fill: `url(#${cab})`, stroke: '#55606b', 'stroke-width': 0.7 }),
      path('M11 5.1H41M46 11.1H114M119 5.1H149', { stroke: '#fff', 'stroke-opacity': 0.14, 'stroke-width': 0.7 }),
      path('M44 10V54M116 10V54M14 43H38M14 46H38M14 49H38M122 43H146M122 46H146M122 49H146M56 48H104M56 51H104', { stroke: DARK, 'stroke-width': 0.9, ...ROUND }),
      s('rect', { x: 4, y: 54, width: 152, height: 3, rx: 1.2, fill: DARK }),
      path(dots(sockets), { stroke: '#11151a', 'stroke-width': 5.4, ...ROUND }),
      ...lamps,
      // the display: dots, the 42 (ghost and slices for the glitch), the time
      s('rect', { x: 49, y: 13, width: 62, height: 32, rx: 2.5, fill: '#0d1114', stroke: '#3a444c', 'stroke-width': 0.6 }),
      s('rect', { ...scr, fill: '#06211d' }),
      g('pfx-aglow', s('rect', { ...scr, fill: `url(#${glow})` })),
      g('pfx-adots', ...[74, 80, 86].map((cx, n) => vars(s('circle', { class: 'pfx-a pfx-adot', cx, cy: 29, r: 1.6, fill: MINT }), { lag: `${n * 130}ms` }))),
      g('pfx-aghost', big('42', COLORS[0]), path('M53 22.5H107M53 30H107M53 35.5H107', { stroke: MINT, 'stroke-opacity': 0.5, 'stroke-width': 1.3 })),
      g('pfx-a42', big('42', MINT)),
      g('pfx-atime', big(t, MINT, 15.5, 34.6)),
      g('pfx-aflash', s('rect', { ...scr, fill: '#e9fff8' })),
      s('rect', { ...scr, fill: `url(#${scan})` }),
    ),
    g('pfx-al1', line(65, [LINES[0].slice(0, -3), s('tspan', { fill: MINT }, '42'), '.'])),
    g('pfx-al2', line(75.5, LINES[1])),
  ];
};
