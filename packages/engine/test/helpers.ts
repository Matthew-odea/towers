import { testing, type Action, type GameEvent, type MatchState, type PlayerId } from '../src/index';

export const { buildState, mustApply, mustReject, applyAll, card, cards, forceDice, eventsOf, completeSetup } = testing;

/** Short alias: c('red:L7') -> 'red-light-7'. */
export const c = (ref: string) => card(ref);

/** Applies actions in order (throws on rejection). */
export function run(s: MatchState, ...actions: Action[]): { state: MatchState; events: GameEvent[] } {
  return applyAll(s, actions);
}

export function engage(player: PlayerId, target: string, refs: string[], witNumber?: number): Action {
  return { type: 'engage', player, target, cardIds: refs.map(c), ...(witNumber !== undefined ? { witNumber } : {}) };
}

export function defend(player: PlayerId, refs: string[], witNumber?: number): Action {
  return { type: 'defend', player, cardIds: refs.map(c), ...(witNumber !== undefined ? { witNumber } : {}) };
}

export function types(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}
