// Hard bot turn planning.
//
// Beam search over sequences of the bot's own CP spends in the medium bot's light board model,
// scored with the hard evaluator. Engagements are valued by their exact material value (36 dice
// outcomes, reroll minimax, Press recursion: ../fight.ts) plus the positional value of each
// casualty outcome (outcomes.ts), so "engage now", "move, then engage" and "move" plans are
// compared in the same units.
import type { Action, AnyState, PlayerId } from '../../types';
import { evaluate as evaluateMedium } from '../evaluate';
import { IDX } from '../geo';
import { type Ctx, type Pos, applyModel, engageOptions, genActions, makeCtx, now, posFromState, quickEngageValue } from '../model';
import type { HardConfig } from './config';
import { evaluateHard, hctx } from './evaluate';
import { type Outcome, engageEval } from './outcomes';

interface Leaf {
  first: Action;
  p: Pos;
  score: number;
}

/** Position after an engagement outcome (casualties removed, 1 CP spent on Engage). */
function applyOutcome(p: Pos, o: Outcome): Pos {
  const dead = [...o.deadAtk, ...o.deadDef];
  const q: Pos = { ...p, st: [...p.st], own: [...p.own], fort: [...p.fort], spent: { ...p.spent }, charge: null };
  q.cp -= 1;
  q.spent.engage += 1;
  if (dead.length) {
    for (let h = 0; h < q.st.length; h++) {
      if (!q.st[h].some((id) => dead.includes(id))) continue;
      q.st[h] = q.st[h].filter((id) => !dead.includes(id));
      if (q.st[h].length === 0) {
        q.own[h] = null;
        q.fort[h] = null;
      }
    }
  }
  return q;
}

export function hardTurn(s: AnyState, me: PlayerId, cfg: HardConfig): Action[] {
  const end: Action = { type: 'endTurn', player: me };
  const t = s.turn;
  if (!t || t.cp <= 0) return [end];
  const ctx = hctx(makeCtx(s, me, cfg.tuning), cfg);
  const evaluate = cfg.ev.on ? (p: Pos) => evaluateHard(ctx, p) : (p: Pos) => evaluateMedium(ctx, p);
  const w = ctx.w;
  const pos0 = posFromState(s);
  const v0 = evaluate(pos0);
  const over = () => ctx.work > cfg.work || now() - ctx.t0 > cfg.ms;

  const commanders = (owner: PlayerId) => {
    const out: string[] = [];
    for (const st of pos0.st) for (const id of st) if (ctx.cards[id].kind === 'commander' && ctx.cards[id].owner === owner) out.push(id);
    return out;
  };
  const myCmds = commanders(me);
  const foeCmds = commanders(ctx.foe);
  /** Outcomes that end the round by Decapitation (valued by the fight's material term alone). */
  const decides = (o: Outcome) =>
    (myCmds.length > 0 && myCmds.every((id) => o.deadAtk.includes(id))) ||
    (foeCmds.length > 0 && foeCmds.every((id) => o.deadDef.includes(id)));
  const bonus = (q: Pos) => (q.cp > 0 ? Math.max(0, quickEngageValue(ctx, q) - w.minEngage) : 0);
  /** Value of stopping at q (plus a cheap estimate of a further engagement). */
  const stop = (q: Pos) => evaluate(q) + bonus(q);
  /** Value of continuing from q with one more action. */
  const cont1 = (q: Pos) => {
    let b = stop(q);
    if (q.cp <= 0) return b;
    for (const a of genActions(ctx, q)) {
      const q1 = applyModel(ctx, q, a);
      if (!q1) continue;
      const v = stop(q1) - w.minGain;
      if (v > b) b = v;
    }
    return b;
  };
  /** Engagements available in p, each valued by material EV + positional change over its outcomes. */
  const engageValues = (p: Pos, base: number, cont: (q: Pos) => number) => {
    const out: { a: Action; v: number; ev: number }[] = [];
    for (const e of engageOptions(ctx, p)) {
      const a = e.action as Extract<Action, { type: 'engage' }>;
      const charge = !!p.charge && a.cardIds.some((id) => p.charge!.includes(id));
      const ee = engageEval(ctx, p, IDX[a.target], a.cardIds, a.witNumber ?? null, charge);
      if (!ee) continue;
      let v = base + ee.ev - cfg.engageMargin;
      for (const o of ee.outcomes) if (!decides(o)) v += o.p * (cont(applyOutcome(p, o)) - base);
      out.push({ a, v, ev: ee.ev });
    }
    return out;
  };

  const scored = new Map<Action, number>();
  const note = (a: Action, v: number) => {
    if (v > (scored.get(a) ?? -Infinity)) scored.set(a, v);
  };
  note(end, v0);
  // Engage now (one further action considered after each outcome).
  for (const e of engageValues(pos0, v0, cont1)) note(e.a, e.v);
  // Depth 1: every candidate; its value includes the best engagement right after it.
  let frontier: Leaf[] = [];
  for (const a of genActions(ctx, pos0)) {
    if (over()) break;
    const p1 = applyModel(ctx, pos0, a);
    if (!p1) continue;
    const base = evaluate(p1);
    let sc = base + bonus(p1);
    if (cfg.engageMode === 'outcomes') {
      for (const e of engageValues(p1, base, stop)) if (e.v > sc) sc = e.v;
    }
    sc -= w.minGain;
    frontier.push({ first: a, p: p1, score: sc });
    note(a, sc);
  }
  // Deeper: beam over further non-engage actions.
  for (let depth = 2; depth <= 4 && frontier.length; depth++) {
    frontier.sort((x, y) => y.score - x.score);
    const keep = frontier.slice(0, cfg.beam[depth - 1] ?? 4).filter((n) => n.p.cp > 0);
    const next: Leaf[] = [];
    for (const n of keep) {
      if (over()) break;
      for (const a of genActions(ctx, n.p)) {
        const p2 = applyModel(ctx, n.p, a);
        if (!p2) continue;
        const sc = stop(p2) - w.minGain * depth;
        next.push({ first: n.first, p: p2, score: sc });
        note(n.first, sc);
      }
    }
    frontier = next;
  }
  const out = [...scored.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map((x) => x[0]);
  if (!out.includes(end)) out.push(end);
  return out;
}
