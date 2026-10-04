import { describe, expect, it } from 'vitest';
import type { CardKind } from '@towers/engine';
import { fanLayout, rowLayout } from '../src/game/layout';

const HAND: CardKind[] = [
  ...(['shardbearer', 'shardbearer', 'cavalry', 'cavalry', 'archer', 'archer'] as CardKind[]),
  ...Array.from({ length: 8 }, () => 'heavy' as CardKind),
  ...Array.from({ length: 8 }, () => 'light' as CardKind),
  'wit',
];

describe('fanLayout', () => {
  it('fits the hand in the box, portraits wide, infantry at least a readable strip', () => {
    for (const [box, w] of [
      [928, 88],
      [770, 67],
    ] as const) {
      const lay = fanLayout(HAND, box, w);
      expect(lay.total).toBeLessThanOrEqual(box);
      const pitch = (i: number) => lay.x[i + 1] - lay.x[i];
      // characters: most of the face shows
      expect(pitch(0)).toBeGreaterThanOrEqual(w * 0.6);
      // infantry inside a group: at least the left strip (rank, type, reliability)
      expect(pitch(7)).toBeGreaterThanOrEqual(w * 0.3 - 0.01);
      expect(pitch(7)).toBeLessThan(pitch(0));
    }
  });

  it('separates the groups with a gap', () => {
    const lay = fanLayout(HAND, 928, 88);
    const inHeavy = lay.x[8] - lay.x[7];
    const heavyToLight = lay.x[14] - lay.x[13];
    expect(heavyToLight).toBeGreaterThan(inHeavy);
  });

  it('leaves room for a trailing pile', () => {
    const lay = fanLayout(HAND, 928, 88, 68);
    expect(lay.total).toBeLessThanOrEqual(928 - 68);
  });

  it('never overlaps when there is plenty of room', () => {
    const lay = fanLayout(['commander', 'heavy', 'light'], 900, 80);
    expect(lay.x[1] - lay.x[0]).toBeGreaterThanOrEqual(80);
    expect(lay.x[2] - lay.x[1]).toBeGreaterThanOrEqual(80);
  });

  it('shows the few cards you can pick whole, and ignores the flags when nearly all are open', () => {
    const hand: CardKind[] = ['commander', 'commander', ...HAND];
    const box = 1000;
    const w = 88;
    const plain = fanLayout(hand, box, w, 68);
    const lay = fanLayout(hand, box, w, 68, hand.map((k) => k === 'commander'));
    expect(lay.total).toBeLessThanOrEqual(box - 68);
    const pitch = (l: typeof lay, i: number) => l.x[i + 1] - l.x[i];
    expect(pitch(plain, 0)).toBeLessThan(w);
    expect(pitch(lay, 0)).toBeGreaterThanOrEqual(w);
    expect(pitch(lay, 1)).toBeGreaterThanOrEqual(w);
    // every other card keeps (nearly) its strip
    expect(pitch(lay, 10)).toBeGreaterThanOrEqual(w * 0.3 * 0.9);
    // all but the Wit open: no room to honour that, so the plain layout
    expect(fanLayout(hand, box, w, 68, hand.map((k) => k !== 'wit'))).toEqual(plain);
  });

  it('squeezes everything when even strips do not fit', () => {
    const lay = fanLayout(HAND, 400, 88);
    expect(lay.total).toBeLessThanOrEqual(400);
  });
});

describe('rowLayout', () => {
  it('keeps pickable rows readable and overlaps big watched rows into one line', () => {
    expect(rowLayout(3, true)).toEqual({ w: 66, step: null });
    expect(rowLayout(8, true).step).toBeNull();
    const watched = rowLayout(8, false);
    expect(watched.step).not.toBeNull();
    expect(7 * watched.step! + watched.w).toBeLessThanOrEqual(320);
    expect(rowLayout(4, false).step).toBeNull();
  });
});
