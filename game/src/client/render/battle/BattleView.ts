/**
 * The battlefield view (PixiJS 8; design §13.5, §25 battle screen). Layers, bottom to top:
 *   world layer (camera transform): the baked ground (terrain, trees, walls, ships, extraction zone);
 *   screen layer (redrawn every frame): buildings and fire, gates, loot, smoke, order lines, figures,
 *   squad footprints and facing, the arrows of the squads the keys are driving, the aim markers of
 *   archers drawing a volley, arrows in flight, clash sparks, the night veil, the selection box;
 *   label layer: squad badges (name, men, morale and stamina bars) and floating captions.
 * The view reads the battle through `BattleViewSource` (the screen's controller) and reports the
 * player's pointer input through `BattleViewInput`; it never orders the engine itself. The camera
 * opens on the player's war-band and glides after the squads the player drives (tunables.drive);
 * dragging with the middle button looks around and stops the following until the next drive or C.
 */
import { Application, Container, Graphics, Sprite, Text, Texture, type TextStyleOptions } from 'pixi.js';
import type { Content } from '@content/index';
import type { BattleMap } from '@sim/battle/map/grid';
import type { BattleRenderState, SquadView } from '@sim/battle/index';
import { clampBattleCamera, fitBattleScale, toScreen, toWorld, zoomAround, type BattleCamera, type BattleViewport } from './camera';
import { bakeGround, hash01 } from './ground';
import { footprintCorners, lerp, lerpAngle, pickStructure, unitShape, type MapPick, type UnitShape } from './geometry';
import { BUILDING_RGB, COLORS, SIDE_COLORS, mixRgb, rgbHex } from './palette';

/** Pixels per tile of the baked ground texture. */
const GROUND_PX = 10;

/** What the view needs to draw a frame. */
export interface BattleViewSource {
  readonly snap: BattleRenderState;
  readonly side: 'attacker' | 'defender';
  readonly selected: readonly string[];
  readonly inspected: string | null;
  readonly planned: Readonly<Record<string, { kind: string; x: number; y: number; target?: string }>>;
  readonly targeting: string | null;
  readonly fx: readonly { id: number; x: number; y: number; text: string; tone: 'good' | 'bad' | 'neutral'; born: number }[];
  readonly realTime: number;
  readonly engine: { readonly alpha: number; readonly state: { readonly map: BattleMap } };
  /** The camera follows `followPoint()` while this is on. */
  readonly cameraFollow: boolean;
  /** The squads the held keys are driving. */
  readonly driven: readonly string[];
  followPoint(): [number, number] | null;
  /** Aim markers of archers drawing a volley (marker, and the near and far ends of its run). */
  aimView(): readonly { id: string; x: number; y: number; nearX: number; nearY: number; farX: number; farY: number }[];
  rosterIds(): string[];
  squadName(id: string): string;
  unitName(unitId: string): string;
}

/** Pointer input in world (tile) coordinates. */
export interface BattleViewInput {
  click(x: number, y: number, add: boolean): void;
  doubleClick(x: number, y: number): void;
  box(x0: number, y0: number, x1: number, y1: number, add: boolean): void;
  command(x: number, y: number, opts: { facing?: number; queue: boolean; run: boolean }): void;
  hover(target: BattleHover | null, screenX: number, screenY: number): void;
  cancel(): void;
  /** The player started looking around with the mouse (the camera stops following). */
  lookAround(): void;
  /** Called every animation frame with the elapsed real seconds, before drawing. */
  frame(dtS: number): void;
}

/** What the pointer is over. */
export type BattleHover = { kind: 'squad'; id: string } | MapPick;

interface Badge {
  bg: Graphics;
  name: Text;
  key: string;
}

const NAME_STYLE: TextStyleOptions = { fontFamily: '"EB Garamond", Georgia, serif', fontSize: 12, fill: 0xf4ead6, fontWeight: '600' };
const FX_STYLE: TextStyleOptions = { fontFamily: 'Cinzel, Georgia, serif', fontSize: 14, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x120a04, width: 4, join: 'round' } };

export class BattleView {
  private app: Application | null = null;
  private host: HTMLElement | null = null;
  private readonly worldLayer = new Container();
  private readonly g = new Graphics();
  private readonly labelLayer = new Container();
  private readonly fxLayer = new Container();
  private ground: Sprite | null = null;
  private view: BattleViewport = { width: 1, height: 1 };
  private cam: BattleCamera = { x: 48, y: 36, scale: 10 };
  private fitted = false;
  private readonly badges: Record<string, Badge> = {};
  private readonly fxTexts: Record<number, Text> = {};
  private readonly shapes: Record<string, UnitShape> = {};
  private drag: { button: number; sx: number; sy: number; moved: boolean } | null = null;
  private pan: { sx: number; sy: number; cx: number; cy: number } | null = null;
  private box: [number, number, number, number] | null = null;
  private rightAim: [number, number, number, number] | null = null;
  private lastClick = { at: 0, sx: 0, sy: 0 };
  private hover: BattleHover | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;
  private readonly listeners: [string, EventListener][] = [];
  private lastFrame = 0;

  constructor(
    private readonly src: BattleViewSource,
    private readonly input: BattleViewInput,
    private readonly content: Content,
  ) {}

  /** Creates the Pixi application inside `host`. */
  async mount(host: HTMLElement): Promise<void> {
    this.host = host;
    const app = new Application();
    await app.init({ resizeTo: host, background: 0x1a1410, antialias: true, autoDensity: true, resolution: Math.min(2, globalThis.devicePixelRatio || 1) });
    if (this.destroyed) {
      app.destroy(true);
      return;
    }
    this.app = app;
    host.appendChild(app.canvas);
    app.canvas.style.display = 'block';
    app.canvas.style.touchAction = 'none';
    app.canvas.setAttribute('data-testid', 'battle-canvas');
    const map = this.src.engine.state.map;
    this.ground = new Sprite(Texture.from(bakeGround(map, GROUND_PX)));
    this.ground.scale.set(1 / GROUND_PX);
    this.worldLayer.addChild(this.ground);
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
      window.removeEventListener('pointerup', this.onWindowUp);
      this.app.destroy(true, { children: true, texture: true });
    }
    this.app = null;
  }

  /** Pans by screen pixels (arrow keys). */
  panScreen(dx: number, dy: number): void {
    const map = this.src.engine.state.map;
    this.cam = clampBattleCamera({ ...this.cam, x: this.cam.x + dx / this.cam.scale, y: this.cam.y + dy / this.cam.scale }, this.view, map.w, map.h);
  }

  zoomBy(factor: number): void {
    const map = this.src.engine.state.map;
    this.cam = zoomAround(this.cam, this.view, factor, this.view.width / 2, this.view.height / 2, map.w, map.h);
  }

  /** Centres the camera on a world point. */
  centreOn(x: number, y: number): void {
    const map = this.src.engine.state.map;
    this.cam = clampBattleCamera({ ...this.cam, x, y }, this.view, map.w, map.h);
  }

  /** Fits the whole field. */
  fit(): void {
    const map = this.src.engine.state.map;
    this.cam = clampBattleCamera({ x: map.w / 2, y: map.h / 2, scale: fitBattleScale(this.view, map.w, map.h) }, this.view, map.w, map.h);
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
      this.openOnBand();
    } else {
      const map = this.src.engine.state.map;
      this.cam = clampBattleCamera(this.cam, this.view, map.w, map.h);
    }
  }

  /** Opening view: zoomed in on the player's war-band (tunables.drive.cameraViewTiles across). */
  private openOnBand(): void {
    const map = this.src.engine.state.map;
    const fitScale = fitBattleScale(this.view, map.w, map.h);
    const scale = Math.max(fitScale, this.view.width / this.content.tunables.battle.drive.cameraViewTiles);
    const p = this.src.followPoint() ?? [map.w / 2, map.h / 2];
    this.cam = clampBattleCamera({ x: p[0], y: p[1], scale }, this.view, map.w, map.h);
  }

  /** Glides the camera toward the followed squads (frame-rate independent). */
  private follow(dt: number): void {
    if (!this.src.cameraFollow || this.pan) return;
    const p = this.src.followPoint();
    if (!p) return;
    const k = 1 - Math.exp(-this.content.tunables.battle.drive.cameraFollowRate * dt);
    const map = this.src.engine.state.map;
    this.cam = clampBattleCamera({ ...this.cam, x: this.cam.x + (p[0] - this.cam.x) * k, y: this.cam.y + (p[1] - this.cam.y) * k }, this.view, map.w, map.h);
  }

  private tick(): void {
    const now = performance.now();
    const dt = Math.min(0.25, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.input.frame(dt);
    if (!this.app || this.destroyed) return;
    this.follow(dt);
    this.draw();
  }

  private sx(x: number, y: number): [number, number] {
    return toScreen(this.cam, this.view, x, y);
  }

  private shapeOf(unit: string): UnitShape {
    return (this.shapes[unit] ??= unitShape(this.content, unit));
  }

  private draw(): void {
    const cam = this.cam;
    const src = this.src;
    const snap = src.snap;
    const alpha = snap.status === 'running' ? src.engine.alpha : 1;
    const t = src.realTime;
    this.worldLayer.scale.set(cam.scale);
    this.worldLayer.position.set(this.view.width / 2 - cam.x * cam.scale, this.view.height / 2 - cam.y * cam.scale);
    const g = this.g;
    g.clear();
    const S = cam.scale;
    const mine = (side: string) => side === src.side;
    const byId: Record<string, SquadView> = {};
    for (const s of snap.squads) byId[s.id] = s;
    const pos = (s: SquadView): [number, number] => [lerp(s.px, s.x, alpha), lerp(s.py, s.y, alpha)];

    this.drawBuildings(g, snap, S, t);
    this.drawGates(g, snap, S, t);
    // Dropped loot.
    for (const c of snap.caches) {
      if (!c.dropped) continue;
      const [x, y] = this.sx(c.x, c.y);
      g.circle(x, y, Math.max(3, 0.45 * S)).fill({ color: COLORS.gold }).stroke({ width: 1.5, color: COLORS.ink });
    }
    // Smoke drifting with the wind.
    if (snap.smoke.length > 0) {
      const map = src.engine.state.map;
      // Compass bearing the wind comes from; smoke drifts downwind (map x = sin, y = -cos of the bearing).
      const wr = ((snap.wind.dir + 180) * Math.PI) / 180;
      const wx = Math.sin(wr);
      const wy = -Math.cos(wr);
      for (const i of snap.smoke) {
        const tx = (i % map.w) + 0.5;
        const ty = Math.floor(i / map.w) + 0.5;
        const ph = hash01(tx, ty, 5);
        const drift = ((t * 0.4 + ph) % 1) * 1.6 * (0.3 + snap.wind.str);
        const [x, y] = this.sx(tx + wx * drift, ty + wy * drift);
        g.circle(x, y, S * (0.7 + ph * 0.5)).fill({ color: COLORS.smoke, alpha: 0.16 });
      }
    }

    // Orders of the selected squads (and orders planned while paused).
    const selected = new Set(src.selected);
    for (const id of src.selected) {
      const s = byId[id];
      if (!s) continue;
      const [x, y] = pos(s);
      const plan = src.planned[id];
      let kind: string = s.task;
      let tx = s.taskX;
      let ty = s.taskY;
      if (plan) {
        kind = plan.kind;
        tx = plan.x;
        ty = plan.y;
      }
      if (kind === 'attack') {
        const target = byId[plan?.target ?? s.taskTarget ?? ''];
        if (target) [tx, ty] = pos(target);
      }
      if (kind === 'none' || kind === 'halt') continue;
      if (kind === 'drive' && !plan) continue; // drawn as a direction arrow below
      const color = kind === 'attack' || kind === 'gate' ? COLORS.attack : kind === 'loot' ? COLORS.loot : kind === 'torch' || kind === 'volley' ? COLORS.torch : kind === 'retreat' ? COLORS.extract : COLORS.move;
      const [ax, ay] = this.sx(x, y);
      const [bx, by] = this.sx(tx, ty);
      this.dashed(g, ax, ay, bx, by, color, plan ? 2.4 : 1.8, plan ? 0.95 : 0.7);
      if (kind !== 'retreat') g.circle(bx, by, plan ? 6 : 4).stroke({ width: 2, color, alpha: 0.9 });
      let px = tx;
      let py = ty;
      for (let k = 0; k + 1 < s.waypoints.length; k += 2) {
        const [cx, cy] = this.sx(px, py);
        const [dx, dy] = this.sx(s.waypoints[k]!, s.waypoints[k + 1]!);
        this.dashed(g, cx, cy, dx, dy, COLORS.move, 1.4, 0.6);
        g.circle(dx, dy, 3).fill({ color: COLORS.move, alpha: 0.8 });
        px = s.waypoints[k]!;
        py = s.waypoints[k + 1]!;
      }
    }

    // Figures.
    const f = snap.figures;
    const r = Math.max(1.8, 0.36 * S);
    for (let i = 0; i < f.n; i++) {
      const si = f.squad[i]!;
      if (si < 0) continue;
      const s = byId[snap.squadIds[si] ?? ''];
      if (!s) continue;
      const x = lerp(f.px[i]!, f.x[i]!, alpha);
      const y = lerp(f.py[i]!, f.y[i]!, alpha);
      const [X, Y] = this.sx(x, y);
      if (X < -20 || Y < -20 || X > this.view.width + 20 || Y > this.view.height + 20) continue;
      const pal = mine(s.side) ? SIDE_COLORS.player : SIDE_COLORS.enemy;
      const routing = s.status === 'routing';
      const fill = routing ? pal.light : s.status === 'asleep' ? mixHex(pal.fill, 0x222222, 0.5) : pal.fill;
      const facing = lerpAngle(s.pFacing, s.facing, alpha);
      const fx = Math.cos(routing ? facing + Math.PI : facing);
      const fy = Math.sin(routing ? facing + Math.PI : facing);
      const shape = this.shapeOf(s.unit);
      if (shape === 'horse') {
        const L = r * 1.7;
        const W = r * 0.75;
        g.poly([X + fx * L, Y + fy * L, X - fy * W, Y + fx * W, X - fx * L, Y - fy * L, X + fy * W, Y - fx * W]).fill({ color: 0x6b4a2c }).stroke({ width: 1, color: pal.dark });
        g.circle(X, Y, r * 0.6).fill({ color: fill });
      } else if (shape === 'beast') {
        g.circle(X, Y, r * 2.2).fill({ color: 0x4a3322 }).stroke({ width: 2, color: pal.fill });
      } else {
        g.circle(X, Y, r).fill({ color: fill }).stroke({ width: Math.max(0.8, r * 0.3), color: pal.dark });
        if (r >= 2.5 && !routing) {
          if (shape === 'archer') {
            const ax = X + fx * r * 0.6;
            const ay = Y + fy * r * 0.6;
            g.moveTo(ax + Math.cos(facing - 1.1) * r * 0.9, ay + Math.sin(facing - 1.1) * r * 0.9)
              .arc(ax, ay, r * 0.9, facing - 1.1, facing + 1.1)
              .stroke({ width: 1.2, color: 0x2a1a0c });
          }
          else if (shape === 'shield') g.circle(X + fx * r * 0.7, Y + fy * r * 0.7, r * 0.55).fill({ color: 0xd8c08a }).stroke({ width: 0.8, color: pal.dark });
          else if (shape === 'foot') g.moveTo(X + fx * r * 0.4, Y + fy * r * 0.4).lineTo(X + fx * r * 1.7, Y + fy * r * 1.7).stroke({ width: 1, color: 0xd9d2c3 });
        }
      }
    }

    // Squad footprints, facing, state.
    for (const s of snap.squads) {
      const [x, y] = pos(s);
      const facing = lerpAngle(s.pFacing, s.facing, alpha);
      const pal = mine(s.side) ? SIDE_COLORS.player : SIDE_COLORS.enemy;
      const pts = footprintCorners(x, y, facing, s.hw + 0.25, s.hd + 0.25).map((v, k) => (k % 2 === 0 ? (v - cam.x) * S + this.view.width / 2 : (v - cam.y) * S + this.view.height / 2));
      const isSel = selected.has(s.id) || src.inspected === s.id;
      const isHover = this.hover?.kind === 'squad' && this.hover.id === s.id;
      const pulse = 0.5 + 0.5 * Math.sin(t * 7);
      let color: number = pal.fill;
      let width = 1.2;
      let a = 0.55;
      if (s.status === 'routing') {
        color = COLORS.rout;
        width = 1.5;
        a = 0.35 + 0.5 * pulse;
      } else if (s.wavering) {
        color = COLORS.waver;
        width = 2;
        a = 0.45 + 0.5 * pulse;
      }
      if (isSel) {
        color = mine(s.side) ? COLORS.select : COLORS.attack;
        width = 2.6;
        a = 1;
      } else if (isHover) {
        color = COLORS.hover;
        width = 2;
        a = 0.9;
      }
      g.poly(pts).stroke({ width, color, alpha: a });
      if (s.status === 'active') {
        // Facing chevron at the front edge.
        const fx = Math.cos(facing);
        const fy = Math.sin(facing);
        const [cx, cy] = this.sx(x + fx * (s.hd + 0.6), y + fy * (s.hd + 0.6));
        const k = Math.max(4, Math.min(9, S * 0.5));
        g.poly([cx + fx * k, cy + fy * k, cx - fy * k * 0.7, cy + fx * k * 0.7, cx + fy * k * 0.7, cy - fx * k * 0.7]).fill({ color: isSel ? COLORS.select : pal.light, alpha: 0.9 });
      }
      // Clash sparks where squads are locked in melee.
      if (s.activity === 'fighting') {
        const fx = Math.cos(facing);
        const fy = Math.sin(facing);
        for (let k = 0; k < 4; k++) {
          const ph = Math.floor(t * 12) + k * 17 + s.men;
          const lat = (hash01(ph, k, 3) - 0.5) * 2 * s.hw;
          const bx = x + fx * (s.hd + 0.2) - fy * lat;
          const by = y + fy * (s.hd + 0.2) + fx * lat;
          const [X, Y] = this.sx(bx, by);
          const ang = hash01(ph, k, 9) * Math.PI * 2;
          const L = Math.max(3, S * 0.35);
          g.moveTo(X - Math.cos(ang) * L, Y - Math.sin(ang) * L)
            .lineTo(X + Math.cos(ang) * L, Y + Math.sin(ang) * L)
            .stroke({ width: 1.4, color: k % 2 === 0 ? 0xfff3c4 : 0xffb347, alpha: 0.9 });
        }
      }
      // Loot carried: a gold sack behind the squad.
      if (s.loot > 0) {
        const [X, Y] = this.sx(x - Math.cos(facing) * (s.hd + 0.8), y - Math.sin(facing) * (s.hd + 0.8));
        g.circle(X, Y, Math.max(4, S * 0.45)).fill({ color: COLORS.gold }).stroke({ width: 1.5, color: COLORS.ink });
      }
    }

    // The squads the keys are driving: a bright arrow ahead of each, pointing the way they go.
    const driven = new Set(src.driven);
    for (const s of snap.squads) {
      if (s.driveX === 0 && s.driveY === 0) continue;
      if (!driven.has(s.id) && !selected.has(s.id)) continue;
      const [x, y] = pos(s);
      const ux = s.driveX;
      const uy = s.driveY;
      // The footprint's extent along the way it goes (half-width across it, half-depth along it).
      const fc = Math.cos(s.facing);
      const fs = Math.sin(s.facing);
      const reach = s.hw * Math.abs(-fs * ux + fc * uy) + s.hd * Math.abs(fc * ux + fs * uy);
      const [ax, ay] = this.sx(x + ux * (reach + 1.3), y + uy * (reach + 1.3));
      const [bx, by] = this.sx(x + ux * (reach + 3.4), y + uy * (reach + 3.4));
      const k = Math.max(7, Math.min(14, S * 0.75));
      g.moveTo(ax, ay).lineTo(bx - ux * k * 0.6, by - uy * k * 0.6).stroke({ width: Math.max(3, S * 0.22), color: COLORS.select, alpha: 0.95 });
      g.poly([bx + ux * k * 0.5, by + uy * k * 0.5, bx - ux * k * 0.6 - uy * k * 0.7, by - uy * k * 0.6 + ux * k * 0.7, bx - ux * k * 0.6 + uy * k * 0.7, by - uy * k * 0.6 - ux * k * 0.7])
        .fill({ color: COLORS.select, alpha: 0.95 })
        .stroke({ width: 1.5, color: COLORS.ink, alpha: 0.7 });
    }

    // Archers drawing a volley: the line it can reach, and the marker where the arrows will fall.
    const volleyR = this.content.tunables.battle.volleyRadiusTiles;
    for (const m of src.aimView()) {
      const s = byId[m.id];
      if (!s) continue;
      const [x, y] = pos(s);
      const dx = x - s.x;
      const dy = y - s.y;
      const [nx, ny] = this.sx(m.nearX + dx, m.nearY + dy);
      const [fx2, fy2] = this.sx(m.farX + dx, m.farY + dy);
      const [mx, my] = this.sx(m.x + dx, m.y + dy);
      this.dashed(g, nx, ny, fx2, fy2, COLORS.aim, 2, 0.55);
      const ux = Math.cos(s.facing);
      const uy = Math.sin(s.facing);
      for (const [px, py] of [
        [nx, ny],
        [fx2, fy2],
      ] as const) {
        g.moveTo(px - uy * 7, py + ux * 7).lineTo(px + uy * 7, py - ux * 7).stroke({ width: 2, color: COLORS.aim, alpha: 0.8 });
      }
      const R = Math.max(10, volleyR * S);
      g.circle(mx, my, R).fill({ color: COLORS.aim, alpha: 0.18 }).stroke({ width: 3, color: COLORS.aim, alpha: 1 });
      g.circle(mx, my, R * 0.35).stroke({ width: 2, color: COLORS.aim, alpha: 0.9 });
      g.moveTo(mx - R * 1.25, my).lineTo(mx - R * 0.55, my).moveTo(mx + R * 0.55, my).lineTo(mx + R * 1.25, my);
      g.moveTo(mx, my - R * 1.25).lineTo(mx, my - R * 0.55).moveTo(mx, my + R * 0.55).lineTo(mx, my + R * 1.25);
      g.stroke({ width: 2, color: COLORS.aim, alpha: 1 });
    }

    // Arrows in flight (a shallow arc).
    for (const p of snap.projectiles) {
      const tt = Math.min(1, p.t + (alpha * 0.05) / Math.max(0.2, Math.hypot(p.x1 - p.x0, p.y1 - p.y0) / 30));
      const x = lerp(p.x0, p.x1, tt);
      const y = lerp(p.y0, p.y1, tt) - Math.sin(tt * Math.PI) * 1.5;
      const dx = p.x1 - p.x0;
      const dy = p.y1 - p.y0 - Math.cos(tt * Math.PI) * 3;
      const d = Math.max(0.001, Math.hypot(dx, dy));
      const [X, Y] = this.sx(x, y);
      const L = Math.max(4, S * 0.7);
      g.moveTo(X - (dx / d) * L, Y - (dy / d) * L)
        .lineTo(X, Y)
        .stroke({ width: p.fire ? 2 : 1.2, color: p.fire ? COLORS.fire : 0x1d140c, alpha: 0.95 });
      if (p.fire) g.circle(X, Y, 2.5).fill({ color: COLORS.fireCore });
    }

    if (snap.night) g.rect(0, 0, this.view.width, this.view.height).fill({ color: COLORS.night, alpha: 0.32 });
    if (this.box) {
      const [x0, y0, x1, y1] = this.box;
      g.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)).fill({ color: COLORS.select, alpha: 0.08 }).stroke({ width: 1.5, color: COLORS.select, alpha: 0.9 });
    }
    if (this.rightAim) {
      const [x0, y0, x1, y1] = this.rightAim;
      g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 3, color: COLORS.move, alpha: 0.9 });
      const a = Math.atan2(y1 - y0, x1 - x0);
      g.poly([x1 + Math.cos(a) * 10, y1 + Math.sin(a) * 10, x1 - Math.sin(a) * 7, y1 + Math.cos(a) * 7, x1 + Math.sin(a) * 7, y1 - Math.cos(a) * 7]).fill({ color: COLORS.move });
    }
    this.drawBadges(snap, pos);
    this.drawFx(t);
    if (this.app) this.app.canvas.style.cursor = src.targeting !== null ? 'crosshair' : this.hover?.kind === 'squad' ? 'pointer' : 'default';
  }

  private drawBuildings(g: Graphics, snap: BattleRenderState, S: number, t: number): void {
    for (const b of snap.buildings) {
      const [x0, y0] = this.sx(b.x, b.y);
      const w = b.w * S;
      const h = b.h * S;
      if (x0 > this.view.width || y0 > this.view.height || x0 + w < 0 || y0 + h < 0) continue;
      const base = BUILDING_RGB[b.kind] ?? [140, 100, 70];
      let rgb = b.stone ? mixRgb(base, [150, 148, 150], 0.5) : base;
      if (b.collapsed) rgb = [62, 54, 48];
      else if (b.burning) rgb = mixRgb(rgb, [60, 30, 20], b.burnPct * 0.8);
      g.rect(x0 + 2, y0 + 3, w, h).fill({ color: 0x000000, alpha: 0.3 });
      g.rect(x0, y0, w, h).fill({ color: rgbHex(rgb) }).stroke({ width: 1.5, color: COLORS.ink });
      if (!b.collapsed) {
        // Roof ridge along the long side.
        if (w >= h) g.moveTo(x0 + 2, y0 + h / 2).lineTo(x0 + w - 2, y0 + h / 2).stroke({ width: 1.2, color: COLORS.ink, alpha: 0.6 });
        else g.moveTo(x0 + w / 2, y0 + 2).lineTo(x0 + w / 2, y0 + h - 2).stroke({ width: 1.2, color: COLORS.ink, alpha: 0.6 });
      } else {
        g.moveTo(x0, y0).lineTo(x0 + w, y0 + h).moveTo(x0 + w, y0).lineTo(x0, y0 + h).stroke({ width: 1, color: 0x2a2420, alpha: 0.8 });
      }
      const [dx, dy] = this.sx(b.doorX + 0.5, b.doorY + 0.5);
      g.circle(dx, dy, Math.max(1.5, S * 0.18)).fill({ color: 0x3a2412, alpha: 0.8 });
      if (b.isKeep || b.isTreasury) {
        const cx = x0 + w / 2;
        const cy = y0 + h / 2;
        const k = Math.max(5, S * 0.6);
        g.poly([cx - k, cy + k * 0.5, cx - k, cy - k * 0.4, cx - k * 0.4, cy, cx, cy - k * 0.7, cx + k * 0.4, cy, cx + k, cy - k * 0.4, cx + k, cy + k * 0.5]).fill({ color: COLORS.gold }).stroke({ width: 1, color: COLORS.ink });
      }
      if (b.loot > 0 && !b.collapsed) {
        const cx = x0 + w - Math.max(5, S * 0.5);
        const cy = y0 + Math.max(5, S * 0.5);
        g.circle(cx, cy, Math.max(3.5, S * 0.32)).fill({ color: COLORS.gold }).stroke({ width: 1.2, color: COLORS.ink });
      }
      if (b.burning) {
        const n = Math.max(3, Math.round(b.w * b.h * 0.6));
        for (let k = 0; k < n; k++) {
          const fx = b.x + 0.3 + hash01(k, b.w * 31 + b.h, 1) * (b.w - 0.6);
          const fy = b.y + 0.3 + hash01(k, b.w * 17 + b.h, 2) * (b.h - 0.6);
          const flick = 0.6 + 0.4 * Math.sin(t * 9 + k * 1.7);
          const [X, Y] = this.sx(fx, fy - flick * 0.3);
          const R = S * (0.35 + 0.25 * flick) * (1 - b.burnPct * 0.4);
          g.circle(X, Y, R).fill({ color: COLORS.fire, alpha: 0.75 });
          g.circle(X, Y + R * 0.2, R * 0.5).fill({ color: COLORS.fireCore, alpha: 0.9 });
        }
      }
      if (this.hover && this.hover.kind === 'building' && this.hover.id === b.id) g.rect(x0 - 1, y0 - 1, w + 2, h + 2).stroke({ width: 2, color: COLORS.hover, alpha: 0.9 });
    }
  }

  private drawGates(g: Graphics, snap: BattleRenderState, S: number, t: number): void {
    for (const gate of snap.gates) {
      const [x0, y0] = this.sx(gate.x, gate.y);
      const w = gate.w * S;
      const h = gate.h * S;
      if (gate.broken) {
        g.rect(x0, y0, w, h).fill({ color: 0x5a5048, alpha: 0.7 });
        continue;
      }
      const color = gate.burning ? mixHex(0x8a5a28, COLORS.fire, 0.5 + 0.5 * Math.sin(t * 8)) : 0x7a5228;
      g.rect(x0, y0, w, h).fill({ color }).stroke({ width: 2, color: COLORS.ink });
      const vertical = h > w;
      for (let k = 1; k < 4; k++) {
        if (vertical) g.moveTo(x0, y0 + (h * k) / 4).lineTo(x0 + w, y0 + (h * k) / 4);
        else g.moveTo(x0 + (w * k) / 4, y0).lineTo(x0 + (w * k) / 4, y0 + h);
      }
      g.stroke({ width: 1, color: COLORS.ink, alpha: 0.6 });
      if (gate.hpPct < 1) {
        const bw = Math.max(w, 24);
        const bx = x0 + w / 2 - bw / 2;
        const by = y0 - 8;
        g.rect(bx, by, bw, 4).fill({ color: 0x000000, alpha: 0.6 });
        g.rect(bx, by, bw * gate.hpPct, 4).fill({ color: 0xe0a040 });
      }
      if (this.hover && this.hover.kind === 'gate' && this.hover.id === gate.id) g.rect(x0 - 2, y0 - 2, w + 4, h + 4).stroke({ width: 2, color: COLORS.hover });
    }
  }

  private drawBadges(snap: BattleRenderState, pos: (s: SquadView) => [number, number]): void {
    const live = new Set<string>();
    const roster = this.src.rosterIds();
    const S = this.cam.scale;
    for (const s of snap.squads) {
      live.add(s.id);
      const badge = (this.badges[s.id] ??= this.makeBadge());
      const own = s.side === this.src.side;
      const k = own ? roster.indexOf(s.id) + 1 : 0;
      const status = s.status === 'routing' ? ' !' : s.status === 'asleep' ? ' z' : '';
      const label = `${k > 0 ? `${k}  ` : ''}${this.src.squadName(s.id)} · ${s.men}${status}`;
      if (badge.key !== label) {
        badge.name.text = label;
        badge.key = label;
      }
      const [x, y] = pos(s);
      // Above the footprint's highest corner on screen.
      const corners = footprintCorners(x, y, s.facing, s.hw + 0.25, s.hd + 0.25);
      let top = Infinity;
      for (let k = 1; k < corners.length; k += 2) top = Math.min(top, corners[k]!);
      const [X, Y] = this.sx(x, top);
      const w = Math.max(54, badge.name.width + 12);
      const bx = Math.round(X - w / 2);
      const by = Math.round(Y - 30);
      const pal = own ? SIDE_COLORS.player : SIDE_COLORS.enemy;
      const sel = this.src.selected.includes(s.id);
      const bg = badge.bg;
      bg.clear();
      bg.roundRect(bx, by, w, 24, 4).fill({ color: 0x140e09, alpha: 0.78 }).stroke({ width: sel ? 2 : 1, color: sel ? COLORS.select : pal.fill, alpha: 0.95 });
      bg.rect(bx, by, 4, 24).fill({ color: pal.fill });
      // Morale (green → amber → red) and stamina (pale blue) bars.
      const m = Math.max(0, Math.min(1, s.morale / 100));
      const mc = s.morale < 12 ? 0xd04030 : s.morale < 30 ? 0xe0b040 : 0x6cc060;
      bg.rect(bx + 6, by + 16, w - 10, 3).fill({ color: 0x000000, alpha: 0.6 });
      bg.rect(bx + 6, by + 16, (w - 10) * m, 3).fill({ color: mc });
      bg.rect(bx + 6, by + 20, w - 10, 2).fill({ color: 0x000000, alpha: 0.6 });
      bg.rect(bx + 6, by + 20, (w - 10) * Math.max(0, Math.min(1, s.stamina / 100)), 2).fill({ color: 0x8fb8e8 });
      badge.name.position.set(bx + 7, by + 1);
      badge.name.style.fill = s.status === 'routing' ? 0xffd0c0 : 0xf4ead6;
      const hide = S < 6.5 && !sel;
      bg.visible = !hide;
      badge.name.visible = !hide;
    }
    for (const id of Object.keys(this.badges)) {
      if (live.has(id)) continue;
      const b = this.badges[id]!;
      b.bg.destroy();
      b.name.destroy();
      delete this.badges[id];
    }
  }

  private makeBadge(): Badge {
    const bg = new Graphics();
    const name = new Text({ text: '', style: NAME_STYLE });
    name.resolution = 2;
    this.labelLayer.addChild(bg, name);
    return { bg, name, key: '' };
  }

  private drawFx(t: number): void {
    const live = new Set<number>();
    for (const f of this.src.fx) {
      live.add(f.id);
      let text = this.fxTexts[f.id];
      if (!text) {
        text = new Text({ text: f.text, style: { ...FX_STYLE, fill: f.tone === 'good' ? 0x9be37a : f.tone === 'bad' ? 0xff8a70 : 0xfff2c8 } });
        text.anchor.set(0.5, 1);
        text.resolution = 2;
        this.fxTexts[f.id] = text;
        this.fxLayer.addChild(text);
      }
      const age = t - f.born;
      const [X, Y] = this.sx(f.x, f.y);
      text.position.set(X, Y - 30 - age * 16);
      text.alpha = Math.max(0, 1 - Math.max(0, age - 1.6) / 1);
    }
    for (const id of Object.keys(this.fxTexts)) {
      const n = Number(id);
      if (live.has(n)) continue;
      this.fxTexts[n]!.destroy();
      delete this.fxTexts[n];
    }
  }

  private dashed(g: Graphics, x0: number, y0: number, x1: number, y1: number, color: number, width: number, alpha: number): void {
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (d < 1) return;
    const n = Math.max(1, Math.floor(d / 10));
    for (let k = 0; k < n; k++) {
      const a = k / n;
      const b = Math.min(1, (k + 0.6) / n);
      g.moveTo(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a).lineTo(x0 + (x1 - x0) * b, y0 + (y1 - y0) * b);
    }
    g.stroke({ width, color, alpha });
  }

  // ---- pointer ---------------------------------------------------------------------------------

  private readonly onWindowUp = (): void => {
    this.pan = null;
  };

  private hoverAt(wx: number, wy: number): BattleHover | null {
    const snap = this.src.snap;
    // Squads: the nearest footprint within half a tile.
    let best: SquadView | null = null;
    let bestD = Infinity;
    for (const s of snap.squads) {
      const d = Math.hypot(s.x - wx, s.y - wy) - Math.max(s.hw, s.hd);
      if (d < 0.6 && d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (best) return { kind: 'squad', id: best.id };
    const pick = pickStructure(this.src.engine.state.map, snap.buildings, snap.gates, snap.caches, wx, wy);
    return pick.kind === 'ground' ? null : pick;
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
      if (e.button === 1) {
        this.pan = { sx, sy, cx: this.cam.x, cy: this.cam.y };
        this.input.lookAround();
        e.preventDefault();
        return;
      }
      this.drag = { button: e.button, sx, sy, moved: false };
    });
    on('pointermove', (ev) => {
      const e = ev as PointerEvent;
      const [sx, sy] = local(e);
      if (this.pan) {
        const map = this.src.engine.state.map;
        this.cam = clampBattleCamera({ ...this.cam, x: this.pan.cx - (sx - this.pan.sx) / this.cam.scale, y: this.pan.cy - (sy - this.pan.sy) / this.cam.scale }, this.view, map.w, map.h);
        return;
      }
      const [wx, wy] = toWorld(this.cam, this.view, sx, sy);
      const d = this.drag;
      if (d) {
        if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) > 6) d.moved = true;
        if (d.moved && d.button === 0 && this.src.targeting === null) this.box = [d.sx, d.sy, sx, sy];
        if (d.moved && d.button === 2) this.rightAim = [d.sx, d.sy, sx, sy];
      }
      this.hover = this.hoverAt(wx, wy);
      this.input.hover(this.hover, sx, sy);
    });
    on('pointerleave', () => {
      this.hover = null;
      this.input.hover(null, 0, 0);
    });
    on('pointerup', (ev) => {
      const e = ev as PointerEvent;
      const [sx, sy] = local(e);
      if (this.pan && e.button === 1) {
        this.pan = null;
        return;
      }
      const d = this.drag;
      this.drag = null;
      this.box = null;
      this.rightAim = null;
      if (!d) return;
      const [wx, wy] = toWorld(this.cam, this.view, sx, sy);
      const [ox, oy] = toWorld(this.cam, this.view, d.sx, d.sy);
      if (d.button === 0) {
        if (d.moved && this.src.targeting === null) {
          this.input.box(ox, oy, wx, wy, e.shiftKey);
          return;
        }
        const now = performance.now();
        const dbl = now - this.lastClick.at < 320 && Math.hypot(sx - this.lastClick.sx, sy - this.lastClick.sy) < 8;
        this.lastClick = { at: dbl ? 0 : now, sx, sy };
        if (dbl) this.input.doubleClick(wx, wy);
        else this.input.click(wx, wy, e.shiftKey);
      } else if (d.button === 2) {
        if (this.src.targeting !== null) {
          this.input.cancel();
          return;
        }
        const opts: { facing?: number; queue: boolean; run: boolean } = { queue: e.shiftKey, run: e.ctrlKey || e.altKey };
        if (d.moved && Math.hypot(wx - ox, wy - oy) > 1) {
          opts.facing = Math.atan2(wy - oy, wx - ox);
          this.input.command(ox, oy, opts);
        } else this.input.command(wx, wy, opts);
      }
    });
    on(
      'wheel',
      (ev) => {
        const e = ev as WheelEvent;
        e.preventDefault();
        const [sx, sy] = local(e);
        const map = this.src.engine.state.map;
        this.cam = zoomAround(this.cam, this.view, e.deltaY < 0 ? 1.15 : 1 / 1.15, sx, sy, map.w, map.h);
      },
      { passive: false },
    );
    window.addEventListener('pointerup', this.onWindowUp);
  }
}

function mixHex(a: number, b: number, t: number): number {
  const ra = (a >> 16) & 255;
  const ga = (a >> 8) & 255;
  const ba = a & 255;
  const rb = (b >> 16) & 255;
  const gb = (b >> 8) & 255;
  const bb = b & 255;
  return (Math.round(ra + (rb - ra) * t) << 16) | (Math.round(ga + (gb - ga) * t) << 8) | Math.round(ba + (bb - ba) * t);
}
