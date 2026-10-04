# Towers engine (`@towers/engine`)

The rules engine as built. Rules come from `docs/rules/RULINGS.md`; this file describes the code.
Everything is exported from `packages/engine/src/index.ts`.

- Pure TypeScript, no dependencies, no Node or browser APIs.
- State is plain JSON. `JSON.parse(JSON.stringify(state))` round-trips.
- `applyAction` never mutates its input and never throws. Bad input returns `{ ok: false, error }`
  with a readable message.
- Deterministic: the same seed and the same action sequence always give the same states and events.

```ts
import { createMatch, applyAction, viewFor, pendingDecision, chooseBotAction } from '@towers/engine';

let state = createMatch({ seed: crypto.randomUUID(), names: { red: 'Ann', black: 'Bo' } });
const r = applyAction(state, { type: 'concede', player: 'red' });
if (r.ok) { state = r.state; broadcast(r.events); } else { reply(r.error); }
```

---

## 1. Core API

```ts
createMatch(opts: { seed: string; names?: Partial<Record<PlayerId, string>>; firstPlayer?: PlayerId }): MatchState
applyAction(state: MatchState, action: Action): { ok: true; state: MatchState; events: GameEvent[] } | { ok: false; error: string }
validateAction(state: MatchState | PlayerView, action: Action): string | null   // null = legal now
isLegal(state: MatchState | PlayerView, action: Action): boolean
viewFor(state: MatchState | PlayerView, player: PlayerId): PlayerView
pendingDecision(state: MatchState | PlayerView): PendingDecision
actingPlayers(state): PlayerId[]          // pendingDecision(state).players
mustAct(state, player): boolean
chooseBotAction(state: MatchState | PlayerView, player: PlayerId, opts?: { level?: BotLevel; rand?: () => number }): Action | null
type BotLevel = 'easy' | 'medium' | 'hard' | 'random'   // 'smart' is still accepted as an alias of 'medium'
BOT_LEVELS: readonly BotLevel[]                           // ['easy', 'medium', 'hard', 'random']
normalizeBotLevel(level: unknown): BotLevel | null        // 'smart' -> 'medium'; unknown -> null
ENGINE_VERSION: string
```

- `createMatch` returns round 1 in the `setup` phase. Terrain is already generated. If
  `firstPlayer` is omitted, the round-1 first player is drawn from the seed.
- `seed` should be a cryptographically random string on the server. The engine hashes it
  (cyrb128) into an sfc32 generator whose 4-word state lives in `state.rng`.
- `validateAction` runs the same checks as `applyAction` without executing anything. It works
  on a `PlayerView`, which is how clients and bots test legality.
- `chooseBotAction` returns a legal action for `player`'s pending decision, or `null` if that
  player has nothing to decide. Levels (dispatch in `src/bot/index.ts`):
  - `'medium'` (default; `'smart'` is a legacy alias): the heuristic search bot in
    `src/bot/smart.ts` (two-ply search over its own turn actions in a light board model, exact
    engagement expected values; about 3–4 ms per decision on average, p99 about 20–25 ms).
    Setup: both Commanders on its Tower, Heavy Infantry escorts on the Tower first (a third
    escort if the opponent has massed a big stack on a side hex), then one strike group on the
    side hex with more open Plains, avoiding the flank the opponent has already loaded. Deploy
    candidates are single cards (most valuable, best activator, best Heavy).
  - `'easy'`: `chooseEasyAction(state, player, rand)` in `src/bot/easy.ts`.
  - `'hard'`: `chooseHardAction(state, player, rand)` in `src/bot/hard/index.ts`.
  - `'random'`: random legal actions (`src/bot/random.ts`), including one random eligible card
    on a random home-edge hex per setup turn.

  `easy` and `hard` currently delegate to `medium` (stubs to be replaced). Every level must
  return a legal action, never concede, and use no Node APIs. Without `rand` the choice is
  deterministic for a given state.

### Actions

Each action carries `player`. All fields are re-validated, so network input can be passed
straight in.

| `type` | Fields | When |
|---|---|---|
| `setupPlace` | `placements: [{ cardId, hex }]` (**exactly one**) | `setup` decision, on your setup turn |
| `move` | `cardIds, from, path` | your turn; `path` = `[hex]`, or `[plains, plains]` for an all-Cavalry move |
| `withdraw` | `cardIds, from, to: HexKey \| 'reserve'` | your turn |
| `deploy` | `cardIds` (**exactly 1**) | your turn |
| `fortify` | `hex` | your turn |
| `reinforce` | `cardId, hex` | your turn |
| `spawnWit` | `hex` | your turn |
| `engage` | `target, cardIds` (1–3), `witNumber?` (2–12, required iff Wit committed) | your turn |
| `defend` | `cardIds` (1–3, or 1–4 if Fortified), `witNumber?` | `defend` decision |
| `reroll` | `source: 'commander' \| 'disadvantage'`, `die: 0 \| 1`, `commanderId?` | `reroll` decision |
| `passReroll` | | `reroll` decision |
| `press` / `breakOff` | | `pressOrBreak` decision (attacker) |
| `chooseCasualties` | `cardIds` (exactly `count`) | `casualties` decision |
| `retreat` | `to: HexKey \| null` (null = stay) | `retreat` decision (defender) |
| `endTurn` | | your turn, no engagement in progress |
| `concede` | | any time, by either player, until the match is over |

A turn action sent while an engagement is in progress is rejected. A `commanderId` left out of
a Commander reroll uses the first unused committed Commander.

---

## 2. State

`MatchState` = `PublicState` + `{ seed, rng, diceQueue }`.
`PlayerView` = `PublicState` + `{ viewer }`. A view has no `seed`, `rng` or `diceQueue`.
Nothing else is hidden: setup is open (RULINGS §4), so both players' setup placements are visible
as they happen.

| Field | Meaning |
|---|---|
| `schema` | `1` |
| `seq` | number of actions applied (incremented by every successful `applyAction`) |
| `names` | display names per seat |
| `cards` | all 54 cards by id: `{ id, owner, kind, rank?, character? }` |
| `phase` | `'setup' \| 'play' \| 'matchOver'` |
| `round` | 1-based |
| `roundWins` | `{ red, black }` |
| `roundResults` | `{ round, winner, reason: 'tower' \| 'decapitation' \| 'concede' }[]`, the history of finished rounds |
| `round1Starter`, `roundStarter` | first player of round 1 / of the current round (alternates) |
| `winner` | match winner once `phase === 'matchOver'` |
| `terrain` | `Record<HexKey, 'plains' \| 'forest' \| 'mountain' \| 'tower'>` for this round |
| `stacks` | `Record<HexKey, cardId[]>`, non-empty hexes only, one owner per hex, insertion order |
| `reserve` | per player. At the start of setup every available card, Commanders included, is here; each setup placement moves one card to the board |
| `destroyed` | per player. Commanders leave this pile when the next round starts |
| `fortified` | `Record<HexKey, PlayerId>`: hexes Fortified for the player holding them |
| `towerCount` | `{ red, black }` per §11.1 |
| `setup` | `Record<PlayerId, { placements: { cardId, hex }[] }>`: this round's setup placements in order (Commanders first). Reset to `[]` when a round starts; kept during play |
| `turn` | `null` outside play, else `TurnState` (below) |
| `engagement` | `null`, or the live `Engagement` (below) |

`TurnState`: `{ player, number, cp, spent: Record<CpActionType, number>, arrived: cardId[], mountainLocked: cardId[], charge: cardId[] | null }`.
`arrived` lists cards that moved or arrived this turn (this blocks Fortify). `mountainLocked`
lists cards of either player that entered a Mountain this turn. `charge` holds the Cavalry from
a 2-hex move that was the immediately previous action. `CpActionType` =
`move | engage | deploy | withdraw | fortify | reinforce | spawnWit`.

`Engagement`: `attacker, defender, target, attackerCards, rangedArchers, attackerWit,
defenderCards, defenderWit, charge, stage ('defend' | 'reroll' | 'pressOrBreak' | 'casualties' | 'retreat'),
modifiers ({ attacker, defender }: { advantage: AdvantageSource[], disadvantage: DisadvantageSource[] }),
dice, rolls, staleCount, commanderRerollsUsed, forcedRerollUsed, window ({ toAct, passes }),
result (latest EngagementResult), casualtySteps, casualtiesChosen, retreatHexes`.

`AdvantageSource` = `fortified | charge | archerHighGround | mountainDefence | flanking | stale`.
`DisadvantageSource` = `cavalryMountain | archerDefending | surrounded`.
`MODIFIER_LABELS` maps each source to display text, and `labelModifiers(m)` applies it.

### Round flow

`setup` (open, one placement per setup turn: starter's 2 Commanders, other player's 2
Commanders, then troops alternating from the starter until each has placed 6) → `setupComplete`
→ `play` (turns, starter first) → round won → **straight into the next round's
`setup`** (new terrain, Commanders restored, surviving cards back in Reserve, the other player
starts), or `matchOver` at 2 round wins. There is no `roundOver` decision: show the result
from the `roundWon` event and `roundResults`. `matchOver` is terminal and every action is
rejected there.

### Board

Axial `"q,r"` keys, radius 2 (19 hexes). Red Tower `-1,2` (home edge `r = 2`), Black Tower
`1,-2` (home edge `r = -2`). Exports: `ALL_HEXES, TOWER, HOME_EDGE, CENTRE, DIRECTIONS, hexKey,
parseHex, isHex, other, distance, areAdjacent, neighbors, mirror, commonNeighbors`.

### Cards

Ids follow `<owner>-<kind>-<rank|character>`, e.g. `red-light-7`, `black-archer-venli`,
`red-wit-hoid`. Exports: `CHARACTERS, KIND_NAMES, RANKS, buildArmy(owner)` (27 cards in
display order), `buildAllCards(), cardName(card)` ("Light Infantry 7", "Archer (venli)"),
`cardActivates(card, dice, witNumber), waysToRoll(total)`.

Constants: `PLAYERS, CP_PER_TURN (4), CP_CAP_PER_TYPE (3), CP_ACTION_TYPES, TOWER_WIN_COUNT (3),
ROUNDS_TO_WIN (2), MAX_SETUP_OTHERS (6, troops per player per setup)`.

Setup helpers (`src/setup.ts`): `nextSetupPlacer(s)` → `{ player, step } | null`,
`setupEligible(s, player)` (cards that player may place now; empty if it is not their setup
turn), `setupCounts(s, player)` → `{ placed, troopsPlaced, commandersLeft, eligibleTroops, troopsLeft }`.

---

## 3. PendingDecision

Every variant has `players`, the players who must act now. Every variant except `matchOver`
lists exactly one player.

| `kind` | Fields | Respond with |
|---|---|---|
| `setup` | `player, step: 'commander' \| 'troop', eligible: cardId[], hexes: HexKey[]` (the player's home edge), `placed`, `commandersLeft`, `troopsLeft` (each `Record<PlayerId, number>`) | `setupPlace` with one `{ cardId, hex }` (`cardId` from `eligible`, `hex` from `hexes`) |
| `turn` | `player, cp, capRemaining: Record<CpActionType, number>` | any turn action, `endTurn` |
| `defend` | `player, target, eligible, min: 1, max, witEligible` | `defend` |
| `reroll` | `player, dice, options: ({ source: 'commander', commanderId } \| { source: 'disadvantage' })[]` | `reroll` / `passReroll` |
| `pressOrBreak` | `player` (attacker), `staleCount` | `press` / `breakOff` |
| `casualties` | `player` (chooser), `owner` (whose cards die), `count`, `eligible`, `reason: 'normal' \| 'advantage' \| 'shardstrike' \| 'bloodbath'` | `chooseCasualties` |
| `retreat` | `player` (defender), `from`, `hexes` (never empty) | `retreat` |
| `matchOver` | `winner`, `players: []` | nothing |

`concede` is legal for either player in every phase except `matchOver`.

The engine resolves these cases automatically, so nobody is asked a question with one answer:
- `defend` when the target hex holds exactly one non-Wit card (a lone Wit still needs a number).
- Reroll turns for a player with no usable option. That player auto-passes (`rerollPassed`,
  `auto: true`). A `reroll` decision therefore always has at least one option.
- A casualty step whose `count` equals the number of eligible cards. All of them die.
- Combat Retreat when no hex is legal. The stack stays (`retreated` with `to: null, auto: true`).

**Automatic end of turn.** When the turn player has 0 CP left and no engagement is in progress,
the engine ends the turn itself, inside the same `applyAction` call: it emits
`turnEnded` with `auto: true` and then starts the opponent's turn (`towerCount`/`turnStarted`,
or `roundWon` if that Tower count wins the round). An Engage paid with the last CP ends the turn
as soon as its engagement ends. Every turn action costs at least 1 CP, so at 0 CP End turn
would be the only choice left. Clients never need to send `endTurn` at 0 CP, and a `turn`
decision always has `cp >= 1`.

---

## 4. GameEvent reference

Events can be shown to both players. Nothing in the game is hidden.

| `type` | Fields |
|---|---|
| `roundStarted` | `round, firstPlayer, terrain` |
| `setupPlaced` | `player, cardId, hex, step: 'commander' \| 'troop'` (one per setup placement) |
| `setupComplete` | `placements: Record<PlayerId, { cardId, hex }[]>` (all of this round's setup placements; `turnStarted` for the starter follows) |
| `turnStarted` | `player, turn, cp` |
| `turnEnded` | `player`, `auto?` (`true` when the engine ended the turn at 0 CP) |
| `towerCount` | `player, count, hex`. Fires when the count goes up at turn start and when it resets to 0 |
| `moved` | `player, cardIds, from, path, to, charge` (`charge` = it was a 2-hex Cavalry move) |
| `withdrew` | `player, cardIds, from, to` (`'reserve'` possible) |
| `deployed` | `player, cardIds, hex` |
| `spawned` | `player, cardId, hex` |
| `fortified` | `player, hex, cost` |
| `fortifyEnded` | `player, hex` (the hex no longer holds that player's cards) |
| `reinforced` | `player, cardId, hex` |
| `engageDeclared` | `attacker, defender, target, cardIds, rangedArchers, witNumber, charge` |
| `engagementStarted` | `attacker, defender, target, attackerCards, defenderCards, rangedArchers, witNumbers: {attacker, defender}, charge, modifiers, autoDefended` |
| `diceRolled` | `dice, roll` (1 for the first roll, +1 per Press) |
| `rerolled` | `player, source, commanderId \| null, die, from, to, dice` |
| `rerollPassed` | `player, auto` |
| `resolved` | `dice, activating: {attacker, defender}, advantageBonus, counts, outcome ('attacker' \| 'defender' \| 'bloodbath' \| 'stale'), winner, overwhelming, shardstrike: {attacker, defender}, staleCount` |
| `advantageGained` | `player, side: 'defender', source: 'stale'` (third stale roll) |
| `pressed` / `brokeOff` | `player` |
| `casualties` | `owner, cardIds, chosenBy, auto`. One event per pick step, emitted when the cards are destroyed |
| `retreated` | `player, cardIds, from, to \| null, auto` |
| `engagementEnded` | `target, outcome` (`'brokeOff'` possible) |
| `conceded` | `player` |
| `roundWon` | `round, winner, reason` |
| `matchWon` | `winner, roundWins` |

Typical engagement sequence: `engageDeclared` → (`engagementStarted` once the defender commits)
→ `diceRolled` → `rerollPassed`/`rerolled`… → `resolved` → [`advantageGained`] → (stale:
`pressed` → `diceRolled`… or `brokeOff`) → `casualties`… → [`fortifyEnded`, `towerCount`] →
[`retreated`] → `engagementEnded` → [`roundWon` → `roundStarted` | `matchWon`] →
[`turnEnded` (`auto`) → `turnStarted`, when the Engage used the last CP].

---

## 5. Query helpers

All of these accept `MatchState | PlayerView` and never mutate. The ones marked "legal now"
check through `validateAction`, so they account for whose turn it is, CP, the 3-CP caps, the
Mountain lock and engagement state.

| Function | Returns |
|---|---|
| `moveOptions(s, player, cardIds, from)` | `{ to, path, charge }[]`, legal now, including Cavalry 2-hex paths |
| `moveDestinations(s, player, cardIds, from)` | distinct destination hexes, legal now |
| `withdrawOptions(s, player, cardIds, from)` | `(HexKey \| 'reserve')[]`, legal now |
| `engageableTargets(s, player)` | enemy hexes you can Engage now |
| `eligibleAttackers(s, player, target)` | `{ cardId, hex, ranged }[]`. Position only: adjacent cards, plus Archers at distance 2 with LOS |
| `eligibleDefenders(s, target)` | `{ cardIds, max }` |
| `previewModifiers(s, { player, target, attackerCardIds, defenderCardIds? })` | `EngagementModifiers` for a proposed commitment. Includes charge (from `turn.charge`) and stale Advantage for the live engagement |
| `labelModifiers(m)` | the same, with `{ source, label }` entries |
| `activationProbability(s, cardIds, { witNumber?, advantage? })` | exact P(side activates) over the 36 rolls, ignoring rerolls |
| `engagementOdds(s, { player, target, attackerCardIds, defenderCardIds, attackerWit?, defenderWit?, modifiers? })` | `{ attackerActivates, defenderActivates, attackerWins, defenderWins, bloodbath, stale }` for one roll |
| `currentEngagementOdds(s)` | the same for the live engagement (after defenders commit), else `null` |
| `spawnHexes(s, player)` | hexes where Wit could be placed (geometry and occupancy only) |
| `legalSpawnHexes(s, player)` | Spawn Wit hexes legal now (empty if Wit is not in Reserve) |
| `fortifyInfo(s, player, hex)` | `{ legal, cost, reason }` |
| `fortifiableHexes(s, player)` | hexes you can Fortify now |
| `fortifyCost(s, hex)` | 1 if the stack holds Heavy Infantry, else 2 |
| `hasSupply(s, player, hex)`, `suppliedHexes(s, player)` | supply line per §10.2 |
| `reinforceTargets(s, player)` | your Fortified hexes with supply (position only; does not check CP) |
| `reserveDeployable(s, player)` | Reserve cards that can be Deployed or Reinforced (not Wit, not Commanders) |
| `deployInfo(s, player)` | `{ legal, reason, hex, cards, max }` (`max` is 1, or 0 with nothing deployable) |
| `retreatHexes(s)` | legal Combat Retreat hexes for the live engagement |
| `rerollOptions(s, player)` | usable reroll options in the open window |
| `casualtyPool(s, engagement, side, result)` | eligible casualties for a side (§12.1, ranged Archer immunity) |
| `lineOfSight(s, from, target)`, `attackMode(s, cardId, target)` | `'adjacent' \| 'ranged' \| null` |
| `computeModifiers(s, input)`, `sideActivation(...)`, `resolveDice(...)`, `ALL_ROLLS` | the combat math the engine itself uses |
| `locate(s, id)`, `hexOf`, `cardHex`, `stackAt`, `stackOwner`, `hexesOf`, `isFortified`, `commandersOf`, `enterable`, `defenderMax` | lookups |

---

## 6. Testing helpers (`testing`)

```ts
import { testing, pendingDecision } from '@towers/engine';
const { buildState, card, cards, forceDice, mustApply, mustReject, applyAll, eventsOf, completeSetup } = testing;
```

- `card(ref)` resolves a short reference to a card id. Accepted forms:
  - a full id: `'red-light-7'`
  - `'<player>:<code>'` where the code is `L7` / `light7`, `H4` / `heavy4`, `A1` `A2` /
    `archer1`, `V1` `V2` / `cavalry1` (Cavalry), `K1` `K2` / `commander1`, `S1` `S2` / `shard1`,
    `W` / `wit`, or a character name (`'black:venli'`)

  `cards(...refs)` maps a list.
- `buildState(spec)` builds a **play-phase** `MatchState`. Every field is optional:
  - `board: Record<HexKey, ref[]>`: one player per hex
  - `terrain`: overrides. The default is Towers on their hexes and **Plains everywhere else**
  - `destroyed: ref[]`; `unlisted: 'reserve' | 'destroyed'` (default `'reserve'`). Commanders
    left off the board go to Reserve, where they are inert, so Decapitation is never triggered
    by accident
  - `current` (default `'red'`), `cp` (default 4), `spent`, `turnNumber`
  - `fortified: HexKey[]` (the owner is whoever holds the hex), `moved`, `mountainLocked`, `charge` (refs)
  - `round`, `roundWins`, `towerCount`, `round1Starter`
  - `dice: number[]`: the forced dice queue
  - `seed`

  It throws on an inconsistent spec, such as a hex that mixes owners or a card listed twice.
- `forceDice(state, ...values)` returns a copy with values appended to the forced-dice queue.
  The engine consumes the queue before the RNG. Each roll takes 2 values and each reroll takes 1.
- `mustApply(state, action)` returns `{ state, events }`, or throws with the engine's error.
  `applyAll(state, actions)` does the same for a list. `mustReject(state, action)` returns the
  error message, or throws if the action was accepted.
- `eventsOf(events, type)` filters events by type, with typing.
- `completeSetup(state, plan?)` plays the current round's setup to the end and returns
  `{ state, events }` (play phase). `plan` is `{ red?: [ref, hex][], black?: [ref, hex][] }`;
  on each setup turn the acting player uses their first planned entry that is legal for the
  current step. Otherwise Commanders go on the Tower and troops are filled with the least useful
  eligible cards (Light Infantry 2, 3, 4, 10, 5, 9, then Heavy Infantry likewise) on
  `HOME_EDGE[p][0]` (red `-2,2`, black `0,-2`).

Example (worked example 4):

```ts
const s = buildState({
  board: { '0,1': ['red:K1', 'red:L8'], '0,0': ['black:L2', 'black:L3'] },
  dice: [2, 5, 3],              // initial roll 2+5, then the reroll gives 3
});
let r = applyAll(s, [
  { type: 'engage', player: 'red', target: '0,0', cardIds: cards('red:K1', 'red:L8') },
  { type: 'defend', player: 'black', cardIds: [card('black:L2')] },
]);
// Black had no reroll and auto-passed; Red is asked.
pendingDecision(r.state);       // { kind: 'reroll', player: 'red', dice: [2, 5], options: [{ source: 'commander', ... }] }
r = mustApply(r.state, { type: 'reroll', player: 'red', source: 'commander', die: 0 });
eventsOf(r.events, 'resolved')[0].outcome;   // 'attacker' (3 + 5 = 8)
```

Remember that a committed Commander opens a reroll window for its owner. A test has to answer
it with `passReroll`/`reroll` before the engagement resolves.

### Simulation

`npm run sim -- --games 100 [--red easy|medium|hard|random] [--black easy|medium|hard|random] [--seed s] [--max-turns 400] [--workers N] [--swap] [--verbose]`
plays bot-vs-bot matches (medium vs medium by default; `smart` = `medium`) through `viewFor` and checks invariants after every action: card
conservation, no shared hexes, CP within bounds, caps respected, Fortified hexes held by their
owner, setup board = setup placements on home edges (at most 6 troops, no Wit), someone always
able to act, the bot always able to answer. It reports wins by seat and by level
(`wins by level: <level> <wins>/<seats>`) and decision-time stats (mean, p50, p99, max) per level. `simulate(seed)` and
`checkInvariants(state)` are exported from `scripts/sim.ts`.

---

## 7. Interpretation notes

These are points RULINGS leaves implicit. Each is implemented as written here and covered by tests.

1. **Cavalry and Mountain Disadvantage.** The attacker is Disadvantaged if it commits Cavalry
   and either a committed Cavalry stands on a Mountain or the target is a Mountain. The defender
   is Disadvantaged if it commits Cavalry and the target is a Mountain. Attacking into a
   Mountain without Cavalry gives no Disadvantage. The defender still gets `mountainDefence`
   Advantage.
2. **Archer high ground** counts any committed attacking Archer, adjacent or ranged, standing on
   a Mountain while the target is not a Mountain.
3. **Advantage and Disadvantage do not stack.** Several sources still mean one extra activation
   on 11/12. Every source is listed for display.
4. **Stale Advantage** is added at exactly the third stale roll, and only if the defender has no
   Advantage at that moment. It then shows as source `stale`.
5. **Modifiers are computed when the defender commits.** Cards cannot move during an
   engagement, so they stay fixed except for the stale rule. **Charge** is decided at the
   Engage: one of the Cavalry from the immediately previous 2-hex Move must be committed.
   Every other successful action by the turn player clears `turn.charge`: Move (a new 2-hex
   move sets a new charge), Withdraw, Deploy, Fortify, Reinforce, Spawn Wit and End turn.
6. **"Currently activates"** for the Disadvantage reroll means the Disadvantaged side's
   activation count is at least 1 on the current dice, including its own Advantage 11/12
   bonus. It is re-evaluated after every reroll, so an option can appear or disappear
   mid-window.
7. **Reroll window.** A player holding any usable option is asked, even if the reroll looks
   pointless. Only players with no options auto-pass. A reroll resets the consecutive-pass
   count.
8. **Fortify "moved or arrived this turn"** is tracked per card for the whole turn. A card that
   moved out and back still blocks. Deploy, Spawn, Reinforce and Withdraw also mark cards.
9. **Mountain lock** also covers Reinforce into a Mountain hex. A Combat Retreat is impossible
   if any card in the defending stack is locked, because the stack cannot split. Withdrawing
   into a Mountain is allowed and locks the cards.
10. **Cavalry 2-hex move**: the origin terrain does not matter, both path hexes must be Plains,
    and the second hex may not be the origin.
11. **Casualty order and timing.** The pick steps run in order and every card is destroyed only
    after the last pick, so Decapitation is checked once on the final result. In a win with
    Shardstrike (and no Advantage-vs-Disadvantage), the winner picks 1 first and the loser then
    picks the rest from what remains. If those casualties take every eligible card, there is no
    choice to make: they resolve automatically as one step (`chosenBy` the winner, `auto: true`)
    and nobody is asked. In a Bloodbath the defender's casualty is decided first,
    then the attacker's.
12. **Decapitation** means both of a player's Commanders are in their `destroyed` pile this
    round. The round ends before any Combat Retreat. If both players lose their last Commander
    together, the attacker wins.
13. **Concede** is allowed for either player in `setup` and `play`, including mid-engagement
    (the engagement is discarded). Setup placements already made that round are discarded.
14. **Setup.** All available cards, Commanders included, start the round in `reserve`; each
    `setupPlace` moves one card onto the board immediately (setup is open). The setup order is
    derived from the placements so far (`nextSetupPlacer`): starter's Commanders, other player's
    Commanders, then troops alternating from the starter, with a player who has placed 6 troops
    or has no eligible card left skipped. Setup ends inside the action that makes the last
    placement (`setupComplete`, then the starter's `turnStarted`). During play, Commanders are
    never in Reserve. Deploy and Reinforce also reject Commanders explicitly, which matters only
    for hand-built test states.
15. **Ranged versus adjacent**: an Archer adjacent to the target is always an adjacent
    attacker. It counts for Flanking, Surrounded and `archerDefending`, and it can be a
    casualty.
16. **`witNumber`** sent without a committed Wit is rejected rather than ignored.
17. **Terrain** for each round comes from the match RNG when the round starts, so it depends on
    the seed and on how much randomness earlier rounds consumed. Round 1 terrain is fixed by
    the seed.
18. **Tower count** fires a `towerCount` event when it goes up at turn start, and fires one
    with `count: 0` when it resets, either immediately after the board changes or at a turn
    start.
19. **Turns end automatically at 0 CP** once no engagement is in progress (`turnEnded` with
    `auto: true`). Concede is still legal at 0 CP, but the owner asked for the turn to pass on
    without a click, so the engine treats End turn as the only real choice.
