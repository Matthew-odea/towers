// Board geometry for rendering: pointy-top axial hexes, each seat sees its home edge at the bottom.
import { ALL_HEXES, parseHex, type HexKey, type PlayerId } from '@towers/engine';

/** Logical hex radius (centre to corner) in board units (px before scaling). */
export const HEX = 76;
const SQRT3 = Math.sqrt(3);

/** Logical stage size. Wide enough for the island plus fanned stacks; tall enough for the cliff. */
export const STAGE_W = Math.round(SQRT3 * HEX * 5 + HEX * 1.1);
export const STAGE_H = Math.round(HEX * 8 + HEX * 0.9);

/** Cliff drop under each hex (drawn by the terrain layer). */
export const CLIFF = 18;

/**
 * The island's real extent: five hexes across (plus room for fanned stacks on the side columns)
 * and five rows down plus the cliff. The board is scaled so this, not the padded stage, fills
 * the arena.
 */
export const ISLAND_W = Math.round(SQRT3 * HEX * 5 + HEX * 0.3);
export const ISLAND_H = Math.round(HEX * 1.5 * 4 + HEX * 2 + CLIFF + 10);

export interface Pt {
  x: number;
  y: number;
}

/** Centre of a hex in stage coordinates (origin at the stage centre). Black's view is rotated 180°. */
export function hexCenter(h: HexKey, seat: PlayerId): Pt {
  const [q, r] = parseHex(h);
  const x = SQRT3 * HEX * (q + r / 2);
  const y = 1.5 * HEX * r;
  return seat === 'black' ? { x: -x + 0, y: -y + 0 } : { x, y };
}

/** Top-left based coordinates (for absolutely positioned HTML). */
export function hexCenterTL(h: HexKey, seat: PlayerId): Pt {
  const c = hexCenter(h, seat);
  return { x: c.x + STAGE_W / 2, y: c.y + STAGE_H / 2 };
}

export function hexCorners(c: Pt, size = HEX): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((60 * i - 30) * Math.PI) / 180;
    out.push({ x: c.x + size * Math.cos(a), y: c.y + size * Math.sin(a) });
  }
  return out;
}

export function polyPoints(pts: Pt[]): string {
  return pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
}

export function hexPath(c: Pt, size = HEX): string {
  const pts = hexCorners(c, size);
  return `M${pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L')}Z`;
}

/** Deterministic small PRNG per hex (for terrain decoration). */
export function hexRand(h: HexKey, salt = 0): () => number {
  let s = 2166136261 ^ salt;
  for (let i = 0; i < h.length; i++) s = Math.imul(s ^ h.charCodeAt(i), 16777619);
  return () => {
    s = Math.imul(s ^ (s >>> 15), 2246822507);
    s = Math.imul(s ^ (s >>> 13), 3266489909);
    s ^= s >>> 16;
    return (s >>> 0) / 4294967296;
  };
}

/** Hexes in paint order (top of the screen first) for the given seat. */
export function paintOrder(seat: PlayerId): HexKey[] {
  return [...ALL_HEXES].sort((a, b) => hexCenter(a, seat).y - hexCenter(b, seat).y || hexCenter(a, seat).x - hexCenter(b, seat).x);
}
