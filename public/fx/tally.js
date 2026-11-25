// Tally stick (Kerbholz): the knife winds up, cuts the fourth notch, the stick gives, wood chips fly.
import { s, g, path, bits, C } from '../js/punchfx.js';

/** @param {string} d @param {string} fill */
const chip = (d, fill) => s('path', { d, fill });

export default () => [
  g(
    'pfx-stick',
    s('rect', { x: 8, y: 42, width: 144, height: 18, rx: 5, fill: C.wood }),
    path('M14 49 h34 M60 55 h34 M106 48 h38 M20 56 h18', { stroke: C.woodLight, 'stroke-width': 1.5, 'stroke-linecap': 'round' }),
    path('M34 42 l5 9 l5 -9 M50 42 l5 9 l5 -9 M66 42 l5 9 l5 -9', { stroke: C.woodDark, 'stroke-width': 3, 'stroke-linejoin': 'round' }),
    g('pfx-notch', path('M86 42 l6 11 l6 -11', { stroke: C.woodDark, 'stroke-width': 3.5, 'stroke-linejoin': 'round' })),
  ),
  ...bits([
    [chip('M88 40 l6 -1 l-2 4 z', C.woodLight), -26, 18, 30, -260],
    [chip('M92 40 l5 0 l-1 5 l-4 -2 z', C.wood), 24, 24, 34, 300],
    [chip('M90 39 l4 1 l-3 3 z', C.woodLight), 40, 12, 36, 400],
    [chip('M93 41 l3 -2 l2 3 z', C.woodDark), -12, 30, 40, -160],
    [chip('M89 41 l3 0 l0 3 z', C.woodLight), 12, 34, 38, 200],
  ]),
  g(
    'pfx-knife',
    s('path', { d: 'M92 42 L83 10 L103 10 Z', fill: C.steel, stroke: C.slate, 'stroke-width': 2, 'stroke-linejoin': 'round' }),
    s('rect', { x: 84, y: -12, width: 18, height: 23, rx: 4, fill: C.slate }),
  ),
];
