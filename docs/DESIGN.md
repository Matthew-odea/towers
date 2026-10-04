# Towers — Design brief

Desktop browser only (min 1280×720, design for 1440×900). Two friends playing over a link,
probably on a voice call.

## The owner's taste (hard requirements)
- **Visually interesting, minimal information.** One focal point per screen.
- **No AI-slop UI**: no taglines or subtitles under headings, no "Welcome to…" copy, no emoji,
  no badge/pill clutter, no gradient-everything, no glassmorphism cards-in-cards, no generic
  dashboard panels, no icons-with-labels repeating the obvious, no explanatory paragraphs.
- Text only where it helps a decision. Secondary information appears on hover/inspect.
- The game state is shown by the board itself — movement and fights are animated on the board,
  not narrated in pop-up text.
- Avoid stock fantasy defaults: no Cinzel, no Inter/Roboto. Pick a distinctive serif for
  numerals/titles and a clean humanist sans for small UI text (Google Fonts link is fine).

## World: Roshar
- Dark weathered stone and slate, parchment and engraved metal. Cool, storm-lit atmosphere.
- **Stormlight** (bright white with a faint cyan) is reserved for **interactivity**: whatever
  you can act on right now glows. Nothing else glows.
- Player colours are deep, never neon: **Red / Kholin & the Radiants** → deep sapphire-steel;
  **Black / Singers & Fused** → deep garnet/ember. (Seat ids stay `red`/`black` in code; the UI
  calls the sides by faction, e.g. "Kholin" / "Singers".)
- **CP** = 4 gemstone spheres beside your hand; spending one drains its light.
- Dice are two carved stone dice that tumble onto the board edge.

## Screens

### Landing
- One input (your name, remembered in localStorage) and three actions: **New game** (creates a
  game and shows the link to copy), **Play the bot**, and a small **Stats** link.
- The title "Towers" may appear once. Nothing else.

### Waiting for opponent
- The link, a copy button, the board terrain preview. That's it.

### Setup
- Your army laid out along the bottom; drag (or click-select then click hex) onto your 3
  home-edge hexes. Commanders must be placed; up to 6 others. A single confirm button that
  only lights (Stormlight) once the placement is legal. Opponent's side shows only "ready".

### Game screen
- **Board** centre and large (Catan-shaped hex island floating in a storm-dark field).
  Terrain is drawn, not labelled: plains (rockbud/grass on stone), forest, mountains, and a
  Tower structure on each Tower hex. Your home edge at the bottom.
- **Stacks** sit on hexes as small fanned cards (type glyph + rank visible). Count badge only
  when the fan is too dense. Fortified hexes get a visible rampart ring. Tower count shown as
  3 marks on the Tower being held.
- **Your Reserve** along the bottom as a fan of cards; **opponent's Reserve** as a thin row of
  card backs top edge (hover to inspect). Destroyed piles are inspectable on hover.
- **Turn flow**: click a stack → it fans out; click cards to select (default: whole stack) →
  legal destinations glow → click a hex to Move (Withdraw is offered automatically when the
  destination is closer to your Tower and Move is capped, or explicitly via a modifier/context
  option; Withdraw-to-Reserve is a drop target on your Reserve when the stack is on your Tower).
  Enemy hexes you can attack glow differently; clicking one enters engagement setup.
  Fortify / Deploy / Reinforce / Spawn Wit / End turn are compact controls near the CP spheres,
  shown only when legal.
- **Engagement**: the two committed groups slide toward the contested edge; eligible cards to
  commit glow; Wit asks for its number with a compact 2–12 dial. Show the side's Advantage /
  Disadvantage as a single small mark each (hover explains the source). Optional subtle
  activation-odds hint on hover only.
  Dice roll → activating cards flare → rerolls offered by making the dice themselves clickable
  (with a small source marker: Commander portrait or Disadvantage) → result plays out:
  destroyed cards shatter/fade, retreats slide. Press / Break Off as two buttons on the dice.
  Casualty choice: eligible cards glow, pick N, confirm.
- **Round over / match over**: one large line ("Kholin take the round") over the board, round
  pips, continue. Match over shows winner + a rematch button.
- **Log**: collapsed by default; a small toggle opens a narrow drawer with the event history.
- **Chat**: small toggle bottom-left; unread dot; Enter to send. No avatars.
- **Concede**: tucked in a small menu, with confirm.
- Whose turn it is: shown by the light on your CP spheres and a subtle board-edge glow on the
  active side, not by a banner.

### Stats
- A single quiet page: your record, per-opponent rows, most-committed characters as small
  portraits. No charts unless they earn their space.

## Cards
- Poker-ish ratio 5:7. Engraved metal frame, colour-keyed per faction.
- **Characters** (Commander, Shardbearer, Cavalry, Archer, Wit): full-bleed portrait, name on a
  small plate, type glyph in a corner. **No subtitles, no flavour text, no artist credit on the
  card** (credits live in `CREDITS.md`).
- **Light / Heavy Infantry**: generic illustrated art (SVG) — Light = spear formation in
  leathers, Heavy = shield wall in plate. Rank as a large numeral. Reliability shown as 1–6
  small spheres = the number of 2d6 combinations that roll that total (2→1, 3→2, … 7→6, … 10→3).
  Higher reliability = brighter infused spheres. That is the only "strength" indicator.
- Card back: a single Tower glyph on stone.
- Type glyphs (simple, custom SVG): Light (single spear), Heavy (shield), Archer (bow),
  Cavalry (horse head / Ryshadium), Commander (crown-sigil), Shardbearer (Shardblade), Wit
  (flute — Hoid's).

## Roster (flavour only)

| Type | Red — Kholin & the Radiants | Black — Singers & Fused |
|---|---|---|
| Commander | `dalinar` Dalinar, `jasnah` Jasnah | `raboniel` Raboniel, `eshonai` Eshonai |
| Shardbearer | `kaladin` Kaladin, `adolin` Adolin | `szeth` Szeth, `moash` Moash |
| Cavalry | `lift` Lift, `lopen` Lopen | `leshwi` Leshwi, `lezian` Lezian |
| Archer | `lunamor` Lunamor, `shallan` Shallan | `venli` Venli, `rlain` Rlain |
| Wit | `hoid` Hoid | `hoid` Hoid |

If a character has no usable art, swap in another fitting character (same faction and role) and
record the swap in `CREDITS.md`.

## Motion
- Purposeful and quick (150–400 ms); bot turns paced so a human can follow (~600 ms/step).
- Respect `prefers-reduced-motion`.
