// Precomputed board geometry on numeric hex indices (0..18), for the smart bot's fast model.
import { ALL_HEXES, TOWER, commonNeighbors, distance, mirror, neighbors } from '../hex';
import type { HexKey, PlayerId } from '../types';

export const HEX: readonly HexKey[] = ALL_HEXES;
export const N_HEX = HEX.length;
export const IDX: Readonly<Record<HexKey, number>> = Object.fromEntries(HEX.map((h, i) => [h, i]));
export const NB: readonly (readonly number[])[] = HEX.map((h) => neighbors(h).map((n) => IDX[n]));
export const DIST: readonly (readonly number[])[] = HEX.map((a) => HEX.map((b) => distance(a, b)));
/** For hex pairs at distance 2: the hexes adjacent to both (line-of-sight middles). */
export const MID: readonly (readonly (readonly number[])[])[] = HEX.map((a, i) =>
  HEX.map((b, j) => (DIST[i][j] === 2 ? commonNeighbors(a, b).map((x) => IDX[x]) : [])),
);
export const TOWER_IDX: Readonly<Record<PlayerId, number>> = { red: IDX[TOWER.red], black: IDX[TOWER.black] };

/** Hexes where Wit may never be Spawned: both Towers and their neighbours. */
export const NO_SPAWN: ReadonlySet<number> = new Set(
  (['red', 'black'] as const).flatMap((p) => [TOWER_IDX[p], ...NB[TOWER_IDX[p]]]),
);

export function adjacent(a: number, b: number): boolean {
  return DIST[a][b] === 1;
}

/**
 * Player-relative iteration orders. Black's are Red's mirrored through the centre, so both
 * seats generate (and therefore tie-break) candidate actions the same way.
 */
const MIRROR_IDX: readonly number[] = HEX.map((h) => IDX[mirror(h)]);
export const ORDER: Readonly<Record<PlayerId, readonly number[]>> = {
  red: HEX.map((_, i) => i),
  black: HEX.map((_, i) => MIRROR_IDX[i]),
};
export const NB_ORDER: Readonly<Record<PlayerId, readonly (readonly number[])[]>> = {
  red: NB,
  black: HEX.map((_, h) => NB[MIRROR_IDX[h]].map((n) => MIRROR_IDX[n])),
};
