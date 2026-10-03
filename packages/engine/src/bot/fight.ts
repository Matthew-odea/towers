// Engagement evaluator for the smart bot.
//
// Exact over the 36 dice outcomes. Rerolls are solved by minimax over the reroll window
// (defender acts first, alternate, close on two consecutive passes), and stale rolls are
// handled by recursion on the stale counter (the attacker presses only when continuing has
// positive value; from the third stale roll on, the defender has Advantage).
//
// All values are the ATTACKER's utility in card-value points: value of defender casualties
// minus value of attacker casualties, plus round swings (Decapitation) and a bonus for
// emptying the target hex.
import type { CardKind } from '../types';
import { DICE_DOUBLE, DICE_TOTAL, ROUND_VALUE } from './values';

export interface FCard {
  id: string;
  /** Value lost if this card dies (Commanders: base value; the round swing is added separately). */
  v: number;
  /** Activation per roll (Wit: with its declared number). */
  act: Uint8Array;
  kind: CardKind;
  /** Attacking ranged Archer (immune unless a defending Archer activates). */
  ranged: boolean;
}

export interface FightSpec {
  atk: FCard[];
  def: FCard[];
  advA: boolean;
  advD: boolean;
  disA: boolean;
  disD: boolean;
  /** Commanders still alive for each side's owner (both dead = round lost). */
  cmdAliveA: number;
  cmdAliveD: number;
  /** Number of cards in the target hex (committed or not). */
  defStack: number;
  /** Attacker utility for emptying the target hex. */
  clearBonus: number;
}

export interface Res {
  /** Unused committed Commander rerolls. */
  aCmd: number;
  dCmd: number;
  /** Forced (Disadvantage) reroll still available to the attacker / defender. */
  aF: boolean;
  dF: boolean;
}

export const NO_RES: Res = { aCmd: 0, dCmd: 0, aF: false, dF: false };

export interface QuickResult {
  ev: number;
  /** Probability the defender loses exactly 1 / 2 cards in this engagement (with presses). */
  pk1: number;
  pk2: number;
  /** Probability the attacker wins the engagement (one decisive roll). */
  pWin: number;
}

export interface RerollChoice {
  kind: 'pass' | 'commander' | 'disadvantage';
  die: 0 | 1;
  value: number;
}

const W_SIZE = 36 * 36 * 4 * 2 * 2;
const wVal = new Float64Array(W_SIZE);
const wStamp = new Int32Array(W_SIZE);
const rVal = new Float64Array(36 * 4);
const rStamp = new Int32Array(36 * 4);
const rBusy = new Int32Array(36 * 4);
let epoch = 0;

type Mode = 0 | 1 | 2; // 0: loser picks (cheapest), 1: winner picks (most valuable), 2: Shardstrike (winner 1, loser rest)

interface Loss {
  score: number;
  round: boolean;
}

function encodeRes(r: Res, spec: FightSpec): number {
  const aCmd = Math.min(2, r.aCmd);
  const dCmd = Math.min(2, r.dCmd);
  const aF = r.aF && spec.disD ? 1 : 0;
  const dF = r.dF && spec.disA ? 1 : 0;
  return aCmd + 3 * dCmd + 9 * aF + 18 * dF;
}

export class Fight {
  readonly spec: FightSpec;
  /** Index i + 36*s (s = stale Advantage active): attacker utility, NaN when stale. */
  private u = new Float64Array(72);
  private kD = new Uint8Array(72);
  private aAct = new Uint8Array(72);
  private dAct = new Uint8Array(72);
  private aWin = new Uint8Array(72);

  constructor(spec: FightSpec) {
    this.spec = spec;
    const { atk, def } = spec;
    const atkShard = atk.some((c) => c.kind === 'shardbearer');
    const defShard = def.some((c) => c.kind === 'shardbearer');
    const atkNR = atk.some((c) => c.ranged) ? atk.filter((c) => !c.ranged) : atk;
    for (let i = 0; i < 36; i++) {
      let aC = 0;
      for (const c of atk) aC += c.act[i];
      let dC = 0;
      let dArch = false;
      for (const c of def) {
        dC += c.act[i];
        if (c.act[i] && c.kind === 'archer') dArch = true;
      }
      const dbl = DICE_DOUBLE[i] === 1;
      const hi = DICE_TOTAL[i] >= 11;
      for (let s = 0; s < 2; s++) {
        const advA = spec.advA;
        const advD = spec.advD || s === 1;
        const a = aC + (advA && hi ? 1 : 0);
        const d = dC + (advD && hi ? 1 : 0);
        const j = i + 36 * s;
        this.aAct[j] = a > 0 ? 1 : 0;
        this.dAct[j] = d > 0 ? 1 : 0;
        if (a === 0 && d === 0) {
          this.u[j] = NaN;
          continue;
        }
        let outcome: 'a' | 'd' | 'b';
        if (a > 0 && d === 0) outcome = 'a';
        else if (d > 0 && a === 0) outcome = 'd';
        else if (advA && !advD) outcome = 'a';
        else if (advD && !advA) outcome = 'd';
        else outcome = 'b';
        const shA = dbl && atkShard;
        const shD = dbl && defShard;
        const atkPool = dArch ? atk : atkNR;
        const atkPid = dArch ? 1 : 2;
        let defLoss: Loss = { score: 0, round: false };
        let atkLoss: Loss = { score: 0, round: false };
        let killsD = 0;
        if (outcome === 'a') {
          const n = Math.min(a >= 2 ? 2 : 1, def.length);
          const mode: Mode = advA && spec.disD ? 1 : shA ? 2 : 0;
          defLoss = this.loss(0, def, n, mode);
          killsD = n;
        } else if (outcome === 'd') {
          const n = Math.min(d >= 2 ? 2 : 1, atkPool.length);
          const mode: Mode = advD && spec.disA ? 1 : shD ? 2 : 0;
          atkLoss = this.loss(atkPid, atkPool, n, mode);
        } else {
          defLoss = this.loss(0, def, Math.min(1, def.length), shA ? 1 : 0);
          atkLoss = this.loss(atkPid, atkPool, Math.min(1, atkPool.length), shD ? 1 : 0);
          killsD = Math.min(1, def.length);
        }
        if (outcome === 'a') this.aWin[j] = 1;
        let util = defLoss.score - atkLoss.score;
        if (defLoss.round && atkLoss.round) util += ROUND_VALUE; // attacker wins a double Decapitation
        this.u[j] = util;
        this.kD[j] = killsD;
      }
    }
  }

  /** Score (loser's loss) of the set {pool[x], pool[y]} (y < 0: single card); sets `lastRound`. */
  private setScore(pool: FCard[], x: number, y: number, isDef: boolean, alive: number): number {
    let v = pool[x].v;
    let cmd = pool[x].kind === 'commander' ? 1 : 0;
    let size = 1;
    if (y >= 0) {
      v += pool[y].v;
      if (pool[y].kind === 'commander') cmd++;
      size = 2;
    }
    const round = alive > 0 && cmd >= alive;
    this.lastRound = round;
    if (round) v += ROUND_VALUE;
    if (isDef && size >= this.spec.defStack) v += this.spec.clearBonus;
    return v;
  }

  private lastRound = false;
  /** Value of rolling at stale count 0..3 without rerolls (filled by quick()). */
  private noRR: number[] | null = null;
  /** Approximate mode: rerolls only on the current roll; stale continuations use noRR. */
  private approx = false;
  private lc = new Float64Array(27).fill(NaN);
  private lr = new Uint8Array(27);

  /**
   * Best set of `n` casualties from `pool` (pid 0 = defender, 1 = all attackers, 2 = attackers
   * without ranged Archers) under the chooser mode. Returns the loser-side score.
   */
  private loss(pid: number, pool: FCard[], n: number, mode: Mode): Loss {
    if (n <= 0 || pool.length === 0) return { score: 0, round: false };
    const key = pid * 9 + n * 3 + mode;
    if (!Number.isNaN(this.lc[key])) return { score: this.lc[key], round: this.lr[key] === 1 };
    const isDef = pid === 0;
    const alive = isDef ? this.spec.cmdAliveD : this.spec.cmdAliveA;
    const L = pool.length;
    let best = NaN;
    let bestRound = false;
    if (n >= L) {
      best = this.setScore(pool, 0, L > 1 ? 1 : -1, isDef, alive);
      bestRound = this.lastRound;
    } else if (n === 1) {
      for (let x = 0; x < L; x++) {
        const v = this.setScore(pool, x, -1, isDef, alive);
        if (Number.isNaN(best) || (mode === 0 ? v < best : v > best)) {
          best = v;
          bestRound = this.lastRound;
        }
      }
    } else if (mode !== 2) {
      for (let x = 0; x < L; x++) {
        for (let y = x + 1; y < L; y++) {
          const v = this.setScore(pool, x, y, isDef, alive);
          if (Number.isNaN(best) || (mode === 0 ? v < best : v > best)) {
            best = v;
            bestRound = this.lastRound;
          }
        }
      }
    } else {
      // Shardstrike: the winner picks one card f, then the loser picks its partner to minimise.
      for (let f = 0; f < L; f++) {
        let inner = NaN;
        let innerRound = false;
        for (let g = 0; g < L; g++) {
          if (g === f) continue;
          const v = this.setScore(pool, f, g, isDef, alive);
          if (Number.isNaN(inner) || v < inner) {
            inner = v;
            innerRound = this.lastRound;
          }
        }
        if (Number.isNaN(best) || inner > best) {
          best = inner;
          bestRound = innerRound;
        }
      }
    }
    this.lc[key] = best;
    this.lr[key] = bestRound ? 1 : 0;
    return { score: best, round: bestRound };
  }

  /** True when the attacker wins outright on dice index i at stale count k. */
  attackerWins(i: number, k: number): boolean {
    return this.aWin[i + (k >= 3 ? 36 : 0)] === 1;
  }

  /** Utility of the final dice at stale count k (NaN = stale). */
  util(i: number, k: number): number {
    return this.u[i + (k >= 3 ? 36 : 0)];
  }

  /** Fast evaluation without rerolls (used for screening, threats and opportunities). */
  quick(): QuickResult {
    const u = this.u;
    let A0 = 0;
    let S0 = 0;
    let A3 = 0;
    let S3 = 0;
    let k1a = 0;
    let k2a = 0;
    let k1b = 0;
    let k2b = 0;
    let w0 = 0;
    let w3 = 0;
    for (let i = 0; i < 36; i++) {
      const x = u[i];
      if (Number.isNaN(x)) S0++;
      else {
        A0 += x;
        if (this.kD[i] === 1) k1a++;
        else if (this.kD[i] === 2) k2a++;
        w0 += this.aWin[i];
      }
      const y = u[i + 36];
      if (Number.isNaN(y)) S3++;
      else {
        A3 += y;
        if (this.kD[i + 36] === 1) k1b++;
        else if (this.kD[i + 36] === 2) k2b++;
        w3 += this.aWin[i + 36];
      }
    }
    A0 /= 36;
    S0 /= 36;
    A3 /= 36;
    S3 /= 36;
    const V3 = S3 < 1 ? A3 / (1 - S3) : 0;
    const V2 = A0 + S0 * Math.max(0, V3);
    const V1 = A0 + S0 * Math.max(0, V2);
    const V0 = A0 + S0 * Math.max(0, V1);
    this.noRR = [V0, V1, V2, V3];
    const m1 = V1 > 0 ? S0 : 0;
    const m2 = m1 * (V2 > 0 ? S0 : 0);
    const m3 = m2 * (V3 > 0 ? S0 : 0);
    const m3t = S3 < 1 ? m3 / (1 - S3) : 0;
    const early = 1 + m1 + m2;
    return {
      ev: V0,
      pk1: (early * k1a + m3t * k1b) / 36,
      pk2: (early * k2a + m3t * k2b) / 36,
      pWin: (early * w0 + m3t * w3) / 36,
    };
  }

  /** Expected attacker utility of rolling now (stale count k) with the given reroll resources. */
  value(res: Res = NO_RES, k = 0, approx = false): number {
    epoch++;
    if (approx && !this.noRR) this.quick();
    this.approx = approx;
    const v = this.roll(Math.min(k, 3), encodeRes(res, this.spec));
    this.approx = false;
    return v;
  }

  /**
   * Values of each choice for `toAct` (0 = attacker, 1 = defender) in a live reroll window at
   * dice index i. Attacker wants the max, defender the min.
   */
  windowChoices(res: Res, i: number, k: number, toAct: 0 | 1, passes: number): RerollChoice[] {
    epoch++;
    const r = encodeRes(res, this.spec);
    const kk = Math.min(k, 3);
    const out: RerollChoice[] = [
      { kind: 'pass', die: 0, value: passes + 1 >= 2 ? this.term(i, r, kk) : this.win(i, r, kk, toAct === 0 ? 1 : 0, passes + 1) },
    ];
    const aCmd = r % 3;
    const dCmd = Math.floor(r / 3) % 3;
    const aF = Math.floor(r / 9) % 2;
    const dF = Math.floor(r / 18) % 2;
    const s = kk >= 3 ? 36 : 0;
    const other = toAct === 0 ? 1 : 0;
    const opts: { kind: 'commander' | 'disadvantage'; nr: number }[] = [];
    if (toAct === 0) {
      if (aCmd > 0) opts.push({ kind: 'commander', nr: r - 1 });
      if (aF && this.dAct[i + s]) opts.push({ kind: 'disadvantage', nr: r - 9 });
    } else {
      if (dCmd > 0) opts.push({ kind: 'commander', nr: r - 3 });
      if (dF && this.aAct[i + s]) opts.push({ kind: 'disadvantage', nr: r - 18 });
    }
    for (const o of opts) {
      for (const die of [0, 1] as const) out.push({ kind: o.kind, die, value: this.rerollValue(i, die, o.nr, kk, other) });
    }
    return out;
  }

  private rerollValue(i: number, die: 0 | 1, nr: number, k: number, next: number): number {
    const d0 = Math.floor(i / 6);
    const d1 = i % 6;
    let sum = 0;
    for (let v = 0; v < 6; v++) {
      const ni = die === 0 ? v * 6 + d1 : d0 * 6 + v;
      sum += this.win(ni, nr, k, next, 0);
    }
    return sum / 6;
  }

  private roll(k: number, r: number): number {
    const key = k * 36 + r;
    if (rStamp[key] === epoch) return rVal[key];
    if (rBusy[key] === epoch) return this.closed3();
    rBusy[key] = epoch;
    let sum = 0;
    if (r === 0) {
      for (let i = 0; i < 36; i++) sum += this.term(i, 0, k);
    } else {
      for (let i = 0; i < 36; i++) sum += this.win(i, r, k, 1, 0);
    }
    const v = sum / 36;
    rVal[key] = v;
    rStamp[key] = epoch;
    rBusy[key] = 0;
    return v;
  }

  private closed3(): number {
    let ns = 0;
    let st = 0;
    for (let i = 36; i < 72; i++) {
      const x = this.u[i];
      if (Number.isNaN(x)) st++;
      else ns += x;
    }
    if (st >= 36) return 0;
    return ns / 36 / (1 - st / 36);
  }

  private term(i: number, r: number, k: number): number {
    const x = this.u[i + (k >= 3 ? 36 : 0)];
    if (!Number.isNaN(x)) return x;
    if (this.approx) return Math.max(0, this.noRR![Math.min(k + 1, 3)]);
    return Math.max(0, this.roll(Math.min(k + 1, 3), r));
  }

  private win(i: number, r: number, k: number, toAct: number, passes: number): number {
    if (passes >= 2) return this.term(i, r, k);
    const key = ((((i * 36 + r) * 4 + k) * 2 + toAct) * 2 + passes) | 0;
    if (wStamp[key] === epoch) return wVal[key];
    const other = toAct === 0 ? 1 : 0;
    let best = this.win(i, r, k, other, passes + 1);
    const s = k >= 3 ? 36 : 0;
    if (toAct === 0) {
      const aCmd = r % 3;
      const aF = Math.floor(r / 9) % 2;
      if (aCmd > 0) {
        best = Math.max(best, this.rerollValue(i, 0, r - 1, k, 1), this.rerollValue(i, 1, r - 1, k, 1));
      }
      if (aF && this.dAct[i + s]) {
        best = Math.max(best, this.rerollValue(i, 0, r - 9, k, 1), this.rerollValue(i, 1, r - 9, k, 1));
      }
    } else {
      const dCmd = Math.floor(r / 3) % 3;
      const dF = Math.floor(r / 18) % 2;
      if (dCmd > 0) {
        best = Math.min(best, this.rerollValue(i, 0, r - 3, k, 0), this.rerollValue(i, 1, r - 3, k, 0));
      }
      if (dF && this.aAct[i + s]) {
        best = Math.min(best, this.rerollValue(i, 0, r - 18, k, 0), this.rerollValue(i, 1, r - 18, k, 0));
      }
    }
    wVal[key] = best;
    wStamp[key] = epoch;
    return best;
  }
}
