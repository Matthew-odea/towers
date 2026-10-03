// Random-legal bot: picks a uniformly-ish random legal action for whatever `player` must decide.
import { HOME_EDGE } from '../hex';
import { pendingDecision, validateAction } from '../core';
import { hexesOf, stackAt } from '../state';
import {
  eligibleAttackers,
  engageableTargets,
  fortifiableHexes,
  legalSpawnHexes,
  moveOptions,
  reinforceTargets,
  reserveDeployable,
  withdrawOptions,
} from '../queries';
import type { Action, AnyState, PlayerId } from '../types';

export type Rand = () => number;

function pick<T>(xs: readonly T[], rand: Rand): T {
  return xs[Math.floor(rand() * xs.length)];
}

function sample<T>(xs: readonly T[], n: number, rand: Rand): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

function randInt(lo: number, hi: number, rand: Rand): number {
  return lo + Math.floor(rand() * (hi - lo + 1));
}

function randomSubset<T>(xs: readonly T[], rand: Rand): T[] {
  if (rand() < 0.5) return [...xs];
  return sample(xs, randInt(1, xs.length, rand), rand);
}

export function randomSetup(s: AnyState, player: PlayerId, rand: Rand): Action {
  const avail = s.reserve[player];
  const edge = HOME_EDGE[player];
  const placements = avail
    .filter((id) => s.cards[id].kind === 'commander')
    .map((cardId) => ({ cardId, hex: pick(edge, rand) }));
  const others = avail.filter((id) => s.cards[id].kind !== 'commander' && s.cards[id].kind !== 'wit');
  for (const cardId of sample(others, randInt(0, Math.min(6, others.length), rand), rand)) {
    placements.push({ cardId, hex: pick(edge, rand) });
  }
  return { type: 'setupPlace', player, placements };
}

function turnCandidates(s: AnyState, player: PlayerId, rand: Rand): Action[] {
  const out: Action[] = [];
  const t = s.turn!;
  if (t.cp <= 0) return out;
  for (const from of hexesOf(s, player)) {
    const cardIds = randomSubset(stackAt(s, from), rand);
    for (const o of moveOptions(s, player, cardIds, from)) out.push({ type: 'move', player, cardIds, from, path: o.path });
    for (const to of withdrawOptions(s, player, cardIds, from)) out.push({ type: 'withdraw', player, cardIds, from, to });
  }
  for (const target of engageableTargets(s, player)) {
    const atk = eligibleAttackers(s, player, target);
    const cardIds = sample(atk, randInt(1, Math.min(3, atk.length), rand), rand).map((a) => a.cardId);
    const hasWit = cardIds.some((id) => s.cards[id].kind === 'wit');
    // Engaging is weighted up so random games actually fight.
    for (let i = 0; i < 3; i++) {
      out.push({ type: 'engage', player, target, cardIds, ...(hasWit ? { witNumber: randInt(2, 12, rand) } : {}) });
    }
  }
  const deployable = reserveDeployable(s, player);
  if (deployable.length > 0) {
    out.push({ type: 'deploy', player, cardIds: sample(deployable, randInt(1, Math.min(3, deployable.length), rand), rand) });
  }
  for (const hex of fortifiableHexes(s, player)) out.push({ type: 'fortify', player, hex });
  if (deployable.length > 0) {
    for (const hex of reinforceTargets(s, player)) out.push({ type: 'reinforce', player, cardId: pick(deployable, rand), hex });
  }
  const spawn = legalSpawnHexes(s, player);
  if (spawn.length > 0) out.push({ type: 'spawnWit', player, hex: pick(spawn, rand) });
  return out.filter((a) => validateAction(s, a) === null);
}

/** A random legal action for `player`, or null if `player` has nothing to decide. Never concedes. */
export function chooseRandomAction(s: AnyState, player: PlayerId, rand: Rand): Action | null {
  const d = pendingDecision(s);
  if (!(d.players as PlayerId[]).includes(player)) return null;
  switch (d.kind) {
    case 'setup':
      return randomSetup(s, player, rand);
    case 'turn': {
      const cands = rand() < 0.12 ? [] : turnCandidates(s, player, rand);
      return cands.length > 0 ? pick(cands, rand) : { type: 'endTurn', player };
    }
    case 'defend': {
      const cardIds = sample(d.eligible, randInt(1, d.max, rand), rand);
      const hasWit = cardIds.some((id) => s.cards[id].kind === 'wit');
      return { type: 'defend', player, cardIds, ...(hasWit ? { witNumber: randInt(2, 12, rand) } : {}) };
    }
    case 'reroll': {
      if (rand() < 0.4) return { type: 'passReroll', player };
      const o = pick(d.options, rand);
      const die = rand() < 0.5 ? 0 : 1;
      return o.source === 'commander'
        ? { type: 'reroll', player, source: 'commander', commanderId: o.commanderId, die }
        : { type: 'reroll', player, source: 'disadvantage', die };
    }
    case 'pressOrBreak':
      return { type: rand() < 0.6 ? 'press' : 'breakOff', player };
    case 'casualties':
      return { type: 'chooseCasualties', player, cardIds: sample(d.eligible, d.count, rand) };
    case 'retreat': {
      const to = rand() < 0.25 ? null : pick(d.hexes, rand);
      return { type: 'retreat', player, to };
    }
    case 'matchOver':
      return null;
  }
}
