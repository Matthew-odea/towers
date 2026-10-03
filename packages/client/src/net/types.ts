// packages/client/src/net/types.ts — shared contract between the app shell and the game screen
import type { Action, PlayerId, PlayerView, GameEvent } from '@towers/engine';
export interface StateUpdate { view: PlayerView; events: GameEvent[]; version: number }
export interface ChatMessage { from: string; text: string; ts: number }
export interface SeatPresence { name: string; connected: boolean; bot: boolean }
export interface Presence { red: SeatPresence | null; black: SeatPresence | null }
export interface ConnectionListener {
  onState?(update: StateUpdate): void;
  onChat?(message: ChatMessage): void;
  onPresence?(presence: Presence): void;
  onError?(error: { code: string; message: string }): void;
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
