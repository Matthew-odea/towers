# Towers — Definitive Rules (implementation spec)

This file is the source of truth for the game engine. It consolidates `Towers_Rules_v1.3.md`
with the owner's clarifications (2026-10-04). Where this file and the v1.3 draft disagree,
**this file wins**. Items marked *(ruling)* are decisions made where the draft was silent.

The draft's multiplayer section does not apply — Towers is strictly 2 players.

---

## 1. Match structure

- Two players, **Red** and **Black** (ids `red` / `black`). Colours are just seats.
- **Best of 3 rounds**: first player to win 2 rounds wins the match.
- Cards destroyed in a round stay destroyed for the rest of the match, **except Commanders**,
  which always come back at full count (2) every round.
- Every card that was not destroyed (on the board, in Reserve, or withdrawn) is available again
  next round.
- **All information is public**: every stack, both Reserves and both destroyed piles are
  visible to both players. There is no hidden information (setup is open, §4).
- Dice are 2d6 rolled by the server with a cryptographically seeded RNG.

## 2. Armies

Each player has the same 27-card army. There are no suits.

| Card | Count | Activates when (see §8) | Notes |
|---|---|---|---|
| Light Infantry 2–10 | 9 (one of each rank) | 2d6 total = rank | |
| Heavy Infantry 2–10 | 9 (one of each rank) | 2d6 total = rank | Lets its stack Fortify for 1 CP |
| Archer | 2 | either die shows a 1 | Ranged support (§7.2), terrain rules |
| Cavalry | 2 | either die shows a 6 | 2-hex Plains move, charge |
| Commander | 2 | **never** activates | Each committed Commander = 1 reroll |
| Shardbearer | 2 | any doubles, or total 7 | Shardstrike on doubles |
| Wit | 1 | total = the number its owner declared (2–12) | Spawns almost anywhere for 1 CP |

Rank on infantry is **not strength** — it is the 2d6 total that activates it, so 6/7/8 are the
most reliable and 2/12-ish ranks rarely fire but still screen and absorb casualties.

The card types are always named **Light Infantry, Heavy Infantry, Archer, Cavalry, Commander,
Shardbearer, Wit**. Never King/Queen/Jack/Ace/Joker anywhere in code-facing UI text.

Characters (flavour only; all cards of a type are mechanically identical) — see `docs/DESIGN.md`.

## 3. Board

- 19-hex Catan-shaped board (hex radius 2). Players sit on opposite sides.
- **Home edge**: the 3 hexes of the outer row nearest a player.
- **Tower**: always the **middle** hex of each home edge. Tower is its own terrain type.
- Terrain types: **Plains, Forest, Mountain, Tower**.
- **Terrain is re-randomised at the start of every round**, and is always **point-symmetric**
  (180° rotation maps the board onto itself) so neither player gets a better map:
  - the 4 non-Tower home-edge hexes are always Plains;
  - the centre hex is uniformly random among Plains / Forest / Mountain;
  - the remaining 12 hexes form 6 symmetric pairs: 2 pairs Forest, 1 pair Mountain,
    3 pairs Plains, shuffled.

### Terrain effects

| Terrain | Movement | Combat |
|---|---|---|
| Plains | normal | Cavalry-only groups may move 2 Plains hexes in one Move (§6.2) |
| Forest | normal; ends Cavalry's extra Plains movement | can block Archer line of sight (§7.3) |
| Mountain | entering ends movement; cards that entered a Mountain this turn cannot leave it this turn | see §9 (Cavalry Disadvantage, Mountain defence Advantage, Archer high ground) |
| Tower | normal | no special effect; any hex (Tower included) can be Fortified |

## 4. Round setup

Setup is **open and turn-based** (owner change, 2026-10-04). Every placement is visible as it
happens; nothing is hidden.

1. Generate this round's terrain (§3).
2. **First player**: random in Round 1; afterwards it alternates (Round 2 is started by the
   player who did not start Round 1; Round 3 by the Round 1 starter). The round's first player
   also places first during setup *(ruling)*.
3. **Commanders**: the first player places both Commanders, one at a time, anywhere on their
   home edge (back rank); then the second player does the same.
4. **Troops**: players then alternate, starting with the first player, each placing **exactly
   one** card per setup turn onto one of their own home-edge hexes, until **each player has
   placed 6** (12 setup turns). Any available non-destroyed card except Commanders and Wit may be
   placed; stacking is allowed. A player who has run out of eligible cards skips their remaining
   setup turns *(ruling)*.
5. Everything not placed starts in **Reserve**. Wit always starts a round in Reserve.
6. When setup ends, the first player takes the first turn of play.

## 5. Turns and Command Points (CP)

- At the start of your turn, in order: (a) Tower count check (§11.1); (b) you receive **4 CP**;
  (c) per-turn trackers reset. Unspent CP is lost when the turn ends.
- **Cap: at most 3 CP may be spent on any single action type per turn.**
- Actions (any order, any mix, e.g. Move, Engage, Move, Engage):

| Action | Cost | Effect |
|---|---|---|
| Move | 1 | Move all or part of one stack 1 adjacent hex (§6) |
| Engage | 1 | Start one engagement (§7) |
| Deploy | 1 | Put **1** Reserve card (not Wit) onto your Tower |
| Withdraw | 1 | Move all or part of a stack 1 hex toward your Tower, or from your Tower into Reserve (§6.4) |
| Fortify | 2, or 1 if the stack contains Heavy Infantry | §10 |
| Reinforce | 3 | Exactly 1 Reserve card (not Wit) to an eligible Fortified hex via a supply line (§10.3) |
| Spawn Wit | 1 | Place Wit from Reserve (§6.5) |
| End turn | 0 | |
| Concede round | 0 | Allowed at any time during the round (either player's turn, including setup) |

- **No undo.** Every action is final once submitted.
- A player with nothing useful to do simply ends their turn.

## 6. Movement

### 6.1 Stacks
- Any number of a player's cards may share a hex. Two players' cards never share a hex.
- A Move/Withdraw picks **any subset** of one player's cards in **one** hex and moves them
  together. The rest stay.
- You cannot enter a hex containing enemy cards — clear it by fighting first. Winning an
  engagement never auto-advances the attacker.
- The same cards may Move more than once per turn (paying each time), subject to the 3-CP cap
  and the Mountain lock.
- A mixed group uses the most restrictive rule: the Cavalry 2-hex move only applies if every
  moving card is Cavalry.

### 6.2 Cavalry 2-hex Plains move and charge
- If **every** card in the moving group is Cavalry, the group may, as the same Move, enter a
  Plains hex and then continue into one more adjacent Plains hex (both must be enterable —
  empty or friendly). Tower is not Plains.
- **Charge**: if your **very next action** after such a 2-hex Move is an Engage in which at
  least one of those Cavalry is committed as an attacker, the attacking side has **Advantage**
  for that engagement. Any other action in between (including another Move) cancels the charge.

### 6.3 Mountain lock
- Entering a Mountain ends that move. Any card that entered a Mountain hex during the current
  turn (by Move, Withdraw, Combat Retreat, Deploy, or Spawn) cannot leave that hex for the rest
  of the current turn. It can still fight.

### 6.4 Withdraw
- 1 CP: move all or part of a stack to an adjacent enterable hex that is **strictly closer**
  (hex distance) to your own Tower. Mountain lock applies. If no such hex exists you cannot
  Withdraw (except as below).
- If the stack is **on your Tower**, Withdraw may instead send the chosen cards off the board
  into **Reserve**. **Commanders can never be withdrawn to Reserve.** Wit may be.
- Withdraw and Move are different action types for the 3-CP cap.

### 6.5 Spawn Wit
- 1 CP. Wit must be in your Reserve. Place it on **any hex** that contains no enemy cards,
  **except** either Tower hex and any hex adjacent to either Tower.
- Wit is a normal card once on the board (moves, withdraws, occupies, links supply, captures
  Towers). If Wit returns to Reserve (Withdraw from your Tower), it can be Spawned again.
- Wit cannot be Deployed, Reinforced, or placed during setup.

## 7. Engagements

### 7.1 Declaring
1. **Engage (1 CP)**: choose a target hex containing enemy cards.
2. **Attacker commits 1–3 eligible cards** in the same action:
   - any of your cards in hexes **adjacent** to the target; and/or
   - any of your **Archers at distance exactly 2** from the target with line of sight (§7.3)
     — these are **ranged Archers**.
   - Committed cards may come from several hexes.
   - If Wit is committed, declare its number (2–12) now.
3. **Defender commits 1–3 cards from the target hex only** (1–4 if the target hex is
   Fortified). The defender must commit at least 1. Only cards actually in the attacked hex can
   defend — Archers elsewhere cannot support a defence. If Wit is committed, declare its number
   now (the defender sees the attacker's commitment and Wit number first).
4. Determine each side's Advantage / Disadvantage (§9). These are fixed for the engagement,
   except the stale-roll rule (§7.6).
5. Roll 2d6. Both sides read the **same** dice.
6. Reroll window (§8.3).
7. Resolve (§7.5).

The same cards can fight more than once per turn if still in position and you pay again.

### 7.2 Ranged Archers
- A ranged Archer is an attacking Archer committed from distance 2 (not adjacent).
- Ranged Archers do **not** count for Flanking / Surrounded hex counts and do not make the
  attack "adjacent" (§9).
- **Ranged Archers can only become casualties if the defender's activation included at least
  one activating defending Archer** (i.e. the defending stack shot back with Archers on a 1).
  Otherwise they are immune: if the attacker loses, the engagement simply ends for them, and in
  a Bloodbath they take no casualty while the defender still takes theirs.

### 7.3 Line of sight (range 2 only)
- Let M be the hexes adjacent to **both** the Archer's hex and the target (1 hex for a straight
  shot, 2 hexes for an off-axis shot).
- LOS is **blocked only if every hex in M is Forest**. Units, Mountains and Towers never block.
  The Archer's and target's own terrain never block.

### 7.4 Activation
- Each committed card activates per §2 against the current dice:
  - Light/Heavy Infantry: total = rank. Archer: either die = 1. Cavalry: either die = 6.
  - Shardbearer: doubles or total 7. Wit: total = declared number. Commander: never.
- **Advantage bonus**: a side with Advantage also activates if the total is 11 or 12. This counts
  as **one extra activation** for that side (added to any cards that activated).
- A side **activates** if its activation count ≥ 1.

### 7.5 Outcome
- **Neither activates** → stale roll (§7.6).
- **Exactly one side activates** → that side wins.
- **Both activate**: if exactly one side has Advantage, it wins. Otherwise (neither, or both
  *(ruling)*) → **Bloodbath**.

### 7.6 Stale rolls, Press and Break Off
- On a stale roll the stale counter increases. When it reaches **3**, the defender gains
  Advantage for the rest of this engagement (no effect if it already has Advantage).
- The attacker then chooses:
  - **Break Off** — the engagement ends, nothing else happens (the Engage CP is spent);
  - **Press** — roll again (back to §7.1 step 5) with the same committed cards and the same Wit
    numbers. Press costs **no CP**.
- Rerolls are per engagement and do **not** refresh when pressing.

## 8. Dice and rerolls

### 8.1 Commander reroll
- Each committed Commander gives its owner **one** reroll per engagement (2 Commanders = 2).
- Using it: the owner picks one die and rerolls it; the new value must be kept.

### 8.2 Disadvantage reroll
- If a side has Disadvantage, its **opponent** may, once per engagement, force a reroll of one
  die (the forcing player picks which die). It may only be used at a moment when the
  Disadvantaged side **currently activates**.

### 8.3 Reroll window
- After every roll (initial and each Press), a reroll window opens.
- **The defender acts first.** Players alternate; on your go you either use one available
  reroll (a Commander reroll, or your Disadvantage reroll if usable) or pass.
- The window closes when both players pass consecutively. A player with no usable reroll
  automatically passes.
- Maximum rerolls a side can hold in one engagement: 3 (two Commanders + forcing a reroll on a
  Disadvantaged opponent).
- After the window closes, the final dice decide activation (§7.4) and outcome (§7.5).

## 9. Advantage and Disadvantage

Both are **side-level**, do not stack, and can apply to the same side at once (they do
different things).

**Advantage** (effects: also activate on 11/12; wins when both sides activate; with opponent
Disadvantage the winner picks casualties):

| Source | Side |
|---|---|
| Target hex is Fortified | Defender |
| Cavalry charge (§6.2) | Attacker |
| A committed attacking Archer stands on a Mountain and the target hex is not a Mountain | Attacker |
| Target hex is a Mountain — **always**, even if attacking cards also stand on Mountains (owner clarification; overrides the v1.3 "from non-Mountain hexes" wording) | Defender |
| **Flanking**: the attacker's committed non-ranged cards occupy ≥2 hexes adjacent to the target, at least two of which are not adjacent to each other | Attacker |
| 3 stale rolls in this engagement | Defender |

**Disadvantage** (effect: the opponent gets the Disadvantage reroll, §8.2; and casualty choice
below):

| Source | Side |
|---|---|
| A committed Cavalry stands on a Mountain, or a committed attacking Cavalry attacks a Mountain target hex (only applies when that side committed Cavalry) | That side |
| Defender committed an Archer and the attacker has ≥1 committed card adjacent to the target | Defender |
| **Surrounded**: the attacker's committed non-ranged cards occupy ≥3 distinct hexes adjacent to the target | Defender |

(Surrounded always implies Flanking.) Shardbearers have **no** special interaction with
Disadvantage.

## 10. Fortify and supply

### 10.1 Fortify
- Cost 2 CP, or 1 CP if the hex's stack contains at least one Heavy Infantry.
- Allowed on any hex holding your cards that is not already Fortified, provided **no card
  currently in that hex moved or arrived there this turn** (Move, Withdraw, Deploy, Spawn,
  Reinforce all count as arriving).
- Fortified status belongs to the hex for its owner:
  - cards that later join the hex (Move, Deploy, Reinforce, Retreat) are part of the Fortified
    stack;
  - if some cards leave, the cards that remain stay Fortified;
  - it ends when no cards of that player remain in the hex, or when the stack Combat Retreats.
- A Fortified defender has Advantage and may commit up to 4 cards.

### 10.2 Supply line
- A supply line exists from your Tower to a hex if there is a chain of adjacent hexes from your
  Tower hex to that hex where **every hex in the chain, including your Tower and the target
  hex, contains at least one of your cards**. Leaving your Tower empty cuts all supply.

### 10.3 Reinforce
- 3 CP: move exactly 1 card from your Reserve (never Wit; Commanders are never in Reserve) onto
  one of your Fortified hexes that has a supply line.

### 10.4 Deploy
- 1 CP: move **exactly 1** Reserve card (not Wit) onto your own Tower (so at most 3 per turn,
  by the 3-CP cap). Not allowed while enemy cards
  occupy your Tower.

## 11. Winning a round

### 11.1 Tower victory
- At the start of each of your turns: if any of your cards occupy the **enemy Tower**, your
  Tower count goes up by 1; if it reaches **3**, you win the round immediately. If you do not
  occupy it, your count is 0.
- Your count also resets to 0 the moment the enemy Tower no longer holds any of your cards.
- The turn you take the Tower does not count; the first count is at the start of your next turn.

### 11.2 Decapitation
- Destroy both enemy Commanders during the round → you win the round immediately (checked
  after every casualty resolution).
- *(ruling)* If both players lose their last Commander in the same resolution, the attacker wins
  the round.

### 11.3 Concession
- A player may concede the round at any time. The opponent wins the round. The conceding
  player's surviving cards all survive.

### 11.4 After a round
- Winner gains a round win. At 2 wins the match ends.
- Otherwise: all non-destroyed cards return to their owner's available army; Commanders are
  restored; new terrain; new setup (§4) with the alternating first player.
- A player with no non-Commander cards left still plays with their two Commanders.

## 12. Casualties

### 12.1 Eligibility
- Casualties come **only from committed cards** of the side taking them, minus ranged Archers
  that are immune under §7.2. Uncommitted cards (including uncommitted Commanders) can never
  be casualties.
- If a side owes more casualties than it has eligible cards, it loses only the eligible ones
  (casualties are capped).

### 12.2 Count
- A winning side causes **1** casualty, or **2** if it has **Overwhelming Activation**
  (activation count ≥ 2, §7.4). Hard cap 2.
- **Bloodbath**: each side takes exactly 1 casualty (if it has an eligible card). Overwhelming
  does not apply.

### 12.3 Who chooses
- Normally the side taking casualties chooses which of its eligible cards die.
- If the winner has Advantage **and** the loser has Disadvantage, the winner chooses all
  casualties it causes.
- **Shardstrike**: a side whose committed Shardbearer activated on **doubles** (final dice) has
  Shardstrike. If that side wins, its player chooses 1 of the casualties it causes; any
  remaining casualty is chosen by the normal rule above. In a Bloodbath, a side with
  Shardstrike chooses the opponent's casualty (if both have it, each chooses the other's).
- Casualties only ever come from the eligible pool, so Shardstrike can never pick an
  uncommitted card or an immune ranged Archer.

### 12.4 After casualties
- Destroyed cards go to their owner's destroyed pile (Commanders return next round; all other
  cards, including Wit, are gone for the match).
- Check Decapitation (§11.2) and the Tower count reset (§11.1).
- **Combat Retreat** (only if the defender lost and still has cards in the target hex): the
  defender may move the **entire** remaining stack (committed or not) 1 hex, for free, to an
  adjacent hex that has no enemy cards and is **not adjacent to (or equal to) any hex
  containing an adjacent committed attacking card**. It cannot split. Mountain lock applies.
  Fortified status is lost (unless it joins a friendly Fortified hex, in which case it is part
  of that stack). Retreat is optional; if no legal hex exists the stack stays.
- The engagement ends.

## 13. Worked examples (all must hold in tests)

1. Attacker commits Light 4, Heavy 4, Shardbearer; roll 2+2. Both 4s and the Shardbearer
   activate (3 activations). Defender commits Light 8 (no activation). Attacker wins,
   Overwhelming → 2 casualties, Shardstrike → attacker chooses 1, defender chooses the other
   (if defender committed ≥2 cards; otherwise only 1 dies).
2. Both sides activate, neither has Advantage → Bloodbath, exactly 1 casualty each regardless of
   how many cards activated. If one side's Shardbearer activated on doubles, that side picks
   the opponent's casualty.
3. Attacker commits from 3 hexes adjacent to the defender → defender Surrounded
   (Disadvantage) and attacker Flanking (Advantage). If attacker wins, attacker chooses the
   casualties.
4. Commander + Light 8 committed, roll 2+5. Reroll window: if the defender passes, the attacker
   may use the Commander to reroll the 2; if it becomes 3, the total is 8 and the 8 activates.
5. Ranged Archer (distance 2, LOS clear) attacks a stack; roll 1+6. The Archer activates (a 1);
   the defender's committed Light 7 activates (total 7). Neither has Advantage → Bloodbath. The
   defender's activation contained no Archer, so the ranged Archer is immune: the defender loses
   1 card, the attacker loses nothing.
6. Defender commits only 1 card; attacker wins with 2 activations → only 1 casualty (capped).
7. Fortified defender (Advantage) commits 4 cards; both sides activate → defender wins.
8. Black holds Red's Tower. Start of Black's next turn → count 1, next → 2, next → 3 → Black wins
   the round. If Red clears the Tower in between, Black's count resets to 0.
