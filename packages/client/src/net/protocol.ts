// Wire protocol: the server package owns it; the client only uses its types.
export type {
  ClientMessage,
  ServerMessage,
  Presence as WirePresence,
  PresenceEntry,
  PlayerStats,
  OpponentRecord,
  ErrorCode,
  BotDifficulty,
} from '@towers/server/protocol';
export { BOT_DIFFICULTIES, DEFAULT_BOT_LEVEL, parseBotLevel } from '@towers/server/protocol';
