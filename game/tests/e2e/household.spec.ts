import { expect, test, type Page } from '@playwright/test';

/**
 * The household screens through the real UI: quick start, then the character sheet, the family,
 * the chronicle (top bar), and the longhouse, rune-seer and grove (hub hotspots; each is a room, and
 * its menu is behind the one person in it). Each screen is opened, checked for its core content,
 * screenshotted into the output folder and closed.
 */

const OUT = process.env.BARDIA_E2E_OUT ?? 'test-results';

async function start(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await page.getByTestId('menu-newSaga').click();
  await page.getByTestId('quick-start').click();
  await expect(page.locator('[data-testid="game-shell"][data-mode="hub"]')).toBeVisible({ timeout: 20_000 });
  // Answer anything that greets the new ruler (a message or critical alert) so overlays can open.
  for (let i = 0; i < 5; i++) {
    const critical = page.getByTestId('critical-modal').locator('button.btn-primary');
    const ack = page.getByTestId('decision-acknowledge');
    if (await critical.isVisible()) await critical.click();
    else if (await ack.isVisible()) await ack.click();
    else break;
  }
}

/** Clicks a hub hotspot, retrying while the hub (rebuilt by another agent) settles. */
async function openHotspot(page: Page, id: string): Promise<void> {
  const spot = page.getByTestId(`hotspot-${id}`);
  await expect(spot).toBeVisible({ timeout: 15_000 });
  await spot.click();
}

test('character, family and chronicle open from the top bar', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await start(page);

  await page.getByTestId('nav-character').click();
  const sheet = page.getByTestId('character');
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId('character-name')).not.toBeEmpty();
  // Six skill bars and the standing of the house on the face of the sheet; the rest behind Details.
  await expect(page.getByTestId('character-skills').locator('[data-testid^="skill-"]')).toHaveCount(6);
  await expect(page.getByTestId('standing-renown')).toBeVisible();
  await expect(page.getByTestId('attr-might')).toBeHidden();
  await page.waitForTimeout(600); // let the overlay finish fading in
  await page.screenshot({ path: `${OUT}/character.png` });
  await page.getByTestId('character-close').click();
  await expect(sheet).toBeHidden();

  await page.getByTestId('nav-family').click();
  await expect(page.getByTestId('family')).toBeVisible();
  await expect(page.getByTestId('family-heir')).toBeVisible();
  await page.waitForTimeout(600); // let the overlay finish fading in
  await page.screenshot({ path: `${OUT}/family.png` });
  // Choosing a person brings them forward; from there their character sheet opens.
  await page.getByTestId('family-ruler-card').click();
  await expect(page.getByTestId('family-focus')).toBeVisible();
  await page.getByTestId('family-open-sheet').click();
  await expect(page.getByTestId('character-sheet')).toBeVisible();
  await page.getByTestId('character-close').click();
  await expect(page.getByTestId('family')).toBeVisible();
  await page.getByTestId('family-close').click();

  await page.getByTestId('nav-chronicle').click();
  await expect(page.getByTestId('chronicle')).toBeVisible();
  await expect(page.getByTestId('chronicle-count')).toBeVisible();
  await page.waitForTimeout(600); // let the overlay finish fading in
  await page.screenshot({ path: `${OUT}/chronicle.png` });
  await page.getByTestId('chronicle-close').click();
  expect(errors).toEqual([]);
});

test('longhouse, rune-seer and grove open from the hub and act on the saga', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await start(page);

  await openHotspot(page, 'longhouse');
  await expect(page.getByTestId('longhouse')).toBeVisible();
  await page.getByTestId('interior-person-houseElder').click();
  await expect(page.getByTestId('longhouse-summary')).toBeVisible();
  await page.getByTestId('office-envoy').click();
  await expect(page.getByTestId('longhouse-focus')).toHaveAttribute('data-office', 'envoy');
  await page.waitForTimeout(600); // let the overlay finish fading in
  await page.screenshot({ path: `${OUT}/longhouse.png` });
  await page.getByTestId('interior-leave').click();
  await expect(page.getByTestId('longhouse')).toHaveCount(0);

  await openHotspot(page, 'seer');
  await expect(page.getByTestId('seer')).toBeVisible();
  await page.getByTestId('interior-person-seer').click();
  const read = page.getByTestId('seer-read');
  if (await read.isEnabled()) {
    await read.click();
    await expect(page.getByTestId('omen-voyage')).not.toHaveAttribute('data-omen', 'none');
    await expect(read).toBeDisabled();
  }
  await page.waitForTimeout(600); // let the overlay finish fading in
  await page.screenshot({ path: `${OUT}/seer.png` });
  await page.getByTestId('interior-leave').click();
  await expect(page.getByTestId('seer')).toHaveCount(0);

  await openHotspot(page, 'grove');
  await expect(page.getByTestId('grove')).toBeVisible();
  await page.getByTestId('interior-person-groveKeeper').click();
  await page.getByTestId('god-select-dunnar').click();
  const offer = page.getByTestId('grove-sacrifice');
  if (await offer.isEnabled()) {
    const before = Number((await page.getByTestId('favor-dunnar').textContent())?.replace('+', '') ?? '0');
    await offer.click();
    await expect
      .poll(async () =>
        Number((await page.getByTestId('favor-dunnar').textContent())?.replace('+', '') ?? '0'),
      )
      .toBeGreaterThan(before);
  }
  await page.waitForTimeout(600); // let the overlay finish fading in
  await page.screenshot({ path: `${OUT}/grove.png` });
  await page.getByTestId('interior-leave').click();
  await expect(page.getByTestId('grove')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('every New Saga choice reaches the ruler: full wizard to character sheet', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await page.getByTestId('menu-newSaga').click();
  const next = page.getByTestId('wizard-next');

  // 1. Identity
  await page.getByTestId('saga-name').fill('Thorvi');
  await next.click();
  // 2. Homeland
  await page.getByTestId('homeland-skarn').click();
  await next.click();
  // 3. Parentage: the mother was the slain Jarl.
  await page.getByTestId('parentage-mother').click();
  await next.click();
  // 4. Upbringing: Seer-touched (runecraft +2, starting trait Seer-Taught).
  await page.getByTestId('upbringing-seerTouched').click();
  await next.click();
  // 5. Skills: clear the recommended spread, then runecraft 4, speechcraft 2.
  const step5 = page.getByTestId('wizard-step-skills');
  for (const minus of await step5.locator('.point-row button:first-of-type').all()) {
    while (await minus.isEnabled()) await minus.click();
  }
  const plus = (id: string) => page.getByTestId(`points-${id}`).locator('.point-ctrl button').last();
  for (let i = 0; i < 4; i++) await plus('runecraft').click();
  for (let i = 0; i < 2; i++) await plus('speechcraft').click();
  await expect(page.getByTestId('total-runecraft')).toHaveText('7'); // 4 + 2 upbringing + 1 Seer-Taught
  await next.click();
  // 6. Attributes: wits +3, vigor +2.
  const step6 = page.getByTestId('wizard-step-attributes');
  for (const minus of await step6.locator('.point-row button:first-of-type').all()) {
    while (await minus.isEnabled()) await minus.click();
  }
  for (let i = 0; i < 3; i++) await plus('wits').click();
  for (let i = 0; i < 2; i++) await plus('vigor').click();
  await next.click();
  // 7. Trait: Lucky, no flaw.
  await page.getByTestId('trait-lucky').click();
  await next.click();
  // 8. Jarldom: the first offered.
  const jarl = page.locator('[data-testid^="jarldom-"]:not([data-testid="jarldom-fate"])').first();
  await jarl.click();
  await next.click();
  // 9. Difficulty
  await page.getByTestId('difficulty-raider').click();
  await next.click();
  // 10. Confirm and begin.
  await expect(page.getByTestId('wizard-step-confirm')).toBeVisible();
  await next.click();
  await expect(page.locator('[data-testid="game-shell"][data-mode="hub"]')).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 5; i++) {
    const critical = page.getByTestId('critical-modal').locator('button.btn-primary');
    const ack = page.getByTestId('decision-acknowledge');
    if (await critical.isVisible()) await critical.click();
    else if (await ack.isVisible()) await ack.click();
    else break;
  }

  await page.getByTestId('nav-character').click();
  await expect(page.getByTestId('character-name')).toHaveText('Thorvi');
  await expect(page.getByTestId('skill-runecraft').locator('.hh-stat-value')).toHaveText('6');
  await expect(page.getByTestId('character-known')).toContainText('Runecraft');
  await expect(page.getByTestId('trait-seerTaught')).toBeVisible();
  await expect(page.getByTestId('trait-lucky')).toBeVisible();
  // Attributes, every skill and the life story are behind Details.
  await page.getByTestId('character-details-toggle').click();
  await expect(page.getByTestId('attr-wits').locator('.hh-stat-value')).toHaveText('7');
  await expect(page.getByTestId('attr-vigor').locator('.hh-stat-value')).toHaveText('6');
  await page.getByRole('tab', { name: 'All skills' }).click();
  await expect(page.getByTestId('skillrow-speechcraft').locator('.hh-stat-value')).toHaveText('2');
  await page.getByRole('tab', { name: 'Life' }).click();
  await expect(page.getByTestId('character-upbringing')).toContainText('Seer-touched');
  await page.waitForTimeout(600); // let the overlay finish fading in
  await page.screenshot({ path: `${OUT}/wizard-ruler.png` });
  expect(errors).toEqual([]);
});
