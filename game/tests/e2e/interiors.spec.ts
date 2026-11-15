import { expect, test, type Page } from '@playwright/test';

/**
 * Building interiors (render/interiors): from the village, enter the Great hall and the Smithy, click every person,
 * check that the panel fits beside the room with the chosen person still in view, that Esc closes the panel and
 * then leaves, and that the top bar stays readable. Screenshots at 1366×768 and 1600×1000 (room alone, and the room
 * with each panel open) land in BARDIA_E2E_OUT as interior-<room>-<w>x<h>[-<person>].png.
 */
const OUT = process.env.BARDIA_E2E_OUT ?? 'test-results';
const SIZES: readonly [number, number][] = [
  [1366, 768],
  [1600, 1000],
];
const ROOMS: readonly { id: string; people: readonly string[]; content: Record<string, string> }[] = [
  { id: 'greatHall', people: ['hirdmaster', 'steward', 'lawspeaker'], content: { hirdmaster: 'great-hall-realm', steward: 'hall-ledger', lawspeaker: 'hall-affairs' } },
  { id: 'smithy', people: ['smith'], content: { smith: 'smithy-armour' } },
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

test('enter the Great hall and the Smithy, speak with everyone, and walk back out', async ({ page }) => {
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
      await page.waitForTimeout(500);
      const rootBox = (await root.boundingBox()) as Box;
      // The whole view below the top bar is the room; the top bar stays in view above it.
      const stats = page.locator('.topbar .topbar-stat-value');
      expect(await stats.count()).toBeGreaterThan(0);
      for (const box of await stats.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().bottom))) expect(box).toBeLessThanOrEqual(rootBox.y + 1);
      expect(rootBox.width).toBeGreaterThanOrEqual(w - 2);
      // Every person: a named button inside the room, its plate on screen.
      for (const id of room.people) {
        const b = page.getByTestId(`interior-person-${id}`);
        await expect(b).toBeVisible();
        const plate = (await b.locator('.int-plate').boundingBox()) as Box;
        expect(inside(plate, rootBox), `${id} plate at ${w}×${h}`).toBe(true);
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
        // The chosen person stays in view beside the panel (the centre of their figure is not under it).
        const person = (await page.getByTestId(`interior-person-${id}`).boundingBox()) as Box;
        const cx = person.x + person.width / 2;
        const cy = person.y + person.height / 2;
        const covered = cx > pb.x && cx < pb.x + pb.width && cy > pb.y && cy < pb.y + pb.height;
        expect(covered, `${id} hidden by the panel at ${w}×${h}`).toBe(false);
        expect(cx).toBeGreaterThan(rootBox.x);
        expect(cx).toBeLessThan(rootBox.x + rootBox.width);
        // At most one gold button in the panel.
        expect(await panel.locator('.btn-primary').count()).toBeLessThanOrEqual(1);
        await page.screenshot({ path: `${OUT}/interior-${room.id}-${w}x${h}-${id}.png` });
        if (id === 'hirdmaster') {
          await page.getByTestId('hall-muster').click();
          await expect(page.getByTestId('muster')).toBeVisible();
          await expect(page.getByTestId('muster-go')).toBeInViewport();
          await page.waitForTimeout(250);
          await page.screenshot({ path: `${OUT}/interior-${room.id}-${w}x${h}-muster.png` });
        }
        await page.getByTestId('interior-back').click();
        await expect(panel).toHaveCount(0);
      }

      // Keys: 1 opens the first person, Esc closes the panel, Esc again leaves the building.
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

  // The Leave button goes back to the village too.
  await page.getByTestId('hotspot-smithy').click();
  await page.getByTestId('interior-leave').click();
  await expect(page.getByTestId('interior-smithy')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the Counsel and the checklist take the player straight to the Hirdmaster’s muster', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await quickStart(page);
  // A new game starts on iced waters: wait out the ice so the checklist's next step is the muster.
  for (let tries = 0; tries < 3 && (await page.getByTestId('counsel-iced').isVisible()); tries++) {
    await page.getByTestId('counsel-iced').click();
    for (let i = 0; i < 20 && (await page.getByTestId('decision-acknowledge').isVisible()); i++) {
      await page.getByTestId('decision-acknowledge').click();
      await page.waitForTimeout(150);
    }
  }
  const muster = page.locator('[data-testid="voyage-action"], [data-testid^="counsel-"]').filter({ hasText: /^Muster$/ }).first();
  for (let i = 0; i < 8 && (await muster.count()) === 0 && (await page.getByTestId('counsel-next').isVisible()); i++) await page.getByTestId('counsel-next').click();
  await expect(muster).toBeVisible();
  await muster.click();
  await expect(page.getByTestId('interior-greatHall')).toBeVisible();
  await expect(page.getByTestId('interior-panel')).toHaveAttribute('data-person', 'hirdmaster');
  await expect(page.getByTestId('muster')).toBeVisible();
  await expect(page.getByTestId('muster-go')).toBeInViewport();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/interior-greatHall-deeplink-muster.png` });
});

test('the ledger opens over the hall, and closing it returns to the Steward', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await quickStart(page);
  await page.getByTestId('hotspot-greatHall').click();
  await page.getByTestId('interior-person-steward').click();
  await page.getByTestId('hall-ledger').click();
  // The ledger is the top route; the hall stays drawn beneath it, out of reach.
  const hall = page.getByTestId('route-building.greatHall');
  await expect(page.getByTestId('route-ledger')).toBeVisible();
  await expect(hall).toHaveClass(/is-under/);
  await expect(hall.getByTestId('interior-greatHall')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/interior-greatHall-ledger-over-hall.png` });
  // Esc closes the ledger only: the hall is still there with the Steward's panel open.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('route-ledger')).toHaveCount(0);
  await expect(hall).not.toHaveClass(/is-under/);
  await expect(page.getByTestId('interior-panel')).toHaveAttribute('data-person', 'steward');
  // And the keys answer the hall again.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('interior-panel')).toHaveCount(0);
  await expect(page.getByTestId('interior-greatHall')).toBeVisible();
});
