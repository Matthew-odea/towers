// Core types for the Towers rules engine. Everything here is JSON-serialisable.

export type PlayerId = 'red' | 'black';
export type CardKind = 'light' | 'heavy' | 'archer' | 'cavalry' | 'commander' | 'shardbearer' | 'wit';
export type Terrain = 'plains' | 'forest' | 'mountain' | 'tower';
/** Axial hex key "q,r", e.g. "-1,2". */
export type HexKey = string;

export interface Card {
  id: string;
  owner: PlayerId;
  kind: CardKind;
  /** 2–10 for Light/Heavy Infantry. */
  rank?: number;
  /** Character id for Archer/Cavalry/Commander/Shardbearer/Wit (flavour only). */
  character?: string;
}

/** Action types that cost CP (the 3-CP-per-type cap is tracked per entry). */
export type CpActionType = 'move' | 'engage' | 'deploy' | 'withdraw' | 'fortify' | 'reinforce' | 'spawnWit';

export type Phase = 'setup' | 'play' | 'matchOver';
export type RoundWinReason = 'tower' | 'decapitation' | 'concede';
export type Side = 'attacker' | 'defender';

export interface Placement {
  cardId: string;
  hex: HexKey;
}

export interface SetupStatus {
  submitted: boolean;
  /** The submitted placement. In a PlayerView the opponent's placement is always null during setup. */
  placements: Placement[] | null;
}

export interface RoundResult {
  round: number;
  winner: PlayerId;
  reason: RoundWinReason;
}

export interface TurnState {
  player: PlayerId;
  /** 1-based turn number within the round. */
  number: number;
  /** CP left this turn. */
  cp: number;
  /** CP spent this turn per action type (cap 3 each). */
  spent: Record<CpActionType, number>;
  /** Cards (either player's) that moved or arrived in a hex this turn (blocks Fortify). */
  arrived: string[];
  /** Cards (either player's) that entered a Mountain this turn and cannot leave it this turn. */
  mountainLocked: string[];
  /** Cavalry that made a 2-hex Plains move as the immediately previous action (charge window), else null. */
  charge: string[] | null;
}

export type AdvantageSource = 'fortified' | 'charge' | 'archerHighGround' | 'mountainDefence' | 'flanking' | 'stale';
export type DisadvantageSource = 'cavalryMountain' | 'archerDefending' | 'surrounded';

export interface SideModifiers {
  advantage: AdvantageSource[];
  disadvantage: DisadvantageSource[];
}

export interface EngagementModifiers {
  attacker: SideModifiers;
  defender: SideModifiers;
}

export type EngagementOutcome = 'attacker' | 'defender' | 'bloodbath' | 'stale';

export interface EngagementResult {
  dice: [number, number];
  /** Committed card ids that activated, per side. */
  activating: Record<Side, string[]>;
  /** Whether the Advantage 11/12 bonus activation applied, per side. */
  advantageBonus: Record<Side, boolean>;
  /** Activation counts (activating cards + Advantage bonus). */
  counts: Record<Side, number>;
  outcome: EngagementOutcome;
  winner: PlayerId | null;
  /** Winner had activation count >= 2 (not applicable to Bloodbath). */
  overwhelming: boolean;
  shardstrike: Record<Side, boolean>;
}

export type CasualtyReason = 'normal' | 'advantage' | 'shardstrike' | 'bloodbath';

export interface CasualtyStep {
  /** Player who picks. */
  chooser: PlayerId;
  /** Player whose cards die. */
  owner: PlayerId;
  /** How many cards to pick (already capped to the eligible pool). */
  count: number;
  /** Eligible card ids (already excluding cards picked in earlier steps). */
  eligible: string[];
  reason: CasualtyReason;
}

export type EngagementStage = 'defend' | 'reroll' | 'pressOrBreak' | 'casualties' | 'retreat';

export interface Engagement {
  attacker: PlayerId;
  defender: PlayerId;
  target: HexKey;
  attackerCards: string[];
  /** Subset of attackerCards committed as ranged Archers (distance 2). */
  rangedArchers: string[];
  attackerWit: number | null;
  /** Empty until the defender commits. */
  defenderCards: string[];
  defenderWit: number | null;
  charge: boolean;
  stage: EngagementStage;
  /** Null until the defender commits. The 'stale' source may be added later. */
  modifiers: EngagementModifiers | null;
  dice: [number, number] | null;
  /** Number of rolls made (1 + presses). */
  rolls: number;
  staleCount: number;
  commanderRerollsUsed: string[];
  /** Whether each player has used their Disadvantage (forced) reroll this engagement. */
  forcedRerollUsed: Record<PlayerId, boolean>;
  /** Reroll window bookkeeping while stage === 'reroll'. */
  window: { toAct: PlayerId; passes: number } | null;
  /** Result of the latest resolution. */
  result: EngagementResult | null;
  /** Remaining casualty picks; the first is the current one. */
  casualtySteps: CasualtyStep[];
  /** Picks made so far (applied together once all are made). */
  casualtiesChosen: { owner: PlayerId; chosenBy: PlayerId; cardIds: string[]; auto: boolean }[];
  /** Legal Combat Retreat hexes while stage === 'retreat'. */
  retreatHexes: HexKey[];
}

/** Everything both players may see. */
export interface PublicState {
  schema: 1;
  /** Number of actions applied so far. */
  seq: number;
  names: Record<PlayerId, string>;
  /** Every card of both armies, by id. */
  cards: Record<string, Card>;
  phase: Phase;
  round: number;
  roundWins: Record<PlayerId, number>;
  roundResults: RoundResult[];
  round1Starter: PlayerId;
  /** First player of the current round. */
  roundStarter: PlayerId;
  /** Match winner once phase === 'matchOver'. */
  winner: PlayerId | null;
  terrain: Record<HexKey, Terrain>;
  /** Non-empty hexes only. All cards in a hex belong to one player. */
  stacks: Record<HexKey, string[]>;
  /** During setup every available card (incl. Commanders) sits here until placed. */
  reserve: Record<PlayerId, string[]>;
  /** Destroyed cards. Commanders leave this pile at the start of each round. */
  destroyed: Record<PlayerId, string[]>;
  /** Fortified hexes and the player they are fortified for. */
  fortified: Record<HexKey, PlayerId>;
  towerCount: Record<PlayerId, number>;
  setup: Record<PlayerId, SetupStatus>;
  turn: TurnState | null;
  engagement: Engagement | null;
}

export type RngState = [number, number, number, number];

export interface MatchState extends PublicState {
  seed: string;
  rng: RngState;
  /** Forced upcoming die values (testing), consumed before the RNG. */
  diceQueue: number[];
}

export interface PlayerView extends PublicState {
  viewer: PlayerId;
}

export type AnyState = MatchState | PlayerView;

export type Action =
  | { type: 'setupPlace'; player: PlayerId; placements: Placement[] }
  | { type: 'move'; player: PlayerId; cardIds: string[]; from: HexKey; path: HexKey[] }
  | { type: 'withdraw'; player: PlayerId; cardIds: string[]; from: HexKey; to: HexKey | 'reserve' }
  | { type: 'deploy'; player: PlayerId; cardIds: string[] }
  | { type: 'fortify'; player: PlayerId; hex: HexKey }
  | { type: 'reinforce'; player: PlayerId; cardId: string; hex: HexKey }
  | { type: 'spawnWit'; player: PlayerId; hex: HexKey }
  | { type: 'engage'; player: PlayerId; target: HexKey; cardIds: string[]; witNumber?: number }
  | { type: 'defend'; player: PlayerId; cardIds: string[]; witNumber?: number }
  | { type: 'reroll'; player: PlayerId; source: 'commander' | 'disadvantage'; die: 0 | 1; commanderId?: string }
  | { type: 'passReroll'; player: PlayerId }
  | { type: 'press'; player: PlayerId }
  | { type: 'breakOff'; player: PlayerId }
  | { type: 'chooseCasualties'; player: PlayerId; cardIds: string[] }
  | { type: 'retreat'; player: PlayerId; to: HexKey | null }
  | { type: 'endTurn'; player: PlayerId }
  | { type: 'concede'; player: PlayerId };

export type ActionType = Action['type'];

export type ApplyResult = { ok: true; state: MatchState; events: GameEvent[] } | { ok: false; error: string };

export type RerollOption = { source: 'commander'; commanderId: string } | { source: 'disadvantage' };

export type PendingDecision =
  | { kind: 'setup'; players: PlayerId[] }
  | {
      kind: 'turn';
      players: [PlayerId];
      player: PlayerId;
      cp: number;
      /** CP still spendable per action type this turn (min of CP left and cap remaining). */
      capRemaining: Record<CpActionType, number>;
    }
  | {
      kind: 'defend';
      players: [PlayerId];
      player: PlayerId;
      target: HexKey;
      eligible: string[];
      min: 1;
      max: number;
      /** True when Wit is among the eligible cards (a number 2–12 must accompany committing it). */
      witEligible: boolean;
    }
  | { kind: 'reroll'; players: [PlayerId]; player: PlayerId; dice: [number, number]; options: RerollOption[] }
  | { kind: 'pressOrBreak'; players: [PlayerId]; player: PlayerId; staleCount: number }
  | {
      kind: 'casualties';
      players: [PlayerId];
      player: PlayerId;
      owner: PlayerId;
      count: number;
      eligible: string[];
      reason: CasualtyReason;
    }
  | { kind: 'retreat'; players: [PlayerId]; player: PlayerId; from: HexKey; hexes: HexKey[] }
  | { kind: 'matchOver'; players: []; winner: PlayerId };

export type GameEvent =
  | { type: 'roundStarted'; round: number; firstPlayer: PlayerId; terrain: Record<HexKey, Terrain> }
  | { type: 'setupSubmitted'; player: PlayerId }
  | { type: 'setupRevealed'; placements: Record<PlayerId, Placement[]> }
  | { type: 'turnStarted'; player: PlayerId; turn: number; cp: number }
  /** `auto`: the engine ended the turn because the player had 0 CP left and nothing in progress. */
  | { type: 'turnEnded'; player: PlayerId; auto?: boolean }
  | { type: 'towerCount'; player: PlayerId; count: number; hex: HexKey }
  | { type: 'moved'; player: PlayerId; cardIds: string[]; from: HexKey; path: HexKey[]; to: HexKey; charge: boolean }
  | { type: 'withdrew'; player: PlayerId; cardIds: string[]; from: HexKey; to: HexKey | 'reserve' }
  | { type: 'deployed'; player: PlayerId; cardIds: string[]; hex: HexKey }
  | { type: 'spawned'; player: PlayerId; cardId: string; hex: HexKey }
  | { type: 'fortified'; player: PlayerId; hex: HexKey; cost: number }
  | { type: 'fortifyEnded'; player: PlayerId; hex: HexKey }
  | { type: 'reinforced'; player: PlayerId; cardId: string; hex: HexKey }
  | {
      type: 'engageDeclared';
      attacker: PlayerId;
      defender: PlayerId;
      target: HexKey;
      cardIds: string[];
      rangedArchers: string[];
      witNumber: number | null;
      charge: boolean;
    }
  | {
      type: 'engagementStarted';
      attacker: PlayerId;
      defender: PlayerId;
      target: HexKey;
      attackerCards: string[];
      defenderCards: string[];
      rangedArchers: string[];
      witNumbers: Record<Side, number | null>;
      charge: boolean;
      modifiers: EngagementModifiers;
      /** True when the engine committed the defender's only card automatically. */
      autoDefended: boolean;
    }
  | { type: 'diceRolled'; dice: [number, number]; roll: number }
  | {
      type: 'rerolled';
      player: PlayerId;
      source: 'commander' | 'disadvantage';
      commanderId: string | null;
      die: 0 | 1;
      from: number;
      to: number;
      dice: [number, number];
    }
  | { type: 'rerollPassed'; player: PlayerId; auto: boolean }
  | {
      type: 'resolved';
      dice: [number, number];
      activating: Record<Side, string[]>;
      advantageBonus: Record<Side, boolean>;
      counts: Record<Side, number>;
      outcome: EngagementOutcome;
      winner: PlayerId | null;
      overwhelming: boolean;
      shardstrike: Record<Side, boolean>;
      staleCount: number;
    }
  | { type: 'advantageGained'; player: PlayerId; side: Side; source: AdvantageSource }
  | { type: 'pressed'; player: PlayerId }
  | { type: 'brokeOff'; player: PlayerId }
  | { type: 'casualties'; owner: PlayerId; cardIds: string[]; chosenBy: PlayerId; auto: boolean }
  | { type: 'retreated'; player: PlayerId; cardIds: string[]; from: HexKey; to: HexKey | null; auto: boolean }
  | { type: 'engagementEnded'; target: HexKey; outcome: EngagementOutcome | 'brokeOff' }
  | { type: 'conceded'; player: PlayerId }
  | { type: 'roundWon'; round: number; winner: PlayerId; reason: RoundWinReason }
  | { type: 'matchWon'; winner: PlayerId; roundWins: Record<PlayerId, number> };

export type GameEventType = GameEvent['type'];
