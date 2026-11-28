// Stand-in for the app's public/js/store.js on the product site (not a copy). The copied fx.js imports
// pickFx from './store.js'; the real store would pull in the database, the API and the crypto, which a
// demo that stores nothing does not need. pickFx and FX_NAMES as in the app (test/unit/demo.test.js
// compares them with the real ones); see scripts/sync-demo.mjs.
/** The app's list, in its order (punchfx.js loads only when an animation plays, so it is not imported here). */
export const FX_NAMES = Object.freeze(['sundial', 'hourglass', 'tower', 'tally', 'seal', 'stamp', 'typewriter', 'clock',
  'card', 'turnstile', 'flip', 'validator', 'badge', 'finger', 'iris', 'nfc', 'button', 'hal',
  'hud', 'gears', 'top', 'rain', 'ripple', 'fuse', 'station', 'grid', 'answer']);
/** The film homages, as in the app (FX_FILM); the rest is «standard». */
export const FX_FILM = new Set(['tower', 'hal', 'hud', 'gears', 'top', 'rain', 'ripple', 'fuse', 'station', 'grid', 'answer']);
/** @type {Record<string, readonly string[]>} */
const POOLS = { random: FX_NAMES, 'random-film': FX_NAMES.filter((n) => FX_FILM.has(n)), 'random-std': FX_NAMES.filter((n) => !FX_FILM.has(n)) };

/** Which animation plays: a random choice never repeats the previous one. @param {unknown} value @param {string|null} prev @param {() => number} [random] */
export function pickFx(value, prev, random = Math.random) {
  const v = value === 'off' || (typeof value === 'string' && (Object.hasOwn(POOLS, value) || FX_NAMES.includes(value))) ? value : 'random';
  if (v === 'off') return null;
  if (!Object.hasOwn(POOLS, /** @type {string} */ (v))) return /** @type {string} */ (v);
  const pool = POOLS[/** @type {string} */ (v)].filter((n) => n !== prev);
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}
