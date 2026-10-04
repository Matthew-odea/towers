// RULINGS §13 worked examples — all must hold.
import { describe, expect, test } from 'vitest';
import { pendingDecision } from '../src/index';
import { buildState, c, defend, engage, eventsOf, mustApply, run } from './helpers';

describe('§13 worked examples', () => {
  test('1. Light 4 + Heavy 4 + Shardbearer on 2+2: 3 activations, Overwhelming 2, Shardstrike picks 1, defender picks the other', () => {
    const s = buildState({ board: { '0,1': ['red:L4', 'red:H4', 'red:S1'], '0,0': ['black:L8', 'black:L9', 'black:L10'] }, dice: [2, 2] });
    let r = run(s, engage('red', '0,0', ['red:L4', 'red:H4', 'red:S1']), defend('black', ['black:L8', 'black:L9', 'black:L10']));
    const res = eventsOf(r.events, 'resolved')[0];
    expect(res).toMatchObject({ outcome: 'attacker', overwhelming: true, shardstrike: { attacker: true, defender: false } });
    expect(res.counts).toEqual({ attacker: 3, defender: 0 });
    expect(pendingDecision(r.state)).toMatchObject({ kind: 'casualties', player: 'red', owner: 'black', count: 1, reason: 'shardstrike' });
    r = run(r.state, { type: 'chooseCasualties', player: 'red', cardIds: [c('black:L10')] });
    expect(pendingDecision(r.state)).toMatchObject({ kind: 'casualties', player: 'black', owner: 'black', count: 1, eligible: [c('black:L8'), c('black:L9')] });
    r = run(r.state, { type: 'chooseCasualties', player: 'black', cardIds: [c('black:L9')] });
    expect(r.state.destroyed.black.sort()).toEqual([c('black:L10'), c('black:L9')].sort());
    const cas = eventsOf(r.events, 'casualties');
    expect(cas.map((e) => [e.chosenBy, e.cardIds])).toEqual([
      ['red', [c('black:L10')]],
      ['black', [c('black:L9')]],
    ]);
  });

  test('1b. same, defender committed 2: both die whatever is picked, so nobody is asked', () => {
    const s = buildState({ board: { '0,1': ['red:L4', 'red:H4', 'red:S1'], '0,0': ['black:L8', 'black:L9', 'black:L10'] }, dice: [2, 2] });
    const r = run(s, engage('red', '0,0', ['red:L4', 'red:H4', 'red:S1']), defend('black', ['black:L8', 'black:L9']));
    expect(pendingDecision(r.state)?.kind).not.toBe('casualties');
    expect(r.state.destroyed.black.sort()).toEqual([c('black:L8'), c('black:L9')].sort());
    expect(r.state.stacks['0,0']).toEqual([c('black:L10')]);
    const cas = eventsOf(r.events, 'casualties');
    expect(cas).toHaveLength(1);
    expect(cas[0]).toMatchObject({ owner: 'black', chosenBy: 'red', auto: true });
  });

  test('1c. same, defender committed 1: only 1 dies', () => {
    const s = buildState({ board: { '0,1': ['red:L4', 'red:H4', 'red:S1'], '0,0': ['black:L8', 'black:L9'] }, dice: [2, 2] });
    const r = run(s, engage('red', '0,0', ['red:L4', 'red:H4', 'red:S1']), defend('black', ['black:L8']));
    expect(r.state.destroyed.black).toEqual([c('black:L8')]);
  });

  test('2. Bloodbath: exactly 1 casualty each regardless of activations; Shardstrike picks the opponent casualty', () => {
    const s = buildState({ board: { '0,1': ['red:L7', 'red:S1', 'red:H7'], '0,0': ['black:L7', 'black:H7', 'black:L2'] }, dice: [3, 4] });
    let r = run(s, engage('red', '0,0', ['red:L7', 'red:S1', 'red:H7']), defend('black', ['black:L7', 'black:H7', 'black:L2']));
    expect(eventsOf(r.events, 'resolved')[0]).toMatchObject({ outcome: 'bloodbath', counts: { attacker: 3, defender: 2 } });
    expect(pendingDecision(r.state)).toMatchObject({ player: 'black', owner: 'black', count: 1, reason: 'bloodbath' });
    r = run(r.state, { type: 'chooseCasualties', player: 'black', cardIds: [c('black:L2')] });
    expect(pendingDecision(r.state)).toMatchObject({ player: 'red', owner: 'red', count: 1, reason: 'bloodbath' });
    r = run(r.state, { type: 'chooseCasualties', player: 'red', cardIds: [c('red:H7')] });
    expect(r.state.destroyed).toEqual({ red: [c('red:H7')], black: [c('black:L2')] });

    const s2 = buildState({ board: { '0,1': ['red:L4', 'red:S1'], '0,0': ['black:L4', 'black:L5', 'black:L6'] }, dice: [2, 2] });
    const r2 = run(s2, engage('red', '0,0', ['red:L4', 'red:S1']), defend('black', ['black:L4', 'black:L5', 'black:L6']));
    expect(eventsOf(r2.events, 'resolved')[0]).toMatchObject({ outcome: 'bloodbath', shardstrike: { attacker: true, defender: false } });
    expect(pendingDecision(r2.state)).toMatchObject({ player: 'red', owner: 'black', count: 1, reason: 'shardstrike' });
  });

  test('3. Attack from 3 adjacent hexes: Surrounded + Flanking; attacker wins and chooses the casualties', () => {
    const s = buildState({
      board: { '0,1': ['red:L7'], '1,-1': ['red:L8'], '-1,0': ['red:L6'], '0,0': ['black:L2', 'black:L3', 'black:L4'] },
      dice: [3, 4],
    });
    const r = run(s, engage('red', '0,0', ['red:L7', 'red:L8', 'red:L6']), defend('black', ['black:L2', 'black:L3', 'black:L4']));
    const st = eventsOf(r.events, 'engagementStarted')[0];
    expect(st.modifiers.attacker.advantage).toContain('flanking');
    expect(st.modifiers.defender.disadvantage).toContain('surrounded');
    expect(pendingDecision(r.state)).toMatchObject({ kind: 'casualties', player: 'red', owner: 'black', count: 1, reason: 'advantage' });
  });

  test('4. Commander + Light 8, roll 2+5: defender passes, Commander rerolls the 2 into a 3 -> 8 activates', () => {
    const s = buildState({ board: { '0,1': ['red:K1', 'red:L8'], '0,0': ['black:L2', 'black:L3'] }, dice: [2, 5, 3] });
    let r = run(s, engage('red', '0,0', ['red:K1', 'red:L8']), defend('black', ['black:L2']));
    // Black has no reroll and passes automatically; Red is asked.
    expect(eventsOf(r.events, 'rerollPassed')).toEqual([{ type: 'rerollPassed', player: 'black', auto: true }]);
    expect(pendingDecision(r.state)).toMatchObject({ kind: 'reroll', player: 'red', dice: [2, 5] });
    r = run(r.state, { type: 'reroll', player: 'red', source: 'commander', die: 0 });
    expect(eventsOf(r.events, 'rerolled')[0]).toMatchObject({ from: 2, to: 3, dice: [3, 5] });
    expect(eventsOf(r.events, 'resolved')[0]).toMatchObject({ outcome: 'attacker', activating: { attacker: [c('red:L8')], defender: [] } });
  });

  test('5. Ranged Archer vs Light 7 on 1+6: Bloodbath, the immune Archer survives, defender loses 1', () => {
    const s = buildState({ board: { '0,2': ['red:A1'], '0,0': ['black:L7'] }, dice: [1, 6] });
    const r = mustApply(s, engage('red', '0,0', ['red:A1']));
    expect(eventsOf(r.events, 'resolved')[0]).toMatchObject({
      outcome: 'bloodbath',
      activating: { attacker: [c('red:A1')], defender: [c('black:L7')] },
    });
    expect(r.state.destroyed).toEqual({ red: [], black: [c('black:L7')] });
    expect(r.state.stacks['0,2']).toEqual([c('red:A1')]);
  });

  test('6. Defender commits only 1 card; attacker wins with 2 activations -> only 1 casualty', () => {
    const s = buildState({ board: { '0,1': ['red:L7', 'red:S1'], '0,0': ['black:L2', 'black:L3'] }, dice: [3, 4] });
    const r = run(s, engage('red', '0,0', ['red:L7', 'red:S1']), defend('black', ['black:L2']));
    expect(eventsOf(r.events, 'resolved')[0]).toMatchObject({ outcome: 'attacker', overwhelming: true });
    expect(r.state.destroyed.black).toEqual([c('black:L2')]);
  });

  test('7. Fortified defender commits 4; both activate -> defender wins', () => {
    const s = buildState({
      board: { '0,1': ['red:L7', 'red:L8'], '0,0': ['black:L7', 'black:L2', 'black:L3', 'black:L4', 'black:L5'] },
      fortified: ['0,0'],
      dice: [3, 4],
    });
    const r = run(s, engage('red', '0,0', ['red:L7', 'red:L8']), defend('black', ['black:L7', 'black:L2', 'black:L3', 'black:L4']));
    expect(eventsOf(r.events, 'resolved')[0]).toMatchObject({ outcome: 'defender', winner: 'black' });
    expect(pendingDecision(r.state)).toMatchObject({ kind: 'casualties', player: 'red', owner: 'red', count: 1 });
  });

  test("8. Black holds Red's Tower: count 1, 2, 3 at Black's turn starts -> Black wins the round; clearing resets", () => {
    const end = (p: 'red' | 'black') => ({ type: 'endTurn', player: p }) as const;
    let s = buildState({ board: { '-1,2': ['black:L5'], '0,0': ['red:K1', 'red:K2'], '0,-2': ['black:K1', 'black:K2'] } });
    s = mustApply(s, end('red')).state;
    expect(s.towerCount.black).toBe(1);
    s = run(s, end('black'), end('red')).state;
    expect(s.towerCount.black).toBe(2);
    s = mustApply(s, end('black')).state;
    const r = mustApply(s, end('red'));
    expect(eventsOf(r.events, 'towerCount')).toEqual([{ type: 'towerCount', player: 'black', count: 3, hex: '-1,2' }]);
    expect(eventsOf(r.events, 'roundWon')).toEqual([{ type: 'roundWon', round: 1, winner: 'black', reason: 'tower' }]);
    expect(r.state.roundWins.black).toBe(1);

    // Reset: Red clears the Tower between counts.
    let t = buildState({ board: { '-1,2': ['black:L2'], '-2,2': ['red:L7'], '0,0': ['red:K1', 'red:K2'] } });
    t = run(t, end('red'), end('black')).state;
    expect(t.towerCount.black).toBe(1);
    t = forceAndEngage(t);
    expect(t.towerCount.black).toBe(0);
    t = run(t, end('red')).state;
    expect(t.towerCount.black).toBe(0);
  });
});

function forceAndEngage(s: ReturnType<typeof buildState>) {
  const st = { ...s, diceQueue: [3, 4] };
  const r = mustApply(st, engage('red', '-1,2', ['red:L7']));
  expect(eventsOf(r.events, 'towerCount')).toEqual([{ type: 'towerCount', player: 'black', count: 0, hex: '-1,2' }]);
  return r.state;
}
