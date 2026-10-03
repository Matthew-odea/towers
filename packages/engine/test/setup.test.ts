import { describe, expect, test } from 'vitest';
import {
  HOME_EDGE,
  applyAction,
  createMatch,
  pendingDecision,
  viewFor,
  type Action,
  type MatchState,
  type PlayerId,
} from '../src/index';
import { c, eventsOf, mustApply, mustReject, types } from './helpers';

function place(player: PlayerId, refs: [string, string][]): Action {
  return { type: 'setupPlace', player, placements: refs.map(([r, hex]) => ({ cardId: c(r), hex })) };
}
const redBasic = place('red', [['red:K1', '-1,2'], ['red:K2', '-2,2']]);
const blackBasic = place('black', [['black:K1', '1,-2'], ['black:K2', '2,-2']]);

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

describe('§4 setup', () => {
  const s0 = createMatch({ seed: 'setup', firstPlayer: 'red' });

  test('both players must place; pending decision lists who has not submitted', () => {
    expect(pendingDecision(s0)).toEqual({ kind: 'setup', players: ['red', 'black'] });
    const s1 = mustApply(s0, redBasic).state;
    expect(pendingDecision(s1)).toEqual({ kind: 'setup', players: ['black'] });
  });

  test('Commanders are required', () => {
    expect(mustReject(s0, place('red', [['red:K1', '-1,2']]))).toMatch(/Commanders must be placed/);
  });

  test('at most 6 other cards', () => {
    const six: [string, string][] = ['L2', 'L3', 'L4', 'L5', 'L6', 'L7'].map((r) => [`red:${r}`, '0,2']);
    expect(applyAction(s0, place('red', [['red:K1', '-1,2'], ['red:K2', '-1,2'], ...six])).ok).toBe(true);
    expect(mustReject(s0, place('red', [['red:K1', '-1,2'], ['red:K2', '-1,2'], ...six, ['red:L8', '0,2']]))).toMatch(/At most 6/);
  });

  test('Wit cannot be placed during setup', () => {
    expect(mustReject(s0, place('red', [['red:K1', '-1,2'], ['red:K2', '-1,2'], ['red:W', '0,2']]))).toMatch(/Wit/);
  });

  test('only own home-edge hexes, own cards, no duplicates', () => {
    expect(mustReject(s0, place('red', [['red:K1', '-1,2'], ['red:K2', '0,1']]))).toMatch(/home edge/);
    expect(mustReject(s0, place('red', [['red:K1', '-1,2'], ['red:K2', '1,-2']]))).toMatch(/home edge/);
    expect(mustReject(s0, place('red', [['red:K1', '-1,2'], ['red:K2', '-1,2'], ['black:L7', '0,2']]))).toMatch(/belongs to Black/);
    expect(mustReject(s0, place('red', [['red:K1', '-1,2'], ['red:K2', '-1,2'], ['red:K2', '0,2']]))).toMatch(/more than once/);
  });

  test('a player submits once', () => {
    const s1 = mustApply(s0, redBasic).state;
    expect(mustReject(s1, redBasic)).toMatch(/already submitted/);
  });

  test('stacks allowed; reveal when both submitted; first player starts with 4 CP', () => {
    const s1 = mustApply(s0, place('red', [['red:K1', '-1,2'], ['red:K2', '-1,2'], ['red:L7', '-1,2'], ['red:A1', '0,2']])).state;
    const r = mustApply(s1, blackBasic);
    expect(types(r.events)).toEqual(['setupSubmitted', 'setupRevealed', 'turnStarted']);
    const s = r.state;
    expect(s.phase).toBe('play');
    expect(s.stacks['-1,2']).toEqual([c('red:K1'), c('red:K2'), c('red:L7')]);
    expect(s.stacks['0,2']).toEqual([c('red:A1')]);
    expect(s.reserve.red).toHaveLength(23);
    expect(s.reserve.red).toContain(c('red:W'));
    expect(s.turn).toMatchObject({ player: 'red', cp: 4, number: 1 });
    expect(pendingDecision(s)).toMatchObject({ kind: 'turn', player: 'red', cp: 4 });
  });

  test("opponent's placement is hidden in views until both have submitted", () => {
    const s1 = mustApply(s0, redBasic).state;
    const bv = viewFor(s1, 'black');
    expect(bv.setup.red).toEqual({ submitted: true, placements: null });
    const rv = viewFor(s1, 'red');
    expect(rv.setup.red.placements).toHaveLength(2);
    // setupSubmitted event carries no placement data
    const ev = mustApply(s0, redBasic).events;
    expect(ev).toEqual([{ type: 'setupSubmitted', player: 'red' }]);
  });

  test('turn actions are rejected during setup', () => {
    expect(mustReject(s0, { type: 'endTurn', player: 'red' })).toMatch(/setup/);
  });

  test('every home-edge hex is usable', () => {
    for (const h of HOME_EDGE.black) {
      expect(applyAction(s0, place('black', [['black:K1', h], ['black:K2', h]])).ok).toBe(true);
    }
  });
});

export function quickSetup(s: MatchState): MatchState {
  const red = s.reserve.red.filter((id) => s.cards[id].kind === 'commander').map((cardId) => ({ cardId, hex: HOME_EDGE.red[1] }));
  const black = s.reserve.black.filter((id) => s.cards[id].kind === 'commander').map((cardId) => ({ cardId, hex: HOME_EDGE.black[1] }));
  s = mustApply(s, { type: 'setupPlace', player: 'red', placements: red }).state;
  return mustApply(s, { type: 'setupPlace', player: 'black', placements: black }).state;
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
