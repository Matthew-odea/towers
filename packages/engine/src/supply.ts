// Supply lines (RULINGS §10.2).
import { TOWER, neighbors } from './hex';
import { stackOwner } from './state';
import type { HexKey, PlayerId, PublicState } from './types';

/** Hexes connected to `player`'s Tower through a chain of hexes that each hold the player's cards (Tower included). */
export function suppliedHexes(s: PublicState, player: PlayerId): HexKey[] {
  const tower = TOWER[player];
  if (stackOwner(s, tower) !== player) return [];
  const seen = new Set<HexKey>([tower]);
  const queue = [tower];
  while (queue.length) {
    const h = queue.shift()!;
    for (const n of neighbors(h)) {
      if (!seen.has(n) && stackOwner(s, n) === player) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return [...seen];
}

export function hasSupply(s: PublicState, player: PlayerId, hex: HexKey): boolean {
  return suppliedHexes(s, player).includes(hex);
}
