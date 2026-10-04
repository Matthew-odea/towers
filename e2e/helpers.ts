import { expect, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCREENS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'screens');
fs.mkdirSync(SCREENS, { recursive: true });

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SCREENS, `${name}.png`) });
}

/** Collects page errors and console errors so a test can assert there were none. */
export function watchErrors(page: Page, label: string): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${label} console: ${m.text()}`);
  });
  return errors;
}

export const game = (page: Page): Locator => page.locator('.game');
export const hex = (page: Page, key: string): Locator => page.locator(`.board-marks polygon.hit[data-hex="${key}"]`);
export const boardCard = (page: Page, id: string): Locator => page.locator(`.board-cards [data-card="${id}"]`);
export const reserveCard = (page: Page, id: string): Locator => page.locator(`.reserve-fan [data-card="${id}"]`);

/**
 * Cards overlap in fans and stacks, so clicks are dispatched straight to the element (the app's
 * handlers are plain React click handlers).
 */
export async function tap(target: Locator): Promise<void> {
  await expect(target).toHaveCount(1);
  await target.dispatchEvent('click');
}

/** Waits until this page's player must act now and all animations have settled. */
export async function myMove(page: Page, decision?: string, timeout = 30_000): Promise<void> {
  const g = game(page);
  await expect(g).toHaveAttribute('data-acting', 'me', { timeout });
  await expect(g).toHaveAttribute('data-busy', 'false', { timeout });
  if (decision) await expect(g).toHaveAttribute('data-decision', decision, { timeout });
}

export async function attr(page: Page, name: string): Promise<string | null> {
  return game(page).getAttribute(name);
}

/** Waits for the version shown on the page to move past `v`, then for animations to settle. */
export async function afterVersion(page: Page, v: number, timeout = 30_000): Promise<void> {
  await expect
    .poll(async () => Number((await attr(page, 'data-version')) ?? -1), { timeout })
    .toBeGreaterThan(v);
  await expect(game(page)).toHaveAttribute('data-busy', 'false', { timeout });
}

export async function version(page: Page): Promise<number> {
  return Number((await attr(page, 'data-version')) ?? -1);
}

export interface DecisionLog {
  seen: string[];
}

/**
 * Answers whatever engagement decision this page currently has (it must be this page's turn to
 * act). The policy exercises every control once: reroll a die the first time, then pass; Press
 * the first stale roll, then Break off; retreat to a hex when one is offered.
 */
export async function answerDecision(page: Page, log: DecisionLog, label: string, shotPrefix = ''): Promise<void> {
  const kind = (await attr(page, 'data-decision')) ?? '';
  const n = log.seen.filter((k) => k.endsWith(`:${kind}`)).length;
  log.seen.push(`${label}:${kind}`);
  await shot(page, `${shotPrefix}${label}-${kind}${n ? `-${n + 1}` : ''}`);
  const v = await version(page);
  switch (kind) {
    case 'defend': {
      const btn = page.getByRole('button', { name: /^Defend/ });
      await expect(btn).toBeEnabled();
      await btn.click();
      break;
    }
    case 'reroll': {
      const rerolled = log.seen.filter((k) => k.endsWith(':reroll')).length > 1;
      if (!rerolled) await page.locator('.die.is-live').nth(1).click();
      else await page.getByRole('button', { name: 'Pass' }).click();
      break;
    }
    case 'pressOrBreak': {
      const pressed = log.seen.filter((k) => k.endsWith(':pressOrBreak')).length > 1;
      await page.getByRole('button', { name: pressed ? 'Break off' : 'Press' }).click();
      break;
    }
    case 'casualties': {
      const confirm = page.getByRole('button', { name: 'Confirm' });
      for (let i = 0; i < 6 && !(await confirm.isEnabled()); i++) {
        await page.locator('.clash .card.is-selectable').first().click();
      }
      await expect(confirm).toBeEnabled();
      await confirm.click();
      break;
    }
    case 'retreat': {
      const hexes = page.locator('.board-marks polygon.hit[data-mark="retreat"]');
      if ((await hexes.count()) > 0) await hexes.first().dispatchEvent('click');
      else await page.getByRole('button', { name: 'Stand' }).click();
      break;
    }
    default:
      throw new Error(`${label}: unexpected decision "${kind}"`);
  }
  await afterVersion(page, v);
}

const ENGAGEMENT_DECISIONS = new Set(['defend', 'reroll', 'pressOrBreak', 'casualties', 'retreat']);

/**
 * Plays `turns` full turns (mine, then the bot's) against the bot from whatever state the page is
 * in. My turns use `plan(i)` (i = 0-based turn index) and then End turn; engagement decisions
 * the bot forces on me are answered as they come; a new round's setup is confirmed as placed.
 */
export async function playTurnsVsBot(
  page: Page,
  turns: number,
  plan: (i: number) => Promise<void>,
  prefix: string,
): Promise<{ log: DecisionLog; turnsPlayed: number }> {
  const log: DecisionLog = { seen: [] };
  let done = 0;
  for (let guard = 0; guard < 200 && done < turns; guard++) {
    const g = game(page);
    await expect
      .poll(async () => ((await attr(page, 'data-phase')) === 'matchOver' ? 'over' : `${await attr(page, 'data-acting')}|${await attr(page, 'data-busy')}`), {
        timeout: 90_000,
      })
      .toMatch(/^(over|me\|false)$/);
    if ((await attr(page, 'data-phase')) === 'matchOver') break;
    const kind = (await attr(page, 'data-decision')) ?? '';
    if (kind === 'setup') {
      const v = await version(page);
      await page.getByRole('button', { name: 'Ready' }).click();
      await afterVersion(page, v);
    } else if (ENGAGEMENT_DECISIONS.has(kind)) {
      await answerDecision(page, log, 'me', prefix);
    } else if (kind === 'turn') {
      await shot(page, `${prefix}turn-${done + 1}`);
      await plan(done);
      // The plan may have spent every CP (the engine then ends the turn itself) or started an
      // engagement; only press End turn if it is still my free turn.
      await expect(g).toHaveAttribute('data-busy', 'false', { timeout: 30_000 });
      if ((await attr(page, 'data-acting')) === 'me' && (await attr(page, 'data-decision')) === 'turn') {
        const v = await version(page);
        await page.getByRole('button', { name: 'End turn' }).click();
        await afterVersion(page, v);
      }
      done++;
    } else {
      throw new Error(`unexpected decision ${kind}`);
    }
  }
  return { log, turnsPlayed: done };
}

/** A simple, always-legal turn: Deploy one card if possible, else move one of my stacks one hex. */
export async function simpleTurn(page: Page, i: number): Promise<void> {
  const deploy = page.getByRole('button', { name: /^Deploy/ });
  if (i % 2 === 0 && (await deploy.count()) > 0) {
    await deploy.click();
    const pick = page.locator('.reserve-fan .card.is-selectable').first();
    if ((await pick.count()) > 0) {
      await pick.dispatchEvent('click');
      const v = await version(page);
      await page.getByRole('button', { name: /^Deploy/ }).click();
      await afterVersion(page, v);
      return;
    }
    await deploy.click(); // nothing to pick: leave deploy mode
  }
  const own = page.locator('.board-marks polygon.hit[data-mark="own"]');
  if ((await own.count()) === 0) return;
  await own.first().dispatchEvent('click');
  const dest = page.locator('.board-marks polygon.hit[data-mark="move"]');
  if ((await dest.count()) === 0) {
    await page.keyboard.press('Escape');
    return;
  }
  const v = await version(page);
  await dest.first().dispatchEvent('click');
  await afterVersion(page, v);
}
