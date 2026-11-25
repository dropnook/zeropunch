// Proof of work for registration (counterpart of src/pow.js). WebCrypto SHA-256 only.
// Finds a nonce so that SHA-256(challenge + ":" + nonce) starts with `bits` zero bits.
// Hashes run in parallel batches: one awaited digest at a time would be much slower.

const enc = new TextEncoder();
const BATCH = 512;

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

/**
 * @param {string} challenge @param {number} bits
 * @param {{ signal?: AbortSignal, onProgress?: (tried: number) => void }} [opt]
 * @returns {Promise<{ nonce: string, tried: number }>}
 */
export async function solve(challenge, bits, opt = {}) {
  for (let start = 0; ; start += BATCH) {
    if (opt.signal?.aborted) throw new Error('aborted');
    const batch = [];
    for (let i = 0; i < BATCH; i++) batch.push(crypto.subtle.digest('SHA-256', enc.encode(`${challenge}:${start + i}`)));
    const hashes = await Promise.all(batch);
    for (let i = 0; i < BATCH; i++) {
      if (leadingZeroBits(new Uint8Array(hashes[i])) >= bits) return { nonce: String(start + i), tried: start + i + 1 };
    }
    opt.onProgress?.(start + BATCH);
  }
}
