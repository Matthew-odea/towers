// Hard bot engagement decisions that depend on the position (Combat Retreat, casualty choice).
// Dice-level decisions (defend, rerolls, Press) are exact in the medium bot and reused as-is.
import type { Action, AnyState, PlayerId } from '../../types';
import { IDX } from '../geo';
import { makeCtx, posFromState, retreatModel } from '../model';
import type { HardConfig } from './config';
import { evaluateHard, hctx } from './evaluate';

export function hardRetreat(s: AnyState, me: PlayerId, hexes: string[], cfg: HardConfig): Action {
  const e = s.engagement!;
  const ctx = hctx(makeCtx(s, me, cfg.tuning), cfg);
  const pos = posFromState(s);
  const from = IDX[e.target];
  let best: string | null = null;
  let bestV = evaluateHard(ctx, pos) + 0.01;
  for (const h of hexes) {
    const v = evaluateHard(ctx, retreatModel(ctx, pos, from, IDX[h]));
    if (v > bestV) {
      bestV = v;
      best = h;
    }
  }
  return { type: 'retreat', player: me, to: best };
}
