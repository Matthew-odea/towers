import { expect, test } from '@playwright/test';
import {
  afterVersion,
  answerDecision,
  attr,
  boardCard,
  game,
  hex,
  myMove,
  placeSetupCard,
  playSetupPlans,
  shot,
  tap,
  version,
  watchErrors,
  type DecisionLog,
} from './helpers';

// Server test mode: seed "e2e", the creator plays Red, Red starts, and the first engagement's
// dice are forced (see playwright.config.ts). With that seed Red's route -2,2 -> -2,1 -> -2,0 ->
// -1,-1 is Plains/Plains/Forest. Attacking 0,-2 from -1,-1 leaves Black's Tower (1,-2) as a legal
// Combat Retreat hex, so every kind of engagement decision comes up.

test('two players: lobby, setup, a full engagement, chat, reload keeps the seat', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errors = [...watchErrors(a, 'A'), ...watchErrors(b, 'B')];

  // ---- A creates a game and waits in the lobby ----
  await a.goto('/');
  await a.getByLabel('Your name').fill('Ann');
  await a.getByRole('button', { name: 'New game' }).click();
  await expect(a).toHaveURL(/#\/g\/[a-z0-9]+$/);
  const lobby = a.getByRole('region', { name: 'Waiting for opponent' });
  await expect(lobby.getByLabel('Game link')).toHaveValue(a.url());
  await shot(a, 'pvp-01-lobby');

  // ---- B opens the link and joins under another name ----
  await b.goto(a.url());
  await b.getByLabel('Your name').fill('Bo');
  await b.getByRole('button', { name: 'Join' }).click();
  await expect(game(a)).toHaveAttribute('data-seat', 'red');
  await expect(game(b)).toHaveAttribute('data-seat', 'black');
  await expect(lobby).toHaveCount(0);
  await expect(a.locator('.rail--top .who-name')).toHaveText('Bo');
  await expect(b.locator('.rail--top .who-name')).toHaveText('Ann');

  // ---- setup: open and turn-based, one card per turn: Red's Commanders, Black's Commanders, then
  // alternating troops. Red stacks Dalinar + Light 7 + Heavy 8 on -2,2 (the rest elsewhere); Black
  // stacks Light 6 + Heavy 5 on 0,-2 (Commanders and the rest elsewhere). ----
  await myMove(a, 'setup');
  await expect(a.locator('.status-line .status-text')).toHaveText(/^Place/);
  await expect(b.locator('.status-line .status-text')).not.toHaveText(/^Place/);
  await expect(game(b)).toHaveAttribute('data-acting', 'opponent');
  await placeSetupCard(a, ['red-commander-dalinar'], '-2,2');
  // No confirm step: Black's page sees the card face up on the board at once.
  await expect(boardCard(b, 'red-commander-dalinar')).toHaveCount(1);
  await expect(hex(a, '-2,2')).not.toHaveAttribute('data-mark', 'setup');
  await playSetupPlans(a, b, {
    a: {
      cards: { 'red-commander-dalinar': '-2,2', 'red-commander-jasnah': '-1,2', 'red-light-7': '-2,2', 'red-heavy-8': '-2,2' },
      rest: '0,2',
    },
    b: {
      cards: { 'black-commander-raboniel': '1,-2', 'black-commander-eshonai': '1,-2', 'black-light-6': '0,-2', 'black-heavy-5': '0,-2' },
      rest: '2,-2',
    },
  });
  await expect(game(a)).toHaveAttribute('data-phase', 'play');
  await shot(a, 'pvp-02-setup-red');
  await shot(b, 'pvp-03-setup-black');

  // ---- Red's turn: move the stack -2,2 -> -2,1 -> -2,0 -> -1,-1 ----
  await myMove(a, 'turn');
  await expect(game(b)).toHaveAttribute('data-acting', 'opponent');
  await expect(boardCard(b, 'red-light-7')).toHaveCount(1); // placements revealed
  await tap(boardCard(a, 'red-light-7'));
  for (const to of ['-2,1', '-2,0', '-1,-1']) {
    await expect(hex(a, to)).toHaveAttribute('data-mark', 'move');
    const v = await version(a);
    await tap(hex(a, to));
    await afterVersion(a, v);
    await myMove(a, 'turn');
  }
  await expect(a.locator('.spheres--mine .sphere.is-on')).toHaveCount(1);
  await shot(a, 'pvp-04-moved');

  // ---- Engage 0,-2 with all three cards (the last CP) ----
  await expect(hex(a, '0,-2')).toHaveAttribute('data-mark', 'attack');
  await tap(hex(a, '0,-2'));
  const engageBtn = a.locator('.primary-act[data-primary="engage"]');
  await expect(engageBtn).toBeEnabled();
  await expect(engageBtn).toContainText('3/3');
  await shot(a, 'pvp-05-commit');
  const v0 = await version(a);
  await engageBtn.click();
  await afterVersion(a, v0);

  // ---- both sides answer every decision until the engagement is over ----
  const log: DecisionLog = { seen: [] };
  for (let i = 0; i < 40; i++) {
    const [actA, actB, decA] = await Promise.all([attr(a, 'data-acting'), attr(b, 'data-acting'), attr(a, 'data-decision')]);
    if (decA === 'turn') break; // engagement over; the turn passed on
    const busy = (await attr(a, 'data-busy')) === 'true' || (await attr(b, 'data-busy')) === 'true';
    if (!busy && actA === 'me') await answerDecision(a, log, 'red', 'pvp-engage-');
    else if (!busy && actB === 'me') await answerDecision(b, log, 'black', 'pvp-engage-');
    else await a.waitForTimeout(150);
  }
  // Forced dice: 1+2 stale, Red's Commander rerolls die 1 to a 1 (still stale), Press, 3+4 = 7:
  // Red's Light 7 fires, Black loses one card and retreats the survivor onto its Tower.
  expect(log.seen).toEqual(['black:defend', 'red:reroll', 'red:pressOrBreak', 'black:casualties', 'black:retreat']);
  const survivors = ['black-light-6', 'black-heavy-5'];
  let left = 0;
  for (const id of survivors) left += await boardCard(b, id).count();
  expect(left).toBe(1);
  await expect(b.locator('.board-cards [data-card^="black-"]')).toHaveCount(7); // eight placed, one casualty
  await expect(hex(b, '0,-2')).not.toHaveClass(/hit--stack/);

  // The Engage used Red's last CP, so the turn ended by itself.
  await myMove(b, 'turn');
  await expect(game(a)).toHaveAttribute('data-acting', 'opponent');
  await expect(b.locator('.spheres--mine .sphere.is-on')).toHaveCount(4);
  await shot(a, 'pvp-06-after-engagement-red');
  await shot(b, 'pvp-07-after-engagement-black');

  // ---- chat round trip ----
  await a.getByRole('button', { name: /^Chat/ }).click();
  await a.getByLabel('Message').fill('Journey before destination');
  await a.getByLabel('Message').press('Enter');
  await expect(b.getByLabel('Unread messages')).toBeVisible();
  await b.getByRole('button', { name: /^Chat/ }).click();
  await expect(b.locator('.chat-line')).toHaveText(['Ann Journey before destination']);
  await b.getByLabel('Message').fill('Life before death');
  await b.getByLabel('Message').press('Enter');
  await expect(a.locator('.chat-line')).toHaveText(['Ann Journey before destination', 'Bo Life before death']);
  await shot(b, 'pvp-08-chat');

  // ---- reloading B restores B's seat, the turn and the chat history ----
  const before = await version(b);
  await b.reload();
  await expect(game(b)).toHaveAttribute('data-seat', 'black');
  await myMove(b, 'turn');
  expect(await version(b)).toBe(before);
  await expect(b.getByRole('button', { name: 'Join' })).toHaveCount(0);
  await b.getByRole('button', { name: /^Chat/ }).click();
  await expect(b.locator('.chat-line')).toHaveCount(2);
  await shot(b, 'pvp-09-reloaded');

  // Black can still play: end the turn and Red is up again.
  const vb = await version(b);
  await b.locator('.primary-act[data-primary="endTurn"]').click();
  await afterVersion(b, vb);
  await myMove(a, 'turn');

  expect(errors).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});

test('rematch: both players land in the same new game with a fresh screen', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errors = [...watchErrors(a, 'A'), ...watchErrors(b, 'B')];
  await a.goto('/');
  // Stats persist across runs (.data/stats.e2e.json), so names are unique per run.
  const tag = String(Date.now() % 1e6);
  const ann = `Ann${tag}`;
  const bo = `Bo${tag}`;
  await a.getByLabel('Your name').fill(ann);
  await a.getByRole('button', { name: 'New game' }).click();
  await expect(a).toHaveURL(/#\/g\/[a-z0-9]+$/);
  const first = a.url();
  await b.goto(first);
  await b.getByLabel('Your name').fill(bo);
  await b.getByRole('button', { name: 'Join' }).click();
  await myMove(a, 'setup');

  // Ann concedes both rounds from the menu.
  for (let round = 1; round <= 2; round++) {
    await expect(game(a)).toHaveAttribute('data-phase', 'setup');
    const v = await version(a);
    await a.getByRole('button', { name: 'Menu' }).click();
    await a.getByRole('menuitem', { name: 'Concede round' }).click();
    await a.getByRole('button', { name: 'Concede', exact: true }).click();
    await afterVersion(a, v);
  }
  await expect(game(a)).toHaveAttribute('data-phase', 'matchOver');
  await expect(b.locator('.banner--match')).toContainText('Singers win');
  await shot(b, 'pvp-rematch-01-match-over');

  await a.getByRole('button', { name: 'Rematch' }).click();
  await expect(a).not.toHaveURL(first);
  await expect(a).toHaveURL(/#\/g\/[a-z0-9]+$/);
  await expect(a.getByRole('region', { name: 'Waiting for opponent' })).toBeVisible();
  await expect(b.getByRole('status')).toHaveText(`${ann} wants a rematch`);
  await b.getByRole('button', { name: 'Rematch' }).click();
  await expect(b).toHaveURL(a.url());
  await myMove(a, 'setup');
  await expect(game(b)).toHaveAttribute('data-decision', 'setup');
  await expect(game(a)).toHaveAttribute('data-version', '0');
  await expect(a.locator('.banner')).toHaveCount(0);
  await expect(b.locator('.rail--top .who-name')).toHaveText(ann);
  await shot(b, 'pvp-rematch-02-new-game');

  // The finished match was recorded: Bo 1-0 against Ann.
  await b.goto('/#/stats');
  await expect(b.locator('.stats-name')).toHaveText(bo);
  await expect(b.locator('.record')).toHaveText(/1\s*–\s*0/);
  await expect(b.locator('.opp-table')).toContainText(ann);
  await shot(b, 'pvp-rematch-03-stats');
  expect(errors).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});
