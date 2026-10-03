import { describe, expect, test } from 'vitest';
import {
  cardActivates,
  pendingDecision,
  previewModifiers,
  resolveDice,
  type Action,
  type MatchState,
} from '../src/index';
import { buildState, c, defend, engage, eventsOf, mustApply, mustReject, run, types } from './helpers';

const pass = (player: 'red' | 'black') => ({ type: 'passReroll', player }) as const;

describe('§7.1 declaring an engagement', () => {
  test('target must hold enemy cards', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['red:L2'] } });
    expect(mustReject(s, engage('red', '0,0', ['red:L7']))).toMatch(/no enemy/);
    expect(mustReject(s, engage('red', '1,0', ['red:L7']))).toMatch(/no enemy/);
  });

  test('attacker commits 1–3 eligible cards, possibly from several hexes', () => {
    const s = buildState({
      board: { '0,1': ['red:L7', 'red:L8'], '1,0': ['red:L6', 'red:L5'], '0,0': ['black:L2', 'black:L3'] },
      dice: [1, 1],
    });
    expect(mustReject(s, engage('red', '0,0', ['red:L7', 'red:L8', 'red:L6', 'red:L5']))).toMatch(/1–3/);
    expect(mustReject(s, engage('red', '0,0', []))).toMatch(/1–3/);
    const r = mustApply(s, engage('red', '0,0', ['red:L7', 'red:L6', 'red:L5']));
    expect(r.state.engagement!.attackerCards).toHaveLength(3);
    expect(r.state.engagement!.stage).toBe('defend');
    expect(r.state.turn!.cp).toBe(3);
  });

  test('non-adjacent cards are ineligible (unless a ranged Archer)', () => {
    const s = buildState({ board: { '0,2': ['red:L7', 'red:A1'], '0,0': ['black:L2', 'black:L3'] }, terrain: {} });
    expect(mustReject(s, engage('red', '0,0', ['red:L7']))).toMatch(/not adjacent/);
    const r = mustApply(s, engage('red', '0,0', ['red:A1']));
    expect(r.state.engagement!.rangedArchers).toEqual([c('red:A1')]);
    expect(eventsOf(r.events, 'engageDeclared')[0].rangedArchers).toEqual([c('red:A1')]);
  });

  test('ranged Archers need line of sight and distance exactly 2', () => {
    const blocked = buildState({ board: { '0,2': ['red:A1'], '0,0': ['black:L2', 'black:L3'] }, terrain: { '0,1': 'forest' } });
    expect(mustReject(blocked, engage('red', '0,0', ['red:A1']))).toMatch(/line of sight/);
    const far = buildState({ board: { '-1,2': ['red:A1'], '1,-1': ['black:L2'] } });
    expect(mustReject(far, engage('red', '1,-1', ['red:A1']))).toMatch(/range 2/);
  });

  test('Wit number is declared with the commitment (2–12)', () => {
    const s = buildState({ board: { '0,1': ['red:W', 'red:L7'], '0,0': ['black:L2', 'black:L3'] } });
    expect(mustReject(s, engage('red', '0,0', ['red:W']))).toMatch(/2 to 12/);
    expect(mustReject(s, engage('red', '0,0', ['red:W'], 13))).toMatch(/2 to 12/);
    expect(mustReject(s, engage('red', '0,0', ['red:L7'], 7))).toMatch(/Wit is not committed/);
    expect(mustApply(s, engage('red', '0,0', ['red:W'], 9)).state.engagement!.attackerWit).toBe(9);
  });

  test('Engage costs 1 CP with a 3-CP cap', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:L2', 'black:L3'] }, spent: { engage: 3 }, cp: 1 });
    expect(mustReject(s, engage('red', '0,0', ['red:L7']))).toMatch(/At most 3 CP/);
  });

  test('defender commits 1–3 from the target hex only', () => {
    let s = buildState({
      board: { '0,1': ['red:L7'], '0,0': ['black:L2', 'black:L3', 'black:L4', 'black:L5'], '0,-2': ['black:A1'] },
      dice: [6, 6],
    });
    s = mustApply(s, engage('red', '0,0', ['red:L7'])).state;
    const d = pendingDecision(s);
    expect(d).toMatchObject({ kind: 'defend', player: 'black', target: '0,0', min: 1, max: 3, witEligible: false });
    expect(mustReject(s, defend('red', ['black:L2']))).toMatch(/defender/);
    expect(mustReject(s, defend('black', []))).toMatch(/1–3/);
    expect(mustReject(s, defend('black', ['black:L2', 'black:L3', 'black:L4', 'black:L5']))).toMatch(/1–3/);
    expect(mustReject(s, defend('black', ['black:A1']))).toMatch(/not in the attacked hex/);
    expect(mustReject(s, { type: 'endTurn', player: 'red' })).toMatch(/engagement is in progress/);
    const r = mustApply(s, defend('black', ['black:L2', 'black:L3', 'black:L4']));
    expect(r.state.engagement!.defenderCards).toHaveLength(3);
  });

  test('a Fortified defender may commit up to 4', () => {
    let s = buildState({
      board: { '0,1': ['red:L7'], '0,0': ['black:L2', 'black:L3', 'black:L4', 'black:L5', 'black:L6'] },
      fortified: ['0,0'],
      dice: [4, 5],
    });
    s = mustApply(s, engage('red', '0,0', ['red:L7'])).state;
    expect(pendingDecision(s)).toMatchObject({ kind: 'defend', max: 4 });
    expect(mustApply(s, defend('black', ['black:L2', 'black:L3', 'black:L4', 'black:L5'])).state.engagement!.defenderCards).toHaveLength(4);
  });

  test('a lone defending card is committed automatically; a lone Wit still declares a number', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:L2'] }, dice: [1, 1] });
    const r = mustApply(s, engage('red', '0,0', ['red:L7']));
    expect(eventsOf(r.events, 'engagementStarted')[0]).toMatchObject({ autoDefended: true, defenderCards: [c('black:L2')] });
    const s2 = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:W'] }, dice: [1, 1] });
    const r2 = mustApply(s2, engage('red', '0,0', ['red:L7']));
    expect(pendingDecision(r2.state)).toMatchObject({ kind: 'defend', witEligible: true });
    expect(mustReject(r2.state, defend('black', ['black:W']))).toMatch(/2 to 12/);
    expect(mustApply(r2.state, defend('black', ['black:W'], 4)).state.engagement!.defenderWit).toBe(4);
  });

  test('the same cards can fight again if still in position and you pay again', () => {
    let s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:L2', 'black:L3'] }, dice: [6, 6, 6, 6] });
    s = run(s, engage('red', '0,0', ['red:L7']), defend('black', ['black:L2']), { type: 'breakOff', player: 'red' }).state;
    s = run(s, engage('red', '0,0', ['red:L7']), defend('black', ['black:L2'])).state;
    expect(s.turn!.cp).toBe(2);
  });
});

describe('§7.4 activation', () => {
  const s = buildState();
  const card = (ref: string) => s.cards[c(ref)];
  test('per card type', () => {
    expect(cardActivates(card('red:L7'), [3, 4], null)).toBe(true);
    expect(cardActivates(card('red:H7'), [3, 4], null)).toBe(true);
    expect(cardActivates(card('red:L7'), [3, 3], null)).toBe(false);
    expect(cardActivates(card('red:A1'), [1, 5], null)).toBe(true);
    expect(cardActivates(card('red:A1'), [5, 1], null)).toBe(true);
    expect(cardActivates(card('red:A1'), [2, 5], null)).toBe(false);
    expect(cardActivates(card('red:V1'), [6, 2], null)).toBe(true);
    expect(cardActivates(card('red:V1'), [5, 2], null)).toBe(false);
    for (const d of [[1, 1], [6, 6], [3, 4], [1, 2]] as [number, number][]) expect(cardActivates(card('red:K1'), d, null)).toBe(false);
    expect(cardActivates(card('red:S1'), [3, 3], null)).toBe(true);
    expect(cardActivates(card('red:S1'), [2, 5], null)).toBe(true);
    expect(cardActivates(card('red:S1'), [2, 4], null)).toBe(false);
    expect(cardActivates(card('red:W'), [2, 4], 6)).toBe(true);
    expect(cardActivates(card('red:W'), [2, 4], 7)).toBe(false);
  });

  test('Advantage adds one extra activation on 11 or 12', () => {
    const mods = (a: boolean, d: boolean) => ({
      attacker: { advantage: a ? (['flanking'] as const).slice() : [], disadvantage: [] },
      defender: { advantage: d ? (['fortified'] as const).slice() : [], disadvantage: [] },
    });
    const base = { attacker: 'red', defender: 'black', attackerWit: null, defenderWit: null } as const;
    const r = resolveDice(s, { ...base, attackerCards: [c('red:L2')], defenderCards: [c('black:L2')], modifiers: mods(true, false) }, [5, 6]);
    expect(r.counts.attacker).toBe(1);
    expect(r.advantageBonus.attacker).toBe(true);
    expect(r.outcome).toBe('attacker');
    expect(r.overwhelming).toBe(false);
    const r2 = resolveDice(s, { ...base, attackerCards: [c('red:V1')], defenderCards: [c('black:L2')], modifiers: mods(true, false) }, [6, 5]);
    expect(r2.counts.attacker).toBe(2);
    expect(r2.overwhelming).toBe(true);
    const r3 = resolveDice(s, { ...base, attackerCards: [c('red:L2')], defenderCards: [c('black:L2')], modifiers: mods(false, false) }, [6, 6]);
    expect(r3.outcome).toBe('stale');
  });
});

describe('§7.5 outcome', () => {
  test('exactly one side activates -> it wins (attacker)', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:L2'] }, dice: [3, 4] });
    const r = mustApply(s, engage('red', '0,0', ['red:L7']));
    expect(eventsOf(r.events, 'resolved')[0]).toMatchObject({ outcome: 'attacker', winner: 'red', counts: { attacker: 1, defender: 0 } });
    expect(r.state.destroyed.black).toEqual([c('black:L2')]);
    expect(r.state.stacks['0,0']).toBeUndefined();
    expect(r.state.stacks['0,1']).toEqual([c('red:L7')]); // winning never auto-advances
  });

  test('exactly one side activates -> it wins (defender)', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:L5'] }, dice: [2, 3] });
    const r = mustApply(s, engage('red', '0,0', ['red:L7']));
    expect(eventsOf(r.events, 'resolved')[0].outcome).toBe('defender');
    expect(r.state.destroyed.red).toEqual([c('red:L7')]);
    expect(eventsOf(r.events, 'casualties')[0]).toMatchObject({ owner: 'red', chosenBy: 'red', auto: true });
  });

  test('both activate, only one side has Advantage -> it wins', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:L7'] }, fortified: ['0,0'], dice: [3, 4] });
    const r = mustApply(s, engage('red', '0,0', ['red:L7']));
    expect(eventsOf(r.events, 'resolved')[0].outcome).toBe('defender');
  });

  test('both activate, both have Advantage -> Bloodbath (ruling)', () => {
    let s = buildState({ board: { '0,1': ['red:L7'], '0,-1': ['red:L8'], '0,0': ['black:L7'] }, fortified: ['0,0'], dice: [3, 4] });
    const r = mustApply(s, engage('red', '0,0', ['red:L7', 'red:L8']));
    const st = eventsOf(r.events, 'engagementStarted')[0];
    expect(st.modifiers.attacker.advantage).toEqual(['flanking']);
    expect(st.modifiers.defender.advantage).toEqual(['fortified']);
    expect(eventsOf(r.events, 'resolved')[0].outcome).toBe('bloodbath');
    s = r.state;
    // Defender's single eligible card dies automatically; attacker chooses 1 of its 2.
    expect(pendingDecision(s)).toMatchObject({ kind: 'casualties', player: 'red', owner: 'red', count: 1, reason: 'bloodbath' });
    const r2 = mustApply(s, { type: 'chooseCasualties', player: 'red', cardIds: [c('red:L8')] });
    expect(r2.state.destroyed.red).toEqual([c('red:L8')]);
    expect(r2.state.destroyed.black).toEqual([c('black:L7')]);
    expect(r2.state.engagement).toBeNull();
  });

  test('neither activates -> stale roll', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:L2'] }, dice: [1, 2] });
    const r = mustApply(s, engage('red', '0,0', ['red:L7']));
    expect(eventsOf(r.events, 'resolved')[0]).toMatchObject({ outcome: 'stale', staleCount: 1 });
    expect(pendingDecision(r.state)).toMatchObject({ kind: 'pressOrBreak', player: 'red', staleCount: 1 });
  });
});

describe('§7.6 stale rolls, Press and Break Off', () => {
  const base = () => buildState({ board: { '0,1': ['red:L7', 'red:W'], '0,0': ['black:L2', 'black:W'] }, dice: [1, 4, 1, 4, 1, 4, 3, 4] });

  test('Break Off ends the engagement; the Engage CP stays spent', () => {
    let s = mustApply(base(), engage('red', '0,0', ['red:L7'])).state;
    s = mustApply(s, defend('black', ['black:L2'])).state;
    expect(mustReject(s, { type: 'breakOff', player: 'black' })).toMatch(/attacker/);
    const r = mustApply(s, { type: 'breakOff', player: 'red' });
    expect(types(r.events)).toEqual(['brokeOff', 'engagementEnded']);
    expect(r.state.engagement).toBeNull();
    expect(r.state.turn!.cp).toBe(3);
  });

  test('Press rolls again at no CP with the same cards and Wit numbers; 3 stale -> defender Advantage', () => {
    let s = mustApply(base(), engage('red', '0,0', ['red:L7', 'red:W'], 9)).state;
    s = mustApply(s, defend('black', ['black:L2', 'black:W'], 12)).state;
    expect(s.engagement!.staleCount).toBe(1);
    s = mustApply(s, { type: 'press', player: 'red' }).state;
    expect(s.engagement!.staleCount).toBe(2);
    expect(s.turn!.cp).toBe(3);
    const r = mustApply(s, { type: 'press', player: 'red' });
    expect(r.state.engagement!.staleCount).toBe(3);
    expect(eventsOf(r.events, 'advantageGained')).toEqual([{ type: 'advantageGained', player: 'black', side: 'defender', source: 'stale' }]);
    expect(r.state.engagement!.modifiers!.defender.advantage).toEqual(['stale']);
    expect(r.state.engagement!.attackerWit).toBe(9);
    expect(r.state.engagement!.defenderWit).toBe(12);
    // Fourth roll 3+4: red L7 activates, black does not -> red wins.
    const r2 = mustApply(r.state, { type: 'press', player: 'red' });
    expect(eventsOf(r2.events, 'resolved')[0]).toMatchObject({ outcome: 'attacker' });
    expect(eventsOf(r2.events, 'diceRolled')[0].roll).toBe(4);
  });

  test('defender with Advantage already gains nothing more at 3 stale', () => {
    let s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:L2'] }, fortified: ['0,0'], dice: [1, 4, 1, 4, 1, 4] });
    s = run(s, engage('red', '0,0', ['red:L7']), { type: 'press', player: 'red' }).state;
    const r = mustApply(s, { type: 'press', player: 'red' });
    expect(eventsOf(r.events, 'advantageGained')).toEqual([]);
    expect(r.state.engagement!.modifiers!.defender.advantage).toEqual(['fortified']);
  });
});

describe('§8 rerolls', () => {
  // Worked example 4 shape: Commander + Light 8 vs a defender with its own Commander.
  const setup = (dice: number[]) =>
    buildState({ board: { '0,1': ['red:K1', 'red:L8'], '0,0': ['black:K1', 'black:L2'] }, dice });

  test('defender acts first; players alternate; window closes after two consecutive passes', () => {
    let s = mustApply(setup([2, 5, 3]), engage('red', '0,0', ['red:K1', 'red:L8'])).state;
    s = mustApply(s, defend('black', ['black:K1', 'black:L2'])).state;
    expect(pendingDecision(s)).toEqual({
      kind: 'reroll',
      players: ['black'],
      player: 'black',
      dice: [2, 5],
      options: [{ source: 'commander', commanderId: c('black:K1') }],
    });
    expect(mustReject(s, pass('red'))).toMatch(/Black's go/);
    s = mustApply(s, pass('black')).state;
    expect(pendingDecision(s)).toMatchObject({ kind: 'reroll', player: 'red' });
    const r = mustApply(s, { type: 'reroll', player: 'red', source: 'commander', die: 0 });
    expect(eventsOf(r.events, 'rerolled')[0]).toMatchObject({ player: 'red', source: 'commander', commanderId: c('red:K1'), die: 0, from: 2, to: 3, dice: [3, 5] });
    // Black may answer (its pass count was reset by the reroll).
    expect(pendingDecision(r.state)).toMatchObject({ kind: 'reroll', player: 'black' });
    const r2 = mustApply(r.state, pass('black'));
    // Red has no reroll left -> auto-pass -> window closes -> 8 activates.
    expect(eventsOf(r2.events, 'rerollPassed').map((e) => [e.player, e.auto])).toEqual([
      ['black', false],
      ['red', true],
    ]);
    expect(eventsOf(r2.events, 'resolved')[0]).toMatchObject({ outcome: 'attacker', activating: { attacker: [c('red:L8')], defender: [] } });
  });

  test('both players passing consecutively closes the window without rerolls', () => {
    let s = mustApply(setup([2, 5]), engage('red', '0,0', ['red:K1', 'red:L8'])).state;
    s = run(s, defend('black', ['black:K1', 'black:L2']), pass('black')).state;
    const r = mustApply(s, pass('red'));
    expect(eventsOf(r.events, 'resolved')[0].outcome).toBe('stale'); // 2+5 = 7: neither L8 nor L2 activates
  });

  test('each committed Commander gives one reroll; uncommitted Commanders give none', () => {
    let s = buildState({ board: { '0,1': ['red:K1', 'red:K2', 'red:L8'], '0,0': ['black:L2'] }, dice: [1, 2, 3, 4] });
    s = mustApply(s, engage('red', '0,0', ['red:K1', 'red:K2', 'red:L8'])).state;
    expect(pendingDecision(s)).toMatchObject({ kind: 'reroll', player: 'red' });
    expect((pendingDecision(s) as { options: unknown[] }).options).toHaveLength(2);
    s = mustApply(s, { type: 'reroll', player: 'red', source: 'commander', commanderId: c('red:K2'), die: 0 }).state;
    expect(mustReject(s, { type: 'reroll', player: 'red', source: 'commander', commanderId: c('red:K2'), die: 0 })).toBeTruthy();
    // black auto-passed after the reroll; red still has K1
    expect(pendingDecision(s)).toMatchObject({ kind: 'reroll', player: 'red', options: [{ source: 'commander', commanderId: c('red:K1') }] });
    s = mustApply(s, { type: 'reroll', player: 'red', source: 'commander', die: 1 }).state;
    expect(s.engagement!.dice).toEqual([3, 4]);
    // no rerolls left on either side -> resolved: total 7, L8 does not activate -> stale
    expect(s.engagement!.stage).toBe('pressOrBreak');

    const s2 = buildState({ board: { '0,1': ['red:K1', 'red:L8'], '0,0': ['black:L2'] }, dice: [1, 2] });
    const r = mustApply(s2, engage('red', '0,0', ['red:L8']));
    expect(r.state.engagement!.stage).toBe('pressOrBreak'); // uncommitted K1 gives no reroll
  });

  test('rerolls do not refresh when pressing', () => {
    let s = buildState({ board: { '0,1': ['red:K1', 'red:L8'], '0,0': ['black:L2'] }, dice: [1, 2, 1, 1, 3] });
    s = mustApply(s, engage('red', '0,0', ['red:K1', 'red:L8'])).state;
    s = mustApply(s, { type: 'reroll', player: 'red', source: 'commander', die: 0 }).state; // 1,2 -> 1,2
    expect(s.engagement!.stage).toBe('pressOrBreak');
    s = mustApply(s, { type: 'press', player: 'red' }).state; // 1,3 -> stale, no reroll offered
    expect(s.engagement!.stage).toBe('pressOrBreak');
    expect(s.engagement!.rolls).toBe(2);
  });

  test('Disadvantage reroll: opponent forces one die once, only while the Disadvantaged side currently activates', () => {
    // Black defends with an Archer against an adjacent attack -> Black has Disadvantage.
    let s = buildState({ board: { '0,1': ['red:L8'], '0,0': ['black:A1', 'black:L2'] }, dice: [1, 4, 4] });
    s = mustApply(s, engage('red', '0,0', ['red:L8'])).state;
    const r = mustApply(s, defend('black', ['black:A1']));
    expect(eventsOf(r.events, 'engagementStarted')[0].modifiers.defender.disadvantage).toEqual(['archerDefending']);
    s = r.state;
    // Black (no options) auto-passed; Red may force a reroll because Black's Archer currently activates.
    expect(pendingDecision(s)).toEqual({ kind: 'reroll', players: ['red'], player: 'red', dice: [1, 4], options: [{ source: 'disadvantage' }] });
    const r2 = mustApply(s, { type: 'reroll', player: 'red', source: 'disadvantage', die: 0 });
    expect(eventsOf(r2.events, 'rerolled')[0]).toMatchObject({ source: 'disadvantage', from: 1, to: 4, commanderId: null });
    expect(eventsOf(r2.events, 'resolved')[0]).toMatchObject({ outcome: 'attacker', dice: [4, 4] });
  });

  test('Disadvantage reroll is not offered while the Disadvantaged side does not activate', () => {
    const s = buildState({ board: { '0,1': ['red:L8'], '0,0': ['black:A1', 'black:L2'] }, dice: [2, 3] });
    const r = run(s, engage('red', '0,0', ['red:L8']), defend('black', ['black:A1']));
    expect(r.state.engagement!.stage).toBe('pressOrBreak');
    expect(eventsOf(r.events, 'rerollPassed').every((e) => e.auto)).toBe(true);
  });

  test('Disadvantage reroll becomes usable after a Commander reroll makes that side activate; once per engagement', () => {
    // Red attacks from a Mountain with Cavalry -> Red has Disadvantage. Black has a committed Commander.
    let s = buildState({
      board: { '0,1': ['red:V1', 'red:K1'], '0,0': ['black:K1', 'black:L5'] },
      terrain: { '0,1': 'mountain' },
      dice: [2, 2, 6, 3, 5],
    });
    s = run(s, engage('red', '0,0', ['red:V1', 'red:K1']), defend('black', ['black:K1', 'black:L5'])).state;
    expect(s.engagement!.modifiers!.attacker.disadvantage).toEqual(['cavalryMountain']);
    // Dice 2,2: Red does not activate -> Black only has its Commander.
    expect(pendingDecision(s)).toMatchObject({ player: 'black', options: [{ source: 'commander' }] });
    s = run(s, pass('black')).state;
    // Red uses its Commander: 2 -> 6, Red's Cavalry now activates.
    s = mustApply(s, { type: 'reroll', player: 'red', source: 'commander', die: 0 }).state;
    expect(s.engagement!.dice).toEqual([6, 2]);
    expect((pendingDecision(s) as { options: { source: string }[] }).options.map((o) => o.source).sort()).toEqual(['commander', 'disadvantage']);
    s = mustApply(s, { type: 'reroll', player: 'black', source: 'disadvantage', die: 0 }).state; // 6 -> 3
    expect(s.engagement!.dice).toEqual([3, 2]);
    // Red has nothing left (auto-pass); Black still has its Commander.
    expect(pendingDecision(s)).toMatchObject({ player: 'black', options: [{ source: 'commander' }] });
    const r = mustApply(s, pass('black'));
    expect(eventsOf(r.events, 'resolved')[0]).toMatchObject({ dice: [3, 2], outcome: 'defender' });
  });

  test('reroll validation', () => {
    let s = mustApply(setup([2, 5]), engage('red', '0,0', ['red:K1', 'red:L8'])).state;
    s = mustApply(s, defend('black', ['black:K1', 'black:L2'])).state;
    expect(mustReject(s, { type: 'reroll', player: 'black', source: 'commander', die: 2 as 0 })).toMatch(/die/);
    expect(mustReject(s, { type: 'reroll', player: 'black', source: 'disadvantage', die: 0 })).toMatch(/No Disadvantage/);
    expect(mustReject(s, { type: 'reroll', player: 'black', source: 'commander', commanderId: c('red:K1'), die: 0 })).toMatch(/no unused/);
    expect(mustReject(s, { type: 'reroll', player: 'black', source: 'magic' as 'commander', die: 0 })).toMatch(/source/);
  });
});

describe('§9 Advantage and Disadvantage', () => {
  const mods = (s: MatchState, atk: string[], def: string[] = [], target = '0,0') =>
    previewModifiers(s, { player: 'red', target, attackerCardIds: atk.map(c), defenderCardIds: def.map(c) });

  test('Fortified target -> defender Advantage', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:L2'] }, fortified: ['0,0'] });
    expect(mods(s, ['red:L7'], ['black:L2']).defender.advantage).toEqual(['fortified']);
  });

  test('Archer on a Mountain attacking a non-Mountain target -> attacker Advantage (ranged or adjacent)', () => {
    const s = buildState({ board: { '0,1': ['red:A1'], '0,2': ['red:A2'], '0,0': ['black:L2'] }, terrain: { '0,1': 'mountain', '0,2': 'mountain' } });
    expect(mods(s, ['red:A2']).attacker.advantage).toEqual(['archerHighGround']);
    expect(mods(s, ['red:A1']).attacker.advantage).toEqual(['archerHighGround']);
    const s2 = buildState({ board: { '0,1': ['red:A1'], '0,0': ['black:L2'] }, terrain: { '0,1': 'mountain', '0,0': 'mountain' } });
    expect(mods(s2, ['red:A1']).attacker.advantage).toEqual([]);
  });

  test('Mountain target -> defender Advantage always, even against attackers on Mountains', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:L2'] }, terrain: { '0,1': 'mountain', '0,0': 'mountain' } });
    expect(mods(s, ['red:L7']).defender.advantage).toEqual(['mountainDefence']);
  });

  test('Flanking needs two non-adjacent adjacent hexes; ranged Archers do not count', () => {
    const s = buildState({
      board: { '0,1': ['red:L7'], '1,0': ['red:L8'], '-1,0': ['red:L6'], '0,2': ['red:A1'], '0,0': ['black:L2'] },
    });
    expect(mods(s, ['red:L7', 'red:L8']).attacker.advantage).toEqual([]); // 0,1 and 1,0 are adjacent
    expect(mods(s, ['red:L7', 'red:L6']).attacker.advantage).toEqual(['flanking']);
    expect(mods(s, ['red:L8', 'red:A1']).attacker.advantage).toEqual([]);
  });

  test('Surrounded (3+ adjacent hexes) -> defender Disadvantage and attacker Flanking', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '1,0': ['red:L8'], '1,-1': ['red:L6'], '0,0': ['black:L2'] } });
    const m = mods(s, ['red:L7', 'red:L8', 'red:L6']);
    expect(m.defender.disadvantage).toEqual(['surrounded']);
    expect(m.attacker.advantage).toEqual(['flanking']);
  });

  test('Cavalry on a Mountain, or attacking Cavalry into a Mountain -> that side Disadvantaged', () => {
    const s = buildState({ board: { '0,1': ['red:V1', 'red:L7'], '0,0': ['black:V1', 'black:L2'] }, terrain: { '0,1': 'mountain' } });
    expect(mods(s, ['red:V1']).attacker.disadvantage).toEqual(['cavalryMountain']);
    expect(mods(s, ['red:L7']).attacker.disadvantage).toEqual([]);
    const s2 = buildState({ board: { '0,1': ['red:V1', 'red:L7'], '0,0': ['black:V1', 'black:L2'] }, terrain: { '0,0': 'mountain' } });
    expect(mods(s2, ['red:V1']).attacker.disadvantage).toEqual(['cavalryMountain']);
    expect(mods(s2, ['red:L7']).attacker.disadvantage).toEqual([]);
    expect(mods(s2, ['red:L7'], ['black:V1']).defender.disadvantage).toEqual(['cavalryMountain']);
    expect(mods(s2, ['red:L7'], ['black:L2']).defender.disadvantage).toEqual([]);
  });

  test('defending Archer vs an adjacent attacker -> defender Disadvantage; not vs ranged-only', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,2': ['red:A1'], '0,0': ['black:A1', 'black:L2'] } });
    expect(mods(s, ['red:L7'], ['black:A1']).defender.disadvantage).toEqual(['archerDefending']);
    expect(mods(s, ['red:A1'], ['black:A1']).defender.disadvantage).toEqual([]);
    expect(mods(s, ['red:L7'], ['black:L2']).defender.disadvantage).toEqual([]);
  });

  test('Advantage and Disadvantage can apply to the same side', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:A1', 'black:L2'] }, fortified: ['0,0'] });
    const m = mods(s, ['red:L7'], ['black:A1']);
    expect(m.defender).toEqual({ advantage: ['fortified'], disadvantage: ['archerDefending'] });
  });

  test('sources do not stack: multiple sources still mean one Advantage bonus', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:L2'] }, fortified: ['0,0'], terrain: { '0,0': 'mountain' }, dice: [6, 6] });
    const r = mustApply(s, engage('red', '0,0', ['red:L7']));
    const res = eventsOf(r.events, 'resolved')[0];
    expect(res.counts.defender).toBe(1);
  });
});

describe('§12 casualties', () => {
  test('only committed cards can die; uncommitted Commanders are safe', () => {
    const s = buildState({ board: { '0,1': ['red:L7', 'red:S1'], '0,0': ['black:L2', 'black:K1', 'black:L3'] }, dice: [3, 4] });
    const r = run(s, engage('red', '0,0', ['red:L7', 'red:S1']), defend('black', ['black:L2']));
    expect(r.state.destroyed.black).toEqual([c('black:L2')]);
    expect(r.state.stacks['0,0']).toEqual([c('black:K1'), c('black:L3')]);
  });

  test('loser normally chooses; Overwhelming causes 2', () => {
    const s = buildState({ board: { '0,1': ['red:L7', 'red:S1'], '0,0': ['black:L2', 'black:L3', 'black:L4'] }, dice: [3, 4] });
    const r = run(s, engage('red', '0,0', ['red:L7', 'red:S1']), defend('black', ['black:L2', 'black:L3', 'black:L4']));
    expect(pendingDecision(r.state)).toMatchObject({ kind: 'casualties', player: 'black', owner: 'black', count: 2, reason: 'normal' });
    expect(mustReject(r.state, { type: 'chooseCasualties', player: 'black', cardIds: [c('black:L2')] })).toMatch(/exactly 2/);
    expect(mustReject(r.state, { type: 'chooseCasualties', player: 'red', cardIds: [c('black:L2'), c('black:L3')] })).toMatch(/Black chooses/);
    expect(mustReject(r.state, { type: 'chooseCasualties', player: 'black', cardIds: [c('black:L2'), c('red:L7')] })).toMatch(/not an eligible/);
    const r2 = mustApply(r.state, { type: 'chooseCasualties', player: 'black', cardIds: [c('black:L2'), c('black:L4')] });
    expect(r2.state.destroyed.black.sort()).toEqual([c('black:L2'), c('black:L4')].sort());
    expect(eventsOf(r2.events, 'casualties')[0]).toMatchObject({ owner: 'black', chosenBy: 'black', auto: false });
  });

  test('winner with Advantage vs loser with Disadvantage chooses all casualties', () => {
    // Example 3 shape: 3 hexes -> Surrounded + Flanking.
    const s = buildState({
      board: { '0,1': ['red:L7'], '1,0': ['red:L2'], '-1,0': ['red:L3'], '0,0': ['black:L4', 'black:L5', 'black:L6'] },
      dice: [3, 4],
    });
    const r = run(s, engage('red', '0,0', ['red:L7', 'red:L2', 'red:L3']), defend('black', ['black:L4', 'black:L5', 'black:L6']));
    expect(pendingDecision(r.state)).toMatchObject({ kind: 'casualties', player: 'red', owner: 'black', count: 1, reason: 'advantage' });
  });

  test('Adv+Dis with Shardstrike: winner still chooses all', () => {
    const s = buildState({
      board: { '0,1': ['red:L4', 'red:S1'], '1,0': ['red:H4'], '-1,0': ['red:L3'], '0,0': ['black:L8', 'black:L9', 'black:L10'] },
      dice: [2, 2],
    });
    const r = run(s, engage('red', '0,0', ['red:L4', 'red:S1', 'red:H4']), defend('black', ['black:L8', 'black:L9', 'black:L10']));
    // 0,1 & 1,0 adjacent; no flanking with only these two -> plain shardstrike
    expect(pendingDecision(r.state)).toMatchObject({ kind: 'casualties', player: 'red', count: 1, reason: 'shardstrike' });
    const s2 = buildState({
      board: { '0,1': ['red:L4', 'red:S1'], '-1,0': ['red:H4'], '1,-1': ['red:L3'], '0,0': ['black:L8', 'black:L9', 'black:L10'] },
      dice: [2, 2],
    });
    const r2 = run(s2, engage('red', '0,0', ['red:S1', 'red:H4', 'red:L3']), defend('black', ['black:L8', 'black:L9', 'black:L10']));
    expect(pendingDecision(r2.state)).toMatchObject({ kind: 'casualties', player: 'red', count: 2, reason: 'advantage' });
  });

  test('Bloodbath: each side exactly 1; Shardstrike on both sides -> each chooses the other side', () => {
    const s = buildState({
      board: { '0,1': ['red:S1', 'red:L2', 'red:L3'], '0,0': ['black:S1', 'black:L4', 'black:L5'] },
      dice: [3, 3],
    });
    let r = run(s, engage('red', '0,0', ['red:S1', 'red:L2', 'red:L3']), defend('black', ['black:S1', 'black:L4', 'black:L5']));
    expect(eventsOf(r.events, 'resolved')[0]).toMatchObject({ outcome: 'bloodbath', shardstrike: { attacker: true, defender: true } });
    expect(pendingDecision(r.state)).toMatchObject({ kind: 'casualties', player: 'red', owner: 'black', count: 1, reason: 'shardstrike' });
    r = run(r.state, { type: 'chooseCasualties', player: 'red', cardIds: [c('black:S1')] });
    expect(pendingDecision(r.state)).toMatchObject({ kind: 'casualties', player: 'black', owner: 'red', count: 1, reason: 'shardstrike' });
    r = run(r.state, { type: 'chooseCasualties', player: 'black', cardIds: [c('red:S1')] });
    expect(r.state.destroyed).toEqual({ red: [c('red:S1')], black: [c('black:S1')] });
    expect(r.state.engagement).toBeNull();
  });

  test('Shardstrike requires doubles: a 7 activates the Shardbearer without Shardstrike', () => {
    const s = buildState({ board: { '0,1': ['red:S1'], '0,0': ['black:L2', 'black:L3'] }, dice: [3, 4] });
    const r = run(s, engage('red', '0,0', ['red:S1']), defend('black', ['black:L2', 'black:L3']));
    expect(eventsOf(r.events, 'resolved')[0].shardstrike.attacker).toBe(false);
    expect(pendingDecision(r.state)).toMatchObject({ player: 'black', reason: 'normal' });
  });

  test('ranged Archers are immune unless a defending Archer activated', () => {
    // Defender wins: immune ranged Archer -> no casualty at all.
    const s = buildState({ board: { '0,2': ['red:A1'], '0,0': ['black:L5'] }, dice: [2, 3] });
    const r = mustApply(s, engage('red', '0,0', ['red:A1']));
    expect(eventsOf(r.events, 'resolved')[0].outcome).toBe('defender');
    expect(r.state.destroyed.red).toEqual([]);
    expect(eventsOf(r.events, 'casualties')).toEqual([]);
    // Defending Archer shoots back on a 1 -> the ranged Archer becomes eligible (bloodbath, both die).
    const s2 = buildState({ board: { '0,2': ['red:A1'], '0,0': ['black:A1'] }, dice: [1, 2] });
    const r2 = mustApply(s2, engage('red', '0,0', ['red:A1']));
    expect(eventsOf(r2.events, 'resolved')[0].outcome).toBe('bloodbath');
    expect(r2.state.destroyed).toEqual({ red: [c('red:A1')], black: [c('black:A1')] });
  });

  test('mixed ranged + adjacent attackers: only the adjacent card is eligible', () => {
    const s = buildState({ board: { '0,2': ['red:A1'], '1,0': ['red:L2'], '0,0': ['black:L5'] }, dice: [2, 3] });
    const r = mustApply(s, engage('red', '0,0', ['red:A1', 'red:L2']));
    expect(r.state.destroyed.red).toEqual([c('red:L2')]);
  });
});

describe('§12.4 Combat Retreat', () => {
  const won = () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:L2', 'black:L3', 'black:K1'] }, fortified: ['0,0'], dice: [3, 4] });
    return run(s, engage('red', '0,0', ['red:L7']), defend('black', ['black:L2']));
  };

  test('after losing, the defender may retreat the whole stack to a hex away from the adjacent attackers', () => {
    const r = won();
    expect(pendingDecision(r.state)).toEqual({
      kind: 'retreat',
      players: ['black'],
      player: 'black',
      from: '0,0',
      hexes: ['1,-1', '0,-1', '-1,0'],
    });
    expect(mustReject(r.state, { type: 'retreat', player: 'black', to: '1,0' })).toMatch(/not a legal retreat/);
    expect(mustReject(r.state, { type: 'retreat', player: 'red', to: '0,-1' })).toMatch(/defender/);
    const r2 = mustApply(r.state, { type: 'retreat', player: 'black', to: '0,-1' });
    expect(r2.state.stacks['0,-1']).toEqual([c('black:L3'), c('black:K1')]);
    expect(r2.state.stacks['0,0']).toBeUndefined();
    expect(r2.state.fortified).toEqual({});
    expect(types(r2.events)).toEqual(['retreated', 'fortifyEnded', 'engagementEnded']);
    expect(r2.state.turn!.player).toBe('red');
  });

  test('retreat is optional', () => {
    const r = mustApply(won().state, { type: 'retreat', player: 'black', to: null });
    expect(r.state.stacks['0,0']).toEqual([c('black:L3'), c('black:K1')]);
    expect(r.state.fortified['0,0']).toBe('black');
  });

  test('joining a friendly Fortified hex makes the stack part of it', () => {
    const s = buildState({
      board: { '0,1': ['red:L7'], '0,0': ['black:L2', 'black:L3'], '0,-1': ['black:L9'] },
      fortified: ['0,-1'],
      dice: [3, 4],
    });
    let st = run(s, engage('red', '0,0', ['red:L7']), defend('black', ['black:L2'])).state;
    st = mustApply(st, { type: 'retreat', player: 'black', to: '0,-1' }).state;
    expect(st.fortified['0,-1']).toBe('black');
    expect(st.stacks['0,-1']).toEqual([c('black:L9'), c('black:L3')]);
  });

  test('no legal hex -> the stack stays automatically', () => {
    const s = buildState({
      board: { '0,1': ['red:L7'], '0,-1': ['red:L8'], '0,0': ['black:L2', 'black:L3'], '1,-1': ['red:L9'] },
      dice: [3, 4],
    });
    // Attackers adjacent at 0,1 and 0,-1 block every neighbour of 0,0.
    const r = run(s, engage('red', '0,0', ['red:L7', 'red:L8']), defend('black', ['black:L2']));
    expect(eventsOf(r.events, 'retreated')[0]).toMatchObject({ to: null, auto: true });
    expect(r.state.engagement).toBeNull();
    expect(r.state.stacks['0,0']).toEqual([c('black:L3')]);
  });

  test('ranged Archers do not restrict retreat; enemy-occupied hexes are not legal', () => {
    const s = buildState({ board: { '0,2': ['red:A1'], '0,0': ['black:L2', 'black:L3'], '-1,0': ['red:L9'] }, dice: [1, 3] });
    const r = run(s, engage('red', '0,0', ['red:A1']), defend('black', ['black:L2']));
    expect((pendingDecision(r.state) as { hexes: string[] }).hexes.sort()).toEqual(['0,1', '1,0', '1,-1', '0,-1', '-1,1'].sort());
  });

  test('Mountain lock: a stack that retreated into a Mountain this turn cannot retreat out', () => {
    const s = buildState({ board: { '0,1': ['red:L7', 'red:L8'], '0,0': ['black:L2', 'black:L3', 'black:L4'] }, terrain: { '0,-1': 'mountain' }, dice: [3, 4, 4, 4] });
    let st = run(s, engage('red', '0,0', ['red:L7']), defend('black', ['black:L2'])).state;
    st = mustApply(st, { type: 'retreat', player: 'black', to: '0,-1' }).state;
    expect(st.turn!.mountainLocked.sort()).toEqual([c('black:L3'), c('black:L4')].sort());
    st = mustApply(st, mustMove(['red:L8'], '0,1', '0,0')).state;
    const r = run(st, engage('red', '0,-1', ['red:L8']), defend('black', ['black:L3']));
    expect(eventsOf(r.events, 'retreated')[0]).toMatchObject({ to: null, auto: true });
  });

  test('no retreat after a Bloodbath or a defender win', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:L7', 'black:L3'] }, dice: [3, 4] });
    const r = run(s, engage('red', '0,0', ['red:L7']), defend('black', ['black:L7']));
    expect(r.state.engagement).toBeNull();
    expect(eventsOf(r.events, 'retreated')).toEqual([]);
  });
});

function mustMove(refs: string[], from: string, to: string): Action {
  return { type: 'move', player: 'red', cardIds: refs.map(c), from, path: [to] };
}
