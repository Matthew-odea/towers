// Bot dispatcher. Keep this thin: strategy lives in sibling modules.
import { makeRandom } from '../rng';
import type { Action, AnyState, PlayerId } from '../types';
import { chooseEasyAction } from './easy';
import { chooseHardAction } from './hard/index';
import { type Rand, chooseRandomAction } from './random';
import { chooseSmartAction } from './smart';
import type { Tuning } from './tuning';

/**
 * Bot difficulty levels.
 * - 'easy': a weaker bot for new players (src/bot/easy.ts).
 * - 'medium' (default): the heuristic search bot (src/bot/smart.ts).
 * - 'hard': the strongest bot (src/bot/hard/).
 * - 'random': uniformly-ish random legal actions (testing / fuzzing).
 */
export type BotLevel = 'easy' | 'medium' | 'hard' | 'random';

export const BOT_LEVELS: readonly BotLevel[] = ['easy', 'medium', 'hard', 'random'];

/** Maps a level name to a BotLevel ('smart' is a legacy alias of 'medium'); null if unknown. */
export function normalizeBotLevel(level: unknown): BotLevel | null {
  if (level === 'smart') return 'medium';
  return typeof level === 'string' && (BOT_LEVELS as readonly string[]).includes(level) ? (level as BotLevel) : null;
}

export interface BotOptions {
  /** Default 'medium'. 'smart' is accepted as a legacy alias of 'medium'. */
  level?: BotLevel | 'smart';
  /** Randomness source; defaults to a deterministic generator derived from the state. */
  rand?: Rand;
  /** Medium bot weight overrides (simulation / tuning only). */
  tuning?: Partial<Tuning>;
}

function defaultRand(s: AnyState, player: PlayerId): Rand {
  const t = s.turn;
  return makeRandom(`bot:${player}:${s.round}:${s.seq}:${t ? `${t.player}${t.number}${t.cp}` : 'setup'}`);
}

/**
 * Chooses an action for `player`, or null when `player` has no pending decision.
 * The returned action is always legal for the given state. Never concedes.
 * Works on a MatchState or a PlayerView.
 */
export function chooseBotAction(state: AnyState, player: PlayerId, opts: BotOptions = {}): Action | null {
  const rand = opts.rand ?? defaultRand(state, player);
  switch (normalizeBotLevel(opts.level ?? 'medium') ?? 'medium') {
    case 'random':
      return chooseRandomAction(state, player, rand);
    case 'easy':
      return chooseEasyAction(state, player, rand);
    case 'hard':
      return chooseHardAction(state, player, rand);
    case 'medium':
    default:
      return chooseSmartAction(state, player, rand, opts.tuning);
  }
}
