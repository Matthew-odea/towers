import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { HexKey } from '@towers/engine';

export interface CardDrag {
  id: string;
  /** The hex under the pointer, if any. */
  over: HexKey | null;
}

export interface DragHandlers {
  canDrag: (id: string) => boolean;
  /** The press became a drag: pick the card so its targets light up. */
  onStart: (id: string) => void;
  /** Released over `hex` (null: anywhere else, or the drag was cancelled). */
  onDrop: (id: string, hex: HexKey | null) => void;
}

/** Pixels the pointer must travel before a press on a hand card becomes a drag (less stays a click). */
const THRESHOLD = 6;

/** The hex at a screen point: a hex's hit area (`data-hex`) or a card standing on it (`data-on-hex`). */
function hexAt(x: number, y: number): HexKey | null {
  const el = document.elementFromPoint(x, y)?.closest('[data-hex], [data-on-hex]');
  return el?.getAttribute('data-hex') ?? el?.getAttribute('data-on-hex') ?? null;
}

/**
 * Dragging a hand card onto a hex, as an alternative to pick-then-click. Pointer-driven so the
 * card itself follows the cursor; handlers are read at event time, so they always see the latest
 * game state. The screen re-renders only when the hex under the card changes: the floating card
 * (`ghostRef`, placed at `ghostAt`) is moved directly.
 */
export function useCardDrag(handlers: DragHandlers) {
  const latest = useRef(handlers);
  latest.current = handlers;
  const [drag, setDrag] = useState<CardDrag | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const at = useRef({ x: 0, y: 0 });
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const onPointerDown = (id: string, e: ReactPointerEvent) => {
    if (e.button !== 0 || !latest.current.canDrag(id)) return;
    stop.current?.();
    const sx = e.clientX;
    const sy = e.clientY;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return;
        started = true;
        latest.current.onStart(id);
      }
      at.current = { x: ev.clientX, y: ev.clientY };
      if (ghostRef.current) ghostRef.current.style.transform = ghostTransform(at.current);
      const over = hexAt(ev.clientX, ev.clientY);
      setDrag((d) => (d?.id === id && d.over === over ? d : { id, over }));
    };
    const finish = (hex: HexKey | null) => {
      end();
      if (!started) return;
      // The release also produces a click somewhere; it belongs to the drag, not to the page.
      const swallow = (c: MouseEvent) => c.stopPropagation();
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      setDrag(null);
      latest.current.onDrop(id, hex);
    };
    const up = (ev: PointerEvent) => finish(hexAt(ev.clientX, ev.clientY));
    const cancel = () => finish(null);
    const key = (ev: KeyboardEvent) => ev.key === 'Escape' && cancel();
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
      stop.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    stop.current = end;
  };

  return { drag, onPointerDown, ghostRef, ghostStyle: { transform: ghostTransform(at.current) } };
}

function ghostTransform(p: { x: number; y: number }): string {
  return `translate(${p.x}px, ${p.y}px)`;
}
