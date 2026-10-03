// Shared validation helpers. All return an error message or null.
import { cardName } from './cards';
import { CP_CAP_PER_TYPE, getCard } from './state';
import type { CpActionType, PlayerId, PublicState } from './types';

/** Handler context. In dry-run mode handlers validate and return before mutating anything. */
export interface HandlerCtx {
  s: import('./types').MatchState;
  events: import('./types').GameEvent[];
  dryRun: boolean;
}

export const CP_TYPE_LABEL: Record<CpActionType, string> = {
  move: 'Move',
  engage: 'Engage',
  deploy: 'Deploy',
  withdraw: 'Withdraw',
  fortify: 'Fortify',
  reinforce: 'Reinforce',
  spawnWit: 'Spawn Wit',
};

export function playerLabel(p: PlayerId): string {
  return p === 'red' ? 'Red' : 'Black';
}

export function label(s: PublicState, id: string): string {
  const c = getCard(s, id);
  return c ? cardName(c) : `card "${id}"`;
}

/** It is `player`'s turn, in the play phase, with no engagement in progress. */
export function requireFreeTurn(s: PublicState, player: PlayerId): string | null {
  if (s.phase === 'matchOver') return 'The match is over.';
  if (s.phase === 'setup') return 'The round is still in setup.';
  if (!s.turn) return 'No turn is in progress.';
  if (s.turn.player !== player) return `It is ${playerLabel(s.turn.player)}'s turn, not ${playerLabel(player)}'s.`;
  if (s.engagement) return 'An engagement is in progress; finish it first.';
  return null;
}

/** Can the current player spend `cost` CP on `type`? */
export function checkCost(s: PublicState, type: CpActionType, cost: number): string | null {
  const t = s.turn;
  if (!t) return 'No turn is in progress.';
  if (t.cp < cost) return `${CP_TYPE_LABEL[type]} costs ${cost} CP but only ${t.cp} CP ${t.cp === 1 ? 'is' : 'are'} left.`;
  if (t.spent[type] + cost > CP_CAP_PER_TYPE) {
    return `At most ${CP_CAP_PER_TYPE} CP may be spent on ${CP_TYPE_LABEL[type]} per turn (${t.spent[type]} already spent).`;
  }
  return null;
}

export function spend(s: PublicState, type: CpActionType, cost: number): void {
  const t = s.turn!;
  t.cp -= cost;
  t.spent[type] += cost;
}

/** Validates an id list: an array of unique strings with min..max entries. */
export function checkIdList(v: unknown, min: number, max: number, what: string): string | null {
  if (!Array.isArray(v)) return `${what} must be an array of card ids.`;
  if (v.some((x) => typeof x !== 'string')) return `${what} must contain only card id strings.`;
  if (new Set(v).size !== v.length) return `${what} contains duplicate card ids.`;
  if (v.length < min || v.length > max) {
    if (max === Infinity) return `${what} must contain at least ${min} card${min === 1 ? '' : 's'}.`;
    return min === max ? `${what} must contain exactly ${min} card${min === 1 ? '' : 's'}.` : `${what} must contain ${min}–${max} cards.`;
  }
  return null;
}

/** Every id is a card owned by `player`. */
export function checkOwned(s: PublicState, player: PlayerId, ids: string[]): string | null {
  for (const id of ids) {
    const c = getCard(s, id);
    if (!c) return `Unknown card "${id}".`;
    if (c.owner !== player) return `${label(s, id)} (${id}) belongs to ${playerLabel(c.owner)}.`;
  }
  return null;
}

export function checkWitNumber(v: unknown): string | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 2 || v > 12) return 'Wit needs a declared number from 2 to 12.';
  return null;
}
