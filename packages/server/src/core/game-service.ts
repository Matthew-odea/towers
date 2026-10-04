import {
  applyAction,
  chooseBotAction,
  createMatch,
  pendingDecision,
  viewFor,
  type Action,
  type GameEvent,
  type MatchState,
  type PlayerId,
} from '@towers/engine';
import {
  GAME_TTL_DAYS,
  MAX_CHAT_CHARS,
  MAX_CHAT_KEPT,
  MAX_MESSAGE_BYTES,
  MAX_USERNAME_CHARS,
  emptyStats,
  statsKey,
  type ClientMessage,
  type ErrorCode,
  type Presence,
  type ServerMessage,
} from './protocol';
import type {
  Broadcaster,
  Clock,
  ConnectionRecord,
  ConnectionStore,
  GameRecord,
  GameStore,
  StatsStore,
  TestHooks,
} from './types';

export const BOT_STEP_CAP = 500;
const CONNECTION_TTL_SECONDS = 3 * 60 * 60;
const MAX_WRITE_ATTEMPTS = 6;
const SEATS: PlayerId[] = ['red', 'black'];

export interface GameServiceDeps {
  games: GameStore;
  connections: ConnectionStore;
  stats: StatsStore;
  out: Broadcaster;
  clock?: Clock;
  log?: (msg: string, err?: unknown) => void;
  /** Deterministic games for e2e tests (local server with TOWERS_TEST=1 only). */
  testHooks?: TestHooks;
}

interface Step {
  state: MatchState;
  events: GameEvent[];
  version: number;
}

interface Failure {
  code: ErrorCode;
  message: string;
  resend?: boolean;
}

type FailM = { fail: Failure; rec?: undefined; out?: undefined };
type Mutation<T> = FailM | { fail?: undefined; rec: GameRecord; out: T; write?: boolean };
type Mutated<T> = FailM | { fail?: undefined; rec: GameRecord; out: T };

const failed = (f: Failure): FailM => ({ fail: f });
const otherSeat = (p: PlayerId): PlayerId => (p === 'red' ? 'black' : 'red');

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}
function randomToken(bytes = 18): string {
  return Array.from(randomBytes(bytes), (x) => x.toString(16).padStart(2, '0')).join('');
}
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function randomGameId(): string {
  return Array.from(randomBytes(10), (x) => ID_ALPHABET[x % ID_ALPHABET.length]).join('');
}
function randomSeat(): PlayerId {
  return randomBytes(1)[0]! % 2 === 0 ? 'red' : 'black';
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function cleanUsername(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length < 1 || s.length > MAX_USERNAME_CHARS) return null;
  return s;
}

export class GameService {
  private readonly games: GameStore;
  private readonly connections: ConnectionStore;
  private readonly stats: StatsStore;
  private readonly out: Broadcaster;
  private readonly clock: Clock;
  private readonly log: (msg: string, err?: unknown) => void;
  private readonly hooks: TestHooks | undefined;

  constructor(deps: GameServiceDeps) {
    this.hooks = deps.testHooks;
    this.games = deps.games;
    this.connections = deps.connections;
    this.stats = deps.stats;
    this.out = deps.out;
    this.clock = deps.clock ?? { now: () => Date.now() };
    this.log = deps.log ?? ((m, e) => console.error(m, e));
  }

  // ---- lifecycle -------------------------------------------------------

  async handleConnect(connectionId: string): Promise<void> {
    await this.connections.put({
      id: connectionId,
      expiresAt: Math.floor(this.clock.now() / 1000) + CONNECTION_TTL_SECONDS,
    });
  }

  async handleDisconnect(connectionId: string): Promise<void> {
    const conn = await this.connections.remove(connectionId);
    if (conn?.gameId) await this.broadcastPresence(conn.gameId);
  }

  async handleMessage(connectionId: string, raw: string): Promise<void> {
    try {
      await this.dispatch(connectionId, raw);
    } catch (err) {
      this.log('handleMessage failed', err);
      await this.deliver(connectionId, { t: 'error', code: 'internal', message: 'Something went wrong on the server.' });
    }
  }

  // ---- dispatch --------------------------------------------------------

  private async dispatch(connId: string, raw: unknown): Promise<void> {
    if (typeof raw !== 'string') return this.fail(connId, 'bad_message', 'Messages must be text.');
    if (raw.length > MAX_MESSAGE_BYTES || new TextEncoder().encode(raw).length > MAX_MESSAGE_BYTES) {
      return this.fail(connId, 'too_large', 'Message too large.');
    }
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return this.fail(connId, 'bad_json', 'Message is not valid JSON.');
    }
    if (!isObject(msg) || typeof msg.t !== 'string') return this.fail(connId, 'bad_message', 'Missing message type.');
    const m = msg as unknown as ClientMessage;
    switch (m.t) {
      case 'ping':
        return void (await this.deliver(connId, { t: 'pong' }));
      case 'hello':
        return this.onHello(connId, m);
      case 'create':
        return this.onCreate(connId, m);
      case 'join':
        return this.onJoin(connId, m);
      case 'action':
        return this.onAction(connId, m);
      case 'chat':
        return this.onChat(connId, m);
      case 'stats':
        return this.onStats(connId, m);
      case 'rematch':
        return this.onRematch(connId, m);
      default:
        return this.fail(connId, 'unknown_type', `Unknown message type "${String((msg as { t: unknown }).t).slice(0, 30)}".`);
    }
  }

  // ---- handlers --------------------------------------------------------

  private async onHello(connId: string, m: { username?: unknown }): Promise<void> {
    const username = cleanUsername(m.username);
    if (!username) return this.fail(connId, 'bad_username', `Pick a name of 1 to ${MAX_USERNAME_CHARS} characters.`);
    const conn = (await this.connections.get(connId)) ?? this.freshConn(connId);
    await this.connections.put({ ...conn, username });
    await this.deliver(connId, { t: 'welcome', username });
  }

  private async onCreate(connId: string, m: { vsBot?: unknown }): Promise<void> {
    const conn = await this.connections.get(connId);
    if (!conn?.username) return this.fail(connId, 'need_hello', 'Say hello with a username first.');
    const made = this.newGame(conn.username, m.vsBot === true);
    if (!(await this.games.put(made.rec, null))) {
      // Game ids are random; a collision is effectively impossible.
      return this.fail(connId, 'busy', 'Could not create the game, try again.');
    }
    await this.seatCreator(conn, made);
  }

  /** A fresh game record with `username` in a (random) seat, plus the bot's opening steps. */
  private newGame(username: string, vsBot: boolean): { rec: GameRecord; seat: PlayerId; token: string; steps: Step[] } {
    const now = this.clock.now();
    const seat = this.hooks?.creatorSeat ?? randomSeat();
    const token = randomToken();
    const rec: GameRecord = {
      id: randomGameId(),
      rev: 1,
      version: 0,
      vsBot,
      seats: { red: null, black: null },
      state: null,
      chat: [],
      commits: { red: {}, black: {} },
      statsRecorded: false,
      rematch: null,
      createdAt: now,
      expiresAt: this.expiry(),
    };
    rec.seats[seat] = { name: username, token, bot: false };
    let steps: Step[] = [];
    if (vsBot) {
      rec.seats[otherSeat(seat)] = { name: 'Bot', token: randomToken(), bot: true };
      rec.state = this.newMatch(rec);
      steps = this.runBots(rec);
    }
    return { rec, seat, token, steps };
  }

  /** Attaches the creating connection to a newly stored game and sends the opening messages. */
  private async seatCreator(
    conn: ConnectionRecord,
    made: { rec: GameRecord; seat: PlayerId; token: string; steps: Step[] },
  ): Promise<void> {
    const { rec, seat, token, steps } = made;
    await this.connections.put({ ...conn, gameId: rec.id, seat });
    await this.deliver(conn.id, { t: 'joined', gameId: rec.id, seat, seatToken: token });
    if (steps.length) await this.broadcastSteps(rec, steps);
    else if (rec.state) await this.sendCurrent(conn.id, rec.id, token);
    await this.broadcastPresence(rec.id, rec);
  }

  /**
   * Rematch: the first player to ask creates the follow-up game (same mode) and the finished
   * game points at it; the other player's request joins that game. The finished game's
   * connections are told so the opponent can follow.
   */
  private async onRematch(connId: string, m: { gameId?: unknown; seatToken?: unknown }): Promise<void> {
    const gameId = this.validId(m.gameId);
    if (!gameId || typeof m.seatToken !== 'string') return this.fail(connId, 'bad_message', 'Missing game id or seat token.');
    const token = m.seatToken;
    const conn = await this.connections.get(connId);
    if (!conn?.username) return this.fail(connId, 'need_hello', 'Say hello with a username first.');
    const old = await this.games.get(gameId);
    if (!old || old.expiresAt * 1000 < this.clock.now()) return this.fail(connId, 'not_found', 'No such game (it may have expired).');
    const seat = SEATS.find((s) => old.seats[s]?.token === token && !old.seats[s]?.bot);
    if (!seat) return this.fail(connId, 'bad_seat', 'That seat token does not match this game.');
    if (old.state?.phase !== 'matchOver') return this.fail(connId, 'not_over', 'The match is not over yet.');

    let next = old.rematch ?? null;
    if (!next) {
      const made = this.newGame(conn.username, old.vsBot);
      if (!(await this.games.put(made.rec, null))) return this.fail(connId, 'busy', 'Could not create the game, try again.');
      const linked = await this.mutate(gameId, (rec) => {
        if (rec.rematch) return { rec, out: rec.rematch, write: false };
        rec.rematch = made.rec.id;
        return { rec, out: made.rec.id };
      });
      if (linked.fail) return this.fail(connId, linked.fail.code, linked.fail.message);
      if (linked.out === made.rec.id) {
        await this.seatCreator(conn, made);
        await this.broadcastTo(gameId, (c) => (c.id === connId ? null : { t: 'rematch', gameId, next: made.rec.id, by: seat }));
        return;
      }
      // Lost a race with the opponent: join their game (ours is left to expire).
      next = linked.out;
    }
    return this.onJoin(connId, { gameId: next });
  }

  private async onJoin(connId: string, m: { gameId?: unknown; seatToken?: unknown }): Promise<void> {
    const gameId = this.validId(m.gameId);
    if (!gameId) return this.fail(connId, 'bad_message', 'Missing game id.');
    const conn = (await this.connections.get(connId)) ?? this.freshConn(connId);
    const presented = typeof m.seatToken === 'string' ? m.seatToken : undefined;

    const res = await this.mutate(gameId, (rec) => {
      const claimed = presented ? SEATS.find((s) => rec.seats[s]?.token === presented && !rec.seats[s]?.bot) : undefined;
      if (claimed) return { rec, out: { seat: claimed, token: presented!, started: false }, write: false };
      if (!conn.username) return failed({ code: 'need_hello', message: 'Say hello with a username first.' });
      const open = SEATS.find((s) => rec.seats[s] === null);
      if (!open) return failed({ code: 'full', message: 'This game already has two players.' });
      const token = randomToken();
      rec.seats[open] = { name: conn.username, token, bot: false };
      let started = false;
      if (SEATS.every((s) => rec.seats[s])) {
        rec.state = this.newMatch(rec);
        started = true;
      }
      rec.expiresAt = this.expiry();
      return { rec, out: { seat: open, token, started } };
    });
    if (res.fail) return this.fail(connId, res.fail.code, res.fail.message);
    const { rec, out } = res;

    await this.connections.put({ ...conn, gameId, seat: out.seat });
    await this.deliver(connId, { t: 'joined', gameId, seat: out.seat, seatToken: out.token });
    if (rec.state) {
      if (out.started) {
        await this.broadcastSteps(rec, [{ state: rec.state, events: [], version: rec.version }]);
      } else {
        await this.deliver(connId, {
          t: 'state',
          gameId,
          view: viewFor(rec.state, out.seat),
          events: [],
          version: rec.version,
        });
      }
    }
    for (const c of rec.chat) {
      await this.deliver(connId, { t: 'chat', gameId, from: c.from, name: c.name, text: c.text, ts: c.ts });
    }
    await this.broadcastPresence(gameId, rec);
  }

  private async onAction(connId: string, m: Partial<Extract<ClientMessage, { t: 'action' }>>): Promise<void> {
    const gameId = this.validId(m.gameId);
    if (!gameId || typeof m.seatToken !== 'string') return this.fail(connId, 'bad_message', 'Missing game id or seat token.');
    if (!isObject(m.action) || typeof (m.action as { type?: unknown }).type !== 'string') {
      return this.fail(connId, 'bad_message', 'Missing action.');
    }
    if (typeof m.expectedVersion !== 'number' || !Number.isInteger(m.expectedVersion)) {
      return this.fail(connId, 'bad_message', 'Missing expectedVersion.');
    }
    const action = m.action as Action;
    const token = m.seatToken;
    const expected = m.expectedVersion;

    const res = await this.mutate(gameId, (rec) => {
      const seat = SEATS.find((s) => rec.seats[s]?.token === token && !rec.seats[s]?.bot);
      if (!seat) return failed({ code: 'bad_seat', message: 'That seat token does not match this game.' });
      if (!rec.state) return failed({ code: 'not_started', message: 'Waiting for the second player.' });
      if (action.player !== seat) return failed({ code: 'bad_seat', message: 'You can only act for your own seat.' });
      if (expected !== rec.version) {
        return failed({ code: 'stale', message: 'Your view was out of date.', resend: true });
      }
      const r = applyAction(rec.state, action);
      if (!r.ok) return failed({ code: 'illegal', message: r.error });
      rec.state = r.state;
      rec.version += 1;
      const steps: Step[] = [{ state: r.state, events: r.events, version: rec.version }];
      this.countCommits(rec, r.events);
      steps.push(...this.runBots(rec));
      let record = false;
      if (rec.state.phase === 'matchOver' && !rec.statsRecorded) {
        rec.statsRecorded = true;
        record = true;
      }
      rec.expiresAt = this.expiry();
      return { rec, out: { steps, record, seat } };
    });

    if (res.fail) {
      await this.fail(connId, res.fail.code, res.fail.message);
      if (res.fail.resend) await this.sendCurrent(connId, gameId, token);
      return;
    }
    await this.broadcastSteps(res.rec, res.out.steps);
    if (res.out.record) await this.recordStats(res.rec);
  }

  private async onChat(connId: string, m: { gameId?: unknown; seatToken?: unknown; text?: unknown }): Promise<void> {
    const gameId = this.validId(m.gameId);
    if (!gameId || typeof m.seatToken !== 'string') return this.fail(connId, 'bad_message', 'Missing game id or seat token.');
    if (typeof m.text !== 'string') return this.fail(connId, 'bad_chat', 'Chat needs text.');
    // eslint-disable-next-line no-control-regex
    const text = m.text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (!text) return this.fail(connId, 'bad_chat', 'Empty message.');
    if (text.length > MAX_CHAT_CHARS) return this.fail(connId, 'bad_chat', `Messages are limited to ${MAX_CHAT_CHARS} characters.`);
    const token = m.seatToken;
    const ts = this.clock.now();
    const res = await this.mutate(gameId, (rec) => {
      const seat = SEATS.find((s) => rec.seats[s]?.token === token && !rec.seats[s]?.bot);
      if (!seat) return failed({ code: 'bad_seat', message: 'That seat token does not match this game.' });
      const entry = { from: seat, name: rec.seats[seat]!.name, text, ts };
      rec.chat.push(entry);
      if (rec.chat.length > MAX_CHAT_KEPT) rec.chat = rec.chat.slice(-MAX_CHAT_KEPT);
      return { rec, out: entry };
    });
    if (res.fail) return this.fail(connId, res.fail.code, res.fail.message);
    await this.broadcastTo(gameId, () => ({ t: 'chat', gameId, from: res.out.from, name: res.out.name, text, ts }));
  }

  private async onStats(connId: string, m: { username?: unknown }): Promise<void> {
    const username = cleanUsername(m.username);
    if (!username) return this.fail(connId, 'bad_username', 'Missing username.');
    const s = await this.stats.get(statsKey(username));
    await this.deliver(connId, { t: 'stats', username, stats: s ?? emptyStats(username) });
  }

  // ---- game logic ------------------------------------------------------

  private newMatch(rec: GameRecord): MatchState {
    const h = this.hooks;
    const state = createMatch({
      seed: h?.seed ?? globalThis.crypto.randomUUID(),
      names: { red: rec.seats.red!.name, black: rec.seats.black!.name },
      firstPlayer: h?.firstPlayer,
    });
    if (h?.dice?.length) state.diceQueue = [...h.dice];
    return state;
  }

  /** Applies bot actions until a human decision is pending. Mutates rec. */
  private runBots(rec: GameRecord): Step[] {
    const steps: Step[] = [];
    const botSeat = SEATS.find((s) => rec.seats[s]?.bot);
    if (!botSeat || !rec.state) return steps;
    while (steps.length < BOT_STEP_CAP) {
      const dec = pendingDecision(rec.state);
      if (!(dec.players as PlayerId[]).includes(botSeat)) break;
      const action = chooseBotAction(rec.state, botSeat);
      if (!action) break;
      const r = applyAction(rec.state, action);
      if (!r.ok) {
        this.log(`bot produced an illegal action: ${r.error}`);
        break;
      }
      rec.state = r.state;
      rec.version += 1;
      this.countCommits(rec, r.events);
      steps.push({ state: r.state, events: r.events, version: rec.version });
    }
    if (steps.length >= BOT_STEP_CAP) this.log(`bot step cap hit in game ${rec.id}`);
    return steps;
  }

  private countCommits(rec: GameRecord, events: GameEvent[]): void {
    const cards = rec.state?.cards;
    if (!cards) return;
    for (const e of events) {
      if (e.type !== 'engagementStarted') continue;
      const ids = new Set([...e.attackerCards, ...e.rangedArchers, ...e.defenderCards]);
      for (const id of ids) {
        const c = cards[id];
        if (!c?.character) continue;
        const bucket = rec.commits[c.owner];
        bucket[c.character] = (bucket[c.character] ?? 0) + 1;
      }
    }
  }

  private async recordStats(rec: GameRecord): Promise<void> {
    const state = rec.state;
    if (!state) return;
    for (const seat of SEATS) {
      const me = rec.seats[seat];
      const opp = rec.seats[otherSeat(seat)];
      if (!me || me.bot || !opp) continue;
      const won = state.winner === seat;
      const oppKey = statsKey(opp.name);
      try {
        await this.stats.update(statsKey(me.name), (cur) => {
          const s = cur ?? emptyStats(me.name);
          s.username = me.name;
          s.matchesPlayed += 1;
          if (won) s.matchesWon += 1;
          s.roundsWon += state.roundWins[seat];
          s.roundsLost += state.roundWins[otherSeat(seat)];
          const o = s.opponents[oppKey] ?? { name: opp.name, played: 0, won: 0 };
          o.name = opp.name;
          o.played += 1;
          if (won) o.won += 1;
          s.opponents[oppKey] = o;
          for (const [ch, n] of Object.entries(rec.commits[seat])) s.characters[ch] = (s.characters[ch] ?? 0) + n;
          return s;
        });
      } catch (err) {
        this.log('stats update failed', err);
      }
    }
  }

  // ---- storage helpers -------------------------------------------------

  /** Load, mutate, write with an optimistic revision check; retry on conflict. */
  private async mutate<T>(
    gameId: string,
    fn: (rec: GameRecord) => Mutation<T>,
  ): Promise<Mutated<T>> {
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const loaded = await this.games.get(gameId);
      if (!loaded || loaded.expiresAt * 1000 < this.clock.now()) {
        return failed({ code: 'not_found', message: 'No such game (it may have expired).' });
      }
      const r = fn(loaded);
      if (r.fail) return r;
      if (r.write === false) return { rec: r.rec, out: r.out };
      const next = { ...r.rec, rev: loaded.rev + 1 };
      if (await this.games.put(next, loaded.rev)) return { rec: next, out: r.out };
    }
    return failed({ code: 'busy', message: 'The game is busy, try again.' });
  }

  private expiry(): number {
    return Math.floor(this.clock.now() / 1000) + GAME_TTL_DAYS * 24 * 60 * 60;
  }

  private validId(v: unknown): string | null {
    return typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null;
  }

  private freshConn(id: string): ConnectionRecord {
    return { id, expiresAt: Math.floor(this.clock.now() / 1000) + CONNECTION_TTL_SECONDS };
  }

  // ---- output helpers --------------------------------------------------

  private async fail(connId: string, code: ErrorCode, message: string): Promise<void> {
    await this.deliver(connId, { t: 'error', code, message });
  }

  private async deliver(connId: string, msg: ServerMessage): Promise<'ok' | 'gone'> {
    let r: 'ok' | 'gone' = 'ok';
    try {
      r = await this.out.send(connId, msg);
    } catch (err) {
      this.log(`send to ${connId} failed`, err);
      return 'ok';
    }
    if (r === 'gone') {
      try {
        await this.connections.remove(connId);
      } catch (err) {
        this.log('remove gone connection failed', err);
      }
    }
    return r;
  }

  /** Sends one message per attached connection, built per connection. */
  private async broadcastTo(
    gameId: string,
    build: (conn: ConnectionRecord) => ServerMessage | null,
    conns?: ConnectionRecord[],
  ): Promise<void> {
    const list = conns ?? (await this.connections.listByGame(gameId));
    await Promise.all(
      list.map(async (c) => {
        const msg = build(c);
        if (msg) await this.deliver(c.id, msg);
      }),
    );
  }

  private async broadcastSteps(rec: GameRecord, steps: Step[]): Promise<void> {
    const conns = (await this.connections.listByGame(rec.id)).filter((c) => c.seat);
    await Promise.all(
      conns.map(async (c) => {
        for (const s of steps) {
          const r = await this.deliver(c.id, {
            t: 'state',
            gameId: rec.id,
            view: viewFor(s.state, c.seat!),
            events: s.events,
            version: s.version,
          });
          if (r === 'gone') return;
        }
      }),
    );
  }

  private async sendCurrent(connId: string, gameId: string, token: string): Promise<void> {
    const rec = await this.games.get(gameId);
    if (!rec?.state) return;
    const seat = SEATS.find((s) => rec.seats[s]?.token === token);
    if (!seat) return;
    await this.deliver(connId, {
      t: 'state',
      gameId,
      view: viewFor(rec.state, seat),
      events: [],
      version: rec.version,
    });
  }

  private async broadcastPresence(gameId: string, known?: GameRecord): Promise<void> {
    const rec = known ?? (await this.games.get(gameId));
    if (!rec) return;
    const conns = await this.connections.listByGame(gameId);
    const entry = (seat: PlayerId) => {
      const s = rec.seats[seat];
      return {
        name: s?.name ?? null,
        bot: s?.bot ?? false,
        connected: s ? s.bot || conns.some((c) => c.seat === seat) : false,
      };
    };
    const players: Presence = { red: entry('red'), black: entry('black') };
    await this.broadcastTo(gameId, () => ({ t: 'presence', gameId, players }), conns);
  }
}
