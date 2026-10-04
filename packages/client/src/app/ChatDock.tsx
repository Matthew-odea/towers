import { useEffect, useRef, useState } from 'react';
import type { GameConnection } from '../net/types';
import { useChat } from './useConnection';

export function ChatDock({ conn }: { conn: GameConnection }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const { messages, unread } = useChat(conn, open);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { list.current?.scrollTo({ top: list.current.scrollHeight }); input.current?.focus(); } }, [open, messages.length]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    conn.sendChat(t);
    setText('');
  };

  return (
    <div className="chat-dock">
      {open && (
        <div className="chat-panel">
          <div className="chat-list" ref={list}>
            {messages.map((m, i) => (
              <p key={i} className={`chat-line chat-line--${m.from} ${m.from === conn.seat ? 'mine' : ''}`}>
                <span className="chat-from">{m.name}</span> {m.text}
              </p>
            ))}
          </div>
          <input
            ref={input}
            className="field chat-input"
            value={text}
            maxLength={300}
            aria-label="Message"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') send();
              if (e.key === 'Escape') setOpen(false);
            }}
          />
        </div>
      )}
      <button type="button" className="chat-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Chat{unread && <span className="unread-dot" aria-label="Unread messages" />}
      </button>
    </div>
  );
}
