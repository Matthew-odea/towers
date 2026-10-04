import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { ALL_HEXES, TOWER, other, type HexKey, type PlayerId, type PlayerView } from '@towers/engine';
import { CardView, type CardMark } from './Card';
import type { ClashView } from './display';
import { HEX, ISLAND_H, ISLAND_W, STAGE_H, STAGE_W, hexCenter, hexCenterTL, hexCorners, polyPoints, type Pt } from './geometry';
import { TerrainLayer } from './Terrain';
import { sortCards } from './cardInfo';

export type HexMark =
  | 'move'
  | 'withdraw'
  | 'attack'
  | 'target'
  | 'deploy'
  | 'spawn'
  | 'fortify'
  | 'reinforce'
  | 'retreat'
  | 'setup'
  | 'drop'
  | 'hint'
  | 'source'
  | 'selected'
  | 'own';

const GLOW_MARKS = new Set<HexMark>(['move', 'withdraw', 'deploy', 'spawn', 'fortify', 'reinforce', 'retreat', 'setup', 'drop']);

export interface BoardProps {
  view: PlayerView;
  seat: PlayerId;
  hexMarks: Partial<Record<HexKey, HexMark>>;
  hexBadges?: Partial<Record<HexKey, ReactNode>>;
  cardMarks: Record<string, CardMark[]>;
  expanded: HexKey | null;
  clash: ClashView | null;
  pulse: HexKey | null;
  flare: string[];
  dying: string[];
  activeSide: PlayerId | null;
  onHexClick: (h: HexKey, e: MouseEvent) => void;
  onCardClick: (id: string, h: HexKey, e: MouseEvent) => void;
  onHexHover: (h: HexKey | null) => void;
  onCardHover: (id: string | null) => void;
  onBackground: () => void;
  /** Dice (and their decisions) for the current engagement, placed on the contested edge. */
  dice?: ReactNode;
}

// Board units; on screen they scale with the board (about 58px wide at 1440x900).
const MINI_W = 54;
const FAN_W = 62;

interface Placed {
  id: string;
  hex: HexKey;
  x: number;
  y: number;
  rot: number;
  z: number;
  w: number;
}

function layoutStack(ids: string[], hex: HexKey, seat: PlayerId, expanded: boolean): Placed[] {
  const c = hexCenterTL(hex, seat);
  const n = ids.length;
  const mid = (n - 1) / 2;
  if (expanded) {
    const step = n > 1 ? Math.min(36, 160 / (n - 1)) : 0;
    const tilt = n > 1 ? Math.min(5, 24 / n) : 0;
    return ids.map((id, i) => ({
      id,
      hex,
      x: c.x + (i - mid) * step,
      y: c.y - 24 + Math.abs(i - mid) ** 2 * 0.9,
      rot: (i - mid) * tilt,
      z: 900 + i,
      w: FAN_W,
    }));
  }
  const step = n > 1 ? Math.min(16, 66 / (n - 1)) : 0;
  const tilt = n > 1 ? Math.min(6, 26 / n) : 0;
  return ids.map((id, i) => ({
    id,
    hex,
    x: c.x + (i - mid) * step,
    y: c.y + 12 + Math.abs(i - mid) ** 2 * 0.6,
    rot: (i - mid) * tilt,
    z: Math.round(c.y) * 10 + i,
    w: MINI_W,
  }));
}

function nudge(p: Pt, toward: Pt, f: number): Pt {
  return { x: p.x + (toward.x - p.x) * f, y: p.y + (toward.y - p.y) * f };
}

function Rampart({ c, owner }: { c: Pt; owner: PlayerId }) {
  return (
    <g className={`rampart rampart--${owner}`}>
      <polygon points={polyPoints(hexCorners(c, HEX - 9))} className="rampart-base" />
      <polygon points={polyPoints(hexCorners(c, HEX - 9))} className="rampart-merlons" />
      <polygon points={polyPoints(hexCorners(c, HEX - 14))} className="rampart-inner" />
    </g>
  );
}

function Brackets({ c, size, className }: { c: Pt; size: number; className: string }) {
  const pts = hexCorners(c, size);
  const d = pts
    .map((p, i) => {
      const a = pts[(i + 5) % 6];
      const b = pts[(i + 1) % 6];
      const f = 0.17;
      return `M${p.x + (a.x - p.x) * f} ${p.y + (a.y - p.y) * f}L${p.x} ${p.y}L${p.x + (b.x - p.x) * f} ${p.y + (b.y - p.y) * f}`;
    })
    .join('');
  return <path d={d} className={className} />;
}

function TowerMarks({ c, count, holder }: { c: Pt; count: number; holder: PlayerId }) {
  return (
    <g className={`tower-marks tower-marks--${holder}`} transform={`translate(${c.x} ${c.y - HEX * 0.72})`}>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={-17 + i * 12} y={-6} width={9} height={12} rx={1.5} className={i < count ? 'on' : 'off'} />
      ))}
    </g>
  );
}

export function Board(props: BoardProps) {
  const { view, seat, hexMarks, cardMarks, expanded, clash } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setScale(Math.max(0.3, Math.min(r.width / ISLAND_W, r.height / ISLAND_H)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- cards ----
  const placed: Placed[] = [];
  const badges: { hex: HexKey; n: number; at: Pt }[] = [];
  for (const h of ALL_HEXES) {
    const ids = view.stacks[h];
    if (!ids?.length) continue;
    const sorted = sortCards(view, ids);
    const isExp = expanded === h;
    placed.push(...layoutStack(sorted, h, seat, isExp));
    if (!isExp && ids.length > 4) {
      const c = hexCenterTL(h, seat);
      badges.push({ hex: h, n: ids.length, at: { x: c.x + 46, y: c.y - 18 } });
    }
  }
  if (clash) {
    const tgt = hexCenterTL(clash.target, seat);
    const atkHexes = new Set<HexKey>();
    for (const p of placed) {
      if (clash.attackerCards.includes(p.id) && !clash.rangedArchers.includes(p.id)) {
        const n = nudge(p, tgt, 0.2);
        p.x = n.x;
        p.y = n.y;
        atkHexes.add(p.hex);
      }
    }
    if (atkHexes.size) {
      const avg = [...atkHexes].map((h) => hexCenterTL(h, seat)).reduce((a, b) => ({ x: a.x + b.x / atkHexes.size, y: a.y + b.y / atkHexes.size }), { x: 0, y: 0 });
      for (const p of placed) {
        if (clash.defenderCards.includes(p.id)) {
          const n = nudge(p, avg, 0.1);
          p.x = n.x;
          p.y = n.y;
        }
      }
    }
  }

  // Where the dice land: the midpoint of the contested edge (between the attacking hexes and
  // the target), in stage units from the stage centre.
  let diceAt: Pt | null = null;
  if (clash && props.dice) {
    const tgt = hexCenter(clash.target, seat);
    const from = [
      ...new Set(
        clash.attackerCards
          .filter((id) => !clash.rangedArchers.includes(id) || clash.attackerCards.every((x) => clash.rangedArchers.includes(x)))
          .map((id) => Object.keys(view.stacks).find((h) => view.stacks[h].includes(id)))
          .filter((h): h is HexKey => !!h && h !== clash.target),
      ),
    ].map((h) => hexCenter(h, seat));
    const src = from.length ? from.reduce((a, b) => ({ x: a.x + b.x / from.length, y: a.y + b.y / from.length }), { x: 0, y: 0 }) : tgt;
    diceAt = nudge(src, tgt, 0.5);
  }

  const flare = new Set(props.flare);
  const dying = new Set(props.dying);
  const active = props.activeSide;

  return (
    <div className="board-wrap" ref={wrap} onClick={props.onBackground}>
      <div
        className={`board-stage ${active ? `board-stage--active-${active === seat ? 'near' : 'far'} board-stage--side-${active}` : ''}`}
        style={{ width: STAGE_W, height: STAGE_H, transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        <div className="board-edge-glow" />
        <TerrainLayer terrain={view.terrain} seat={seat} />

        <svg className="board-marks" viewBox={`${-STAGE_W / 2} ${-STAGE_H / 2} ${STAGE_W} ${STAGE_H}`}>
          <defs>
            <filter id="bf-storm" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3.5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {Object.entries(view.fortified).map(([h, owner]) => (
            <Rampart key={`f${h}`} c={hexCenter(h, seat)} owner={owner} />
          ))}
          {(['red', 'black'] as const).map((p) => {
            const enemyTower = TOWER[other(p)];
            const holds = view.stacks[enemyTower]?.length && view.cards[view.stacks[enemyTower][0]].owner === p;
            return holds ? <TowerMarks key={p} c={hexCenter(enemyTower, seat)} count={view.towerCount[p]} holder={p} /> : null;
          })}
          {clash &&
            [...new Set(clash.attackerCards.map((id) => Object.keys(view.stacks).find((h) => view.stacks[h].includes(id))).filter(Boolean) as string[])].map(
              (h) => {
                const a = hexCenter(h, seat);
                const b = hexCenter(clash.target, seat);
                const m = nudge(a, b, 0.5);
                return (
                  <g key={`l${h}`} className={`clash-line clash-line--${clash.attacker}`}>
                    <path d={`M${nudge(a, b, 0.32).x} ${nudge(a, b, 0.32).y}L${nudge(a, b, 0.62).x} ${nudge(a, b, 0.62).y}`} />
                    <circle cx={m.x} cy={m.y} r={2.5} />
                  </g>
                );
              },
            )}
          {clash && <Brackets c={hexCenter(clash.target, seat)} size={HEX - 4} className="mark-clash" />}
          {Object.entries(hexMarks).map(([h, m]) => {
            const c = hexCenter(h, seat);
            if (!m) return null;
            if (m === 'attack' || m === 'target')
              return (
                <g key={`m${h}`} className={`mark mark--${m}`}>
                  <polygon points={polyPoints(hexCorners(c, HEX - 4))} className="mark-fill" />
                  <Brackets c={c} size={HEX - 5} className="mark-brackets" />
                </g>
              );
            if (m === 'selected' || m === 'source' || m === 'own')
              return <polygon key={`m${h}`} points={polyPoints(hexCorners(c, HEX - 5))} className={`mark mark--${m}`} />;
            return (
              <g key={`m${h}`} className={`mark mark--glow mark--${m}`}>
                <polygon points={polyPoints(hexCorners(c, HEX - 4))} className="mark-fill" />
                <polygon points={polyPoints(hexCorners(c, HEX - 5))} className="mark-line" filter="url(#bf-storm)" />
              </g>
            );
          })}
          {props.pulse && <polygon key={`p${props.pulse}`} points={polyPoints(hexCorners(hexCenter(props.pulse, seat), HEX - 3))} className="mark-pulse" />}
          {/* hit areas */}
          {ALL_HEXES.map((h) => (
            <polygon
              key={`h${h}`}
              points={polyPoints(hexCorners(hexCenter(h, seat), HEX))}
              className={`hit ${hexMarks[h] && hexMarks[h] !== 'source' && hexMarks[h] !== 'hint' ? 'hit--live' : ''} ${view.stacks[h] ? 'hit--stack' : ''}`}
              data-hex={h}
              data-mark={hexMarks[h] ?? undefined}
              onClick={(e) => {
                e.stopPropagation();
                props.onHexClick(h, e);
              }}
              onMouseEnter={() => props.onHexHover(h)}
              onMouseLeave={() => props.onHexHover(null)}
            />
          ))}
        </svg>

        <div className="board-cards">
          {placed.map((p) => {
            const card = view.cards[p.id];
            const marks: CardMark[] = [...(cardMarks[p.id] ?? [])];
            if (flare.has(p.id)) marks.push('flare');
            if (dying.has(p.id)) marks.push('dying');
            return (
              <div
                key={p.id}
                className={`board-card ${expanded === p.hex ? 'board-card--fan' : ''}`}
                data-on-hex={p.hex}
                style={{
                  transform: `translate(${p.x - p.w / 2}px, ${p.y - (p.w * 1.4) / 2}px) rotate(${p.rot}deg)`,
                  zIndex: p.z,
                }}
              >
                <CardView
                  card={card}
                  width={p.w}
                  mini
                  marks={marks}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onCardClick(p.id, p.hex, e);
                  }}
                  onEnter={() => props.onCardHover(p.id)}
                  onLeave={() => props.onCardHover(null)}
                />
              </div>
            );
          })}
          {badges.map((b) => (
            <div key={`n${b.hex}`} className="stack-count numeral" style={{ transform: `translate(${b.at.x}px, ${b.at.y}px)` }}>
              {b.n}
            </div>
          ))}
          {Object.entries(props.hexBadges ?? {}).map(([h, node]) => {
            const c = hexCenterTL(h, seat);
            return (
              <div key={`b${h}`} className="hex-badge" style={{ transform: `translate(${c.x}px, ${c.y - HEX * 0.62}px)` }}>
                {node}
              </div>
            );
          })}
        </div>
      </div>
      {diceAt && (
        <div
          className="board-dice"
          style={{ left: `calc(50% + ${diceAt.x * scale}px)`, top: `calc(50% + ${diceAt.y * scale}px)` }}
          onClick={(e) => e.stopPropagation()}
        >
          {props.dice}
        </div>
      )}
    </div>
  );
}
