import { describe, it, expect } from 'vitest';
import { hasSupply, suppliedHexes, fortifyCost } from '../../src/index';
import { buildState, mustApply, mustReject, c, cs, seq, fight, settle, eventsOf } from './h';

const fort = (hex: string, p: 'red' | 'black' = 'red') => ({ type: 'fortify' as const, player: p, hex });

describe('§10.1 Fortify', () => {
  it('costs 2 CP, or 1 CP if the stack contains a Heavy Infantry', () => {
    const s = buildState({ board: { '0,0': ['red:L5', 'red:L6'], '1,0': ['red:L7', 'red:H4'] } });
    expect(fortifyCost(s, '0,0')).toBe(2);
    expect(fortifyCost(s, '1,0')).toBe(1);
    const a = mustApply(s, fort('0,0'));
    expect(a.state.turn!.cp).toBe(2);
    expect(eventsOf(a.events, 'fortified')[0].cost).toBe(2);
    expect(a.state.fortified['0,0']).toBe('red');
    const b = mustApply(s, fort('1,0'));
    expect(b.state.turn!.cp).toBe(3);
    expect(eventsOf(b.events, 'fortified')[0].cost).toBe(1);
  });

  it('any hex holding your cards can be Fortified, the Tower included', () => {
    mustApply(buildState({ board: { '-1,2': ['red:L5'] } }), fort('-1,2'));
    mustApply(buildState({ board: { '0,0': ['red:L5'] } }), fort('0,0'));
    mustApply(buildState({ board: { '1,-2': ['red:L5'] } }), fort('1,-2')); // the enemy Tower too
  });

  it('cannot Fortify an empty hex, an enemy hex, or an already Fortified hex', () => {
    const s = buildState({ board: { '0,0': ['red:L5'], '0,-1': ['black:L5'] }, fortified: ['0,0'] });
    mustReject(s, fort('1,0'));
    mustReject(s, fort('0,-1'));
    mustReject(s, fort('0,0'));
  });

  it('a card that moved into the hex this turn blocks Fortify; it works on the next turn', () => {
    let s = buildState({ board: { '0,1': ['red:L5'], '0,0': ['red:H6'], '0,-1': ['black:L9'] } });
    s = mustApply(s, { type: 'move', player: 'red', cardIds: cs('red:L5'), from: '0,1', path: ['0,0'] }).state;
    mustReject(s, fort('0,0'));
    s = mustApply(mustApply(s, { type: 'endTurn', player: 'red' }).state, { type: 'endTurn', player: 'black' }).state;
    mustApply(s, fort('0,0'));
  });

  it('cards that left the hex do not block the ones that stayed', () => {
    let s = buildState({ board: { '0,0': ['red:L5', 'red:H6'] } });
    s = mustApply(s, { type: 'move', player: 'red', cardIds: cs('red:L5'), from: '0,0', path: ['1,0'] }).state;
    mustApply(s, fort('0,0'));
  });

  it('arriving by Deploy, Spawn or Withdraw also blocks Fortify', () => {
    const d = mustApply(buildState({ board: { '-1,2': ['red:H5'] } }), { type: 'deploy', player: 'red', cardIds: cs('red:L2') }).state;
    mustReject(d, fort('-1,2'));
    const sp = mustApply(buildState({ board: { '1,0': ['red:H5'] } }), { type: 'spawnWit', player: 'red', hex: '1,0' }).state;
    mustReject(sp, fort('1,0'));
    const w = mustApply(buildState({ board: { '0,0': ['red:L5'], '0,1': ['red:H5'] } }), { type: 'withdraw', player: 'red', cardIds: cs('red:L5'), from: '0,0', to: '0,1' }).state;
    mustReject(w, fort('0,1'));
  });

  it('a Fortified hex keeps its status when cards join it', () => {
    let s = buildState({ board: { '0,0': ['red:H6'], '0,1': ['red:L5'] }, fortified: ['0,0'] });
    s = mustApply(s, { type: 'move', player: 'red', cardIds: cs('red:L5'), from: '0,1', path: ['0,0'] }).state;
    expect(s.fortified['0,0']).toBe('red');
    const d = mustApply(buildState({ board: { '-1,2': ['red:H6'] }, fortified: ['-1,2'] }), { type: 'deploy', player: 'red', cardIds: cs('red:L2') }).state;
    expect(d.fortified['-1,2']).toBe('red');
  });

  it('if some cards leave, the cards that remain stay Fortified; it ends when all have left', () => {
    let s = buildState({ board: { '0,0': ['red:H6', 'red:L5'] }, fortified: ['0,0'] });
    s = mustApply(s, { type: 'move', player: 'red', cardIds: cs('red:L5'), from: '0,0', path: ['1,0'] }).state;
    expect(s.fortified['0,0']).toBe('red');
    const r = mustApply(s, { type: 'move', player: 'red', cardIds: cs('red:H6'), from: '0,0', path: ['0,1'] });
    expect(r.state.fortified['0,0']).toBeUndefined();
    expect(eventsOf(r.events, 'fortifyEnded')[0]).toMatchObject({ player: 'red', hex: '0,0' });
  });

  it('it ends when no cards remain because they were all destroyed', () => {
    const s = buildState({ board: { '0,1': ['red:L5'], '0,0': ['black:L8'] }, fortified: ['0,0'], dice: [2, 3] });
    const r = settle(fight(s, { target: '0,0', atk: ['red:L5'] }));
    expect(r.state.fortified['0,0']).toBeUndefined();
    expect(eventsOf(r.events, 'fortifyEnded')).toHaveLength(1);
  });

  it('a Fortified hex that is vacated can be Fortified again later by another stack', () => {
    let s = buildState({ board: { '0,0': ['red:H6'], '0,1': ['red:H5'] }, fortified: ['0,0'] });
    s = mustApply(s, { type: 'move', player: 'red', cardIds: cs('red:H6'), from: '0,0', path: ['1,0'] }).state;
    s = mustApply(mustApply(s, { type: 'endTurn', player: 'red' }).state, { type: 'endTurn', player: 'black' }).state;
    s = mustApply(s, { type: 'move', player: 'red', cardIds: cs('red:H5'), from: '0,1', path: ['0,0'] }).state;
    expect(s.fortified['0,0']).toBeUndefined();
  });
});

describe('§10.2 Supply line', () => {
  const chain = (extra: Record<string, string[]> = {}) => buildState({ board: { '-1,2': ['red:L2'], '-1,1': ['red:L3'], '-1,0': ['red:H4'], ...extra } });

  it('exists when every hex in a chain from your Tower to the hex holds your cards', () => {
    const s = chain();
    expect(hasSupply(s, 'red', '-1,2')).toBe(true);
    expect(hasSupply(s, 'red', '-1,1')).toBe(true);
    expect(hasSupply(s, 'red', '-1,0')).toBe(true);
    expect([...suppliedHexes(s, 'red')].sort()).toEqual(['-1,0', '-1,1', '-1,2']);
  });

  it('a bent chain also works', () => {
    const s = buildState({ board: { '-1,2': ['red:L2'], '0,1': ['red:L3'], '0,0': ['red:H4'] } });
    expect(hasSupply(s, 'red', '0,0')).toBe(true);
  });

  it('a gap in the chain breaks the supply line', () => {
    const s = buildState({ board: { '-1,2': ['red:L2'], '-1,0': ['red:H4'] } });
    expect(hasSupply(s, 'red', '-1,0')).toBe(false);
  });

  it('an empty Tower cuts all supply', () => {
    const s = buildState({ board: { '-1,1': ['red:L3'], '-1,0': ['red:H4'] } });
    expect(hasSupply(s, 'red', '-1,1')).toBe(false);
    expect(hasSupply(s, 'red', '-1,0')).toBe(false);
    expect(suppliedHexes(s, 'red')).toHaveLength(0);
  });

  it('an enemy on the Tower cuts supply; an enemy in the chain cuts that route', () => {
    expect(hasSupply(buildState({ board: { '-1,2': ['black:L2'], '-1,1': ['red:L3'] } }), 'red', '-1,1')).toBe(false);
    const s = buildState({ board: { '-1,2': ['red:L2'], '-1,1': ['black:L3'], '-1,0': ['red:H4'] } });
    expect(hasSupply(s, 'red', '-1,0')).toBe(false);
  });

  it('supply is per player: Black supply runs from the Black Tower', () => {
    const s = buildState({ board: { '1,-2': ['black:L2'], '1,-1': ['black:L3'] } });
    expect(hasSupply(s, 'black', '1,-1')).toBe(true);
    expect(hasSupply(s, 'red', '1,-1')).toBe(false);
  });
});

describe('§10.3 Reinforce', () => {
  const rf = (hex: string, card = 'red:L2') => ({ type: 'reinforce' as const, player: 'red' as const, cardId: c(card), hex });
  const line = (o: any = {}) => buildState({ board: { '-1,2': ['red:L5'], '-1,1': ['red:L6'], '-1,0': ['red:H4'] }, fortified: ['-1,0'], ...o });

  it('costs 3 CP and moves exactly 1 Reserve card onto a Fortified hex with supply', () => {
    const r = mustApply(line(), rf('-1,0'));
    expect(r.state.turn!.cp).toBe(1);
    expect(r.state.stacks['-1,0']).toContain(c('red:L2'));
    expect(r.state.reserve.red).not.toContain(c('red:L2'));
    expect(r.state.fortified['-1,0']).toBe('red');
    expect(eventsOf(r.events, 'reinforced')).toHaveLength(1);
  });

  it('the Fortified Tower itself can be Reinforced', () => {
    mustApply(buildState({ board: { '-1,2': ['red:H4'] }, fortified: ['-1,2'] }), rf('-1,2'));
  });

  it('requires the hex to be Fortified', () => {
    mustReject(line({ fortified: [] }), rf('-1,0'));
  });

  it('requires an unbroken supply line, including the Tower', () => {
    mustReject(buildState({ board: { '-1,2': ['red:L5'], '-1,0': ['red:H4'] }, fortified: ['-1,0'] }), rf('-1,0'));
    mustReject(buildState({ board: { '-1,1': ['red:L6'], '-1,0': ['red:H4'] }, fortified: ['-1,0'] }), rf('-1,0'));
  });

  it('the card must be in Reserve; Wit and Commanders cannot be Reinforced', () => {
    mustReject(line(), rf('-1,0', 'red:L5')); // on the board
    mustReject(line(), rf('-1,0', 'red:W'));
    mustReject(line(), rf('-1,0', 'red:K1'));
    mustReject(line(), rf('-1,0', 'black:L2'));
  });

  it('cannot Reinforce a hex that is not yours', () => {
    mustReject(buildState({ board: { '-1,2': ['red:L5'], '0,0': ['black:H4'] }, fortified: ['0,0'] }), rf('0,0'));
  });
});

describe('§10.4 Deploy', () => {
  const dp = (...ids: string[]) => ({ type: 'deploy' as const, player: 'red' as const, cardIds: cs(...ids) });

  it('puts exactly 1 Reserve card on your own Tower for 1 CP', () => {
    for (const ids of [['red:L2'], ['red:H3'], ['red:A1'], ['red:S1'], ['red:V2']]) {
      const r = mustApply(buildState(), dp(...ids));
      expect(r.state.stacks['-1,2'].sort()).toEqual(cs(...ids).sort());
      expect(r.state.turn!.cp).toBe(3);
      for (const i of ids) expect(r.state.reserve.red).not.toContain(c(i));
    }
  });

  it('adds to a stack already on the Tower', () => {
    const r = mustApply(buildState({ board: { '-1,2': ['red:L5'] } }), dp('red:L2'));
    expect(r.state.stacks['-1,2']).toHaveLength(2);
  });

  it('rejects 0, 2 or 3 cards, Wit, Commanders, cards not in Reserve and the opponent cards', () => {
    const s = buildState({ board: { '0,0': ['red:L5'] } });
    mustReject(s, dp());
    mustReject(s, dp('red:L2', 'red:H3'));
    mustReject(s, dp('red:L2', 'red:H3', 'red:A1'));
    mustReject(s, dp('red:W'));
    mustReject(s, dp('red:K1'));
    mustReject(s, dp('red:L5'));
    mustReject(s, dp('black:L2'));
  });

  it('is not allowed while enemy cards occupy your Tower', () => {
    mustReject(buildState({ board: { '-1,2': ['black:L5'] } }), dp('red:L2'));
  });
});
