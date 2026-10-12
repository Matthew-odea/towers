import { useRef, useState } from 'react';
import { WebSocketTransport } from '../net/WebSocketTransport';
import { getBotLevel, getName, setBotLevel, setName, type StoredBotLevel } from '../net/storage';
import { gamePath, navigate } from './route';
import { stashConnection } from './connections';
import { HeroLayout } from './HeroLayout';

const LEVELS: { id: StoredBotLevel; label: string }[] = [
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
];

export function Landing() {
  const [name, setNameState] = useState(getName);
  const [busy, setBusy] = useState<'new' | StoredBotLevel | null>(null);
  const [problem, setProblem] = useState('');
  /** "Play the bot" was clicked: the button gives way to the three difficulties. */
  const [choosing, setChoosing] = useState(false);
  const [level, setLevel] = useState(getBotLevel);
  const input = useRef<HTMLInputElement>(null);
  const ready = name.trim().length > 0;

  const start = async (bot: StoredBotLevel | null) => {
    if (!ready) { input.current?.focus(); return; }
    setName(name);
    if (bot) { setBotLevel(bot); setLevel(bot); }
    setBusy(bot ?? 'new');
    setProblem('');
    try {
      const conn = await WebSocketTransport.create(name.trim(), bot ?? false);
      stashConnection(conn);
      navigate(gamePath(conn.gameId));
    } catch {
      // The offline bot reads the stored level.
      if (bot) navigate('#/offline');
      else { setProblem('The server is unreachable.'); setBusy(null); }
    }
  };

  return (
    <HeroLayout>
      <h1 className="landing-title">Towers</h1>
      <form
        className="landing-form"
        onSubmit={(e) => { e.preventDefault(); void start(null); }}
        onKeyDown={(e) => { if (e.key === 'Escape') setChoosing(false); }}
      >
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
          {choosing ? (
            <div className="bot-levels" role="group" aria-label="Bot difficulty">
              {LEVELS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={`btn bot-level ${l.id === level ? 'lit is-last' : ''}`}
                  data-level={l.id}
                  disabled={!ready || busy !== null}
                  autoFocus={l.id === level}
                  onClick={() => void start(l.id)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          ) : (
            <button type="button" className="btn" disabled={!ready || busy !== null} onClick={() => setChoosing(true)}>
              Play the bot
            </button>
          )}
        </div>
        {problem && <p className="quiet" role="status">{problem}</p>}
      </form>
      <nav className="landing-links">
        <a className="stats-link" href="#/rules">Rules</a>
        <a className="stats-link" href="#/stats" onClick={() => ready && setName(name)}>Stats</a>
      </nav>
    </HeroLayout>
  );
}
