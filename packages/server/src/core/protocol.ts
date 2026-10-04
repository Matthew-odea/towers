// Wire protocol shared by server and client. Type-only plus tiny pure helpers; no Node imports.
import type { Action, GameEvent, PlayerId, PlayerView } from '@towers/engine';

/** Bot difficulty for vs-bot games (default 'medium'). */
export type BotDifficulty = 'easy' | 'medium' | 'hard';
export const BOT_DIFFICULTIES: readonly BotDifficulty[] = ['easy', 'medium', 'hard'];
export const DEFAULT_BOT_LEVEL: BotDifficulty = 'medium';
export function parseBotLevel(v: unknown): BotDifficulty | null {
  return typeof v === 'string' && (BOT_DIFFICULTIES as readonly string[]).includes(v) ? (v as BotDifficulty) : null;
}
/** Opponent name recorded in stats for a bot game, e.g. "Bot (Hard)". */
export function botOpponentName(level: BotDifficulty): string {
  return `Bot (${level[0]!.toUpperCase()}${level.slice(1)})`;
}

export const MAX_MESSAGE_BYTES = 16 * 1024;
export const MAX_CHAT_CHARS = 300;
export const MAX_CHAT_KEPT = 50;
export const MAX_USERNAME_CHARS = 24;
export const GAME_TTL_DAYS = 14;

export type ClientMessage =
  | { t: 'hello'; username: string }
  | { t: 'create'; vsBot: boolean; botLevel?: BotDifficulty }
  | { t: 'join'; gameId: string; seatToken?: string }
  | { t: 'action'; gameId: string; seatToken: string; action: Action; expectedVersion: number }
  | { t: 'chat'; gameId: string; seatToken: string; text: string }
  | { t: 'stats'; username: string }
  /** After the match is over: start (or join) the follow-up game. Replies like create/join. */
  | { t: 'rematch'; gameId: string; seatToken: string }
  /**
   * Resume bot play. Send it when the view shows the bot to move (for example after a reconnect or
   * a stalled bot run); a no-op if nothing is pending. Replies with the current state.
   */
  | { t: 'continue'; gameId: string; seatToken: string }
  | { t: 'ping' };

export interface PresenceEntry {
  /** Display name, or null while the seat is still empty. */
  name: string | null;
  connected: boolean;
  bot: boolean;
  /** Present for the bot seat. */
  botLevel?: BotDifficulty;
}
export type Presence = Record<PlayerId, PresenceEntry>;

export interface OpponentRecord {
  name: string;
  played: number;
  won: number;
}

export interface PlayerStats {
  username: string;
  matchesPlayed: number;
  matchesWon: number;
  roundsWon: number;
  roundsLost: number;
  /** Keyed by lower-cased opponent name; bot games are recorded per level as "Bot (Easy)", "Bot (Medium)" or "Bot (Hard)". */
  opponents: Record<string, OpponentRecord>;
  /** Times each named character was committed to an engagement. Keyed by character id. */
  characters: Record<string, number>;
}

export type ErrorCode =
  | 'bad_json'
  | 'too_large'
  | 'bad_message'
  | 'unknown_type'
  | 'need_hello'
  | 'bad_username'
  | 'not_found'
  | 'full'
  | 'bad_seat'
  | 'not_started'
  | 'stale'
  | 'illegal'
  | 'bad_chat'
  | 'not_over'
  | 'busy'
  | 'rate_limited'
  | 'internal';

export type ServerMessage =
  | { t: 'welcome'; username: string }
  | { t: 'joined'; gameId: string; seat: PlayerId; seatToken: string }
  | { t: 'state'; gameId: string; view: PlayerView; events: GameEvent[]; version: number }
  | { t: 'chat'; gameId: string; from: PlayerId; name: string; text: string; ts: number }
  | { t: 'presence'; gameId: string; players: Presence }
  | { t: 'stats'; username: string; stats: PlayerStats }
  /** Sent to a finished game's connections when a player starts the rematch game `next`. */
  | { t: 'rematch'; gameId: string; next: string; by: PlayerId }
  | { t: 'pong' }
  | { t: 'error'; code: ErrorCode; message: string };

/** Zero-width characters and bidi controls: never shown, only used to spoof or hide text. */
// eslint-disable-next-line no-misleading-character-class
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

export function stripInvisible(s: string): string {
  return s.replace(INVISIBLE, '');
}

/** Display-name cleanup: NFKC, no invisible characters. */
export function normalizeName(s: string): string {
  return stripInvisible(s.normalize('NFKC'));
}

/** The name the bot opponent goes by; humans may not use it. */
export const BOT_NAME = 'Bot';

export function statsKey(username: string): string {
  return normalizeName(username).trim().toLowerCase();
}

export function emptyStats(username: string): PlayerStats {
  return {
    username,
    matchesPlayed: 0,
    matchesWon: 0,
    roundsWon: 0,
    roundsLost: 0,
    opponents: {},
    characters: {},
  };
}
