import { describe, it, expect } from 'vitest';
import { encodeQr } from '../../public/js/qr.js';

// Structure checks here; decoding with a real reader was checked by hand.
describe('QR code', () => {
  it('login link with a 32-character username fits a small version', () => {
    const q = encodeQr('https://zeropunch.app/#u=' + 'x'.repeat(32), { ecl: 'M' });
    expect(q.version).toBeLessThanOrEqual(4);
  });

  it('finder patterns in three corners, timing lines, dark module', () => {
    const { modules: m, size } = encodeQr('https://zeropunch.app/#u=' + 'x'.repeat(40));
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      expect(m[cy][cx]).toBe(true); // centre dark
      expect(m[cy - 2][cx]).toBe(false); // light ring
      expect(m[cy - 3][cx]).toBe(true); // dark border
    }
    for (let i = 8; i < size - 8; i++) expect(m[6][i]).toBe(i % 2 === 0);
    expect(m[size - 8][8]).toBe(true);
  });

  it('deterministic', () => {
    const url = 'https://zeropunch.app/#u=' + 'a'.repeat(33);
    expect(encodeQr(url).modules).toEqual(encodeQr(url).modules);
  });

  it('too long throws', () => {
    expect(() => encodeQr('x'.repeat(3000), { ecl: 'H' })).toThrow('qr_too_long');
  });
});
