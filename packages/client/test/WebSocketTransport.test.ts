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

  it('sends the bot difficulty when creating a bot game', async () => {
    const p = WebSocketTransport.create('Ann', 'hard', deps);
    await flush();
    const ws = FakeWebSocket.last;
    ws.open();
    ws.receive({ t: 'welcome', username: 'Ann' });
    expect(ws.sent[1]).toEqual({ t: 'create', vsBot: true, botLevel: 'hard' });
    ws.receive({ t: 'joined', gameId: 'g2', seat: 'red', seatToken: 'tok' });
    ws.receive({
      t: 'presence',
      gameId: 'g2',
      players: { red: { name: 'Ann', connected: true, bot: false }, black: { name: 'Bot (Hard)', connected: true, bot: true, botLevel: 'hard' } },
    });
    const conn = await p;
    expect(conn.getPresence()?.black).toEqual({ name: 'Bot (Hard)', connected: true, bot: true, botLevel: 'hard' });
    expect(conn.getPresence()?.red).toEqual({ name: 'Ann', connected: true, bot: false });
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

describe('WebSocketTransport and the server protocol', () => {
  it('maps a presence entry with name null to an empty seat', async () => {
    const { conn, ws } = await created();
    const seen: unknown[] = [];
    conn.subscribe({ onPresence: (p) => seen.push(p) });
    ws.receive({
      t: 'presence',
      gameId: 'g1',
      players: { black: { name: 'Ann', connected: true, bot: false }, red: { name: null, connected: false, bot: false } },
    });
    expect(conn.getPresence()).toEqual({ black: { name: 'Ann', connected: true, bot: false }, red: null });
    expect(seen).toHaveLength(1);
  });

  it('keeps chat names and ignores history replayed on a re-join', async () => {
    const { conn, ws } = await created();
    const got: unknown[] = [];
    conn.subscribe({ onChat: (m) => got.push(m) });
    const line = { t: 'chat', gameId: 'g1', from: 'red', name: 'Bo', text: 'hi', ts: 5 };
    ws.receive(line);
    ws.receive(line);
    expect(conn.getChat()).toEqual([{ from: 'red', name: 'Bo', text: 'hi', ts: 5 }]);
    expect(got).toHaveLength(1);
  });

  it('rematch sends the finished game and seat token, then follows the new game', async () => {
    store.set('towers.seat.old', 'tok-old');
    const p = WebSocketTransport.rematch('Ann', { gameId: 'old', seat: 'red' }, deps);
    await flush();
    const ws = FakeWebSocket.last;
    ws.open();
    ws.receive({ t: 'welcome', username: 'Ann' });
    expect(ws.sent[1]).toEqual({ t: 'rematch', gameId: 'old', seatToken: 'tok-old' });
    ws.receive({ t: 'joined', gameId: 'new', seat: 'black', seatToken: 'tok-new' });
    const conn = await p;
    expect(conn.gameId).toBe('new');
    expect(store.get('towers.seat.new')).toBe('tok-new');
    // a reconnect re-joins the new game, not the old one
    ws.drop();
    await vi.advanceTimersByTimeAsync(150);
    const ws2 = FakeWebSocket.last;
    ws2.open();
    ws2.receive({ t: 'welcome', username: 'Ann' });
    expect(ws2.sent[1]).toEqual({ t: 'join', gameId: 'new', seatToken: 'tok-new' });
  });

  it('reports an opponent rematch offer', async () => {
    const { conn, ws } = await created();
    const offers: string[] = [];
    conn.subscribe({ onRematchOffer: (id) => offers.push(id) });
    ws.receive({ t: 'rematch', gameId: 'g1', next: 'g2', by: 'black' }); // our own seat: ignored
    ws.receive({ t: 'rematch', gameId: 'g1', next: 'g2', by: 'red' });
    expect(offers).toEqual(['g2']);
  });
});
