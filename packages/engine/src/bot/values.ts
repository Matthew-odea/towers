// Card values and activation tables used by the smart bot.
import { cardActivates, waysToRoll } from '../cards';
import { ALL_ROLLS } from '../combat';
import type { Card } from '../types';

/** Utility of winning (or losing) the current round, in card-value points. */
export const ROUND_VALUE = 80;
/** Base value of a Commander while its partner is still alive (the last one is worth ROUND_VALUE more). */
export const COMMANDER_VALUE = 20;

/** How much a card is worth keeping alive (persisting losses count across rounds). */
export function baseValue(c: Card): number {
  switch (c.kind) {
    case 'light':
      return 1.6 + waysToRoll(c.rank!);
    case 'heavy':
      return 2.3 + waysToRoll(c.rank!);
    case 'archer':
      return 8;
    case 'cavalry':
      return 7.5;
    case 'shardbearer':
      return 10;
    case 'wit':
      return 5.5;
    case 'commander':
      return COMMANDER_VALUE;
  }
}

const maskCache = new Map<string, Uint8Array>();

/** 36-entry activation table (index = (die0-1)*6 + die1-1) for a card; Wit uses the declared number. */
export function actMask(c: Card, wit: number | null = null): Uint8Array {
  const key = c.kind === 'wit' ? `wit:${wit}` : c.kind === 'light' || c.kind === 'heavy' ? `inf:${c.rank}` : c.kind;
  let m = maskCache.get(key);
  if (!m) {
    m = new Uint8Array(36);
    ALL_ROLLS.forEach((d, i) => {
      m![i] = cardActivates(c, d, wit) ? 1 : 0;
    });
    maskCache.set(key, m);
  }
  return m;
}

/** Number of the 36 rolls on which the card activates (Wit: its best case, 6). */
export function activationWays(c: Card): number {
  if (c.kind === 'wit') return 6;
  const m = actMask(c);
  let n = 0;
  for (let i = 0; i < 36; i++) n += m[i];
  return n;
}

export const DICE_TOTAL: Uint8Array = Uint8Array.from(ALL_ROLLS.map(([a, b]) => a + b));
export const DICE_DOUBLE: Uint8Array = Uint8Array.from(ALL_ROLLS.map(([a, b]) => (a === b ? 1 : 0)));

/**
 * Best Wit number given the other committed cards' coverage: the total that activates on the
 * most rolls not already covered (ties go to the total closest to 7).
 */
export function bestWitNumber(others: readonly Uint8Array[]): number {
  let best = 7;
  let bestGain = -1;
  for (let t = 2; t <= 12; t++) {
    let gain = 0;
    for (let i = 0; i < 36; i++) {
      if (DICE_TOTAL[i] !== t) continue;
      if (!others.some((m) => m[i])) gain++;
    }
    const score = gain * 10 - Math.abs(7 - t) * 0.1;
    if (score > bestGain) {
      bestGain = score;
      best = t;
    }
  }
  return best;
}
