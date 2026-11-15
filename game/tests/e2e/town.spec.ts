import { expect, test, type Page } from '@playwright/test';

/**
 * The home town's Market and Mead-hall through the real UI: quick start, open each from its hub hotspot,
 * use what works at home (a deal through the two-sided slider, sell all, other ports, trade routes; the hall's
 * choices, news, sellswords, other places) and close it again. Screenshots land in the run's output folder.
 */
const OUT = process.env.BARDIA_E2E_OUT ?? 'test-results';

async function startSaga(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await page.getByTestId('menu-newSaga').click();
  await page.getByTestId('quick-start').click();
  await expect(page.locator('[data-testid="game-shell"][data-mode="hub"]')).toBeVisible({ timeout: 20_000 });
  // A decision raised on the first day (a storylet, a message) would cover the hub: answer it.
  for (let i = 0; i < 5; i++) {
    const ack = page.getByTestId('decision-acknowledge');
    const choice = page.locator('[data-testid^="decision-choice-"]:not([disabled])').first();
    if (await ack.isVisible()) await ack.click();
    else if (await choice.isVisible()) await choice.click();
    else break;
  }
}

test('the home market: a deal on the slider, sell all, other ports and trade routes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await startSaga(page);
  await page.getByTestId('hotspot-market').click();
  const market = page.getByTestId('home-market');
  await expect(market).toBeVisible();
  await expect(page.getByTestId('home-stores')).toContainText('Storehouse');
  // A new saga: provisions for the first voyage are stored, and there is no loot yet.
  await expect(page.getByTestId('sell-all')).toBeDisabled();
  await expect(page.getByTestId('sell-all-why')).toContainText(/no loot/i);
  await page.getByTestId('market-row-salt').click();
  await expect(page.getByTestId('market-deal')).toHaveAttribute('data-good', 'salt');
  // Ten steps of the handle toward the storehouse: buy one ton; the deal is told in words as it moves.
  await page.getByTestId('market-slider-handle').focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('market-quote')).toHaveAttribute('data-side', 'buy');
  await expect(page.getByTestId('market-quote')).toContainText(/Buy 1 t for [0-9,]+ silver/);
  await page.screenshot({ path: `${OUT}/town-market-deal.png` });
  await page.getByTestId('market-strike').click();
  await expect(page.getByTestId('held-salt')).toHaveText(/^1/);
  await expect(page.getByTestId('market-done')).toContainText(/Bought 1 t/);
  // Where else salt sells best, behind "Other ports".
  await page.getByTestId('market-elsewhere-toggle').click();
  await expect(page.getByTestId('known-markets').or(page.getByTestId('known-empty'))).toBeVisible();
  // Now there is loot of a sort: Sell all shows its total before confirming.
  await page.getByTestId('sell-all').click();
  await expect(page.getByTestId('sell-all-total')).toContainText(/silver/);
  await page.screenshot({ path: `${OUT}/town-market.png` });
  await page.getByTestId('sell-all-cancel').click();

  await page.getByTestId('market-view-routes').click();
  await expect(page.getByTestId('route-form')).toBeVisible();
  await page.screenshot({ path: `${OUT}/town-market-routes.png` });
  await page.getByTestId('market-view-goods').click();
  await expect(page.getByTestId('market')).toBeVisible();

  await page.getByTestId('market-close').click();
  await expect(market).toBeHidden();
  expect(errors).toEqual([]);
});

test('the home mead-hall: four choices, news, sellswords and other places', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await startSaga(page);
  await page.getByTestId('hotspot-meadHall').click();
  const hall = page.getByTestId('home-meadhall');
  await expect(hall).toBeVisible();
  await page.getByTestId('tavern-anyNews').click();
  await expect(page.getByTestId('tavern-result')).toContainText(/keeper/i);
  await page.getByTestId('tavern-travellers').click();
  await expect(page.getByTestId('tavern-result')).toContainText(/travellers/i);
  await page.screenshot({ path: `${OUT}/town-meadhall.png` });
  // What has been heard sits beside the choices.
  await expect(page.getByTestId('news-log')).toBeVisible();

  await page.getByTestId('hall-sellswords').click();
  await expect(page.getByTestId('sellswords').or(page.getByTestId('sellswords-empty'))).toBeVisible();
  await page.screenshot({ path: `${OUT}/town-meadhall-sellswords.png` });

  await page.getByTestId('hall-places-toggle').click();
  await expect(page.getByTestId('intel-panel')).toBeVisible();
  await page.screenshot({ path: `${OUT}/town-meadhall-intel.png` });

  await page.getByTestId('meadhall-close').click();
  await expect(hall).toBeHidden();
  expect(errors).toEqual([]);
});

/** Answers one thing in the player's way (a critical alert, a message, a generic decision). */
async function answerOne(page: Page): Promise<boolean> {
  const critical = page.getByTestId('critical-modal').locator('button.btn-primary');
  const ack = page.getByTestId('decision-acknowledge');
  const choice = page.locator('[data-testid^="decision-choice-"]:not([disabled])').first();
  if (await critical.isVisible()) await critical.click();
  else if (await ack.isVisible()) await ack.click();
  else if (await choice.isVisible()) await choice.click();
  else return false;
  return true;
}

test('the shared market and mead-hall abroad, in a foreign settlement hub', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await startSaga(page);
  const date = async () => (await page.getByTestId('topbar-date').textContent()) ?? '';
  for (let i = 0; i < 60 && /Icebreak/.test(await date()); i++) {
    const wait = page.getByTestId('wait-30');
    if (!(await answerOne(page)) && (await wait.isEnabled())) await wait.click();
    await page.waitForTimeout(250);
  }
  while (await answerOne(page)) await page.waitForTimeout(200);
  await page.getByTestId('hub-expedition').click();
  await expect(page.getByTestId('planner-launch')).toBeEnabled();
  await page.getByTestId('planner-launch').click();
  await expect(page.getByTestId('world-map-loading')).toHaveCount(0, { timeout: 60_000 });
  await page.getByTestId('order-chart').click();
  await page.getByTestId('order-sail-destination').click();
  const card = page.getByTestId('arrival-card');
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && !(await card.isVisible())) {
    if (!(await answerOne(page))) {
      const play = page.getByTestId('time-speed-4');
      const pressed = await play.getAttribute('aria-pressed', { timeout: 300 }).catch(() => null);
      if (pressed === 'false') await play.click({ timeout: 1000 }).catch(() => undefined);
    }
    await page.waitForTimeout(250);
  }
  if (!(await card.isVisible())) await page.screenshot({ path: `${OUT}/town-abroad-stuck.png` });
  await expect(card).toBeVisible();
  const enter = page.getByTestId('choose-enter');
  if (await enter.isEnabled()) await enter.click();
  else await page.getByTestId('choose-trade').click();
  const hub = page.getByTestId('settlement-hub');
  await expect(hub).toBeVisible();
  const market = page.getByTestId('market');
  if (await market.isVisible()) {
    await page.locator('[data-testid^="market-row-"]').first().click();
    await expect(page.getByTestId('market-slider').or(page.getByTestId('market-closed'))).toBeVisible();
    await expect(page.getByTestId('market-quote').or(page.getByTestId('market-closed'))).toBeVisible();
  }
  await page.screenshot({ path: `${OUT}/town-abroad-market.png` });
  await page.getByRole('tab', { name: /mead-hall/i }).click();
  await page.getByTestId('tavern-anyNews').click();
  await expect(page.getByTestId('tavern-result')).toBeVisible();
  await page.screenshot({ path: `${OUT}/town-abroad-meadhall.png` });
  await page.getByTestId('hub-leave').click();
  await expect(hub).toBeHidden();
  expect(errors).toEqual([]);
});
