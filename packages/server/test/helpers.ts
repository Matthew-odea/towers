import WebSocket from 'ws';
import type { PlayerId, PlayerView } from '@towers/engine';
import type { Broadcaster } from '../src/core/types';
import type { ServerMessage } from '../src/core/protocol';

/** Collects everything sent to each connection. */
export class Bus implements Broadcaster {
  readonly inbox = new Map<string, ServerMessage[]>();
  readonly gone = new Set<string>();
  async send(id: string, msg: ServerMessage) {
    if (this.gone.has(id)) return 'gone' as const;
    // Round-trip through JSON like a real transport would.
    const copy = JSON.parse(JSON.stringify(msg)) as ServerMessage;
    const list = this.inbox.get(id) ?? [];
    list.push(copy);
    this.inbox.set(id, list);
    return 'ok' as const;
  }
  all(id: string) {
    return this.inbox.get(id) ?? [];
  }
  ofType<T extends ServerMessage['t']>(id: string, t: T) {
    return this.all(id).filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[];
  }
  last<T extends ServerMessage['t']>(id: string, t: T) {
    return this.ofType(id, t).at(-1);
  }
  clear(id?: string) {
    if (id) this.inbox.delete(id);
    else this.inbox.clear();
  }
}

/** A tiny ws client with an unbounded inbox and polling waits. */
export class Client {
  readonly msgs: ServerMessage[] = [];
  seat?: PlayerId;
  token?: string;
  gameId?: string;
  view?: PlayerView;
  version = 0;
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      this.msgs.push(m);
      if (m.t === 'state') {
        this.view = m.view;
        this.version = m.version;
      }
    });
  }
  static async connect(port: number): Promise<Client> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((res, rej) => {
      ws.once('open', () => res());
      ws.once('error', rej);
    });
    return new Client(ws);
  }
  send(m: unknown) {
    this.ws.send(typeof m === 'string' ? m : JSON.stringify(m));
  }
  async waitFor<T extends ServerMessage['t']>(
    t: T,
    pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true,
    from = 0,
    timeout = 4000,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const start = Date.now();
    for (;;) {
      for (let i = from; i < this.msgs.length; i++) {
        const m = this.msgs[i]!;
        if (m.t === t && pred(m as Extract<ServerMessage, { t: T }>)) return m as Extract<ServerMessage, { t: T }>;
      }
      if (Date.now() - start > timeout) throw new Error(`timeout waiting for ${t}; got ${JSON.stringify(this.msgs.slice(from).map((m) => m.t))}`);
      await new Promise((r) => setTimeout(r, 5));
    }
  }
  /** Sends and waits for the next message of the given type that arrives after the send. */
  async request<T extends ServerMessage['t']>(m: unknown, t: T, pred?: (m: Extract<ServerMessage, { t: T }>) => boolean) {
    const from = this.msgs.length;
    this.send(m);
    return this.waitFor(t, pred, from);
  }
  async hello(name: string) {
    return this.request({ t: 'hello', username: name }, 'welcome');
  }
  async create(vsBot = false) {
    const j = await this.request({ t: 'create', vsBot }, 'joined');
    this.seat = j.seat;
    this.token = j.seatToken;
    this.gameId = j.gameId;
    return j;
  }
  async join(gameId: string, seatToken?: string) {
    const from = this.msgs.length;
    this.send({ t: 'join', gameId, seatToken });
    const j = await this.waitFor('joined', () => true, from);
    this.seat = j.seat;
    this.token = j.seatToken;
    this.gameId = gameId;
    return j;
  }
  close() {
    this.ws.close();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
