// Proof of work for registration (and for logins to an account under attack). Stateless challenge: id.expires.bits.signature (HMAC with PEPPER).
// The client finds a nonce so that SHA-256(challenge + ":" + nonce) starts with `bits` zero bits.
// Spent challenge ids are remembered in `pow_used` until they expire.

import { hmacHex, randomToken, safeEqual } from './util.js';

export const POW_TTL = 10 * 60_000;
export const DEFAULT_POW_BITS = 17;
const enc = new TextEncoder();

/** @param {Record<string, any>} env */
export function powBits(env) {
  const n = Number.parseInt(String(env.POW_BITS ?? ''), 10);
  return Number.isFinite(n) && n >= 0 && n <= 32 ? n : DEFAULT_POW_BITS;
}

/** @param {Uint8Array} hash */
export function leadingZeroBits(hash) {
  let n = 0;
  for (const b of hash) {
    if (b === 0) {
      n += 8;
      continue;
    }
    return n + Math.clz32(b) - 24;
  }
  return n;
}

/** @param {Record<string, any>} env @param {number} [now] @param {number} [bits] defaults to POW_BITS */
export async function makeChallenge(env, now = Date.now(), bits = powBits(env)) {
  bits = Math.min(32, Math.max(0, bits));
  const expires = now + POW_TTL;
  const body = `${randomToken(16)}.${expires}.${bits}`;
  const sig = await hmacHex(env.PEPPER, `pow|${body}`);
  return { challenge: `${body}.${sig}`, bits, expires };
}

/**
 * @param {Record<string, any>} env @param {unknown} challenge @param {unknown} nonce @param {number} [now]
 * @returns {Promise<{ ok: true, id: string, expires: number, bits: number } | { ok: false, error: 'pow_invalid' | 'pow_expired' }>}
 */
export async function checkSolution(env, challenge, nonce, now = Date.now()) {
  const bad = /** @type {const} */ ({ ok: false, error: 'pow_invalid' });
  if (typeof challenge !== 'string' || challenge.length > 200) return bad;
  if (typeof nonce !== 'string' || !/^\d{1,16}$/.test(nonce)) return bad;
  const parts = challenge.split('.');
  if (parts.length !== 4) return bad;
  const [id, expRaw, bitsRaw, sig] = parts;
  if (!/^[A-Za-z0-9_-]{22}$/.test(id) || !/^\d{1,15}$/.test(expRaw) || !/^\d{1,2}$/.test(bitsRaw)) return bad;
  const expect = await hmacHex(env.PEPPER, `pow|${id}.${expRaw}.${bitsRaw}`);
  if (!safeEqual(sig, expect)) return bad;
  const bits = Number(bitsRaw);
  if (bits < powBits(env)) return bad;
  const expires = Number(expRaw);
  if (expires <= now) return { ok: false, error: 'pow_expired' };
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${challenge}:${nonce}`)));
  if (leadingZeroBits(hash) < bits) return bad;
  return { ok: true, id, expires, bits };
}
