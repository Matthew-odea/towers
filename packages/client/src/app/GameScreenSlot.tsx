import type { ComponentType } from 'react';
import type { GameConnection } from '../net/types';
import { useLatest } from './useConnection';

type GameScreenProps = { conn: GameConnection; onRematch?: () => void };

// The game screen lives in src/game (another owner). The glob keeps the shell compiling and
// running before that file exists; once it does, the real component is used automatically.
const found = import.meta.glob('../game/GameScreen.tsx', { eager: true }) as Record<string, { GameScreen?: ComponentType<GameScreenProps> }>;
const Real = Object.values(found)[0]?.GameScreen;

function Placeholder({ conn, onRematch }: GameScreenProps) {
  const latest = useLatest(conn);
  return (
    <div className="placeholder-screen">
      <p>{latest ? `${latest.view.phase} / round ${latest.view.round} / v${latest.version}` : 'Waiting for state'}</p>
      {latest?.view.phase === 'matchOver' && onRematch && <button className="btn primary" onClick={onRematch}>Rematch</button>}
    </div>
  );
}

export const GameScreenSlot: ComponentType<GameScreenProps> = Real ?? Placeholder;
