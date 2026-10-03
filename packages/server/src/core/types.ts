import type { MatchState, PlayerId } from '@towers/engine';
import type { PlayerStats, ServerMessage } from './protocol';

export interface SeatRecord {
  name: string;
  token: string;
  bot: boolean;
}

export interface ChatRecord {
  from: PlayerId;
  name: string;
  text: string;
  ts: number;
}

export interface GameRecord {
  id: string;
  /** Storage revision: bumped on every write (actions, joins, chat). Used for optimistic writes. */
  rev: number;
  /** Game version: bumped on every applied action (including bot steps). */
  version: number;
  vsBot: boolean;
  seats: Record<PlayerId, SeatRecord | null>;
  /** null until both seats are filled. */
  state: MatchState | null;
  chat: ChatRecord[];
  /** Per-seat character commit counts accumulated from engagement events. */
  commits: Record<PlayerId, Record<string, number>>;
  statsRecorded: boolean;
  createdAt: number;
  /** Epoch seconds (DynamoDB TTL). */
  expiresAt: number;
}

export interface ConnectionRecord {
  id: string;
  username?: string;
  gameId?: string;
  seat?: PlayerId;
  /** Epoch seconds (TTL). */
  expiresAt: number;
}

export interface GameStore {
  get(id: string): Promise<GameRecord | null>;
  /** Writes `rec` only if the stored rev equals `expectedRev` (null = must not exist). Returns false on conflict. */
  put(rec: GameRecord, expectedRev: number | null): Promise<boolean>;
}

export interface ConnectionStore {
  get(id: string): Promise<ConnectionRecord | null>;
  put(conn: ConnectionRecord): Promise<void>;
  remove(id: string): Promise<ConnectionRecord | null>;
  listByGame(gameId: string): Promise<ConnectionRecord[]>;
}

export interface StatsStore {
  get(key: string): Promise<PlayerStats | null>;
  /** Read-modify-write; implementations must make it safe against concurrent updates. */
  update(key: string, fn: (current: PlayerStats | null) => PlayerStats): Promise<PlayerStats>;
}

export interface Broadcaster {
  /** Resolves 'gone' when the connection no longer exists. */
  send(connectionId: string, msg: ServerMessage): Promise<'ok' | 'gone'>;
}

export interface Clock {
  now(): number;
}
