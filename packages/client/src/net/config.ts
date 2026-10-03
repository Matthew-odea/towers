export interface ClientConfig { wsUrl: string }

let cached: Promise<ClientConfig> | null = null;

function defaultWsUrl(): string {
  const l = globalThis.location;
  if (!l) return 'ws://localhost:8787/ws';
  return `${l.protocol === 'https:' ? 'wss' : 'ws'}://${l.host}/ws`;
}

/** Reads /config.json once; falls back to same-origin /ws if it is missing. */
export function loadConfig(fetchImpl: typeof fetch = fetch): Promise<ClientConfig> {
  if (!cached) {
    cached = (async () => {
      try {
        const res = await fetchImpl('/config.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as Partial<ClientConfig>;
        if (typeof json.wsUrl === 'string' && json.wsUrl) return { wsUrl: json.wsUrl };
      } catch { /* fall through */ }
      return { wsUrl: defaultWsUrl() };
    })();
  }
  return cached;
}

export function resetConfigCache(): void { cached = null; }
