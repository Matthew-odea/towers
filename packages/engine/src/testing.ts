// Testing helpers: build play-phase states from a compact description and force dice.
// Exported from the package as `testing` (import { testing } from '@towers/engine').
import { CHARACTERS, buildAllCards, buildArmy, waysToRoll } from './cards';
import { applyAction } from './core';
import { ALL_HEXES, HOME_EDGE, TOWER, isHex } from './hex';
import { nextSetupPlacer, setupEligible, setupHexWithRoom } from './setup';
import { seedRng } from './rng';
import { PLAYERS, emptyTurn, isPlayer } from './state';
import type {
  Action,
  CpActionType,
  GameEvent,
  HexKey,
  MatchState,
  PlayerId,
  Terrain,
} from './types';

/**
 * Resolves a card reference to a full card id. Accepted forms:
 * - a full id: "red-light-7", "black-archer-venli"
 * - "<player>:<code>" where code is one of
 *   L7 / light7 (Light Infantry 7), H4 / heavy4 (Heavy Infantry 4),
 *   A1 A2 / archer1 archer2, V1 V2 / cavalry1 cavalry2, K1 K2 / commander1 commander2,
 *   S1 S2 / shard1 shard2 / shardbearer1, W / wit,
 *   or a character name ("red:dalinar", "black:venli").
 */
export function card(ref: string, player?: PlayerId): string {
  const all = buildAllCards();
  if (all[ref]) return ref;
  let p: PlayerId | undefined = player;
  let code = ref;
  const m = /^(red|black)[:.](.+)$/.exec(ref);
  if (m) {
    p = m[1] as PlayerId;
    code = m[2];
  }
  if (!p) throw new Error(`card(): cannot tell the owner of "${ref}" (use "red:L7" style)`);
  const c = code.toLowerCase();
  const ch = CHARACTERS[p];
  let mm: RegExpExecArray | null;
  if ((mm = /^(l|light)(\d+)$/.exec(c))) return check(`${p}-light-${mm[2]}`, ref, all);
  if ((mm = /^(h|heavy)(\d+)$/.exec(c))) return check(`${p}-heavy-${mm[2]}`, ref, all);
  if ((mm = /^(a|archer)([12])$/.exec(c))) return `${p}-archer-${ch.archer[+mm[2] - 1]}`;
  if ((mm = /^(v|cav|cavalry)([12])$/.exec(c))) return `${p}-cavalry-${ch.cavalry[+mm[2] - 1]}`;
  if ((mm = /^(k|cmd|commander)([12])$/.exec(c))) return `${p}-commander-${ch.commander[+mm[2] - 1]}`;
  if ((mm = /^(s|shard|shardbearer)([12])$/.exec(c))) return `${p}-shardbearer-${ch.shardbearer[+mm[2] - 1]}`;
  if (c === 'w' || c === 'wit') return `${p}-wit-hoid`;
  const byChar = Object.values(all).find((x) => x.owner === p && x.character === c);
  if (byChar) return byChar.id;
  throw new Error(`card(): unknown card reference "${ref}"`);
}

function check(id: string, ref: string, all: Record<string, unknown>): string {
  if (!all[id]) throw new Error(`card(): unknown card reference "${ref}"`);
  return id;
}

/** Resolves a list of card references. */
export function cards(...refs: string[]): string[] {
  return refs.map((r) => card(r));
}

export interface TestStateSpec {
  seed?: string;
  /** Terrain overrides. Default: Towers at their hexes, every other hex Plains. */
  terrain?: Partial<Record<HexKey, Terrain>>;
  /** Cards on the board per hex (card refs, see `card()`). A hex must hold one player's cards only. */
  board?: Record<HexKey, string[]>;
  /** Destroyed cards (refs). */
  destroyed?: string[];
  /**
   * Where unlisted cards go: 'reserve' (default) or 'destroyed'. Unlisted Commanders always go
   * to Reserve (inert there: they cannot be Deployed/Reinforced) so Decapitation is not triggered.
   */
  unlisted?: 'reserve' | 'destroyed';
  /** Player whose turn it is (default 'red'). */
  current?: PlayerId;
  /** CP left this turn (default 4). */
  cp?: number;
  /** CP already spent per action type this turn (for the 3-CP cap). */
  spent?: Partial<Record<CpActionType, number>>;
  /** Fortified hexes; owner is whoever holds the hex. */
  fortified?: HexKey[];
  /** Cards (refs) that moved / arrived this turn (blocks Fortify). */
  moved?: string[];
  /** Cards (refs) that entered a Mountain this turn (cannot leave this turn). */
  mountainLocked?: string[];
  /** Cavalry (refs) that just made a 2-hex Plains move as the previous action (charge pending). */
  charge?: string[];
  round?: number;
  roundWins?: Partial<Record<PlayerId, number>>;
  towerCount?: Partial<Record<PlayerId, number>>;
  /** First player of round 1 (default 'red'); the current round's starter follows the alternation. */
  round1Starter?: PlayerId;
  turnNumber?: number;
  /** Forced upcoming dice values, consumed before the RNG. */
  dice?: number[];
}

/** Builds a play-phase MatchState from a compact description. Throws on inconsistent specs. */
export function buildState(spec: TestStateSpec = {}): MatchState {
  const seed = spec.seed ?? 'test';
  const all = buildAllCards();
  const terrain: Record<HexKey, Terrain> = {};
  for (const h of ALL_HEXES) terrain[h] = 'plains';
  for (const p of PLAYERS) terrain[TOWER[p]] = 'tower';
  for (const [h, t] of Object.entries(spec.terrain ?? {})) {
    if (!isHex(h)) throw new Error(`buildState: bad hex "${h}"`);
    terrain[h] = t!;
  }
  const stacks: Record<HexKey, string[]> = {};
  const placed = new Set<string>();
  for (const [h, refs] of Object.entries(spec.board ?? {})) {
    if (!isHex(h)) throw new Error(`buildState: bad hex "${h}"`);
    if (refs.length === 0) continue;
    const ids = refs.map((r) => card(r));
    const owners = new Set(ids.map((id) => all[id].owner));
    if (owners.size > 1) throw new Error(`buildState: hex ${h} mixes both players' cards`);
    for (const id of ids) {
      if (placed.has(id)) throw new Error(`buildState: ${id} placed twice`);
      placed.add(id);
    }
    stacks[h] = ids;
  }
  const destroyedIds = new Set((spec.destroyed ?? []).map((r) => card(r)));
  for (const id of destroyedIds) if (placed.has(id)) throw new Error(`buildState: ${id} is both on the board and destroyed`);
  const reserve: Record<PlayerId, string[]> = { red: [], black: [] };
  const destroyed: Record<PlayerId, string[]> = { red: [], black: [] };
  for (const p of PLAYERS) {
    for (const c of buildArmy(p)) {
      if (placed.has(c.id)) continue;
      if (destroyedIds.has(c.id)) destroyed[p].push(c.id);
      else if (spec.unlisted === 'destroyed' && c.kind !== 'commander') destroyed[p].push(c.id);
      else reserve[p].push(c.id);
    }
  }
  const fortified: Record<HexKey, PlayerId> = {};
  for (const h of spec.fortified ?? []) {
    const st = stacks[h];
    if (!st) throw new Error(`buildState: cannot fortify empty hex ${h}`);
    fortified[h] = all[st[0]].owner;
  }
  const current = spec.current ?? 'red';
  if (!isPlayer(current)) throw new Error('buildState: bad current player');
  const round = spec.round ?? 1;
  const r1 = spec.round1Starter ?? 'red';
  const turn = emptyTurn(current, spec.turnNumber ?? 1);
  turn.cp = spec.cp ?? 4;
  for (const [k, v] of Object.entries(spec.spent ?? {})) turn.spent[k as CpActionType] = v!;
  turn.arrived = (spec.moved ?? []).map((r) => card(r));
  turn.mountainLocked = (spec.mountainLocked ?? []).map((r) => card(r));
  turn.charge = spec.charge ? spec.charge.map((r) => card(r)) : null;
  return {
    schema: 1,
    seq: 0,
    seed,
    rng: seedRng(seed),
    diceQueue: [...(spec.dice ?? [])],
    names: { red: 'Red', black: 'Black' },
    cards: all,
    phase: 'play',
    round,
    roundWins: { red: spec.roundWins?.red ?? 0, black: spec.roundWins?.black ?? 0 },
    roundResults: [],
    round1Starter: r1,
    roundStarter: round % 2 === 1 ? r1 : r1 === 'red' ? 'black' : 'red',
    winner: null,
    terrain,
    stacks,
    reserve,
    destroyed,
    fortified,
    towerCount: { red: spec.towerCount?.red ?? 0, black: spec.towerCount?.black ?? 0 },
    setup: {
      red: { placements: [] },
      black: { placements: [] },
    },
    turn,
    engagement: null,
  };
}

/** Returns a copy of `state` with `values` appended to the forced-dice queue. */
export function forceDice(state: MatchState, ...values: number[]): MatchState {
  for (const v of values) if (!Number.isInteger(v) || v < 1 || v > 6) throw new Error(`forceDice: bad die value ${v}`);
  return { ...state, diceQueue: [...state.diceQueue, ...values] };
}

/** Applies an action and throws (with the engine's error message) if it is rejected. */
export function mustApply(state: MatchState, action: Action): { state: MatchState; events: GameEvent[] } {
  const r = applyAction(state, action);
  if (!r.ok) throw new Error(`Action ${action.type} rejected: ${r.error}`);
  return { state: r.state, events: r.events };
}

/** Applies several actions in order (throwing on the first rejection); returns final state and all events. */
export function applyAll(state: MatchState, actions: Action[]): { state: MatchState; events: GameEvent[] } {
  let s = state;
  const events: GameEvent[] = [];
  for (const a of actions) {
    const r = mustApply(s, a);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

/** Expects rejection; returns the error message (throws if the action was accepted). */
export function mustReject(state: MatchState, action: Action): string {
  const r = applyAction(state, action);
  if (r.ok) throw new Error(`Action ${action.type} was unexpectedly accepted`);
  return r.error;
}

/** Events of one type, typed. */
export function eventsOf<T extends GameEvent['type']>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/** Planned setup placements per player, in order, as [cardRef, hex]. */
export type SetupPlan = Partial<Record<PlayerId, [string, HexKey][]>>;

const FILL_KIND_ORDER = ['light', 'heavy', 'archer', 'cavalry', 'shardbearer'];

/**
 * Plays the current round's setup to completion (RULINGS §4 order) and returns the play-phase
 * state plus every event. On each setup turn the acting player uses the first entry of their plan
 * that is legal for the current step. When their plan has nothing usable, Commanders go on their
 * Tower and troops are filled with the least useful eligible card (Light Infantry 2, 3, 4, 10, 5,
 * 9, ... then Heavy Infantry in the same order) on HOME_EDGE[p][0] (red "-2,2", black "0,-2")
 * until it holds 4 cards, then on the emptiest home-edge hex with room.
 * Every player always places 6 troops if they have them (setup turns cannot be skipped).
 */
export function completeSetup(state: MatchState, plan: SetupPlan = {}): { state: MatchState; events: GameEvent[] } {
  let s = state;
  const events: GameEvent[] = [];
  const queue: Record<PlayerId, [string, HexKey][]> = {
    red: (plan.red ?? []).map(([r, h]) => [card(r), h]),
    black: (plan.black ?? []).map(([r, h]) => [card(r), h]),
  };
  const round = s.round;
  for (let guard = 0; guard < 40 && s.phase === 'setup' && s.round === round; guard++) {
    const n = nextSetupPlacer(s);
    if (!n) break;
    const p = n.player;
    const eligible = setupEligible(s, p);
    const i = queue[p].findIndex(([id]) => eligible.includes(id));
    let cardId: string;
    let hex: HexKey;
    if (i >= 0) {
      [cardId, hex] = queue[p][i];
      queue[p].splice(i, 1);
    } else if (n.step === 'commander') {
      cardId = eligible[0];
      hex = TOWER[p];
    } else {
      const kindOrder = (id: string) => FILL_KIND_ORDER.indexOf(s.cards[id].kind);
      const ways = (id: string) => (s.cards[id].rank ? waysToRoll(s.cards[id].rank!) : 0);
      cardId = [...eligible].sort(
        (a, b) => kindOrder(a) - kindOrder(b) || ways(a) - ways(b) || (s.cards[a].rank ?? 0) - (s.cards[b].rank ?? 0),
      )[0];
      hex = setupHexWithRoom(s, p, HOME_EDGE[p][0]);
    }
    const r = mustApply(s, { type: 'setupPlace', player: p, placements: [{ cardId, hex }] });
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}
