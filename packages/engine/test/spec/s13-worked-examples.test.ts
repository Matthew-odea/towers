import { describe, it, expect } from 'vitest';
import { buildState, mustApply, c, cs, seq, fight, settle, eventsOf, pend, resolvedEv, started } from './h';

describe('§13 Worked examples', () => {
  it('1. Light 4 + Heavy 4 + Shardbearer on 2+2: 3 activations, Overwhelming (2 casualties), Shardstrike lets the attacker choose 1 and the defender the other', () => {
    const s = buildState({ board: { '0,1': ['red:L4', 'red:H4', 'red:S1'], '0,0': ['black:L8', 'black:H9'] }, dice: [2, 2] });
    const r = fight(s, { target: '0,0', atk: ['red:L4', 'red:H4', 'red:S1'], def: ['black:L8', 'black:H9'] });
    const ev = resolvedEv(r.events)[0];
    expect(ev.activating.attacker.sort()).toEqual(cs('red:L4', 'red:H4', 'red:S1').sort());
    expect(ev.activating.defender).toEqual([]);
    expect(ev).toMatchObject({ outcome: 'attacker', winner: 'red', overwhelming: true, shardstrike: { attacker: true, defender: false } });
    expect(ev.counts.attacker).toBe(3);
    const q = settle(r, { pick: (p) => (p.player === 'red' ? [c('black:H9')] : undefined) });
    expect(q.log.filter((p: any) => p.player === 'red')).toHaveLength(1);
    expect(q.state.destroyed.black.sort()).toEqual(cs('black:L8', 'black:H9').sort());
  });

  it('1b. ...if the defender committed only one card, only 1 dies', () => {
    const s = buildState({ board: { '0,1': ['red:L4', 'red:H4', 'red:S1'], '0,0': ['black:L8'] }, dice: [2, 2] });
    const r = settle(fight(s, { target: '0,0', atk: ['red:L4', 'red:H4', 'red:S1'] }));
    expect(r.state.destroyed.black).toEqual(cs('black:L8'));
    expect(r.state.destroyed.red).toEqual([]);
  });

  it('2. Both sides activate with no Advantage: Bloodbath, exactly 1 casualty each, however many activated; a doubles Shardbearer picks the opponent casualty', () => {
    const s = buildState({ board: { '0,1': ['red:L4', 'red:H4', 'red:S1'], '0,0': ['black:L4', 'black:H4', 'black:L9'] }, dice: [2, 2] });
    const r = fight(s, { target: '0,0', atk: ['red:L4', 'red:H4', 'red:S1'], def: ['black:L4', 'black:H4', 'black:L9'] });
    const ev = resolvedEv(r.events)[0];
    expect(ev.outcome).toBe('bloodbath');
    expect(ev.counts.attacker).toBe(3);
    expect(ev.counts.defender).toBe(2);
    const q = settle(r, { pick: (p) => (p.owner === 'black' ? [c('black:L9')] : undefined) });
    expect(q.state.destroyed.red).toHaveLength(1);
    expect(q.state.destroyed.black).toEqual(cs('black:L9'));
    expect(q.log.find((p: any) => p.owner === 'black').player).toBe('red');
  });

  it('3. Attacker commits from 3 hexes adjacent to the defender: Surrounded + Flanking; the winning attacker chooses the casualties', () => {
    const s = buildState({
      board: { '1,0': ['red:L6'], '0,-1': ['red:L3'], '-1,1': ['red:L4'], '0,0': ['black:L9', 'black:H10'] }, dice: [3, 3],
    });
    const r = fight(s, { target: '0,0', atk: ['red:L6', 'red:L3', 'red:L4'], def: ['black:L9', 'black:H10'] });
    const m = started(r.events).modifiers;
    expect(m.defender.disadvantage).toContain('surrounded');
    expect(m.attacker.advantage).toContain('flanking');
    expect(pend(r.state)).toMatchObject({ kind: 'casualties', player: 'red', owner: 'black' });
  });

  it('4. Commander + Light 8 on 2+5: if the defender passes, the Commander rerolls the 2; a 3 makes 8 and the 8 activates', () => {
    const s = buildState({ board: { '0,1': ['red:K1', 'red:L8'], '0,0': ['black:L2', 'black:L3'] }, dice: [2, 5, 3] });
    let r = fight(s, { target: '0,0', atk: ['red:K1', 'red:L8'], def: ['black:L2'] });
    expect(pend(r.state)).toMatchObject({ kind: 'reroll', player: 'red', dice: [2, 5] });
    r = seq(r, { type: 'reroll', player: 'red', source: 'commander', die: 0 });
    const ev = resolvedEv(r.events)[0];
    expect(ev.dice).toEqual([3, 5]);
    expect(ev.activating.attacker).toEqual(cs('red:L8'));
    expect(ev.outcome).toBe('attacker');
  });

  it('4b. ...if the defender holds a Commander it is asked first and may pass, then the attacker rerolls', () => {
    const s = buildState({ board: { '0,1': ['red:K1', 'red:L8'], '0,0': ['black:K1', 'black:L2'] }, dice: [2, 5, 3] });
    let r = fight(s, { target: '0,0', atk: ['red:K1', 'red:L8'], def: ['black:K1', 'black:L2'] });
    expect(pend(r.state).player).toBe('black');
    r = seq(r, { type: 'passReroll', player: 'black' });
    expect(pend(r.state).player).toBe('red');
    r = seq(r, { type: 'reroll', player: 'red', source: 'commander', die: 0 });
    // black gets another look (reroll resets the pass count)
    expect(pend(r.state)).toMatchObject({ kind: 'reroll', player: 'black' });
    r = seq(r, { type: 'passReroll', player: 'black' });
    expect(resolvedEv(r.events)[0]).toMatchObject({ dice: [3, 5], outcome: 'attacker' });
  });

  it('5. Ranged Archer on 1+6: Archer activates, defender Light 7 activates, Bloodbath; no defending Archer activated so the ranged Archer is immune: defender loses 1, attacker nothing', () => {
    const s = buildState({ board: { '0,2': ['red:A1'], '0,0': ['black:L7', 'black:L9'] }, dice: [1, 6] });
    const r = fight(s, { target: '0,0', atk: ['red:A1'], def: ['black:L7'] });
    const ev = resolvedEv(r.events)[0];
    expect(ev.activating.attacker).toEqual(cs('red:A1'));
    expect(ev.activating.defender).toEqual(cs('black:L7'));
    expect(ev.outcome).toBe('bloodbath');
    const q = settle(r);
    expect(q.state.destroyed.black).toEqual(cs('black:L7'));
    expect(q.state.destroyed.red).toEqual([]);
    expect(q.state.stacks['0,2']).toEqual(cs('red:A1'));
  });

  it('6. Defender commits only 1 card; attacker wins with 2 activations: only 1 casualty (capped)', () => {
    const s = buildState({ board: { '0,1': ['red:L5', 'red:H5'], '0,0': ['black:L8', 'black:L9'] }, dice: [2, 3] });
    const r = fight(s, { target: '0,0', atk: ['red:L5', 'red:H5'], def: ['black:L8'] });
    expect(resolvedEv(r.events)[0].counts.attacker).toBe(2);
    const q = settle(r);
    expect(q.state.destroyed.black).toEqual(cs('black:L8'));
    expect(eventsOf(q.events, 'casualties').flatMap((e) => e.cardIds)).toEqual(cs('black:L8'));
  });

  it('7. Fortified defender (Advantage) commits 4 cards; both sides activate: defender wins', () => {
    const s = buildState({
      board: { '0,1': ['red:H8'], '0,0': ['black:L8', 'black:L9', 'black:L10', 'black:H7', 'black:L6'] }, fortified: ['0,0'], dice: [4, 4],
    });
    let r = seq(s, { type: 'engage', player: 'red', target: '0,0', cardIds: cs('red:H8') });
    expect(pend(r.state)).toMatchObject({ kind: 'defend', max: 4 });
    r = seq(r, { type: 'defend', player: 'black', cardIds: cs('black:L8', 'black:L9', 'black:L10', 'black:H7') });
    const ev = resolvedEv(r.events)[0];
    expect(ev.activating.attacker).toEqual(cs('red:H8'));
    expect(ev.activating.defender).toEqual(cs('black:L8'));
    expect(ev).toMatchObject({ outcome: 'defender', winner: 'black' });
    expect(settle(r).state.destroyed.red).toEqual(cs('red:H8'));
  });

  it('8. Black holds Red Tower: start of Black next turn count 1, next 2, next 3 wins; clearing the Tower in between resets to 0', () => {
    const play = (clearAfter?: number) => {
      let s = buildState({ current: 'black', board: { '-1,1': ['black:L5'], '-2,1': ['red:L5'], '0,0': ['red:H6'] } });
      s = mustApply(s, { type: 'move', player: 'black', cardIds: cs('black:L5'), from: '-1,1', path: ['-1,2'] }).state;
      const counts: number[] = [];
      for (let i = 1; i <= 3 && s.phase === 'play'; i++) {
        s = mustApply(s, { type: 'endTurn', player: 'black' }).state;
        if (i === clearAfter) {
          // Red clears the Tower: red L5 to -1,1... then attack with dice
          s = mustApply(s, { type: 'move', player: 'red', cardIds: cs('red:L5'), from: '-2,1', path: ['-1,1'] }).state;
          const r = settle(fight({ ...s, diceQueue: [2, 3] }, { target: '-1,2', atk: ['red:L5'] }));
          s = r.state;
        }
        s = mustApply(s, { type: 'endTurn', player: 'red' }).state;
        if (s.phase === 'play') counts.push(s.towerCount.black);
      }
      return { s, counts };
    };
    const a = play();
    expect(a.counts).toEqual([1, 2]);
    expect(a.s.roundWins.black).toBe(1);
    expect(a.s.roundResults[0].reason).toBe('tower');
    const b = play(2);
    expect(b.counts).toEqual([1, 0, 0]);
    expect(b.s.phase).toBe('play');
    expect(b.s.roundWins.black).toBe(0);
  });
});
