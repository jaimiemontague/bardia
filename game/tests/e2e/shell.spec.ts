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
