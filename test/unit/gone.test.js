import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleAccountGone } from '../../public/js/gone.js';

const deps = (o = {}) => {
  const log = [];
  return {
    log,
    d: {
      stillOurs: async () => o.ours ?? true,
      countOutbox: async () => {
        if (o.countFails) throw new Error('idb');
        return o.outbox ?? 0;
      },
      wipe: async () => void log.push('wipe'),
      tellTabs: () => log.push('tabs'),
      reload: () => log.push('reload'),
    },
  };
};

describe('account deleted elsewhere (410): the client wipe', () => {
  it('wipes this device, tells the other tabs and reports the unsynced changes that are lost', async () => {
    const { d, log } = deps({ outbox: 3 });
    expect(await handleAccountGone(d)).toEqual({ wiped: true, lost: 3 });
    expect(log).toEqual(['wipe', 'tabs']);
  });

  it('a late 410 for an account another tab has replaced on this device wipes nothing (reload only)', async () => {
    const { d, log } = deps({ ours: false, outbox: 3 });
    expect(await handleAccountGone(d)).toEqual({ wiped: false, lost: 0 });
    expect(log).toEqual(['reload']);
  });

  it('still wipes when the outbox cannot be counted', async () => {
    const { d, log } = deps({ countFails: true });
    expect((await handleAccountGone(d)).wiped).toBe(true);
    expect(log).toContain('wipe');
  });

  it('the device keeps no copy of the wrapped key; an old copy is removed on start', () => {
    const app = readFileSync(new URL('../../public/js/app.js', import.meta.url), 'utf8');
    expect(app).not.toMatch(/kvSet\('keysBlob'/);
    expect(app).toMatch(/LEGACY_KEYS_BLOB = 'keysBlob'/);
    expect(app).toMatch(/db\.del\('kv', LEGACY_KEYS_BLOB\)/);
  });
});
