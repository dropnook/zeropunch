// Small decisions of the app shell (app.js), kept free of the DOM so the unit tests can check them.

import * as realApi from './api.js';
import { passphraseKeys } from './crypto.js';

/**
 * Delete the account: the server wants proof of the passphrase, the same `auth` value as at login
 * (derived here from username + passphrase; the passphrase itself never leaves the device).
 * Throws the server's answer: 400 wrong_auth for a wrong passphrase (isWrongAuth), 429 when too many
 * wrong tries were made.
 * @param {{ api?: { deleteAccount: (auth: string) => Promise<any> }, keys?: (u: string, p: string) => Promise<{ auth: string }> }} deps
 * @param {string} username @param {string} passphrase
 */
export async function deleteAccountWith(deps, username, passphrase) {
  const api = deps.api || realApi;
  const keys = deps.keys || passphraseKeys;
  const k = await keys(username, passphrase);
  return api.deleteAccount(k.auth);
}

/** The server says the passphrase does not match. @param {any} e */
export const isWrongAuth = (e) => !!e && e.status === 400 && e.body?.error === 'wrong_auth';

/**
 * A new app version is ready: may the page reload now? Not while something is typed or confirmed,
 * and not while a punch is under way: a punch link waiting or running, a sync running, the punch
 * button's short lock, or records still waiting to be sent.
 * @param {{ dialogOpen: boolean, typing: boolean, linkPunch: boolean, syncing: boolean, cooldown: boolean, outbox: number }} s
 */
export function reloadBlocked(s) {
  return s.dialogOpen || s.typing || s.linkPunch || s.syncing || s.cooldown || s.outbox > 0;
}

/**
 * The service worker's controllerchange: on a page loaded without a controller, the first one is the
 * new worker taking the page (clients.claim), not a new version; every later one is an update.
 * Returns a function that says, per event, whether it is an update.
 * @param {boolean} hadController
 */
export function controllerWatch(hadController) {
  let claim = !hadController;
  return () => {
    if (claim) {
      claim = false;
      return false;
    }
    return true;
  };
}

/**
 * Punch link with «without asking» switched on: punch at once only when the page was opened directly
 * (no referrer: NFC sticker, home-screen shortcut, typed address). A link followed from a web page or
 * a mail carries a referrer, so it asks «Punch now?» like without the setting. Best effort: a page can
 * hide its referrer (rel=noreferrer, Referrer-Policy), then this cannot tell the difference.
 * @param {boolean} withoutAsking settings.linkPunch @param {string} referrer document.referrer
 */
export const linkPunchAsks = (withoutAsking, referrer) => !withoutAsking || !!referrer;

/**
 * May the tab a punch link opened close itself now? Only after a punch was made by that link with
 * «without asking», when nothing waits to be sent and no dialog (e.g. the badge reminder) is open,
 * and the tab holds nothing but this one page.
 * @param {{ opened: boolean, linkPunch: boolean, outbox: number, dialogOpen: boolean, historyLength: number }} s
 */
export function mayCloseLinkTab(s) {
  return s.opened && s.linkPunch && s.outbox === 0 && !s.dialogOpen && s.historyLength <= 1;
}
