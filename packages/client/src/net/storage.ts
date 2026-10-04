// localStorage can throw or be absent (private windows, tests). Never let that break the app.
export function readStore(key: string): string | null {
  try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
}
export function writeStore(key: string, value: string): void {
  try { globalThis.localStorage?.setItem(key, value); } catch { /* ignore */ }
}
export function removeStore(key: string): void {
  try { globalThis.localStorage?.removeItem(key); } catch { /* ignore */ }
}
export const NAME_KEY = 'towers.name';
export const seatKey = (gameId: string) => `towers.seat.${gameId}`;
export const getName = () => (readStore(NAME_KEY) ?? '').trim();
export const setName = (n: string) => writeStore(NAME_KEY, n.trim());
export const BOT_LEVEL_KEY = 'towers.botLevel';
export type StoredBotLevel = 'easy' | 'medium' | 'hard';
/** The last bot difficulty chosen on the landing page (default 'medium'). */
export function getBotLevel(): StoredBotLevel {
  const v = readStore(BOT_LEVEL_KEY);
  return v === 'easy' || v === 'medium' || v === 'hard' ? v : 'medium';
}
export const setBotLevel = (l: StoredBotLevel) => writeStore(BOT_LEVEL_KEY, l);
