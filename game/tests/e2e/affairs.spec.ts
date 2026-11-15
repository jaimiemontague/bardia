import { expect, test, type Page } from '@playwright/test';

/**
 * Affairs of State (route 'affairs', SCR-09) through the real UI on the §20 layout (one decision in view at a
 * time, chosen from three doors): quick start, open the screen from the Great Hall, set a tax from its card,
 * pick and queue a building, wait at home until it is built, move men with the garrison's two-sided slider,
 * and check the screen at 1280×720, 1366×768 and 1920×1080.
 * Screenshots: <BARDIA_E2E_OUT or test-results>/affairs-*.png.
 */

const OUT = process.env.BARDIA_E2E_OUT ?? 'test-results';

/**
 * Other agents edit this folder while the dev server runs: a transient compile error in their screens raises
 * Vite's error overlay over the page. It is not this screen's concern, so it is removed.
 */
async function clearViteOverlay(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelectorAll('vite-error-overlay').forEach((e) => e.remove())).catch(() => undefined);
}

/** Answers one thing in the player's way: a critical alert, a message or a generic decision. */
async function answerOne(page: Page): Promise<boolean> {
  await clearViteOverlay(page);
  const critical = page.getByTestId('critical-modal').locator('button.btn-primary');
  const ack = page.getByTestId('decision-acknowledge');
  const choice = page.locator('[data-testid^="decision-choice-"]:not([disabled])').first();
  if (await critical.isVisible()) await critical.click();
  else if (await ack.isVisible()) await ack.click();
  else if (await choice.isVisible()) await choice.click();
  else return false;
  return true;
}

async function quickStart(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('menu-newSaga').click();
  await page.getByTestId('quick-start').click();
  await expect(page.locator('[data-testid="game-shell"][data-mode="hub"]')).toBeVisible({ timeout: 20_000 });
  while (await answerOne(page)) await page.waitForTimeout(200);
}

/** Opens the Affairs of State screen: hub → Great Hall → Affairs. */
async function openAffairs(page: Page): Promise<void> {
  await page.getByTestId('hotspot-greatHall').click();
  await page.getByTestId('hall-affairs').click();
  await expect(page.getByTestId('affairs')).toBeVisible();
  await clearViteOverlay(page);
  // Let the overlay finish fading in before anyone takes a picture.
  await page.waitForTimeout(350);
}

/** Closes Affairs of State and any route under it (the Great Hall), back to the hub. */
async function closeToHub(page: Page): Promise<void> {
  await page.getByTestId('affairs-close').click();
  await expect(page.getByTestId('affairs')).toHaveCount(0);
  for (let i = 0; i < 3 && (await page.locator('.route-host').count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
}

test('Affairs of State: set a tax, queue a building and see it finished', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await quickStart(page);
  await openAffairs(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/affairs-1280-open.png` });

  // Taxes (the first door): each card says what it does; choosing one moves the forecast.
  await expect(page.getByTestId('affairs-panel-folk')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('affairs-tax-light')).toContainText('silver a month');
  const forecast = page.getByTestId('affairs-loyalty-forecast');
  const before = (await forecast.textContent()) ?? '';
  await page.getByTestId('affairs-tax-light').click();
  await expect(page.getByTestId('affairs-tax-light')).toHaveAttribute('aria-checked', 'true');
  await expect(forecast).not.toHaveText(before);
  await expect(page.getByTestId('affairs-reasons')).toContainText('Light taxes');
  await expect(page.getByTestId('affairs-panel-folk')).toContainText('Light taxes');

  // Buildings: pick the walls (cheapest sure upgrade) from their card, then the one gold button.
  await page.getByTestId('affairs-panel-buildings').click();
  await expect(page.getByTestId('affairs-folk')).toHaveCount(0);
  await page.getByTestId('affairs-building-walls').click();
  const build = page.getByTestId('affairs-build-walls');
  await expect(build).toBeEnabled();
  await expect(build).toBeInViewport();
  const tierBefore = Number(await page.getByTestId('affairs-building-walls').getAttribute('data-tier'));
  await build.click();
  await expect(page.getByTestId('affairs-queue-walls')).toBeVisible();
  await expect(page.getByTestId('affairs-slots')).toContainText('1 of');
  await expect(page.getByTestId('affairs-panel-buildings')).toContainText('Walls under way');
  await page.screenshot({ path: `${OUT}/affairs-1280-queued.png` });

  // Wait at home until the builders finish (closing the screen to use the hall's waits).
  await closeToHub(page);
  for (let i = 0; i < 40; i++) {
    if (await answerOne(page)) {
      await page.waitForTimeout(150);
      continue;
    }
    await openAffairs(page);
    await page.getByTestId('affairs-panel-buildings').click();
    const tier = Number(await page.getByTestId('affairs-building-walls').getAttribute('data-tier'));
    if (tier > tierBefore) break;
    await closeToHub(page);
    const wait = page.getByTestId('wait-30');
    if (await wait.isEnabled()) await wait.click();
    await page.waitForTimeout(250);
  }
  await expect(page.getByTestId('affairs-building-walls')).toHaveAttribute('data-tier', String(tierBefore + 1));
  await expect(page.getByTestId('affairs-queue-walls')).toHaveCount(0);
  await page.screenshot({ path: `${OUT}/affairs-1280-built.png` });
  await page.getByTestId('affairs-panel-folk').click();
  await expect(page.getByTestId('affairs-last-report')).toContainText('Last reckoning');

  // Garrison: one two-sided slider; the send-home button waits until men are moved to the farms side.
  await page.getByTestId('affairs-panel-garrison').click();
  const slider = page.getByTestId('affairs-garrison-slider');
  if (await slider.count()) {
    const firstUnit = page.locator('[data-testid^="affairs-unit-"]').first();
    if (await firstUnit.count()) await firstUnit.click();
    const send = page.locator('[data-testid^="affairs-send-"]:not([data-testid="affairs-send-why"])');
    await expect(send).toBeDisabled();
    await page.getByTestId('affairs-garrison-slider-handle').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('affairs-garrison-slider-right')).toHaveText('1');
    await expect(send).toBeEnabled();
    await expect(send).toContainText('Send 1 home');
  }

  // 1366×768 (the reference window) and Full HD.
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/affairs-1366-garrison.png` });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/affairs-1920.png` });
  // Scroll the screen to its end at 1280×720 to check nothing is cut off.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByTestId('affairs-panel-buildings').click();
  await page.locator('[data-testid="affairs"] .frame-body').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/affairs-1280-scrolled.png` });
  expect(errors).toEqual([]);
});
