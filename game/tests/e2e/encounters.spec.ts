import { expect, test, type Page } from '@playwright/test';

/**
 * Encounters at sea through the real UI (the dev console, switched on in Options, sets a long course): quick start, wait out
 * the ice, launch an expedition, sail far, and answer what is sighted (an attention cue, then the full-screen encounter
 * scene, §20.7). The first encounter is answered
 * with its first choice (always safe); the next one is attacked, which must open the sea-battle (or land
 * battle) setup screen, resolved with auto-resolve. Screenshots land in the output folder for a visual check.
 */

const OUT = process.env.BARDIA_E2E_OUT ?? 'test-results';

async function answerOther(page: Page): Promise<boolean> {
  const cue = page.getByTestId('scene-cue');
  const critical = page.getByTestId('critical-modal').locator('button.btn-primary');
  const ack = page.getByTestId('decision-acknowledge');
  const leave = page.getByTestId('choose-leave');
  const choice = page.locator('[data-testid^="decision-choice-"]:not([disabled])').first();
  // An attention cue (the arrival or encounter scene follows it): skip it.
  if ((await cue.isVisible()) && !/sail|ships|wolves|fleet|on us/i.test((await cue.textContent()) ?? '')) await cue.click({ timeout: 1500 }).catch(() => undefined);
  else if (await critical.isVisible()) await critical.click();
  else if (await ack.isVisible()) await ack.click();
  else if (await leave.isVisible()) await leave.click();
  else if (await choice.isVisible()) await choice.click();
  else return false;
  return true;
}

/** Runs a dev-console command and returns the text of its last output line. */
async function devRun(page: Page, line: string): Promise<string> {
  const input = page.getByTestId('dev-console-input');
  await input.fill(line);
  await input.press('Enter');
  return (await page.getByTestId('dev-console').locator('.devconsole-line').last().textContent()) ?? '';
}

/**
 * Sets a long course through the dev console: from the fleet's last port (or the capital), the sea lane with
 * the most days that the router accepts. Returns the settlement id sailed for.
 */
async function sailFar(page: Page, from: string | null): Promise<string | null> {
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('dev-console-input')).toBeVisible();
  const origin = from ?? JSON.parse(await devRun(page, 'state player.capitalId')) as string;
  const lanes = JSON.parse(await devRun(page, `state worldIndex.settlements.${origin}.lanes`)) as { to: string; seaDays: number | null }[];
  const far = lanes.filter((l) => l.seaDays !== null).sort((x, y) => (y.seaDays ?? 0) - (x.seaDays ?? 0));
  let chosen: string | null = null;
  for (const l of far) {
    if (/Dispatched/.test(await devRun(page, `cmd {"type":"setRoute","to":{"settlementId":"${l.to}"}}`))) {
      chosen = l.to;
      break;
    }
  }
  await page.keyboard.press('Backquote');
  return chosen;
}

test('encounters at sea: a readable card with a safe first choice, and an attack that reaches the battle setup', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  // Release builds keep the developer console off until it is switched on in Options (it sets the long course below).
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
  await page.getByTestId('planner-launch').click();
  await expect(page.locator('[data-testid="game-shell"][data-mode="map"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('world-map-loading')).toHaveCount(0, { timeout: 60_000 });
  let target = await sailFar(page, null);
  expect(target).not.toBeNull();

  // The encounter is a full-screen scene now (§20.7), shown after its attention cue.
  const encounterCard = page.getByTestId('encounter-scene');
  const cue = page.getByTestId('scene-cue');
  let seen = 0;
  let attacked = false;
  const deadline = Date.now() + 200_000;
  let nextShot = Date.now() + 30_000;
  let shots = 0;
  while (Date.now() < deadline && !(seen >= 1 && attacked)) {
    // The saga can end at sea (a quick-start house may lose its ruler): stop and judge what was seen.
    if (await page.getByTestId('menu-newSaga').isVisible()) break;
    if ((await cue.isVisible()) && /sail|ships|wolves|fleet|on us|trees|road|Ambush/i.test((await cue.textContent()) ?? '')) {
      await expect(encounterCard).toBeVisible({ timeout: 4000 });
    }
    if (await encounterCard.isVisible()) {
      seen++;
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/encounter-${seen}.png` });
      const first = encounterCard.locator('[data-testid^="decision-choice-"]').first();
      await expect(first).toBeEnabled();
      const attack = page.locator('[data-testid="decision-choice-attack"]:not([disabled])');
      if (seen >= 2 && !attacked && (await attack.isVisible())) {
        await attack.click();
        const setup = page.locator('[data-testid="sea-battle-setup"], [data-testid="battle-setup"]');
        await expect(setup).toBeVisible({ timeout: 5000 });
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/encounter-battle-setup.png` });
        const auto = page.locator('[data-testid="sea-battle-auto"], [data-testid="battle-auto"]');
        await auto.first().click();
        await expect(setup).toHaveCount(0);
        attacked = true;
      } else {
        await first.click();
      }
      await page.waitForTimeout(250);
      continue;
    }
    if (await answerOther(page)) {
      await page.waitForTimeout(250);
      continue;
    }
    if (Date.now() > nextShot) {
      nextShot = Date.now() + 30_000;
      shots++;
      await page.screenshot({ path: `${OUT}/encounter-progress-${shots}.png` });
      console.log(`progress ${shots}: ${await date()} | ${(await page.getByTestId('expedition-status').textContent().catch(() => '')) ?? ''}`);
    }
    // Arrived or stopped: set another long course.
    const status = (await page.getByTestId('expedition-status').textContent().catch(() => '')) ?? '';
    if (!/Bound for/.test(status)) {
      target = (await sailFar(page, target)) ?? (await sailFar(page, null));
    }
    const play = page.getByTestId('time-speed-4');
    const pressed = await play.getAttribute('aria-pressed', { timeout: 300 }).catch(() => null);
    if (pressed === 'false') await play.click({ timeout: 1000 }).catch(() => undefined);
    await page.waitForTimeout(250);
  }
  expect(seen).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
