import { expect, test, type Page } from '@playwright/test';

/**
 * The household's rooms (render/interiors): from the village, enter the Longhouse, the Seer's hut and the Sacred
 * Grove, click the one person in each, check that the panel fits beside the room with that person still in view,
 * that Esc closes the panel and then leaves, and that the top bar stays readable; and that a screen opened from a
 * panel (the family) comes back to it. Screenshots at 1366×768 and 1600×1000 (room alone, and the room with each
 * panel open) land in BARDIA_E2E_OUT as interior-<room>-<w>x<h>[-<person>].png.
 */
const OUT = process.env.BARDIA_E2E_OUT ?? 'test-results';
const SIZES: readonly [number, number][] = [
  [1366, 768],
  [1600, 1000],
];
const ROOMS: readonly { id: string; stage: string; people: readonly string[]; content: Record<string, string> }[] = [
  { id: 'longhouse', stage: 'longhouse', people: ['houseElder'], content: { houseElder: 'longhouse-summary' } },
  { id: 'seer', stage: 'seer', people: ['seer'], content: { seer: 'seer-read' } },
  { id: 'grove', stage: 'grove', people: ['groveKeeper'], content: { groveKeeper: 'grove-offering' } },
];

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function clearViteOverlay(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelectorAll('vite-error-overlay').forEach((e) => e.remove())).catch(() => undefined);
}

async function quickStart(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('menu-newSaga').click();
  await page.getByTestId('quick-start').click();
  await expect(page.locator('[data-testid="game-shell"][data-mode="hub"]')).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 6; i++) {
    await clearViteOverlay(page);
    const ack = page.getByTestId('decision-acknowledge');
    const critical = page.getByTestId('critical-modal').locator('button.btn-primary');
    if (await critical.isVisible()) await critical.click();
    else if (await ack.isVisible()) await ack.click();
    else break;
    await page.waitForTimeout(200);
  }
}

function inside(inner: Box, outer: Box, slack = 1): boolean {
  return inner.x >= outer.x - slack && inner.y >= outer.y - slack && inner.x + inner.width <= outer.x + outer.width + slack && inner.y + inner.height <= outer.y + outer.height + slack;
}

test('enter the Longhouse, the Seer’s hut and the Grove, speak with each keeper, and walk back out', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await quickStart(page);

  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    for (const room of ROOMS) {
      await clearViteOverlay(page);
      await page.getByTestId(`hotspot-${room.id}`).click();
      const root = page.getByTestId(`interior-${room.id}`);
      await expect(root).toBeVisible();
      await expect(page.getByTestId(room.stage)).toBeVisible();
      await page.waitForTimeout(500);
      const rootBox = (await root.boundingBox()) as Box;
      // The whole view below the top bar is the room; the top bar stays in view above it.
      const stats = page.locator('.topbar .topbar-stat-value');
      expect(await stats.count()).toBeGreaterThan(0);
      for (const bottom of await stats.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().bottom))) expect(bottom).toBeLessThanOrEqual(rootBox.y + 1);
      expect(rootBox.width).toBeGreaterThanOrEqual(w - 2);
      // A final painting is on screen (the base file or the season's own), and its table places the people.
      await expect(root).toHaveAttribute('data-art', /^(base|spring|summer|autumn|winter)$/);
      // The person: a named button inside the room, the plate on screen and clear of the title.
      const title = (await root.locator('.int-title').boundingBox()) as Box;
      for (const id of room.people) {
        const b = page.getByTestId(`interior-person-${id}`);
        await expect(b).toBeVisible();
        const plate = (await b.locator('.int-plate').boundingBox()) as Box;
        expect(inside(plate, rootBox), `${id} plate at ${w}×${h}`).toBe(true);
        const clear = plate.y >= title.y + title.height || plate.x >= title.x + title.width || plate.x + plate.width <= title.x;
        expect(clear, `${id} plate under the title at ${w}×${h}`).toBe(true);
      }
      await page.screenshot({ path: `${OUT}/interior-${room.id}-${w}x${h}.png` });

      for (const id of room.people) {
        await page.getByTestId(`interior-person-${id}`).click();
        const panel = page.getByTestId('interior-panel');
        await expect(panel).toHaveAttribute('data-person', id);
        await expect(page.getByTestId(room.content[id] as string)).toBeVisible();
        await page.waitForTimeout(550);
        const pb = (await panel.boundingBox()) as Box;
        expect(inside(pb, rootBox), `${id} panel fits at ${w}×${h}`).toBe(true);
        // The person stays in view beside the panel (the centre of the figure is not under it).
        const person = (await page.getByTestId(`interior-person-${id}`).boundingBox()) as Box;
        const cx = person.x + person.width / 2;
        const cy = person.y + person.height / 2;
        const covered = cx > pb.x && cx < pb.x + pb.width && cy > pb.y && cy < pb.y + pb.height;
        expect(covered, `${id} hidden by the panel at ${w}×${h}`).toBe(false);
        expect(cx).toBeGreaterThan(rootBox.x);
        expect(cx).toBeLessThan(rootBox.x + rootBox.width);
        // Nothing in the panel is wider than the panel.
        const body = panel.locator('.int-panel-body');
        const overflow = await body.evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(overflow, `${id} panel scrolls sideways at ${w}×${h}`).toBeLessThanOrEqual(1);
        // At most one gold button in the panel.
        expect(await panel.locator('.btn-primary').count()).toBeLessThanOrEqual(1);
        await page.screenshot({ path: `${OUT}/interior-${room.id}-${w}x${h}-${id}.png` });
        if (id === 'seer') {
          await page.getByTestId('seer-heal').click();
          await expect(page.getByTestId('seer-healing')).toBeVisible();
          await page.waitForTimeout(250);
          await page.screenshot({ path: `${OUT}/interior-${room.id}-${w}x${h}-${id}-heal.png` });
        }
        await page.getByTestId('interior-back').click();
        await expect(panel).toHaveCount(0);
      }

      // Keys: 1 opens the person, Esc closes the panel, Esc again leaves the building.
      await page.getByTestId(`interior-person-${room.people[0]}`).focus();
      await page.keyboard.press('1');
      await expect(page.getByTestId('interior-panel')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('interior-panel')).toHaveCount(0);
      await expect(root).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(root).toHaveCount(0);
      await expect(page.getByTestId('hub')).toBeVisible();
    }
  }
  expect(errors).toEqual([]);
});

test('the House-elder sends the player to the family, and coming back finds him again', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await quickStart(page);
  await page.getByTestId('hotspot-longhouse').click();
  await page.getByTestId('interior-person-houseElder').click();
  await page.getByTestId('office-envoy').click();
  await expect(page.getByTestId('longhouse-focus')).toHaveAttribute('data-office', 'envoy');
  await page.getByTestId('longhouse-to-family').click();
  await expect(page.getByTestId('family')).toBeVisible();
  await page.getByTestId('family-close').click();
  // Back in the Longhouse with the House-elder's panel open.
  await expect(page.getByTestId('interior-panel')).toHaveAttribute('data-person', 'houseElder');
  await expect(page.getByTestId('longhouse-summary')).toBeVisible();
  await page.getByTestId('interior-leave').click();
  await expect(page.getByTestId('interior-longhouse')).toHaveCount(0);
  expect(errors).toEqual([]);
});
