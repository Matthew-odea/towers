// Drawn terrain: a floating hex island with plains, forest, mountains and two Towers.
import { memo, type ReactNode } from 'react';
import { TOWER, type HexKey, type PlayerId, type Terrain as TerrainT } from '@towers/engine';
import { CLIFF, HEX, STAGE_H, STAGE_W, hexCenter, hexCorners, hexPath, hexRand, paintOrder, polyPoints, type Pt } from './geometry';


function scatter(rand: () => number, n: number, radius: number, avoid?: (p: Pt) => boolean): Pt[] {
  const out: Pt[] = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 30) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * radius;
    const p = { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.92 };
    if (avoid && avoid(p)) continue;
    if (out.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < radius * 0.18)) continue;
    out.push(p);
  }
  return out;
}

function Plains({ h }: { h: HexKey }) {
  const rand = hexRand(h, 1);
  const buds = scatter(rand, 6 + Math.floor(rand() * 3), HEX * 0.74);
  const tufts = scatter(rand, 12, HEX * 0.78);
  const stones = scatter(rand, 4, HEX * 0.7);
  return (
    <g>
      {tufts.map((p, i) => (
        <path
          key={`t${i}`}
          d={`M${p.x} ${p.y}l-3 -6M${p.x} ${p.y}l0.5 -7.5M${p.x} ${p.y}l3.5 -5.5`}
          className="tr-tuft"
        />
      ))}
      {stones.map((p, i) => (
        <ellipse key={`s${i}`} cx={p.x} cy={p.y} rx={2.6 + rand() * 2} ry={1.8 + rand()} className="tr-pebble" />
      ))}
      {buds.map((p, i) => {
        const s = 0.8 + rand() * 0.6;
        const flip = rand() < 0.5 ? -1 : 1;
        return (
          <g key={`b${i}`} transform={`translate(${p.x} ${p.y}) scale(${s * flip} ${s})`}>
            <ellipse cx="1.5" cy="2.6" rx="7.5" ry="2.4" className="tr-shadow" />
            <path d="M-6.5 2 C-6.5 -5 6.5 -5 6.5 2 Z" className="tr-bud" />
            <path d="M-4.5 -0.5 C-3.5 -3.6 1.5 -4.4 4 -1.6" className="tr-bud-hi" />
            <path d="M-1 -3.4 C-3 -8 -6 -8.5 -8 -7 M1.4 -3.6 C2 -8.6 5 -10 7.4 -8.6 M0 -3.8 C-0.5 -7 0.6 -9.8 2 -11" className="tr-vine" />
          </g>
        );
      })}
    </g>
  );
}

function Forest({ h }: { h: HexKey }) {
  const rand = hexRand(h, 2);
  const trees = scatter(rand, 8, HEX * 0.66).sort((a, b) => a.y - b.y);
  return (
    <g>
      {trees.map((p, i) => {
        const s = 0.85 + rand() * 0.5;
        const lean = (rand() - 0.5) * 10;
        return (
          <g key={i} transform={`translate(${p.x} ${p.y}) scale(${s})`}>
            <ellipse cx="4" cy="9" rx="13" ry="4.5" className="tr-shadow" />
            <path d={`M0 9 C0.5 3 ${lean * 0.3} -2 ${lean * 0.4} -6`} className="tr-trunk" />
            <circle cx={-6 + lean * 0.2} cy="-2" r="8.5" className="tr-leaf-a" />
            <circle cx={6 + lean * 0.3} cy="-1" r="8" className="tr-leaf-a" />
            <circle cx={lean * 0.4} cy="-9" r="10" className="tr-leaf-b" />
            <circle cx={-3 + lean * 0.4} cy="-12" r="4.5" className="tr-leaf-c" />
          </g>
        );
      })}
    </g>
  );
}

function Peak({ x, y, w, hgt, snow }: { x: number; y: number; w: number; hgt: number; snow: number }) {
  const top = { x: x + w * 0.06, y: y - hgt };
  const l = { x: x - w / 2, y };
  const r = { x: x + w / 2, y };
  const mid = { x: x + w * 0.12, y };
  const sl = { x: top.x - (top.x - l.x) * snow, y: top.y + hgt * snow };
  const sr = { x: top.x + (r.x - top.x) * snow, y: top.y + hgt * snow };
  return (
    <g>
      <polygon points={polyPoints([l, top, mid])} className="tr-rock-lit" />
      <polygon points={polyPoints([mid, top, r])} className="tr-rock-dark" />
      <polygon
        points={polyPoints([sl, top, sr, { x: sr.x - w * 0.08, y: sr.y + 3 }, { x: top.x + 2, y: sl.y - 2 }, { x: sl.x + w * 0.06, y: sl.y + 4 }])}
        className="tr-snow"
      />
      <path d={`M${top.x} ${top.y} L${mid.x} ${mid.y}`} className="tr-ridge" />
    </g>
  );
}

function Mountain({ h }: { h: HexKey }) {
  const rand = hexRand(h, 3);
  const flip = rand() < 0.5;
  const scree = scatter(rand, 7, HEX * 0.7, (p) => p.y < 4);
  return (
    <g transform={flip ? 'scale(-1 1)' : undefined}>
      <ellipse cx="2" cy="22" rx="58" ry="11" className="tr-shadow" />
      <Peak x={-30} y={18} w={50} hgt={44} snow={0.28} />
      <Peak x={26} y={22} w={46} hgt={36} snow={0.25} />
      <Peak x={-2} y={24} w={74} hgt={70} snow={0.3} />
      {scree.map((p, i) => (
        <ellipse key={i} cx={p.x} cy={p.y + 8} rx={2.5} ry={1.6} className="tr-pebble" />
      ))}
    </g>
  );
}

function TowerArt({ owner }: { owner: PlayerId }) {
  return (
    <g>
      <ellipse cx="0" cy="20" rx="44" ry="13" className="tr-plinth-shadow" />
      <path d="M-40 14 L-22 4 L22 4 L40 14 L22 26 L-22 26 Z" className="tr-plinth" />
      <path d="M-40 14 L-22 4 L22 4 L40 14" className="tr-plinth-edge" />
      <ellipse cx="6" cy="17" rx="22" ry="6" className="tr-shadow" />
      {/* body */}
      <path d="M-15 16 L-11 -50 L11 -50 L15 16 Z" className="tr-tower-dark" />
      <path d="M-15 16 L-11 -50 L-1 -50 L-1 16 Z" className="tr-tower-lit" />
      <path d="M-14 -2 L14 -2 M-13 -20 L13 -20 M-12 -36 L12 -36" className="tr-course" />
      {/* battlement */}
      <path
        d="M-15 -50 L15 -50 L15 -58 L10 -58 L10 -54 L5 -54 L5 -58 L0 -58 L0 -54 L-5 -54 L-5 -58 L-10 -58 L-10 -54 L-15 -54 Z"
        className="tr-tower-lit"
      />
      <path d="M0 -50 L15 -50 L15 -58 L10 -58 L10 -54 L5 -54 L5 -58 L0 -58 Z" className="tr-tower-dark" />
      <rect x="-2" y="-34" width="4" height="10" rx="2" className="tr-slit" />
      <path d="M-5 16 L-5 6 A5 5 0 0 1 5 6 L5 16 Z" className="tr-slit" />
      {/* banner */}
      <path d="M0 -58 L0 -80" className="tr-pole" />
      <path d="M0 -80 L17 -76 L12 -72.5 L17 -69 L0 -70 Z" className={`tr-banner tr-banner--${owner}`} />
    </g>
  );
}

function decoration(t: TerrainT, h: HexKey): ReactNode {
  switch (t) {
    case 'plains':
      return <Plains h={h} />;
    case 'forest':
      return <Forest h={h} />;
    case 'mountain':
      return <Mountain h={h} />;
    case 'tower':
      return <TowerArt owner={h === TOWER.red ? 'red' : 'black'} />;
  }
}

/** `terrain: null` draws the bare island (stone faces, the two Towers): the lobby preview. */
function TerrainImpl({ terrain, seat }: { terrain: Record<HexKey, TerrainT> | null; seat: PlayerId }) {
  const order = paintOrder(seat);
  return (
    <svg className="board-terrain" viewBox={`${-STAGE_W / 2} ${-STAGE_H / 2} ${STAGE_W} ${STAGE_H}`} aria-hidden>
      <defs>
        <radialGradient id="tg-plains" cx="0.42" cy="0.36" r="0.75">
          <stop offset="0" stopColor="var(--plains-b)" />
          <stop offset="1" stopColor="var(--plains-a)" />
        </radialGradient>
        <radialGradient id="tg-forest" cx="0.42" cy="0.36" r="0.75">
          <stop offset="0" stopColor="#2a3a2b" />
          <stop offset="1" stopColor="var(--forest-a)" />
        </radialGradient>
        <radialGradient id="tg-mountain" cx="0.42" cy="0.36" r="0.75">
          <stop offset="0" stopColor="#555864" />
          <stop offset="1" stopColor="var(--mountain-a)" />
        </radialGradient>
        <radialGradient id="tg-blank" cx="0.42" cy="0.36" r="0.75">
          <stop offset="0" stopColor="#3d4148" />
          <stop offset="1" stopColor="#24272d" />
        </radialGradient>
        <radialGradient id="tg-tower" cx="0.45" cy="0.4" r="0.75">
          <stop offset="0" stopColor="var(--tower-b)" />
          <stop offset="1" stopColor="var(--tower-a)" />
        </radialGradient>
        <linearGradient id="tg-cliff" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b2f36" />
          <stop offset="0.45" stopColor="#171a1f" />
          <stop offset="1" stopColor="#0a0c0f" />
        </linearGradient>
        <radialGradient id="tg-shadow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000" stopOpacity="0.75" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <filter id="tf-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.55 -0.1" />
        </filter>
        <filter id="tf-mottle" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="3" seed="3" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.9  0 0 0 0 0.92  0 0 0 0 0.85  0 0 0 0.5 -0.18" />
        </filter>
        <clipPath id="tc-island">
          {order.map((h) => (
            <path key={h} d={hexPath(hexCenter(h, seat), HEX - 1)} />
          ))}
        </clipPath>
      </defs>

      <ellipse cx="0" cy={HEX * 0.6} rx={HEX * 5.2} ry={HEX * 4.4} fill="url(#tg-shadow)" />

      {/* cliffs */}
      <g>
        {order.map((h) => {
          const c = hexCenter(h, seat);
          return (
            <g key={h}>
              <path d={hexPath({ x: c.x, y: c.y + CLIFF }, HEX)} fill="url(#tg-cliff)" />
              <path d={hexPath({ x: c.x, y: c.y + CLIFF * 0.45 }, HEX)} className="tr-stratum" />
            </g>
          );
        })}
      </g>

      {/* faces */}
      {order.map((h) => {
        const c = hexCenter(h, seat);
        const t = terrain ? terrain[h] : h === TOWER.red || h === TOWER.black ? 'tower' : 'blank';
        return <path key={h} d={hexPath(c, HEX)} fill={`url(#tg-${t})`} className="tr-face" />;
      })}

      {/* texture */}
      <g clipPath="url(#tc-island)">
        <rect x={-STAGE_W / 2} y={-STAGE_H / 2} width={STAGE_W} height={STAGE_H} filter="url(#tf-mottle)" opacity="0.28" />
        <rect x={-STAGE_W / 2} y={-STAGE_H / 2} width={STAGE_W} height={STAGE_H} filter="url(#tf-grain)" opacity="0.22" />
      </g>

      {/* decoration */}
      {order.map((h) => {
        const c = hexCenter(h, seat);
        return (
          <g key={h} transform={`translate(${c.x} ${c.y})`} clipPath={undefined}>
            {terrain ? decoration(terrain[h], h) : h === TOWER.red || h === TOWER.black ? decoration('tower', h) : null}
          </g>
        );
      })}

      {/* bevels and grout */}
      {order.map((h) => {
        const c = hexCenter(h, seat);
        return (
          <g key={h}>
            <polygon points={polyPoints(hexCorners(c, HEX - 3))} className="tr-bevel" />
            <polygon points={polyPoints(hexCorners(c, HEX))} className="tr-grout" />
          </g>
        );
      })}
    </svg>
  );
}

export const TerrainLayer = memo(TerrainImpl);

const FACE: Record<TerrainT, [string, string]> = {
  plains: ['var(--plains-b)', 'var(--plains-a)'],
  forest: ['#2a3a2b', 'var(--forest-a)'],
  mountain: ['#555864', 'var(--mountain-a)'],
  tower: ['var(--tower-b)', 'var(--tower-a)'],
};

/** One hex of drawn terrain on its own, `size` px square (the rulebook's legend). */
export function TerrainHex({ t, size, seed = '0,0' }: { t: TerrainT; size: number; seed?: HexKey }) {
  const id = `th-${t}`;
  const box = HEX + 8;
  const c = { x: 0, y: 0 };
  return (
    <svg className="terrain-hex" width={size} height={size} viewBox={`${-box} ${-box - 6} ${box * 2} ${box * 2}`} aria-hidden>
      <defs>
        <radialGradient id={id} cx="0.42" cy="0.36" r="0.75">
          <stop offset="0" stopColor={FACE[t][0]} />
          <stop offset="1" stopColor={FACE[t][1]} />
        </radialGradient>
      </defs>
      <path d={hexPath({ x: 0, y: CLIFF * 0.5 }, HEX)} fill="#0f1216" />
      <path d={hexPath(c, HEX)} fill={`url(#${id})`} />
      {decoration(t, t === 'tower' ? TOWER.red : seed)}
      <polygon points={polyPoints(hexCorners(c, HEX - 3))} className="tr-bevel" />
      <polygon points={polyPoints(hexCorners(c, HEX))} className="tr-grout" />
    </svg>
  );
}
