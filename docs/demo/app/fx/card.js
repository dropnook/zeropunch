// Punch card (Lochkarte): the card slides in, the punch winds up and comes down, the chad and a
// burst of confetti fly out of the fresh hole.
import { s, g, path, bits, C } from '../js/punchfx.js';

/** @param {number} x @param {number} y @param {string} [fill] */
const hole = (x, y, fill = C.slate) => s('rect', { x, y, width: 6, height: 10, rx: 1.5, fill });
/** @param {string} fill @param {number} [w] @param {number} [hh] */
const bit = (fill, w = 3, hh = 4) => s('rect', { x: 86, y: 37, width: w, height: hh, rx: 0.8, fill });

export default () => [
  g(
    'pfx-slide',
    s('path', { d: 'M36 22 h82 l6 6 v42 h-88 z', fill: C.paper, stroke: C.edge, 'stroke-width': 2, 'stroke-linejoin': 'round' }),
    path('M44 32 h18 M44 62 h26 M100 62 h16', { stroke: C.edge, 'stroke-width': 3, 'stroke-linecap': 'round' }),
    hole(48, 40),
    hole(60, 46),
    hole(72, 38),
    hole(100, 44),
    hole(110, 36),
    g('pfx-hole', hole(85, 36)),
  ),
  ...bits([
    [s('rect', { x: 85, y: 36, width: 6, height: 10, rx: 1.5, fill: C.coral }), 34, 10, 40, 420],
    [bit(C.coral), -30, 22, 30, -300],
    [bit(C.slate, 2.5, 3), 24, 28, 22, 260],
    [bit(C.edge), -16, 30, 36, 200],
    [bit(C.coral, 2.5, 2.5), 44, 18, 30, 340],
    [bit(C.coralDark, 2, 3), -40, 12, 34, -220],
    [bit(C.slate, 2, 2), 10, 34, 38, 180],
  ]),
  g('pfx-plunger', s('rect', { x: 82, y: 2, width: 12, height: 42, rx: 2.5, fill: C.slate }), s('rect', { x: 78, y: -8, width: 20, height: 14, rx: 3, fill: C.slateLight })),
];
