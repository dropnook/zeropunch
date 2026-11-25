// Ticket validator (Entwerter): the ticket is lifted, pushed into the slot, «clack», and comes back
// out with a printed stripe and the time.
import { s, g, path, text, C } from '../js/punchfx.js';

export default (/** @type {string} */ time) => [
  g(
    'pfx-ticket',
    s('rect', { x: 56, y: 2, width: 48, height: 40, rx: 2, fill: C.paper, stroke: C.edge, 'stroke-width': 1.5 }),
    s('rect', { x: 56, y: 2, width: 48, height: 7, fill: C.coral }),
    path('M62 14 h20', { stroke: C.edge, 'stroke-width': 2, 'stroke-linecap': 'round' }),
    g('pfx-print', s('rect', { x: 60, y: 18, width: 40, height: 3, fill: C.ink }), text(80, 34, time, C.ink, 12)),
  ),
  g(
    'pfx-box',
    s('rect', { x: 42, y: 40, width: 76, height: 38, rx: 6, fill: C.slate }),
    s('rect', { x: 52, y: 42, width: 56, height: 4, rx: 2, fill: '#11161a' }),
    s('path', { d: 'M74 54 h12 l-6 7 z', fill: C.coral }),
    s('circle', { cx: 106, cy: 68, r: 3.5, fill: C.slateLight }),
    g('pfx-led', s('circle', { cx: 106, cy: 68, r: 3.5, fill: C.ok })),
  ),
  g('pfx-clack', path('M46 34 l-7 -6 M42 42 h-10 M114 34 l7 -6 M118 42 h10', { stroke: C.slate, 'stroke-width': 2.5, 'stroke-linecap': 'round' })),
];
