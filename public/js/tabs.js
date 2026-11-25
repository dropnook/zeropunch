// Tabs of the same app in one browser share the local database and the session cookie. When one tab
// logs out, wipes the device or logs in (maybe as someone else), the others must not keep running with
// what they had in memory: this tells them, through a BroadcastChannel, or through a storage event
// where there is none. The receiving tab decides (the app reloads).

const NAME = 'zeropunch-tabs';

/**
 * @typedef {{ type: 'wipe' } | { type: 'account', fp: string | null }} TabMessage
 * @param {{ onMessage: (m: TabMessage) => void, Channel?: typeof BroadcastChannel | null,
 *   storage?: Storage | null, win?: { addEventListener: Window['addEventListener'] } | null }} o
 */
export function createTabLink(o) {
  const Channel = o.Channel === undefined ? globalThis.BroadcastChannel : o.Channel;
  const storage = o.storage === undefined ? safeLocalStorage() : o.storage;
  const win = o.win === undefined ? globalThis.window : o.win;
  /** @param {any} m */
  const accept = (m) => {
    if (m && (m.type === 'wipe' || m.type === 'account')) o.onMessage(m);
  };
  /** @type {BroadcastChannel | null} */
  let ch = null;
  if (typeof Channel === 'function') {
    try {
      ch = new Channel(NAME);
      ch.onmessage = (e) => accept(e.data);
    } catch {
      ch = null;
    }
  }
  if (!ch && storage && win) {
    // Fallback: a storage event fires in every other tab of this origin when the value changes.
    win.addEventListener('storage', (/** @type {StorageEvent} */ e) => {
      if (e.key !== NAME || !e.newValue) return;
      try {
        accept(JSON.parse(e.newValue).m);
      } catch {
        /* not ours */
      }
    });
  }
  return {
    /** @param {TabMessage} m */
    post(m) {
      if (ch) {
        try {
          ch.postMessage(m);
        } catch {
          /* closed */
        }
        return;
      }
      try {
        // A nonce makes every message a change, so the event fires again for the same message.
        storage?.setItem(NAME, JSON.stringify({ m, n: Math.random() }));
      } catch {
        /* storage blocked */
      }
    },
    usesChannel: !!ch,
  };
}

function safeLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
