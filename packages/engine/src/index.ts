// @towers/engine public API. See docs/ENGINE.md.
export const ENGINE_VERSION = '1.0.0';

export * from './types';
export { createMatch, type CreateMatchOptions } from './lifecycle';
export { applyAction, validateAction, isLegal, viewFor, pendingDecision, actingPlayers, mustAct } from './core';
export { chooseBotAction, type BotOptions, type BotLevel } from './bot/index';
export { chooseRandomAction } from './bot/random';

// Board geometry
export {
  ALL_HEXES,
  TOWER,
  HOME_EDGE,
  CENTRE,
  DIRECTIONS,
  hexKey,
  parseHex,
  isHex,
  other,
  distance,
  areAdjacent,
  neighbors,
  mirror,
  commonNeighbors,
} from './hex';

// Cards
export { CHARACTERS, KIND_NAMES, RANKS, buildArmy, buildAllCards, cardName, cardActivates, waysToRoll } from './cards';

// Constants and state lookups
export {
  PLAYERS,
  CP_PER_TURN,
  CP_CAP_PER_TYPE,
  CP_ACTION_TYPES,
  TOWER_WIN_COUNT,
  ROUNDS_TO_WIN,
  MAX_SETUP_OTHERS,
  locate,
  hexOf,
  stackAt,
  stackOwner,
  hexesOf,
  isFortified,
  commandersOf,
  enterable,
  type CardLocation,
} from './state';

// Combat math
export { lineOfSight, attackMode, computeModifiers, sideActivation, resolveDice, ALL_ROLLS } from './combat';
export { rerollOptions, casualtyPool, defenderMax } from './engagement';
export { fortifyCost } from './actions';

// Query helpers
export * from './queries';

// Testing helpers
export * as testing from './testing';
