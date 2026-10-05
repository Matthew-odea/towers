import { describe, expect, test } from 'vitest';
import {
  BOT_LEVELS,
  normalizeBotLevel,
  activationProbability,
  applyAction,
  buildArmy,
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

describe('roster', () => {
  test("the Singers' Archers are Venli and Rlain", () => {
    const ids = buildArmy('black').filter((c) => c.kind === 'archer').map((c) => c.id);
    expect(ids).toEqual(['black-archer-venli', 'black-archer-rlain']);
  });
});

describe('automatic end of turn at 0 CP', () => {
  test('spending the last CP ends the turn with an auto turnEnded event', () => {
    const s = buildState({ board: { '0,1': ['red:L7'] }, cp: 1 });
    const r = mustApply(s, { type: 'move', player: 'red', cardIds: [c('red:L7')], from: '0,1', path: ['0,0'] });
    const ended = r.events.find((e) => e.type === 'turnEnded');
    expect(ended).toEqual({ type: 'turnEnded', player: 'red', auto: true });
    expect(r.events.map((e) => e.type)).toContain('turnStarted');
    expect(r.state.turn!.player).toBe('black');
    expect(r.state.turn!.cp).toBe(4);
    expect(pendingDecision(r.state)).toMatchObject({ kind: 'turn', player: 'black' });
  });

  test('a turn with CP left does not end on its own', () => {
    const s = buildState({ board: { '0,1': ['red:L7'] }, cp: 2 });
    const r = mustApply(s, { type: 'move', player: 'red', cardIds: [c('red:L7')], from: '0,1', path: ['0,0'] });
    expect(r.events.some((e) => e.type === 'turnEnded')).toBe(false);
    expect(r.state.turn).toMatchObject({ player: 'red', cp: 1 });
  });

  test('an Engage with the last CP waits for the engagement to end, then ends the turn', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:L2', 'black:L3'] }, cp: 1, dice: [3, 4] });
    let r = mustApply(s, engage('red', '0,0', ['red:L7']));
    expect(r.state.turn!.player).toBe('red');
    expect(r.state.turn!.cp).toBe(0);
    expect(pendingDecision(r.state).kind).toBe('defend');
    r = mustApply(r.state, defend('black', ['black:L2']));
    // Red 7 activates, Black 2 does not: attacker wins; Black picks its casualty.
    let p = pendingDecision(r.state);
    const all = [...r.events];
    for (let i = 0; i < 10 && p.kind !== 'turn'; i++) {
      let a: Action;
      if (p.kind === 'casualties') a = { type: 'chooseCasualties', player: p.player, cardIds: p.eligible.slice(0, p.count) };
      else if (p.kind === 'retreat') a = { type: 'retreat', player: p.player, to: null };
      else if (p.kind === 'reroll') a = { type: 'passReroll', player: p.player };
      else if (p.kind === 'pressOrBreak') a = { type: 'breakOff', player: p.player };
      else throw new Error(`unexpected ${p.kind}`);
      r = mustApply(r.state, a);
      all.push(...r.events);
      p = pendingDecision(r.state);
    }
    expect(all.map((e) => e.type)).toContain('engagementEnded');
    expect(all.find((e) => e.type === 'turnEnded')).toEqual({ type: 'turnEnded', player: 'red', auto: true });
    expect(all.findIndex((e) => e.type === 'turnEnded')).toBeGreaterThan(all.findIndex((e) => e.type === 'engagementEnded'));
    expect(pendingDecision(r.state)).toMatchObject({ kind: 'turn', player: 'black', cp: 4 });
  });

  test('validateAction does not auto-end (dry run only)', () => {
    const s = buildState({ board: { '0,1': ['red:L7'] }, cp: 1 });
    expect(validateAction(s, { type: 'move', player: 'red', cardIds: [c('red:L7')], from: '0,1', path: ['0,0'] })).toBeNull();
    expect(s.turn!.player).toBe('red');
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

describe('bot levels', () => {
  test('BOT_LEVELS and the smart -> medium alias', () => {
    expect(BOT_LEVELS).toEqual(['easy', 'medium', 'hard', 'random']);
    expect(normalizeBotLevel('smart')).toBe('medium');
    expect(normalizeBotLevel('hard')).toBe('hard');
    expect(normalizeBotLevel('nope')).toBeNull();
  });

  test('every level answers every setup step and engagement decision legally', () => {
    let s = createMatch({ seed: 'levels', firstPlayer: 'black' });
    const states: MatchState[] = [];
    // Walk through the whole setup with the medium bot, collecting each step.
    while (s.phase === 'setup') {
      states.push(s);
      const p = pendingDecision(s).players[0]!;
      s = mustApply(s, chooseBotAction(viewFor(s, p), p)!).state;
    }
    const b = buildState({ board: { '0,1': ['red:K1', 'red:L8'], '0,0': ['black:K1', 'black:L2', 'black:W'] }, dice: [2, 5, 1, 2, 3, 4] });
    states.push(s, b, mustApply(b, engage('red', '0,0', ['red:K1', 'red:L8'])).state);
    for (const level of [...BOT_LEVELS, 'smart'] as const) {
      for (const st of states) {
        for (const p of pendingDecision(st).players) {
          const a = chooseBotAction(viewFor(st, p), p, { level });
          expect(a, `${level} at ${pendingDecision(st).kind}`).not.toBeNull();
          expect(validateAction(st, a!)).toBeNull();
        }
      }
    }
  });

  test('medium setup: Commanders and two Heavy escorts fill the Tower; one strike group on the flank away from a massed enemy', () => {
    let s = createMatch({ seed: 'medium-setup', firstPlayer: 'black' });
    // Black masses Shardbearers and Cavalry on its 0,-2 corner (a full stack), Archers on 2,-2.
    const blackPlan = ['black:S1', 'black:S2', 'black:V1', 'black:V2', 'black:A1', 'black:A2'].map(c);
    while (s.phase === 'setup') {
      const d = pendingDecision(s);
      if (d.kind !== 'setup') break;
      let a: Action;
      if (d.player === 'black' && d.step === 'troop') {
        const hex = blackPlan.length > 2 ? '0,-2' : '2,-2';
        a = { type: 'setupPlace', player: 'black', placements: [{ cardId: blackPlan.shift()!, hex }] };
      } else a = chooseBotAction(viewFor(s, d.player), d.player)!;
      s = mustApply(s, a).state;
    }
    const red = s.setup.red.placements;
    expect(red.filter((x) => s.cards[x.cardId].kind === 'commander').every((x) => x.hex === '-1,2')).toBe(true);
    const troops = red.filter((x) => s.cards[x.cardId].kind !== 'commander');
    expect(troops).toHaveLength(6);
    const escorts = troops.filter((x) => x.hex === '-1,2');
    expect(escorts).toHaveLength(2);
    expect(escorts.every((x) => s.cards[x.cardId].kind === 'heavy')).toBe(true);
    const strikeHexes = new Set(troops.filter((x) => x.hex !== '-1,2').map((x) => x.hex));
    // Black massed on its left flank (0,-2), so Red strikes down the other flank (0,2).
    expect([...strikeHexes]).toEqual(['0,2']);
  });

  test('medium deploys exactly one card', () => {
    const s = buildState({ board: { '0,0': ['red:K1', 'red:K2'], '1,-1': ['black:K1', 'black:K2'] } });
    for (const level of BOT_LEVELS) {
      const a = chooseBotAction(s, 'red', { level, rand: () => 0.5 });
      if (a?.type === 'deploy') expect(a.cardIds).toHaveLength(1);
    }
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
