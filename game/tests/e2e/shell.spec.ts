import { expect, test, type Page } from '@playwright/test';

/**
 * Client shell end to end (installed Chrome, production build): the main menu, Quick Start into
 * the hub, Options persisting across a reload, saving and continuing through IndexedDB, keyboard
 * navigation and the developer console. Selectors are the shell's data-testids, so other agents'
 * scenes (the real hub, the map) can replace the placeholders without breaking these tests.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function quickStart(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.getByTestId('menu-newSaga').click();
  await expect(page.getByTestId('new-saga')).toBeVisible();
  await page.getByTestId('quick-start').click();
  await expect(page.getByTestId('game-shell')).toBeVisible();
}

const textScale = (page: Page) => page.evaluate(() => document.documentElement.style.getPropertyValue('--text-scale'));

test.describe('client shell', () => {
  test('main menu → Quick Start → hub → Options: text size persists after reload', async ({ page }) => {
    const errors = collectErrors(page);
    await quickStart(page);

    // The hub scene is on screen (whichever screen serves mode 'hub'), with the top bar.
    await expect(page.locator('[data-testid="game-shell"][data-mode="hub"]')).toBeVisible();
    await expect(page.getByTestId('scene-placeholder')).toHaveCount(0);
    await expect(page.getByTestId('topbar-ruler')).not.toBeEmpty();
    await expect(page.getByTestId('topbar-date')).toContainText('812');

    // Options from the in-game menu.
    await page.getByTestId('nav-menu').click();
    await expect(page.getByTestId('game-menu')).toBeVisible();
    await page.getByTestId('gm-options').click();
    await expect(page.getByTestId('options')).toBeVisible();
    await page.getByRole('tab', { name: 'Accessibility' }).click();
    const field = page.getByTestId('options-text-size').getByRole('textbox');
    await field.fill('130');
    await field.press('Enter');
    await expect.poll(() => textScale(page)).toBe('1.3');
    const bodySize = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
    expect(bodySize).toBeGreaterThan(20);

    // Reload: the setting survives and is applied before anything renders.
    await page.reload();
    await expect(page.getByTestId('main-menu')).toBeVisible();
    expect(await textScale(page)).toBe('1.3');
    await page.getByTestId('menu-options').click();
    await page.getByRole('tab', { name: 'Accessibility' }).click();
    await expect(page.getByTestId('options-text-size').getByRole('textbox')).toHaveValue('130');
    expect(errors).toEqual([]);
  });

  test('saving to a slot and continuing it after a reload (IndexedDB)', async ({ page }) => {
    const errors = collectErrors(page);
    await quickStart(page);
    const ruler = (await page.getByTestId('topbar-ruler').textContent()) ?? '';
    await page.getByTestId('nav-menu').click();
    await page.getByTestId('gm-save').click();
    await page.getByTestId('save-name').fill('Before the storm');
    await page.getByTestId('save-new').click();
    await expect(page.getByTestId('save-row-manual-1')).toContainText('Before the storm');

    await page.reload();
    const cont = page.getByTestId('menu-continue');
    await expect(cont).toBeEnabled();
    await cont.click();
    await expect(page.getByTestId('game-shell')).toBeVisible();
    await expect(page.getByTestId('topbar-ruler')).toHaveText(ruler);
    expect(errors).toEqual([]);
  });

  test('keyboard: Escape opens and closes the game menu; top-bar screens without a chamber say so', async ({ page }) => {
    const errors = collectErrors(page);
    await quickStart(page);
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('game-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('game-menu')).toHaveCount(0);
    // Every top-bar button opens something: its screen, or the Coming-soon card.
    for (const id of ['character', 'family', 'ledger', 'chronicle', 'sagaLedger', 'codex']) {
      await page.getByTestId(`nav-${id}`).click();
      await expect(page.locator(`[data-testid="route-${id}"], [data-testid="coming-soon"]`).first()).toBeVisible();
      await page.keyboard.press('Escape');
    }
    expect(errors).toEqual([]);
  });

  test('the developer console can be enabled in Options and inspects the saga', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await page.getByTestId('menu-options').click();
    await page.getByRole('tab', { name: 'Gameplay' }).click();
    await page.getByRole('switch', { name: /Developer console/ }).click();
    await page.getByTestId('options-done').click();
    await page.getByTestId('menu-newSaga').click();
    await page.getByTestId('quick-start').click();
    await expect(page.getByTestId('game-shell')).toBeVisible();
    await page.keyboard.press('Backquote');
    const input = page.getByTestId('dev-console-input');
    await expect(input).toBeFocused();
    await input.fill('advance 3');
    await input.press('Enter');
    await expect(page.getByTestId('dev-console')).toContainText('4 Icebreak 812');
    await input.press('Escape');
    await expect(page.getByTestId('dev-console')).toHaveCount(0);
    await expect(page.getByTestId('topbar-date')).toContainText('4 Icebreak 812');
    expect(errors).toEqual([]);
  });
});

/**
 * Event cards carry their picture (DecisionHost EventPicture): the steward's monthly tally (ledger pause on)
 * shows the storehouse, and every other card met on the way (storylets, the people module's cards) shows its
 * own picture. At 1280×720 the choices stay in view without scrolling; screenshots at the three reference
 * sizes land in the output folder.
 */
test.describe('event cards', () => {
  const OUT = process.env.BARDIA_E2E_OUT ?? 'test-results';

  /** Runs a developer-console line; returns its last output line. */
  async function devLine(page: Page, line: string): Promise<string> {
    await page.keyboard.press('Backquote');
    const input = page.getByTestId('dev-console-input');
    await expect(input).toBeVisible();
    await input.fill(line);
    await input.press('Enter');
    const out = (await page.getByTestId('dev-console').locator('.devconsole-line').last().textContent()) ?? '';
    await page.keyboard.press('Backquote');
    await expect(page.getByTestId('dev-console-input')).toHaveCount(0);
    return out;
  }

  async function newSagaWithConsole(page: Page): Promise<void> {
    await page.goto('/');
    await page.getByTestId('menu-options').click();
    await page.getByRole('tab', { name: 'Gameplay' }).click();
    const devSwitch = page.getByRole('switch', { name: /Developer console/ });
    if ((await devSwitch.getAttribute('aria-checked')) !== 'true') await devSwitch.click();
    await page.getByTestId('options-done').click();
    await page.getByTestId('menu-newSaga').click();
    await page.getByTestId('quick-start').click();
    await expect(page.getByTestId('game-shell')).toBeVisible({ timeout: 20_000 });
  }

  /** Answers whatever card or alert is up; false when nothing is. */
  async function answerAny(page: Page): Promise<boolean> {
    const critical = page.getByTestId('critical-modal').locator('button.btn-primary');
    if (await critical.isVisible()) {
      await critical.click();
      return true;
    }
    const ack = page.getByTestId('decision-acknowledge');
    if (await ack.isVisible()) {
      await ack.click();
      return true;
    }
    const choice = page.locator('[data-testid^="decision-choice-"]:not([disabled])').first();
    if (await choice.isVisible()) {
      await choice.click();
      return true;
    }
    return false;
  }

  /** The choices (or the acknowledge button) are inside the window, with no scrolling. */
  async function choicesInView(page: Page): Promise<void> {
    const vp = page.viewportSize();
    const buttons = page.locator('[data-testid="generic-decision"] .frame-footer button');
    const n = await buttons.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const box = await buttons.nth(i).boundingBox();
      expect(box).not.toBeNull();
      if (box && vp) expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    }
    const picture = await page.getByTestId('decision-picture').boundingBox();
    expect(picture?.height ?? 0).toBeGreaterThan(80);
  }

  test('the monthly tally and the other event cards show their pictures, choices in view', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await newSagaWithConsole(page);
    await devLine(page, 'cmd {"type":"setPolicy","policy":"ledgerPause","value":"always"}');

    const seen = new Set<string>();
    const card = page.getByTestId('generic-decision');
    for (let i = 0; i < 60 && !seen.has('narrative.vignette.storehouse'); i++) {
      if (await card.isVisible()) {
        const picture = card.getByTestId('decision-picture');
        if (await picture.isVisible()) {
          const id = (await picture.getAttribute('data-asset-id')) ?? '';
          await expect(picture).toHaveAttribute('data-final', 'yes');
          await expect(picture.locator('img')).toHaveJSProperty('complete', true);
          await choicesInView(page);
          if (!seen.has(id)) {
            for (const [w, h] of [[1280, 720], [1366, 768], [1920, 1080]] as const) {
              await page.setViewportSize({ width: w, height: h });
              await page.waitForTimeout(150);
              await choicesInView(page);
              await page.screenshot({ path: `${OUT}/event-card-${id}-${w}x${h}.png` });
            }
            await page.setViewportSize({ width: 1280, height: 720 });
          }
          seen.add(id);
        }
        const ack = card.getByTestId('decision-acknowledge');
        if (await ack.isVisible()) await ack.click();
        else await card.locator('[data-testid^="decision-choice-"]:not([disabled])').first().click();
        continue;
      }
      const critical = page.getByTestId('critical-modal').locator('button.btn-primary');
      if (await critical.isVisible()) {
        await critical.click();
        continue;
      }
      if (await page.locator('[data-testid^="pending-"]').first().isVisible()) {
        const choice = page.locator('[data-testid^="decision-choice-"]:not([disabled])').first();
        if (await choice.isVisible()) await choice.click();
        else break;
        continue;
      }
      await devLine(page, 'cmd {"type":"wait","days":10}');
      await page.waitForTimeout(200);
    }
    expect([...seen]).toContain('narrative.vignette.storehouse');
    expect(errors).toEqual([]);
  });

  test('a finished muster waits in the inbox with its picture: a thumbnail, the whole picture when opened', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1366, height: 768 });
    await newSagaWithConsole(page);
    const capital = JSON.parse(await devLine(page, 'state player.capitalId')) as string;
    expect(await devLine(page, `cmd {"type":"muster","holdingId":"${capital}","units":{"bondi":5}}`)).toMatch(/muster/);
    const thumb = page.locator('[data-testid="inbox-thumb-picture"][data-asset-id="military.illus.muster"]').first();
    for (let i = 0; i < 12; i++) {
      while (await answerAny(page)) await page.waitForTimeout(150);
      await devLine(page, 'cmd {"type":"wait","days":5}');
      while (await answerAny(page)) await page.waitForTimeout(150);
      await page.getByTestId('nav-inbox').click();
      await expect(page.getByTestId('inbox')).toBeVisible();
      if ((await thumb.count()) > 0) break;
      await page.getByTestId('inbox-close').click();
    }
    await expect(thumb).toBeVisible();
    await thumb.click();
    const picture = page.getByTestId('inbox-picture');
    await expect(picture).toHaveAttribute('data-asset-id', 'military.illus.muster');
    await expect(picture).toHaveAttribute('data-final', 'yes');
    await expect(picture.locator('img')).toHaveJSProperty('complete', true);
    for (const [w, h] of [[1280, 720], [1366, 768], [1920, 1080]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${OUT}/inbox-muster-${w}x${h}.png` });
    }
    expect(errors).toEqual([]);
  });
});
