// Clock tower (Turmuhr): a storm cloud drifts over a gabled portico with a big dial that shows the
// time of the punch. Lightning strikes the dial, the minute hand jumps, a spark leaps over to the time
// card and brands the real time on it.
import { s, g, path, text, vars, bits, C } from '../js/punchfx.js';

const CX = 48;
const CY = 35;
const R = 13.5;
const STONE = '#e6dcc6';
const BOLT = '#ffc93c';

/** Hand angles in degrees for HH:MM (10:10 without a time). @param {string} time */
export function hands(time) {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  const hh = m ? Number(m[1]) % 12 : 10;
  const mm = m ? Number(m[2]) : 10;
  return { hour: (hh + mm / 60) * 30, minute: mm * 6 };
}

/** A lightning line, drawn by stroke-dashoffset: dark outline, bright core. @param {string} cls @param {string} d @param {number} w */
const bolt = (cls, d, w) =>
  [
    [C.slate, w + 2.5],
    [BOLT, w],
  ].map(([stroke, width]) => path(d, { class: `pfx-a ${cls}`, stroke, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1 }));

export default (/** @type {string} */ time) => {
  const a = hands(time);
  const ticks = [];
  for (let i = 0; i < 12; i++) {
    const r = (i * 30 * Math.PI) / 180;
    const from = i % 3 ? R - 2.5 : R - 4;
    ticks.push(`M${(CX + from * Math.sin(r)).toFixed(1)} ${(CY - from * Math.cos(r)).toFixed(1)} L${(CX + (R - 1) * Math.sin(r)).toFixed(1)} ${(CY - (R - 1) * Math.cos(r)).toFixed(1)}`);
  }
  const turn = { transform: 'rotate(-6 127 52)' };
  return [
    g(
      'pfx-slip',
      s('rect', { x: 100, y: 30, width: 54, height: 42, rx: 3, fill: C.paper, stroke: C.edge, 'stroke-width': 1.5 }),
      path('M107 37 h26 M107 67 h18', { stroke: C.edge, 'stroke-width': 1.5, 'stroke-linecap': 'round' }),
      g('pfx-print', s('rect', { x: 106, y: 42, width: 42, height: 20, rx: 3, fill: 'none', stroke: C.ink, 'stroke-width': 2, ...turn }), text(127, 57, time, C.ink, 13, turn)),
    ),
    // the building: steps, a dark hall behind four columns, the beam and the gable
    s('rect', { x: 10, y: 55, width: 76, height: 20, fill: C.slateLight }),
    ...[12, 33, 55, 76].map((x) => s('rect', { x, y: 55, width: 8, height: 20, fill: STONE, stroke: C.edge, 'stroke-width': 1 })),
    s('rect', { x: 4, y: 74, width: 88, height: 3, fill: STONE, stroke: C.edge, 'stroke-width': 1 }),
    s('rect', { x: 0, y: 77, width: 96, height: 3, fill: STONE, stroke: C.edge, 'stroke-width': 1 }),
    s('path', { d: 'M4 51 L48 13 L92 51 Z', fill: STONE, stroke: C.slate, 'stroke-width': 2, 'stroke-linejoin': 'round' }),
    s('rect', { x: 5, y: 50, width: 86, height: 5, rx: 1, fill: STONE, stroke: C.slate, 'stroke-width': 1.5 }),
    g(
      'pfx-dial',
      s('circle', { cx: CX, cy: CY, r: R, fill: C.white, stroke: C.slate, 'stroke-width': 2.5 }),
      path(ticks.join(' '), { stroke: C.slate, 'stroke-width': 1.5, 'stroke-linecap': 'round' }),
      vars(g('pfx-hh', path(`M${CX} ${CY} v-7`, { stroke: C.slate, 'stroke-width': 3, 'stroke-linecap': 'round' })), { a: `${a.hour}deg` }),
      vars(g('pfx-mh', path(`M${CX} ${CY} v-10.5`, { stroke: C.coral, 'stroke-width': 2, 'stroke-linecap': 'round' })), { a: `${a.minute}deg` }),
      s('circle', { cx: CX, cy: CY, r: 2, fill: C.slate }),
    ),
    g('pfx-glow', s('circle', { cx: CX, cy: CY, r: R, fill: 'none', stroke: BOLT, 'stroke-width': 3 })),
    g('pfx-cloud', s('circle', { cx: 94, cy: 1, r: 8, fill: C.slateLight }), s('circle', { cx: 107, cy: -1, r: 10, fill: C.slate }), s('circle', { cx: 120, cy: 1, r: 8, fill: C.slateLight })),
    s('rect', { class: 'pfx-a pfx-flash', x: 0, y: 0, width: 160, height: 80, fill: '#fff3b8' }),
    ...bolt('pfx-bolt', 'M103 5 L87 11 L93 13 L73 19 L79 21 L57.5 25.5', 3),
    ...bolt('pfx-arc', 'M61.5 36 L73 32 L71 41 L86 37 L84 46 L100 48', 2),
    ...bits([
      [s('circle', { cx: 58, cy: 25, r: 2, fill: BOLT }), 16, 12, 10, 90],
      [s('rect', { x: 56, y: 24, width: 3, height: 3, fill: C.coral }), -14, 14, 6, -120],
      [s('circle', { cx: 100, cy: 48, r: 1.8, fill: BOLT }), -10, 10, 14, 60],
      [s('rect', { x: 99, y: 46, width: 3, height: 3, fill: BOLT }), 8, 16, 4, 140],
    ]),
  ];
};
