import { describe, expect, it } from 'vitest';
import { normalizeStats } from '../src/net/stats';

describe('normalizeStats', () => {
  it("flattens the server's PlayerStats and shows opponents by display name", () => {
    const d = normalizeStats({
      username: 'Bo',
      matchesPlayed: 3,
      matchesWon: 2,
      roundsWon: 5,
      roundsLost: 2,
      opponents: { ann: { name: 'Ann', played: 2, won: 1 }, bot: { name: 'Bot', played: 1, won: 1 } },
      characters: { venli: 4, rlain: 9 },
    });
    expect(d).toEqual({
      played: 3,
      won: 2,
      roundsWon: 5,
      roundsLost: 2,
      opponents: [
        { name: 'Ann', played: 2, won: 1 },
        { name: 'Bot', played: 1, won: 1 },
      ],
      characters: [
        { id: 'rlain', count: 9 },
        { id: 'venli', count: 4 },
      ],
    });
  });

  it('tolerates an empty or partial record', () => {
    expect(normalizeStats({})).toEqual({ played: 0, won: 0, roundsWon: 0, roundsLost: 0, opponents: [], characters: [] });
    expect(normalizeStats(null).opponents).toEqual([]);
  });
});
