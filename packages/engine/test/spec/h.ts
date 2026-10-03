// Shared helpers for the independent spec suite. Only uses the public API (src/index.ts).
import { testing, pendingDecision, type Action, type GameEvent, type MatchState, type PlayerId } from '../../src/index';

export const { buildState, mustApply, mustReject, applyAll, card, cards, forceDice, eventsOf } = testing;
export { pendingDecision };
export const c = (ref: string) => card(ref);
export const cs = (...refs: string[]) => cards(...refs);

export type R = { state: MatchState; events: GameEvent[] };
export const pend = (s: MatchState): any => pendingDecision(s);
export const rd = (s: MatchState, p: PlayerId) => ({ ...s, view: p });

/** Apply a list of actions, accumulating events. */
export function seq(r: R | MatchState, ...actions: Action[]): R {
  let cur: R = 'events' in r ? (r as R) : { state: r as MatchState, events: [] };
  for (const a of actions) {
    const n = mustApply(cur.state, a);
    cur = { state: n.state, events: [...cur.events, ...n.events] };
  }
  return cur;
}

/** Attacker (current turn player) engages and the defender commits (unless auto-defended). */
export function fight(
  s: MatchState,
  o: { target: string; atk: string[]; def?: string[]; witA?: number; witD?: number },
): R {
  const player = s.turn!.player;
  const other: PlayerId = player === 'red' ? 'black' : 'red';
  let r = seq(s, { type: 'engage', player, target: o.target, cardIds: cs(...o.atk), witNumber: o.witA });
  const p = pend(r.state);
  if (p.kind === 'defend') {
    const ids = o.def ? cs(...o.def) : p.eligible.slice(0, p.max);
    r = seq(r, { type: 'defend', player: other, cardIds: ids, witNumber: o.witD });
  }
  return r;
}

export interface SettleOpts {
  /** casualty chooser: receives the pending decision, returns card ids */
  pick?: (p: any) => string[] | undefined;
  retreat?: string | null | ((p: any) => string | null);
  press?: boolean;
  /** stop at reroll decisions instead of passing */
  stopAtReroll?: boolean;
}
/** Drive passive decisions (reroll passes, casualties, retreat, press/break) until something else is pending. */
export function settle(r: R, o: SettleOpts = {}): R & { log: any[] } {
  let cur = r;
  const log: any[] = [];
  for (let i = 0; i < 60; i++) {
    const p = pend(cur.state);
    if (p.kind === 'reroll' && !o.stopAtReroll) cur = seq(cur, { type: 'passReroll', player: p.player });
    else if (p.kind === 'casualties') {
      log.push(p);
      const ids = o.pick?.(p) ?? p.eligible.slice(0, p.count);
      cur = seq(cur, { type: 'chooseCasualties', player: p.player, cardIds: ids });
    } else if (p.kind === 'retreat') {
      const to = typeof o.retreat === 'function' ? o.retreat(p) : (o.retreat ?? null);
      cur = seq(cur, { type: 'retreat', player: p.player, to });
    } else if (p.kind === 'pressOrBreak') {
      cur = seq(cur, { type: o.press ? 'press' : 'breakOff', player: p.player } as Action);
    } else break;
  }
  return { ...cur, log };
}

export const last = <T extends GameEvent['type']>(events: GameEvent[], t: T) => {
  const l = eventsOf(events, t);
  return l[l.length - 1];
};
export const started = (events: GameEvent[]) => eventsOf(events, 'engagementStarted')[0];
export const resolvedEv = (events: GameEvent[]) => eventsOf(events, 'resolved');
export const has = (arr: string[] | undefined, x: string) => (arr ?? []).includes(x);

export const RED_TOWER = '-1,2';
export const BLACK_TOWER = '1,-2';

/** Legal minimal setup placement: both Commanders on the player's home edge. */
export function placeCommanders(s: MatchState, p: PlayerId, extra: { cardId: string; hex: string }[] = []): Action {
  const edge = p === 'red' ? ['-1,2', '-2,2'] : ['1,-2', '0,-2'];
  return {
    type: 'setupPlace',
    player: p,
    placements: [{ cardId: c(`${p}:K1`), hex: edge[0] }, { cardId: c(`${p}:K2`), hex: edge[1] }, ...extra],
  };
}
