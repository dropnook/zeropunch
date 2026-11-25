// Time clock (Stempeluhr): the time card goes into the slot, the lever comes down, ka-chunk twice,
// the minute hand jumps, the card comes back out with the real time printed on it.
import { s, g, path, text, vars, C } from '../js/punchfx.js';

/** Hand angles for HH:MM. @param {string} time */
function angles(time) {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  const hh = m ? Number(m[1]) % 12 : 10;
  const mm = m ? Number(m[2]) : 10;
  return { ha: `${(hh + mm / 60) * 30}deg`, ma: `${mm * 6}deg` };
}

export default (/** @type {string} */ time) => {
  const a = angles(time);
  return [
    g(
      'pfx-timecard',
      s('rect', { x: 50, y: 50, width: 104, height: 18, rx: 2, fill: C.paper, stroke: C.edge, 'stroke-width': 1.5 }),
      path('M126 54 h22 M126 64 h16', { stroke: C.edge, 'stroke-width': 1.5 }),
      g('pfx-print', text(104, 64, time, C.ink, 13)),
    ),
    g(
      'pfx-body',
      s('rect', { x: 6, y: 4, width: 60, height: 72, rx: 8, fill: C.slate }),
      s('circle', { cx: 36, cy: 27, r: 18, fill: C.white }),
      path('M36 11 v3 M36 40 v3 M20 27 h3 M49 27 h3', { stroke: C.slate, 'stroke-width': 2 }),
      vars(g('pfx-hh', path('M36 27 V18', { stroke: C.slate, 'stroke-width': 3.5, 'stroke-linecap': 'round' })), { a: a.ha }),
      vars(g('pfx-mh', path('M36 27 V12', { stroke: C.coral, 'stroke-width': 2.5, 'stroke-linecap': 'round' })), { a: a.ma }),
      s('circle', { cx: 36, cy: 27, r: 2.5, fill: C.slate }),
      s('rect', { x: 12, y: 55, width: 46, height: 8, rx: 3, fill: '#11161a' }),
    ),
    g('pfx-lever', path('M64 34 L80 18', { stroke: C.slateLight, 'stroke-width': 5, 'stroke-linecap': 'round' }), s('circle', { cx: 81, cy: 17, r: 5.5, fill: C.coral })),
  ];
};
