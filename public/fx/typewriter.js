// Typewriter (Schreibmaschine): a type bar strikes once per character, the carriage steps left and
// the time appears on the paper character by character; at the end the bell dings.
import { s, g, path, vars, C } from '../js/punchfx.js';

/** Strike times in ms (the first one is the impact). */
const STRIKES = [176, 308, 440, 572, 704];
const STEP = 11;
const AT = 113;

export default (/** @type {string} */ time) => {
  const chars = [...(time || '12:00').slice(0, 5)];
  return [
    g(
      'pfx-carriage',
      s('rect', { x: 66, y: 6, width: 110, height: 44, rx: 1, fill: C.white, stroke: C.edge, 'stroke-width': 1.5 }),
      ...chars.map((ch, i) =>
        vars(g('pfx-char', s('text', { x: AT + i * STEP, y: 38, fill: C.slate, 'font-size': 18, 'font-weight': 700, 'text-anchor': 'middle', 'font-family': 'ui-monospace, Menlo, monospace' }, ch)), {
          lag: `${STRIKES[i]}ms`,
        }),
      ),
      s('rect', { x: 50, y: 48, width: 140, height: 8, rx: 4, fill: C.slate }),
    ),
    g('pfx-bar', path(`M${AT} 74 L${AT} 36`, { stroke: C.slateLight, 'stroke-width': 3, 'stroke-linecap': 'round' }), s('rect', { x: AT - 3, y: 30, width: 6, height: 7, rx: 1, fill: C.slate })),
    s('path', { d: 'M8 60 h144 l-6 18 h-132 z', fill: C.slate }),
    path('M28 69 h8 M44 69 h8 M60 69 h8 M76 69 h8 M92 69 h8 M108 69 h8 M124 69 h8', { stroke: C.paper, 'stroke-width': 4, 'stroke-linecap': 'round' }),
    g('pfx-bell', s('path', { d: 'M140 18 a7 7 0 0 1 14 0 v2 h-14 z', fill: C.coral }), s('circle', { cx: 147, cy: 10, r: 1.8, fill: C.coral })),
    g('pfx-ding', path('M136 8 l-5 -3 M135 15 h-6 M158 8 l3 -3', { stroke: C.coral, 'stroke-width': 2, 'stroke-linecap': 'round' })),
  ];
};
