import { useEffect, useState } from 'react';
import type { ChatMessage, GameConnection, Presence, StateUpdate } from '../net/types';

export function useLatest(conn: GameConnection): StateUpdate | null {
  const [v, setV] = useState(() => conn.getLatest());
  useEffect(() => {
    setV(conn.getLatest());
    return conn.subscribe({ onState: (u) => setV(u) });
  }, [conn]);
  return v;
}

export function usePresence(conn: GameConnection): Presence | null {
  const [v, setV] = useState(() => conn.getPresence());
  useEffect(() => {
    setV(conn.getPresence());
    return conn.subscribe({ onPresence: (p) => setV(p) });
  }, [conn]);
  return v;
}

export function useChat(conn: GameConnection, open: boolean) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => conn.getChat());
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    setMessages(conn.getChat());
    return conn.subscribe({
      onChat: (m) => {
        setMessages((prev) => [...prev, m]);
        if (m.from !== conn.seat) setUnread(true);
      },
    });
  }, [conn]);
  useEffect(() => { if (open) setUnread(false); }, [open, messages.length]);
  return { messages, unread: unread && !open };
}
