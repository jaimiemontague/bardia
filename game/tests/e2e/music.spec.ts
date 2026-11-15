import { expect, test, type Page } from '@playwright/test';

/**
 * Screen music: the owner's final tracks are fetched for the screen on show. The first click unlocks audio,
 * the menu asks for the new-saga track, the home village for its homeland's hall theme, and a room for its
 * own track (the Great hall).
 */
function musicRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => {
    const m = /\/assets\/music\/([a-z-]+)\.ogg/.exec(r.url());
    if (m?.[1]) seen.push(m[1]);
  });
  return seen;
}

async function clearOpening(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const ack = page.getByTestId('decision-acknowledge');
    const critical = page.getByTestId('critical-modal').locator('button.btn-primary');
    if (await critical.isVisible()) await critical.click();
    else if (await ack.isVisible()) await ack.click();
    else break;
    await page.waitForTimeout(200);
  }
}

test('menus, the home village and a room request their final music', async ({ page }) => {
  const seen = musicRequests(page);
  await page.goto('/');
  await page.getByTestId('menu-newSaga').click();
  await expect.poll(() => seen.includes('new-saga'), { timeout: 10_000 }).toBe(true);

  await page.getByTestId('quick-start').click();
  await expect(page.locator('[data-testid="game-shell"][data-mode="hub"]')).toBeVisible({ timeout: 20_000 });
  await clearOpening(page);
  await expect.poll(() => seen.some((s) => s.startsWith('home-')), { timeout: 10_000 }).toBe(true);

  await page.getByTestId('hotspot-greatHall').click();
  await expect.poll(() => seen.includes('great-hall'), { timeout: 10_000 }).toBe(true);
});
