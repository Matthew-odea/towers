// applyAction, validateAction, viewFor, pendingDecision.
import { autoEndTurn, dispatch } from './actions';
import { defenderMax, rerollOptions } from './engagement';
import { nextSetupPlacer, setupCounters, setupEligible, setupHexes } from './setup';
import { CP_ACTION_TYPES, CP_CAP_PER_TYPE, deepClone, isPlayer, stackAt } from './state';
import type {
  Action,
  AnyState,
  ApplyResult,
  CpActionType,
  MatchState,
  PendingDecision,
  PlayerId,
  PlayerView,
} from './types';
import type { HandlerCtx } from './validate';

function isMatchState(s: AnyState): s is MatchState {
  return Array.isArray((s as MatchState).rng);
}

/**
 * Applies an action. Never throws and never mutates `state`; invalid actions return
 * `{ ok: false, error }` with a human-readable reason.
 */
export function applyAction(state: MatchState, action: Action): ApplyResult {
  try {
    if (!state || typeof state !== 'object' || !isMatchState(state)) return { ok: false, error: 'Invalid match state.' };
    const err0 = dispatch({ s: state, events: [], dryRun: true }, action);
    if (err0) return { ok: false, error: err0 };
    const ctx: HandlerCtx = { s: deepClone(state), events: [], dryRun: false };
    const err = dispatch(ctx, action);
    if (err) return { ok: false, error: err };
    autoEndTurn(ctx);
    ctx.s.seq += 1;
    return { ok: true, state: ctx.s, events: ctx.events };
  } catch (e) {
    return { ok: false, error: `Internal engine error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Returns null if `action` is legal right now, else the reason it is not. Works on a PlayerView too. */
export function validateAction(state: AnyState, action: Action): string | null {
  try {
    return dispatch({ s: state as MatchState, events: [], dryRun: true }, action);
  } catch (e) {
    return `Internal engine error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** True if `action` is legal right now. */
export function isLegal(state: AnyState, action: Action): boolean {
  return validateAction(state, action) === null;
}

/** The state as `player` may see it: no RNG/seed/forced dice. Everything else is public (setup is open). */
export function viewFor(state: AnyState, player: PlayerId): PlayerView {
  const c = deepClone(state) as Partial<MatchState> & Partial<PlayerView>;
  delete c.rng;
  delete c.seed;
  delete c.diceQueue;
  const view = c as PlayerView;
  view.viewer = player;
  return view;
}

/** Who must act now and what they must decide. Works on MatchState or PlayerView. */
export function pendingDecision(s: AnyState): PendingDecision {
  if (s.phase === 'matchOver') return { kind: 'matchOver', players: [], winner: s.winner! };
  if (s.phase === 'setup') {
    // Setup always ends inside the action that completes it, so `n` is only null for a malformed state.
    const n = nextSetupPlacer(s) ?? { player: s.roundStarter, step: 'troop' as const };
    return {
      kind: 'setup',
      players: [n.player],
      player: n.player,
      step: n.step,
      eligible: setupEligible(s, n.player),
      hexes: setupHexes(n.player),
      ...setupCounters(s),
    };
  }
  const e = s.engagement;
  if (e) {
    switch (e.stage) {
      case 'defend': {
        const eligible = [...stackAt(s, e.target)];
        return {
          kind: 'defend',
          players: [e.defender],
          player: e.defender,
          target: e.target,
          eligible,
          min: 1,
          max: Math.min(defenderMax(s, e.target), eligible.length),
          witEligible: eligible.some((id) => s.cards[id].kind === 'wit'),
        };
      }
      case 'reroll': {
        const p = e.window!.toAct;
        return { kind: 'reroll', players: [p], player: p, dice: [e.dice![0], e.dice![1]], options: rerollOptions(s, p) };
      }
      case 'pressOrBreak':
        return { kind: 'pressOrBreak', players: [e.attacker], player: e.attacker, staleCount: e.staleCount };
      case 'casualties': {
        const st = e.casualtySteps[0];
        return {
          kind: 'casualties',
          players: [st.chooser],
          player: st.chooser,
          owner: st.owner,
          count: st.count,
          eligible: [...st.eligible],
          reason: st.reason,
        };
      }
      case 'retreat':
        return { kind: 'retreat', players: [e.defender], player: e.defender, from: e.target, hexes: [...e.retreatHexes] };
    }
  }
  const t = s.turn!;
  const capRemaining = {} as Record<CpActionType, number>;
  for (const k of CP_ACTION_TYPES) capRemaining[k] = Math.max(0, Math.min(t.cp, CP_CAP_PER_TYPE - t.spent[k]));
  return { kind: 'turn', players: [t.player], player: t.player, cp: t.cp, capRemaining };
}

/** Players who must act now (empty when the match is over). */
export function actingPlayers(s: AnyState): PlayerId[] {
  return [...pendingDecision(s).players];
}

export function mustAct(s: AnyState, player: PlayerId): boolean {
  return isPlayer(player) && actingPlayers(s).includes(player);
}
