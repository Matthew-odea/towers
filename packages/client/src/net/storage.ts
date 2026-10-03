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
