import { useEffect, useState, type ReactNode } from 'react';
import type { GameConnection } from '../net/types';
import { GameScreenSlot } from './GameScreenSlot';
import { ChatDock } from './ChatDock';
import { GameMenu } from './GameMenu';
import { ShareOverlay } from './ShareOverlay';
import { usePresence } from './useConnection';
import { copyText } from './clipboard';
import { gameLink } from './route';

interface Props {
  conn: GameConnection;
  myName: string;
  online: boolean;
  onLeave: () => void;
  onRematch: () => void;
  children?: ReactNode;
}

export function GameShell({ conn, myName, online, onLeave, onRematch }: Props) {
  const presence = usePresence(conn);
  const [dismissed, setDismissed] = useState(false);
  const [toast, setToast] = useState('');
  const opponent = conn.seat === 'red' ? 'black' : 'red';
  const waiting = online && presence !== null && presence[opponent] === null;
  const link = online ? gameLink(conn.gameId) : '';

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = conn.subscribe({
      onError: (e) => {
        if (e.code === 'stale') return;
        setToast(e.message);
        clearTimeout(t);
        t = setTimeout(() => setToast(''), 3500);
      },
    });
    return () => { off(); clearTimeout(t); };
  }, [conn]);

  return (
    <div className="game-shell">
      <GameScreenSlot conn={conn} onRematch={onRematch} />
      {waiting && !dismissed && <ShareOverlay link={link} onDismiss={() => setDismissed(true)} />}
      <GameMenu
        conn={conn}
        onLeave={onLeave}
        onCopyLink={online ? () => void copyText(link) : undefined}
        onShowInvite={waiting && dismissed ? () => setDismissed(false) : undefined}
      />
      {online && <ChatDock conn={conn} myName={myName} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
