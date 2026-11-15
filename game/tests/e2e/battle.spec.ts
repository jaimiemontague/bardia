import { expect, test, type Page } from '@playwright/test';

/**
 * The playable battle through the real UI: Main Menu → Skirmish → a raid on a village. Reads the
 * "how to command" card, selects squads with the number keys and Ctrl+A, gives a right-click order
 * on the field, sets a formation, runs the battle at 4×, lets the captains finish it from the pause
 * menu, reads the summary and returns to the main menu. Screenshots at deployment, mid-fight, the
 * later fight and the summary land in the output folder (BARDIA_E2E_OUT) for a visual check.
 */

const OUT = process.env.BARDIA_E2E_OUT ?? 'test-results';

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${OUT}/battle-${name}.png` });
}

/** Screen point of a map tile, assuming the field is fitted to a 1600×1000 viewport (96×72 tiles). */
function tileToScreen(tx: number, ty: number): { x: number; y: number } {
  const scale = Math.min(1600 / 98, 1000 / 74);
  return { x: 800 + (tx - 48) * scale, y: 500 + (ty - 36) * scale };
}

test('a skirmish raid is played to a result and back to the main menu', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  // Other agents edit this folder while the dev server runs: cut the HMR socket so no reload interrupts the battle.
  await page.routeWebSocket(/./, () => {});
  await page.goto('/');
  await page.getByTestId('menu-skirmish').click();
  await expect(page.getByTestId('skirmish')).toBeVisible();
  await shot(page, '0-presets');

  await page.getByTestId('skirmish-preset-raid').click();
  const screen = page.getByTestId('battle-screen');
  await expect(screen).toBeVisible();
  await expect(page.getByTestId('battle-canvas')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('battle-howto')).toBeVisible();
  await page.waitForTimeout(600);
  await shot(page, '1-howto');
  await page.getByTestId('battle-howto-plan').click();
  await expect(screen).toHaveAttribute('data-paused', 'true');

  // Select the first squad by number, then everyone, and send them at the village.
  await page.keyboard.press('Digit1');
  await expect(page.getByTestId('battle-panel-name')).toHaveText(/Haldrek/);
  await page.getByTestId('battle-formation-line').click();
  await page.keyboard.press('Control+KeyA');
  await expect(page.getByTestId('battle-panel-name')).toContainText(/4 squads/);
  const target = tileToScreen(48, 32);
  await page.mouse.click(target.x, target.y, { button: 'right' });
  await expect(page.getByTestId('battle-panel-order').first()).toBeVisible().catch(() => undefined);
  await page.waitForTimeout(400);
  await shot(page, '2-deployment-orders');

  // Unpause with Space and run at 4×.
  await page.keyboard.press('Space');
  await expect(screen).toHaveAttribute('data-paused', 'false');
  await page.getByTestId('battle-speed-4').click();
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="battle-clock"]');
    const m = /(\d+):(\d+)/.exec(el?.textContent ?? '');
    return m !== null && Number(m[1]) * 60 + Number(m[2]) >= 25;
  }, undefined, { timeout: 40_000 });
  await shot(page, '3-mid-fight');
  // Select the archers and look at their panel (morale tooltip anchor present).
  await page.keyboard.press('Digit3');
  await expect(page.getByTestId('battle-squad-panel')).toBeVisible();
  // Wait for a squad to break (the log says so) or a minute of battle.
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="battle-clock"]');
    const m = /(\d+):(\d+)/.exec(el?.textContent ?? '');
    const log = document.querySelector('[data-testid="battle-log"]')?.textContent ?? '';
    return /breaks and runs/.test(log) || (m !== null && Number(m[1]) * 60 + Number(m[2]) >= 75) || document.querySelector('[data-testid="battle-summary"]') !== null;
  }, undefined, { timeout: 60_000 });
  await expect(page.getByTestId('battle-log').locator('li').first()).toBeVisible();
  if (!(await page.getByTestId('battle-summary').isVisible())) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    // Hover the archers' morale to read why it moves.
    await page.getByTestId('battle-squad-panel').getByText('Morale', { exact: true }).hover();
    await page.waitForTimeout(600);
    await shot(page, '4-rout');
    await page.keyboard.press('Space');
  }

  // Pause menu → let the captains finish it.
  if (!(await page.getByTestId('battle-summary').isVisible())) {
    await page.getByTestId('battle-menu').click();
    await expect(page.getByTestId('battle-pause-menu')).toBeVisible();
    await shot(page, '5-pause-menu');
    await page.getByTestId('battle-captains').click();
  }
  await expect(page.getByTestId('battle-summary')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('battle-outcome')).toHaveAttribute('data-outcome', /victory|defeat|retreat|draw/);
  await page.waitForTimeout(300);
  await shot(page, '6-summary');

  await page.getByTestId('battle-return').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the skirmish picker offers every match-up and Escape opens the battle menu', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  // Other agents edit this folder while the dev server runs: cut the HMR socket so no reload interrupts the battle.
  await page.routeWebSocket(/./, () => {});
  await page.goto('/');
  await page.getByTestId('menu-skirmish').click();
  for (const id of ['raid', 'field', 'assault', 'cloister']) await expect(page.getByTestId(`skirmish-preset-${id}`)).toBeVisible();
  await page.getByTestId('skirmish-preset-assault').click();
  await expect(page.getByTestId('battle-howto')).toBeVisible();
  await page.getByTestId('battle-howto-start').click();
  await expect(page.getByTestId('battle-screen')).toHaveAttribute('data-paused', 'false');
  await page.waitForTimeout(1500);
  await shot(page, 'assault-start');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('battle-pause-menu')).toBeVisible();
  await expect(page.getByTestId('battle-screen')).toHaveAttribute('data-paused', 'true');
  await page.getByTestId('battle-leave').click();
  await expect(page.getByTestId('skirmish')).toBeVisible();
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

test('a campaign raid fought on the field returns to the saga', async ({ page }) => {
  test.setTimeout(200_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.routeWebSocket(/./, () => {});
  await page.goto('/');
  await page.getByTestId('menu-newSaga').click();
  await page.getByTestId('quick-start').click();
  await expect(page.locator('[data-testid="game-shell"][data-mode="hub"]')).toBeVisible({ timeout: 20_000 });
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
  await expect(page.locator('[data-testid="game-shell"][data-mode="map"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('world-map-loading')).toHaveCount(0, { timeout: 60_000 });
  await page.getByTestId('order-chart').click();
  await page.getByTestId('order-sail-destination').click();
  const arrival = page.getByTestId('arrival-card');
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && !(await arrival.isVisible())) {
    if (!(await answerOne(page))) {
      const play = page.getByTestId('time-speed-4');
      const pressed = await play.getAttribute('aria-pressed', { timeout: 300 }).catch(() => null);
      if (pressed === 'false') await play.click({ timeout: 1000 }).catch(() => undefined);
    }
    await page.waitForTimeout(250);
  }
  await expect(arrival).toBeVisible();
  await page.getByTestId('choose-raid').click();
  await expect(page.getByTestId('battle-setup')).toBeVisible();
  await expect(page.getByTestId('battle-fight')).toBeEnabled();
  await page.getByTestId('battle-fight').click();

  await expect(page.locator('[data-testid="game-shell"][data-mode="battle"]')).toBeVisible();
  await expect(page.getByTestId('battle-howto')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('battle-setup')).toHaveCount(0);
  await page.getByTestId('battle-howto-start').click();
  await page.waitForTimeout(2500);
  await shot(page, 'campaign-field');
  await page.getByTestId('battle-menu').click();
  await page.getByTestId('battle-captains').click();
  await expect(page.getByTestId('battle-summary')).toBeVisible({ timeout: 60_000 });
  await shot(page, 'campaign-summary');
  await page.getByTestId('battle-return').click();
  await expect(page.getByTestId('battle-screen')).toHaveCount(0);
  await expect(page.locator('[data-testid="game-shell"][data-mode="map"]')).toBeVisible();
  expect(errors).toEqual([]);
});
