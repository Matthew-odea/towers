# Towers — Architecture

Read alongside `docs/rules/RULINGS.md` (rules, source of truth) and `docs/DESIGN.md` (UX/visuals).

## Goals
- 2-player online game, joinable by private link from anywhere. Anyone can open the site and
  create a game; the game link (random id) is the only "access control".
- Usernames only (no passwords). Stats remembered per username.
- Play vs a bot (online, and offline in-browser).
- Hosted on AWS, **serverless, scale-to-zero**, costs cents/month when idle.
- The same server core also runs as a plain Node server (`npm run dev` / `npm start`) for local
  development and optional LAN play.

## Repo layout (npm workspaces, TypeScript everywhere, ESM)

```
package.json              workspaces: packages/*; scripts: dev, test, sim, build, deploy
tsconfig.base.json
packages/
  engine/                 @towers/engine — pure rules engine + bot. No I/O, no Node APIs.
    src/index.ts          public API (see below)
    src/...               internal modules (board, rules, engagement, bot, rng, view, ...)
    test/                 vitest unit tests (engine author)
    test/spec/            independent spec tests written from RULINGS.md
    scripts/sim.ts        bot-vs-bot simulation + invariant checks
  server/                 @towers/server
    src/core/             transport-agnostic room logic (protocol handling, stats, bot turns)
    src/local/            Node http + ws server; serves built client; in-memory games; JSON stats file
    src/aws/              Lambda handler for API Gateway WebSocket + DynamoDB stores
    test/
  client/                 @towers/client — React + Vite SPA
    public/art/           card art (characters/*.webp, infantry/*.svg), CREDITS in repo root
    src/app/              shell: routing, landing, lobby, stats, chat, connection management
    src/net/              transports: WebSocketTransport, LocalTransport (engine+bot in browser)
    src/game/             game screen: board, stacks, cards, engagement UI, animations
    src/styles/           tokens.css (design tokens) + global styles
infra/                    Terraform (AWS)
scripts/deploy.sh         build + terraform apply + upload + invalidate
docs/                     RULINGS, ARCHITECTURE, DESIGN, ENGINE (written by the engine author)
CREDITS.md                art credits/copyright (never shown on cards)
```

Packages point `main`/`types`/`exports` at `src/index.ts` — no build step for the engine;
Vite, tsx, vitest and esbuild all consume TS source directly.

## Board geometry (shared contract)

- Axial coordinates `(q, r)`, all hexes with `max(|q|, |r|, |q+r|) <= 2` (19 hexes).
- Hex key string: `"q,r"` (e.g. `"-1,2"`). Type `HexKey = string`.
- Pointy-top orientation; rows by `r` (r = -2 top … r = 2 bottom): 3, 4, 5, 4, 3 hexes.
- **Red home edge** = row `r = 2`: `-2,2`, `-1,2`, `0,2`. **Red Tower = `-1,2`**.
- **Black home edge** = row `r = -2`: `0,-2`, `1,-2`, `2,-2`. **Black Tower = `1,-2`**.
- Point symmetry: `(q, r) ↔ (-q, -r)`.
- Distance: `(|dq| + |dr| + |dq + dr|) / 2`. Neighbour directions:
  `(+1,0) (+1,-1) (0,-1) (-1,0) (-1,+1) (0,+1)`.
- The client renders each player's own home edge at the bottom (Black's view is rotated 180°).

## Card ids
`<owner>-<kind>-<rank|character>`, e.g. `red-light-7`, `black-heavy-10`,
`red-commander-dalinar`, `black-shardbearer-szeth`, `red-wit-hoid`.
Kinds: `light | heavy | archer | cavalry | commander | shardbearer | wit`.
Character ids per faction are listed in `docs/DESIGN.md`.

## Engine public API (contract — other packages rely on these names)

```ts
export type PlayerId = 'red' | 'black';
export type CardKind = 'light' | 'heavy' | 'archer' | 'cavalry' | 'commander' | 'shardbearer' | 'wit';
export type Terrain = 'plains' | 'forest' | 'mountain' | 'tower';
export type HexKey = string;

export interface Card { id: string; owner: PlayerId; kind: CardKind; rank?: number; character?: string }

export interface MatchState { /* engine-defined; JSON-serialisable; includes rng state */ }
export type PlayerView = /* MatchState minus seed/rng/forced dice; nothing else is hidden (setup is open) */;

export type Action =
  | { type: 'setupPlace'; player: PlayerId; placements: { cardId: string; hex: HexKey }[] }   // exactly one placement per setup turn
  | { type: 'move'; player: PlayerId; cardIds: string[]; from: HexKey; path: HexKey[] }      // path length 1, or 2 for a Cavalry Plains move
  | { type: 'withdraw'; player: PlayerId; cardIds: string[]; from: HexKey; to: HexKey | 'reserve' }
  | { type: 'deploy'; player: PlayerId; cardIds: string[] }                                  // exactly one card id
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
  | { type: 'retreat'; player: PlayerId; to: HexKey | null }        // null = stay
  | { type: 'endTurn'; player: PlayerId }
  | { type: 'concede'; player: PlayerId };

export function createMatch(opts: { seed: string; names?: Partial<Record<PlayerId, string>>; firstPlayer?: PlayerId }): MatchState;
export function applyAction(state: MatchState, action: Action):
  | { ok: true; state: MatchState; events: GameEvent[] }
  | { ok: false; error: string };            // never throws on bad input; never mutates `state`
export function viewFor(state: MatchState, player: PlayerId): PlayerView;
export function pendingDecision(state: MatchState | PlayerView): PendingDecision;  // who must act, and what kind of decision
export type BotLevel = 'easy' | 'medium' | 'hard' | 'random';                          // 'smart' accepted as an alias of 'medium'
export function chooseBotAction(state: MatchState | PlayerView, player: PlayerId,
  opts?: { level?: BotLevel; rand?: () => number }): Action | null;                     // default 'medium'; null when the bot has nothing to decide
// Query helpers used by UI and bot (all accept MatchState | PlayerView):
//   legal move destinations for a card selection, engageable targets, eligible attackers for a target,
//   eligible defenders, legal retreat hexes, spawn hexes, fortify cost/legality, supply check,
//   advantage/disadvantage preview for a proposed engagement, activation probability preview.
```

- `GameEvent` is a discriminated union describing what happened (moves, dice rolled, rerolls,
  activations, outcome, casualties, retreats, fortify, deploy, tower count, round/match won,
  etc.) — the client animates from these and builds the move log.
- `PendingDecision` tells each client exactly what (if anything) it must do now: `setup`
  (`{ player, step: 'commander' | 'troop', eligible, hexes, placed, commandersLeft, troopsLeft }`:
  one player places one card per setup turn; open setup, RULINGS §4), `turn` (free actions), `defend`, `reroll` (with the usable reroll options), `pressOrBreak`,
  `casualties` (chooser, count, eligible card ids, whose cards), `retreat` (legal hexes),
  `matchOver`. Decisions with exactly one legal choice are auto-resolved by the engine so
  humans are never asked a question with one answer.
- Setup is open and turn-based: the round starter places both Commanders, then the other
  player; then troops alternate from the starter, one card per action, until each has placed 6
  (a player out of eligible cards is skipped). Each placement emits `setupPlaced`; the last one
  emits `setupComplete` and the starter's `turnStarted`.
- Bot levels: `easy` (`src/bot/easy.ts`), `medium` (`src/bot/smart.ts`, the heuristic search
  bot), `hard` (`src/bot/hard/`), `random` (`src/bot/random.ts`), dispatched in
  `src/bot/index.ts`. `easy`/`hard` currently delegate to `medium`.
- There is no round-over decision: when a round is won the engine goes straight into the next
  round's `setup` (or `matchOver`). Clients show the result from the `roundWon` event and the
  `roundResults` history in the state.
- A turn ends by itself once the turn player has 0 CP and no engagement is in progress
  (`turnEnded` with `auto: true`); clients never need to send `endTurn` at 0 CP.
- The engine author documents the final API in `docs/ENGINE.md`.

## Wire protocol (JSON over WebSocket)

Client → server:
```
{ t: 'hello', username }                                   -> { t: 'welcome', username }
{ t: 'create', vsBot: boolean, botLevel?: 'easy'|'medium'|'hard' } -> { t: 'joined', gameId, seat, seatToken }
{ t: 'join', gameId, seatToken? }                          -> { t: 'joined', gameId, seat, seatToken } | error 'full' | 'not_found'
{ t: 'action', gameId, seatToken, action, expectedVersion }-> broadcast 'state' | error
{ t: 'chat', gameId, seatToken, text }                     -> broadcast 'chat'
{ t: 'stats', username }                                   -> { t: 'stats', username, stats: PlayerStats }
{ t: 'rematch', gameId, seatToken }                        -> { t: 'joined', gameId: <new>, seat, seatToken } | error 'not_over'
{ t: 'ping' }                                              -> { t: 'pong' }
```
Server → client:
```
{ t: 'state', gameId, view: PlayerView, events: GameEvent[], version }
{ t: 'chat', gameId, from: PlayerId, name, text, ts }       // from = seat, name = display name
{ t: 'presence', gameId, players: { red: { name, connected, bot, botLevel? }, black: { ... } } }  // botLevel only on the bot seat
{ t: 'rematch', gameId, next, by }                         // the finished game's follow-up game
{ t: 'error', code, message }
```
- The protocol types live in `packages/server/src/core/protocol.ts` (`@towers/server/protocol`);
  the client imports them with `import type`.
- **Bot difficulty.** `botLevel` is optional and only meaningful with `vsBot: true`; the default is
  `'medium'`, and any other value is rejected with `bad_message`. The server stores it on the game
  record (`GameRecord.botLevel`), passes it to `chooseBotAction(state, seat, { level })` for every bot
  step, reports it in `presence` for the bot seat (`{ bot: true, botLevel }`), and carries it into
  rematches. The bot seat's display name is `Bot (Easy)`, `Bot (Medium)` or `Bot (Hard)`, and stats
  record opponents under that name (key `bot (hard)` etc.), so each level has its own record.
  Humans may not take any of those names (or `Bot`). Types: `BotDifficulty`, `parseBotLevel`,
  `botOpponentName` in `protocol.ts`.
- **Setup and Deploy are turn-based.** `pendingDecision` for setup names exactly one player; each
  `setupPlace` action carries exactly one placement and is public at once (no hidden state; the view
  only strips seed/RNG). After a human action the server keeps applying bot actions, including bot
  setup placements, until the human has a decision or the game ends. Deploy moves one card.
- **Bot deadline.** A bot run is bounded by a wall-clock budget (20 s, or Lambda time left minus 5 s)
  and stops `BOT_STEP_MARGIN_MS` (500 ms) early, so one slow Hard decision (up to ~400 ms) cannot
  push the invocation past the 29 s API Gateway / Lambda limit. The state reached so far is
  broadcast and the bot stays to move; the client sends `continue` (or rejoins) and the next
  invocation resumes the run.
- `hello` is required before `create` and before a first `join`; a `join` that reclaims a seat
  with a valid `seatToken` works without it.
- **Waiting lobby.** A human-vs-human match is created only when the second player joins (the
  engine needs both names), so the creator receives `joined` and `presence` but **no `state`**
  until then. Presence reports an empty seat as `{ name: null, connected: false, bot: false }`;
  the client shows the invite link while the opponent seat is empty. Bot games start at once.
- Presence is broadcast on create, join and disconnect. The bot seat is always connected with
  `bot: true`. A second tab that reclaims a seat does not kick the first; both get updates.
- Chat history (last 50) is replayed to every joining or reconnecting connection; clients
  de-duplicate lines they already have.
- **Rematch.** After `matchOver`, the first player to send `rematch` creates the follow-up game
  (same mode, new random seats) and the finished game records its id; the server tells the
  finished game's other connections with `{ t: 'rematch', next }`, and the other player's
  `rematch` joins that same game. Clients open a new connection (and a fresh game screen) for it.
- Error codes: `bad_json`, `too_large`, `bad_message`, `unknown_type`, `need_hello`,
  `bad_username`, `not_found`, `full`, `bad_seat`, `not_started`, `stale`, `illegal`,
  `bad_chat`, `not_over`, `busy`, `internal`.
- Creator's seat is random. Second joiner takes the other seat. A `seatToken` (random, stored
  in the browser's localStorage per game) lets a player reconnect to their seat. A third
  person gets `full`.
- Bot games: after every human action, the server runs `chooseBotAction` for the bot seat in
  a loop until a human decision is pending, broadcasting each step (events let the client
  animate the bot's turn at a readable pace).
- Version: every applied action increments `version`; stale `expectedVersion` → error
  `stale` and the server re-sends current state.
- Clients auto-reconnect (API Gateway drops idle sockets after 10 min, hard cap 2 h) and
  re-`join` with their seatToken.
- Game link format: `<site>/#/g/<gameId>`. Client reads `/config.json` → `{ wsUrl }` at
  startup (local server serves it too).

## Server core
- `GameService` with injected stores: `GameStore` (get/put with optimistic version check),
  `ConnectionStore` (connection ↔ game/seat), `StatsStore`, and a `Broadcaster`
  (send to connection ids). Local and AWS adapters implement these.
- Stats per username (case-insensitive key, display name as typed): matches played/won,
  rounds won/lost, per-opponent record (bot recorded as opponent "Bot"), per-character
  commit counts. Recorded when a match ends.
- Chat: last 50 messages kept with the game, max 300 chars, plain text.
- Games expire after 14 days (DynamoDB TTL).

## AWS (Terraform in `infra/`, region us-east-1, default AWS profile, local state)
- S3 bucket (private) + CloudFront (OAC), default root `index.html`, price class 100,
  response headers policy adding `X-Robots-Tag: noindex, nofollow`. `robots.txt` disallows all.
  Use the default `*.cloudfront.net` domain (no custom domain).
- API Gateway v2 **WebSocket** API: routes `$connect`, `$disconnect`, `$default` → one Lambda.
  Stage throttling (rate 20, burst 50) to bound cost.
- Lambda: Node.js 22, arm64, 512 MB, bundled with esbuild from `packages/server/src/aws/handler.ts`.
- DynamoDB: one on-demand table (pk/sk single-table design: game state, connections, stats),
  TTL attribute `expiresAt`.
- CloudWatch log retention 7 days.
- `scripts/deploy.sh`: bundle Lambda → `terraform apply` → build client → write `config.json`
  with the WebSocket URL → `aws s3 sync` → CloudFront invalidation → print the site URL.

## Testing
- `npm test` runs vitest in all packages.
- Engine: unit tests + independent spec tests (`test/spec`) covering every section and worked
  example of RULINGS.md.
- `npm run sim -- --games N [--red L] [--black L]` (L = easy|medium|hard|random): bot-vs-bot games, per-level win rates and decision times, with invariant checks after every action (card
  conservation, no shared hexes, CP within bounds, caps respected, pending decision always
  actionable, every match terminates under a turn cap in simulation only).
- Server: protocol tests with real ws clients against the local server, incl. a full bot game.
- E2E: Playwright (chromium, 1 worker; `playwright.config.ts` at the root, specs in `e2e/`).
  The config starts its own local server on :8790 and Vite on :5190 so it never clashes with
  `npm run dev`. Run one spec per command: `npm run e2e -- e2e/pvp.spec.ts` (two contexts:
  lobby, join, setup, a full engagement through every decision, chat, reload keeps the seat,
  rematch and stats), `e2e/bot.spec.ts` (online bot game, three full turns; stats page) and
  `e2e/offline.spec.ts` (server unreachable: Play the bot falls back to `#/offline`).
  Screenshots go to `test-results/screens/`.
- **Test mode** (local server only, never the Lambda): `TOWERS_TEST=1` makes every match use a
  fixed seed (`TOWERS_TEST_SEED`, default `e2e`), gives the creator a fixed seat
  (`TOWERS_TEST_SEAT`, default red), fixes the round-1 first player (`TOWERS_TEST_FIRST`) and
  queues opening dice (`TOWERS_TEST_DICE`, e.g. `1,2,1,3,4`). Stats then go to
  `.data/stats.e2e.json`.

## Dev
- `npm run dev`: local server on :8787 (HTTP + WS at `/ws`) + Vite on :5173 (proxying `/ws`
  and `/config.json` to :8787, keeping the Vite host so the socket goes through the proxy).
  Ports: `TOWERS_SERVER_PORT` (or `PORT`) for the server, `TOWERS_CLIENT_PORT` for Vite.
- `packages/client/dev.html` (dev server only, not in the build) renders the game screen
  against an in-browser engine with scenarios, e.g. `/dev.html?seat=black&scenario=reroll`.
- `npm start`: build client, serve everything from :8787 (LAN: share `http://<lan-ip>:8787`).
