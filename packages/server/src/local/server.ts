import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { GameService } from '../core/game-service';
import { MemoryConnectionStore, MemoryGameStore, MemoryStatsStore } from '../core/memory-stores';
import type { PlayerStats, ServerMessage } from '../core/protocol';
import type { Broadcaster } from '../core/types';

export interface LocalServerOptions {
  port?: number;
  host?: string;
  /** Where stats are persisted. Omit for in-memory only. */
  statsFile?: string;
  /** Directory of the built client. Omit or missing: no static serving. */
  clientDir?: string;
  quiet?: boolean;
}

export interface LocalServer {
  server: http.Server;
  port: number;
  service: GameService;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

function loadStats(file?: string): Record<string, PlayerStats> {
  if (!file) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, PlayerStats>;
  } catch {
    return {};
  }
}

function makeStatsPersister(file: string) {
  let timer: NodeJS.Timeout | null = null;
  let latest: Record<string, PlayerStats> | null = null;
  const flush = () => {
    timer = null;
    if (!latest) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(latest, null, 2));
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('could not write stats file', err);
    }
    latest = null;
  };
  return {
    schedule(all: Record<string, PlayerStats>) {
      latest = all;
      timer ??= setTimeout(flush, 200);
    },
    flushNow() {
      if (timer) clearTimeout(timer);
      flush();
    },
  };
}

export async function startLocalServer(opts: LocalServerOptions = {}): Promise<LocalServer> {
  const sockets = new Map<string, WebSocket>();

  const out: Broadcaster = {
    async send(id, msg: ServerMessage) {
      const ws = sockets.get(id);
      if (!ws || ws.readyState !== WebSocket.OPEN) return 'gone';
      return new Promise((resolve) => ws.send(JSON.stringify(msg), (err) => resolve(err ? 'gone' : 'ok')));
    },
  };

  const games = new MemoryGameStore();
  const connections = new MemoryConnectionStore();
  const stats = new MemoryStatsStore(loadStats(opts.statsFile));
  const persister = opts.statsFile ? makeStatsPersister(opts.statsFile) : null;
  if (persister) stats.onChange = (all) => persister.schedule(all);

  const service = new GameService({
    games,
    connections,
    stats,
    out,
    log: opts.quiet ? () => {} : undefined,
  });

  const clientDir = opts.clientDir && fs.existsSync(path.join(opts.clientDir, 'index.html')) ? path.resolve(opts.clientDir) : null;

  const server = http.createServer((req, res) => {
    try {
      handleHttp(req, res, clientDir);
    } catch {
      res.writeHead(500).end('error');
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    const id = randomUUID();
    sockets.set(id, ws);
    let alive = true;
    ws.on('pong', () => (alive = true));
    const beat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 30_000);
    // Handle one message at a time per socket so replies stay in order.
    let chain: Promise<void> = service.handleConnect(id).catch(() => {});
    ws.on('message', (data, isBinary) => {
      const raw = isBinary ? null : data.toString();
      chain = chain.then(() => service.handleMessage(id, raw as string));
    });
    ws.on('close', () => {
      clearInterval(beat);
      sockets.delete(id);
      chain = chain.then(() => service.handleDisconnect(id)).catch(() => {});
    });
    ws.on('error', () => {});
  });

  const sweeper = setInterval(() => games.sweep(Date.now()), 60 * 60 * 1000);
  sweeper.unref();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 8787, opts.host, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;

  return {
    server,
    port,
    service,
    async close() {
      clearInterval(sweeper);
      persister?.flushNow();
      for (const ws of sockets.values()) ws.terminate();
      wss.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

function handleHttp(req: http.IncomingMessage, res: http.ServerResponse, clientDir: string | null): void {
  const url = new URL(req.url ?? '/', 'http://x');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/config.json') {
    const host = req.headers.host ?? 'localhost';
    const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0]!.trim() === 'https' ? 'wss' : 'ws';
    res.writeHead(200, { 'content-type': MIME['.json']!, 'cache-control': 'no-store' });
    res.end(JSON.stringify({ wsUrl: `${proto}://${host}/ws` }));
    return;
  }
  if (pathname === '/robots.txt') {
    res.writeHead(200, { 'content-type': MIME['.txt']! });
    res.end('User-agent: *\nDisallow: /\n');
    return;
  }
  if (!clientDir) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Client not built. Run "npm start" or use the Vite dev server.\n');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }

  const rel = path.normalize(pathname).replace(/^([/\\])+/, '');
  let file = path.join(clientDir, rel);
  if (file !== clientDir && !file.startsWith(clientDir + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  let stat = safeStat(file);
  if (stat?.isDirectory()) {
    file = path.join(file, 'index.html');
    stat = safeStat(file);
  }
  if (!stat?.isFile()) {
    if (path.extname(pathname)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    file = path.join(clientDir, 'index.html'); // SPA fallback
    stat = safeStat(file);
    if (!stat) {
      res.writeHead(404).end();
      return;
    }
  }
  const ext = path.extname(file).toLowerCase();
  const hashed = /[\\/]assets[\\/]/.test(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-robots-tag': 'noindex, nofollow',
  });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(file).pipe(res);
}

function safeStat(f: string): fs.Stats | null {
  try {
    return fs.statSync(f);
  } catch {
    return null;
  }
}
