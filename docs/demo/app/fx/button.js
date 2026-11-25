// In the button (Im Knopf): the button itself loads up and recoils, the logo's hole is punched
// top right with a ring, the coral piece and a few bits fly off. In the picker and the preview a
// small coral button stands in for the real one.
import { s, g, bits, C } from '../js/punchfx.js';

/** @param {number} r */
const bit = (r) => s('circle', { cx: 116, cy: 36, r, fill: C.coral });

export default (/** @type {string} */ _time, /** @type {{ mini?: boolean }} */ o = {}) => [
  o.mini ? g('pfx-mini', s('rect', { x: 10, y: 14, width: 140, height: 56, rx: 16, fill: C.coral }), s('rect', { x: 34, y: 38, width: 56, height: 8, rx: 4, fill: C.slate, opacity: 0.85 })) : null,
  g('pfx-ring1', s('circle', { cx: 116, cy: 36, r: 11, fill: 'none', stroke: C.white, 'stroke-width': 3 })),
  g('pfx-fade', g('pfx-hole', s('circle', { cx: 116, cy: 36, r: 9, fill: C.slate, stroke: C.white, 'stroke-width': 3 }))),
  ...bits([
    [s('circle', { cx: 116, cy: 36, r: 7, fill: C.coral, stroke: C.slate, 'stroke-width': 2 }), 30, 24, -8, 240],
    [bit(2.2), -22, 16, 20, 0],
    [bit(1.8), 14, 30, 10, 0],
    [bit(1.6), -8, 26, 30, 0],
  ]),
];
