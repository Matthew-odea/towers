import type { PlayerStats, ServerMessage } from './protocol';
import { loadConfig } from './config';

export interface StatsData {
  played: number;
  won: number;
  roundsWon: number;
  roundsLost: number;
  opponents: { name: string; played: number; won: number }[];
  characters: { id: string; count: number }[];
}

const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/**
 * Flattens the server's PlayerStats ({ matchesPlayed, matchesWon, roundsWon, roundsLost,
 * opponents: { [lowercased name]: { name, played, won } }, characters: { [id]: count } }) for
 * display. Defensive about missing fields; opponents are shown by their display name.
 */
export function normalizeStats(raw: PlayerStats | unknown): StatsData {
  const s = rec(raw);
  const opponents: StatsData['opponents'] = Object.entries(rec(s.opponents)).map(([key, o]) => {
    const r = rec(o);
    return { name: typeof r.name === 'string' && r.name ? r.name : key, played: num(r.played), won: num(r.won) };
  });
  const characters: StatsData['characters'] = Object.entries(rec(s.characters)).map(([id, n]) => ({ id, count: num(n) }));
  characters.sort((a, b) => b.count - a.count);
  opponents.sort((a, b) => b.played - a.played);
  return {
    played: num(s.matchesPlayed),
    won: num(s.matchesWon),
    roundsWon: num(s.roundsWon),
    roundsLost: num(s.roundsLost),
    opponents,
    characters,
  };
}

export async function fetchStats(
  username: string,
  deps: { wsUrl?: () => Promise<string>; WebSocketImpl?: new (url: string) => WebSocket; timeoutMs?: number } = {},
): Promise<StatsData> {
  const url = deps.wsUrl ? await deps.wsUrl() : (await loadConfig()).wsUrl;
  const Impl = deps.WebSocketImpl ?? WebSocket;
  return new Promise<StatsData>((resolve, reject) => {
    let ws: WebSocket;
    const done = (fn: () => void) => { clearTimeout(timer); try { ws?.close(); } catch { /* ignore */ } fn(); };
    const timer = setTimeout(() => done(() => reject(new Error('timeout'))), deps.timeoutMs ?? 6000);
    try { ws = new Impl(url); } catch (e) { clearTimeout(timer); return reject(e); }
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', username }));
    ws.onerror = () => done(() => reject(new Error('unreachable')));
    ws.onclose = () => done(() => reject(new Error('closed')));
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.t === 'welcome') ws.send(JSON.stringify({ t: 'stats', username }));
      else if (msg.t === 'stats') done(() => resolve(normalizeStats(msg.stats)));
      // Replies are { t: 'stats', username, stats: PlayerStats } (server/core/protocol.ts).
      else if (msg.t === 'error') done(() => reject(new Error(msg.message)));
    };
  });
}
