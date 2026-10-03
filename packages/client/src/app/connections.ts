import type { GameConnection } from '../net/types';

/** Connections made before navigation (create / rematch), picked up by the game route. */
const pending = new Map<string, GameConnection>();

export function stashConnection(conn: GameConnection): void {
  pending.set(conn.gameId, conn);
}
export function takeConnection(gameId: string): GameConnection | null {
  const c = pending.get(gameId) ?? null;
  pending.delete(gameId);
  return c;
}
