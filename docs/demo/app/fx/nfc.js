// NFC tap (Funk-Chip): a phone swings back, taps the reader and gives, waves ring out from the
// contact, a check mark appears on the phone's screen.
import { s, g, path, check, C } from '../js/punchfx.js';

/** @param {string} cls */
const wave = (cls) => g(cls, s('circle', { cx: 102, cy: 42, r: 10, fill: 'none', stroke: C.coral, 'stroke-width': 2.5 }));

export default () => [
  s('rect', { x: 104, y: 14, width: 46, height: 58, rx: 7, fill: C.slate }),
  path('M120 36 a8 8 0 0 1 0 12 M126 32 a14 14 0 0 1 0 20 M132 28 a20 20 0 0 1 0 28', { stroke: C.white, 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
  wave('pfx-w1'),
  wave('pfx-w2'),
  wave('pfx-w3'),
  g(
    'pfx-phone',
    s('rect', { x: 54, y: 8, width: 34, height: 64, rx: 7, fill: C.slate }),
    s('rect', { x: 57, y: 15, width: 28, height: 49, rx: 2, fill: C.coral }),
    s('rect', { x: 66, y: 10.5, width: 10, height: 2, rx: 1, fill: C.slateLight }),
    check('M62 40 l6 6 l12 -14', C.white, 4.5),
  ),
];
