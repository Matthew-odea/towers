// Army definitions and card helpers.
import type { Card, CardKind, PlayerId } from './types';

export const CHARACTERS: Readonly<Record<PlayerId, Readonly<Record<'commander' | 'shardbearer' | 'cavalry' | 'archer' | 'wit', readonly string[]>>>> = {
  red: {
    commander: ['dalinar', 'jasnah'],
    shardbearer: ['kaladin', 'adolin'],
    cavalry: ['lift', 'lopen'],
    archer: ['lunamor', 'shallan'],
    wit: ['hoid'],
  },
  black: {
    commander: ['raboniel', 'eshonai'],
    shardbearer: ['szeth', 'moash'],
    cavalry: ['leshwi', 'lezian'],
    archer: ['venli', 'thude'],
    wit: ['hoid'],
  },
};

export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export const KIND_NAMES: Readonly<Record<CardKind, string>> = {
  light: 'Light Infantry',
  heavy: 'Heavy Infantry',
  archer: 'Archer',
  cavalry: 'Cavalry',
  commander: 'Commander',
  shardbearer: 'Shardbearer',
  wit: 'Wit',
};

/** The 27-card army of one player, in a stable display order. */
export function buildArmy(owner: PlayerId): Card[] {
  const out: Card[] = [];
  const ch = CHARACTERS[owner];
  for (const kind of ['commander', 'shardbearer', 'cavalry', 'archer'] as const) {
    for (const c of ch[kind]) out.push({ id: `${owner}-${kind}-${c}`, owner, kind, character: c });
  }
  for (const kind of ['heavy', 'light'] as const) {
    for (const rank of RANKS) out.push({ id: `${owner}-${kind}-${rank}`, owner, kind, rank });
  }
  out.push({ id: `${owner}-wit-${ch.wit[0]}`, owner, kind: 'wit', character: ch.wit[0] });
  return out;
}

export function buildAllCards(): Record<string, Card> {
  const out: Record<string, Card> = {};
  for (const p of ['red', 'black'] as const) for (const c of buildArmy(p)) out[c.id] = c;
  return out;
}

/** Human-readable card name, e.g. "Light Infantry 7" or "Archer (lunamor)". */
export function cardName(card: Card): string {
  const base = KIND_NAMES[card.kind];
  if (card.rank !== undefined) return `${base} ${card.rank}`;
  if (card.character) return `${base} (${card.character})`;
  return base;
}

/** Number of 2d6 combinations (of 36) that roll a given total. */
export function waysToRoll(total: number): number {
  if (total < 2 || total > 12) return 0;
  return 6 - Math.abs(7 - total);
}

/** Does this card activate on these dice? (`witNumber` = declared number for a committed Wit.) */
export function cardActivates(card: Card, dice: readonly [number, number], witNumber: number | null): boolean {
  const [a, b] = dice;
  const total = a + b;
  switch (card.kind) {
    case 'light':
    case 'heavy':
      return total === card.rank;
    case 'archer':
      return a === 1 || b === 1;
    case 'cavalry':
      return a === 6 || b === 6;
    case 'commander':
      return false;
    case 'shardbearer':
      return a === b || total === 7;
    case 'wit':
      return witNumber !== null && total === witNumber;
  }
}
