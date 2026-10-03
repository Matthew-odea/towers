import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Card, PlayerId, PlayerView } from '@towers/engine';
import { CardView, type CardMark } from './Card';
import { FACTION, activationText, longName, sortCards } from './cardInfo';
import type { Banner } from './display';
import type { LogEntry } from './log';

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
  onHover: (id: string | null) => void;
  drop?: boolean;
  onDrop?: () => void;
  children?: ReactNode;
}

export function ReserveFan({ view, ids, marksFor, onCardClick, onHover, drop, onDrop }: FanProps) {
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
  const n = sorted.length;
  const step = n > 1 ? Math.min(w + 8, (box.w - w - 16) / (n - 1)) : 0;
  const total = (n - 1) * step + w;
  const x0 = (box.w - total) / 2;
  return (
    <div
      className={`reserve-fan ${drop ? 'reserve-fan--drop' : ''}`}
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
        const marks = marksFor(id);
        return (
          <div
            key={id}
            className={`fan-card ${marks.includes('selected') ? 'fan-card--up' : ''}`}
            style={{ transform: `translateX(${x0 + i * step}px)`, zIndex: i }}
          >
            <CardView
              card={view.cards[id]}
              width={w}
              marks={marks}
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
    </div>
  );
}

// ---- Opponent reserve: thin row of backs -------------------------------------------------

export function BackRow({ view, ids, onHover }: { view: PlayerView; ids: string[]; onHover: (on: boolean) => void }) {
  const step = Math.min(13, 360 / Math.max(1, ids.length));
  return (
    <div
      className="back-row"
      style={{ width: (ids.length - 1) * step + 30 }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      aria-label={`${ids.length} cards in Reserve`}
    >
      {ids.map((id, i) => (
        <div key={id} className="back-row-card" style={{ transform: `translateX(${i * step}px)` }}>
          <CardView card={view.cards[id]} width={30} faceDown />
        </div>
      ))}
    </div>
  );
}

// ---- Destroyed pile ------------------------------------------------------------------------

export function Pile({ view, ids, onHover, side }: { view: PlayerView; ids: string[]; onHover: (on: boolean) => void; side: PlayerId }) {
  if (!ids.length) return <div className="pile pile--empty" />;
  const top = ids.slice(-3);
  return (
    <div className={`pile pile--${side}`} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} aria-label={`${ids.length} destroyed`}>
      {top.map((id, i) => (
        <div key={id} className="pile-card" style={{ transform: `translate(${i * 3}px, ${-i * 2}px) rotate(${(i - 1) * 5}deg)` }}>
          <CardView card={view.cards[id]} width={38} marks="ash" />
        </div>
      ))}
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
  }, [open, entries.length]);
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

export function BannerView({ banner, seat, onSkip, onRematch }: { banner: Banner; seat: PlayerId; onSkip: () => void; onRematch?: () => void }) {
  const opp: PlayerId = seat === 'red' ? 'black' : 'red';
  const line =
    banner.kind === 'match' ? `${FACTION[banner.winner]} win` : `${FACTION[banner.winner]} take the round`;
  return (
    <div className={`banner banner--${banner.kind} banner--${banner.winner}`} onClick={banner.kind === 'round' ? onSkip : undefined}>
      <div className="banner-inner">
        <h2 className="banner-line">{line}</h2>
        <div className="banner-pips">
          <RoundPips wins={banner.roundWins[opp]} side={opp} />
          <span className="banner-sep" />
          <RoundPips wins={banner.roundWins[seat]} side={seat} />
        </div>
        {banner.kind === 'match' && onRematch && (
          <button type="button" className="btn lit banner-rematch" onClick={onRematch}>
            Rematch
          </button>
        )}
      </div>
    </div>
  );
}


