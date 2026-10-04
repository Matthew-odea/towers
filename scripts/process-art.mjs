// Crops originals in art-src/ to 5:7 portraits (600x840 webp) in packages/client/public/art/characters.
// Crop boxes were chosen per image by eye: { left, top, width, height } in original pixels.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => path.join(root, 'art-src', f);
const out = path.join(root, 'packages/client/public/art/characters');
mkdirSync(out, { recursive: true });

const tarot = { left: 35, top: 30, width: 1180, height: 1652 };

const JOBS = {
  dalinar: { file: 'dalinar.jpg', box: tarot },
  jasnah: { file: 'jasnah.jpg', box: tarot },
  kaladin: { file: 'kaladin.jpg', box: tarot },
  adolin: { file: 'adolin.jpg', box: tarot },
  lift: { file: 'lift.jpg', box: tarot },
  lopen: { file: 'lopen.jpg', box: { left: 130, top: 0, width: 822, height: 1151 } },
  lunamor: { file: 'lunamor.jpg', box: { left: 100, top: 0, width: 970, height: 1357 } },
  shallan: { file: 'shallan.jpg', box: tarot },
  raboniel: { file: 'raboniel3.png', box: { left: 190, top: 120, width: 2450, height: 3430 } },
  eshonai: { file: 'eshonai.jpg', box: tarot },
  szeth: { file: 'szeth.jpg', box: tarot },
  moash: { file: 'moash.jpg', box: { left: 60, top: 80, width: 900, height: 1260 } },
  leshwi: { file: 'leshwi2.jpg', box: { left: 150, top: 0, width: 640, height: 896 } },
  lezian: { file: 'lezian2.png', box: { left: 430, top: 200, width: 1127, height: 1578 } },
  venli: { file: 'venli.jpg', box: tarot },
  rlain: { file: 'rlain.jpg', box: { left: 0, top: 0, width: 1150, height: 1610 } }, // Singers' second Archer (substitution, see CREDITS.md)
  hoid: { file: 'hoid.jpg', box: { left: 50, top: 60, width: 1088, height: 1523 } },
};

const only = process.argv.slice(2);
for (const [id, { file, box }] of Object.entries(JOBS)) {
  if (only.length && !only.includes(id)) continue;
  await sharp(src(file)).extract(box).resize(600, 840, { fit: 'cover' })
    .webp({ quality: 82 }).toFile(path.join(out, `${id}.webp`));
  console.log('ok', id);
}
