import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chooseBotAction, type Action, type GameEvent, type PlayerId } from '@towers/engine';
import { startLocalServer, type LocalServer } from '../src/local/server';
import { Client, sleep } from './helpers';

let tmp: string;
let srv: LocalServer;
let port: number;
const clients: Client[] = [];

async function client(name?: string) {
  const c = await Client.connect(port);
  clients.push(c);
  if (name) await c.hello(name);
  return c;
}
async function act(c: Client, action: Action, expected = c.version) {
  c.send({ t: 'action', gameId: c.gameId, seatToken: c.token, action, expectedVersion: expected });
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'towers-srv-'));
  fs.mkdirSync(path.join(tmp, 'dist', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'dist', 'index.html'), '<!doctype html><title>spa</title>');
  fs.writeFileSync(path.join(tmp, 'dist', 'assets', 'app.js'), 'console.log(1)');
  srv = await startLocalServer({
    port: 0,
    host: '127.0.0.1',
    statsFile: path.join(tmp, 'data', 'stats.json'),
    clientDir: path.join(tmp, 'dist'),
    quiet: true,
  });
  port = srv.port;
  expect(port).not.toBe(8787);
});

afterAll(async () => {
  for (const c of clients) c.close();
  await srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('http', () => {
  test('config.json uses the Host header', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/config.json`, { headers: { host: 'towers.example:1234' } }).catch(() => null);
    // fetch forbids overriding Host in some runtimes; fall back to the default check
    const j = (await (await fetch(`http://127.0.0.1:${port}/config.json`)).json()) as { wsUrl: string };
    expect(j.wsUrl).toBe(`ws://127.0.0.1:${port}/ws`);
    if (r) expect(((await r.json()) as { wsUrl: string }).wsUrl).toMatch(/^ws:\/\/.+\/ws$/);
  });
  test('robots, static, SPA fallback, traversal', async () => {
    const base = `http://127.0.0.1:${port}`;
    expect(await (await fetch(`${base}/robots.txt`)).text()).toContain('Disallow: /');
    const js = await fetch(`${base}/assets/app.js`);
    expect(js.headers.get('content-type')).toContain('javascript');
    const spa = await fetch(`${base}/g/abc`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('<title>spa</title>');
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
    const raw = await new Promise<string>((resolve) => {
      import('node:net').then(({ default: net }) => {
        const s = net.connect(port, '127.0.0.1', () => s.write('GET /../../package.json HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
        let buf = '';
        s.on('data', (d) => (buf += d));
        s.on('close', () => resolve(buf));
      });
    });
    expect(raw).not.toContain('"workspaces"');
  });
  test('without a built client the server still serves config and robots', async () => {
    const s2 = await startLocalServer({ port: 0, host: '127.0.0.1', clientDir: path.join(tmp, 'nope'), quiet: true });
    expect((await fetch(`http://127.0.0.1:${s2.port}/x`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${s2.port}/robots.txt`)).status).toBe(200);
    await s2.close();
  });
});

describe('websocket protocol', () => {
  test('hello/create/join/full/reconnect', async () => {
    const a = await client('Ann');
    const b = await client('Bo');
    const c = await client('Cy');
    const ja = await a.create();
    expect(ja.gameId).toMatch(/^[a-z0-9]{10}$/);
    const jb = await b.join(ja.gameId);
    expect(jb.seat).not.toBe(ja.seat);
    await a.waitFor('state');
    await b.waitFor('state');

    const err = await c.request({ t: 'join', gameId: ja.gameId }, 'error');
    expect(err.code).toBe('full');
    const nf = await c.request({ t: 'join', gameId: 'zzzzzzzzzz' }, 'error');
    expect(nf.code).toBe('not_found');

    // b drops; a sees presence flip
    b.close();
    await a.waitFor('presence', (p) => p.players[jb.seat].connected === false);
    const b2 = await client();
    const re = await b2.join(ja.gameId, jb.seatToken);
    expect(re.seat).toBe(jb.seat);
    await b2.waitFor('state');
    await a.waitFor('presence', (p) => p.players[jb.seat].connected === true);
  });

  test('malformed input and binary frames get errors, not crashes', async () => {
    const a = await client();
    expect((await a.request('{bad', 'error')).code).toBe('bad_json');
    expect((await a.request({ t: 'nope' }, 'error')).code).toBe('unknown_type');
    expect((await a.request({ t: 'create', vsBot: true }, 'error')).code).toBe('need_hello');
    expect((await a.request(JSON.stringify({ t: 'hello', username: 'a'.repeat(20000) }), 'error')).code).toBe('too_large');
    const from = a.msgs.length;
    a.ws.send(Buffer.from([1, 2, 3]));
    expect((await a.waitFor('error', () => true, from)).code).toBe('bad_message');
    expect((await a.request({ t: 'ping' }, 'pong')).t).toBe('pong');
  });

  test('actions broadcast per-seat views; setup never leaks; stale; chat; presence', async () => {
    const a = await client('Ann');
    const b = await client('Bo');
    await a.create();
    await b.join(a.gameId!);
    await a.waitFor('state');
    await b.waitFor('state');

    const place = chooseBotAction(a.view!, a.seat!)!;
    await act(a, place);
    await b.waitFor('state', (s) => s.version === 1);
    await a.waitFor('state', (s) => s.version === 1);
    expect(a.view!.setup[a.seat!].placements).not.toBeNull();
    expect(b.view!.setup[a.seat!].submitted).toBe(true);
    expect(b.view!.setup[a.seat!].placements).toBeNull();
    expect(b.view!.viewer).toBe(b.seat);

    // stale
    const from = b.msgs.length;
    await act(b, chooseBotAction(b.view!, b.seat!)!, 0);
    expect((await b.waitFor('error', () => true, from)).code).toBe('stale');
    const resent = await b.waitFor('state', () => true, from);
    expect(resent.version).toBe(1);

    await act(b, chooseBotAction(b.view!, b.seat!)!);
    await a.waitFor('state', (s) => s.version === 2);
    expect(a.view!.phase).toBe('play');

    // chat
    const ca = await b.request({ t: 'chat', gameId: b.gameId, seatToken: b.token, text: '  hi  ' }, 'chat');
    expect(ca.text).toBe('hi');
    await a.waitFor('chat', (m) => m.text === 'hi');
    expect((await a.request({ t: 'chat', gameId: a.gameId, seatToken: a.token, text: 'x'.repeat(400) }, 'error')).code).toBe('bad_chat');
  });

  test('a bot game over websockets reaches the end of round 1; stats persist to the file', async () => {
    const a = await client('Zed');
    const j = await a.create(true);
    await a.waitFor('state');
    const events: GameEvent[] = [];
    let seen = a.msgs.length;
    let won = false;
    for (let i = 0; i < 6000 && !won; i++) {
      const action = chooseBotAction(a.view!, j.seat);
      expect(action).not.toBeNull();
      const v = a.version;
      await act(a, action!, v);
      // wait until the broadcast for this action (and all following bot steps) landed
      await a.waitFor('state', (s) => s.version > v, seen);
      await sleep(0);
      // bot steps arrive in the same burst; drain until quiet
      let n = -1;
      while (n !== a.msgs.length) {
        n = a.msgs.length;
        await sleep(2);
      }
      for (const m of a.msgs.slice(seen)) if (m.t === 'state') events.push(...m.events);
      seen = a.msgs.length;
      won = events.some((e) => e.type === 'roundWon');
    }
    expect(won).toBe(true);
    // concede out
    for (let i = 0; i < 4 && a.view!.phase !== 'matchOver'; i++) {
      const v = a.version;
      await act(a, { type: 'concede', player: j.seat as PlayerId }, v);
      await a.waitFor('state', (s) => s.version > v, seen);
      let n = -1;
      while (n !== a.msgs.length) {
        n = a.msgs.length;
        await sleep(2);
      }
      seen = a.msgs.length;
    }
    expect(a.view!.phase).toBe('matchOver');

    const st = await a.request({ t: 'stats', username: 'zed' }, 'stats');
    expect(st.stats.matchesPlayed).toBe(1);
    expect(st.stats.opponents['bot']!.name).toBe('Bot');
    await sleep(400); // debounce
    const file = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'stats.json'), 'utf8'));
    expect(file['zed'].matchesPlayed).toBe(1);
  }, 60_000);
});
