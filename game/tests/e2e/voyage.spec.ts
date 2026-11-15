import { expect, test, type Page } from '@playwright/test';

/**
 * Free sailing (owner play-test 2026-11-14): quick start, wait out the ice, launch an expedition, hold a steering key
 * (time runs and the ship moves), let go (time stops), then reach a harbour: by the "Chart a course" picker, and by
 * steering back into it after sailing on (landfall by touch). Both raise the arrival decision.
 * The developer console (switched on in Options, as release builds need) reads the fleet's position and the hour.
 * Screenshots of the ship at sea land in the output folder at 1366×768 and 1600×1000.
 */
const OUT = process.env.BARDIA_E2E_OUT ?? 'test-results';

type Dir = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
const KEYS: Record<Dir, string[]> = {
  n: ['KeyW'],
  ne: ['KeyW', 'KeyD'],
  e: ['KeyD'],
  se: ['KeyS', 'KeyD'],
  s: ['ArrowDown'],
  sw: ['ArrowDown', 'ArrowLeft'],
  w: ['ArrowLeft'],
  nw: ['ArrowUp', 'ArrowLeft'],
};
const VEC: Record<Dir, [number, number]> = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] };

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

/** Runs a dev-console command and returns the text of its last output line. */
async function devRun(page: Page, line: string): Promise<string> {
  const input = page.getByTestId('dev-console-input');
  await input.fill(line);
  await input.press('Enter');
  return (await page.getByTestId('dev-console').locator('.devconsole-line').last().textContent()) ?? '';
}

/** Answers whatever is in the way (an encounter, an alert, a storylet), but never the arrival decision. */
async function settle(page: Page): Promise<void> {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    if (await page.getByTestId('pending-arrival').isVisible()) return;
    const busy = (await page.locator('[data-testid^="pending-"]').first().isVisible()) || (await page.getByTestId('critical-modal').isVisible());
    if (!busy) return;
    await answerOne(page);
    await page.waitForTimeout(250);
  }
}

/** Reads values from the state through the console (opened and closed around the reads). */
async function readState(page: Page, paths: string[]): Promise<unknown[]> {
  await settle(page);
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('dev-console-input')).toBeVisible();
  const out: unknown[] = [];
  for (const p of paths) {
    const text = await devRun(page, `state ${p}`);
    try {
      out.push(JSON.parse(text));
    } catch {
      out.push(undefined);
    }
  }
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('dev-console-input')).toHaveCount(0);
  return out;
}

async function fleetAndHour(page: Page): Promise<{ pos: { x: number; y: number }; hour: number }> {
  const [id] = (await readState(page, ['player.expeditionFleetId'])) as [string];
  const [pos, hour] = (await readState(page, [`fleets.${id}.pos`, 'time.hour'])) as [{ x: number; y: number }, number];
  return { pos, hour };
}

async function hold(page: Page, dir: Dir, ms: number, stopWhen?: () => Promise<boolean>, midway?: () => Promise<void>): Promise<void> {
  for (const k of KEYS[dir]) await page.keyboard.down(k);
  const end = Date.now() + ms;
  let shot = midway === undefined;
  while (Date.now() < end) {
    if (stopWhen && (await stopWhen())) break;
    if (!shot && Date.now() > end - ms + 350) {
      shot = true;
      await midway?.();
    }
    await page.waitForTimeout(100);
  }
  for (const k of KEYS[dir]) await page.keyboard.up(k);
}

test('steer the expedition with the keys and reach harbours by picker and by touch', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  // Release builds keep the developer console off until it is switched on in Options.
  await page.getByTestId('menu-options').click();
  await page.getByRole('tab', { name: 'Gameplay' }).click();
  const devSwitch = page.getByRole('switch', { name: /Developer console/ });
  if ((await devSwitch.getAttribute('aria-checked')) !== 'true') await devSwitch.click();
  await page.getByTestId('options-done').click();
  await page.getByTestId('menu-newSaga').click();
  await page.getByTestId('quick-start').click();
  await expect(page.locator('[data-testid="game-shell"][data-mode="hub"]')).toBeVisible({ timeout: 20_000 });

  // Northern seas are iced in through Icebreak: wait at home first.
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
  await expect(page.getByTestId('expedition-hud')).toBeVisible();
  await expect(page.getByTestId('steer-hint')).toBeVisible();
  await page.screenshot({ path: `${OUT}/voyage-launch-1366.png` });

  const [fid] = (await readState(page, ['player.expeditionFleetId'])) as [string];

  // Hold a steering key: time runs and the ship moves. Try the headings until one has open water.
  const start = await fleetAndHour(page);
  let moved: Dir | null = null;
  for (const dir of ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'] as Dir[]) {
    await hold(page, dir, 1600, async () => page.locator('[data-testid^="pending-"]').first().isVisible());
    if (await page.getByTestId('pending-arrival').isVisible()) {
      // It sailed straight into a harbour: moved all the same. Sail on.
      moved = dir;
      await page.getByTestId('choose-leave').click();
      break;
    }
    const now = await fleetAndHour(page);
    if (Math.hypot(now.pos.x - start.pos.x, now.pos.y - start.pos.y) > 1) {
      moved = dir;
      expect(now.hour).toBeGreaterThan(start.hour);
      break;
    }
  }
  expect(moved).not.toBeNull();
  await expect(page.getByTestId('steer-hint')).toHaveCount(0);
  // Let go: time stops.
  const a = await fleetAndHour(page);
  await page.waitForTimeout(1200);
  const b = await fleetAndHour(page);
  expect(b.hour).toBe(a.hour);
  expect(b.pos).toEqual(a.pos);

  // A moving ship for the screenshots (zoomed out and zoomed in, at both window sizes).
  if (moved) {
    for (const k of KEYS[moved]) await page.keyboard.down(k);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/voyage-sailing-1366-out.png` });
    await page.getByTestId('map-band-local').click({ timeout: 1500 }).catch(() => undefined);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/voyage-sailing-1366-in.png` });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/voyage-sailing-1600-in.png` });
    await page.getByTestId('map-band-region').click({ timeout: 1500 }).catch(() => undefined);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/voyage-sailing-1600-out.png` });
    for (const k of KEYS[moved]) await page.keyboard.up(k);
  }
  if (await page.getByTestId('pending-arrival').isVisible()) await page.getByTestId('choose-leave').click();
  await settle(page);

  // By the picker: Chart a course → Sail, let time run until the arrival decision.
  const arrival = page.getByTestId('pending-arrival');
  await page.getByTestId('order-chart').click();
  await expect(page.getByTestId('order-sail-destination')).toBeVisible();
  await page.getByTestId('order-sail-destination').click();
  await expect(page.getByTestId('expedition-status')).toContainText(/Bound for/);
  const deadline = Date.now() + 90_000;
  let lastPos: { x: number; y: number } | null = null;
  while (Date.now() < deadline && !(await arrival.isVisible())) {
    if (!(await answerOne(page))) {
      const play = page.getByTestId('time-speed-4');
      const pressed = await play.getAttribute('aria-pressed', { timeout: 300 }).catch(() => null);
      if (pressed === 'false') await play.click({ timeout: 1000 }).catch(() => undefined);
      const status = (await page.getByTestId('expedition-status').textContent().catch(() => '')) ?? '';
      if (!/Bound for/.test(status) && !(await arrival.isVisible())) {
        // An encounter cancelled the course: chart it again.
        await page.getByTestId('order-chart').click().catch(() => undefined);
        await page.getByTestId('order-sail-destination').click().catch(() => undefined);
      }
    }
    await page.waitForTimeout(250);
  }
  await expect(arrival).toBeVisible();
  await page.screenshot({ path: `${OUT}/voyage-arrival-picker.png` });

  // Sail on, steer out of the harbour's reach, and steer back in: the arrival comes again (landfall by touch).
  // The harbour's berth cell is the point to steer back to (read while the arrival is still pending).
  const [sid, gridW] = (await readState(page, ['pending.payload.settlementId', 'worldIndex.width'])) as [string | undefined, number | undefined];
  const [portCell] = sid !== undefined ? ((await readState(page, [`worldIndex.settlements.${sid}.port`])) as [number | undefined]) : [undefined];
  await page.getByTestId('choose-leave').click();
  await expect(arrival).toHaveCount(0);
  await page.getByTestId('time-speed-1').click({ timeout: 1500 }).catch(() => undefined);
  const here = (await readState(page, [`fleets.${fid}.pos`]))[0] as { x: number; y: number };
  const berth = typeof portCell === 'number' && portCell >= 0 && typeof gridW === 'number' ? { x: (portCell % gridW) + 0.5, y: Math.floor(portCell / gridW) + 0.5 } : here;
  await page.getByTestId('map-band-local').click();
  let touched = false;
  // Once, while the ship is under way: a look at it (close and region zoom, both window sizes).
  let shotsTaken = false;
  const shots = async (): Promise<void> => {
    if (shotsTaken) return;
    shotsTaken = true;
    await page.screenshot({ path: `${OUT}/voyage-open-1600-in.png` });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/voyage-open-1366-in.png` });
    // (a decision may have come up meanwhile: never wait on the zoom buttons)
    await page.getByTestId('map-band-region').click({ timeout: 1500 }).catch(() => undefined);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/voyage-open-1366-out.png` });
    await page.getByTestId('map-band-local').click({ timeout: 1500 }).catch(() => undefined);
    await page.setViewportSize({ width: 1600, height: 1000 });
  };
  const pendingUp = async (): Promise<boolean> => page.locator('[data-testid^="pending-"]').first().isVisible();
  const towards = (from: { x: number; y: number }): Dir => {
    const dx = berth.x - from.x;
    const dy = berth.y - from.y;
    return (Object.keys(VEC) as Dir[]).sort((p, q) => {
      const score = (d: Dir) => (VEC[d][0] * dx + VEC[d][1] * dy) / Math.hypot(VEC[d][0], VEC[d][1]);
      return score(q) - score(p);
    })[0] as Dir;
  };
  // Out: the first heading with open water, until the ship is well clear of the harbour's reach.
  for (const out of ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'] as Dir[]) {
    await hold(page, out, 700, pendingUp, shots);
    await settle(page);
    if (await arrival.isVisible()) break; // touched another harbour: an arrival all the same
    lastPos = (await readState(page, [`fleets.${fid}.pos`]))[0] as { x: number; y: number };
    if (Math.hypot(lastPos.x - berth.x, lastPos.y - berth.y) >= 5) break;
  }
  // Back: the eight headings are 45 degrees apart, so one long hold on a single heading can pass the harbour by.
  // Re-aim after every hold, with short holds once the ship is close.
  for (let i = 0; i < 45 && !(await arrival.isVisible()); i++) {
    const pos = (await readState(page, [`fleets.${fid}.pos`]))[0] as { x: number; y: number };
    if (await arrival.isVisible()) break;
    const d = Math.hypot(pos.x - berth.x, pos.y - berth.y);
    await hold(page, towards(pos), d > 12 ? 600 : 180, pendingUp);
    await settle(page);
  }
  touched = await arrival.isVisible();
  expect(touched || (await arrival.isVisible())).toBe(true);
  await page.screenshot({ path: `${OUT}/voyage-arrival-touch.png` });
  expect(errors).toEqual([]);
});
