import { describe, it, expect } from 'vitest';
import { solve, leadingZeroBits } from '../../public/js/pow.js';
import { makeChallenge, checkSolution, leadingZeroBits as serverLzb, powBits, DEFAULT_POW_BITS } from '../../src/pow.js';

const env = { PEPPER: 'unit-pepper', POW_BITS: '8' };

describe('proof of work', () => {
  it('leading zero bits', () => {
    for (const f of [leadingZeroBits, serverLzb]) {
      expect(f(new Uint8Array([0x80]))).toBe(0);
      expect(f(new Uint8Array([0x01]))).toBe(7);
      expect(f(new Uint8Array([0, 0x10]))).toBe(11);
      expect(f(new Uint8Array([0, 0]))).toBe(16);
    }
  });

  it('client solution is accepted by the server; wrong nonce is not', async () => {
    const ch = await makeChallenge(env);
    expect(ch.bits).toBe(8);
    const { nonce } = await solve(ch.challenge, ch.bits);
    expect(await checkSolution(env, ch.challenge, nonce)).toMatchObject({ ok: true });
    let bad = Number(nonce) + 1;
    while ((await checkSolution(env, ch.challenge, String(bad))).ok) bad++;
    expect(await checkSolution(env, ch.challenge, String(bad))).toEqual({ ok: false, error: 'pow_invalid' });
  });

  it('expired, tampered, lower difficulty, other secret', async () => {
    const old = await makeChallenge(env, Date.now() - 11 * 60_000);
    const s = await solve(old.challenge, old.bits);
    expect(await checkSolution(env, old.challenge, s.nonce)).toEqual({ ok: false, error: 'pow_expired' });
    const ch = await makeChallenge(env);
    const [id, exp, , sig] = ch.challenge.split('.');
    expect((await checkSolution(env, `${id}.${exp}.1.${sig}`, '0')).ok).toBe(false);
    expect((await checkSolution(env, `${id}.${Number(exp) + 999999}.8.${sig}`, '0')).ok).toBe(false);
    const easy = await makeChallenge({ PEPPER: env.PEPPER, POW_BITS: '2' });
    const e = await solve(easy.challenge, easy.bits);
    expect((await checkSolution(env, easy.challenge, e.nonce)).ok).toBe(false); // server now wants 8
    expect((await checkSolution({ PEPPER: 'other', POW_BITS: '8' }, ch.challenge, '0')).ok).toBe(false);
    for (const junk of [undefined, 5, 'x', 'a.b.c', 'a.b.c.d.e']) expect((await checkSolution(env, junk, '0')).ok).toBe(false);
    expect((await checkSolution(env, ch.challenge, '-1')).ok).toBe(false);
  });

  it('difficulty from POW_BITS, default 17 (wrangler.jsonc sets the real value)', () => {
    expect(powBits({})).toBe(DEFAULT_POW_BITS);
    expect(powBits({ POW_BITS: '18' })).toBe(18);
    expect(powBits({ POW_BITS: 'nonsense' })).toBe(DEFAULT_POW_BITS);
  });
});
