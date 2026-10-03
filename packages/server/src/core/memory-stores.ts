import type { PlayerStats } from './protocol';
import type { ConnectionRecord, ConnectionStore, GameRecord, GameStore, StatsStore } from './types';

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryGameStore implements GameStore {
  private readonly map = new Map<string, GameRecord>();
  async get(id: string) {
    const r = this.map.get(id);
    return r ? clone(r) : null;
  }
  async put(rec: GameRecord, expectedRev: number | null) {
    const cur = this.map.get(rec.id);
    if ((cur?.rev ?? null) !== expectedRev) return false;
    this.map.set(rec.id, clone(rec));
    return true;
  }
  /** Drops expired games; call occasionally. */
  sweep(nowMs: number) {
    for (const [k, v] of this.map) if (v.expiresAt * 1000 < nowMs) this.map.delete(k);
  }
  get size() {
    return this.map.size;
  }
}

export class MemoryConnectionStore implements ConnectionStore {
  private readonly map = new Map<string, ConnectionRecord>();
  async get(id: string) {
    const r = this.map.get(id);
    return r ? clone(r) : null;
  }
  async put(conn: ConnectionRecord) {
    this.map.set(conn.id, clone(conn));
  }
  async remove(id: string) {
    const r = this.map.get(id) ?? null;
    this.map.delete(id);
    return r;
  }
  async listByGame(gameId: string) {
    return [...this.map.values()].filter((c) => c.gameId === gameId).map(clone);
  }
}

export class MemoryStatsStore implements StatsStore {
  private readonly map = new Map<string, PlayerStats>();
  /** Called after every update (the local server uses it to persist to disk). */
  onChange?: (all: Record<string, PlayerStats>) => void;
  constructor(initial?: Record<string, PlayerStats>) {
    for (const [k, v] of Object.entries(initial ?? {})) this.map.set(k, v);
  }
  async get(key: string) {
    const r = this.map.get(key);
    return r ? clone(r) : null;
  }
  async update(key: string, fn: (cur: PlayerStats | null) => PlayerStats) {
    const cur = this.map.get(key);
    const next = fn(cur ? clone(cur) : null);
    this.map.set(key, next);
    this.onChange?.(Object.fromEntries(this.map));
    return clone(next);
  }
}
