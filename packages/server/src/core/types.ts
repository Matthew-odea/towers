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
  /** Id of the follow-up game once a player asked for a rematch. */
  rematch?: string | null;
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

/**
 * Deterministic games for end-to-end tests. Only the local server sets these, and only when
 * TOWERS_TEST=1; the Lambda never does.
 */
export interface TestHooks {
  /** Seed used for every new match (instead of a random UUID). */
  seed?: string;
  /** Seat given to whoever creates a game (instead of a random one). */
  creatorSeat?: PlayerId;
  /** Round-1 first player. */
  firstPlayer?: PlayerId;
  /** Dice values queued at the start of every match (consumed before the RNG). */
  dice?: number[];
}

export interface Clock {
  now(): number;
}
