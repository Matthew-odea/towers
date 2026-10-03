// Display state: the view the board is currently showing, advanced event by event so that
// moves, dice and casualties can be animated before snapping to the authoritative view.
import {
  other,
  type EngagementModifiers,
  type EngagementOutcome,
  type GameEvent,
  type HexKey,
  type PlayerId,
  type PlayerView,
  type RoundWinReason,
  type Side,
} from '@towers/engine';

export interface ClashResult {
  activating: Record<Side, string[]>;
  advantageBonus: Record<Side, boolean>;
  counts: Record<Side, number>;
  outcome: EngagementOutcome;
  winner: PlayerId | null;
  overwhelming: boolean;
  shardstrike: Record<Side, boolean>;
}

export interface RerollMark {
  player: PlayerId;
  source: 'commander' | 'disadvantage';
  commanderId: string | null;
  die: 0 | 1;
}

export interface ClashView {
  attacker: PlayerId;
  defender: PlayerId;
  target: HexKey;
  attackerCards: string[];
  rangedArchers: string[];
  attackerWit: number | null;
  defenderCards: string[];
  defenderWit: number | null;
  modifiers: EngagementModifiers | null;
  dice: [number, number] | null;
  /** Bumped per die whenever it is (re)thrown, to retrigger the tumble. */
  dieKeys: [number, number];
  result: ClashResult | null;
  staleCount: number;
  rerolls: RerollMark[];
  ended: EngagementOutcome | 'brokeOff' | null;
  lost: string[];
}

export type Banner =
  | { kind: 'round'; round: number; winner: PlayerId; reason: RoundWinReason; roundWins: Record<PlayerId, number> }
  | { kind: 'match'; winner: PlayerId; roundWins: Record<PlayerId, number> };

export interface Display {
  view: PlayerView;
  clash: ClashView | null;
  flare: string[];
  dying: string[];
  banner: Banner | null;
  pulse: HexKey | null;
}

export interface Frame {
  d: Display;
  ms: number;
  /** Frame waits for a click (or its timeout) before continuing. */
  skippable?: boolean;
}

// ---- helpers ------------------------------------------------------------------------------

function cloneView(v: PlayerView): PlayerView {
  return {
    ...v,
    stacks: Object.fromEntries(Object.entries(v.stacks).map(([k, ids]) => [k, [...ids]])),
    reserve: { red: [...v.reserve.red], black: [...v.reserve.black] },
    destroyed: { red: [...v.destroyed.red], black: [...v.destroyed.black] },
    fortified: { ...v.fortified },
    towerCount: { ...v.towerCount },
    turn: v.turn ? { ...v.turn } : null,
  };
}

function removeFromBoard(v: PlayerView, ids: string[]): void {
  const set = new Set(ids);
  for (const h of Object.keys(v.stacks)) {
    const rest = v.stacks[h].filter((id) => !set.has(id));
    if (rest.length) v.stacks[h] = rest;
    else delete v.stacks[h];
  }
}

function removeFromPiles(v: PlayerView, ids: string[]): void {
  const set = new Set(ids);
  for (const p of ['red', 'black'] as const) v.reserve[p] = v.reserve[p].filter((id) => !set.has(id));
}

function addToHex(v: PlayerView, ids: string[], hex: HexKey): void {
  v.stacks[hex] = [...(v.stacks[hex] ?? []), ...ids];
}

function spend(v: PlayerView, n: number): void {
  if (v.turn) v.turn.cp = Math.max(0, v.turn.cp - n);
}

function next(d: Display, patch: Partial<Display> = {}): Display {
  return { ...d, view: cloneView(d.view), flare: [], dying: [], pulse: null, ...patch };
}

export function clashFromView(v: PlayerView, prev: ClashView | null): ClashView | null {
  const e = v.engagement;
  if (!e) return null;
  const same = prev && prev.target === e.target && prev.attacker === e.attacker && !prev.ended;
  return {
    attacker: e.attacker,
    defender: e.defender,
    target: e.target,
    attackerCards: [...e.attackerCards],
    rangedArchers: [...e.rangedArchers],
    attackerWit: e.attackerWit,
    defenderCards: [...e.defenderCards],
    defenderWit: e.defenderWit,
    modifiers: e.modifiers,
    dice: e.dice,
    dieKeys: same ? prev!.dieKeys : [0, 0],
    result: e.result
      ? {
          activating: e.result.activating,
          advantageBonus: e.result.advantageBonus,
          counts: e.result.counts,
          outcome: e.result.outcome,
          winner: e.result.winner,
          overwhelming: e.result.overwhelming,
          shardstrike: e.result.shardstrike,
        }
      : null,
    staleCount: e.staleCount,
    rerolls: same ? prev!.rerolls : [],
    ended: null,
    lost: same ? prev!.lost : [],
  };
}

/** Snap to the authoritative view at the end of an update. */
export function finalize(d: Display, view: PlayerView): Display {
  return {
    view,
    clash: clashFromView(view, d.clash),
    flare: [],
    dying: [],
    pulse: null,
    banner: view.phase === 'matchOver' && view.winner ? { kind: 'match', winner: view.winner, roundWins: view.roundWins } : null,
  };
}

export function initialDisplay(view: PlayerView): Display {
  return finalize({ view, clash: null, flare: [], dying: [], banner: null, pulse: null }, view);
}

// ---- event → frames -----------------------------------------------------------------------

export function framesFor(d0: Display, e: GameEvent): Frame[] {
  switch (e.type) {
    case 'roundStarted': {
      const d = next(d0, { banner: null, clash: null });
      d.view.terrain = e.terrain;
      d.view.stacks = {};
      d.view.fortified = {};
      d.view.round = e.round;
      d.view.phase = 'setup';
      d.view.turn = null;
      return [{ d, ms: 350 }];
    }
    case 'setupSubmitted':
      return [{ d: next(d0, { banner: d0.banner }), ms: 120 }];
    case 'setupRevealed': {
      const d = next(d0);
      for (const p of ['red', 'black'] as const) {
        for (const pl of e.placements[p]) {
          removeFromPiles(d.view, [pl.cardId]);
          addToHex(d.view, [pl.cardId], pl.hex);
        }
      }
      d.view.phase = 'play';
      return [{ d, ms: 800 }];
    }
    case 'turnStarted': {
      const d = next(d0);
      d.view.turn = d.view.turn
        ? { ...d.view.turn, player: e.player, cp: e.cp, number: e.turn, charge: null }
        : {
            player: e.player,
            cp: e.cp,
            number: e.turn,
            spent: { move: 0, engage: 0, deploy: 0, withdraw: 0, fortify: 0, reinforce: 0, spawnWit: 0 },
            arrived: [],
            mountainLocked: [],
            charge: null,
          };
      return [{ d, ms: 380 }];
    }
    case 'turnEnded': {
      const d = next(d0);
      if (d.view.turn) d.view.turn.cp = 0;
      return [{ d, ms: 160 }];
    }
    case 'towerCount': {
      const d = next(d0, { pulse: e.hex });
      d.view.towerCount[e.player] = e.count;
      return [{ d, ms: e.count > 0 ? 650 : 250 }];
    }
    case 'moved': {
      const out: Frame[] = [];
      let d = d0;
      e.path.forEach((h, i) => {
        d = next(d);
        if (i === 0) spend(d.view, 1);
        removeFromBoard(d.view, e.cardIds);
        addToHex(d.view, e.cardIds, h);
        out.push({ d, ms: 420 });
      });
      return out;
    }
    case 'withdrew': {
      const d = next(d0);
      spend(d.view, 1);
      removeFromBoard(d.view, e.cardIds);
      if (e.to === 'reserve') d.view.reserve[e.player] = [...d.view.reserve[e.player], ...e.cardIds];
      else addToHex(d.view, e.cardIds, e.to);
      return [{ d, ms: 450 }];
    }
    case 'deployed':
    case 'spawned':
    case 'reinforced': {
      const ids = e.type === 'deployed' ? e.cardIds : [e.cardId];
      const d = next(d0, { pulse: e.hex });
      spend(d.view, e.type === 'reinforced' ? 3 : 1);
      removeFromPiles(d.view, ids);
      addToHex(d.view, ids, e.hex);
      return [{ d, ms: 520 }];
    }
    case 'fortified': {
      const d = next(d0, { pulse: e.hex });
      spend(d.view, e.cost);
      d.view.fortified[e.hex] = e.player;
      return [{ d, ms: 560 }];
    }
    case 'fortifyEnded': {
      const d = next(d0);
      delete d.view.fortified[e.hex];
      return [{ d, ms: 200 }];
    }
    case 'engageDeclared': {
      const d = next(d0);
      spend(d.view, 1);
      d.clash = {
        attacker: e.attacker,
        defender: e.defender,
        target: e.target,
        attackerCards: e.cardIds,
        rangedArchers: e.rangedArchers,
        attackerWit: e.witNumber,
        defenderCards: [],
        defenderWit: null,
        modifiers: null,
        dice: null,
        dieKeys: [0, 0],
        result: null,
        staleCount: 0,
        rerolls: [],
        ended: null,
        lost: [],
      };
      return [{ d, ms: 650 }];
    }
    case 'engagementStarted': {
      const d = next(d0);
      const base = d.clash ?? {
        attacker: e.attacker,
        defender: e.defender,
        target: e.target,
        attackerCards: e.attackerCards,
        rangedArchers: e.rangedArchers,
        attackerWit: e.witNumbers.attacker,
        defenderCards: [],
        defenderWit: null,
        modifiers: null,
        dice: null,
        dieKeys: [0, 0] as [number, number],
        result: null,
        staleCount: 0,
        rerolls: [],
        ended: null,
        lost: [],
      };
      d.clash = { ...base, defenderCards: e.defenderCards, defenderWit: e.witNumbers.defender, modifiers: e.modifiers };
      return [{ d, ms: 650 }];
    }
    case 'diceRolled': {
      if (!d0.clash) return [];
      const d = next(d0);
      d.clash = {
        ...d0.clash,
        dice: e.dice,
        dieKeys: [d0.clash.dieKeys[0] + 1, d0.clash.dieKeys[1] + 1],
        result: null,
        rerolls: e.roll === 1 ? [] : d0.clash.rerolls,
      };
      return [{ d, ms: 950 }];
    }
    case 'rerolled': {
      if (!d0.clash) return [];
      const d = next(d0);
      const keys: [number, number] = [...d0.clash.dieKeys];
      keys[e.die] += 1;
      d.clash = {
        ...d0.clash,
        dice: e.dice,
        dieKeys: keys,
        rerolls: [...d0.clash.rerolls, { player: e.player, source: e.source, commanderId: e.commanderId, die: e.die }],
      };
      return [{ d, ms: 900 }];
    }
    case 'rerollPassed':
      return e.auto ? [] : [{ d: next(d0), ms: 260 }];
    case 'resolved': {
      if (!d0.clash) return [];
      const d = next(d0);
      d.clash = {
        ...d0.clash,
        dice: e.dice,
        staleCount: e.staleCount,
        result: {
          activating: e.activating,
          advantageBonus: e.advantageBonus,
          counts: e.counts,
          outcome: e.outcome,
          winner: e.winner,
          overwhelming: e.overwhelming,
          shardstrike: e.shardstrike,
        },
      };
      d.flare = [...e.activating.attacker, ...e.activating.defender];
      return [{ d, ms: 1150 }];
    }
    case 'advantageGained': {
      if (!d0.clash?.modifiers) return [];
      const d = next(d0);
      const m = d0.clash.modifiers;
      d.clash = {
        ...d0.clash,
        modifiers: { ...m, [e.side]: { ...m[e.side], advantage: [...m[e.side].advantage, e.source] } },
      };
      return [{ d, ms: 500 }];
    }
    case 'pressed': {
      if (!d0.clash) return [];
      return [{ d: next(d0, { clash: { ...d0.clash, result: null } }), ms: 260 }];
    }
    case 'brokeOff':
      return [{ d: next(d0), ms: 300 }];
    case 'casualties': {
      const a = next(d0);
      a.dying = e.cardIds;
      const b = next(a);
      removeFromBoard(b.view, e.cardIds);
      b.view.destroyed[e.owner] = [...b.view.destroyed[e.owner], ...e.cardIds];
      if (b.clash) b.clash = { ...b.clash, lost: [...b.clash.lost, ...e.cardIds] };
      return [
        { d: a, ms: 800 },
        { d: b, ms: 120 },
      ];
    }
    case 'retreated': {
      if (e.to === null) return [{ d: next(d0), ms: 200 }];
      const d = next(d0);
      removeFromBoard(d.view, e.cardIds);
      addToHex(d.view, e.cardIds, e.to);
      if (d.view.fortified[e.from] === e.player) delete d.view.fortified[e.from];
      return [{ d, ms: 520 }];
    }
    case 'engagementEnded': {
      if (!d0.clash) return [];
      return [{ d: next(d0, { clash: { ...d0.clash, ended: e.outcome } }), ms: 900 }];
    }
    case 'conceded':
      return [{ d: next(d0), ms: 300 }];
    case 'roundWon': {
      const wins = { ...d0.view.roundWins, [e.winner]: d0.view.roundWins[e.winner] + 1 };
      const d = next(d0, {
        clash: null,
        banner: { kind: 'round', round: e.round, winner: e.winner, reason: e.reason, roundWins: wins },
      });
      d.view.roundWins = wins;
      return [{ d, ms: 3200, skippable: true }];
    }
    case 'matchWon':
      return [{ d: next(d0, { clash: null, banner: { kind: 'match', winner: e.winner, roundWins: e.roundWins } }), ms: 200 }];
  }
}

/** The player behind an event, if any (used to pace the opponent's steps). */
export function eventActor(e: GameEvent): PlayerId | null {
  if ('player' in e && (e.player === 'red' || e.player === 'black')) return e.player;
  if ('attacker' in e) return e.attacker;
  return null;
}

export { other };
