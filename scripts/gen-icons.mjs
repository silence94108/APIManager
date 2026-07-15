// 生成扩展图标：碳黑圆角底 + 中央磷光绿圆点（含光晕）。零依赖，手拼 PNG。
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icon");

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([len, typeBytes, data, crc]);
}

function png(size, pixelFn) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y, size);
      raw.writeUInt32BE(((r << 24) | (g << 16) | (b << 8) | a) >>> 0, row + 1 + x * 4);
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CARBON = [11, 12, 14];
const PHOS = [200, 245, 66];

function pixel(x, y, size) {
  const cx = x + 0.5 - size / 2;
  const cy = y + 0.5 - size / 2;
  const dist = Math.hypot(cx, cy) / (size / 2); // 0=中心 1=边缘

  // 圆角方块底：四角裁圆（半径 22%）
  const r = size * 0.22;
  const ex = Math.max(0, Math.abs(x + 0.5 - size / 2) - (size / 2 - r));
  const ey = Math.max(0, Math.abs(y + 0.5 - size / 2) - (size / 2 - r));
  if (Math.hypot(ex, ey) > r) return [0, 0, 0, 0];

  // 中央磷光圆点（28%）+ 光晕衰减（28%~62%）
  if (dist < 0.28) return [...PHOS, 255];
  if (dist < 0.62) {
    const t = 1 - (dist - 0.28) / 0.34; // 1→0
    const glow = t * t * 0.55;
    return [
      Math.round(CARBON[0] + (PHOS[0] - CARBON[0]) * glow),
      Math.round(CARBON[1] + (PHOS[1] - CARBON[1]) * glow),
      Math.round(CARBON[2] + (PHOS[2] - CARBON[2]) * glow),
      255,
    ];
  }
  return [...CARBON, 255];
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(OUT_DIR, `${size}.png`), png(size, pixel));
  console.log(`icon/${size}.png`);
}
