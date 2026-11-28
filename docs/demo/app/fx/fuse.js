// Fuse (a Mission: Impossible homage by allusion): a lit fuse burns to the time, which lights up; a
// briefing card with our own line goes up in smoke. No logo, no mask, no music.
import { s, g, path, text, vars, bits, uid, C } from '../js/punchfx.js';

/** The spark's waypoints in fuse.css follow it. */
const FUSE = 'M6 64 C18 64 22 42 38 44 S52 70 70 68 S98 50 116 60 S152 62 146 42 S126 19 108 19';
/** Our own lines, English in every language. */
const LINES = { in: ['Mission accepted.'], out: ['This workday will', 'self-destruct in 5 seconds.'] };
const LIT = '#ffcf5a';

const fuse = (cls, stroke, w, a = {}) => path(FUSE, { class: `pfx-a ${cls}`, stroke, 'stroke-width': w, 'stroke-linecap': 'round', pathLength: 1, ...a });
const stop = (at, c, op = 1) => s('stop', { offset: `${at}%`, 'stop-color': c, 'stop-opacity': op });
const dot = (cx, cy, r, fill) => s('circle', { cx, cy, r, fill });

export default (/** @type {string} */ time, /** @type {{ out?: boolean }} */ o = {}) => {
  const t = time || '12:00';
  const pl = uid('fu-plate');
  const gl = uid('fu-glow');
  const lines = o.out ? LINES.out : LINES.in;
  const one = lines.length === 1;
  const fly = [[10, 9, 4, 90], [16, 4, 10, 140], [6, 12, 12, 60], [-4, 7, 9, 120]].map(([dx, rise, fall, turn]) => [dot(108, 19, 1, LIT), dx, rise, fall, turn]);
  return [
    s(
      'defs',
      {},
      s('linearGradient', { id: pl, x1: 0, y1: 0, x2: 0, y2: 1 }, stop(0, '#1d2630'), stop(100, '#0b0f14')),
      s('radialGradient', { id: gl }, stop(0, '#ff9a3c', 0.55), stop(60, C.coral, 0.18), stop(100, C.coral, 0)),
    ),
    // past the viewBox: dark at any stage shape
    s('rect', { x: -160, y: -80, width: 480, height: 240, fill: `url(#${pl})` }),
    // cord, braid, char, ember trail, burning head
    g(
      'pfx-fcord',
      fuse('pfx-frope', '#b9a47e', 2.6),
      fuse('pfx-fbraid', '#7d6a4c', 2.6, { 'stroke-dasharray': '0.006 0.01', 'stroke-linecap': 'butt' }),
      fuse('pfx-fash', '#252b32', 3.6),
      fuse('pfx-ftrail', C.coral, 1.6),
      fuse('pfx-fhead', '#ff9a3c', 9, { 'stroke-opacity': 0.35 }),
      fuse('pfx-fhead', '#fff6d8', 3.4),
    ),
    g(
      'pfx-fspark',
      g('pfx-fspin', path('M0-6V-2.5M0 6V2.5M-6 0H-2.5M6 0H2.5M-4-4L-2-2M4 4L2 2M4-4L2-2M-4 4L-2 2', { stroke: LIT, 'stroke-width': 1.1, 'stroke-linecap': 'round' })),
      ...[[-9, -7], [8, -9], [-3, 10], [10, 5]].map(([x, y], i) => vars(g('pfx-fspit', dot(0, 0, 1, LIT)), { x: `${x}px`, y: `${y}px`, lag: `${i * 50}ms` })),
    ),
    g('pfx-fdim', text(80, 27, t, '#5d6873', 18)),
    g('pfx-fglow', s('ellipse', { cx: 80, cy: 20, rx: 38, ry: 17, fill: `url(#${gl})` })),
    g('pfx-flit', text(80, 27, t, LIT, 18)),
    ...bits(fly),
    g(
      'pfx-fcard',
      s('rect', { x: 8, y: 35, width: 144, height: 41, rx: 3, fill: C.paper, stroke: C.edge, 'stroke-width': 1 }),
      s('rect', { x: 8, y: 35, width: 4, height: 41, fill: C.coral }),
      text(19, 43.5, 'BRIEFING', C.slateLight, 5.2, { 'text-anchor': 'start', 'letter-spacing': 1.4 }),
      path('M19 46.5H145', { stroke: C.edge, 'stroke-width': 0.8 }),
      ...lines.map((l, i) => g(`pfx-fl${i + 1}`, text(82, one ? 63 : 57.5 + i * 11, l, C.slate, one ? 12 : 9, { 'font-weight': 700 }))),
    ),
    // puffs swell in turn, the cloud fades as one
    g(
      'pfx-fsmoke',
      ...[[58, 54, 13], [102, 54, 13], [80, 50, 15], [40, 62, 9], [120, 62, 9], [66, 66, 11], [94, 66, 11], [80, 62, 12]].map(([cx, cy, r], i) =>
        vars(g('pfx-fpuff', dot(cx, cy, r, i < 3 ? '#7f8892' : '#b9c0c8')), { o: `${(i % 4) * 30}ms` }),
      ),
    ),
  ];
};
