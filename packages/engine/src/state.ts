// State helpers shared by rules, queries and view code.
import { ALL_HEXES, CENTRE, HOME_EDGE, TOWER, isHex, mirror, other } from './hex';
import { nextFloat, nextInt } from './rng';
import type {
  Card,
  CpActionType,
  GameEvent,
  HexKey,
  MatchState,
  PlayerId,
  PublicState,
  Terrain,
  TurnState,
} from './types';

export const PLAYERS: readonly PlayerId[] = ['red', 'black'];
export const CP_PER_TURN = 4;
export const CP_CAP_PER_TYPE = 3;
export const TOWER_WIN_COUNT = 3;
export const ROUNDS_TO_WIN = 2;
export const MAX_SETUP_OTHERS = 6;
export const CP_ACTION_TYPES: readonly CpActionType[] = ['move', 'engage', 'deploy', 'withdraw', 'fortify', 'reinforce', 'spawnWit'];

export function isPlayer(p: unknown): p is PlayerId {
  return p === 'red' || p === 'black';
}

export function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function getCard(s: PublicState, id: string): Card | undefined {
  return Object.prototype.hasOwnProperty.call(s.cards, id) ? s.cards[id] : undefined;
}

export function stackAt(s: PublicState, hex: HexKey): string[] {
  return s.stacks[hex] ?? [];
}

export function stackOwner(s: PublicState, hex: HexKey): PlayerId | null {
  const st = s.stacks[hex];
  if (!st || st.length === 0) return null;
  return s.cards[st[0]].owner;
}

export type CardLocation =
  | { zone: 'board'; hex: HexKey }
  | { zone: 'reserve' }
  | { zone: 'destroyed' };

export function locate(s: PublicState, id: string): CardLocation | null {
  const card = getCard(s, id);
  if (!card) return null;
  for (const [hex, ids] of Object.entries(s.stacks)) if (ids.includes(id)) return { zone: 'board', hex };
  if (s.reserve[card.owner].includes(id)) return { zone: 'reserve' };
  if (s.destroyed[card.owner].includes(id)) return { zone: 'destroyed' };
  return null;
}

export function hexOf(s: PublicState, id: string): HexKey | null {
  for (const [hex, ids] of Object.entries(s.stacks)) if (ids.includes(id)) return hex;
  return null;
}

/** Hex is on the board and holds no cards of `player`'s enemy. */
export function enterable(s: PublicState, player: PlayerId, hex: HexKey): boolean {
  if (!isHex(hex)) return false;
  const o = stackOwner(s, hex);
  return o === null || o === player;
}

export function hexesOf(s: PublicState, player: PlayerId): HexKey[] {
  return ALL_HEXES.filter((h) => stackOwner(s, h) === player);
}

export function isFortified(s: PublicState, hex: HexKey): boolean {
  const f = s.fortified[hex];
  return f !== undefined && f === stackOwner(s, hex);
}

export function commandersOf(s: PublicState, player: PlayerId): string[] {
  return Object.values(s.cards)
    .filter((c) => c.owner === player && c.kind === 'commander')
    .map((c) => c.id);
}

export function emptyTurn(player: PlayerId, number: number): TurnState {
  return {
    player,
    number,
    cp: 0,
    spent: { move: 0, engage: 0, deploy: 0, withdraw: 0, fortify: 0, reinforce: 0, spawnWit: 0 },
    arrived: [],
    mountainLocked: [],
    charge: null,
  };
}

// ---------------------------------------------------------------------------
// Mutation helpers (operate on a cloned MatchState).

export interface Ctx {
  s: MatchState;
  events: GameEvent[];
}

export function emit(ctx: Ctx, e: GameEvent): void {
  ctx.events.push(e);
}

function removeFromStack(s: PublicState, id: string): HexKey | null {
  for (const [hex, ids] of Object.entries(s.stacks)) {
    const i = ids.indexOf(id);
    if (i >= 0) {
      ids.splice(i, 1);
      if (ids.length === 0) delete s.stacks[hex];
      return hex;
    }
  }
  return null;
}

function addToStack(s: PublicState, id: string, hex: HexKey): void {
  (s.stacks[hex] ??= []).push(id);
}

function markArrival(s: PublicState, ids: string[], hex: HexKey): void {
  const t = s.turn;
  if (!t) return;
  for (const id of ids) {
    if (!t.arrived.includes(id)) t.arrived.push(id);
    if (s.terrain[hex] === 'mountain' && !t.mountainLocked.includes(id)) t.mountainLocked.push(id);
  }
}

/** Moves cards (from wherever they are on the board or in reserve) into `hex`, tracking arrival / Mountain lock. */
export function placeCards(s: PublicState, ids: string[], hex: HexKey): void {
  for (const id of ids) {
    const card = s.cards[id];
    if (removeFromStack(s, id) === null) {
      const r = s.reserve[card.owner];
      const i = r.indexOf(id);
      if (i >= 0) r.splice(i, 1);
    }
    addToStack(s, id, hex);
  }
  markArrival(s, ids, hex);
}

export function toReserve(s: PublicState, ids: string[]): void {
  for (const id of ids) {
    removeFromStack(s, id);
    s.reserve[s.cards[id].owner].push(id);
  }
}

export function destroyCards(s: PublicState, ids: string[]): void {
  for (const id of ids) {
    removeFromStack(s, id);
    const owner = s.cards[id].owner;
    const r = s.reserve[owner];
    const i = r.indexOf(id);
    if (i >= 0) r.splice(i, 1);
    if (!s.destroyed[owner].includes(id)) s.destroyed[owner].push(id);
  }
}

/**
 * Housekeeping after anything changes the board: drop fortifications whose owner no longer
 * holds the hex, and reset Tower counts of players no longer on the enemy Tower.
 */
export function normalize(ctx: Ctx): void {
  const s = ctx.s;
  for (const [hex, owner] of Object.entries(s.fortified)) {
    if (stackOwner(s, hex) !== owner) {
      delete s.fortified[hex];
      emit(ctx, { type: 'fortifyEnded', player: owner, hex });
    }
  }
  for (const p of PLAYERS) {
    const enemyTower = TOWER[other(p)];
    if (s.towerCount[p] > 0 && stackOwner(s, enemyTower) !== p) {
      s.towerCount[p] = 0;
      emit(ctx, { type: 'towerCount', player: p, count: 0, hex: enemyTower });
    }
  }
}

// ---------------------------------------------------------------------------
// Dice and terrain.

export function rollDie(s: MatchState): number {
  while (s.diceQueue.length > 0) {
    const v = s.diceQueue.shift()!;
    if (Number.isInteger(v) && v >= 1 && v <= 6) return v;
  }
  return 1 + Math.floor(nextFloat(s.rng) * 6);
}

/** Point-symmetric terrain per RULINGS §3. */
export function generateTerrain(s: MatchState): Record<HexKey, Terrain> {
  const t: Record<HexKey, Terrain> = {};
  for (const p of PLAYERS) {
    for (const h of HOME_EDGE[p]) t[h] = h === TOWER[p] ? 'tower' : 'plains';
  }
  const centreOpts: Terrain[] = ['plains', 'forest', 'mountain'];
  t[CENTRE] = centreOpts[nextInt(s.rng, 3)];
  // Remaining 12 hexes form 6 symmetric pairs; take one representative per pair.
  const reps: HexKey[] = [];
  const seen = new Set<HexKey>();
  for (const h of ALL_HEXES) {
    if (t[h] !== undefined || seen.has(h)) continue;
    seen.add(h);
    seen.add(mirror(h));
    reps.push(h);
  }
  const kinds: Terrain[] = ['forest', 'forest', 'mountain', 'plains', 'plains', 'plains'];
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = nextInt(s.rng, i + 1);
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  reps.forEach((h, i) => {
    t[h] = kinds[i];
    t[mirror(h)] = kinds[i];
  });
  const ordered: Record<HexKey, Terrain> = {};
  for (const h of ALL_HEXES) ordered[h] = t[h];
  return ordered;
}
