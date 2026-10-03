import { useEffect, useState } from 'react';
import { fetchStats, type StatsData } from '../net/stats';
import { getName, setName } from '../net/storage';

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
    <main className="stats">
      <a className="back-link" href="#/" aria-label="Back">&larr;</a>
      {!name ? (
        <form className="landing-form" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { setName(draft); setNameState(draft.trim()); } }}>
          <input className="field" autoFocus placeholder="Your name" aria-label="Your name" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </form>
      ) : failed ? (
        <p className="quiet">The server is unreachable.</p>
      ) : !data ? null : (
        <>
          <h1 className="stats-name">{name}</h1>
          <p className="record">
            <span className="record-num">{data.won}</span>
            <span className="record-sep">&ndash;</span>
            <span className="record-num dim">{Math.max(0, data.played - data.won)}</span>
          </p>
          {data.played === 0 ? null : (
            <p className="quiet">Rounds {data.roundsWon}&ndash;{data.roundsLost}</p>
          )}
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
            <ul className="portraits">
              {data.characters.slice(0, 8).map((c) => (
                <li key={c.id} title={`${c.id} ${c.count}`}>
                  <img src={`/art/characters/${c.id}.webp`} alt={c.id} width={64} height={64} />
                  <span>{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
