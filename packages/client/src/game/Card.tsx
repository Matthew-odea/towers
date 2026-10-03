import { memo, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import type { Card as CardT, CardKind } from '@towers/engine';
import { ART, isInfantry, plateName, reliability } from './cardInfo';

export type CardMark = 'selectable' | 'selected' | 'flare' | 'lit' | 'dying' | 'dim' | 'ash' | 'locked' | 'focus';

export interface CardProps {
  card: CardT;
  /** Rendered width in px; height follows 5:7. */
  width: number;
  faceDown?: boolean;
  marks?: CardMark[] | CardMark | null;
  badge?: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: (e: MouseEvent) => void;
  onEnter?: () => void;
  onLeave?: () => void;
  title?: string;
}

export function Glyph({ kind, className }: { kind: CardKind; className?: string }) {
  return <span className={`glyph ${className ?? ''}`} style={{ ['--glyph' as string]: `url(${ART.glyph(kind)})` }} aria-hidden />;
}

function Portrait({ card }: { card: CardT }) {
  const [failed, setFailed] = useState(false);
  if (!card.character || failed) {
    return (
      <div className="card-art card-art--fallback">
        <Glyph kind={card.kind} />
      </div>
    );
  }
  return (
    <div className="card-art">
      <img src={ART.portrait(card.character)} alt="" draggable={false} loading="lazy" onError={() => setFailed(true)} />
    </div>
  );
}

function Spheres({ n }: { n: number }) {
  return (
    <div className="card-spheres" data-n={n} aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  );
}

function CardImpl({ card, width, faceDown, marks, badge, className, style, onClick, onEnter, onLeave, title }: CardProps) {
  const ms = marks == null ? [] : Array.isArray(marks) ? marks : [marks];
  const mini = width < 56;
  const cls = [
    'card',
    `card--${card.owner}`,
    `kind-${card.kind}`,
    mini ? 'card--mini' : 'card--full',
    faceDown ? 'card--back' : '',
    onClick ? 'card--click' : '',
    ...ms.map((m) => `is-${m}`),
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const st: CSSProperties = { ...style, ['--w' as string]: `${width}px` };
  if (faceDown) {
    return (
      <div className={cls} style={st} onClick={onClick} onMouseEnter={onEnter} onMouseLeave={onLeave} title={title}>
        <div className="card-face" />
      </div>
    );
  }
  const inf = isInfantry(card);
  return (
    <div
      className={cls}
      style={st}
      onClick={onClick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      title={title}
      data-card={card.id}
    >
      <div className="card-face">
        {inf ? (
          <>
            <div className="card-art card-art--infantry" style={{ ['--art' as string]: `url(${ART.infantry(card.kind as 'light' | 'heavy')})` }} />
            <div className={`card-rank numeral ${card.rank >= 10 ? 'card-rank--wide' : ''}`}>{card.rank}</div>
            {!mini && <Spheres n={reliability(card)} />}
          </>
        ) : (
          <>
            <Portrait card={card} />
            {!mini && (
              <div className="card-plate">
                <span>{plateName(card)}</span>
              </div>
            )}
          </>
        )}
        <div className="card-sigil">
          <Glyph kind={card.kind} />
        </div>
        {badge != null && <div className="card-badge numeral">{badge}</div>}
      </div>
    </div>
  );
}

export const CardView = memo(CardImpl);
