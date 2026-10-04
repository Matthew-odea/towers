import type { ReactNode } from 'react';
import {
  MODIFIER_LABELS,
  waysToRoll,
  type EngagementModifiers,
  type HexKey,
  type PlayerId,
  type PlayerView,
  type RerollOption,
  type SideModifiers,
} from '@towers/engine';
import { CardView, Glyph, type CardMark } from './Card';
import { BlankDie, Die } from './Dice';
import { ART, FACTION, sortCards } from './cardInfo';
import type { ClashView } from './display';
import { rowLayout } from './layout';

export type ClashPrompt =
  | {
      kind: 'commit';
      target: HexKey;
      eligible: string[];
      ranged: string[];
      picks: string[];
      wit: number;
      canConfirm: boolean;
      mods: EngagementModifiers;
      odds: string[] | null;
      onToggle: (id: string) => void;
      onWit: (n: number) => void;
      onConfirm: () => void;
      onCancel: () => void;
    }
  | {
      kind: 'defend';
      eligible: string[];
      max: number;
      picks: string[];
      wit: number;
      canConfirm: boolean;
      mods: EngagementModifiers;
      odds: string[] | null;
      onToggle: (id: string) => void;
      onWit: (n: number) => void;
      onConfirm: () => void;
    }
  | {
      kind: 'reroll';
      options: RerollOption[];
      source: number;
      onSource: (i: number) => void;
      onDie: (die: 0 | 1) => void;
      onPass: () => void;
    }
  | { kind: 'press'; onPress: () => void; onBreak: () => void }
  | {
      kind: 'casualties';
      owner: PlayerId;
      count: number;
      eligible: string[];
      picks: string[];
      onToggle: (id: string) => void;
      onConfirm: () => void;
    }
  | { kind: 'retreat'; onStay: () => void }
  | null;

export interface ClashProps {
  view: PlayerView;
  seat: PlayerId;
  clash: ClashView | null;
  prompt: ClashPrompt;
  flare: string[];
  dying: string[];
  /** Opponent is the one deciding right now. */
  waiting: boolean;
  onHoverCard: (id: string | null) => void;
}

function MarkIcon({ kind }: { kind: 'adv' | 'dis' }) {
  return (
    <svg viewBox="0 0 16 16" className={`side-mark-icon side-mark-icon--${kind}`} aria-hidden>
      {kind === 'adv' ? <path d="M2 11 L8 4 L14 11 L11 11 L8 7.5 L5 11 Z" /> : <path d="M2 5 L8 12 L14 5 L11 5 L8 8.5 L5 5 Z" />}
    </svg>
  );
}

function SideMarks({ mods }: { mods: SideModifiers | null }) {
  if (!mods) return null;
  const items: [string, 'adv' | 'dis', string[]][] = [];
  if (mods.advantage.length) items.push(['Advantage', 'adv', mods.advantage]);
  if (mods.disadvantage.length) items.push(['Disadvantage', 'dis', mods.disadvantage]);
  return (
    <div className="side-marks">
      {items.map(([name, kind, sources]) => (
        <span key={kind} className={`side-mark side-mark--${kind}`} tabIndex={0}>
          <MarkIcon kind={kind} />
          <span className="side-mark-tip">
            <b>{name}</b>
            {sources.map((s) => (
              <span key={s}>{MODIFIER_LABELS[s] ?? s}</span>
            ))}
          </span>
        </span>
      ))}
    </div>
  );
}

export function WitDial({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="wit-dial" role="radiogroup" aria-label="Wit number">
      <Glyph kind="wit" />
      {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={n === value}
          className={`wit-dial-n ${n === value ? 'is-on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onChange(n);
          }}
        >
          <span className="numeral">{n}</span>
          <i style={{ height: waysToRoll(n) * 2.5 }} />
        </button>
      ))}
    </div>
  );
}

function OddsTip({ lines }: { lines: string[] | null }) {
  if (!lines?.length) return null;
  return (
    <span className="odds-tip">
      {lines.map((l) => (
        <span key={l}>{l}</span>
      ))}
    </span>
  );
}

interface RowProps {
  view: PlayerView;
  side: PlayerId;
  ids: string[];
  marksFor: (id: string) => CardMark[];
  badgeFor?: (id: string) => ReactNode;
  onClick?: (id: string) => void;
  onHoverCard: (id: string | null) => void;
  mods: SideModifiers | null;
  count?: number | null;
  role: 'attacker' | 'defender' | null;
  far: boolean;
  extra?: ReactNode;
}

function Row({ view, side, ids, marksFor, badgeFor, onClick, onHoverCard, mods, count, role, far, extra }: RowProps) {
  const { w, step } = rowLayout(ids.length, !!onClick);
  const sorted = sortCards(view, ids);
  return (
    <div className={`clash-row clash-row--${far ? 'far' : 'near'} clash-row--${side}`}>
      <div className="clash-side" title={count != null && count > 0 ? `${count} activation${count === 1 ? '' : 's'}` : undefined}>
        <span className="clash-side-name caps">{FACTION[side]}</span>
        {role && <span className="clash-role caps">{role === 'attacker' ? 'Attack' : 'Defend'}</span>}
        <SideMarks mods={mods} />
        {extra}
      </div>
      <div
        className={`clash-cards ${step !== null ? 'clash-cards--overlap' : ''}`}
        style={step !== null ? { width: (sorted.length - 1) * step + w, height: w * 1.4 } : undefined}
      >
        {sorted.map((id, i) => (
          <CardView
            key={id}
            card={view.cards[id]}
            width={w}
            marks={marksFor(id)}
            badge={badgeFor?.(id)}
            style={step !== null ? { position: 'absolute', left: i * step, zIndex: i } : undefined}
            onClick={
              onClick
                ? (e) => {
                    e.stopPropagation();
                    onClick(id);
                  }
                : undefined
            }
            onEnter={() => onHoverCard(id)}
            onLeave={() => onHoverCard(null)}
          />
        ))}
      </div>
    </div>
  );
}

// ---- Dice on the board ----------------------------------------------------------------------

export interface ClashDiceProps {
  view: PlayerView;
  seat: PlayerId;
  clash: ClashView;
  prompt: ClashPrompt;
  /** Opponent is the one deciding right now. */
  waiting: boolean;
}

function SourceMark({ view, player, source, commanderId }: { view: PlayerView; player: PlayerId; source: 'commander' | 'disadvantage'; commanderId: string | null }) {
  const ch = source === 'commander' && commanderId ? view.cards[commanderId]?.character : undefined;
  return ch ? (
    <img className={`reroll-src reroll-src--${player}`} src={ART.portrait(ch)} alt="" />
  ) : (
    <span className={`reroll-src reroll-src--dis reroll-src--${player}`}>
      <MarkIcon kind="dis" />
    </span>
  );
}

/**
 * The two stone dice, thrown onto the contested edge of the board, with the result and the
 * decisions that belong to them (reroll a die by clicking it, Pass, Press / Break off) underneath.
 */
export function ClashDice({ view, seat, clash, prompt, waiting }: ClashDiceProps) {
  const rr = prompt?.kind === 'reroll' ? prompt : null;
  const picked = rr ? rr.options[rr.source] : null;
  const pickedMark = picked ? (
    <SourceMark view={view} player={seat} source={picked.source} commanderId={picked.source === 'commander' ? picked.commanderId : null} />
  ) : null;
  const done = (i: 0 | 1) =>
    clash.rerolls
      .filter((r) => r.die === i)
      .map((r, k) => <SourceMark key={k} view={view} player={r.player} source={r.source} commanderId={r.commanderId} />);
  const dieMarker = (i: 0 | 1) => {
    const marks = done(i);
    return marks.length ? <>{marks}</> : null;
  };

  const result = clash.result;
  let outcome: string | null = null;
  if (result) {
    if (result.outcome === 'stale') outcome = 'Stale';
    else if (result.outcome === 'bloodbath') outcome = 'Bloodbath';
    else outcome = `${FACTION[result.winner!]} win`;
  }
  if (clash.ended === 'brokeOff') outcome = 'Broken off';
  const total = clash.dice && result ? clash.dice[0] + clash.dice[1] : null;
  const staleNote = result?.outcome === 'stale' && clash.staleCount > 0 && !clash.ended ? clash.staleCount : null;

  return (
    <div className={`clash-dice ${clash.ended ? 'clash-dice--ended' : ''}`} onClick={(e) => e.stopPropagation()}>
      <div className="dice-tray">
        {clash.dice ? (
          <>
            <Die index={0} value={clash.dice[0]} throwKey={clash.dieKeys[0]} live={!!rr} onClick={() => rr?.onDie(0)} marker={dieMarker(0)} badge={pickedMark} />
            <Die index={1} value={clash.dice[1]} throwKey={clash.dieKeys[1]} live={!!rr} onClick={() => rr?.onDie(1)} marker={dieMarker(1)} badge={pickedMark} />
          </>
        ) : (
          <>
            <BlankDie />
            <BlankDie />
          </>
        )}
      </div>
      <div className="clash-verdict">
        {total !== null && <span className="clash-total numeral">{total}</span>}
        {outcome && <span className="clash-outcome display">{outcome}</span>}
        {staleNote !== null && (
          <span className="stale-note" title="Three stale rolls give the defender Advantage">
            {staleNote} of 3
          </span>
        )}
        {waiting && !rr && prompt?.kind !== 'press' && <span className="clash-wait" aria-label="Waiting for opponent" />}
      </div>
      {rr && (
        <div className="reroll-bar">
          {rr.options.length > 1 && (
            <div className="reroll-sources">
              {rr.options.map((o, i) => (
                <button
                  key={i}
                  type="button"
                  className={`reroll-chip ${rr.source === i ? 'is-on' : ''}`}
                  onClick={() => rr.onSource(i)}
                  title={o.source === 'commander' ? 'Commander reroll' : 'Force a reroll (Disadvantage)'}
                >
                  {o.source === 'commander' && view.cards[o.commanderId]?.character ? (
                    <img src={ART.portrait(view.cards[o.commanderId].character!)} alt="" />
                  ) : (
                    <MarkIcon kind="dis" />
                  )}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="btn ghost" onClick={rr.onPass}>
            Pass
          </button>
        </div>
      )}
      {prompt?.kind === 'press' && (
        <div className="press-bar">
          <button type="button" className="btn lit" onClick={prompt.onPress}>
            Press
          </button>
          <button type="button" className="btn" onClick={prompt.onBreak}>
            Break off
          </button>
        </div>
      )}
    </div>
  );
}

export function Clash({ view, seat, clash, prompt, flare, dying, waiting, onHoverCard }: ClashProps) {
  const opp: PlayerId = seat === 'red' ? 'black' : 'red';
  if (!clash && prompt?.kind !== 'commit') return null;

  const flareS = new Set(flare);
  const dyingS = new Set(dying);
  const lostS = new Set(clash?.lost ?? []);
  const lit = new Set(clash?.result ? [...clash.result.activating.attacker, ...clash.result.activating.defender] : []);

  const baseMarks = (id: string): CardMark[] => {
    const m: CardMark[] = [];
    if (flareS.has(id)) m.push('flare');
    else if (lit.has(id)) m.push('lit');
    if (dyingS.has(id)) m.push('dying');
    else if (lostS.has(id)) m.push('ash');
    return m;
  };

  // ---- who is on which row ----
  let attacker: PlayerId;
  let atkIds: string[];
  let defIds: string[];
  let mods: EngagementModifiers | null;
  let defPending = false;
  if (prompt?.kind === 'commit') {
    attacker = seat;
    atkIds = prompt.eligible;
    defIds = view.stacks[prompt.target] ?? [];
    mods = prompt.mods;
    defPending = true;
  } else {
    attacker = clash!.attacker;
    atkIds = clash!.attackerCards;
    defIds = clash!.defenderCards.length ? clash!.defenderCards : (view.stacks[clash!.target] ?? []);
    defPending = clash!.defenderCards.length === 0;
    mods = clash!.modifiers;
    if (prompt?.kind === 'defend') {
      defIds = prompt.eligible;
      mods = prompt.mods;
    }
  }
  const defender: PlayerId = attacker === 'red' ? 'black' : 'red';

  const picks = new Set(prompt && 'picks' in prompt ? prompt.picks : []);
  const pickable = new Set(
    prompt?.kind === 'commit' || prompt?.kind === 'defend' || prompt?.kind === 'casualties' ? prompt.eligible : [],
  );
  const marksFor = (id: string): CardMark[] => {
    const m = baseMarks(id);
    if (pickable.has(id)) m.push(picks.has(id) ? 'selected' : 'selectable');
    if (defPending && defIds.includes(id) && prompt?.kind !== 'defend') m.push('dim');
    return m;
  };
  const onToggle = prompt && 'onToggle' in prompt ? prompt.onToggle : undefined;
  const clickFor = (ids: string[]) => (onToggle && ids.some((id) => pickable.has(id)) ? (id: string) => pickable.has(id) && onToggle(id) : undefined);

  const witA = prompt?.kind === 'commit' ? (picks.has(atkIds.find((id) => view.cards[id].kind === 'wit') ?? '') ? prompt.wit : null) : clash?.attackerWit ?? null;
  const witD = prompt?.kind === 'defend' ? (picks.has(defIds.find((id) => view.cards[id].kind === 'wit') ?? '') ? prompt.wit : null) : clash?.defenderWit ?? null;
  const badgeFor = (side: 'attacker' | 'defender') => (id: string) =>
    view.cards[id].kind === 'wit' ? (side === 'attacker' ? witA : witD) : (clash?.rangedArchers.includes(id) || (prompt?.kind === 'commit' && prompt.ranged.includes(id)) ? '↗' : null);

  const result = clash?.result ?? null;
  const rows = {
    [attacker]: (
      <Row
        key="a"
        view={view}
        side={attacker}
        ids={atkIds}
        marksFor={marksFor}
        badgeFor={badgeFor('attacker')}
        onClick={clickFor(atkIds)}
        onHoverCard={onHoverCard}
        mods={mods?.attacker ?? null}
        count={result?.counts.attacker}
        role="attacker"
        far={attacker !== seat}
      />
    ),
    [defender]: (
      <Row
        key="d"
        view={view}
        side={defender}
        ids={defIds}
        marksFor={marksFor}
        badgeFor={badgeFor('defender')}
        onClick={clickFor(defIds)}
        onHoverCard={onHoverCard}
        mods={mods?.defender ?? null}
        count={result?.counts.defender}
        role="defender"
        far={defender !== seat}
      />
    ),
  } as Record<PlayerId, ReactNode>;

  const confirmable = prompt?.kind === 'commit' || prompt?.kind === 'defend';
  const witPicked =
    (prompt?.kind === 'commit' && witA !== null) || (prompt?.kind === 'defend' && witD !== null);

  return (
    <div className={`clash ${clash?.ended ? 'clash--ended' : ''}`} onClick={(e) => e.stopPropagation()}>
      {rows[opp]}

      <div className="clash-mid">{waiting && !clash?.dice && <span className="clash-wait" aria-label="Waiting for opponent" />}</div>

      {rows[seat]}

      <div className="clash-controls">
        {witPicked && confirmable && <WitDial value={prompt.wit} onChange={prompt.onWit} />}
        {confirmable && (
          <div className="clash-confirm">
            {prompt.kind === 'commit' && (
              <button type="button" className="btn ghost" onClick={prompt.onCancel}>
                Cancel
              </button>
            )}
            <span className="odds-wrap">
              <button type="button" className="btn lit" disabled={!prompt.canConfirm} onClick={prompt.onConfirm}>
                {prompt.kind === 'commit' ? 'Engage' : 'Defend'}
                <span className="pick-count numeral">
                  {prompt.picks.length}/{prompt.kind === 'commit' ? 3 : prompt.max}
                </span>
              </button>
              <OddsTip lines={prompt.odds} />
            </span>
          </div>
        )}
        {prompt?.kind === 'casualties' && (
          <div className="clash-confirm">
            <span className="casualty-ask caps">
              {prompt.owner === seat ? 'Lose' : 'Strike'} <b className="numeral">{prompt.count}</b>
            </span>
            <button type="button" className="btn lit" disabled={prompt.picks.length !== prompt.count} onClick={prompt.onConfirm}>
              Confirm
            </button>
          </div>
        )}
        {prompt?.kind === 'retreat' && (
          <div className="clash-confirm">
            <button type="button" className="btn" onClick={prompt.onStay}>
              Stand
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
