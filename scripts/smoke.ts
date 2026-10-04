// Live smoke test: npx tsx scripts/smoke.ts <wsUrl>
import WebSocket from 'ws';
import { chooseBotAction, pendingDecision } from '@towers/engine';

const url = process.argv[2] ?? process.env.WS_URL;
if (!url) throw new Error('usage: tsx scripts/smoke.ts <wsUrl>');

type Msg = any;
class Client {
  ws!: WebSocket;
  q: Msg[] = [];
  waiters: Array<() => void> = [];
  constructor(public name: string) {}
  async open() {
    this.ws = new WebSocket(url!);
    this.ws.on('message', (d) => { this.q.push(JSON.parse(String(d))); this.waiters.splice(0).forEach((w) => w()); });
    await new Promise<void>((res, rej) => { this.ws.on('open', () => res()); this.ws.on('error', rej); });
  }
  send(m: Msg) { this.ws.send(JSON.stringify(m)); }
  async next(pred: (m: Msg) => boolean, ms = 15000): Promise<Msg> {
    const end = Date.now() + ms;
    for (;;) {
      const i = this.q.findIndex(pred);
      if (i >= 0) return this.q.splice(i, 1)[0];
      const left = end - Date.now();
      if (left <= 0) throw new Error(`${this.name}: timeout waiting; queue=${JSON.stringify(this.q.map((m) => m.t + (m.code ? ':' + m.code : '')))}`);
      await new Promise<void>((r) => { this.waiters.push(r); setTimeout(r, left); });
    }
  }
  async hello() { this.send({ t: 'hello', username: this.name }); await this.next((m) => m.t === 'welcome'); }
}
const check = (c: any, msg: string) => { if (!c) throw new Error('FAIL: ' + msg); console.log('ok  ' + msg); };

async function vsBot() {
  const c = new Client('SmokeBot' + Math.floor(Math.random() * 1e4));
  await c.open(); await c.hello();
  c.send({ t: 'create', vsBot: true });
  const j = await c.next((m) => m.t === 'joined');
  check(j.gameId && j.seatToken, 'bot game created');
  const seat = j.seat;
  let st = await c.next((m) => m.t === 'state');
  let view = st.view; let version = st.version;
  let turns = 0, actions = 0;
  let lastTurnPlayer: string | null = null;
  const track = (v: any) => { const p = pendingDecision(v) as any; if (p.kind === 'turn') { if (p.player === seat && lastTurnPlayer !== seat) turns++; lastTurnPlayer = p.player; } };
  const sendAct = async (action: any) => {
    c.send({ t: 'action', gameId: j.gameId, seatToken: j.seatToken, action, expectedVersion: version });
    // consume states until the human has a decision again or game over
    for (;;) {
      const m = await c.next((x) => x.t === 'state' || x.t === 'error');
      if (m.t === 'error') throw new Error(`action rejected: ${m.code} ${m.message} ${JSON.stringify(action)}`);
      if (!(m.version > version)) throw new Error(`version not incrementing ${version} -> ${m.version}`);
      version = m.version; view = m.view; actions++; track(view);
      if (view.phase === 'matchOver') return;
      const pd = pendingDecision(view);
      if (pd.players.includes(seat)) { await new Promise((r) => setTimeout(r, 150)); if (!c.q.some((x) => x.t === 'state')) return; }
    }
  };
  while (turns < 6 && view.phase !== 'matchOver') {
    const a = chooseBotAction(view, seat);
    if (!a) { await new Promise((r) => setTimeout(r, 300)); const m = await c.next((x) => x.t === 'state'); view = m.view; version = m.version; continue; }
    track(view);
    await sendAct(a);
    if (actions > 1500) break;
  }
  console.log('end phase', view.phase);
  check(turns >= 5, `played ${turns} own turns (${actions} state updates)`);
  c.send({ t: 'action', gameId: j.gameId, seatToken: j.seatToken, action: { type: 'concede', player: seat }, expectedVersion: version });
  for (;;) {
    const m = await c.next((x) => x.t === 'state' || x.t === 'error');
    if (m.t === 'error' && m.code === 'stale') { version = version; continue; }
    if (m.t === 'error') throw new Error('concede: ' + m.code);
    if (m.view.roundResults?.some((r: any) => r.reason === 'concede') || m.view.phase === 'matchOver') { check(true, 'conceded'); break; }
  }
  c.ws.close();
}

async function pvp() {
  const a = new Client('SmokeA' + Math.floor(Math.random() * 1e4));
  const b = new Client('SmokeB' + Math.floor(Math.random() * 1e4));
  await a.open(); await b.open(); await a.hello(); await b.hello();
  a.send({ t: 'create', vsBot: false });
  const ja = await a.next((m) => m.t === 'joined');
  b.send({ t: 'join', gameId: ja.gameId });
  const jb = await b.next((m) => m.t === 'joined');
  check(ja.seat !== jb.seat, `pvp seats differ (${ja.seat}/${jb.seat})`);
  const sa = await a.next((m) => m.t === 'state');
  const sb = await b.next((m) => m.t === 'state');
  let version = Math.max(sa.version, sb.version);
  const act = chooseBotAction(sa.view, ja.seat)!;
  check(act, 'setup action chosen: ' + act.type);
  a.send({ t: 'action', gameId: ja.gameId, seatToken: ja.seatToken, action: act, expectedVersion: sa.version });
  const ua = await a.next((m) => m.t === 'state'); const ub = await b.next((m) => m.t === 'state');
  check(ua.version > version && ub.version === ua.version, 'pvp action broadcast to both with version bump');
  a.send({ t: 'chat', gameId: ja.gameId, seatToken: ja.seatToken, text: 'hello from smoke' });
  const ch = await b.next((m) => m.t === 'chat' && m.text === 'hello from smoke');
  check(ch.name, 'chat received by opponent');
  const c3 = new Client('SmokeC'); await c3.open(); await c3.hello();
  c3.send({ t: 'join', gameId: ja.gameId });
  const e = await c3.next((m) => m.t === 'error'); check(e.code === 'full', 'third joiner rejected: full');
  c3.ws.close();
  a.send({ t: 'action', gameId: ja.gameId, seatToken: ja.seatToken, action: { type: 'concede', player: ja.seat }, expectedVersion: ua.version });
  await a.next((m) => m.t === 'state'); check(true, 'pvp concede');
  a.ws.close(); b.ws.close();
}

const t0 = Date.now();
vsBot().then(pvp).then(() => { console.log(`SMOKE PASS (${Date.now() - t0} ms)`); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
