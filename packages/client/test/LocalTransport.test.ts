import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pendingDecision } from '@towers/engine';
import { LocalTransport } from '../src/net/LocalTransport';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('LocalTransport', () => {
  it('starts in setup with presence for both seats', () => {
    const t = new LocalTransport({ name: 'Ann', seed: 's1' });
    expect(t.seat).toBe('red');
    expect(t.getLatest()?.view.phase).toBe('setup');
    expect(t.getPresence()?.black).toEqual({ name: 'Bot', connected: true, bot: true });
    t.close();
  });

  it('paces the bot at ~600 ms per step', async () => {
    const t = new LocalTransport({ name: 'Ann', seed: 's1' });
    const onState = vi.fn();
    t.subscribe({ onState });
    await vi.advanceTimersByTimeAsync(599);
    expect(onState).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(onState).toHaveBeenCalledTimes(1);
    expect(t.getLatest()?.view.setup.black.submitted).toBe(true);
    t.close();
  });

  it('reports illegal actions and ignores them', () => {
    const t = new LocalTransport({ name: 'Ann', seed: 's1' });
    const onError = vi.fn();
    t.subscribe({ onError });
    t.sendAction({ type: 'endTurn', player: 'red' });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'illegal' }));
    t.close();
  });

  it('plays a full match against the bot via concede', async () => {
    const t = new LocalTransport({ name: 'Ann', seed: 's2', paceMs: 10 });
    for (let i = 0; i < 2; i++) {
      await vi.advanceTimersByTimeAsync(50);
      t.sendAction({ type: 'concede', player: 'red' });
    }
    await vi.advanceTimersByTimeAsync(500);
    const v = t.getLatest()!.view;
    expect(v.phase).toBe('matchOver');
    expect(v.winner).toBe('black');
    expect(pendingDecision(v).kind).toBe('matchOver');
    t.close();
  });

  it('stops after close', async () => {
    const t = new LocalTransport({ name: 'Ann', seed: 's1' });
    const onState = vi.fn();
    t.subscribe({ onState });
    t.close();
    await vi.advanceTimersByTimeAsync(2000);
    expect(onState).not.toHaveBeenCalled();
  });
});
