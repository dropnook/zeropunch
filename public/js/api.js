// Thin wrapper around fetch. Cookies are HttpOnly and same-origin.

export class ApiError extends Error {
  /** @param {number} status @param {any} body */
  constructor(status, body) {
    super((body && body.error) || `http_${status}`);
    this.status = status;
    this.body = body;
  }
}

export class OfflineError extends Error {
  constructor() {
    super('offline');
  }
}

/** Called once when the server says the account was deleted (410 on an authenticated call). @type {null | (() => void)} */
let goneHandler = null;
/** @param {null | (() => void)} fn */
export const onAccountGone = (fn) => {
  goneHandler = fn;
};

/** @param {ApiError} e */
export const isAccountGone = (e) => e instanceof ApiError && e.status === 410 && e.body?.error === 'account_deleted';

/**
 * A request without an answer after this long is given up and counts as offline (a hanging request
 * would otherwise hold every later sync and settings change until a reload). Every call is a small
 * JSON exchange; the slow parts (key derivation, proof of work) run on the device, before the request.
 */
export const REQUEST_TIMEOUT = 20_000;

/**
 * @param {string} method @param {string} path @param {any} [body]
 * @param {{ quiet?: boolean, timeout?: number }} [opt] quiet: a 410 does not call the «account gone»
 * handler (used for the delayed server logout of a device that has already been cleared)
 */
export async function api(method, path, body, opt = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opt.timeout ?? REQUEST_TIMEOUT);
  /** @type {RequestInit} */
  const init = { method, credentials: 'same-origin', cache: 'no-store', headers: {}, signal: ctl.signal };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let res;
  let data = null;
  try {
    try {
      res = await fetch(path, init);
    } catch {
      throw new OfflineError();
    }
    try {
      data = await res.json();
    } catch {
      if (ctl.signal.aborted) throw new OfflineError(); // the answer stopped halfway
    }
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const e = new ApiError(res.status, data);
    if (isAccountGone(e) && goneHandler && !opt.quiet) goneHandler();
    throw e;
  }
  return data;
}

/** @param {'register'|'login'} [purpose] */
export const challenge = (purpose = 'register') => api('GET', purpose === 'login' ? '/api/auth/challenge?for=login' : '/api/auth/challenge');
export const register = (/** @type {any} */ body) => api('POST', '/api/auth/register', body);
/** @param {string} username @param {string} auth @param {{challenge: string, nonce: string}} [pow] */
export const login = (username, auth, pow) => api('POST', '/api/auth/login', pow ? { username, auth, pow } : { username, auth });
export const changePassphrase = (/** @type {any} */ body) => api('POST', '/api/auth/passphrase', body);
/** @param {{ quiet?: boolean }} [opt] */
export const logout = (opt = {}) => api('POST', '/api/auth/logout', {}, opt);
export const logoutAll = () => api('POST', '/api/auth/logout-all', {});
export const getKeys = () => api('GET', '/api/keys');
export const getRecords = (/** @type {number} */ since) => api('GET', `/api/records?since=${since}`);
export const putRecord = (/** @type {string} */ id, /** @type {string} */ data) => api('PUT', `/api/records/${id}`, { data });
export const deleteRecord = (/** @type {string} */ id) => api('DELETE', `/api/records/${id}`, {});
/** @param {string} auth the same value as at login (proof of the passphrase) */
export const deleteAccount = (auth) => api('DELETE', '/api/account', { auth });
