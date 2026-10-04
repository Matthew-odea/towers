import { describe, expect, test } from 'vitest';
import { applyAction, chooseBotAction, createMatch, pendingDecision, validateAction, viewFor, type MatchState } from '../src/index';
import { chooseEasyAction } from '../src/bot/easy';
import { makeRandom } from '../src/rng';
import { simulate } from '../scripts/sim';

describe('easy bot', () => {
  test('plays complete games against medium and random with legal actions and no invariant violations', () => {
    for (let i = 0; i < 3; i++) {
      for (const bots of [
        { red: 'easy', black: 'random' },
        { red: 'medium', black: 'easy' },
        { red: 'easy', black: 'easy' },
      ] as const) {
        const r = simulate(`easy-${i}`, 300, true, { bots: { ...bots } });
        expect(r.errors).toEqual([]);
      }
    }
  });

  test('is deterministic given rand and always returns a legal action', () => {
    let s: MatchState = createMatch({ seed: 'easy-det' });
    for (let n = 0; n < 150 && s.phase !== 'matchOver'; n++) {
      const d = pendingDecision(s);
      const p = d.players[0]!;
      const a = chooseEasyAction(viewFor(s, p), p, makeRandom(`r${n}`));
      const b = chooseEasyAction(viewFor(s, p), p, makeRandom(`r${n}`));
      expect(a).toEqual(b);
      expect(a).not.toBeNull();
      expect(validateAction(s, a!)).toBeNull();
      const r = chooseBotAction(viewFor(s, p), p, { level: 'easy', rand: makeRandom(`r${n}`) });
      expect(r).toEqual(a);
      const res = applyAction(s, a!);
      if (!res.ok) throw new Error(res.error);
      s = res.state;
    }
  });

  test('returns null when the player has no pending decision', () => {
    const s = createMatch({ seed: 'easy-null' });
    const d = pendingDecision(s);
    const other = (d.players[0] === 'red' ? 'black' : 'red') as 'red' | 'black';
    expect(chooseEasyAction(s, other, makeRandom('x'))).toBeNull();
  });

  test('decides quickly', () => {
    const r = simulate('easy-speed', 300, false, { bots: { red: 'easy', black: 'random' }, collectTiming: true });
    const ts = r.timing.easy ?? [];
    expect(ts.length).toBeGreaterThan(0);
    const mean = ts.reduce((a, b) => a + b, 0) / ts.length;
    expect(mean).toBeLessThan(5);
  });
});

