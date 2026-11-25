// Rubber stamp (Gummistempel): it rises and tilts, slams down and squashes, ink splatters, it lifts
// off and leaves a slightly rotated imprint with the real time.
import { s, g, text, bits, C } from '../js/punchfx.js';

/** @param {number} cx @param {number} cy @param {number} r */
const dot = (cx, cy, r) => s('circle', { cx, cy, r, fill: C.coral });

export default (/** @type {string} */ time) => [
  s('rect', { x: 12, y: 58, width: 136, height: 20, rx: 3, fill: C.paper }),
  ...bits(
    [
      [dot(46, 50, 2.2), -10, 4, 2, 0],
      [dot(114, 50, 1.8), 12, 5, 1, 0],
      [dot(47, 70, 1.6), -12, 2, 4, 0],
      [dot(113, 71, 2.4), 9, 2, 3, 0],
      [dot(80, 46, 1.4), 4, 8, -2, 0],
      [dot(60, 73, 1.2), -5, 1, 3, 0],
      [dot(100, 46, 1.3), 7, 6, -1, 0],
    ],
    'pfx-stay',
  ),
  g('pfx-ink', s('rect', { x: 46, y: 46, width: 68, height: 26, rx: 5, fill: 'none', stroke: C.coral, 'stroke-width': 3 }), text(80, 65, time, C.coral)),
  g(
    'pfx-rubber',
    s('circle', { cx: 80, cy: -4, r: 10, fill: C.slate }),
    s('rect', { x: 75, y: 2, width: 10, height: 14, fill: C.slate }),
    s('rect', { x: 54, y: 14, width: 52, height: 14, rx: 3, fill: C.slate }),
    s('rect', { x: 56, y: 28, width: 48, height: 5, fill: C.coral }),
  ),
];
