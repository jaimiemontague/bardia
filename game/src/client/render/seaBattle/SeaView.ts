/**
 * The sea-battle view (PixiJS 8). Layers, bottom to top:
 *   world layer (camera transform): open water beyond the arena and the baked arena (shoals, shores,
 *     islands, rocks);
 *   screen layer (redrawn every frame): swell crests and wind streaks moving downwind, wakes, the
 *     ships (hull, shields, sail, oars, crew, flags, damage), the gold ring of the ship at the
 *     player's helm, smoke, grapnel lines, arrows in flight, rams and sinkings, order lines, selection
 *     rings, hull bars, the bowshot rail and the aim marker off the steered ship's side, the player's
 *     volleys in flight and where they will fall, the selection box;
 *   label layer: ship numbers and names, floating captions.
 * The camera follows the ship the player steers (with the nearest enemy in frame when close) until
 * the player drags or zooms; C (or the HUD) gives it back. Without a helm it frames the fight. The
 * view reads the battle through `SeaViewSource` (the scene's controller) and reports pointer input
 * through `SeaViewInput`; it never orders the engine itself.
 */
import { Application, Container, Graphics, Sprite, Text, Texture, type TextStyleOptions } from 'pixi.js';
import type { SeaAim, SeaAimConfig, SeaFx, SeaVolleyState } from '../../screens/seaBattle/controller';
import type { SeaBroadside, SeaRenderState, SeaShipView, SeaSideKey } from '@sim/seabattle/index';
import { clampSeaCamera, easeCamera, frameRect, minSeaScale, shipInflation, toScreen, toWorld, zoomAround, type SeaCamera, type SeaInsets, type SeaViewport } from './camera';
import { FX, hash01, SEA, SIDE, type SidePalette } from './palette';
import { drawRope, drawShip, drawSmoke, forwardOf, halfBeam, hullKind } from './ships';
import { bakeSeaCanvas, SEA_PX } from './water';

/** What the view needs to draw a frame. */
export interface SeaViewSource {
  readonly snap: SeaRenderState;
  readonly alpha: number;
  readonly side: SeaSideKey;
  readonly selected: readonly number[];
  readonly fx: readonly SeaFx[];
  readonly sunkAt: Readonly<Record<number, number>>;
  readonly realTime: number;
  readonly fastForward: boolean;
  /** The aim marker while the player draws (Space held), else null. */
  readonly aim: SeaAim | null;
  readonly aimCfg: SeaAimConfig;
  /** What the steered ship's bows can do now, and the side facing the nearest enemy. */
  volleyState(): SeaVolleyState;
  aimSide(): SeaBroadside;
}

/** Pointer input in world (metre) coordinates; `tolM` and `inflate` describe the pick area. */
export interface SeaViewInput {
  click(x: number, y: number, tolM: number, inflate: number, add: boolean): void;
  doubleClick(x: number, y: number, tolM: number, inflate: number): void;
  box(x0: number, y0: number, x1: number, y1: number, add: boolean): void;
  command(x: number, y: number, tolM: number, inflate: number): void;
  hover(ship: number, screenX: number, screenY: number): void;
  /** Called every animation frame with the elapsed real seconds, before drawing. */
  frame(dtS: number): void;
  /** The camera stopped (false) or started (true) following the fight. */
  follow?(on: boolean): void;
}

const LABEL_STYLE: TextStyleOptions = { fontFamily: '"EB Garamond", Georgia, serif', fontSize: 14, fill: 0xf4ead6, fontWeight: '700', stroke: { color: 0x0b0806, width: 3, join: 'round' } };
const NUM_STYLE: TextStyleOptions = { fontFamily: 'Cinzel, Georgia, serif', fontSize: 13, fill: 0xfff2a8, fontWeight: '700', stroke: { color: 0x0b0806, width: 3, join: 'round' } };
const FX_STYLE: TextStyleOptions = { fontFamily: 'Cinzel, Georgia, serif', fontSize: 17, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x120a04, width: 4, join: 'round' } };

/** Pick tolerance around a hull, in screen pixels. */
const PICK_PX = 9;

interface ShipLabel {
  num: Text;
  name: Text;
  key: string;
}

export class SeaView {
  private app: Application | null = null;
  private host: HTMLElement | null = null;
  private readonly worldLayer = new Container();
  private readonly g = new Graphics();
  private readonly labelLayer = new Container();
  private readonly fxLayer = new Container();
  private view: SeaViewport = { width: 1, height: 1 };
  private cam: SeaCamera = { x: 1000, y: 1000, scale: 1 };
  private insets: SeaInsets = { top: 72, bottom: 150, left: 20, right: 20 };
  private following = true;
  private fitted = false;
  private readonly labels: Record<number, ShipLabel> = {};
  private readonly fxTexts: Record<number, Text> = {};
  private drag: { button: number; sx: number; sy: number; moved: boolean; cx: number; cy: number } | null = null;
  private box: [number, number, number, number] | null = null;
  private lastClick = { at: 0, sx: 0, sy: 0 };
  private hover = -1;
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;
  private readonly listeners: [string, EventListener][] = [];
  private lastFrame = 0;

  constructor(
    private readonly src: SeaViewSource,
    private readonly input: SeaViewInput,
  ) {}

  /** Creates the Pixi application inside `host`. */
  async mount(host: HTMLElement): Promise<void> {
    this.host = host;
    const app = new Application();
    await app.init({ resizeTo: host, background: SEA.outside, antialias: true, autoDensity: true, resolution: Math.min(2, globalThis.devicePixelRatio || 1) });
    if (this.destroyed) {
      app.destroy(true);
      return;
    }
    this.app = app;
    host.appendChild(app.canvas);
    app.canvas.style.display = 'block';
    app.canvas.style.touchAction = 'none';
    app.canvas.setAttribute('data-testid', 'sea-canvas');
    const arena = this.src.snap.arena;
    const outside = new Graphics();
    outside.rect(-arena.sizeM, -arena.sizeM, arena.sizeM * 3, arena.sizeM * 3).fill({ color: SEA.outside });
    const sea = new Sprite(Texture.from(bakeSeaCanvas(arena, SEA_PX)));
    sea.scale.set(arena.cellM / SEA_PX);
    const edge = new Graphics();
    edge.rect(0, 0, arena.sizeM, arena.sizeM).stroke({ width: 6, color: 0x9fd0d8, alpha: 0.18 });
    this.worldLayer.addChild(outside, sea, edge);
    app.stage.addChild(this.worldLayer, this.g, this.labelLayer, this.fxLayer);
    this.measure();
    this.bindPointer(app.canvas);
    this.resizeObserver = new ResizeObserver(() => this.measure());
    this.resizeObserver.observe(host);
    this.lastFrame = performance.now();
    app.ticker.add(() => this.tick());
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    if (this.app) {
      for (const [type, fn] of this.listeners) this.app.canvas.removeEventListener(type, fn);
      this.app.destroy(true, { children: true, texture: true });
    }
    this.app = null;
  }

  /** Screen areas the HUD covers (kept out of the auto-framing). */
  setInsets(insets: SeaInsets): void {
    this.insets = insets;
  }

  /** Whether the camera follows the fight by itself. */
  get isFollowing(): boolean {
    return this.following;
  }

  setFollow(on: boolean): void {
    if (this.following === on) return;
    this.following = on;
    this.input.follow?.(on);
  }

  panScreen(dx: number, dy: number): void {
    this.setFollow(false);
    this.cam = clampSeaCamera({ ...this.cam, x: this.cam.x + dx / this.cam.scale, y: this.cam.y + dy / this.cam.scale }, this.view, this.src.snap.arena.sizeM);
  }

  zoomBy(factor: number): void {
    this.setFollow(false);
    this.cam = zoomAround(this.cam, this.view, factor, this.view.width / 2, this.view.height / 2, this.src.snap.arena.sizeM);
  }

  /** Centres the camera on a world point (stops following). */
  centreOn(x: number, y: number): void {
    this.setFollow(false);
    this.cam = clampSeaCamera({ ...this.cam, x, y, scale: Math.max(this.cam.scale, 2) }, this.view, this.src.snap.arena.sizeM);
  }

  /** Screen position of a world point (for HTML overlays). */
  screenOf(x: number, y: number): [number, number] {
    return toScreen(this.cam, this.view, x, y);
  }

  // ---------------------------------------------------------------------------------------------

  private measure(): void {
    const w = this.host?.clientWidth ?? 1;
    const h = this.host?.clientHeight ?? 1;
    this.view = { width: Math.max(1, w), height: Math.max(1, h) };
    if (!this.fitted && w > 10 && h > 10) {
      this.fitted = true;
      this.cam = this.followTarget();
    } else this.cam = clampSeaCamera(this.cam, this.view, this.src.snap.arena.sizeM);
  }

  /** The camera framing every ship still afloat. */
  private followTarget(): SeaCamera {
    const snap = this.src.snap;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    // A boarding of the player's: close in on the lashed decks (true to scale, the fight readable).
    for (const b of snap.boardings) {
      const a = snap.ships[b.attacker];
      const d = snap.ships[b.defender];
      if (!a || !d || (a.side !== this.src.side && d.side !== this.src.side)) continue;
      for (const s of [a, d]) {
        x0 = Math.min(x0, s.x);
        y0 = Math.min(y0, s.y);
        x1 = Math.max(x1, s.x);
        y1 = Math.max(y1, s.y);
      }
    }
    if (Number.isFinite(x0)) {
      const pad = 45;
      return frameRect(this.view, this.insets, x0 - pad, y0 - pad, x1 + pad, y1 + pad, snap.arena.sizeM, 5.5, 150);
    }
    // The ship at the player's helm: her bowshot all round, a little ahead of her, and the nearest
    // enemy too when it is close enough to fight.
    const helm = snap.helm >= 0 ? snap.ships[snap.helm] : undefined;
    if (helm && helm.status === 'active' && !this.src.fastForward) {
      const [hx, hy, hh] = this.pose(helm);
      const [fx, fy] = forwardOf(hh);
      const lead = helm.speedMs * 4;
      const R = this.src.aimCfg.maxRangeM + 25;
      const cx = hx + fx * lead;
      const cy = hy + fy * lead;
      let ax = cx - R;
      let ay = cy - R;
      let bx = cx + R;
      let by = cy + R;
      let near: SeaShipView | undefined;
      let nearD = 360;
      for (const s of snap.ships) {
        if (s.side === this.src.side || s.status !== 'active') continue;
        const d = Math.hypot(s.x - hx, s.y - hy);
        if (d < nearD) {
          nearD = d;
          near = s;
        }
      }
      if (near) {
        ax = Math.min(ax, near.x - 40);
        ay = Math.min(ay, near.y - 40);
        bx = Math.max(bx, near.x + 40);
        by = Math.max(by, near.y + 40);
      }
      return frameRect(this.view, this.insets, ax, ay, bx, by, snap.arena.sizeM, 3.6, 2 * R);
    }
    // The action around the player's fleet: ships far from it (a runaway, a distant straggler) do not
    // pull the camera out.
    let fx = 0;
    let fy = 0;
    let n = 0;
    for (const s of snap.ships) {
      if (s.side !== this.src.side || s.status !== 'active') continue;
      fx += s.x;
      fy += s.y;
      n++;
    }
    const near = (s: SeaShipView) => n === 0 || s.side === this.src.side || Math.hypot(s.x - fx / n, s.y - fy / n) < 1150;
    for (const s of snap.ships) {
      if ((s.status !== 'active' && s.status !== 'struck') || !near(s)) continue;
      x0 = Math.min(x0, s.x);
      y0 = Math.min(y0, s.y);
      x1 = Math.max(x1, s.x);
      y1 = Math.max(y1, s.y);
    }
    if (!Number.isFinite(x0)) {
      const c = snap.arena.sizeM / 2;
      return clampSeaCamera({ x: c, y: c, scale: minSeaScale(this.view, snap.arena.sizeM) }, this.view, snap.arena.sizeM);
    }
    const pad = 80;
    return frameRect(this.view, this.insets, x0 - pad, y0 - pad, x1 + pad, y1 + pad, snap.arena.sizeM);
  }

  private tick(): void {
    const now = performance.now();
    const dt = Math.min(0.25, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.input.frame(dt);
    if (!this.app || this.destroyed) return;
    const helmCam = this.src.snap.helm >= 0 && !this.src.fastForward;
    if (this.following && !this.drag) this.cam = easeCamera(this.cam, this.followTarget(), dt, this.src.fastForward ? 4 : helmCam ? 2.6 : 1.6);
    this.draw();
  }

  private sx(x: number, y: number): [number, number] {
    return toScreen(this.cam, this.view, x, y);
  }

  /** Interpolated pose of a ship. */
  private pose(s: SeaShipView): [number, number, number] {
    const a = this.src.snap.status === 'running' ? this.src.alpha : 1;
    let d = (((s.heading - s.prevHeading) % 360) + 540) % 360 - 180;
    if (!Number.isFinite(d)) d = 0;
    return [s.prevX + (s.x - s.prevX) * a, s.prevY + (s.y - s.prevY) * a, s.prevHeading + d * a];
  }

  private palOf(side: SeaSideKey): SidePalette {
    return side === this.src.side ? SIDE.player : SIDE.enemy;
  }

  private draw(): void {
    const cam = this.cam;
    const src = this.src;
    const snap = src.snap;
    const t = src.realTime;
    this.worldLayer.scale.set(cam.scale);
    this.worldLayer.position.set(this.view.width / 2 - cam.x * cam.scale, this.view.height / 2 - cam.y * cam.scale);
    const g = this.g;
    g.clear();
    const S = cam.scale;
    const inflate = shipInflation(S);
    const k = S * inflate;
    // Downwind (the wind direction is where it blows FROM).
    const [downX, downY] = forwardOf(snap.wind.dir + 180);
    const strength = { calm: 0.15, light: 0.35, fresh: 0.6, strong: 0.85, gale: 1 }[snap.wind.str] ?? 0.5;

    this.drawSwell(g, t, downX, downY, strength);

    const poses: Record<number, [number, number, number]> = {};
    for (const s of snap.ships) poses[s.idx] = this.pose(s);
    // Ships drawn larger than life would overlap where they lie lashed together: ease each pair apart
    // just enough that the drawn rails touch (the boarding then reads as two decks side by side).
    const beamScale = Math.min(1.45, 1 + 0.3 * (inflate - 1));
    for (const b of snap.boardings) {
      const a = snap.ships[b.attacker];
      const d = snap.ships[b.defender];
      const pa = poses[b.attacker];
      const pd = poses[b.defender];
      if (!a || !d || !pa || !pd) continue;
      const need = ((a.beamM + d.beamM) / 2) * beamScale * inflate + 4 / S;
      let ux = pd[0] - pa[0];
      let uy = pd[1] - pa[1];
      const dist = Math.hypot(ux, uy);
      if (dist >= need) continue;
      if (dist < 1e-3) {
        [ux, uy] = forwardOf(pa[2] + 90);
      } else {
        ux /= dist;
        uy /= dist;
      }
      const push = (need - dist) / 2;
      poses[b.attacker] = [pa[0] - ux * push, pa[1] - uy * push, pa[2]];
      poses[b.defender] = [pd[0] + ux * push, pd[1] + uy * push, pd[2]];
    }
    const boardersOn: Record<number, { men: number; side: SeaSideKey }> = {};
    for (const b of snap.boardings) {
      if (b.phase !== 'fighting') continue;
      const a = snap.ships[b.attacker];
      const d = snap.ships[b.defender];
      if (a && d) boardersOn[d.idx] = { men: a.boarders + a.archers * 0.5, side: a.side };
    }

    // Ships (sunk ones first, under the living), then smoke over them.
    const order = [...snap.ships].sort((a, b) => Number(a.status === 'active') - Number(b.status === 'active'));
    const selected = new Set(src.selected);
    for (const s of order) {
      if (s.status === 'fled') continue;
      const [x, y, h] = poses[s.idx]!;
      const [X, Y] = this.sx(x, y);
      const margin = s.lengthM * k;
      if (X < -margin || Y < -margin || X > this.view.width + margin || Y > this.view.height + margin) continue;
      const gone = s.status === 'sunk' || s.status === 'burned';
      let sinking = 0;
      if (gone) {
        const at = src.sunkAt[s.idx];
        const age = at === undefined ? 99 : t - at;
        if (age >= 5) {
          this.drawFlotsam(g, X, Y, k, s.idx, t);
          continue;
        }
        sinking = age / 5;
      }
      if (s.isHelm && s.status === 'active') this.drawHelmRing(g, s, X, Y, h, k, t);
      if (selected.has(s.idx) || this.hover === s.idx) this.drawRing(g, s, X, Y, h, k, selected.has(s.idx) ? FX.select : s.side === src.side ? FX.hover : FX.attack);
      const board = boardersOn[s.idx];
      const ctx = {
        sx: X,
        sy: Y,
        heading: h,
        k,
        pal: this.palOf(s.side),
        t,
        downX,
        downY,
        windFrom: snap.wind.dir,
        boarders: board?.men ?? 0,
        sinking,
        playerFlag: s.isPlayer,
        beamScale,
      } as Parameters<typeof drawShip>[2];
      if (board) ctx.boarderPal = this.palOf(board.side);
      if (s.status === 'captured') ctx.captor = this.palOf(s.side === 'attacker' ? 'defender' : 'attacker');
      drawShip(g, s, ctx);
      if (gone) {
        // Foam rings where she goes down.
        for (let r = 0; r < 3; r++) g.circle(X, Y, (s.lengthM * 0.4 + sinking * 14 + r * 5) * k * 0.6).stroke({ width: 1.5, color: SEA.foam, alpha: (1 - sinking) * 0.5 });
      }
    }
    for (const s of snap.ships) {
      if (s.status !== 'active' && s.status !== 'struck') continue;
      const [x, y] = poses[s.idx]!;
      const [X, Y] = this.sx(x, y);
      drawSmoke(g, s, { sx: X, sy: Y, k, t, downX, downY });
    }

    // Grapnel lines between lashed ships.
    for (const b of snap.boardings) {
      const a = snap.ships[b.attacker];
      const d = snap.ships[b.defender];
      if (!a || !d) continue;
      const [ax, ay, ah] = poses[a.idx]!;
      const [dx, dy, dh] = poses[d.idx]!;
      for (let i = 0; i < 3; i++) {
        const u = (i - 1) * 0.25;
        const pa = this.railPoint(a, ax, ay, ah, u, dx, dy);
        const pd = this.railPoint(d, dx, dy, dh, u, ax, ay);
        drawRope(g, pa[0], pa[1], pd[0], pd[1], b.phase === 'lashing' ? 3 : 1, Math.max(1.8, 0.25 * k));
      }
    }

    this.drawOrders(g, snap, poses, selected, k);
    this.drawEffects(g, snap, poses, t, k);
    this.drawBars(g, snap, poses, selected, k);
    this.drawAim(g, snap, poses, t);
    this.drawShots(g, snap, t);
    this.drawPointers(g, snap, poses);

    if (this.box) {
      const [x0, y0, x1, y1] = this.box;
      g.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)).fill({ color: FX.select, alpha: 0.08 }).stroke({ width: 1.5, color: FX.select, alpha: 0.9 });
    }
    this.drawLabels(snap, poses, selected, k);
    this.drawCaptions(t, poses);
    if (this.app) this.app.canvas.style.cursor = this.hover >= 0 ? (snap.ships[this.hover]?.side === src.side ? 'pointer' : 'crosshair') : 'default';
  }

  /** Half the on-screen height of a ship's hull at heading `h` (for labels and bars). */
  private halfHeight(s: SeaShipView, h: number, k: number): number {
    const [fx, fy] = forwardOf(h);
    return Math.abs(fy) * (s.lengthM / 2) * k + Math.abs(fx) * (s.beamM / 2) * k * 1.4;
  }

  private halfWidth(s: SeaShipView, h: number, k: number): number {
    const [fx, fy] = forwardOf(h);
    return Math.abs(fx) * (s.lengthM / 2) * k + Math.abs(fy) * (s.beamM / 2) * k * 1.4;
  }

  /** A point on a ship's rail facing another point (for grapnel lines). */
  private railPoint(s: SeaShipView, x: number, y: number, h: number, t: number, ox: number, oy: number): [number, number] {
    const [fx, fy] = forwardOf(h);
    const rx = -fy;
    const ry = fx;
    const side = (ox - x) * rx + (oy - y) * ry >= 0 ? 1 : -1;
    const v = halfBeam(hullKind(s.type), s.beamM, t) * side * 0.95;
    const u = t * s.lengthM * 0.5;
    const k = this.cam.scale * shipInflation(this.cam.scale);
    const [X, Y] = this.sx(x, y);
    return [X + (fx * u + rx * v) * k, Y + (fy * u + ry * v) * k];
  }

  /**
   * The moving sea: small curling crests across the wind that swell up, drift downwind and fade, and
   * in a stronger wind a few whitecaps. Anchored to the water, so they slide past as the camera moves.
   */
  private drawSwell(g: Graphics, t: number, downX: number, downY: number, strength: number): void {
    const S = this.cam.scale;
    const arena = this.src.snap.arena;
    const spacingPx = 74;
    const spacing = spacingPx / S;
    const speed = (3 + 7 * strength) * Math.max(1, 1.4 / S);
    const [wx0, wy0] = toWorld(this.cam, this.view, 0, 0);
    const [wx1, wy1] = toWorld(this.cam, this.view, this.view.width, this.view.height);
    const i0 = Math.floor((wx0 - spacing * 2) / spacing);
    const i1 = Math.ceil((wx1 + spacing) / spacing);
    const j0 = Math.floor((wy0 - spacing * 2) / spacing);
    const j1 = Math.ceil((wy1 + spacing) / spacing);
    const downA = Math.atan2(downY, downX);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const h1 = hash01(i, j, 11);
        const h2 = hash01(i, j, 12);
        const h3 = hash01(i, j, 13);
        // Each crest lives a cycle: it rises, rolls downwind a little and sinks back.
        const period = 3.5 + 3 * h3;
        const phase = (t / period + h1) % 1;
        const life = Math.sin(phase * Math.PI);
        const travel = phase * speed * period * 0.5;
        const wx = (i + h1) * spacing + downX * travel;
        const wy = (j + h2) * spacing + downY * travel;
        if (wx >= 0 && wy >= 0 && wx < arena.sizeM && wy < arena.sizeM) {
          const code = arena.terrain[Math.floor(wy / arena.cellM) * arena.w + Math.floor(wx / arena.cellM)];
          if (code === 2 || code === 3) continue;
        }
        const [X, Y] = this.sx(wx, wy);
        const r = 10 + 9 * h2 + 6 * strength;
        const a = (0.05 + 0.13 * strength) * life;
        // An arc bulging downwind: its centre sits upwind of the crest.
        const cx = X - downX * r * 0.7;
        const cy = Y - downY * r * 0.7;
        const span = 0.75 + 0.25 * h3;
        g.moveTo(cx + Math.cos(downA - span) * r, cy + Math.sin(downA - span) * r)
          .arc(cx, cy, r, downA - span, downA + span)
          .stroke({ width: 1.6, color: SEA.crest, alpha: a });
        if (h3 > 0.55) {
          g.moveTo(cx - downX * 5 + Math.cos(downA - span * 0.7) * r, cy - downY * 5 + Math.sin(downA - span * 0.7) * r)
            .arc(cx - downX * 5, cy - downY * 5, r, downA - span * 0.7, downA + span * 0.7)
            .stroke({ width: 1.2, color: SEA.crest, alpha: a * 0.6 });
        }
        // Whitecaps in a fresh wind or more.
        if (strength >= 0.55 && h3 > 0.8 && life > 0.6) g.circle(X + downX * 2, Y + downY * 2, 1.4 + strength).fill({ color: 0xffffff, alpha: 0.25 * life * strength });
      }
    }
  }

  private drawFlotsam(g: Graphics, X: number, Y: number, k: number, idx: number, t: number): void {
    for (let i = 0; i < 5; i++) {
      const bob = Math.sin(t * 1.2 + i) * 0.6;
      const x = X + (hash01(idx, i, 1) - 0.5) * 12 * k;
      const y = Y + (hash01(idx, i, 2) - 0.5) * 12 * k + bob;
      const a = hash01(idx, i, 3) * Math.PI;
      const l = Math.max(2, 1.6 * k);
      g.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l).lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l).stroke({ width: Math.max(1, 0.4 * k), color: FX.splinter, alpha: 0.55 });
    }
  }

  private drawRing(g: Graphics, s: SeaShipView, X: number, Y: number, h: number, k: number, color: number): void {
    const [fx, fy] = forwardOf(h);
    const rx = -fy;
    const ry = fx;
    const a = (s.lengthM / 2) * k + 7;
    const b = (s.beamM / 2) * k + 7;
    const pts: number[] = [];
    for (let i = 0; i < 28; i++) {
      const th = (i / 28) * Math.PI * 2;
      const u = Math.cos(th) * a;
      const v = Math.sin(th) * b;
      pts.push(X + fx * u + rx * v, Y + fy * u + ry * v);
    }
    g.poly(pts).fill({ color, alpha: 0.08 }).stroke({ width: 2, color, alpha: 0.95 });
  }

  /** The ship at the player's helm: a gold ring that breathes a little, and a chevron off her bow. */
  private drawHelmRing(g: Graphics, s: SeaShipView, X: number, Y: number, h: number, k: number, t: number): void {
    const [fx, fy] = forwardOf(h);
    const rx = -fy;
    const ry = fx;
    const pulse = 1 + 0.05 * Math.sin(t * 3);
    const a = ((s.lengthM / 2) * k + 13) * pulse;
    const b = ((s.beamM / 2) * k * 1.4 + 13) * pulse;
    const pts: number[] = [];
    for (let i = 0; i < 32; i++) {
      const th = (i / 32) * Math.PI * 2;
      const u = Math.cos(th) * a;
      const v = Math.sin(th) * b;
      pts.push(X + fx * u + rx * v, Y + fy * u + ry * v);
    }
    g.poly(pts).fill({ color: FX.helm, alpha: 0.1 }).stroke({ width: 3, color: FX.helm, alpha: 0.95 });
    // A chevron ahead of the bow shows which way she points.
    const tip = a + 14;
    const cx = X + fx * tip;
    const cy = Y + fy * tip;
    g.poly([cx + fx * 9, cy + fy * 9, cx - fx * 3 + rx * 8, cy - fy * 3 + ry * 8, cx - fx * 3 - rx * 8, cy - fy * 3 - ry * 8]).fill({ color: FX.helm, alpha: 0.95 });
  }

  /**
   * Off the steered ship's side facing the enemy: a faint rail from the shortest to the longest
   * bowshot while the bows are ready, and while Space is held the aim marker running along it (a
   * circle the size of the fall of shot, true to scale).
   */
  private drawAim(g: Graphics, snap: SeaRenderState, poses: Record<number, [number, number, number]>, t: number): void {
    const src = this.src;
    const helm = snap.helm >= 0 ? snap.ships[snap.helm] : undefined;
    if (!helm || helm.status !== 'active' || src.fastForward || snap.status !== 'running') return;
    const aim = src.aim;
    const state = src.volleyState();
    if (!aim && state !== 'ready') return;
    const pose = poses[helm.idx];
    if (!pose) return;
    const side = aim ? aim.side : src.aimSide();
    const [fx, fy] = forwardOf(pose[2]);
    const [ux, uy] = side === 'starboard' ? [-fy, fx] : [fy, -fx];
    const cfg = src.aimCfg;
    const S = this.cam.scale;
    const at = (r: number) => this.sx(pose[0] + ux * r, pose[1] + uy * r);
    const [ax, ay] = at(cfg.minRangeM);
    const [bx, by] = at(cfg.maxRangeM);
    const railA = aim ? 0.75 : 0.4 + 0.15 * Math.sin(t * 4);
    this.dashed(g, ax, ay, bx, by, FX.shoot, aim ? 2.4 : 1.8, railA);
    // Ticks every 20 m across the rail, and a bar at each end.
    const tx = -uy;
    const ty = ux;
    for (let r = cfg.minRangeM; r <= cfg.maxRangeM + 1e-6; r += 20) {
      const [px, py] = at(r);
      const w = r === cfg.minRangeM || r + 20 > cfg.maxRangeM ? 9 : 5;
      g.moveTo(px - tx * w, py - ty * w).lineTo(px + tx * w, py + ty * w).stroke({ width: 1.6, color: FX.shoot, alpha: railA });
    }
    if (!aim) return;
    const [mx, my] = at(aim.rangeM);
    const rad = Math.max(10, cfg.fallRadiusM * S);
    const [sx, sy] = at(0);
    g.moveTo(sx, sy).lineTo(mx, my).stroke({ width: 2, color: FX.shoot, alpha: 0.55 });
    g.circle(mx, my, rad).fill({ color: FX.shoot, alpha: 0.18 }).stroke({ width: 3, color: FX.aim, alpha: 0.95 });
    g.circle(mx, my, rad * 0.45).stroke({ width: 1.5, color: FX.aim, alpha: 0.8 });
    g.moveTo(mx - rad * 1.25, my).lineTo(mx - rad * 0.6, my).moveTo(mx + rad * 0.6, my).lineTo(mx + rad * 1.25, my);
    g.moveTo(mx, my - rad * 1.25).lineTo(mx, my - rad * 0.6).moveTo(mx, my + rad * 0.6).lineTo(mx, my + rad * 1.25);
    g.stroke({ width: 2, color: FX.aim, alpha: 0.95 });
  }

  /**
   * Ships out of view: a pointer at the edge of the free screen, red for enemies (larger the nearer
   * they are), small and blue for the player's own, so the helmsman always knows where to steer.
   */
  private drawPointers(g: Graphics, snap: SeaRenderState, poses: Record<number, [number, number, number]>): void {
    if (this.src.fastForward || snap.status === 'ended') return;
    const W = this.view.width;
    const H = this.view.height;
    const left = 26;
    const right = W - 26;
    const top = this.insets.top + 34;
    const bottom = H - 26;
    const cx = W / 2;
    const cy = H / 2;
    const helm = snap.helm >= 0 ? snap.ships[snap.helm] : undefined;
    for (const s of snap.ships) {
      if (s.status !== 'active') continue;
      const p = poses[s.idx];
      if (!p) continue;
      const [X, Y] = this.sx(p[0], p[1]);
      if (X >= 0 && X <= W && Y >= this.insets.top && Y <= H) continue;
      const dx = X - cx;
      const dy = Y - cy;
      // Where the line from the centre leaves the free rectangle.
      const kx = dx > 0 ? (right - cx) / dx : dx < 0 ? (left - cx) / dx : Infinity;
      const ky = dy > 0 ? (bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity;
      const k = Math.min(kx, ky);
      if (!Number.isFinite(k) || k <= 0) continue;
      const px = cx + dx * k;
      const py = cy + dy * k;
      const l = Math.max(1e-6, Math.hypot(dx, dy));
      const ux = dx / l;
      const uy = dy / l;
      const foe = s.side !== this.src.side;
      const dist = helm ? Math.hypot(p[0] - helm.x, p[1] - helm.y) : 600;
      const size = foe ? 11 + 9 * Math.max(0, Math.min(1, 1 - dist / 900)) : 8;
      const color = foe ? SIDE.enemy.fill : SIDE.player.fill;
      const tip = [px + ux * size, py + uy * size];
      const b1 = [px - ux * size * 0.6 - uy * size * 0.75, py - uy * size * 0.6 + ux * size * 0.75];
      const b2 = [px - ux * size * 0.6 + uy * size * 0.75, py - uy * size * 0.6 - ux * size * 0.75];
      g.poly([tip[0]!, tip[1]!, b1[0]!, b1[1]!, b2[0]!, b2[1]!])
        .fill({ color, alpha: foe ? 0.95 : 0.7 })
        .stroke({ width: 2, color: 0x0b0806, alpha: 0.8 });
    }
  }

  /** The player's volleys in flight: a sheaf of arrows arcing out, and a ring where they will fall. */
  private drawShots(g: Graphics, snap: SeaRenderState, t: number): void {
    if (snap.shots.length === 0) return;
    const a = snap.status === 'running' ? this.src.alpha : 1;
    const now = snap.timeS - snap.stepS * (1 - a);
    const S = this.cam.scale;
    const rad = Math.max(8, this.src.aimCfg.fallRadiusM * S);
    for (const [n, shot] of snap.shots.entries()) {
      const span = Math.max(1e-6, shot.landT - shot.firedT);
      const p = Math.max(0, Math.min(1, (now - shot.firedT) / span));
      const [x0, y0] = this.sx(shot.fromX, shot.fromY);
      const [x1, y1] = this.sx(shot.x, shot.y);
      const d = Math.hypot(x1 - x0, y1 - y0);
      const nx = -(y1 - y0) / Math.max(1, d);
      const ny = (x1 - x0) / Math.max(1, d);
      // Where they will come down.
      g.circle(x1, y1, rad).stroke({ width: 2, color: shot.fire ? FX.fire : FX.shoot, alpha: 0.35 + 0.35 * p });
      for (let i = 0; i < 11; i++) {
        const q = Math.max(0, Math.min(1, p - (hash01(n, i, 5) - 0.5) * 0.08));
        const jx = (hash01(n + 17, i, 1) - 0.5) * 2 * rad * q;
        const jy = (hash01(n + 17, i, 2) - 0.5) * 2 * rad * q;
        const arc = Math.sin(q * Math.PI) * d * 0.16;
        const x = x0 + (x1 - x0) * q + nx * arc + jx;
        const y = y0 + (y1 - y0) * q + ny * arc + jy;
        const vx = x1 - x0 + nx * Math.cos(q * Math.PI) * d * 0.5;
        const vy = y1 - y0 + ny * Math.cos(q * Math.PI) * d * 0.5;
        const vl = Math.max(1e-6, Math.hypot(vx, vy));
        const L = Math.max(7, 2.4 * S);
        g.moveTo(x - (vx / vl) * L, y - (vy / vl) * L)
          .lineTo(x, y)
          .stroke({ width: shot.fire ? 2.4 : 1.7, color: shot.fire ? FX.fire : FX.arrow, alpha: 0.95 });
        if (shot.fire) g.circle(x, y, 2.6 + Math.sin(t * 20 + i)).fill({ color: FX.fireCore, alpha: 0.95 });
        else g.circle(x - (vx / vl) * L, y - (vy / vl) * L, 1.3).fill({ color: 0xf0e8d8, alpha: 0.9 });
      }
    }
  }

  private dashed(g: Graphics, x0: number, y0: number, x1: number, y1: number, color: number, width: number, alpha: number): void {
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (d < 1) return;
    const n = Math.max(1, Math.floor(d / 12));
    for (let k = 0; k < n; k++) {
      const a = k / n;
      const b = Math.min(1, (k + 0.6) / n);
      g.moveTo(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a).lineTo(x0 + (x1 - x0) * b, y0 + (y1 - y0) * b);
    }
    g.stroke({ width, color, alpha });
  }

  /** Where the selected ships are going and whom they are after. */
  private drawOrders(g: Graphics, snap: SeaRenderState, poses: Record<number, [number, number, number]>, selected: Set<number>, k: number): void {
    for (const s of snap.ships) {
      if (s.side !== this.src.side || s.status !== 'active') continue;
      const sel = selected.has(s.idx);
      const [x, y] = poses[s.idx]!;
      const [X, Y] = this.sx(x, y);
      if (s.moveTo) {
        const [tx, ty] = this.sx(s.moveTo.x, s.moveTo.y);
        this.dashed(g, X, Y, tx, ty, FX.move, sel ? 2.2 : 1.4, sel ? 0.9 : 0.45);
        g.circle(tx, ty, sel ? 7 : 5).stroke({ width: 2, color: FX.move, alpha: sel ? 0.95 : 0.5 });
        continue;
      }
      const attacking = s.order === 'attack' || s.order === 'board' || s.order === 'shoot';
      const target = attacking ? snap.ships[s.orderTarget] : undefined;
      if (target && (target.status === 'active' || target.status === 'struck')) {
        const [tx, ty] = poses[target.idx]!;
        const [TX, TY] = this.sx(tx, ty);
        const color = s.order === 'shoot' ? FX.shoot : FX.attack;
        this.dashed(g, X, Y, TX, TY, color, sel ? 2.2 : 1.3, sel ? 0.85 : 0.35);
        if (sel) g.circle(TX, TY, (target.lengthM / 2) * k + 9).stroke({ width: 2, color, alpha: 0.8 });
      }
    }
  }

  /** Arrows, rams, sea-fire and sinkings. */
  private drawEffects(g: Graphics, snap: SeaRenderState, poses: Record<number, [number, number, number]>, t: number, k: number): void {
    for (const f of this.src.fx) {
      const age = t - f.born;
      if (f.kind === 'arrows' && f.from !== undefined && f.to !== undefined) {
        const a = poses[f.from];
        const b = poses[f.to];
        if (!a || !b || age > 1.4) continue;
        const [ax, ay] = this.sx(a[0], a[1]);
        const [bx, by] = this.sx(b[0], b[1]);
        const d = Math.hypot(bx - ax, by - ay);
        const nx = -(by - ay) / Math.max(1, d);
        const ny = (bx - ax) / Math.max(1, d);
        const n = f.n ?? 4;
        for (let i = 0; i < n; i++) {
          const p = (age - i * 0.05) / 0.75;
          if (p < 0 || p > 1) continue;
          const jx = (hash01(f.id, i, 1) - 0.5) * 6 * k;
          const jy = (hash01(f.id, i, 2) - 0.5) * 6 * k;
          const arc = Math.sin(p * Math.PI) * d * 0.14;
          const x = ax + (bx - ax) * p + nx * arc + jx * p;
          const y = ay + (by - ay) * p + ny * arc + jy * p;
          const vx = bx - ax + nx * Math.cos(p * Math.PI) * d * 0.44;
          const vy = by - ay + ny * Math.cos(p * Math.PI) * d * 0.44;
          const vl = Math.max(1e-6, Math.hypot(vx, vy));
          const L = Math.max(6, 2.2 * k);
          g.moveTo(x - (vx / vl) * L, y - (vy / vl) * L)
            .lineTo(x, y)
            .stroke({ width: f.fire ? 2.2 : 1.5, color: f.fire ? FX.fire : FX.arrow, alpha: 0.95 });
          if (f.fire) g.circle(x, y, 2.6).fill({ color: FX.fireCore, alpha: 0.95 });
          else g.circle(x - (vx / vl) * L, y - (vy / vl) * L, 1.2).fill({ color: 0xf0e8d8, alpha: 0.9 });
        }
        // Splashes where the misses fall.
        if (age > 0.7 && age < 1.3) {
          for (let i = 0; i < 3; i++) {
            const r = (age - 0.7) * 18;
            const x = bx + (hash01(f.id, i, 7) - 0.5) * 18 * k;
            const y = by + (hash01(f.id, i, 8) - 0.5) * 18 * k;
            g.circle(x, y, Math.max(1, r * 0.4)).stroke({ width: 1, color: SEA.foam, alpha: (1.3 - age) * 0.8 });
          }
        }
      } else if (f.kind === 'fall' && age < 1.4) {
        // The fall of shot: splashes across the circle, a red flash where men were struck.
        const [X, Y] = this.sx(f.x, f.y);
        const rad = Math.max(8, this.src.aimCfg.fallRadiusM * this.cam.scale);
        const hit = (f.n ?? 0) > 0;
        g.circle(X, Y, rad * (1 + age * 0.5)).stroke({ width: 2.5, color: hit ? FX.attack : SEA.foam, alpha: (1 - age / 1.4) * 0.8 });
        for (let i = 0; i < 10; i++) {
          const r = rad * Math.sqrt(hash01(f.id, i, 9));
          const a = hash01(f.id, i, 10) * Math.PI * 2;
          const sx = X + Math.cos(a) * r;
          const sy = Y + Math.sin(a) * r;
          g.circle(sx, sy, 1.5 + age * 6).stroke({ width: 1.2, color: SEA.foam, alpha: (1 - age / 1.4) * 0.75 });
        }
      } else if (f.kind === 'ram' && age < 1.6) {
        const p = poses[f.to ?? -1];
        const [X, Y] = p ? this.sx(p[0], p[1]) : this.sx(f.x, f.y);
        for (let i = 0; i < 9; i++) {
          const a = hash01(f.id, i, 3) * Math.PI * 2;
          const r = (6 + age * 40) * (0.6 + hash01(f.id, i, 4));
          g.moveTo(X + Math.cos(a) * r * 0.6, Y + Math.sin(a) * r * 0.6)
            .lineTo(X + Math.cos(a) * r, Y + Math.sin(a) * r)
            .stroke({ width: 2, color: FX.splinter, alpha: 1 - age / 1.6 });
        }
        g.circle(X, Y, 10 + age * 30).stroke({ width: 3, color: SEA.foam, alpha: (1 - age / 1.6) * 0.7 });
      } else if (f.kind === 'sink' && age < 4) {
        const [X, Y] = this.sx(f.x, f.y);
        for (let r = 0; r < 3; r++) g.circle(X, Y, (8 + age * 16 + r * 9) * Math.max(1, k * 0.4)).stroke({ width: 2, color: SEA.foam, alpha: (1 - age / 4) * 0.6 });
      } else if (f.kind === 'seaFire' && f.from !== undefined && age < 1.4) {
        const s = snap.ships[f.from];
        const p = poses[f.from];
        if (!s || !p) continue;
        const [fx, fy] = forwardOf(p[2]);
        const [X, Y] = this.sx(p[0], p[1]);
        const len = 34 * k * Math.min(1, age * 3);
        const spread = len * 0.36;
        const bx = X + fx * (s.lengthM / 2) * k;
        const by = Y + fy * (s.lengthM / 2) * k;
        g.poly([bx, by, bx + fx * len - fy * spread, by + fy * len + fx * spread, bx + fx * len + fy * spread, by + fy * len - fx * spread]).fill({ color: FX.fire, alpha: 0.55 * (1 - age / 1.4) });
      } else if (f.kind === 'grapple' && f.from !== undefined && f.to !== undefined && age < 0.8) {
        const a = poses[f.from];
        const b = poses[f.to];
        if (!a || !b) continue;
        const [ax, ay] = this.sx(a[0], a[1]);
        const [bx, by] = this.sx(b[0], b[1]);
        const p = Math.min(1, age / 0.5);
        for (let i = 0; i < 3; i++) {
          const jx = (hash01(f.id, i, 1) - 0.5) * 8 * k;
          const jy = (hash01(f.id, i, 2) - 0.5) * 8 * k;
          drawRope(g, ax, ay, ax + (bx + jx - ax) * p, ay + (by + jy - ay) * p, 6 * (1 - p), 1.4);
        }
      }
    }
  }

  /** Thin hull and crew bars over ships that are damaged, selected or under the pointer. */
  private drawBars(g: Graphics, snap: SeaRenderState, poses: Record<number, [number, number, number]>, selected: Set<number>, k: number): void {
    for (const s of snap.ships) {
      if (s.status !== 'active') continue;
      const show = selected.has(s.idx) || this.hover === s.idx || s.hullPct < 0.97;
      if (!show) continue;
      const [x, y, h] = poses[s.idx]!;
      const [X, Y] = this.sx(x, y);
      const w = 34;
      const top = Y + this.halfHeight(s, h, k) + 8;
      const pal = this.palOf(s.side);
      g.rect(X - w / 2 - 1, top - 1, w + 2, 6).fill({ color: 0x000000, alpha: 0.55 });
      const hull = Math.max(0, Math.min(1, s.hullPct));
      g.rect(X - w / 2, top, w * hull, 4).fill({ color: hull < 0.35 ? 0xd04030 : hull < 0.65 ? 0xe0b040 : 0x6cc060 });
      g.rect(X - w / 2, top - 1, 3, 6).fill({ color: pal.fill });
    }
  }

  private drawLabels(snap: SeaRenderState, poses: Record<number, [number, number, number]>, selected: Set<number>, k: number): void {
    const live = new Set<number>();
    const roster = snap.ships.filter((s) => s.side === this.src.side);
    for (const s of snap.ships) {
      if (s.status !== 'active' && s.status !== 'struck') continue;
      const own = s.side === this.src.side;
      const showName = selected.has(s.idx) || this.hover === s.idx || (s.isHelm && s.status === 'active');
      const num = own ? roster.indexOf(s) + 1 : 0;
      if (!own && !showName) continue;
      live.add(s.idx);
      const label = (this.labels[s.idx] ??= this.makeLabel());
      const key = `${num}|${showName ? s.name : ''}`;
      if (label.key !== key) {
        label.num.text = num > 0 ? String(num) : '';
        label.name.text = showName ? s.name : '';
        label.key = key;
      }
      const [x, y, h] = poses[s.idx]!;
      const [X, Y] = this.sx(x, y);
      const top = Y - this.halfHeight(s, h, k) - 6;
      label.num.position.set(X - this.halfWidth(s, h, k) - 8, Y);
      label.num.visible = num > 0 && !this.src.fastForward;
      label.name.position.set(X, top);
      label.name.visible = showName;
    }
    for (const id of Object.keys(this.labels)) {
      const n = Number(id);
      if (live.has(n)) continue;
      this.labels[n]!.num.destroy();
      this.labels[n]!.name.destroy();
      delete this.labels[n];
    }
  }

  private makeLabel(): ShipLabel {
    const num = new Text({ text: '', style: NUM_STYLE });
    num.resolution = 2;
    num.anchor.set(0.5, 0.5);
    const name = new Text({ text: '', style: LABEL_STYLE });
    name.resolution = 2;
    name.anchor.set(0.5, 1);
    this.labelLayer.addChild(num, name);
    return { num, name, key: '' };
  }

  private drawCaptions(t: number, poses: Record<number, [number, number, number]>): void {
    const live = new Set<number>();
    const stack: Record<number, number> = {};
    for (const f of this.src.fx) {
      if (f.kind !== 'caption' || f.text === undefined) continue;
      const age = t - f.born;
      if (age > 2.6) continue;
      live.add(f.id);
      let text = this.fxTexts[f.id];
      if (!text) {
        text = new Text({ text: f.text, style: { ...FX_STYLE, fill: f.tone === 'good' ? 0x9be37a : f.tone === 'bad' ? 0xff8a70 : 0xfff2c8 } });
        text.anchor.set(0.5, 1);
        text.resolution = 2;
        this.fxTexts[f.id] = text;
        this.fxLayer.addChild(text);
      }
      const p = f.from !== undefined ? poses[f.from] : undefined;
      const [X, Y] = p ? this.sx(p[0], p[1]) : this.sx(f.x, f.y);
      // Several captions over one ship stack instead of printing over each other.
      const key = f.from ?? -1 - f.id;
      const row = (stack[key] = (stack[key] ?? -1) + 1);
      text.position.set(X, Y - 34 - age * 12 - row * 22);
      text.alpha = Math.max(0, 1 - Math.max(0, age - 1.8) / 0.8);
    }
    for (const id of Object.keys(this.fxTexts)) {
      const n = Number(id);
      if (live.has(n)) continue;
      this.fxTexts[n]!.destroy();
      delete this.fxTexts[n];
    }
  }

  // ---- pointer ---------------------------------------------------------------------------------

  private pick(): { tolM: number; inflate: number } {
    return { tolM: PICK_PX / this.cam.scale, inflate: shipInflation(this.cam.scale) };
  }

  private hoverAt(wx: number, wy: number): number {
    const { tolM, inflate } = this.pick();
    let best = -1;
    let bestD = Infinity;
    for (const s of this.src.snap.ships) {
      if (s.status !== 'active' && s.status !== 'struck') continue;
      const [fx, fy] = forwardOf(s.heading);
      const half = Math.max(0, ((s.lengthM - s.beamM) * inflate) / 2);
      const r = (s.beamM * inflate) / 2;
      const dx = wx - s.x;
      const dy = wy - s.y;
      const along = Math.max(-half, Math.min(half, dx * fx + dy * fy));
      const d = Math.max(0, Math.hypot(wx - (s.x + fx * along), wy - (s.y + fy * along)) - r);
      if (d <= tolM && d < bestD) {
        bestD = d;
        best = s.idx;
      }
    }
    return best;
  }

  private bindPointer(canvas: HTMLCanvasElement): void {
    const on = (type: string, fn: EventListener, opts?: AddEventListenerOptions) => {
      canvas.addEventListener(type, fn, opts);
      this.listeners.push([type, fn]);
    };
    const local = (e: PointerEvent | WheelEvent | MouseEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    on('contextmenu', (e) => e.preventDefault());
    on('pointerdown', (ev) => {
      const e = ev as PointerEvent;
      const [sx, sy] = local(e);
      canvas.setPointerCapture?.(e.pointerId);
      this.drag = { button: e.button, sx, sy, moved: false, cx: this.cam.x, cy: this.cam.y };
      if (e.button === 1) e.preventDefault();
    });
    on('pointermove', (ev) => {
      const e = ev as PointerEvent;
      const [sx, sy] = local(e);
      const d = this.drag;
      if (d) {
        if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) > 6) d.moved = true;
        if (d.moved && (d.button === 1 || d.button === 2)) {
          // Middle or right drag pans the sea.
          this.setFollow(false);
          this.cam = clampSeaCamera({ ...this.cam, x: d.cx - (sx - d.sx) / this.cam.scale, y: d.cy - (sy - d.sy) / this.cam.scale }, this.view, this.src.snap.arena.sizeM);
          return;
        }
        if (d.moved && d.button === 0) this.box = [d.sx, d.sy, sx, sy];
      }
      const [wx, wy] = toWorld(this.cam, this.view, sx, sy);
      this.hover = this.hoverAt(wx, wy);
      this.input.hover(this.hover, sx, sy);
    });
    on('pointerleave', () => {
      this.hover = -1;
      this.input.hover(-1, 0, 0);
    });
    on('pointerup', (ev) => {
      const e = ev as PointerEvent;
      const [sx, sy] = local(e);
      const d = this.drag;
      this.drag = null;
      this.box = null;
      if (!d) return;
      const [wx, wy] = toWorld(this.cam, this.view, sx, sy);
      const { tolM, inflate } = this.pick();
      if (d.button === 0) {
        if (d.moved) {
          const [ox, oy] = toWorld(this.cam, this.view, d.sx, d.sy);
          this.input.box(ox, oy, wx, wy, e.shiftKey);
          return;
        }
        const now = performance.now();
        const dbl = now - this.lastClick.at < 320 && Math.hypot(sx - this.lastClick.sx, sy - this.lastClick.sy) < 8;
        this.lastClick = { at: dbl ? 0 : now, sx, sy };
        if (dbl) this.input.doubleClick(wx, wy, tolM, inflate);
        else this.input.click(wx, wy, tolM, inflate, e.shiftKey);
      } else if (d.button === 2 && !d.moved) {
        this.input.command(wx, wy, tolM, inflate);
      }
    });
    on(
      'wheel',
      (ev) => {
        const e = ev as WheelEvent;
        e.preventDefault();
        const [sx, sy] = local(e);
        this.setFollow(false);
        this.cam = zoomAround(this.cam, this.view, e.deltaY < 0 ? 1.15 : 1 / 1.15, sx, sy, this.src.snap.arena.sizeM);
      },
      { passive: false },
    );
  }
}
