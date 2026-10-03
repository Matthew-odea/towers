// Local copy of the wire protocol (docs/ARCHITECTURE.md). The server package's protocol module
// is still a stub; switch these to `import type ... from '@towers/server/protocol'` once it lands.
import type { Action, GameEvent, PlayerId, PlayerView } from '@towers/engine';
import type { Presence } from './types';

export type ClientMessage =
  | { t: 'hello'; username: string }
  | { t: 'create'; vsBot: boolean }
  | { t: 'join'; gameId: string; seatToken?: string }
  | { t: 'action'; gameId: string; seatToken: string; action: Action; expectedVersion: number }
  | { t: 'chat'; gameId: string; seatToken: string; text: string }
  | { t: 'stats'; username: string }
  | { t: 'ping' };

export type ServerMessage =
  | { t: 'welcome'; username: string }
  | { t: 'joined'; gameId: string; seat: PlayerId; seatToken: string }
  | { t: 'state'; gameId: string; view: PlayerView; events: GameEvent[]; version: number }
  | { t: 'chat'; gameId: string; from: string; text: string; ts: number }
  | { t: 'presence'; gameId: string; players: Presence }
  | { t: 'stats'; stats: unknown }
  | { t: 'pong' }
  | { t: 'error'; code: string; message: string };
