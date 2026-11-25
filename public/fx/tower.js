// Clock tower (Turmuhr): a storm cloud drifts over a gabled portico with a big dial that shows the
// time of the punch; a wild-haired inventor in a white coat waits beside it, arms up. Lightning
// strikes the dial, the minute hand jumps, the current runs down a cable to the street and brands
// the real time on the time card.
import { s, g, path, text, vars, bits, C } from '../js/punchfx.js';

const CX = 64;
const CY = 36;
const R = 12.5;
const STONE = '#e6dcc6';
const BOLT = '#ffc93c';
const CABLE = 'M76 40 Q92 58 106 60';

/** Hand angles in degrees for HH:MM (10:10 without a time). @param {string} time */
export function hands(time) {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  const hh = m ? Number(m[1]) % 12 : 10;
  const mm = m ? Number(m[2]) : 10;
  return { hour: (hh + mm / 60) * 30, minute: mm * 6 };
}

/** A stroked line. @param {string} d @param {string} stroke @param {number} w @param {Record<string, any>} [a] */
const line = (d, stroke, w, a = {}) => path(d, { stroke, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...a });
/** A stone block. @param {number} x @param {number} y @param {number} width @param {number} height @param {string} [stroke] */
const block = (x, y, width, height, stroke = C.edge) => s('rect', { x, y, width, height, fill: STONE, stroke, 'stroke-width': 1 });

export default (/** @type {string} */ time) => {
  const a = hands(time);
  const ticks = [];
  for (let i = 0; i < 12; i++) {
    const sin = Math.sin((i * Math.PI) / 6);
    const cos = Math.cos((i * Math.PI) / 6);
    const from = i % 3 ? R - 2.5 : R - 4;
    ticks.push(`M${(CX + from * sin).toFixed(1)} ${(CY - from * cos).toFixed(1)} L${(CX + (R - 1) * sin).toFixed(1)} ${(CY - (R - 1) * cos).toFixed(1)}`);
  }
  const turn = { transform: 'rotate(-6 134 52)' };
  const arms = 'M9.5 60 L4.5 51 M17.5 60 L22.5 51';
  return [
    g(
      'pfx-slip',
      s('rect', { x: 112, y: 30, width: 44, height: 42, rx: 3, fill: C.paper, stroke: C.edge, 'stroke-width': 1.5 }),
      line('M118 37 h22 M118 67 h16', C.edge, 1.5),
      g('pfx-print', s('rect', { x: 115, y: 42, width: 38, height: 20, rx: 3, fill: 'none', stroke: C.ink, 'stroke-width': 2, ...turn }), text(134, 56.5, time, C.ink, 12, turn)),
    ),
    // the building: a dark hall behind four columns, steps, the gable and its beam
    s('rect', { x: 33, y: 55, width: 62, height: 20, fill: C.slateLight }),
    ...[35, 52, 69, 86].map((x) => block(x, 55, 7, 20)),
    block(28, 74, 72, 3),
    block(24, 77, 80, 3),
    s('path', { d: 'M28 51 L64 16 L100 51 Z', fill: STONE, stroke: C.slate, 'stroke-width': 2, 'stroke-linejoin': 'round' }),
    block(29, 50, 70, 5, C.slate),
    // the cable from the dial down to a post in the street
    line(`${CABLE} V80`, C.slate, 1.8),
    g(
      'pfx-dial',
      s('circle', { cx: CX, cy: CY, r: R, fill: C.white, stroke: C.slate, 'stroke-width': 2.5 }),
      line(ticks.join(' '), C.slate, 1.5),
      vars(g('pfx-hh', line(`M${CX} ${CY} v-6.5`, C.slate, 3)), { a: `${a.hour}deg` }),
      vars(g('pfx-mh', line(`M${CX} ${CY} v-9.5`, C.coral, 2)), { a: `${a.minute}deg` }),
      s('circle', { cx: CX, cy: CY, r: 2, fill: C.slate }),
    ),
    // the inventor: legs, coat, raised arms, wild white hair, goggles pushed up on the forehead
    g(
      'pfx-man',
      line('M11 71 V79 M16 71 V79', C.slate, 2.6),
      line(arms, C.slate, 4.2),
      line(arms, C.white, 2.4),
      s('path', { d: 'M9 58 H18 L20 72 H7 Z', fill: C.white, stroke: C.slate, 'stroke-width': 1.2, 'stroke-linejoin': 'round' }),
      line('M13.5 59 V72', C.steel, 1),
      s('path', { d: 'M8 55 L5 51 L8.5 51.5 L7 46.5 L11 49 L13.5 44.5 L16 49 L20 46.5 L18.5 51.5 L22 51 L19 55 Z', fill: C.white, stroke: C.slate, 'stroke-width': 1, 'stroke-linejoin': 'round' }),
      s('circle', { cx: 13.5, cy: 53.5, r: 3.5, fill: '#f1c9a5', stroke: C.slate, 'stroke-width': 1 }),
      line('M10.4 52 h6.2', C.slate, 2.4),
      line('M11.7 52 h0.1 M15.2 52 h0.1', C.steel, 1.4),
    ),
    g('pfx-glow', s('circle', { cx: CX, cy: CY, r: R, fill: 'none', stroke: BOLT, 'stroke-width': 3 })),
    g('pfx-cloud', s('circle', { cx: 108, cy: 1, r: 8, fill: C.slateLight }), s('circle', { cx: 121, cy: -1, r: 10, fill: C.slate }), s('circle', { cx: 134, cy: 1, r: 8, fill: C.slateLight })),
    s('rect', { class: 'pfx-a pfx-flash', x: 0, y: 0, width: 160, height: 80, fill: '#fff3b8' }),
    ...[
      [C.slate, 5.5],
      [BOLT, 3],
    ].map(([stroke, w]) => line('M117 5 L101 11 L107 13 L88 19 L94 21 L72.8 27.2', /** @type {string} */ (stroke), /** @type {number} */ (w), { class: 'pfx-a pfx-bolt', pathLength: 1 })),
    line(CABLE, BOLT, 3.2, { class: 'pfx-a pfx-arc', pathLength: 1 }),
    ...bits([
      [s('circle', { cx: 107, cy: 59, r: 2, fill: BOLT }), -12, 12, 10, 90],
      [s('rect', { x: 106, y: 57, width: 3, height: 3, fill: C.coral }), 10, 16, 4, 140],
      [s('circle', { cx: 110, cy: 58, r: 1.6, fill: BOLT }), 16, 9, 12, -90],
    ]),
  ];
};
