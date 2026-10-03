import { describe, expect, test } from 'vitest';
import { HOME_EDGE, applyAction, createMatch, pendingDecision, type MatchState } from '../src/index';
import { buildState, c, defend, engage, eventsOf, mustApply, mustReject, run, types } from './helpers';

const end = (p: 'red' | 'black') => ({ type: 'endTurn', player: p }) as const;

function setupCommandersOnly(s: MatchState): MatchState {
  for (const p of ['red', 'black'] as const) {
    const placements = s.reserve[p].filter((id) => s.cards[id].kind === 'commander').map((cardId) => ({ cardId, hex: HOME_EDGE[p][0] }));
    s = mustApply(s, { type: 'setupPlace', player: p, placements }).state;
  }
  return s;
}

describe('§11.1 Tower victory', () => {
  test('the turn you take the Tower does not count', () => {
    let s = buildState({ board: { '-1,1': ['black:L5'] }, current: 'black' });
    s = mustApply(s, { type: 'move', player: 'black', cardIds: [c('black:L5')], from: '-1,1', path: ['-1,2'] }).state;
    expect(s.towerCount.black).toBe(0);
    s = run(s, end('black')).state;
    expect(s.towerCount.black).toBe(0);
    s = run(s, end('red')).state;
    expect(s.towerCount.black).toBe(1);
  });

  test('leaving the enemy Tower resets the count immediately', () => {
    let s = buildState({ board: { '-1,2': ['black:L5'] }, current: 'black', towerCount: { black: 2 } });
    const r = mustApply(s, { type: 'move', player: 'black', cardIds: [c('black:L5')], from: '-1,2', path: ['-1,1'] });
    expect(r.state.towerCount.black).toBe(0);
    expect(eventsOf(r.events, 'towerCount')).toEqual([{ type: 'towerCount', player: 'black', count: 0, hex: '-1,2' }]);
  });

  test('Tower count is checked before CP: a third count ends the round at once', () => {
    const s = buildState({ board: { '-1,2': ['black:L5'] }, towerCount: { black: 2 } });
    const r = mustApply(s, end('red'));
    expect(types(r.events)).toEqual(['turnEnded', 'towerCount', 'roundWon', 'roundStarted']);
    expect(r.state.phase).toBe('setup');
    expect(r.state.round).toBe(2);
  });
});

describe('§11.2 Decapitation', () => {
  test('destroying both enemy Commanders wins the round immediately', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:K2'] }, destroyed: ['black:K1'], dice: [3, 4] });
    // The lone committed Commander gives Black a reroll; Black passes.
    const r = run(s, engage('red', '0,0', ['red:L7']), { type: 'passReroll', player: 'black' });
    expect(eventsOf(r.events, 'roundWon')).toEqual([{ type: 'roundWon', round: 1, winner: 'red', reason: 'decapitation' }]);
    expect(r.state.roundResults).toEqual([{ round: 1, winner: 'red', reason: 'decapitation' }]);
  });

  test('both lose their last Commander in the same resolution -> attacker wins', () => {
    const s = buildState({ board: { '0,1': ['red:K1', 'red:L7'], '0,0': ['black:K1', 'black:L7'] }, destroyed: ['red:K2', 'black:K2'], dice: [3, 4] });
    let r = run(
      s,
      engage('red', '0,0', ['red:K1', 'red:L7']),
      defend('black', ['black:K1', 'black:L7']),
      { type: 'passReroll', player: 'black' },
      { type: 'passReroll', player: 'red' },
    );
    expect(eventsOf(r.events, 'resolved')[0].outcome).toBe('bloodbath');
    r = run(r.state, { type: 'chooseCasualties', player: 'black', cardIds: [c('black:K1')] }, { type: 'chooseCasualties', player: 'red', cardIds: [c('red:K1')] });
    expect(eventsOf(r.events, 'roundWon')[0]).toMatchObject({ winner: 'red', reason: 'decapitation' });
  });

  test('defender can win by Decapitation too', () => {
    const s = buildState({ board: { '0,1': ['red:K1'], '0,0': ['black:L7'] }, destroyed: ['red:K2'], dice: [3, 4] });
    const r = run(s, engage('red', '0,0', ['red:K1']), { type: 'passReroll', player: 'red' });
    expect(eventsOf(r.events, 'roundWon')[0]).toMatchObject({ winner: 'black', reason: 'decapitation' });
  });
});

describe('§11.3 concession', () => {
  test('either player, any time (setup, own or opponent turn, mid-engagement)', () => {
    const m = createMatch({ seed: 'c', firstPlayer: 'red' });
    const r1 = mustApply(m, { type: 'concede', player: 'black' });
    expect(eventsOf(r1.events, 'roundWon')[0]).toMatchObject({ winner: 'red', reason: 'concede' });
    expect(r1.state.round).toBe(2);

    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:L2', 'black:L3'] }, dice: [1, 3] });
    const mid = mustApply(s, engage('red', '0,0', ['red:L7'])).state;
    const r2 = mustApply(mid, { type: 'concede', player: 'black' });
    expect(r2.state.engagement).toBeNull();
    expect(r2.state.roundWins.red).toBe(1);
    const r3 = mustApply(s, { type: 'concede', player: 'black' }); // not black's turn
    expect(r3.state.roundWins.red).toBe(1);
  });

  test("the conceding player's surviving cards all survive", () => {
    const s = buildState({ board: { '0,0': ['black:L2', 'black:L3'], '1,1': ['red:L4'] }, destroyed: ['black:L9', 'red:L9'] });
    const r = mustApply(s, { type: 'concede', player: 'black' });
    expect(r.state.reserve.black).toContain(c('black:L2'));
    expect(r.state.reserve.black).toContain(c('black:L3'));
    expect(r.state.reserve.black).toHaveLength(26);
    expect(r.state.destroyed.black).toEqual([c('black:L9')]);
  });
});

describe('§11.4 after a round', () => {
  test('next round: new setup, alternate first player, Commanders restored, destroyed stay gone, terrain re-rolled', () => {
    let s = createMatch({ seed: 'rounds', firstPlayer: 'black' });
    const t1 = s.terrain;
    s = setupCommandersOnly(s);
    expect(s.turn!.player).toBe('black');
    // Destroy something by hand through a fight is covered elsewhere; here concede and inspect.
    s = mustApply(s, { type: 'concede', player: 'red' }).state;
    expect(s.phase).toBe('setup');
    expect(s.round).toBe(2);
    expect(s.roundStarter).toBe('red');
    expect(pendingDecision(s)).toEqual({ kind: 'setup', players: ['red', 'black'] });
    expect(s.reserve.red).toHaveLength(27);
    expect(s.stacks).toEqual({});
    expect(s.setup.red).toEqual({ submitted: false, placements: null });
    // terrain is regenerated (same seed stream, so different from round 1 with overwhelming probability)
    expect(s.terrain).not.toEqual(t1);
    s = setupCommandersOnly(s);
    expect(s.turn!.player).toBe('red');
    s = mustApply(s, { type: 'concede', player: 'black' }).state;
    expect(s.round).toBe(3);
    expect(s.roundStarter).toBe('black');
  });

  test('Commanders destroyed in a round come back; other destroyed cards do not', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:K2'] }, destroyed: ['black:K1', 'black:L9', 'black:W'], dice: [3, 4] });
    const r = run(s, engage('red', '0,0', ['red:L7']), { type: 'passReroll', player: 'black' });
    const n = r.state;
    expect(n.round).toBe(2);
    expect(n.destroyed.black.sort()).toEqual([c('black:L9'), c('black:W')].sort());
    expect(n.reserve.black).toContain(c('black:K1'));
    expect(n.reserve.black).toContain(c('black:K2'));
    expect(n.reserve.black).toHaveLength(25);
    expect(mustReject(n, { type: 'setupPlace', player: 'black', placements: [{ cardId: c('black:K1'), hex: '1,-2' }, { cardId: c('black:K2'), hex: '1,-2' }, { cardId: c('black:L9'), hex: '1,-2' }] })).toMatch(/not available/);
  });

  test('a player with no non-Commander cards still plays with two Commanders', () => {
    const all = Object.keys(buildState().cards).filter((id) => id.startsWith('red-') && !id.includes('commander'));
    const s = buildState({ board: { '0,0': ['black:L2'] }, destroyed: all.map((id) => id), current: 'black' });
    const r = mustApply(s, { type: 'concede', player: 'black' });
    expect(r.state.reserve.red).toEqual([c('red:K1'), c('red:K2')]);
    expect(applyAction(r.state, { type: 'setupPlace', player: 'red', placements: [{ cardId: c('red:K1'), hex: '-1,2' }, { cardId: c('red:K2'), hex: '0,2' }] }).ok).toBe(true);
  });

  test('match ends at 2 round wins and is terminal', () => {
    let s = createMatch({ seed: 'm' });
    s = mustApply(s, { type: 'concede', player: 'red' }).state;
    const r = mustApply(s, { type: 'concede', player: 'red' });
    expect(types(r.events)).toEqual(['conceded', 'roundWon', 'matchWon']);
    expect(eventsOf(r.events, 'matchWon')[0]).toEqual({ type: 'matchWon', winner: 'black', roundWins: { red: 0, black: 2 } });
    expect(r.state.phase).toBe('matchOver');
    expect(r.state.winner).toBe('black');
    expect(r.state.roundResults).toEqual([
      { round: 1, winner: 'black', reason: 'concede' },
      { round: 2, winner: 'black', reason: 'concede' },
    ]);
    expect(pendingDecision(r.state)).toEqual({ kind: 'matchOver', players: [], winner: 'black' });
    expect(mustReject(r.state, { type: 'concede', player: 'black' })).toMatch(/over/);
    expect(mustReject(r.state, { type: 'endTurn', player: 'black' })).toMatch(/over/);
  });

  test('split rounds go to a third', () => {
    let s = createMatch({ seed: 'm3', firstPlayer: 'red' });
    s = mustApply(s, { type: 'concede', player: 'red' }).state;
    s = mustApply(s, { type: 'concede', player: 'black' }).state;
    expect(s.round).toBe(3);
    expect(s.roundWins).toEqual({ red: 1, black: 1 });
    expect(s.roundStarter).toBe('red');
    s = mustApply(s, { type: 'concede', player: 'black' }).state;
    expect(s.winner).toBe('red');
  });
});
