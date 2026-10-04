import { useCallback, useEffect, useState } from 'react';
import { WebSocketTransport, TransportError } from '../net/WebSocketTransport';
import { LocalTransport } from '../net/LocalTransport';
import type { GameConnection } from '../net/types';
import { getBotLevel, getName } from '../net/storage';
import { gamePath, navigate } from './route';
import { stashConnection, takeConnection } from './connections';
import { NameGate } from './NameGate';
import { GameShell } from './GameShell';

type Conn = { conn: GameConnection } | { error: string } | null;

function describe(e: unknown): string {
  const code = e instanceof TransportError ? e.code : '';
  if (code === 'full') return 'This game is full.';
  if (code === 'not_found') return 'This game no longer exists.';
  return 'The server is unreachable.';
}

export function GameRoute({ gameId }: { gameId: string }) {
  const [name, setName] = useState(getName);
  const [state, setState] = useState<Conn>(null);

  useEffect(() => {
    if (!name) return;
    let live = true;
    let opened: GameConnection | null = null;
    setState(null);
    const cached = takeConnection(gameId);
    (cached ? Promise.resolve(cached) : WebSocketTransport.join(name, gameId)).then(
      (conn) => { opened = conn; if (live) setState({ conn }); else conn.close(); },
      (e) => { if (live) setState({ error: describe(e) }); },
    );
    return () => { live = false; opened?.close(); };
  }, [gameId, name]);

  const rematch = useCallback(async () => {
    if (!state || !('conn' in state)) return;
    try {
      // The first player to ask creates the follow-up game; the other joins the same one.
      const next = await WebSocketTransport.rematch(name, { gameId: state.conn.gameId, seat: state.conn.seat });
      stashConnection(next);
      navigate(gamePath(next.gameId));
    } catch { /* stay on the finished game */ }
  }, [state, name]);

  if (!name) return <NameGate onDone={setName} />;
  if (!state) return <main className="landing storm-field" />;
  if ('error' in state) {
    return (
      <main className="landing storm-field">
        <p className="quiet">{state.error}</p>
        <a className="stats-link" href="#/">Back</a>
      </main>
    );
  }
  return (
    <GameShell
      conn={state.conn}
      online
      onLeave={() => navigate('#/')}
      onRematch={() => void rematch()}
    />
  );
}

export function OfflineRoute() {
  const name = getName() || 'You';
  const [level] = useState(getBotLevel);
  const [conn, setConn] = useState<GameConnection>(() => new LocalTransport({ name, level }));
  useEffect(() => () => conn.close(), [conn]);
  return (
    <GameShell
      conn={conn}
      online={false}
      onLeave={() => navigate('#/')}
      onRematch={() => setConn(new LocalTransport({ name, level }))}
    />
  );
}
