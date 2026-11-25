import { describe, it, expect, vi } from 'vitest';
import { createFxRunner } from '../../public/js/fx.js';
import { FX_NAMES } from '../../public/js/store.js';
import { NAMES } from '../../public/js/punchfx.js';

/** A stand-in for punchfx.js that records what it was asked to do. */
function fakeModule() {
  const log = [];
  return {
    log,
    loads: 0,
    play(name, o) {
      const h = { name, o, cancelled: false, cancel: () => (h.cancelled = true) };
      log.push(h);
      return h;
    },
  };
}

const setup = (o = {}) => {
  const m = fakeModule();
  const run = createFxRunner({
    load: async () => {
      m.loads++;
      return m;
    },
    reduced: () => !!o.reduced,
    random: o.random,
    vibrate: o.vibrate,
  });
  return { m, run };
};
const opts = { anchor: /** @type {any} */ ({}), time: '08:02' };

describe('punch animation runner', () => {
  it('the setting and the module list the same animations', () => {
    expect([...FX_NAMES]).toEqual([...NAMES]);
  });

  it('«off» and reduced motion start nothing and do not even load the module', async () => {
    let s = setup();
    expect(await s.run.punch('off', opts)).toBeNull();
    expect(s.m.loads).toBe(0);
    s = setup({ reduced: true });
    for (const v of ['random', 'card', undefined]) expect(await s.run.punch(v, opts)).toBeNull();
    expect(s.m.loads).toBe(0);
    expect(s.m.log).toHaveLength(0);
  });

  it('loads the module lazily, on the first animation only when it is about to play', async () => {
    const { m, run } = setup();
    expect(m.loads).toBe(0); // creating the runner loads nothing
    expect(await run.punch('stamp', opts)).toBe('stamp');
    expect(m.loads).toBe(1);
    expect(m.log.map((h) => h.name)).toEqual(['stamp']);
  });

  it('random never repeats the previous one', async () => {
    const { m, run } = setup({ random: () => 0 });
    for (let i = 0; i < 20; i++) await run.punch('random', opts);
    const names = m.log.map((h) => h.name);
    for (let i = 1; i < names.length; i++) expect(names[i]).not.toBe(names[i - 1]);
  });

  it('a second punch cancels the running animation; a punch still loading is dropped', async () => {
    const { m, run } = setup();
    await run.punch('card', opts);
    await run.punch('seal', opts);
    expect(m.log[0].cancelled).toBe(true);
    expect(m.log[1].cancelled).toBe(false);
    // two punches in quick succession while the module loads: only the second one plays
    const a = run.punch('tally', opts);
    const b = run.punch('badge', opts);
    expect(await a).toBeNull();
    expect(await b).toBe('badge');
    expect(m.log.at(-1).name).toBe('badge');
    expect(m.log[1].cancelled).toBe(true);
  });

  it('a failing module never surfaces', async () => {
    const run = createFxRunner({ load: async () => Promise.reject(new Error('offline')), reduced: () => false });
    expect(await run.punch('card', opts)).toBeNull();
  });

  it('haptics: with an animation the buzz is handed to it for the impact, no plain buzz', async () => {
    const vibrate = vi.fn();
    const { m, run } = setup({ vibrate });
    expect(await run.punch('clock', opts)).toBe('clock');
    expect(vibrate).not.toHaveBeenCalled(); // nothing yet: the animation buzzes at its impact
    m.log[0].o.buzz([12, 70, 16]);
    expect(vibrate).toHaveBeenCalledWith([12, 70, 16]);
    expect(m.log[0].o.anchor).toBe(opts.anchor);
  });

  it('haptics: «off» and reduced motion keep the plain short buzz, right away', async () => {
    const v1 = vi.fn();
    const off = setup({ vibrate: v1 });
    const p1 = off.run.punch('off', opts);
    expect(v1).toHaveBeenCalledTimes(1); // synchronously, as before 2.5
    expect(v1).toHaveBeenCalledWith(15);
    await p1;
    const v2 = vi.fn();
    const red = setup({ vibrate: v2, reduced: true });
    await red.run.punch('stamp', opts);
    expect(v2).toHaveBeenCalledWith(15);
    expect(red.m.loads).toBe(0);
  });

  it('haptics: only where the API exists; a failing module falls back to the plain buzz', async () => {
    const { m, run } = setup({ vibrate: null });
    await run.punch('card', opts);
    expect(m.log[0].o.buzz).toBeNull();
    await expect(run.punch('off', opts)).resolves.toBeNull(); // no API: nothing to call, nothing thrown
    const vibrate = vi.fn();
    const bad = createFxRunner({ load: async () => Promise.reject(new Error('offline')), reduced: () => false, vibrate });
    expect(await bad.punch('card', opts)).toBeNull();
    expect(vibrate).toHaveBeenCalledWith(15);
    const broken = createFxRunner({ load: async () => fakeModule(), reduced: () => false, vibrate: () => { throw new Error('no'); } });
    await expect(broken.punch('off', opts)).resolves.toBeNull(); // a throwing vibrate never surfaces
  });
});
