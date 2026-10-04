import { useRef, useState } from 'react';
import { WebSocketTransport } from '../net/WebSocketTransport';
import { getName, setName } from '../net/storage';
import { gamePath, navigate } from './route';
import { stashConnection } from './connections';

export function Landing() {
  const [name, setNameState] = useState(getName);
  const [busy, setBusy] = useState<'new' | 'bot' | null>(null);
  const [problem, setProblem] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const ready = name.trim().length > 0;

  const start = async (vsBot: boolean) => {
    if (!ready) { input.current?.focus(); return; }
    setName(name);
    setBusy(vsBot ? 'bot' : 'new');
    setProblem('');
    try {
      const conn = await WebSocketTransport.create(name.trim(), vsBot);
      stashConnection(conn);
      navigate(gamePath(conn.gameId));
    } catch {
      if (vsBot) navigate('#/offline');
      else { setProblem('The server is unreachable.'); setBusy(null); }
    }
  };

  return (
    <main className="landing storm-field">
      <h1 className="landing-title">Towers</h1>
      <form className="landing-form" onSubmit={(e) => { e.preventDefault(); void start(false); }}>
        <input
          ref={input}
          className="field"
          value={name}
          maxLength={24}
          autoFocus
          spellCheck={false}
          autoComplete="nickname"
          placeholder="Your name"
          aria-label="Your name"
          onChange={(e) => setNameState(e.target.value)}
        />
        <div className="landing-actions">
          <button type="submit" className="btn primary" disabled={!ready || busy !== null}>New game</button>
          <button type="button" className="btn" disabled={!ready || busy !== null} onClick={() => void start(true)}>Play the bot</button>
        </div>
        {problem && <p className="quiet" role="status">{problem}</p>}
      </form>
      <a className="stats-link" href="#/stats" onClick={() => ready && setName(name)}>Stats</a>
    </main>
  );
}
