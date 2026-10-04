// Pure layout maths for the hand and the clash rows (unit-tested in test/layout.test.ts).
import type { CardKind } from '@towers/engine';

/** Fan groups, left to right: characters, Heavy, Light, Wit. */
const FAN_GROUP: Record<CardKind, number> = { commander: 0, shardbearer: 0, cavalry: 0, archer: 0, heavy: 1, light: 2, wit: 3 };

export interface FanLayout {
  x: number[];
  w: number;
  total: number;
}

/**
 * Lays out the hand: cards grouped by type with a gap between groups. Portraits get a wide pitch
 * (most of the face shows); infantry overlap down to a strip that still shows rank, type and
 * reliability. Everything tightens together only when even that does not fit.
 */
export function fanLayout(kinds: CardKind[], boxW: number, cardW: number, reserveW = 0): FanLayout {
  const n = kinds.length;
  const w = cardW;
  if (n === 0) return { x: [], w, total: 0 };
  const gap = Math.round(w * 0.16);
  const avail = Math.max(w, boxW - w - reserveW - 8);
  const portrait = (k: CardKind) => FAN_GROUP[k] === 0 || FAN_GROUP[k] === 3;
  let nc = 0;
  let ni = 0;
  let gaps = 0;
  for (let i = 0; i < n - 1; i++) {
    if (portrait(kinds[i])) nc++;
    else ni++;
    if (FAN_GROUP[kinds[i]] !== FAN_GROUP[kinds[i + 1]]) gaps++;
  }
  const full = w + 6;
  const strip = w * 0.3;
  const room = avail - gaps * gap;
  let pc = Math.min(full, Math.max(w * 0.7, w * (62 / 88)));
  let pi = ni ? (room - nc * pc) / ni : 0;
  if (ni && pi > full) {
    pi = full;
    pc = nc ? Math.min(full, (room - ni * pi) / nc) : pc;
  } else if (ni && pi < strip) {
    pi = strip;
    pc = nc ? Math.max(strip, (room - ni * pi) / nc) : pc;
  } else if (!ni && nc) {
    pc = Math.min(full, room / nc);
  }
  let g = gap;
  const need = nc * pc + ni * pi + gaps * g;
  if (need > avail && need > 0) {
    // Not even strips fit: shrink pitches and gaps together.
    const f = avail / need;
    pc *= f;
    pi *= f;
    g *= f;
  }
  const x: number[] = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    x.push(at);
    if (i < n - 1) at += (portrait(kinds[i]) ? pc : pi) + (FAN_GROUP[kinds[i]] !== FAN_GROUP[kinds[i + 1]] ? g : 0);
  }
  return { x, w, total: at + w };
}

/** Inner width of the clash column (px); see .clash in game.css. */
const ROW_W = 320;

/**
 * Card size for a row. Rows you pick from keep readable cards (wrapping to a second line when
 * needed); rows you only watch overlap into a single line once they hold more than five cards,
 * so the column never grows past the arena.
 */
export function rowLayout(n: number, interactive: boolean): { w: number; step: number | null } {
  if (interactive || n <= 5) return { w: n > 8 ? 44 : n > 5 ? 52 : 66, step: null };
  const w = 46;
  return { w, step: Math.min(w + 7, (ROW_W - w) / (n - 1)) };
}

