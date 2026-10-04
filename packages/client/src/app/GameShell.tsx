import { useEffect, useState } from 'react';
import type { GameConnection } from '../net/types';
import { GameScreen } from '../game/GameScreen';
import { ChatDock } from './ChatDock';
import { GameMenu } from './GameMenu';
import { ShareOverlay } from './ShareOverlay';
import { useLatest, usePresence } from './useConnection';
import { copyText } from './clipboard';
import { gameLink } from './route';

interface Props {
  conn: GameConnection;
  online: boolean;
  onLeave: () => void;
  onRematch: () => void;
}

export function GameShell({ conn, online, onLeave, onRematch }: Props) {
  const presence = usePresence(conn);
  const latest = useLatest(conn);
  const [dismissed, setDismissed] = useState(false);
  const [toast, setToast] = useState('');
  const opponent = conn.seat === 'red' ? 'black' : 'red';
  const waiting = online && presence !== null && presence[opponent] === null;
  const link = online ? gameLink(conn.gameId) : '';

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const show = (text: string) => {
      setToast(text);
      clearTimeout(t);
      t = setTimeout(() => setToast(''), 3500);
    };
    const off = conn.subscribe({
      onError: (e) => {
        if (e.code === 'stale') return;
        show(e.message);
      },
      onRematchOffer: () => {
        const name = conn.getPresence()?.[opponent]?.name;
        show(`${name ?? 'Your opponent'} wants a rematch`);
      },
    });
    return () => { off(); clearTimeout(t); };
  }, [conn, opponent]);

  // No state exists until the second player joins (the match is created with both names).
  const lobby = online && !latest;

  return (
    <div className="game-shell">
      <GameScreen conn={conn} onRematch={onRematch} />
      {lobby ? (
        <div className="lobby" role="region" aria-label="Waiting for opponent">
          {waiting && <ShareOverlay link={link} />}
        </div>
      ) : (
        waiting && !dismissed && <ShareOverlay link={link} onDismiss={() => setDismissed(true)} />
      )}
      <GameMenu
        conn={conn}
        onLeave={onLeave}
        onCopyLink={online ? () => void copyText(link) : undefined}
        onShowInvite={waiting && dismissed && !lobby ? () => setDismissed(false) : undefined}
      />
      {online && <ChatDock conn={conn} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
