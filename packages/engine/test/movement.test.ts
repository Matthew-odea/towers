import { describe, expect, test } from 'vitest';
import {
  deployInfo,
  fortifyInfo,
  hasSupply,
  legalSpawnHexes,
  moveDestinations,
  moveOptions,
  reinforceTargets,
  spawnHexes,
  suppliedHexes,
  withdrawOptions,
} from '../src/index';
import { buildState, c, engage, eventsOf, mustApply, mustReject, run } from './helpers';

const mv = (refs: string[], from: string, ...path: string[]) =>
  ({ type: 'move', player: c(refs[0]).startsWith('red') ? 'red' : 'black', cardIds: refs.map(c), from, path }) as const;

describe('§6.1 Move', () => {
  test('moves all or part of a stack 1 hex for 1 CP', () => {
    const s = buildState({ board: { '0,1': ['red:L7', 'red:L8'] } });
    const r = mustApply(s, mv(['red:L7'], '0,1', '0,0'));
    expect(r.state.stacks['0,0']).toEqual([c('red:L7')]);
    expect(r.state.stacks['0,1']).toEqual([c('red:L8')]);
    expect(r.state.turn!.cp).toBe(3);
    expect(r.events[0]).toMatchObject({ type: 'moved', from: '0,1', to: '0,0', charge: false });
  });

  test('can join a friendly stack; cannot enter an enemy hex', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['red:L8'], '1,0': ['black:L2'] } });
    expect(mustApply(s, mv(['red:L7'], '0,1', '0,0')).state.stacks['0,0']).toHaveLength(2);
    const s2 = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:L2'] } });
    expect(mustReject(s2, mv(['red:L7'], '0,1', '0,0'))).toMatch(/enemy/);
  });

  test('rejects non-adjacent, off-board, wrong hex, foreign cards, empty selections', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,-1': ['black:L7'] } });
    expect(mustReject(s, mv(['red:L7'], '0,1', '0,-1'))).toMatch(/not adjacent/);
    expect(mustReject(s, mv(['red:L7'], '0,1', '5,5'))).toMatch(/not a hex/);
    expect(mustReject(s, mv(['red:L7'], '0,0', '1,0'))).toMatch(/not in hex/);
    expect(mustReject(s, { type: 'move', player: 'red', cardIds: [c('black:L7')], from: '0,-1', path: ['0,0'] })).toMatch(/belongs to Black/);
    expect(mustReject(s, { type: 'move', player: 'red', cardIds: [], from: '0,1', path: ['0,0'] })).toMatch(/1/);
  });

  test('same cards may move repeatedly, up to the 3-CP cap per action type', () => {
    let s = buildState({ board: { '0,2': ['red:L7'] } });
    s = run(s, mv(['red:L7'], '0,2', '0,1'), mv(['red:L7'], '0,1', '0,0'), mv(['red:L7'], '0,0', '0,-1')).state;
    expect(s.turn!.cp).toBe(1);
    expect(mustReject(s, mv(['red:L7'], '0,-1', '1,-1'))).toMatch(/At most 3 CP/);
  });

  test('not enough CP', () => {
    const s = buildState({ board: { '0,2': ['red:L7'] }, cp: 0 });
    expect(mustReject(s, mv(['red:L7'], '0,2', '0,1'))).toMatch(/only 0 CP/);
  });
});

describe('§6.2 Cavalry 2-hex Plains move and charge', () => {
  test('all-Cavalry group may move through Plains into Plains', () => {
    const s = buildState({ board: { '0,2': ['red:V1', 'red:V2'] } });
    const r = mustApply(s, mv(['red:V1', 'red:V2'], '0,2', '0,1', '0,0'));
    expect(r.state.stacks['0,0']).toHaveLength(2);
    expect(r.state.turn!.cp).toBe(3);
    expect(r.state.turn!.charge).toEqual([c('red:V1'), c('red:V2')]);
    expect(r.events[0]).toMatchObject({ type: 'moved', charge: true, path: ['0,1', '0,0'] });
  });

  test('a mixed group uses the most restrictive rule', () => {
    const s = buildState({ board: { '0,2': ['red:V1', 'red:L7'] } });
    expect(mustReject(s, mv(['red:V1', 'red:L7'], '0,2', '0,1', '0,0'))).toMatch(/all-Cavalry/);
  });

  test('both hexes must be Plains (Forest ends the extra move; Tower is not Plains) and enterable', () => {
    expect(mustReject(buildState({ board: { '0,2': ['red:V1'] }, terrain: { '0,1': 'forest' } }), mv(['red:V1'], '0,2', '0,1', '0,0'))).toMatch(
      /Plains/,
    );
    expect(mustReject(buildState({ board: { '0,2': ['red:V1'] }, terrain: { '0,0': 'mountain' } }), mv(['red:V1'], '0,2', '0,1', '0,0'))).toMatch(
      /Plains/,
    );
    expect(mustReject(buildState({ board: { '0,1': ['red:V1'] } }), mv(['red:V1'], '0,1', '0,2', '-1,2'))).toMatch(/Plains/);
    expect(mustReject(buildState({ board: { '0,2': ['red:V1'], '0,0': ['black:L2'] } }), mv(['red:V1'], '0,2', '0,1', '0,0'))).toMatch(/enemy/);
    expect(mustReject(buildState({ board: { '0,2': ['red:V1'] } }), mv(['red:V1'], '0,2', '0,1', '-1,0'))).toMatch(/not adjacent/);
  });

  test('origin terrain does not matter (Forest start is fine)', () => {
    const s = buildState({ board: { '0,2': ['red:V1'] }, terrain: { '0,2': 'forest' } });
    expect(mustApply(s, mv(['red:V1'], '0,2', '0,1', '0,0')).state.stacks['0,0']).toEqual([c('red:V1')]);
  });

  test('charge: very next action is an Engage with one of those Cavalry -> attacker Advantage', () => {
    let s = buildState({ board: { '0,2': ['red:V1'], '0,-1': ['black:L2'] }, dice: [2, 3] });
    s = mustApply(s, mv(['red:V1'], '0,2', '0,1', '0,0')).state;
    const r = mustApply(s, engage('red', '0,-1', ['red:V1']));
    const started = eventsOf(r.events, 'engagementStarted')[0];
    expect(started.charge).toBe(true);
    expect(started.modifiers.attacker.advantage).toContain('charge');
  });

  test('any other action in between cancels the charge (including another Move)', () => {
    let s = buildState({ board: { '0,2': ['red:V1'], '1,1': ['red:L5'], '0,-1': ['black:L2'] }, dice: [2, 3] });
    s = run(s, mv(['red:V1'], '0,2', '0,1', '0,0'), mv(['red:L5'], '1,1', '1,0')).state;
    expect(s.turn!.charge).toBeNull();
    const r = mustApply(s, engage('red', '0,-1', ['red:V1']));
    expect(eventsOf(r.events, 'engagementStarted')[0].modifiers.attacker.advantage).not.toContain('charge');
  });

  test('charge requires one of the moving Cavalry to be committed', () => {
    let s = buildState({ board: { '0,2': ['red:V1'], '1,-1': ['red:L5'], '0,-1': ['black:L2'] }, dice: [2, 3] });
    s = mustApply(s, mv(['red:V1'], '0,2', '0,1', '0,0')).state;
    const r = mustApply(s, engage('red', '0,-1', ['red:L5']));
    expect(eventsOf(r.events, 'engagementStarted')[0].charge).toBe(false);
  });

  test('a 1-hex Cavalry move does not open a charge', () => {
    let s = buildState({ board: { '0,1': ['red:V1'], '0,-1': ['black:L2'] }, dice: [2, 3] });
    s = mustApply(s, mv(['red:V1'], '0,1', '0,0')).state;
    expect(s.turn!.charge).toBeNull();
  });

  test('moveOptions lists 1-hex and 2-hex paths', () => {
    const s = buildState({ board: { '0,2': ['red:V1'] }, terrain: { '1,1': 'forest' } });
    const opts = moveOptions(s, 'red', [c('red:V1')], '0,2');
    expect(opts.filter((o) => !o.charge).map((o) => o.to).sort()).toEqual(['-1,2', '0,1', '1,1'].sort());
    const two = opts.filter((o) => o.charge).map((o) => o.to);
    expect(two).toContain('0,0');
    expect(two).not.toContain('-1,2');
    expect(two.every((h) => h !== '0,2')).toBe(true);
    expect(moveDestinations(s, 'red', [c('red:V1')], '0,2')).toContain('1,0');
  });
});

describe('§6.3 Mountain lock', () => {
  test('cards that entered a Mountain this turn cannot leave it this turn but can fight', () => {
    let s = buildState({ board: { '0,1': ['red:L7'], '1,-1': ['black:L2'] }, terrain: { '0,0': 'mountain' }, dice: [3, 4] });
    s = mustApply(s, mv(['red:L7'], '0,1', '0,0')).state;
    expect(s.turn!.mountainLocked).toEqual([c('red:L7')]);
    expect(mustReject(s, mv(['red:L7'], '0,0', '1,0'))).toMatch(/Mountain/);
    expect(mustReject(s, { type: 'withdraw', player: 'red', cardIds: [c('red:L7')], from: '0,0', to: '0,1' })).toMatch(/Mountain/);
    expect(mustApply(s, engage('red', '1,-1', ['red:L7'])).state.engagement).toBeNull();
  });

  test('lock lasts only for the current turn', () => {
    let s = buildState({ board: { '0,1': ['red:L7'] }, terrain: { '0,0': 'mountain' } });
    s = run(s, mv(['red:L7'], '0,1', '0,0'), { type: 'endTurn', player: 'red' }, { type: 'endTurn', player: 'black' }).state;
    expect(mustApply(s, mv(['red:L7'], '0,0', '1,0')).state.stacks['1,0']).toEqual([c('red:L7')]);
  });

  test('cards already on a Mountain from an earlier turn may leave; only locked cards are stuck', () => {
    const s = buildState({ board: { '0,0': ['red:L7', 'red:L8'] }, terrain: { '0,0': 'mountain' }, mountainLocked: ['red:L8'] });
    expect(mustApply(s, mv(['red:L7'], '0,0', '1,0')).state.stacks['1,0']).toEqual([c('red:L7')]);
    expect(mustReject(s, mv(['red:L7', 'red:L8'], '0,0', '1,0'))).toMatch(/Mountain/);
  });

  test('Spawn into a Mountain locks Wit', () => {
    const s = buildState({ terrain: { '0,0': 'mountain' } });
    const s2 = mustApply(s, { type: 'spawnWit', player: 'red', hex: '0,0' }).state;
    expect(s2.turn!.mountainLocked).toEqual([c('red:W')]);
  });
});

describe('§6.4 Withdraw', () => {
  test('to an adjacent enterable hex strictly closer to own Tower', () => {
    const s = buildState({ board: { '0,0': ['red:L7', 'red:L8'] } });
    expect(withdrawOptions(s, 'red', [c('red:L7')], '0,0').sort()).toEqual(['-1,1', '0,1'].sort());
    const r = mustApply(s, { type: 'withdraw', player: 'red', cardIds: [c('red:L7')], from: '0,0', to: '0,1' });
    expect(r.state.stacks['0,1']).toEqual([c('red:L7')]);
    expect(r.events[0]).toMatchObject({ type: 'withdrew', to: '0,1' });
    expect(mustReject(s, { type: 'withdraw', player: 'red', cardIds: [c('red:L7')], from: '0,0', to: '1,0' })).toMatch(/closer/);
  });

  test('black withdraws toward its own Tower', () => {
    const s = buildState({ board: { '0,0': ['black:L7'] }, current: 'black' });
    expect(withdrawOptions(s, 'black', [c('black:L7')], '0,0').sort()).toEqual(['0,-1', '1,-1'].sort());
  });

  test('no closer enterable hex -> cannot withdraw', () => {
    const s = buildState({ board: { '0,0': ['red:L7'], '0,1': ['black:L2'], '-1,1': ['black:L3'] } });
    expect(withdrawOptions(s, 'red', [c('red:L7')], '0,0')).toEqual([]);
  });

  test('from own Tower to Reserve; Commanders never; Wit may', () => {
    const s = buildState({ board: { '-1,2': ['red:L7', 'red:K1', 'red:W'] } });
    expect(withdrawOptions(s, 'red', [c('red:L7')], '-1,2')).toEqual(['reserve']);
    const r = mustApply(s, { type: 'withdraw', player: 'red', cardIds: [c('red:L7'), c('red:W')], from: '-1,2', to: 'reserve' });
    expect(r.state.reserve.red).toContain(c('red:L7'));
    expect(r.state.reserve.red).toContain(c('red:W'));
    expect(r.state.stacks['-1,2']).toEqual([c('red:K1')]);
    expect(mustReject(s, { type: 'withdraw', player: 'red', cardIds: [c('red:K1')], from: '-1,2', to: 'reserve' })).toMatch(/Commanders/);
  });

  test('to Reserve only from your own Tower', () => {
    const s = buildState({ board: { '0,2': ['red:L7'], '1,-2': ['red:L8'] } });
    expect(mustReject(s, { type: 'withdraw', player: 'red', cardIds: [c('red:L7')], from: '0,2', to: 'reserve' })).toMatch(/own Tower/);
    expect(mustReject(s, { type: 'withdraw', player: 'red', cardIds: [c('red:L8')], from: '1,-2', to: 'reserve' })).toMatch(/own Tower/);
  });

  test('Withdraw and Move are separate action types for the cap', () => {
    let s = buildState({ board: { '0,-2': ['red:L7'], '0,0': ['red:L2'] } });
    s = run(s, mv(['red:L7'], '0,-2', '0,-1'), mv(['red:L7'], '0,-1', '1,-1'), mv(['red:L7'], '1,-1', '1,0')).state;
    const r = mustApply(s, { type: 'withdraw', player: 'red', cardIds: [c('red:L2')], from: '0,0', to: '0,1' });
    // The 4th CP was accepted; at 0 CP the turn ends automatically.
    expect(r.events.some((e) => e.type === 'withdrew')).toBe(true);
    expect(r.state.turn!.player).toBe('black');
  });

  test('a Withdrawn Wit can be Spawned again', () => {
    let s = buildState({ board: { '-1,2': ['red:W'] } });
    s = mustApply(s, { type: 'withdraw', player: 'red', cardIds: [c('red:W')], from: '-1,2', to: 'reserve' }).state;
    expect(mustApply(s, { type: 'spawnWit', player: 'red', hex: '0,0' }).state.stacks['0,0']).toEqual([c('red:W')]);
  });
});

describe('§6.5 Spawn Wit', () => {
  test('any hex without enemy cards except Towers and hexes adjacent to either Tower', () => {
    const s = buildState({ board: { '0,0': ['black:L2'], '1,0': ['red:L3'] } });
    const hexes = spawnHexes(s, 'red');
    expect(hexes).not.toContain('0,0');
    expect(hexes).toContain('1,0');
    for (const h of ['-1,2', '1,-2', '0,2', '-2,2', '0,1', '-1,1', '0,-2', '2,-2', '0,-1', '1,-1']) expect(hexes).not.toContain(h);
    expect(spawnHexes(buildState(), 'red')).toHaveLength(9);
    expect(mustReject(s, { type: 'spawnWit', player: 'red', hex: '0,1' })).toMatch(/adjacent to a Tower/);
    expect(mustReject(s, { type: 'spawnWit', player: 'red', hex: '1,-2' })).toMatch(/on a Tower/);
    expect(mustReject(s, { type: 'spawnWit', player: 'red', hex: '0,0' })).toMatch(/enemy/);
  });

  test('costs 1 CP and requires Wit in Reserve', () => {
    const s = buildState();
    const r = mustApply(s, { type: 'spawnWit', player: 'red', hex: '2,0' });
    expect(r.state.turn!.cp).toBe(3);
    expect(r.events[0]).toEqual({ type: 'spawned', player: 'red', cardId: c('red:W'), hex: '2,0' });
    expect(mustReject(r.state, { type: 'spawnWit', player: 'red', hex: '-2,0' })).toMatch(/not in your Reserve/);
    expect(legalSpawnHexes(r.state, 'red')).toEqual([]);
  });

  test('Wit cannot be Deployed or Reinforced', () => {
    const s = buildState({ board: { '-1,2': ['red:L7'] }, fortified: ['-1,2'] });
    expect(mustReject(s, { type: 'deploy', player: 'red', cardIds: [c('red:W')] })).toMatch(/Wit/);
    expect(mustReject(s, { type: 'reinforce', player: 'red', cardId: c('red:W'), hex: '-1,2' })).toMatch(/Wit/);
  });
});

describe('§10.4 Deploy', () => {
  test('1–3 Reserve cards onto own Tower for 1 CP', () => {
    const s = buildState();
    const r = mustApply(s, { type: 'deploy', player: 'red', cardIds: [c('red:L7'), c('red:H4'), c('red:A1')] });
    expect(r.state.stacks['-1,2']).toHaveLength(3);
    expect(r.state.turn!.cp).toBe(3);
    expect(mustReject(s, { type: 'deploy', player: 'red', cardIds: ['red:L2', 'red:L3', 'red:L4', 'red:L5'].map(c) })).toMatch(/1–3/);
  });

  test('not while enemy cards occupy your Tower; only Reserve cards', () => {
    const s = buildState({ board: { '-1,2': ['black:L2'], '0,0': ['red:L7'] } });
    expect(mustReject(s, { type: 'deploy', player: 'red', cardIds: [c('red:L8')] })).toMatch(/enemy/);
    expect(deployInfo(s, 'red').legal).toBe(false);
    const s2 = buildState({ board: { '0,0': ['red:L7'] }, destroyed: ['red:L8'] });
    expect(mustReject(s2, { type: 'deploy', player: 'red', cardIds: [c('red:L7')] })).toMatch(/not in your Reserve/);
    expect(mustReject(s2, { type: 'deploy', player: 'red', cardIds: [c('red:L8')] })).toMatch(/not in your Reserve/);
  });
});

describe('§10.1 Fortify', () => {
  test('costs 2, or 1 with Heavy Infantry in the stack', () => {
    const s = buildState({ board: { '0,0': ['red:L7'], '1,0': ['red:H3', 'red:L2'] } });
    expect(fortifyInfo(s, 'red', '0,0')).toEqual({ legal: true, cost: 2, reason: null });
    expect(fortifyInfo(s, 'red', '1,0').cost).toBe(1);
    const r = mustApply(s, { type: 'fortify', player: 'red', hex: '1,0' });
    expect(r.state.turn!.cp).toBe(3);
    expect(r.state.fortified).toEqual({ '1,0': 'red' });
    expect(r.events[0]).toEqual({ type: 'fortified', player: 'red', hex: '1,0', cost: 1 });
  });

  test('3-CP cap: two 2-CP Fortifies are not allowed in one turn', () => {
    let s = buildState({ board: { '0,0': ['red:L7'], '1,0': ['red:L2'], '-1,0': ['red:H5'] } });
    s = mustApply(s, { type: 'fortify', player: 'red', hex: '0,0' }).state;
    expect(mustReject(s, { type: 'fortify', player: 'red', hex: '1,0' })).toMatch(/At most 3 CP/);
    expect(mustApply(s, { type: 'fortify', player: 'red', hex: '-1,0' }).state.turn!.cp).toBe(1);
  });

  test('not if any card in the hex moved or arrived this turn; not if already Fortified; only own hexes', () => {
    let s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['red:L2'], '1,0': ['black:L5'] } });
    s = mustApply(s, mv(['red:L7'], '0,1', '0,0')).state;
    expect(mustReject(s, { type: 'fortify', player: 'red', hex: '0,0' })).toMatch(/moved or arrived/);
    const s2 = buildState({ board: { '0,0': ['red:L2'] }, fortified: ['0,0'] });
    expect(mustReject(s2, { type: 'fortify', player: 'red', hex: '0,0' })).toMatch(/already Fortified/);
    expect(mustReject(s2, { type: 'fortify', player: 'red', hex: '1,0' })).toMatch(/no cards/);
    // Deployed / spawned / reinforced cards count as arriving
    const s3 = mustApply(buildState({ board: { '-1,2': ['red:L2'] } }), { type: 'deploy', player: 'red', cardIds: [c('red:L3')] }).state;
    expect(mustReject(s3, { type: 'fortify', player: 'red', hex: '-1,2' })).toMatch(/moved or arrived/);
    const s4 = mustApply(buildState({ board: { '2,0': ['red:L2'] } }), { type: 'spawnWit', player: 'red', hex: '2,0' }).state;
    expect(mustReject(s4, { type: 'fortify', player: 'red', hex: '2,0' })).toMatch(/moved or arrived/);
  });

  test('a card that moved out and back still blocks', () => {
    let s = buildState({ board: { '0,0': ['red:L7'] } });
    s = run(s, mv(['red:L7'], '0,0', '1,0'), mv(['red:L7'], '1,0', '0,0')).state;
    expect(mustReject(s, { type: 'fortify', player: 'red', hex: '0,0' })).toMatch(/moved/);
  });

  test('joining cards become Fortified; leaving cards do not end it; emptying the hex does', () => {
    let s = buildState({ board: { '0,0': ['red:L7', 'red:L8'], '0,1': ['red:L2'] }, fortified: ['0,0'] });
    s = mustApply(s, mv(['red:L2'], '0,1', '0,0')).state;
    expect(s.fortified['0,0']).toBe('red');
    s = mustApply(s, mv(['red:L7'], '0,0', '1,0')).state;
    expect(s.fortified['0,0']).toBe('red');
    const r = mustApply(s, mv(['red:L8', 'red:L2'], '0,0', '-1,0'));
    expect(r.state.fortified).toEqual({});
    expect(eventsOf(r.events, 'fortifyEnded')).toEqual([{ type: 'fortifyEnded', player: 'red', hex: '0,0' }]);
  });

  test('any hex including a Tower may be Fortified', () => {
    const s = buildState({ board: { '-1,2': ['red:L7'] } });
    expect(mustApply(s, { type: 'fortify', player: 'red', hex: '-1,2' }).state.fortified['-1,2']).toBe('red');
  });
});

describe('§10.2–10.3 supply and Reinforce', () => {
  const chain = { '-1,2': ['red:K1'], '-1,1': ['red:L2'], '-1,0': ['red:L3'], '0,-1': ['red:L4'] };

  test('supply line: chain of own-occupied hexes from own Tower', () => {
    const s = buildState({ board: { ...chain, '1,0': ['red:L5'] } });
    expect(hasSupply(s, 'red', '0,-1')).toBe(true);
    expect(hasSupply(s, 'red', '1,0')).toBe(false);
    expect(suppliedHexes(s, 'red').sort()).toEqual(['-1,2', '-1,1', '-1,0', '0,-1'].sort());
  });

  test('leaving your Tower empty cuts all supply', () => {
    const { '-1,2': _t, ...noTower } = chain;
    const s = buildState({ board: noTower });
    expect(suppliedHexes(s, 'red')).toEqual([]);
  });

  test('enemy cards break the chain', () => {
    const s = buildState({ board: { '-1,2': ['red:K1'], '-1,1': ['black:L2'], '-1,0': ['red:L3'] } });
    expect(hasSupply(s, 'red', '-1,0')).toBe(false);
  });

  test('Reinforce: 3 CP, one Reserve card onto a supplied Fortified hex', () => {
    const s = buildState({ board: chain, fortified: ['0,-1'] });
    expect(reinforceTargets(s, 'red')).toEqual(['0,-1']);
    const r = mustApply(s, { type: 'reinforce', player: 'red', cardId: c('red:H9'), hex: '0,-1' });
    expect(r.state.stacks['0,-1']).toContain(c('red:H9'));
    expect(r.state.turn!.cp).toBe(1);
    expect(r.events[0]).toEqual({ type: 'reinforced', player: 'red', cardId: c('red:H9'), hex: '0,-1' });
    expect(mustReject(r.state, { type: 'reinforce', player: 'red', cardId: c('red:H8'), hex: '0,-1' })).toMatch(/CP/);
  });

  test('Reinforce needs Fortified + supply + Reserve card', () => {
    const s = buildState({ board: { ...chain, '1,0': ['red:L5'] }, fortified: ['1,0', '-1,0'] });
    expect(mustReject(s, { type: 'reinforce', player: 'red', cardId: c('red:H9'), hex: '1,0' })).toMatch(/supply/);
    expect(mustReject(s, { type: 'reinforce', player: 'red', cardId: c('red:H9'), hex: '0,-1' })).toMatch(/Fortified/);
    expect(mustReject(s, { type: 'reinforce', player: 'red', cardId: c('red:L2'), hex: '-1,0' })).toMatch(/Reserve/);
    expect(mustReject(s, { type: 'reinforce', player: 'red', cardId: c('red:K2'), hex: '-1,0' })).toMatch(/Commanders/);
  });
});
