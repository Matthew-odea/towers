// Query helpers for UI and bots. All accept MatchState | PlayerView and never mutate.
import { fortifyCost, spawnHexError } from './actions';
import { ALL_ROLLS, attackMode, computeModifiers, resolveDice, sideActivation } from './combat';
import { validateAction } from './core';
import { computeRetreatHexes, defenderMax } from './engagement';
import { ALL_HEXES, TOWER, neighbors, other } from './hex';
import { hexOf, isFortified, stackAt, stackOwner } from './state';
import { suppliedHexes } from './supply';
import type { AnyState, EngagementModifiers, HexKey, PlayerId } from './types';

export interface MoveOption {
  to: HexKey;
  path: HexKey[];
  /** True for a Cavalry 2-hex Plains move (which opens a charge). */
  charge: boolean;
}

/** Legal Move destinations for moving `cardIds` (all in `from`) right now, incl. Cavalry 2-hex paths. */
export function moveOptions(s: AnyState, player: PlayerId, cardIds: string[], from: HexKey): MoveOption[] {
  const out: MoveOption[] = [];
  for (const a of neighbors(from)) {
    if (validateAction(s, { type: 'move', player, cardIds, from, path: [a] }) === null) out.push({ to: a, path: [a], charge: false });
    for (const b of neighbors(a)) {
      if (validateAction(s, { type: 'move', player, cardIds, from, path: [a, b] }) === null) {
        out.push({ to: b, path: [a, b], charge: true });
      }
    }
  }
  return out;
}

/** Distinct legal Move destination hexes (1- or 2-hex). */
export function moveDestinations(s: AnyState, player: PlayerId, cardIds: string[], from: HexKey): HexKey[] {
  return [...new Set(moveOptions(s, player, cardIds, from).map((o) => o.to))];
}

/** Legal Withdraw destinations (hexes, plus 'reserve' from your own Tower). */
export function withdrawOptions(s: AnyState, player: PlayerId, cardIds: string[], from: HexKey): (HexKey | 'reserve')[] {
  const out: (HexKey | 'reserve')[] = [];
  for (const to of [...neighbors(from), 'reserve' as const]) {
    if (validateAction(s, { type: 'withdraw', player, cardIds, from, to }) === null) out.push(to);
  }
  return out;
}

export interface AttackerOption {
  cardId: string;
  hex: HexKey;
  ranged: boolean;
}

/** Cards of `player` that could be committed against `target` (adjacent, or ranged Archers with LOS). Positional only. */
export function eligibleAttackers(s: AnyState, player: PlayerId, target: HexKey): AttackerOption[] {
  if (stackOwner(s, target) !== other(player)) return [];
  const out: AttackerOption[] = [];
  for (const h of ALL_HEXES) {
    if (stackOwner(s, h) !== player) continue;
    for (const id of stackAt(s, h)) {
      const mode = attackMode(s, id, target);
      if (mode) out.push({ cardId: id, hex: h, ranged: mode === 'ranged' });
    }
  }
  return out;
}

/** Enemy hexes `player` can Engage right now (their turn, CP/cap allow, at least one eligible attacker). */
export function engageableTargets(s: AnyState, player: PlayerId): HexKey[] {
  return ALL_HEXES.filter((h) => {
    const atk = eligibleAttackers(s, player, h);
    if (atk.length === 0) return false;
    const wit = s.cards[atk[0].cardId].kind === 'wit' ? 7 : undefined;
    return validateAction(s, { type: 'engage', player, target: h, cardIds: [atk[0].cardId], witNumber: wit }) === null;
  });
}

/** Cards that may defend `target` and how many may be committed. */
export function eligibleDefenders(s: AnyState, target: HexKey): { cardIds: string[]; max: number } {
  const ids = [...stackAt(s, target)];
  return { cardIds: ids, max: Math.min(ids.length, defenderMax(s, target)) };
}

export interface ModifierPreviewInput {
  player: PlayerId;
  target: HexKey;
  attackerCardIds: string[];
  defenderCardIds?: string[];
}

export interface LabelledModifiers {
  advantage: { source: string; label: string }[];
  disadvantage: { source: string; label: string }[];
}

export const MODIFIER_LABELS: Record<string, string> = {
  fortified: 'Fortified',
  charge: 'Cavalry charge',
  archerHighGround: 'Archer on high ground',
  mountainDefence: 'Defending a Mountain',
  flanking: 'Flanking',
  stale: 'Three stale rolls',
  cavalryMountain: 'Cavalry on a Mountain',
  archerDefending: 'Archer defending at close quarters',
  surrounded: 'Surrounded',
};

/**
 * Advantage/Disadvantage for a proposed commitment (RULINGS §9). Charge applies if the
 * proposal includes Cavalry from the just-completed 2-hex move. If `defenderCardIds` is
 * omitted, defender-side card-dependent sources (Archer / Cavalry) are not counted.
 */
export function previewModifiers(s: AnyState, input: ModifierPreviewInput): EngagementModifiers {
  const t = s.turn;
  const charge =
    !!t && t.player === input.player && t.charge !== null && input.attackerCardIds.some((id) => t.charge!.includes(id));
  const e = s.engagement;
  const staleAdvantage = !!e && e.target === input.target && e.staleCount >= 3;
  return computeModifiers(s, {
    target: input.target,
    attackerCards: input.attackerCardIds,
    defenderCards: input.defenderCardIds ?? [],
    charge,
    staleAdvantage,
  });
}

/** Same as previewModifiers, with human-readable labels. */
export function labelModifiers(m: EngagementModifiers): Record<'attacker' | 'defender', LabelledModifiers> {
  const f = (xs: string[]) => xs.map((x) => ({ source: x, label: MODIFIER_LABELS[x] ?? x }));
  return {
    attacker: { advantage: f(m.attacker.advantage), disadvantage: f(m.attacker.disadvantage) },
    defender: { advantage: f(m.defender.advantage), disadvantage: f(m.defender.disadvantage) },
  };
}

/** Exact probability (0–1) that a side with these committed cards activates on one 2d6 roll (rerolls ignored). */
export function activationProbability(
  s: AnyState,
  cardIds: string[],
  opts: { witNumber?: number | null; advantage?: boolean } = {},
): number {
  let n = 0;
  for (const d of ALL_ROLLS) if (sideActivation(s, cardIds, opts.witNumber ?? null, d, !!opts.advantage).count > 0) n++;
  return n / 36;
}

export interface OddsInput {
  player: PlayerId;
  target: HexKey;
  attackerCardIds: string[];
  defenderCardIds: string[];
  attackerWit?: number | null;
  defenderWit?: number | null;
  /** Override the computed modifiers (e.g. for the live engagement). */
  modifiers?: EngagementModifiers;
}

export interface Odds {
  attackerActivates: number;
  defenderActivates: number;
  attackerWins: number;
  defenderWins: number;
  bloodbath: number;
  stale: number;
}

/** Exact single-roll outcome probabilities for a proposed (or live) engagement (rerolls ignored). */
export function engagementOdds(s: AnyState, input: OddsInput): Odds {
  const modifiers =
    input.modifiers ??
    previewModifiers(s, {
      player: input.player,
      target: input.target,
      attackerCardIds: input.attackerCardIds,
      defenderCardIds: input.defenderCardIds,
    });
  const o: Odds = { attackerActivates: 0, defenderActivates: 0, attackerWins: 0, defenderWins: 0, bloodbath: 0, stale: 0 };
  for (const d of ALL_ROLLS) {
    const r = resolveDice(
      s,
      {
        attacker: input.player,
        defender: other(input.player),
        attackerCards: input.attackerCardIds,
        defenderCards: input.defenderCardIds,
        attackerWit: input.attackerWit ?? null,
        defenderWit: input.defenderWit ?? null,
        modifiers,
      },
      d,
    );
    if (r.counts.attacker > 0) o.attackerActivates++;
    if (r.counts.defender > 0) o.defenderActivates++;
    if (r.outcome === 'attacker') o.attackerWins++;
    else if (r.outcome === 'defender') o.defenderWins++;
    else if (r.outcome === 'bloodbath') o.bloodbath++;
    else o.stale++;
  }
  for (const k of Object.keys(o) as (keyof Odds)[]) o[k] /= 36;
  return o;
}

/** Odds for the engagement in progress (after defenders are committed), else null. */
export function currentEngagementOdds(s: AnyState): Odds | null {
  const e = s.engagement;
  if (!e || !e.modifiers) return null;
  return engagementOdds(s, {
    player: e.attacker,
    target: e.target,
    attackerCardIds: e.attackerCards,
    defenderCardIds: e.defenderCards,
    attackerWit: e.attackerWit,
    defenderWit: e.defenderWit,
    modifiers: e.modifiers,
  });
}

/** Hexes where Wit may be Spawned (geometry + occupancy only; see canSpawnWit for full legality). */
export function spawnHexes(s: AnyState, player: PlayerId): HexKey[] {
  return ALL_HEXES.filter((h) => spawnHexError(s, player, h) === null);
}

/** Full legality of Spawn Wit for each hex right now. */
export function legalSpawnHexes(s: AnyState, player: PlayerId): HexKey[] {
  return ALL_HEXES.filter((h) => validateAction(s, { type: 'spawnWit', player, hex: h }) === null);
}

export interface FortifyInfo {
  legal: boolean;
  cost: number;
  reason: string | null;
}

export function fortifyInfo(s: AnyState, player: PlayerId, hex: HexKey): FortifyInfo {
  const reason = validateAction(s, { type: 'fortify', player, hex });
  return { legal: reason === null, cost: fortifyCost(s, hex), reason };
}

/** Hexes `player` may Fortify right now. */
export function fortifiableHexes(s: AnyState, player: PlayerId): HexKey[] {
  return ALL_HEXES.filter((h) => validateAction(s, { type: 'fortify', player, hex: h }) === null);
}

export { suppliedHexes };
export { hasSupply } from './supply';

/** Fortified hexes of `player` with a supply line (positional; ignores CP). */
export function reinforceTargets(s: AnyState, player: PlayerId): HexKey[] {
  const supplied = suppliedHexes(s, player);
  return supplied.filter((h) => isFortified(s, h) && stackOwner(s, h) === player);
}

/** Reserve cards that may be Reinforced / Deployed (not Wit, not Commanders). */
export function reserveDeployable(s: AnyState, player: PlayerId): string[] {
  return s.reserve[player].filter((id) => s.cards[id].kind !== 'wit' && s.cards[id].kind !== 'commander');
}

export interface DeployInfo {
  legal: boolean;
  reason: string | null;
  hex: HexKey;
  cards: string[];
  max: number;
}

export function deployInfo(s: AnyState, player: PlayerId): DeployInfo {
  const cards = reserveDeployable(s, player);
  const reason =
    cards.length === 0
      ? 'No deployable cards in Reserve.'
      : validateAction(s, { type: 'deploy', player, cardIds: [cards[0]] });
  return { legal: reason === null, reason, hex: TOWER[player], cards, max: Math.min(3, cards.length) };
}

/** Legal Combat Retreat hexes for the engagement in progress (empty if none). */
export function retreatHexes(s: AnyState): HexKey[] {
  const e = s.engagement;
  if (!e) return [];
  if (e.stage === 'retreat') return [...e.retreatHexes];
  return computeRetreatHexes(s, e);
}

/** Where a card is: its hex, or null if not on the board. */
export function cardHex(s: AnyState, cardId: string): HexKey | null {
  return hexOf(s, cardId);
}
