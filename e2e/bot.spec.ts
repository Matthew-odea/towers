import { expect, test } from '@playwright/test';
import { game, myMove, playTurnsVsBot, shot, simpleTurn, watchErrors } from './helpers';

test('online game against the bot: setup and three full turns', async ({ page }) => {
  const errors = watchErrors(page, 'bot');
  await page.goto('/');
  await page.getByLabel('Your name').fill('Hal');
  await page.getByRole('button', { name: 'Play the bot' }).click();
  await expect(page).toHaveURL(/#\/g\/[a-z0-9]+$/);
  await expect(game(page)).toHaveAttribute('data-seat', 'red');
  await expect(page.locator('.rail--top .who-name')).toHaveText('Bot');
  // No invite for a bot game.
  await expect(page.getByLabel('Game link')).toHaveCount(0);

  // The bot has already placed (its "Ready" shows); Commanders start on my Tower.
  await myMove(page, 'setup');
  await expect(page.locator('.rail--top .who-ready')).toBeVisible();
  await shot(page, 'bot-01-setup');
  await page.getByRole('button', { name: 'Ready' }).click();

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
  await expect(page.locator('.record')).toHaveText(/0\s*–\s*0/);
  await shot(page, 'stats-01-empty');
});
