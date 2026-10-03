// Cross-checks the smart bot's combat model against the engine on random engagements:
// Advantage/Disadvantage flags (bot/model.ts modFlags vs combat.computeModifiers) and the
// per-roll outcome (bot/fight.ts vs combat.resolveDice). Run after engine rule changes:
//   npx tsx scripts/bot-crosscheck.ts [iterations]
import { ALL_ROLLS, attackMode, computeModifiers, resolveDice } from '../src/combat';
import { buildArmy, testing, type Terrain } from '../src/index';
import { Fight } from '../src/bot/fight';
import { DIST, IDX } from '../src/bot/geo';
import { buildSpec, makeCtx, modFlags, posFromState, type AtkCard } from '../src/bot/model';
import { makeRandom } from '../src/rng';

const iterations = Number(process.argv[2] ?? 3000);
const rand = makeRandom('bot-crosscheck');
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const shuffle = <T>(xs: T[]): T[] => {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
};
const target = '0,0';
const ring = ['1,0', '-1,0', '0,1', '1,-1', '-1,1', '0,-1'];
let rolls = 0;
let bad = 0;
for (let it = 0; it < iterations; it++) {
  const red = shuffle(buildArmy('red').map((c) => c.id).filter((id) => !id.includes('-wit-')));
  const black = shuffle(buildArmy('black').map((c) => c.id).filter((id) => !id.includes('-wit-')));
  const board: Record<string, string[]> = {};
  const atk: string[] = [];
  for (let i = 0, n = 1 + Math.floor(rand() * 3); i < n; i++) {
    const id = red.pop()!;
    // Archers sometimes shoot from range 2 (2,0 has a clear straight line to 0,0 via 1,0).
    const h = id.includes('-archer-') && rand() < 0.5 ? pick(['2,0', '0,2', '-2,0']) : pick(ring);
    (board[h] ??= []).push(id);
    atk.push(id);
  }
  const def = black.slice(0, 1 + Math.floor(rand() * 4));
  board[target] = def;
  const terrain: Record<string, Terrain> = {};
  for (const h of [target, ...ring]) terrain[h] = pick(['plains', 'plains', 'mountain', 'forest'] as const);
  const s = testing.buildState({ board, terrain, fortified: rand() < 0.3 ? [target] : [] });
  const ctx = makeCtx(s, 'red');
  const pos = posFromState(s);
  const cards: AtkCard[] = atk.map((id) => {
    const hex = IDX[Object.entries(s.stacks).find(([, ids]) => ids.includes(id))![0]];
    return { id, hex, ranged: DIST[hex][IDX[target]] === 2 };
  });
  // Skip ranged Archers whose line of sight is blocked (the engine would reject the Engage).
  if (atk.some((id) => attackMode(s, id, target) === null)) continue;
  const em = computeModifiers(s, { target, attackerCards: atk, defenderCards: def, charge: false });
  const engine = {
    advA: em.attacker.advantage.length > 0,
    advD: em.defender.advantage.length > 0,
    disA: em.attacker.disadvantage.length > 0,
    disD: em.defender.disadvantage.length > 0,
  };
  const mine = modFlags(ctx, pos, IDX[target], cards, def, false);
  if (JSON.stringify(engine) !== JSON.stringify(mine)) {
    bad++;
    if (bad <= 5) console.log('modifier mismatch', { engine, mine, board, terrain });
    continue;
  }
  const f = new Fight(buildSpec(ctx, pos, 'red', IDX[target], cards, null, { ids: def, wit: null }, false, 0));
  ALL_ROLLS.forEach((d, i) => {
    rolls++;
    const r = resolveDice(s, { attacker: 'red', defender: 'black', attackerCards: atk, defenderCards: def, attackerWit: null, defenderWit: null, modifiers: em }, d);
    const stale = Number.isNaN(f.util(i, 0));
    if (stale !== (r.outcome === 'stale') || f.attackerWins(i, 0) !== (r.outcome === 'attacker')) {
      bad++;
      if (bad <= 5) console.log('outcome mismatch', { dice: d, engine: r.outcome, board, terrain });
    }
  });
}
console.log(`bot-crosscheck: ${iterations} engagements, ${rolls} rolls compared, ${bad} mismatches`);
if (bad) process.exitCode = 1;
