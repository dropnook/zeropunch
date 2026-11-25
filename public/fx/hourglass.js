// Hourglass (Sanduhr): it leans back, tips over and lands, the sand runs through, it tips back.
import { s, g, path, C } from '../js/punchfx.js';

const SAND = '#e0a25a';

export default () => [
  g(
    'pfx-glass',
    s('rect', { x: 60, y: 3, width: 40, height: 6, rx: 2, fill: C.woodDark }),
    s('rect', { x: 60, y: 71, width: 40, height: 6, rx: 2, fill: C.woodDark }),
    s('rect', { x: 62, y: 8, width: 3, height: 64, fill: C.wood }),
    s('rect', { x: 95, y: 8, width: 3, height: 64, fill: C.wood }),
    // chamber B (top in the drawing, starts empty) fills while the glass stands on its head
    g('pfx-fill', s('path', { d: 'M70 10 L90 10 C89 18 84 24 80 26 C76 24 71 18 70 10 Z', fill: SAND })),
    // chamber A (bottom in the drawing, starts full) drains
    g('pfx-drain', s('path', { d: 'M68 70 L92 70 C90 60 84 52 80 50 C76 52 70 60 68 70 Z', fill: SAND })),
    g('pfx-stream', s('rect', { x: 79.2, y: 24, width: 1.6, height: 26, fill: SAND })),
    path('M68 9 C68 26 78 34 78 40 C78 46 68 54 68 71 M92 9 C92 26 82 34 82 40 C82 46 92 54 92 71', { stroke: C.slate, 'stroke-width': 2.5 }),
  ),
];
