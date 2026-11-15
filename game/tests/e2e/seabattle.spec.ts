import { expect, test, type Page } from '@playwright/test';

/**
 * The sea battle through the real UI, fought with the keyboard (owner play-test 2026-11-15):
 * Main Menu → Skirmish → a sea match-up. Reads the "how to command" card, holds W and sees the
 * flagship gather way, holds D and sees her turn, holds Space to draw (the aim marker runs out from
 * the side) and lets go to loose a volley, checks that P (not Space) pauses, sends the other ship at
 * an enemy with the mouse, then fights on with the keys (steering side-on and loosing when an enemy
 * lies under the marker) until the captains finish it, reads the summary and returns. A second test
 * plays the merchant raid; a third puts a sea fight in front of a quick-start saga, takes the helm
 * on the Before-the-Sea-Battle card, into the scene and back to the saga.
 * Screenshots (1366×768) land in the output folder (BARDIA_E2E_OUT) for a visual check.
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

/** The scene's controller as the tests read it (dev build: exposed on window). */
type SeaHandle = {
  snap: {
    status: string;
    helm: number;
    timeS: number;
    shots: unknown[];
    ships: { idx: number; side: string; status: string; x: number; y: number; heading: number; speedMs: number; isHelm: boolean }[];
  };
  side: string;
  paused: boolean;
  aim: { rangeM: number; side: string } | null;
  aimCfg: { minRangeM: number; maxRangeM: number };
  engine: { inputLog: { input?: { kind: string } }[] };
  volleyState(): string;
  helmShip(): { idx: number; x: number; y: number; heading: number; speedMs: number } | undefined;
};

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

/** The steered ship's speed (m/s) and heading (degrees). */
async function helm(page: Page): Promise<{ idx: number; speed: number; heading: number }> {
  return page.evaluate(() => {
    const c = (window as unknown as { __bardiaSeaBattle?: SeaHandle }).__bardiaSeaBattle;
    const s = c?.helmShip();
    return { idx: s?.idx ?? -1, speed: s?.speedMs ?? 0, heading: s?.heading ?? 0 };
  });
}

async function looses(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = (window as unknown as { __bardiaSeaBattle?: SeaHandle }).__bardiaSeaBattle;
    return c ? c.engine.inputLog.filter((x) => x.input?.kind === 'loose').length : 0;
  });
}

/** Zooms out (the minus key) until an enemy ship is in clear view; returns its screen position. */
async function enemyInView(page: Page): Promise<ShipPos | undefined> {
  const vp = page.viewportSize() ?? { width: 1366, height: 768 };
  for (let i = 0; i < 10; i++) {
    const foe = (await ships(page)).find((s) => s.side === 'foe' && s.status === 'active' && s.x > 120 && s.x < vp.width - 120 && s.y > 170 && s.y < vp.height - 200);
    if (foe) return foe;
    await page.keyboard.press('Minus');
    await page.waitForTimeout(80);
  }
  return undefined;
}

async function battleTime(page: Page): Promise<number> {
  const text = (await page.getByTestId('sea-clock').textContent()) ?? '';
  const m = /(\d+):(\d+)/.exec(text);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/**
 * What the keys should do now (read in the page): the turn toward having the nearest enemy on the
 * beam at about 55 m, and — when the bows are ready and the enemy lies near the line square to the
 * keel — the range to loose at.
 */
async function plan(page: Page): Promise<{ over: boolean; turn: number; ahead: boolean; loose: number | null }> {
  return page.evaluate(() => {
    const c = (window as unknown as { __bardiaSeaBattle?: SeaHandle }).__bardiaSeaBattle;
    if (!c || c.snap.status !== 'running') return { over: true, turn: 0, ahead: false, loose: null };
    const me = c.helmShip();
    if (!me) return { over: true, turn: 0, ahead: false, loose: null };
    let foe: SeaHandle['snap']['ships'][number] | undefined;
    let best = Infinity;
    for (const s of c.snap.ships) {
      if (s.side === c.side || s.status !== 'active') continue;
      const d = Math.hypot(s.x - me.x, s.y - me.y);
      if (d < best) {
        best = d;
        foe = s;
      }
    }
    if (!foe) return { over: true, turn: 0, ahead: false, loose: null };
    const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
    const to = (Math.atan2(foe.x - me.x, -(foe.y - me.y)) * 180) / Math.PI;
    const beamA = wrap(to - 90);
    const beamB = wrap(to + 90);
    const want = best > 80 ? to : Math.abs(wrap(beamA - me.heading)) < Math.abs(wrap(beamB - me.heading)) ? beamA : beamB;
    const turn = wrap(want - me.heading);
    let loose: number | null = null;
    if (c.volleyState() === 'ready') {
      const h = (me.heading * Math.PI) / 180;
      const fh = (foe.heading * Math.PI) / 180;
      const lead = 1.2 + best / 40;
      const fx = foe.x + Math.sin(fh) * foe.speedMs * lead - me.x;
      const fy = foe.y - Math.cos(fh) * foe.speedMs * lead - me.y;
      const out = Math.abs(fx * Math.cos(h) + fy * Math.sin(h));
      const along = fx * Math.sin(h) - fy * Math.cos(h);
      if (Math.abs(along) < 9 && out >= c.aimCfg.minRangeM && out <= c.aimCfg.maxRangeM) loose = out;
    }
    return { over: false, turn, ahead: best > 40, loose };
  });
}

/** Holds Space until the marker reaches `rangeM` (± 4 m), then lets go. */
async function drawAndLoose(page: Page, rangeM: number): Promise<void> {
  await page.keyboard.down('Space');
  await page
    .waitForFunction(
      (r) => {
        const c = (window as unknown as { __bardiaSeaBattle?: SeaHandle }).__bardiaSeaBattle;
        return !c?.aim || Math.abs(c.aim.rangeM - r) < 4;
      },
      rangeM,
      { timeout: 3000, polling: 'raf' },
    )
    .catch(() => undefined);
  await page.keyboard.up('Space');
}

/** Fights with the keys for `seconds` of real time: steer side-on, loose when the enemy lies under the line. */
async function fightWithKeys(page: Page, seconds: number): Promise<void> {
  const until = Date.now() + seconds * 1000;
  let held: string | null = null;
  const hold = async (k: string | null) => {
    if (held === k) return;
    if (held) await page.keyboard.up(held);
    if (k) await page.keyboard.down(k);
    held = k;
  };
  await page.keyboard.down('KeyW');
  while (Date.now() < until) {
    const p = await plan(page);
    if (p.over) break;
    await hold(p.turn > 12 ? 'KeyD' : p.turn < -12 ? 'KeyA' : null);
    if (p.loose !== null) await drawAndLoose(page, p.loose);
    else await page.waitForTimeout(120);
  }
  await hold(null);
  await page.keyboard.up('KeyW');
}

test('a sea skirmish fought with the keys: steer, draw and loose, to the summary', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  // Other agents edit this folder while the dev server runs: cut the HMR socket so no reload interrupts the battle.
  await page.routeWebSocket(/./, () => {});
  await page.goto('/');
  await page.getByTestId('menu-skirmish').click();
  await expect(page.getByTestId('skirmish')).toBeVisible();
  for (const id of ['seaPair', 'seaMerchant', 'seaStand']) await expect(page.getByTestId(`skirmish-preset-${id}`)).toBeVisible();

  await page.getByTestId('skirmish-preset-seaPair').click();
  const screen = page.getByTestId('sea-battle-screen');
  await expect(screen).toBeVisible();
  await expect(page.getByTestId('sea-canvas')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('sea-howto')).toBeVisible();
  await expect(page.getByTestId('sea-howto-lead')).toHaveText(/W A S D steer · hold Space to draw, let go to loose/);
  await page.waitForTimeout(700);
  await shot(page, '1-howto');
  await page.getByTestId('sea-howto-start').click();
  await expect(screen).toHaveAttribute('data-paused', 'false');
  const strip = page.getByTestId('sea-helm');
  await expect(strip).toBeVisible();
  await expect(strip).toHaveAttribute('data-volley', 'ready');
  const start = await helm(page);
  expect(start.idx).toBeGreaterThanOrEqual(0);
  expect(start.speed).toBeLessThan(0.3);

  // Hold W: she gathers way.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  const underway = await helm(page);
  expect(underway.speed).toBeGreaterThan(0.8);
  await expect(strip).not.toHaveAttribute('data-way', 'stopped');
  await shot(page, '2-underway');
  // Hold D as well: she turns to starboard.
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyD');
  const turned = await helm(page);
  const dh = ((turned.heading - underway.heading + 540) % 360) - 180;
  expect(dh).toBeGreaterThan(8);
  await page.keyboard.up('KeyW');

  // Hold Space: the bows are drawn and the marker runs out; let go: a volley is loosed.
  await page.keyboard.down('Space');
  await page.waitForTimeout(450);
  await expect(strip).toHaveClass(/is-drawing/);
  const aim = await page.evaluate(() => (window as unknown as { __bardiaSeaBattle?: SeaHandle }).__bardiaSeaBattle?.aim ?? null);
  expect(aim).not.toBeNull();
  await shot(page, '3-aim');
  await page.keyboard.up('Space');
  await expect.poll(() => looses(page)).toBe(1);
  await expect(strip).toHaveAttribute('data-volley', 'nocking');
  await page.waitForTimeout(250);
  await shot(page, '4-loosed');
  // Space no longer pauses; P does.
  await expect(screen).toHaveAttribute('data-paused', 'false');
  await page.keyboard.press('KeyP');
  await expect(screen).toHaveAttribute('data-paused', 'true');
  await page.keyboard.press('KeyP');
  await expect(screen).toHaveAttribute('data-paused', 'false');

  // The mouse still commands the other ship: Shift+2 selects it, a right click sends it at an enemy.
  await page.keyboard.press('Shift+Digit2');
  await expect(page.getByTestId('sea-ship-cards').locator('.sv-card')).toHaveCount(1);
  await page.keyboard.press('KeyP');
  const target = await enemyInView(page);
  expect(target).toBeDefined();
  await page.mouse.click(target!.x, target!.y, { button: 'right' });
  await expect(page.getByTestId('sea-ship-doing').first()).toHaveText(/Closing to board|Shooting from bowshot|Going in to ram/);
  await shot(page, '5-orders');
  // C: the camera follows your ship again.
  await page.keyboard.press('KeyC');
  await page.keyboard.press('KeyP');

  // Fight on with the keys at 2× (steer side-on, loose when the enemy lies under the line).
  await page.getByTestId('sea-speed-2').click();
  await fightWithKeys(page, 45);
  await shot(page, '6-fight');
  expect(await looses(page)).toBeGreaterThan(1);
  expect(await battleTime(page)).toBeGreaterThan(0);

  // Escape → battle menu → let the captains finish it.
  if (!(await page.getByTestId('sea-summary').isVisible())) {
    if (await page.getByTestId('sea-duel').isVisible()) await page.getByTestId('sea-duel-fight').click();
    await page.keyboard.press('Escape');
    if (await page.getByTestId('sea-pause-menu').isVisible()) {
      await expect(screen).toHaveAttribute('data-paused', 'true');
      await page.getByTestId('sea-captains').click();
    }
  }
  await expect(page.getByTestId('sea-summary')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('sea-outcome')).toHaveAttribute('data-outcome', /victory|defeat|escaped|draw/);
  await page.waitForTimeout(400);
  await shot(page, '7-summary');
  await page.getByTestId('sea-return').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the merchant raid: Tab takes another helm, the fleet is sent with the mouse, to the summary', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.routeWebSocket(/./, () => {});
  await page.goto('/');
  await page.getByTestId('menu-skirmish').click();
  await page.getByTestId('skirmish-preset-seaMerchant').click();
  await expect(page.getByTestId('sea-howto')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('sea-howto-start').click();
  await expect(page.getByTestId('sea-battle-screen')).toHaveAttribute('data-paused', 'false');
  const first = await helm(page);
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await helm(page)).idx).not.toBe(first.idx);
  await expect(page.getByTestId('sea-helm')).toHaveAttribute('data-ship', String((await helm(page)).idx));
  await page.keyboard.press('Digit1');
  await expect.poll(async () => (await helm(page)).idx).toBe(first.idx);
  // Send the whole fleet at the laden knarr; the steered ship stays in hand.
  await page.keyboard.press('Control+KeyA');
  const knarr = await enemyInView(page);
  expect(knarr).toBeDefined();
  await page.mouse.click(knarr!.x, knarr!.y, { button: 'right' });
  await page.keyboard.press('KeyC');
  await page.getByTestId('sea-speed-4').click();
  await fightWithKeys(page, 12);
  await shot(page, 'small-2-mid');
  if (!(await page.getByTestId('sea-summary').isVisible())) {
    if (await page.getByTestId('sea-duel').isVisible()) await page.getByTestId('sea-duel-fight').click();
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
  await expect(page.getByTestId('sea-battle-fight')).toBeEnabled();
  await page.getByTestId('sea-battle-fight').click();
  await expect(page.locator('[data-testid="game-shell"][data-mode="seaBattle"]')).toBeVisible();
  await expect(page.getByTestId('sea-howto')).toBeVisible({ timeout: 15_000 });
  await expect(setupCard).toHaveCount(0);
  await page.getByTestId('sea-howto-start').click();
  await page.getByTestId('sea-speed-2').click();
  // The keys steer in the campaign as in a skirmish.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  expect((await helm(page)).speed).toBeGreaterThan(0.5);
  await page.keyboard.up('KeyW');
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
