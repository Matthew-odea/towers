import { useEffect, useState } from 'react';
import { fetchStats, type StatsData } from '../net/stats';
import { getName, setName } from '../net/storage';
import { useEscapeTo } from './route';
import { ART, titleCase } from '../game/cardInfo';

export function Stats() {
  const [name, setNameState] = useState(getName);
  const [draft, setDraft] = useState('');
  const [data, setData] = useState<StatsData | null>(null);
  const [failed, setFailed] = useState(false);
  useEscapeTo('#/');

  useEffect(() => {
    if (!name) return;
    let live = true;
    setData(null);
    setFailed(false);
    fetchStats(name).then((d) => live && setData(d), () => live && setFailed(true));
    return () => { live = false; };
  }, [name]);

  const none = !!data && data.played === 0;
  return (
    <main className="stats storm-field">
      <a className="back-link" href="#/" aria-label="Back" title="Back (Esc)">
        <span aria-hidden>&larr;</span>
      </a>
      {!name ? (
        <div className="stats-body">
          <h1 className="stats-title">Stats</h1>
          <form
            className="stats-ask"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) {
                setName(draft);
                setNameState(draft.trim());
              }
            }}
          >
            <input className="field" autoFocus placeholder="Your name" aria-label="Your name" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button type="submit" className="btn" disabled={!draft.trim()}>
              Show
            </button>
          </form>
        </div>
      ) : (
        <div className="stats-body">
          <h1 className="stats-name">{name}</h1>
          {failed ? (
            <p className="quiet">The server is unreachable.</p>
          ) : (
            <>
              <div className={`record ${!data || none ? 'record--empty' : ''}`}>
                <span className="record-cell">
                  <span className="record-num">{data ? data.won : '–'}</span>
                  <span className="record-cap caps">Won</span>
                </span>
                <span className="record-sep">&ndash;</span>
                <span className="record-cell">
                  <span className="record-num dim">{data ? Math.max(0, data.played - data.won) : '–'}</span>
                  <span className="record-cap caps">Lost</span>
                </span>
              </div>
              {none && (
                <>
                  <p className="quiet">No finished games yet.</p>
                  <a className="btn" href="#/">
                    Play a game
                  </a>
                </>
              )}
              {data && !none && (
                <p className="rounds">
                  Rounds <span className="numeral">{data.roundsWon}</span>&ndash;<span className="numeral">{data.roundsLost}</span>
                </p>
              )}
              {data && data.opponents.length > 0 && (
                <table className="opp-table">
                  <tbody>
                    {data.opponents.map((o) => (
                      <tr key={o.name}>
                        <th scope="row">{o.name}</th>
                        <td>
                          {o.won}&ndash;{Math.max(0, o.played - o.won)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {data && data.characters.length > 0 && (
                <ul className="portraits" aria-label="Most committed">
                  {data.characters.slice(0, 5).map((c) => (
                    <li key={c.id} title={titleCase(c.id)}>
                      <img src={ART.portrait(c.id)} alt={titleCase(c.id)} width={64} height={64} />
                      <span className="numeral">{c.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </main>
  );
}
