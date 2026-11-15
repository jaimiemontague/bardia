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

/**
 * Every room on its final painting (the dev gallery, `/?interiors=<room>&person=<id>`; skipped on a production
 * build, which has no gallery): each person's button sits on the table measured for the painting, every plate is on
 * screen, clear of the title and of the other plates, and with each panel open the chosen person stays in view
 * beside it. Screenshots at 1280×720, 1366×768 and 1920×1080 land in BARDIA_E2E_OUT as
 * art-<room>-<w>x<h>[-<person>].png.
 */
const ART_SIZES: readonly [number, number][] = [
  [1280, 720],
  [1366, 768],
  [1920, 1080],
];
const ART_ROOMS: Readonly<Record<string, readonly string[]>> = {
  greatHall: ['hirdmaster', 'steward', 'lawspeaker'],
  smithy: ['smith'],
  shipyard: ['shipwright', 'strand'],
  market: ['merchant'],
  meadHall: ['keeper', 'travellers', 'sellswords'],
  longhouse: ['houseElder'],
  seer: ['seer'],
  grove: ['groveKeeper'],
};

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test('every room’s people sit on their figures in the final paintings', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/?interiors=smithy');
  const gallery = await page
    .getByTestId('interior-gallery')
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!gallery, 'the room gallery exists on dev builds only');

  for (const [w, h] of ART_SIZES) {
    await page.setViewportSize({ width: w, height: h });
    for (const [roomId, people] of Object.entries(ART_ROOMS)) {
      await page.goto(`/?interiors=${roomId}`);
      const root = page.getByTestId(`interior-${roomId}`);
      await expect(root).toHaveAttribute('data-art', 'base');
      await expect(root.locator('.scn-final')).toBeVisible();
      await page.waitForTimeout(500);
      const rootBox = (await root.boundingBox()) as Box;
      const title = (await root.locator('.int-title').boundingBox()) as Box;
      const plates: Box[] = [];
      for (const id of people) {
        const plate = (await page.getByTestId(`interior-person-${id}`).locator('.int-plate').boundingBox()) as Box;
        expect.soft(inside(plate, rootBox), `${roomId}/${id} plate on screen at ${w}×${h}`).toBe(true);
        expect.soft(overlaps(plate, title), `${roomId}/${id} plate under the title at ${w}×${h}`).toBe(false);
        for (const other of plates) expect.soft(overlaps(plate, other), `${roomId}/${id} plate over another at ${w}×${h}`).toBe(false);
        plates.push(plate);
      }
      await page.screenshot({ path: `${OUT}/art-${roomId}-${w}x${h}.png` });

      for (const id of people) {
        await page.goto(`/?interiors=${roomId}&person=${id}`);
        const panel = page.getByTestId('interior-panel');
        await expect(panel).toHaveAttribute('data-person', id);
        await page.waitForTimeout(650);
        const pb = (await panel.boundingBox()) as Box;
        const person = (await page.getByTestId(`interior-person-${id}`).boundingBox()) as Box;
        const cx = person.x + person.width / 2;
        const cy = person.y + person.height / 2;
        const covered = cx > pb.x && cx < pb.x + pb.width && cy > pb.y && cy < pb.y + pb.height;
        expect.soft(covered, `${roomId}/${id} hidden by the panel at ${w}×${h}`).toBe(false);
        expect(cx).toBeGreaterThan(rootBox.x);
        expect(cx).toBeLessThan(rootBox.x + rootBox.width);
        const plate = (await page.getByTestId(`interior-person-${id}`).locator('.int-plate').boundingBox()) as Box;
        expect.soft(inside(plate, rootBox), `${roomId}/${id} plate on screen beside the panel at ${w}×${h}`).toBe(true);
        expect.soft(overlaps(plate, pb), `${roomId}/${id} plate under the panel at ${w}×${h}`).toBe(false);
        await page.screenshot({ path: `${OUT}/art-${roomId}-${w}x${h}-${id}.png` });
      }
    }
  }
  expect(errors).toEqual([]);
});
