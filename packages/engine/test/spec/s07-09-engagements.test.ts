import { describe, it, expect } from 'vitest';
import { pendingDecision } from '../../src/index';
import { buildState, mustApply, mustReject, c, cs, seq, fight, settle, eventsOf, pend, started, resolvedEv, last } from './h';

const eng = (target: string, atk: string[], extra: any = {}) => ({ type: 'engage' as const, player: 'red' as const, target, cardIds: cs(...atk), ...extra });
const mods = (r: { events: any[] }) => started(r.events).modifiers as { attacker: any; defender: any };
const advA = (r: any) => mods(r).attacker.advantage as string[];
const advD = (r: any) => mods(r).defender.advantage as string[];
const disA = (r: any) => mods(r).attacker.disadvantage as string[];
const disD = (r: any) => mods(r).defender.disadvantage as string[];

describe('§7.1 Declaring an engagement', () => {
  const board = () => buildState({ board: { '0,1': ['red:L5', 'red:H6', 'red:L7', 'red:L8'], '0,0': ['black:L10', 'black:L9', 'black:H8', 'black:H7'], '0,-1': ['black:A1'] }, dice: [1, 2] });

  it('attacker commits 1 to 3 cards: 0 and 4 are rejected, 1 and 3 accepted', () => {
    mustReject(board(), eng('0,0', []));
    mustReject(board(), eng('0,0', ['red:L5', 'red:H6', 'red:L7', 'red:L8']));
    mustApply(board(), eng('0,0', ['red:L5']));
    mustApply(board(), eng('0,0', ['red:L5', 'red:H6', 'red:L7']));
  });

  it('the target must contain enemy cards', () => {
    mustReject(board(), eng('1,1', ['red:L5']));
    mustReject(board(), eng('0,1', ['red:L5']));
  });

  it('only adjacent cards (and ranged Archers) may be committed', () => {
    const s = buildState({ board: { '0,2': ['red:L5', 'red:V1'], '0,1': ['red:H6'], '0,0': ['black:L10'] } });
    mustReject(s, eng('0,0', ['red:L5']));
    mustReject(s, eng('0,0', ['red:V1']));
    mustReject(s, eng('0,0', ['red:H6', 'red:L5']));
    mustApply(s, eng('0,0', ['red:H6']));
  });

  it('committed cards may come from several adjacent hexes', () => {
    const s = buildState({ board: { '0,1': ['red:L5'], '1,0': ['red:H6'], '-1,0': ['red:L7'], '0,0': ['black:L10', 'black:L9'] } });
    const r = fight(s, { target: '0,0', atk: ['red:L5', 'red:H6', 'red:L7'] });
    expect(started(r.events).attackerCards.sort()).toEqual(cs('red:L5', 'red:H6', 'red:L7').sort());
  });

  it('cannot commit the opponent cards, and cannot engage from out of range with Archers at distance 3', () => {
    mustReject(board(), eng('0,0', ['black:A1']));
    const s = buildState({ board: { '0,2': ['red:A1'], '0,-1': ['black:L10'] } });
    mustReject(s, eng('0,-1', ['red:A1']));
  });

  it('declaring Wit requires a number from 2 to 12', () => {
    const s = buildState({ board: { '0,1': ['red:W', 'red:L5'], '0,0': ['black:L10'] } });
    mustReject(s, eng('0,0', ['red:W']));
    mustReject(s, eng('0,0', ['red:W'], { witNumber: 1 }));
    mustReject(s, eng('0,0', ['red:W'], { witNumber: 13 }));
    mustApply(s, eng('0,0', ['red:W'], { witNumber: 2 }));
    mustApply(s, eng('0,0', ['red:W', 'red:L5'], { witNumber: 12 }));
  });

  it('the defender is asked after the attacker commits; 1 to 3 cards (4 if Fortified), at least 1', () => {
    const r = seq(board(), eng('0,0', ['red:L5']));
    const p = pend(r.state);
    expect(p).toMatchObject({ kind: 'defend', player: 'black', target: '0,0', min: 1, max: 3 });
    mustReject(r.state, { type: 'defend', player: 'black', cardIds: [] });
    mustReject(r.state, { type: 'defend', player: 'black', cardIds: cs('black:L10', 'black:L9', 'black:H8', 'black:H7') });
    mustApply(r.state, { type: 'defend', player: 'black', cardIds: cs('black:L10', 'black:L9', 'black:H8') });
    mustApply(r.state, { type: 'defend', player: 'black', cardIds: cs('black:L10') });
  });

  it('a Fortified defender may commit up to 4 cards (and not 5)', () => {
    const s = buildState({ board: { '0,1': ['red:L5'], '0,0': ['black:L10', 'black:L9', 'black:H8', 'black:H7', 'black:L6'] }, fortified: ['0,0'], dice: [1, 2] });
    const r = seq(s, eng('0,0', ['red:L5']));
    expect(pend(r.state).max).toBe(4);
    mustReject(r.state, { type: 'defend', player: 'black', cardIds: cs('black:L10', 'black:L9', 'black:H8', 'black:H7', 'black:L6') });
    mustApply(r.state, { type: 'defend', player: 'black', cardIds: cs('black:L10', 'black:L9', 'black:H8', 'black:H7') });
  });

  it('only cards in the attacked hex can defend; Archers elsewhere cannot support', () => {
    const r = seq(board(), eng('0,0', ['red:L5']));
    mustReject(r.state, { type: 'defend', player: 'black', cardIds: cs('black:A1') });
    mustReject(r.state, { type: 'defend', player: 'black', cardIds: cs('black:L10', 'black:A1') });
  });

  it('the defender sees the attacker Wit number before committing and declares its own', () => {
    const s = buildState({ board: { '0,1': ['red:W'], '0,0': ['black:W', 'black:L9'] }, dice: [3, 4] });
    const r = seq(s, eng('0,0', ['red:W'], { witNumber: 7 }));
    expect(r.state.engagement!.attackerWit).toBe(7);
    expect(pend(r.state).witEligible).toBe(true);
    mustReject(r.state, { type: 'defend', player: 'black', cardIds: cs('black:W') });
    const q = seq(r, { type: 'defend', player: 'black', cardIds: cs('black:W'), witNumber: 9 });
    expect(q.state.engagement!.defenderWit).toBe(9);
  });

  it('both sides read the same dice', () => {
    const s = buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:H7'] }, dice: [3, 4] });
    const r = fight(s, { target: '0,0', atk: ['red:L7'] });
    expect(eventsOf(r.events, 'diceRolled')[0].dice).toEqual([3, 4]);
    expect(resolvedEv(r.events)[0].dice).toEqual([3, 4]);
    expect(resolvedEv(r.events)[0].counts).toEqual({ attacker: 1, defender: 1 });
  });

  it('the same cards can fight again after paying again', () => {
    const s = buildState({ board: { '0,1': ['red:L5'], '0,0': ['black:L10'] }, dice: [1, 2, 1, 2] });
    let r = settle(fight(s, { target: '0,0', atk: ['red:L5'] }));
    r = settle(fight(r.state, { target: '0,0', atk: ['red:L5'] }));
    expect(r.state.turn!.cp).toBe(2);
  });
});

describe('§7.2/§7.3 Ranged Archers and line of sight', () => {
  const shot = (terrain: Record<string, any> = {}, board: Record<string, string[]> = {}) =>
    buildState({ board: { '0,2': ['red:A1'], '0,0': ['black:L10'], ...board }, terrain });
  const ok = (s: any) => { const r = mustApply(s, eng('0,0', ['red:A1'])); return r; };

  it('an Archer at distance exactly 2 with clear line of sight may be committed and is ranged', () => {
    const r = ok(shot());
    expect(eventsOf(r.events, 'engageDeclared')[0].rangedArchers).toEqual(cs('red:A1'));
  });

  it('an adjacent Archer is an ordinary (non-ranged) attacker', () => {
    const s = buildState({ board: { '0,1': ['red:A1'], '0,0': ['black:L10'] } });
    expect(eventsOf(mustApply(s, eng('0,0', ['red:A1'])).events, 'engageDeclared')[0].rangedArchers).toEqual([]);
  });

  it('straight shot (one in-between hex): Forest blocks', () => {
    mustReject(shot({ '0,1': 'forest' }), eng('0,0', ['red:A1']));
  });
  it('straight shot: Mountain, Tower and units never block', () => {
    ok(shot({ '0,1': 'mountain' }));
    ok(shot({ '0,1': 'tower' }));
    ok(shot({}, { '0,1': ['red:L5'] }));
    ok(shot({}, { '0,1': ['black:L5'] }));
  });
  it('the Archer and target own terrain never block', () => {
    ok(shot({ '0,2': 'forest', '0,0': 'forest' }));
  });

  describe('off-axis shot (two in-between hexes)', () => {
    const off = (terrain: any) => buildState({ board: { '1,1': ['red:A1'], '0,0': ['black:L10'] }, terrain });
    it('one Forest does not block', () => {
      mustApply(off({ '1,0': 'forest' }), eng('0,0', ['red:A1']));
      mustApply(off({ '0,1': 'forest' }), eng('0,0', ['red:A1']));
    });
    it('both Forests block', () => {
      mustReject(off({ '1,0': 'forest', '0,1': 'forest' }), eng('0,0', ['red:A1']));
    });
    it('Forest plus Mountain does not block', () => {
      mustApply(off({ '1,0': 'forest', '0,1': 'mountain' }), eng('0,0', ['red:A1']));
    });
  });

  it('a non-Archer at distance 2 cannot attack', () => {
    mustReject(buildState({ board: { '0,2': ['red:L5', 'red:S1', 'red:V1'], '0,0': ['black:L10'] } }), eng('0,0', ['red:L5']));
    mustReject(buildState({ board: { '0,2': ['red:S1'], '0,0': ['black:L10'] } }), eng('0,0', ['red:S1']));
  });

  it('ranged Archers do not make the attack adjacent (no Archer-defending Disadvantage) and do not flank', () => {
    const s = buildState({ board: { '0,2': ['red:A1'], '0,0': ['black:A2', 'black:L9'] }, dice: [3, 4] });
    const r = fight(s, { target: '0,0', atk: ['red:A1'], def: ['black:A2', 'black:L9'] });
    expect(disD(r)).toEqual([]);
    expect(advA(r)).not.toContain('flanking');
  });

  it('Ranged Archer is immune when the attacker loses and the defender had no activating Archer', () => {
    const s = buildState({ board: { '0,2': ['red:A1'], '0,1': ['red:L5'], '0,0': ['black:L8'] }, dice: [3, 5] });
    const r = settle(fight(s, { target: '0,0', atk: ['red:A1', 'red:L5'] }));
    expect(resolvedEv(r.events)[0].outcome).toBe('defender');
    expect(r.state.stacks['0,2']).toEqual(cs('red:A1'));
    expect(r.state.destroyed.red).toEqual(cs('red:L5'));
  });

  it('ranged Archer alone loses: the engagement ends with no casualty', () => {
    const s = buildState({ board: { '0,2': ['red:A1'], '0,0': ['black:L8'] }, dice: [3, 5] });
    const r = settle(fight(s, { target: '0,0', atk: ['red:A1'] }));
    expect(eventsOf(r.events, 'casualties')).toHaveLength(0);
    expect(r.state.stacks['0,2']).toEqual(cs('red:A1'));
    expect(r.state.engagement).toBeNull();
  });

  it('a defending Archer that was committed but did not activate does not remove immunity', () => {
    const s = buildState({ board: { '0,2': ['red:A1'], '0,0': ['black:A2', 'black:L8'] }, dice: [3, 5] });
    const r = settle(fight(s, { target: '0,0', atk: ['red:A1'], def: ['black:A2', 'black:L8'] }));
    expect(resolvedEv(r.events)[0].outcome).toBe('defender');
    expect(r.state.stacks['0,2']).toEqual(cs('red:A1'));
  });

  it('in a Bloodbath the immune ranged Archer takes no casualty while the defender still takes theirs', () => {
    const s = buildState({ board: { '0,2': ['red:A1'], '0,0': ['black:L7'] }, dice: [1, 6] });
    const r = settle(fight(s, { target: '0,0', atk: ['red:A1'] }));
    expect(resolvedEv(r.events)[0].outcome).toBe('bloodbath');
    expect(r.state.destroyed.black).toEqual(cs('black:L7'));
    expect(r.state.destroyed.red).toEqual([]);
  });

  it('the ranged Archer loses immunity when a defending Archer activated (Bloodbath)', () => {
    const s = buildState({ board: { '0,2': ['red:A1'], '0,0': ['black:A2', 'black:L9'] }, dice: [1, 6] });
    const r = settle(fight(s, { target: '0,0', atk: ['red:A1'], def: ['black:A2', 'black:L9'] }), { pick: (p) => (p.owner === 'black' ? cs('black:L9') : undefined) });
    expect(resolvedEv(r.events)[0].outcome).toBe('bloodbath');
    expect(r.state.destroyed.red).toEqual(cs('red:A1'));
    expect(r.state.destroyed.black).toEqual(cs('black:L9'));
  });

  it('ranged Archer is a possible casualty on a loss when a defending Archer activated', () => {
    const s = buildState({
      board: { '0,2': ['red:A1'], '0,1': ['red:L5'], '0,0': ['black:A2', 'black:L9'] }, fortified: ['0,0'], dice: [1, 5],
    });
    let r = fight(s, { target: '0,0', atk: ['red:A1', 'red:L5'], def: ['black:A2', 'black:L9'] });
    r = seq(r, { type: 'passReroll', player: 'red' }); // red could force a Disadvantage reroll; declines
    const p = pend(r.state);
    expect(resolvedEv(r.events)[0].outcome).toBe('defender');
    expect(p.kind).toBe('casualties');
    expect(p.owner).toBe('red');
    expect(p.eligible.sort()).toEqual(cs('red:A1', 'red:L5').sort());
  });
});

describe('§9 Advantage and Disadvantage sources', () => {
  const T = '0,0';
  const target = (extra: any = {}) => ({ '0,0': ['black:L10', 'black:L9'], ...extra });

  it('Fortified target gives the defender Advantage', () => {
    const s = buildState({ board: { '0,1': ['red:L5'], ...target() }, fortified: [T], dice: [1, 2] });
    const r = fight(s, { target: T, atk: ['red:L5'] });
    expect(advD(r)).toContain('fortified');
    expect(advA(r)).toEqual([]);
  });

  it('Archer high ground: committed attacking Archer on a Mountain, target not a Mountain, gives the attacker Advantage', () => {
    const s = buildState({ board: { '0,1': ['red:A1'], ...target() }, terrain: { '0,1': 'mountain' }, dice: [3, 4] });
    expect(advA(fight(s, { target: T, atk: ['red:A1'] }))).toContain('archerHighGround');
    // a ranged Archer on a Mountain counts as well
    const s2 = buildState({ board: { '0,2': ['red:A1'], ...target() }, terrain: { '0,2': 'mountain' }, dice: [3, 4] });
    expect(advA(fight(s2, { target: T, atk: ['red:A1'] }))).toContain('archerHighGround');
  });

  it('no high ground if the Archer is not on a Mountain or the target is a Mountain', () => {
    const s = buildState({ board: { '0,1': ['red:A1'], ...target() }, dice: [3, 4] });
    expect(advA(fight(s, { target: T, atk: ['red:A1'] }))).toEqual([]);
    const s2 = buildState({ board: { '0,1': ['red:A1'], ...target() }, terrain: { '0,1': 'mountain', '0,0': 'mountain' }, dice: [3, 4] });
    expect(advA(fight(s2, { target: T, atk: ['red:A1'] }))).not.toContain('archerHighGround');
  });

  it('Mountain target always gives the defender Advantage, even if attackers stand on Mountains', () => {
    const s = buildState({ board: { '0,1': ['red:L5'], ...target() }, terrain: { '0,0': 'mountain' }, dice: [3, 4] });
    expect(advD(fight(s, { target: T, atk: ['red:L5'] }))).toContain('mountainDefence');
    const s2 = buildState({ board: { '0,1': ['red:L5'], ...target() }, terrain: { '0,0': 'mountain', '0,1': 'mountain' }, dice: [3, 4] });
    const r = fight(s2, { target: T, atk: ['red:L5'] });
    expect(advD(r)).toContain('mountainDefence');
    expect(advA(r)).toEqual([]);
  });

  describe('Flanking and Surrounded geometry', () => {
    const run = (hexes: string[], extra: Record<string, string[]> = {}, commitAll = true) => {
      const board: Record<string, string[]> = { '0,0': ['black:L10', 'black:L9'], ...extra };
      const atk: string[] = [];
      hexes.forEach((h, i) => { const ref = `red:L${i + 2}`; board[h] = [...(board[h] ?? []), ref]; atk.push(ref); });
      const s = buildState({ board, dice: [3, 4] });
      return fight(s, { target: T, atk: commitAll ? atk : atk.slice(0, 2) });
    };
    it('one hex: neither', () => {
      const r = run(['0,1']);
      expect(advA(r)).not.toContain('flanking');
      expect(disD(r)).not.toContain('surrounded');
    });
    it('two hexes adjacent to each other: neither', () => {
      const r = run(['1,0', '1,-1']);
      expect(advA(r)).not.toContain('flanking');
      expect(disD(r)).not.toContain('surrounded');
    });
    it('two hexes not adjacent to each other: Flanking only', () => {
      const r = run(['1,0', '0,-1']);
      expect(advA(r)).toContain('flanking');
      expect(disD(r)).not.toContain('surrounded');
    });
    it('opposite hexes also flank', () => {
      expect(advA(run(['0,1', '0,-1']))).toContain('flanking');
    });
    it('three hexes: Surrounded (and so Flanking)', () => {
      const r = run(['1,0', '0,-1', '-1,1']);
      expect(disD(r)).toContain('surrounded');
      expect(advA(r)).toContain('flanking');
    });
    it('three consecutive hexes still count as Surrounded', () => {
      const r = run(['1,0', '1,-1', '0,-1']);
      expect(disD(r)).toContain('surrounded');
      expect(advA(r)).toContain('flanking');
    });
    it('uncommitted cards do not count', () => {
      const r = run(['1,0', '1,-1', '0,-1'], {}, false); // commits only the first two (adjacent hexes)
      expect(advA(r)).not.toContain('flanking');
      expect(disD(r)).not.toContain('surrounded');
    });
    it('ranged Archers do not count toward Flanking', () => {
      const s = buildState({ board: { '0,1': ['red:L5'], '0,2': ['red:A1'], '0,0': ['black:L10', 'black:L9'] }, dice: [3, 4] });
      expect(advA(fight(s, { target: T, atk: ['red:L5', 'red:A1'] }))).not.toContain('flanking');
    });
    it('ranged Archers do not count toward Surrounded', () => {
      const s = buildState({ board: { '1,0': ['red:L5'], '0,-1': ['red:L6'], '0,2': ['red:A1'], '0,0': ['black:L10', 'black:L9'] }, dice: [3, 4] });
      const r = fight(s, { target: T, atk: ['red:L5', 'red:L6', 'red:A1'] });
      expect(advA(r)).toContain('flanking');
      expect(disD(r)).not.toContain('surrounded');
    });
    it('adjacent Archers do count', () => {
      const s = buildState({ board: { '1,0': ['red:L5'], '0,-1': ['red:A1'], '-1,1': ['red:A2'], '0,0': ['black:L10', 'black:L9'] }, dice: [3, 4] });
      const r = fight(s, { target: T, atk: ['red:L5', 'red:A1', 'red:A2'] });
      expect(disD(r)).toContain('surrounded');
    });
  });

  describe('Cavalry on Mountains', () => {
    it('attacker Cavalry standing on a Mountain gives the attacker Disadvantage', () => {
      const s = buildState({ board: { '0,1': ['red:V1'], ...target() }, terrain: { '0,1': 'mountain' }, dice: [3, 4] });
      expect(disA(fight(s, { target: T, atk: ['red:V1'] }))).toContain('cavalryMountain');
    });
    it('attacker Cavalry attacking into a Mountain target is Disadvantaged', () => {
      const s = buildState({ board: { '0,1': ['red:V1'], ...target() }, terrain: { '0,0': 'mountain' }, dice: [3, 4] });
      expect(disA(fight(s, { target: T, atk: ['red:V1'] }))).toContain('cavalryMountain');
    });
    it('defending Cavalry on a Mountain target is Disadvantaged', () => {
      const s = buildState({ board: { '0,1': ['red:L5'], '0,0': ['black:V1', 'black:L9'] }, terrain: { '0,0': 'mountain' }, dice: [3, 4] });
      expect(disD(fight(s, { target: T, atk: ['red:L5'] , def: ['black:V1'] }))).toContain('cavalryMountain');
    });
    it('Cavalry on plains has no Disadvantage; non-Cavalry on a Mountain has none', () => {
      const s = buildState({ board: { '0,1': ['red:V1'], ...target() }, dice: [3, 4] });
      expect(disA(fight(s, { target: T, atk: ['red:V1'] }))).toEqual([]);
      const s2 = buildState({ board: { '0,1': ['red:L5'], ...target() }, terrain: { '0,1': 'mountain' }, dice: [3, 4] });
      expect(disA(fight(s2, { target: T, atk: ['red:L5'] }))).toEqual([]);
    });
  });

  describe('defending Archers', () => {
    it('defender committed an Archer and the attacker has an adjacent committed card: defender Disadvantaged', () => {
      const s = buildState({ board: { '0,1': ['red:L5'], '0,0': ['black:A1', 'black:L9'] }, dice: [3, 4] });
      expect(disD(fight(s, { target: T, atk: ['red:L5'], def: ['black:A1', 'black:L9'] }))).toContain('archerDefending');
    });
    it('not if the defender did not commit the Archer', () => {
      const s = buildState({ board: { '0,1': ['red:L5'], '0,0': ['black:A1', 'black:L9'] }, dice: [3, 4] });
      expect(disD(fight(s, { target: T, atk: ['red:L5'], def: ['black:L9'] }))).toEqual([]);
    });
  });

  it('Advantage and Disadvantage do not stack: several sources still give one extra 11/12 activation', () => {
    const s = buildState({ board: { '0,1': ['red:L5'], '0,0': ['black:S1', 'black:L4'] }, terrain: { '0,0': 'mountain' }, fortified: ['0,0'], dice: [6, 6] });
    const r = fight(s, { target: T, atk: ['red:L5'], def: ['black:S1', 'black:L4'] });
    expect(advD(r)).toEqual(expect.arrayContaining(['fortified', 'mountainDefence']));
    expect(resolvedEv(r.events)[0].counts.defender).toBe(2); // shardbearer (doubles) + one bonus
  });

  it('the third stale roll gives the defender Advantage', () => {
    const s = buildState({ board: { '0,1': ['red:L5'], ...target() }, dice: [1, 2, 1, 2, 1, 2] });
    let r = fight(s, { target: T, atk: ['red:L5'], def: ['black:L10'] });
    r = seq(r, { type: 'press', player: 'red' });
    expect(eventsOf(r.events, 'advantageGained')).toHaveLength(0);
    r = seq(r, { type: 'press', player: 'red' });
    const g = eventsOf(r.events, 'advantageGained');
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ player: 'black', side: 'defender', source: 'stale' });
    expect(pend(r.state).staleCount).toBe(3);
  });
});

describe('§7.4/§7.5 Activation and outcome', () => {
  const duel = (a: string[], d: string[], dice: number[], o: any = {}) =>
    buildState({ board: { '0,1': a, '0,0': d, ...(o.board ?? {}) }, dice, fortified: o.fortified, terrain: o.terrain });

  it('neither side activates: stale roll and the attacker chooses press or break', () => {
    const r = fight(duel(['red:L5'], ['black:L10'], [1, 2]), { target: '0,0', atk: ['red:L5'] });
    expect(resolvedEv(r.events)[0].outcome).toBe('stale');
    expect(pend(r.state)).toMatchObject({ kind: 'pressOrBreak', player: 'red', staleCount: 1 });
  });

  it('exactly one side activates: that side wins (attacker)', () => {
    const r = fight(duel(['red:L5'], ['black:L10'], [2, 3]), { target: '0,0', atk: ['red:L5'] });
    expect(resolvedEv(r.events)[0]).toMatchObject({ outcome: 'attacker', winner: 'red' });
  });
  it('exactly one side activates: that side wins (defender)', () => {
    const r = fight(duel(['red:L5'], ['black:L10'], [4, 6]), { target: '0,0', atk: ['red:L5'] });
    expect(resolvedEv(r.events)[0]).toMatchObject({ outcome: 'defender', winner: 'black' });
  });
  it('both activate with no Advantage on either side: Bloodbath', () => {
    const r = fight(duel(['red:L7'], ['black:H7'], [3, 4]), { target: '0,0', atk: ['red:L7'] });
    expect(resolvedEv(r.events)[0].outcome).toBe('bloodbath');
  });
  it('both activate, only the attacker has Advantage: attacker wins', () => {
    const s = buildState({ board: { '1,0': ['red:L7'], '0,-1': ['red:L2'], '0,0': ['black:H7'] }, dice: [3, 4] });
    const r = fight(s, { target: '0,0', atk: ['red:L7', 'red:L2'] });
    expect(resolvedEv(r.events)[0]).toMatchObject({ outcome: 'attacker', winner: 'red' });
  });
  it('both activate, only the defender has Advantage: defender wins', () => {
    const r = fight(duel(['red:L7'], ['black:H7'], [3, 4], { fortified: ['0,0'] }), { target: '0,0', atk: ['red:L7'] });
    expect(resolvedEv(r.events)[0]).toMatchObject({ outcome: 'defender', winner: 'black' });
  });
  it('both sides have Advantage and both activate: Bloodbath', () => {
    const s = buildState({ board: { '1,0': ['red:L7'], '0,-1': ['red:L2'], '0,0': ['black:H7'] }, fortified: ['0,0'], dice: [3, 4] });
    const r = fight(s, { target: '0,0', atk: ['red:L7', 'red:L2'] });
    expect(advA(r)).toContain('flanking');
    expect(advD(r)).toContain('fortified');
    expect(resolvedEv(r.events)[0].outcome).toBe('bloodbath');
  });

  it('Advantage: a total of 11 or 12 is one extra activation (defender, no other card activates)', () => {
    const r = fight(duel(['red:L5'], ['black:L5'], [5, 6], { fortified: ['0,0'] }), { target: '0,0', atk: ['red:L5'] });
    expect(resolvedEv(r.events)[0]).toMatchObject({ outcome: 'defender', advantageBonus: { attacker: false, defender: true }, counts: { attacker: 0, defender: 1 } });
  });
  it('without Advantage, 11 or 12 does nothing', () => {
    const r = fight(duel(['red:L5'], ['black:L5'], [5, 6]), { target: '0,0', atk: ['red:L5'] });
    expect(resolvedEv(r.events)[0].outcome).toBe('stale');
    const r2 = fight(duel(['red:L5'], ['black:L5'], [6, 6]), { target: '0,0', atk: ['red:L5'] });
    expect(resolvedEv(r2.events)[0].outcome).toBe('stale');
  });
  it('the bonus adds to cards that activated: Cavalry on 6+5 plus bonus is 2 (Overwhelming)', () => {
    const r = fight(duel(['red:L5'], ['black:V1', 'black:L4'], [6, 5], { fortified: ['0,0'] }), { target: '0,0', atk: ['red:L5'], def: ['black:V1', 'black:L4'] });
    const ev = resolvedEv(r.events)[0];
    expect(ev.counts.defender).toBe(2);
    expect(ev.overwhelming).toBe(true);
  });
  it('the bonus works for the attacker too (Flanking, 12)', () => {
    const s = buildState({ board: { '1,0': ['red:L7'], '0,-1': ['red:L2'], '0,0': ['black:H7'] }, dice: [6, 6] });
    const r = fight(s, { target: '0,0', atk: ['red:L7', 'red:L2'] });
    expect(resolvedEv(r.events)[0]).toMatchObject({ outcome: 'attacker', advantageBonus: { attacker: true, defender: false } });
  });
});

describe('§7.6 Stale rolls, Press and Break Off', () => {
  const base = (dice: number[], o: any = {}) =>
    buildState({ board: { '0,1': o.atk ?? ['red:L5'], '0,0': o.def ?? ['black:L10'] }, dice, fortified: o.fortified });

  it('Break Off ends the engagement; nothing else happens and the Engage CP stays spent', () => {
    const r = seq(fight(base([1, 2]), { target: '0,0', atk: ['red:L5'] }), { type: 'breakOff', player: 'red' });
    expect(r.state.engagement).toBeNull();
    expect(eventsOf(r.events, 'casualties')).toHaveLength(0);
    expect(r.state.turn!.cp).toBe(3);
    expect(r.state.stacks['0,0']).toEqual(cs('black:L10'));
  });

  it('Press costs no CP and rolls again with the same cards', () => {
    let r = fight(base([1, 2, 2, 3]), { target: '0,0', atk: ['red:L5'] });
    const cp = r.state.turn!.cp;
    r = seq(r, { type: 'press', player: 'red' });
    expect(r.state.turn!.cp).toBe(cp);
    expect(eventsOf(r.events, 'diceRolled').map((e) => e.roll)).toEqual([1, 2]);
    expect(resolvedEv(r.events)[1].outcome).toBe('attacker');
  });

  it('Press keeps the committed Wit numbers (no re-declaration)', () => {
    const s = buildState({ board: { '0,1': ['red:W'], '0,0': ['black:L10'] }, dice: [1, 2, 2, 3] });
    let r = fight(s, { target: '0,0', atk: ['red:W'], witA: 5 });
    r = seq(r, { type: 'press', player: 'red' });
    expect(resolvedEv(r.events)[1]).toMatchObject({ outcome: 'attacker', winner: 'red' });
  });

  it('Press does not refresh rerolls: a used Commander reroll stays used', () => {
    const s = buildState({ board: { '0,1': ['red:K1', 'red:L8'], '0,0': ['black:L10'] }, dice: [1, 2, 1, 4, 4] });
    let r = fight(s, { target: '0,0', atk: ['red:K1', 'red:L8'] });
    expect(pend(r.state)).toMatchObject({ kind: 'reroll', player: 'red' });
    r = seq(r, { type: 'reroll', player: 'red', source: 'commander', die: 0 }); // 1 -> 1, still stale
    expect(pend(r.state).kind).toBe('pressOrBreak');
    r = seq(r, { type: 'press', player: 'red' });
    expect(eventsOf(r.events, 'rerolled')).toHaveLength(1);
    expect(resolvedEv(r.events)[1].outcome).toBe('attacker');
    expect(pend(r.state).kind).not.toBe('reroll');
  });

  it('Stale x3 gives the defender Advantage so a later both-activate roll goes to the defender', () => {
    const s = buildState({ board: { '0,1': ['red:L10'], '0,0': ['black:H10'] }, dice: [1, 2, 1, 2, 1, 2, 4, 6] });
    let r = fight(s, { target: '0,0', atk: ['red:L10'] });
    r = seq(r, { type: 'press', player: 'red' }, { type: 'press', player: 'red' }, { type: 'press', player: 'red' });
    expect(resolvedEv(r.events).map((e) => e.outcome)).toEqual(['stale', 'stale', 'stale', 'defender']);
    // control: without the stale Advantage the same roll is a Bloodbath
    const c2 = fight(buildState({ board: { '0,1': ['red:L10'], '0,0': ['black:H10'] }, dice: [4, 6] }), { target: '0,0', atk: ['red:L10'] });
    expect(resolvedEv(c2.events)[0].outcome).toBe('bloodbath');
  });

  it('the third stale roll has no effect on a defender that already has Advantage', () => {
    const s = base([1, 2, 1, 2, 1, 2], { fortified: ['0,0'] });
    let r = fight(s, { target: '0,0', atk: ['red:L5'] });
    r = seq(r, { type: 'press', player: 'red' }, { type: 'press', player: 'red' });
    expect(eventsOf(r.events, 'advantageGained')).toHaveLength(0);
  });

  it('Press may be repeated for free as long as rolls stay stale', () => {
    let r = fight(base([1, 2, 1, 2, 1, 2, 1, 2]), { target: '0,0', atk: ['red:L5'] });
    for (let i = 0; i < 3; i++) r = seq(r, { type: 'press', player: 'red' });
    expect(r.state.turn!.cp).toBe(3);
    expect(resolvedEv(r.events)).toHaveLength(4);
  });
});

describe('§8 Dice and rerolls', () => {
  const k = (extra: any = {}) => buildState({ board: { '0,1': ['red:K1', 'red:L8'], '0,0': ['black:L2', 'black:L3'] }, dice: [2, 5, 3], ...extra });
  const start = (s: any, atk = ['red:K1', 'red:L8'], def = ['black:L2']) => fight(s, { target: '0,0', atk, def });

  it('a committed Commander gives one reroll of one chosen die; the new value is kept', () => {
    let r = start(k());
    expect(pend(r.state).options).toEqual([{ source: 'commander', commanderId: c('red:K1') }]);
    r = seq(r, { type: 'reroll', player: 'red', source: 'commander', die: 0 });
    const rr = eventsOf(r.events, 'rerolled')[0];
    expect(rr).toMatchObject({ player: 'red', die: 0, from: 2, to: 3, dice: [3, 5] });
    expect(resolvedEv(r.events)[0].dice).toEqual([3, 5]);
  });

  it('rerolling the other die leaves the first die alone', () => {
    let r = start(k({ dice: [2, 5, 6] }));
    r = seq(r, { type: 'reroll', player: 'red', source: 'commander', die: 1 });
    expect(resolvedEv(r.events)[0].dice).toEqual([2, 6]);
  });

  it('an uncommitted Commander gives no reroll', () => {
    const s = buildState({ board: { '0,1': ['red:K1', 'red:L8'], '0,0': ['black:L2', 'black:L3'] }, dice: [2, 5] });
    const r = start(s, ['red:L8']);
    expect(pend(r.state).kind).not.toBe('reroll');
  });

  it('a Commander reroll is single-use: no second reroll with one Commander', () => {
    let r = start(k({ dice: [2, 5, 3, 1] }));
    r = seq(r, { type: 'reroll', player: 'red', source: 'commander', die: 0 });
    mustReject(r.state, { type: 'reroll', player: 'red', source: 'commander', die: 0 });
  });

  it('two Commanders give two rerolls', () => {
    const s = buildState({ board: { '0,1': ['red:K1', 'red:K2', 'red:L8'], '0,0': ['black:L2', 'black:L3'] }, dice: [6, 6, 3, 5] });
    let r = start(s, ['red:K1', 'red:K2', 'red:L8']);
    expect(pend(r.state).options).toHaveLength(2);
    r = seq(r, { type: 'reroll', player: 'red', source: 'commander', die: 0 });
    expect(pend(r.state).kind).toBe('reroll');
    r = seq(r, { type: 'reroll', player: 'red', source: 'commander', die: 1 });
    expect(resolvedEv(r.events)[0]).toMatchObject({ dice: [3, 5], outcome: 'attacker' });
  });

  it('after every roll a window opens; the defender acts first', () => {
    const s = buildState({ board: { '0,1': ['red:K1', 'red:L8'], '0,0': ['black:K1', 'black:L3'] }, dice: [2, 5] });
    const r = fight(s, { target: '0,0', atk: ['red:K1', 'red:L8'], def: ['black:K1', 'black:L3'] });
    expect(pend(r.state)).toMatchObject({ kind: 'reroll', player: 'black' });
    mustReject(r.state, { type: 'passReroll', player: 'red' });
  });

  it('a window opens again after Press and the defender is again first', () => {
    const s = buildState({ board: { '0,1': ['red:K1', 'red:L8'], '0,0': ['black:K1', 'black:L9'] }, dice: [1, 2, 4, 3] });
    let r = fight(s, { target: '0,0', atk: ['red:K1', 'red:L8'], def: ['black:K1', 'black:L9'] });
    r = seq(r, { type: 'passReroll', player: 'black' }, { type: 'passReroll', player: 'red' });
    expect(pend(r.state).kind).toBe('pressOrBreak');
    r = seq(r, { type: 'press', player: 'red' });
    expect(pend(r.state)).toMatchObject({ kind: 'reroll', player: 'black' });
  });

  it('the window alternates and a reroll resets the passes; it closes when both pass consecutively', () => {
    const s = buildState({ board: { '0,1': ['red:K1', 'red:L8'], '0,0': ['black:K1', 'black:K2', 'black:L3'] }, dice: [2, 5, 6, 3, 1] });
    let r = fight(s, { target: '0,0', atk: ['red:K1', 'red:L8'], def: ['black:K1', 'black:K2', 'black:L3'] });
    expect(pend(r.state).player).toBe('black');
    r = seq(r, { type: 'reroll', player: 'black', source: 'commander', die: 0 }); // 2 -> 6
    expect(pend(r.state).player).toBe('red');
    r = seq(r, { type: 'reroll', player: 'red', source: 'commander', die: 0 }); // 6 -> 3 (total 8)
    expect(pend(r.state).player).toBe('black'); // black still holds a Commander
    r = seq(r, { type: 'passReroll', player: 'black' });
    // red has no option left: its automatic pass is the second consecutive pass, so the window closes
    expect(eventsOf(r.events, 'resolved')).toHaveLength(1);
    expect(resolvedEv(r.events)[0]).toMatchObject({ dice: [3, 5], outcome: 'attacker' });
  });

  it('the pass counter resets after a reroll: pass, reroll, then the other side is asked again', () => {
    const s = buildState({ board: { '0,1': ['red:K1', 'red:K2', 'red:L8'], '0,0': ['black:K1', 'black:L3'] }, dice: [2, 5, 1, 1] });
    let r = fight(s, { target: '0,0', atk: ['red:K1', 'red:K2', 'red:L8'], def: ['black:K1', 'black:L3'] });
    r = seq(r, { type: 'passReroll', player: 'black' });
    expect(pend(r.state).player).toBe('red');
    r = seq(r, { type: 'reroll', player: 'red', source: 'commander', die: 0 });
    expect(pend(r.state)).toMatchObject({ kind: 'reroll', player: 'black' }); // black asked again
    r = seq(r, { type: 'reroll', player: 'black', source: 'commander', die: 1 });
    expect(pend(r.state)).toMatchObject({ kind: 'reroll', player: 'red' });
  });

  it('a player with no usable reroll passes automatically', () => {
    const r = start(k());
    const passes = eventsOf(r.events, 'rerollPassed');
    expect(passes.some((e) => e.player === 'black' && e.auto)).toBe(true);
  });

  describe('Disadvantage reroll', () => {
    const arch = (dice: number[]) =>
      buildState({ board: { '0,1': ['red:L8'], '0,0': ['black:A1', 'black:L9'] }, dice });
    const go = (dice: number[]) => fight(arch(dice), { target: '0,0', atk: ['red:L8'], def: ['black:A1', 'black:L9'] });

    it('the opponent may force a reroll of one die (they pick which) while the Disadvantaged side activates', () => {
      let r = go([1, 5, 3]);
      expect(pend(r.state)).toMatchObject({ kind: 'reroll', player: 'red' });
      expect(pend(r.state).options).toEqual([{ source: 'disadvantage' }]);
      r = seq(r, { type: 'reroll', player: 'red', source: 'disadvantage', die: 0 });
      expect(eventsOf(r.events, 'rerolled')[0]).toMatchObject({ player: 'red', source: 'disadvantage', die: 0, from: 1, to: 3 });
      expect(resolvedEv(r.events)[0]).toMatchObject({ dice: [3, 5], outcome: 'attacker' });
    });

    it('not available when the Disadvantaged side does not currently activate', () => {
      const r = go([2, 5]);
      expect(pend(r.state).kind).toBe('pressOrBreak');
    });

    it('usable only once per engagement', () => {
      let r = go([1, 5, 1]);
      r = seq(r, { type: 'reroll', player: 'red', source: 'disadvantage', die: 1 });
      expect(r.events.filter((e: any) => e.type === 'rerolled')).toHaveLength(1);
      expect(pend(r.state).kind).not.toBe('reroll');
    });

    describe('when the Disadvantaged side activates only through its Advantage 11/12 bonus (§7.4, §8.2)', () => {
      // Black is Fortified (Advantage) and defends with an Archer next to an adjacent attacker
      // (Disadvantage); A1 itself does not activate on these dice.
      const bonus = (dice: number[]) =>
        fight(buildState({ board: { '0,1': ['red:L2'], '0,0': ['black:A1', 'black:L9'] }, fortified: ['0,0'], dice }), {
          target: '0,0',
          atk: ['red:L2'],
          def: ['black:A1'],
        });

      it('5+6: the bonus counts as activating, so the opponent is offered the forced reroll', () => {
        let r = bonus([5, 6]);
        expect(started(r.events).modifiers.defender).toEqual({ advantage: ['fortified'], disadvantage: ['archerDefending'] });
        expect(pend(r.state)).toMatchObject({ kind: 'reroll', player: 'red', options: [{ source: 'disadvantage' }] });
        r = seq(r, { type: 'passReroll', player: 'red' });
        // confirms the activation really was the bonus alone
        expect(resolvedEv(r.events)[0]).toMatchObject({
          activating: { attacker: [], defender: [] },
          advantageBonus: { defender: true },
          outcome: 'defender',
        });
      });

      it('5+4: no bonus and no card activating, so the forced reroll is not offered', () => {
        const r = bonus([5, 4]);
        expect(eventsOf(r.events, 'rerolled')).toHaveLength(0);
        expect(resolvedEv(r.events)[0]).toMatchObject({ activating: { attacker: [], defender: [] }, advantageBonus: { defender: false } });
        expect(pend(r.state).kind).toBe('pressOrBreak');
      });
    });

    it('the Disadvantaged side cannot use it itself', () => {
      const r = go([1, 5, 3]);
      mustReject(r.state, { type: 'reroll', player: 'black', source: 'disadvantage', die: 0 });
    });

    it('the defender may force it when the attacker is Disadvantaged (Cavalry on a Mountain), defender first', () => {
      const s = buildState({ board: { '0,1': ['red:V1'], '0,0': ['black:L10'] }, terrain: { '0,1': 'mountain' }, dice: [6, 2, 1] });
      let r = fight(s, { target: '0,0', atk: ['red:V1'] });
      expect(pend(r.state)).toMatchObject({ kind: 'reroll', player: 'black' });
      r = seq(r, { type: 'reroll', player: 'black', source: 'disadvantage', die: 0 });
      expect(resolvedEv(r.events)[0].outcome).toBe('stale');
    });

    it('a side can hold up to 3 rerolls: two Commanders plus the Disadvantage reroll', () => {
      const s = buildState({ board: { '0,1': ['red:K1', 'red:K2', 'red:L8'], '0,0': ['black:A1', 'black:L9'] }, dice: [1, 5, 1, 1, 3] });
      let r = fight(s, { target: '0,0', atk: ['red:K1', 'red:K2', 'red:L8'], def: ['black:A1', 'black:L9'] });
      expect(pend(r.state).options).toHaveLength(3);
      r = seq(r, { type: 'reroll', player: 'red', source: 'disadvantage', die: 0 }); // 1 -> 1, black still activates
      r = seq(r, { type: 'reroll', player: 'red', source: 'commander', die: 0 }); // 1 -> 1
      expect(pend(r.state).kind).toBe('reroll');
      r = seq(r, { type: 'reroll', player: 'red', source: 'commander', die: 0 }); // 1 -> 3
      expect(eventsOf(r.events, 'rerolled')).toHaveLength(3);
      expect(resolvedEv(r.events)[0]).toMatchObject({ dice: [3, 5], outcome: 'attacker' });
    });
  });
});
