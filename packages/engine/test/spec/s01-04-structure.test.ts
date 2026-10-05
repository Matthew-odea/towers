import { describe, it, expect } from 'vitest';
import {
  createMatch, applyAction, viewFor, pendingDecision, buildArmy, buildAllCards, cardActivates, KIND_NAMES,
  ALL_HEXES, TOWER, HOME_EDGE, CENTRE, neighbors, distance, areAdjacent, mirror,
} from '../../src/index';
import { buildState, mustApply, mustReject, c, cs, seq, fight, settle, eventsOf, placeCommanders, place, completeSetup } from './h';

const KINDS = ['light', 'heavy', 'archer', 'cavalry', 'commander', 'shardbearer', 'wit'];

function checkTerrain(t: Record<string, string>) {
  expect(Object.keys(t).sort()).toEqual([...ALL_HEXES].sort());
  expect(t[TOWER.red]).toBe('tower');
  expect(t[TOWER.black]).toBe('tower');
  expect(Object.values(t).filter((x) => x === 'tower')).toHaveLength(2);
  for (const p of ['red', 'black'] as const)
    for (const h of HOME_EDGE[p]) if (h !== TOWER[p]) expect(t[h]).toBe('plains');
  expect(['plains', 'forest', 'mountain']).toContain(t[CENTRE]);
  // point symmetry
  for (const h of ALL_HEXES) expect(t[mirror(h)]).toBe(t[h]);
  const skip = new Set<string>([TOWER.red, TOWER.black, CENTRE, ...HOME_EDGE.red, ...HOME_EDGE.black]);
  const rest = ALL_HEXES.filter((h) => !skip.has(h));
  expect(rest).toHaveLength(12);
  const n = (k: string) => rest.filter((h) => t[h] === k).length;
  expect(n('forest')).toBe(4);
  expect(n('mountain')).toBe(2);
  expect(n('plains')).toBe(6);
}

describe('§1 Match structure', () => {
  it('two players red/black; best of 3, starting in round 1 setup', () => {
    const s = createMatch({ seed: 'm1' });
    expect(s.phase).toBe('setup');
    expect(s.round).toBe(1);
    expect(s.roundWins).toEqual({ red: 0, black: 0 });
    expect(Object.keys(s.names).sort()).toEqual(['black', 'red']);
  });

  it('first player to win 2 rounds wins the match; match over rejects every action', () => {
    const s = buildState({ roundWins: { red: 1 }, round: 2 });
    const r = mustApply(s, { type: 'concede', player: 'black' });
    expect(r.state.phase).toBe('matchOver');
    expect(r.state.winner).toBe('red');
    expect(eventsOf(r.events, 'matchWon')[0].winner).toBe('red');
    expect(pendingDecision(r.state).kind).toBe('matchOver');
    mustReject(r.state, { type: 'concede', player: 'red' });
    mustReject(r.state, { type: 'endTurn', player: 'red' });
  });

  it('a 1-1 split goes to a third round', () => {
    const s = buildState({ roundWins: { red: 1, black: 1 }, round: 3 });
    // not yet 2 wins: one win makes 2-1 and ends it; a 1-0 state continues instead
    const t = buildState({ roundWins: { red: 0, black: 1 }, round: 2 });
    const r = mustApply(t, { type: 'concede', player: 'black' });
    expect(r.state.phase).toBe('setup');
    expect(r.state.round).toBe(3);
    expect(r.state.roundWins).toEqual({ red: 1, black: 1 });
    expect(s.round).toBe(3);
  });

  it('cards destroyed stay destroyed next round; Commanders come back at full count', () => {
    const s = buildState({
      board: { '0,0': ['red:L4'], '1,-1': ['black:L5'] },
      destroyed: ['red:K1', 'red:K2', 'red:L9', 'black:H3', 'black:K1'],
    });
    const r = mustApply(s, { type: 'concede', player: 'red' });
    expect(r.state.round).toBe(2);
    expect(r.state.destroyed.red).toEqual([c('red:L9')]);
    expect(r.state.destroyed.black).toEqual([c('black:H3')]);
    for (const p of ['red', 'black'] as const)
      for (const k of ['K1', 'K2']) expect(JSON.stringify(r.state.reserve[p])).toContain(c(`${p}:${k}`));
  });

  it('every card not destroyed (board, Reserve, withdrawn) is available again next round', () => {
    const s = buildState({ board: { '0,0': ['red:L4', 'red:H4'], '1,-1': ['black:L5'] }, destroyed: ['red:L9'] });
    const r = mustApply(s, { type: 'concede', player: 'black' });
    const avail = (p: 'red' | 'black') => [...r.state.reserve[p]].sort();
    const expectRed = buildArmy('red').map((x) => x.id).filter((i) => i !== c('red:L9')).sort();
    expect(avail('red')).toEqual(expectRed);
    expect(avail('black')).toEqual(buildArmy('black').map((x) => x.id).sort());
    expect(Object.keys(r.state.stacks)).toHaveLength(0);
  });

  it('all information is public, including setup placements as they happen', () => {
    let s = createMatch({ seed: 'pub', firstPlayer: 'black' });
    const v = viewFor(s, 'red');
    expect(v.reserve.black).toEqual(s.reserve.black);
    expect(v.destroyed.black).toEqual(s.destroyed.black);
    expect(JSON.stringify(v)).not.toContain('"seed"');
    expect(JSON.stringify(v)).not.toContain('"rng"');
    s = seq(s, ...placeCommanders(s, 'black')).state;
    const rv = viewFor(s, 'red');
    expect(rv.setup.black.placements).toEqual([
      { cardId: c('black:K1'), hex: '1,-2' },
      { cardId: c('black:K2'), hex: '0,-2' },
    ]);
    expect(rv.stacks).toEqual({ '1,-2': [c('black:K1')], '0,-2': [c('black:K2')] });
    expect(rv.reserve.black).not.toContain(c('black:K1'));
  });

  it('dice are two d6 rolled by the engine, within range, and vary', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const s = buildState({ seed: 'dice' + i, board: { '0,1': ['red:L5'], '0,0': ['black:L5'] } });
      const r = fight(s, { target: '0,0', atk: ['red:L5'] });
      const d = eventsOf(r.events, 'diceRolled')[0].dice;
      for (const x of d) { expect(x).toBeGreaterThanOrEqual(1); expect(x).toBeLessThanOrEqual(6); }
      seen.add(d.join());
    }
    expect(seen.size).toBeGreaterThan(5);
  });
});

describe('§2 Armies', () => {
  const army = buildArmy('red');
  it('27 cards per player, 54 total, with the stated composition', () => {
    expect(army).toHaveLength(27);
    expect(Object.keys(buildAllCards())).toHaveLength(54);
    const n = (k: string) => army.filter((x) => x.kind === k).length;
    expect([n('light'), n('heavy'), n('archer'), n('cavalry'), n('commander'), n('shardbearer'), n('wit')]).toEqual([9, 9, 2, 2, 2, 2, 1]);
    for (const k of ['light', 'heavy']) expect(army.filter((x) => x.kind === k).map((x) => x.rank).sort((a, b) => a! - b!)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(buildArmy('black').map((x) => x.kind).sort()).toEqual(army.map((x) => x.kind).sort());
  });

  it('card types use the Stormlight names, never playing-card names', () => {
    expect(Object.values(KIND_NAMES).sort()).toEqual(['Archer', 'Cavalry', 'Commander', 'Heavy Infantry', 'Light Infantry', 'Shardbearer', 'Wit']);
    expect(JSON.stringify(KIND_NAMES)).not.toMatch(/King|Queen|Jack|Ace|Joker/);
    expect(KINDS.length).toBe(7);
  });

  const s = buildState();
  const act = (ref: string, d: [number, number], wit?: number) => cardActivates(s.cards[c(ref)], d, wit as any);
  it('Light and Heavy Infantry activate when total equals rank', () => {
    for (let r = 2; r <= 10; r++) {
      expect(act(`red:L${r}`, [Math.min(6, r - 1), r - Math.min(6, r - 1)])).toBe(true);
      expect(act(`red:H${r}`, [Math.min(6, r - 1), r - Math.min(6, r - 1)])).toBe(true);
    }
    expect(act('red:L8', [3, 4])).toBe(false);
    expect(act('red:H8', [6, 3])).toBe(false);
  });
  it('Archer activates when either die shows a 1', () => {
    expect(act('red:A1', [1, 6])).toBe(true);
    expect(act('red:A1', [4, 1])).toBe(true);
    expect(act('red:A1', [2, 6])).toBe(false);
  });
  it('Cavalry activates when either die shows a 6', () => {
    expect(act('red:V1', [6, 2])).toBe(true);
    expect(act('red:V1', [3, 6])).toBe(true);
    expect(act('red:V1', [5, 5])).toBe(false);
  });
  it('Commander never activates', () => {
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) expect(act('red:K1', [a, b])).toBe(false);
  });
  it('Shardbearer activates on any doubles or a total of 7', () => {
    for (let a = 1; a <= 6; a++) expect(act('red:S1', [a, a])).toBe(true);
    expect(act('red:S1', [3, 4])).toBe(true);
    expect(act('red:S1', [1, 6])).toBe(true);
    expect(act('red:S1', [2, 3])).toBe(false);
  });
  it('Wit activates when total equals the declared number', () => {
    expect(act('red:W', [2, 3], 5)).toBe(true);
    expect(act('red:W', [2, 3], 6)).toBe(false);
    expect(act('red:W', [6, 6], 12)).toBe(true);
  });
});

describe('§3 Board', () => {
  it('19 hexes of radius 2; towers are the middle of each home edge', () => {
    expect(ALL_HEXES).toHaveLength(19);
    expect(HOME_EDGE.red).toHaveLength(3);
    expect(HOME_EDGE.black).toHaveLength(3);
    expect(HOME_EDGE.red[1]).toBe(TOWER.red);
    expect(HOME_EDGE.black[1]).toBe(TOWER.black);
    expect(distance(TOWER.red, TOWER.black)).toBe(4);
    expect(neighbors('0,0')).toHaveLength(6);
    expect(areAdjacent('0,0', '1,0')).toBe(true);
    expect(areAdjacent('1,0', '0,-1')).toBe(false);
  });

  it('terrain obeys the point-symmetric generation rules for many seeds, round 1', () => {
    for (let i = 0; i < 60; i++) checkTerrain(createMatch({ seed: 'terr' + i }).terrain);
  });

  it('terrain is re-randomised each round and keeps the rules', () => {
    const seen = new Set<string>();
    let differs = 0;
    for (let i = 0; i < 25; i++) {
      const s = createMatch({ seed: 'rr' + i });
      const r = mustApply(s, { type: 'concede', player: 'red' });
      checkTerrain(r.state.terrain);
      seen.add(JSON.stringify(r.state.terrain));
      if (JSON.stringify(r.state.terrain) !== JSON.stringify(s.terrain)) differs++;
    }
    expect(differs).toBeGreaterThan(15);
    expect(seen.size).toBeGreaterThan(5);
  });

  it('the centre hex is Plains, Forest or Mountain across seeds (all three occur)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(createMatch({ seed: 'cen' + i }).terrain[CENTRE]);
    expect([...seen].sort()).toEqual(['forest', 'mountain', 'plains']);
  });
});

describe('§4 Round setup', () => {
  const fresh = () => createMatch({ seed: 'setup', firstPlayer: 'black' });

  it('Commanders first (starter, then the other player), then 6 troops each, alternating from the starter; the rest stays in Reserve', () => {
    const r = completeSetup(fresh(), {
      red: [['red:L2', '-2,2'], ['red:L3', '-1,2'], ['red:L4', '0,2'], ['red:H5', '-2,2'], ['red:A1', '-1,2'], ['red:S1', '0,2']],
    });
    const placed = eventsOf(r.events, 'setupPlaced');
    expect(placed.map((e) => `${e.player}:${e.step}`)).toEqual([
      'black:commander', 'black:commander', 'red:commander', 'red:commander',
      'black:troop', 'red:troop', 'black:troop', 'red:troop', 'black:troop', 'red:troop',
      'black:troop', 'red:troop', 'black:troop', 'red:troop', 'black:troop', 'red:troop',
    ]);
    expect(placed.filter((e) => e.player === 'red' && e.step === 'troop').map((e) => e.cardId)).toEqual(
      cs('red:L2', 'red:L3', 'red:L4', 'red:H5', 'red:A1', 'red:S1'),
    );
    const s = r.state;
    expect(s.phase).toBe('play');
    expect(s.turn!.player).toBe('black');
    expect(Object.values(s.stacks).flat().filter((i) => i.startsWith('red-'))).toHaveLength(8);
    expect(s.reserve.red).toHaveLength(27 - 8);
    expect(s.reserve.black).toHaveLength(27 - 8);
  });

  it('Commanders go on home-edge hexes, one per action', () => {
    const s = fresh();
    mustReject(s, place('black', 'black:K1', '0,0'));
    mustReject(s, place('black', 'black:K1', '-1,2'));
    mustReject(s, { type: 'setupPlace', player: 'black', placements: [{ cardId: c('black:K1'), hex: '1,-2' }, { cardId: c('black:K2'), hex: '1,-2' }] });
    mustReject(s, place('black', 'black:L7', '1,-2'));
    mustApply(s, place('black', 'black:K1', '2,-2'));
  });

  it('a 7th troop is never asked for; Wit is never placed at setup', () => {
    let s = seq(fresh(), ...placeCommanders(fresh(), 'black'), ...placeCommanders(fresh(), 'red')).state;
    mustReject(s, place('black', 'black:W', '0,-2'));
    const plan = ['L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'].map((x, i) => [`black:${x}`, i < 3 ? '0,-2' : '2,-2'] as [string, string]);
    const r = completeSetup(s, { black: plan });
    expect(r.state.stacks['0,-2']).toEqual([c('black:K2'), ...cs('black:L2', 'black:L3', 'black:L4')]);
    expect(r.state.stacks['2,-2']).toEqual(cs('black:L5', 'black:L6', 'black:L7'));
    expect(r.state.reserve.black).toContain(c('black:L8'));
    expect(r.state.reserve.black).toContain(c('black:W'));
    s = r.state;
    expect(s.phase).toBe('play');
  });

  it('a home-edge hex holds at most 4 cards; a full hex is not offered', () => {
    const s0 = seq(fresh(), ...placeCommanders(fresh(), 'black'), ...placeCommanders(fresh(), 'red')).state;
    // Black's 0,-2 already holds a Commander; three troops fill it.
    const s = seq(
      s0,
      place('black', 'black:L2', '0,-2'),
      place('red', 'red:L2', '0,2'),
      place('black', 'black:L3', '0,-2'),
      place('red', 'red:L3', '0,2'),
      place('black', 'black:L4', '0,-2'),
      place('red', 'red:L4', '0,2'),
    ).state;
    expect(s.stacks['0,-2']).toHaveLength(4);
    expect(mustReject(s, place('black', 'black:L5', '0,-2'))).toMatch(/at most 4/);
    const d = pendingDecision(s);
    expect(d.kind === 'setup' && d.hexes).toEqual(['1,-2', '2,-2']);
    mustApply(s, place('black', 'black:L5', '2,-2'));
  });

  it('cannot place the opponent cards, a card twice, destroyed cards, or out of turn', () => {
    const s = seq(fresh(), ...placeCommanders(fresh(), 'black'), ...placeCommanders(fresh(), 'red')).state;
    mustReject(s, place('black', 'red:L2', '0,-2'));
    mustReject(s, place('red', 'red:L2', '0,2')); // black's setup turn
    const t = mustApply(s, place('black', 'black:L2', '0,-2')).state;
    const u = mustApply(t, place('red', 'red:L2', '0,2')).state;
    mustReject(u, place('black', 'black:L2', '0,-2'));
    // destroyed card in a later round
    const g = buildState({ board: { '0,0': ['red:L4'] }, destroyed: ['red:L9'], round1Starter: 'black' });
    const r2 = mustApply(g, { type: 'concede', player: 'red' }).state; // round 2: red starts
    const r3 = seq(r2, ...placeCommanders(r2, 'red'), ...placeCommanders(r2, 'black')).state;
    expect(mustReject(r3, place('red', 'red:L9', '0,2'))).toMatch(/not available/);
  });

  it('setup is open: every placement is public and announced with its hex; play starts with setupComplete', () => {
    const s = fresh();
    const r1 = mustApply(s, place('black', 'black:K1', '1,-2'));
    expect(r1.events).toEqual([{ type: 'setupPlaced', player: 'black', cardId: c('black:K1'), hex: '1,-2', step: 'commander' }]);
    expect(viewFor(r1.state, 'red').setup.black.placements).toEqual([{ cardId: c('black:K1'), hex: '1,-2' }]);
    expect(viewFor(r1.state, 'red').stacks['1,-2']).toEqual([c('black:K1')]);
    expect(pendingDecision(r1.state)).toMatchObject({ kind: 'setup', players: ['black'], step: 'commander' });
    const r2 = completeSetup(r1.state);
    const done = eventsOf(r2.events, 'setupComplete');
    expect(done).toHaveLength(1);
    expect(done[0].placements.red).toHaveLength(8);
    expect(done[0].placements.black).toHaveLength(8);
    expect(r2.events[r2.events.length - 1]).toMatchObject({ type: 'turnStarted', player: 'black', turn: 1, cp: 4 });
    expect(r2.state.phase).toBe('play');
  });

  it('first player is random in round 1, then alternates (round 2 other, round 3 = round 1 starter)', () => {
    const starters = new Set<string>();
    for (let i = 0; i < 30; i++) starters.add(createMatch({ seed: 'fp' + i }).roundStarter);
    expect(starters.size).toBe(2);
    for (const first of ['red', 'black'] as const) {
      const other = first === 'red' ? 'black' : 'red';
      let s = createMatch({ seed: 'alt', firstPlayer: first });
      expect(s.roundStarter).toBe(first);
      expect(pendingDecision(s)).toMatchObject({ kind: 'setup', player: first });
      s = completeSetup(s).state;
      expect(s.turn!.player).toBe(first);
      s = mustApply(s, { type: 'concede', player: first }).state; // round 2
      expect(s.roundStarter).toBe(other);
      expect(pendingDecision(s)).toMatchObject({ kind: 'setup', player: other });
      s = completeSetup(s).state;
      expect(s.turn!.player).toBe(other);
      s = mustApply(s, { type: 'concede', player: other }).state; // 1-1 -> round 3
      expect(s.round).toBe(3);
      expect(s.roundStarter).toBe(first);
      s = completeSetup(s).state;
      expect(s.turn!.player).toBe(first);
    }
  });

  it('a player with only Commanders left still plays on (skips their troop setup turns)', () => {
    const g = buildState({ board: { '0,0': ['black:L4'] }, unlisted: 'destroyed' });
    const s = mustApply(g, { type: 'concede', player: 'black' }).state;
    expect(s.reserve.red.filter((i) => !i.includes('commander'))).toHaveLength(0);
    const r = completeSetup(s);
    expect(eventsOf(r.events, 'setupPlaced').filter((e) => e.player === 'red').map((e) => e.step)).toEqual(['commander', 'commander']);
    expect(r.state.phase).toBe('play');
  });
});
