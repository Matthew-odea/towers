import { describe, expect, it } from 'vitest';
import type { CpActionType } from '@towers/engine';
import { capHint } from '../src/game/hints';
import { plateLabel } from '../src/game/cardInfo';

const caps = (over: Partial<Record<CpActionType, number>>): Record<CpActionType, number> => ({
  move: 1,
  engage: 1,
  deploy: 1,
  withdraw: 1,
  fortify: 1,
  reinforce: 1,
  spawnWit: 1,
  ...over,
});

describe('capHint', () => {
  it('explains a used-up Move cap while CP remain and a stack is selected', () => {
    expect(capHint(1, caps({ move: 0 }), true)).toMatch(/Move used 3 times/);
    expect(capHint(1, caps({ move: 0, withdraw: 0 }), true)).toMatch(/Move and Withdraw/);
  });
  it('says nothing otherwise', () => {
    expect(capHint(1, caps({}), true)).toBeNull();
    expect(capHint(0, caps({ move: 0 }), true)).toBeNull();
    expect(capHint(1, caps({ move: 0 }), false)).toBeNull();
  });
});

describe('plateLabel', () => {
  it('never goes under 10px and shortens names that cannot fit', () => {
    expect(plateLabel('Lunamor', 88)).toEqual({ text: 'Lunamor', size: expect.any(Number) });
    expect(plateLabel('Lunamor', 40).size).toBe(10);
    expect(plateLabel('Lunamor', 40).text).toBe('Luna');
    expect(plateLabel('Hoid', 210).size).toBeLessThanOrEqual(15);
  });
});
