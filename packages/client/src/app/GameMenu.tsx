import { useEffect, useRef, useState } from 'react';
import type { GameConnection } from '../net/types';
import { useLatest } from './useConnection';

interface Props {
  conn: GameConnection;
  onLeave: () => void;
  onCopyLink?: () => void;
  onShowInvite?: () => void;
}

export function GameMenu({ conn, onLeave, onCopyLink, onShowInvite }: Props) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const latest = useLatest(conn);
  const over = latest?.view.phase === 'matchOver';

  useEffect(() => {
    if (!open) { setConfirm(false); return; }
    const on = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', on);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', on); document.removeEventListener('keydown', key); };
  }, [open]);

  return (
    <div className="game-menu" ref={root}>
      <button type="button" className="menu-toggle" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span /><span /><span />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          {onCopyLink && (
            <button type="button" role="menuitem" onClick={() => { onCopyLink(); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
          )}
          {onShowInvite && (
            <button type="button" role="menuitem" onClick={() => { onShowInvite(); setOpen(false); }}>Show invite</button>
          )}
          {!over && !confirm && (
            <button type="button" role="menuitem" onClick={() => setConfirm(true)}>Concede round</button>
          )}
          {!over && confirm && (
            <div className="menu-confirm">
              <span>Concede this round?</span>
              <button type="button" className="danger" onClick={() => { conn.sendAction({ type: 'concede', player: conn.seat }); setOpen(false); }}>Concede</button>
              <button type="button" onClick={() => setConfirm(false)}>Cancel</button>
            </div>
          )}
          <button type="button" role="menuitem" onClick={() => { window.open('#/rules', '_blank', 'noopener'); setOpen(false); }}>Rules</button>
          <button type="button" role="menuitem" onClick={onLeave}>Leave</button>
        </div>
      )}
    </div>
  );
}
