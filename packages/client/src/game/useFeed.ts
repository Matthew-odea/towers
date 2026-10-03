// Consumes StateUpdates from the connection and plays their events as paced display frames.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerId } from '@towers/engine';
import type { GameConnection, StateUpdate } from '../net/types';
import { eventActor, finalize, framesFor, initialDisplay, type Display } from './display';
import { logLines, type LogEntry } from './log';

const MIN_OPPONENT_STEP = 600;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export interface Feed {
  display: Display | null;
  /** Latest authoritative update (what decisions are computed from). */
  latest: StateUpdate | null;
  /** True while animations are still catching up with `latest`. */
  busy: boolean;
  log: LogEntry[];
  /** Skip a skippable hold (round banner). */
  skip: () => void;
}

export function useFeed(conn: GameConnection, seat: PlayerId): Feed {
  const first = conn.getLatest();
  const [display, setDisplay] = useState<Display | null>(() => (first ? initialDisplay(first.view) : null));
  const [latest, setLatest] = useState<StateUpdate | null>(first);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const cur = useRef<Display | null>(display);
  const version = useRef<number>(first?.version ?? -1);
  const queue = useRef<StateUpdate[]>([]);
  const running = useRef(false);
  const gen = useRef(0);
  const skipRef = useRef<(() => void) | null>(null);
  const logId = useRef(0);

  const wait = useCallback((ms: number, skippable = false) => {
    return new Promise<void>((resolve) => {
      const t = window.setTimeout(done, ms);
      function done() {
        window.clearTimeout(t);
        if (skipRef.current === done) skipRef.current = null;
        resolve();
      }
      if (skippable) skipRef.current = done;
    });
  }, []);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const my = gen.current;
    const alive = () => gen.current === my;
    setBusy(true);
    const slow = reducedMotion() ? 0.45 : 1;
    while (queue.current.length && alive()) {
      const u = queue.current.shift()!;
      if (u.version <= version.current) continue;
      version.current = u.version;
      // Catch up quickly if several updates piled up (e.g. after a reconnect).
      const backlog = queue.current.length > 6;
      let d = cur.current ?? initialDisplay(u.view);
      const entries: LogEntry[] = [];
      for (const e of u.events) for (const l of logLines(e, d.view)) entries.push({ ...l, id: ++logId.current });
      if (entries.length) setLog((xs) => [...xs, ...entries].slice(-400));
      const t0 = performance.now();
      const fromOpponent = u.events.some((e) => {
        const a = eventActor(e);
        return a !== null && a !== seat;
      });
      if (!backlog && cur.current) {
        for (const e of u.events) {
          for (const f of framesFor(d, e)) {
            d = f.d;
            cur.current = d;
            setDisplay(d);
            await wait(Math.max(f.skippable ? f.ms : f.ms * slow, 0), f.skippable);
            if (!alive()) return;
          }
        }
        const spent = performance.now() - t0;
        if (fromOpponent && spent < MIN_OPPONENT_STEP * slow) await wait(MIN_OPPONENT_STEP * slow - spent);
      }
      if (!alive()) return;
      d = finalize(d, u.view);
      cur.current = d;
      setDisplay(d);
      setLatest(u);
    }
    running.current = false;
    setBusy(false);
  }, [seat, wait]);

  useEffect(() => {
    gen.current += 1;
    const unsub = conn.subscribe({
      onState(u) {
        queue.current.push(u);
        void pump();
      },
    });
    // The connection may have advanced between render and subscribe.
    const l = conn.getLatest();
    if (l && l.version > version.current) {
      queue.current.push({ ...l, events: [] });
      void pump();
    }
    return () => {
      gen.current += 1;
      running.current = false;
      unsub();
    };
  }, [conn, pump]);

  const skip = useCallback(() => skipRef.current?.(), []);

  return { display, latest, busy, log, skip };
}
