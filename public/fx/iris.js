// Iris scan (Iris-Scan): an eye opens inside a viewfinder, the pupil narrows as a glowing scan line
// sweeps down and back up over it, the iris pattern lights up, the frame pulses, a check mark.
import { s, g, path, check, C } from '../js/punchfx.js';

const EYE = 'M42 40 Q80 4 118 40 Q80 76 42 40 Z';
/** Twelve spokes of the iris pattern, from the pupil outwards. */
const SPOKES = Array.from({ length: 12 }, (_, i) => {
  const a = (i * Math.PI) / 6 + 0.26;
  const p = (/** @type {number} */ r) => `${(80 + Math.cos(a) * r).toFixed(1)} ${(40 + Math.sin(a) * r).toFixed(1)}`;
  return `M${p(9)} L${p(16)}`;
}).join(' ');

export default () => [
  g(
    'pfx-find',
    path('M36 16 v-8 h10 M114 8 h10 v8 M124 64 v8 h-10 M46 72 h-10 v-8', { stroke: C.slate, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  ),
  g(
    'pfx-dim',
    g(
      'pfx-eye',
      path(EYE, { fill: C.white, stroke: C.slate, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }),
      s('circle', { cx: 80, cy: 40, r: 18, fill: C.coral, stroke: C.coralDark, 'stroke-width': 2 }),
      g('pfx-spokes', path(SPOKES, { stroke: C.coralDark, 'stroke-width': 1.6, 'stroke-linecap': 'round' })),
      g('pfx-pupil', s('circle', { cx: 80, cy: 40, r: 8.5, fill: C.slate })),
      s('circle', { cx: 74.5, cy: 34, r: 2.6, fill: C.white }),
    ),
  ),
  g('pfx-scan', s('rect', { x: 38, y: 2, width: 84, height: 9, rx: 4.5, fill: C.coral, opacity: 0.28 }), s('rect', { x: 38, y: 5.25, width: 84, height: 2.5, rx: 1.25, fill: C.coral })),
  g('pfx-ring1', s('circle', { cx: 80, cy: 40, r: 18, fill: 'none', stroke: C.coral, 'stroke-width': 3 })),
  check('M62 42 l12 12 l24 -26'),
];
