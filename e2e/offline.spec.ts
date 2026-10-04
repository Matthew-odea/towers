import { expect, test } from '@playwright/test';
import { completeSetup, game, myMove, playTurnsVsBot, shot, simpleTurn, watchErrors } from './helpers';

test('offline: with the server unreachable, Play the bot falls back to the in-browser bot', async ({ page }) => {
  const errors = watchErrors(page, 'offline');
  // Cut the page off from the game server: no config, every WebSocket closes at once.
  let sockets = 0;
  await page.route('**/config.json', (r) => r.abort());
  await page.routeWebSocket(/\/ws/, (ws) => {
    sockets++;
    void ws.close();
  });

  await page.goto('/');
  await page.getByLabel('Your name').fill('Offline Olga');
  await page.getByRole('button', { name: 'Play the bot' }).click();
  await page.getByRole('group', { name: 'Bot difficulty' }).getByRole('button', { name: 'Easy' }).click();
  await expect(page).toHaveURL(/#\/offline$/, { timeout: 15_000 });
  expect(sockets).toBeGreaterThan(0); // it did try the server first

  await expect(game(page)).toHaveAttribute('data-seat', 'red');
  await expect(page.locator('.rail--bottom .who-name')).toHaveText('Offline Olga');
  await expect(page.getByRole('button', { name: /^Chat/ })).toHaveCount(0);
  await myMove(page, 'setup');
  await shot(page, 'offline-01-setup');
  await completeSetup(page);

  const { turnsPlayed } = await playTurnsVsBot(page, 2, (i) => simpleTurn(page, i), 'offline-');
  expect(turnsPlayed).toBe(2);
  await shot(page, 'offline-02-played');
  // Console errors from the failed server attempts are expected; nothing else is.
  expect(errors.filter((e) => !/WebSocket|config\.json|ERR_FAILED|Failed to load resource/i.test(e))).toEqual([]);
});

test('offline: the #/offline route works directly', async ({ page }) => {
  await page.routeWebSocket(/\/ws/, (ws) => void ws.close());
  await page.goto('/#/offline');
  await expect(game(page)).toHaveAttribute('data-phase', 'setup');
  await myMove(page, 'setup');
  await completeSetup(page);
  // Offline games use a random seed: the bot may start (and attack) first, so answer whatever
  // comes up until one of my turns has been played.
  const { turnsPlayed } = await playTurnsVsBot(page, 1, (i) => simpleTurn(page, i), 'offline-direct-');
  expect(turnsPlayed).toBe(1);
});
