// Fingerprint (Fingerabdruck): a finger presses the glass and lifts, the ridges appear, a glowing
// scan line sweeps over them, the sensor pulses and ripples, a check mark.
import { s, g, path, check, C } from '../js/punchfx.js';

const RIDGES = [
  'M60 34 q8 -22 20 -22 q12 0 20 22',
  'M62 48 q2 -28 18 -32 q16 4 18 32',
  'M66 60 q-4 -24 14 -28 q18 4 14 28',
  'M72 63 q-2 -20 8 -22 q10 2 8 22',
  'M78 63 q0 -14 2 -16 q2 2 2 16',
];

export default () => [
  g('pfx-frame', s('rect', { x: 52, y: 4, width: 56, height: 72, rx: 12, fill: '#ece5d4', stroke: C.edge, 'stroke-width': 2 })),
  g('pfx-print', ...RIDGES.map((d) => path(d, { class: 'pfx-a pfx-ridge', stroke: C.slate, 'stroke-width': 2.5, 'stroke-linecap': 'round', pathLength: 1 }))),
  g('pfx-scan', s('rect', { x: 54, y: 4, width: 52, height: 9, rx: 4.5, fill: C.coral, opacity: 0.28 }), s('rect', { x: 54, y: 7.5, width: 52, height: 2.5, rx: 1.25, fill: C.coral })),
  g('pfx-pad', s('ellipse', { cx: 80, cy: 40, rx: 21, ry: 27, fill: '#d8b49a', stroke: '#b48a6e', 'stroke-width': 2 })),
  g('pfx-ring1', s('circle', { cx: 80, cy: 40, r: 16, fill: 'none', stroke: C.coral, 'stroke-width': 3 })),
  check('M62 42 l12 12 l24 -26'),
];
