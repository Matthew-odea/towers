// Open, turn-based round setup (RULINGS §4): who places next, and what they may place.
import { HOME_EDGE, other } from './hex';
import { MAX_SETUP_OTHERS, PLAYERS, hasRoom } from './state';
import type { AnyState, PlayerId, PublicState, SetupStep } from './types';

export interface SetupCounts {
  /** Cards placed so far this setup (Commanders + troops). */
  placed: number;
  /** Troops (non-Commander cards) placed so far this setup. */
  troopsPlaced: number;
  /** Unplaced Commanders (still in Reserve). */
  commandersLeft: number;
  /** Cards that may still be placed as troops (Reserve, not Commander, not Wit). */
  eligibleTroops: string[];
  /** Troop placements still to come: min(6 - troops placed, eligible troops). */
  troopsLeft: number;
}

/** Setup progress of `player` (meaningful while `phase === 'setup'`). */
export function setupCounts(s: PublicState, player: PlayerId): SetupCounts {
  const placements = s.setup[player]?.placements ?? [];
  const troopsPlaced = placements.filter((p) => s.cards[p.cardId]?.kind !== 'commander').length;
  const reserve = s.reserve[player];
  const commandersLeft = reserve.filter((id) => s.cards[id].kind === 'commander').length;
  const eligibleTroops = reserve.filter((id) => s.cards[id].kind !== 'commander' && s.cards[id].kind !== 'wit');
  return {
    placed: placements.length,
    troopsPlaced,
    commandersLeft,
    eligibleTroops,
    troopsLeft: Math.max(0, Math.min(MAX_SETUP_OTHERS - troopsPlaced, eligibleTroops.length)),
  };
}

/**
 * Who places next during setup, and in which step; null when setup is complete.
 * Order: the round starter places both Commanders, then the other player; then troops alternate
 * starting with the round starter, one card per setup turn, until each player has placed 6.
 * A player with no eligible cards left skips their remaining setup turns.
 */
export function nextSetupPlacer(s: AnyState): { player: PlayerId; step: SetupStep } | null {
  if (s.phase !== 'setup') return null;
  const first = s.roundStarter;
  const second = other(first);
  const f = setupCounts(s, first);
  const g = setupCounts(s, second);
  if (f.commandersLeft > 0) return { player: first, step: 'commander' };
  if (g.commandersLeft > 0) return { player: second, step: 'commander' };
  if (f.troopsLeft === 0 && g.troopsLeft === 0) return null;
  if (f.troopsLeft === 0) return { player: second, step: 'troop' };
  if (g.troopsLeft === 0) return { player: first, step: 'troop' };
  return { player: f.troopsPlaced <= g.troopsPlaced ? first : second, step: 'troop' };
}

/** Cards `player` may place right now (empty if it is not their setup turn). */
export function setupEligible(s: AnyState, player: PlayerId): string[] {
  const n = nextSetupPlacer(s);
  if (!n || n.player !== player) return [];
  if (n.step === 'commander') return s.reserve[player].filter((id) => s.cards[id].kind === 'commander');
  return setupCounts(s, player).eligibleTroops;
}

/** Per-player setup counters for the `setup` PendingDecision. */
export function setupCounters(s: AnyState): {
  placed: Record<PlayerId, number>;
  commandersLeft: Record<PlayerId, number>;
  troopsLeft: Record<PlayerId, number>;
} {
  const placed = {} as Record<PlayerId, number>;
  const commandersLeft = {} as Record<PlayerId, number>;
  const troopsLeft = {} as Record<PlayerId, number>;
  for (const p of PLAYERS) {
    const c = setupCounts(s, p);
    placed[p] = c.placed;
    commandersLeft[p] = c.commandersLeft;
    troopsLeft[p] = c.troopsLeft;
  }
  return { placed, commandersLeft, troopsLeft };
}

/** Home-edge hexes that still have room for one more card. */
export function openSetupHexes(s: PublicState, player: PlayerId): string[] {
  return HOME_EDGE[player].filter((h) => hasRoom(s, h, 1));
}

/** `preferred` if it has room, else the open home-edge hex holding the fewest cards (side hexes first). */
export function setupHexWithRoom(s: PublicState, player: PlayerId, preferred: string): string {
  if (hasRoom(s, preferred, 1)) return preferred;
  const open = openSetupHexes(s, player);
  const n = (h: string) => s.stacks[h]?.length ?? 0;
  return [...open].sort((a, b) => n(a) - n(b))[0] ?? preferred;
}
