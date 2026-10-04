// Hard bot static evaluation: the medium evaluator (../evaluate.ts) plus Tower-race terms.
// From ctx.me's point of view at the end of ctx.me's turn (the opponent acts next).
import { DIST, NB, N_HEX } from '../geo';
import { killsAtLeast } from '../evaluate';
import {
  type AtkCard,
  type Ctx,
  type Pos,
  type ThreatInfo,
  attackersOf,
  clearBonusFor,
  holdValue,
  isFort,
  quickAttack,
} from '../model';
import { COMMANDER_VALUE, ROUND_VALUE } from '../values';
import type { HardConfig } from './config';

export interface HCtx extends Ctx {
  h: HardConfig;
  /** Cache of ctx.me's attack potential on a hex (recapture), keyed by layout. */
  recap: Map<string, ThreatInfo>;
}

export function hctx(ctx: Ctx, h: HardConfig): HCtx {
  const c = ctx as HCtx;
  if (c.h !== h || !c.recap) {
    c.h = h;
    c.recap = new Map();
  }
  return c;
}

/** Attack potential of `attacker` on hex h next turn: adjacent cards, ranged Archers, and cards 2 away that can step in. */
function attackPotential(ctx: Ctx, p: Pos, attacker: PlayerId, h: number, clearBonus: number): ThreatInfo {
  const defender = p.own[h]!;
  const elig: AtkCard[] = attackersOf(ctx, p, attacker, h);
  for (let g = 0; g < N_HEX; g++) {
    if (p.own[g] !== attacker || DIST[g][h] !== 2) continue;
    if (!NB[h].some((n) => DIST[n][g] === 1 && p.own[n] !== defender)) continue;
    for (const id of p.st[g]) if (!elig.some((a) => a.id === id)) elig.push({ id, hex: -1, ranged: false });
  }
  return quickAttack(ctx, p, attacker, h, elig, clearBonus, ctx.w.mobile);
}

type PlayerId = import('../../types').PlayerId;

/** The enemy's best next-turn engagement on my hex h (material, plus a capture term on my Tower). */
export function threatOn(ctx: HCtx, p: Pos, h: number): ThreatInfo {
  const key = `${h}|${p.st[h].join(',')}|${isFort(p, h) ? 1 : 0}`;
  const hit = ctx.threatCache.get(key);
  if (hit) return hit;
  const me = p.own[h]!;
  const foe = me === ctx.me ? ctx.foe : ctx.me;
  const cb = h === ctx.tower[me] ? ctx.h.ev.towerCapture * holdValue(ctx, ctx.towerCount[foe] + 1) : 0;
  const r = attackPotential(ctx, p, foe, h, cb);
  ctx.threatCache.set(key, r);
  return r;
}

function opportunityOn(ctx: Ctx, p: Pos, t: number): number {
  const elig = attackersOf(ctx, p, ctx.me, t);
  if (!elig.length) return 0;
  const key = `${t}|${elig.map((a) => `${a.id}@${a.hex}`).join(',')}`;
  const hit = ctx.oppCache.get(key);
  if (hit !== undefined) return hit;
  const r = quickAttack(ctx, p, ctx.me, t, elig, clearBonusFor(ctx, ctx.me, t), 1).ev;
  ctx.oppCache.set(key, r);
  return r;
}

/**
 * Fewest Move actions `player` needs to bring some cards from hex g onto hex `to` (which must be
 * empty or friendly) this turn, through hexes free of the other player's cards; Mountains end
 * movement, so they are never crossed. Cavalry-only groups may take 2-Plains steps. 99 if > 3.
 */
function movesToReach(ctx: Ctx, p: Pos, player: PlayerId, g: number, to: number, cavOnly: boolean): number {
  const blocked = (h: number) => p.own[h] !== null && p.own[h] !== player;
  if (blocked(to)) return 99;
  let frontier = [g];
  const seen = new Set<number>([g]);
  for (let step = 1; step <= 3; step++) {
    const next: number[] = [];
    for (const h of frontier) {
      for (const n of NB[h]) {
        if (blocked(n)) continue;
        if (n === to) return step;
        if (ctx.terrain[n] === 'mountain') continue;
        if (!seen.has(n)) {
          seen.add(n);
          next.push(n);
        }
        if (cavOnly && ctx.terrain[n] === 'plains') {
          for (const m of NB[n]) {
            if (m === h || blocked(m) || ctx.terrain[m] !== 'plains') continue;
            if (m === to) return step;
            if (!seen.has(m)) {
              seen.add(m);
              next.push(m);
            }
          }
        }
      }
    }
    frontier = next;
  }
  return 99;
}

/**
 * My Tower is empty at the end of my turn: the enemy's best walk-in (the largest stack that can
 * reach it next turn) and my chance of clearing it on my following turn.
 */
function walkInPenalty(ctx: HCtx, p: Pos): number {
  const me = ctx.me;
  const foe = ctx.foe;
  const tw = ctx.tower[me];
  let best: { from: number; ids: string[] } | null = null;
  for (let g = 0; g < N_HEX; g++) {
    if (p.own[g] !== foe) continue;
    const ids = p.st[g];
    let group: string[] = [];
    if (movesToReach(ctx, p, foe, g, tw, false) <= 3) group = ids;
    else {
      const cav = ids.filter((id) => ctx.cards[id].kind === 'cavalry');
      if (cav.length && movesToReach(ctx, p, foe, g, tw, true) <= 3) group = cav;
    }
    if (group.length && (!best || group.length > best.ids.length)) best = { from: g, ids: group };
  }
  if (!best) return 0;
  const key = `walk|${best.ids.join(',')}|${p.own.join(',')}|${p.st.map((x) => x.length).join(',')}`;
  let t = ctx.recap.get(key);
  if (!t) {
    const q: Pos = { ...p, st: [...p.st], own: [...p.own], fort: [...p.fort] };
    q.st[best.from] = p.st[best.from].filter((id) => !best!.ids.includes(id));
    if (!q.st[best.from].length) {
      q.own[best.from] = null;
      q.fort[best.from] = null;
    }
    q.st[tw] = best.ids;
    q.own[tw] = foe;
    q.fort[tw] = null;
    t = attackPotential(ctx, q, me, tw, clearBonusFor(ctx, me, tw));
    ctx.recap.set(key, t);
  }
  const pClear = killsAtLeast(t, best.ids.length);
  return ctx.h.ev.walkIn * (1 - pClear);
}

export function evaluateHard(ctx: HCtx, p: Pos): number {
  const { me, foe } = ctx;
  const E = ctx.h.ev;
  ctx.work += 0.5;
  const myTower = ctx.tower[me];
  const foeTower = ctx.tower[foe];
  let v = 0;
  const prog = ctx.w.prog * (1 + ctx.urgency);
  const threats: number[] = [];
  let foeNearMyTower = 9;
  let meNearFoeTower = 9;
  const sup = new Set<number>();
  let myOthers = p.reserve[me].length;
  for (let h = 0; h < N_HEX; h++) if (p.own[h] === me) for (const id of p.st[h]) if (ctx.cards[id].kind !== 'commander') myOthers++;
  const cmdProg = myOthers <= 1 ? 8 : 0;
  const foeHexes: number[] = [];
  for (let h = 0; h < N_HEX; h++) if (p.own[h] === foe) foeHexes.push(h);
  for (const id of p.reserve[me]) if (ctx.cards[id].kind !== 'wit') v -= prog * ctx.w.reserve * ctx.val[id];
  for (let h = 0; h < N_HEX; h++) {
    const o = p.own[h];
    if (o === foe) {
      foeNearMyTower = Math.min(foeNearMyTower, DIST[h][myTower]);
      continue;
    }
    if (o !== me) continue;
    meNearFoeTower = Math.min(meNearFoeTower, DIST[h][foeTower]);
    const ids = p.st[h];
    let nonCmd = 0;
    let cmds = 0;
    for (const id of ids) {
      if (ctx.cards[id].kind === 'commander') {
        cmds++;
        v += prog * cmdProg * (4 - DIST[h][foeTower]);
        continue;
      }
      nonCmd++;
      v += prog * ctx.val[id] * (4 - DIST[h][foeTower]);
    }
    const t = threatOn(ctx, p, h);
    if (t.ev > 0) threats.push(t.ev, t.ev * 0.7);
    if (h === myTower && E.safety > 0) {
      // The enemy clears my Tower stack and walks in next turn (it then needs one more of my turns to stick).
      const pCap = killsAtLeast(t, ids.length);
      if (pCap > 0.001) v -= E.safety * pCap;
    }
    if (h === foeTower) {
      const hold = holdValue(ctx, ctx.towerCount[me] + 1);
      v += hold * (1 - killsAtLeast(t, ids.length));
    }
    if (cmds > 0) {
      const alive = ctx.cmdAlive[me];
      const value = alive <= 1 || cmds >= alive ? COMMANDER_VALUE + ROUND_VALUE * (alive <= 1 ? 1 : 0.5) : COMMANDER_VALUE;
      if (t.pk1 > 0 || t.pk2 > 0) {
        const k3 = killsAtLeast(t, nonCmd + 1);
        v -= ctx.w.cmdRisk * value * k3;
        // Away from my Tower the stack cannot be topped up by Deploy: attrition over two enemy turns.
        if (E.attrition > 0 && h !== myTower) v -= E.attrition * value * (killsAtLeast(t, nonCmd + 1, 6) - k3);
      }
      if (nonCmd < 3 && myOthers > 1) {
        let dmin = 9;
        for (const g of foeHexes) if (DIST[g][h] < dmin) dmin = DIST[g][h];
        const prox = dmin <= 1 ? 1 : dmin === 2 ? 0.8 : dmin === 3 ? 0.5 : dmin === 4 ? 0.25 : 0.1;
        v -= ctx.w.cmdExpose * value * prox * [1, 0.4, 0.15][nonCmd];
      }
    }
    if (isFort(p, h)) sup.add(h);
  }
  if (sup.size) {
    const tw = myTower;
    if (p.own[tw] === me) {
      const seen = new Set<number>([tw]);
      const q = [tw];
      while (q.length) {
        const h = q.pop()!;
        for (const n of NB[h]) if (!seen.has(n) && p.own[n] === me) {
          seen.add(n);
          q.push(n);
        }
      }
      for (const h of sup) if (seen.has(h)) v += ctx.w.supply;
    }
  }
  threats.sort((a, b) => b - a);
  for (let i = 0; i < Math.min(3, threats.length); i++) v -= ctx.w.threat[i] * threats[i];

  if (p.own[myTower] === foe) {
    const c1 = ctx.towerCount[foe] + 1;
    if (c1 >= 3 || !E.recapture) v -= holdValue(ctx, c1);
    else {
      // The count reaches c1 at the start of the enemy's turn; I then get one turn to clear it.
      const key = `${p.st[myTower].join(',')}|${p.own.join(',')}|${p.st.map((x) => x.length).join(',')}`;
      let t = ctx.recap.get(key);
      if (!t) {
        t = attackPotential(ctx, p, me, myTower, clearBonusFor(ctx, me, myTower));
        ctx.recap.set(key, t);
      }
      const pClear = killsAtLeast(t, p.st[myTower].length);
      v -= holdValue(ctx, c1) + (holdValue(ctx, c1 + 1) - holdValue(ctx, c1)) * (1 - pClear);
    }
  } else if (p.own[myTower] === null && E.walkIn > 0) {
    v -= walkInPenalty(ctx, p);
  } else if (p.own[myTower] === null) {
    if (foeNearMyTower === 1) v -= ctx.w.walk1;
    else if (foeNearMyTower === 2) v -= ctx.w.walk2;
    else if (foeNearMyTower === 3) v -= ctx.w.walk3;
  }
  if (p.own[foeTower] === null && meNearFoeTower === 1) v += ctx.w.walkOpp;

  const opps: number[] = [];
  for (let t = 0; t < N_HEX; t++) {
    if (p.own[t] !== foe) continue;
    const o = opportunityOn(ctx, p, t);
    if (o > 0) opps.push(o);
  }
  opps.sort((a, b) => b - a);
  if (opps.length) v += ctx.w.opp * (1 + ctx.urgency) * (opps[0] + 0.5 * (opps[1] ?? 0));
  return v;
}
