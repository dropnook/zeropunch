// Tron (homage): a black plate, a glowing grid floor. A light trail races in and, at right angles only,
// writes the time in our own neon segments, each lit as the trail closes it; the last is the impact and
// the digits glow up. Cyan in, orange out.
import { s, g, path, vars, uid, IMPACT } from '../js/punchfx.js';

const W = 19;
const TOP = 9;
const BOT = 43;
const HZ = 50;
const X = [28, 54, 87, 113];
/** Segments a–g as edges between a digit's corners A B / C D / E F. */
const EDGES = ['AB', 'BD', 'DF', 'EF', 'CE', 'AC', 'CD'];
const MASK = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
/** The trail's way through each digit: in at the bottom left, out at the bottom. */
const ROUTE = ['ECABDFE', 'EFDBDF', 'ECDBACEF', 'EFDBACDF', 'ECACDBDF', 'EFDCABDF', 'EFDCECABDF', 'ECABDF', 'ECABDFECDF', 'EFDBACDF'];
/** The trail starts (ms) as the stage has nearly sprung in. */
const T0 = 130;
const GRID = '#1ab4e8';

/** @param {number} x @param {string} c @returns {[number, number]} */
const corner = (x, c) => [/[BDF]/.test(c) ? x + W : x, c < 'C' ? TOP : c < 'E' ? (TOP + BOT) / 2 : BOT];

export default (/** @type {string} */ time, /** @type {{ out?: boolean }} */ o = {}) => {
  const m = /(\d{1,2}):(\d{2})/.exec(time || '');
  const digits = m ? [...(m[1].padStart(2, '0') + m[2])].map(Number) : [1, 2, 0, 0];
  const [lit, glow, core] = o.out ? ['#ffad5c', '#ff7a1a', '#fff4e6'] : ['#45ecff', '#00c2ff', '#effdff'];
  const [plate, sky, clip, blur] = ['plate', 'sky', 'clip', 'blur'].map((n) => uid(`grid-${n}`));
  const stop = (/** @type {number} */ at, /** @type {string} */ c, op = 1) => s('stop', { offset: `${at}%`, 'stop-color': c, 'stop-opacity': op });

  // in along the floor, up, through the digits, out to the right
  /** @type {[number, number][]} */
  const pts = [[-40, 66], [20, 66], [20, BOT]];
  /** @type {{ e: string, d: string, at: number }[]} */
  const segs = [];
  let len = 83;
  let colon = 0;
  const to = (/** @type {[number, number]} */ p) => {
    const q = pts[pts.length - 1];
    len += Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);
    pts.push(p);
  };
  digits.forEach((n, i) => {
    if (i === 2) colon = len + 80 - pts[pts.length - 1][0];
    const r = ROUTE[n];
    to(corner(X[i], r[0]));
    for (let k = 1; k < r.length; k++) {
      const [a, p] = [pts[pts.length - 1], corner(X[i], r[k])];
      const e = EDGES.indexOf([r[k - 1], r[k]].sort().join(''));
      to(p);
      if (MASK[n] & (1 << e) && !segs.some((sg) => sg.e === `${i}${e}`)) {
        const [dx, dy] = [Math.sign(p[0] - a[0]) * 2, Math.sign(p[1] - a[1]) * 2];
        segs.push({ e: `${i}${e}`, d: `M${a[0] + dx} ${a[1] + dy}L${p[0] - dx} ${p[1] - dy}`, at: len });
      }
    }
  });
  const last = Math.max(...segs.map((sg) => sg.at));
  to([140, BOT]);
  to([140, 66]);
  to([340, 66]);
  // constant speed: the last segment closes exactly at the impact
  const v = ((IMPACT.grid || 960) - T0) / last;
  const route = `M${pts.join('L')}`;
  const trail = (/** @type {string} */ cls, /** @type {number} */ dash, /** @type {string} */ c, /** @type {number} */ w, /** @type {number} */ op) =>
    vars(path(route, { class: `pfx-a ${cls}`, stroke: c, 'stroke-width': w, 'stroke-opacity': op, pathLength: 1, 'stroke-dasharray': `${dash} 2` }), {
      lag: `${T0}ms`,
      td: `${Math.round(len * v)}ms`,
      a: dash,
      b: dash - 1,
    });
  const seg = (/** @type {string} */ d, /** @type {number} */ at) =>
    vars(path(d, { class: 'pfx-a pfx-gs', stroke: lit, 'stroke-width': 3.4 }), { lag: `${Math.round(T0 + (at - 16) * v)}ms` });
  const dots = `M80 ${TOP + 9.5}v3.4M80 ${BOT - 12.9}v3.4`;
  const all = segs.map((sg) => sg.d).join('') + dots;

  // the floor: rays to a point above the horizon, rungs closing up toward it
  let rays = '';
  for (let i = -14; i <= 14; i++) rays += `M${80 + i * 9.6} ${HZ}L${80 + i * 52} 98`;
  let rungs = `M-160 ${HZ}H320`;
  for (const z of [1.15, 1.55, 2.1, 2.9, 4, 5.6, 8.2, 13]) rungs += `M-160 ${(HZ + 34 / z).toFixed(2)}H320`;
  const line = (/** @type {string} */ d) => path(d, { stroke: GRID, 'stroke-width': 0.5, 'stroke-opacity': 0.75 });

  return [
    s(
      'defs',
      {},
      s('linearGradient', { id: plate, x2: 0, y2: 1 }, stop(0, '#010207'), stop(50, '#04101d'), stop(54, '#0a2a40'), stop(56, '#03121e'), stop(100, '#010509')),
      s('linearGradient', { id: sky, x2: 0, y2: 1 }, stop(0, '#00b4ff', 0), stop(100, '#00b4ff', 0.32)),
      s('filter', { id: blur, x: '-20%', y: '-60%', width: '140%', height: '220%' }, s('feGaussianBlur', { stdDeviation: 2.2 })),
      s('clipPath', { id: clip }, s('rect', { x: -160, y: HZ - 0.6, width: 480, height: 120 })),
    ),
    // the dark plate reaches past the viewBox: the whole stage is dark at any shape
    s('rect', { x: -160, y: -80, width: 480, height: 240, fill: `url(#${plate})` }),
    g('pfx-gsky', s('rect', { x: -160, y: HZ - 14, width: 480, height: 14, fill: `url(#${sky})` })),
    s('g', { 'clip-path': `url(#${clip})` }, g('pfx-gfloor', line(rays), g('pfx-grun', line(rungs)))),
    g('pfx-ghz', path(`M-160 ${HZ}H320`, { stroke: '#8fe9ff', 'stroke-width': 0.8 })),
    trail('pfx-gtail', 0.16, glow, 2.4, 0.4),
    trail('pfx-gtail', 0.06, lit, 2, 0.85),
    g(
      'pfx-gdig',
      g('pfx-gglow', path(all, { stroke: glow, 'stroke-width': 4.4, 'stroke-opacity': 0.95, filter: `url(#${blur})` })),
      ...segs.map((sg) => seg(sg.d, sg.at)),
      seg(dots, colon),
      g('pfx-gcore', path(all, { stroke: core, 'stroke-width': 1.1 })),
    ),
    trail('pfx-ghead', 0.014, '#fff', 2.4, 1),
  ];
};
