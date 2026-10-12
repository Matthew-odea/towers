import { expect, test } from '@playwright/test';
import { watchErrors } from './helpers';

test('rules page: reachable from the landing page; contents scroll to each section', async ({ page }) => {
  const errors = watchErrors(page, 'rules');
  await page.goto('/');
  await page.getByRole('link', { name: 'Rules' }).click();
  await expect(page).toHaveURL(/#\/rules$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Rules' })).toBeVisible();
  const contents = page.getByRole('navigation', { name: 'Contents' });
  for (const title of ['Winning', 'Your turn', 'Casualties']) {
    await contents.getByRole('button', { name: title }).click();
    await expect(page.getByRole('heading', { level: 2, name: title })).toBeInViewport();
  }
  // Scrolling to a section never touches the hash route.
  await expect(page).toHaveURL(/#\/rules$/);
  // The back button stays put while the page scrolls.
  await expect(page.getByRole('link', { name: 'Back' })).toBeInViewport();
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page.getByRole('link', { name: 'Rules' })).toBeVisible();
  // Escape also goes back, from the rules and from the stats page.
  await page.getByRole('link', { name: 'Rules' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Rules' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/#\/rules/);
  await page.getByRole('link', { name: 'Stats' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Stats' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/#\/stats/);
  expect(errors).toEqual([]);
});

test('rules page: the in-game menu opens it in a new tab and the game stays put', async ({ page, context }) => {
  await page.routeWebSocket(/\/ws/, (ws) => void ws.close());
  await page.goto('/#/offline');
  await page.getByRole('button', { name: 'Menu' }).click();
  const [tab] = await Promise.all([context.waitForEvent('page'), page.getByRole('menuitem', { name: 'Rules' }).click()]);
  await expect(tab).toHaveURL(/#\/rules$/);
  await expect(tab.getByRole('heading', { level: 1, name: 'Rules' })).toBeVisible();
  await expect(page).toHaveURL(/#\/offline$/);
});
