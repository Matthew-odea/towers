// Hard bot: the strongest level. Answers every PendingDecision; every candidate is validated
// with the engine and, failing all, the medium bot's choice is used.
// Contract: return a legal action for `player`, or null when `player` has nothing to decide.
// Never concede. Pure: no Node APIs, no I/O.
import { pendingDecision, validateAction } from '../../core';
import type { Action, AnyState, PlayerId } from '../../types';
import type { Rand } from '../random';
import { chooseSmartAction } from '../smart';
import { type HardConfig, type HardOverrides, mergeConfig } from './config';
import { hardRetreat } from './fight';
import { hardSetup } from './setup';
import { hardTurn } from './turn';

export { DEFAULT_HARD, type HardConfig } from './config';

export function chooseHardAction(state: AnyState, player: PlayerId, rand: Rand): Action | null {
  return chooseHardActionWith(state, player, rand, {});
}

/** As chooseHardAction, with configuration overrides (simulation / tuning experiments). */
export function chooseHardActionWith(
  state: AnyState,
  player: PlayerId,
  rand: Rand,
  overrides: HardOverrides,
): Action | null {
  const d = pendingDecision(state);
  if (!(d.players as PlayerId[]).includes(player)) return null;
  if (d.kind === 'matchOver') return null;
  const cfg: HardConfig = mergeConfig(overrides);
  let candidates: Action[] = [];
  try {
    switch (d.kind) {
      case 'setup': {
        if (cfg.setup.mode === 'medium') break;
        const a = hardSetup(state, player, cfg);
        candidates = a ? [a] : [];
        break;
      }
      case 'retreat':
        if (cfg.fight.retreat) candidates = [hardRetreat(state, player, d.hexes, cfg)];
        break;
      case 'turn':
        if (cfg.turnMode !== 'medium') candidates = hardTurn(state, player, cfg);
        break;
      default:
        candidates = [];
    }
  } catch {
    candidates = [];
  }
  for (const a of candidates) if (validateAction(state, a) === null) return a;
  return chooseSmartAction(state, player, rand, cfg.tuning);
}
