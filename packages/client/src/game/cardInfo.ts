// Presentation helpers for cards and sides.
import { KIND_NAMES, waysToRoll, type Card, type CardKind, type PlayerId, type PlayerView } from '@towers/engine';

export const FACTION: Record<PlayerId, string> = { red: 'Kholin', black: 'Singers' };

export const ART = {
  portrait: (character: string) => `/art/characters/${character}.webp`,
  infantry: (kind: 'light' | 'heavy') => `/art/infantry/${kind}.svg`,
  glyph: (kind: CardKind) => `/art/glyphs/${kind}.svg`,
  back: '/art/card-back.svg',
};

export function isInfantry(c: Card): c is Card & { kind: 'light' | 'heavy'; rank: number } {
  return c.kind === 'light' || c.kind === 'heavy';
}

export function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Name on the plate: the character, or the infantry type. */
export function plateName(c: Card): string {
  if (c.character) return titleCase(c.character);
  return KIND_NAMES[c.kind];
}

/** Short label for the log and tooltips: "Dalinar", "Light 7". */
export function shortName(c: Card): string {
  if (isInfantry(c)) return `${c.kind === 'light' ? 'Light' : 'Heavy'} ${c.rank}`;
  return c.character ? titleCase(c.character) : KIND_NAMES[c.kind];
}

/** Long label, e.g. "Heavy Infantry 4" or "Dalinar, Commander". */
export function longName(c: Card): string {
  if (isInfantry(c)) return `${KIND_NAMES[c.kind]} ${c.rank}`;
  return `${c.character ? titleCase(c.character) : ''}${c.character ? ', ' : ''}${KIND_NAMES[c.kind]}`;
}

/** Number of 2d6 combinations (1–6) that make an infantry card fire. */
export function reliability(c: Card): number {
  return isInfantry(c) ? waysToRoll(c.rank) : 0;
}

/** Text for "when does this fire". Only shown in the inspector. */
export function activationText(c: Card): string {
  switch (c.kind) {
    case 'light':
    case 'heavy':
      return `Fires on ${c.rank}`;
    case 'archer':
      return 'Fires on any 1';
    case 'cavalry':
      return 'Fires on any 6';
    case 'commander':
      return 'Never fires · 1 reroll';
    case 'shardbearer':
      return 'Fires on doubles or 7';
    case 'wit':
      return 'Fires on its number';
  }
}

const KIND_ORDER: Record<CardKind, number> = {
  commander: 0,
  shardbearer: 1,
  cavalry: 2,
  archer: 3,
  heavy: 4,
  light: 5,
  wit: 6,
};

export function sortCards(view: PlayerView, ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const ca = view.cards[a];
    const cb = view.cards[b];
    return KIND_ORDER[ca.kind] - KIND_ORDER[cb.kind] || (ca.rank ?? 0) - (cb.rank ?? 0) || a.localeCompare(b);
  });
}
