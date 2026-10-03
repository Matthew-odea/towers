import type { ServerMessage } from './protocol';
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

/** Tolerant of the server's exact field names (matches/played, per-opponent map or list). */
export function normalizeStats(raw: unknown): StatsData {
  const s = rec(raw);
  const opp = s.opponents ?? s.perOpponent ?? s.vs;
  const opponents: StatsData['opponents'] = [];
  const addOpp = (name: string, o: unknown) => {
    const r = rec(o);
    opponents.push({ name, played: num(r.played ?? r.matches ?? r.games), won: num(r.won ?? r.wins) });
  };
  if (Array.isArray(opp)) opp.forEach((o) => addOpp(String(rec(o).name ?? rec(o).opponent ?? '?'), o));
  else Object.entries(rec(opp)).forEach(([k, v]) => addOpp(k, v));

  const ch = s.characters ?? s.characterCommits ?? s.commits;
  const characters: StatsData['characters'] = [];
  if (Array.isArray(ch)) ch.forEach((c) => characters.push({ id: String(rec(c).id ?? rec(c).character), count: num(rec(c).count ?? rec(c).commits) }));
  else Object.entries(rec(ch)).forEach(([k, v]) => characters.push({ id: k, count: num(v) }));
  characters.sort((a, b) => b.count - a.count);
  opponents.sort((a, b) => b.played - a.played);

  return {
    played: num(s.played ?? s.matchesPlayed ?? s.matches),
    won: num(s.won ?? s.matchesWon ?? s.wins),
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
      else if (msg.t === 'error') done(() => reject(new Error(msg.message)));
    };
  });
}
