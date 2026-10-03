// Lightweight board model used by the smart bot to look ahead within a turn.
// Mirrors the engine's turn-action rules closely enough for planning; every action the bot
// finally returns is re-validated against the real engine.
import { other } from '../hex';
import type { Action, AnyState, Card, CpActionType, PlayerId, Terrain } from '../types';
import { Fight, type FCard, type FightSpec, type QuickResult } from './fight';
import { DEFAULT_TUNING, type Tuning } from './tuning';
import { DIST, HEX, IDX, MID, NB, NB_ORDER, NO_SPAWN, N_HEX, ORDER, TOWER_IDX } from './geo';
import { ROUND_VALUE, actMask, activationWays, baseValue, bestWitNumber } from './values';

export interface Pos {
  /** Card ids per hex index. Inner arrays are never mutated in place (copy on write). */
  st: string[][];
  own: (PlayerId | null)[];
  /** Player a hex is Fortified for (only meaningful while that player holds it). */
  fort: (PlayerId | null)[];
  reserve: Record<PlayerId, string[]>;
  cp: number;
  spent: Record<CpActionType, number>;
  arrived: string[];
  locked: string[];
  charge: string[] | null;
}

export interface DefSet {
  ids: string[];
  wit: number | null;
}

export interface ThreatInfo {
  ev: number;
  pk1: number;
  pk2: number;
}

export interface EngageOpt {
  action: Extract<Action, { type: 'engage' }>;
  ev: number;
}

export interface Ctx {
  s: AnyState;
  me: PlayerId;
  foe: PlayerId;
  terrain: Terrain[];
  cards: Record<string, Card>;
  val: Record<string, number>;
  ways: Record<string, number>;
  cmdAlive: Record<PlayerId, number>;
  towerCount: Record<PlayerId, number>;
  tower: Record<PlayerId, number>;
  threatCache: Map<string, ThreatInfo>;
  oppCache: Map<string, number>;
  engCache: Map<string, EngageOpt | null>;
  defCache: Map<string, DefSet[]>;
  t0: number;
  /** Grows with the round's length to break stalemates (0 before turn 50). */
  urgency: number;
  w: Tuning;
  /** Deterministic work counter (Fights built), used as the search budget. */
  work: number;
}

export const CAP = 3;

export function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function makeCtx(s: AnyState, me: PlayerId, w: Tuning = DEFAULT_TUNING): Ctx {
  const val: Record<string, number> = {};
  const ways: Record<string, number> = {};
  for (const [id, c] of Object.entries(s.cards)) {
    val[id] = baseValue(c);
    ways[id] = activationWays(c);
  }
  const cmdAlive = { red: 0, black: 0 } as Record<PlayerId, number>;
  for (const c of Object.values(s.cards)) {
    if (c.kind === 'commander' && !s.destroyed[c.owner].includes(c.id)) cmdAlive[c.owner]++;
  }
  return {
    s,
    me,
    foe: other(me),
    terrain: HEX.map((h) => s.terrain[h] ?? 'plains'),
    cards: s.cards,
    val,
    ways,
    cmdAlive,
    towerCount: { ...s.towerCount },
    tower: { ...TOWER_IDX },
    threatCache: new Map(),
    oppCache: new Map(),
    engCache: new Map(),
    defCache: new Map(),
    t0: now(),
    urgency: Math.max(0, ((s.turn?.number ?? 0) - 50) / 40),
    w,
    work: 0,
  };
}

export function posFromState(s: AnyState): Pos {
  const st: string[][] = [];
  const own: (PlayerId | null)[] = [];
  const fort: (PlayerId | null)[] = [];
  for (let i = 0; i < N_HEX; i++) {
    const ids = s.stacks[HEX[i]] ?? [];
    st.push([...ids]);
    own.push(ids.length ? s.cards[ids[0]].owner : null);
    fort.push(s.fortified[HEX[i]] ?? null);
  }
  const t = s.turn;
  return {
    st,
    own,
    fort,
    reserve: { red: [...s.reserve.red], black: [...s.reserve.black] },
    cp: t?.cp ?? 0,
    spent: t ? { ...t.spent } : { move: 0, engage: 0, deploy: 0, withdraw: 0, fortify: 0, reinforce: 0, spawnWit: 0 },
    arrived: t ? [...t.arrived] : [],
    locked: t ? [...t.mountainLocked] : [],
    charge: t?.charge ? [...t.charge] : null,
  };
}

function clonePos(p: Pos): Pos {
  return {
    st: [...p.st],
    own: [...p.own],
    fort: [...p.fort],
    reserve: p.reserve,
    cp: p.cp,
    spent: { ...p.spent },
    arrived: p.arrived,
    locked: p.locked,
    charge: null,
  };
}

export function isFort(p: Pos, h: number): boolean {
  return p.fort[h] !== null && p.fort[h] === p.own[h];
}

function canSpend(p: Pos, type: CpActionType, cost: number): boolean {
  return p.cp >= cost && p.spent[type] + cost <= CAP;
}

function spendOn(p: Pos, type: CpActionType, cost: number): void {
  p.cp -= cost;
  p.spent[type] += cost;
}

function removeFrom(p: Pos, h: number, ids: string[]): void {
  const rest = p.st[h].filter((x) => !ids.includes(x));
  p.st[h] = rest;
  if (rest.length === 0) {
    p.own[h] = null;
    p.fort[h] = null;
  }
}

function addTo(ctx: Ctx, p: Pos, h: number, ids: string[], owner: PlayerId): void {
  p.st[h] = [...p.st[h], ...ids];
  p.own[h] = owner;
  if (p.fort[h] !== null && p.fort[h] !== owner) p.fort[h] = null;
  p.arrived = [...p.arrived, ...ids];
  if (ctx.terrain[h] === 'mountain') p.locked = [...p.locked, ...ids];
}

/** Applies a (turn) action of ctx.me to the model; null if the model thinks it is illegal. */
export function applyModel(ctx: Ctx, p: Pos, a: Action): Pos | null {
  const me = ctx.me;
  switch (a.type) {
    case 'move': {
      const from = IDX[a.from];
      if (p.own[from] !== me || !canSpend(p, 'move', 1)) return null;
      if (a.cardIds.some((id) => p.locked.includes(id) || !p.st[from].includes(id))) return null;
      const path = a.path.map((h) => IDX[h]);
      if (DIST[from][path[0]] !== 1 || p.own[path[0]] === ctx.foe) return null;
      if (path.length === 2) {
        if (a.cardIds.some((id) => ctx.cards[id].kind !== 'cavalry')) return null;
        if (ctx.terrain[path[0]] !== 'plains' || ctx.terrain[path[1]] !== 'plains') return null;
        if (DIST[path[0]][path[1]] !== 1 || path[1] === from || p.own[path[1]] === ctx.foe) return null;
      }
      const q = clonePos(p);
      spendOn(q, 'move', 1);
      removeFrom(q, from, a.cardIds);
      addTo(ctx, q, path[path.length - 1], a.cardIds, me);
      q.charge = path.length === 2 ? [...a.cardIds] : null;
      return q;
    }
    case 'withdraw': {
      const from = IDX[a.from];
      if (p.own[from] !== me || !canSpend(p, 'withdraw', 1)) return null;
      if (a.cardIds.some((id) => p.locked.includes(id) || !p.st[from].includes(id))) return null;
      const q = clonePos(p);
      spendOn(q, 'withdraw', 1);
      if (a.to === 'reserve') {
        if (from !== ctx.tower[me] || a.cardIds.some((id) => ctx.cards[id].kind === 'commander')) return null;
        removeFrom(q, from, a.cardIds);
        q.reserve = { ...q.reserve, [me]: [...q.reserve[me], ...a.cardIds] };
      } else {
        const to = IDX[a.to];
        if (DIST[from][to] !== 1 || p.own[to] === ctx.foe) return null;
        if (DIST[to][ctx.tower[me]] >= DIST[from][ctx.tower[me]]) return null;
        removeFrom(q, from, a.cardIds);
        addTo(ctx, q, to, a.cardIds, me);
      }
      return q;
    }
    case 'deploy': {
      const tw = ctx.tower[me];
      if (p.own[tw] === ctx.foe || !canSpend(p, 'deploy', 1)) return null;
      if (a.cardIds.length < 1 || a.cardIds.length > 3) return null;
      if (a.cardIds.some((id) => !p.reserve[me].includes(id) || ['wit', 'commander'].includes(ctx.cards[id].kind))) return null;
      const q = clonePos(p);
      spendOn(q, 'deploy', 1);
      q.reserve = { ...q.reserve, [me]: q.reserve[me].filter((x) => !a.cardIds.includes(x)) };
      addTo(ctx, q, tw, a.cardIds, me);
      return q;
    }
    case 'fortify': {
      const h = IDX[a.hex];
      if (p.own[h] !== me || isFort(p, h)) return null;
      if (p.st[h].some((id) => p.arrived.includes(id))) return null;
      const cost = p.st[h].some((id) => ctx.cards[id].kind === 'heavy') ? 1 : 2;
      if (!canSpend(p, 'fortify', cost)) return null;
      const q = clonePos(p);
      spendOn(q, 'fortify', cost);
      q.fort[h] = me;
      return q;
    }
    case 'reinforce': {
      const h = IDX[a.hex];
      if (p.own[h] !== me || !isFort(p, h) || !canSpend(p, 'reinforce', 3)) return null;
      if (!p.reserve[me].includes(a.cardId) || ['wit', 'commander'].includes(ctx.cards[a.cardId].kind)) return null;
      if (!supplied(ctx, p, me).has(h)) return null;
      const q = clonePos(p);
      spendOn(q, 'reinforce', 3);
      q.reserve = { ...q.reserve, [me]: q.reserve[me].filter((x) => x !== a.cardId) };
      addTo(ctx, q, h, [a.cardId], me);
      return q;
    }
    case 'spawnWit': {
      const h = IDX[a.hex];
      const wit = p.reserve[me].find((id) => ctx.cards[id].kind === 'wit');
      if (!wit || NO_SPAWN.has(h) || p.own[h] === ctx.foe || !canSpend(p, 'spawnWit', 1)) return null;
      const q = clonePos(p);
      spendOn(q, 'spawnWit', 1);
      q.reserve = { ...q.reserve, [me]: q.reserve[me].filter((x) => x !== wit) };
      addTo(ctx, q, h, [wit], me);
      return q;
    }
    default:
      return null;
  }
}

export function supplied(ctx: Ctx, p: Pos, player: PlayerId): Set<number> {
  const tw = ctx.tower[player];
  const seen = new Set<number>();
  if (p.own[tw] !== player) return seen;
  seen.add(tw);
  const q = [tw];
  while (q.length) {
    const h = q.pop()!;
    for (const n of NB[h]) if (!seen.has(n) && p.own[n] === player) {
      seen.add(n);
      q.push(n);
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Candidate generation

function subsetVariants(ctx: Ctx, ids: string[]): string[][] {
  const out: string[][] = [];
  const seen = new Set<string>();
  const add = (xs: string[]) => {
    if (xs.length === 0) return;
    const k = [...xs].sort().join('|');
    if (seen.has(k)) return;
    seen.add(k);
    out.push(xs);
  };
  const kind = (id: string) => ctx.cards[id].kind;
  add(ids);
  const nonCmd = ids.filter((id) => kind(id) !== 'commander');
  const byVal = [...nonCmd].sort((a, b) => ctx.val[b] - ctx.val[a]);
  const hasCmd = nonCmd.length < ids.length;
  if (hasCmd) {
    add(nonCmd);
    if (nonCmd.length >= 3) add(byVal.slice(0, nonCmd.length - 2));
    if (nonCmd.length >= 2) add(byVal.slice(0, nonCmd.length - 1));
  }
  const cav = ids.filter((id) => kind(id) === 'cavalry');
  if (cav.length) add(cav);
  if (ids.length >= 2 && byVal.length) add([byVal[0]]);
  if (byVal.length > 3) add(byVal.slice(0, 3));
  if (!hasCmd && byVal.length >= 4) add(byVal.slice(0, Math.ceil(byVal.length / 2)));
  const wit = ids.find((id) => kind(id) === 'wit');
  if (wit && ids.length >= 2) add([wit]);
  const archers = ids.filter((id) => kind(id) === 'archer');
  if (archers.length && archers.length < ids.length) add(archers);
  return out;
}

export function genActions(ctx: Ctx, p: Pos): Action[] {
  const me = ctx.me;
  const foe = ctx.foe;
  const out: Action[] = [];
  const myTower = ctx.tower[me];
  const NBo = NB_ORDER[me];
  for (const h of ORDER[me]) {
    if (p.own[h] !== me) continue;
    const ids = p.st[h].filter((id) => !p.locked.includes(id));
    if (ids.length === 0) continue;
    const from = HEX[h];
    const subs = subsetVariants(ctx, ids);
    for (const sub of subs) {
      if (canSpend(p, 'move', 1)) {
        for (const n of NBo[h]) {
          if (p.own[n] === foe) continue;
          out.push({ type: 'move', player: me, cardIds: sub, from, path: [HEX[n]] });
        }
        if (sub.every((id) => ctx.cards[id].kind === 'cavalry')) {
          for (const n of NBo[h]) {
            if (p.own[n] === foe || ctx.terrain[n] !== 'plains') continue;
            for (const m of NBo[n]) {
              if (m === h || p.own[m] === foe || ctx.terrain[m] !== 'plains') continue;
              out.push({ type: 'move', player: me, cardIds: sub, from, path: [HEX[n], HEX[m]] });
            }
          }
        }
      }
      if (canSpend(p, 'withdraw', 1)) {
        for (const n of NBo[h]) {
          if (p.own[n] === foe || DIST[n][myTower] >= DIST[h][myTower]) continue;
          out.push({ type: 'withdraw', player: me, cardIds: sub, from, to: HEX[n] });
        }
        if (h === myTower && sub.every((id) => ctx.cards[id].kind !== 'commander')) {
          out.push({ type: 'withdraw', player: me, cardIds: sub, from, to: 'reserve' });
        }
      }
    }
    if (!isFort(p, h) && !p.st[h].some((id) => p.arrived.includes(id))) {
      const cost = p.st[h].some((id) => ctx.cards[id].kind === 'heavy') ? 1 : 2;
      if (canSpend(p, 'fortify', cost)) out.push({ type: 'fortify', player: me, hex: from });
    }
  }
  const deployable = p.reserve[me].filter((id) => !['wit', 'commander'].includes(ctx.cards[id].kind));
  if (deployable.length && p.own[myTower] !== foe && canSpend(p, 'deploy', 1)) {
    const byVal = [...deployable].sort((a, b) => ctx.val[b] - ctx.val[a]);
    const byWays = [...deployable].sort((a, b) => ctx.ways[b] - ctx.ways[a] || ctx.val[b] - ctx.val[a]);
    const heavyFirst = [...deployable].sort(
      (a, b) =>
        Number(ctx.cards[b].kind === 'heavy') - Number(ctx.cards[a].kind === 'heavy') || ctx.ways[b] - ctx.ways[a],
    );
    const seen = new Set<string>();
    for (const xs of [byVal.slice(0, 3), byWays.slice(0, 3), heavyFirst.slice(0, 3), byWays.slice(0, 1)]) {
      const k = [...xs].sort().join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ type: 'deploy', player: me, cardIds: xs });
    }
  }
  if (deployable.length && canSpend(p, 'reinforce', 3)) {
    const sup = supplied(ctx, p, me);
    const best = [...deployable].sort((a, b) => ctx.ways[b] - ctx.ways[a] || ctx.val[b] - ctx.val[a])[0];
    for (const h of sup) if (isFort(p, h)) out.push({ type: 'reinforce', player: me, cardId: best, hex: HEX[h] });
  }
  if (p.reserve[me].some((id) => ctx.cards[id].kind === 'wit') && canSpend(p, 'spawnWit', 1)) {
    for (const h of ORDER[me]) {
      if (NO_SPAWN.has(h) || p.own[h] === foe) continue;
      out.push({ type: 'spawnWit', player: me, hex: HEX[h] });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fights in the model

export interface AtkCard {
  id: string;
  hex: number;
  ranged: boolean;
}

function hexOfIn(p: Pos, id: string): number {
  for (let h = 0; h < N_HEX; h++) if (p.st[h].includes(id)) return h;
  return -1;
}

export function lineOfSight(ctx: Ctx, from: number, to: number): boolean {
  if (DIST[from][to] !== 2) return false;
  const mid = MID[from][to];
  return mid.length === 0 || !mid.every((m) => ctx.terrain[m] === 'forest');
}

/** Cards of `player` that could attack `target` (adjacent, or ranged Archers with LOS). */
export function attackersOf(ctx: Ctx, p: Pos, player: PlayerId, target: number): AtkCard[] {
  const out: AtkCard[] = [];
  for (const h of ORDER[player]) {
    if (p.own[h] !== player) continue;
    const d = DIST[h][target];
    if (d === 1) for (const id of p.st[h]) out.push({ id, hex: h, ranged: false });
    else if (d === 2 && lineOfSight(ctx, h, target)) {
      for (const id of p.st[h]) if (ctx.cards[id].kind === 'archer') out.push({ id, hex: h, ranged: true });
    }
  }
  return out;
}

/** Positional extra value of a card (cards holding the enemy Tower matter more). */
function posExtra(ctx: Ctx, owner: PlayerId, hex: number): number {
  return hex === ctx.tower[other(owner)] ? 3 : 0;
}

export function fcard(ctx: Ctx, id: string, hex: number, wit: number | null, ranged: boolean): FCard {
  const c = ctx.cards[id];
  return {
    id,
    v: ctx.val[id] + (hex >= 0 ? posExtra(ctx, c.owner, hex) : 0),
    act: actMask(c, c.kind === 'wit' ? wit ?? 7 : null),
    kind: c.kind,
    ranged,
  };
}

/** Attacker utility for emptying `target` (attacker = `attacker`). */
export function clearBonusFor(ctx: Ctx, attacker: PlayerId, target: number): number {
  const defender = other(attacker);
  if (target === ctx.tower[attacker]) return holdValue(ctx, ctx.towerCount[defender] + 1) + 6;
  if (target === ctx.tower[defender]) return 4;
  return 1.5;
}

export interface ModFlags {
  advA: boolean;
  advD: boolean;
  disA: boolean;
  disD: boolean;
}

/** RULINGS §9 in the model. Attackers with hex -1 are "virtual" movers (no flanking). */
export function modFlags(ctx: Ctx, p: Pos, target: number, atk: AtkCard[], def: string[], charge: boolean): ModFlags {
  const tm = ctx.terrain[target] === 'mountain';
  const adj: number[] = [];
  for (const a of atk) if (!a.ranged && a.hex >= 0 && !adj.includes(a.hex)) adj.push(a.hex);
  let flank = false;
  for (let i = 0; i < adj.length && !flank; i++) for (let j = i + 1; j < adj.length; j++) if (DIST[adj[i]][adj[j]] !== 1) flank = true;
  const kind = (id: string) => ctx.cards[id].kind;
  const advA =
    charge || flank || (!tm && atk.some((a) => kind(a.id) === 'archer' && a.hex >= 0 && ctx.terrain[a.hex] === 'mountain'));
  const advD = isFort(p, target) || tm;
  const cav = atk.filter((a) => kind(a.id) === 'cavalry');
  const disA = cav.length > 0 && (tm || cav.some((a) => a.hex >= 0 && ctx.terrain[a.hex] === 'mountain'));
  const disD =
    (tm && def.some((id) => kind(id) === 'cavalry')) ||
    (def.some((id) => kind(id) === 'archer') && adj.length > 0) ||
    adj.length >= 3;
  return { advA, advD, disA, disD };
}

export function buildSpec(
  ctx: Ctx,
  p: Pos,
  attacker: PlayerId,
  target: number,
  atk: AtkCard[],
  atkWit: number | null,
  def: DefSet,
  charge: boolean,
  clearBonus: number,
): FightSpec {
  const m = modFlags(ctx, p, target, atk, def.ids, charge);
  return {
    atk: atk.map((a) => fcard(ctx, a.id, a.hex, atkWit, a.ranged)),
    def: def.ids.map((id) => fcard(ctx, id, target, def.wit, false)),
    ...m,
    cmdAliveA: ctx.cmdAlive[attacker],
    cmdAliveD: ctx.cmdAlive[other(attacker)],
    defStack: p.st[target].length,
    clearBonus,
  };
}

/** Plausible defender commitments for the stack at `h` (greedy coverage, and a single best card). */
export function defenseSets(ctx: Ctx, p: Pos, h: number): DefSet[] {
  const key = `${h}|${p.st[h].join(',')}|${isFort(p, h) ? 1 : 0}`;
  const hit = ctx.defCache.get(key);
  if (hit) return hit;
  const max = isFort(p, h) ? 4 : 3;
  const stack = p.st[h];
  const nonCmd = stack.filter((id) => ctx.cards[id].kind !== 'commander');
  const pool = nonCmd.length ? nonCmd : stack;
  const chosen: string[] = [];
  const covered = new Uint8Array(36);
  let wit: number | null = null;
  while (chosen.length < Math.min(max, pool.length)) {
    let best: string | null = null;
    let bestScore = -Infinity;
    let bestWit: number | null = null;
    for (const id of pool) {
      if (chosen.includes(id)) continue;
      const c = ctx.cards[id];
      let w: number | null = null;
      if (c.kind === 'wit') {
        const masks = chosen.filter((x) => ctx.cards[x].kind !== 'wit').map((x) => actMask(ctx.cards[x]));
        w = bestWitNumber(masks);
      }
      const m = actMask(c, w);
      let gain = 0;
      for (let i = 0; i < 36; i++) if (m[i] && !covered[i]) gain++;
      const score = gain * 10 - ctx.val[id] * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = id;
        bestWit = w;
      }
    }
    if (!best) break;
    chosen.push(best);
    if (bestWit !== null) wit = bestWit;
    const m = actMask(ctx.cards[best], bestWit);
    for (let i = 0; i < 36; i++) if (m[i]) covered[i] = 1;
  }
  const sets: DefSet[] = [{ ids: chosen, wit: chosen.some((id) => ctx.cards[id].kind === 'wit') ? wit : null }];
  if (chosen.length > 1) {
    const first = chosen[0];
    sets.push({ ids: [first], wit: ctx.cards[first].kind === 'wit' ? 7 : null });
  }
  ctx.defCache.set(key, sets);
  return sets;
}

function combos<T>(xs: T[], maxK: number): T[][] {
  const out: T[][] = [];
  const n = xs.length;
  for (let a = 0; a < n; a++) {
    out.push([xs[a]]);
    if (maxK < 2) continue;
    for (let b = a + 1; b < n; b++) {
      out.push([xs[a], xs[b]]);
      if (maxK < 3) continue;
      for (let c = b + 1; c < n; c++) out.push([xs[a], xs[b], xs[c]]);
    }
  }
  return out;
}

/** Keep the most useful attackers: best activators, plus one per distinct hex (for Flanking). */
function pruneAttackers(ctx: Ctx, elig: AtkCard[], n: number, charge: string[] | null): AtkCard[] {
  const score = (a: AtkCard) =>
    ctx.ways[a.id] + (charge?.includes(a.id) ? 8 : 0) + (ctx.cards[a.id].kind === 'commander' ? 3 : 0) + (a.ranged ? 2 : 0);
  const sorted = [...elig].sort((a, b) => score(b) - score(a) || ctx.val[a.id] - ctx.val[b.id]);
  const out = sorted.slice(0, n);
  const hexes = new Set(out.filter((a) => !a.ranged).map((a) => a.hex));
  for (const a of sorted) {
    if (out.length >= n + 2) break;
    if (!a.ranged && !hexes.has(a.hex)) {
      out.push(a);
      hexes.add(a.hex);
    }
  }
  return out;
}

/**
 * Best attack by `attacker` on `target` with the given eligible cards, against the defender's
 * plausible commitments. Returns the attacker's expected utility.
 */
export function bestAttack(
  ctx: Ctx,
  p: Pos,
  attacker: PlayerId,
  target: number,
  elig: AtkCard[],
  opts: { charge: string[] | null; clearBonus: number; rerolls: boolean; prune: number; mobileFactor?: number },
): { cards: AtkCard[]; wit: number | null; ev: number; pk1: number; pk2: number } | null {
  if (elig.length === 0) return null;
  const defs = defenseSets(ctx, p, target);
  const cand = pruneAttackers(ctx, elig, opts.prune, opts.charge);
  type Scored = { cards: AtkCard[]; wit: number | null; charge: boolean; ev: number; pk1: number; pk2: number; factor: number; cmd: number };
  const scored: Scored[] = [];
  for (const sub of combos(cand, 3)) {
    let wit: number | null = null;
    if (sub.some((a) => ctx.cards[a.id].kind === 'wit')) {
      wit = bestWitNumber(sub.filter((a) => ctx.cards[a.id].kind !== 'wit').map((a) => actMask(ctx.cards[a.id])));
    }
    const charge = !!opts.charge && sub.some((a) => opts.charge!.includes(a.id));
    let worst: QuickResult | null = null;
    for (const d of defs) {
      ctx.work++;
      const r = new Fight(buildSpec(ctx, p, attacker, target, sub, wit, d, charge, opts.clearBonus)).quick();
      if (!worst || r.ev < worst.ev) worst = r;
    }
    if (!worst) continue;
    const factor = sub.some((a) => a.hex < 0) ? (opts.mobileFactor ?? 0.6) : 1;
    const cmd = sub.filter((a) => ctx.cards[a.id].kind === 'commander').length;
    scored.push({ cards: sub, wit, charge, ev: worst.ev * factor, pk1: worst.pk1 * factor, pk2: worst.pk2 * factor, factor, cmd });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.ev - a.ev);
  if (!opts.rerolls) {
    const b = scored[0];
    return { cards: b.cards, wit: b.wit, ev: b.ev, pk1: b.pk1, pk2: b.pk2 };
  }
  // Re-score the most promising commitments exactly, with rerolls (Commanders, Disadvantage).
  const finalists = scored.slice(0, 3);
  for (const x of scored.filter((y) => y.cmd > 0).slice(0, 2)) if (!finalists.includes(x)) finalists.push(x);
  let best: { cards: AtkCard[]; wit: number | null; ev: number; pk1: number; pk2: number } | null = null;
  for (const x of finalists) {
    let worst = Infinity;
    for (const d of defs) {
      const spec = buildSpec(ctx, p, attacker, target, x.cards, x.wit, d, x.charge, opts.clearBonus);
      const dCmd = d.ids.filter((id) => ctx.cards[id].kind === 'commander').length;
      const f = new Fight(spec);
      ctx.work += 4;
      const v =
        x.cmd > 0 || dCmd > 0 || spec.disA || spec.disD ? f.value({ aCmd: x.cmd, dCmd, aF: true, dF: true }, 0, true) : f.quick().ev;
      if (v < worst) worst = v;
    }
    const ev = worst * x.factor;
    if (!best || ev > best.ev) best = { cards: x.cards, wit: x.wit, ev, pk1: x.pk1, pk2: x.pk2 };
  }
  return best;
}

/** Best engagement for ctx.me against each enemy hex in position p (cached by local layout). */
export function engageOptions(ctx: Ctx, p: Pos): EngageOpt[] {
  const out: EngageOpt[] = [];
  if (!canSpend(p, 'engage', 1)) return out;
  for (const t of ORDER[ctx.me]) {
    if (p.own[t] !== ctx.foe) continue;
    const elig = attackersOf(ctx, p, ctx.me, t);
    if (!elig.length) continue;
    const chg = p.charge && elig.some((a) => p.charge!.includes(a.id)) ? p.charge : null;
    const key = `${t}|${elig.map((a) => `${a.id}@${a.hex}`).join(',')}|${chg ? chg.join(',') : ''}|${isFort(p, t) ? 1 : 0}`;
    let opt = ctx.engCache.get(key);
    if (opt === undefined) {
      const b = bestAttack(ctx, p, ctx.me, t, elig, {
        charge: chg,
        clearBonus: clearBonusFor(ctx, ctx.me, t),
        rerolls: true,
        prune: 5,
      });
      opt = b
        ? {
            action: {
              type: 'engage',
              player: ctx.me,
              target: HEX[t],
              cardIds: b.cards.map((a) => a.id),
              ...(b.wit !== null ? { witNumber: b.wit } : {}),
            },
            ev: b.ev,
          }
        : null;
      ctx.engCache.set(key, opt);
    }
    if (opt) out.push(opt);
  }
  return out;
}

export function hexOfCard(p: Pos, id: string): number {
  return hexOfIn(p, id);
}

/** Greedy attack commitment: maximise new dice coverage, favour Flanking and charges. */
function greedyAttack(ctx: Ctx, elig: AtkCard[], charge: string[] | null): AtkCard[] {
  const chosen: AtkCard[] = [];
  const covered = new Uint8Array(36);
  while (chosen.length < 3) {
    let best: AtkCard | null = null;
    let bestScore = -Infinity;
    for (const a of elig) {
      if (chosen.includes(a)) continue;
      const c = ctx.cards[a.id];
      const m = actMask(c, c.kind === 'wit' ? 7 : null);
      let gain = 0;
      for (let i = 0; i < 36; i++) if (m[i] && !covered[i]) gain++;
      let score = gain * 10 - ctx.val[a.id] * 0.3;
      if (charge?.includes(a.id)) score += 40;
      if (!a.ranged && a.hex >= 0) {
        const hexes = chosen.filter((x) => !x.ranged && x.hex >= 0).map((x) => x.hex);
        if (hexes.length && hexes.every((h) => h !== a.hex) && hexes.some((h) => DIST[h][a.hex] !== 1)) score += 25;
      }
      if (a.ranged) score += 6;
      if (c.kind === 'commander') score -= 20;
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    if (!best) break;
    chosen.push(best);
    const c = ctx.cards[best.id];
    const m = actMask(c, c.kind === 'wit' ? 7 : null);
    for (let i = 0; i < 36; i++) if (m[i]) covered[i] = 1;
  }
  return chosen;
}

/** Fast estimate of `attacker`'s best engagement on `target` (no rerolls, greedy commitment). */
export function quickAttack(
  ctx: Ctx,
  p: Pos,
  attacker: PlayerId,
  target: number,
  elig: AtkCard[],
  clearBonus: number,
  mobileFactor: number,
  charge: string[] | null = null,
): ThreatInfo {
  const zero: ThreatInfo = { ev: 0, pk1: 0, pk2: 0 };
  if (!elig.length) return zero;
  const sets: AtkCard[][] = [greedyAttack(ctx, elig, charge)];
  if (sets[0].some((a) => a.hex < 0)) {
    const fixed = elig.filter((a) => a.hex >= 0);
    if (fixed.length) sets.push(greedyAttack(ctx, fixed, null));
  }
  const defs = defenseSets(ctx, p, target);
  let best = zero;
  for (const sub of sets) {
    if (!sub.length) continue;
    const others = sub.filter((a) => ctx.cards[a.id].kind !== 'wit').map((a) => actMask(ctx.cards[a.id]));
    const wit = sub.some((a) => ctx.cards[a.id].kind === 'wit') ? bestWitNumber(others) : null;
    let worst: ThreatInfo | null = null;
    for (const d of defs) {
      const chg = !!charge && sub.some((a) => charge.includes(a.id));
      ctx.work++;
      const r = new Fight(buildSpec(ctx, p, attacker, target, sub, wit, d, chg, clearBonus)).quick();
      if (!worst || r.ev < worst.ev) worst = r;
    }
    if (!worst) continue;
    const f = sub.some((a) => a.hex < 0) ? mobileFactor : 1;
    if (worst.ev * f > best.ev) best = { ev: worst.ev * f, pk1: worst.pk1 * f, pk2: worst.pk2 * f };
  }
  return best;
}

/** Moves a whole stack (Combat Retreat) in the model; Fortified status is lost unless joining one. */
export function retreatModel(ctx: Ctx, p: Pos, from: number, to: number): Pos {
  const q = clonePos(p);
  const ids = p.st[from];
  const owner = p.own[from]!;
  removeFrom(q, from, ids);
  addTo(ctx, q, to, ids, owner);
  return q;
}

/** Cheap estimate of ctx.me's best engagement value in position p (greedy commitment, no rerolls). */
export function quickEngageValue(ctx: Ctx, p: Pos): number {
  if (!canSpend(p, 'engage', 1)) return 0;
  let best = 0;
  for (const t of ORDER[ctx.me]) {
    if (p.own[t] !== ctx.foe) continue;
    const elig = attackersOf(ctx, p, ctx.me, t);
    if (!elig.length) continue;
    const chg = p.charge && elig.some((a) => p.charge!.includes(a.id)) ? p.charge : null;
    const key = `q${t}|${elig.map((a) => `${a.id}@${a.hex}`).join(',')}|${chg ? chg.join(',') : ''}`;
    let v = ctx.oppCache.get(key);
    if (v === undefined) {
      v = quickAttack(ctx, p, ctx.me, t, elig, clearBonusFor(ctx, ctx.me, t), 1, chg).ev;
      ctx.oppCache.set(key, v);
    }
    if (v > best) best = v;
  }
  return best;
}

/** Value of a Tower hold whose count will next be `c` (3 = round won). */
export function holdValue(ctx: Ctx, c: number): number {
  return c >= 3 ? ROUND_VALUE : c === 2 ? ctx.w.hold2 : c === 1 ? ctx.w.hold1 : 0;
}
