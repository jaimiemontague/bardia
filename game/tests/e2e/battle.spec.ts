import { expect, test, type Page } from '@playwright/test';

/**
 * The playable battle through the real UI, fought with the keyboard (owner play-test 2026-11-15):
 * Main Menu → Skirmish → a raid. Reads the "how to command" card, holds W A S D and checks through
 * the dev handle `__bardiaBattle` that the whole war-band moved and that it stopped when the key was
 * let go, charges with Space, draws and looses an aimed volley with the archers, pauses with P, steps
 * through the squads with Tab, and plays the battle to its summary. Screenshots (1366×768) of the
 * card, the squads on the move and the archers aiming land in BARDIA_E2E_OUT for a visual check.
 */

const OUT = process.env.BARDIA_E2E_OUT ?? 'test-results';

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${OUT}/battle-${name}.png` });
}

/** What the tests read from the battle controller (window.__bardiaBattle, dev builds only). */
interface SquadLite {
  id: string;
  side: string;
  x: number;
  y: number;
  facing: number;
  status: string;
  task: string;
  taskTarget: string | null;
  abilities: string[];
  cooldowns: Record<string, number>;
  activity: string;
}
interface BattleHandle {
  side: string;
  selected: string[];
  paused: boolean;
  driveDir: { dx: number; dy: number; run: boolean } | null;
  aiming: { squads: string[] } | null;
  snap: { squads: SquadLite[]; status: string };
  ownSquads(): SquadLite[];
  aimView(): { id: string; x: number; y: number }[];
}
type BattleWindow = Window & { __bardiaBattle?: BattleHandle };

async function own(page: Page): Promise<SquadLite[]> {
  return page.evaluate(() => {
    const c = (window as BattleWindow).__bardiaBattle!;
    return JSON.parse(JSON.stringify(c.ownSquads())) as SquadLite[];
  });
}

/** Runs `fn` on the battle controller in the page (its result must be JSON-safe). */
async function handle<T>(page: Page, fn: (c: BattleHandle) => T): Promise<T> {
  return (await page.evaluate(`(${fn.toString()})(window.__bardiaBattle)`)) as T;
}

const KEYS = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' } as const;

/** Holds the movement keys for a direction (8-way) toward (dx, dy); returns the keys held. */
async function holdToward(page: Page, dx: number, dy: number, held: string[]): Promise<string[]> {
  const want: string[] = [];
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax > ay * 0.41) want.push(dx > 0 ? KEYS.right : KEYS.left);
  if (ay > ax * 0.41) want.push(dy > 0 ? KEYS.down : KEYS.up);
  for (const k of held) if (!want.includes(k)) await page.keyboard.up(k);
  for (const k of want) if (!held.includes(k)) await page.keyboard.down(k);
  return want;
}

async function release(page: Page, held: string[]): Promise<void> {
  for (const k of held) await page.keyboard.up(k);
}

/** The nearest seen enemy to a point, or null. */
async function nearestFoe(page: Page, x: number, y: number): Promise<SquadLite | null> {
  const foes = await page.evaluate(() => {
    const c = (window as BattleWindow).__bardiaBattle!;
    return JSON.parse(JSON.stringify(c.snap.squads.filter((s) => s.side !== c.side && s.status === 'active'))) as SquadLite[];
  });
  foes.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
  return foes[0] ?? null;
}

async function openRaid(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1366, height: 768 });
  // Other agents edit this folder while the dev server runs: cut the HMR socket so no reload interrupts the battle.
  await page.routeWebSocket(/./, () => {});
  await page.goto('/');
  await page.getByTestId('menu-skirmish').click();
  await expect(page.getByTestId('skirmish')).toBeVisible();
  await page.getByTestId('skirmish-preset-raid').click();
  await expect(page.getByTestId('battle-screen')).toBeVisible();
  await expect(page.getByTestId('battle-canvas')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('battle-howto')).toBeVisible();
}

test('a skirmish raid is fought with the keyboard to its summary', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await openRaid(page);
  const screen = page.getByTestId('battle-screen');
  await page.waitForTimeout(600);
  await shot(page, '1-howto');

  // The card dismissed, the battle waits; the whole war-band is selected.
  await page.getByTestId('battle-howto-plan').click();
  await expect(screen).toHaveAttribute('data-paused', 'true');
  const start = await own(page);
  expect(await handle(page, (c) => c.selected.length)).toBe(start.length);
  await expect(page.getByTestId('battle-panel-name')).toContainText(new RegExp(`${start.length} squads`));

  // Hold W: the first movement key starts the battle and everyone moves up the screen.
  await page.keyboard.down('KeyW');
  await expect(screen).toHaveAttribute('data-paused', 'false');
  await page.waitForTimeout(1600);
  await shot(page, '2-on-the-move');
  const moving = await own(page);
  for (const s of moving) {
    const s0 = start.find((q) => q.id === s.id)!;
    expect(s.y).toBeLessThan(s0.y - 0.8);
    expect(s.task).toBe('drive');
  }
  // Let go: they halt at once and hold.
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(250);
  const stopped = await own(page);
  await page.waitForTimeout(1000);
  const later = await own(page);
  for (const s of later) {
    const s1 = stopped.find((q) => q.id === s.id)!;
    expect(s.task).not.toBe('drive');
    if (s.activity !== 'fighting') expect(Math.hypot(s.x - s1.x, s.y - s1.y)).toBeLessThan(0.3);
  }

  // P pauses and resumes (Space no longer does).
  await page.keyboard.press('KeyP');
  await expect(screen).toHaveAttribute('data-paused', 'true');
  await expect(page.getByTestId('battle-paused-banner')).toContainText('P');
  await page.keyboard.press('KeyP');
  await expect(screen).toHaveAttribute('data-paused', 'false');

  // Tab: one squad alone; then the first squad (the huscarls) leads the way to the enemy and charges with Space.
  await page.keyboard.press('Tab');
  expect(await handle(page, (c) => c.selected.length)).toBe(1);
  await page.keyboard.press('Digit1');
  const leader = (await handle(page, (c) => c.selected[0]))!;
  await page.getByTestId('battle-speed-2').click();
  let held: string[] = [];
  let charged = false;
  for (let i = 0; i < 120 && !charged; i++) {
    const me = (await own(page)).find((s) => s.id === leader);
    if (!me) break;
    const foe = await nearestFoe(page, me.x, me.y);
    const tx = foe ? foe.x : 48;
    const ty = foe ? foe.y : 36;
    const d = Math.hypot(tx - me.x, ty - me.y);
    if (foe && d < 15) {
      held = await holdToward(page, tx - me.x, ty - me.y, held);
      await page.waitForTimeout(250);
      await release(page, held);
      held = [];
      await page.keyboard.press('Space');
      await page.waitForTimeout(200);
      const after = (await own(page)).find((s) => s.id === leader);
      charged = after !== undefined && (after.cooldowns['charge'] ?? 0) > 0;
      continue;
    }
    held = await holdToward(page, tx - me.x, ty - me.y, held);
    await page.waitForTimeout(300);
  }
  await release(page, held);
  expect(charged).toBe(true);
  await page.waitForTimeout(400);
  const charger = (await own(page)).find((s) => s.id === leader);
  if (charger) expect(['attack', 'none']).toContain(charger.task);

  // The archers: face the enemy, hold Space to draw (the marker runs out), let go to loose.
  const archers = (await own(page)).find((s) => s.abilities.includes('volley'));
  expect(archers).toBeDefined();
  await page.keyboard.press(`Digit${(await handle(page, (c) => c.ownSquads().map((s) => s.id))).indexOf(archers!.id) + 1}`);
  const foe = await nearestFoe(page, archers!.x, archers!.y);
  held = await holdToward(page, (foe?.x ?? 48) - archers!.x, (foe?.y ?? 36) - archers!.y, []);
  await page.waitForTimeout(700);
  await release(page, held);
  await page.keyboard.down('Space');
  await page.waitForTimeout(900);
  expect(await handle(page, (c) => c.aiming?.squads.length ?? 0)).toBe(1);
  expect(await handle(page, (c) => c.aimView().length)).toBe(1);
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(150);
  await shot(page, '3-archers-aiming');
  await page.keyboard.press('KeyP');
  await page.keyboard.up('Space');
  await page.waitForTimeout(300);
  expect(await handle(page, (c) => c.aiming)).toBeNull();
  const loosed = (await own(page)).find((s) => s.id === archers!.id);
  if (loosed) expect(loosed.task).toBe('volley');

  // Everyone again (Ctrl+A), into the enemy at 4×; then the captains finish whatever is left.
  await page.keyboard.press('Control+KeyA');
  await page.getByTestId('battle-speed-4').click();
  held = [];
  for (let i = 0; i < 40 && !(await page.getByTestId('battle-summary').isVisible()); i++) {
    const band = await own(page);
    if (band.length === 0) break;
    const cx = band.reduce((a, s) => a + s.x, 0) / band.length;
    const cy = band.reduce((a, s) => a + s.y, 0) / band.length;
    const f = await nearestFoe(page, cx, cy);
    if (!f) break;
    held = await holdToward(page, f.x - cx, f.y - cy, held);
    await page.waitForTimeout(400);
  }
  await release(page, held);
  await shot(page, '4-melee');
  if (!(await page.getByTestId('battle-summary').isVisible())) {
    await page.getByTestId('battle-menu').click();
    await expect(page.getByTestId('battle-pause-menu')).toBeVisible();
    await page.getByTestId('battle-captains').click();
  }
  await expect(page.getByTestId('battle-summary')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('battle-outcome')).toHaveAttribute('data-outcome', /victory|defeat|retreat|draw/);
  await page.waitForTimeout(300);
  await shot(page, '5-summary');

  await page.getByTestId('battle-return').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  expect(errors).toEqual([]);
});

test('right-click orders still work, and Escape opens the battle menu', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.routeWebSocket(/./, () => {});
  await page.goto('/');
  await page.getByTestId('menu-skirmish').click();
  for (const id of ['raid', 'field', 'assault', 'cloister']) await expect(page.getByTestId(`skirmish-preset-${id}`)).toBeVisible();
  await page.getByTestId('skirmish-preset-field').click();
  await expect(page.getByTestId('battle-howto')).toBeVisible();
  await page.getByTestId('battle-howto-start').click();
  const screen = page.getByTestId('battle-screen');
  await expect(screen).toHaveAttribute('data-paused', 'false');
  // Right-click a spot just above the middle of the screen: the band marches there.
  await page.keyboard.press('Digit1');
  const before = (await own(page))[0]!;
  const canvas = await page.getByTestId('battle-canvas').boundingBox();
  await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2 - 120, { button: 'right' });
  await page.waitForTimeout(1200);
  const after = (await own(page)).find((s) => s.id === before.id)!;
  expect(after.task === 'move' || Math.hypot(after.x - before.x, after.y - before.y) > 0.5).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('battle-pause-menu')).toBeVisible();
  await expect(screen).toHaveAttribute('data-paused', 'true');
  await page.getByTestId('battle-leave').click();
  await expect(page.getByTestId('skirmish')).toBeVisible();
  expect(errors).toEqual([]);
});

/** Answers one thing in the player's way (a critical alert, a message, a generic decision). */
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

test('a campaign raid fought on the field returns to the saga', async ({ page }) => {
  test.setTimeout(200_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.routeWebSocket(/./, () => {});
  await page.goto('/');
  await page.getByTestId('menu-newSaga').click();
  await page.getByTestId('quick-start').click();
  await expect(page.locator('[data-testid="game-shell"][data-mode="hub"]')).toBeVisible({ timeout: 20_000 });
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
  await page.getByTestId('order-chart').click();
  await page.getByTestId('order-sail-destination').click();
  const arrival = page.getByTestId('arrival-card');
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && !(await arrival.isVisible())) {
    if (!(await answerOne(page))) {
      const play = page.getByTestId('time-speed-4');
      const pressed = await play.getAttribute('aria-pressed', { timeout: 300 }).catch(() => null);
      if (pressed === 'false') await play.click({ timeout: 1000 }).catch(() => undefined);
    }
    await page.waitForTimeout(250);
  }
  await expect(arrival).toBeVisible();
  await page.getByTestId('choose-raid').click();
  await expect(page.getByTestId('battle-setup')).toBeVisible();
  await expect(page.getByTestId('battle-fight')).toBeEnabled();
  await page.getByTestId('battle-fight').click();

  await expect(page.locator('[data-testid="game-shell"][data-mode="battle"]')).toBeVisible();
  await expect(page.getByTestId('battle-howto')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('battle-setup')).toHaveCount(0);
  await page.getByTestId('battle-howto-plan').click();
  // The first movement key starts the campaign battle too.
  await page.keyboard.down('KeyW');
  await expect(page.getByTestId('battle-screen')).toHaveAttribute('data-paused', 'false');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  await shot(page, 'campaign-field');
  await page.getByTestId('battle-menu').click();
  await page.getByTestId('battle-captains').click();
  await expect(page.getByTestId('battle-summary')).toBeVisible({ timeout: 60_000 });
  await shot(page, 'campaign-summary');
  await page.getByTestId('battle-return').click();
  await expect(page.getByTestId('battle-screen')).toHaveCount(0);
  await expect(page.locator('[data-testid="game-shell"][data-mode="map"]')).toBeVisible();
  expect(errors).toEqual([]);
});
