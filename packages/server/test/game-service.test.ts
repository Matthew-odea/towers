import { beforeEach, describe, expect, test } from 'vitest';
import { chooseBotAction, pendingDecision, type Action, type PlayerId, type PlayerView, type GameEvent } from '@towers/engine';
import { GameService } from '../src/core/game-service';
import { MemoryConnectionStore, MemoryGameStore, MemoryStatsStore } from '../src/core/memory-stores';
import { MAX_CHAT_KEPT, type ServerMessage } from '../src/core/protocol';
import { TokenBucketLimiter } from '../src/core/rate-limit';
import { Bus } from './helpers';

let bus: Bus;
let games: MemoryGameStore;
let stats: MemoryStatsStore;
let svc: GameService;
let now: number;
const errors: unknown[] = [];

beforeEach(() => {
  bus = new Bus();
  games = new MemoryGameStore();
  stats = new MemoryStatsStore();
  now = Date.UTC(2026, 0, 1);
  svc = new GameService({
    games,
    connections: new MemoryConnectionStore(),
    stats,
    out: bus,
    clock: { now: () => now },
    log: (m, e) => errors.push([m, e]),
  });
});

const send = (c: string, m: unknown) => svc.handleMessage(c, typeof m === 'string' ? m : JSON.stringify(m));
async function connect(c: string, name?: string) {
  await svc.handleConnect(c);
  if (name) await send(c, { t: 'hello', username: name });
}
interface Seat { c: string; seat: PlayerId; token: string }
async function create(c: string, vsBot = false): Promise<Seat & { gameId: string }> {
  await send(c, { t: 'create', vsBot });
  const j = bus.last(c, 'joined')!;
  return { c, seat: j.seat, token: j.seatToken, gameId: j.gameId };
}
async function join(c: string, gameId: string, token?: string): Promise<Seat> {
  await send(c, { t: 'join', gameId, seatToken: token });
  const j = bus.last(c, 'joined')!;
  return { c, seat: j.seat, token: j.seatToken };
}
const view = (c: string) => bus.last(c, 'state')!.view;
const version = (c: string) => bus.last(c, 'state')!.version;
async function act(s: Seat, gameId: string, action: Action, expected = version(s.c)) {
  await send(s.c, { t: 'action', gameId, seatToken: s.token, action, expectedVersion: expected });
}
const lastError = (c: string) => bus.last(c, 'error');

describe('validation', () => {
  test('rejects malformed JSON, non-objects, unknown types, oversize', async () => {
    await connect('a');
    await send('a', '{nope');
    expect(lastError('a')?.code).toBe('bad_json');
    await send('a', '[1,2]');
    expect(lastError('a')?.code).toBe('bad_message');
    await send('a', { t: 'dance' });
    expect(lastError('a')?.code).toBe('unknown_type');
    await send('a', JSON.stringify({ t: 'hello', username: 'x'.repeat(17000) }));
    expect(lastError('a')?.code).toBe('too_large');
    // multi-byte characters count as bytes
    await send('a', JSON.stringify({ t: 'hello', username: '€'.repeat(6000) }));
    expect(lastError('a')?.code).toBe('too_large');
  });

  test('ping/pong, hello validation, create needs hello', async () => {
    await connect('a');
    await send('a', { t: 'ping' });
    expect(bus.last('a', 'pong')).toBeTruthy();
    await send('a', { t: 'create', vsBot: false });
    expect(lastError('a')?.code).toBe('need_hello');
    await send('a', { t: 'hello', username: '   ' });
    expect(lastError('a')?.code).toBe('bad_username');
    await send('a', { t: 'hello', username: '  Kal  ' });
    expect(bus.last('a', 'welcome')?.username).toBe('Kal');
  });

  test('join unknown game', async () => {
    await connect('a', 'Ann');
    await send('a', { t: 'join', gameId: 'nope' });
    expect(lastError('a')?.code).toBe('not_found');
  });
});

describe('lobby', () => {
  test('create, join, full, seats are different and tokens differ', async () => {
    await connect('a', 'Ann');
    await connect('b', 'Bo');
    await connect('c', 'Cy');
    const g = await create('a');
    expect(bus.ofType('a', 'state')).toHaveLength(0); // waiting for opponent
    expect(bus.last('a', 'presence')?.players[g.seat]).toMatchObject({ name: 'Ann', connected: true, bot: false });
    const other = g.seat === 'red' ? 'black' : 'red';
    expect(bus.last('a', 'presence')?.players[other]).toMatchObject({ name: null, connected: false });

    const b = await join('b', g.gameId);
    expect(b.seat).toBe(other);
    expect(b.token).not.toBe(g.token);
    expect(view('a').names[g.seat]).toBe('Ann');
    expect(view('b').names[b.seat]).toBe('Bo');
    expect(view('a').viewer).toBe(g.seat);
    expect(view('b').viewer).toBe(b.seat);
    expect(bus.last('a', 'presence')?.players[other].connected).toBe(true);

    await send('c', { t: 'join', gameId: g.gameId });
    expect(lastError('c')?.code).toBe('full');
  });

  test('creator seat is random', async () => {
    const seen = new Set<PlayerId>();
    for (let i = 0; i < 40; i++) {
      await connect(`c${i}`, 'x');
      seen.add((await create(`c${i}`)).seat);
    }
    expect(seen.size).toBe(2);
  });

  test('reconnect with seatToken reclaims the seat, state is re-sent; presence tracks disconnects', async () => {
    await connect('a', 'Ann');
    await connect('b', 'Bo');
    const g = await create('a');
    const b = await join('b', g.gameId);
    await svc.handleDisconnect('b');
    expect(bus.last('a', 'presence')?.players[b.seat].connected).toBe(false);

    await connect('b2'); // no hello needed to reclaim
    const r = await join('b2', g.gameId, b.token);
    expect(r).toEqual({ c: 'b2', seat: b.seat, token: b.token });
    expect(view('b2').viewer).toBe(b.seat);
    expect(bus.last('a', 'presence')?.players[b.seat].connected).toBe(true);

    // a bad token with no open seat is "full"
    await connect('x', 'Xi');
    await send('x', { t: 'join', gameId: g.gameId, seatToken: 'bogus' });
    expect(lastError('x')?.code).toBe('full');
  });

  test('gone connections are dropped on send', async () => {
    await connect('a', 'Ann');
    await connect('b', 'Bo');
    const g = await create('a');
    await join('b', g.gameId);
    bus.gone.add('b');
    await send('a', { t: 'chat', gameId: g.gameId, seatToken: g.token, text: 'hi' });
    await send('a', { t: 'chat', gameId: g.gameId, seatToken: g.token, text: 'hi2' });
    expect(bus.last('a', 'presence')).toBeTruthy();
  });
});

async function twoPlayers() {
  await connect('a', 'Ann');
  await connect('b', 'Bo');
  const a = await create('a');
  const b = await join('b', a.gameId);
  return { a, b, gameId: a.gameId, red: a.seat === 'red' ? a : b, black: a.seat === 'red' ? b : a };
}

describe('actions', () => {
  test("setup: opponent's unsubmitted placement never leaks; reveal after both submit", async () => {
    const { a, b, gameId } = await twoPlayers();
    const act1 = chooseBotAction(view(a.c), a.seat)!;
    expect(act1.type).toBe('setupPlace');
    await act(a, gameId, act1);
    expect(lastError(a.c)).toBeUndefined();
    const aView = view(a.c);
    const bView = view(b.c);
    expect(aView.setup[a.seat].placements).not.toBeNull();
    expect(bView.setup[a.seat].submitted).toBe(true);
    expect(bView.setup[a.seat].placements).toBeNull();
    // opponent's chosen hexes are nowhere in b's payload
    const bPayload = JSON.stringify(bus.all(b.c).filter((m) => m.t === 'state'));
    for (const p of (act1 as Extract<Action, { type: 'setupPlace' }>).placements) {
      expect(bPayload).not.toContain(`"${p.cardId}":"${p.hex}"`);
    }
    expect(bPayload).not.toContain('"seed"');
    expect(bPayload).not.toContain('"rng"');
    expect(bus.last(b.c, 'state')!.events.some((e) => e.type === 'setupRevealed')).toBe(false);

    await act(b, gameId, chooseBotAction(view(b.c), b.seat)!);
    for (const c of [a.c, b.c]) {
      const v = view(c);
      expect(v.phase).toBe('play');
      expect(v.setup.red.placements).not.toBeNull();
      expect(v.setup.black.placements).not.toBeNull();
      expect(bus.last(c, 'state')!.events.some((e) => e.type === 'setupRevealed')).toBe(true);
    }
    expect(version(a.c)).toBe(version(b.c));
    expect(version(a.c)).toBe(2);
  });

  test('token and seat checks', async () => {
    const { a, b, gameId } = await twoPlayers();
    const mine = chooseBotAction(view(a.c), a.seat)!;
    // wrong token
    await send(a.c, { t: 'action', gameId, seatToken: 'bad', action: mine, expectedVersion: 0 });
    expect(lastError(a.c)?.code).toBe('bad_seat');
    // b's token with a's player
    await send(b.c, { t: 'action', gameId, seatToken: b.token, action: mine, expectedVersion: 0 });
    expect(lastError(b.c)?.code).toBe('bad_seat');
    // not an action
    await send(a.c, { t: 'action', gameId, seatToken: a.token, action: 'x', expectedVersion: 0 });
    expect(lastError(a.c)?.code).toBe('bad_message');
    await send(a.c, { t: 'action', gameId, seatToken: a.token, action: mine });
    expect(lastError(a.c)?.code).toBe('bad_message');
    // illegal action
    await act(a, gameId, { type: 'endTurn', player: a.seat }, 0);
    expect(lastError(a.c)?.code).toBe('illegal');
    expect(version(a.c)).toBe(0);
  });

  test('stale expectedVersion -> error and current state re-sent', async () => {
    const { a, b, gameId } = await twoPlayers();
    await act(a, gameId, chooseBotAction(view(a.c), a.seat)!);
    expect(version(b.c)).toBe(1);
    const before = bus.ofType(b.c, 'state').length;
    await act(b, gameId, chooseBotAction(view(b.c), b.seat)!, 0);
    expect(lastError(b.c)?.code).toBe('stale');
    const after = bus.ofType(b.c, 'state');
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)!.version).toBe(1);
    expect(after.at(-1)!.view.viewer).toBe(b.seat);
    // nothing was applied and a's inbox did not get it
    expect(bus.ofType(a.c, 'state').at(-1)!.version).toBe(1);
  });

  test('actions before the opponent joins are rejected', async () => {
    await connect('a', 'Ann');
    const a = await create('a');
    await send('a', {
      t: 'action', gameId: a.gameId, seatToken: a.token, expectedVersion: 0,
      action: { type: 'concede', player: a.seat },
    });
    expect(lastError('a')?.code).toBe('not_started');
  });
});

describe('chat', () => {
  test('trims, limits, broadcasts, keeps last 50, replays on join', async () => {
    const { a, b, gameId } = await twoPlayers();
    await send(a.c, { t: 'chat', gameId, seatToken: a.token, text: '   hello there  ' });
    for (const c of [a.c, b.c]) {
      expect(bus.last(c, 'chat')).toMatchObject({ from: a.seat, name: 'Ann', text: 'hello there' });
    }
    await send(a.c, { t: 'chat', gameId, seatToken: a.token, text: '   ' });
    expect(lastError(a.c)?.code).toBe('bad_chat');
    await send(a.c, { t: 'chat', gameId, seatToken: a.token, text: 'x'.repeat(301) });
    expect(lastError(a.c)?.code).toBe('bad_chat');
    await send(a.c, { t: 'chat', gameId, seatToken: a.token, text: 'x'.repeat(300) });
    expect(bus.last(a.c, 'chat')!.text).toHaveLength(300);
    await send(a.c, { t: 'chat', gameId, seatToken: 'nope', text: 'hi' });
    expect(lastError(a.c)?.code).toBe('bad_seat');

    for (let i = 0; i < 60; i++) await send(b.c, { t: 'chat', gameId, seatToken: b.token, text: `m${i}` });
    await connect('b2');
    bus.clear('b2');
    await join('b2', gameId, b.token);
    const replay = bus.ofType('b2', 'chat');
    expect(replay).toHaveLength(MAX_CHAT_KEPT);
    expect(replay[0]!.text).toBe('m10');
    expect(replay.at(-1)!.text).toBe('m59');
  });
});

describe('bot games', () => {
  test('create vs bot: bot seat flagged, bot acts until a human decision is pending', async () => {
    await connect('a', 'Ann');
    const g = await create('a', true);
    const botSeat: PlayerId = g.seat === 'red' ? 'black' : 'red';
    expect(bus.last('a', 'presence')?.players[botSeat]).toMatchObject({ name: 'Bot', bot: true, connected: true });
    const v = view('a');
    expect(v.names[botSeat]).toBe('Bot');
    expect(v.setup[botSeat].submitted).toBe(true);
    expect(v.setup[botSeat].placements).toBeNull();
    expect(pendingDecision(v).players).toEqual([g.seat]);
  });

  test('a bot game driven to the end of round 1, steps broadcast one by one; stats recorded at match end', async () => {
    await connect('a', 'Ann');
    const g = await create('a', true);
    const events: GameEvent[] = [];
    let roundWon = false;
    let humanActions = 0;
    let lastVersion = version('a');
    let guard = 0;
    while (!roundWon && guard++ < 6000) {
      const v = view('a');
      const act0 = chooseBotAction(v, g.seat);
      expect(act0, 'human has a decision').not.toBeNull();
      const from = bus.ofType('a', 'state').length;
      await act(g, g.gameId, act0!);
      expect(lastError('a')).toBeUndefined();
      humanActions++;
      const steps = bus.ofType('a', 'state').slice(from);
      // versions are contiguous: one state message per applied action
      for (const s of steps) {
        expect(s.version).toBe(++lastVersion);
        events.push(...s.events);
        if (s.events.some((e) => e.type === 'roundWon')) roundWon = true;
      }
      if (humanActions > 4000) break;
    }
    expect(roundWon, 'round 1 should finish under random play').toBe(true);
    expect(events.some((e) => e.type === 'engagementStarted')).toBe(true);

    // independent count of character commits per seat from the observed events
    const cards = view('a').cards;
    const expected: Record<PlayerId, Record<string, number>> = { red: {}, black: {} };
    for (const e of events) {
      if (e.type !== 'engagementStarted') continue;
      for (const id of new Set([...e.attackerCards, ...e.rangedArchers, ...e.defenderCards])) {
        const c = cards[id]!;
        if (c.character) expected[c.owner][c.character] = (expected[c.owner][c.character] ?? 0) + 1;
      }
    }

    // finish the match by conceding every round
    const rounds = view('a').roundWins;
    expect(rounds.red + rounds.black).toBe(1);
    let guard2 = 0;
    while (view('a').phase !== 'matchOver' && guard2++ < 4) {
      const concede: Action = { type: 'concede', player: g.seat };
      await act(g, g.gameId, concede);
      expect(lastError('a')).toBeUndefined();
    }
    const finalView = view('a');
    expect(finalView.phase).toBe('matchOver');
    const s = await stats.get('ann');
    expect(s).toBeTruthy();
    expect(s!.username).toBe('Ann');
    expect(s!.matchesPlayed).toBe(1);
    expect(s!.matchesWon).toBe(finalView.winner === g.seat ? 1 : 0);
    expect(s!.opponents['bot']).toMatchObject({ name: 'Bot', played: 1 });
    const botSeat: PlayerId = g.seat === 'red' ? 'black' : 'red';
    expect(s!.roundsWon).toBe(finalView.roundWins[g.seat]);
    expect(s!.roundsLost).toBe(finalView.roundWins[botSeat]);
    expect(s!.characters).toEqual(expected[g.seat]);
    expect(await stats.get('bot')).toBeNull();

    // a finished match rejects further actions and does not double count
    await act(g, g.gameId, { type: 'concede', player: g.seat });
    expect(lastError('a')?.code).toBe('illegal');
    expect((await stats.get('ann'))!.matchesPlayed).toBe(1);
  }, 60_000);
});

describe('stats', () => {
  test('two humans: concede twice, both get records; case-insensitive key; stats request', async () => {
    const { a, b, gameId } = await twoPlayers();
    for (const s of [a, b]) await act(s, gameId, chooseBotAction(view(s.c), s.seat)!);
    // red concedes both rounds
    const red = a.seat === 'red' ? a : b;
    const black = red === a ? b : a;
    for (let i = 0; i < 2; i++) {
      if (view(red.c).phase === 'setup') {
        // round 2 starts in setup; conceding is legal there too
      }
      await act(red, gameId, { type: 'concede', player: 'red' });
      expect(lastError(red.c)).toBeUndefined();
    }
    expect(view(red.c).phase).toBe('matchOver');
    expect(view(red.c).winner).toBe('black');

    await send(red.c, { t: 'stats', username: red === a ? 'ANN' : 'BO' });
    const rs = bus.last(red.c, 'stats')!;
    expect(rs.stats).toMatchObject({ matchesPlayed: 1, matchesWon: 0, roundsWon: 0, roundsLost: 2 });
    await send(black.c, { t: 'stats', username: black === a ? 'ann' : 'bo' });
    const bs = bus.last(black.c, 'stats')!;
    expect(bs.stats).toMatchObject({ matchesPlayed: 1, matchesWon: 1, roundsWon: 2, roundsLost: 0 });
    expect(Object.values(bs.stats.opponents)[0]).toMatchObject({ played: 1, won: 1 });

    await send(red.c, { t: 'stats', username: 'Nobody' });
    expect(bus.last(red.c, 'stats')!.stats).toMatchObject({ username: 'Nobody', matchesPlayed: 0 });
  });
});

describe('expiry', () => {
  test('games expire 14 days after last activity', async () => {
    await connect('a', 'Ann');
    const g = await create('a');
    now += 13 * 24 * 3600 * 1000;
    await connect('b', 'Bo');
    await send('b', { t: 'join', gameId: g.gameId });
    expect(bus.last('b', 'joined')).toBeTruthy(); // join refreshes expiry
    now += 15 * 24 * 3600 * 1000;
    await connect('c', 'Cy');
    await send('c', { t: 'join', gameId: g.gameId, seatToken: g.token });
    expect(lastError('c')?.code).toBe('not_found');
  });
});

test('no internal errors were logged', () => {
  expect(errors).toEqual([]);
});

// keep type imports used
export type _Unused = [PlayerView, ServerMessage];

describe('rematch', () => {
  async function finished() {
    const { a, b, gameId } = await twoPlayers();
    const red = a.seat === 'red' ? a : b;
    await act(red, gameId, { type: 'concede', player: 'red' });
    await act(red, gameId, { type: 'concede', player: 'red' });
    expect(view(a.c).phase).toBe('matchOver');
    return { a, b, gameId };
  }

  test('is refused before the match is over', async () => {
    const { a, gameId } = await twoPlayers();
    await send(a.c, { t: 'rematch', gameId, seatToken: a.token });
    expect(lastError(a.c)?.code).toBe('not_over');
  });

  test('first request creates the follow-up game, the opponent is told, the second request joins it', async () => {
    const { a, b, gameId } = await finished();
    await connect('a2', 'Ann');
    await send('a2', { t: 'rematch', gameId, seatToken: a.token });
    const ja = bus.last('a2', 'joined')!;
    expect(ja.gameId).not.toBe(gameId);
    expect(bus.ofType('a2', 'state')).toHaveLength(0); // waiting for the opponent
    const offer = bus.last(b.c, 'rematch')!;
    expect(offer).toMatchObject({ gameId, next: ja.gameId });

    await connect('b2', 'Bo');
    await send('b2', { t: 'rematch', gameId, seatToken: b.token });
    const jb = bus.last('b2', 'joined')!;
    expect(jb.gameId).toBe(ja.gameId);
    expect(jb.seat).not.toBe(ja.seat);
    expect(view('a2').phase).toBe('setup');
    expect(view('b2').names[jb.seat]).toBe('Bo');
    // the creator asking again (second tab) goes back to their own seat, never the opponent's
    await connect('c2', 'Ann');
    await send('c2', { t: 'rematch', gameId, seatToken: a.token });
    const jc = bus.last('c2', 'joined')!;
    expect(jc).toMatchObject({ gameId: ja.gameId, seat: ja.seat, seatToken: ja.seatToken });
    expect(lastError('c2')).toBeUndefined();
    // a repeat request from the opponent finds the game full; it never takes a third seat
    await connect('d2', 'Bo');
    await send('d2', { t: 'rematch', gameId, seatToken: b.token });
    expect(lastError('d2')?.code).toBe('full');
  });

  test('double request before the opponent answers keeps the second seat open', async () => {
    const { a, b, gameId } = await finished();
    await connect('a2', 'Ann');
    await send('a2', { t: 'rematch', gameId, seatToken: a.token });
    const ja = bus.last('a2', 'joined')!;
    await connect('a3', 'Ann');
    await send('a3', { t: 'rematch', gameId, seatToken: a.token });
    expect(bus.last('a3', 'joined')).toMatchObject({ gameId: ja.gameId, seat: ja.seat, seatToken: ja.seatToken });
    await connect('b2', 'Bo');
    await send('b2', { t: 'rematch', gameId, seatToken: b.token });
    const jb = bus.last('b2', 'joined')!;
    expect(jb.gameId).toBe(ja.gameId);
    expect(jb.seat).not.toBe(ja.seat);
  });

  test('a bot game rematch starts a new bot game straight away', async () => {
    await connect('h', 'Hal');
    const g = await create('h', true);
    await act(g, g.gameId, { type: 'concede', player: g.seat });
    if (view('h').phase !== 'matchOver') await act(g, g.gameId, { type: 'concede', player: g.seat });
    expect(view('h').phase).toBe('matchOver');
    await connect('h2', 'Hal');
    await send('h2', { t: 'rematch', gameId: g.gameId, seatToken: g.token });
    const j = bus.last('h2', 'joined')!;
    expect(j.gameId).not.toBe(g.gameId);
    expect(view('h2').phase).toBe('setup');
    expect(bus.last('h2', 'presence')!.players[j.seat === 'red' ? 'black' : 'red']).toMatchObject({ bot: true });
  });
});

describe('test hooks', () => {
  test('fixed seed, creator seat, first player and dice make games repeatable', async () => {
    const mk = () =>
      new GameService({
        games: new MemoryGameStore(),
        connections: new MemoryConnectionStore(),
        stats: new MemoryStatsStore(),
        out: bus,
        clock: { now: () => now },
        testHooks: { seed: 'fixed', creatorSeat: 'black', firstPlayer: 'black', dice: [6, 6] },
      });
    const terrains: unknown[] = [];
    for (const [i, s] of [mk(), mk()].entries()) {
      const a = `ha${i}`;
      const b = `hb${i}`;
      for (const [c, n] of [[a, 'Ann'], [b, 'Bo']] as const) {
        await s.handleConnect(c);
        await s.handleMessage(c, JSON.stringify({ t: 'hello', username: n }));
      }
      await s.handleMessage(a, JSON.stringify({ t: 'create', vsBot: false }));
      const ja = bus.last(a, 'joined')!;
      expect(ja.seat).toBe('black');
      await s.handleMessage(b, JSON.stringify({ t: 'join', gameId: ja.gameId }));
      const v = bus.last(a, 'state')!.view;
      expect(v.roundStarter).toBe('black');
      terrains.push(v.terrain);
    }
    expect(terrains[0]).toEqual(terrains[1]);
  });
});

describe('robustness', () => {
  test('chat does not bump the game revision or rewrite the record', async () => {
    const { a, gameId } = await twoPlayers();
    const before = (await games.get(gameId))!.rev;
    for (let i = 0; i < 5; i++) await send(a.c, { t: 'chat', gameId, seatToken: a.token, text: `m${i}` });
    expect((await games.get(gameId))!.rev).toBe(before);
  });

  test('invisible characters are stripped; the bot name is reserved', async () => {
    await connect('a');
    await send('a', { t: 'hello', username: 'Bo\u202Eb\u200B' });
    expect(bus.last('a', 'welcome')!.username).toBe('Bob');
    await send('a', { t: 'hello', username: ' ＢＯＴ ' });
    expect(lastError('a')?.code).toBe('bad_username');
  });

  test('rate limiter rejects bursts but never pings', async () => {
    const l = new GameService({
      games: new MemoryGameStore(),
      connections: new MemoryConnectionStore(),
      stats: new MemoryStatsStore(),
      out: bus,
      clock: { now: () => now },
      limiter: new TokenBucketLimiter(3, 1, () => now),
    });
    await l.handleConnect('r');
    for (let i = 0; i < 5; i++) await l.handleMessage('r', JSON.stringify({ t: 'stats', username: 'x' }));
    expect(bus.ofType('r', 'error').filter((e) => e.code === 'rate_limited')).toHaveLength(2);
    bus.clear('r');
    await l.handleMessage('r', JSON.stringify({ t: 'ping' }));
    expect(bus.last('r', 'pong')).toBeTruthy();
    now += 2000;
    await l.handleMessage('r', JSON.stringify({ t: 'stats', username: 'x' }));
    expect(bus.last('r', 'stats')).toBeTruthy();
  });

  test('a stalled bot run resumes on continue and on rejoin', async () => {
    await connect('h', 'Hal');
    // zero budget: the bot cannot move during create, so it is left to move
    await svc.handleMessage('h', JSON.stringify({ t: 'create', vsBot: true }), 0);
    const j = bus.last('h', 'joined')!;
    const g = { c: 'h', seat: j.seat, token: j.seatToken, gameId: j.gameId };
    const rec0 = (await games.get(g.gameId))!;
    expect(rec0.version).toBe(0);
    // bad token refused
    await send('h', { t: 'continue', gameId: g.gameId, seatToken: 'nope' });
    expect(lastError('h')?.code).toBe('bad_seat');
    await send('h', { t: 'continue', gameId: g.gameId, seatToken: g.token });
    const after = (await games.get(g.gameId))!;
    expect(after.version).toBeGreaterThan(0);
    expect(bus.last('h', 'state')!.version).toBe(after.version);
    // nothing pending now: continue is a harmless resend
    await send('h', { t: 'continue', gameId: g.gameId, seatToken: g.token });
    expect((await games.get(g.gameId))!.version).toBe(after.version);

    // rejoin path
    await connect('h2', 'Hal');
    await svc.handleMessage('h2', JSON.stringify({ t: 'create', vsBot: true }), 0);
    const j2 = bus.last('h2', 'joined')!;
    await connect('h3', 'Hal');
    await send('h3', { t: 'join', gameId: j2.gameId, seatToken: j2.seatToken });
    expect((await games.get(j2.gameId))!.version).toBeGreaterThan(0);
  });
});
