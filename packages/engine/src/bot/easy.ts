// Easy bot: a sensible beginner. It advances, attacks when it has adjacent cards, defends with
// what is there, deploys reserves and sets up on its back rank, but it never computes odds,
// ignores Flanking/Surround/Cavalry charges, rarely Fortifies/Reinforces, uses rerolls naively
// and sometimes ends its turn with CP unspent.
// Contract: return a legal action for `player`, or null when `player` has nothing to decide.
// Never concedes. Pure and deterministic given `rand`. No Node APIs.
import { resolveDice } from '../combat';
import { pendingDecision, validateAction } from '../core';
import { HOME_EDGE, TOWER, distance, neighbors, other } from '../hex';
import { eligibleAttackers, engageableTargets, fortifiableHexes, reserveDeployable } from '../queries';
import { nextSetupPlacer, setupEligible, setupHexWithRoom } from '../setup';
import { hexesOf, stackAt } from '../state';
import type { Action, AnyState, HexKey, PendingDecision, PlayerId } from '../types';
import type { Rand } from './random';
import { chooseSmartAction } from './smart';
import { activationWays, baseValue } from './values';

/** Chance per decision of just ending the turn (leaving CP unspent). */
const P_END = 0.12;
const P_FORTIFY = 0.04;

function pick<T>(xs: readonly T[], rand: Rand): T {
  return xs[Math.floor(rand() * xs.length)];
}

export function chooseEasyAction(state: AnyState, player: PlayerId, rand: Rand): Action | null {
  const d = pendingDecision(state);
  if (!(d.players as PlayerId[]).includes(player) || d.kind === 'matchOver') return null;
  let a: Action | null = null;
  try {
    a = decide(state, player, d, rand);
  } catch {
    a = null;
  }
  if (a && validateAction(state, a) === null) return a;
  return chooseSmartAction(state, player, rand);
}

function decide(s: AnyState, me: PlayerId, d: PendingDecision, rand: Rand): Action | null {
  switch (d.kind) {
    case 'setup':
      return easySetup(s, me, rand);
    case 'turn':
      return easyTurn(s, me, rand);
    case 'defend':
      return easyDefend(s, me, d.eligible, d.max);
    case 'reroll':
      return easyReroll(s, me, d.options, rand);
    case 'pressOrBreak':
      return { type: rand() < 0.5 ? 'press' : 'breakOff', player: me };
    case 'casualties':
      return easyCasualties(s, me, d.owner, d.count, d.eligible);
    case 'retreat':
      return easyRetreat(me, d.hexes, rand);
    default:
      return null;
  }
}

const kindOf = (s: AnyState, id: string) => s.cards[id].kind;
const worth = (s: AnyState, id: string) => baseValue(s.cards[id]);

// ---------------------------------------------------------------------------
// Setup: Commanders on the Tower, a couple of escorts there, the rest spread along the back rank.

function easySetup(s: AnyState, me: PlayerId, rand: Rand): Action | null {
  const n = nextSetupPlacer(s);
  if (!n || n.player !== me) return null;
  const eligible = setupEligible(s, me);
  if (eligible.length === 0) return null;
  const place = (cardId: string, hex: HexKey): Action => ({ type: 'setupPlace', player: me, placements: [{ cardId, hex: setupHexWithRoom(s, me, hex) }] });
  const tower = TOWER[me];
  if (n.step === 'commander') return place(eligible[0], tower);
  const mine = s.setup[me].placements.filter((p) => kindOf(s, p.cardId) !== 'commander');
  const atTower = mine.filter((p) => p.hex === tower).length;
  const byWays = [...eligible].sort((a, b) => activationWays(s.cards[b]) - activationWays(s.cards[a]));
  if (atTower < 2) return place(byWays[0], tower);
  // Remaining troops: favour the two side hexes, with a little randomness.
  const sides = HOME_EDGE[me].filter((h) => h !== tower);
  const hex = rand() < 0.85 ? pick(sides, rand) : tower;
  return place(pick(byWays.slice(0, 4), rand), hex);
}

// ---------------------------------------------------------------------------
// Turn

function easyTurn(s: AnyState, me: PlayerId, rand: Rand): Action | null {
  const end: Action = { type: 'endTurn', player: me };
  const t = s.turn;
  if (!t || t.cp <= 0) return end;
  if (rand() < P_END) return end;

  const attack = tryEngage(s, me, rand);
  if (attack) return attack;

  if (reserveDeployable(s, me).length > 0 && rand() < 0.75) {
    const id = pick(reserveDeployable(s, me), rand);
    const a: Action = { type: 'deploy', player: me, cardIds: [id] };
    if (validateAction(s, a) === null) return a;
  }
  if (rand() < P_FORTIFY) {
    const f = fortifiableHexes(s, me);
    if (f.length > 0) return { type: 'fortify', player: me, hex: pick(f, rand) };
  }
  return tryMove(s, me, rand) ?? end;
}

function tryEngage(s: AnyState, me: PlayerId, rand: Rand): Action | null {
  const foeTower = TOWER[other(me)];
  const targets = engageableTargets(s, me);
  type Opt = { target: HexKey; ids: string[]; score: number };
  const opts: Opt[] = [];
  for (const target of targets) {
    const pool = eligibleAttackers(s, me, target)
      .map((o) => o.cardId)
      .filter((id) => kindOf(s, id) !== 'commander' && kindOf(s, id) !== 'wit');
    if (pool.length === 0) continue;
    const ids = pool.sort((a, b) => activationWays(s.cards[b]) - activationWays(s.cards[a])).slice(0, 3);
    const foes = stackAt(s, target).length;
    const edge = ids.length - foes;
    // Simple head count, not odds.
    const take = edge >= 0 ? 0.9 : edge === -1 ? 0.35 : 0.08;
    if (rand() > take) continue;
    opts.push({ target, ids, score: (target === foeTower ? 3 : 0) + edge + rand() });
  }
  if (opts.length === 0) return null;
  opts.sort((a, b) => b.score - a.score);
  const o = opts[0];
  return { type: 'engage', player: me, target: o.target, cardIds: o.ids };
}

function tryMove(s: AnyState, me: PlayerId, rand: Rand): Action | null {
  const goal = TOWER[other(me)];
  const hexes = hexesOf(s, me);
  type Opt = { from: HexKey; ids: string[]; to: HexKey; gain: number };
  const opts: Opt[] = [];
  for (const from of hexes) {
    const stack = stackAt(s, from);
    const cmds = stack.filter((id) => kindOf(s, id) === 'commander');
    let movers = stack.filter((id) => kindOf(s, id) !== 'commander');
    // Commanders stay home with a couple of escorts.
    if (cmds.length > 0) movers = movers.slice(0, Math.max(0, movers.length - 2));
    movers = movers.slice(0, 3);
    if (movers.length === 0) continue;
    for (const to of neighbors(from)) {
      const gain = distance(from, goal) - distance(to, goal);
      if (gain <= 0) continue;
      const a: Action = { type: 'move', player: me, cardIds: movers, from, path: [to] };
      if (validateAction(s, a) === null) opts.push({ from, ids: movers, to, gain });
    }
  }
  if (opts.length === 0) return null;
  const best = Math.max(...opts.map((o) => o.gain + (stackAt(s, o.from).length > 0 ? 0 : 0)));
  const good = opts.filter((o) => o.gain === best);
  const o = pick(rand() < 0.7 ? good : opts, rand);
  return { type: 'move', player: me, cardIds: o.ids, from: o.from, path: [o.to] };
}

// ---------------------------------------------------------------------------
// Engagement decisions

function easyDefend(s: AnyState, me: PlayerId, eligible: string[], max: number): Action {
  const nonCmd = eligible.filter((id) => kindOf(s, id) !== 'commander' && kindOf(s, id) !== 'wit');
  const rest = eligible.filter((id) => !nonCmd.includes(id));
  const sorted = nonCmd.sort((a, b) => activationWays(s.cards[b]) - activationWays(s.cards[a]));
  const ids = [...sorted, ...rest.filter((id) => kindOf(s, id) !== 'wit'), ...rest.filter((id) => kindOf(s, id) === 'wit')].slice(
    0,
    Math.max(1, max),
  );
  const hasWit = ids.some((id) => kindOf(s, id) === 'wit');
  return { type: 'defend', player: me, cardIds: ids, ...(hasWit ? { witNumber: 7 } : {}) };
}

function easyReroll(
  s: AnyState,
  me: PlayerId,
  options: ({ source: 'commander'; commanderId: string } | { source: 'disadvantage' })[],
  rand: Rand,
): Action {
  const pass: Action = { type: 'passReroll', player: me };
  const e = s.engagement;
  if (!e || !e.dice || !e.modifiers) return pass;
  const r = resolveDice(s, { ...e, modifiers: e.modifiers }, e.dice);
  const losing = r.outcome === 'stale' ? false : r.winner !== null ? r.winner !== me : true;
  if (!losing) return pass;
  const die: 0 | 1 = rand() < 0.5 ? 0 : 1;
  const c = options.find((o) => o.source === 'commander') as { source: 'commander'; commanderId: string } | undefined;
  if (c) return { type: 'reroll', player: me, source: 'commander', commanderId: c.commanderId, die };
  if (options.some((o) => o.source === 'disadvantage')) return { type: 'reroll', player: me, source: 'disadvantage', die };
  return pass;
}

function easyCasualties(s: AnyState, me: PlayerId, owner: PlayerId, count: number, eligible: string[]): Action {
  // Value with Commanders counting as the most precious.
  const v = (id: string) => (kindOf(s, id) === 'commander' ? 1000 : worth(s, id));
  const sorted = [...eligible].sort((a, b) => (owner === me ? v(a) - v(b) : v(b) - v(a)));
  return { type: 'chooseCasualties', player: me, cardIds: sorted.slice(0, count) };
}

function easyRetreat(me: PlayerId, hexes: HexKey[], rand: Rand): Action {
  if (hexes.length === 0 || rand() < 0.4) return { type: 'retreat', player: me, to: null };
  const home = TOWER[me];
  const best = [...hexes].sort((a, b) => distance(a, home) - distance(b, home))[0];
  return { type: 'retreat', player: me, to: best };
}

