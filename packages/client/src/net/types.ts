// packages/client/src/net/types.ts — shared contract between the app shell and the game screen
import type { Action, PlayerId, PlayerView, GameEvent } from '@towers/engine';
import type { BotDifficulty } from './protocol';
export interface StateUpdate { view: PlayerView; events: GameEvent[]; version: number }
/** `from` is the sender's seat; `name` their display name. */
export interface ChatMessage { from: PlayerId; name: string; text: string; ts: number }
/** `botLevel` is set for a bot seat. */
export interface SeatPresence { name: string; connected: boolean; bot: boolean; botLevel?: BotDifficulty }
/** A seat is null while nobody has taken it (an online game waiting for its second player). */
export interface Presence { red: SeatPresence | null; black: SeatPresence | null }
export interface ConnectionListener {
  onState?(update: StateUpdate): void;
  onChat?(message: ChatMessage): void;
  onPresence?(presence: Presence): void;
  onError?(error: { code: string; message: string }): void;
  /** The opponent started a rematch game (online only). */
  onRematchOffer?(nextGameId: string): void;
}
export interface GameConnection {
  readonly gameId: string;
  readonly seat: PlayerId;
  subscribe(listener: ConnectionListener): () => void;   // returns unsubscribe
  getLatest(): StateUpdate | null;
  getChat(): ChatMessage[];
  getPresence(): Presence | null;
  sendAction(action: Action): void;
  sendChat(text: string): void;
  close(): void;
}
