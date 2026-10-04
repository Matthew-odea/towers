// Exact outcome distribution of an engagement in the light model (no rerolls), used to value
// the position after each outcome rather than only the material swing.
import type { PlayerId } from '../../types';
import { Fight, type FCard, type FightSpec } from '../fight';
import { HEX } from '../geo';
import {
  type AtkCard,
  type Ctx,
  type DefSet,
  type Pos,
  attackersOf,
  buildSpec,
  defenseSets,
} from '../model';
import { DICE_DOUBLE, DICE_TOTAL, ROUND_VALUE } from '../values';

export interface Outcome {
  p: number;
  deadAtk: string[];
  deadDef: string[];
}

export interface EngageEval {
  spec: FightSpec;
  def: DefSet;
  outcomes: Outcome[];
  /** Exact attacker material EV (rerolls included, no clear bonus). */
  ev: number;
}

/** Picks `n` of `pool` minimising (loser picks) or maximising (winner picks) the loser's loss. */
function pickSet(pool: FCard[], n: number, maximise: boolean, alive: number): string[] {
  if (n <= 0 || pool.length === 0) return [];
  if (n >= pool.length) return pool.map((c) => c.id);
  const score = (cs: FCard[]) => {
    let v = 0;
    let cmd = 0;
    for (const c of cs) {
      v += c.v;
      if (c.kind === 'commander') cmd++;
    }
    return v + (alive > 0 && cmd >= alive ? ROUND_VALUE : 0);
  };
  let best: FCard[] = [];
  let bestV = maximise ? -Infinity : Infinity;
  if (n === 1) {
    for (const c of pool) {
      const v = score([c]);
      if (maximise ? v > bestV : v < bestV) {
        bestV = v;
        best = [c];
      }
    }
  } else {
    for (let x = 0; x < pool.length; x++)
      for (let y = x + 1; y < pool.length; y++) {
        const v = score([pool[x], pool[y]]);
        if (maximise ? v > bestV : v < bestV) {
          bestV = v;
          best = [pool[x], pool[y]];
        }
      }
  }
  return best.map((c) => c.id);
}

/** Shardstrike with 2 casualties: the winner picks one (most valuable), the loser the other (cheapest). */
function shardSet(pool: FCard[], n: number, alive: number): string[] {
  if (n <= 1 || pool.length <= n) return pickSet(pool, n, true, alive);
  const first = pickSet(pool, 1, true, alive);
  const rest = pool.filter((c) => c.id !== first[0]);
  return [...first, ...pickSet(rest, 1, false, alive)];
}

interface Roll {
  stale: boolean;
  deadAtk: string[];
  deadDef: string[];
  u: number;
}

function rollTable(spec: FightSpec, staleAdv: boolean): Roll[] {
  const { atk, def } = spec;
  const atkShard = atk.some((c) => c.kind === 'shardbearer');
  const defShard = def.some((c) => c.kind === 'shardbearer');
  const atkNR = atk.filter((c) => !c.ranged);
  const out: Roll[] = [];
  for (let i = 0; i < 36; i++) {
    let aC = 0;
    for (const c of atk) aC += c.act[i];
    let dC = 0;
    let dArch = false;
    for (const c of def) {
      dC += c.act[i];
      if (c.act[i] && c.kind === 'archer') dArch = true;
    }
    const hi = DICE_TOTAL[i] >= 11;
    const dbl = DICE_DOUBLE[i] === 1;
    const advA = spec.advA;
    const advD = spec.advD || staleAdv;
    const a = aC + (advA && hi ? 1 : 0);
    const d = dC + (advD && hi ? 1 : 0);
    if (a === 0 && d === 0) {
      out.push({ stale: true, deadAtk: [], deadDef: [], u: 0 });
      continue;
    }
    let o: 'a' | 'd' | 'b';
    if (a > 0 && d === 0) o = 'a';
    else if (d > 0 && a === 0) o = 'd';
    else if (advA && !advD) o = 'a';
    else if (advD && !advA) o = 'd';
    else o = 'b';
    const atkPool = dArch ? atk : atkNR;
    let deadAtk: string[] = [];
    let deadDef: string[] = [];
    if (o === 'a') {
      const n = Math.min(a >= 2 ? 2 : 1, def.length);
      deadDef =
        advA && spec.disD ? pickSet(def, n, true, spec.cmdAliveD) : dbl && atkShard ? shardSet(def, n, spec.cmdAliveD) : pickSet(def, n, false, spec.cmdAliveD);
    } else if (o === 'd') {
      const n = Math.min(d >= 2 ? 2 : 1, atkPool.length);
      deadAtk =
        advD && spec.disA
          ? pickSet(atkPool, n, true, spec.cmdAliveA)
          : dbl && defShard
            ? shardSet(atkPool, n, spec.cmdAliveA)
            : pickSet(atkPool, n, false, spec.cmdAliveA);
    } else {
      deadDef = pickSet(def, Math.min(1, def.length), dbl && atkShard, spec.cmdAliveD);
      deadAtk = pickSet(atkPool, Math.min(1, atkPool.length), dbl && defShard, spec.cmdAliveA);
    }
    const val = (ids: string[], cs: FCard[]) => ids.reduce((s, id) => s + cs.find((c) => c.id === id)!.v, 0);
    out.push({ stale: false, deadAtk, deadDef, u: val(deadDef, def) - val(deadAtk, atk) });
  }
  return out;
}

/**
 * Outcome distribution (no rerolls). Stale rolls: the attacker presses while the continuation
 * has positive material value, else breaks off (an outcome with no casualties).
 */
export function outcomeDistribution(spec: FightSpec): Outcome[] {
  const t0 = rollTable(spec, false);
  const t1 = rollTable(spec, true);
  type Dist = Map<string, Outcome>;
  const add = (d: Dist, r: { deadAtk: string[]; deadDef: string[] }, p: number) => {
    const k = `${r.deadAtk.join(',')}|${r.deadDef.join(',')}`;
    const e = d.get(k);
    if (e) e.p += p;
    else d.set(k, { p, deadAtk: r.deadAtk, deadDef: r.deadDef });
  };
  const evOf = (d: Dist, ...tables: Roll[][]) => {
    let s = 0;
    for (const o of d.values()) {
      const r = tables[0].find((x) => x.deadAtk.join(',') === o.deadAtk.join(',') && x.deadDef.join(',') === o.deadDef.join(','));
      s += o.p * (r ? r.u : 0);
    }
    return s;
  };
  // Level 3+: geometric over the stale-Advantage table.
  const s1 = t1.filter((r) => r.stale).length / 36;
  const d3: Dist = new Map();
  if (s1 < 1) for (const r of t1) if (!r.stale) add(d3, r, 1 / 36 / (1 - s1));
  let ev3 = 0;
  for (const r of t1) if (!r.stale) ev3 += r.u / 36 / (1 - s1 || 1);
  let next = d3;
  let nextEv = ev3;
  const s0 = t0.filter((r) => r.stale).length / 36;
  let ev0 = 0;
  for (const r of t0) if (!r.stale) ev0 += r.u / 36;
  for (let k = 2; k >= 0; k--) {
    const d: Dist = new Map();
    for (const r of t0) if (!r.stale) add(d, r, 1 / 36);
    const press = nextEv > 0;
    if (s0 > 0) {
      if (press) for (const o of next.values()) add(d, o, s0 * o.p);
      else add(d, { deadAtk: [], deadDef: [] }, s0);
    }
    nextEv = ev0 + s0 * (press ? nextEv : 0);
    next = d;
  }
  void evOf;
  return [...next.values()];
}

/** Evaluates an engage action of ctx.me in position p (the defender's commitment is its worst case for me). */
export function engageEval(
  ctx: Ctx,
  p: Pos,
  target: number,
  cardIds: string[],
  wit: number | null,
  charge: boolean,
): EngageEval | null {
  const elig = attackersOf(ctx, p, ctx.me, target);
  const atk: AtkCard[] = [];
  for (const id of cardIds) {
    const a = elig.find((x) => x.id === id);
    if (!a) return null;
    atk.push(a);
  }
  const defs = defenseSets(ctx, p, target);
  let best: EngageEval | null = null;
  const cmdA = cardIds.filter((id) => ctx.cards[id].kind === 'commander').length;
  for (const d of defs) {
    const spec = buildSpec(ctx, p, ctx.me, target, atk, wit, d, charge, 0);
    const dCmd = d.ids.filter((id) => ctx.cards[id].kind === 'commander').length;
    ctx.work += 4;
    const ev = new Fight(spec).value({ aCmd: cmdA, dCmd, aF: true, dF: true }, 0, true);
    if (!best || ev < best.ev) best = { spec, def: d, outcomes: [], ev };
  }
  if (!best) return null;
  best.outcomes = outcomeDistribution(best.spec);
  return best;
}

export function hexName(h: number): string {
  return HEX[h];
}

export type { PlayerId };
