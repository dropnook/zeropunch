// The app shell's small decisions (public/js/flow.js), the request timeout (api.js) and how app.js
// wires them (read as text: app.js needs the whole page to run).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { reloadBlocked, controllerWatch, linkPunchAsks, mayCloseLinkTab } from '../../public/js/flow.js';
import * as api from '../../public/js/api.js';

const app = readFileSync(new URL('../../public/js/app.js', import.meta.url), 'utf8');
/** The body of a function in app.js, from its header to the next top-level line. @param {string} head */
const fn = (head) => {
  const i = app.indexOf(head);
  expect(i, head).toBeGreaterThan(-1);
  const j = app.indexOf('\n}\n', i);
  return app.slice(i, j + 2);
};

describe('request timeout (api.js)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('a request that never answers is given up after 20 s as «offline»', async () => {
    vi.useFakeTimers();
    let signal = null;
    vi.stubGlobal('fetch', (_p, init) => {
      signal = init.signal;
      return new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    });
    expect(api.REQUEST_TIMEOUT).toBe(20_000);
    const p = api.getRecords(0);
    const caught = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(19_000);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(await caught).toBeInstanceOf(api.OfflineError);
  });

  it('an answer whose body stops halfway is «offline» too, a normal answer is untouched', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', async (_p, init) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    }));
    const caught = api.getKeys().catch((e) => e);
    await vi.advanceTimersByTimeAsync(20_100);
    expect(await caught).toBeInstanceOf(api.OfflineError);
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ seq: 3 }) }));
    expect(await api.getRecords(0)).toEqual({ seq: 3 });
  });

  it('deleting the account sends the passphrase proof as JSON: { auth }', async () => {
    /** @type {any} */
    let seen = null;
    vi.stubGlobal('fetch', async (path, init) => ((seen = { path, init }), { ok: true, status: 200, json: async () => ({ ok: true }) }));
    await api.deleteAccount('AUTH');
    expect(seen.path).toBe('/api/account');
    expect(seen.init.method).toBe('DELETE');
    expect(seen.init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(seen.init.body)).toEqual({ auth: 'AUTH' });
  });

  it('the store gets out of a hung sync: the timeout ends up as the existing offline path', () => {
    // store.js maps OfflineError to «offline» (online = false) and frees `syncing` in its finally.
    const store = readFileSync(new URL('../../public/js/store.js', import.meta.url), 'utf8');
    expect(store).toMatch(/if \(e instanceof this\.api\.OfflineError\) this\.online = false;/);
  });
});

describe('new app version (service worker)', () => {
  const quiet = { dialogOpen: false, typing: false, linkPunch: false, syncing: false, cooldown: false, outbox: 0 };

  it('no reload while a punch is under way: punch link, sync, button lock, waiting records', () => {
    expect(reloadBlocked(quiet)).toBe(false);
    for (const k of ['dialogOpen', 'typing', 'linkPunch', 'syncing', 'cooldown']) expect(reloadBlocked({ ...quiet, [k]: true }), k).toBe(true);
    expect(reloadBlocked({ ...quiet, outbox: 1 })).toBe(true);
  });

  it('a page first loaded without a controller ignores only the first claim, later updates count', () => {
    const fresh = controllerWatch(false);
    expect(fresh()).toBe(false); // the worker taking the page
    expect(fresh()).toBe(true); // a later version
    expect(fresh()).toBe(true);
    const had = controllerWatch(true);
    expect(had()).toBe(true);
  });

  it('app.js uses them and reloads at the next quiet moment (sync done, punch done, back in front)', () => {
    const sw = fn('function registerServiceWorker()');
    expect(sw).not.toMatch(/if \(!hadController\) return;/);
    expect(sw).toMatch(/controllerWatch\(/);
    expect(sw).toMatch(/reloadBlocked\(\{/);
    expect(sw).toMatch(/linkPunch: pendingPunchLink \|\| linkPunchRunning/);
    expect(sw).toMatch(/syncing: !!st\?\.syncing/);
    expect(sw).toMatch(/cooldown: \$\('#b-punch'\)\.dataset\.cooldown === '1'/);
    expect(sw).toMatch(/outbox: st \? st\.outbox : 0/);
    expect(app).toMatch(/if \(!store\.syncing\) reloadWhenIdle\(\);/);
    expect(fn('async function doPunch()')).toMatch(/reloadWhenIdle\(\);/);
    expect(fn('async function linkPunchNow(st)')).toMatch(/reloadWhenIdle\(\);/);
  });
});

describe('punch link', () => {
  it('«without asking» only for a page opened directly; a referrer (web page, mail) asks first', () => {
    expect(linkPunchAsks(false, '')).toBe(true);
    expect(linkPunchAsks(true, '')).toBe(false);
    expect(linkPunchAsks(true, 'https://example.org/page')).toBe(true);
    expect(fn('async function askLinkPunch()')).toMatch(/linkPunchAsks\(!!st\.settings\.linkPunch, document\.referrer\)/);
  });

  it('the tab closes only after a punch that was made and sent, never over a dialog', () => {
    const ok = { opened: true, linkPunch: true, outbox: 0, dialogOpen: false, historyLength: 1 };
    expect(mayCloseLinkTab(ok)).toBe(true);
    expect(mayCloseLinkTab({ ...ok, dialogOpen: true })).toBe(false); // e.g. the badge reminder
    expect(mayCloseLinkTab({ ...ok, outbox: 1 })).toBe(false);
    expect(mayCloseLinkTab({ ...ok, historyLength: 2 })).toBe(false);
    expect(mayCloseLinkTab({ ...ok, opened: false })).toBe(false);
    expect(mayCloseLinkTab({ ...ok, linkPunch: false })).toBe(false);
    // doPunch says whether the punch was made; a failed one keeps the tab
    expect(fn('async function doPunch()')).toMatch(/return true;[\s\S]*return false;/);
    expect(fn('async function linkPunchNow(st)')).toMatch(/if \(!\(await doPunch\(\)\)\) return;/);
    // the check runs again when the tab would close, and the badge reminder keeps it open until dismissed
    const close = fn('function closeLinkTab()');
    expect(close).toMatch(/dialogOpen: !!document\.querySelector\('dialog\[open\]'\)/);
    expect(close).toMatch(/badge\.addEventListener\('close'/);
  });

  it('a sticker touched during the re-login or the print view is asked about afterwards', () => {
    const login = fn('async function loginWith(');
    expect(login).toMatch(/state\.store\.sync\(\);\s*showAway\(\);\s*void askLinkPunch\(\);/);
    expect(app).toMatch(/printing = null;\s*show\('list'\);\s*void askLinkPunch\(\);/);
  });
});

describe('account deletion (app.js)', () => {
  it('asks for the typed word and the passphrase, says «wrong passphrase» in the dialog', () => {
    const del = fn('async function onDeleteAccount()');
    expect(del).toMatch(/word: t\('delete_word'\)/);
    expect(del).toMatch(/pass: true/);
    expect(del).toMatch(/deleteAccountWith\(\{\}, username, pass\)/);
    expect(del).toMatch(/isWrongAuth\(e\) \? t\('err_current_pass'\)/);
    expect(app).not.toMatch(/api\.deleteAccount\(\)/);
    // «log out everywhere» is unchanged
    expect(app).toMatch(/await \(all \? api\.logoutAll\(\) : api\.logout\(\)\);/);
  });
});
