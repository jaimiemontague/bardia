import { expect, test, type Page } from '@playwright/test';

/**
 * The march (owner play-test 2026-11-14): quick start (the harbour iced in), open the planner, choose "March
 * overland", march out, hold a steering key (time runs and the war-band moves), let go (time stops), then take the
 * road to a neighbouring settlement (the "March to" picker, or the dev console when no place is known yet) until the
 * arrival decision shows, leave, "March home" and see the hall again.
 * The developer console (switched on in Options, as release builds need) reads the war-band's position and the hour.
 * Screenshots (the planner, the war-band under way zoomed in and out, the helm strip) land in the output folder at
 * 1366×768 and 1600×1000.
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

async function answerOne(page: Page): Promise<boolean> {
  const cue = page.getByTestId('scene-cue');
  const critical = page.getByTestId('critical-modal').locator('button.btn-primary');
  const ack = page.getByTestId('decision-acknowledge');
  const choice = page.locator('[data-testid^="decision-choice-"]:not([disabled])').first();
  if (await cue.isVisible()) await cue.click({ timeout: 1500 }).catch(() => undefined);
  else if (await critical.isVisible()) await critical.click();
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
    const busy = (await page.locator('[data-testid^="pending-"]').first().isVisible()) || (await page.getByTestId('critical-modal').isVisible()) || (await page.getByTestId('scene-cue').isVisible());
    if (!busy) return;
    await answerOne(page);
    await page.waitForTimeout(250);
  }
}

/** Opens the console, runs `lines` and closes it again; returns each line's output. */
async function console_(page: Page, lines: string[]): Promise<string[]> {
  await settle(page);
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('dev-console-input')).toBeVisible();
  const out: string[] = [];
  for (const l of lines) out.push(await devRun(page, l));
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('dev-console-input')).toHaveCount(0);
  return out;
}

async function readState(page: Page, paths: string[]): Promise<unknown[]> {
  return (await console_(page, paths.map((p) => `state ${p}`))).map((t) => {
    try {
      return JSON.parse(t);
    } catch {
      return undefined;
    }
  });
}

async function bandAndHour(page: Page, armyId: string): Promise<{ pos: { x: number; y: number }; hour: number }> {
  const [pos, hour] = (await readState(page, [`armies.${armyId}.pos`, 'time.hour'])) as [{ x: number; y: number }, number];
  return { pos, hour };
}

async function hold(page: Page, dir: Dir, ms: number): Promise<void> {
  for (const k of KEYS[dir]) await page.keyboard.down(k);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await page.locator('[data-testid^="pending-"]').first().isVisible()) break;
    await page.waitForTimeout(100);
  }
  for (const k of KEYS[dir]) await page.keyboard.up(k);
}

/** Lets time run at the fastest speed, answering everything but the arrival, until `done` holds. */
async function playUntil(page: Page, done: () => Promise<boolean>, ms: number, again?: () => Promise<void>): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !(await done())) {
    if (!(await page.getByTestId('pending-arrival').isVisible()) && !(await answerOne(page))) {
      const play = page.getByTestId('time-speed-4');
      const pressed = await play.getAttribute('aria-pressed', { timeout: 300 }).catch(() => null);
      if (pressed === 'false') await play.click({ timeout: 1000 }).catch(() => undefined);
      await again?.();
    }
    await page.waitForTimeout(250);
  }
}

test('march overland from the iced-in hall: steer the war-band, reach a neighbour, march home', async ({ page }) => {
  test.setTimeout(360_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await page.getByTestId('menu-options').click();
  await page.getByRole('tab', { name: 'Gameplay' }).click();
  const devSwitch = page.getByRole('switch', { name: /Developer console/ });
  if ((await devSwitch.getAttribute('aria-checked')) !== 'true') await devSwitch.click();
  await page.getByTestId('options-done').click();
  await page.getByTestId('menu-newSaga').click();
  await page.getByTestId('quick-start').click();
  await expect(page.locator('[data-testid="game-shell"][data-mode="hub"]')).toBeVisible({ timeout: 20_000 });
  while (await answerOne(page)) await page.waitForTimeout(200);

  // The planner: Set sail is the default; while the sea is iced the steward says the roads are open.
  await page.getByTestId('hub-expedition').click();
  await expect(page.getByTestId('planner-travel')).toBeVisible();
  await expect(page.getByTestId('planner-travel-sea')).toHaveAttribute('aria-checked', 'true');
  const iced = await page.getByTestId('planner-iced').isVisible();
  if (iced) await expect(page.getByTestId('planner-launch')).toBeDisabled();
  await page.getByTestId('planner-travel-land').click();
  await expect(page.getByTestId('planner-travel-land')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('planner-on-foot')).toBeVisible();
  await expect(page.getByTestId('planner-launch')).toBeEnabled();
  await expect(page.getByTestId('planner-launch')).toContainText('March out');
  await page.screenshot({ path: `${OUT}/march-planner-1366.png` });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/march-planner-1600.png` });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByTestId('planner-launch').click();

  await expect(page.locator('[data-testid="game-shell"][data-mode="map"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('world-map-loading')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('[data-testid="expedition-hud"][data-travel="land"]')).toBeVisible();
  // Just launched: the home order is the normal "March home" (Come home waits until the band has come back).
  await expect(page.getByTestId('order-home')).toContainText('March home');
  await expect(page.getByTestId('expedition-where')).toContainText('On the march');

  const [fid, parties] = (await readState(page, ['player.expeditionFleetId', 'expeditions.landParties'])) as [string, Record<string, string>];
  const armyId = Object.keys(parties).find((a) => parties[a] === fid) as string;
  expect(armyId).toBeTruthy();

  // Hold a steering key: time runs and the war-band moves. Try the headings until one has open land.
  const start = await bandAndHour(page, armyId);
  let moved: Dir | null = null;
  for (const dir of ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'] as Dir[]) {
    await hold(page, dir, 1600);
    if (await page.getByTestId('pending-arrival').isVisible()) {
      moved = dir;
      await page.getByTestId('choose-leave').click();
      break;
    }
    await settle(page);
    const now = await bandAndHour(page, armyId);
    if (Math.hypot(now.pos.x - start.pos.x, now.pos.y - start.pos.y) > 0.5) {
      moved = dir;
      expect(now.hour).toBeGreaterThan(start.hour);
      break;
    }
  }
  expect(moved).not.toBeNull();
  // Let go: time stops.
  const a = await bandAndHour(page, armyId);
  await page.waitForTimeout(1200);
  const b = await bandAndHour(page, armyId);
  expect(b.hour).toBe(a.hour);
  expect(b.pos).toEqual(a.pos);

  // The war-band under way, zoomed out and in, at both window sizes.
  if (moved) {
    for (const k of KEYS[moved]) await page.keyboard.down(k);
    await page.waitForTimeout(500);
    await page.getByTestId('map-band-region').click({ timeout: 1500 }).catch(() => undefined);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/march-underway-1366-out.png` });
    await page.getByTestId('map-band-local').click({ timeout: 1500 }).catch(() => undefined);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/march-underway-1366-in.png` });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/march-underway-1600-in.png` });
    await page.getByTestId('map-band-region').click({ timeout: 1500 }).catch(() => undefined);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/march-underway-1600-out.png` });
    for (const k of KEYS[moved]) await page.keyboard.up(k);
    await page.setViewportSize({ width: 1366, height: 768 });
  }
  if (await page.getByTestId('pending-arrival').isVisible()) await page.getByTestId('choose-leave').click();
  await settle(page);

  // March to a neighbour: the picker of known places, else (nothing known yet) the dev console's setRoute.
  const arrival = page.getByTestId('pending-arrival');
  let routed = false;
  await page.getByTestId('order-chart').click();
  if (await page.getByTestId('order-march-destination').isVisible()) {
    await page.getByTestId('order-march-destination').click();
    routed = /road/i.test((await page.getByTestId('expedition-status').textContent()) ?? '');
  } else await page.getByTestId('order-chart').click();
  if (!routed) {
    const [cap, lanes] = (await readState(page, ['player.capitalId', 'worldIndex.settlements'])) as [string, Record<string, { lanes: { to: string; landDays: number | null }[] }>];
    const near = (lanes[cap]?.lanes ?? []).filter((l) => l.landDays !== null).sort((x, y) => (x.landDays ?? 0) - (y.landDays ?? 0));
    for (const l of near) {
      const [out] = await console_(page, [`cmd {"type":"setRoute","to":{"settlementId":"${l.to}"}}`]);
      if (/Dispatched/.test(out ?? '')) {
        routed = true;
        break;
      }
    }
  }
  expect(routed).toBe(true);
  await expect(page.getByTestId('expedition-status')).toContainText(/road/i);
  await page.screenshot({ path: `${OUT}/march-helm-1366.png` });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/march-helm-1600.png` });
  await page.setViewportSize({ width: 1366, height: 768 });
  await playUntil(page, () => arrival.isVisible(), 150_000);
  await expect(arrival).toBeVisible();
  await page.screenshot({ path: `${OUT}/march-arrival.png` });

  // Leave, then March home: the road home ends in the hall.
  await page.getByTestId('choose-leave').click();
  await expect(arrival).toHaveCount(0);
  await settle(page);
  const hub = page.locator('[data-testid="game-shell"][data-mode="hub"]');
  await page.getByTestId('order-home').click();
  await playUntil(page, () => hub.isVisible(), 150_000, async () => {
    // An encounter or a halt may have cancelled the road home: give the order again.
    const home = page.getByTestId('order-home');
    if (await home.isVisible().catch(() => false)) await home.click({ timeout: 1000 }).catch(() => undefined);
  });
  await expect(hub).toBeVisible();
  await expect(page.getByTestId('hub')).toBeVisible();
  expect(errors).toEqual([]);
});

test('walking back into the hall only halts the war-band; Come home ends the march', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  // Release builds keep the developer console off until it is switched on in Options (the test reads positions with it).
  await page.getByTestId('menu-options').click();
  await page.getByRole('tab', { name: 'Gameplay' }).click();
  const devSwitch = page.getByRole('switch', { name: /Developer console/ });
  if ((await devSwitch.getAttribute('aria-checked')) !== 'true') await devSwitch.click();
  await page.getByTestId('options-done').click();
  await page.getByTestId('menu-newSaga').click();
  await page.getByTestId('quick-start').click();
  await expect(page.locator('[data-testid="game-shell"][data-mode="hub"]')).toBeVisible({ timeout: 20_000 });
  while (await answerOne(page)) await page.waitForTimeout(200);
  await page.getByTestId('hub-expedition').click();
  await page.getByTestId('planner-travel-land').click();
  await page.getByTestId('planner-launch').click();
  const map = page.locator('[data-testid="game-shell"][data-mode="map"]');
  await expect(map).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('world-map-loading')).toHaveCount(0, { timeout: 60_000 });
  const home = page.getByTestId('order-home');
  // Just launched, at the gates: the home order is "March home", not "Come home".
  await expect(home).toHaveAttribute('data-at-home', 'false');
  await expect(home).toContainText('March home');
  const [fid, parties] = (await readState(page, ['player.expeditionFleetId', 'expeditions.landParties'])) as [string, Record<string, string>];
  const armyId = Object.keys(parties).find((a) => parties[a] === fid) as string;
  const origin = (await bandAndHour(page, armyId)).pos;
  const away = async (): Promise<boolean> => {
    const p = (await bandAndHour(page, armyId)).pos;
    return Math.hypot(p.x - origin.x, p.y - origin.y) > 3.2;
  };

  // Walk out of reach of home, then straight back in.
  const back: Record<Dir, Dir> = { n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e', nw: 'se' };
  let out: Dir | null = null;
  for (const dir of ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'] as Dir[]) {
    // (The state read opens the dev console, so never read while a key is held.)
    await hold(page, dir, 3000);
    if (await page.getByTestId('pending-arrival').isVisible()) await page.getByTestId('choose-leave').click();
    await settle(page);
    if (await away()) {
      out = dir;
      break;
    }
  }
  expect(out).not.toBeNull();
  if (!out) return;
  await expect(home).toContainText('March home');
  for (const k of KEYS[back[out]]) await page.keyboard.down(k);
  const end = Date.now() + 8000;
  while (Date.now() < end && (await home.getAttribute('data-at-home')) !== 'true') await page.waitForTimeout(100);
  // On into the gates: the touch halts the war-band there.
  await page.waitForTimeout(1500);
  for (const k of KEYS[back[out]]) await page.keyboard.up(k);
  await settle(page);
  // Still out on the march, lying at home: the gold Come home ends it.
  await expect(map).toBeVisible();
  await expect(home).toHaveAttribute('data-at-home', 'true');
  await expect(home).toContainText('Come home');
  await page.screenshot({ path: `${OUT}/march-come-home.png` });
  await home.click();
  await expect(page.locator('[data-testid="game-shell"][data-mode="hub"]')).toBeVisible({ timeout: 10_000 });
  expect(errors).toEqual([]);
});
