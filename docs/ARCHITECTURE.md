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
export type PlayerView = /* MatchState minus rng, with opponent's unrevealed setup redacted */;

export type Action =
  | { type: 'setupPlace'; player: PlayerId; placements: { cardId: string; hex: HexKey }[] }
  | { type: 'move'; player: PlayerId; cardIds: string[]; from: HexKey; path: HexKey[] }      // path length 1, or 2 for a Cavalry Plains move
  | { type: 'withdraw'; player: PlayerId; cardIds: string[]; from: HexKey; to: HexKey | 'reserve' }
  | { type: 'deploy'; player: PlayerId; cardIds: string[] }
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
export function chooseBotAction(state: MatchState, player: PlayerId): Action | null; // null when the bot has nothing to decide
// Query helpers used by UI and bot (all accept MatchState | PlayerView):
//   legal move destinations for a card selection, engageable targets, eligible attackers for a target,
//   eligible defenders, legal retreat hexes, spawn hexes, fortify cost/legality, supply check,
//   advantage/disadvantage preview for a proposed engagement, activation probability preview.
```

- `GameEvent` is a discriminated union describing what happened (moves, dice rolled, rerolls,
  activations, outcome, casualties, retreats, fortify, deploy, tower count, round/match won,
  etc.) — the client animates from these and builds the move log.
- `PendingDecision` tells each client exactly what (if anything) it must do now: `setup`,
  `turn` (free actions), `defend`, `reroll` (with the usable reroll options), `pressOrBreak`,
  `casualties` (chooser, count, eligible card ids, whose cards), `retreat` (legal hexes),
  `roundOver`, `matchOver`. Decisions with exactly one legal choice are auto-resolved by the
  engine so humans are never asked a question with one answer.
- The engine author documents the final API in `docs/ENGINE.md`.

## Wire protocol (JSON over WebSocket)

Client → server:
```
{ t: 'hello', username }                                   -> { t: 'welcome', username }
{ t: 'create', vsBot: boolean }                            -> { t: 'joined', gameId, seat, seatToken }
{ t: 'join', gameId, seatToken? }                          -> { t: 'joined', gameId, seat, seatToken } | error 'full' | 'not_found'
{ t: 'action', gameId, seatToken, action, expectedVersion }-> broadcast 'state' | error
{ t: 'chat', gameId, seatToken, text }                     -> broadcast 'chat'
{ t: 'stats', username }                                   -> { t: 'stats', stats }
{ t: 'ping' }                                              -> { t: 'pong' }
```
Server → client:
```
{ t: 'state', gameId, view: PlayerView, events: GameEvent[], version }
{ t: 'chat', gameId, from, text, ts }
{ t: 'presence', gameId, players: { red: { name, connected, bot }, black: { ... } } }
{ t: 'error', code, message }
```
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
- `npm run sim -- --games N`: bot-vs-bot games with invariant checks after every action (card
  conservation, no shared hexes, CP within bounds, caps respected, pending decision always
  actionable, every match terminates under a turn cap in simulation only).
- Server: protocol tests with real ws clients against the local server, incl. a full bot game.
- E2E: Playwright (chromium) against `npm run dev`: two browser contexts create/join and play
  through setup into an engagement; a vs-bot game; screenshots saved to `test-results/`.

## Dev
- `npm run dev`: local server on :8787 (HTTP + WS at `/ws`) + Vite on :5173 (proxying `/ws`
  and `/config.json` to :8787).
- `npm start`: build client, serve everything from :8787 (LAN: share `http://<lan-ip>:8787`).
