import { expect, test, type Page } from '@playwright/test';

/**
 * The town's building interiors (render/interiors): from the village, enter the Shipyard, the Market and the
 * Mead-hall, click every person, check that each panel fits beside the room with the chosen person still in view,
 * that Esc closes the panel and then leaves, and that the top bar stays readable; then the Counsel's deep link to
 * the Shipwright. Screenshots at 1366×768 and 1600×1000 (room alone, and the room with each panel open) land in
 * BARDIA_E2E_OUT as interior-<room>-<w>x<h>[-<person>].png.
 */
const OUT = process.env.BARDIA_E2E_OUT ?? 'test-results';
const SIZES: readonly [number, number][] = [
  [1366, 768],
  [1600, 1000],
];
const ROOMS: readonly { id: string; stage: string; people: readonly string[]; content: Record<string, string> }[] = [
  { id: 'shipyard', stage: 'shipyard', people: ['shipwright', 'strand'], content: { shipwright: 'shipyard-orders', strand: 'shipyard-ships' } },
  { id: 'market', stage: 'home-market', people: ['merchant'], content: { merchant: 'quick-deals' } },
  { id: 'meadHall', stage: 'home-meadhall', people: ['keeper', 'travellers', 'sellswords'], content: { keeper: 'tavern-anyNews', travellers: 'tavern-travellers', sellswords: 'meadhall-sellswords' } },
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
    const choice = page.locator('[data-testid^="decision-choice-"]:not([disabled])').first();
    if (await critical.isVisible()) await critical.click();
    else if (await ack.isVisible()) await ack.click();
    else if (await choice.isVisible()) await choice.click();
    else break;
    await page.waitForTimeout(200);
  }
}

function inside(inner: Box, outer: Box, slack = 1): boolean {
  return inner.x >= outer.x - slack && inner.y >= outer.y - slack && inner.x + inner.width <= outer.x + outer.width + slack && inner.y + inner.height <= outer.y + outer.height + slack;
}

test('enter the Shipyard, the Market and the Mead-hall, speak with everyone, and walk back out', async ({ page }) => {
  test.setTimeout(180_000);
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
      // Every person: a named button inside the room, its plate on screen and clear of the title.
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
        // The chosen person stays in view beside the panel (the centre of their figure is not under it).
        const person = (await page.getByTestId(`interior-person-${id}`).boundingBox()) as Box;
        const cx = person.x + person.width / 2;
        const cy = person.y + person.height / 2;
        const covered = cx > pb.x && cx < pb.x + pb.width && cy > pb.y && cy < pb.y + pb.height;
        expect(covered, `${id} hidden by the panel at ${w}×${h}`).toBe(false);
        expect(cx).toBeGreaterThan(rootBox.x);
        expect(cx).toBeLessThan(rootBox.x + rootBox.width);
        // At most one gold button in the panel; nothing in it wider than the panel.
        expect(await panel.locator('.btn-primary').count()).toBeLessThanOrEqual(1);
        const body = panel.locator('.int-panel-body');
        expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${id} panel scrolls sideways at ${w}×${h}`).toBe(true);
        await page.screenshot({ path: `${OUT}/interior-${room.id}-${w}x${h}-${id}.png` });
        if (id === 'merchant') {
          // One deal: pick a good, the slider and the quote stand beside the goods.
          await page.locator('[data-testid^="market-row-"]').first().click();
          await expect(page.getByTestId('market-slider').or(page.getByTestId('market-closed'))).toBeVisible();
          await page.waitForTimeout(250);
          await page.screenshot({ path: `${OUT}/interior-${room.id}-${w}x${h}-${id}-deal.png` });
          await page.getByTestId('market-view-routes').click();
          await expect(page.getByTestId('route-form')).toBeVisible();
          await page.screenshot({ path: `${OUT}/interior-${room.id}-${w}x${h}-${id}-routes.png` });
          await page.getByTestId('market-view-goods').click();
        }
        if (id === 'keeper') {
          await page.getByTestId('tavern-anyNews').click();
          await expect(page.getByTestId('tavern-result')).toBeVisible();
          await page.screenshot({ path: `${OUT}/interior-${room.id}-${w}x${h}-${id}-news.png` });
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
  await page.getByTestId('hotspot-meadHall').click();
  await page.getByTestId('interior-leave').click();
  await expect(page.getByTestId('interior-meadHall')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the Counsel takes the player straight to the Shipwright', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await quickStart(page);
  // Lay a keel so the Counsel speaks of the slipways (a line with a Shipyard button).
  await page.getByTestId('hotspot-shipyard').click();
  await page.getByTestId('interior-person-shipwright').click();
  const order = page.locator('[data-testid^="order-"]').first();
  await expect(order).toBeVisible();
  if (await order.isEnabled()) await order.click();
  await page.getByTestId('interior-leave').click();
  const go = page.locator('[data-testid^="counsel-"]').filter({ hasText: /^Shipyard$/ }).first();
  for (let i = 0; i < 8 && (await go.count()) === 0 && (await page.getByTestId('counsel-next').isVisible()); i++) await page.getByTestId('counsel-next').click();
  await expect(go).toBeVisible();
  await go.click();
  await expect(page.getByTestId('interior-shipyard')).toBeVisible();
  await expect(page.getByTestId('interior-panel')).toHaveAttribute('data-person', 'shipwright');
  await expect(page.getByTestId('shipyard-queue')).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/interior-shipyard-deeplink-shipwright.png` });
});
