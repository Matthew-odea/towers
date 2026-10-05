// Engagement flow: engage, defend, roll, reroll window, resolution, casualties, Combat Retreat.
import { attackMode, computeModifiers, resolveDice, sideActivation, sideOf } from './combat';
import { areAdjacent, isHex, neighbors, other } from './hex';
import { endRound } from './lifecycle';
import {
  commandersOf,
  destroyCards,
  emit,
  enterable,
  hasRoom,
  hexOf,
  isFortified,
  normalize,
  placeCards,
  rollDie,
  stackAt,
  stackOwner,
} from './state';
import type { CasualtyStep, Engagement, EngagementResult, HexKey, PlayerId, PublicState, RerollOption, Side } from './types';
import {
  type HandlerCtx,
  checkCost,
  checkIdList,
  checkOwned,
  checkWitNumber,
  label,
  playerLabel,
  requireFreeTurn,
  spend,
} from './validate';

const MAX_ATTACKERS = 3;

export function defenderMax(s: PublicState, target: HexKey): number {
  return isFortified(s, target) ? 4 : 3;
}

function sideCards(e: Engagement, side: Side): string[] {
  return side === 'attacker' ? e.attackerCards : e.defenderCards;
}
function sideWit(e: Engagement, side: Side): number | null {
  return side === 'attacker' ? e.attackerWit : e.defenderWit;
}
function opp(side: Side): Side {
  return side === 'attacker' ? 'defender' : 'attacker';
}
function playerOf(e: Engagement, side: Side): PlayerId {
  return side === 'attacker' ? e.attacker : e.defender;
}

/** Reroll options currently usable by `player` (RULINGS §8). Empty outside a reroll window. */
export function rerollOptions(s: PublicState, player: PlayerId): RerollOption[] {
  const e = s.engagement;
  if (!e || e.stage !== 'reroll' || !e.dice || !e.modifiers) return [];
  if (player !== e.attacker && player !== e.defender) return [];
  const side = sideOf(e, player);
  const out: RerollOption[] = [];
  for (const id of sideCards(e, side)) {
    if (s.cards[id]?.kind === 'commander' && !e.commanderRerollsUsed.includes(id)) out.push({ source: 'commander', commanderId: id });
  }
  const o = opp(side);
  if (e.modifiers[o].disadvantage.length > 0 && !e.forcedRerollUsed[player]) {
    const act = sideActivation(s, sideCards(e, o), sideWit(e, o), e.dice, e.modifiers[o].advantage.length > 0);
    if (act.count > 0) out.push({ source: 'disadvantage' });
  }
  return out;
}

/** Legal Combat Retreat hexes for the current engagement's defending stack (RULINGS §12.4). */
export function computeRetreatHexes(s: PublicState, e: Engagement): HexKey[] {
  const stack = stackAt(s, e.target);
  if (stack.length === 0 || stackOwner(s, e.target) !== e.defender) return [];
  if (s.turn && stack.some((id) => s.turn!.mountainLocked.includes(id))) return [];
  const blockers = new Set<HexKey>();
  for (const id of e.attackerCards) {
    if (e.rangedArchers.includes(id)) continue;
    const h = hexOf(s, id);
    if (h && areAdjacent(h, e.target)) blockers.add(h);
  }
  return neighbors(e.target).filter((h) => {
    if (!enterable(s, e.defender, h)) return false;
    // The whole stack retreats together, so the hex must have room for all of it.
    if (!hasRoom(s, h, stack.length)) return false;
    for (const b of blockers) if (b === h || areAdjacent(b, h)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Engage

export function handleEngage(
  ctx: HandlerCtx,
  a: { player: PlayerId; target: unknown; cardIds: unknown; witNumber?: unknown },
): string | null {
  const s = ctx.s;
  const err = requireFreeTurn(s, a.player);
  if (err) return err;
  if (!isHex(a.target)) return `"${String(a.target)}" is not a hex on the board.`;
  const target = a.target;
  const enemy = other(a.player);
  if (stackOwner(s, target) !== enemy) return `Hex ${target} holds no enemy cards to engage.`;
  const listErr = checkIdList(a.cardIds, 1, MAX_ATTACKERS, 'Attacking cards');
  if (listErr) return listErr;
  const ids = a.cardIds as string[];
  const ownErr = checkOwned(s, a.player, ids);
  if (ownErr) return ownErr;
  const ranged: string[] = [];
  for (const id of ids) {
    if (!hexOf(s, id)) return `${label(s, id)} is not on the board.`;
    const mode = attackMode(s, id, target);
    if (mode === null) {
      return s.cards[id].kind === 'archer'
        ? `${label(s, id)} is neither adjacent to ${target} nor at range 2 with line of sight.`
        : `${label(s, id)} is not adjacent to ${target}.`;
    }
    if (mode === 'ranged') ranged.push(id);
  }
  const hasWit = ids.some((id) => s.cards[id].kind === 'wit');
  if (hasWit) {
    const wErr = checkWitNumber(a.witNumber);
    if (wErr) return wErr;
  } else if (a.witNumber !== undefined && a.witNumber !== null) {
    return 'A Wit number was given but Wit is not committed.';
  }
  const costErr = checkCost(s, 'engage', 1);
  if (costErr) return costErr;
  if (ctx.dryRun) return null;

  const t = s.turn!;
  spend(s, 'engage', 1);
  const charge = t.charge !== null && ids.some((id) => t.charge!.includes(id));
  t.charge = null;
  const e: Engagement = {
    attacker: a.player,
    defender: enemy,
    target,
    attackerCards: [...ids],
    rangedArchers: ranged,
    attackerWit: hasWit ? (a.witNumber as number) : null,
    defenderCards: [],
    defenderWit: null,
    charge,
    stage: 'defend',
    modifiers: null,
    dice: null,
    rolls: 0,
    staleCount: 0,
    commanderRerollsUsed: [],
    forcedRerollUsed: { red: false, black: false },
    window: null,
    result: null,
    casualtySteps: [],
    casualtiesChosen: [],
    retreatHexes: [],
  };
  s.engagement = e;
  emit(ctx, {
    type: 'engageDeclared',
    attacker: a.player,
    defender: enemy,
    target,
    cardIds: [...ids],
    rangedArchers: [...ranged],
    witNumber: e.attackerWit,
    charge,
  });
  // Auto-defend when the defender has exactly one legal commitment.
  const stack = stackAt(s, target);
  if (stack.length === 1 && s.cards[stack[0]].kind !== 'wit') commitDefence(ctx, [stack[0]], null, true);
  return null;
}

// ---------------------------------------------------------------------------
// Defend

export function handleDefend(
  ctx: HandlerCtx,
  a: { player: PlayerId; cardIds: unknown; witNumber?: unknown },
): string | null {
  const s = ctx.s;
  const e = s.engagement;
  if (!e || e.stage !== 'defend') return 'There is no engagement waiting for defenders.';
  if (a.player !== e.defender) return `${playerLabel(e.defender)} is the defender, not ${playerLabel(a.player)}.`;
  const max = defenderMax(s, e.target);
  const listErr = checkIdList(a.cardIds, 1, max, 'Defending cards');
  if (listErr) return listErr;
  const ids = a.cardIds as string[];
  const ownErr = checkOwned(s, a.player, ids);
  if (ownErr) return ownErr;
  const stack = stackAt(s, e.target);
  for (const id of ids) if (!stack.includes(id)) return `${label(s, id)} is not in the attacked hex ${e.target}.`;
  const hasWit = ids.some((id) => s.cards[id].kind === 'wit');
  if (hasWit) {
    const wErr = checkWitNumber(a.witNumber);
    if (wErr) return wErr;
  } else if (a.witNumber !== undefined && a.witNumber !== null) {
    return 'A Wit number was given but Wit is not committed.';
  }
  if (ctx.dryRun) return null;
  commitDefence(ctx, ids, hasWit ? (a.witNumber as number) : null, false);
  return null;
}

function commitDefence(ctx: HandlerCtx, ids: string[], wit: number | null, auto: boolean): void {
  const s = ctx.s;
  const e = s.engagement!;
  e.defenderCards = [...ids];
  e.defenderWit = wit;
  e.modifiers = computeModifiers(s, {
    target: e.target,
    attackerCards: e.attackerCards,
    rangedArchers: e.rangedArchers,
    defenderCards: e.defenderCards,
    charge: e.charge,
  });
  emit(ctx, {
    type: 'engagementStarted',
    attacker: e.attacker,
    defender: e.defender,
    target: e.target,
    attackerCards: [...e.attackerCards],
    defenderCards: [...e.defenderCards],
    rangedArchers: [...e.rangedArchers],
    witNumbers: { attacker: e.attackerWit, defender: e.defenderWit },
    charge: e.charge,
    modifiers: JSON.parse(JSON.stringify(e.modifiers)),
    autoDefended: auto,
  });
  roll(ctx);
}

// ---------------------------------------------------------------------------
// Rolling and the reroll window

function roll(ctx: HandlerCtx): void {
  const s = ctx.s;
  const e = s.engagement!;
  e.dice = [rollDie(s), rollDie(s)];
  e.rolls += 1;
  e.result = null;
  emit(ctx, { type: 'diceRolled', dice: [e.dice[0], e.dice[1]], roll: e.rolls });
  e.stage = 'reroll';
  e.window = { toAct: e.defender, passes: 0 };
  advanceWindow(ctx);
}

/** Auto-passes players with no usable reroll; closes the window after two consecutive passes. */
function advanceWindow(ctx: HandlerCtx): void {
  const s = ctx.s;
  const e = s.engagement!;
  while (e.window) {
    if (e.window.passes >= 2) {
      e.window = null;
      resolve(ctx);
      return;
    }
    const p = e.window.toAct;
    if (rerollOptions(s, p).length > 0) return;
    emit(ctx, { type: 'rerollPassed', player: p, auto: true });
    e.window.passes += 1;
    e.window.toAct = other(p);
  }
}

export function handleReroll(
  ctx: HandlerCtx,
  a: { player: PlayerId; source: unknown; die: unknown; commanderId?: unknown },
): string | null {
  const s = ctx.s;
  const e = s.engagement;
  if (!e || e.stage !== 'reroll' || !e.window || !e.dice) return 'There is no reroll window open.';
  if (e.window.toAct !== a.player) return `It is ${playerLabel(e.window.toAct)}'s go in the reroll window.`;
  if (a.die !== 0 && a.die !== 1) return 'die must be 0 or 1.';
  const opts = rerollOptions(s, a.player);
  let commanderId: string | null = null;
  if (a.source === 'commander') {
    const cmd = opts.filter((o): o is { source: 'commander'; commanderId: string } => o.source === 'commander');
    if (cmd.length === 0) return 'You have no unused committed Commander reroll.';
    if (a.commanderId !== undefined && a.commanderId !== null) {
      if (typeof a.commanderId !== 'string' || !cmd.some((o) => o.commanderId === a.commanderId)) {
        return `${typeof a.commanderId === 'string' ? label(s, a.commanderId) : 'That card'} has no unused Commander reroll in this engagement.`;
      }
      commanderId = a.commanderId;
    } else commanderId = cmd[0].commanderId;
  } else if (a.source === 'disadvantage') {
    if (!opts.some((o) => o.source === 'disadvantage')) {
      return 'No Disadvantage reroll is available (the opponent must have Disadvantage and currently activate, once per engagement).';
    }
  } else return 'source must be "commander" or "disadvantage".';
  if (ctx.dryRun) return null;

  const die = a.die as 0 | 1;
  const from = e.dice[die];
  const to = rollDie(s);
  e.dice[die] = to;
  if (commanderId) e.commanderRerollsUsed.push(commanderId);
  else e.forcedRerollUsed[a.player] = true;
  emit(ctx, {
    type: 'rerolled',
    player: a.player,
    source: a.source as 'commander' | 'disadvantage',
    commanderId,
    die,
    from,
    to,
    dice: [e.dice[0], e.dice[1]],
  });
  e.window.passes = 0;
  e.window.toAct = other(a.player);
  advanceWindow(ctx);
  return null;
}

export function handlePassReroll(ctx: HandlerCtx, a: { player: PlayerId }): string | null {
  const e = ctx.s.engagement;
  if (!e || e.stage !== 'reroll' || !e.window) return 'There is no reroll window open.';
  if (e.window.toAct !== a.player) return `It is ${playerLabel(e.window.toAct)}'s go in the reroll window.`;
  if (ctx.dryRun) return null;
  emit(ctx, { type: 'rerollPassed', player: a.player, auto: false });
  e.window.passes += 1;
  e.window.toAct = other(a.player);
  advanceWindow(ctx);
  return null;
}

// ---------------------------------------------------------------------------
// Resolution

function resolve(ctx: HandlerCtx): void {
  const s = ctx.s;
  const e = s.engagement!;
  const r = resolveDice(s, { ...e, modifiers: e.modifiers! }, e.dice!);
  e.result = r;
  if (r.outcome === 'stale') e.staleCount += 1;
  emit(ctx, {
    type: 'resolved',
    dice: [r.dice[0], r.dice[1]],
    activating: { attacker: [...r.activating.attacker], defender: [...r.activating.defender] },
    advantageBonus: { ...r.advantageBonus },
    counts: { ...r.counts },
    outcome: r.outcome,
    winner: r.winner,
    overwhelming: r.overwhelming,
    shardstrike: { ...r.shardstrike },
    staleCount: e.staleCount,
  });
  if (r.outcome === 'stale') {
    if (e.staleCount === 3 && e.modifiers!.defender.advantage.length === 0) {
      e.modifiers!.defender.advantage.push('stale');
      emit(ctx, { type: 'advantageGained', player: e.defender, side: 'defender', source: 'stale' });
    }
    e.stage = 'pressOrBreak';
    return;
  }
  e.casualtySteps = buildCasualtySteps(s, e, r);
  e.casualtiesChosen = [];
  e.stage = 'casualties';
  processCasualties(ctx);
}

/** RULINGS §12: eligible pool for a side (ranged Archers immune unless a defending Archer activated). */
export function casualtyPool(s: PublicState, e: Engagement, side: Side, r: EngagementResult): string[] {
  if (side === 'defender') return [...e.defenderCards];
  const shotBack = r.activating.defender.some((id) => s.cards[id].kind === 'archer');
  return e.attackerCards.filter((id) => shotBack || !e.rangedArchers.includes(id));
}

function buildCasualtySteps(s: PublicState, e: Engagement, r: EngagementResult): CasualtyStep[] {
  if (r.outcome === 'bloodbath') {
    const steps: CasualtyStep[] = [];
    for (const side of ['defender', 'attacker'] as const) {
      const pool = casualtyPool(s, e, side, r);
      const owner = playerOf(e, side);
      const striker = r.shardstrike[opp(side)];
      steps.push({
        chooser: striker ? playerOf(e, opp(side)) : owner,
        owner,
        count: Math.min(1, pool.length),
        eligible: pool,
        reason: striker ? 'shardstrike' : 'bloodbath',
      });
    }
    return steps;
  }
  const winSide: Side = r.outcome === 'attacker' ? 'attacker' : 'defender';
  const loseSide = opp(winSide);
  const winner = playerOf(e, winSide);
  const loser = playerOf(e, loseSide);
  const pool = casualtyPool(s, e, loseSide, r);
  const n = Math.min(r.overwhelming ? 2 : 1, pool.length);
  const mods = e.modifiers!;
  if (mods[winSide].advantage.length > 0 && mods[loseSide].disadvantage.length > 0) {
    return [{ chooser: winner, owner: loser, count: n, eligible: pool, reason: 'advantage' }];
  }
  if (r.shardstrike[winSide]) {
    // Every eligible card dies whoever picks: one auto-resolving step, so nobody is asked a
    // question with a single answer (the winner is still recorded as the chooser).
    if (n === pool.length) return [{ chooser: winner, owner: loser, count: n, eligible: pool, reason: 'shardstrike' }];
    const first = Math.min(1, n);
    return [
      { chooser: winner, owner: loser, count: first, eligible: pool, reason: 'shardstrike' },
      { chooser: loser, owner: loser, count: n - first, eligible: pool, reason: 'normal' },
    ];
  }
  return [{ chooser: loser, owner: loser, count: n, eligible: pool, reason: 'normal' }];
}

/** Auto-resolves casualty picks with no real choice; stops at the first real decision. */
function processCasualties(ctx: HandlerCtx): void {
  const s = ctx.s;
  const e = s.engagement!;
  while (e.casualtySteps.length > 0) {
    const step = e.casualtySteps[0];
    const taken = new Set(e.casualtiesChosen.flatMap((c) => c.cardIds));
    step.eligible = step.eligible.filter((id) => !taken.has(id));
    step.count = Math.min(step.count, step.eligible.length);
    if (step.count === 0) {
      e.casualtySteps.shift();
      continue;
    }
    if (step.count === step.eligible.length) {
      e.casualtiesChosen.push({ owner: step.owner, chosenBy: step.chooser, cardIds: [...step.eligible], auto: true });
      e.casualtySteps.shift();
      continue;
    }
    return;
  }
  finishCasualties(ctx);
}

export function handleChooseCasualties(ctx: HandlerCtx, a: { player: PlayerId; cardIds: unknown }): string | null {
  const s = ctx.s;
  const e = s.engagement;
  if (!e || e.stage !== 'casualties' || e.casualtySteps.length === 0) return 'There are no casualties to choose.';
  const step = e.casualtySteps[0];
  if (step.chooser !== a.player) return `${playerLabel(step.chooser)} chooses these casualties, not ${playerLabel(a.player)}.`;
  const listErr = checkIdList(a.cardIds, step.count, step.count, 'Casualties');
  if (listErr) return listErr;
  const ids = a.cardIds as string[];
  for (const id of ids) {
    if (!step.eligible.includes(id)) return `${label(s, id)} is not an eligible casualty (eligible: ${step.eligible.join(', ')}).`;
  }
  if (ctx.dryRun) return null;
  e.casualtiesChosen.push({ owner: step.owner, chosenBy: step.chooser, cardIds: [...ids], auto: false });
  e.casualtySteps.shift();
  processCasualties(ctx);
  return null;
}

function finishCasualties(ctx: HandlerCtx): void {
  const s = ctx.s;
  const e = s.engagement!;
  for (const c of e.casualtiesChosen) {
    if (c.cardIds.length === 0) continue;
    destroyCards(s, c.cardIds);
    emit(ctx, { type: 'casualties', owner: c.owner, cardIds: [...c.cardIds], chosenBy: c.chosenBy, auto: c.auto });
  }
  normalize(ctx);
  // Decapitation (§11.2): attacker wins if both lose their last Commander together.
  const lost = (p: PlayerId) => commandersOf(s, p).every((id) => s.destroyed[p].includes(id));
  const atkLost = lost(e.attacker);
  const defLost = lost(e.defender);
  if (defLost || atkLost) {
    emit(ctx, { type: 'engagementEnded', target: e.target, outcome: e.result!.outcome });
    endRound(ctx, defLost ? e.attacker : e.defender, 'decapitation');
    return;
  }
  if (e.result!.outcome === 'attacker' && stackOwner(s, e.target) === e.defender) {
    const hexes = computeRetreatHexes(s, e);
    if (hexes.length === 0) {
      emit(ctx, { type: 'retreated', player: e.defender, cardIds: [], from: e.target, to: null, auto: true });
      endEngagement(ctx);
      return;
    }
    e.retreatHexes = hexes;
    e.stage = 'retreat';
    return;
  }
  endEngagement(ctx);
}

function endEngagement(ctx: HandlerCtx, outcome?: 'brokeOff'): void {
  const e = ctx.s.engagement!;
  emit(ctx, { type: 'engagementEnded', target: e.target, outcome: outcome ?? e.result!.outcome });
  ctx.s.engagement = null;
}

// ---------------------------------------------------------------------------
// Press / Break Off / Retreat

export function handlePressOrBreak(ctx: HandlerCtx, a: { type: 'press' | 'breakOff'; player: PlayerId }): string | null {
  const e = ctx.s.engagement;
  if (!e || e.stage !== 'pressOrBreak') return 'There is no stale roll to Press or Break Off.';
  if (a.player !== e.attacker) return `Only the attacker (${playerLabel(e.attacker)}) may Press or Break Off.`;
  if (ctx.dryRun) return null;
  if (a.type === 'press') {
    emit(ctx, { type: 'pressed', player: a.player });
    roll(ctx);
  } else {
    emit(ctx, { type: 'brokeOff', player: a.player });
    endEngagement(ctx, 'brokeOff');
  }
  return null;
}

export function handleRetreat(ctx: HandlerCtx, a: { player: PlayerId; to: unknown }): string | null {
  const s = ctx.s;
  const e = s.engagement;
  if (!e || e.stage !== 'retreat') return 'There is no Combat Retreat to decide.';
  if (a.player !== e.defender) return `Only the defender (${playerLabel(e.defender)}) may Combat Retreat.`;
  if (a.to !== null && !e.retreatHexes.includes(a.to as string)) {
    return `${String(a.to)} is not a legal retreat hex (legal: ${e.retreatHexes.join(', ')}; or null to stay).`;
  }
  if (ctx.dryRun) return null;
  const ids = [...stackAt(s, e.target)];
  if (a.to !== null) {
    const to = a.to as HexKey;
    placeCards(s, ids, to);
    emit(ctx, { type: 'retreated', player: a.player, cardIds: ids, from: e.target, to, auto: false });
    normalize(ctx);
  } else {
    emit(ctx, { type: 'retreated', player: a.player, cardIds: [], from: e.target, to: null, auto: false });
  }
  endEngagement(ctx);
  return null;
}
