import { describe, expect, test } from 'vitest';
import {
  HOME_EDGE,
  createMatch,
  pendingDecision,
  viewFor,
  type Action,
  type MatchState,
  type PlayerId,
} from '../src/index';
import { c, completeSetup, eventsOf, mustApply, mustReject, types } from './helpers';

function place(player: PlayerId, ref: string, hex: string): Action {
  return { type: 'setupPlace', player, placements: [{ cardId: c(ref), hex }] };
}
const ids = (...refs: string[]) => refs.map(c);

describe('§1/§2 match creation', () => {
  test('two 27-card armies, all in Reserve during setup', () => {
    const s = createMatch({ seed: 's' });
    expect(Object.keys(s.cards)).toHaveLength(54);
    expect(s.reserve.red).toHaveLength(27);
    expect(s.reserve.black).toHaveLength(27);
    expect(s.phase).toBe('setup');
    expect(s.round).toBe(1);
    const red = Object.values(s.cards).filter((x) => x.owner === 'red');
    const count = (k: string) => red.filter((x) => x.kind === k).length;
    expect([count('light'), count('heavy'), count('archer'), count('cavalry'), count('commander'), count('shardbearer'), count('wit')]).toEqual([
      9, 9, 2, 2, 2, 2, 1,
    ]);
    expect(s.cards['red-light-7']).toMatchObject({ kind: 'light', rank: 7, owner: 'red' });
    expect(s.cards['black-commander-raboniel']).toMatchObject({ kind: 'commander', character: 'raboniel' });
    expect(s.cards['red-wit-hoid']).toBeDefined();
  });

  test('names and explicit first player', () => {
    const s = createMatch({ seed: 's', names: { red: 'Ann' }, firstPlayer: 'black' });
    expect(s.names).toEqual({ red: 'Ann', black: 'Black' });
    expect(s.roundStarter).toBe('black');
  });

  test('round-1 first player is random but seeded', () => {
    const starters = new Set(Array.from({ length: 30 }, (_, i) => createMatch({ seed: `f${i}` }).roundStarter));
    expect(starters).toEqual(new Set(['red', 'black']));
    expect(createMatch({ seed: 'q' }).roundStarter).toBe(createMatch({ seed: 'q' }).roundStarter);
  });
});

describe('§4 setup (open, turn-based)', () => {
  const s0 = createMatch({ seed: 'setup', firstPlayer: 'red' });

  test('the first player places both Commanders first; pending decision carries the counters', () => {
    expect(pendingDecision(s0)).toEqual({
      kind: 'setup',
      players: ['red'],
      player: 'red',
      step: 'commander',
      eligible: ids('red:K1', 'red:K2'),
      hexes: [...HOME_EDGE.red],
      placed: { red: 0, black: 0 },
      commandersLeft: { red: 2, black: 2 },
      troopsLeft: { red: 6, black: 6 },
    });
  });

  test('order: first player Commanders x2, second player Commanders x2, then troops alternate from the first player', () => {
    const { state, events } = completeSetup(s0);
    const placed = eventsOf(events, 'setupPlaced');
    expect(placed.map((e) => e.player)).toEqual([
      'red', 'red', 'black', 'black',
      'red', 'black', 'red', 'black', 'red', 'black', 'red', 'black', 'red', 'black', 'red', 'black',
    ]);
    expect(placed.map((e) => e.step)).toEqual([...Array(4).fill('commander'), ...Array(12).fill('troop')]);
    expect(types(events).slice(-2)).toEqual(['setupComplete', 'turnStarted']);
    expect(state.phase).toBe('play');
    expect(state.turn).toMatchObject({ player: 'red', cp: 4, number: 1 });
    expect(state.reserve.red).toHaveLength(27 - 8);
    expect(state.reserve.red).toContain(c('red:W'));
    const done = eventsOf(events, 'setupComplete')[0];
    expect(done.placements.red).toHaveLength(8);
    expect(done.placements.black).toHaveLength(8);
    expect(pendingDecision(state)).toMatchObject({ kind: 'turn', player: 'red', cp: 4 });
  });

  test('the round starter places first (black starts)', () => {
    const s = createMatch({ seed: 'setup', firstPlayer: 'black' });
    expect(pendingDecision(s)).toMatchObject({ kind: 'setup', player: 'black', step: 'commander' });
    const placed = eventsOf(completeSetup(s).events, 'setupPlaced').map((e) => e.player);
    expect(placed.slice(0, 6)).toEqual(['black', 'black', 'red', 'red', 'black', 'red']);
  });

  test('each placement is applied at once, public, and announced', () => {
    const r = mustApply(s0, place('red', 'red:K1', '-2,2'));
    expect(r.events).toEqual([{ type: 'setupPlaced', player: 'red', cardId: c('red:K1'), hex: '-2,2', step: 'commander' }]);
    expect(r.state.stacks['-2,2']).toEqual([c('red:K1')]);
    expect(r.state.reserve.red).not.toContain(c('red:K1'));
    expect(viewFor(r.state, 'black').setup.red.placements).toEqual([{ cardId: c('red:K1'), hex: '-2,2' }]);
    expect(viewFor(r.state, 'black').stacks['-2,2']).toEqual([c('red:K1')]);
    expect(pendingDecision(r.state)).toMatchObject({ player: 'red', step: 'commander', eligible: ids('red:K2'), placed: { red: 1, black: 0 }, commandersLeft: { red: 1, black: 2 } });
  });

  test('exactly one placement per action', () => {
    expect(mustReject(s0, { type: 'setupPlace', player: 'red', placements: [] })).toMatch(/exactly one/);
    expect(
      mustReject(s0, { type: 'setupPlace', player: 'red', placements: [{ cardId: c('red:K1'), hex: '-1,2' }, { cardId: c('red:K2'), hex: '-1,2' }] }),
    ).toMatch(/exactly one/);
  });

  test('only the player whose setup turn it is may place', () => {
    expect(mustReject(s0, place('black', 'black:K1', '1,-2'))).toMatch(/Red's setup turn/);
  });

  test('Commanders before troops; Commanders only once', () => {
    expect(mustReject(s0, place('red', 'red:L7', '-1,2'))).toMatch(/Commanders first/);
    let s = mustApply(s0, place('red', 'red:K1', '-1,2')).state;
    s = mustApply(s, place('red', 'red:K2', '-1,2')).state;
    expect(mustReject(s, place('red', 'red:K1', '-1,2'))).toMatch(/Black's setup turn/);
    s = mustApply(s, place('black', 'black:K1', '1,-2')).state;
    s = mustApply(s, place('black', 'black:K2', '1,-2')).state;
    expect(pendingDecision(s)).toMatchObject({ player: 'red', step: 'troop', commandersLeft: { red: 0, black: 0 }, troopsLeft: { red: 6, black: 6 } });
    expect(mustReject(s, place('red', 'red:K1', '-1,2'))).toMatch(/already been placed/);
  });

  test('Wit, opponent cards, off-edge hexes and already-placed cards are rejected', () => {
    // Troop step: all Commanders placed.
    let s = mustApply(createMatch({ seed: 'x', firstPlayer: 'red' }), place('red', 'red:K1', '-1,2')).state;
    s = mustApply(s, place('red', 'red:K2', '-1,2')).state;
    s = mustApply(s, place('black', 'black:K1', '1,-2')).state;
    s = mustApply(s, place('black', 'black:K2', '1,-2')).state;
    expect(mustReject(s, place('red', 'red:W', '0,2'))).toMatch(/Wit/);
    expect(mustReject(s, place('red', 'black:L7', '0,2'))).toMatch(/belongs to Black/);
    expect(mustReject(s, place('red', 'red:L7', '0,1'))).toMatch(/home edge/);
    expect(mustReject(s, place('red', 'red:L7', '1,-2'))).toMatch(/home edge/);
    s = mustApply(s, place('red', 'red:L7', '0,2')).state;
    s = mustApply(s, place('black', 'black:L7', '0,-2')).state;
    expect(mustReject(s, place('red', 'red:L7', '0,2'))).toMatch(/already been placed/);
  });

  test('stacking is allowed on any home-edge hex', () => {
    for (const h of HOME_EDGE.red) {
      const { state } = completeSetup(s0, { red: [['red:K1', h], ['red:K2', h], ['red:L7', h], ['red:A1', h]] });
      expect(state.stacks[h]).toEqual(expect.arrayContaining(ids('red:K1', 'red:K2', 'red:L7', 'red:A1')));
    }
  });

  test('each player places exactly 6 troops; the rest stay in Reserve', () => {
    const { state } = completeSetup(s0);
    for (const p of ['red', 'black'] as const) {
      const placements = state.setup[p].placements;
      expect(placements.filter((x) => state.cards[x.cardId].kind !== 'commander')).toHaveLength(6);
      expect(placements.every((x) => HOME_EDGE[p].includes(x.hex))).toBe(true);
    }
  });

  test('a player out of eligible cards skips their remaining setup turns', () => {
    const s = createMatch({ seed: 'skip', firstPlayer: 'red' });
    // Red keeps only two troops (plus Commanders and Wit).
    const keep = new Set(ids('red:K1', 'red:K2', 'red:W', 'red:L7', 'red:H6'));
    s.destroyed.red = s.reserve.red.filter((id) => !keep.has(id));
    s.reserve.red = s.reserve.red.filter((id) => keep.has(id));
    let cur = s;
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      const d = pendingDecision(cur);
      if (d.kind !== 'setup') throw new Error('expected setup');
      order.push(d.player);
      cur = mustApply(cur, { type: 'setupPlace', player: d.player, placements: [{ cardId: d.eligible[0], hex: d.hexes[0] }] }).state;
    }
    const d = pendingDecision(cur);
    expect(d).toMatchObject({ kind: 'setup', player: 'red', troopsLeft: { red: 2, black: 6 } });
    const r = completeSetup(cur);
    const after = eventsOf(r.events, 'setupPlaced').map((e) => e.player);
    expect(after).toEqual(['red', 'black', 'red', 'black', 'black', 'black', 'black', 'black']);
    expect(r.state.phase).toBe('play');
    expect(r.state.reserve.red).toEqual(ids('red:W'));
  });

  test('turn actions are rejected during setup; setup actions after it', () => {
    expect(mustReject(s0, { type: 'endTurn', player: 'red' })).toMatch(/setup/);
    const s = completeSetup(s0).state;
    expect(mustReject(s, place('red', 'red:L8', '-1,2'))).toMatch(/only allowed during round setup/);
  });
});

export function quickSetup(s: MatchState): MatchState {
  return completeSetup(s).state;
}

describe('§5 turns and CP', () => {
  test('end turn passes to the other player with fresh CP and trackers', () => {
    let s = quickSetup(createMatch({ seed: 't', firstPlayer: 'red' }));
    s = mustApply(s, { type: 'deploy', player: 'red', cardIds: [c('red:L7')] }).state;
    expect(s.turn!.cp).toBe(3);
    const r = mustApply(s, { type: 'endTurn', player: 'red' });
    expect(types(r.events)).toEqual(['turnEnded', 'turnStarted']);
    expect(r.state.turn).toMatchObject({ player: 'black', cp: 4, number: 2, arrived: [], mountainLocked: [], charge: null });
    expect(r.state.turn!.spent.deploy).toBe(0);
  });

  test('only the current player may act; unspent CP is lost', () => {
    let s = quickSetup(createMatch({ seed: 't', firstPlayer: 'red' }));
    expect(mustReject(s, { type: 'endTurn', player: 'black' })).toMatch(/Red's turn/);
    s = mustApply(s, { type: 'endTurn', player: 'red' }).state;
    s = mustApply(s, { type: 'endTurn', player: 'black' }).state;
    expect(s.turn!.cp).toBe(4);
  });
});
