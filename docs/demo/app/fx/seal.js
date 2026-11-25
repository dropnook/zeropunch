// Wax seal (Wachssiegel): warm wax bulges, the seal comes down hard and squashes it (beads squeeze
// out), lifts away, the imprint (the logo's ring) catches a sheen.
import { s, g, bits, uid, C } from '../js/punchfx.js';

const WAX = 'M52 60 q-6 -16 10 -20 q18 -9 34 0 q16 4 10 20 q-4 10 -27 10 q-23 0 -27 -10 z';

export default () => {
  const clip = uid('seal');
  return [
    s('defs', {}, s('clipPath', { id: clip }, s('path', { d: WAX }))),
    ...bits(
      [
        [s('circle', { cx: 54, cy: 64, r: 3, fill: C.coral }), -10, 3, 4, 0],
        [s('circle', { cx: 106, cy: 63, r: 2.6, fill: C.coral }), 11, 4, 5, 0],
        [s('circle', { cx: 62, cy: 69, r: 2, fill: C.coral }), -7, 1, 4, 0],
        [s('circle', { cx: 99, cy: 69, r: 2.2, fill: C.coral }), 8, 1, 4, 0],
      ],
      'pfx-stay',
    ),
    g(
      'pfx-wax',
      s('path', { d: WAX, fill: C.coral }),
      g('pfx-imprint', s('circle', { cx: 79, cy: 54, r: 11, fill: 'none', stroke: C.coralDark, 'stroke-width': 5 }), s('circle', { cx: 87, cy: 46, r: 3, fill: C.coralDark })),
      s('g', { 'clip-path': `url(#${clip})` }, g('pfx-sheen', s('path', { d: 'M66 34 h9 l-12 42 h-9 z', fill: C.white, opacity: 0.6 }))),
    ),
    g(
      'pfx-sealer',
      s('rect', { x: 64, y: 30, width: 30, height: 10, rx: 3, fill: C.slate }),
      s('rect', { x: 74, y: 8, width: 10, height: 24, rx: 4, fill: C.slate }),
      s('circle', { cx: 79, cy: 6, r: 8, fill: C.slate }),
      s('rect', { x: 66, y: 38, width: 26, height: 3, rx: 1.5, fill: C.slateLight }),
    ),
  ];
};
