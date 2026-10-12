import { expect, test, type Locator, type Page } from '@playwright/test';
import { afterVersion, boardCard, game, hex, myMove, reserveCard, shot, version, watchErrors } from './helpers';

// Drag and drop with real mouse movement (pointer events), as the alternative to pick-then-click.

/** A point on a hand card that is not covered by its right-hand neighbour. */
async function handPoint(card: Locator): Promise<{ x: number; y: number }> {
  const b = (await card.boundingBox())!;
  return { x: b.x + Math.min(12, b.width / 4), y: b.y + b.height * 0.6 };
}

async function centre(target: Locator): Promise<{ x: number; y: number }> {
  const b = (await target.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Presses on `card`, drags to `to`, runs `during` while still holding, then releases. */
async function dragCard(page: Page, card: Locator, to: { x: number; y: number }, during?: () => Promise<void>): Promise<void> {
  const from = await handPoint(card);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await during?.();
  await page.mouse.up();
}

test('drag and drop: setup placements and a Deploy', async ({ page }) => {
  const errors = watchErrors(page, 'drag');
  await page.goto('/');
  await page.getByLabel('Your name').fill('Dragging Dana');
  await page.getByRole('button', { name: 'Play the bot' }).click();
  await page.getByRole('radiogroup', { name: 'Bot difficulty' }).getByRole('radio', { name: 'Easy' }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(game(page)).toHaveAttribute('data-seat', 'red');
  await myMove(page, 'setup');

  // Released away from the board: nothing is sent and the card goes back to the hand.
  const first = page.locator('.reserve-fan .card.is-selectable').first();
  const firstId = (await first.getAttribute('data-card'))!;
  const v0 = await version(page);
  await dragCard(page, first, { x: 160, y: 300 }, async () => {
    await expect(page.locator('.drag-ghost')).toHaveCount(1);
    await expect(page.locator('.board-marks polygon.hit[data-mark="setup"]')).toHaveCount(3);
  });
  await expect(page.locator('.drag-ghost')).toHaveCount(0);
  await expect(reserveCard(page, firstId)).toHaveCount(1);
  await expect(page.locator('.reserve-fan .card.is-selected')).toHaveCount(0);
  expect(await version(page)).toBe(v0);

  // Every setup placement by dragging, spread over the three home hexes.
  let placed = 0;
  while ((await game(page).getAttribute('data-phase')) === 'setup') {
    await expect
      .poll(async () => `${await game(page).getAttribute('data-phase')}|${await game(page).getAttribute('data-acting')}|${await game(page).getAttribute('data-busy')}`, {
        timeout: 30_000,
      })
      .toMatch(/^(play\|.*|setup\|me\|false)$/);
    if ((await game(page).getAttribute('data-phase')) !== 'setup') break;
    const card = page.locator('.reserve-fan .card.is-selectable').first();
    const id = (await card.getAttribute('data-card'))!;
    const targets = page.locator('.board-marks polygon.hit[data-mark="hint"]');
    const target = targets.nth(placed % (await targets.count()));
    const key = (await target.getAttribute('data-hex'))!;
    const v = await version(page);
    await dragCard(page, card, await centre(target), async () => {
      await expect(hex(page, key)).toHaveAttribute('data-mark', 'drop');
      if (placed === 0) await shot(page, 'drag-01-setup');
    });
    await afterVersion(page, v);
    await expect(boardCard(page, id)).toHaveCount(1);
    placed++;
  }
  expect(placed).toBe(8);

  // Red starts: drag one infantry card onto the Tower to Deploy it (1 CP).
  await myMove(page, 'turn');
  const tower = hex(page, '-1,2');
  const infantry = page.locator('.reserve-fan .card.kind-heavy, .reserve-fan .card.kind-light').first();
  const id = (await infantry.getAttribute('data-card'))!;
  const v = await version(page);
  await dragCard(page, infantry, await centre(tower), async () => {
    await expect(tower).toHaveAttribute('data-mark', 'drop');
    await expect(page.locator('.spheres--mine .sphere.is-cost')).toHaveCount(1);
    await shot(page, 'drag-02-deploy');
  });
  await afterVersion(page, v);
  await expect(boardCard(page, id)).toHaveCount(1);
  await expect(page.locator('.spheres--mine .sphere.is-on')).toHaveCount(3);
  expect(errors).toEqual([]);
});
