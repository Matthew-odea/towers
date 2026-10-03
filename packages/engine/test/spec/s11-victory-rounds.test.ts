import { describe, it, expect } from 'vitest';
import { pendingDecision, ALL_HEXES, TOWER } from '../../src/index';
import { buildState, mustApply, mustReject, c, cs, seq, fight, settle, eventsOf, pend, placeCommanders, last } from './h';

const end = (s: any, p: 'red' | 'black') => mustApply(s, { type: 'endTurn', player: p });

describe('§11.1 Tower victory', () => {
  it('count timing: the turn you take the Tower does not count; the first count is at the start of your next turn', () => {
    let s = buildState({ current: 'black', board: { '-1,1': ['black:L5'], '0,0': ['red:L7'] } });
    s = mustApply(s, { type: 'move', player: 'black', cardIds: cs('black:L5'), from: '-1,1', path: ['-1,2'] }).state;
    expect(s.towerCount.black).toBe(0);
    s = end(s, 'black').state;
    expect(s.towerCount.black).toBe(0);
    s = end(s, 'red').state; // black's next turn starts
    expect(s.towerCount.black).toBe(1);
  });

  it('worked example 8: counts 1, 2, then 3 wins the round at the start of the third counted turn', () => {
    let s = buildState({ current: 'black', board: { '-1,1': ['black:L5'], '0,0': ['red:L7'] } });
    s = mustApply(s, { type: 'move', player: 'black', cardIds: cs('black:L5'), from: '-1,1', path: ['-1,2'] }).state;
    const counts: number[] = [];
    let ev: any[] = [];
    for (let i = 0; i < 3; i++) {
      s = end(s, 'black').state;
      s = end(s, 'red').state;
      if (s.phase === 'play') counts.push(s.towerCount.black);
      if (i === 2) {
        const r = { state: s };
        expect(r.state.round).toBe(2);
      }
    }
    expect(counts).toEqual([1, 2]);
    expect(s.roundWins).toEqual({ red: 0, black: 1 });
    expect(s.roundResults[0]).toMatchObject({ round: 1, winner: 'black', reason: 'tower' });
    expect(ev).toEqual([]);
  });

  it('reaching 3 wins immediately at turn start (event reports the count)', () => {
    const s = buildState({ board: { '-1,2': ['black:L5'], '0,0': ['red:L7'] }, towerCount: { black: 2 } });
    const r = end(s, 'red');
    expect(eventsOf(r.events, 'towerCount').map((e) => e.count)).toContain(3);
    expect(eventsOf(r.events, 'roundWon')[0]).toMatchObject({ winner: 'black', reason: 'tower' });
    expect(r.state.round).toBe(2);
  });

  it('Red wins the same way by holding the Black Tower', () => {
    const s = buildState({ current: 'black', board: { '1,-2': ['red:L5'], '0,0': ['black:L7'] }, towerCount: { red: 2 } });
    const r = end(s, 'black');
    expect(eventsOf(r.events, 'roundWon')[0]).toMatchObject({ winner: 'red', reason: 'tower' });
  });

  it('the opponent turn start does not advance your count', () => {
    const s = buildState({ board: { '-1,2': ['black:L5'], '0,0': ['red:L7'] }, towerCount: { black: 1 }, current: 'black' });
    const r = end(s, 'black').state; // red turn starts
    expect(r.towerCount.black).toBe(1);
  });

  it('count resets to 0 the moment the enemy Tower no longer holds any of your cards: moving off', () => {
    const s = buildState({ current: 'black', board: { '-1,2': ['black:L5'], '0,0': ['red:L7'] }, towerCount: { black: 2 } });
    const r = mustApply(s, { type: 'move', player: 'black', cardIds: cs('black:L5'), from: '-1,2', path: ['-1,1'] });
    expect(r.state.towerCount.black).toBe(0);
    expect(eventsOf(r.events, 'towerCount').some((e) => e.player === 'black' && e.count === 0)).toBe(true);
  });

  it('count resets immediately when the last card on the Tower is destroyed (Red clears it)', () => {
    const s = buildState({ board: { '-1,1': ['red:L5'], '-1,2': ['black:L9'], '1,0': ['black:L2'] }, towerCount: { black: 2 }, dice: [2, 3] });
    const r = settle(fight(s, { target: '-1,2', atk: ['red:L5'] }));
    expect(r.state.towerCount.black).toBe(0);
    expect(r.state.stacks['-1,2']).toBeUndefined();
    // black's next turn does not restart at 3
    const n = end(r.state, 'red').state;
    expect(n.towerCount.black).toBe(0);
  });

  it('the count survives while some of your cards remain on the Tower', () => {
    const s = buildState({ current: 'black', board: { '-1,2': ['black:L5', 'black:L6'], '0,0': ['red:L7'] }, towerCount: { black: 2 } });
    const r = mustApply(s, { type: 'move', player: 'black', cardIds: cs('black:L5'), from: '-1,2', path: ['-1,1'] });
    expect(r.state.towerCount.black).toBe(2);
  });

  it('not occupying the enemy Tower at the start of your turn means a count of 0', () => {
    const s = buildState({ board: { '0,0': ['black:L5', 'red:L7'.replace('red', 'black')], '1,0': ['red:L7'] }, towerCount: { black: 2 } });
    const r = end(s, 'red').state;
    expect(r.towerCount.black).toBe(0);
  });

  it('after a reset the count starts over: re-entering counts 1 only on the following turn', () => {
    let s = buildState({ current: 'black', board: { '-1,2': ['black:L5'], '0,0': ['red:L7'] }, towerCount: { black: 2 } });
    s = mustApply(s, { type: 'move', player: 'black', cardIds: cs('black:L5'), from: '-1,2', path: ['-1,1'] }).state;
    s = mustApply(s, { type: 'move', player: 'black', cardIds: cs('black:L5'), from: '-1,1', path: ['-1,2'] }).state;
    expect(s.towerCount.black).toBe(0);
    s = end(end(s, 'black').state, 'red').state;
    expect(s.towerCount.black).toBe(1);
  });
});

describe('§11.2 Decapitation', () => {
  it('destroying both enemy Commanders wins the round immediately', () => {
    const s = buildState({ board: { '0,1': ['red:L4', 'red:H4'], '0,0': ['black:K1', 'black:K2'] }, dice: [2, 2] });
    const r = settle(fight(s, { target: '0,0', atk: ['red:L4', 'red:H4'], def: ['black:K1', 'black:K2'] }));
    expect(eventsOf(r.events, 'roundWon')[0]).toMatchObject({ winner: 'red', reason: 'decapitation' });
    expect(r.state.roundWins.red).toBe(1);
    expect(r.state.round).toBe(2);
    expect(r.state.phase).toBe('setup');
  });

  it('destroying only one Commander does not win', () => {
    const s = buildState({ board: { '0,1': ['red:L4'], '0,0': ['black:K1', 'black:K2'] }, dice: [2, 2] });
    const r = settle(fight(s, { target: '0,0', atk: ['red:L4'], def: ['black:K1', 'black:K2'] }));
    expect(eventsOf(r.events, 'roundWon')).toHaveLength(0);
    expect(r.state.round).toBe(1);
  });

  it('a Commander destroyed earlier in the round counts: the second one finishes it', () => {
    const s = buildState({ board: { '0,1': ['red:L4'], '0,0': ['black:K2'] }, destroyed: ['black:K1'], dice: [2, 2] });
    const r = settle(fight(s, { target: '0,0', atk: ['red:L4'] }));
    expect(eventsOf(r.events, 'roundWon')[0]).toMatchObject({ winner: 'red', reason: 'decapitation' });
  });

  it('Commanders in Reserve (not destroyed) never trigger it', () => {
    const s = buildState({ board: { '0,1': ['red:L4'], '0,0': ['black:L9'] }, dice: [2, 2] });
    const r = settle(fight(s, { target: '0,0', atk: ['red:L4'] }));
    expect(eventsOf(r.events, 'roundWon')).toHaveLength(0);
  });

  it('Commanders in a Bloodbath: the loser of a casualty pick may lose them and the round ends', () => {
    const s = buildState({ board: { '0,1': ['red:K1', 'red:L7'], '0,0': ['black:K1', 'black:H7'] }, destroyed: ['red:K2', 'black:K2'], dice: [3, 4] });
    let r = fight(s, { target: '0,0', atk: ['red:K1', 'red:L7'], def: ['black:K1', 'black:H7'] });
    r = settle(r, { pick: (p) => [p.owner === 'red' ? c('red:K1') : c('black:K1')] });
    expect(eventsOf(r.events, 'roundWon')).toHaveLength(1);
  });

  it('simultaneous loss of the last Commanders: the attacker wins the round', () => {
    const s = buildState({ board: { '0,1': ['red:K1', 'red:L7'], '0,0': ['black:K1', 'black:H7'] }, destroyed: ['red:K2', 'black:K2'], dice: [3, 4] });
    let r = fight(s, { target: '0,0', atk: ['red:K1', 'red:L7'], def: ['black:K1', 'black:H7'] });
    r = settle(r, { pick: (p) => [p.owner === 'red' ? c('red:K1') : c('black:K1')] });
    expect(eventsOf(r.events, 'roundWon')[0]).toMatchObject({ winner: 'red', reason: 'decapitation' });
    const t = fight(buildState({ current: 'black', board: { '0,1': ['red:K1', 'red:L7'], '0,0': ['black:K1', 'black:H7'] }, destroyed: ['red:K2', 'black:K2'], dice: [3, 4] }),
      { target: '0,1', atk: ['black:K1', 'black:H7'], def: ['red:K1', 'red:L7'] });
    const t2 = settle(t, { pick: (p) => [p.owner === 'red' ? c('red:K1') : c('black:K1')] });
    expect(eventsOf(t2.events, 'roundWon')[0]).toMatchObject({ winner: 'black', reason: 'decapitation' });
  });
});

describe('§11.3 Concession', () => {
  it('a player may concede at any time, even on the opponent turn; the opponent wins the round', () => {
    const s = buildState({ board: { '0,0': ['red:L5'] } });
    const r = mustApply(s, { type: 'concede', player: 'black' });
    expect(eventsOf(r.events, 'roundWon')[0]).toMatchObject({ winner: 'red', reason: 'concede' });
    expect(r.state.roundWins).toEqual({ red: 1, black: 0 });
  });

  it('the conceding player may concede on their own turn too, with 0 CP', () => {
    const s = buildState({ cp: 0, board: { '0,0': ['red:L5'] } });
    expect(mustApply(s, { type: 'concede', player: 'red' }).state.roundWins.black).toBe(1);
  });

  it('may concede during setup', () => {
    let s = mustApply(mustApply(buildState({ board: { '0,0': ['red:L5'] } }), { type: 'concede', player: 'red' }).state, { type: 'concede', player: 'black' }).state;
    expect(s.roundWins).toEqual({ red: 1, black: 1 });
    expect(s.phase).toBe('setup');
    expect(s.round).toBe(3);
  });

  it('may concede in the middle of an engagement', () => {
    const s = buildState({ board: { '0,1': ['red:K1', 'red:L5'], '0,0': ['black:L9'] }, dice: [1, 2] });
    const r = fight(s, { target: '0,0', atk: ['red:K1', 'red:L5'] });
    expect(r.state.engagement).not.toBeNull();
    const q = mustApply(r.state, { type: 'concede', player: 'black' });
    expect(q.state.engagement).toBeNull();
    expect(q.state.roundWins.red).toBe(1);
  });

  it('the conceding player surviving cards all survive into the next round', () => {
    const s = buildState({ board: { '0,0': ['red:L5', 'red:H6'] }, destroyed: ['red:L9'] });
    const r = mustApply(s, { type: 'concede', player: 'red' }).state;
    const ids = r.reserve.red;
    expect(ids).toContain(c('red:L5'));
    expect(ids).toContain(c('red:H6'));
    expect(ids).toHaveLength(26);
  });
});

describe('§11.4 After a round', () => {
  const after = () => {
    const s = buildState({
      board: { '0,1': ['red:L5', 'red:K1'], '0,0': ['black:L9'], '-1,2': ['red:H4'] },
      fortified: ['-1,2'], destroyed: ['red:K2', 'red:L2', 'black:K1', 'black:K2'], towerCount: { red: 1 },
    });
    return mustApply(s, { type: 'concede', player: 'black' }).state;
  };

  it('winner gains a round win and the next round starts in setup with a clean board', () => {
    const r = after();
    expect(r.roundWins).toEqual({ red: 1, black: 0 });
    expect(r.phase).toBe('setup');
    expect(r.round).toBe(2);
    expect(r.turn).toBeNull();
    expect(Object.keys(r.stacks)).toHaveLength(0);
    expect(Object.keys(r.fortified)).toHaveLength(0);
    expect(r.towerCount).toEqual({ red: 0, black: 0 });
    expect(r.engagement).toBeNull();
    expect(r.setup.red.submitted).toBe(false);
    expect(r.setup.black.submitted).toBe(false);
  });

  it('Commanders are restored at full count (2) even if destroyed; other destroyed cards stay gone', () => {
    const r = after();
    for (const p of ['red', 'black'] as const) {
      expect(r.destroyed[p].some((i) => i.includes('commander'))).toBe(false);
      expect(r.reserve[p].filter((i) => i.includes('commander'))).toHaveLength(2);
    }
    expect(r.destroyed.red).toEqual(cs('red:L2'));
    expect(r.reserve.red).not.toContain(c('red:L2'));
    expect(r.reserve.red).toHaveLength(26);
    expect(r.reserve.black).toHaveLength(27);
  });

  it('a restored Commander can be placed in the new setup; a player with only Commanders still plays', () => {
    let r = after();
    r = mustApply(r, placeCommanders(r, 'red')).state;
    r = mustApply(r, placeCommanders(r, 'black')).state;
    expect(r.phase).toBe('play');
    expect(r.stacks['-1,2']).toContain(c('red:K1'));
  });

  it('the new round terrain is point-symmetric', () => {
    const t = after().terrain;
    for (const h of ALL_HEXES) {
      const [q, rr] = h.split(',').map(Number);
      expect(t[`${-q},${-rr}`]).toBe(t[h]);
    }
    expect(t[TOWER.red]).toBe('tower');
  });

  it('the match ends at 2 round wins with no further setup', () => {
    const s = buildState({ round: 2, roundWins: { red: 1 }, board: { '0,0': ['red:L5'] } });
    const r = mustApply(s, { type: 'concede', player: 'black' });
    expect(r.state.phase).toBe('matchOver');
    expect(r.state.roundWins.red).toBe(2);
    expect(eventsOf(r.events, 'matchWon')[0]).toMatchObject({ winner: 'red' });
    expect(pendingDecision(r.state)).toMatchObject({ kind: 'matchOver', winner: 'red' });
  });

  it('a Decapitation or Tower win also advances the match the same way', () => {
    const s = buildState({ round: 2, roundWins: { black: 1 }, board: { '-1,2': ['black:L5'], '0,0': ['red:L7'] }, towerCount: { black: 2 } });
    const r = end(s, 'red');
    expect(r.state.phase).toBe('matchOver');
    expect(r.state.winner).toBe('black');
  });
});
