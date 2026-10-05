// Smart heuristic bot: answers every PendingDecision with an evaluated choice.
//
// - Turns: a two-ply search over the bot's own actions in a light board model, scoring each
//   resulting position with `evaluate` (threats, Tower pressure, opportunities) and each
//   possible engagement with its exact expected value (36 dice outcomes, reroll minimax,
//   stale-roll recursion).
// - Engagement decisions (defend, reroll, press, casualties, retreat) use the same evaluator on
//   the live engagement.
// Every returned action is validated with the engine; on any doubt it falls back to the
// random-legal bot.
import { computeModifiers } from '../combat';
import { pendingDecision, validateAction } from '../core';
import { HOME_EDGE, TOWER, neighbors, other, parseHex } from '../hex';
import { nextSetupPlacer, setupEligible, setupHexWithRoom } from '../setup';
import { hasRoom, hexOf } from '../state';
import type { Action, AnyState, Engagement, PendingDecision, PlayerId } from '../types';
import { evaluate } from './evaluate';
import { DEFAULT_TUNING, type Tuning } from './tuning';
import { Fight, type FCard, type FightSpec, type Res } from './fight';
import { IDX } from './geo';
import {
  type Ctx,
  type Pos,
  applyModel,
  clearBonusFor,
  engageOptions,
  fcard,
  genActions,
  makeCtx,
  now,
  posFromState,
  quickEngageValue,
  retreatModel,
} from './model';
import { type Rand, chooseRandomAction } from './random';
import { ROUND_VALUE, actMask, activationWays, bestWitNumber } from './values';

/**
 * Search budget in deterministic work units (≈ 250–300 per ms): past it, level-1 candidates get
 * the cheap engagement estimate and no further level-2 expansion happens.
 */
const BUDGET_WORK = 4000;
/** Hard stop for evaluating level-1 candidates (work units), and a wall-clock safety net (ms). */
const HARD_WORK = 20000;
const HARD_MS = 150;

export function chooseSmartAction(
  s: AnyState,
  player: PlayerId,
  rand: Rand,
  tuning: Partial<Tuning> = {},
): Action | null {
  const w: Tuning = { ...DEFAULT_TUNING, ...tuning };
  const d = pendingDecision(s);
  if (!(d.players as PlayerId[]).includes(player)) return null;
  if (d.kind === 'matchOver') return null;
  let candidates: Action[] = [];
  try {
    candidates = decide(s, player, d, w);
  } catch {
    candidates = [];
  }
  for (const a of candidates) if (validateAction(s, a) === null) return a;
  return chooseRandomAction(s, player, rand);
}

/** The medium bot (alias of the smart heuristic search bot). */
export const chooseMediumAction = chooseSmartAction;

function decide(s: AnyState, me: PlayerId, d: PendingDecision, w: Tuning): Action[] {
  switch (d.kind) {
    case 'setup': {
      const a = smartSetup(s, me, w);
      return a ? [a] : [];
    }
    case 'turn':
      return smartTurn(s, me, w);
    case 'defend':
      return [smartDefend(s, me, d.eligible, d.max, w)];
    case 'reroll':
      return [smartReroll(s, me, d.options, w)];
    case 'pressOrBreak':
      return [smartPress(s, me, w)];
    case 'casualties':
      return [smartCasualties(s, me, d.owner, d.count, d.eligible, w)];
    case 'retreat':
      return [smartRetreat(s, me, d.hexes, w)];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Setup

/** Left/right flank of a home-edge side hex (-1 / +1, 0 for a Tower): same sign = same side of the board. */
function flank(h: string): number {
  const [q, r] = parseHex(h);
  return Math.sign(2 * q + r);
}

/**
 * One setup placement (setup is open and turn-based, RULINGS §4). The plan:
 * - Commanders both go on the Tower (the hardest hex to reach, and escorts join them there).
 * - The first troops are Heavy Infantry escorts on the Tower (cheap Fortify); a third escort
 *   joins when the opponent has massed a large strike stack.
 * - The rest form one strike group on a side hex, chosen once the escorts are down so it can
 *   react to the opponent's visible placements: prefer the flank the opponent left weaker and
 *   more open Plains around the hex. Once chosen it never moves.
 */
function smartSetup(s: AnyState, me: PlayerId, w: Tuning): Action | null {
  const n = nextSetupPlacer(s);
  if (!n || n.player !== me) return null;
  const tower = TOWER[me];
  const eligible = setupEligible(s, me);
  if (eligible.length === 0) return null;
  const place = (cardId: string, hex: string): Action => ({ type: 'setupPlace', player: me, placements: [{ cardId, hex: setupHexWithRoom(s, me, hex) }] });
  if (n.step === 'commander') return place(eligible[0], tower);

  const kind = (id: string) => s.cards[id].kind;
  const ways = (id: string) => activationWays(s.cards[id]);
  const foe = other(me);
  const mine = s.setup[me].placements.filter((p) => kind(p.cardId) !== 'commander');
  const escortsPlaced = mine.filter((p) => p.hex === tower).length;
  const strikePlaced = mine.filter((p) => p.hex !== tower);
  // Opponent's visible troops per hex.
  const foeTroops: Record<string, number> = {};
  for (const p of s.setup[foe].placements) {
    if (kind(p.cardId) === 'commander') continue;
    const pri = kind(p.cardId) === 'shardbearer' || kind(p.cardId) === 'cavalry' ? 1.5 : 1;
    foeTroops[p.hex] = (foeTroops[p.hex] ?? 0) + pri;
  }
  const foeSideMax = Math.max(0, ...HOME_EDGE[foe].filter((h) => h !== TOWER[foe]).map((h) => foeTroops[h] ?? 0));
  const wantEscorts = foeSideMax >= 4 ? 3 : 2;

  if (escortsPlaced < wantEscorts && hasRoom(s, tower, 1)) {
    const heavy = eligible.filter((id) => kind(id) === 'heavy').sort((a, b) => ways(b) - ways(a));
    const light = eligible.filter((id) => kind(id) === 'light').sort((a, b) => ways(b) - ways(a));
    const escort = heavy[0] ?? light[0];
    if (escort) return place(escort, tower);
  }
  // Strike group: Shardbearers, Cavalry, Archers, then the most reliable infantry.
  let strikeHex = strikePlaced[0]?.hex;
  if (!strikeHex) {
    const plainsAround = (h: string) => neighbors(h).filter((x) => s.terrain[x] === 'plains').length;
    const foeOnFlank = (h: string) =>
      HOME_EDGE[foe].filter((x) => x !== TOWER[foe] && flank(x) === flank(h)).reduce((acc, x) => acc + (foeTroops[x] ?? 0), 0);
    const score = (h: string) => plainsAround(h) - 0.6 * foeOnFlank(h);
    const sides = HOME_EDGE[me].filter((h) => h !== tower);
    // Ties: point-symmetric for both seats (setupCorner flips which corner).
    const tie = (me === 'red' ? 1 : -1) * (w.setupCorner ? 1 : -1);
    strikeHex = sides.sort((a, b) => score(b) - score(a) || (flank(a) - flank(b)) * tie)[0] ?? tower;
  }
  const pri: Record<string, number> = { shardbearer: 40, cavalry: 30, archer: 25, light: 0, heavy: 0 };
  const best = [...eligible].sort((a, b) => (pri[kind(b)] ?? 0) + ways(b) - ((pri[kind(a)] ?? 0) + ways(a)))[0];
  return place(best, strikeHex);
}

// ---------------------------------------------------------------------------
// Turn search

function smartTurn(s: AnyState, me: PlayerId, w: Tuning): Action[] {
  const end: Action = { type: 'endTurn', player: me };
  const t = s.turn;
  if (!t || t.cp <= 0) return [end];
  const ctx = makeCtx(s, me, w);
  const pos0 = posFromState(s);
  const v0 = evaluate(ctx, pos0);
  // Long rounds: accept slightly losing engagements to break stalemates.
  const minEngage = ctx.w.minEngage - ctx.w.urgencyEngage * ctx.urgency;
  const scored: { a: Action; score: number }[] = [{ a: end, score: v0 }];
  for (const e of engageOptions(ctx, pos0)) {
    if (e.ev > minEngage) scored.push({ a: e.action, score: v0 + e.ev - minEngage + ctx.w.minEngage });
  }
  const bestEngage = (p: Pos) => {
    let b = 0;
    for (const e of engageOptions(ctx, p)) if (e.ev - ctx.w.minEngage > b) b = e.ev - ctx.w.minEngage;
    return b;
  };
  const level1: { a: Action; p: Pos; score: number }[] = [];
  for (const a of genActions(ctx, pos0)) {
    if (ctx.work > HARD_WORK || now() - ctx.t0 > HARD_MS) break;
    const p1 = applyModel(ctx, pos0, a);
    if (!p1) continue;
    const s1 = evaluate(ctx, p1);
    const eng = ctx.work > BUDGET_WORK ? Math.max(0, quickEngageValue(ctx, p1) - ctx.w.minEngage) : bestEngage(p1);
    level1.push({ a, p: p1, score: s1 + eng - ctx.w.minGain });
  }
  level1.sort((x, y) => y.score - x.score);
  const expand = level1.slice(0, ctx.w.expand);
  for (const n of expand) {
    if (ctx.work > BUDGET_WORK) break;
    if (n.p.cp <= 0) continue;
    for (const a2 of genActions(ctx, n.p)) {
      const p2 = applyModel(ctx, n.p, a2);
      if (!p2) continue;
      const s2 = evaluate(ctx, p2) + Math.max(0, quickEngageValue(ctx, p2) - ctx.w.minEngage) - ctx.w.minGain;
      if (s2 > n.score) n.score = s2;
    }
  }
  for (const n of level1) scored.push({ a: n.a, score: n.score });
  scored.sort((x, y) => y.score - x.score);
  const out = scored.slice(0, 8).map((x) => x.a);
  if (!out.includes(end)) out.push(end);
  return out;
}

// ---------------------------------------------------------------------------
// Live engagement helpers

function liveCard(ctx: Ctx, s: AnyState, id: string, wit: number | null, ranged: boolean): FCard {
  const h = hexOf(s, id);
  return fcard(ctx, id, h ? IDX[h] : -1, wit, ranged);
}

function liveSpec(ctx: Ctx, s: AnyState, e: Engagement, defIds = e.defenderCards, defWit = e.defenderWit): FightSpec {
  const mods =
    defIds === e.defenderCards && e.modifiers
      ? e.modifiers
      : computeModifiers(s, {
          target: e.target,
          attackerCards: e.attackerCards,
          rangedArchers: e.rangedArchers,
          defenderCards: defIds,
          charge: e.charge,
        });
  return {
    atk: e.attackerCards.map((id) => liveCard(ctx, s, id, e.attackerWit, e.rangedArchers.includes(id))),
    def: defIds.map((id) => liveCard(ctx, s, id, defWit, false)),
    advA: mods.attacker.advantage.length > 0,
    advD: mods.defender.advantage.length > 0,
    disA: mods.attacker.disadvantage.length > 0,
    disD: mods.defender.disadvantage.length > 0,
    cmdAliveA: ctx.cmdAlive[e.attacker],
    cmdAliveD: ctx.cmdAlive[e.defender],
    defStack: (s.stacks[e.target] ?? []).length,
    clearBonus: clearBonusFor(ctx, e.attacker, IDX[e.target]),
  };
}

function liveRes(s: AnyState, e: Engagement, defIds = e.defenderCards): Res {
  const isCmd = (id: string) => s.cards[id].kind === 'commander';
  return {
    aCmd: e.attackerCards.filter((id) => isCmd(id) && !e.commanderRerollsUsed.includes(id)).length,
    dCmd: defIds.filter((id) => isCmd(id) && !e.commanderRerollsUsed.includes(id)).length,
    aF: !e.forcedRerollUsed[e.attacker],
    dF: !e.forcedRerollUsed[e.defender],
  };
}

function combosUpTo<T>(xs: T[], maxK: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, cur: T[]) => {
    if (cur.length) out.push([...cur]);
    if (cur.length >= maxK) return;
    for (let i = start; i < xs.length; i++) {
      cur.push(xs[i]);
      rec(i + 1, cur);
      cur.pop();
    }
  };
  rec(0, []);
  return out;
}

// ---------------------------------------------------------------------------
// Defend

function smartDefend(s: AnyState, me: PlayerId, eligible: string[], max: number, w: Tuning): Action {
  const e = s.engagement!;
  const ctx = makeCtx(s, me, w);
  const ways = (id: string) => activationWays(s.cards[id]);
  // Keep the 7 most useful cards (best activators; Commanders kept as reroll sources).
  const pool = [...eligible]
    .sort((a, b) => ways(b) - ways(a) || ctx.val[a] - ctx.val[b])
    .slice(0, 7);
  for (const id of eligible) {
    if (pool.length >= 8) break;
    if (!pool.includes(id) && s.cards[id].kind === 'commander') pool.push(id);
  }
  type Cand = { ids: string[]; wit: number | null; v: number };
  const cands: Cand[] = [];
  let evals = 0;
  for (const sub of combosUpTo(pool, max)) {
    const hasWit = sub.some((id) => s.cards[id].kind === 'wit');
    const witOpts = hasWit
      ? [
          ...new Set([
            bestWitNumber(sub.filter((id) => s.cards[id].kind !== 'wit').map((id) => actMask(s.cards[id]))),
            7,
            ...(e.attackerWit ? [e.attackerWit] : []),
          ]),
        ]
      : [null];
    for (const wit of witOpts) {
      const f = new Fight(liveSpec(ctx, s, e, sub, wit));
      const v = evals++ > 80 ? f.quick().ev : f.value(liveRes(s, e, sub), 0, true);
      // Small tie-breaker: commit fewer valuable cards when equal.
      const tie = sub.reduce((acc, id) => acc + ctx.val[id], 0) * 1e-4;
      cands.push({ ids: sub, wit, v: v + tie });
    }
  }
  cands.sort((a, b) => a.v - b.v);
  // Exact (full reroll play across presses) for the best few.
  let best: Cand | null = null;
  for (const c of cands.slice(0, 3)) {
    const v = new Fight(liveSpec(ctx, s, e, c.ids, c.wit)).value(liveRes(s, e, c.ids), 0);
    if (!best || v < best.v) best = { ...c, v };
  }
  const ids = best ? best.ids : [eligible[0]];
  const wit = best ? best.wit : s.cards[eligible[0]].kind === 'wit' ? 7 : null;
  return { type: 'defend', player: me, cardIds: ids, ...(wit !== null ? { witNumber: wit } : {}) };
}

// ---------------------------------------------------------------------------
// Rerolls and Press / Break Off

function smartReroll(
  s: AnyState,
  me: PlayerId,
  options: ({ source: 'commander'; commanderId: string } | { source: 'disadvantage' })[],
  w: Tuning,
): Action {
  const pass: Action = { type: 'passReroll', player: me };
  const e = s.engagement!;
  if (!e.dice || !e.window) return pass;
  const ctx = makeCtx(s, me, w);
  const f = new Fight(liveSpec(ctx, s, e));
  const i = (e.dice[0] - 1) * 6 + (e.dice[1] - 1);
  const toAct: 0 | 1 = me === e.attacker ? 0 : 1;
  const choices = f.windowChoices(liveRes(s, e), i, e.staleCount, toAct, e.window.passes);
  const sign = toAct === 0 ? 1 : -1;
  let best = choices[0];
  for (const c of choices) if (sign * (c.value - best.value) > 1e-9) best = c;
  if (best.kind === 'pass') return pass;
  if (best.kind === 'commander') {
    const o = options.find((x) => x.source === 'commander') as { source: 'commander'; commanderId: string } | undefined;
    if (!o) return pass;
    return { type: 'reroll', player: me, source: 'commander', commanderId: o.commanderId, die: best.die };
  }
  if (!options.some((x) => x.source === 'disadvantage')) return pass;
  return { type: 'reroll', player: me, source: 'disadvantage', die: best.die };
}

function smartPress(s: AnyState, me: PlayerId, w: Tuning): Action {
  const e = s.engagement!;
  const ctx = makeCtx(s, me, w);
  const v = new Fight(liveSpec(ctx, s, e)).value(liveRes(s, e), e.staleCount);
  return { type: v > ctx.w.press ? 'press' : 'breakOff', player: me };
}

// ---------------------------------------------------------------------------
// Casualties

function smartCasualties(s: AnyState, me: PlayerId, owner: PlayerId, count: number, eligible: string[], w: Tuning): Action {
  const e = s.engagement!;
  const ctx = makeCtx(s, me, w);
  const already = e.casualtiesChosen.filter((c) => c.owner === owner).flatMap((c) => c.cardIds);
  const stack = s.stacks[e.target] ?? [];
  const alive = ctx.cmdAlive[owner];
  const isDefender = owner === e.defender;
  const clear = clearBonusFor(ctx, e.attacker, IDX[e.target]);
  const valueOf = (id: string) => liveCard(ctx, s, id, null, false).v;
  const score = (set: string[]) => {
    let v = 0;
    let cmd = already.filter((id) => s.cards[id].kind === 'commander').length;
    for (const id of set) {
      v += valueOf(id);
      if (s.cards[id].kind === 'commander') cmd++;
    }
    if (alive > 0 && cmd >= alive) v += ROUND_VALUE;
    if (isDefender) {
      const left = stack.filter((id) => !already.includes(id) && !set.includes(id));
      if (left.length === 0) v += clear;
    }
    return v;
  };
  const sets = combosUpTo(eligible, count).filter((x) => x.length === count);
  const mine = owner === me;
  let best = sets[0] ?? eligible.slice(0, count);
  let bestV = score(best);
  for (const set of sets) {
    const v = score(set);
    if (mine ? v < bestV : v > bestV) {
      best = set;
      bestV = v;
    }
  }
  return { type: 'chooseCasualties', player: me, cardIds: best };
}

// ---------------------------------------------------------------------------
// Combat Retreat

function smartRetreat(s: AnyState, me: PlayerId, hexes: string[], w: Tuning): Action {
  const e = s.engagement!;
  const ctx = makeCtx(s, me, w);
  const pos = posFromState(s);
  const from = IDX[e.target];
  let best: string | null = null;
  let bestV = evaluate(ctx, pos) + 0.01;
  for (const h of hexes) {
    const v = evaluate(ctx, retreatModel(ctx, pos, from, IDX[h]));
    if (v > bestV) {
      bestV = v;
      best = h;
    }
  }
  return { type: 'retreat', player: me, to: best };
}
