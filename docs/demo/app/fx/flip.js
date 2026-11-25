// Flip clock (Klappzahlen): a split-flap board shows «– –:– –», then one flap after the other falls
// and the board settles on the punch time.
import { s, g, text, vars, uid, C } from '../js/punchfx.js';

const X = [12, 44, 88, 120];
const W = 28;

/** One card face (background + character), clipped to its top or bottom half. @param {number} x @param {string} ch @param {string} clip */
const face = (x, ch, clip) =>
  s('g', { 'clip-path': `url(#${clip})` }, s('rect', { x, y: 17, width: W, height: 46, rx: 4, fill: C.slate }), text(x + W / 2, 52, ch, C.white, 34));

export default (/** @type {string} */ time) => {
  const digits = /^\d{1,2}:\d{2}/.test(time) ? time.padStart(5, '0').replace(':', '').slice(0, 4) : '1200';
  const top = uid('flip-t');
  const bot = uid('flip-b');
  return [
    s('defs', {}, s('clipPath', { id: top }, s('rect', { x: 0, y: 0, width: 160, height: 40 })), s('clipPath', { id: bot }, s('rect', { x: 0, y: 40, width: 160, height: 40 }))),
    ...X.map((x, i) =>
      vars(
        g(
          'pfx-cell',
          face(x, digits[i], top),
          face(x, '–', bot),
          g('pfx-fa', face(x, '–', top)),
          g('pfx-fb', face(x, digits[i], bot)),
          s('rect', { x, y: 39.4, width: W, height: 1.2, fill: '#11161a' }),
        ),
        { i },
      ),
    ),
    s('circle', { cx: 80, cy: 32, r: 3, fill: C.slate }),
    s('circle', { cx: 80, cy: 48, r: 3, fill: C.slate }),
  ];
};
