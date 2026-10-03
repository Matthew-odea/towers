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
import { HOME_EDGE, TOWER, neighbors } from '../hex';
import { hexOf } from '../state';
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

function decide(s: AnyState, me: PlayerId, d: PendingDecision, w: Tuning): Action[] {
  switch (d.kind) {
    case 'setup':
      return [smartSetup(s, me, w)];
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

function smartSetup(s: AnyState, me: PlayerId, w: Tuning): Action {
  const avail = s.reserve[me];
  const kind = (id: string) => s.cards[id].kind;
  const ways = (id: string) => activationWays(s.cards[id]);
  const tower = TOWER[me];
  // Corner first, so both seats break ties the same (point-symmetric) way.
  const sides = HOME_EDGE[me]
    .filter((h) => h !== tower)
    .sort((a, b) => (neighbors(a).length - neighbors(b).length) * (w.setupCorner ? 1 : -1));
  const plainsAround = (h: string) => neighbors(h).filter((n) => s.terrain[n] === 'plains').length;
  const strikeHex = sides[0] && sides[1] && plainsAround(sides[1]) > plainsAround(sides[0]) ? sides[1] : sides[0] ?? tower;
  const placements: { cardId: string; hex: string }[] = [];
  for (const id of avail) if (kind(id) === 'commander') placements.push({ cardId: id, hex: tower });
  const others = avail.filter((id) => kind(id) !== 'commander' && kind(id) !== 'wit');
  const used = new Set<string>();
  // Two Heavy Infantry escorts on the Tower (cheap Fortify), best activators first.
  const escorts = others
    .filter((id) => kind(id) === 'heavy')
    .sort((a, b) => ways(b) - ways(a))
    .slice(0, 2);
  if (escorts.length < 2) {
    for (const id of others.filter((x) => kind(x) === 'light').sort((a, b) => ways(b) - ways(a))) {
      if (escorts.length >= 2) break;
      escorts.push(id);
    }
  }
  for (const id of escorts) {
    placements.push({ cardId: id, hex: tower });
    used.add(id);
  }
  // Strike group: Shardbearers, Cavalry, Archers, then the most reliable infantry.
  const pri: Record<string, number> = { shardbearer: 40, cavalry: 30, archer: 25, light: 0, heavy: 0 };
  const strike = others
    .filter((id) => !used.has(id))
    .sort((a, b) => (pri[kind(b)] ?? 0) + ways(b) - ((pri[kind(a)] ?? 0) + ways(a)))
    .slice(0, 6 - escorts.length);
  for (const id of strike) placements.push({ cardId: id, hex: strikeHex });
  return { type: 'setupPlace', player: me, placements };
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
