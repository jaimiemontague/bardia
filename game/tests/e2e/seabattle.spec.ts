import { expect, test, type Page } from '@playwright/test';

/**
 * The sea battle through the real UI: Main Menu → Skirmish → a sea match-up. Reads the "how to
 * command" card, selects ships with the number keys and Ctrl+A, sails them with a right click on the
 * water, sends them at an enemy ship with a right click on it, sets the attack style, runs the fight
 * at 4×, lets the captains finish it from the battle menu, reads the summary and returns. A second
 * test plays a short match-up at 1366×768; a third puts a sea fight in front of a quick-start saga and
 * takes the helm on the Before-the-Sea-Battle card, into the scene and back to the saga.
 * Screenshots land in the output folder (BARDIA_E2E_OUT) for a visual check.
 */

const OUT = process.env.BARDIA_E2E_OUT ?? 'test-results';

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${OUT}/sea-${name}.png` });
}

interface ShipPos {
  idx: number;
  side: string;
  status: string;
  x: number;
  y: number;
}

/** Screen position of every ship (dev build: the scene exposes its controller and view). */
async function ships(page: Page): Promise<ShipPos[]> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __bardiaSeaBattle?: { snap: { ships: { idx: number; side: string; status: string; x: number; y: number }[] }; side: string };
      __bardiaSeaView?: { screenOf(x: number, y: number): [number, number] };
    };
    const c = w.__bardiaSeaBattle;
    const v = w.__bardiaSeaView;
    if (!c || !v) return [];
    return c.snap.ships.map((s) => {
      const [x, y] = v.screenOf(s.x, s.y);
      return { idx: s.idx, side: s.side === c.side ? 'own' : 'foe', status: s.status, x, y };
    });
  });
}

/** A point near (x, y) where the sea itself (not a HUD card) takes the click. */
async function openWater(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([x0, y0]) => {
      for (let r = 0; r < 400; r += 20) {
        for (const [dx, dy] of [
          [0, r],
          [0, -r],
          [r, 0],
          [-r, 0],
        ]) {
          const el = document.elementFromPoint(x0! + dx!, y0! + dy!);
          if (el instanceof HTMLCanvasElement) return { x: x0! + dx!, y: y0! + dy! };
        }
      }
      return { x: x0!, y: y0! };
    },
    [x, y],
  );
}

async function battleTime(page: Page): Promise<number> {
  const text = (await page.getByTestId('sea-clock').textContent()) ?? '';
  const m = /(\d+):(\d+)/.exec(text);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

test('a sea skirmish is commanded with the mouse, fought, finished by the captains and left', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  // Other agents edit this folder while the dev server runs: cut the HMR socket so no reload interrupts the battle.
  await page.routeWebSocket(/./, () => {});
  await page.goto('/');
  await page.getByTestId('menu-skirmish').click();
  await expect(page.getByTestId('skirmish')).toBeVisible();
  for (const id of ['raid', 'field', 'assault', 'cloister', 'seaPair', 'seaMerchant', 'seaStand']) await expect(page.getByTestId(`skirmish-preset-${id}`)).toBeVisible();
  await shot(page, '0-presets');

  await page.getByTestId('skirmish-preset-seaPair').click();
  const screen = page.getByTestId('sea-battle-screen');
  await expect(screen).toBeVisible();
  await expect(page.getByTestId('sea-canvas')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('sea-howto')).toBeVisible();
  await page.waitForTimeout(700);
  await shot(page, '1-howto');
  await page.getByTestId('sea-howto-plan').click();
  await expect(screen).toHaveAttribute('data-paused', 'true');
  // Both fleets are on the water before the first tick.
  const start = await ships(page);
  expect(start.filter((s) => s.side === 'own').length).toBe(2);
  expect(start.filter((s) => s.side === 'foe').length).toBe(2);
  await page.waitForTimeout(400);
  await shot(page, '2-before-start');

  // Select by number, then the whole fleet; sail toward the enemy with a right click on the water.
  await page.keyboard.press('Digit2');
  await expect(page.getByTestId('sea-ship-cards').locator('.sv-card')).toHaveCount(1);
  await page.keyboard.press('Control+KeyA');
  await expect(page.getByTestId('sea-ship-cards').locator('.sv-card')).toHaveCount(2);
  const own = start.filter((s) => s.side === 'own');
  const foe = start.filter((s) => s.side === 'foe');
  const ox = own.reduce((a, s) => a + s.x, 0) / own.length;
  const oy = own.reduce((a, s) => a + s.y, 0) / own.length;
  const fx = foe.reduce((a, s) => a + s.x, 0) / foe.length;
  const fy = foe.reduce((a, s) => a + s.y, 0) / foe.length;
  const mark = await openWater(page, ox + (fx - ox) * 0.35, oy + (fy - oy) * 0.35);
  await page.mouse.click(mark.x, mark.y, { button: 'right' });
  await expect(page.getByTestId('sea-ship-doing').first()).toHaveText(/Sailing to the mark/);
  // The flagship goes for an enemy ship by boarding, the other shoots.
  await page.keyboard.press('Digit1');
  await page.getByTestId('sea-style-board').click();
  const target = (await ships(page)).find((s) => s.side === 'foe' && s.status === 'active')!;
  await page.mouse.click(target.x, target.y, { button: 'right' });
  await page.keyboard.press('Digit2');
  await page.getByTestId('sea-style-shoot').click();
  await page.mouse.click(target.x, target.y, { button: 'right' });
  await page.waitForTimeout(300);
  await shot(page, '3-orders');

  // Space starts; 4× speeds it up.
  await page.keyboard.press('Space');
  await expect(screen).toHaveAttribute('data-paused', 'false');
  await page.getByTestId('sea-speed-4').click();
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __bardiaSeaBattle?: { snap: { ships: { side: string; status: string; x: number; y: number }[]; status: string } } };
      const s = w.__bardiaSeaBattle?.snap;
      if (!s) return false;
      if (s.status === 'ended') return true;
      const a = s.ships.filter((x) => x.side === 'attacker' && x.status === 'active');
      const d = s.ships.filter((x) => x.side === 'defender' && x.status === 'active');
      return a.some((p) => d.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 160));
    },
    undefined,
    { timeout: 90_000 },
  );
  await page.waitForTimeout(1500);
  await shot(page, '4-engaged');
  // A deck fight (or the end, if the fight went another way): pause on it and let the camera close in.
  const boarded = await page
    .waitForFunction(
      () => {
        const w = window as unknown as { __bardiaSeaBattle?: { snap: { boardings: { phase: string }[]; status: string; duel: unknown } } };
        const s = w.__bardiaSeaBattle?.snap;
        return !s || s.status !== 'running' || s.duel !== null || s.boardings.some((b) => b.phase === 'fighting');
      },
      undefined,
      { timeout: 60_000, polling: 50 },
    )
    .then(() => true)
    .catch(() => false);
  if (await page.getByTestId('sea-duel').isVisible()) {
    await shot(page, '5-duel');
    await page.getByTestId('sea-duel-fight').click();
  } else if (boarded && (await page.getByTestId('sea-battle-screen').getAttribute('data-status')) === 'running') {
    await page.keyboard.press('Space');
    await page.waitForTimeout(1800);
    await shot(page, '5-boarding');
    await page.keyboard.press('Space');
  }
  expect(await battleTime(page)).toBeGreaterThan(0);

  // Escape → battle menu → let the captains finish it.
  if (!(await page.getByTestId('sea-summary').isVisible())) {
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sea-pause-menu')).toBeVisible();
    await expect(screen).toHaveAttribute('data-paused', 'true');
    await shot(page, '6-menu');
    await page.getByTestId('sea-captains').click();
  }
  await expect(page.getByTestId('sea-summary')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('sea-outcome')).toHaveAttribute('data-outcome', /victory|defeat|escaped|draw/);
  await page.waitForTimeout(400);
  await shot(page, '7-summary');
  await page.getByTestId('sea-return').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a short sea match-up at 1366×768: the merchant raid to its summary', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.routeWebSocket(/./, () => {});
  await page.goto('/');
  await page.getByTestId('menu-skirmish').click();
  await shot(page, 'small-0-presets');
  await page.getByTestId('skirmish-preset-seaMerchant').click();
  await expect(page.getByTestId('sea-howto')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await shot(page, 'small-1-howto');
  await page.getByTestId('sea-howto-start').click();
  await expect(page.getByTestId('sea-battle-screen')).toHaveAttribute('data-paused', 'false');
  // Send the whole fleet at the laden knarr.
  await page.keyboard.press('Control+KeyA');
  const knarr = (await ships(page)).find((s) => s.side === 'foe')!;
  await page.mouse.click(knarr.x, knarr.y, { button: 'right' });
  await page.getByTestId('sea-speed-4').click();
  await page.waitForTimeout(9000);
  await shot(page, 'small-2-mid');
  if (!(await page.getByTestId('sea-summary').isVisible())) {
    await page.getByTestId('sea-menu').click();
    await page.getByTestId('sea-captains').click();
  }
  await expect(page.getByTestId('sea-summary')).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(400);
  await shot(page, 'small-3-summary');
  await page.getByTestId('skirmish-another').click();
  await expect(page.getByTestId('skirmish')).toBeVisible();
  expect(errors).toEqual([]);
});

// ---- the campaign path -------------------------------------------------------------------------

/**
 * Puts a sea fight in front of the player in the running saga, deterministically: the seabattle
 * module's own `startSeaBattle` effect (as an encounter's "Attack" applies it) is run on the current
 * state, and the result is loaded as a save through the store. Dev server only (it imports the live
 * modules by their source path); returns false on a production build.
 */
async function forceSeaFight(page: Page): Promise<boolean> {
  const why = await page.evaluate(async (): Promise<string> => {
    try {
      // Source paths served by the dev server (a variable keeps the type checker out of them).
      const load = (path: string): Promise<unknown> => import(/* @vite-ignore */ path);
      const store = (await load('/src/client/app/gameStore.ts')) as {
        useGame: { getState(): { session: { getState(): Record<string, unknown>; env: unknown } | null; loadFromBlob(blob: string): unknown } };
      };
      const kernel = (await load('/src/sim/core/context.ts')) as {
        runOperation(state: unknown, env: unknown, fn: (draft: unknown, ctx: { applyEffects(e: unknown[]): void }) => void): { state: unknown };
      };
      const save = (await load('/src/sim/save/index.ts')) as { serialize(state: unknown): string };
      const game = store.useGame.getState();
      const session = game.session;
      if (!session) return 'no session';
      const st = session.getState() as { player: { factionId: string }; factions: Record<string, { id: string }> };
      const enemy = Object.values(st.factions).find((f) => f.id !== st.player.factionId);
      if (!enemy) return 'no other faction';
      const r = kernel.runOperation(st, session.env, (_d, ctx) =>
        ctx.applyEffects([
          {
            op: 'startSeaBattle',
            attacker: { factionId: st.player.factionId, ships: [{ type: 'drakkar', crew: 70 }, { type: 'snekkja', crew: 45 }] },
            defender: { factionId: enemy.id, ships: [{ type: 'snekkja', crew: 40 }, { type: 'knarr', crew: 10 }], role: 'raider' },
            origin: 'e2e',
            arena: 'coastal',
            wind: { dir: 300, str: 'fresh' },
          },
        ]),
      );
      game.loadFromBlob(save.serialize(r.state));
      return 'ok';
    } catch (e) {
      return String(e);
    }
  });
  if (why !== 'ok') console.log(`forceSeaFight: ${why}`);
  return why === 'ok';
}

test('a campaign sea fight: take the helm on the setup card, fight in the scene, back to the saga', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.routeWebSocket(/./, () => {});
  await page.goto('/');
  await page.getByTestId('menu-newSaga').click();
  await page.getByTestId('quick-start').click();
  await expect(page.locator('[data-testid="game-shell"][data-mode="hub"]')).toBeVisible({ timeout: 20_000 });
  test.skip(!(await forceSeaFight(page)), 'needs the dev server (the sea fight is forced through the live modules)');

  const setupCard = page.getByTestId('sea-battle-setup');
  await expect(setupCard).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await shot(page, 'campaign-0-setup');
  await expect(page.getByTestId('sea-battle-odds')).toHaveAttribute('data-band', /decisive|likely|even|risky|hopeless/);
  await page.getByTestId('sea-battle-details').locator('summary').click();
  await page.waitForTimeout(200);
  await shot(page, 'campaign-1-setup-details');
  await expect(page.getByTestId('sea-battle-fight')).toBeEnabled();
  await page.getByTestId('sea-battle-fight').click();
  await expect(page.locator('[data-testid="game-shell"][data-mode="seaBattle"]')).toBeVisible();
  await expect(page.getByTestId('sea-howto')).toBeVisible({ timeout: 15_000 });
  await expect(setupCard).toHaveCount(0);
  await page.getByTestId('sea-howto-start').click();
  await page.getByTestId('sea-speed-2').click();
  await page.waitForTimeout(3000);
  await shot(page, 'campaign-2-scene');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sea-pause-menu')).toBeVisible();
  await page.getByTestId('sea-captains').click();
  await expect(page.getByTestId('sea-summary')).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(300);
  await shot(page, 'campaign-3-summary');
  await page.getByTestId('sea-return').click();
  await expect(page.getByTestId('sea-battle-screen')).toHaveCount(0);
  await expect(page.locator('[data-testid="game-shell"][data-mode="hub"]')).toBeVisible();
  await expect(setupCard).toHaveCount(0);
  expect(errors).toEqual([]);
});
