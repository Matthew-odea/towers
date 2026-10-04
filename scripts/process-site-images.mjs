// Builds the favicon set (from packages/client/public/favicon.svg) and the landing hero image
// (from art-src/hero/, git-ignored; see CREDITS.md). Run: node scripts/process-site-images.mjs
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'packages/client/public');
const svg = path.join(pub, 'favicon.svg');
const png = (size) => sharp(svg, { density: Math.ceil((size / 32) * 72 * 4) }).resize(size, size).png().toBuffer();

// PNG favicons for browsers that ignore SVG icons (Safari), plus the iOS/Android touch sizes.
for (const [name, size] of [['favicon-32.png', 32], ['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  writeFileSync(path.join(pub, name), await png(size));
}

// favicon.ico holding PNG-encoded 16, 32 and 48 px images (valid since Windows Vista; all browsers read it).
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s, e); header.writeUInt8(s, e + 1); header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(images[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});
writeFileSync(path.join(pub, 'favicon.ico'), Buffer.concat([header, ...images]));

// Landing hero: "Urithiru" by automaticmoon (portrait painting, shown full height beside the form).
mkdirSync(path.join(pub, 'art/hero'), { recursive: true });
await sharp(path.join(root, 'art-src/hero/Urithiru_by_AutomaticMoon.jpg'))
  .resize({ width: 1100 }).webp({ quality: 78 }).toFile(path.join(pub, 'art/hero/urithiru.webp'));
console.log('ok');
