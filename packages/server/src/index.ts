export const SERVER_VERSION = '0.1.0';
export * from './core/protocol';
export * from './core/types';
export { GameService, BOT_STEP_CAP, type GameServiceDeps } from './core/game-service';
export { MemoryGameStore, MemoryConnectionStore, MemoryStatsStore } from './core/memory-stores';
