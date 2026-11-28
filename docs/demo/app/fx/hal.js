// HAL 9000: a calm machine eye in a dark housing (our own geometric sensor, not the film's panel). A
// scan line sweeps the lens, the eye glows up red with a hot core, pulses calmly twice and politely
// declines, with the user's name. The only scene with words to read, hence the longer run.
import { s, g, path, text, uid } from '../js/punchfx.js';

const CX = 80;
const CY = 24;
/** The eye is kept small: the words need the room (the stage is only ~84 px high on short phones). */
const LENS = 9.3;
/** Longest name shown in full (usernames can have 32 characters). */
export const NAME_MAX = 14;
/** Room for a line of the quote, in user units (the viewBox is 160 wide; a margin on both sides). */
const ROOM = 148;
const SIZE = 10.5;
const LIGHT = '#ece7de';

/** The name in the quote: trimmed, «Dave» without one, cut to NAME_MAX characters with «…». @param {unknown} user */
export function quoteName(user) {
  const name = typeof user === 'string' ? user.trim() : '';
  if (!name) return 'Dave';
  const chars = [...name];
  return chars.length > NAME_MAX ? `${chars.slice(0, NAME_MAX).join('')}…` : name;
}

/** The two lines of the quote (English in every language: it is the film's line). @param {unknown} user */
export const quote = (user) => [`I'm sorry, ${quoteName(user)}.`, "I'm afraid I can't do that."];

/**
 * Font size so a line fits ROOM, from a rough width per character of a light system-ui face (in em):
 * the text is built before it is on the page, so it cannot be measured. Generous on purpose.
 * @param {string} str @param {number} [base]
 */
export function fitSize(str, base = SIZE) {
  let em = 0;
  for (const ch of str) em += /[mw…]/.test(ch) ? 0.86 : /[il.,'!|:;\s]/.test(ch) ? 0.3 : /[A-Z0-9]/.test(ch) ? 0.66 : /[a-z_-]/.test(ch) ? 0.56 : 0.7;
  return Math.min(base, Math.floor((ROOM / em) * 10) / 10);
}

/** The soft red glow around the eye (its own group: it pulses). @param {string} id */
const vglow = (id) => g('pfx-hglow', s('circle', { cx: CX, cy: CY, r: 29, fill: `url(#${id})` }));

export default (/** @type {string} */ _time, /** @type {{ user?: string }} */ o = {}) => {
  const ids = { plate: uid('hal-plate'), lens: uid('hal-lens'), core: uid('hal-core'), glow: uid('hal-glow'), clip: uid('hal-clip') };
  const stop = (/** @type {number} */ at, /** @type {string} */ color, /** @type {number} */ op = 1) => s('stop', { offset: `${at}%`, 'stop-color': color, 'stop-opacity': op });
  const lines = quote(o.user);
  const size = Math.min(...lines.map((l) => fitSize(l)));
  const say = (/** @type {number} */ y, /** @type {string} */ str, /** @type {string} */ cls) =>
    g(cls, text(CX, y, str, LIGHT, size, { 'font-weight': 300, 'letter-spacing': 0.15 }));
  // tick marks on the bezel, every 30° (the sensor's own scale)
  const ticks = [];
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    const [r1, r2] = i % 3 ? [14, 14.9] : [13.6, 15.2];
    ticks.push(`M${(CX + r1 * Math.sin(a)).toFixed(2)} ${(CY - r1 * Math.cos(a)).toFixed(2)} L${(CX + r2 * Math.sin(a)).toFixed(2)} ${(CY - r2 * Math.cos(a)).toFixed(2)}`);
  }
  return [
    s(
      'defs',
      {},
      s('linearGradient', { id: ids.plate, x1: 0, y1: 0, x2: 0, y2: 1 }, stop(0, '#2a3137'), stop(100, '#101417')),
      s('radialGradient', { id: ids.lens, cx: '50%', cy: '50%', r: '50%' }, stop(0, '#ff4a2e'), stop(45, '#c8150c'), stop(80, '#5e0604'), stop(100, '#1c0101')),
      s('radialGradient', { id: ids.core, cx: '50%', cy: '50%', r: '50%' }, stop(0, '#ffffff'), stop(45, '#fff1b0'), stop(100, '#ffc23a', 0)),
      s('radialGradient', { id: ids.glow, cx: '50%', cy: '50%', r: '50%' }, stop(0, '#ff2a12', 0.55), stop(45, '#e0180a', 0.22), stop(100, '#b00000', 0)),
      s('clipPath', { id: ids.clip }, s('circle', { cx: CX, cy: CY, r: LENS })),
    ),
    // the dark housing; it reaches past the viewBox so the whole stage is dark at any shape
    s('rect', { x: -160, y: -80, width: 480, height: 240, fill: `url(#${ids.plate})` }),
    // the sensor (one group: the picker's small tile shows it alone, larger, without the words)
    g(
      'pfx-heye',
      vglow(ids.glow),
      // a bezel with its own scale, a dark well, the lens
      s('circle', { cx: CX, cy: CY, r: 16, fill: '#0a0c0e', stroke: '#55606b', 'stroke-width': 1 }),
      path(ticks.join(' '), { stroke: '#8a949e', 'stroke-width': 0.6, 'stroke-linecap': 'round' }),
      s('circle', { cx: CX, cy: CY, r: 12, fill: '#050606', stroke: '#2b3238', 'stroke-width': 1.2 }),
      g('pfx-hlens', s('circle', { cx: CX, cy: CY, r: LENS, fill: `url(#${ids.lens})` })),
      g('pfx-hring', s('circle', { cx: CX, cy: CY, r: 6, fill: 'none', stroke: '#ff8a5c', 'stroke-opacity': 0.35, 'stroke-width': 0.45 })),
      g('pfx-hcore', s('circle', { cx: CX, cy: CY, r: 2.9, fill: `url(#${ids.core})` })),
      // a highlight on the glass and the scan line that crosses it before it lights
      path(`M${CX - 6} ${CY - 4.6} A7.6 7.6 0 0 1 ${CX - 1.3} ${CY - 7.3}`, { stroke: '#ffffff', 'stroke-opacity': 0.28, 'stroke-width': 0.9, 'stroke-linecap': 'round' }),
      s('g', { 'clip-path': `url(#${ids.clip})` }, g('pfx-hscan', s('rect', { x: CX - LENS, y: CY - 0.5, width: LENS * 2, height: 1, fill: '#ff9a7a', 'fill-opacity': 0.8 }))),
    ),
    say(56, lines[0], 'pfx-hq1'),
    say(70, lines[1], 'pfx-hq2'),
  ];
};
