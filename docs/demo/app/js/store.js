// Stand-in for the app's public/js/store.js on the product site (not a copy). The copied fx.js imports
// pickFx from './store.js'; the real store would pull in the database, the API and the crypto, which a
// demo that stores nothing does not need. pickFx and FX_NAMES as in the app (test/unit/demo.test.js
// compares them with the real ones); see scripts/sync-demo.mjs.
/** The app's list, in its order (punchfx.js loads only when an animation plays, so it is not imported here). */
export const FX_NAMES = Object.freeze(['sundial', 'hourglass', 'tally', 'seal', 'stamp', 'typewriter', 'clock', 'card',
  'turnstile', 'flip', 'validator', 'badge', 'finger', 'iris', 'nfc', 'button']);

/** Which animation plays: «random» never repeats the previous one. @param {unknown} value @param {string|null} prev @param {() => number} [random] */
export function pickFx(value, prev, random = Math.random) {
  const v = value === 'off' || FX_NAMES.includes(/** @type {any} */ (value)) ? value : 'random';
  if (v === 'off') return null;
  if (v !== 'random') return /** @type {string} */ (v);
  const pool = FX_NAMES.filter((n) => n !== prev);
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}
