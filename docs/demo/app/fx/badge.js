// Badge: the badge swings back, taps the reader and gives, a glowing scan line runs over the reader's
// window, the LED turns green, two rings ripple out, a check mark.
import { s, g, path, check, C } from '../js/punchfx.js';

export default () => [
  s('rect', { x: 104, y: 8, width: 44, height: 64, rx: 8, fill: C.slate }),
  s('rect', { x: 112, y: 16, width: 28, height: 22, rx: 3, fill: '#11161a' }),
  g('pfx-glow', s('rect', { x: 113, y: 15, width: 26, height: 7, rx: 3.5, fill: C.coral, opacity: 0.3 }), s('rect', { x: 113, y: 17.5, width: 26, height: 2, rx: 1, fill: C.coral })),
  path('M118 52 a8 8 0 0 1 12 0 M114 48 a14 14 0 0 1 20 0', { stroke: C.white, 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
  s('circle', { cx: 126, cy: 63, r: 4, fill: C.slateLight }),
  g('pfx-led', s('circle', { cx: 126, cy: 63, r: 4, fill: C.ok })),
  g('pfx-ring1', s('circle', { cx: 104, cy: 42, r: 12, fill: 'none', stroke: C.coral, 'stroke-width': 3 })),
  g('pfx-ring2', s('circle', { cx: 104, cy: 42, r: 12, fill: 'none', stroke: C.coral, 'stroke-width': 2 })),
  g(
    'pfx-tap',
    path('M75 4 L75 20', { stroke: C.slateLight, 'stroke-width': 2 }),
    s('rect', { x: 58, y: 20, width: 34, height: 44, rx: 5, fill: C.coral }),
    s('rect', { x: 64, y: 26, width: 13, height: 15, rx: 2, fill: C.white }),
    path('M64 48 h22 M64 55 h14', { stroke: C.white, 'stroke-width': 3, 'stroke-linecap': 'round' }),
  ),
  check('M12 42 l10 10 l20 -23'),
];
