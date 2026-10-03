// Bot dispatcher. Keep this thin: strategy lives in sibling modules.
import { makeRandom } from '../rng';
import type { Action, AnyState, PlayerId } from '../types';
import { type Rand, chooseRandomAction } from './random';
import { chooseSmartAction } from './smart';
import type { Tuning } from './tuning';

/** 'smart' (default): heuristic search bot. 'random': uniformly random legal actions. */
export type BotLevel = 'smart' | 'random';

export interface BotOptions {
  level?: BotLevel;
  /** Randomness source (random bot, and the smart bot's fallback); defaults to a deterministic generator derived from the state. */
  rand?: Rand;
  /** Smart bot weight overrides (simulation / tuning only). */
  tuning?: Partial<Tuning>;
}

function defaultRand(s: AnyState, player: PlayerId): Rand {
  const t = s.turn;
  return makeRandom(`bot:${player}:${s.round}:${s.seq}:${t ? `${t.player}${t.number}${t.cp}` : 'setup'}`);
}

/**
 * Chooses an action for `player`, or null when `player` has no pending decision.
 * The returned action is always legal for the given state. Never concedes.
 */
export function chooseBotAction(state: AnyState, player: PlayerId, opts: BotOptions = {}): Action | null {
  const rand = opts.rand ?? defaultRand(state, player);
  switch (opts.level ?? 'smart') {
    case 'random':
      return chooseRandomAction(state, player, rand);
    case 'smart':
    default:
      return chooseSmartAction(state, player, rand, opts.tuning);
  }
}
