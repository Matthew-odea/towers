import { expect, test } from '@playwright/test';
import { afterVersion, game, hex, myMove, playSetupPlans, shot, tap, version, watchErrors } from './helpers';

// Layout at the minimum supported size (1280x720): controls must stay clickable with a real
// mouse (no dispatchEvent), even when the clash column is at its tallest.

test('1280x720: Engage stays clickable with the Wit dial over an 8-card defence; chat clears the hand', async ({ browser }) => {
  const viewport = { width: 1280, height: 720 };
  const a = await (await browser.newContext({ viewport })).newPage();
  const b = await (await browser.newContext({ viewport })).newPage();
  const errors = [...watchErrors(a, 'A'), ...watchErrors(b, 'B')];

  await a.goto('/');
  await a.getByLabel('Your name').fill('Ann');
  await a.getByRole('button', { name: 'New game' }).click();
  await expect(a.getByRole('region', { name: 'Waiting for opponent' })).toBeVisible();
  await b.goto(a.url());
  await b.getByLabel('Your name').fill('Bo');
  await b.getByRole('button', { name: 'Join' }).click();

  // Red stacks both Commanders and six troops on 0,2: an 8-card defence. Black keeps Light 6 + Heavy 5
  // on 0,-2 and puts everything else elsewhere.
  await myMove(a, 'setup');
  await playSetupPlans(a, b, {
    a: {
      cards: Object.fromEntries(
        ['red-commander-dalinar', 'red-commander-jasnah', 'red-archer-lunamor', 'red-heavy-8', 'red-light-2', 'red-light-3', 'red-light-4', 'red-light-5'].map((id) => [id, '0,2']),
      ),
      rest: '0,2',
    },
    b: {
      cards: { 'black-commander-raboniel': '1,-2', 'black-commander-eshonai': '1,-2', 'black-light-6': '0,-2', 'black-heavy-5': '0,-2' },
      rest: '2,-2',
    },
  });

  await myMove(a, 'turn');
  let v = await version(a);
  await a.locator('.primary-act[data-primary="endTurn"]').click();
  await afterVersion(a, v);

  // Black spawns Wit next to the stack and commits it: the Wit dial opens.
  await myMove(b, 'turn');
  await b.getByRole('button', { name: 'Spawn Wit' }).click();
  v = await version(b);
  await tap(hex(b, '1,1'));
  await afterVersion(b, v);
  await myMove(b, 'turn');
  await tap(hex(b, '0,2'));
  await b.locator('.clash [data-card="black-wit-hoid"]').click();
  await expect(b.getByRole('radiogroup', { name: 'Wit number' })).toBeVisible();
  await b.getByRole('radio', { name: '8' }).click();
  await shot(b, 'layout-01-wit-dial-1280');

  // A real click (actionability + hit test): fails if anything covers the button.
  v = await version(b);
  await b.locator('.primary-act[data-primary="engage"]').click({ timeout: 5_000 });
  await afterVersion(b, v);
  await myMove(a, 'defend');
  await expect(game(a)).toHaveAttribute('data-decision', 'defend');

  // The open chat panel sits above the hand, not on it.
  await a.getByRole('button', { name: /^Chat/ }).click();
  const panel = await a.locator('.chat-panel').boundingBox();
  const fan = await a.locator('.reserve-fan').boundingBox();
  expect(panel && fan && panel.y + panel.height <= fan.y + 1).toBeTruthy();
  await expect(a.getByLabel('Message')).toHaveAttribute('placeholder', 'Say something');
  await shot(a, 'layout-02-chat-1280');

  expect(errors).toEqual([]);
});
