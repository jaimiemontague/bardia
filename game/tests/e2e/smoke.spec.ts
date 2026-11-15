import { expect, test } from '@playwright/test';

/**
 * Smoke: the production build boots, a Quick Start generates the real world in the browser (world
 * generation, every module's init) and lands in the hub of a geography settlement, without page errors.
 */
test('a quick start generates the world in the browser and reaches the hub', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.getByTestId('menu-newSaga').click();
  await page.getByTestId('quick-start').click();
  await expect(page.locator('[data-testid="game-shell"][data-mode="hub"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('topbar-date')).toContainText('812');
  await expect(page.getByTestId('topbar-ruler')).not.toBeEmpty();
  expect(errors).toEqual([]);
});
