import { describe, it, expect, afterEach } from 'vitest';
import { dayBlocks, deletePunch, deleteDay } from '../../public/js/listview.js';
import { buildDays, zonedToEpoch } from '../../public/js/time.js';
import { setLang } from '../../public/js/i18n.js';

const TZ = 'Europe/Zurich';
const at = (h, m) => zonedToEpoch(2026, 11, 23, h, m, TZ);
const entries = [
  { id: 'a', ts: at(8, 2), tz: TZ },
  { id: 'b', ts: at(12, 1), tz: TZ },
  { id: 'c', ts: at(12, 48), tz: TZ, note: 'Büro' },
];
const day = () => buildDays(entries, zonedToEpoch(2026, 11, 24, 12, 0, TZ), 0, TZ)[0];

afterEach(() => setLang('en'));

describe('list: one edit and one delete control per punch', () => {
  it('builds pair blocks with a row per punch and the right labels (EN)', () => {
    setLang('en');
    const blocks = dayBlocks(day());
    expect(blocks).toHaveLength(2);
    const rows = blocks.flatMap((b) => b.rows).filter((r) => r.entry);
    expect(rows.map((r) => r.time)).toEqual(['08:02', '12:01', '12:48']);
    expect(rows.map((r) => r.dir)).toEqual(['in', 'out', 'in']);
    for (const r of rows) {
      expect(r.controls.map((c) => c.kind)).toEqual(['edit', 'delete']);
      expect(r.controls[0].aria).toBe(`Edit punch ${r.time}`);
      expect(r.controls[1].aria).toBe(`Delete punch ${r.time}`);
    }
    // the unpaired last punch (a past day: open) gets an empty second row without controls
    expect(blocks[1].status).toBe('open');
    expect(blocks[1].rows[1]).toMatchObject({ entry: null, controls: [] });
    expect(blocks[1].notes).toEqual(['Büro']);
  });

  it('German labels', () => {
    setLang('de');
    const r = dayBlocks(day())[0].rows[0];
    expect(r.controls.map((c) => c.aria)).toEqual(['Punch 08:02 bearbeiten', 'Punch 08:02 löschen']);
  });
});

describe('list: delete goes through the confirmation', () => {
  /** @param {boolean} answer */
  function fakes(answer) {
    const log = { confirm: [], removed: [], toasts: [] };
    const store = { remove: async (id) => void log.removed.push(id) };
    const ui = {
      confirm: async (title, text, opt) => (log.confirm.push({ title, text, opt }), answer),
      toast: (m) => log.toasts.push(m),
      message: () => 'error',
    };
    return { log, store, ui };
  }

  it('cancel: nothing is deleted', async () => {
    setLang('en');
    const { log, store, ui } = fakes(false);
    expect(await deletePunch(store, entries[1], 'Mon 23 Nov', ui)).toBe(false);
    expect(log.removed).toEqual([]);
    expect(log.confirm[0].text).toBe('Delete punch 12:01 on Mon 23 Nov? The day is paired anew.');
    expect(log.confirm[0].opt).toEqual({ ok: 'Delete' }); // a plain confirmation, no typed word
  });

  it('confirm: tombstone via store.remove, then a toast', async () => {
    setLang('de');
    const { log, store, ui } = fakes(true);
    expect(await deletePunch(store, entries[1], 'Mo., 23. Nov.', ui)).toBe(true);
    expect(log.removed).toEqual(['b']);
    expect(log.confirm[0].title).toBe('Punch löschen?');
    expect(log.confirm[0].text).toBe('Punch 12:01 am Mo., 23. Nov. löschen? Der Tag wird neu gepaart.');
    expect(log.toasts).toEqual(['Punch 12:01 gelöscht.']);
  });

  it('a failing delete shows the error instead', async () => {
    const { log, ui } = fakes(true);
    const store = { remove: async () => { throw new Error('too_old'); } };
    expect(await deletePunch(store, entries[0], 'x', ui)).toBe(false);
    expect(log.toasts).toEqual(['error']);
  });
});

describe('list: delete a whole day', () => {
  const ui = (answer) => {
    const log = { confirm: [], toasts: [], removed: [] };
    return { log, store: { remove: async (id) => void log.removed.push(id) }, ui: { confirm: async (title, text, opt) => (log.confirm.push({ title, text, opt }), answer), toast: (m) => log.toasts.push(m), message: () => 'error' } };
  };

  it('asks once with day and number, then removes every punch of that day', async () => {
    setLang('de');
    const f = ui(true);
    expect(await deleteDay(f.store, entries, 'Mo., 23. Nov.', f.ui)).toBe(3);
    expect(f.log.confirm).toHaveLength(1);
    expect(f.log.confirm[0].text).toBe('Alle 3 Punches vom Mo., 23. Nov. löschen?');
    expect(f.log.removed).toEqual(['a', 'b', 'c']);
    expect(f.log.toasts).toEqual(['3 Punches gelöscht.']);
  });

  it('cancel removes nothing; an empty day asks nothing', async () => {
    setLang('en');
    const f = ui(false);
    expect(await deleteDay(f.store, entries, 'Mon 23 Nov', f.ui)).toBe(0);
    expect(f.log.removed).toEqual([]);
    expect(await deleteDay(f.store, [], 'Mon 23 Nov', f.ui)).toBe(0);
    expect(f.log.confirm).toHaveLength(1);
  });

  it('stops at the first failure and reports how far it got', async () => {
    const f = ui(true);
    let n = 0;
    const store = { remove: async () => { if (++n === 2) throw new Error('daily'); } };
    expect(await deleteDay(store, entries, 'x', f.ui)).toBe(1);
    expect(f.log.toasts).toEqual(['error']);
  });
});
