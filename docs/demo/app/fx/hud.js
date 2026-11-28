// Machine vision («Terminator»): a red HUD, invented readouts; a crosshair locks onto the time (impact).
// In: «TARGET ACQUIRED: name»; out: the film's one short line. No face, no figure.
import { s, g, text, vars, uid } from '../js/punchfx.js';

const MONO = 'ui-monospace, Menlo, Consolas, monospace';
const RED = '#ff3b24';
const DIM = '#b3200f';
const HOT = '#ffd0c4';

/** Trimmed, «HUMAN» without one, cut to 14 characters with «…». @param {unknown} user */
export function targetName(user) {
  const c = [...(typeof user === 'string' ? user.trim() : '')];
  return !c.length ? 'HUMAN' : c.length > 14 ? `${c.slice(0, 14).join('')}…` : c.join('');
}

/** English in every language. @param {unknown} user @param {boolean} [out] */
export const line = (user, out = false) => (out ? "I'll be back." : `TARGET ACQUIRED: ${targetName(user)}`);

/** @param {number} x @param {number} y @param {string} str @param {Record<string, any>} [a] */
const mono = (x, y, str, fill = RED, size = 4.2, a = {}) => text(x, y, str, fill, size, { 'font-family': MONO, 'font-weight': 700, ...a });
const tiny = (x, y, str, fill = RED, anchor = 'start') => mono(x, y, str, fill, 4, { 'text-anchor': anchor });

export default (/** @type {string} */ time, /** @type {{ user?: string, out?: boolean }} */ o = {}) => {
  const t = /^\d{1,2}:\d{2}$/.test(time) ? time : '12:00';
  const [hh, mm] = t.split(':').map(Number);
  const out = !!o.out;
  const say = line(o.user, out);
  // fit 148 units at 0.62 em per character
  const size = Math.min(out ? 14 : 7, Math.floor(2380 / [...say].length) / 10);
  const y = out ? 66.5 : 61;
  const ids = [uid('hud'), uid('hud')];
  const all = { x: -160, y: -80, width: 480, height: 240 };
  return [
    s(
      'defs',
      {},
      s('radialGradient', { id: ids[0], cy: '45%', r: '65%' }, ...[['0', '#3d0605'], ['60%', '#1c0202'], ['1', '#080000']].map(([offset, c]) => s('stop', { offset, 'stop-color': c }))),
      s('pattern', { id: ids[1], width: 4, height: 2, patternUnits: 'userSpaceOnUse' }, s('rect', { width: 4, height: 0.7, fill: RED, 'fill-opacity': 0.09 })),
    ),
    // past the viewBox: the stage is dark at any shape
    s('rect', { ...all, fill: `url(#${ids[0]})` }),
    s('rect', { ...all, fill: `url(#${ids[1]})` }),
    g('pfx-hscan', s('rect', { x: -160, y: -6, width: 480, height: 6, fill: RED, 'fill-opacity': 0.1 })),
    // readouts top left, level bars top right
    g('pfx-hdata', tiny(5, 9, `MODE: CLOCK-${out ? 'OUT' : 'IN'}`), tiny(5, 14.5, `SEQ ${(hh * 60 + mm).toString(16).toUpperCase().padStart(4, '0')}  SYNC`, DIM), tiny(5, 20, 'SCAN 160:80 RGB0')),
    g(
      'pfx-hbars',
      ...[22, 15, 19, 11].map((w, i) => vars(g('pfx-hb', s('rect', { x: 155 - w, y: 5 + i * 4.4, width: w, height: 2.6, fill: i % 2 ? DIM : RED })), { lag: `${i * -470}ms` })),
    ),
    // the target (the picker's tile shows it alone)
    g(
      'pfx-hcore',
      g('pfx-hflash', s('rect', { x: 49, y: 22, width: 62, height: 24, fill: RED, 'fill-opacity': 0.45 })),
      g('pfx-htime', mono(80, 40.5, t, HOT, 17)),
      g(
        'pfx-hx',
        s('path', { d: 'M80 -120 V20 M80 48 V200 M-200 34 H47 M113 34 H360', stroke: RED, 'stroke-opacity': 0.55, 'stroke-width': 0.5 }),
        g('pfx-hdot', s('circle', { cx: 80, cy: 34, r: 5, fill: 'none', stroke: RED, 'stroke-width': 0.8 }), s('path', { d: 'M80 26v4m0 8v4M72 34h4m8 0h4', stroke: RED, 'stroke-width': 0.8 })),
      ),
      g('pfx-hbox', s('path', { d: 'M49 28V22h8m46 0h8v6m0 12v6h-8m-46 0h-8v-6', stroke: RED, 'stroke-width': 1.4, fill: 'none' }), tiny(111, 19.5, 'LOCK', RED, 'end')),
    ),
    // the line: a faint wide stroke as a halo
    g(
      out ? 'pfx-hquote' : 'pfx-hline',
      mono(80, y, say, RED, size, { stroke: RED, 'stroke-opacity': 0.28, 'stroke-width': size / 6, 'stroke-linejoin': 'round' }),
      mono(80, y, say, out ? HOT : RED, size),
    ),
    // a match bar, full at the lock
    g(
      'pfx-hfoot',
      tiny(5, 76, 'MATCH', DIM),
      s('rect', { x: 19, y: 73.4, width: 40, height: 3, fill: 'none', stroke: DIM, 'stroke-width': 0.5 }),
      g('pfx-hmatch', s('rect', { x: 19.6, y: 74, width: 38.8, height: 1.8, fill: RED })),
      g('pfx-hpct', tiny(155, 76, `LOG ${out ? 'CLOSED' : 'OPEN'}`, RED, 'end')),
    ),
  ];
};
