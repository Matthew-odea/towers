// Tunable weights of the smart bot (see evaluate.ts / smart.ts for where each is used).
/** Tunable weights. */
export const DEFAULT_TUNING = {
  /** Per card-value point, per hex closer to the enemy Tower. */
  prog: 0.05,
  /** Weight of next-turn attack opportunities. */
  opp: 0.3,
  /** My Tower empty with enemy cards 1 / 2 hexes away. */
  walk1: 26,
  walk2: 7,
  walk3: 0,
  /** Enemy Tower empty with my cards adjacent. */
  walkOpp: 5,
  /** Weights for the enemy's three best engagements next turn. */
  threat: [1, 0.75, 0.5],
  /** Enemy cards that must move first to attack. */
  mobile: 0.8,
  /** Scale on the multi-engagement Commander-exposure penalty. */
  cmdRisk: 1,
  /** Progress-equivalent penalty (in hexes) for a card left in Reserve. */
  reserve: 1,
  /** Commanders with fewer than 3 escorts, scaled by enemy proximity. */
  cmdExpose: 1,
  /** Fortified hex with a supply line. */
  supply: 0.3,
  /** Value of holding the enemy Tower when the count will next be 1 / 2 (3 wins the round). */
  hold1: 16,
  hold2: 34,
  /** Minimum gain over ending the turn for a non-engage action. */
  minGain: 0.05,
  /** Minimum expected value for starting an engagement. */
  minEngage: 0.8,
  /** How far the engagement threshold drops per unit of urgency (long rounds). */
  urgencyEngage: 1.5,
  /** Level-1 candidates expanded one ply further. */
  expand: 6,
  /** Setup: which side hex the strike group prefers on ties (1 or 0; point-symmetric for both seats either way). */
  setupCorner: 1,
  /** Expected value needed to Press after a stale roll. */
  press: 0.05,
};

export type Tuning = typeof DEFAULT_TUNING;
