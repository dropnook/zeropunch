// Interstellar (homage): a wheel station of our own turns before a far black hole. In: a capsule
// docks at the hub, matching its spin. Out: it lets go toward the black hole.
import { s, g, path, text, uid } from '../js/punchfx.js';

const X = 54;
const Y = 28;
const STEEL = '#c8ced6';
const DARK = '#2b3238';
// capsule headings (deg)
const IN = -26.6;
const OUT = -4.9;
// the wheel's turn at the impact (120deg over the scene, hit 30 %)
const AT_HIT = 36;

/** @param {boolean} [out] */
export const lines = (out) => (out ? ['One hour here.', 'Seven years out there.'] : ['Time runs differently here.']);

const f = (n) => +n.toFixed(2);
// points u, v turned by deg around the hub
function poly(p, deg, k = 1.3) {
  const c = Math.cos((deg * Math.PI) / 180) * k;
  const n = Math.sin((deg * Math.PI) / 180) * k;
  let d = '';
  for (let i = 0; i < p.length; i += 2) d += `${i ? 'L' : 'M'}${f(X + p[i] * c - p[i + 1] * n)} ${f(Y + p[i] * n + p[i + 1] * c)}`;
  return `${d}Z`;
}
const fill = (d, c, a = {}) => s('path', { d, fill: c, ...a });
const edge = { stroke: DARK, 'stroke-width': 0.6, 'stroke-linejoin': 'round' };

const capsule = (cls, deg, flame = false) =>
  g(
    cls,
    flame && g('pfx-sflame', fill(poly([-4, -1, -7.8, 0, -4, 1], deg), '#ffb36b')),
    fill(poly([-4.2, -1.8, 1.2, -1.8, 3.4, -1.2, 4.6, 0, 3.4, 1.2, 1.2, 1.8, -4.2, 1.8], deg), '#eef1f4', edge),
    fill(poly([1.6, -0.7, 2.8, -0.5, 2.8, 0.5, 1.6, 0.7], deg), '#3d6f9a'),
  );

function stars(x, n, c, w) {
  let d = '';
  const r = () => (x = (x * 16807) % 2147483647) / 2147483647;
  while (n--) d += `M${f(r() * 240 - 40)} ${f(r() * 110 - 15)}h.01`;
  return path(d, { stroke: c, 'stroke-width': w, 'stroke-linecap': 'round' });
}

export default (/** @type {string} */ _t, /** @type {{ out?: boolean }} */ o = {}) => {
  const id = [uid('st'), uid('st'), uid('st'), uid('st')];
  const url = (i) => `url(#${id[i]})`;
  const grad = (tag, i, a, ...st) =>
    s(tag, { id: id[i], ...a }, st.map(([at, c, op = 1]) => s('stop', { offset: `${at}%`, 'stop-color': c, 'stop-opacity': op })));
  const ring = (r, a, cx = X, cy = Y) => s('circle', { cx, cy, r, fill: 'none', ...a });
  const head = o.out ? OUT : IN;
  let mods = '';
  for (let k = 30; k < 360; k += 60) mods += poly([14.1, -2.3, 19.1, -2.3, 19.1, 2.3, 14.1, 2.3], k, 1);
  let spokes = '';
  for (let k = 90; k < 360; k += 120) spokes += poly([4, 0, 15, 0], k, 1);
  const said = lines(o.out);
  const say = (y, i) =>
    g(`pfx-sq${i + 1}`, text(80, y, said[i], '#ece7de', 9.4, { 'font-weight': 300, 'letter-spacing': 0.15 }));
  return [
    s(
      'defs',
      {},
      grad('linearGradient', 0, { x2: 0, y2: 1 }, [0, '#0d1424'], [100, '#04060b']),
      grad('radialGradient', 1, {}, [0, '#ffd59a', 0.9], [28, '#ff9a4a', 0.5], [60, '#c4501f', 0.16], [100, '#7a2a10', 0]),
      grad('linearGradient', 2, { x1: 0, y1: 1, x2: 1, y2: 0 }, [10, '#fff3d6'], [45, '#ffb35c'], [100, '#9a3a16']),
      grad('radialGradient', 3, {}, [0, '#fff'], [35, '#fff1c4', 0.8], [100, '#ffc46b', 0]),
    ),
    // deep space, past the viewBox
    s('rect', { x: -160, y: -80, width: 480, height: 240, fill: url(0) }),
    g('pfx-ssa', stars(7, 26, '#dfe6f2', 0.75)),
    g('pfx-ssb', stars(91, 22, '#aeb9cc', 0.55)),
    g(
      'pfx-sscene',
      // the black hole
      g('pfx-sglow', s('circle', { cx: 112, cy: 23, r: 40, fill: url(1) })),
      ring(13.4, { stroke: '#ffd6a0', 'stroke-opacity': 0.35, 'stroke-width': 0.6 }, 112, 23),
      ring(10.8, { stroke: url(2), 'stroke-width': 3.6 }, 112, 23),
      s('circle', { cx: 112, cy: 23, r: 9, fill: '#020203' }),
      // its light on the rim, then the turning wheel
      path('M65.77 13.2A18.9 18.9 0 0 1 65.77 42.8', { stroke: '#ffb36b', 'stroke-opacity': 0.6, 'stroke-width': 0.8 }),
      g(
        'pfx-sspin',
        path(spokes, { stroke: STEEL, 'stroke-width': 1.3 }),
        ring(16.5, { stroke: STEEL, 'stroke-width': 3 }),
        ring(16.5, { stroke: '#ffd27a', 'stroke-width': 0.9, 'stroke-dasharray': '0.7 2.2' }),
        fill(mods, STEEL, edge),
        s('circle', { cx: X, cy: Y, r: 4.2, fill: STEEL, ...edge }),
        s('circle', { cx: X, cy: Y, r: 1.7, fill: '#3a434b' }),
        // the docked twin: points along the heading at the impact
        capsule(o.out ? 'pfx-sdout' : 'pfx-sdin', head - AT_HIT),
      ),
      capsule(o.out ? 'pfx-sfout' : 'pfx-sfin', head, true),
      g('pfx-sring', ring(5, { stroke: '#fff1c4', 'stroke-width': 0.4 })),
      g('pfx-sflash', s('circle', { cx: X, cy: Y, r: 10, fill: url(3) })),
    ),
    said[1] ? [say(61, 0), say(73.5, 1)] : say(67, 0),
  ];
};
