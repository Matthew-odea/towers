import { describe, expect, test } from 'vitest';
import {
  ALL_HEXES,
  HOME_EDGE,
  TOWER,
  areAdjacent,
  commonNeighbors,
  createMatch,
  distance,
  lineOfSight,
  mirror,
  neighbors,
} from '../src/index';
import { hashSeed, makeRandom, seedRng, nextFloat } from '../src/rng';
import { buildState } from './helpers';

describe('§3 board geometry', () => {
  test('19 hexes, radius 2, rows 3-4-5-4-3', () => {
    expect(ALL_HEXES).toHaveLength(19);
    const rows = [-2, -1, 0, 1, 2].map((r) => ALL_HEXES.filter((h) => Number(h.split(',')[1]) === r).length);
    expect(rows).toEqual([3, 4, 5, 4, 3]);
  });

  test('Towers are the middle hex of each home edge', () => {
    expect(TOWER.red).toBe('-1,2');
    expect(TOWER.black).toBe('1,-2');
    expect(HOME_EDGE.red[1]).toBe(TOWER.red);
    expect(HOME_EDGE.black[1]).toBe(TOWER.black);
    expect(mirror(TOWER.red)).toBe(TOWER.black);
  });

  test('distance, adjacency and neighbours', () => {
    expect(distance('0,0', '0,2')).toBe(2);
    expect(distance('-1,2', '1,-2')).toBe(4);
    expect(areAdjacent('0,0', '1,-1')).toBe(true);
    expect(areAdjacent('0,0', '1,1')).toBe(false);
    expect(neighbors('0,0')).toHaveLength(6);
    expect(neighbors('-1,2').sort()).toEqual(['-1,1', '-2,2', '0,1', '0,2'].sort());
    expect(commonNeighbors('0,2', '0,0')).toEqual(['0,1']);
    expect(commonNeighbors('1,1', '0,0').sort()).toEqual(['0,1', '1,0'].sort());
  });
});

describe('§3 terrain generation', () => {
  test.each(Array.from({ length: 40 }, (_, i) => `seed-${i}`))('point-symmetric with the right counts (%s)', (seed) => {
    const s = createMatch({ seed });
    const t = s.terrain;
    expect(Object.keys(t)).toHaveLength(19);
    for (const h of ALL_HEXES) expect(t[h]).toBe(t[mirror(h)]);
    expect(t[TOWER.red]).toBe('tower');
    expect(t[TOWER.black]).toBe('tower');
    for (const p of ['red', 'black'] as const) {
      for (const h of HOME_EDGE[p]) if (h !== TOWER[p]) expect(t[h]).toBe('plains');
    }
    expect(['plains', 'forest', 'mountain']).toContain(t['0,0']);
    const rest = ALL_HEXES.filter((h) => h !== '0,0' && !HOME_EDGE.red.includes(h) && !HOME_EDGE.black.includes(h));
    expect(rest).toHaveLength(12);
    const count = (k: string) => rest.filter((h) => t[h] === k).length;
    expect(count('forest')).toBe(4);
    expect(count('mountain')).toBe(2);
    expect(count('plains')).toBe(6);
  });

  test('terrain varies between seeds and is deterministic per seed', () => {
    const a = createMatch({ seed: 'x' }).terrain;
    expect(createMatch({ seed: 'x' }).terrain).toEqual(a);
    const distinct = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(createMatch({ seed: `v${i}` }).terrain)));
    expect(distinct.size).toBeGreaterThan(10);
    const centres = new Set(Array.from({ length: 60 }, (_, i) => createMatch({ seed: `c${i}` }).terrain['0,0']));
    expect(centres).toEqual(new Set(['plains', 'forest', 'mountain']));
  });
});

describe('§7.3 line of sight', () => {
  test('straight shot blocked only by Forest in the middle hex', () => {
    expect(lineOfSight(buildState(), '0,2', '0,0')).toBe(true);
    expect(lineOfSight(buildState({ terrain: { '0,1': 'forest' } }), '0,2', '0,0')).toBe(false);
    expect(lineOfSight(buildState({ terrain: { '0,1': 'mountain' } }), '0,2', '0,0')).toBe(true);
  });

  test('off-axis shot blocked only if both middle hexes are Forest', () => {
    expect(lineOfSight(buildState({ terrain: { '1,0': 'forest' } }), '1,1', '0,0')).toBe(true);
    expect(lineOfSight(buildState({ terrain: { '0,1': 'forest' } }), '1,1', '0,0')).toBe(true);
    expect(lineOfSight(buildState({ terrain: { '0,1': 'forest', '1,0': 'forest' } }), '1,1', '0,0')).toBe(false);
  });

  test("units, Towers and the ends' own terrain never block", () => {
    const s = buildState({ terrain: { '0,2': 'forest', '0,0': 'forest' }, board: { '0,1': ['black:L5'] } });
    expect(lineOfSight(s, '0,2', '0,0')).toBe(true);
  });

  test('only defined at distance exactly 2', () => {
    expect(lineOfSight(buildState(), '0,1', '0,0')).toBe(false);
    expect(lineOfSight(buildState(), '0,2', '0,-1')).toBe(false);
  });
});

describe('seeded PRNG', () => {
  test('sfc32 is deterministic and seed-sensitive', () => {
    const a = seedRng('abc');
    const b = seedRng('abc');
    const xs = Array.from({ length: 5 }, () => nextFloat(a));
    expect(Array.from({ length: 5 }, () => nextFloat(b))).toEqual(xs);
    expect(hashSeed('abc')).not.toEqual(hashSeed('abd'));
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });

  test('dice are roughly uniform', () => {
    const r = makeRandom('dice');
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 60000; i++) counts[Math.floor(r() * 6)]++;
    for (const n of counts) expect(Math.abs(n - 10000)).toBeLessThan(500);
  });
});
