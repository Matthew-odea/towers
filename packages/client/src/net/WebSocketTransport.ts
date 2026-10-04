import type { Action, PlayerId } from '@towers/engine';
import type { BotDifficulty, ClientMessage, ServerMessage, WirePresence } from './protocol';
import type { ChatMessage, ConnectionListener, GameConnection, Presence, StateUpdate } from './types';
import { loadConfig } from './config';
import { readStore, removeStore, seatKey, writeStore } from './storage';

export interface TransportDeps {
  /** Resolves the WebSocket URL. Defaults to /config.json. */
  wsUrl?: () => Promise<string>;
  WebSocketImpl?: new (url: string) => WebSocket;
  /** Reconnect delays in ms; the last one repeats. */
  backoff?: number[];
  pingMs?: number;
  /** Give up on the first connection after this long. */
  connectTimeoutMs?: number;
}

export class TransportError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const DEFAULT_BACKOFF = [500, 1000, 2000, 4000, 8000, 15000];
const FATAL_CODES = new Set(['full', 'not_found']);
const OPEN = 1;

/** The server reports an empty seat as `name: null`; the client contract uses `null` for it. */
export function toPresence(p: WirePresence): Presence {
  const seat = (e: WirePresence['red']) =>
    e && e.name !== null ? { name: e.name, connected: e.connected, bot: e.bot, ...(e.bot && e.botLevel ? { botLevel: e.botLevel } : {}) } : null;
  return { red: seat(p.red), black: seat(p.black) };
}

type Mode =
  | { kind: 'create'; vsBot: boolean; botLevel?: BotDifficulty }
  | { kind: 'join'; gameId: string }
  | { kind: 'rematch'; from: string; seatToken: string };

/** Online game connection: one socket, hello -> create/join -> state stream, with auto-rejoin. */
export class WebSocketTransport implements GameConnection {
  private _gameId = '';
  private _seat: PlayerId = 'red';
  private token = '';
  private latest: StateUpdate | null = null;
  private chat: ChatMessage[] = [];
  private chatSeen = new Set<string>();
  private presence: Presence | null = null;
  private listeners = new Set<ConnectionListener>();
  private ws: WebSocket | null = null;
  private closed = false;
  private joined = false;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private firstSettle: { resolve: () => void; reject: (e: TransportError) => void } | null = null;
  private readonly deps: Required<Pick<TransportDeps, 'backoff' | 'pingMs' | 'connectTimeoutMs'>> & TransportDeps;

  private constructor(
    private readonly username: string,
    private readonly mode: Mode,
    deps: TransportDeps,
  ) {
    this.deps = { backoff: DEFAULT_BACKOFF, pingMs: 5 * 60_000, connectTimeoutMs: 6000, ...deps };
    if (mode.kind === 'join') this._gameId = mode.gameId;
  }

  /** `vsBot`: false for a game against a friend; true or a difficulty for a game against the bot. */
  static async create(username: string, vsBot: boolean | BotDifficulty, deps: TransportDeps = {}): Promise<WebSocketTransport> {
    const mode: Mode = typeof vsBot === 'string' ? { kind: 'create', vsBot: true, botLevel: vsBot } : { kind: 'create', vsBot };
    const t = new WebSocketTransport(username, mode, deps);
    await t.start();
    return t;
  }

  static async join(username: string, gameId: string, deps: TransportDeps = {}): Promise<WebSocketTransport> {
    const t = new WebSocketTransport(username, { kind: 'join', gameId }, deps);
    await t.start();
    return t;
  }

  /**
   * Starts (or joins) the follow-up game of a finished online game. The first player to ask
   * creates it; the other player's request lands in the same game.
   */
  static async rematch(username: string, finished: { gameId: string; seat: PlayerId }, deps: TransportDeps = {}): Promise<WebSocketTransport> {
    const seatToken = readStore(seatKey(finished.gameId));
    if (!seatToken) throw new TransportError('bad_seat', 'No seat in the finished game');
    const t = new WebSocketTransport(username, { kind: 'rematch', from: finished.gameId, seatToken }, deps);
    await t.start();
    return t;
  }

  get gameId() { return this._gameId; }
  get seat() { return this._seat; }

  subscribe(l: ConnectionListener): () => void {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }
  getLatest() { return this.latest; }
  getChat() { return this.chat.slice(); }
  getPresence() { return this.presence; }

  sendAction(action: Action): void {
    if (!this.joined) return this.emitError('offline', 'Not connected');
    this.send({ t: 'action', gameId: this._gameId, seatToken: this.token, action, expectedVersion: this.latest?.version ?? 0 });
  }

  sendChat(text: string): void {
    const clean = text.trim().slice(0, 300);
    if (!clean) return;
    if (!this.joined) return this.emitError('offline', 'Not connected');
    this.send({ t: 'chat', gameId: this._gameId, seatToken: this.token, text: clean });
  }

  close(): void {
    this.closed = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch { /* ignore */ }
    this.listeners.clear();
  }

  // ---- internals ----

  private start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.firstSettle) this.failFirst(new TransportError('unreachable', 'Could not reach the server'));
      }, this.deps.connectTimeoutMs);
      this.firstSettle = {
        resolve: () => { clearTimeout(timer); this.firstSettle = null; resolve(); },
        reject: (e) => { clearTimeout(timer); this.firstSettle = null; reject(e); },
      };
      void this.connect();
    });
  }

  private failFirst(e: TransportError) {
    const s = this.firstSettle;
    this.closed = true;
    this.clearTimers();
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
    s?.reject(e);
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
    let url: string;
    try {
      url = this.deps.wsUrl ? await this.deps.wsUrl() : (await loadConfig()).wsUrl;
    } catch {
      return this.onDrop();
    }
    if (this.closed) return;
    const Impl = this.deps.WebSocketImpl ?? WebSocket;
    let ws: WebSocket;
    try { ws = new Impl(url); } catch { return this.onDrop(); }
    this.ws = ws;
    this.joined = false;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.send({ t: 'hello', username: this.username });
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let msg: ServerMessage;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      this.onMessage(msg);
    };
    ws.onclose = () => { if (this.ws === ws) this.onDrop(); };
    ws.onerror = () => { /* close follows */ };
  }

  private onDrop() {
    this.ws = null;
    this.joined = false;
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.closed) return;
    if (this.firstSettle && this.attempts >= 1) {
      return this.failFirst(new TransportError('unreachable', 'Could not reach the server'));
    }
    const d = this.deps.backoff;
    const delay = d[Math.min(this.attempts, d.length - 1)] ?? 1000;
    this.attempts++;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; void this.connect(); }, delay);
  }

  private onMessage(msg: ServerMessage) {
    switch (msg.t) {
      case 'welcome': {
        if (this.mode.kind === 'create' && !this._gameId) {
          this.send(
            this.mode.botLevel
              ? { t: 'create', vsBot: this.mode.vsBot, botLevel: this.mode.botLevel }
              : { t: 'create', vsBot: this.mode.vsBot },
          );
        } else if (this.mode.kind === 'rematch' && !this._gameId) {
          this.send({ t: 'rematch', gameId: this.mode.from, seatToken: this.mode.seatToken });
        } else {
          const seatToken = readStore(seatKey(this._gameId)) ?? undefined;
          this.send({ t: 'join', gameId: this._gameId, seatToken });
        }
        return;
      }
      case 'joined': {
        this._gameId = msg.gameId;
        this._seat = msg.seat;
        this.token = msg.seatToken;
        writeStore(seatKey(msg.gameId), msg.seatToken);
        this.joined = true;
        this.attempts = 0;
        if (!this.pingTimer) this.pingTimer = setInterval(() => this.send({ t: 'ping' }), this.deps.pingMs);
        this.firstSettle?.resolve();
        return;
      }
      case 'state': {
        if (msg.gameId !== this._gameId) return;
        if (this.latest && msg.version < this.latest.version) return;
        this.latest = { view: msg.view, events: msg.events, version: msg.version };
        this.each((l) => l.onState?.(this.latest!));
        return;
      }
      case 'chat': {
        if (msg.gameId !== this._gameId) return;
        // History is replayed on every (re)join: skip lines already seen.
        const key = `${msg.ts}|${msg.from}|${msg.text}`;
        if (this.chatSeen.has(key)) return;
        this.chatSeen.add(key);
        const m: ChatMessage = { from: msg.from, name: msg.name, text: msg.text, ts: msg.ts };
        this.chat.push(m);
        if (this.chat.length > 100) this.chat.shift();
        this.each((l) => l.onChat?.(m));
        return;
      }
      case 'presence': {
        if (msg.gameId !== this._gameId) return;
        const p = toPresence(msg.players);
        this.presence = p;
        this.each((l) => l.onPresence?.(p));
        return;
      }
      case 'rematch': {
        if (msg.gameId !== this._gameId || msg.by === this._seat) return;
        this.each((l) => l.onRematchOffer?.(msg.next));
        return;
      }
      case 'error': {
        if (this.firstSettle) {
          return this.failFirst(new TransportError(msg.code, msg.message));
        }
        if (FATAL_CODES.has(msg.code)) {
          if (msg.code === 'not_found') removeStore(seatKey(this._gameId));
          this.closed = true;
          this.clearTimers();
          try { this.ws?.close(); } catch { /* ignore */ }
          this.ws = null;
        }
        this.emitError(msg.code, msg.message);
        return;
      }
      default:
        return;
    }
  }

  private send(msg: ClientMessage) {
    const ws = this.ws;
    if (ws && ws.readyState === OPEN) ws.send(JSON.stringify(msg));
  }

  private emitError(code: string, message: string) {
    this.each((l) => l.onError?.({ code, message }));
  }

  private each(fn: (l: ConnectionListener) => void) {
    for (const l of [...this.listeners]) fn(l);
  }

  private clearTimers() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }
}
