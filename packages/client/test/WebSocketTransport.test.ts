import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketTransport } from '../src/net/WebSocketTransport';
import { FakeWebSocket, asImpl } from './fakeWs';

const store = new Map<string, string>();
beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.reset();
  store.clear();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});
afterEach(() => vi.useRealTimers());

const deps = { wsUrl: async () => 'ws://x/ws', WebSocketImpl: asImpl, backoff: [100, 200], pingMs: 300_000 };
const flush = async () => { await vi.advanceTimersByTimeAsync(0); };

async function created(vsBot = false) {
  const p = WebSocketTransport.create('Ann', vsBot, deps);
  await flush();
  const ws = FakeWebSocket.last;
  ws.open();
  expect(ws.sent[0]).toEqual({ t: 'hello', username: 'Ann' });
  ws.receive({ t: 'welcome', username: 'Ann' });
  expect(ws.sent[1]).toEqual({ t: 'create', vsBot });
  ws.receive({ t: 'joined', gameId: 'g1', seat: 'black', seatToken: 'tok' });
  return { conn: await p, ws };
}

describe('WebSocketTransport', () => {
  it('creates a game and stores the seat token', async () => {
    const { conn } = await created();
    expect(conn.gameId).toBe('g1');
    expect(conn.seat).toBe('black');
    expect(store.get('towers.seat.g1')).toBe('tok');
  });

  it('joins with a stored token', async () => {
    store.set('towers.seat.abc', 'old');
    const p = WebSocketTransport.join('Bo', 'abc', deps);
    await flush();
    const ws = FakeWebSocket.last;
    ws.open();
    ws.receive({ t: 'welcome', username: 'Bo' });
    expect(ws.sent[1]).toEqual({ t: 'join', gameId: 'abc', seatToken: 'old' });
    ws.receive({ t: 'joined', gameId: 'abc', seat: 'red', seatToken: 'old' });
    expect((await p).seat).toBe('red');
  });

  it('rejects a full game', async () => {
    const p = WebSocketTransport.join('Bo', 'abc', deps);
    const caught = p.catch((e) => e);
    await flush();
    const ws = FakeWebSocket.last;
    ws.open();
    ws.receive({ t: 'welcome', username: 'Bo' });
    ws.receive({ t: 'error', code: 'full', message: 'Game is full' });
    expect((await caught).code).toBe('full');
  });

  it('delivers state, chat, presence and sends actions with expectedVersion', async () => {
    const { conn, ws } = await created();
    const onState = vi.fn(), onChat = vi.fn(), onPresence = vi.fn();
    conn.subscribe({ onState, onChat, onPresence });
    ws.receive({ t: 'state', gameId: 'g1', view: { round: 1 }, events: [], version: 4 });
    ws.receive({ t: 'state', gameId: 'g1', view: { round: 0 }, events: [], version: 2 }); // stale, ignored
    ws.receive({ t: 'chat', gameId: 'g1', from: 'Bo', text: 'hi', ts: 1 });
    ws.receive({ t: 'presence', gameId: 'g1', players: { red: null, black: { name: 'Ann', connected: true, bot: false } } });
    expect(onState).toHaveBeenCalledTimes(1);
    expect(conn.getLatest()?.version).toBe(4);
    expect(conn.getChat()).toHaveLength(1);
    expect(onPresence).toHaveBeenCalled();
    conn.sendAction({ type: 'endTurn', player: 'black' });
    expect(ws.sent.at(-1)).toMatchObject({ t: 'action', gameId: 'g1', seatToken: 'tok', expectedVersion: 4 });
    conn.sendChat('  yo ');
    expect(ws.sent.at(-1)).toMatchObject({ t: 'chat', text: 'yo' });
  });

  it('surfaces server errors to listeners', async () => {
    const { conn, ws } = await created();
    const onError = vi.fn();
    conn.subscribe({ onError });
    ws.receive({ t: 'error', code: 'stale', message: 'stale' });
    expect(onError).toHaveBeenCalledWith({ code: 'stale', message: 'stale' });
  });

  it('reconnects with backoff and re-joins with the seat token', async () => {
    const { conn, ws } = await created();
    ws.drop();
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const ws2 = FakeWebSocket.last;
    ws2.open();
    ws2.receive({ t: 'welcome', username: 'Ann' });
    expect(ws2.sent[1]).toEqual({ t: 'join', gameId: 'g1', seatToken: 'tok' });
    ws2.receive({ t: 'joined', gameId: 'g1', seat: 'black', seatToken: 'tok' });
    ws2.drop();
    await vi.advanceTimersByTimeAsync(100); // attempts reset after a successful join
    expect(FakeWebSocket.instances).toHaveLength(3);
    conn.close();
    FakeWebSocket.last.drop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('pings every 5 minutes', async () => {
    const { ws } = await created();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(ws.sent.at(-1)).toEqual({ t: 'ping' });
  });

  it('fails creation when the server is unreachable', async () => {
    const p = WebSocketTransport.create('Ann', true, deps);
    const caught = p.catch((e) => e);
    await flush();
    FakeWebSocket.last.drop();
    await vi.advanceTimersByTimeAsync(100);
    FakeWebSocket.last.drop();
    expect((await caught).code).toBe('unreachable');
  });
});
