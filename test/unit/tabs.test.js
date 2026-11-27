import { describe, it, expect } from 'vitest';
import { createTabLink } from '../../public/js/tabs.js';

/** BroadcastChannel stand-in: every channel of the same name except the sender gets the message. */
function fakeChannelClass() {
  const all = new Set();
  return class {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      all.add(this);
    }
    postMessage(data) {
      for (const c of all) if (c !== this && c.name === this.name && c.onmessage) c.onmessage({ data });
    }
  };
}

/** localStorage + storage events shared by several «tabs». */
function fakeStorageBus() {
  const values = new Map();
  const tabs = [];
  const tab = () => {
    const listeners = [];
    const win = { addEventListener: (t, fn) => t === 'storage' && listeners.push(fn) };
    const storage = {
      setItem: (k, v) => {
        values.set(k, v);
        for (const other of tabs) if (other !== me) for (const fn of other.listeners) fn({ key: k, newValue: v });
      },
      getItem: (k) => values.get(k) ?? null,
    };
    const me = { win, storage, listeners };
    tabs.push(me);
    return me;
  };
  return { tab };
}

describe('tabs: a wipe or login in one tab reaches the others', () => {
  it('through a BroadcastChannel', () => {
    const Channel = fakeChannelClass();
    const gotA = [];
    const gotB = [];
    const a = createTabLink({ onMessage: (m) => gotA.push(m), Channel, storage: null, win: null });
    const b = createTabLink({ onMessage: (m) => gotB.push(m), Channel, storage: null, win: null });
    expect(a.usesChannel).toBe(true);
    a.post({ type: 'wipe' });
    b.post({ type: 'account', fp: 'abcd' });
    expect(gotB).toEqual([{ type: 'wipe' }]);
    expect(gotA).toEqual([{ type: 'account', fp: 'abcd' }]);
  });

  it('through storage events where there is no BroadcastChannel; the same message twice arrives twice', () => {
    const bus = fakeStorageBus();
    const ta = bus.tab();
    const tb = bus.tab();
    const gotB = [];
    const a = createTabLink({ onMessage: () => {}, Channel: null, storage: ta.storage, win: ta.win });
    createTabLink({ onMessage: (m) => gotB.push(m), Channel: null, storage: tb.storage, win: tb.win });
    expect(a.usesChannel).toBe(false);
    a.post({ type: 'wipe' });
    a.post({ type: 'wipe' });
    expect(gotB).toEqual([{ type: 'wipe' }, { type: 'wipe' }]);
  });

  it('carries «records changed» through the channel and through storage events', () => {
    const Channel = fakeChannelClass();
    const got = [];
    const a = createTabLink({ onMessage: () => {}, Channel, storage: null, win: null });
    createTabLink({ onMessage: (m) => got.push(m), Channel, storage: null, win: null });
    a.post({ type: 'records' });
    expect(got).toEqual([{ type: 'records' }]);
    const bus = fakeStorageBus();
    const ta = bus.tab();
    const tb = bus.tab();
    const gotB = [];
    const c = createTabLink({ onMessage: () => {}, Channel: null, storage: ta.storage, win: ta.win });
    createTabLink({ onMessage: (m) => gotB.push(m), Channel: null, storage: tb.storage, win: tb.win });
    c.post({ type: 'records' });
    c.post({ type: 'records' });
    expect(gotB).toEqual([{ type: 'records' }, { type: 'records' }]);
  });

  it('ignores foreign messages', () => {
    const Channel = fakeChannelClass();
    const got = [];
    createTabLink({ onMessage: (m) => got.push(m), Channel, storage: null, win: null });
    const other = new Channel('zeropunch-tabs');
    other.postMessage({ type: 'hello' });
    other.postMessage(null);
    other.postMessage({ type: 'record' });
    other.postMessage({ type: 'RECORDS' });
    other.postMessage('records');
    expect(got).toEqual([]);
    other.postMessage({ type: 'records' });
    expect(got).toEqual([{ type: 'records' }]);
  });
});
