/** Per-key token bucket. In-memory: cheap, and per Lambda container (a hot connection mostly hits one). */
export interface RateLimiter {
  allow(key: string): boolean;
}

export class TokenBucketLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private readonly capacity = 10,
    private readonly refillPerSecond = 2,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 2000,
  ) {}

  allow(key: string): boolean {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.prune(t);
      b = { tokens: this.capacity, at: t };
      this.buckets.set(key, b);
    } else {
      b.tokens = Math.min(this.capacity, b.tokens + ((t - b.at) / 1000) * this.refillPerSecond);
      b.at = t;
    }
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Drops buckets that have refilled completely (idle keys). */
  private prune(t: number): void {
    for (const [k, b] of this.buckets) {
      if (b.tokens + ((t - b.at) / 1000) * this.refillPerSecond >= this.capacity) this.buckets.delete(k);
    }
    if (this.buckets.size >= this.maxKeys) this.buckets.clear();
  }
}
