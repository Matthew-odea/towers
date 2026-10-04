import { describe, expect, it } from 'vitest';
import type { GameEvent, PlayerView } from '@towers/engine';
import { appendLog, logLines, type LogEntry } from '../src/game/log';

const view = {
  cards: {
    'red-commander-dalinar': { id: 'red-commander-dalinar', owner: 'red', kind: 'commander', character: 'dalinar' },
    'red-light-7': { id: 'red-light-7', owner: 'red', kind: 'light', rank: 7 },
  },
  terrain: { '-2,1': 'plains', '-2,0': 'plains', '-1,-1': 'forest', '1,-2': 'tower' },
} as unknown as PlayerView;

let id = 0;
const lines = (e: GameEvent): LogEntry[] => logLines(e, view).map((l) => ({ ...l, id: ++id }));
const move = (from: string, to: string): GameEvent =>
  ({ type: 'moved', player: 'red', cardIds: ['red-commander-dalinar', 'red-light-7'], from, path: [to], to, charge: false }) as GameEvent;

describe('log', () => {
  it('merges consecutive moves of the same group into one line naming where it ended', () => {
    let log: LogEntry[] = [];
    log = appendLog(log, lines(move('-2,2', '-2,1')));
    log = appendLog(log, lines(move('-2,1', '-2,0')));
    log = appendLog(log, lines(move('-2,0', '-1,-1')));
    expect(log.map((l) => l.text)).toEqual(['Dalinar, Light 7 move 3 hexes to the forest']);
  });

  it('starts a new line for a different group or a non-continuing move', () => {
    let log = appendLog([], lines(move('-2,2', '-2,1')));
    log = appendLog(log, lines({ ...(move('0,2', '1,-2') as object), cardIds: ['red-light-7'] } as GameEvent));
    expect(log.map((l) => l.text)).toEqual(['Dalinar, Light 7 move 1 hex to the plains', 'Light 7 move 1 hex to the Singers Tower']);
  });

  it('writes the dice with their total', () => {
    expect(lines({ type: 'diceRolled', dice: [3, 4], roll: 1 } as unknown as GameEvent)[0].text).toBe('Dice 3 4 = 7');
  });
});
