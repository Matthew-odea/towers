// Board geometry: 19-hex board, axial coordinates, radius 2.
import type { HexKey, PlayerId } from './types';

export const BOARD_RADIUS = 2;

/** Neighbour directions (axial). */
export const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

export function hexKey(q: number, r: number): HexKey {
  // Normalise -0 to 0.
  return `${q + 0},${r + 0}`;
}

export function parseHex(k: HexKey): [number, number] {
  const [q, r] = k.split(',').map(Number);
  return [q, r];
}

function buildAll(): HexKey[] {
  const out: HexKey[] = [];
  for (let r = -BOARD_RADIUS; r <= BOARD_RADIUS; r++) {
    for (let q = -BOARD_RADIUS; q <= BOARD_RADIUS; q++) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= BOARD_RADIUS) out.push(hexKey(q, r));
    }
  }
  return out;
}

/** All 19 hexes, ordered by row (r = -2 first) then q. */
export const ALL_HEXES: readonly HexKey[] = buildAll();
const HEX_SET = new Set<string>(ALL_HEXES);

export function isHex(k: unknown): k is HexKey {
  return typeof k === 'string' && HEX_SET.has(k);
}

export const TOWER: Readonly<Record<PlayerId, HexKey>> = { red: '-1,2', black: '1,-2' };
export const HOME_EDGE: Readonly<Record<PlayerId, readonly HexKey[]>> = {
  red: ['-2,2', '-1,2', '0,2'],
  black: ['0,-2', '1,-2', '2,-2'],
};
export const CENTRE: HexKey = '0,0';

export function other(p: PlayerId): PlayerId {
  return p === 'red' ? 'black' : 'red';
}

export function distance(a: HexKey, b: HexKey): number {
  const [aq, ar] = parseHex(a);
  const [bq, br] = parseHex(b);
  const dq = aq - bq;
  const dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function areAdjacent(a: HexKey, b: HexKey): boolean {
  return distance(a, b) === 1;
}

const NEIGHBOURS: Record<HexKey, HexKey[]> = {};
for (const h of ALL_HEXES) {
  const [q, r] = parseHex(h);
  NEIGHBOURS[h] = DIRECTIONS.map(([dq, dr]) => hexKey(q + dq, r + dr)).filter((k) => HEX_SET.has(k));
}

/** On-board neighbours of a hex. */
export function neighbors(h: HexKey): HexKey[] {
  return NEIGHBOURS[h] ? [...NEIGHBOURS[h]] : [];
}

/** Point-symmetric partner (180° rotation). */
export function mirror(h: HexKey): HexKey {
  const [q, r] = parseHex(h);
  return hexKey(-q, -r);
}

/** On-board hexes adjacent to both a and b. */
export function commonNeighbors(a: HexKey, b: HexKey): HexKey[] {
  const nb = new Set(neighbors(b));
  return neighbors(a).filter((h) => nb.has(h));
}
