// Generates the PWA / app icons from the design tokens with no image dependencies (pure PNG encoder):
// an ink square with a Signal-cyan "reader eye" ring and slit. Run: node scripts/icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INK = [0x07, 0x08, 0x0a];
const SIGNAL = [0x00, 0xa3, 0xe0];
const LIGHT = [0x7f, 0xe3, 0xff];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, pixel) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x + 0.5, y + 0.5);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))));

/** `scale` < 1 keeps the mark inside the maskable safe zone. */
function eye(size, scale = 1) {
  const c = size / 2;
  const R = size * 0.34 * scale;
  const ring = size * 0.035 * scale;
  return (x, y) => {
    const d = Math.hypot(x - c, y - c);
    let px = mix(INK, [0x17, 0x1a, 0x20], 1 - d / (size * 0.7));
    const edge = Math.abs(d - R);
    if (edge < ring) px = mix(px, SIGNAL, 1 - edge / ring);
    const slitW = R * 0.95;
    const slitH = size * 0.03 * scale;
    if (Math.abs(y - c) < slitH && Math.abs(x - c) < slitW) px = mix(LIGHT, SIGNAL, Math.abs(x - c) / slitW);
    return px;
  };
}

const out = join(root, 'public', 'icons');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'icon-192.png'), png(192, eye(192)));
writeFileSync(join(out, 'icon-512.png'), png(512, eye(512)));
writeFileSync(join(out, 'maskable-512.png'), png(512, eye(512, 0.78)));
writeFileSync(join(out, 'apple-touch-icon.png'), png(180, eye(180, 0.9)));
console.log('icons written to', out);
