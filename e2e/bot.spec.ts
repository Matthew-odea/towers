import { expect, test } from '@playwright/test';
import { completeSetup, game, myMove, playTurnsVsBot, shot, simpleTurn, watchErrors } from './helpers';

test('online game against the bot: setup and three full turns', async ({ page }) => {
  const errors = watchErrors(page, 'bot');
  await page.goto('/');
  await page.getByLabel('Your name').fill('Hal');
  await page.getByRole('button', { name: 'Play the bot' }).click();
  await page.getByRole('group', { name: 'Bot difficulty' }).getByRole('button', { name: 'Medium' }).click();
  await expect(page).toHaveURL(/#\/g\/[a-z0-9]+$/);
  await expect(game(page)).toHaveAttribute('data-seat', 'red');
  await expect(page.locator('.rail--top .who-name')).toHaveText('Bot');
  await expect(page.locator('.rail--top .who-level')).toHaveText(/Medium/i);
  expect(await page.evaluate(() => localStorage.getItem('towers.botLevel'))).toBe('medium');
  // No invite for a bot game.
  await expect(page.getByLabel('Game link')).toHaveCount(0);

  // Setup is turn-based: Red (me) places first, one card per turn, and the bot answers on its own turns.
  await myMove(page, 'setup');
  await expect(page.locator('.status-line .status-text')).toHaveText(/^Place/);
  await shot(page, 'bot-01-setup');
  await completeSetup(page);
  await expect(game(page)).toHaveAttribute('data-phase', 'play');

  const { turnsPlayed, log } = await playTurnsVsBot(page, 3, (i) => simpleTurn(page, i), 'bot-');
  expect(turnsPlayed).toBe(3);
  await shot(page, 'bot-02-after-three-turns');
  // Either it is my turn again or the bot made me answer something; never stuck.
  await expect(game(page)).toHaveAttribute('data-busy', 'false', { timeout: 60_000 });
  test.info().annotations.push({ type: 'decisions', description: log.seen.join(', ') || 'none' });
  expect(errors).toEqual([]);
});

test('stats page reads the server record for the stored name', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Your name').fill('Statler');
  await page.getByRole('link', { name: 'Stats' }).click();
  await expect(page.locator('.stats-name')).toHaveText('Statler');
  await expect(page.locator('.record-num')).toHaveText(['0', '0']);
  await expect(page.getByText('No finished games yet.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Play a game' })).toHaveAttribute('href', '#/');
  await shot(page, 'stats-01-empty');
});
