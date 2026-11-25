// Turnstile (Drehkreuz): the lamp shows the green arrow, the arm is pushed (it resists a little),
// turns a third and locks with a click; the lamp shows the cross again.
import { s, g, path, C } from '../js/punchfx.js';

const HX = 78;
const HY = 44;
const L = 34;

/** An arm at `deg` from pointing right. @param {number} deg @param {string} [tip] */
const arm = (deg, tip) => {
  const r = (deg * Math.PI) / 180;
  const x = (HX + L * Math.cos(r)).toFixed(1);
  const y = (HY + L * Math.sin(r)).toFixed(1);
  return [path(`M${HX} ${HY} L${x} ${y}`, { stroke: C.slate, 'stroke-width': 6, 'stroke-linecap': 'round' }), tip ? s('circle', { cx: x, cy: y, r: 4.5, fill: tip }) : null];
};

export default () => [
  s('rect', { x: 16, y: 22, width: 50, height: 56, rx: 6, fill: C.slate }),
  s('rect', { x: 24, y: 30, width: 34, height: 18, rx: 3, fill: '#11161a' }),
  g('pfx-go', path('M31 39 h18 m-6 -6 l6 6 l-6 6', { stroke: C.ok, 'stroke-width': 3.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })),
  g('pfx-stop', path('M36 34 l10 10 m0 -10 l-10 10', { stroke: C.coral, 'stroke-width': 3.5, 'stroke-linecap': 'round' })),
  g('pfx-arms', ...arm(0, C.coral), ...arm(120), ...arm(240)),
  s('circle', { cx: HX, cy: HY, r: 8, fill: C.slateLight, stroke: C.slate, 'stroke-width': 2 }),
  g('pfx-click', path(`M${HX + 12} ${HY - 12} l5 -5 M${HX + 14} ${HY} h7 M${HX + 12} ${HY + 12} l5 5`, { stroke: C.slate, 'stroke-width': 2.5, 'stroke-linecap': 'round' })),
];
