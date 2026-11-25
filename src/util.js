// Small helpers: randomness, hashes, encoding. WebCrypto only.

const enc = new TextEncoder();

/** @param {Uint8Array} bytes */
export function toHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/** @param {Uint8Array} bytes */
export function toB64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {number} n */
export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** Random token as base64url. @param {number} bytes */
export function randomToken(bytes) {
  return toB64url(randomBytes(bytes));
}

/** @param {string} s */
export async function sha256Hex(s) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
}

/** @type {Map<string, Promise<CryptoKey>>} */
const hmacKeys = new Map();

/** HMAC-SHA-256 with the server secret. @param {string} pepper @param {string} msg */
export async function hmacHex(pepper, msg) {
  if (!pepper) throw new Error('PEPPER missing');
  let key = hmacKeys.get(pepper);
  if (!key) {
    key = crypto.subtle.importKey('raw', enc.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    hmacKeys.set(pepper, key);
  }
  const sig = await crypto.subtle.sign('HMAC', await key, enc.encode(msg));
  return toHex(new Uint8Array(sig));
}

/** Constant-time comparison of two equally long strings. @param {string} a @param {string} b */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Client network for rate limits: an IPv4 address as is, an IPv6 address reduced to its /64 prefix
 * (one subscriber usually gets a whole /64). IPv4-mapped IPv6 counts as IPv4.
 * @param {string | null | undefined} ip
 */
export function clientNet(ip) {
  const g = ipv6Groups(ip);
  return Array.isArray(g) ? `${g.slice(0, 4).join(':')}::/64` : g;
}

/**
 * Coarser network for a second, higher limit: the IPv6 /48 (what a site or a business line usually
 * gets, so an attacker cannot multiply the per-/64 limits by 65 536). null for IPv4 and unknown
 * addresses: an IPv4 address is already the smallest unit a client gets.
 * @param {string | null | undefined} ip
 */
export function clientNet48(ip) {
  const g = ipv6Groups(ip);
  return Array.isArray(g) ? `${g.slice(0, 3).join(':')}::/48` : null;
}

/** IPv6 → its 8 groups (hex, no leading zeros); anything else → the IPv4 string or 'local'. @param {string | null | undefined} ip */
function ipv6Groups(ip) {
  let s = String(ip || '').trim().toLowerCase();
  if (!s) return 'local';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mapped) return mapped[1];
  if (!s.includes(':')) return s;
  s = s.split('%')[0].replace(/^\[|\]$/g, '');
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  /** @type {string[]} */
  let groups;
  if (tail === undefined) groups = h;
  else {
    const t = tail ? tail.split(':') : [];
    groups = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  }
  return groups.map((g) => (Number.parseInt(g, 16) || 0).toString(16));
}

/** @param {string} s */
function fromB64url(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** @type {Map<string, Promise<CryptoKey>>} */
const restKeys = new Map();

/** AES-GCM key for the wrapped-key blob at rest: HKDF(PEPPER). @param {string} pepper */
function restKey(pepper) {
  if (!pepper) throw new Error('PEPPER missing');
  let k = restKeys.get(pepper);
  if (!k) {
    k = (async () => {
      const base = await crypto.subtle.importKey('raw', enc.encode(pepper), 'HKDF', false, ['deriveKey']);
      return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('zeropunch keys at rest'), info: enc.encode('v1') },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    })();
    restKeys.set(pepper, k);
  }
  return k;
}

/** Prefix of an encrypted blob in users.keys. Old rows hold plain JSON (starting with "{"). */
export const SEALED = 'e1.';

/** Encrypt the keys JSON for storage. AAD = account id. @param {string} pepper @param {string} userId @param {string} text */
export async function sealKeys(pepper, userId, text) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(userId) }, await restKey(pepper), enc.encode(text)),
  );
  return `${SEALED}${toB64url(iv)}.${toB64url(ct)}`;
}

/** Stored value → keys JSON text (plain legacy rows are returned as they are). @param {string} pepper @param {string} userId @param {string} stored */
export async function openKeys(pepper, userId, stored) {
  if (!stored.startsWith(SEALED)) return stored;
  const [iv, ct] = stored.slice(SEALED.length).split('.');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64url(iv), additionalData: enc.encode(userId) },
    await restKey(pepper),
    fromB64url(ct),
  );
  return new TextDecoder().decode(pt);
}
