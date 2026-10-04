// Dev entry: /dev.html?seat=red|black&scenario=setup|setupTroop|setupOpp|play|engage|defend|reroll|casualties|retreat|press|tower&seed=…&delay=650
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PlayerId } from '@towers/engine';
import '../../styles/global.css';
import { GameScreen } from '../GameScreen';
import { createDevConnection } from './devConnection';

const params = new URLSearchParams(location.search);

function make() {
  return createDevConnection({
    seat: (params.get('seat') as PlayerId) || 'red',
    scenario: params.get('scenario') ?? 'setup',
    seed: params.get('seed') ?? undefined,
    botDelay: params.has('delay') ? Number(params.get('delay')) : undefined,
    level: (params.get('level') as 'easy' | 'medium' | 'hard' | null) ?? undefined,
  });
}

function DevApp() {
  const [{ conn, n }, setConn] = useState(() => ({ conn: make(), n: 0 }));
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <GameScreen
        key={n}
        conn={conn}
        onRematch={() => {
          conn.close();
          setConn({ conn: make(), n: n + 1 });
        }}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<DevApp />);
