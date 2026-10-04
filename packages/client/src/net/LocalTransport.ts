import { applyAction, chooseBotAction, createMatch, viewFor } from '@towers/engine';
import type { Action, GameEvent, MatchState, PlayerId } from '@towers/engine';
import type { BotDifficulty } from './protocol';
import type { ChatMessage, ConnectionListener, GameConnection, Presence, StateUpdate } from './types';

export interface LocalOptions {
  name: string;
  seed?: string;
  /** Delay between bot steps. */
  paceMs?: number;
  human?: PlayerId;
  /** Bot difficulty (default 'medium'). */
  level?: BotDifficulty;
}

/** Offline match against the bot, entirely in the browser. */
export class LocalTransport implements GameConnection {
  readonly gameId = 'offline';
  readonly seat: PlayerId;
  private readonly botSeat: PlayerId;
  readonly level: BotDifficulty;
  private state: MatchState;
  private latest: StateUpdate;
  private listeners = new Set<ConnectionListener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private readonly pace: number;
  private readonly presence: Presence;

  constructor(opts: LocalOptions) {
    this.seat = opts.human ?? 'red';
    this.botSeat = this.seat === 'red' ? 'black' : 'red';
    this.pace = opts.paceMs ?? 600;
    this.level = opts.level ?? 'medium';
    const seed = opts.seed ?? (globalThis.crypto?.randomUUID?.() ?? String(Math.random()));
    const names = { [this.seat]: opts.name || 'You', [this.botSeat]: 'Bot' } as Record<PlayerId, string>;
    this.state = createMatch({ seed, names });
    this.latest = { view: viewFor(this.state, this.seat), events: [], version: this.state.seq };
    this.presence = {
      red: { name: names.red, connected: true, bot: this.botSeat === 'red' },
      black: { name: names.black, connected: true, bot: this.botSeat === 'black' },
    };
    this.presence[this.botSeat] = { ...this.presence[this.botSeat]!, botLevel: this.level };
    this.scheduleBot();
  }

  subscribe(l: ConnectionListener) {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }
  getLatest() { return this.latest; }
  getChat(): ChatMessage[] { return []; }
  getPresence() { return this.presence; }
  sendChat(): void { /* nobody to talk to */ }

  sendAction(action: Action): void {
    if (this.closed) return;
    const r = applyAction(this.state, { ...action, player: this.seat } as Action);
    if (!r.ok) {
      for (const l of [...this.listeners]) l.onError?.({ code: 'illegal', message: r.error });
      return;
    }
    this.commit(r.state, r.events);
    this.scheduleBot();
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  private commit(state: MatchState, events: GameEvent[]) {
    this.state = state;
    this.latest = { view: viewFor(state, this.seat), events, version: state.seq };
    for (const l of [...this.listeners]) l.onState?.(this.latest);
  }

  private botAction(): Action | null {
    return chooseBotAction(this.state, this.botSeat, { level: this.level });
  }

  private scheduleBot() {
    if (this.closed || this.timer) return;
    if (!this.botAction()) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.closed) return;
      const action = this.botAction();
      if (action) {
        const r = applyAction(this.state, action);
        if (r.ok) this.commit(r.state, r.events);
        else return; // a bot that proposes an illegal action stops rather than spinning
      }
      this.scheduleBot();
    }, this.pace);
  }
}
