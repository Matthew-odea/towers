import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import {
  TOWER,
  activationProbability,
  deployInfo,
  eligibleAttackers,
  engageableTargets,
  engagementOdds,
  fortifiableHexes,
  fortifyCost,
  legalSpawnHexes,
  moveOptions,
  other,
  pendingDecision,
  previewModifiers,
  reinforceTargets,
  reserveDeployable,
  setupCounts,
  validateAction,
  withdrawOptions,
  type Action,
  type CpActionType,
  type HexKey,
  type PendingDecision,
  type PlayerId,
  type PlayerView,
} from '@towers/engine';
import type { GameConnection, Presence } from '../net/types';
import { Board, type HexMark } from './Board';
import type { CardMark } from './Card';
import { Clash, ClashDice, OddsTip, type ClashPrompt } from './Clash';
import { FACTION } from './cardInfo';
import { BackRow, BannerView, Inspector, LogDrawer, PILE_W, Pile, ReserveFan, RoundPips, Spheres, type Inspect } from './Hud';
import { ROUND_BANNER_MS } from './display';
import { capHint } from './hints';
import { statusFor, type TurnStep } from './status';
import { TerrainLayer } from './Terrain';
import { useFeed } from './useFeed';
import './game.css';

type Mode =
  | { kind: 'idle' }
  | { kind: 'select'; hex: HexKey; cardIds: string[]; withdraw: boolean }
  | { kind: 'engage'; target: HexKey }
  | { kind: 'deploy' }
  | { kind: 'fortify' }
  | { kind: 'reinforce' }
  | { kind: 'spawn' };

const IDLE: Mode = { kind: 'idle' };

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

const LEVEL_NAMES: Record<string, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

/** The bot's difficulty, from presence or (older servers) a name like "Bot (Hard)". */
function botLevelLabel(p: Presence | null, side: PlayerId, name: string): string | null {
  const entry = p?.[side];
  if (!entry?.bot) return null;
  if (entry.botLevel) return LEVEL_NAMES[entry.botLevel] ?? null;
  const m = /\((Easy|Medium|Hard)\)\s*$/.exec(name);
  return m ? m[1] : null;
}

interface Primary {
  /** Stable id for tests: endTurn | engage | defend | pass | press | confirm | stay. */
  kind: string;
  label: string;
  count?: string;
  /** Stormlight: this is the expected next step. */
  lit: boolean;
  enabled: boolean;
  onClick: () => void;
  odds?: string[] | null;
}

function toggle(list: string[], id: string, max: number): string[] {
  if (list.includes(id)) return list.filter((x) => x !== id);
  if (list.length >= max) return max === 1 ? [id] : list;
  return [...list, id];
}

let connSerial = 0;
const connKeys = new WeakMap<GameConnection, number>();

/** The game screen for `conn.seat`. A new connection object starts a fresh screen. */
export function GameScreen({ conn, onRematch }: { conn: GameConnection; onRematch?: () => void }) {
  let key = connKeys.get(conn);
  if (key === undefined) {
    key = ++connSerial;
    connKeys.set(conn, key);
  }
  return <Screen key={key} conn={conn} onRematch={onRematch} />;
}

function Screen({ conn, onRematch }: { conn: GameConnection; onRematch?: () => void }) {
  const seat = conn.seat;
  const opp = other(seat);
  const feed = useFeed(conn, seat);
  const live: PlayerView | null = feed.latest?.view ?? null;
  const d = feed.display;

  const [mode, setMode] = useState<Mode>(IDLE);
  const [picks, setPicks] = useState<string[]>([]);
  const [wit, setWit] = useState(7);
  const [rerollSrc, setRerollSrc] = useState(0);
  const [setupPick, setSetupPick] = useState<string | null>(null);
  const [presence, setPresence] = useState<Presence | null>(() => conn.getPresence());
  const [hoverCard, setHoverCard] = useState<string | null>(null);
  const [hoverHex, setHoverHex] = useState<HexKey | null>(null);
  const [hoverGroup, setHoverGroup] = useState<Inspect>(null);
  const [costPreview, setCostPreview] = useState(0);
  const [logOpen, setLogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaiting, setAwaiting] = useState<number | null>(null);
  const pendingSelect = useRef<{ hex: HexKey; cardIds: string[] } | null>(null);

  useEffect(() => {
    setPresence(conn.getPresence());
    return conn.subscribe({ onPresence: setPresence });
  }, [conn]);

  // ---- connection errors ----
  useEffect(
    () =>
      conn.subscribe({
        // The shell shows server errors; here we only unlock input.
        onError: () => setAwaiting(null),
      }),
    [conn],
  );
  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(null), 3500);
    return () => window.clearTimeout(t);
  }, [error]);

  // ---- reset per decision ----
  const seq = live?.seq ?? -1;
  const pd: PendingDecision | null = useMemo(() => (live ? pendingDecision(live) : null), [live]);
  useEffect(() => {
    setAwaiting(null);
    setPicks([]);
    setRerollSrc(0);
    setCostPreview(0);
    setSetupPick(null);
    const ps = pendingSelect.current;
    pendingSelect.current = null;
    if (ps && live && live.turn?.player === seat && !live.engagement && live.turn.cp > 0) {
      const st = live.stacks[ps.hex] ?? [];
      if (ps.cardIds.every((id) => st.includes(id))) {
        setMode({
          kind: 'select',
          hex: ps.hex,
          cardIds: ps.cardIds,
          withdraw: false,
        });
        return;
      }
    }
    setMode(IDLE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  // Defaults for the defend decision.
  useEffect(() => {
    if (pd?.kind === 'defend' && pd.player === seat) {
      setPicks(pd.eligible.length <= pd.max ? [...pd.eligible] : []);
      setWit(7);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  const canAct = !!live && !!pd && !feed.busy && awaiting !== seq && (pd.players as PlayerId[]).includes(seat);
  const turnPd = canAct && pd?.kind === 'turn' ? pd : null;
  /** My setup turn: place one eligible card on a home-edge hex. */
  const mySetup = canAct && pd?.kind === 'setup' && pd.player === seat ? pd : null;

  const send = useCallback(
    (a: Action) => {
      if (!live) return;
      const err = validateAction(live, a);
      if (err) {
        setError(err);
        return;
      }
      setAwaiting(live.seq);
      setHoverCard(null);
      conn.sendAction(a);
    },
    [conn, live],
  );

  // ---- turn queries ----
  const q = useMemo(() => {
    if (!live || !turnPd) return null;
    const sel = mode.kind === 'select' ? mode : null;
    return {
      engage: engageableTargets(live, seat),
      fortify: fortifiableHexes(live, seat),
      deploy: deployInfo(live, seat),
      spawn: legalSpawnHexes(live, seat),
      reinforce: turnPd.capRemaining.reinforce >= 3 && reserveDeployable(live, seat).length > 0 ? reinforceTargets(live, seat) : [],
      moves: sel ? moveOptions(live, seat, sel.cardIds, sel.hex) : [],
      withdraws: sel ? withdrawOptions(live, seat, sel.cardIds, sel.hex) : [],
    };
  }, [live, turnPd, mode, seat]);

  const engageMode = mode.kind === 'engage' && turnPd ? mode : null;
  const attackers = useMemo(() => (live && engageMode ? eligibleAttackers(live, seat, engageMode.target) : []), [live, engageMode, seat]);

  if (!live || !d || !pd)
    return (
      <div className="game game--empty storm-field" data-phase="none">
        {/* Before the match exists (waiting for the opponent) the terrain is not dealt yet: show the
            bare island and its two Towers, dimmed. */}
        <div className="board-preview" aria-hidden>
          <TerrainLayer terrain={null} seat={seat} />
        </div>
      </div>
    );

  const view = d.view;
  const setupPhase = live.phase === 'setup' || view.phase === 'setup';
  const myStackAt = (h: HexKey) => (live.stacks[h] && live.cards[live.stacks[h][0]].owner === seat ? live.stacks[h] : null);
  const boardView: PlayerView = view;

  // ---- engagement prompts ----
  const e = live.engagement;
  let prompt: ClashPrompt = null;
  if (engageMode && turnPd) {
    const target = engageMode.target;
    const eligible = attackers.map((a) => a.cardId);
    const hasWit = picks.some((id) => live.cards[id].kind === 'wit');
    const action: Action = {
      type: 'engage',
      player: seat,
      target,
      cardIds: picks,
      witNumber: hasWit ? wit : undefined,
    };
    const mods = previewModifiers(live, {
      player: seat,
      target,
      attackerCardIds: picks,
    });
    const fire = picks.length
      ? activationProbability(live, picks, {
          witNumber: hasWit ? wit : null,
          advantage: mods.attacker.advantage.length > 0,
        })
      : null;
    prompt = {
      kind: 'commit',
      target,
      eligible,
      ranged: attackers.filter((a) => a.ranged).map((a) => a.cardId),
      picks,
      wit,
      canConfirm: picks.length > 0 && validateAction(live, action) === null,
      mods,
      odds: fire === null ? null : [`Fires ${pct(fire)}`],
      onToggle: (id) => setPicks((p) => toggle(p, id, 3)),
      onWit: setWit,
      onConfirm: () => send(action),
      onCancel: () => setMode(IDLE),
    };
  } else if (canAct && e && pd.kind === 'defend') {
    const hasWit = picks.some((id) => live.cards[id].kind === 'wit');
    const action: Action = {
      type: 'defend',
      player: seat,
      cardIds: picks,
      witNumber: hasWit ? wit : undefined,
    };
    const mods = previewModifiers(live, {
      player: e.attacker,
      target: e.target,
      attackerCardIds: e.attackerCards,
      defenderCardIds: picks,
    });
    const odds = picks.length
      ? engagementOdds(live, {
          player: e.attacker,
          target: e.target,
          attackerCardIds: e.attackerCards,
          defenderCardIds: picks,
          attackerWit: e.attackerWit,
          defenderWit: hasWit ? wit : null,
          modifiers: mods,
        })
      : null;
    prompt = {
      kind: 'defend',
      eligible: pd.eligible,
      max: pd.max,
      picks,
      wit,
      canConfirm: picks.length > 0 && validateAction(live, action) === null,
      mods,
      odds: odds
        ? [`Win ${pct(odds.defenderWins)}`, `Lose ${pct(odds.attackerWins)}`, `Bloodbath ${pct(odds.bloodbath)}`, `Stale ${pct(odds.stale)}`]
        : null,
      onToggle: (id) => setPicks((p) => toggle(p, id, pd.max)),
      onWit: setWit,
      onConfirm: () => send(action),
    };
  } else if (canAct && pd.kind === 'reroll') {
    const opts = pd.options;
    const src = Math.min(rerollSrc, opts.length - 1);
    prompt = {
      kind: 'reroll',
      options: opts,
      source: src,
      onSource: setRerollSrc,
      onDie: (die) => {
        const o = opts[src];
        send({
          type: 'reroll',
          player: seat,
          source: o.source,
          die,
          commanderId: o.source === 'commander' ? o.commanderId : undefined,
        });
      },
      onPass: () => send({ type: 'passReroll', player: seat }),
    };
  } else if (canAct && pd.kind === 'pressOrBreak') {
    prompt = {
      kind: 'press',
      onPress: () => send({ type: 'press', player: seat }),
      onBreak: () => send({ type: 'breakOff', player: seat }),
    };
  } else if (canAct && pd.kind === 'casualties') {
    prompt = {
      kind: 'casualties',
      owner: pd.owner,
      count: pd.count,
      eligible: pd.eligible,
      picks,
      onToggle: (id) => setPicks((p) => toggle(p, id, pd.count)),
      onConfirm: () => send({ type: 'chooseCasualties', player: seat, cardIds: picks }),
    };
  } else if (canAct && pd.kind === 'retreat') {
    prompt = {
      kind: 'retreat',
      onStay: () => send({ type: 'retreat', player: seat, to: null }),
    };
  }
  const oppDeciding = !feed.busy && !!e && pd.players.length > 0 && !(pd.players as PlayerId[]).includes(seat);

  // ---- marks ----
  const hexMarks: Partial<Record<HexKey, HexMark>> = {};
  const hexBadges: Partial<Record<HexKey, ReactNode>> = {};
  const cardMarks: Record<string, CardMark[]> = {};
  const addMark = (id: string, m: CardMark) => (cardMarks[id] ??= []).push(m);
  const sel = mode.kind === 'select' && turnPd ? mode : null;

  const moveTo = new Map<HexKey, HexKey[]>();
  for (const o of q?.moves ?? []) if (!moveTo.has(o.to) || o.path.length < moveTo.get(o.to)!.length) moveTo.set(o.to, o.path);
  const withdrawTo = new Set((q?.withdraws ?? []).filter((x): x is HexKey => x !== 'reserve'));
  const reserveDrop = !!sel && (q?.withdraws ?? []).includes('reserve');

  if (setupPhase) {
    // My setup turn: once a card is picked the home hexes glow; before that they breathe softly.
    if (mySetup) for (const h of mySetup.hexes) hexMarks[h] = setupPick ? 'setup' : 'hint';
  } else if (turnPd && q) {
    if (mode.kind === 'idle') {
      if (turnPd.cp > 0) for (const h of Object.keys(live.stacks)) if (myStackAt(h)) hexMarks[h] = 'own';
      for (const h of q.engage) hexMarks[h] = 'attack';
    } else if (sel) {
      for (const h of q.engage) hexMarks[h] = 'attack';
      hexMarks[sel.hex] = 'selected';
      if (sel.withdraw) for (const h of withdrawTo) hexMarks[h] = 'withdraw';
      else {
        for (const h of withdrawTo) if (!moveTo.has(h)) hexMarks[h] = 'withdraw';
        for (const h of moveTo.keys()) hexMarks[h] = 'move';
      }
      const locked = new Set(live.turn?.mountainLocked ?? []);
      for (const id of live.stacks[sel.hex] ?? []) {
        if (sel.cardIds.includes(id)) addMark(id, 'selected');
        if (locked.has(id)) addMark(id, 'locked');
      }
    } else if (engageMode) {
      hexMarks[engageMode.target] = 'target';
      for (const a of attackers) {
        if (!hexMarks[a.hex]) hexMarks[a.hex] = 'source';
        addMark(a.cardId, picks.includes(a.cardId) ? 'selected' : 'selectable');
      }
    } else if (mode.kind === 'deploy') {
      if (picks.length) hexMarks[TOWER[seat]] = 'deploy';
    } else if (mode.kind === 'fortify') {
      for (const h of q.fortify) {
        hexMarks[h] = 'fortify';
        hexBadges[h] = (
          <span className="cost-pips">
            {Array.from({ length: fortifyCost(live, h) }, (_, i) => (
              <i key={i} />
            ))}
          </span>
        );
      }
    } else if (mode.kind === 'reinforce') {
      if (picks[0])
        for (const h of q.reinforce)
          if (
            validateAction(live, {
              type: 'reinforce',
              player: seat,
              cardId: picks[0],
              hex: h,
            }) === null
          )
            hexMarks[h] = 'reinforce';
    } else if (mode.kind === 'spawn') {
      for (const h of q.spawn) hexMarks[h] = 'spawn';
    }
  } else if (canAct && pd.kind === 'retreat') {
    for (const h of pd.hexes) hexMarks[h] = 'retreat';
  }
  if (canAct && (pd.kind === 'defend' || pd.kind === 'casualties')) {
    for (const id of pd.eligible) addMark(id, picks.includes(id) ? 'selected' : 'selectable');
  }

  // ---- click handling ----
  const onHexClick = (h: HexKey, ev: MouseEvent) => {
    if (setupPhase) {
      if (mySetup && setupPick && mySetup.hexes.includes(h)) {
        send({
          type: 'setupPlace',
          player: seat,
          placements: [{ cardId: setupPick, hex: h }],
        });
      }
      return;
    }
    if (!canAct) return;
    if (pd.kind === 'retreat') {
      if (pd.hexes.includes(h)) send({ type: 'retreat', player: seat, to: h });
      return;
    }
    if (pd.kind === 'defend' || pd.kind === 'casualties') return;
    if (!turnPd || !q) return;
    switch (mode.kind) {
      case 'spawn':
        if (q.spawn.includes(h)) send({ type: 'spawnWit', player: seat, hex: h });
        else setMode(IDLE);
        return;
      case 'fortify':
        if (q.fortify.includes(h)) send({ type: 'fortify', player: seat, hex: h });
        else setMode(IDLE);
        return;
      case 'reinforce':
        if (picks[0] && hexMarks[h] === 'reinforce') send({ type: 'reinforce', player: seat, cardId: picks[0], hex: h });
        else setMode(IDLE);
        return;
      case 'deploy':
        if (h === TOWER[seat] && picks.length) send({ type: 'deploy', player: seat, cardIds: [picks[0]] });
        else setMode(IDLE);
        return;
      case 'engage':
        if (q.engage.includes(h) && h !== mode.target) {
          setMode({ kind: 'engage', target: h });
          setPicks([]);
        } else if (myStackAt(h)) {
          setMode({
            kind: 'select',
            hex: h,
            cardIds: [...myStackAt(h)!],
            withdraw: false,
          });
        }
        return;
      case 'select': {
        const wantWithdraw = mode.withdraw || ev.shiftKey || ev.altKey;
        if (wantWithdraw && withdrawTo.has(h)) {
          send({
            type: 'withdraw',
            player: seat,
            cardIds: mode.cardIds,
            from: mode.hex,
            to: h,
          });
          return;
        }
        if (!mode.withdraw && moveTo.has(h)) {
          pendingSelect.current = { hex: h, cardIds: mode.cardIds };
          send({
            type: 'move',
            player: seat,
            cardIds: mode.cardIds,
            from: mode.hex,
            path: moveTo.get(h)!,
          });
          return;
        }
        if (withdrawTo.has(h)) {
          send({
            type: 'withdraw',
            player: seat,
            cardIds: mode.cardIds,
            from: mode.hex,
            to: h,
          });
          return;
        }
        if (q.engage.includes(h)) {
          const elig = new Set(eligibleAttackers(live, seat, h).map((a) => a.cardId));
          setMode({ kind: 'engage', target: h });
          setPicks(mode.cardIds.filter((id) => elig.has(id)).slice(0, 3));
          return;
        }
        if (myStackAt(h)) {
          const all = myStackAt(h)!;
          if (h === mode.hex) {
            if (mode.cardIds.length === all.length) setMode(IDLE);
            else setMode({ ...mode, cardIds: [...all] });
          } else
            setMode({
              kind: 'select',
              hex: h,
              cardIds: [...all],
              withdraw: false,
            });
          return;
        }
        setMode(IDLE);
        return;
      }
      case 'idle':
        if (myStackAt(h) && turnPd.cp > 0)
          setMode({
            kind: 'select',
            hex: h,
            cardIds: [...myStackAt(h)!],
            withdraw: false,
          });
        else if (q.engage.includes(h)) {
          setMode({ kind: 'engage', target: h });
          setPicks([]);
        }
        return;
    }
  };

  const onCardClick = (id: string, h: HexKey, ev: MouseEvent) => {
    if (setupPhase) {
      // Placed cards are final; clicking one is clicking its hex (to stack another card there).
      onHexClick(h, ev);
      return;
    }
    if (canAct && (pd.kind === 'defend' || pd.kind === 'casualties')) {
      if (pd.eligible.includes(id)) prompt && 'onToggle' in prompt && prompt.onToggle(id);
      return;
    }
    if (engageMode) {
      if (attackers.some((a) => a.cardId === id)) {
        setPicks((p) => toggle(p, id, 3));
        return;
      }
      return onHexClick(h, ev);
    }
    if (sel && sel.hex === h) {
      const all = live.stacks[h];
      let next: string[];
      if (sel.cardIds.length === all.length) next = [id];
      else next = sel.cardIds.includes(id) ? sel.cardIds.filter((x) => x !== id) : [...sel.cardIds, id];
      if (next.length === 0) setMode(IDLE);
      else setMode({ ...sel, cardIds: next });
      return;
    }
    onHexClick(h, ev);
  };

  const onReserveClick = (id: string) => {
    if (setupPhase) {
      if (mySetup?.eligible.includes(id)) setSetupPick((cur) => (cur === id ? null : id));
      return;
    }
    if (!turnPd || !q) return;
    const kind = live.cards[id].kind;
    if (mode.kind === 'deploy') {
      // Deploy is one card (RULINGS §10.4): picking another replaces the pick.
      if (q.deploy.cards.includes(id)) setPicks((p) => (p[0] === id ? [] : [id]));
      return;
    }
    if (mode.kind === 'reinforce') {
      if (reserveDeployable(live, seat).includes(id)) setPicks([id]);
      return;
    }
    if (kind === 'wit' && q.spawn.length) {
      setMode({ kind: 'spawn' });
      return;
    }
    if (q.deploy.legal && q.deploy.cards.includes(id)) {
      setMode({ kind: 'deploy' });
      setPicks([id]);
    }
  };

  // Reserve marks
  const reserveIds = view.reserve[seat];
  const reserveMarks = (id: string): CardMark[] => {
    const kind = live.cards[id].kind;
    if (setupPhase) {
      if (!mySetup || !mySetup.eligible.includes(id)) return ['dim'];
      return [setupPick === id ? 'selected' : 'selectable'];
    }
    if (!turnPd || !q) return [];
    if (mode.kind === 'deploy') return q.deploy.cards.includes(id) ? [picks.includes(id) ? 'selected' : 'selectable'] : ['dim'];
    if (mode.kind === 'reinforce') return reserveDeployable(live, seat).includes(id) ? [picks.includes(id) ? 'selected' : 'selectable'] : ['dim'];
    if (mode.kind === 'spawn') return kind === 'wit' ? ['selected'] : ['dim'];
    if (mode.kind === 'idle' && kind === 'wit' && q.spawn.length) return ['selectable'];
    return [];
  };

  // ---- inspector ----
  let inspect: Inspect = null;
  if (hoverCard) inspect = { kind: 'card', id: hoverCard };
  else if (hoverGroup) inspect = hoverGroup;
  else if (hoverHex && boardView.stacks[hoverHex]?.length) inspect = { kind: 'cards', ids: boardView.stacks[hoverHex] };

  // ---- controls ----
  const myCp = view.turn?.player === seat ? view.turn.cp : 0;
  const oppCp = view.turn?.player === opp ? view.turn.cp : 0;
  const fortHere = sel && q?.fortify.includes(sel.hex) ? fortifyCost(live, sel.hex) : null;
  const modeBtn = (k: Mode['kind']) => (mode.kind === k ? 'is-on' : '');

  // ---- status line: whose move, and what is asked ----
  const step: TurnStep =
    mode.kind === 'deploy'
      ? picks.length
        ? 'deployPicked'
        : 'deploy'
      : mode.kind === 'reinforce'
        ? picks.length
          ? 'reinforcePicked'
          : 'reinforce'
        : mode.kind;
  // Decisions come from the last settled update, while the board may already be animating the next
  // turn: once the display shows a new turn starting, the status line follows it.
  const shownPd: PendingDecision =
    feed.busy && view.phase === 'play' && view.turn && (pd.kind === 'setup' || (pd.kind === 'turn' && view.turn.player !== pd.player))
      ? {
          kind: 'turn',
          players: [view.turn.player],
          player: view.turn.player,
          cp: view.turn.cp,
          capRemaining: pd.kind === 'turn' ? pd.capRemaining : ({} as Record<CpActionType, number>),
        }
      : pd;
  const status = statusFor({
    pd: shownPd,
    seat,
    cp: view.turn?.cp ?? 0,
    step: turnPd ? step : 'idle',
    troopsPlaced:
      pd.kind === 'setup'
        ? {
            red: setupCounts(live, 'red').troopsPlaced,
            black: setupCounts(live, 'black').troopsPlaced,
          }
        : {},
  });
  const actor = status.actor;
  const sideState = (p: PlayerId) => (actor === null ? '' : actor === p ? 'is-active' : 'is-idle');

  // ---- the one primary action, always in the same place ----
  let primary: Primary | null = null;
  const secondary: ReactNode[] = [];
  if (prompt?.kind === 'commit') {
    primary = {
      kind: 'engage',
      label: 'Engage',
      count: `${prompt.picks.length}/3`,
      lit: prompt.canConfirm,
      enabled: prompt.canConfirm,
      onClick: prompt.onConfirm,
      odds: prompt.odds,
    };
    secondary.push(
      <button key="cancel" type="button" className="btn act ghost" onClick={prompt.onCancel}>
        Cancel
      </button>,
    );
  } else if (prompt?.kind === 'defend') {
    primary = {
      kind: 'defend',
      label: 'Defend',
      count: `${prompt.picks.length}/${prompt.max}`,
      lit: prompt.canConfirm,
      enabled: prompt.canConfirm,
      onClick: prompt.onConfirm,
      odds: prompt.odds,
    };
  } else if (prompt?.kind === 'reroll') {
    primary = {
      kind: 'pass',
      label: 'Pass',
      lit: true,
      enabled: true,
      onClick: prompt.onPass,
    };
  } else if (prompt?.kind === 'press') {
    primary = {
      kind: 'press',
      label: 'Press',
      lit: true,
      enabled: true,
      onClick: prompt.onPress,
    };
    secondary.push(
      <button key="break" type="button" className="btn act" data-secondary="breakOff" onClick={prompt.onBreak}>
        Break off
      </button>,
    );
  } else if (prompt?.kind === 'casualties') {
    const ok = prompt.picks.length === prompt.count;
    primary = {
      kind: 'confirm',
      label: 'Confirm',
      count: `${prompt.picks.length}/${prompt.count}`,
      lit: ok,
      enabled: ok,
      onClick: prompt.onConfirm,
    };
  } else if (prompt?.kind === 'retreat') {
    primary = {
      kind: 'stay',
      label: 'Stay',
      lit: true,
      enabled: true,
      onClick: prompt.onStay,
    };
  } else if (turnPd && q && !e) {
    primary = {
      kind: 'endTurn',
      label: 'End turn',
      lit: mode.kind === 'idle',
      enabled: true,
      onClick: () => send({ type: 'endTurn', player: seat }),
    };
    if (sel && (q.withdraws.length > 0 || sel.withdraw))
      secondary.push(
        <button
          key="withdraw"
          type="button"
          className={`btn act ${sel.withdraw ? 'is-on' : ''}`}
          onClick={() => setMode({ ...sel, withdraw: !sel.withdraw })}
          onMouseEnter={() => setCostPreview(1)}
          onMouseLeave={() => setCostPreview(0)}
        >
          Withdraw
        </button>,
      );
    if (q.fortify.length > 0)
      secondary.push(
        <button
          key="fortify"
          type="button"
          className={`btn act ${modeBtn('fortify')} ${fortHere !== null ? 'lit' : ''}`}
          onClick={() => {
            if (sel && fortHere !== null) send({ type: 'fortify', player: seat, hex: sel.hex });
            else setMode(mode.kind === 'fortify' ? IDLE : { kind: 'fortify' });
          }}
          onMouseEnter={() => setCostPreview(fortHere ?? 0)}
          onMouseLeave={() => setCostPreview(0)}
        >
          Fortify
          {fortHere !== null && (
            <span className="cost-pips">
              {Array.from({ length: fortHere }, (_, i) => (
                <i key={i} />
              ))}
            </span>
          )}
        </button>,
      );
    if (q.deploy.legal)
      secondary.push(
        <button
          key="deploy"
          type="button"
          className={`btn act ${modeBtn('deploy')}`}
          onClick={() => {
            if (mode.kind === 'deploy' && picks.length) send({ type: 'deploy', player: seat, cardIds: [picks[0]] });
            else if (mode.kind === 'deploy') setMode(IDLE);
            else {
              setMode({ kind: 'deploy' });
              setPicks([]);
            }
          }}
          onMouseEnter={() => setCostPreview(1)}
          onMouseLeave={() => setCostPreview(0)}
        >
          Deploy
        </button>,
      );
    if (q.reinforce.length > 0)
      secondary.push(
        <button
          key="reinforce"
          type="button"
          className={`btn act ${modeBtn('reinforce')}`}
          onClick={() => {
            setMode(mode.kind === 'reinforce' ? IDLE : { kind: 'reinforce' });
            setPicks([]);
          }}
          onMouseEnter={() => setCostPreview(3)}
          onMouseLeave={() => setCostPreview(0)}
        >
          Reinforce
        </button>,
      );
    if (q.spawn.length > 0)
      secondary.push(
        <button
          key="spawn"
          type="button"
          className={`btn act ${modeBtn('spawn')}`}
          onClick={() => setMode(mode.kind === 'spawn' ? IDLE : { kind: 'spawn' })}
          onMouseEnter={() => setCostPreview(1)}
          onMouseLeave={() => setCostPreview(0)}
        >
          Spawn Wit
        </button>,
      );
  }
  if (primary && !canAct) primary = null;

  // ---- keyboard ----
  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      setMode(IDLE);
      setSetupPick(null);
      if (pd.kind !== 'defend' && pd.kind !== 'casualties') setPicks([]);
    } else if (ev.key === 'Enter' && primary && primary.enabled && primary.kind !== 'endTurn') {
      primary.onClick();
    }
  };

  const showClash = !!(d.clash || prompt?.kind === 'commit');
  const hint = turnPd && !e ? capHint(turnPd.cp, turnPd.capRemaining, !!sel) : null;
  const oppLevel = botLevelLabel(presence, opp, live.names[opp] ?? '');
  const oppName = oppLevel ? 'Bot' : live.names[opp] || FACTION[opp];

  return (
    <div
      className={`game storm-field ${showClash ? 'game--clash' : ''}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-seat={seat}
      data-phase={live.phase}
      data-decision={pd.kind}
      data-acting={canAct ? 'me' : (pd.players as PlayerId[]).length ? 'opponent' : 'none'}
      data-actor={actor ?? 'none'}
      data-busy={feed.busy ? 'true' : 'false'}
      data-version={feed.latest?.version}
    >
      <div className="storm-mist" aria-hidden />

      {/* ---- top: opponent ---- */}
      <header className="rail rail--top">
        <div className={`who who--${opp} ${sideState(opp)}`}>
          <span className="who-name">{oppName}</span>
          {oppLevel && <span className="who-level">{oppLevel}</span>}
          <RoundPips wins={view.roundWins[opp]} side={opp} />
          {!setupPhase && <Spheres lit={oppCp} side={opp} mine={false} small />}
        </div>
        <div className="opp-reserve">
          <BackRow
            view={view}
            ids={view.reserve[opp]}
            onHover={(on) => setHoverGroup(on ? { kind: 'cards', ids: view.reserve[opp], label: 'Reserve' } : null)}
          />
          <div className="opp-pile">
            <Pile
              view={view}
              ids={view.destroyed[opp]}
              side={opp}
              width={30}
              onHover={(on) =>
                setHoverGroup(
                  on
                    ? {
                        kind: 'cards',
                        ids: view.destroyed[opp],
                        label: 'Fallen',
                      }
                    : null,
                )
              }
            />
          </div>
        </div>
      </header>

      {/* ---- board ---- */}
      <main className="arena">
        <Board
          view={boardView}
          seat={seat}
          hexMarks={hexMarks}
          hexBadges={hexBadges}
          cardMarks={cardMarks}
          expanded={sel ? sel.hex : null}
          clash={d.clash}
          pulse={d.pulse}
          flare={d.flare}
          dying={d.dying}
          activeSide={actor}
          onHexClick={onHexClick}
          onCardClick={onCardClick}
          onHexHover={setHoverHex}
          onCardHover={setHoverCard}
          onBackground={() => {
            if (mode.kind !== 'idle' && mode.kind !== 'engage') setMode(IDLE);
            setSetupPick(null);
          }}
          dice={d.clash ? <ClashDice view={view} seat={seat} clash={d.clash} prompt={prompt} waiting={oppDeciding} /> : undefined}
        />
        <Inspector view={boardView} target={inspect} />
        {showClash && (
          <Clash
            view={view}
            seat={seat}
            clash={d.clash}
            prompt={prompt}
            flare={d.flare}
            dying={d.dying}
            waiting={oppDeciding}
            onHoverCard={setHoverCard}
          />
        )}
        {status.text && (
          <div
            className={`status-line ${actor ? `status-line--${actor}` : ''} ${status.mine ? 'status-line--mine' : 'status-line--theirs'}`}
            aria-live="polite"
            data-status={status.mine ? 'me' : actor ? 'opponent' : 'none'}
          >
            <i className="status-mark" aria-hidden />
            <span className="status-text">{status.text}</span>
          </div>
        )}
        {d.banner && <BannerView banner={d.banner} seat={seat} holdMs={ROUND_BANNER_MS} onSkip={feed.skip} onRematch={onRematch} />}
        {error && <div className="game-error">{error}</div>}
      </main>

      {/* ---- bottom: me ---- */}
      <footer className="rail rail--bottom">
        <ReserveFan
          view={boardView}
          ids={reserveIds}
          marksFor={reserveMarks}
          onCardClick={onReserveClick}
          onHover={setHoverCard}
          idle={actor !== seat}
          drop={reserveDrop}
          onDrop={() =>
            sel &&
            send({
              type: 'withdraw',
              player: seat,
              cardIds: sel.cardIds,
              from: sel.hex,
              to: 'reserve',
            })
          }
          trailingW={PILE_W}
          trailing={
            view.destroyed[seat].length > 0 && (
              <Pile
                view={view}
                ids={view.destroyed[seat]}
                side={seat}
                onHover={(on) =>
                  setHoverGroup(
                    on
                      ? {
                          kind: 'cards',
                          ids: view.destroyed[seat],
                          label: 'Fallen',
                        }
                      : null,
                  )
                }
              />
            )
          }
        />
        <div className="command">
          <div className={`who who--${seat} ${sideState(seat)}`}>
            <span className="who-name">{live.names[seat] || FACTION[seat]}</span>
            <RoundPips wins={view.roundWins[seat]} side={seat} />
          </div>
          {secondary.length > 0 && <div className="actions">{secondary}</div>}
          <div className="cp-line">
            {hint && <span className="cap-hint">{hint}</span>}
            <Spheres lit={myCp} side={seat} mine cost={costPreview} />
            <div className="primary-slot">
              {primary && (
                <span className="odds-wrap">
                  <button
                    type="button"
                    className={`btn primary-act ${primary.lit ? 'lit' : ''}`}
                    data-primary={primary.kind}
                    disabled={!primary.enabled}
                    onClick={primary.onClick}
                  >
                    {primary.label}
                    {primary.count && <span className="pick-count numeral">{primary.count}</span>}
                  </button>
                  {primary.odds && <OddsTip lines={primary.odds} />}
                </span>
              )}
            </div>
          </div>
        </div>
      </footer>

      <LogDrawer open={logOpen} entries={feed.log} onToggle={() => setLogOpen((o) => !o)} />
    </div>
  );
}

export default GameScreen;
