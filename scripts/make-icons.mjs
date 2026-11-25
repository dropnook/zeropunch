// Generates the PNG icons without dependencies (zlib from Node). Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcT = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (t, d) => {
  const l = Buffer.alloc(4);
  l.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t), d]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([l, td, c]);
};

// Same mark as icon.svg ("punched zero"): white ring on slate, a hole punched out of the ring at
// the upper right, the punched-out piece as a coral dot.
// rounded: rounded square with transparent corners (purpose "any").
// maskable: full-bleed slate square, mark scaled to `scale` around the centre (stays in the safe zone).
const SLATE = [0x2b, 0x32, 0x38];
const WHITE = [255, 255, 255];
const CORAL = [0xff, 0x6b, 0x4a];

/** Colour (or null = transparent) at a point of the 512 × 512 design. */
function colourAt(px, py, rounded, scale) {
  if (rounded) {
    const rx = 112;
    const cx = Math.min(Math.max(px, rx), 512 - rx), cy = Math.min(Math.max(py, rx), 512 - rx);
    if (Math.hypot(px - cx, py - cy) > rx) return null;
  }
  // Undo the scaling around the centre, then test the three circles.
  const x = 256 + (px - 256) / scale, y = 256 + (py - 256) / scale;
  if (Math.hypot(x - 423, y - 89) <= 27) return CORAL;
  if (Math.hypot(x - 352, y - 160) <= 34) return SLATE;
  if (Math.abs(Math.hypot(x - 256, y - 256) - 137) <= 29) return WHITE;
  return SLATE;
}

function icon(size, { rounded = false, scale = 1 } = {}) {
  const S = 4; // supersampling
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const u = size / 512;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const c = colourAt((x + (sx + 0.5) / S) / u, (y + (sy + 0.5) / S) / u, rounded, scale);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a++;
        }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((255 * a) / (S * S));
    }
  }
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(size, 0);
  ih.writeUInt32BE(size, 4);
  ih[8] = 8;
  ih[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ih),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = (name, png) => writeFileSync(new URL(`../public/icons/${name}`, import.meta.url), png);
// iOS rounds the corners itself: full-bleed, unscaled.
out('icon-180.png', icon(180));
for (const size of [192, 512]) {
  out(`icon-${size}.png`, icon(size, { rounded: true }));
  out(`icon-maskable-${size}.png`, icon(size, { scale: 0.78 }));
}
console.log('Icons written.');
