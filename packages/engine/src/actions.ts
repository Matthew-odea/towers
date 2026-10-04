// Setup, turn actions, concede, and the action dispatcher.
import { cardName } from './cards';
import {
  handleChooseCasualties,
  handleDefend,
  handleEngage,
  handlePassReroll,
  handlePressOrBreak,
  handleReroll,
  handleRetreat,
} from './engagement';
import { HOME_EDGE, TOWER, areAdjacent, distance, isHex, other } from './hex';
import { endRound, startTurn } from './lifecycle';
import {
  MAX_SETUP_OTHERS,
  PLAYERS,
  emit,
  enterable,
  getCard,
  isFortified,
  isPlayer,
  normalize,
  placeCards,
  stackAt,
  stackOwner,
  toReserve,
} from './state';
import { hasSupply } from './supply';
import type { Action, HexKey, PlayerId, PublicState } from './types';
import {
  type HandlerCtx,
  checkCost,
  checkIdList,
  checkOwned,
  label,
  playerLabel,
  requireFreeTurn,
  spend,
} from './validate';

type A<T extends Action['type']> = Extract<Action, { type: T }>;
/** Network input is untrusted: every field is re-validated, so handlers accept loose shapes. */
type Loose<T> = { [K in keyof T]: K extends 'type' | 'player' ? T[K] : unknown };

// ---------------------------------------------------------------------------
// Setup

function handleSetupPlace(ctx: HandlerCtx, a: Loose<A<'setupPlace'>>): string | null {
  const s = ctx.s;
  if (s.phase !== 'setup') return 'Setup placement is only allowed during round setup.';
  if (s.setup[a.player].submitted) return `${playerLabel(a.player)} has already submitted a setup placement.`;
  if (!Array.isArray(a.placements)) return 'placements must be an array of { cardId, hex }.';
  const placements = a.placements as unknown[];
  const seen = new Set<string>();
  let others = 0;
  for (const p of placements) {
    if (typeof p !== 'object' || p === null) return 'Each placement must be { cardId, hex }.';
    const { cardId, hex } = p as { cardId?: unknown; hex?: unknown };
    if (typeof cardId !== 'string') return 'Each placement needs a cardId string.';
    const card = getCard(s, cardId);
    if (!card) return `Unknown card "${cardId}".`;
    if (card.owner !== a.player) return `${cardName(card)} (${cardId}) belongs to ${playerLabel(card.owner)}.`;
    if (seen.has(cardId)) return `${cardName(card)} is placed more than once.`;
    seen.add(cardId);
    if (!s.reserve[a.player].includes(cardId)) return `${cardName(card)} is not available (destroyed).`;
    if (card.kind === 'wit') return 'Wit cannot be placed during setup; it always starts in Reserve.';
    if (!isHex(hex) || !HOME_EDGE[a.player].includes(hex)) {
      return `${cardName(card)} must be placed on your home edge (${HOME_EDGE[a.player].join(', ')}).`;
    }
    if (card.kind !== 'commander') others += 1;
  }
  const commanders = s.reserve[a.player].filter((id) => s.cards[id].kind === 'commander');
  for (const c of commanders) if (!seen.has(c)) return `Both Commanders must be placed; ${label(s, c)} is missing.`;
  if (others > MAX_SETUP_OTHERS) return `At most ${MAX_SETUP_OTHERS} non-Commander cards may be placed (got ${others}).`;
  if (ctx.dryRun) return null;

  s.setup[a.player] = {
    submitted: true,
    placements: placements.map((p) => {
      const { cardId, hex } = p as { cardId: string; hex: string };
      return { cardId, hex };
    }),
  };
  emit(ctx, { type: 'setupSubmitted', player: a.player });
  if (PLAYERS.every((p) => s.setup[p].submitted)) {
    for (const p of PLAYERS) for (const pl of s.setup[p].placements!) placeCards(s, [pl.cardId], pl.hex);
    emit(ctx, {
      type: 'setupRevealed',
      placements: { red: [...s.setup.red.placements!], black: [...s.setup.black.placements!] },
    });
    s.phase = 'play';
    startTurn(ctx, s.roundStarter);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared checks for moving cards out of a hex.

function checkCardsInHex(s: PublicState, player: PlayerId, ids: unknown, from: unknown, what: string): string | null {
  const listErr = checkIdList(ids, 1, Infinity, what);
  if (listErr) return listErr;
  const list = ids as string[];
  if (!isHex(from)) return `"${String(from)}" is not a hex on the board.`;
  const ownErr = checkOwned(s, player, list);
  if (ownErr) return ownErr;
  const stack = stackAt(s, from);
  for (const id of list) if (!stack.includes(id)) return `${label(s, id)} is not in hex ${from}.`;
  return null;
}

function checkMountainLock(s: PublicState, ids: string[]): string | null {
  const locked = ids.find((id) => s.turn!.mountainLocked.includes(id));
  return locked ? `${label(s, locked)} entered a Mountain this turn and cannot leave it until a later turn.` : null;
}

// ---------------------------------------------------------------------------
// Move

function handleMove(ctx: HandlerCtx, a: Loose<A<'move'>>): string | null {
  const s = ctx.s;
  const err = requireFreeTurn(s, a.player) ?? checkCardsInHex(s, a.player, a.cardIds, a.from, 'Moving cards');
  if (err) return err;
  const ids = a.cardIds as string[];
  const from = a.from as HexKey;
  const lockErr = checkMountainLock(s, ids);
  if (lockErr) return lockErr;
  if (!Array.isArray(a.path) || (a.path.length !== 1 && a.path.length !== 2) || !a.path.every((h) => typeof h === 'string')) {
    return 'path must list 1 hex (or 2 for a Cavalry Plains move).';
  }
  const path = a.path as HexKey[];
  for (const h of path) if (!isHex(h)) return `"${h}" is not a hex on the board.`;
  if (!areAdjacent(from, path[0])) return `${path[0]} is not adjacent to ${from}.`;
  if (!enterable(s, a.player, path[0])) return `Hex ${path[0]} holds enemy cards; clear it by engaging first.`;
  if (path.length === 2) {
    const nonCav = ids.find((id) => s.cards[id].kind !== 'cavalry');
    if (nonCav) return `Only an all-Cavalry group may move 2 hexes (${label(s, nonCav)} is not Cavalry).`;
    if (s.terrain[path[0]] !== 'plains') return `A Cavalry 2-hex move must first enter a Plains hex (${path[0]} is ${s.terrain[path[0]]}).`;
    if (!areAdjacent(path[0], path[1])) return `${path[1]} is not adjacent to ${path[0]}.`;
    if (path[1] === from) return 'A Cavalry 2-hex move cannot return to its starting hex.';
    if (s.terrain[path[1]] !== 'plains') return `A Cavalry 2-hex move can only continue into Plains (${path[1]} is ${s.terrain[path[1]]}).`;
    if (!enterable(s, a.player, path[1])) return `Hex ${path[1]} holds enemy cards; clear it by engaging first.`;
  }
  const costErr = checkCost(s, 'move', 1);
  if (costErr) return costErr;
  if (ctx.dryRun) return null;

  spend(s, 'move', 1);
  const to = path[path.length - 1];
  placeCards(s, ids, to);
  s.turn!.charge = path.length === 2 ? [...ids] : null;
  emit(ctx, { type: 'moved', player: a.player, cardIds: [...ids], from, path: [...path], to, charge: path.length === 2 });
  normalize(ctx);
  return null;
}

// ---------------------------------------------------------------------------
// Withdraw

function handleWithdraw(ctx: HandlerCtx, a: Loose<A<'withdraw'>>): string | null {
  const s = ctx.s;
  const err = requireFreeTurn(s, a.player) ?? checkCardsInHex(s, a.player, a.cardIds, a.from, 'Withdrawing cards');
  if (err) return err;
  const ids = a.cardIds as string[];
  const from = a.from as HexKey;
  const lockErr = checkMountainLock(s, ids);
  if (lockErr) return lockErr;
  const tower = TOWER[a.player];
  if (a.to === 'reserve') {
    if (from !== tower) return `Cards can only be withdrawn to Reserve from your own Tower (${tower}).`;
    const cmd = ids.find((id) => s.cards[id].kind === 'commander');
    if (cmd) return `Commanders can never be withdrawn to Reserve (${label(s, cmd)}).`;
  } else {
    if (!isHex(a.to)) return `"${String(a.to)}" is not a hex on the board (or "reserve").`;
    if (!areAdjacent(from, a.to)) return `${a.to} is not adjacent to ${from}.`;
    if (!enterable(s, a.player, a.to)) return `Hex ${a.to} holds enemy cards.`;
    if (distance(a.to, tower) >= distance(from, tower)) return `Withdraw must move strictly closer to your Tower (${tower}).`;
  }
  const costErr = checkCost(s, 'withdraw', 1);
  if (costErr) return costErr;
  if (ctx.dryRun) return null;

  spend(s, 'withdraw', 1);
  s.turn!.charge = null;
  if (a.to === 'reserve') toReserve(s, ids);
  else placeCards(s, ids, a.to as HexKey);
  emit(ctx, { type: 'withdrew', player: a.player, cardIds: [...ids], from, to: a.to as HexKey | 'reserve' });
  normalize(ctx);
  return null;
}

// ---------------------------------------------------------------------------
// Deploy

function handleDeploy(ctx: HandlerCtx, a: Loose<A<'deploy'>>): string | null {
  const s = ctx.s;
  const err = requireFreeTurn(s, a.player) ?? checkIdList(a.cardIds, 1, 3, 'Deployed cards');
  if (err) return err;
  const ids = a.cardIds as string[];
  const ownErr = checkOwned(s, a.player, ids);
  if (ownErr) return ownErr;
  for (const id of ids) {
    if (!s.reserve[a.player].includes(id)) return `${label(s, id)} is not in your Reserve.`;
    const k = s.cards[id].kind;
    if (k === 'wit') return 'Wit cannot be Deployed; use Spawn Wit.';
    if (k === 'commander') return 'Commanders cannot be Deployed.';
  }
  const tower = TOWER[a.player];
  if (stackOwner(s, tower) === other(a.player)) return 'You cannot Deploy while enemy cards occupy your Tower.';
  const costErr = checkCost(s, 'deploy', 1);
  if (costErr) return costErr;
  if (ctx.dryRun) return null;

  spend(s, 'deploy', 1);
  s.turn!.charge = null;
  placeCards(s, ids, tower);
  emit(ctx, { type: 'deployed', player: a.player, cardIds: [...ids], hex: tower });
  normalize(ctx);
  return null;
}

// ---------------------------------------------------------------------------
// Fortify

export function fortifyCost(s: PublicState, hex: HexKey): number {
  return stackAt(s, hex).some((id) => s.cards[id].kind === 'heavy') ? 1 : 2;
}

function handleFortify(ctx: HandlerCtx, a: Loose<A<'fortify'>>): string | null {
  const s = ctx.s;
  const err = requireFreeTurn(s, a.player);
  if (err) return err;
  if (!isHex(a.hex)) return `"${String(a.hex)}" is not a hex on the board.`;
  const hex = a.hex;
  if (stackOwner(s, hex) !== a.player) return `You have no cards in hex ${hex}.`;
  if (isFortified(s, hex)) return `Hex ${hex} is already Fortified.`;
  const mover = stackAt(s, hex).find((id) => s.turn!.arrived.includes(id));
  if (mover) return `Cannot Fortify ${hex}: ${label(s, mover)} moved or arrived this turn.`;
  const cost = fortifyCost(s, hex);
  const costErr = checkCost(s, 'fortify', cost);
  if (costErr) return costErr;
  if (ctx.dryRun) return null;

  spend(s, 'fortify', cost);
  s.turn!.charge = null;
  s.fortified[hex] = a.player;
  emit(ctx, { type: 'fortified', player: a.player, hex, cost });
  return null;
}

// ---------------------------------------------------------------------------
// Reinforce

function handleReinforce(ctx: HandlerCtx, a: Loose<A<'reinforce'>>): string | null {
  const s = ctx.s;
  const err = requireFreeTurn(s, a.player);
  if (err) return err;
  if (typeof a.cardId !== 'string') return 'cardId must be a card id string.';
  const ownErr = checkOwned(s, a.player, [a.cardId]);
  if (ownErr) return ownErr;
  const id = a.cardId;
  if (!s.reserve[a.player].includes(id)) return `${label(s, id)} is not in your Reserve.`;
  if (s.cards[id].kind === 'wit') return 'Wit cannot be Reinforced.';
  if (s.cards[id].kind === 'commander') return 'Commanders cannot be Reinforced.';
  if (!isHex(a.hex)) return `"${String(a.hex)}" is not a hex on the board.`;
  const hex = a.hex;
  if (stackOwner(s, hex) !== a.player || !isFortified(s, hex)) return `Hex ${hex} is not one of your Fortified hexes.`;
  if (!hasSupply(s, a.player, hex)) return `Hex ${hex} has no supply line to your Tower.`;
  const costErr = checkCost(s, 'reinforce', 3);
  if (costErr) return costErr;
  if (ctx.dryRun) return null;

  spend(s, 'reinforce', 3);
  s.turn!.charge = null;
  placeCards(s, [id], hex);
  emit(ctx, { type: 'reinforced', player: a.player, cardId: id, hex });
  return null;
}

// ---------------------------------------------------------------------------
// Spawn Wit

export function spawnHexError(s: PublicState, player: PlayerId, hex: unknown): string | null {
  if (!isHex(hex)) return `"${String(hex)}" is not a hex on the board.`;
  for (const p of PLAYERS) {
    if (hex === TOWER[p]) return 'Wit cannot be Spawned on a Tower.';
    if (areAdjacent(hex, TOWER[p])) return 'Wit cannot be Spawned adjacent to a Tower.';
  }
  if (!enterable(s, player, hex)) return `Hex ${hex} holds enemy cards.`;
  return null;
}

function handleSpawnWit(ctx: HandlerCtx, a: Loose<A<'spawnWit'>>): string | null {
  const s = ctx.s;
  const err = requireFreeTurn(s, a.player);
  if (err) return err;
  const wit = s.reserve[a.player].find((id) => s.cards[id].kind === 'wit');
  if (!wit) return 'Wit is not in your Reserve.';
  const hexErr = spawnHexError(s, a.player, a.hex);
  if (hexErr) return hexErr;
  const costErr = checkCost(s, 'spawnWit', 1);
  if (costErr) return costErr;
  if (ctx.dryRun) return null;

  spend(s, 'spawnWit', 1);
  s.turn!.charge = null;
  placeCards(s, [wit], a.hex as HexKey);
  emit(ctx, { type: 'spawned', player: a.player, cardId: wit, hex: a.hex as HexKey });
  return null;
}

// ---------------------------------------------------------------------------
// End turn / concede

function handleEndTurn(ctx: HandlerCtx, a: Loose<A<'endTurn'>>): string | null {
  const err = requireFreeTurn(ctx.s, a.player);
  if (err) return err;
  if (ctx.dryRun) return null;
  emit(ctx, { type: 'turnEnded', player: a.player });
  startTurn(ctx, other(a.player));
  return null;
}

/**
 * Ends the turn automatically once the turn player has 0 CP and no engagement is in progress:
 * every turn action costs at least 1 CP, so End turn (or Concede) would be the only choice left.
 */
export function autoEndTurn(ctx: HandlerCtx): void {
  const s = ctx.s;
  if (s.phase !== 'play' || s.engagement || !s.turn || s.turn.cp > 0) return;
  const player = s.turn.player;
  emit(ctx, { type: 'turnEnded', player, auto: true });
  startTurn(ctx, other(player));
}

function handleConcede(ctx: HandlerCtx, a: Loose<A<'concede'>>): string | null {
  if (ctx.s.phase === 'matchOver') return 'The match is over.';
  if (ctx.dryRun) return null;
  emit(ctx, { type: 'conceded', player: a.player });
  endRound(ctx, other(a.player), 'concede');
  return null;
}

// ---------------------------------------------------------------------------
// Dispatcher

const ACTION_TYPES = new Set<string>([
  'setupPlace',
  'move',
  'withdraw',
  'deploy',
  'fortify',
  'reinforce',
  'spawnWit',
  'engage',
  'defend',
  'reroll',
  'passReroll',
  'press',
  'breakOff',
  'chooseCasualties',
  'retreat',
  'endTurn',
  'concede',
]);

/** Validates (and unless dryRun, applies) an action. Returns an error message or null. */
export function dispatch(ctx: HandlerCtx, action: unknown): string | null {
  if (typeof action !== 'object' || action === null) return 'Action must be an object.';
  const a = action as { type?: unknown; player?: unknown };
  if (typeof a.type !== 'string' || !ACTION_TYPES.has(a.type)) return `Unknown action type "${String(a.type)}".`;
  if (!isPlayer(a.player)) return 'Action player must be "red" or "black".';
  const act = action as Loose<Action>;
  switch (act.type) {
    case 'setupPlace':
      return handleSetupPlace(ctx, act as Loose<A<'setupPlace'>>);
    case 'move':
      return handleMove(ctx, act as Loose<A<'move'>>);
    case 'withdraw':
      return handleWithdraw(ctx, act as Loose<A<'withdraw'>>);
    case 'deploy':
      return handleDeploy(ctx, act as Loose<A<'deploy'>>);
    case 'fortify':
      return handleFortify(ctx, act as Loose<A<'fortify'>>);
    case 'reinforce':
      return handleReinforce(ctx, act as Loose<A<'reinforce'>>);
    case 'spawnWit':
      return handleSpawnWit(ctx, act as Loose<A<'spawnWit'>>);
    case 'engage':
      return handleEngage(ctx, act as Loose<A<'engage'>>);
    case 'defend':
      return handleDefend(ctx, act as Loose<A<'defend'>>);
    case 'reroll':
      return handleReroll(ctx, act as Loose<A<'reroll'>>);
    case 'passReroll':
      return handlePassReroll(ctx, act);
    case 'press':
    case 'breakOff':
      return handlePressOrBreak(ctx, act as { type: 'press' | 'breakOff'; player: PlayerId });
    case 'chooseCasualties':
      return handleChooseCasualties(ctx, act as Loose<A<'chooseCasualties'>>);
    case 'retreat':
      return handleRetreat(ctx, act as Loose<A<'retreat'>>);
    case 'endTurn':
      return handleEndTurn(ctx, act);
    case 'concede':
      return handleConcede(ctx, act);
  }
  return 'Unknown action.';
}

