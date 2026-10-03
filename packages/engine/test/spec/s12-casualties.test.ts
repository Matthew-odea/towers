import { describe, it, expect } from 'vitest';
import { buildState, mustApply, mustReject, c, cs, seq, fight, settle, eventsOf, pend, resolvedEv } from './h';

const duel = (a: Record<string, string[]>, d: string[], dice: number[], o: any = {}) =>
  buildState({ board: { ...a, '0,0': d }, dice, fortified: o.fortified, terrain: o.terrain });
const at01 = (...a: string[]) => ({ '0,1': a });

describe('§12.1 Eligibility', () => {
  it('only committed cards can be casualties: uncommitted defenders (including Commanders) survive', () => {
    const s = duel(at01('red:L5'), ['black:L9', 'black:K1', 'black:L8'], [2, 3]);
    const r = settle(fight(s, { target: '0,0', atk: ['red:L5'], def: ['black:L9'] }));
    expect(r.state.destroyed.black).toEqual(cs('black:L9'));
    expect(r.state.stacks['0,0'] ?? r.state.stacks['0,-1'] ?? r.state.stacks['-1,0'] ?? r.state.stacks['1,-1']).toBeDefined();
  });

  it('only committed cards can be casualties on the attacking side too', () => {
    const s = duel(at01('red:L5', 'red:H6', 'red:K1'), ['black:L5'], [3, 2]);
    const r = settle(fight(s, { target: '0,0', atk: ['red:L5', 'red:H6'] , def: ['black:L5']}));
    // Bloodbath not possible (H6/L5: dice 5 -> both L5 activate -> Bloodbath)
    expect(resolvedEv(r.events)[0].outcome).toBe('bloodbath');
    const lost = r.state.destroyed.red;
    expect(lost).toHaveLength(1);
    expect(cs('red:L5', 'red:H6')).toContain(lost[0]);
    expect(r.state.destroyed.red).not.toContain(c('red:K1'));
  });

  it('casualties are capped at the eligible committed cards (defender commits 1, attacker has 2 activations)', () => {
    const s = duel(at01('red:L5', 'red:H5'), ['black:L9', 'black:L8'], [2, 3]);
    const r = fight(s, { target: '0,0', atk: ['red:L5', 'red:H5'], def: ['black:L9'] });
    expect(resolvedEv(r.events)[0]).toMatchObject({ overwhelming: true, outcome: 'attacker' });
    const q = settle(r);
    expect(q.state.destroyed.black).toEqual(cs('black:L9'));
    expect(eventsOf(q.events, 'casualties').flatMap((e) => e.cardIds)).toHaveLength(1);
  });

  it('a Bloodbath with an empty eligible pool on one side costs that side nothing (immune ranged Archer)', () => {
    const s = buildState({ board: { '0,2': ['red:A1'], '0,0': ['black:L7'] }, dice: [1, 6] });
    const r = settle(fight(s, { target: '0,0', atk: ['red:A1'] }));
    expect(r.state.destroyed.red).toHaveLength(0);
    expect(r.state.destroyed.black).toHaveLength(1);
  });
});

describe('§12.2 Count', () => {
  it('a normal win causes 1 casualty', () => {
    const s = duel(at01('red:L5'), ['black:L9', 'black:L8'], [2, 3]);
    const r = fight(s, { target: '0,0', atk: ['red:L5'], def: ['black:L9', 'black:L8'] });
    expect(pend(r.state)).toMatchObject({ kind: 'casualties', count: 1, owner: 'black' });
  });

  it('Overwhelming Activation (2+) causes 2 casualties', () => {
    const s = duel(at01('red:L5', 'red:H5'), ['black:L9', 'black:L8', 'black:L10'], [2, 3]);
    const r = fight(s, { target: '0,0', atk: ['red:L5', 'red:H5'], def: ['black:L9', 'black:L8', 'black:L10'] });
    expect(pend(r.state)).toMatchObject({ kind: 'casualties', count: 2, owner: 'black' });
    const q = settle(r);
    expect(q.state.destroyed.black).toHaveLength(2);
  });

  it('Overwhelming comes from the Advantage bonus too (card + 11/12 bonus)', () => {
    const s = buildState({ board: { '0,1': ['red:L2', 'red:L3', 'red:L4'], '0,0': ['black:L9', 'black:L8', 'black:V1'] }, fortified: ['0,0'], dice: [6, 5] });
    const r = fight(s, { target: '0,0', atk: ['red:L2', 'red:L3', 'red:L4'], def: ['black:L9', 'black:L8', 'black:V1'] });
    expect(resolvedEv(r.events)[0].counts.defender).toBe(2);
    expect(pend(r.state)).toMatchObject({ kind: 'casualties', count: 2, owner: 'red' });
  });

  it('hard cap 2: three activations still cause only 2 casualties', () => {
    const s = duel(at01('red:L7', 'red:H7', 'red:V1'), ['black:L10', 'black:L9', 'black:L8'], [6, 1]);
    const r = fight(s, { target: '0,0', atk: ['red:L7', 'red:H7', 'red:V1'], def: ['black:L10', 'black:L9', 'black:L8'] });
    expect(resolvedEv(r.events)[0].counts.attacker).toBe(3);
    expect(pend(r.state)).toMatchObject({ kind: 'casualties', count: 2, owner: 'black' });
    expect(settle(r).state.destroyed.black).toHaveLength(2);
  });

  it('Bloodbath: exactly 1 casualty each regardless of how many cards activated', () => {
    const s = duel(at01('red:L7', 'red:H7', 'red:V1'), ['black:H7', 'black:L7', 'black:V1'], [6, 1]);
    const r = settle(fight(s, { target: '0,0', atk: ['red:L7', 'red:H7', 'red:V1'], def: ['black:H7', 'black:L7', 'black:V1'] }));
    expect(resolvedEv(r.events)[0].outcome).toBe('bloodbath');
    expect(resolvedEv(r.events)[0].overwhelming).toBe(false);
    expect(r.state.destroyed.red).toHaveLength(1);
    expect(r.state.destroyed.black).toHaveLength(1);
  });

  it('the casualty events list the destroyed cards in the destroyed piles', () => {
    const s = duel(at01('red:L5'), ['black:L9'], [2, 3]);
    const r = settle(fight(s, { target: '0,0', atk: ['red:L5'] }));
    const ev = eventsOf(r.events, 'casualties');
    expect(ev.flatMap((e) => e.cardIds)).toEqual(cs('black:L9'));
    expect(r.state.destroyed.black).toEqual(cs('black:L9'));
    expect(r.state.stacks['0,0']).toBeUndefined();
  });
});

describe('§12.3 Who chooses', () => {
  it('normally the side taking casualties chooses', () => {
    const s = duel(at01('red:L5'), ['black:L9', 'black:L8'], [2, 3]);
    const r = fight(s, { target: '0,0', atk: ['red:L5'], def: ['black:L9', 'black:L8'] });
    expect(pend(r.state)).toMatchObject({ kind: 'casualties', player: 'black', owner: 'black', reason: 'normal' });
    const q = seq(r, { type: 'chooseCasualties', player: 'black', cardIds: cs('black:L8') });
    expect(q.state.destroyed.black).toEqual(cs('black:L8'));
  });

  it('a chooser must pick exactly count cards from the eligible pool', () => {
    const s = duel(at01('red:L5'), ['black:L9', 'black:L8'], [2, 3]);
    const r = fight(s, { target: '0,0', atk: ['red:L5'], def: ['black:L9'] , });
    expect(r).toBeDefined();
    const r2 = fight(duel(at01('red:L5'), ['black:L9', 'black:L8', 'black:L6'], [2, 3]), { target: '0,0', atk: ['red:L5'], def: ['black:L9', 'black:L8'] });
    mustReject(r2.state, { type: 'chooseCasualties', player: 'black', cardIds: cs('black:L6') }); // not committed
    mustReject(r2.state, { type: 'chooseCasualties', player: 'black', cardIds: cs('black:L9', 'black:L8') }); // too many
    mustReject(r2.state, { type: 'chooseCasualties', player: 'red', cardIds: cs('black:L9') }); // wrong chooser
  });

  it('winner with Advantage and loser with Disadvantage: the winner chooses (attacker flank + surrounded)', () => {
    const s = buildState({
      board: { '1,0': ['red:L6'], '0,-1': ['red:L3'], '-1,1': ['red:L4'], '0,0': ['black:L9', 'black:L8'] }, dice: [3, 3],
    });
    const r = fight(s, { target: '0,0', atk: ['red:L6', 'red:L3', 'red:L4'], def: ['black:L9', 'black:L8'] });
    expect(pend(r.state)).toMatchObject({ kind: 'casualties', player: 'red', owner: 'black', reason: 'advantage' });
  });

  it('winner with Advantage and loser with Disadvantage: the winner chooses (Fortified defender vs Cavalry on a Mountain)', () => {
    const s = buildState({ board: { '0,1': ['red:V1', 'red:L5'], '0,0': ['black:L8'] }, terrain: { '0,1': 'mountain' }, fortified: ['0,0'], dice: [4, 4] });
    const r = fight(s, { target: '0,0', atk: ['red:V1', 'red:L5'] });
    expect(pend(r.state)).toMatchObject({ kind: 'casualties', player: 'black', owner: 'red', reason: 'advantage' });
    expect(pend(r.state).eligible.sort()).toEqual(cs('red:V1', 'red:L5').sort());
  });

  it('with only Advantage (no opposing Disadvantage) the loser still chooses', () => {
    const s = buildState({ board: { '0,1': ['red:L5', 'red:L6'], '0,0': ['black:L8'] }, fortified: ['0,0'], dice: [4, 4] });
    const r = fight(s, { target: '0,0', atk: ['red:L5', 'red:L6'] });
    expect(pend(r.state)).toMatchObject({ kind: 'casualties', player: 'red', owner: 'red', reason: 'normal' });
  });

  describe('Shardstrike', () => {
    const win = (dice: number[], o: any = {}) =>
      buildState({ board: { '0,1': o.atk ?? ['red:S1', 'red:L9'], '0,0': ['black:L8', 'black:L10'] }, dice });

    it('a winner whose Shardbearer activated on doubles chooses 1 casualty', () => {
      const r = fight(win([3, 3]), { target: '0,0', atk: ['red:S1', 'red:L9'], def: ['black:L8', 'black:L10'] });
      expect(resolvedEv(r.events)[0].shardstrike.attacker).toBe(true);
      expect(pend(r.state)).toMatchObject({ kind: 'casualties', player: 'red', owner: 'black', count: 1, reason: 'shardstrike' });
      const q = seq(r, { type: 'chooseCasualties', player: 'red', cardIds: cs('black:L10') });
      expect(q.state.destroyed.black).toEqual(cs('black:L10'));
    });

    it('total 7 activates the Shardbearer but gives no Shardstrike (the loser chooses)', () => {
      const r = fight(win([3, 4]), { target: '0,0', atk: ['red:S1', 'red:L9'], def: ['black:L8', 'black:L10'] });
      expect(resolvedEv(r.events)[0].shardstrike.attacker).toBe(false);
      expect(pend(r.state)).toMatchObject({ kind: 'casualties', player: 'black', owner: 'black', reason: 'normal' });
    });

    it('Shardstrike uses the final dice after rerolls', () => {
      const s = buildState({ board: { '0,1': ['red:K1', 'red:S1'], '0,0': ['black:L8', 'black:L10'] }, dice: [3, 4, 4] });
      let r = fight(s, { target: '0,0', atk: ['red:K1', 'red:S1'], def: ['black:L8', 'black:L10'] });
      r = seq(r, { type: 'reroll', player: 'red', source: 'commander', die: 0 });
      expect(resolvedEv(r.events)[0].shardstrike.attacker).toBe(true);
      expect(pend(r.state)).toMatchObject({ player: 'red', reason: 'shardstrike' });
    });

    it('Overwhelming with Shardstrike: the winner picks 1, the loser picks the other (worked example 1 pattern)', () => {
      const s = buildState({ board: { '0,1': ['red:L4', 'red:H4', 'red:S1'], '0,0': ['black:L8', 'black:L9', 'black:L10'] }, dice: [2, 2] });
      const r = fight(s, { target: '0,0', atk: ['red:L4', 'red:H4', 'red:S1'], def: ['black:L8', 'black:L9', 'black:L10'] });
      expect(resolvedEv(r.events)[0]).toMatchObject({ counts: { attacker: 3, defender: 0 }, overwhelming: true });
      const q = settle(r, { pick: (p) => (p.player === 'red' ? [p.eligible.includes(c('black:L9')) ? c('black:L9') : p.eligible[0]] : undefined) });
      const chooser = q.log.map((p: any) => `${p.player}:${p.count}`).sort();
      expect(chooser).toEqual(['black:1', 'red:1']);
      expect(q.state.destroyed.black).toHaveLength(2);
      expect(q.state.destroyed.black).toContain(c('black:L9'));
      const redPick = q.log.find((p: any) => p.player === 'red');
      expect(redPick.owner).toBe('black');
    });

    it('with a single committed defender only 1 dies even with Overwhelming and Shardstrike', () => {
      const s = buildState({ board: { '0,1': ['red:L4', 'red:H4', 'red:S1'], '0,0': ['black:L8', 'black:L9'] }, dice: [2, 2] });
      const r = settle(fight(s, { target: '0,0', atk: ['red:L4', 'red:H4', 'red:S1'], def: ['black:L8'] }));
      expect(r.state.destroyed.black).toEqual(cs('black:L8'));
    });

    it('Bloodbath: a side with Shardstrike chooses the opponent casualty', () => {
      const s = buildState({ board: { '0,1': ['red:S1', 'red:L9'], '0,0': ['black:L6', 'black:L8'] }, dice: [3, 3] });
      const r = fight(s, { target: '0,0', atk: ['red:S1', 'red:L9'], def: ['black:L6', 'black:L8'] });
      expect(resolvedEv(r.events)[0].outcome).toBe('bloodbath');
      const q = settle(r, { pick: (p) => (p.owner === 'black' ? cs('black:L8') : undefined) });
      const blk = q.log.find((p: any) => p.owner === 'black');
      expect(blk.player).toBe('red');
      expect(q.state.destroyed.black).toEqual(cs('black:L8'));
      const redEntry = q.log.find((p: any) => p.owner === 'red');
      expect(redEntry.player).toBe('red');
    });

    it('Bloodbath where both sides have Shardstrike: each chooses the other casualty', () => {
      const s = buildState({ board: { '0,1': ['red:S1', 'red:L9'], '0,0': ['black:S1', 'black:L8'] }, dice: [4, 4] });
      const r = fight(s, { target: '0,0', atk: ['red:S1', 'red:L9'], def: ['black:S1', 'black:L8'] });
      expect(resolvedEv(r.events)[0]).toMatchObject({ outcome: 'bloodbath', shardstrike: { attacker: true, defender: true } });
      const q = settle(r, { pick: (p) => (p.owner === 'black' ? cs('black:L8') : cs('red:L9')) });
      expect(q.log.find((p: any) => p.owner === 'black').player).toBe('red');
      expect(q.log.find((p: any) => p.owner === 'red').player).toBe('black');
    });

    it('Shardstrike never reaches uncommitted cards', () => {
      const s = buildState({ board: { '0,1': ['red:S1'], '0,0': ['black:L8', 'black:K1', 'black:L10'] }, dice: [3, 3] });
      const r = fight(s, { target: '0,0', atk: ['red:S1'], def: ['black:L8', 'black:L10'] });
      expect(pend(r.state).eligible.sort()).toEqual(cs('black:L8', 'black:L10').sort());
    });

    it('the defender can have Shardstrike too (defender wins on doubles)', () => {
      const s = buildState({ board: { '0,1': ['red:L5', 'red:L6'], '0,0': ['black:S1'] }, dice: [2, 2] });
      const r = fight(s, { target: '0,0', atk: ['red:L5', 'red:L6'] });
      expect(resolvedEv(r.events)[0].shardstrike.defender).toBe(true);
      expect(pend(r.state)).toMatchObject({ player: 'black', owner: 'red', reason: 'shardstrike' });
    });
  });
});

describe('§12.4 After casualties', () => {
  it('destroyed cards go to the destroyed pile; non-Commanders (including Wit) stay gone next round', () => {
    const s = buildState({ board: { '0,1': ['red:L5'], '0,0': ['black:W', 'black:L8'] }, dice: [2, 3] });
    const r = settle(fight(s, { target: '0,0', atk: ['red:L5'], def: ['black:W'], witD: 7 }));
    expect(r.state.destroyed.black).toEqual(cs('black:W'));
    const next = mustApply(r.state, { type: 'concede', player: 'red' }).state;
    expect(next.destroyed.black).toEqual(cs('black:W'));
    expect(next.reserve.black).not.toContain(c('black:W'));
  });

  describe('Combat Retreat', () => {
    const board = (extra: Record<string, string[]> = {}) => ({ '0,1': ['red:L5'], '0,0': ['black:L8', 'black:L9'], ...extra });
    const lose = (b: any, o: any = {}) => fight(buildState({ board: b, dice: [2, 3], ...o }), { target: '0,0', atk: o.atk ?? ['red:L5'], def: ['black:L8'] });

    it('is offered to a defender that lost and still has cards; legal hexes avoid attackers and their neighbours', () => {
      const r = lose(board());
      const p = pend(r.state);
      expect(p).toMatchObject({ kind: 'retreat', player: 'black', from: '0,0' });
      expect([...p.hexes].sort()).toEqual(['-1,0', '0,-1', '1,-1']);
      mustReject(r.state, { type: 'retreat', player: 'black', to: '1,0' }); // adjacent to the attacker
      mustReject(r.state, { type: 'retreat', player: 'black', to: '-1,1' });
      mustReject(r.state, { type: 'retreat', player: 'black', to: '0,1' }); // enemy hex
      mustReject(r.state, { type: 'retreat', player: 'black', to: '2,0' }); // not adjacent to the stack
    });

    it('moves the entire remaining stack (committed or not) one hex for free', () => {
      const s = buildState({ board: { '0,1': ['red:L5'], '0,0': ['black:L8', 'black:L9', 'black:L10'] }, dice: [2, 3] });
      const r = fight(s, { target: '0,0', atk: ['red:L5'], def: ['black:L8'] });
      const cp = r.state.turn!.cp;
      const q = seq(r, { type: 'retreat', player: 'black', to: '0,-1' });
      expect(q.state.stacks['0,-1'].sort()).toEqual(cs('black:L9', 'black:L10').sort());
      expect(q.state.stacks['0,0']).toBeUndefined();
      expect(q.state.turn!.cp).toBe(cp);
      expect(q.state.engagement).toBeNull();
    });

    it('is optional: staying is allowed', () => {
      const r = lose(board());
      const q = seq(r, { type: 'retreat', player: 'black', to: null });
      expect(q.state.stacks['0,0']).toEqual(cs('black:L9'));
      expect(q.state.engagement).toBeNull();
    });

    it('ranged Archer hexes and uncommitted attackers do not restrict the retreat', () => {
      const s = buildState({ board: { '0,1': ['red:L5', 'red:H3'], '2,-1': ['red:A1'], '0,0': ['black:L8', 'black:L9'] }, dice: [2, 3] });
      const r = fight(s, { target: '0,0', atk: ['red:L5', 'red:A1'], def: ['black:L8'] });
      expect([...pend(r.state).hexes].sort()).toEqual(['-1,0', '0,-1', '1,-1']);
    });

    it('every adjacent attacker hex restricts the retreat (two attacker hexes leave none)', () => {
      const s = buildState({ board: { '0,1': ['red:L5'], '0,-1': ['red:L3'], '0,0': ['black:L8', 'black:L9'] }, dice: [2, 3] });
      const r = fight(s, { target: '0,0', atk: ['red:L5', 'red:L3'], def: ['black:L8'] });
      // 1,-1 and -1,0 are next to 0,-1; 1,0 and -1,1 are next to 0,1: no legal hex, so no decision is asked
      expect(pend(r.state).kind).toBe('turn');
      expect(r.state.stacks['0,0']).toEqual(cs('black:L9'));
    });

    it('is not offered if no hex is legal: the stack just stays', () => {
      const s = buildState({ board: { '1,0': ['red:L5'], '0,-1': ['red:L3'], '-1,1': ['red:L4'], '0,0': ['black:L8', 'black:L9'] }, dice: [2, 3] });
      const r = fight(s, { target: '0,0', atk: ['red:L5', 'red:L3', 'red:L4'], def: ['black:L8'] });
      expect(r.state.engagement).toBeNull();
      expect(r.state.stacks['0,0']).toEqual(cs('black:L9'));
    });

    it('is not offered when the defender wins, in a Bloodbath, or when the defender has no cards left', () => {
      const win = fight(buildState({ board: board(), dice: [4, 6, 1, 1] }), { target: '0,0', atk: ['red:L5'], def: ['black:L8'] });
      expect(win.state.engagement === null || pend(win.state).kind !== 'retreat').toBe(true);
      const bb = settle(fight(buildState({ board: { '0,1': ['red:L7'], '0,0': ['black:H7', 'black:L9'] }, dice: [3, 4] }), { target: '0,0', atk: ['red:L7'], def: ['black:H7'] }));
      expect(resolvedEv(bb.events)[0].outcome).toBe('bloodbath');
      expect(eventsOf(bb.events, 'retreated')).toHaveLength(0);
      const none = settle(fight(buildState({ board: { '0,1': ['red:L5'], '0,0': ['black:L8'] }, dice: [2, 3] }), { target: '0,0', atk: ['red:L5'] }));
      expect(eventsOf(none.events, 'retreated')).toHaveLength(0);
    });

    it('loses Fortified status', () => {
      const s = buildState({ board: { '0,1': ['red:L5'], '0,0': ['black:L8', 'black:L9'] }, fortified: ['0,0'], dice: [2, 3] });
      let r = fight(s, { target: '0,0', atk: ['red:L5'], def: ['black:L8'] });
      expect(s.fortified['0,0']).toBe('black');
      r = seq(r, { type: 'retreat', player: 'black', to: '0,-1' });
      expect(Object.keys(r.state.fortified)).toHaveLength(0);
    });

    it('losing Fortified status also happens when the stack stays? no: it stays Fortified', () => {
      const s = buildState({ board: { '0,1': ['red:L5'], '0,0': ['black:L8', 'black:L9'] }, fortified: ['0,0'], dice: [2, 3] });
      let r = fight(s, { target: '0,0', atk: ['red:L5'], def: ['black:L8'] });
      r = seq(r, { type: 'retreat', player: 'black', to: null });
      expect(r.state.fortified['0,0']).toBe('black');
    });

    it('joining a friendly Fortified hex makes the cards part of that Fortified stack', () => {
      const s = buildState({ board: { '0,1': ['red:L5'], '0,0': ['black:L8', 'black:L9'], '-1,0': ['black:L7'] }, fortified: ['0,0', '-1,0'], dice: [2, 3] });
      let r = fight(s, { target: '0,0', atk: ['red:L5'], def: ['black:L8'] });
      r = seq(r, { type: 'retreat', player: 'black', to: '-1,0' });
      expect(r.state.fortified['-1,0']).toBe('black');
      expect(r.state.fortified['0,0']).toBeUndefined();
      expect(r.state.stacks['-1,0'].sort()).toEqual(cs('black:L7', 'black:L9').sort());
    });

    it('into a Mountain applies the lock', () => {
      const s = buildState({ board: { '0,1': ['red:L5'], '0,0': ['black:L8', 'black:L9'] }, terrain: { '-1,0': 'mountain' }, dice: [2, 3] });
      let r = fight(s, { target: '0,0', atk: ['red:L5'], def: ['black:L8'] });
      r = seq(r, { type: 'retreat', player: 'black', to: '-1,0' });
      expect(r.state.turn!.mountainLocked).toContain(c('black:L9'));
    });
  });
});
