// Match / round / turn lifecycle.
import { buildAllCards, buildArmy } from './cards';
import { TOWER, other } from './hex';
import { nextFloat, seedRng } from './rng';
import {
  CP_PER_TURN,
  PLAYERS,
  ROUNDS_TO_WIN,
  TOWER_WIN_COUNT,
  type Ctx,
  emit,
  emptyTurn,
  generateTerrain,
  stackOwner,
} from './state';
import type { MatchState, PlayerId, RoundWinReason } from './types';

export interface CreateMatchOptions {
  /** Seed string for the PRNG (use a cryptographically random string on the server). */
  seed: string;
  names?: Partial<Record<PlayerId, string>>;
  /** Round-1 first player; random (from the seed) when omitted. */
  firstPlayer?: PlayerId;
}

export function createMatch(opts: CreateMatchOptions): MatchState {
  const seed = String(opts?.seed ?? '');
  const rng = seedRng(seed);
  const round1Starter: PlayerId =
    opts?.firstPlayer === 'red' || opts?.firstPlayer === 'black' ? opts.firstPlayer : nextFloat(rng) < 0.5 ? 'red' : 'black';
  const s: MatchState = {
    schema: 1,
    seq: 0,
    seed,
    rng,
    diceQueue: [],
    names: { red: opts?.names?.red ?? 'Red', black: opts?.names?.black ?? 'Black' },
    cards: buildAllCards(),
    phase: 'setup',
    round: 0,
    roundWins: { red: 0, black: 0 },
    roundResults: [],
    round1Starter,
    roundStarter: round1Starter,
    winner: null,
    terrain: {},
    stacks: {},
    reserve: { red: [], black: [] },
    destroyed: { red: [], black: [] },
    fortified: {},
    towerCount: { red: 0, black: 0 },
    setup: { red: { placements: [] }, black: { placements: [] } },
    turn: null,
    engagement: null,
  };
  const ctx: Ctx = { s, events: [] };
  startRound(ctx, 1);
  return s;
}

/** RULINGS §4 / §11.4: new terrain, all surviving cards (and Commanders) back to Reserve, setup phase. */
export function startRound(ctx: Ctx, round: number): void {
  const s = ctx.s;
  s.round = round;
  s.phase = 'setup';
  s.turn = null;
  s.engagement = null;
  s.stacks = {};
  s.fortified = {};
  s.towerCount = { red: 0, black: 0 };
  s.roundStarter = round % 2 === 1 ? s.round1Starter : other(s.round1Starter);
  for (const p of PLAYERS) {
    s.destroyed[p] = s.destroyed[p].filter((id) => s.cards[id].kind !== 'commander');
    const dead = new Set(s.destroyed[p]);
    s.reserve[p] = buildArmy(p)
      .map((c) => c.id)
      .filter((id) => !dead.has(id));
    s.setup[p] = { placements: [] };
  }
  s.terrain = generateTerrain(s);
  emit(ctx, { type: 'roundStarted', round, firstPlayer: s.roundStarter, terrain: { ...s.terrain } });
}

/** RULINGS §5 start of turn: (a) Tower count, (b) 4 CP, (c) trackers reset. */
export function startTurn(ctx: Ctx, player: PlayerId): void {
  const s = ctx.s;
  const number = s.turn ? s.turn.number + 1 : 1;
  s.turn = emptyTurn(player, number);
  const enemyTower = TOWER[other(player)];
  if (stackOwner(s, enemyTower) === player) {
    s.towerCount[player] += 1;
    emit(ctx, { type: 'towerCount', player, count: s.towerCount[player], hex: enemyTower });
    if (s.towerCount[player] >= TOWER_WIN_COUNT) {
      endRound(ctx, player, 'tower');
      return;
    }
  } else if (s.towerCount[player] !== 0) {
    s.towerCount[player] = 0;
    emit(ctx, { type: 'towerCount', player, count: 0, hex: enemyTower });
  }
  s.turn.cp = CP_PER_TURN;
  emit(ctx, { type: 'turnStarted', player, turn: number, cp: CP_PER_TURN });
}

export function endRound(ctx: Ctx, winner: PlayerId, reason: RoundWinReason): void {
  const s = ctx.s;
  s.roundWins[winner] += 1;
  s.roundResults.push({ round: s.round, winner, reason });
  s.engagement = null;
  s.turn = null;
  emit(ctx, { type: 'roundWon', round: s.round, winner, reason });
  if (s.roundWins[winner] >= ROUNDS_TO_WIN) {
    s.phase = 'matchOver';
    s.winner = winner;
    emit(ctx, { type: 'matchWon', winner, roundWins: { ...s.roundWins } });
    return;
  }
  startRound(ctx, s.round + 1);
}
