import { expect, test } from '@playwright/test';

/**
 * The world map (render/map + screens/worldMap) through the `?mapPreview` dev page: the chart bakes, draws the
 * generated world without page errors, switches map modes and zoom bands. Screenshots land in test-results/ for
 * a visual check.
 */
test('the sea chart renders the generated world and switches modes', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/?mapPreview&seed=chart&days=2');
  await expect(page.getByTestId('world-map')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('world-map-loading')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByTestId('map-legend')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/map-home.png' });
  await page.getByTestId('map-band-world').click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'test-results/map-world.png' });

  await page.getByTestId('map-band-region').click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'test-results/map-region.png' });

  await page.getByTestId('map-mode-relations').click();
  await page.waitForTimeout(600);
  await expect(page.locator('[data-testid="world-map"][data-mode="relations"]')).toBeVisible();
  await page.screenshot({ path: 'test-results/map-relations.png' });

  await page.getByTestId('map-band-local').click();
  await page.waitForTimeout(900);
  await page.getByTestId('map-mode-political').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/map-local.png' });
  expect(errors).toEqual([]);
});

test('the hall opens the sea chart and its close button returns to the hall', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await page.getByTestId('menu-newSaga').click();
  await page.getByTestId('quick-start').click();
  await expect(page.locator('[data-testid="game-shell"][data-mode="hub"]')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('hub-chart').click();
  await expect(page.getByTestId('world-map')).toBeVisible();
  await expect(page.getByTestId('world-map-loading')).toHaveCount(0, { timeout: 60_000 });
  await page.getByTestId('map-close').click();
  await expect(page.getByTestId('world-map')).toHaveCount(0);
  expect(errors).toEqual([]);
});
