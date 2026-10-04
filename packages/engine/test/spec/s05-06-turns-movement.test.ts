import { describe, it, expect } from 'vitest';
import { applyAction, pendingDecision, legalSpawnHexes, ALL_HEXES, CP_PER_TURN } from '../../src/index';
import { buildState, mustApply, mustReject, c, cs, seq, fight, settle, eventsOf, pend, started } from './h';

describe('§5 Turns and Command Points', () => {
  const base = () => buildState({ board: { '0,1': ['red:L5'], '0,-1': ['black:L5'], '-1,2': ['red:H3'] } });

  it('a turn gives 4 CP; ending the turn hands over to the opponent with a fresh 4 CP', () => {
    expect(CP_PER_TURN).toBe(4);
    const r = mustApply(base(), { type: 'endTurn', player: 'red' });
    expect(r.state.turn!.player).toBe('black');
    expect(r.state.turn!.cp).toBe(4);
    const ts = eventsOf(r.events, 'turnStarted')[0];
    expect(ts.player).toBe('black');
    expect(ts.cp).toBe(4);
  });

  it('unspent CP is lost and per-turn spending trackers reset', () => {
    let s = buildState({ board: { '0,1': ['red:L5'], '0,-1': ['black:L5'] }, spent: { move: 3 }, cp: 1 });
    mustReject(s, { type: 'move', player: 'red', cardIds: cs('red:L5'), from: '0,1', path: ['0,2'] });
    s = mustApply(s, { type: 'endTurn', player: 'red' }).state;
    expect(s.turn!.cp).toBe(4);
    s = mustApply(s, { type: 'endTurn', player: 'black' }).state;
    expect(s.turn!.player).toBe('red');
    expect(s.turn!.cp).toBe(4);
    expect(s.turn!.spent.move ?? 0).toBe(0);
    mustApply(s, { type: 'move', player: 'red', cardIds: cs('red:L5'), from: '0,1', path: ['0,2'] });
  });

  it('only the player whose turn it is may take turn actions', () => {
    mustReject(base(), { type: 'move', player: 'black', cardIds: cs('black:L5'), from: '0,-1', path: ['0,0'] });
    mustReject(base(), { type: 'endTurn', player: 'black' });
  });

  it('costs: Move 1, Engage 1, Deploy 1, Withdraw 1, Spawn 1, Fortify 2 (1 with Heavy), Reinforce 3, End turn 0', () => {
    const cp = (s: any, a: any) => mustApply(s, a).state.turn!.cp;
    const b = () => buildState({ board: { '0,1': ['red:L5'], '0,-1': ['black:L5'], '0,0': ['red:L6'], '-1,2': ['red:H3'], '-1,1': ['red:L7'] } });
    expect(cp(b(), { type: 'move', player: 'red', cardIds: cs('red:L5'), from: '0,1', path: ['1,0'] })).toBe(3);
    expect(cp(b(), { type: 'engage', player: 'red', target: '0,-1', cardIds: cs('red:L6'), witNumber: undefined })).toBe(3);
    expect(cp(b(), { type: 'deploy', player: 'red', cardIds: cs('red:L2') })).toBe(3);
    expect(cp(b(), { type: 'withdraw', player: 'red', cardIds: cs('red:L6'), from: '0,0', to: '0,1' })).toBe(3);
    expect(cp(b(), { type: 'spawnWit', player: 'red', hex: '-2,1' })).toBe(3);
    expect(cp(b(), { type: 'fortify', player: 'red', hex: '-1,1' })).toBe(2); // Light only: 2
    expect(cp(b(), { type: 'fortify', player: 'red', hex: '-1,2' })).toBe(3); // Heavy: 1
    expect(cp(buildState({ board: { '-1,2': ['red:H3'] }, fortified: ['-1,2'] }), { type: 'reinforce', player: 'red', cardId: c('red:L2'), hex: '-1,2' })).toBe(1);
    expect(cp(b(), { type: 'endTurn', player: 'red' })).toBe(4);
  });

  it('an action that costs more CP than remain is rejected', () => {
    mustReject(buildState({ board: { '-1,2': ['red:H3'] }, fortified: ['-1,2'], cp: 2 }), { type: 'reinforce', player: 'red', cardId: c('red:L2'), hex: '-1,2' });
    mustReject(buildState({ board: { '0,1': ['red:L5'] }, cp: 0 }), { type: 'move', player: 'red', cardIds: cs('red:L5'), from: '0,1', path: ['0,2'] });
    mustReject(buildState({ board: { '0,1': ['red:L5'] }, cp: 1 }), { type: 'fortify', player: 'red', hex: '0,1' });
  });

  it('cap: at most 3 CP on Move per turn even with CP left; other action types still work', () => {
    let s = buildState({ board: { '0,1': ['red:L5'] } });
    const mv = (from: string, to: string) => ({ type: 'move' as const, player: 'red' as const, cardIds: cs('red:L5'), from, path: [to] });
    s = mustApply(s, mv('0,1', '0,0')).state;
    s = mustApply(s, mv('0,0', '-1,0')).state;
    s = mustApply(s, mv('-1,0', '-1,-1')).state;
    expect(s.turn!.cp).toBe(1);
    mustReject(s, mv('-1,-1', '-2,0'));
    mustApply(s, { type: 'deploy', player: 'red', cardIds: cs('red:L2') });
  });

  it('cap: 3 Engage per turn; the 4th is rejected', () => {
    let s = buildState({ board: { '0,1': ['red:L5'], '0,0': ['black:L10'] }, dice: [1, 2, 1, 2, 1, 2, 1, 2] });
    for (let i = 0; i < 3; i++) {
      s = seq(s, { type: 'engage', player: 'red', target: '0,0', cardIds: cs('red:L5') }).state;
      s = settle({ state: s, events: [] }).state; // stale -> break off
      expect(s.engagement).toBeNull();
    }
    expect(s.turn!.cp).toBe(1);
    mustReject(s, { type: 'engage', player: 'red', target: '0,0', cardIds: cs('red:L5') });
  });

  it('cap: 3 Deploy per turn; Withdraw is a separate type from Move', () => {
    let s = buildState({ board: { '0,1': ['red:L5'] } });
    for (const x of ['L2', 'L3', 'L4']) s = mustApply(s, { type: 'deploy', player: 'red', cardIds: cs(`red:${x}`) }).state;
    mustReject(s, { type: 'deploy', player: 'red', cardIds: cs('red:L6') });
    const w = buildState({ board: { '0,0': ['red:L5'] }, spent: { move: 3 }, cp: 1 });
    mustApply(w, { type: 'withdraw', player: 'red', cardIds: cs('red:L5'), from: '0,0', to: '0,1' });
  });

  it('cap: Fortify (2 CP, no Heavy) cannot be repeated beyond 3 CP; Heavy at 1 CP can', () => {
    const b = buildState({ board: { '0,0': ['red:L5'], '0,1': ['red:L6'], '-1,1': ['red:H7'], '-1,0': ['red:H8'] } });
    const s1 = mustApply(b, { type: 'fortify', player: 'red', hex: '0,0' }).state; // 2
    mustReject(s1, { type: 'fortify', player: 'red', hex: '0,1' }); // would be 4
    const s2 = mustApply(s1, { type: 'fortify', player: 'red', hex: '-1,1' }).state; // heavy 1 -> total 3
    mustReject(s2, { type: 'fortify', player: 'red', hex: '-1,0' }); // total 4
  });

  it('cap: Reinforce (3 CP) once; Spawn Wit capped at 3 CP per turn', () => {
    const f = buildState({ board: { '-1,2': ['red:H3'] }, fortified: ['-1,2'], spent: { reinforce: 1 } });
    mustReject(f, { type: 'reinforce', player: 'red', cardId: c('red:L2'), hex: '-1,2' });
    mustReject(buildState({ spent: { spawnWit: 3 } }), { type: 'spawnWit', player: 'red', hex: '0,0' });
    mustReject(buildState({ spent: { engage: 3 }, board: { '0,1': ['red:L5'], '0,0': ['black:L5'] } }), { type: 'engage', player: 'red', target: '0,0', cardIds: cs('red:L5') });
  });

  it('actions may be mixed in any order (Move, Engage, Move, Engage)', () => {
    let s = buildState({ board: { '0,2': ['red:L5'], '0,1': ['red:L6'], '0,-1': ['black:L10'] }, dice: [1, 2, 1, 2] });
    s = mustApply(s, { type: 'move', player: 'red', cardIds: cs('red:L6'), from: '0,1', path: ['0,0'] }).state;
    s = settle(fight(s, { target: '0,-1', atk: ['red:L6'] })).state;
    s = mustApply(s, { type: 'move', player: 'red', cardIds: cs('red:L5'), from: '0,2', path: ['0,1'] }).state;
    const last = settle(fight(s, { target: '0,-1', atk: ['red:L6'] }));
    // All 4 CP spent: the turn ended automatically once the engagement was over.
    expect(last.state.turn!.player).toBe('black');
  });

  it('there is no undo action', () => {
    const r = applyAction(base(), { type: 'undo', player: 'red' } as any);
    expect(r.ok).toBe(false);
  });

  it('an engagement in progress blocks other turn actions and endTurn', () => {
    const s = buildState({ board: { '0,1': ['red:L5'], '0,0': ['black:L10'] }, dice: [1, 2] });
    const r = seq(s, { type: 'engage', player: 'red', target: '0,0', cardIds: cs('red:L5') });
    expect(pend(r.state).kind).toBe('pressOrBreak');
    mustReject(r.state, { type: 'endTurn', player: 'red' });
    mustReject(r.state, { type: 'move', player: 'red', cardIds: cs('red:L5'), from: '0,1', path: ['0,2'] });
  });
});

describe('§6.1 Stacks and moving', () => {
  it('a Move takes any subset of one stack one hex; the rest stay', () => {
    const s = buildState({ board: { '0,1': ['red:L5', 'red:H6', 'red:L7'] } });
    const r = mustApply(s, { type: 'move', player: 'red', cardIds: cs('red:L5', 'red:L7'), from: '0,1', path: ['0,0'] }).state;
    expect(r.stacks['0,0'].sort()).toEqual(cs('red:L5', 'red:L7').sort());
    expect(r.stacks['0,1']).toEqual(cs('red:H6'));
  });

  it('cannot enter an enemy hex; cannot move more than one hex; cannot move cards not in the hex or not yours', () => {
    const s = buildState({ board: { '0,1': ['red:L5'], '0,0': ['black:L6'], '2,0': ['red:L7'] } });
    mustReject(s, { type: 'move', player: 'red', cardIds: cs('red:L5'), from: '0,1', path: ['0,0'] });
    mustReject(s, { type: 'move', player: 'red', cardIds: cs('red:L5'), from: '0,1', path: ['-1,0'] }); // not adjacent? (0,1)->(-1,0) distance 2
    mustReject(s, { type: 'move', player: 'red', cardIds: cs('red:L5', 'red:L7'), from: '0,1', path: ['1,1'] });
    mustReject(s, { type: 'move', player: 'red', cardIds: cs('black:L6'), from: '0,0', path: ['1,0'] });
    mustReject(s, { type: 'move', player: 'red', cardIds: cs('red:L5'), from: '0,1', path: ['1,0', '2,-1'] }); // non-Cavalry two hexes
  });

  it('two players cards never share a hex after any accepted move', () => {
    const s = buildState({ board: { '0,1': ['red:L5'], '0,-1': ['black:L6'] } });
    const r = mustApply(s, { type: 'move', player: 'red', cardIds: cs('red:L5'), from: '0,1', path: ['0,0'] }).state;
    for (const st of Object.values(r.stacks)) expect(new Set(st.map((i) => r.cards[i].owner)).size).toBe(1);
  });

  it('winning an engagement never auto-advances the attacker', () => {
    const s = buildState({ board: { '0,1': ['red:L5'], '0,0': ['black:L10'] }, dice: [2, 3] });
    const r = settle(fight(s, { target: '0,0', atk: ['red:L5'] }));
    expect(r.state.stacks['0,0']).toBeUndefined();
    expect(r.state.stacks['0,1']).toEqual(cs('red:L5'));
  });

  it('the same cards can Move again (paying each time)', () => {
    let s = buildState({ board: { '0,1': ['red:L5'] } });
    s = mustApply(s, { type: 'move', player: 'red', cardIds: cs('red:L5'), from: '0,1', path: ['0,0'] }).state;
    s = mustApply(s, { type: 'move', player: 'red', cardIds: cs('red:L5'), from: '0,0', path: ['0,1'] }).state;
    expect(s.turn!.cp).toBe(2);
  });

  it('Forest and Plains are ordinary to enter and leave (no lock)', () => {
    let s = buildState({ board: { '0,1': ['red:L5'] }, terrain: { '0,0': 'forest' } });
    s = mustApply(s, { type: 'move', player: 'red', cardIds: cs('red:L5'), from: '0,1', path: ['0,0'] }).state;
    mustApply(s, { type: 'move', player: 'red', cardIds: cs('red:L5'), from: '0,0', path: ['-1,0'] });
  });
});

describe('§6.2 Cavalry 2-hex Plains move and charge', () => {
  const cav = (extra = {}) => buildState({ board: { '0,2': ['red:V1'] }, ...extra });
  const mv2 = (ids: string[], from: string, path: string[]) => ({ type: 'move' as const, player: 'red' as const, cardIds: cs(...ids), from, path });

  it('an all-Cavalry group may enter a Plains hex and continue into one more Plains hex', () => {
    const r = mustApply(cav(), mv2(['red:V1'], '0,2', ['0,1', '0,0']));
    expect(r.state.stacks['0,0']).toEqual(cs('red:V1'));
    expect(r.state.turn!.cp).toBe(3);
    expect(eventsOf(r.events, 'moved')[0].charge).toBe(true);
  });

  it('two Cavalry together may make the 2-hex move', () => {
    const s = buildState({ board: { '0,2': ['red:V1', 'red:V2'] } });
    const r = mustApply(s, mv2(['red:V1', 'red:V2'], '0,2', ['0,1', '1,0']));
    expect(r.state.stacks['1,0']).toHaveLength(2);
  });

  it('a mixed group (Cavalry + anything else) cannot make the 2-hex move, but may move one hex', () => {
    const s = buildState({ board: { '0,2': ['red:V1', 'red:L5'] } });
    mustReject(s, mv2(['red:V1', 'red:L5'], '0,2', ['0,1', '0,0']));
    mustApply(s, mv2(['red:V1', 'red:L5'], '0,2', ['0,1']));
  });

  it('a Forest in either path hex, a Tower or a Mountain breaks the 2-hex move', () => {
    mustReject(cav({ terrain: { '0,1': 'forest' } }), mv2(['red:V1'], '0,2', ['0,1', '0,0']));
    mustReject(cav({ terrain: { '0,0': 'forest' } }), mv2(['red:V1'], '0,2', ['0,1', '0,0']));
    mustReject(cav({ terrain: { '0,0': 'mountain' } }), mv2(['red:V1'], '0,2', ['0,1', '0,0']));
    mustReject(cav({ terrain: { '0,1': 'mountain' } }), mv2(['red:V1'], '0,2', ['0,1', '0,0']));
    const s = buildState({ board: { '-1,1': ['red:V1'] } });
    mustReject(s, mv2(['red:V1'], '-1,1', ['0,1', '-1,2'])); // second hex is the Tower
    mustReject(s, mv2(['red:V1'], '-1,1', ['-1,2', '0,2'])); // first hex is the Tower
    // single-hex move into a forest is fine
    mustApply(cav({ terrain: { '0,1': 'forest' } }), mv2(['red:V1'], '0,2', ['0,1']));
  });

  it('both path hexes must be enterable: an enemy blocks, friendly cards do not', () => {
    mustReject(buildState({ board: { '0,2': ['red:V1'], '0,1': ['black:L5'] } }), mv2(['red:V1'], '0,2', ['0,1', '0,0']));
    mustReject(buildState({ board: { '0,2': ['red:V1'], '0,0': ['black:L5'] } }), mv2(['red:V1'], '0,2', ['0,1', '0,0']));
    const r = mustApply(buildState({ board: { '0,2': ['red:V1'], '0,1': ['red:L5'], '0,0': ['red:L6'] } }), mv2(['red:V1'], '0,2', ['0,1', '0,0']));
    expect(r.state.stacks['0,0']).toHaveLength(2);
  });

  describe('charge', () => {
    const chargeBoard = () =>
      buildState({ board: { '0,2': ['red:V1'], '-1,1': ['red:L5'], '1,-1': ['red:L6'], '-1,2': ['red:H3'], '0,-1': ['black:L10'] }, dice: [1, 2, 1, 2, 1, 2] });
    const to00 = mv2(['red:V1'], '0,2', ['0,1', '0,0']);
    const adv = (r: { events: any[] }) => started(r.events).modifiers.attacker.advantage;

    it('Engage as the very next action with the charging Cavalry committed gives the attacker Advantage', () => {
      const r = fight(mustApply(chargeBoard(), to00).state, { target: '0,-1', atk: ['red:V1'] });
      expect(started(r.events).charge).toBe(true);
      expect(adv(r)).toContain('charge');
    });

    it('also when other cards are committed alongside the Cavalry', () => {
      const r = fight(mustApply(chargeBoard(), to00).state, { target: '0,-1', atk: ['red:V1', 'red:L6'] });
      expect(adv(r)).toContain('charge');
    });

    it('a single-hex Cavalry move gives no charge', () => {
      const s = buildState({ board: { '0,1': ['red:V1'], '0,-1': ['black:L10'] }, dice: [1, 2] });
      const s1 = mustApply(s, mv2(['red:V1'], '0,1', ['0,0'])).state;
      const r = fight(s1, { target: '0,-1', atk: ['red:V1'] });
      expect(adv(r)).not.toContain('charge');
    });

    it('without a committed charging Cavalry there is no charge', () => {
      const r = fight(mustApply(chargeBoard(), to00).state, { target: '0,-1', atk: ['red:L6'] });
      expect(adv(r)).not.toContain('charge');
    });

    it.each([
      ['another Move', { type: 'move', player: 'red', cardIds: ['red-light-5'], from: '-1,1', path: ['-1,0'] }],
      ['a Deploy', { type: 'deploy', player: 'red', cardIds: ['red-light-2'] }],
      ['a Fortify', { type: 'fortify', player: 'red', hex: '-1,2' }],
      ['a Spawn Wit', { type: 'spawnWit', player: 'red', hex: '-2,1' }],
      ['a Withdraw', { type: 'withdraw', player: 'red', cardIds: ['red-light-6'], from: '1,-1', to: '1,0' }],
    ])('%s between the move and the Engage cancels the charge', (_n, act) => {
      let s = mustApply(chargeBoard(), to00).state;
      s = mustApply(s, act as any).state;
      const r = fight(s, { target: '0,-1', atk: ['red:V1'] });
      expect(adv(r)).not.toContain('charge');
    });

    it('a previous Engage also uses up the charge: only the very next action counts', () => {
      let s = mustApply(chargeBoard(), to00).state;
      let r = fight(s, { target: '0,-1', atk: ['red:V1'] });
      expect(adv(r)).toContain('charge');
      r = settle(r);
      expect(r.state.engagement).toBeNull();
      const r2 = fight(r.state, { target: '0,-1', atk: ['red:V1'] });
      expect(adv(r2)).not.toContain('charge');
    });
  });
});

describe('§6.3 Mountain lock', () => {
  const M = { '0,0': 'mountain' as const };
  const mv = (ids: string[], from: string, to: string, p: 'red' | 'black' = 'red') => ({ type: 'move' as const, player: p, cardIds: cs(...ids), from, path: [to] });

  it('cards that entered a Mountain by Move cannot leave it this turn but can next turn', () => {
    let s = buildState({ board: { '0,1': ['red:L5'], '0,-1': ['black:L5'] }, terrain: M });
    s = mustApply(s, mv(['red:L5'], '0,1', '0,0')).state;
    mustReject(s, mv(['red:L5'], '0,0', '-1,0'));
    mustReject(s, { type: 'withdraw', player: 'red', cardIds: cs('red:L5'), from: '0,0', to: '0,1' });
    s = mustApply(mustApply(s, { type: 'endTurn', player: 'red' }).state, { type: 'endTurn', player: 'black' }).state;
    mustApply(s, mv(['red:L5'], '0,0', '-1,0'));
  });

  it('a locked card can still fight', () => {
    let s = buildState({ board: { '0,1': ['red:L5'], '0,-1': ['black:L10'] }, terrain: M, dice: [1, 2] });
    s = mustApply(s, mv(['red:L5'], '0,1', '0,0')).state;
    mustApply(s, { type: 'engage', player: 'red', target: '0,-1', cardIds: cs('red:L5') });
  });

  it('only the cards that entered are locked; cards already on the Mountain may leave', () => {
    let s = buildState({ board: { '0,0': ['red:H6'], '0,1': ['red:L5'] }, terrain: M });
    s = mustApply(s, mv(['red:L5'], '0,1', '0,0')).state;
    mustReject(s, mv(['red:L5'], '0,0', '-1,0'));
    mustReject(s, mv(['red:L5', 'red:H6'], '0,0', '-1,0'));
    mustApply(s, mv(['red:H6'], '0,0', '-1,0'));
  });

  it('entering by Withdraw locks', () => {
    let s = buildState({ board: { '0,0': ['red:L5'] }, terrain: { '0,1': 'mountain' } });
    s = mustApply(s, { type: 'withdraw', player: 'red', cardIds: cs('red:L5'), from: '0,0', to: '0,1' }).state;
    mustReject(s, mv(['red:L5'], '0,1', '1,0'));
    mustReject(s, { type: 'withdraw', player: 'red', cardIds: cs('red:L5'), from: '0,1', to: '0,2' });
  });

  it('entering by Spawn locks', () => {
    let s = buildState({ terrain: { '1,1': 'mountain' } });
    s = mustApply(s, { type: 'spawnWit', player: 'red', hex: '1,1' }).state;
    mustReject(s, mv(['red:W'], '1,1', '1,0'));
  });

  it('entering by Combat Retreat locks the retreating cards for the rest of the turn', () => {
    // Red attacks black at 0,0 from 0,1; black retreats to the mountain at -1,0... not adjacent to 0,1? (-1,0) neighbours 0,0,-1,1 -> adjacent to 0,1? no
    const s = buildState({
      board: { '0,1': ['red:L5'], '0,0': ['black:L8'] },
      terrain: { '-1,0': 'mountain' }, dice: [2, 3, 2, 3],
    });
    const r = settle(fight(s, { target: '0,0', atk: ['red:L5'], def: ['black:L8'] }), { retreat: '-1,0' });
    // dice 2+3 = 5: red L5 activates, black L8 does not: black loses its only card, nothing left to retreat.
    expect(r.state.engagement).toBeNull();
    // Use a two-card defender so one survives and retreats
    const s2 = buildState({
      board: { '0,1': ['red:L5'], '0,0': ['black:L8', 'black:L9'] },
      terrain: { '-1,0': 'mountain' }, dice: [2, 3],
    });
    const r2 = fight(s2, { target: '0,0', atk: ['red:L5'], def: ['black:L8'] });
    let q = settle(r2, { pick: (p) => [c('black:L8')], retreat: '-1,0' });
    expect(q.state.stacks['-1,0']).toEqual(cs('black:L9'));
    expect(q.state.turn!.mountainLocked).toContain(c('black:L9'));
    q = { ...q, state: mustApply(mustApply(q.state, { type: 'endTurn', player: 'red' }).state, mv(['black:L9'], '-1,0', '-1,-1', 'black')).state };
    expect(q.state.stacks['-1,-1']).toEqual(cs('black:L9'));
  });
});

describe('§6.4 Withdraw', () => {
  const wd = (ids: string[], from: string, to: string, p: 'red' | 'black' = 'red') => ({ type: 'withdraw' as const, player: p, cardIds: cs(...ids), from, to });

  it('moves to an adjacent hex strictly closer to your own Tower, whole stack or subset', () => {
    const s = buildState({ board: { '0,0': ['red:L5', 'red:L6'] } });
    const r = mustApply(s, wd(['red:L5'], '0,0', '0,1')).state;
    expect(r.stacks['0,0']).toEqual(cs('red:L6'));
    mustApply(s, wd(['red:L5', 'red:L6'], '0,0', '-1,1'));
  });

  it('rejects hexes at equal or greater distance from the Tower, and enemy-occupied hexes', () => {
    const s = buildState({ board: { '0,0': ['red:L5'] } });
    mustReject(s, wd(['red:L5'], '0,0', '-1,0')); // distance 2 -> 2
    mustReject(s, wd(['red:L5'], '0,0', '1,0'));
    mustReject(s, wd(['red:L5'], '0,0', '0,-1'));
    const e = buildState({ board: { '0,0': ['red:L5'], '0,1': ['black:L5'] } });
    mustReject(e, wd(['red:L5'], '0,0', '0,1'));
  });

  it('closeness is measured to the player\'s own Tower (Black)', () => {
    const s = buildState({ board: { '0,0': ['black:L5'] }, current: 'black' });
    mustApply(s, wd(['black:L5'], '0,0', '0,-1', 'black'));
    mustApply(s, wd(['black:L5'], '0,0', '1,-1', 'black'));
    mustReject(s, wd(['black:L5'], '0,0', '0,1', 'black'));
  });

  it('from your own Tower, cards may be withdrawn into Reserve', () => {
    const s = buildState({ board: { '-1,2': ['red:L5', 'red:L6'] } });
    const r = mustApply(s, wd(['red:L5'], '-1,2', 'reserve')).state;
    expect(r.reserve.red).toContain(c('red:L5'));
    expect(r.stacks['-1,2']).toEqual(cs('red:L6'));
  });

  it('cannot withdraw to Reserve from a non-Tower hex, nor from the enemy Tower', () => {
    mustReject(buildState({ board: { '0,1': ['red:L5'] } }), wd(['red:L5'], '0,1', 'reserve'));
    mustReject(buildState({ board: { '1,-2': ['red:L5'] } }), wd(['red:L5'], '1,-2', 'reserve'));
  });

  it('Commanders can never be withdrawn to Reserve; Wit may be', () => {
    const s = buildState({ board: { '-1,2': ['red:K1', 'red:W', 'red:L5'] } });
    mustReject(s, wd(['red:K1'], '-1,2', 'reserve'));
    mustReject(s, wd(['red:K1', 'red:L5'], '-1,2', 'reserve'));
    mustApply(s, wd(['red:W'], '-1,2', 'reserve'));
  });

  it('from the Tower there is no strictly-closer board hex', () => {
    const s = buildState({ board: { '-1,2': ['red:L5'] } });
    for (const h of ['-2,2', '0,2', '-1,1', '0,1']) mustReject(s, wd(['red:L5'], '-1,2', h));
  });
});

describe('§6.5 Spawn Wit', () => {
  it('Wit may spawn on any hex with no enemy, except Towers and hexes adjacent to either Tower', () => {
    const s = buildState({ board: { '0,0': ['black:L5'], '-1,-1': ['red:L5'] } });
    const allowed = ['-1,-1', '2,-1', '-2,0', '-1,0', '1,0', '2,0', '-2,1', '1,1']; // 0,0 holds an enemy
    expect([...legalSpawnHexes(s, 'red')].sort()).toEqual([...allowed].sort());
    for (const h of ALL_HEXES.filter((x) => !allowed.includes(x))) mustReject(s, { type: 'spawnWit', player: 'red', hex: h });
    for (const h of allowed) mustApply(s, { type: 'spawnWit', player: 'red', hex: h });
  });

  it('an empty centre hex is allowed', () => {
    mustApply(buildState(), { type: 'spawnWit', player: 'red', hex: '0,0' });
  });

  it('Wit must be in Reserve; spawning costs 1 and the Wit is a normal card afterwards', () => {
    const s = buildState({ board: { '0,0': ['red:W'] } });
    mustReject(s, { type: 'spawnWit', player: 'red', hex: '1,0' });
    let t = mustApply(buildState(), { type: 'spawnWit', player: 'red', hex: '0,0' });
    expect(t.state.stacks['0,0']).toEqual(cs('red:W'));
    expect(t.state.reserve.red).not.toContain(c('red:W'));
    t = mustApply(t.state, { type: 'move', player: 'red', cardIds: cs('red:W'), from: '0,0', path: ['1,0'] });
    expect(t.state.stacks['1,0']).toEqual(cs('red:W'));
  });

  it('Wit may be spawned again after being withdrawn to Reserve from the Tower', () => {
    let s = buildState({ board: { '-1,2': ['red:W'] } });
    s = mustApply(s, { type: 'withdraw', player: 'red', cardIds: cs('red:W'), from: '-1,2', to: 'reserve' }).state;
    s = mustApply(s, { type: 'spawnWit', player: 'red', hex: '1,0' }).state;
    expect(s.stacks['1,0']).toEqual(cs('red:W'));
  });

  it('Wit cannot be Deployed or Reinforced', () => {
    mustReject(buildState(), { type: 'deploy', player: 'red', cardIds: cs('red:W') });
    mustReject(buildState({ board: { '-1,2': ['red:H3'] }, fortified: ['-1,2'] }), { type: 'reinforce', player: 'red', cardId: c('red:W'), hex: '-1,2' });
  });

  it('spawn on an own-occupied hex is allowed and adds to the stack', () => {
    const s = buildState({ board: { '1,0': ['red:L5'] } });
    const r = mustApply(s, { type: 'spawnWit', player: 'red', hex: '1,0' }).state;
    expect(r.stacks['1,0']).toHaveLength(2);
  });
});
