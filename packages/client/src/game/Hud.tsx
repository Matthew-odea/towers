import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import type { Card, PlayerId, PlayerView } from '@towers/engine';
import { CardView, type CardMark } from './Card';
import { FACTION, activationText, longName, sortCards } from './cardInfo';
import type { Banner } from './display';
import type { LogEntry } from './log';
import { fanLayout } from './layout';

// ---- CP spheres --------------------------------------------------------------------------

export function Spheres({ lit, side, mine, cost = 0, small }: { lit: number; side: PlayerId; mine: boolean; cost?: number; small?: boolean }) {
  return (
    <div className={`spheres spheres--${side} ${mine ? 'spheres--mine' : ''} ${small ? 'spheres--small' : ''}`} aria-label={`${lit} CP`}>
      {[0, 1, 2, 3].map((i) => {
        const on = i < lit;
        const willSpend = on && i >= lit - cost;
        return <i key={i} className={`sphere ${on ? 'is-on' : ''} ${willSpend ? 'is-cost' : ''}`} />;
      })}
    </div>
  );
}

export function RoundPips({ wins, side }: { wins: number; side: PlayerId }) {
  return (
    <span className={`round-pips round-pips--${side}`} aria-label={`${wins} rounds won`}>
      {[0, 1].map((i) => (
        <i key={i} className={i < wins ? 'on' : ''} />
      ))}
    </span>
  );
}

// ---- Reserve fan (mine) ------------------------------------------------------------------

export interface FanProps {
  view: PlayerView;
  ids: string[];
  marksFor: (id: string) => CardMark[];
  onCardClick?: (id: string) => void;
  /** A press on a card, which may become a drag onto the board. */
  onCardPointerDown?: (id: string, e: PointerEvent) => void;
  /** The card being dragged out of the hand: its slot stays, faded. */
  dragging?: string | null;
  onHover: (id: string | null) => void;
  /** Not my move: the hand sits back, visibly inactive. */
  idle?: boolean;
  drop?: boolean;
  onDrop?: () => void;
  /** Shown after the last card (my destroyed pile), `trailingW` px wide. */
  trailing?: ReactNode;
  trailingW?: number;
}

export function ReserveFan({ view, ids, marksFor, onCardClick, onCardPointerDown, dragging, onHover, idle, drop, onDrop, trailing, trailingW = 0 }: FanProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 800, h: 140 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const sorted = sortCards(view, ids);
  const w = Math.max(56, Math.min(88, (box.h - 26) / 1.4));
  const tw = trailing ? trailingW + 16 : 0;
  const marks = sorted.map((id) => marksFor(id));
  const lay = fanLayout(
    sorted.map((id) => view.cards[id].kind),
    box.w,
    w,
    tw,
    marks.map((m) => m.includes('selectable') || m.includes('selected')),
  );
  const x0 = Math.max(0, (box.w - lay.total - tw) / 2);
  return (
    <div
      className={`reserve-fan ${drop ? 'reserve-fan--drop' : ''} ${idle ? 'reserve-fan--idle' : ''}`}
      ref={ref}
      onClick={(e) => {
        if (drop && onDrop) {
          e.stopPropagation();
          onDrop();
        }
      }}
    >
      {drop && <div className="reserve-drop" />}
      {sorted.map((id, i) => {
        const m = marks[i];
        return (
          <div
            key={id}
            className={`fan-card ${m.includes('selected') ? 'fan-card--up' : m.includes('selectable') ? 'fan-card--able' : ''} ${dragging === id ? 'fan-card--lifted' : ''}`}
            style={{ transform: `translateX(${x0 + lay.x[i]}px)`, zIndex: i }}
            onPointerDown={onCardPointerDown && !drop ? (e) => onCardPointerDown(id, e) : undefined}
          >
            <CardView
              card={view.cards[id]}
              width={w}
              marks={m}
              onClick={
                onCardClick && !drop
                  ? (e) => {
                      e.stopPropagation();
                      onCardClick(id);
                    }
                  : undefined
              }
              onEnter={() => onHover(id)}
              onLeave={() => onHover(null)}
            />
          </div>
        );
      })}
      {trailing && (
        <div className="fan-trailing" style={{ transform: `translateX(${x0 + lay.total + 16}px)` }}>
          {trailing}
        </div>
      )}
    </div>
  );
}

// ---- Opponent reserve: thin row of backs -------------------------------------------------

/** Back slivers 6px apart, ending in one whole card back. Hover to see the count by type. */
export function BackRow({ view, ids, onHover }: { view: PlayerView; ids: string[]; onHover: (on: boolean) => void }) {
  if (!ids.length) return null;
  const step = 6;
  const last = ids[ids.length - 1];
  return (
    <div
      className="back-row"
      style={{ width: (ids.length - 1) * step + 30 }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      aria-label={`${ids.length} cards in Reserve`}
    >
      {ids.slice(0, -1).map((id, i) => (
        <i key={id} className="back-sliver" style={{ left: i * step }} />
      ))}
      <div className="back-row-card" style={{ left: (ids.length - 1) * step }}>
        <CardView card={view.cards[last]} width={30} faceDown />
      </div>
    </div>
  );
}

// ---- Destroyed pile ------------------------------------------------------------------------

export const PILE_W = 52;

export function Pile({ view, ids, onHover, side, width = 36 }: { view: PlayerView; ids: string[]; onHover: (on: boolean) => void; side: PlayerId; width?: number }) {
  if (!ids.length) return null;
  const top = ids[ids.length - 1];
  return (
    <div
      className={`pile pile--${side} ${ids.length > 1 ? 'pile--stack' : ''}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      aria-label={`${ids.length} destroyed`}
    >
      <CardView card={view.cards[top]} width={width} mini marks="ash" />
      <span className="pile-count numeral">{ids.length}</span>
    </div>
  );
}

// ---- Inspector -----------------------------------------------------------------------------

export type Inspect = { kind: 'card'; id: string } | { kind: 'cards'; ids: string[]; label?: string } | null;

export function Inspector({ view, target }: { view: PlayerView; target: Inspect }) {
  if (!target) return null;
  if (target.kind === 'card') {
    const c: Card | undefined = view.cards[target.id];
    if (!c) return null;
    return (
      <div className="inspector inspector--one">
        <CardView card={c} width={210} />
        <div className="inspector-caption">
          <span className="inspector-name">{longName(c)}</span>
          <span className="inspector-rule">{activationText(c)}</span>
        </div>
      </div>
    );
  }
  if (!target.ids.length) return null;
  const ids = sortCards(view, target.ids);
  const w = ids.length > 12 ? 52 : ids.length > 6 ? 66 : 92;
  return (
    <div className="inspector inspector--many">
      {target.label && <span className="inspector-label caps">{target.label}</span>}
      <div className="inspector-grid" style={{ gridTemplateColumns: `repeat(${Math.min(ids.length, ids.length > 12 ? 5 : ids.length > 6 ? 4 : 3)}, ${w}px)` }}>
        {ids.map((id) => (
          <CardView key={id} card={view.cards[id]} width={w} />
        ))}
      </div>
    </div>
  );
}

// ---- Log drawer ----------------------------------------------------------------------------

export function LogDrawer({ open, entries, onToggle }: { open: boolean; entries: LogEntry[]; onToggle: () => void }) {
  const list = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    if (open) list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [open, entries]);
  return (
    <>
      <button type="button" className={`log-toggle ${open ? 'is-open' : ''}`} onClick={onToggle} aria-expanded={open}>
        Log
      </button>
      <aside className={`log-drawer ${open ? 'is-open' : ''}`} aria-hidden={!open}>
        <ol ref={list}>
          {entries.map((e) => (
            <li key={e.id} className={`log-line ${e.side ? `log-line--${e.side}` : ''} ${e.rule ? `log-rule log-rule--${e.rule}` : ''}`}>
              {e.text}
            </li>
          ))}
        </ol>
      </aside>
    </>
  );
}

// ---- Round / match banner ----------------------------------------------------------------

export function BannerView({
  banner,
  seat,
  holdMs,
  onSkip,
  onRematch,
}: {
  banner: Banner;
  seat: PlayerId;
  /** How long a round banner stays before play continues on its own. */
  holdMs: number;
  onSkip: () => void;
  onRematch?: () => void;
}) {
  const opp: PlayerId = seat === 'red' ? 'black' : 'red';
  const line =
    banner.kind === 'match' ? `${FACTION[banner.winner]} win` : `${FACTION[banner.winner]} take the round`;
  return (
    <div className={`banner banner--${banner.kind} banner--${banner.winner}`} onClick={banner.kind === 'round' ? onSkip : undefined}>
      <div className="banner-inner">
        <h2 className="banner-line">{line}</h2>
        <div className="banner-pips">
          <span className={`banner-side banner-side--${opp} caps`}>{FACTION[opp]}</span>
          <RoundPips wins={banner.roundWins[opp]} side={opp} />
          <span className="banner-sep" />
          <RoundPips wins={banner.roundWins[seat]} side={seat} />
          <span className={`banner-side banner-side--${seat} caps`}>{FACTION[seat]}</span>
        </div>
        {banner.kind === 'round' && (
          <button
            type="button"
            className="banner-continue"
            style={{ ['--hold' as string]: `${holdMs}ms` }}
            onClick={(e) => {
              e.stopPropagation();
              onSkip();
            }}
          >
            Continue
          </button>
        )}
        {banner.kind === 'match' && onRematch && (
          <button type="button" className="btn lit banner-rematch" onClick={onRematch}>
            Rematch
          </button>
        )}
      </div>
    </div>
  );
}
