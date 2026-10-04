import { describe, expect, it } from 'vitest';
import type { PendingDecision } from '@towers/engine';
import { possessive, statusFor } from '../src/game/status';

const zero = { red: 0, black: 0 };
const setup = (player: 'red' | 'black', step: 'commander' | 'troop', over: Partial<PendingDecision & { kind: 'setup' }> = {}): PendingDecision => ({
  kind: 'setup',
  players: [player],
  player,
  step,
  eligible: [],
  hexes: [],
  placed: zero,
  commandersLeft: { red: 2, black: 2 },
  troopsLeft: { red: 6, black: 6 },
  ...over,
});

describe('statusFor', () => {
  it('names the setup step and progress', () => {
    expect(statusFor({ pd: setup('red', 'commander'), seat: 'red', cp: 0 }).text).toBe('Place a Commander (1 of 2)');
    expect(statusFor({ pd: setup('red', 'commander', { placed: { red: 1, black: 0 }, commandersLeft: { red: 1, black: 2 } }), seat: 'red', cp: 0 }).text).toBe(
      'Place a Commander (2 of 2)',
    );
    const troop = setup('red', 'troop', { placed: { red: 5, black: 4 }, commandersLeft: zero, troopsLeft: { red: 3, black: 4 } });
    expect(statusFor({ pd: troop, seat: 'red', cp: 0, troopsPlaced: { red: 3, black: 2 } }).text).toBe('Place a card · 4 of 6');
    const theirs = statusFor({ pd: troop, seat: 'black', cp: 0, troopsPlaced: { red: 3, black: 2 } });
    expect(theirs).toEqual({ text: 'Kholin place a card · 4 of 6', actor: 'red', mine: false });
  });

  it('says whose turn it is and the CP left', () => {
    const pd: PendingDecision = { kind: 'turn', players: ['black'], player: 'black', cp: 3, capRemaining: {} as never };
    expect(statusFor({ pd, seat: 'black', cp: 3 })).toEqual({ text: 'Your turn · 3 CP', actor: 'black', mine: true });
    expect(statusFor({ pd, seat: 'red', cp: 3 }).text).toBe("Singers' turn");
    expect(statusFor({ pd, seat: 'black', cp: 3, step: 'deployPicked' }).text).toBe('Deploy · place it on your Tower');
  });

  it('asks for each engagement decision, or waits for the opponent', () => {
    const defend: PendingDecision = { kind: 'defend', players: ['red'], player: 'red', target: '0,0', eligible: [], min: 1, max: 3, witEligible: false };
    expect(statusFor({ pd: defend, seat: 'red', cp: 0 }).text).toBe('Defend · commit up to 3');
    expect(statusFor({ pd: defend, seat: 'black', cp: 0 }).text).toBe('Waiting for Kholin…');
    const reroll: PendingDecision = { kind: 'reroll', players: ['red'], player: 'red', dice: [1, 2], options: [] };
    expect(statusFor({ pd: reroll, seat: 'red', cp: 0 }).text).toBe('Reroll a die or pass');
    const press: PendingDecision = { kind: 'pressOrBreak', players: ['red'], player: 'red', staleCount: 1 };
    expect(statusFor({ pd: press, seat: 'red', cp: 0 }).text).toBe('Press or break off');
    const cas = (owner: 'red' | 'black', count: number): PendingDecision => ({
      kind: 'casualties',
      players: ['red'],
      player: 'red',
      owner,
      count,
      eligible: [],
      reason: 'loss' as never,
    });
    expect(statusFor({ pd: cas('red', 1), seat: 'red', cp: 0 }).text).toBe('Choose 1 casualty');
    expect(statusFor({ pd: cas('red', 2), seat: 'red', cp: 0 }).text).toBe('Choose 2 casualties');
    expect(statusFor({ pd: cas('black', 1), seat: 'red', cp: 0 }).text).toBe('Strike 1 · choose a card');
    const retreat: PendingDecision = { kind: 'retreat', players: ['red'], player: 'red', from: '0,0', hexes: [] };
    expect(statusFor({ pd: retreat, seat: 'red', cp: 0 }).text).toBe('Retreat or stay');
  });

  it('names the winner once the match is over', () => {
    expect(statusFor({ pd: { kind: 'matchOver', players: [], winner: 'red' }, seat: 'black', cp: 0 })).toEqual({
      text: 'Kholin win the match',
      actor: null,
      mine: false,
    });
  });

  it('forms possessives', () => {
    expect(possessive('Singers')).toBe("Singers'");
    expect(possessive('Kholin')).toBe("Kholin's");
  });
});
