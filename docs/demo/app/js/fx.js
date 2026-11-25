// Runs the punch animation (decoration only). The animation module is imported only when an animation
// is about to play, after the punch is written: «Off» and reduced motion never load it. One animation at
// a time: a new punch cancels the running one. Nothing here can fail or delay a punch.
// Haptics: with an animation, one short vibration (a pattern per animation) at its impact; without
// one («Off», reduced motion, or it cannot load) the plain short vibration right away, as before.
// Only where the device has the API (`vibrate` is null otherwise).

import { pickFx } from './store.js';

/**
 * @param {{ load: () => Promise<{ play: (name: string, o: any) => { cancel(): void } }>, reduced: () => boolean, random?: () => number, vibrate?: ((p: number | number[]) => void) | null }} deps
 */
export function createFxRunner(deps) {
  /** @type {string | null} */
  let prev = null;
  /** @type {{ cancel(): void } | null} */
  let running = null;
  let gen = 0;

  /** @param {number | number[]} p */
  const buzz = (p) => {
    try {
      deps.vibrate?.(p);
    } catch {
      /* decoration only */
    }
  };
  /** The plain vibration of a punch without animation. */
  const plain = () => buzz(15);

  const cancel = () => {
    gen++;
    try {
      running?.cancel();
    } catch {
      /* decoration only */
    }
    running = null;
  };

  return {
    cancel,
    /**
     * After a punch was written: play what the setting says. Resolves to the name played, or null.
     * @param {unknown} setting settings.fx @param {{ anchor: HTMLElement, time: string }} o
     */
    async punch(setting, o) {
      cancel();
      const mine = gen;
      const name = deps.reduced() ? null : pickFx(setting, prev, deps.random);
      if (!name) {
        plain();
        return null;
      }
      prev = name;
      try {
        const m = await deps.load();
        if (mine !== gen) return null; // another punch came first
        running = m.play(name, { ...o, buzz: deps.vibrate ? buzz : null });
        return name;
      } catch {
        if (mine === gen) plain();
        return null;
      }
    },
  };
}
