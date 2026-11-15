import { expect, test, type Page } from '@playwright/test';

/**
 * The Home Hall hub (SCR-05): each homeland's village painting is shown, and its labels sit on their own painted
 * buildings at every window size from 1280×720 to 1920×1080 (the label's centre lies on or just above its
 * building, no two labels overlap, none is clipped),
 * the buildings open their screens (the Great hall and the Smithy as rooms with people in them), the Counsel (one piece of advice at a time) and the First Voyage tell a new
 * player what to do next, and the Expedition Planner moves men and food with its two-sided handles (keyboard and
 * pointer) and launches.
 * Screenshots land in the output folder (BARDIA_E2E_OUT) for a visual check.
 */
const OUT = process.env.BARDIA_E2E_OUT ?? 'test-results';
const SIZES: readonly [number, number][] = [
  [1280, 720],
  [1366, 768],
  [1600, 1000],
  [1920, 1080],
];
const HOMELANDS = ['skarn', 'hvarn', 'eyjar'] as const;
const IDS = ['greatHall', 'longhouse', 'meadHall', 'smithy', 'shipyard', 'market', 'seer', 'grove'] as const;

async function quickStart(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('menu-newSaga').click();
  await page.getByTestId('quick-start').click();
  await expect(page.locator('[data-testid="game-shell"][data-mode="hub"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('hub')).toBeVisible();
  await clearOpening(page);
}

/** Answers any opening message so nothing covers the hall. */
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

/** A new saga from this homeland, everything else recommended, into the hub. */
async function startIn(page: Page, homeland: string): Promise<void> {
  await page.goto('/');
  await page.getByTestId('menu-newSaga').click();
  await page.getByTestId('step-homeland').click();
  await page.getByTestId(`homeland-${homeland}`).click();
  const shell = page.locator('[data-testid="game-shell"][data-mode="hub"]');
  for (let i = 0; i < 14 && !(await shell.isVisible()); i++) {
    const next = page.getByTestId('wizard-next');
    if (await next.isVisible()) {
      if (await next.isDisabled()) await page.getByTestId('wizard-recommended').click();
      await next.click();
    }
    await page.waitForTimeout(250);
  }
  await expect(shell).toBeVisible({ timeout: 20_000 });
  await clearOpening(page);
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function distanceToBox(px: number, py: number, b: Box): number {
  const dx = Math.max(b.x - px, 0, px - (b.x + b.width));
  const dy = Math.max(b.y - py, 0, py - (b.y + b.height));
  return Math.hypot(dx, dy);
}

/** Every label on its own building, none clipped, none on another building or label, at every size. */
async function checkLabels(page: Page, tag: string): Promise<void> {
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    const picture = (await page.locator('.hub-picture').boundingBox()) as Box;
    expect(picture.width).toBeGreaterThan(300);
    // The picture keeps the village's aspect (1300 × 1000), so the labels cannot drift.
    expect(Math.abs(picture.width / picture.height - 1.3), `${tag} aspect at ${w}×${h}`).toBeLessThan(0.01);
    const labels: Record<string, Box> = {};
    const buildings: Record<string, Box> = {};
    for (const id of IDS) {
      labels[id] = (await page.getByTestId(`hotspot-${id}`).boundingBox()) as Box;
      buildings[id] = (await page.locator(`[data-building-id="${id}"] .hv-hit`).boundingBox()) as Box;
    }
    for (const id of IDS) {
      const l = labels[id] as Box;
      const b = buildings[id] as Box;
      const cx = l.x + l.width / 2;
      const cy = l.y + l.height / 2;
      // On or right above its own building (within 5% of the picture's height).
      expect(distanceToBox(cx, cy, b), `${tag} ${id} label at ${w}×${h}`).toBeLessThanOrEqual(picture.height * 0.05);
      // Not clipped by the picture.
      expect(l.x, `${tag} ${id} left edge at ${w}×${h}`).toBeGreaterThanOrEqual(picture.x - 1);
      expect(l.x + l.width, `${tag} ${id} right edge at ${w}×${h}`).toBeLessThanOrEqual(picture.x + picture.width + 1);
      expect(l.y, `${tag} ${id} top edge at ${w}×${h}`).toBeGreaterThanOrEqual(picture.y - 1);
      expect(l.y + l.height, `${tag} ${id} bottom edge at ${w}×${h}`).toBeLessThanOrEqual(picture.y + picture.height + 1);
      for (const other of IDS) {
        if (other === id) continue;
        expect(overlap(l, labels[other] as Box), `${tag} ${id} and ${other} labels overlap at ${w}×${h}`).toBe(false);
        // A label never sits on another building.
        expect(distanceToBox(cx, cy, buildings[other] as Box) > 0, `${tag} ${id} label lies on the ${other} at ${w}×${h}`).toBe(true);
      }
    }
    await page.screenshot({ path: `${OUT}/hub-${tag}-${w}x${h}.png` });
  }
}

for (const homeland of HOMELANDS) {
  test(`the ${homeland} village painting: every label on its own building at 1280×720 to 1920×1080`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.setViewportSize({ width: 1600, height: 1000 });
    await startIn(page, homeland);
    const village = page.getByTestId('hub-village');
    await expect(village).toHaveAttribute('data-final', 'yes');
    await expect(village).toHaveAttribute('data-culture', homeland);
    // The ships on the strand keep their click area and count.
    await expect(page.getByTestId('hub-ships')).toHaveAttribute('data-count', /^\d+$/);
    await checkLabels(page, homeland);
    expect(errors).toEqual([]);
  });
}

test('the homeland cards show their pictures, and the step does not scroll at 1920×1080', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await page.getByTestId('menu-newSaga').click();
  await page.getByTestId('step-homeland').click();
  for (const homeland of HOMELANDS) {
    const img = page.getByTestId(`homeland-${homeland}`).locator('.choice-card-picture img');
    await expect(img).toHaveAttribute('data-asset-id', `menu.homeland.${homeland}`);
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  const scroll = page.locator('.wizard-scroll');
  expect(await scroll.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await page.screenshot({ path: `${OUT}/new-saga-homeland-1920x1080.png` });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/new-saga-homeland-1280x720.png` });
});

test('the hall buildings open their screens', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await quickStart(page);

  // The Great hall is a room: the Hirdmaster on the high seat holds the realm and the muster.
  await page.getByTestId('hotspot-greatHall').click();
  await expect(page.getByTestId('great-hall')).toBeVisible();
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/hub-great-hall.png` });
  await page.getByTestId('interior-person-hirdmaster').click();
  await expect(page.getByTestId('great-hall-realm')).toBeVisible();
  await page.getByRole('tab', { name: /Muster/ }).click();
  await expect(page.getByTestId('muster')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/hub-muster.png` });
  // Esc closes the Hirdmaster's panel first, then leaves the hall.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('muster')).toHaveCount(0);
  await expect(page.getByTestId('great-hall')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('great-hall')).toHaveCount(0);

  await page.getByTestId('hotspot-shipyard').click();
  await expect(page.getByTestId('shipyard')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/hub-shipyard.png` });
  await page.keyboard.press('Escape');

  await page.getByTestId('hotspot-smithy').click();
  await expect(page.getByTestId('smithy')).toBeVisible();
  await page.getByTestId('interior-person-smith').click();
  await expect(page.getByTestId('smithy-armour')).toBeVisible();
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/hub-smithy.png` });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('smithy')).toHaveCount(0);

  // Hotspots are keyboard-focusable buttons.
  await page.getByTestId('hotspot-market').focus();
  await expect(page.getByTestId('hotspot-market')).toBeFocused();
  expect(errors).toEqual([]);
});

test('the Counsel and the First Voyage say what to do next', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await quickStart(page);
  await expect(page.getByTestId('hub-counsel')).toBeVisible();
  await expect(page.getByTestId('hub-voyage')).toBeVisible();
  await expect(page.getByTestId('voyage-next')).toBeVisible();
  const iced = page.locator('[data-counsel="iced"]');
  if (await iced.isVisible()) {
    // A new game starts on 1 Icebreak; northern harbours are iced in: one click waits out the ice.
    await expect(page.getByTestId('voyage-thaw')).toHaveAttribute('data-done', 'false');
    await page.screenshot({ path: `${OUT}/hub-iced-1600x1000.png` });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/hub-iced-1280x720.png` });
    await page.setViewportSize({ width: 1600, height: 1000 });
    // The planner says why Launch is disabled and offers the same wait.
    await page.getByTestId('hub-expedition').click();
    await expect(page.getByTestId('planner-iced')).toBeVisible();
    await expect(page.getByTestId('planner-launch')).toBeDisabled();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/hub-planner-iced.png` });
    await page.keyboard.press('Escape');
    await page.getByTestId('counsel-iced').click();
    for (let i = 0; i < 20 && (await page.getByTestId('decision-acknowledge').isVisible()); i++) {
      await page.getByTestId('decision-acknowledge').click();
      await page.waitForTimeout(150);
    }
    if (await page.getByTestId('counsel-iced').isVisible()) await page.getByTestId('counsel-iced').click();
    await expect(page.getByTestId('voyage-thaw')).toHaveAttribute('data-done', 'true');
  }
  // The Counsel shows one piece of advice at a time, the most important first; "next" steps through the rest.
  for (let i = 0; i < 8 && !(await page.locator('[data-counsel="plan"]').isVisible()); i++) {
    await page.getByTestId('counsel-next').click();
  }
  await expect(page.locator('[data-counsel="plan"]')).toBeVisible();
  await expect(page.getByTestId('hub-counsel').locator('[data-counsel]')).toHaveCount(1);
  await page.screenshot({ path: `${OUT}/hub-counsel.png` });
  await page.getByTestId('counsel-plan').click();
  await expect(page.getByTestId('expedition-planner')).toBeVisible();
});

/** Waits out the harbour ice from the Counsel (a new game starts on 1 Icebreak) and answers what follows. */
async function thaw(page: Page): Promise<void> {
  for (let tries = 0; tries < 3 && (await page.getByTestId('counsel-iced').isVisible()); tries++) {
    await page.getByTestId('counsel-iced').click();
    for (let i = 0; i < 20 && (await page.getByTestId('decision-acknowledge').isVisible()); i++) {
      await page.getByTestId('decision-acknowledge').click();
      await page.waitForTimeout(150);
    }
  }
}

const amount = async (page: Page, id: string): Promise<number> =>
  Number(((await page.getByTestId(id).textContent()) ?? '').replace(/\D/g, ''));

test('the planner moves men and food between the town and the ships, by keyboard and by pointer', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await quickStart(page);
  await thaw(page);
  await page.getByTestId('hub-expedition').click();
  await expect(page.getByTestId('expedition-planner')).toBeVisible();
  // The default plan is launchable as it stands.
  await expect(page.getByTestId('planner-launch')).toBeEnabled();
  await expect(page.getByTestId('planner-ready').or(page.getByTestId('planner-ready-but'))).toBeVisible();
  await page.screenshot({ path: `${OUT}/planner-1366x768.png` });

  // Keyboard: one step of rations back to the storehouse; both sides follow.
  const aboard = await amount(page, 'planner-rations-right');
  const stored = await amount(page, 'planner-rations-left');
  await page.getByTestId('planner-rations-handle').focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => amount(page, 'planner-rations-right')).toBe(aboard - 10);
  expect(await amount(page, 'planner-rations-left')).toBe(stored + 10);

  // Pointer: drag the first kind of warrior's handle to the town end; all of them stay home.
  const track = page.locator('[data-testid^="planner-men-"][data-testid$="-track"]').first();
  const unitId = ((await track.getAttribute('data-testid')) ?? '').replace(/-track$/, '');
  const handle = page.getByTestId(`${unitId}-handle`);
  const hb = (await handle.boundingBox()) as { x: number; y: number; width: number; height: number };
  const tb = (await track.boundingBox()) as { x: number; y: number; width: number; height: number };
  const sailing = await amount(page, `${unitId}-right`);
  const home = await amount(page, `${unitId}-left`);
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width * 0.9, tb.y + tb.height / 2, { steps: 6 });
  await page.mouse.move(tb.x + tb.width + 40, tb.y + tb.height / 2, { steps: 3 });
  await page.mouse.up();
  await expect.poll(() => amount(page, `${unitId}-right`)).toBe(0);
  expect(await amount(page, `${unitId}-left`)).toBe(home + sailing);

  // Pointer: a click part-way along the provisions track moves food aboard at once.
  const food = page.getByTestId('planner-rations-track');
  const fb = (await food.boundingBox()) as { x: number; y: number; width: number; height: number };
  await page.mouse.click(fb.x + fb.width * 0.9, fb.y + fb.height / 2);
  await expect.poll(() => amount(page, 'planner-rations-right')).toBeLessThan(aboard);

  // Quick muster restores a launchable plan; Launch sails.
  await page.getByTestId('planner-suggest').click();
  await expect(page.getByTestId('planner-launch')).toBeEnabled();
  await page.getByTestId('planner-details-toggle').click();
  await expect(page.getByTestId('planner-silver')).toBeVisible();
  await page.screenshot({ path: `${OUT}/planner-details-1366x768.png` });
  await page.getByTestId('planner-launch').click();
  await expect(page.getByTestId('expedition-planner')).toHaveCount(0);
  expect(errors).toEqual([]);
});
