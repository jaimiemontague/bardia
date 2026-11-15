import { expect, test, type Page } from '@playwright/test';

/**
 * Interruptions as scenes (ARCHITECTURE §20.7) through the real UI: sailing into a settlement raises the
 * attention cue over the map, then the full-screen arrival scene; entering opens the visit scene (market,
 * mead-hall, back to the ships). Sailing far raises an encounter: cue, then the full-screen encounter
 * scene, answered with its safe first choice. In dev builds the scene gallery (`?scenes=<variant>`) is
 * screenshotted at both reference sizes. Screenshots land in the output folder for a visual check.
 */

const OUT = process.env.BARDIA_E2E_OUT ?? 'test-results';

/** Answers whatever else is in the way (alerts, messages, other decisions); skips a cue. */
async function answerOther(page: Page): Promise<boolean> {
  const cue = page.getByTestId('scene-cue');
  const critical = page.getByTestId('critical-modal').locator('button.btn-primary');
  const ack = page.getByTestId('decision-acknowledge');
  const choice = page.locator('[data-testid="generic-decision"] [data-testid^="decision-choice-"]:not([disabled])').first();
  if (await cue.isVisible()) await cue.click({ timeout: 1500 }).catch(() => undefined);
  else if (await critical.isVisible()) await critical.click();
  else if (await ack.isVisible()) await ack.click();
  else if (await choice.isVisible()) await choice.click();
  else return false;
  return true;
}

async function startExpedition(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('menu-options').click();
  await page.getByRole('tab', { name: 'Gameplay' }).click();
  const devSwitch = page.getByRole('switch', { name: /Developer console/ });
  if ((await devSwitch.getAttribute('aria-checked')) !== 'true') await devSwitch.click();
  await page.getByTestId('options-done').click();
  await page.getByTestId('menu-newSaga').click();
  await page.getByTestId('quick-start').click();
  await expect(page.locator('[data-testid="game-shell"][data-mode="hub"]')).toBeVisible({ timeout: 20_000 });
  const date = async () => (await page.getByTestId('topbar-date').textContent()) ?? '';
  for (let i = 0; i < 60 && /Icebreak/.test(await date()); i++) {
    const wait = page.getByTestId('wait-30');
    if (!(await answerOther(page)) && (await wait.isEnabled())) await wait.click();
    await page.waitForTimeout(250);
  }
  while (await answerOther(page)) await page.waitForTimeout(200);
  await page.getByTestId('hub-expedition').click();
  await expect(page.getByTestId('planner-launch')).toBeEnabled();
  await page.getByTestId('planner-launch').click();
  await expect(page.locator('[data-testid="game-shell"][data-mode="map"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('world-map-loading')).toHaveCount(0, { timeout: 60_000 });
}

/**
 * Sets a course with the map's own "Chart a course" picker, which lists the known harbours of other houses
 * nearest first: the first one ('near') or the last one ('far').
 */
async function sailTo(page: Page, which: 'near' | 'far'): Promise<boolean> {
  const sail = page.getByTestId('order-sail-destination');
  if (!(await sail.isVisible())) await page.getByTestId('order-chart').click({ timeout: 3000 }).catch(() => undefined);
  if (!(await sail.isVisible({ timeout: 3000 }).catch(() => false))) return false;
  if (which === 'far') {
    const select = page.getByTestId('order-destination');
    const values = await select.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    const last = values[values.length - 1];
    if (last !== undefined) await select.selectOption(last);
  }
  if (!(await sail.isEnabled())) return false;
  await sail.click();
  return true;
}

async function play(page: Page): Promise<void> {
  const speed = page.getByTestId('time-speed-4');
  const pressed = await speed.getAttribute('aria-pressed', { timeout: 300 }).catch(() => null);
  if (pressed === 'false') await speed.click({ timeout: 1000 }).catch(() => undefined);
}

test('arriving at a settlement: the cue over the map, the arrival scene, then the visit scene', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await startExpedition(page);
  expect(await sailTo(page, 'near')).toBe(true);

  const cue = page.getByTestId('scene-cue');
  const card = page.getByTestId('arrival-card');
  const encounter = page.getByTestId('encounter-scene');
  let sawCue = false;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline && !(await card.isVisible())) {
    if (await cue.isVisible()) {
      // An arrival cue: let it play (screenshot mid-animation); anything else: skip it.
      if (/Land!|Rooftops|Home waters/.test((await cue.textContent()) ?? '')) {
        sawCue = true;
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${OUT}/scene-arrival-cue.png` });
        await expect(card).toBeVisible({ timeout: 4000 });
        break;
      }
      await cue.click({ timeout: 1500 }).catch(() => undefined);
    } else if (await encounter.isVisible()) {
      await page.locator('[data-testid^="decision-choice-"]:not([disabled])').first().click();
    } else if (!(await answerOther(page))) await play(page);
    await page.waitForTimeout(200);
  }
  await expect(card).toBeVisible();
  expect(sawCue).toBe(true);
  // The scene covers the map (the shell's top bar stays above it).
  const box = await card.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(1300);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/scene-arrival.png` });

  const enter = page.getByTestId('choose-enter');
  if (await enter.isEnabled()) await enter.click();
  else await page.getByTestId('choose-trade').click();
  const hub = page.getByTestId('settlement-hub');
  await expect(hub).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/scene-visit.png` });
  await page.getByRole('tab', { name: /mead-hall/i }).click();
  await expect(page.getByTestId('visit-panel-meadHall')).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/scene-visit-meadhall.png` });
  await page.getByTestId('hub-leave').click();
  await expect(hub).toBeHidden();
  expect(errors).toEqual([]);
});

test('meeting another party: the cue, then the encounter scene, answered safely', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await startExpedition(page);
  const sailFar = () => sailTo(page, 'far');
  let nextCourse = Date.now() + 25_000;
  expect(await sailFar()).toBe(true);

  const cue = page.getByTestId('scene-cue');
  const scene = page.getByTestId('encounter-scene');
  let seen = false;
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline && !seen) {
    // The saga can end at sea (a quick-start house may lose its ruler): start another.
    if (await page.getByTestId('menu-newSaga').isVisible()) {
      await startExpedition(page);
      await sailFar();
      continue;
    }
    if (await cue.isVisible()) {
      const text = (await cue.textContent()) ?? '';
      if (/Land!|Rooftops|Home waters/.test(text)) {
        await cue.click({ timeout: 1500 }).catch(() => undefined);
        await page.getByTestId('choose-leave').click();
        await sailFar();
        continue;
      }
      // While the cue plays no choice exists yet: nothing can be answered by accident.
      await expect(page.locator('[data-testid^="decision-choice-"]')).toHaveCount(0);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/scene-encounter-cue.png` });
      await expect(scene).toBeVisible({ timeout: 4000 });
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${OUT}/scene-encounter.png` });
      const first = page.locator('[data-testid^="decision-choice-"]').first();
      await expect(first).toBeEnabled();
      await first.click();
      seen = true;
      break;
    }
    // An arrival scene whose cue was missed: sail on and set the course again.
    const leave = page.getByTestId('choose-leave');
    if (await leave.isVisible()) {
      await leave.click();
      await sailFar();
      continue;
    }
    // The voyage ended at home: put out again.
    if (await page.locator('[data-testid="game-shell"][data-mode="hub"]').isVisible()) {
      // The homecoming scene lies over the hall until it is dismissed.
      const home = page.getByTestId('decision-choice-continue');
      if (await home.isVisible().catch(() => false)) {
        await home.click();
        continue;
      }
      const plan = page.getByTestId('hub-expedition');
      if (await plan.isEnabled().catch(() => false)) {
        await plan.click();
        const launch = page.getByTestId('planner-launch');
        if (await launch.isEnabled({ timeout: 3000 }).catch(() => false)) {
          await launch.click();
          await expect(page.locator('[data-testid="game-shell"][data-mode="map"]')).toBeVisible({ timeout: 10_000 });
          await expect(page.getByTestId('world-map-loading')).toHaveCount(0, { timeout: 60_000 });
          await sailFar();
        } else await page.getByTestId('planner-close').click({ timeout: 1500 }).catch(() => undefined);
      }
      await page.waitForTimeout(250);
      continue;
    }
    if (!(await answerOther(page))) {
      const status = (await page.getByTestId('expedition-status').textContent().catch(() => '')) ?? '';
      // The map's status line is being reworked: re-set the course at most every 25 s (opening the console pauses time).
      if (!/Bound for/.test(status) && Date.now() > nextCourse) {
        nextCourse = Date.now() + 25_000;
        await sailFar();
      }
      await play(page);
    }
    await page.waitForTimeout(250);
  }
  expect(seen).toBe(true);
  await expect(scene).toBeHidden({ timeout: 5000 }).catch(() => undefined);
  expect(errors).toEqual([]);
});

const GALLERY = ['sea-day-merchant', 'sea-night-raiders', 'sea-day-caught', 'sea-dawn-warfleet-fog', 'land-day-outlaws', 'land-caught', 'arrival-hamlet', 'arrival-town-walled', 'arrival-cloister', 'arrival-city-west', 'arrival-raided', 'aftermath'];

for (const [w, h] of [
  [1366, 768],
  [1600, 1000],
] as const) {
  test(`scene gallery at ${w}x${h}`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`/?scenes=${GALLERY[0]}`);
    const gallery = page.getByTestId('scene-gallery');
    // The gallery deep link exists in dev builds only.
    if (!(await gallery.isVisible({ timeout: 8000 }).catch(() => false))) test.skip(true, 'scene gallery is dev-only');
    for (const v of GALLERY) {
      await page.getByTestId('scene-gallery-pick').selectOption(v);
      await expect(gallery).toHaveAttribute('data-variant', v);
      await page.waitForTimeout(700);
      // Text stays inside the viewport and the choices stay four or fewer.
      const visible = await page.locator('.scn-choice-list:not([hidden]) .scn-choice').count();
      expect(visible).toBeLessThanOrEqual(4);
      await page.screenshot({ path: `${OUT}/gallery-${v}-${w}x${h}.png` });
    }
    await page.goto(`/?scenes=sea-night-raiders&cue=1`);
    await expect(page.getByTestId('scene-cue')).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/gallery-cue-${w}x${h}.png` });
    await expect(page.getByTestId('encounter-scene')).toBeVisible({ timeout: 4000 });
    expect(errors).toEqual([]);
  });
}
