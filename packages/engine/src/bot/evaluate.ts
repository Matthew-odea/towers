// Static position evaluation for the smart bot, from ctx.me's point of view, assuming the
// opponent acts next (end of ctx.me's turn, or mid-way through the opponent's turn).
import { DIST, NB, N_HEX } from './geo';
import { type Ctx, type Pos, type ThreatInfo, attackersOf, clearBonusFor, holdValue, isFort, quickAttack, type AtkCard } from './model';
import { COMMANDER_VALUE, ROUND_VALUE } from './values';

export { DEFAULT_TUNING, type Tuning } from './tuning';

/** P(total casualties over `n` engagements ≥ m), each engagement killing 1 w.p. pk1, 2 w.p. pk2. */
export function killsAtLeast(t: ThreatInfo, m: number, n = 3): number {
  if (m <= 0) return 1;
  const p0 = Math.max(0, 1 - t.pk1 - t.pk2);
  let dist = [1];
  for (let k = 0; k < n; k++) {
    const next = new Array(dist.length + 2).fill(0);
    dist.forEach((x, i) => {
      next[i] += x * p0;
      next[i + 1] += x * t.pk1;
      next[i + 2] += x * t.pk2;
    });
    dist = next;
  }
  let s = 0;
  for (let i = m; i < dist.length; i++) s += dist[i];
  return s;
}

/** The enemy's best next-turn engagement on my hex h (material only). */
export function threatOn(ctx: Ctx, p: Pos, h: number): ThreatInfo {
  const key = `${h}|${p.st[h].join(',')}|${isFort(p, h) ? 1 : 0}`;
  const hit = ctx.threatCache.get(key);
  if (hit) return hit;
  const me = p.own[h]!;
  const foe = me === ctx.me ? ctx.foe : ctx.me;
  const elig: AtkCard[] = attackersOf(ctx, p, foe, h);
  for (let g = 0; g < N_HEX; g++) {
    if (p.own[g] !== foe || DIST[g][h] !== 2) continue;
    if (!NB[h].some((n) => DIST[n][g] === 1 && p.own[n] !== me)) continue;
    for (const id of p.st[g]) if (!elig.some((a) => a.id === id)) elig.push({ id, hex: -1, ranged: false });
  }
  const r = quickAttack(ctx, p, foe, h, elig, 0, ctx.w.mobile);
  ctx.threatCache.set(key, r);
  return r;
}

/** My best next-turn engagement on enemy hex t (no movement). */
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

export function evaluate(ctx: Ctx, p: Pos): number {
  const { me, foe } = ctx;
  ctx.work += 0.5;
  const myTower = ctx.tower[me];
  const foeTower = ctx.tower[foe];
  let v = 0;
  const prog = ctx.w.prog * (1 + ctx.urgency);
  const threats: number[] = [];
  let foeNearMyTower = 9;
  let meNearFoeTower = 9;
  const sup = new Set<number>();
  // With (almost) no other cards left, the Commanders themselves must carry the fight.
  let myOthers = p.reserve[me].length;
  for (let h = 0; h < N_HEX; h++) if (p.own[h] === me) for (const id of p.st[h]) if (ctx.cards[id].kind !== 'commander') myOthers++;
  const cmdProg = myOthers <= 1 ? 8 : 0;
  const foeHexes: number[] = [];
  for (let h = 0; h < N_HEX; h++) if (p.own[h] === foe) foeHexes.push(h);
  // Cards idling in Reserve count as one step behind the Tower.
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
    if (h === foeTower) {
      const hold = holdValue(ctx, ctx.towerCount[me] + 1);
      v += hold * (1 - killsAtLeast(t, ids.length));
    }
    if (cmds > 0) {
      const alive = ctx.cmdAlive[me];
      const value = alive <= 1 || cmds >= alive ? COMMANDER_VALUE + ROUND_VALUE * (alive <= 1 ? 1 : 0.5) : COMMANDER_VALUE;
      if (t.pk1 > 0 || t.pk2 > 0) v -= ctx.w.cmdRisk * value * killsAtLeast(t, nonCmd + 1);
      // Commanders without escorts invite Decapitation, even from a distance.
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
    // Fortified hexes that keep a supply line can be Reinforced.
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

  if (p.own[myTower] === foe) v -= holdValue(ctx, ctx.towerCount[foe] + 1);
  else if (p.own[myTower] === null) {
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
