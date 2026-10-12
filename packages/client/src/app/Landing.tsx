import { useRef, useState, type KeyboardEvent } from 'react';
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

  /** Arrow keys move the difficulty choice, like any radio group. */
  const onLevelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = LEVELS.findIndex((l) => l.id === level);
    const next = LEVELS[(i + step + LEVELS.length) % LEVELS.length];
    setLevel(next.id);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-level="${next.id}"]`)?.focus();
  };

  return (
    <HeroLayout>
      <h1 className="landing-title">Towers</h1>
      <form
        className="landing-form"
        // Enter starts whatever is on offer: the bot game once its difficulty row is open.
        onSubmit={(e) => { e.preventDefault(); void start(choosing ? level : null); }}
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
          <button
            type={choosing ? 'button' : 'submit'}
            className={`btn ${choosing ? '' : 'primary'}`}
            disabled={!ready || busy !== null}
            onClick={choosing ? () => void start(null) : undefined}
          >
            New game
          </button>
          <button
            type="button"
            className={`btn ${choosing ? 'is-on' : ''}`}
            aria-expanded={choosing}
            disabled={!ready || busy !== null}
            onClick={() => setChoosing((c) => !c)}
          >
            Play the bot
          </button>
        </div>
        {choosing && (
          <div className="bot-start">
            <div className="bot-levels" role="radiogroup" aria-label="Bot difficulty" onKeyDown={onLevelKey}>
              {LEVELS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  role="radio"
                  aria-checked={l.id === level}
                  tabIndex={l.id === level ? 0 : -1}
                  className={`btn bot-level ${l.id === level ? 'is-on' : ''}`}
                  data-level={l.id}
                  disabled={busy !== null}
                  onClick={() => setLevel(l.id)}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <button type="submit" className="btn lit bot-go" disabled={!ready || busy !== null} autoFocus>
              Start
            </button>
          </div>
        )}
      {problem && <p className="quiet" role="status">{problem}</p>}
      </form>
      <nav className="landing-links">
        <a className="stats-link" href="#/rules">Rules</a>
        <a className="stats-link" href="#/stats" onClick={() => ready && setName(name)}>Stats</a>
      </nav>
    </HeroLayout>
  );
}
