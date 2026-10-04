import { useEffect, useState } from 'react';
import { fetchStats, type StatsData } from '../net/stats';
import { getName, setName } from '../net/storage';
import { ART, titleCase } from '../game/cardInfo';

export function Stats() {
  const [name, setNameState] = useState(getName);
  const [draft, setDraft] = useState('');
  const [data, setData] = useState<StatsData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!name) return;
    let live = true;
    setData(null);
    setFailed(false);
    fetchStats(name).then((d) => live && setData(d), () => live && setFailed(true));
    return () => { live = false; };
  }, [name]);

  return (
    <main className="stats storm-field">
      <a className="back-link" href="#/" aria-label="Back">
        <span aria-hidden>&larr;</span>
      </a>
      {!name ? (
        <form className="landing-form" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { setName(draft); setNameState(draft.trim()); } }}>
          <input className="field" autoFocus placeholder="Your name" aria-label="Your name" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </form>
      ) : failed ? (
        <p className="quiet">The server is unreachable.</p>
      ) : !data ? null : (
        <div className="stats-body">
          <h1 className="stats-name">{name}</h1>
          <p className="record" aria-label={`${data.won} won, ${Math.max(0, data.played - data.won)} lost`}>
            <span className="record-num">{data.won}</span>
            <span className="record-sep">&ndash;</span>
            <span className="record-num dim">{Math.max(0, data.played - data.won)}</span>
          </p>
          {data.opponents.length > 0 && (
            <table className="opp-table">
              <tbody>
                {data.opponents.map((o) => (
                  <tr key={o.name}>
                    <th scope="row">{o.name}</th>
                    <td>{o.won}&ndash;{Math.max(0, o.played - o.won)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data.characters.length > 0 && (
            <ul className="portraits" aria-label="Most committed">
              {data.characters.slice(0, 5).map((c) => (
                <li key={c.id} title={titleCase(c.id)}>
                  <img src={ART.portrait(c.id)} alt={titleCase(c.id)} width={64} height={64} />
                  <span className="numeral">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}
