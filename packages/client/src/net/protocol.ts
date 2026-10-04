// Wire protocol: the server package owns it; the client only uses its types.
export type {
  ClientMessage,
  ServerMessage,
  Presence as WirePresence,
  PresenceEntry,
  PlayerStats,
  OpponentRecord,
  ErrorCode,
} from '@towers/server/protocol';
