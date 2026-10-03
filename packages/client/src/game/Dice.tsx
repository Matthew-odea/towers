import { useEffect, useState, type ReactNode } from 'react';

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function reduced(): boolean {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** One carved stone die. Remount (change `throwKey`) to throw it again. */
function DieInner({ value, from, live, picked, onClick, marker }: DieProps & { from: 0 | 1 }) {
  const [face, setFace] = useState(() => (reduced() ? value : 1 + Math.floor(Math.random() * 6)));
  const [rolling, setRolling] = useState(() => !reduced());
  useEffect(() => {
    if (reduced()) {
      setFace(value);
      setRolling(false);
      return;
    }
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      if (n >= 7) {
        window.clearInterval(id);
        setFace(value);
        setRolling(false);
      } else setFace(1 + Math.floor(Math.random() * 6));
    }, 80);
    return () => window.clearInterval(id);
  }, [value]);
  return (
    <div className={`die-slot`}>
      <button
        type="button"
        className={`die die--from${from} ${rolling ? 'is-rolling' : ''} ${live ? 'is-live' : ''} ${picked ? 'is-picked' : ''}`}
        disabled={!live}
        onClick={onClick}
        aria-label={`Die showing ${value}`}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <i key={i} className={PIPS[face].includes(i) ? 'pip' : 'pip pip--off'} />
        ))}
      </button>
      {marker && <div className="die-marker">{marker}</div>}
    </div>
  );
}

export interface DieProps {
  value: number;
  throwKey: number;
  live?: boolean;
  picked?: boolean;
  onClick?: () => void;
  marker?: ReactNode;
}

export function Die(props: DieProps & { index: 0 | 1 }) {
  return <DieInner key={props.throwKey} {...props} from={props.index} />;
}

export function BlankDie() {
  return (
    <div className="die-slot">
      <div className="die die--blank" aria-hidden />
    </div>
  );
}
