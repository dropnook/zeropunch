// Sundial (Sonnenuhr), the oldest one: the sun comes up on one side, the gnomon's shadow sweeps over
// the dial and settles on the hour of the punch (night hours rest at the dial's edge).
import { s, g, path, text, vars, C } from '../js/punchfx.js';

const CX = 80;
const CY = 72;

/** Shadow angle from straight up, in degrees, for HH:MM (06:00 = -90, 12:00 = 0, 18:00 = 90). @param {string} time */
export function hourAngle(time) {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  const t = m ? Number(m[1]) + Number(m[2]) / 60 : 12;
  return Math.max(-90, Math.min(90, (t - 12) * 15));
}

/** @param {number} deg @param {number} r */
const at = (deg, r) => [CX + r * Math.sin((deg * Math.PI) / 180), CY - r * Math.cos((deg * Math.PI) / 180)];

export default (/** @type {string} */ time) => {
  const a = hourAngle(time);
  const ticks = [];
  for (let hr = 6; hr <= 18; hr++) {
    const d = (hr - 12) * 15;
    const [x1, y1] = at(d, hr % 3 ? 52 : 48);
    const [x2, y2] = at(d, 57);
    ticks.push(`M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`);
  }
  const [mx, my] = at(a, 62);
  const sunX = a < 0 ? 146 : 14;
  return [
    s('path', { d: `M${CX - 64} ${CY} A64 64 0 0 1 ${CX + 64} ${CY} Z`, fill: '#e6dcc6', stroke: C.edge, 'stroke-width': 2 }),
    path(ticks.join(' '), { stroke: C.slate, 'stroke-width': 2, 'stroke-linecap': 'round' }),
    vars(g('pfx-shadow', s('path', { d: `M${CX - 3} ${CY} L${CX} ${CY - 56} L${CX + 3} ${CY} Z`, fill: C.slate, opacity: 0.6 })), { to: `${a}deg` }),
    s('rect', { x: CX - 2, y: CY - 24, width: 4, height: 24, rx: 1, fill: C.woodDark }),
    s('circle', { cx: CX, cy: CY, r: 4, fill: C.slate }),
    g('pfx-mark', s('circle', { cx: mx, cy: my, r: 4, fill: C.coral })),
    g('pfx-sun', s('circle', { cx: sunX, cy: 14, r: 7, fill: C.coral }), path(`M${sunX} 2 v4 M${sunX} 22 v4 M${sunX - 12} 14 h4 M${sunX + 8} 14 h4`, { stroke: C.coral, 'stroke-width': 2.5, 'stroke-linecap': 'round' })),
    g('pfx-time', text(a < 0 ? 24 : 136, 18, time, C.slate, 12)),
  ];
};
