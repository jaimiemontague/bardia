import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The playable slice through the real UI (production build): quick start, wait out the spring ice at home,
 * muster an expedition in the planner, sail for the nearest known harbour, raid it through the Arrival Card
 * and the battle setup (auto-resolve), close the Cargo screen, sail home and stand down in the hall.
 * Quick start picks a random house, so the raid can also fail (leaders wounded, slain or taken): the run then
 * answers the alerts and the captivity decision and still sails home.
 * Back home, the loot the fleet brought is in the house storehouse: the market sells it all and the treasury rises.
 * Screenshots land in test-results/ for a visual check.
 */
const OUT = process.env.BARDIA_E2E_OUT ?? 'test-results';

/** The treasury as the home Market states it ("Treasury: 2,345 silver · …"). */
async function marketTreasury(page: Page): Promise<number> {
  const text = (await page.getByTestId('home-stores').textContent()) ?? '';
  const m = /([\d,]+) silver/.exec(text);
  return m ? Number((m[1] ?? '0').replace(/,/g, '')) : NaN;
}

/**
 * Answers one thing in the player's way, as a player would: a critical alert (a death, a capture), a message,
 * or a generic decision (storylets, captivity: its first choice is "wait for ransom").
 */
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

/** Answers generic decisions and keeps time running (on the chart) until `target` shows. */
async function playUntil(page: Page, target: Locator, timeoutMs: number, opts: { realtime: boolean }): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await target.first().isVisible()) return;
    if (!(await answerOne(page)) && opts.realtime) {
      const play = page.getByTestId('time-speed-4');
      // (the controls can vanish mid-check when the scene changes: never wait on them)
      const pressed = await play.getAttribute('aria-pressed', { timeout: 300 }).catch(() => null);
      if (pressed === 'false') await play.click({ timeout: 1000 }).catch(() => undefined);
    }
    await page.waitForTimeout(250);
  }
  await expect(target.first()).toBeVisible();
}

test('launch an expedition, raid a neighbour and bring the loot home', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await page.getByTestId('menu-newSaga').click();
  await page.getByTestId('quick-start').click();
  const hub = page.locator('[data-testid="game-shell"][data-mode="hub"]');
  await expect(hub).toBeVisible({ timeout: 20_000 });

  // Northern seas are iced in through Icebreak: wait a month at home first.
  const date = async () => (await page.getByTestId('topbar-date').textContent()) ?? '';
  for (let i = 0; i < 60 && /Icebreak/.test(await date()); i++) {
    const wait = page.getByTestId('wait-30');
    if (!(await answerOne(page)) && (await wait.isEnabled())) await wait.click();
    await page.waitForTimeout(250);
  }
  expect(await date()).not.toMatch(/Icebreak/);
  while (await answerOne(page)) await page.waitForTimeout(200);

  // Muster and launch.
  await page.getByTestId('hub-expedition').click();
  await expect(page.getByTestId('expedition-planner')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/slice-planner.png' });
  await expect(page.getByTestId('planner-launch')).toBeEnabled();
  await page.getByTestId('planner-launch').click();
  await expect(page.locator('[data-testid="game-shell"][data-mode="map"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('world-map-loading')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByTestId('expedition-hud')).toBeVisible();

  // Sail for the nearest known harbour (the "Chart a course" picker) and let time run.
  await page.getByTestId('order-chart').click();
  await page.getByTestId('order-sail-destination').click();
  await expect(page.getByTestId('expedition-status')).toContainText(/Bound for/);
  await page.screenshot({ path: 'test-results/slice-sailing.png' });
  await playUntil(page, page.getByTestId('arrival-card'), 90_000, { realtime: true });
  await page.screenshot({ path: 'test-results/slice-arrival.png' });

  // Raid → battle setup → auto-resolve.
  await page.getByTestId('choose-raid').click();
  await expect(page.getByTestId('battle-setup')).toBeVisible();
  await expect(page.getByTestId('battle-odds')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/slice-battle.png' });
  await page.getByTestId('battle-auto').click();
  await expect(page.getByTestId('battle-setup')).toHaveCount(0);

  // A won raid opens the Cargo screen; a lost one sends the men back to the ships.
  const cargo = page.getByTestId('cargo-panel');
  const homeReady = page.locator('[data-testid="order-home"]:not([disabled])');
  await playUntil(page, cargo.or(homeReady), 20_000, { realtime: false });
  if (await cargo.isVisible()) {
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/slice-cargo.png' });
    // Load the best of the plunder (the hold permitting).
    for (let i = 0; i < 3; i++) {
      const take = page.locator('[data-testid^="cargo-take-"]:not([disabled])').first();
      if (!(await take.isVisible())) break;
      await take.click();
      await page.waitForTimeout(150);
    }
    await page.getByTestId('cargo-done').click();
  }

  // Sail home and stand down.
  await playUntil(page, homeReady, 20_000, { realtime: false });
  await homeReady.click();
  await playUntil(page, hub, 90_000, { realtime: true });
  while (await answerOne(page)) await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/slice-home.png' });
  await expect(page.getByTestId('hub-expedition')).toBeEnabled();

  // Sell the loot at the home market: the treasury rises by the total shown.
  await page.getByTestId('hotspot-market').click();
  await expect(page.getByTestId('home-market')).toBeVisible();
  const sellAll = page.getByTestId('sell-all');
  if (await sellAll.isEnabled()) {
    const before = await marketTreasury(page);
    await sellAll.click();
    const total = Number(((await page.getByTestId('sell-all-total').textContent()) ?? '').replace(/[^0-9]/g, ''));
    expect(total).toBeGreaterThan(0);
    await page.screenshot({ path: `${OUT}/slice-sell-all.png` });
    await page.getByTestId('sell-all-confirm').click();
    await expect(page.getByTestId('quick-result')).toBeVisible();
    const after = await marketTreasury(page);
    expect(after).toBe(before + total);
    expect(after).toBeGreaterThan(before);
  } else {
    // A failed raid brings nothing home: the button says so.
    await expect(page.getByTestId('sell-all-why')).toContainText(/no loot/i);
  }
  await page.screenshot({ path: `${OUT}/slice-market-home.png` });
  await page.getByTestId('market-close').click();
  expect(errors).toEqual([]);
});
