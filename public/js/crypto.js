// Encryption in the browser. WebCrypto only, no dependencies.
//
// Master key (MK): 32 random bytes. It exists as bytes only briefly: when the account is created
// and when the passphrase is re-wrapped. On the device it lives as a non-extractable CryptoKey
// (created directly by unwrapKey) in IndexedDB.
//
// Passphrase → PBKDF2-SHA-256(salt = SHA-256("zeropunch kdf v1|" + username), 600 000) → HKDF into
//   authKey (sent to the server to log in) and wrapKey (wraps the MK, never leaves the device).
// There is no second way in: without the passphrase the MK cannot be unwrapped. (Accounts from
// before 2.4 also had a `rec` wrapping under a recovery key; the server drops it, nothing here reads it.)

const enc = new TextEncoder();
const dec = new TextDecoder();

export const PBKDF2_ITERATIONS = 600_000;
export const PLAINTEXT_SIZE = 256;
export const USERNAME = /^[a-z0-9._-]{3,32}$/;
export const MIN_PASSPHRASE = 6;
/** Shorter than this is accepted, but the app warns: easy to guess for someone who knows the username. */
export const WEAK_PASSPHRASE = 10;
export const FORMAT = 1;

// ------------------------------------------------------------ encoding

/** @param {Uint8Array} bytes */
export function b64u(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} s */
export function unb64u(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** @param {Uint8Array} bytes */
export function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** @param {number} n */
export function random(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** 128-bit record id as hex. */
export function newId() {
  return hex(random(16));
}

/** Fixed id of the settings record. */
export const SETTINGS_ID = '0'.repeat(32);

// ------------------------------------------------------------ keys

/** @param {unknown} u */
export function normalizeUsername(u) {
  if (typeof u !== 'string') return null;
  const s = u.trim().toLowerCase();
  return USERNAME.test(s) ? s : null;
}

/** AAD of the passphrase wrapping (the kind «pass» is part of it since 1.0). @param {string} username */
const wrapAad = (username) => enc.encode(`zeropunch${FORMAT}|key|pass|${username}`);

/** @param {string} username @param {string} id */
export const recordAad = (username, id) => enc.encode(`zeropunch${FORMAT}|rec|${username}|${id}`);

/** @param {string} username */
async function kdfSalt(username) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`zeropunch kdf v1|${username}`)));
}

/**
 * Split key material into two independent keys with HKDF.
 * @param {Uint8Array} ikm @param {Uint8Array} salt @param {string} infoAuth @param {string} infoWrap
 * @returns {Promise<{ auth: string, wrapKey: CryptoKey }>}
 */
async function split(ikm, salt, infoAuth, infoWrap) {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const auth = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(infoAuth) }, base, 256),
  );
  const wrapKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(infoWrap) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt', 'unwrapKey'],
  );
  return { auth: b64u(auth), wrapKey };
}

/**
 * Passphrase → { auth (base64url, for the server), wrapKey (stays here) }.
 * @param {string} username normalised @param {string} passphrase @param {number} [iterations]
 */
export async function passphraseKeys(username, passphrase, iterations = PBKDF2_ITERATIONS) {
  const salt = await kdfSalt(username);
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256));
  try {
    return await split(bits, salt, 'zeropunch auth v1', 'zeropunch wrap v1');
  } finally {
    bits.fill(0);
  }
}

/** @param {Uint8Array} raw @param {CryptoKey} kek @param {Uint8Array} aad */
async function wrapRaw(raw, kek, aad) {
  const iv = random(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, kek, raw));
  return { iv: b64u(iv), ct: b64u(ct) };
}

/** Unwrap straight into a non-extractable key. @param {{iv: string, ct: string}} w @param {CryptoKey} kek @param {Uint8Array} aad */
function unwrapToKey(w, kek, aad) {
  return crypto.subtle.unwrapKey(
    'raw',
    unb64u(w.ct),
    kek,
    { name: 'AES-GCM', iv: unb64u(w.iv), additionalData: aad },
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Unwrap as bytes (only for re-wrapping; the caller zeroes them). @param {{iv: string, ct: string}} w @param {CryptoKey} kek @param {Uint8Array} aad */
async function unwrapToRaw(w, kek, aad) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(w.iv), additionalData: aad }, kek, unb64u(w.ct)));
}

/** Fingerprint of the MK. @param {Uint8Array} raw */
export async function fingerprintRaw(raw) {
  const data = new Uint8Array([...enc.encode('zeropunch fingerprint v1|'), ...raw]);
  try {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    return hex(h.slice(0, 8)).match(/.{4}/g).join(' ');
  } finally {
    data.fill(0); // the copy holds the master key
  }
}

/**
 * New account: create the MK and wrap it with the passphrase's wrapKey.
 * @param {string} username normalised @param {string} passphrase @param {{iterations?: number}} [opt]
 * @returns {Promise<{ blob: { v: number, pass: {iv: string, ct: string} }, key: CryptoKey, fingerprint: string, auth: string }>}
 */
export async function createAccount(username, passphrase, opt = {}) {
  if (passphrase.length < MIN_PASSPHRASE) throw new Error('passphrase_short');
  const raw = random(32);
  try {
    const p = await passphraseKeys(username, passphrase, opt.iterations);
    const blob = { v: FORMAT, pass: await wrapRaw(raw, p.wrapKey, wrapAad(username)) };
    // Create the non-extractable key through the path just built (checks the round trip, too).
    const key = await unwrapToKey(blob.pass, p.wrapKey, wrapAad(username));
    return { blob, key, fingerprint: await fingerprintRaw(raw), auth: p.auth };
  } finally {
    raw.fill(0);
  }
}

/**
 * Unlock with the passphrase's wrapKey. Throws «wrong_passphrase» on a wrong key.
 * @param {any} blob @param {CryptoKey} wrapKey @param {string} username
 * @returns {Promise<{ key: CryptoKey, fingerprint: string }>}
 */
export async function unlock(blob, wrapKey, username) {
  const aad = wrapAad(username);
  let raw;
  try {
    raw = await unwrapToRaw(blob.pass, wrapKey, aad);
  } catch {
    throw new Error('wrong_passphrase');
  }
  try {
    return { key: await unwrapToKey(blob.pass, wrapKey, aad), fingerprint: await fingerprintRaw(raw) };
  } finally {
    raw.fill(0);
  }
}

/**
 * New passphrase, proven by the current passphrase's wrapKey. The MK stays the same, so all records
 * stay valid. The new blob is { v, pass } only (an old `rec` part is not carried over).
 * @param {any} blob @param {CryptoKey} oldWrap @param {string} username @param {string} newPassphrase
 * @param {{iterations?: number}} [opt]
 * @returns {Promise<{ blob: { v: number, pass: {iv: string, ct: string} }, key: CryptoKey, fingerprint: string, auth: string }>}
 */
export async function rewrapPassphrase(blob, oldWrap, username, newPassphrase, opt = {}) {
  if (newPassphrase.length < MIN_PASSPHRASE) throw new Error('passphrase_short');
  let raw;
  try {
    raw = await unwrapToRaw(blob.pass, oldWrap, wrapAad(username));
  } catch {
    throw new Error('wrong_passphrase');
  }
  try {
    const p = await passphraseKeys(username, newPassphrase, opt.iterations);
    const aad = wrapAad(username);
    const pass = await wrapRaw(raw, p.wrapKey, aad);
    const key = await unwrapToKey(pass, p.wrapKey, aad);
    return { blob: { v: FORMAT, pass }, key, fingerprint: await fingerprintRaw(raw), auth: p.auth };
  } finally {
    raw.fill(0);
  }
}

// ------------------------------------------------------------ records

/**
 * Pad the plaintext to a fixed size (JSON + spaces). The caller keeps notes short enough.
 * @param {object} obj
 */
export function pad(obj) {
  const bytes = enc.encode(JSON.stringify(obj));
  if (bytes.length > PLAINTEXT_SIZE) throw new Error('too_long');
  const out = new Uint8Array(PLAINTEXT_SIZE).fill(0x20);
  out.set(bytes);
  return out;
}

/** Size of an object as JSON in bytes. @param {object} obj */
export function jsonSize(obj) {
  return enc.encode(JSON.stringify(obj)).length;
}

/**
 * @param {CryptoKey} key @param {string} username @param {string} id @param {object} obj
 * @returns {Promise<string>} base64url(iv ‖ ciphertext ‖ tag), always the same length
 */
export async function encryptRecord(key, username, id, obj) {
  const iv = random(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: recordAad(username, id) }, key, pad(obj)),
  );
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return b64u(out);
}

/** @param {CryptoKey} key @param {string} username @param {string} id @param {string} data */
export async function decryptRecord(key, username, id, data) {
  const bytes = unb64u(data);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: recordAad(username, id) },
    key,
    bytes.slice(12),
  );
  return JSON.parse(dec.decode(pt));
}
