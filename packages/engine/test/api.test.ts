import { describe, expect, test } from 'vitest';
import {
  activationProbability,
  applyAction,
  chooseBotAction,
  createMatch,
  currentEngagementOdds,
  eligibleAttackers,
  eligibleDefenders,
  engageableTargets,
  engagementOdds,
  labelModifiers,
  pendingDecision,
  previewModifiers,
  retreatHexes,
  testing,
  validateAction,
  viewFor,
  waysToRoll,
  type Action,
  type MatchState,
} from '../src/index';
import { simulate } from '../scripts/sim';
import { buildState, c, defend, engage, forceDice, mustApply, run } from './helpers';

describe('applyAction contract', () => {
  test('never mutates its input', () => {
    const s = buildState({ board: { '0,1': ['red:L7', 'red:K1'], '0,0': ['black:L2', 'black:L3'] }, dice: [2, 5, 3] });
    const before = JSON.stringify(s);
    const r = applyAction(s, engage('red', '0,0', ['red:L7', 'red:K1']));
    expect(r.ok).toBe(true);
    expect(JSON.stringify(s)).toBe(before);
    const s2 = (r as { state: MatchState }).state;
    const before2 = JSON.stringify(s2);
    applyAction(s2, defend('black', ['black:L2']));
    expect(JSON.stringify(s2)).toBe(before2);
  });

  test('never throws on garbage input', () => {
    const s = buildState({ board: { '0,1': ['red:L7'] } });
    const junk: unknown[] = [
      null,
      undefined,
      42,
      'move',
      {},
      { type: 'nope', player: 'red' },
      { type: 'move', player: 'green' },
      { type: 'move', player: 'red' },
      { type: 'move', player: 'red', cardIds: 'x', from: '0,1', path: ['0,0'] },
      { type: 'move', player: 'red', cardIds: [1], from: '0,1', path: ['0,0'] },
      { type: 'move', player: 'red', cardIds: [c('red:L7')], from: '0,1', path: 'x' },
      { type: 'move', player: 'red', cardIds: [c('red:L7')], from: '0,1', path: [5] },
      { type: 'move', player: 'red', cardIds: [c('red:L7')], from: null, path: ['0,0'] },
      { type: 'move', player: 'red', cardIds: ['__proto__'], from: '0,1', path: ['0,0'] },
      { type: 'move', player: 'red', cardIds: ['constructor'], from: '0,1', path: ['0,0'] },
      { type: 'withdraw', player: 'red', cardIds: [c('red:L7')], from: '0,1', to: {} },
      { type: 'engage', player: 'red', target: ['0,0'], cardIds: [c('red:L7')] },
      { type: 'engage', player: 'red', target: '0,0', cardIds: null },
      { type: 'setupPlace', player: 'red', placements: [null] },
      { type: 'reroll', player: 'red', source: 'commander', die: 0 },
      { type: 'chooseCasualties', player: 'red', cardIds: [] },
      { type: 'retreat', player: 'red', to: '0,0' },
      { type: 'fortify', player: 'red', hex: 7 },
      { type: 'reinforce', player: 'red', cardId: {}, hex: '0,1' },
      { type: 'deploy', player: 'red', cardIds: [c('red:L7'), c('red:L7')] },
      { type: 'spawnWit', player: 'red', hex: '9,9' },
    ];
    for (const a of junk) {
      const r = applyAction(s, a as Action);
      expect(r.ok).toBe(false);
      expect(typeof (r as { error: string }).error).toBe('string');
    }
    expect(applyAction(null as unknown as MatchState, { type: 'endTurn', player: 'red' }).ok).toBe(false);
  });

  test('state and events are JSON-serialisable; seq increments', () => {
    const s = createMatch({ seed: 'json' });
    const r = applyAction(s, { type: 'concede', player: 'red' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.parse(JSON.stringify(r.state))).toEqual(r.state);
    expect(JSON.parse(JSON.stringify(r.events))).toEqual(r.events);
    expect(r.state.seq).toBe(1);
  });

  test('deterministic for a given seed and action sequence', () => {
    const a = simulate('det', 400, false);
    const b = simulate('det', 400, false);
    expect(a).toEqual(b);
  });

  test('validateAction mirrors applyAction', () => {
    const s = buildState({ board: { '0,1': ['red:L7'] } });
    expect(validateAction(s, { type: 'move', player: 'red', cardIds: [c('red:L7')], from: '0,1', path: ['0,0'] })).toBeNull();
    expect(validateAction(s, { type: 'move', player: 'black', cardIds: [c('red:L7')], from: '0,1', path: ['0,0'] })).toMatch(/turn/);
  });
});

describe('viewFor', () => {
  test('strips RNG, seed and forced dice', () => {
    const s = forceDice(createMatch({ seed: 'secret' }), 1, 2);
    const v = viewFor(s, 'red') as unknown as Record<string, unknown>;
    expect(v.rng).toBeUndefined();
    expect(v.seed).toBeUndefined();
    expect(v.diceQueue).toBeUndefined();
    expect(v.viewer).toBe('red');
    expect(JSON.stringify(v)).not.toContain('secret');
  });

  test('query helpers and pendingDecision work on a view', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:L2', 'black:L3'] }, dice: [1, 3] });
    const v = viewFor(s, 'red');
    expect(pendingDecision(v)).toMatchObject({ kind: 'turn', player: 'red' });
    expect(engageableTargets(v, 'red')).toEqual(['0,0']);
    expect(validateAction(v, engage('red', '0,0', ['red:L7']))).toBeNull();
    expect(chooseBotAction(v, 'red')).not.toBeNull();
    expect(chooseBotAction(v, 'black')).toBeNull();
  });
});

describe('pendingDecision', () => {
  test('turn decision exposes CP and per-type cap remaining', () => {
    const s = buildState({ cp: 3, spent: { move: 1 } });
    expect(pendingDecision(s)).toEqual({
      kind: 'turn',
      players: ['red'],
      player: 'red',
      cp: 3,
      capRemaining: { move: 2, engage: 3, deploy: 3, withdraw: 3, fortify: 3, reinforce: 3, spawnWit: 3 },
    });
  });

  test('random bot games always leave someone able to act until the match ends', () => {
    for (let i = 0; i < 8; i++) {
      const r = simulate(`api-${i}`, 300, true);
      expect(r.errors).toEqual([]);
      expect(r.winner).not.toBeNull();
    }
  });
});

describe('chooseBotAction (random)', () => {
  test('returns a legal action for every kind of decision', () => {
    const states: MatchState[] = [];
    states.push(createMatch({ seed: 'b1' }));
    const s = buildState({ board: { '0,1': ['red:K1', 'red:L8'], '0,0': ['black:K1', 'black:L2', 'black:W'] }, dice: [2, 5, 1, 2, 3, 4] });
    const e1 = mustApply(s, engage('red', '0,0', ['red:K1', 'red:L8'])).state;
    states.push(s, e1);
    for (const st of states) {
      for (const p of pendingDecision(st).players) {
        for (let k = 0; k < 20; k++) {
          const a = chooseBotAction(st, p, { rand: Math.random });
          expect(a).not.toBeNull();
          expect(validateAction(st, a!)).toBeNull();
        }
      }
    }
  });

  test('returns null when the player has nothing to decide', () => {
    expect(chooseBotAction(buildState(), 'black')).toBeNull();
  });
});

describe('query helpers', () => {
  test('eligibleAttackers includes adjacent cards and ranged Archers with LOS', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,2': ['red:A1', 'red:L2'], '0,0': ['black:L2'] } });
    expect(eligibleAttackers(s, 'red', '0,0')).toEqual([
      { cardId: c('red:L7'), hex: '0,1', ranged: false },
      { cardId: c('red:A1'), hex: '0,2', ranged: true },
    ]);
    expect(eligibleAttackers(s, 'red', '0,1')).toEqual([]);
  });

  test('eligibleDefenders reports the cap', () => {
    const s = buildState({ board: { '0,0': ['black:L2', 'black:L3', 'black:L4', 'black:L5', 'black:L6'] }, fortified: ['0,0'] });
    expect(eligibleDefenders(s, '0,0').max).toBe(4);
  });

  test('labelModifiers gives readable labels', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:L2'] }, fortified: ['0,0'] });
    const m = labelModifiers(previewModifiers(s, { player: 'red', target: '0,0', attackerCardIds: [c('red:L7')] }));
    expect(m.defender.advantage).toEqual([{ source: 'fortified', label: 'Fortified' }]);
  });

  test('activationProbability enumerates the 36 outcomes exactly', () => {
    const s = buildState();
    expect(activationProbability(s, [c('red:L7')])).toBeCloseTo(6 / 36);
    expect(activationProbability(s, [c('red:L2')])).toBeCloseTo(1 / 36);
    expect(activationProbability(s, [c('red:A1')])).toBeCloseTo(11 / 36);
    expect(activationProbability(s, [c('red:V1')])).toBeCloseTo(11 / 36);
    expect(activationProbability(s, [c('red:S1')])).toBeCloseTo(12 / 36);
    expect(activationProbability(s, [c('red:K1')])).toBe(0);
    expect(activationProbability(s, [c('red:W')], { witNumber: 8 })).toBeCloseTo(5 / 36);
    expect(activationProbability(s, [c('red:L7')], { advantage: true })).toBeCloseTo(9 / 36);
    expect(activationProbability(s, [c('red:L6'), c('red:L7'), c('red:L8')])).toBeCloseTo(16 / 36);
    for (let t = 2; t <= 12; t++) expect(activationProbability(s, [c(`red:L${Math.min(10, Math.max(2, t))}`)])).toBeCloseTo(waysToRoll(Math.min(10, Math.max(2, t))) / 36);
  });

  test('engagementOdds sums to 1 and reflects Advantage', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:L7'] }, fortified: ['0,0'] });
    const o = engagementOdds(s, { player: 'red', target: '0,0', attackerCardIds: [c('red:L7')], defenderCardIds: [c('black:L7')] });
    expect(o.attackerWins + o.defenderWins + o.bloodbath + o.stale).toBeCloseTo(1);
    expect(o.bloodbath).toBe(0);
    expect(o.attackerWins).toBe(0); // any 7 also activates the fortified defender, who has Advantage
    expect(o.defenderWins).toBeCloseTo(9 / 36);
  });

  test('currentEngagementOdds and retreatHexes for the live engagement', () => {
    let s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:L2', 'black:L3'] }, dice: [1, 3] });
    s = run(s, engage('red', '0,0', ['red:L7']), defend('black', ['black:L2'])).state;
    expect(currentEngagementOdds(s)).not.toBeNull();
    expect(retreatHexes(s).sort()).toEqual(['1,-1', '0,-1', '-1,0'].sort());
  });
});

describe('testing helpers', () => {
  test('card refs', () => {
    expect(testing.card('red:L7')).toBe('red-light-7');
    expect(testing.card('black:heavy10')).toBe('black-heavy-10');
    expect(testing.card('red:A2')).toBe('red-archer-shallan');
    expect(testing.card('black:V1')).toBe('black-cavalry-leshwi');
    expect(testing.card('red:K1')).toBe('red-commander-dalinar');
    expect(testing.card('black:S2')).toBe('black-shardbearer-moash');
    expect(testing.card('red:W')).toBe('red-wit-hoid');
    expect(testing.card('black:venli')).toBe('black-archer-venli');
    expect(testing.card('red-light-3')).toBe('red-light-3');
    expect(() => testing.card('red:L11')).toThrow();
  });

  test('buildState rejects inconsistent specs', () => {
    expect(() => buildState({ board: { '0,0': ['red:L2', 'black:L2'] } })).toThrow(/mixes/);
    expect(() => buildState({ board: { '0,0': ['red:L2'], '1,0': ['red:L2'] } })).toThrow(/twice/);
    expect(() => buildState({ board: { '9,9': ['red:L2'] } })).toThrow(/bad hex/);
  });

  test('forced dice are consumed before the RNG', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:L2'] } });
    const r = mustApply(forceDice(s, 6, 6), engage('red', '0,0', ['red:L7']));
    expect(r.state.engagement!.dice).toEqual([6, 6]);
  });
});
