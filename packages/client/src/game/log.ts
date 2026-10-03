// Short log lines built from GameEvents.
import { MODIFIER_LABELS, type GameEvent, type PlayerId, type PlayerView } from '@towers/engine';
import { FACTION, shortName } from './cardInfo';

export interface LogEntry {
  id: number;
  side: PlayerId | null;
  text: string;
  /** Section break (new turn / new round). */
  rule?: 'turn' | 'round';
}

const REASON: Record<string, string> = { tower: 'held the Tower', decapitation: 'fell both Commanders', concede: 'concession' };

function names(v: PlayerView, ids: string[]): string {
  return ids.map((id) => (v.cards[id] ? shortName(v.cards[id]) : id)).join(', ');
}

export function logLines(e: GameEvent, v: PlayerView): Omit<LogEntry, 'id'>[] {
  const F = FACTION;
  switch (e.type) {
    case 'roundStarted':
      return [{ side: null, text: `Round ${e.round}`, rule: 'round' }];
    case 'setupRevealed':
      return [{ side: null, text: 'Armies revealed' }];
    case 'turnStarted':
      return [{ side: e.player, text: `${F[e.player]} turn ${e.turn}`, rule: 'turn' }];
    case 'towerCount':
      return e.count > 0
        ? [{ side: e.player, text: `${F[e.player]} hold the Tower · ${e.count} of 3` }]
        : [{ side: e.player, text: `${F[e.player]} lose the Tower` }];
    case 'moved':
      return [{ side: e.player, text: `${names(v, e.cardIds)} ${e.charge ? 'ride two hexes' : 'move'}` }];
    case 'withdrew':
      return [{ side: e.player, text: `${names(v, e.cardIds)} withdraw${e.to === 'reserve' ? ' to Reserve' : ''}` }];
    case 'deployed':
      return [{ side: e.player, text: `Deploy ${names(v, e.cardIds)}` }];
    case 'spawned':
      return [{ side: e.player, text: `${names(v, [e.cardId])} appears` }];
    case 'fortified':
      return [{ side: e.player, text: `Fortify · ${e.cost} CP` }];
    case 'fortifyEnded':
      return [];
    case 'reinforced':
      return [{ side: e.player, text: `Reinforce with ${names(v, [e.cardId])}` }];
    case 'engageDeclared':
      return [
        {
          side: e.attacker,
          text: `Engage with ${names(v, e.cardIds)}${e.witNumber ? ` (Wit ${e.witNumber})` : ''}${e.charge ? ' · charge' : ''}`,
        },
      ];
    case 'engagementStarted': {
      const mods = (['attacker', 'defender'] as const)
        .flatMap((s) => [
          ...e.modifiers[s].advantage.map((x) => `${F[s === 'attacker' ? e.attacker : e.defender]} +${MODIFIER_LABELS[x] ?? x}`),
          ...e.modifiers[s].disadvantage.map((x) => `${F[s === 'attacker' ? e.attacker : e.defender]} −${MODIFIER_LABELS[x] ?? x}`),
        ])
        .join(' · ');
      return [
        {
          side: e.defender,
          text: `Defend with ${names(v, e.defenderCards)}${e.witNumbers.defender ? ` (Wit ${e.witNumbers.defender})` : ''}`,
        },
        ...(mods ? [{ side: null, text: mods }] : []),
      ];
    }
    case 'diceRolled':
      return [{ side: null, text: `${e.roll > 1 ? 'Press · ' : ''}Dice ${e.dice[0]} · ${e.dice[1]}` }];
    case 'rerolled':
      return [
        {
          side: e.player,
          text: `${e.source === 'commander' && e.commanderId ? names(v, [e.commanderId]) : 'Forced'} reroll ${e.from} → ${e.to}`,
        },
      ];
    case 'rerollPassed':
      return [];
    case 'resolved': {
      if (e.outcome === 'stale') return [{ side: null, text: `Stale roll${e.staleCount > 1 ? ` (${e.staleCount})` : ''}` }];
      if (e.outcome === 'bloodbath') return [{ side: null, text: 'Bloodbath' }];
      return [{ side: e.winner, text: `${F[e.winner!]} win the clash${e.overwhelming ? ' · overwhelming' : ''}` }];
    }
    case 'advantageGained':
      return [{ side: e.player, text: `${F[e.player]} gain Advantage` }];
    case 'pressed':
      return [];
    case 'brokeOff':
      return [{ side: e.player, text: `${F[e.player]} break off` }];
    case 'casualties':
      return [{ side: e.owner, text: `${F[e.owner]} lose ${names(v, e.cardIds)}` }];
    case 'retreated':
      return e.to ? [{ side: e.player, text: `${F[e.player]} retreat` }] : [];
    case 'engagementEnded':
      return [];
    case 'conceded':
      return [{ side: e.player, text: `${F[e.player]} concede` }];
    case 'roundWon':
      return [{ side: e.winner, text: `${F[e.winner]} take round ${e.round} · ${REASON[e.reason]}` }];
    case 'matchWon':
      return [{ side: e.winner, text: `${F[e.winner]} win the match` }];
    default:
      return [];
  }
}
