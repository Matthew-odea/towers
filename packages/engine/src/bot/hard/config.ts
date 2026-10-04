// Hard bot search/evaluation settings. Experiments may pass overrides; production uses the defaults.
import { DEFAULT_TUNING, type Tuning } from '../tuning';

export const DEFAULT_HARD = {
  /** Evaluation weights (same meaning as the medium bot's). */
  tuning: { ...DEFAULT_TUNING } as Tuning,
  /** Turn planner: 'beam' (hard search) or 'medium' (the medium bot; experiments). */
  turnMode: 'beam' as 'beam' | 'medium',
  /** Setup plan. */
  setup: {
    mode: 'hard' as 'hard' | 'medium',
    /** Escorts placed with the Commanders on the Tower (a Heavy first, for cheap Fortify). */
    escorts: 2,
    /** Where the Commanders go: 'tower' or 'strike' (with the strike group). */
    cmd: 'tower' as 'tower' | 'strike' | 'other',
    /** Strike card priorities by kind (plus activation ways). */
    pri: { shardbearer: 40, cavalry: 30, archer: 25, light: 0, heavy: 0 } as Record<string, number>,
    /** Strike hex choice: 'plains' (open ground), 'weak' (away from the enemy mass), 'strong' (facing it), 'tower' (everything on the Tower). */
    strike: 'weak' as 'plains' | 'weak' | 'strong' | 'tower',
    /** Split troops between both side hexes. */
    split: false,
  },
  /** Hard evaluation extras. */
  ev: {
    /** Use the hard evaluator (else the medium one). */
    on: true,
    /** Enemy on my Tower: weigh the next count step by my chance of clearing it. */
    recapture: true,
    /** Share of the enemy's next hold value added to its threat on my Tower stack. */
    towerCapture: 0.5,
    /** Empty Tower: penalty for an exact enemy walk-in next turn (scaled by my chance to clear it); 0 = medium's distance rule. */
    walkIn: 30,
    /** Weight of the chance that the enemy clears my Tower stack next turn. */
    safety: 0,
    /** Commander stacks away from my Tower: weight of the two-turn attrition risk. */
    attrition: 0,
  },
  /** Root engagements: 'outcomes' (value each outcome's position) or 'ev' (medium-style material EV). */
  engageMode: 'outcomes' as 'outcomes' | 'ev',
  /** Required margin (card-value points) for an engagement over the best alternative. */
  engageMargin: 0.3,
  /** Engagement decisions handled by the hard bot (others use the medium bot's exact play). */
  fight: { retreat: true },
  /** Beam widths per search depth (depth 1 keeps every candidate). */
  beam: [1000, 10, 6, 4],
  /** Deterministic work budget (Fights built) for the turn search. */
  work: 60000,
  /** Wall-clock safety cutoff (ms) for the turn search. */
  ms: 350,
};

export type HardConfig = typeof DEFAULT_HARD;
export type HardOverrides = Partial<Omit<HardConfig, 'tuning' | 'setup'>> & {
  tuning?: Partial<Tuning>;
  setup?: Partial<HardConfig['setup']>;
  ev?: Partial<HardConfig['ev']>;
  fight?: Partial<HardConfig['fight']>;
};

export function mergeConfig(o: HardOverrides = {}): HardConfig {
  return {
    ...DEFAULT_HARD,
    ...o,
    tuning: { ...DEFAULT_HARD.tuning, ...(o.tuning ?? {}) },
    setup: { ...DEFAULT_HARD.setup, ...(o.setup ?? {}) },
    ev: { ...DEFAULT_HARD.ev, ...(o.ev ?? {}) },
    fight: { ...DEFAULT_HARD.fight, ...(o.fight ?? {}) },
  };
}
