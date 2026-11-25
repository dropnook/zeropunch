// Zeropunch – user interface. Flow: register or log in (username + passphrase) → stamp.

import * as api from './api.js';
import * as db from './db.js';
import { $, $$, h, s as svg, fill } from './dom.js';
import { qrSvg } from './qr.js';
import { weekBars, monthBars, heatmap } from './charts.js';
import {
  Store,
  localTz,
  oldestDay,
  oldestLogicalDay,
  csvCell,
  MAX_PER_DAY,
  RETENTION_MONTHS,
  awayDays,
  showAwayNotice,
  buttonLabel,
  buttonLabelKey,
  BUTTON_LABELS,
  fxSetting,
  pickFx,
  FX_CHOICES,
  FX_NAMES,
  syncStatus,
  badgeDays,
  badgeDue,
  badgeNextDay,
  BADGE_DAYS_DEFAULT,
  isAbsence,
  isExpired,
  ABSENCE_AHEAD_DAYS,
} from './store.js';
import { deleteAccountWith, isWrongAuth, reloadBlocked, controllerWatch, linkPunchAsks, mayCloseLinkTab } from './flow.js';
import { createFxRunner } from './fx.js';
import { createTabLink } from './tabs.js';
import { handleAccountGone } from './gone.js';
import { dayBlocks, deletePunch, deleteDay, absenceRows, absenceLabel, deleteAbsence } from './listview.js';
import { periodOptions, renderSheet } from './sheet.js';
import { createWheel } from './wheel.js';
import { solve } from './pow.js';
import { APP_NAME, WORDMARK, REPO_URL, t, tn, wordMatches, setLang, getLang, detectLang, applyStatic, locale, num, plain } from './i18n.js';
import {
  createAccount,
  passphraseKeys,
  unlock,
  rewrapPassphrase,
  normalizeUsername,
  newId,
  jsonSize,
  MIN_PASSPHRASE,
  WEAK_PASSPHRASE,
  PLAINTEXT_SIZE,
  SETTINGS_ID,
} from './crypto.js';
import {
  buildDays,
  dayView,
  directions,
  groupWeeks,
  currentState,
  dayKey,
  timeOfDay,
  editedTs,
  parseDay,
  addDays,
  weekStart,
  formatDur,
  balance,
  weeklyHours,
  monthlyHours,
  addMonths,
  stats,
  minutesToClock,
  calendarDate,
  clockToMinutes,
  parseHours,
  DEFAULT_TZ,
  logicalDay,
  creditByDay,
  withAbsences,
  absenceCredit,
  periodSheet,
  isDayKey,
  absenceDays,
  daysBetween,
} from './time.js';

export const APP_VERSION = '2026.11.25';
const MAIN_TABS = ['start', 'list', 'nerd', 'settings'];
const FILE_PREFIX = APP_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const state = {
  /** @type {string|null} */ username: null,
  /** @type {Store|null} */ store: null,
  /** Fingerprint of the master key this tab runs with (to notice another tab's login). @type {string|null} */
  fingerprint: null,
  tab: 'start',
  listWeeks: 8,
  /** @type {any} */ editing: null,
  timersStarted: false,
  /** Session expired while the app was open: log in again with the known username. */
  reauth: false,
  /** Solved proof of work for a registration (reused after a failure that did not spend it). @type {null | { challenge: string, nonce: string, expires: number }} */
  pow: null,
  /** The last registration attempt ended without an answer (network error): its username. @type {string|null} */
  regUnanswered: null,
  /** Day shown on top of the start screen ("YYYY-MM-DD"); null = today. Not kept across reloads. @type {string|null} */
  viewDay: null,
  /** Day the list scrolls to and highlights once (tapped on the start screen). @type {string|null} */
  listFocus: null,
  /** Nerd mode: period of the key figures and the heatmap. */
  nerdRange: /** @type {'90d'|'all'} */ ('90d'),
  /** Days away before this login, if the away notice is due (shown once, after entering the app). @type {number|null} */
  away: null,
};

/** sessionStorage: the account was deleted elsewhere; value = unsynced changes lost with it. Shown once after the reload. */
const GONE_NOTE = 'zeropunch-gone';
let goneHandled = false;

/**
 * The server said the account no longer exists (410 on an authenticated call: deleted on another
 * device or for being unused). Wipe everything of it here – key, records, outbox, username, settings –
 * and start over on the intro screen with a one-time note. No question: the account is gone, and an
 * unsynced outbox has nowhere to go.
 */
async function accountGone() {
  if (goneHandled) return;
  goneHandled = true;
  // A late answer for an account another tab has already replaced: wipe nothing, just reload.
  const { wiped, lost } = await handleAccountGone({
    stillOurs,
    countOutbox: () => db.count('outbox'),
    wipe: () => db.wipe(),
    tellTabs: () => tabs?.post({ type: 'wipe' }),
    reload: () => location.reload(),
  });
  if (!wiped) return;
  try {
    sessionStorage.setItem(GONE_NOTE, String(lost));
    location.replace('/');
    return;
  } catch {
    /* storage blocked: show it without a reload */
  }
  state.store = null;
  state.username = null;
  state.fingerprint = null;
  showLogin('intro');
  showGoneNote(lost);
}

/** @param {number} lost unsynced changes that were lost */
function showGoneNote(lost) {
  const el = $('#o-gone');
  el.textContent = t('gone_note') + (lost > 0 ? ` ${tn('gone_lost', lost)}` : '');
  el.hidden = false;
}

/** Local flag of 2.3 («recovery key shown but not confirmed»); removed on start. */
const LEGACY_UNCONFIRMED = 'unconfirmedRecovery';
/** Up to 2.4's drafts a copy of the wrapped-key blob was kept on the device (an offline verifier for guesses): removed on start. */
const LEGACY_KEYS_BLOB = 'keysBlob';
/** kv flag: logged out while offline; the server session is ended at the next chance. */
const LOGOUT_PENDING = 'logoutPending';

/**
 * Is the account on this device (IndexedDB, shared by all tabs) still the one this tab runs with?
 * Another tab may have logged out, or logged in as someone else.
 */
async function stillOurs() {
  if (!state.username) return true;
  try {
    return (await db.kvGet('username')) === state.username && ((await db.kvGet('fingerprint')) ?? null) === state.fingerprint;
  } catch {
    return false;
  }
}

/** Other tabs of this app in the browser: a wipe or login there means this tab reloads. */
/** @type {ReturnType<typeof createTabLink> | null} */
let tabs = null;
function linkTabs() {
  tabs = createTabLink({
    onMessage: (m) => {
      if (m.type === 'wipe' && !state.username) return; // nothing here to drop
      if (m.type === 'account' && state.username && m.fp === state.fingerprint) return; // the same account (e.g. a re-login)
      location.reload();
    },
  });
}

/** The server session of an offline «log out» is ended as soon as the network is there. */
async function flushLogout() {
  try {
    if (!(await db.kvGet(LOGOUT_PENDING))) return;
    await api.logout({ quiet: true });
  } catch (e) {
    if (e instanceof api.OfflineError) return; // next time
  }
  await db.del('kv', LOGOUT_PENDING).catch(() => {});
}

/** The punch animation (lazy module, decoration only) and its short vibration where the device has one. */
const fx = createFxRunner({
  load: () => import('./punchfx.js'),
  reduced: () => reducedMotion(),
  vibrate: typeof navigator.vibrate === 'function' ? (p) => navigator.vibrate(p) : null,
});

// ------------------------------------------------------------ helpers

/** @param {string} view */
function show(view) {
  for (const sec of $$('.view')) sec.hidden = sec.id !== `v-${view}`;
  const main = MAIN_TABS.includes(view);
  $('#topbar').hidden = !main;
  $('#tabs').hidden = !main;
  $('#banner-auth').hidden = !main || !state.store?.authLost;
  $('#banner-clock').hidden = !main || !state.store?.clockBad;
  $('#app').dataset.view = view;
  if (main) {
    state.tab = view;
    for (const b of $$('#tabs button')) {
      if (b.dataset.tab === view) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
    window.scrollTo(0, 0); // before rendering: the list may scroll to a day itself
    render();
  } else window.scrollTo(0, 0);
}

/** @param {string} id @param {string|null} msg */
function setError(id, msg) {
  const el = $(`#${id}`);
  el.textContent = msg || '';
  el.hidden = !msg;
}

/** @param {string} sel */
const input = (sel) => /** @type {HTMLInputElement} */ ($(sel));

let toastTimer = 0;
/** @param {string} msg @param {{ label: string, fn: () => void }} [action] */
function toast(msg, action) {
  const el = $('#toast');
  fill(el, h('span', { text: msg }), action ? h('button', { class: 'btn small', type: 'button', onclick: action.fn, text: action.label }) : null);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), action ? 10000 : 3500);
}

/** Error → text in the current language. @param {any} e */
function message(e) {
  if (e instanceof api.OfflineError) return t('err_offline');
  if (e instanceof api.ApiError) {
    if (e.status === 429) return t('err_429');
    if (e.status === 401) return t('err_401');
    if (e.status === 403) return e.body?.error === 'https_required' ? t('err_https') : t('err_403');
    if (e.status >= 500) return t('err_500');
  }
  if (e?.message === 'day_full_abs') return t('day_full_abs', { n: MAX_PER_DAY - 1 });
  const known = {
    too_old: 'err_too_old',
    day_full: 'err_day_full',
    too_long: 'err_note',
    passphrase_short: 'err_min',
    absence_exists: 'err_absence_exists',
    no_room: 'err_no_room',
    bad_day: 'err_date',
    too_far: 'err_abs_future',
  };
  const key = known[/** @type {keyof typeof known} */ (e?.message)];
  if (key) return t(key, { n: key === 'err_abs_future' ? ABSENCE_AHEAD_DAYS : MIN_PASSPHRASE });
  return t('err_generic');
}

/** @param {string} key "YYYY-MM-DD" */
function shortDate(key) {
  const { y, m, d } = parseDay(key);
  return new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' }).format(
    Date.UTC(y, m - 1, d, 12),
  );
}

/** «Mon 23 Nov» / «Mo., 23. Nov.» for confirmations. @param {string} key "YYYY-MM-DD" */
function longDate(key) {
  const { y, m, d } = parseDay(key);
  return new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d, 12));
}

/** @param {string} key */
function dayLabel(key) {
  const today = state.store ? state.store.dayOf(Date.now()) : dayKey(Date.now(), localTz());
  if (key === today) return t('today');
  if (key === addDays(today, -1)) return t('yesterday');
  return shortDate(key);
}

/**
 * Confirm, optionally by typing a word and/or the passphrase. `submit` runs before the dialog closes
 * and gets the passphrase; an error text it returns is shown in the dialog, null closes it.
 * @param {string} title @param {string} text
 * @param {{ ok?: string, word?: string, pass?: boolean, submit?: (pass: string) => Promise<string | null> }} [opt]
 */
function confirmDialog(title, text, opt = {}) {
  const dlg = /** @type {HTMLDialogElement} */ ($('#dlg-confirm'));
  $('#dlg-confirm-title').textContent = title;
  $('#o-confirm').textContent = text;
  const field = input('#i-confirm');
  const label = $('#l-confirm');
  const ok = /** @type {HTMLButtonElement} */ ($('#b-confirm-ok'));
  ok.textContent = opt.ok || t('ok');
  const pass = input('#i-confirm-pass');
  field.value = '';
  pass.value = '';
  input('#i-confirm-user').value = state.username || '';
  setError('e-confirm', null);
  field.hidden = label.hidden = !opt.word;
  pass.hidden = $('#l-confirm-pass').hidden = !opt.pass;
  if (opt.word) label.textContent = t('type_word', { word: opt.word });
  const ready = () => (!opt.word || wordMatches(field.value, /** @type {string} */ (opt.word))) && (!opt.pass || !!pass.value);
  ok.disabled = !ready();
  field.oninput = pass.oninput = () => (ok.disabled = !ready());
  return new Promise((resolve) => {
    const done = (/** @type {boolean} */ v) => {
      pass.value = '';
      dlg.close();
      resolve(v);
    };
    $('#f-confirm').onsubmit = async (e) => {
      e.preventDefault();
      if (ok.disabled) return;
      if (!opt.submit) return done(true);
      // Checked before the dialog closes: a wrong passphrase is said in the dialog, to try again.
      ok.disabled = true;
      ok.textContent = t('working_kdf');
      setError('e-confirm', null);
      const err = await opt.submit(pass.value);
      ok.textContent = opt.ok || t('ok');
      ok.disabled = !ready();
      if (err) setError('e-confirm', err);
      else done(true);
    };
    $('#b-confirm-cancel').onclick = () => done(false);
    dlg.oncancel = () => resolve(false);
    dlg.showModal();
    (opt.word ? field : /** @type {HTMLElement} */ ($('#b-confirm-cancel'))).focus();
  });
}

/** @param {string} name @param {string} mime @param {string} content */
function download(name, mime, content) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function applyLanguage() {
  applyStatic();
  for (const el of $$('[data-wordmark]')) {
    fill(el, h('span', { class: 'wm-a' }, WORDMARK[0]), h('span', { class: 'wm-b' }, WORDMARK[1]));
    el.setAttribute('aria-label', APP_NAME);
  }
  document.title = APP_NAME;
  /** @type {HTMLSelectElement} */ ($('#s-lang')).value = getLang();
  /** @type {HTMLAnchorElement} */ ($('#a-source')).href = REPO_URL;
  updateLoginTexts();
}

// ------------------------------------------------------------ start

async function boot() {
  setLang(detectLang());
  applyLanguage();
  bindEvents();
  registerServiceWorker();
  linkTabs();
  api.onAccountGone(() => void accountGone());
  /** @type {string|null} */
  let goneNote = null;
  try {
    goneNote = sessionStorage.getItem(GONE_NOTE);
    sessionStorage.removeItem(GONE_NOTE);
  } catch {
    goneNote = null;
  }

  openedByPunchLink = takePunchLink(); // /#punch: asked about once the account is open
  // Pre-filled login link from another device: /#u=<username>. The hash is cleared first; a broken
  // escape (e.g. «%E0») is simply ignored.
  const m = /^#u=([^&]*)$/.exec(location.hash);
  if (m) history.replaceState(null, '', location.pathname + location.search);
  let linked = null;
  if (m) {
    try {
      linked = normalizeUsername(decodeURIComponent(m[1]));
    } catch {
      linked = null;
    }
  }

  let username = null, key = null;
  try {
    username = await db.kvGet('username');
    key = await db.kvGet('key');
  } catch {
    showLogin('intro');
    setError('e-intro', t('err_idb'));
    return;
  }
  db.del('kv', LEGACY_KEYS_BLOB).catch(() => {});
  if (username && key) {
    db.del('kv', LEGACY_UNCONFIRMED).catch(() => {});
    await enterApp(username, key);
    return;
  }
  void flushLogout();
  showLogin(linked ? 'login' : 'intro', linked);
  if (goneNote !== null && !linked) showGoneNote(Number(goneNote) || 0);
}

/** @param {string} username @param {CryptoKey} key */
async function enterApp(username, key) {
  state.username = username;
  state.reauth = false;
  state.fingerprint = (await db.kvGet('fingerprint').catch(() => null)) ?? null;
  const store = new Store(username, key, { guard: stillOurs });
  state.store = store;
  // Another tab replaced the account on this device: this tab's data is not current any more.
  store.addEventListener('stale', () => store === state.store && location.reload());
  store.addEventListener('change', () => render());
  store.addEventListener('sync', () => {
    renderSync();
    if (!store.syncing) reloadWhenIdle();
  });
  store.addEventListener('gone', () => void accountGone());
  store.addEventListener('auth', () => ($('#banner-auth').hidden = !MAIN_TABS.includes(/** @type {string} */ ($('#app').dataset.view))));
  await store.load();
  state.viewDay = null;
  show('start');
  startTimers();
  store.autoSync();
  void askLinkPunch();
}

function startTimers() {
  if (state.timersStarted) return;
  state.timersStarted = true;
  setInterval(tick, 1000);
  // Sync: regularly, when coming back to the app and when the network returns. 
  setInterval(() => document.visibilityState === 'visible' && state.store?.autoSync(), 60_000);
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (!(await stillOurs())) return location.reload();
    render();
    state.store?.autoSync();
  });
  window.addEventListener('online', () => {
    state.store?.autoSync();
    void flushLogout();
  });
  window.addEventListener('offline', () => {
    if (state.store) state.store.online = false;
    renderSync();
  });
}

function tick() {
  if (state.tab !== 'start' || !state.store || $('#v-start').hidden || document.hidden) return;
  renderStart();
}

// ------------------------------------------------------------ log in / register

const FORMS = ['login-intro', 'f-login', 'f-register', 'login-working'];

/** @param {string} id */
function showPart(id) {
  for (const f of FORMS) $(`#${f}`).hidden = f !== id;
}

/**
 * @param {'intro'|'login'|'register'} part
 * @param {string|null} [username] pre-fill
 */
function showLogin(part, username = null) {
  show('login');
  for (const id of ['e-intro', 'e-login', 'e-register']) setError(id, null);
  $('#o-gone').hidden = true;
  if (part === 'intro') {
    state.reauth = false;
    showPart('login-intro');
  } else showPart(`f-${part}`);
  if (username) input('#i-login-user').value = username;
  updateLoginTexts();
  const focus = {
    intro: '#b-show-login',
    login: state.reauth || username ? '#i-login-pass' : '#i-login-user',
    register: '#i-reg-user',
  }[part];
  /** @type {HTMLElement} */ ($(focus)).focus();
}

function updateLoginTexts() {
  const re = state.reauth && !!state.username;
  $('#login-user-box').hidden = re;
  // Hidden but filled, so password managers match the right entry.
  if (re) input('#i-login-user').value = /** @type {string} */ (state.username);
  $('#o-reauth').hidden = !re;
  if (re) $('#o-reauth').textContent = t('reauth_as', { user: /** @type {string} */ (state.username) });
  $('#b-login-back').textContent = re ? t('back_to_app') : t('back');
}

/** Show the working indicator instead of the form. @param {string} textKey */
function working(textKey) {
  showPart('login-working');
  $('#o-working').textContent = t(textKey);
}

/** The device's account: username, the non-extractable key and its fingerprint (no copy of the key blob). @param {string} username @param {CryptoKey} key @param {string} fingerprint */
async function saveLocal(username, key, fingerprint) {
  await db.kvSet('username', username);
  await db.kvSet('key', key);
  await db.kvSet('fingerprint', fingerprint);
}

/**
 * Run a login call; if the server asks for a proof of work (428, account under attack),
 * fetch a challenge, solve it with a short «Checking …» and try once more.
 * @param {(pow?: {challenge: string, nonce: string}) => Promise<any>} call
 */
async function withPow(call) {
  try {
    return await call();
  } catch (err) {
    if (!(err instanceof api.ApiError && err.status === 428)) throw err;
    const before = $('#o-working').textContent;
    $('#o-working').textContent = t('working_check');
    const ch = await api.challenge('login');
    const { nonce } = await solve(ch.challenge, ch.bits);
    $('#o-working').textContent = before;
    return call({ challenge: ch.challenge, nonce });
  }
}

/** Remember the server's clock from a login answer (for the «clock is wrong» banner). @param {any} r */
async function noteServerTime(r) {
  if (Number.isFinite(r?.now)) await db.kvSet('skew', Number(r.now) - Date.now()).catch(() => {});
  // The server's previous «last seen» day: after a long absence, say once that unused accounts go.
  const away = awayDays(r?.lastSeen, Number.isFinite(r?.now) ? Number(r.now) : Date.now());
  state.away = showAwayNotice(away) ? away : null;
}

/** Show the away notice once, if the last login asked for it. */
function showAway() {
  if (state.away == null) return;
  const n = state.away;
  state.away = null;
  $('#o-away').textContent = t('away_text', { n });
  /** @type {HTMLDialogElement} */ ($('#dlg-away')).showModal();
}

/**
 * Log in with a known passphrase and keep or replace the local data. Shared by the login form and
 * the «username taken after a lost answer» case.
 * @param {string} username @param {string} pass @param {boolean} reauth
 */
async function loginWith(username, pass, reauth) {
  const k = await passphraseKeys(username, pass);
  $('#o-working').textContent = t('working_login');
  await flushLogout(); // an old session ended offline goes first
  const r = await withPow((pow) => api.login(username, k.auth, pow));
  const un = await unlock(r.keys, k.wrapKey, username);
  await noteServerTime(r);
  if (reauth && state.store) {
    const fp = await db.kvGet('fingerprint').catch(() => null);
    if (fp === un.fingerprint) {
      // Same key as before: keep local data and outbox, just sync again.
      state.reauth = false;
      state.store.authLost = false;
      show(state.tab);
      state.store.sync();
      showAway();
      void askLinkPunch(); // a sticker touched while the login form was shown
      return;
    }
  }
  await db.wipe();
  await saveLocal(username, un.key, un.fingerprint);
  await enterApp(username, un.key);
  tabs?.post({ type: 'account', fp: un.fingerprint });
  showAway();
}

async function onLogin(/** @type {SubmitEvent} */ e) {
  e.preventDefault();
  setError('e-login', null);
  const reauth = state.reauth && !!state.username;
  const username = reauth ? /** @type {string} */ (state.username) : normalizeUsername(input('#i-login-user').value);
  const pass = input('#i-login-pass').value;
  if (!username) return setError('e-login', t('err_username'));
  if (!pass) return setError('e-login', t('err_login'));
  working('working_kdf');
  try {
    await loginWith(username, pass, reauth);
    input('#i-login-pass').value = '';
  } catch (err) {
    showPart('f-login');
    if (err instanceof api.ApiError && err.status === 401) setError('e-login', t('err_login'));
    else if (err instanceof Error && err.message === 'wrong_passphrase') setError('e-login', t('err_login'));
    else setError('e-login', message(err));
  }
}

/** Fetch and solve a challenge, or reuse an unspent one. */
async function proofOfWork() {
  if (state.pow && state.pow.expires > Date.now() + 60_000) return state.pow;
  const ch = await api.challenge();
  const { nonce } = await solve(ch.challenge, ch.bits);
  state.pow = { challenge: ch.challenge, nonce, expires: ch.expires };
  return state.pow;
}

async function onRegister(/** @type {SubmitEvent} */ e) {
  e.preventDefault();
  setError('e-register', null);
  const username = normalizeUsername(input('#i-reg-user').value);
  const p1 = input('#i-reg-pass1').value;
  const p2 = input('#i-reg-pass2').value;
  if (!username) return setError('e-register', t('err_username'));
  if (p1.length < MIN_PASSPHRASE) return setError('e-register', t('err_min', { n: MIN_PASSPHRASE }));
  if (p1 !== p2) return setError('e-register', t('err_mismatch'));
  working('working_pow');
  const lostBefore = state.regUnanswered === username;
  state.regUnanswered = null;
  try {
    const made = await createAccount(username, p1);
    // A challenge can be too weak on a busy day, expired or spent: fetch a new one, a few times.
    for (let attempt = 0; ; attempt++) {
      $('#o-working').textContent = t('working_pow');
      const pow = await proofOfWork();
      $('#o-working').textContent = t('working_kdf');
      try {
        const r = await api.register({
          username,
          auth: made.auth,
          keys: made.blob,
          pow: { challenge: pow.challenge, nonce: pow.nonce },
        });
        await noteServerTime(r);
        break;
      } catch (err) {
        const code = err instanceof api.ApiError ? err.body?.error : null;
        if (typeof code === 'string' && code.startsWith('pow_')) state.pow = null;
        if (err instanceof api.ApiError && err.status === 409) state.pow = null; // spent on the taken name
        if (typeof code === 'string' && ['pow_weak', 'pow_expired', 'pow_used'].includes(code) && attempt < 2) continue;
        throw err;
      }
    }
    state.pow = null;
    await db.wipe();
    await saveLocal(username, made.key, made.fingerprint);
    for (const id of ['#i-reg-pass1', '#i-reg-pass2']) input(id).value = '';
    // Straight into the app: there is nothing else to note down than username and passphrase.
    await enterApp(username, made.key);
    tabs?.post({ type: 'account', fp: made.fingerprint });
  } catch (err) {
    const code = err instanceof api.ApiError ? err.body?.error : null;
    if (err instanceof api.OfflineError) state.regUnanswered = username;
    if (code === 'username_taken' && lostBefore) {
      // The first attempt probably went through and only its answer was lost: try logging in with
      // the same credentials.
      try {
        working('working_kdf');
        await loginWith(username, p1, false);
        for (const id of ['#i-reg-pass1', '#i-reg-pass2']) input(id).value = '';
        return;
      } catch {
        /* not ours: report the name as taken */
      }
    }
    showPart('f-register');
    if (code === 'username_taken') setError('e-register', t('err_taken'));
    else if (code === 'username') setError('e-register', t('err_username'));
    else if (typeof code === 'string' && code.startsWith('pow_')) {
      state.pow = null;
      setError('e-register', t('err_pow'));
    } else setError('e-register', message(err));
  }
}

async function onPassChange(/** @type {SubmitEvent} */ e) {
  e.preventDefault();
  const old = input('#i-pold').value;
  const p1 = input('#i-pnew1').value;
  const p2 = input('#i-pnew2').value;
  setError('e-pass', null);
  if (p1.length < MIN_PASSPHRASE) return setError('e-pass', t('err_min', { n: MIN_PASSPHRASE }));
  if (p1 !== p2) return setError('e-pass', t('err_mismatch'));
  const btn = /** @type {HTMLButtonElement} */ ($('#f-pass button[type=submit]'));
  btn.disabled = true;
  btn.textContent = t('working_kdf');
  try {
    const username = /** @type {string} */ (state.username);
    const k = await api.getKeys(); // fresh state from the server
    const oldKeys = await passphraseKeys(username, old);
    const re = await rewrapPassphrase(k.keys, oldKeys.wrapKey, username, p1);
    await api.changePassphrase({ auth: oldKeys.auth, newAuth: re.auth, keys: re.blob, version: k.version });
    for (const id of ['#i-pold', '#i-pnew1', '#i-pnew2']) input(id).value = '';
    toast(t('pass_changed'));
  } catch (err) {
    const wrong =
      (err instanceof Error && err.message === 'wrong_passphrase') || (err instanceof api.ApiError && err.body?.error === 'wrong_auth');
    if (wrong) setError('e-pass', t('err_current_pass'));
    else if (err instanceof api.ApiError && err.status === 409) setError('e-pass', t('err_conflict'));
    else setError('e-pass', message(err));
  } finally {
    btn.disabled = false;
    btn.textContent = t('h_pass');
  }
}

// ------------------------------------------------------------ rendering

function render() {
  if (!state.store) return;
  if ($('#app').dataset.view === 'print') return renderPrint();
  $('#tabs [data-tab=nerd]').hidden = !state.store.settings.nerd;
  if (state.tab === 'nerd' && !state.store.settings.nerd) return show('start');
  renderSync();
  if (state.tab === 'start') renderStart();
  else if (state.tab === 'list') renderList();
  else if (state.tab === 'nerd') renderNerd();
  else if (state.tab === 'settings') renderSettings();
}

function renderSync() {
  const st = state.store;
  if (!st) return;
  const dot = $('#o-syncdot');
  const s = syncStatus(st, navigator.onLine);
  $('#o-sync').textContent = t(s.key, { n: s.n });
  dot.className = `dot ${s.cls}`;
  const main = MAIN_TABS.includes(/** @type {string} */ ($('#app').dataset.view));
  $('#banner-clock').hidden = !main || !st.clockBad;
  // Writes the server refused for good: say so plainly, offer «try again» and «discard».
  const rej = $('#banner-rejected');
  rej.hidden = !main || !st.rejected;
  if (st.rejected) {
    $('#o-rejected').textContent = tn(st.rejectedCode === 'too_many' ? 'rejected_full' : 'rejected_text', st.rejected);
  }
}

function renderStart() {
  const st = /** @type {Store} */ (state.store);
  const now = Date.now();
  const tz = localTz();
  const cur = currentState(st.list(), now, tz, st.dayStart, oldestLogicalDay(now, tz, st.dayStart));
  renderDayView(st, now, tz);
  const d = new Date(now);
  const p2 = (/** @type {number} */ n) => String(n).padStart(2, '0');
  $('#o-clock').textContent = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  const stateEl = $('#o-state');
  if (cur.in) stateEl.textContent = t('state_in', { time: timeOfDay(/** @type {number} */ (cur.since), tz), dur: formatDur(cur.todaySum) });
  else if (cur.punchesToday) stateEl.textContent = t('state_out', { dur: formatDur(cur.todaySum) });
  else stateEl.textContent = t('state_none');
  $('#app').dataset.punched = cur.in ? 'in' : 'out';
  $('#o-today').textContent = formatDur(cur.todaySum);
  const btn = /** @type {HTMLButtonElement} */ ($('#b-punch'));
  // The label is a setting (the button's text is its accessible name, too); the worded ones get a
  // smaller font so that they stay on one line down to 320 px.
  const labelKey = buttonLabelKey(st.settings.button);
  const label = t(labelKey);
  if (btn.textContent !== label) btn.textContent = label;
  btn.classList.toggle('long', labelKey !== 'punch');
  const full = st.todayFull();
  btn.disabled = full || btn.dataset.cooldown === '1';
  const df = $('#o-dayfull');
  const fullText = () => (st.absencesOn(cur.today).length ? t('day_full_abs', { n: MAX_PER_DAY - 1 }) : t('day_full'));
  df.textContent = full ? fullText() : st.dailyLimited ? t('daily_wait') : '';
  df.hidden = !full && !st.dailyLimited;
  const warn = $('#o-openday');
  if (cur.openDays.length) {
    const last = cur.openDays[cur.openDays.length - 1];
    warn.textContent = cur.openDays.length === 1 ? t('open_one', { day: shortDate(last) }) : t('open_many', { n: cur.openDays.length });
    warn.hidden = false;
  } else warn.hidden = true;
  const ob = $('#o-outbox');
  if (st.outbox) {
    ob.textContent = st.outbox === 1 ? t('outbox_one') : t('outbox_many', { n: st.outbox });
    ob.hidden = false;
  } else ob.hidden = true;
}

// ------------------------------------------------------------ day view (top of the start screen)

/** The day view's inputs → the view (pure logic in time.js). @param {Store} st @param {number} now @param {string} tz */
const currentDayView = (st, now, tz) =>
  dayView(st.list(), now, { day: state.viewDay, dayStart: st.dayStart, tz, oldest: oldestLogicalDay(now, tz, st.dayStart) });

/** «Today» / «Yesterday» / «Mon 23 Nov» for the day view. @param {ReturnType<typeof dayView>} v */
function dayViewLabel(v) {
  if (v.isToday) return t('today');
  if (v.day === addDays(v.today, -1)) return t('yesterday');
  return longDate(v.day);
}

/**
 * One day on top of the start screen: the header «‹ Today · 5:49 h ›» and all punches of that day.
 * The start screen ticks every second: header texts are written only when they differ, the chips
 * are rebuilt only when something they show changed.
 * @param {Store} st @param {number} now @param {string} tz
 */
function renderDayView(st, now, tz) {
  const v = currentDayView(st, now, tz);
  if (state.viewDay && v.isToday) state.viewDay = null; // today again (or the day fell out of the bounds)
  const label = dayViewLabel(v);
  const setText = (/** @type {string} */ sel, /** @type {string} */ text) => {
    const el = $(sel);
    if (el.textContent !== text) el.textContent = text;
  };
  setText('#o-dv-day', label);
  setText('#o-dv-sum', `${formatDur(v.sum)} h`);
  // An absence on that day: a short label in the header (hidden where the header is narrow, so the
  // area's height never changes), and instead of «No punches» on an otherwise empty day.
  const abs = st.absencesOn(v.day).map((a) => absenceLabel(a)).join(', ');
  const absEl = $('#o-dv-abs');
  setText('#o-dv-abs', abs);
  absEl.hidden = !abs || !v.punches.length;
  /** @type {HTMLButtonElement} */ ($('#b-dv-prev')).disabled = !v.prev;
  /** @type {HTMLButtonElement} */ ($('#b-dv-next')).disabled = !v.next;
  $('#b-dv-today').hidden = v.isToday;
  const box = $('#o-dayview');
  const sig = `${getLang()}|${v.day}|${label}|${abs}|` + v.punches.map((p) => `${p.id}:${p.ts}:${p.dir}`).join(',');
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.classList.toggle('dense', v.punches.length > 6);
  if (!v.punches.length) {
    fill(box, h('p', { class: ['dv-empty', abs && 'dv-absent'] }, abs || t('day_empty')));
    return;
  }
  fill(
    box,
    ...v.punches.map((p) => {
      const dir = t(p.dir === 'in' ? 'dir_in' : 'dir_out');
      const time = timeOfDay(p.ts, p.tz);
      return h(
        'button',
        { class: `dv-chip ${p.dir}${p.id === glow.id ? ' dv-new' : ''}`, type: 'button', 'data-day': v.day, 'aria-label': t('chip_aria', { day: label, time, dir }) },
        h('span', { class: 'dv-time' }, time),
        h('span', { class: 'dv-dir' }, dir),
      );
    }),
  );
}

/** One punch, from the big button or a confirmed punch link. @returns {Promise<boolean>} whether it was made */
async function doPunch() {
  const btn = /** @type {HTMLButtonElement} */ ($('#b-punch'));
  if (!state.store || btn.disabled) return false;
  btn.disabled = true;
  btn.dataset.cooldown = '1';
  try {
    const entry = await state.store.punch();
    state.viewDay = null; // the day view goes back to today
    // Decoration after the record is written; never awaited, never fails the punch. It also buzzes:
    // at the animation's impact, or (no animation) right away as a plain short vibration.
    void fx.punch(state.store.settings.fx, { anchor: btn, time: timeOfDay(entry.ts, entry.tz) });
    const dir = directions(state.store.list(), state.store.dayStart).get(entry.id) === 'out' ? t('dir_out') : t('dir_in');
    // No banner: the new chip in the day view glows for a moment. Screen readers hear the same line.
    $('#o-punched').textContent = t('punched', { time: timeOfDay(entry.ts, entry.tz), dir });
    glowChip(entry.id);
    badgeReminder(state.store);
    return true;
  } catch (err) {
    toast(message(err));
    return false;
  } finally {
    // short lock against double taps
    setTimeout(() => {
      btn.dataset.cooldown = '';
      if (state.tab === 'start') renderStart();
      reloadWhenIdle();
    }, 800);
  }
}

// ------------------------------------------------------------ punch link (NFC tag, QR code, shortcut)

/** The link that asks «Punch now?». The part after # never reaches the server. */
const punchLink = () => `${location.origin}/#punch`;
let pendingPunchLink = false;
/** A punch link's punch is being made and sent (linkPunchNow). */
let linkPunchRunning = false;
/** With «punch link without asking»: this long after the last punch a link does nothing (ms). */
const LINK_PUNCH_LOCK = 60_000;
/** If the address is the punch link: note it and clean the address, so a reload does not ask again. */
function takePunchLink() {
  if (location.hash !== '#punch') return false;
  history.replaceState(null, '', location.pathname + location.search);
  pendingPunchLink = true;
  return true;
}
/**
 * A punch that came by link: made like any other, and a sync is asked for explicitly, because the
 * browser a sticker opens is closed again within seconds.
 * @param {Store} st
 */
async function linkPunchNow(st) {
  linkPunchRunning = true;
  try {
    if (!(await doPunch())) return; // not made: the tab stays open with the message
    // Resolves once the punch has been sent (also when a sync was already running when it was
    // written); without a network it stays waiting and the tab stays open.
    if (state.store === st) await st.sync({ force: true }).catch(() => {});
    if (state.store === st) closeLinkTab();
  } finally {
    linkPunchRunning = false;
    reloadWhenIdle();
  }
}

/** The page was opened by the punch link itself (not a link followed inside the running app). */
let openedByPunchLink = false;
/**
 * Without asking, every touch of the sticker opens a new browser tab. Once the punch is made and
 * sent, and the animation has played, the tab closes itself where the browser allows a page to close
 * a tab that holds nothing but this one page; elsewhere nothing happens.
 */
function closeLinkTab() {
  const st = state.store;
  if (!st) return;
  // Checked again when it is time to close: a failed send, a refused write or a dialog keeps the tab.
  const can = () =>
    state.store === st &&
    mayCloseLinkTab({
      opened: openedByPunchLink,
      linkPunch: !!st.settings.linkPunch,
      outbox: st.outbox + st.rejected,
      dialogOpen: !!document.querySelector('dialog[open]'),
      historyLength: history.length,
    });
  if (!openedByPunchLink || !st.settings.linkPunch || st.outbox) return;
  window.setTimeout(() => {
    // The badge reminder came up meanwhile: it stays; the tab closes once it is dismissed.
    const badge = /** @type {HTMLDialogElement} */ ($('#dlg-badge'));
    if (badge.open) {
      badge.addEventListener('close', () => window.setTimeout(() => can() && tryClose(), 300), { once: true });
      return;
    }
    if (can()) tryClose();
  }, 2200);
}

function tryClose() {
  try {
    window.close();
  } catch {
    /* not allowed here: the tab stays */
  }
}

/**
 * After a punch link: go to the start and ask before punching (a link somebody sent you must never
 * punch by itself). Says what the punch would be: the time now, and in or out.
 */
async function askLinkPunch() {
  const st = state.store;
  if (!pendingPunchLink || !st) return;
  pendingPunchLink = false;
  show('start');
  const now = Date.now();
  const tz = localTz();
  const cur = currentState(st.list(), now, tz, st.dayStart);
  if (cur.punchesToday >= MAX_PER_DAY || st.todayFull()) return; // the start screen says so
  // «Without asking» only for a page opened directly (sticker, shortcut, typed address): a link from a
  // web page or a mail asks first. Best effort (flow.js linkPunchAsks): a referrer can be hidden.
  if (!linkPunchAsks(!!st.settings.linkPunch, document.referrer)) {
    // Without asking (the user's choice in the settings). A second touch of the sticker within a
    // minute of the last punch does nothing.
    const last = st.list().reduce((m, e) => (e.ts <= now ? Math.max(m, e.ts) : m), 0);
    if (now - last < LINK_PUNCH_LOCK) {
      toast(t('linkpunch_recent'));
      closeLinkTab();
    }
    else void linkPunchNow(st);
    return;
  }
  const dlg = /** @type {HTMLDialogElement} */ ($('#dlg-linkpunch'));
  if (dlg.open) return;
  $('#o-linkpunch').textContent = t('punched', { time: timeOfDay(now, tz), dir: t(cur.in ? 'dir_out' : 'dir_in') });
  $('#b-linkpunch-ok').textContent = t(buttonLabelKey(st.settings.button));
  dlg.returnValue = '';
  dlg.onclose = () => {
    if (dlg.returnValue === 'punch' && state.store === st) void linkPunchNow(st);
  };
  dlg.showModal();
}

/**
 * After a punch: the badge reminder, when it is due (store.js badgeDue). It waits for the punch
 * animation, and the day is noted when the note is on the screen, so it shows once.
 * @param {Store} st
 */
function badgeReminder(st) {
  const now = Date.now();
  const tz = localTz();
  const today = logicalDay(now, tz, st.dayStart);
  if (!badgeDue(st.settings, today, currentState(st.list(), now, tz, st.dayStart).punchesToday)) return;
  window.setTimeout(() => {
    if (state.store !== st) return;
    const dlg = /** @type {HTMLDialogElement} */ ($('#dlg-badge'));
    if (!dlg.open) dlg.showModal();
    st.saveSettings({ badgeAt: today }).catch(() => {});
  }, 1300);
}

/** The punch just made: its chip glows once (CSS, not with reduced motion). */
const glow = { id: /** @type {string | null} */ (null), timer: 0 };
/** @param {string} id */
function glowChip(id) {
  glow.id = id;
  clearTimeout(glow.timer);
  // Forget it after the glow, so a later redraw (language, edit) does not glow again.
  glow.timer = window.setTimeout(() => (glow.id = null), 1800);
  delete $('#o-dayview').dataset.sig;
  if (state.tab === 'start') renderStart();
}

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * One day back (-1) or forward (+1), or back to today (0). The chips slide in from the side the day
 * comes from (older from the left); no animation with reduced motion.
 * @param {-1|0|1} step @param {number} [fromX] where a drag left the chips, in px
 */
function stepDay(step, fromX = 0) {
  const st = state.store;
  if (!st) return;
  const now = Date.now();
  const tz = localTz();
  const v = currentDayView(st, now, tz);
  const target = step === 0 ? null : step < 0 ? v.prev : v.next;
  const box = $('#o-dayview');
  box.style.transform = '';
  if (step !== 0 && !target) {
    // At a bound: a drag springs back, nothing else happens.
    if (fromX && !reducedMotion()) box.animate([{ transform: `translateX(${fromX}px)` }, { transform: 'none' }], { duration: 160, easing: 'ease-out' });
    return;
  }
  if (step === 0 && v.isToday) return;
  state.viewDay = target;
  renderDayView(st, now, tz);
  if (reducedMotion()) return;
  const start = fromX || (step < 0 ? -1 : 1) * Math.min(80, box.clientWidth * 0.25);
  box.animate([{ transform: `translateX(${start}px)`, opacity: 0.3 }, { transform: 'none', opacity: 1 }], { duration: 180, easing: 'ease-out' });
}

/** Swipe, arrow buttons, arrow keys and horizontal wheel gestures; a chip opens the list at its day. */
function bindDayView() {
  const area = $('#dayview');
  const box = $('#o-dayview');
  $('#b-dv-prev').addEventListener('click', () => stepDay(-1));
  $('#b-dv-next').addEventListener('click', () => stepDay(1));
  $('#b-dv-today').addEventListener('click', () => {
    stepDay(0);
    area.focus({ preventScroll: true }); // the button disappears; keep the focus in the area
  });
  area.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    stepDay(e.key === 'ArrowLeft' ? -1 : 1);
  });

  // Touch, pen and mouse drag: the dominant axis decides after a few pixels. Vertical movement stays
  // with the browser (touch-action: pan-y), which then cancels the pointer.
  const SLOP = 10;
  const SWIPE = 48;
  /** @type {null | { id: number, x: number, y: number, t: number, axis: ''|'x'|'y' }} */
  let drag = null;
  let swipedAt = 0;
  area.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, axis: '' };
  });
  area.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.axis) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (drag.axis === 'y') return;
      try {
        area.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
    }
    if (drag.axis === 'x' && !reducedMotion()) box.style.transform = `translateX(${dx * 0.6}px)`;
  });
  const end = (/** @type {PointerEvent} */ e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.axis !== 'x') return;
    swipedAt = Date.now();
    const dx = e.type === 'pointercancel' ? 0 : e.clientX - d.x;
    const fast = Math.abs(dx) > 24 && Math.abs(dx) / Math.max(1, e.timeStamp - d.t) > 0.4;
    const shown = reducedMotion() ? 0 : dx * 0.6;
    // finger to the right = an older day, to the left = a newer one
    if (Math.abs(dx) >= SWIPE || fast) stepDay(dx > 0 ? -1 : 1, shown);
    else {
      box.style.transform = '';
      if (shown) box.animate([{ transform: `translateX(${shown}px)` }, { transform: 'none' }], { duration: 140, easing: 'ease-out' });
    }
  };
  area.addEventListener('pointerup', end);
  area.addEventListener('pointercancel', end);

  // Trackpad or tilt wheel: one day per horizontal gesture. The deltas of a gesture add up; after a
  // step nothing happens until the wheel has been quiet for a moment, so momentum does not run on.
  let acc = 0;
  let quietUntil = 0;
  area.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault(); // no browser back/forward gesture over this area
      const now = Date.now();
      if (now < quietUntil) {
        quietUntil = now + 250;
        return;
      }
      acc += e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX;
      if (Math.abs(acc) < 60) return;
      stepDay(acc > 0 ? 1 : -1);
      acc = 0;
      quietUntil = now + 250;
    },
    { passive: false },
  );

  // A chip opens the list at its day (not when a swipe just ended on it).
  box.addEventListener('click', (e) => {
    const chip = /** @type {HTMLElement} */ (e.target).closest('[data-day]');
    if (!chip || Date.now() - swipedAt < 400) return;
    state.listFocus = /** @type {string} */ (chip.getAttribute('data-day'));
    show('list');
  });
}

function renderList() {
  const st = /** @type {Store} */ (state.store);
  const now = Date.now();
  const target = st.settings.weekHours;
  const weeks = groupWeeks(withAbsences(buildDays(st.list(), now, st.dayStart, localTz()), st.absences(), target));
  const out = $('#o-list');
  const focus = state.listFocus;
  state.listFocus = null;
  if (!weeks.length) {
    fill(out, h('p', { class: 'empty' }, t('list_empty')));
    return;
  }
  // A day tapped on the start screen: show enough weeks to contain it (8 at a time, as the button does).
  const wi = focus ? weeks.findIndex((w) => w.days.some((d) => d.day === focus)) : -1;
  if (wi >= state.listWeeks) state.listWeeks = Math.ceil((wi + 1) / 8) * 8;
  const shown = weeks.slice(0, state.listWeeks);
  fill(
    out,
    shown.map((w) =>
      h(
        'section',
        { class: 'week' },
        h(
          'h2',
          { class: 'week-head' },
          h('span', {}, t('week', { n: w.week })),
          h('span', { class: 'sum' }, `${formatDur(w.sum + w.credit)} h`, h('small', {}, ` / ${num(target)} h`)),
        ),
        w.days.map((d) => renderDay(d, target)),
      ),
    ),
    weeks.length > shown.length
      ? h('button', { class: 'btn ghost', type: 'button', onclick: () => ((state.listWeeks += 8), renderList()) }, t('older_weeks'))
      : null,
  );
  if (wi >= 0) focusDay(/** @type {string} */ (focus));
}

/** Scroll the list to a day and highlight it briefly. @param {string} day */
function focusDay(day) {
  const el = $(`#o-list [data-day="${day}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
  el.classList.remove('flash');
  void el.getBoundingClientRect(); // restart the animation
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1800);
}

/** @param {import('./time.js').Day} d @param {number} weekHours */
function renderDay(d, weekHours) {
  const badge = d.open
    ? h('span', { class: 'badge warn' }, t('badge_open'))
    : d.running
      ? h('span', { class: 'badge live' }, t('badge_running'))
      : null;
  return h(
    'article',
    { class: ['day', d.open && 'open'], 'data-day': d.day },
    h(
      'header',
      {},
      h('span', { class: 'date' }, dayLabel(d.day)),
      badge,
      h('span', { class: 'sum' }, formatDur(d.sum + (d.credit || 0))),
      // The day's bin deletes its punches; an absence has its own bin in its row.
      d.punches.length
        ? h(
        'button',
        {
          class: 'icon-btn del',
          type: 'button',
          'aria-label': t('delete_day_aria', { day: shortDate(d.day) }),
          title: t('delete_day_aria', { day: shortDate(d.day) }),
          onclick: () => state.store && deleteDay(state.store, d.punches, longDate(d.day), { confirm: confirmDialog, toast, message }),
        },
        icon('delete'),
      )
        : h('span', { class: 'icon-gap', 'aria-hidden': 'true' }),
    ),
    h('ul', { class: 'pairs' }, absenceRows(d, weekHours).map((r) => renderAbsence(r, d.day)), dayBlocks(d).map((b) => renderPair(b, d.day))),
  );
}

/** One absence in the list: its label, the credited time and a bin. @param {import('./listview.js').AbsenceRow} r @param {string} day */
function renderAbsence(r, day) {
  const c = r.controls[0];
  return h(
    'li',
    { class: 'pair absence' },
    h(
      'div',
      { class: 'pair-box' },
      h(
        'div',
        { class: 'prows' },
        h(
          'div',
          { class: 'prow' },
          h('span', { class: 'pmain abs-main' }, h('span', { class: 'abs-label' }, r.label)),
          h(
            'button',
            {
              class: 'icon-btn del',
              type: 'button',
              'aria-label': c.aria,
              title: c.aria,
              onclick: () => state.store && deleteAbsence(state.store, r.absence, longDate(day), { confirm: confirmDialog, toast, message }),
            },
            icon('delete'),
          ),
        ),
      ),
      h('span', { class: 'dur' }, formatDur(r.credit)),
    ),
    r.note ? h('p', { class: 'note' }, r.note) : null,
  );
}

/** Hand-drawn 24 × 24 icons (stroke only, colour from CSS). */
const ICONS = {
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  delete: 'M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6',
};

/** @param {'edit'|'delete'} kind */
const icon = (kind) => svg('svg', { viewBox: '0 0 24 24', class: 'ico-svg', 'aria-hidden': 'true', focusable: 'false' }, svg('path', { d: ICONS[kind] }));

/** @param {import('./listview.js').PairBlock} b @param {string} day */
function renderPair(b, day) {
  const rows = b.rows.map((r) => {
    const dir = h('span', { class: 'pdir' }, t(r.dir === 'in' ? 'dir_in' : 'dir_out'));
    if (!r.entry) {
      // Unpaired last punch: «…» (running today, open on a past day); tapping adds a punch on that day.
      return h(
        'div',
        { class: 'prow' },
        h('button', { class: 'pmain missing', type: 'button', onclick: () => openNew(day), 'aria-label': t('add_on_day_aria', { day: shortDate(day) }) }, dir, h('span', { class: 'ptime' }, '…')),
      );
    }
    const e = r.entry;
    return h(
      'div',
      { class: 'prow' },
      h('button', { class: 'pmain', type: 'button', onclick: () => openEdit(e), 'aria-label': r.controls[0].aria }, dir, h('span', { class: 'ptime' }, r.time)),
      r.controls.map((c) =>
        h(
          'button',
          {
            class: ['icon-btn', c.kind === 'delete' && 'del'],
            type: 'button',
            'aria-label': c.aria,
            title: c.aria,
            onclick: () => (c.kind === 'edit' ? openEdit(e) : onListDelete(e, day)),
          },
          icon(c.kind),
        ),
      ),
    );
  });
  return h(
    'li',
    { class: ['pair', b.status] },
    h('div', { class: 'pair-box' }, h('div', { class: 'prows' }, rows), h('span', { class: 'dur' }, b.status === 'open' ? '–' : formatDur(b.dur))),
    b.notes.length ? h('p', { class: 'note' }, b.notes.join(' · ')) : null,
  );
}

/** Bin in the list: confirm with day and time, then tombstone. @param {any} e @param {string} day */
function onListDelete(e, day) {
  if (!state.store) return;
  return deletePunch(state.store, e, longDate(day), { confirm: confirmDialog, toast, message });
}

const loginLink = () => `${location.origin}/#u=${encodeURIComponent(/** @type {string} */ (state.username))}`;
let shownLink = '';

/** Install help: say so when already installed, otherwise open the steps for this device. */
function renderInstallHelp() {
  const installed = matchMedia('(display-mode: standalone)').matches || /** @type {any} */ (navigator).standalone === true;
  $('#o-installed').hidden = !installed;
  $('#install-box').hidden = installed;
  const box = $('#install-box');
  if (installed || box.dataset.opened) return;
  box.dataset.opened = '1';
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) $('#d-install-ios').setAttribute('open', '');
  else if (/Android/.test(ua)) $('#d-install-android').setAttribute('open', '');
}

function renderSettings() {
  renderInstallHelp();
  const st = /** @type {Store} */ (state.store);
  const tgt = input('#i-target');
  if (document.activeElement !== tgt) tgt.value = String(st.settings.weekHours);
  input('#c-nerd').checked = !!st.settings.nerd;
  const bl = buttonLabel(st.settings.button);
  for (const r of $$('input[name=button-label]')) /** @type {HTMLInputElement} */ (r).checked = /** @type {HTMLInputElement} */ (r).value === bl;
  const fv = fxSetting(st.settings.fx);
  for (const r of $$('input[name=punch-fx]')) /** @type {HTMLInputElement} */ (r).checked = /** @type {HTMLInputElement} */ (r).value === fv;
  $('#o-fx-reduced').hidden = !reducedMotion();
  loadFxPics();
  const ds = st.dayStart;
  input('#c-night').checked = ds > 0;
  $('#night-box').hidden = ds === 0;
  const bd = badgeDays(st.settings.badge);
  input('#c-badge').checked = bd > 0;
  $('#badge-box').hidden = bd === 0;
  const bdEl = input('#i-badge-days');
  if (document.activeElement !== bdEl) bdEl.value = String(bd || BADGE_DAYS_DEFAULT);
  const bNext = badgeNextDay(st.settings);
  const bToday = logicalDay(Date.now(), localTz(), st.dayStart);
  $('#o-badge-next').textContent = bd ? (bNext && bNext > bToday ? t('badge_next', { date: longDate(bNext) }) : t('badge_next_now')) : '';
  const dsEl = input('#i-daystart');
  if (document.activeElement !== dsEl) dsEl.value = ds ? minutesToClock(ds) : '04:00';
  /** @type {HTMLSelectElement} */ ($('#s-lang')).value = getLang();
  $('#o-whoami').textContent = t('signed_in_as', { user: /** @type {string} */ (state.username) });
  $('#o-username').textContent = t('your_username', { user: /** @type {string} */ (state.username) });
  input('#i-pass-user').value = /** @type {string} */ (state.username);
  $('#o-punch-link').textContent = punchLink();
  input('#c-linkpunch').checked = !!st.settings.linkPunch;
  const link = loginLink();
  $('#o-login-link').textContent = link;
  if (shownLink !== link + getLang()) {
    fill($('#qr-login'), qrSvg(link, { label: t('qr_login') }));
    shownLink = link + getLang();
  }
  $('#o-about').textContent = t('about_version', { version: APP_VERSION });
}

async function renderNerd() {
  const st = /** @type {Store} */ (state.store);
  const now = Date.now();
  const tz = localTz();
  const today = st.dayOf(now, tz);
  const list = st.list();
  const days = buildDays(list, now, st.dayStart, tz);
  const target = st.settings.weekHours;
  const credits = creditByDay(st.absences(), target);
  const { y, m } = parseDay(today);
  const periods = [
    [t('period_week'), weekStart(today)],
    [t('period_month'), `${y}-${String(m).padStart(2, '0')}-01`],
    // The last 12 months: from the same date a year ago (exclusive) up to and including today.
    [t('period_12m'), addDays(addMonths(today, -12), 1)],
  ];
  // Key figures and heatmap: the last 90 days (default) or everything that is kept (13 months).
  const rangeFrom = state.nerdRange === 'all' ? oldestDay(now, tz) : addDays(today, -89);
  const inRange = days.filter((d) => d.day >= rangeFrom);
  const s = stats(list, inRange);
  const rangeBtn = (/** @type {'90d'|'all'} */ key, /** @type {string} */ label) =>
    h(
      'button',
      {
        type: 'button',
        class: 'seg-btn',
        'aria-pressed': state.nerdRange === key ? 'true' : 'false',
        onclick: () => {
          state.nerdRange = key;
          renderNerd();
        },
      },
      label,
    );
  const fp = await db.kvGet('fingerprint').catch(() => null);
  // Tombstones: deleted punches and deleted absences (an absence is always `del` for old clients).
  const tomb = [...st.entries.values()].filter((e) => (isAbsence(e) ? e.gone : e.del)).length;
  const sample = [...st.raw].pop();
  const saldo = (/** @type {number} */ ms) => (ms >= 0 ? `+${formatDur(ms)}` : formatDur(ms));
  const dl = (/** @type {any[]} */ ...pairs) => h('dl', { class: 'kv' }, pairs);
  const row = (/** @type {string} */ k, /** @type {any} */ v, /** @type {any} */ attrs = {}) => [h('dt', {}, k), h('dd', attrs, v)];

  if (state.tab !== 'nerd') return;
  fill(
    $('#o-nerd'),
    h('h2', {}, t('h_balance')),
    h(
      'div',
      { class: 'cards' },
      periods.map(([label, from]) => {
        const b = balance(days, target, from, today, credits);
        return h(
          'div',
          { class: 'card' },
          h('span', { class: 'label' }, label),
          h('strong', { class: b.diff >= 0 ? 'pos' : 'neg' }, saldo(b.diff)),
          h('span', { class: 'small' }, t('of_target', { worked: formatDur(b.worked + b.credit), target: formatDur(b.target) })),
        );
      }),
    ),
    h('p', { class: 'hint' }, t('balance_hint', { h: num(target) })),

    h('h2', {}, t('h_weekhours')),
    // Bars: worked time plus the absence credit (what counts against the target).
    weekBars(weeklyHours(days, today, 13, credits).map((w) => ({ ...w, sum: w.sum + w.credit })), target),

    h('h2', {}, t('h_monthhours')),
    monthBars(monthlyHours(days, today, RETENTION_MONTHS, target, credits).map((x) => ({ ...x, sum: x.sum + x.credit }))),

    h('div', { class: 'seg seg-buttons', role: 'group', 'aria-label': t('range_label') }, rangeBtn('90d', t('range_90d')), rangeBtn('all', t('range_all'))),
    h('h2', {}, t('h_figures')),
    dl(
      row(t('avg_first'), minutesToClock(s.avgFirst)),
      row(t('avg_last'), minutesToClock(s.avgLast)),
      row(t('longest'), s.longest ? `${shortDate(s.longest.day)} · ${formatDur(s.longest.sum)} h` : '–'),
      row(t('avg_break'), s.avgBreak != null ? tn('break_days', s.breakDays, { dur: formatDur(s.avgBreak) }) : '–'),
      row(t('days_worked'), String(s.workedDays)),
      row(t('stamps_today'), t('of_max', { n: st.countDay(today), max: MAX_PER_DAY })),
    ),

    h('h2', {}, t('h_heat')),
    heatmap(s.heat),

    h('h2', {}, t('h_crypto')),
    dl(
      row(t('fingerprint'), fp || '–', { class: 'mono' }),
      row(t('records'), tn('records_detail', st.raw.size, { del: tomb, set: st.raw.has(SETTINGS_ID) ? t('settings_rec') : '' })),
      st.unreadable ? row(t('unreadable'), String(st.unreadable), { class: 'neg' }) : null,
      row(t('sync_state'), t('sync_no', { n: st.seq })),
      row(t('last_sync'), st.lastSync ? new Date(st.lastSync).toLocaleString(locale()) : '–'),
      row(t('outbox'), t('outbox_detail', { n: st.outbox })),
    ),
    h('p', { class: 'hint' }, t('raw_hint')),
    sample ? h('pre', { class: 'raw' }, `${sample[0]}\n${sample[1]}`) : h('p', { class: 'muted' }, t('no_record')),
    h('div', { class: 'row-buttons' }, h('button', { class: 'btn', type: 'button', onclick: () => st.sync({ force: true }) }, t('send_now'))),
    h('h2', {}, t('h_export')),
    h(
      'div',
      { class: 'row-buttons' },
      h('button', { class: 'btn', type: 'button', onclick: exportCsv }, 'CSV'),
      h('button', { class: 'btn', type: 'button', onclick: exportJson }, 'JSON'),
    ),
  );
}

// ------------------------------------------------------------ punch animation setting

/** The tile drawings of Random (two dice) and Off (a crossed circle), in the scenes' 160 × 80 box. @param {string} v */
function fxIcon(v) {
  const ink = '#2B3238';
  /** A die at (x, y), turned by `deg`, with pips at the given offsets. @param {number} x @param {number} y @param {number} deg @param {string} face @param {number[][]} pips */
  const die = (x, y, deg, face, pips) =>
    svg(
      'g',
      { transform: `rotate(${deg} ${x + 18} ${y + 18})` },
      svg('rect', { x, y, width: 36, height: 36, rx: 7, fill: face, stroke: ink, 'stroke-width': 3.5 }),
      pips.map(([a, b]) => svg('circle', { cx: x + a, cy: y + b, r: 3.2, fill: ink })),
    );
  const kids =
    v === 'off'
      ? [svg('circle', { cx: 80, cy: 40, r: 24, fill: 'none', stroke: ink, 'stroke-width': 6 }), svg('path', { d: 'M63 57 L97 23', stroke: ink, 'stroke-width': 6, 'stroke-linecap': 'round' })]
      : [
          die(40, 22, -12, '#ffffff', [[10, 10], [18, 18], [26, 26]]),
          die(84, 22, 10, '#FF6B4A', [[10, 10], [26, 10], [10, 26], [26, 26]]),
        ];
  return svg('svg', { viewBox: '0 0 160 80', 'aria-hidden': 'true', focusable: 'false' }, kids);
}

/**
 * The «Animation» choice in the settings: a radio group laid out as a grid of small tiles (a still
 * drawing and the name each; Random and Off first; a name breaks only between words or at its soft
 * hyphens). Arrow keys move through it as in any radio group. The chosen one plays once in the
 * larger preview area above (Random plays one of them; with reduced motion only the still is shown).
 * The drawings load with the animation module, the first time the settings are shown.
 */
function bindFxChoice() {
  const box = $('#fx-choices');
  fill(
    box,
    FX_CHOICES.map((v) =>
      h(
        'label',
        { class: 'fx-tile', dataset: { fx: v } },
        h('input', { type: 'radio', name: 'punch-fx', value: v, 'aria-label': plain(t(`fx_${v}`)), 'data-i18n-aria': `fx_${v}` }),
        h('span', { class: 'fx-pic', 'aria-hidden': 'true' }, v === 'random' || v === 'off' ? fxIcon(v) : null),
        // The visible name may carry soft hyphens (see i18n.js SHY); the radio button has the plain one.
        h('span', { class: 'fx-name', 'aria-hidden': 'true', 'data-i18n': `fx_${v}` }, t(`fx_${v}`)),
      ),
    ),
  );
  box.addEventListener('change', (e) => {
    const el = /** @type {HTMLInputElement} */ (e.target);
    if (!el.checked || el.name !== 'punch-fx') return;
    const v = fxSetting(el.value);
    state.store?.saveSettings({ fx: v });
    void showFx(v, true);
  });
}

/** @type {Promise<any> | null} */
let fxPics = null;
/** @type {string | null} */
let fxShown = null;

/** The tiles' still drawings and the preview of the current choice, once (lazy: the animation module). */
function loadFxPics() {
  if (fxPics) return;
  const time = timeOfDay(Date.now(), localTz());
  fxPics = import('./punchfx.js').then(
    (m) => {
      for (const v of FX_NAMES)
        void m.still(v, { time }).then((/** @type {Element | null} */ el) => {
          const pic = $(`.fx-tile[data-fx="${v}"] .fx-pic`);
          if (el && pic) pic.replaceChildren(el);
        });
      void showFx(fxSetting(state.store?.settings.fx), false);
      return m;
    },
    () => {
      fxPics = null; // try again next time
    },
  );
}

/**
 * Fill the preview area: the still of `v`, or (`play`, not with reduced motion) play it once.
 * @param {string} v one of FX_CHOICES @param {boolean} play
 */
async function showFx(v, play) {
  const area = $('#fx-show');
  if (!area) return;
  try {
    const m = await (fxPics || import('./punchfx.js'));
    if (!m) return;
    const time = timeOfDay(Date.now(), localTz());
    if (v === 'off' || (v === 'random' && !(play && !reducedMotion()))) {
      m.cancelPreview();
      area.replaceChildren(fxIcon(v));
      return;
    }
    const name = v === 'random' ? /** @type {string} */ (pickFx('random', fxShown)) : v;
    fxShown = name;
    if (play && !reducedMotion()) m.preview(name, area, { time });
    else {
      m.cancelPreview();
      const el = await m.still(name, { time });
      if (el) area.replaceChildren(el);
    }
  } catch {
    /* decoration only */
  }
}

// ------------------------------------------------------------ editing

/** Minutes after midnight at which the logical day changes (night shifts), 0 = midnight. */
const dayStartNow = () => state.store?.dayStart || 0;

/** @param {any} e */
function openEdit(e) {
  const tz = e.tz || DEFAULT_TZ;
  // The date field holds the logical day (as in the list); the calendar date is shown below it.
  const opened = { day: state.store ? state.store.dayOf(e.ts, tz) : dayKey(e.ts, tz), time: timeOfDay(e.ts, tz) };
  state.editing = { id: e.id, entry: e, isNew: false, opened };
  fillEditDialog(opened.day, opened.time, e.note || '', false);
}

/** New single punch on a logical day (default: today). @param {string} [day] */
function openNew(day) {
  state.editing = { id: newId(), entry: { tz: localTz(), note: '', del: false }, isNew: true, opened: null };
  fillEditDialog(day || (state.store ? state.store.dayOf(Date.now()) : dayKey(Date.now(), localTz())), '', '', true);
}

/** With night shifts: show which calendar date the entered time lands on. */
function updateRealDate() {
  const el = $('#o-erealdate');
  const ds = dayStartNow();
  const day = input('#i-edate').value;
  const time = input('#i-etime').value;
  if (!ds || !/^\d{4}-\d{2}-\d{2}$/.test(day) || clockToMinutes(time) == null) {
    el.hidden = true;
    return;
  }
  el.textContent = t('real_date', { date: shortDate(calendarDate(day, time, ds)) });
  el.hidden = false;
}

/** The two wheel columns of the time picker; the value itself lives in the hidden #i-etime ("HH:MM"). */
/** @type {null | { hh: ReturnType<typeof createWheel>, mm: ReturnType<typeof createWheel> }} */
let wheels = null;

function timeWheels() {
  if (wheels) return wheels;
  const p2 = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const sync = () => {
    if (!wheels) return;
    input('#i-etime').value = `${p2(wheels.hh.value)}:${p2(wheels.mm.value)}`;
    updateRealDate();
  };
  wheels = {
    hh: createWheel({ min: 0, max: 23, label: t('hours'), onChange: sync }),
    mm: createWheel({ min: 0, max: 59, label: t('minutes'), onChange: sync }),
  };
  fill($('#wheel-time'), wheels.hh.el, h('span', { class: 'wheel-colon', 'aria-hidden': 'true' }, ':'), wheels.mm.el);
  return wheels;
}

/** @param {string} day @param {string} time "HH:MM", empty = now @param {string} note @param {boolean} isNew */
function fillEditDialog(day, time, note, isNew) {
  if (!time) time = timeOfDay(Date.now(), localTz());
  $('#dlg-edit-title').textContent = isNew ? t('add_title') : t('edit_title');
  const dateEl = input('#i-edate');
  dateEl.value = day;
  dateEl.min = oldestLogicalDay(Date.now(), localTz(), dayStartNow());
  dateEl.max = state.store ? state.store.dayOf(Date.now()) : dayKey(Date.now(), localTz());
  input('#i-etime').value = time;
  input('#i-enote').value = note;
  updateRealDate();
  const del = /** @type {HTMLButtonElement} */ ($('#b-edel'));
  del.hidden = isNew;
  del.textContent = t('delete');
  del.dataset.armed = '';
  setError('e-edit', null);
  const w = timeWheels();
  w.hh.el.setAttribute('aria-label', t('hours'));
  w.mm.el.setAttribute('aria-label', t('minutes'));
  /** @type {HTMLDialogElement} */ ($('#dlg-edit')).showModal();
  // After showModal: the columns need their layout to scroll to the value.
  const [hh, mm] = time.split(':').map(Number);
  w.hh.set(hh);
  w.mm.set(mm);
  // The picker gets the focus, not the note: no on-screen keyboard over the wheels.
  w.hh.el.focus({ preventScroll: true });
}


/** @param {object} entry */
function noteFits(entry) {
  return jsonSize({ ...entry, v: 1, mod: Date.now() }) <= PLAINTEXT_SIZE;
}

/** @param {number} ts */
const tooOld = (ts) => isExpired({ ts }, Date.now(), localTz(), dayStartNow());

async function onEditSubmit(/** @type {SubmitEvent} */ ev) {
  ev.preventDefault();
  const ed = state.editing;
  if (!ed || !state.store) return;
  const tz = ed.entry.tz || localTz();
  // A wheel still moving stops at the row under the centre line; the hidden field follows at once.
  if (wheels) {
    wheels.hh.commit();
    wheels.mm.commit();
  }
  // Unchanged date and time keep the original timestamp (a repeated hour must not move by an hour).
  const ts = editedTs(ed.isNew ? null : ed.entry, ed.opened, input('#i-edate').value, input('#i-etime').value, tz, dayStartNow());
  const note = input('#i-enote').value.trim();
  if (ts == null) return setError('e-edit', t('err_date'));
  if (ts > Date.now() + 60_000) return setError('e-edit', t('err_future'));
  if (tooOld(ts)) return setError('e-edit', t('err_too_old'));
  const { t: _legacy, ...rest } = ed.entry;
  const next = { ...rest, ts, tz, note, del: false };
  if (!noteFits(next)) return setError('e-edit', t('err_note'));
  try {
    await state.store.write(ed.id, next);
    /** @type {HTMLDialogElement} */ ($('#dlg-edit')).close();
    state.editing = null;
    toast(ed.isNew ? t('added') : t('saved'));
  } catch (err) {
    setError('e-edit', message(err));
  }
}

async function onEditDelete() {
  const btn = /** @type {HTMLButtonElement} */ ($('#b-edel'));
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.textContent = t('really_delete');
    return;
  }
  const ed = state.editing;
  if (!ed || !state.store) return;
  try {
    await state.store.remove(ed.id);
  } catch (err) {
    return setError('e-edit', message(err));
  }
  /** @type {HTMLDialogElement} */ ($('#dlg-edit')).close();
  state.editing = null;
  toast(t('deleted'));
}

// ------------------------------------------------------------ absences

/** A from–until range covers at most this many weeks (one record per weekday, see the server's daily write budget). */
const ABSENCE_MAX_WEEKS = 6;

/** Open the absence dialog for a logical day (default: today). @param {string} [day] */
function openAbsence(day) {
  const st = state.store;
  if (!st) return;
  const today = st.dayOf(Date.now());
  const from = input('#i-abs-from');
  const to = input('#i-abs-to');
  from.min = to.min = oldestLogicalDay(Date.now(), localTz(), st.dayStart);
  from.max = to.max = addDays(today, ABSENCE_AHEAD_DAYS);
  from.value = day || today;
  to.value = '';
  input('#i-abs-note').value = '';
  input('#c-abs-half').checked = false;
  $('#o-abs-range').textContent = t('absence_range_hint', { weeks: ABSENCE_MAX_WEEKS, days: ABSENCE_AHEAD_DAYS });
  const whole = absenceCredit({ day: '2026-01-05', half: false }, st.settings.weekHours); // any Monday
  $('#o-abs-credit').textContent = t('absence_credit', { dur: formatDur(whole), half: formatDur(Math.round(whole / 2)) });
  updateAbsenceForm();
  setError('e-absence', null);
  /** @type {HTMLDialogElement} */ ($('#dlg-absence')).showModal();
}

/** A half day only for a single day. */
function updateAbsenceForm() {
  const from = input('#i-abs-from').value;
  const to = input('#i-abs-to').value;
  const range = !!to && to !== from;
  const half = input('#c-abs-half');
  half.disabled = range;
  if (range) half.checked = false;
}

async function onAbsenceSubmit(/** @type {SubmitEvent} */ ev) {
  ev.preventDefault();
  const st = state.store;
  if (!st) return;
  const from = input('#i-abs-from').value;
  const to = input('#i-abs-to').value;
  const type = /** @type {HTMLSelectElement} */ ($('#s-abs-type')).value;
  const half = input('#c-abs-half').checked;
  const note = input('#i-abs-note').value.trim();
  const today = st.dayOf(Date.now());
  const oldest = oldestLogicalDay(Date.now(), localTz(), st.dayStart);
  if (!isDayKey(from) || (to && !isDayKey(to))) return setError('e-absence', t('err_date'));
  if (to && to < from) return setError('e-absence', t('err_range'));
  if (to && daysBetween(from, to) >= ABSENCE_MAX_WEEKS * 7) return setError('e-absence', t('err_range_long', { weeks: ABSENCE_MAX_WEEKS }));
  if (from < oldest) return setError('e-absence', t('err_too_old'));
  if ((to || from) > addDays(today, ABSENCE_AHEAD_DAYS)) return setError('e-absence', t('err_abs_future', { n: ABSENCE_AHEAD_DAYS }));
  if (!noteFits({ kind: 'absence', day: from, type, half, note, ts: Date.now(), tz: localTz(), del: true, gone: false })) return setError('e-absence', t('err_note'));
  const days = absenceDays(from, to);
  if (days.length === 1) {
    // One day: say exactly why it cannot be added.
    try {
      await st.addAbsence({ day: days[0], type, half, note });
    } catch (err) {
      return setError('e-absence', message(err));
    }
    /** @type {HTMLDialogElement} */ ($('#dlg-absence')).close();
    toast(tn('absence_added', 1));
    return;
  }
  // A range: one record per weekday; days that already have an absence or are full are skipped.
  let added = 0;
  let skipped = 0;
  for (const day of days) {
    if (st.absencesOn(day).length || st.dayRecords(day) >= MAX_PER_DAY) {
      skipped++;
      continue;
    }
    try {
      await st.addAbsence({ day, type, half: false, note });
      added++;
    } catch (err) {
      /** @type {HTMLDialogElement} */ ($('#dlg-absence')).close();
      toast(`${tn('absence_added', added)} ${message(err)}`);
      return;
    }
  }
  /** @type {HTMLDialogElement} */ ($('#dlg-absence')).close();
  toast(skipped ? `${tn('absence_added', added)} ${tn('absence_skipped', skipped)}` : tn('absence_added', added));
}

// ------------------------------------------------------------ week and month sheets

/** @type {null | { kind: 'week'|'month', from: string, to: string }} the sheet on screen */
let printing = null;

const sheetKind = () => /** @type {'week'|'month'} */ ((/** @type {HTMLInputElement | null} */ ($('input[name=sheet-kind]:checked')))?.value === 'month' ? 'month' : 'week');

/** Fill the period choice: weeks or months from now (or a later planned absence) back to the retention bound. */
function fillSheetPeriods() {
  const st = state.store;
  if (!st) return;
  const now = Date.now();
  const today = st.dayOf(now);
  const sel = /** @type {HTMLSelectElement} */ ($('#s-sheet-period'));
  const opts = periodOptions(sheetKind(), today, oldestLogicalDay(now, localTz(), st.dayStart));
  fill(sel, opts.map((o) => h('option', { value: `${o.from}|${o.to}` }, o.label)));
  sel.selectedIndex = 0;
}

function openSheetDialog() {
  if (!state.store) return;
  fillSheetPeriods();
  /** @type {HTMLDialogElement} */ ($('#dlg-sheet')).showModal();
}

/** Draw the chosen sheet into the print view (also after a language change or new data). */
function renderPrint() {
  const st = state.store;
  if (!st || !printing) return;
  const now = Date.now();
  const tz = localTz();
  const weekHours = st.settings.weekHours;
  const days = withAbsences(buildDays(st.list(), now, st.dayStart, tz), st.absences(), weekHours);
  const today = st.dayOf(now, tz);
  const sheet = periodSheet(days, printing.from, printing.to, today, weekHours);
  fill($('#o-print'), renderSheet(sheet, { kind: printing.kind, username: /** @type {string} */ (state.username), weekHours, dayStart: st.dayStart, today }));
}

function onSheetSubmit(/** @type {SubmitEvent} */ ev) {
  ev.preventDefault();
  const [from, to] = /** @type {HTMLSelectElement} */ ($('#s-sheet-period')).value.split('|');
  if (!isDayKey(from) || !isDayKey(to)) return;
  printing = { kind: sheetKind(), from, to };
  /** @type {HTMLDialogElement} */ ($('#dlg-sheet')).close();
  show('print');
  renderPrint();
}

// ------------------------------------------------------------ export

const stamp = () => dayKey(Date.now(), localTz());

function exportCsv() {
  const st = /** @type {Store} */ (state.store);
  const weekHours = st.settings.weekHours;
  // Absences get their own row (first on their day) and the two last columns; punch rows leave them empty.
  const rows = [[t('csv_date'), t('csv_cal_date'), t('csv_time'), t('csv_tz'), t('csv_note'), t('csv_dir'), t('csv_day_total'), t('csv_absence'), t('csv_credit')]];
  for (const d of withAbsences(buildDays(st.list(), Date.now(), st.dayStart, localTz()), st.absences(), weekHours).reverse()) {
    for (const a of d.absences || []) rows.push([d.day, d.day, '', a.tz || DEFAULT_TZ, a.note || '', '', '', absenceLabel(a), formatDur(absenceCredit(a, weekHours))]);
    d.punches.forEach((p, i) => {
      const tz = p.tz || DEFAULT_TZ;
      const last = i === d.punches.length - 1;
      rows.push([d.day, dayKey(p.ts, tz), timeOfDay(p.ts, tz), tz, p.note || '', i % 2 === 0 ? t('dir_in') : t('dir_out'), last ? formatDur(d.sum) : '', '', '']);
    });
  }
  download(`${FILE_PREFIX}-${stamp()}.csv`, 'text/csv;charset=utf-8', '\ufeff' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n');
}

function exportJson() {
  const st = /** @type {Store} */ (state.store);
  const list = st.list();
  const dir = directions(list, st.dayStart);
  const punches = [...list]
    .sort((a, b) => a.ts - b.ts)
    .map((e) => ({ id: e.id, ts: e.ts, iso: new Date(e.ts).toISOString(), tz: e.tz, note: e.note || '', dir: dir.get(e.id) }));
  const weekHours = st.settings.weekHours;
  const absences = st.absences().map((a) => ({ id: a.id, day: a.day, type: a.type, half: !!a.half, note: a.note || '', creditMs: absenceCredit(a, weekHours) }));
  const days = withAbsences(buildDays(list, Date.now(), st.dayStart, localTz()), st.absences(), weekHours)
    .reverse()
    .map((d) => ({ day: d.day, punches: d.punches.length, totalMs: d.sum, creditMs: d.credit || 0, open: d.open }));
  download(
    `${FILE_PREFIX}-${stamp()}.json`,
    'application/json',
    JSON.stringify({ format: 'zeropunch-export', v: 3, created: new Date().toISOString(), settings: st.settings, punches, absences, days }, null, 2),
  );
}

// ------------------------------------------------------------ account

/** @param {boolean} [serverPending] the server session could not be ended (offline): end it later */
async function leaveDevice(serverPending = false) {
  await db.wipe().catch(() => {});
  if (serverPending) await db.kvSet(LOGOUT_PENDING, true).catch(() => {});
  tabs?.post({ type: 'wipe' });
  location.replace('/');
}

async function onLogout(/** @type {boolean} */ all) {
  const st = state.store;
  if (st) await st.sync({ force: true });
  if (st && st.unsynced > 0) {
    const ok = await confirmDialog(t('unsynced_title'), tn('unsynced_text', st.unsynced), { ok: t('logout_anyway') });
    if (!ok) return;
  }
  if (all) {
    const ok = await confirmDialog(t('logout_all_title'), t('logout_all_text'), { ok: t('logout_all_ok') });
    if (!ok) return;
  }
  let pending = false;
  try {
    await (all ? api.logoutAll() : api.logout());
  } catch (e) {
    if (all) {
      toast(message(e));
      return;
    }
    // Offline: the device is cleared now; the server session is ended at the next chance.
    pending = e instanceof api.OfflineError;
  }
  await leaveDevice(pending);
}

async function onDeleteAccount() {
  const username = state.username;
  if (!username) return;
  // The typed word and the passphrase: the server deletes only with proof of the passphrase (the
  // same value as at login), so an open, unlocked device alone is not enough.
  const ok = await confirmDialog(t('delete_title'), t('delete_text'), {
    ok: t('delete_ok'),
    word: t('delete_word'),
    pass: true,
    submit: async (pass) => {
      try {
        await deleteAccountWith({}, username, pass);
        return null;
      } catch (e) {
        return isWrongAuth(e) ? t('err_current_pass') : message(e);
      }
    },
  });
  if (!ok) return;
  await leaveDevice();
}

// ------------------------------------------------------------ service worker

/** Load a new app version that is waiting, if nothing is under way now (set by registerServiceWorker). */
let reloadWhenIdle = () => {};

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const isUpdate = controllerWatch(!!navigator.serviceWorker.controller);
  /** @type {ServiceWorkerRegistration | null} */
  let reg = null;
  let lastCheck = Date.now();
  navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((r) => (reg = r))
    .catch(() => {});
  // An installed app stays open for days and never loads the page again, so the browser never looks
  // for a new version by itself: ask when the app comes back to the front, at most once a day.
  const check = () => {
    if (!reg || document.visibilityState !== 'visible' || Date.now() - lastCheck < 24 * 3600_000) return;
    lastCheck = Date.now();
    reg.update().catch(() => {});
  };
  document.addEventListener('visibilitychange', check);
  setInterval(check, 3600_000); // an app left open in the front for days

  // The new version is active: load it at once when nothing is being typed, confirmed or punched,
  // otherwise offer «Reload» and load it at the next quiet moment (back in front, a sync done, the
  // punch sent).
  let waiting = false;
  const busy = () => {
    const a = /** @type {HTMLElement | null} */ (document.activeElement);
    const st = state.store;
    return reloadBlocked({
      dialogOpen: !!document.querySelector('dialog[open]'),
      typing: !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName),
      linkPunch: pendingPunchLink || linkPunchRunning,
      syncing: !!st?.syncing,
      cooldown: $('#b-punch').dataset.cooldown === '1',
      outbox: st ? st.outbox : 0,
    });
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // A page loaded without a controller: its first change is the worker taking it, not an update.
    if (!isUpdate()) return;
    if (!busy()) return location.reload();
    waiting = true;
    toast(t('new_version'), { label: t('reload'), fn: () => location.reload() });
  });
  reloadWhenIdle = () => {
    if (waiting && document.visibilityState === 'visible' && !busy()) location.reload();
  };
  document.addEventListener('visibilitychange', () => reloadWhenIdle());
}

// ------------------------------------------------------------ events

/** @param {string} id @param {(e: SubmitEvent) => any} fn */
const onSubmit = (id, fn) => $(id).addEventListener('submit', /** @type {any} */ (fn));

function bindEvents() {
  $('#b-show-login').addEventListener('click', () => showLogin('login'));
  $('#b-show-register').addEventListener('click', () => showLogin('register'));
  $('#b-login-back').addEventListener('click', () => {
    if (state.reauth && state.store) {
      state.reauth = false;
      show(state.tab);
      void askLinkPunch();
    } else showLogin('intro');
  });
  $('#b-register-back').addEventListener('click', () => showLogin('intro'));
  onSubmit('#f-login', onLogin);
  onSubmit('#f-register', onRegister);

  for (const b of $$('#tabs button')) b.addEventListener('click', () => show(/** @type {string} */ (b.dataset.tab)));

  // Short passphrases are allowed from MIN_PASSPHRASE on; below WEAK_PASSPHRASE the form warns while typing.
  for (const [inp, warn] of [['#i-reg-pass1', '#w-reg-pass'], ['#i-pnew1', '#w-pnew']]) {
    const el = input(inp);
    const upd = () => {
      const n = el.value.length;
      $(warn).hidden = !(n > 0 && n < WEAK_PASSPHRASE);
    };
    el.addEventListener('input', upd);
    el.form?.addEventListener('reset', () => setTimeout(upd));
  }
  bindDayView();
  $('#b-punch').addEventListener('click', () => void doPunch());
  // A punch link opened while the app is already running (e.g. an installed app on Android).
  window.addEventListener('hashchange', () => {
    if (!takePunchLink()) return;
    if (state.store && MAIN_TABS.includes(/** @type {string} */ ($('#app').dataset.view))) void askLinkPunch();
  });
  input('#c-linkpunch').addEventListener('change', (e) => state.store?.saveSettings({ linkPunch: /** @type {HTMLInputElement} */ (e.target).checked }));
  $('#b-copy-punch-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(punchLink());
      toast(t('link_copied'));
    } catch {
      toast(t('copy_failed'));
    }
  });

  $('#o-openday').addEventListener('click', () => show('list'));
  // A tap on the status means «sync now».
  $('#b-sync').addEventListener('click', () => state.store?.sync({ force: true }));
  $('#b-reauth').addEventListener('click', () => {
    state.reauth = true;
    showLogin('login');
  });

  $('#b-add').addEventListener('click', () => openNew());
  $('#b-absence').addEventListener('click', () => openAbsence());
  onSubmit('#f-absence', onAbsenceSubmit);
  $('#b-abs-cancel').addEventListener('click', () => /** @type {HTMLDialogElement} */ ($('#dlg-absence')).close());
  $('#i-abs-from').addEventListener('input', updateAbsenceForm);
  $('#i-abs-to').addEventListener('input', updateAbsenceForm);
  $('#b-sheet').addEventListener('click', openSheetDialog);
  onSubmit('#f-sheet', onSheetSubmit);
  $('#b-sheet-cancel').addEventListener('click', () => /** @type {HTMLDialogElement} */ ($('#dlg-sheet')).close());
  for (const r of $$('input[name=sheet-kind]')) r.addEventListener('change', fillSheetPeriods);
  $('#b-print').addEventListener('click', () => window.print());
  $('#b-print-back').addEventListener('click', () => {
    printing = null;
    show('list');
    void askLinkPunch(); // a sticker touched while the sheet was shown
  });
  $('#i-edate').addEventListener('input', updateRealDate);
  $('#b-away-ok').addEventListener('click', () => /** @type {HTMLDialogElement} */ ($('#dlg-away')).close());
  onSubmit('#f-edit', onEditSubmit);
  $('#b-edel').addEventListener('click', onEditDelete);
  $('#b-ecancel').addEventListener('click', () => /** @type {HTMLDialogElement} */ ($('#dlg-edit')).close());

  $('#i-target').addEventListener('change', (e) => {
    // Empty or unparseable input is an error, never 0.
    const v = parseHours(/** @type {HTMLInputElement} */ (e.target).value);
    if (v != null) state.store?.saveSettings({ weekHours: v });
    else toast(t('err_number'));
  });
  $('#f-target').addEventListener('submit', (e) => e.preventDefault());
  $('#s-lang').addEventListener('change', (e) => {
    setLang(/** @type {'en'|'de'} */ (/** @type {HTMLSelectElement} */ (e.target).value), true);
    applyLanguage();
    render();
  });
  input('#c-night').addEventListener('change', (e) => {
    const on = /** @type {HTMLInputElement} */ (e.target).checked;
    state.store?.saveSettings({ dayStart: on ? 240 : 0 }); // 04:00 when switched on
  });
  // Badge reminder: switching it on starts the count today, so the first note comes after the interval.
  input('#c-badge').addEventListener('change', (e) => {
    const on = /** @type {HTMLInputElement} */ (e.target).checked;
    const st = state.store;
    if (!st) return;
    st.saveSettings(on ? { badge: badgeDays(input('#i-badge-days').value) || BADGE_DAYS_DEFAULT, badgeAt: logicalDay(Date.now(), localTz(), st.dayStart) } : { badge: 0 });
  });
  $('#i-badge-days').addEventListener('change', (e) => {
    const n = badgeDays(/** @type {HTMLInputElement} */ (e.target).value);
    if (n && state.store && badgeDays(state.store.settings.badge)) state.store.saveSettings({ badge: n });
  });
  $('#i-daystart').addEventListener('change', (e) => {
    const m = /^(\d{2}):(\d{2})$/.exec(/** @type {HTMLInputElement} */ (e.target).value);
    if (m) state.store?.saveSettings({ dayStart: Number(m[1]) * 60 + Number(m[2]) });
  });
  for (const r of $$('input[name=button-label]')) {
    r.addEventListener('change', (e) => {
      const el = /** @type {HTMLInputElement} */ (e.target);
      if (el.checked) state.store?.saveSettings({ button: buttonLabel(el.value) });
    });
  }
  bindFxChoice();
  $('#b-rej-retry').addEventListener('click', () => state.store?.retryRejected());
  $('#b-rej-discard').addEventListener('click', async () => {
    const st = state.store;
    if (!st) return;
    const ok = await confirmDialog(t('rejected_discard_title'), tn('rejected_discard_text', st.rejected), { ok: t('rejected_discard') });
    if (ok) await st.discardRejected();
  });
  input('#c-nerd').addEventListener('change', (e) => state.store?.saveSettings({ nerd: /** @type {HTMLInputElement} */ (e.target).checked }));
  $('#b-csv').addEventListener('click', exportCsv);
  $('#b-json').addEventListener('click', exportJson);
  $('#b-copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(loginLink());
      toast(t('link_copied'));
    } catch {
      toast(t('copy_failed'));
    }
  });
  onSubmit('#f-pass', onPassChange);
  $('#b-logout').addEventListener('click', () => onLogout(false));
  $('#b-logout-all').addEventListener('click', () => onLogout(true));
  $('#b-delete').addEventListener('click', onDeleteAccount);
}

boot().catch(() => {
  showLogin('intro');
  setError('e-intro', t('err_boot'));
});
