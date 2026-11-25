// QR code generator: byte mode, versions 1–40, error correction L/M/Q/H.
// Own implementation after ISO/IEC 18004 (structure follows Nayuki's reference
// implementation). Output as a matrix or as an SVG element.

const ECC_CODEWORDS_PER_BLOCK = [
  // Version: (0 unused), 1 … 40
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // L
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28], // M
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // Q
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // H
];
const NUM_ERROR_CORRECTION_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25], // L
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49], // M
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68], // Q
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81], // H
];
const ECL = { L: { ord: 0, bits: 1 }, M: { ord: 1, bits: 0 }, Q: { ord: 2, bits: 3 }, H: { ord: 3, bits: 2 } };

/** @param {number} x @param {number} i */
const bit = (x, i) => ((x >>> i) & 1) !== 0;

/** @param {number} ver */
function numRawDataModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

/** @param {number} ver @param {number} ecl */
function numDataCodewords(ver, ecl) {
  return Math.floor(numRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[ecl][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl][ver];
}

// GF(256) with polynomial 0x11D
/** @param {number} x @param {number} y */
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** @param {number} degree */
function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}

/** @param {number[]} data @param {number[]} divisor */
function rsRemainder(data, divisor) {
  const r = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ /** @type {number} */ (r.shift());
    r.push(0);
    divisor.forEach((coef, i) => (r[i] ^= gfMul(coef, factor)));
  }
  return r;
}

/** @param {number} ver */
function alignmentPositions(ver) {
  if (ver === 1) return [];
  const size = ver * 4 + 17;
  const n = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let pos = size - 7; r.length < n; pos -= step) r.splice(1, 0, pos);
  return r;
}

/**
 * Text (UTF-8, byte mode) to a QR matrix. true = dark.
 * @param {string} text
 * @param {{ ecl?: 'L'|'M'|'Q'|'H', minVersion?: number, mask?: number }} [opt]
 * @returns {{ size: number, version: number, modules: boolean[][] }}
 */
export function encodeQr(text, opt = {}) {
  const ecl = ECL[opt.ecl || 'M'];
  const data = Array.from(new TextEncoder().encode(text));

  // Smallest version that fits
  let ver = opt.minVersion || 1;
  for (; ; ver++) {
    if (ver > 40) throw new Error('qr_too_long');
    const ccBits = ver <= 9 ? 8 : 16;
    if (4 + ccBits + data.length * 8 <= numDataCodewords(ver, ecl.ord) * 8) break;
  }
  const capacityBits = numDataCodewords(ver, ecl.ord) * 8;

  // Bit stream: mode 0100, length, data, terminator, padding bytes
  /** @type {number[]} */
  const bits = [];
  const push = (/** @type {number} */ val, /** @type {number} */ len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4);
  push(data.length, ver <= 9 ? 8 : 16);
  for (const b of data) push(b, 8);
  push(0, Math.min(4, capacityBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8);
  /** @type {number[]} */
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    codewords.push(v);
  }

  // Error correction and interleaving
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl.ord][ver];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl.ord][ver];
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks);
  const div = rsDivisor(blockEccLen);
  /** @type {number[][]} */
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = codewords.slice(k, k + shortLen - blockEccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  /** @type {number[]} */
  const all = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((blk, j) => {
      if (i !== shortLen - blockEccLen || j >= numShort) all.push(blk[i]);
    });
  }

  // Build the matrix
  const size = ver * 4 + 17;
  const modules = Array.from({ length: size }, () => Array(size).fill(false));
  const isFn = Array.from({ length: size }, () => Array(size).fill(false));
  const setFn = (/** @type {number} */ x, /** @type {number} */ y, /** @type {boolean} */ dark) => {
    modules[y][x] = dark;
    isFn[y][x] = true;
  };

  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = cx + dx, yy = cy + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, d !== 2 && d !== 4);
      }
    }
  }
  const al = alignmentPositions(ver);
  for (let i = 0; i < al.length; i++) {
    for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) setFn(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  const drawFormat = (/** @type {number} */ mask) => {
    const d = (ecl.bits << 3) | mask;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(b, i));
    setFn(8, 7, bit(b, 6));
    setFn(8, 8, bit(b, 7));
    setFn(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(b, i));
    setFn(8, size - 8, true);
  };
  drawFormat(0); // reserves the fields

  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), c = Math.floor(i / 3);
      setFn(a, c, bit(b, i));
      setFn(c, a, bit(b, i));
    }
  }

  // Data in a zigzag
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - vert : vert;
        if (!isFn[y][x] && i < all.length * 8) {
          modules[y][x] = bit(all[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }

  const applyMask = (/** @type {number} */ m) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (isFn[y][x]) continue;
        let inv;
        switch (m) {
          case 0: inv = (x + y) % 2 === 0; break;
          case 1: inv = y % 2 === 0; break;
          case 2: inv = x % 3 === 0; break;
          case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (inv) modules[y][x] = !modules[y][x];
      }
    }
  };

  let mask = opt.mask;
  if (mask == null) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m);
      drawFormat(m);
      const p = penalty(modules);
      if (p < best) {
        best = p;
        mask = m;
      }
      applyMask(m); // undo (XOR)
    }
  }
  applyMask(/** @type {number} */ (mask));
  drawFormat(/** @type {number} */ (mask));
  return { size, version: ver, modules };
}

/** Simplified penalty score (runs, 2×2 blocks, finder-like patterns, balance). @param {boolean[][]} m */
function penalty(m) {
  const size = m.length;
  let p = 0;
  const line = (/** @type {(i: number) => boolean} */ get) => {
    let run = 1;
    let s = 0;
    const seq = [];
    for (let i = 0; i < size; i++) seq.push(get(i) ? 1 : 0);
    for (let i = 1; i <= size; i++) {
      if (i < size && seq[i] === seq[i - 1]) run++;
      else {
        if (run >= 5) s += 3 + run - 5;
        run = 1;
      }
    }
    const str = seq.join('');
    for (const pat of ['10111010000', '00001011101']) {
      let k = str.indexOf(pat);
      while (k >= 0) {
        s += 40;
        k = str.indexOf(pat, k + 1);
      }
    }
    return s;
  };
  for (let y = 0; y < size; y++) p += line((x) => m[y][x]);
  for (let x = 0; x < size; x++) p += line((y) => m[y][x]);
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++;
      if (x < size - 1 && y < size - 1) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
      }
    }
  }
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return p + Math.max(0, k) * 10;
}

/**
 * SVG element (dark on light regardless of the colour scheme, so cameras can read it).
 * @param {string} text @param {{ ecl?: 'L'|'M'|'Q'|'H', label?: string }} [opt]
 */
export function qrSvg(text, opt = {}) {
  const { size, modules } = encodeQr(text, opt);
  const quiet = 4;
  const full = size + quiet * 2;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${full} ${full}`);
  svg.setAttribute('class', 'qr');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', opt.label || 'QR code');
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', String(full));
  bg.setAttribute('height', String(full));
  bg.setAttribute('fill', '#ffffff');
  svg.appendChild(bg);
  let d = '';
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) if (modules[y][x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#000000');
  svg.appendChild(path);
  return svg;
}
