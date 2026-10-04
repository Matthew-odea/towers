// Bot-vs-bot simulation with invariant checks after every action.
//
// Usage:
//   npm run sim -- --games 500 [--red smart|random] [--black smart|random] [--seed S]
//                  [--max-turns 400] [--workers N] [--verbose] [--no-check]
//
// Defaults: smart vs smart, 20 games, seed "sim", 400 turns per round, workers = CPU count - 1.
// Games are independent and seeded `${seed}-${index}`, so any failure can be replayed with
// `--seed <seed> --from <index> --games 1`.
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  ALL_HEXES,
  CP_CAP_PER_TYPE,
  CP_PER_TURN,
  PLAYERS,
  ROUNDS_TO_WIN,
  TOWER,
  applyAction,
  buildArmy,
  chooseBotAction,
  createMatch,
  other,
  pendingDecision,
  validateAction,
  viewFor,
  type Action,
  type BotLevel,
  type MatchState,
  type PlayerId,
  type RoundWinReason,
} from '../src/index';
import type { Tuning } from '../src/bot/tuning';

// ---------------------------------------------------------------------------
// Invariants

/** Structural invariants of a match state (bot answerability is checked by `simulate`). */
export function checkStateInvariants(s: MatchState): string[] {
  const errs: string[] = [];
  // Every card in exactly one location.
  for (const p of PLAYERS) {
    for (const c of buildArmy(p)) {
      let n = 0;
      for (const ids of Object.values(s.stacks)) n += ids.filter((x) => x === c.id).length;
      n += s.reserve[p].filter((x) => x === c.id).length;
      n += s.destroyed[p].filter((x) => x === c.id).length;
      if (n !== 1) errs.push(`card ${c.id} appears ${n} times`);
      if (s.cards[c.id]?.owner !== p) errs.push(`card ${c.id} has wrong owner`);
    }
    for (const id of [...s.reserve[p], ...s.destroyed[p]]) {
      if (s.cards[id]?.owner !== p) errs.push(`${id} is in ${p}'s reserve/destroyed pile`);
    }
  }
  // No hex holds both players' cards.
  for (const [h, ids] of Object.entries(s.stacks)) {
    if (!ALL_HEXES.includes(h)) errs.push(`stack on off-board hex ${h}`);
    if (ids.length === 0) errs.push(`empty stack entry at ${h}`);
    const owners = new Set(ids.map((id) => s.cards[id].owner));
    if (owners.size > 1) errs.push(`hex ${h} holds both players' cards`);
  }
  for (const [h, p] of Object.entries(s.fortified)) {
    const ids = s.stacks[h];
    if (!ids || s.cards[ids[0]].owner !== p) errs.push(`fortified hex ${h} not held by ${p}`);
  }
  // CP and per-type caps.
  if (s.turn) {
    const t = s.turn;
    if (t.cp < 0 || t.cp > CP_PER_TURN) errs.push(`cp out of range: ${t.cp}`);
    let spent = 0;
    for (const [k, v] of Object.entries(t.spent)) {
      if (v < 0 || v > CP_CAP_PER_TYPE) errs.push(`per-type cap broken for ${k}: ${v}`);
      spent += v;
    }
    if (spent + t.cp !== CP_PER_TURN) errs.push(`cp ${t.cp} + spent ${spent} != ${CP_PER_TURN}`);
    if (t.number < 1) errs.push(`turn number ${t.number}`);
    if (s.phase === 'play' && !s.engagement && t.cp === 0) errs.push('free turn left at 0 CP (should have auto-ended)');
  }
  // Round / match counters.
  const wins = { red: 0, black: 0 } as Record<PlayerId, number>;
  for (const r of s.roundResults) wins[r.winner]++;
  for (const p of PLAYERS) {
    if (wins[p] !== s.roundWins[p]) errs.push(`roundWins[${p}]=${s.roundWins[p]} but ${wins[p]} round results`);
    if (s.roundWins[p] > ROUNDS_TO_WIN) errs.push(`roundWins[${p}]=${s.roundWins[p]} > ${ROUNDS_TO_WIN}`);
  }
  s.roundResults.forEach((r, i) => {
    if (r.round !== i + 1) errs.push(`roundResults[${i}].round = ${r.round}`);
  });
  const decided = PLAYERS.find((p) => s.roundWins[p] >= ROUNDS_TO_WIN);
  if (s.phase === 'matchOver') {
    if (!decided || s.winner !== decided) errs.push(`matchOver with winner ${s.winner} but roundWins ${JSON.stringify(s.roundWins)}`);
    if (s.round !== s.roundResults.length) errs.push(`matchOver: round ${s.round} vs ${s.roundResults.length} results`);
  } else {
    if (decided) errs.push(`${decided} has ${ROUNDS_TO_WIN} round wins but the match continues`);
    if (s.winner !== null) errs.push('winner set before matchOver');
    if (s.round !== s.roundResults.length + 1) errs.push(`round ${s.round} with ${s.roundResults.length} results`);
    const expectedStarter = s.round % 2 === 1 ? s.round1Starter : other(s.round1Starter);
    if (s.roundStarter !== expectedStarter) errs.push(`round ${s.round} starter ${s.roundStarter}, expected ${expectedStarter}`);
  }
  if (s.phase === 'setup') {
    if (s.turn || s.engagement) errs.push('turn/engagement present during setup');
    if (Object.keys(s.stacks).length) errs.push('cards on the board during setup');
  }
  if (s.phase === 'play') {
    if (!s.turn) errs.push('play phase without a turn');
    for (const p of PLAYERS) {
      const cmds = buildArmy(p).filter((c) => c.kind === 'commander');
      if (cmds.every((c) => s.destroyed[p].includes(c.id))) errs.push(`${p} lost both Commanders but the round continues`);
      for (const c of cmds) if (s.reserve[p].includes(c.id)) errs.push(`${c.id} in Reserve during play`);
      if (s.towerCount[p] < 0 || s.towerCount[p] >= 3) errs.push(`towerCount[${p}] = ${s.towerCount[p]}`);
      const enemyTower = TOWER[other(p)];
      const holder = s.stacks[enemyTower]?.length ? s.cards[s.stacks[enemyTower][0]].owner : null;
      if (s.towerCount[p] > 0 && holder !== p) errs.push(`towerCount[${p}] = ${s.towerCount[p]} but ${p} is not on ${enemyTower}`);
    }
    const e = s.engagement;
    if (e) {
      if (!s.turn || s.turn.player !== e.attacker) errs.push('engagement attacker is not the turn player');
      for (const id of e.attackerCards) {
        const h = Object.entries(s.stacks).find(([, ids]) => ids.includes(id));
        if (!h || s.cards[id].owner !== e.attacker) errs.push(`attacking card ${id} not on the board`);
      }
      const tgt = s.stacks[e.target] ?? [];
      if (e.stage !== 'retreat' && e.stage !== 'casualties') {
        for (const id of e.defenderCards) if (!tgt.includes(id)) errs.push(`defending card ${id} not in ${e.target}`);
      }
      if (e.attackerCards.length < 1 || e.attackerCards.length > 3) errs.push(`${e.attackerCards.length} attackers committed`);
      if (e.defenderCards.length > 4) errs.push(`${e.defenderCards.length} defenders committed`);
    }
  } else if (s.phase === 'matchOver' && (s.turn || s.engagement)) errs.push('turn/engagement after matchOver');
  return errs;
}

/** Backwards-compatible: structural invariants plus "someone can act and the bot can answer". */
export function checkInvariants(s: MatchState, bots: Record<PlayerId, BotLevel> = { red: 'random', black: 'random' }): string[] {
  const errs = checkStateInvariants(s);
  const d = pendingDecision(s);
  if (s.phase !== 'matchOver' && d.players.length === 0) errs.push('nobody can act');
  for (const p of d.players) {
    const a = chooseBotAction(viewFor(s, p), p, { level: bots[p] });
    if (!a) errs.push(`bot for ${p} has no action for ${d.kind}`);
    else {
      const err = validateAction(s, a);
      if (err) errs.push(`bot for ${p} chose an illegal ${a.type}: ${err}`);
    }
  }
  if (d.kind === 'reroll' && d.options.length === 0) errs.push('reroll decision with no options');
  return errs;
}

// ---------------------------------------------------------------------------
// One match

export interface RoundStat {
  round: number;
  winner: PlayerId;
  reason: RoundWinReason;
  starter: PlayerId;
  turns: number;
  stalled: boolean;
}

export interface SimResult {
  winner: PlayerId | null;
  actions: number;
  turns: number;
  rounds: number;
  capped: boolean;
  errors: string[];
  roundStats: RoundStat[];
  engagements: number;
  round1Starter: PlayerId;
  /** Decision times (ms) of each bot level. */
  timing: Record<string, number[]>;
  slowest: { ms: number; kind: string; level: string } | null;
}

export interface SimOptions {
  bots?: Record<PlayerId, BotLevel>;
  /** Smart-bot weight overrides per seat (tuning experiments). */
  tunings?: Partial<Record<PlayerId, Partial<Tuning>>>;
  check?: boolean;
  maxTurns?: number;
  collectTiming?: boolean;
}

function nowMs(): number {
  return performance.now();
}

/**
 * Plays one match. `maxTurns` caps each round (the player to move concedes, and the round is
 * reported as stalled). Default bots are random (as the engine tests expect).
 */
export function simulate(seed: string, maxTurns = 400, check = true, opts: SimOptions = {}): SimResult {
  const bots = opts.bots ?? { red: 'random', black: 'random' };
  let s = createMatch({ seed });
  let actions = 0;
  let turns = 0;
  let roundTurns = 0;
  let capped = false;
  let stalledThisRound = false;
  let engagements = 0;
  const errors: string[] = [];
  const roundStats: RoundStat[] = [];
  const timing: Record<string, number[]> = {};
  let slowest: SimResult['slowest'] = null;
  let starter = s.roundStarter;
  const round1Starter = s.round1Starter;
  while (s.phase !== 'matchOver' && actions < 100000) {
    const d = pendingDecision(s);
    if (d.players.length === 0) {
      errors.push(`nobody can act at ${d.kind}`);
      break;
    }
    // Every acting player's bot must produce a legal action; the first one is applied.
    let action: Action | null = null;
    for (const p of d.players) {
      const t0 = nowMs();
      const a = chooseBotAction(viewFor(s, p), p, { level: bots[p], tuning: opts.tunings?.[p] });
      const ms = nowMs() - t0;
      if (opts.collectTiming) {
        (timing[bots[p]] ??= []).push(ms);
        if (!slowest || ms > slowest.ms) slowest = { ms, kind: d.kind, level: bots[p] };
      }
      if (!a) {
        errors.push(`bot ${bots[p]} for ${p} has no action for ${d.kind}`);
        break;
      }
      const err = validateAction(s, a);
      if (err) {
        errors.push(`bot ${bots[p]} for ${p} chose an illegal ${a.type} at ${d.kind}: ${err}`);
        break;
      }
      if (!action) action = a;
    }
    if (errors.length || !action) break;
    if (roundTurns > maxTurns && s.phase === 'play' && d.kind === 'turn') {
      action = { type: 'concede', player: d.players[0] };
      capped = true;
      stalledThisRound = true;
    }
    const r = applyAction(s, action);
    if (!r.ok) {
      errors.push(`bot action rejected (${action.type}): ${r.error}`);
      break;
    }
    s = r.state;
    actions++;
    for (const ev of r.events) {
      if (ev.type === 'turnStarted') {
        turns++;
        roundTurns++;
      } else if (ev.type === 'engagementStarted') engagements++;
      else if (ev.type === 'roundWon') {
        roundStats.push({ round: ev.round, winner: ev.winner, reason: ev.reason, starter, turns: roundTurns, stalled: stalledThisRound });
        roundTurns = 0;
        stalledThisRound = false;
      } else if (ev.type === 'roundStarted') starter = ev.firstPlayer;
    }
    if (check) {
      const errs = checkStateInvariants(s);
      if (errs.length) {
        errors.push(...errs.map((e) => `after ${action!.type} #${actions} (round ${s.round}): ${e}`));
        break;
      }
    }
  }
  if (!errors.length && s.phase !== 'matchOver') errors.push(`match did not finish within ${actions} actions`);
  return {
    winner: s.winner,
    actions,
    turns,
    rounds: s.roundResults.length,
    capped,
    errors,
    roundStats,
    engagements,
    round1Starter,
    timing,
    slowest,
  };
}

// ---------------------------------------------------------------------------
// CLI

interface GameRecord {
  index: number;
  seed: string;
  /** Label of the bot in each seat (level, plus tuning overrides). */
  bots: Record<PlayerId, string>;
  result: Omit<SimResult, 'timing'> & { timing: Record<string, { n: number; sum: number; max: number; over30: number; over200: number; p: number[] }> };
  crash?: string;
}

function summariseTiming(xs: number[]) {
  const sorted = [...xs].sort((a, b) => a - b);
  return {
    n: xs.length,
    sum: xs.reduce((a, b) => a + b, 0),
    max: sorted[sorted.length - 1] ?? 0,
    over30: xs.filter((x) => x > 30).length,
    over200: xs.filter((x) => x > 200).length,
    p: sorted,
  };
}

interface SeatConfig {
  level: BotLevel;
  tuning: Partial<Tuning>;
  label: string;
}

function parseTuning(spec: string): Partial<Tuning> {
  const out: Record<string, number> = {};
  for (const kv of spec.split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (!k || v === undefined || Number.isNaN(Number(v))) throw new Error(`bad tuning "${kv}" (use key=number)`);
    out[k] = Number(v);
  }
  return out as Partial<Tuning>;
}

function runGame(index: number, base: string, seats: Record<PlayerId, SeatConfig>, swap: boolean, maxTurns: number, check: boolean): GameRecord {
  const seed = `${base}-${index}`;
  const cfg: Record<PlayerId, SeatConfig> = swap && index % 2 === 1 ? { red: seats.black, black: seats.red } : seats;
  const bots = { red: cfg.red.label, black: cfg.black.label };
  try {
    const r = simulate(seed, maxTurns, check, {
      bots: { red: cfg.red.level, black: cfg.black.level },
      tunings: { red: cfg.red.tuning, black: cfg.black.tuning },
      collectTiming: true,
    });
    const timing: GameRecord['result']['timing'] = {};
    for (const [k, xs] of Object.entries(r.timing)) {
      const t = summariseTiming(xs);
      // Keep a coarse sample of the distribution only (percentiles are computed from it).
      t.p = t.p.filter((_, i) => i % 10 === 0 || i === t.p.length - 1);
      timing[k] = t;
    }
    return { index, seed, bots, result: { ...r, timing } };
  } catch (e) {
    return {
      index,
      seed,
      bots,
      result: {
        winner: null, actions: 0, turns: 0, rounds: 0, capped: false, errors: [], roundStats: [], engagements: 0,
        round1Starter: 'red', timing: {}, slowest: null,
      },
      crash: e instanceof Error ? `${e.message}\n${e.stack}` : String(e),
    };
  }
}

function parseArgs(argv: string[]) {
  const arg = (name: string, def: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def;
  };
  const level = (v: string): BotLevel => {
    if (v !== 'smart' && v !== 'random') throw new Error(`bot must be smart or random, got ${v}`);
    return v;
  };
  const tuneRed = arg('tune-red', '');
  const tuneBlack = arg('tune-black', '');
  const bots = { red: level(arg('red', 'smart')), black: level(arg('black', 'smart')) } as Record<PlayerId, BotLevel>;
  const seat = (p: PlayerId, t: string): SeatConfig => ({
    level: bots[p],
    tuning: parseTuning(t),
    label: t ? `${bots[p]}[${t}]` : bots[p],
  });
  return {
    seats: { red: seat('red', tuneRed), black: seat('black', tuneBlack) } as Record<PlayerId, SeatConfig>,
    tuneRed,
    tuneBlack,
    swap: argv.includes('--swap'),
    games: Number(arg('games', '20')),
    from: Number(arg('from', '0')),
    seed: arg('seed', 'sim'),
    maxTurns: Number(arg('max-turns', '400')),
    bots,
    workers: Number(arg('workers', String(Math.max(1, Math.floor(availableParallelism() / 2))))),
    verbose: argv.includes('--verbose'),
    check: !argv.includes('--no-check'),
    worker: argv.includes('--worker'),
  };
}

function pct(n: number, d: number): string {
  return d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a';
}

function report(records: GameRecord[], o: ReturnType<typeof parseArgs>, ms: number): number {
  const games = records.length;
  const bySeat = { red: 0, black: 0 } as Record<PlayerId, number>;
  const byLevel: Record<string, number> = {};
  const reasons: Record<string, number> = { tower: 0, decapitation: 0, concede: 0 };
  const reasonsByLevel: Record<string, Record<string, number>> = {};
  let rounds = 0;
  let roundTurns = 0;
  let starterRoundWins = 0;
  let starterMatchWins = 0;
  let decided = 0;
  let engagements = 0;
  let stalls = 0;
  const stallSeeds: string[] = [];
  const failures: string[] = [];
  const timing: Record<string, { n: number; sum: number; max: number; over30: number; over200: number; samples: number[] }> = {};
  let slowest: { ms: number; kind: string; level: string; seed: string } | null = null;
  for (const g of records) {
    const r = g.result;
    if (g.crash) {
      failures.push(`seed ${g.seed}: CRASH ${g.crash.split('\n')[0]}`);
      continue;
    }
    if (r.errors.length) failures.push(`seed ${g.seed}: ${r.errors.slice(0, 3).join(' | ')}`);
    if (r.winner) {
      decided++;
      bySeat[r.winner]++;
      const lv = g.bots[r.winner];
      byLevel[lv] = (byLevel[lv] ?? 0) + 1;
      if (r.winner === r.round1Starter) starterMatchWins++;
    }
    engagements += r.engagements;
    for (const rs of r.roundStats) {
      rounds++;
      roundTurns += rs.turns;
      reasons[rs.reason] = (reasons[rs.reason] ?? 0) + 1;
      const lv = g.bots[rs.winner];
      (reasonsByLevel[`${lv}(${rs.winner})`] ??= {})[rs.reason] = ((reasonsByLevel[`${lv}(${rs.winner})`] ?? {})[rs.reason] ?? 0) + 1;
      if (rs.winner === rs.starter) starterRoundWins++;
      if (rs.stalled) {
        stalls++;
        if (stallSeeds.length < 20) stallSeeds.push(`${g.seed} (round ${rs.round})`);
      }
    }
    for (const [k, t] of Object.entries(r.timing)) {
      const acc = (timing[k] ??= { n: 0, sum: 0, max: 0, over30: 0, over200: 0, samples: [] });
      acc.n += t.n;
      acc.sum += t.sum;
      acc.max = Math.max(acc.max, t.max);
      acc.over30 += t.over30;
      acc.over200 += t.over200;
      acc.samples.push(...t.p);
    }
    if (r.slowest && (!slowest || r.slowest.ms > slowest.ms)) slowest = { ...r.slowest, seed: g.seed };
  }
  const lines: string[] = [];
  lines.push(
    `Towers simulation: ${games} games, red=${o.seats.red.label} black=${o.seats.black.label}${o.swap ? ' (seats swapped on odd games)' : ''}, seed "${o.seed}", ${(ms / 1000).toFixed(1)} s`,
  );
  lines.push(`  finished matches: ${decided}/${games}`);
  lines.push(`  wins by seat: red ${bySeat.red} (${pct(bySeat.red, decided)}), black ${bySeat.black} (${pct(bySeat.black, decided)})`);
  if (o.seats.red.label !== o.seats.black.label) {
    for (const [lv, n] of Object.entries(byLevel)) lines.push(`  wins by bot: ${lv} ${n} (${pct(n, decided)})`);
  }
  lines.push(
    `  rounds: ${rounds}; win reasons: tower ${reasons.tower} (${pct(reasons.tower, rounds)}), decapitation ${reasons.decapitation} (${pct(reasons.decapitation, rounds)}), concede ${reasons.concede} (${pct(reasons.concede, rounds)})`,
  );
  for (const [k, v] of Object.entries(reasonsByLevel)) lines.push(`    ${k}: ${JSON.stringify(v)}`);
  lines.push(`  average turns per round: ${rounds ? (roundTurns / rounds).toFixed(1) : 'n/a'}`);
  lines.push(`  first player win rate: rounds ${pct(starterRoundWins, rounds)}, matches (round-1 starter) ${pct(starterMatchWins, decided)}`);
  lines.push(`  average engagements per match: ${games ? (engagements / games).toFixed(1) : 'n/a'}`);
  lines.push(`  stalled rounds (turn cap ${o.maxTurns}, mover conceded): ${stalls}${stallSeeds.length ? ` e.g. ${stallSeeds.join(', ')}` : ''}`);
  for (const [k, t] of Object.entries(timing)) {
    const xs = t.samples.sort((a, b) => a - b);
    const q = (f: number) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(f * xs.length))].toFixed(2) : 'n/a');
    lines.push(
      `  ${k} bot decision time: ${t.n} decisions, mean ${(t.sum / Math.max(1, t.n)).toFixed(2)} ms, p50 ${q(0.5)} ms, p99 ${q(0.99)} ms, max ${t.max.toFixed(1)} ms, >30 ms ${t.over30}, >200 ms ${t.over200}`,
    );
  }
  if (slowest) lines.push(`  slowest decision: ${slowest.ms.toFixed(1)} ms (${slowest.level}, ${slowest.kind}, seed ${slowest.seed})`);
  lines.push(`  crashes / invariant violations: ${failures.length}`);
  for (const f of failures.slice(0, 30)) lines.push(`    ${f}`);
  console.log(lines.join('\n'));
  return failures.length;
}

async function main(): Promise<void> {
  const o = parseArgs(process.argv.slice(2));
  if (o.worker) {
    // Child process: play the assigned games and print one JSON record per line.
    for (let i = o.from; i < o.from + o.games; i++) {
      process.stdout.write(`${JSON.stringify(runGame(i, o.seed, o.seats, o.swap, o.maxTurns, o.check))}\n`);
    }
    return;
  }
  const t0 = Date.now();
  const records: GameRecord[] = [];
  const workers = Math.max(1, Math.min(o.workers, o.games));
  if (workers === 1) {
    for (let i = o.from; i < o.from + o.games; i++) {
      const g = runGame(i, o.seed, o.seats, o.swap, o.maxTurns, o.check);
      records.push(g);
      if (o.verbose) console.log(`game ${i}: winner ${g.result.winner} (${g.result.winner ? g.bots[g.result.winner] : "-"}), ${g.result.rounds} rounds, ${g.result.turns} turns`);
    }
  } else {
    const self = fileURLToPath(import.meta.url);
    const per = Math.ceil(o.games / workers);
    const jobs: Promise<void>[] = [];
    for (let w = 0; w < workers; w++) {
      const from = o.from + w * per;
      const n = Math.min(per, o.from + o.games - from);
      if (n <= 0) continue;
      const args = [...process.execArgv, self, '--worker', '--from', String(from), '--games', String(n), '--seed', o.seed,
        '--red', o.bots.red, '--black', o.bots.black, '--max-turns', String(o.maxTurns), ...(o.check ? [] : ['--no-check']),
        ...(o.tuneRed ? ['--tune-red', o.tuneRed] : []), ...(o.tuneBlack ? ['--tune-black', o.tuneBlack] : []), ...(o.swap ? ['--swap'] : [])];
      jobs.push(
        new Promise((resolve, reject) => {
          const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] });
          let buf = '';
          child.stdout.on('data', (chunk: Buffer) => {
            buf += chunk.toString();
            let nl: number;
            while ((nl = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, nl);
              buf = buf.slice(nl + 1);
              if (!line.trim()) continue;
              const g = JSON.parse(line) as GameRecord;
              records.push(g);
              if (o.verbose) console.log(`game ${g.index}: winner ${g.result.winner}, ${g.result.rounds} rounds, ${g.result.turns} turns`);
            }
          });
          child.on('error', reject);
          child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exited with ${code}`))));
        }),
      );
    }
    await Promise.all(jobs);
  }
  records.sort((a, b) => a.index - b.index);
  const failures = report(records, o, Date.now() - t0);
  if (failures > 0) process.exitCode = 1;
}

const isMain = typeof process !== 'undefined' && !!process.argv[1] && /sim\.ts$/.test(process.argv[1]);
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(2);
  });
}

