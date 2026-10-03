// Pure combat math: line of sight, attacker eligibility, Advantage/Disadvantage, activation, outcome.
import { cardActivates } from './cards';
import { areAdjacent, commonNeighbors, distance, isHex } from './hex';
import { getCard, hexOf, isFortified } from './state';
import type {
  EngagementModifiers,
  EngagementOutcome,
  EngagementResult,
  HexKey,
  PlayerId,
  PublicState,
  Side,
} from './types';

/** RULINGS §7.3: range-2 line of sight is blocked only if every hex adjacent to both ends is Forest. */
export function lineOfSight(s: PublicState, from: HexKey, target: HexKey): boolean {
  if (!isHex(from) || !isHex(target) || distance(from, target) !== 2) return false;
  const mid = commonNeighbors(from, target);
  if (mid.length === 0) return true;
  return !mid.every((h) => s.terrain[h] === 'forest');
}

/** How a card can join an attack on `target`: adjacent, ranged (Archer at range 2 with LOS), or not at all. */
export function attackMode(s: PublicState, cardId: string, target: HexKey): 'adjacent' | 'ranged' | null {
  const card = getCard(s, cardId);
  const hex = hexOf(s, cardId);
  if (!card || !hex || !isHex(target)) return null;
  if (areAdjacent(hex, target)) return 'adjacent';
  if (card.kind === 'archer' && distance(hex, target) === 2 && lineOfSight(s, hex, target)) return 'ranged';
  return null;
}

export interface CommitmentInput {
  target: HexKey;
  attackerCards: string[];
  /** Defaults to the attacking Archers that are not adjacent to the target. */
  rangedArchers?: string[];
  defenderCards: string[];
  charge: boolean;
  staleAdvantage?: boolean;
}

/** RULINGS §9. Uses current card positions. */
export function computeModifiers(s: PublicState, input: CommitmentInput): EngagementModifiers {
  const { target } = input;
  const ranged = new Set(
    input.rangedArchers ?? input.attackerCards.filter((id) => attackMode(s, id, target) === 'ranged'),
  );
  const mods: EngagementModifiers = {
    attacker: { advantage: [], disadvantage: [] },
    defender: { advantage: [], disadvantage: [] },
  };
  const targetMountain = s.terrain[target] === 'mountain';
  const atk = input.attackerCards.map((id) => ({ id, card: s.cards[id], hex: hexOf(s, id) }));
  const def = input.defenderCards.map((id) => ({ id, card: s.cards[id] }));
  const adjacentHexes = [
    ...new Set(atk.filter((a) => !ranged.has(a.id) && a.hex !== null && areAdjacent(a.hex, target)).map((a) => a.hex!)),
  ];

  // Attacker Advantage.
  if (input.charge) mods.attacker.advantage.push('charge');
  if (!targetMountain && atk.some((a) => a.card.kind === 'archer' && a.hex !== null && s.terrain[a.hex] === 'mountain')) {
    mods.attacker.advantage.push('archerHighGround');
  }
  let flanking = false;
  for (let i = 0; i < adjacentHexes.length && !flanking; i++) {
    for (let j = i + 1; j < adjacentHexes.length; j++) {
      if (!areAdjacent(adjacentHexes[i], adjacentHexes[j])) {
        flanking = true;
        break;
      }
    }
  }
  if (flanking) mods.attacker.advantage.push('flanking');

  // Defender Advantage.
  if (isFortified(s, target)) mods.defender.advantage.push('fortified');
  if (targetMountain) mods.defender.advantage.push('mountainDefence');
  if (input.staleAdvantage && mods.defender.advantage.length === 0) mods.defender.advantage.push('stale');

  // Disadvantage.
  const atkCavalry = atk.filter((a) => a.card.kind === 'cavalry');
  if (atkCavalry.length > 0 && (targetMountain || atkCavalry.some((a) => a.hex !== null && s.terrain[a.hex] === 'mountain'))) {
    mods.attacker.disadvantage.push('cavalryMountain');
  }
  if (targetMountain && def.some((d) => d.card.kind === 'cavalry')) mods.defender.disadvantage.push('cavalryMountain');
  if (def.some((d) => d.card.kind === 'archer') && adjacentHexes.length > 0) mods.defender.disadvantage.push('archerDefending');
  if (adjacentHexes.length >= 3) mods.defender.disadvantage.push('surrounded');

  return mods;
}

export interface SideActivation {
  activating: string[];
  bonus: boolean;
  count: number;
}

/** RULINGS §7.4 for one side. */
export function sideActivation(
  s: PublicState,
  cardIds: readonly string[],
  witNumber: number | null,
  dice: readonly [number, number],
  hasAdvantage: boolean,
): SideActivation {
  const activating = cardIds.filter((id) => {
    const c = getCard(s, id);
    return c !== undefined && cardActivates(c, dice, witNumber);
  });
  const bonus = hasAdvantage && dice[0] + dice[1] >= 11;
  return { activating, bonus, count: activating.length + (bonus ? 1 : 0) };
}

export interface ResolveInput {
  attacker: PlayerId;
  defender: PlayerId;
  attackerCards: readonly string[];
  defenderCards: readonly string[];
  attackerWit: number | null;
  defenderWit: number | null;
  modifiers: EngagementModifiers;
}

/** RULINGS §7.5 + Shardstrike detection (§12.3) for final dice. */
export function resolveDice(s: PublicState, e: ResolveInput, dice: [number, number]): EngagementResult {
  const advA = e.modifiers.attacker.advantage.length > 0;
  const advD = e.modifiers.defender.advantage.length > 0;
  const a = sideActivation(s, e.attackerCards, e.attackerWit, dice, advA);
  const d = sideActivation(s, e.defenderCards, e.defenderWit, dice, advD);
  let outcome: EngagementOutcome;
  if (a.count === 0 && d.count === 0) outcome = 'stale';
  else if (a.count > 0 && d.count === 0) outcome = 'attacker';
  else if (d.count > 0 && a.count === 0) outcome = 'defender';
  else if (advA && !advD) outcome = 'attacker';
  else if (advD && !advA) outcome = 'defender';
  else outcome = 'bloodbath';
  const winner = outcome === 'attacker' ? e.attacker : outcome === 'defender' ? e.defender : null;
  const doubles = dice[0] === dice[1];
  const shard = (ids: readonly string[]) => doubles && ids.some((id) => s.cards[id]?.kind === 'shardbearer');
  const winCount = outcome === 'attacker' ? a.count : outcome === 'defender' ? d.count : 0;
  return {
    dice: [dice[0], dice[1]],
    activating: { attacker: a.activating, defender: d.activating },
    advantageBonus: { attacker: a.bonus, defender: d.bonus },
    counts: { attacker: a.count, defender: d.count },
    outcome,
    winner,
    overwhelming: winCount >= 2,
    shardstrike: { attacker: shard(e.attackerCards), defender: shard(e.defenderCards) },
  };
}

export function sideOf(e: { attacker: PlayerId }, p: PlayerId): Side {
  return e.attacker === p ? 'attacker' : 'defender';
}

/** All 36 ordered 2d6 outcomes. */
export const ALL_ROLLS: ReadonlyArray<[number, number]> = (() => {
  const out: [number, number][] = [];
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) out.push([a, b]);
  return out;
})();
