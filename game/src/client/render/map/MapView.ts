/**
 * The world-map view (PixiJS 8; SCR-12, design §8.10, §25.4). Layers, bottom to top:
 *   world layer (camera transform): the baked base chart · the map-mode tint · the fog of the unknown;
 *   screen layer (redrawn when the camera or the scene changes): routes, storm cells, sites, settlements, fleets;
 *   labels (decluttered per zoom band);
 *   ships and war-bands (redrawn every frame while they glide: the sim moves them in whole hours, the view
 *   interpolates, see motion.ts; art in shipArt.ts). The camera can follow the expedition with a soft dead zone.
 * Everything it draws comes from the pure builders of this folder; the view owns only Pixi objects, the camera and
 * the pointer. It reads GameState and never writes it: selection goes out through `onSelect`.
 */
import { Application, Container, Graphics, Sprite, Text, Texture, type TextStyleOptions } from 'pixi.js';
import type { GameState } from '@sim/core/state';
import type { StaticWorld } from '@sim/modules/world/map/index';
import { BAND_PRESETS, cameraLimits, clampCamera, fitScale, panBy, screenToWorld, worldToScreen, zoomAt, zoomBand, type Camera, type CameraLimits, type Viewport } from './camera';
import { bakeBaseChart, bakeFog, bakeTint } from './chart';
import { CHART, readMapPalette, type MapPalette } from './colors';
import { declutterLabels, estimateTextWidth, type LabelCandidate, type Obstacle } from './declutter';
import { dashPolyline } from './geometry';
import { cellTarget, pickMarker, targetKey, type ScreenMarker } from './hitTest';
import { knowledgeAt, knowledgeSignature, readKnowledge } from './knowledge';
import { buildLabelDefs, labelFontSize, labelLetterSpacing, labelPlacements, labelPriority, labelVisible, settlementIconSize, settlementIconVisible, type MapLabelDef } from './labels';
import { buildOverlay } from './overlays';
import { followCamera, MotionTracker } from './motion';
import { buildMapScene, factionColor, tierRank } from './scene';
import { bannerBearerShapes, longshipShapes, paintShapes, shipLength, shipPose, smallShipShapes, wakeShapes } from './shipArt';
import { KNOW_UNKNOWN, type MapModeId, type MapScene, type MapTarget, type OverlayData, type Vec2, type ZoomBand } from './types';

/** Pixels per cell of the baked textures. */
const BASE_P = 4;
const OVERLAY_P = 2;

export interface MapViewOptions {
  onSelect?(target: MapTarget | null): void;
  onHover?(target: MapTarget | null, screenX: number, screenY: number): void;
  /** Bake progress 0…1 (the screen shows a loading veil). */
  onProgress?(share: number): void;
  /** Called when the overlay data changes (the screen draws the legend). */
  onOverlay?(overlay: OverlayData): void;
  /** Called when the zoom band changes. */
  onBand?(band: ZoomBand): void;
  /** Called when the camera starts or stops following the expedition (dragging the map detaches it). */
  onFollow?(following: boolean): void;
}

interface LabelStyleKey {
  kind: MapLabelDef['kind'];
  size: number;
  home: boolean;
  faint: boolean;
}

function styleFor(k: LabelStyleKey, spacing: number): TextStyleOptions {
  const base: TextStyleOptions = { fontSize: k.size, letterSpacing: spacing, stroke: { color: CHART.parchment, width: Math.max(2, k.size * 0.22), join: 'round' } };
  switch (k.kind) {
    case 'region':
      return { ...base, fontFamily: 'Cinzel, serif', fill: 0x5a3a1c, fontWeight: '600' };
    case 'sea':
      return { ...base, fontFamily: '"EB Garamond", serif', fontStyle: 'italic', fill: 0x2f5368, stroke: { color: 0xd8e3e1, width: Math.max(2, k.size * 0.2), join: 'round' } };
    case 'province':
      return { ...base, fontFamily: 'Cinzel, serif', fill: 0x6c5640 };
    case 'site':
      return { ...base, fontFamily: '"EB Garamond", serif', fontStyle: 'italic', fill: 0x4a3a2a };
    default:
      return { ...base, fontFamily: '"EB Garamond", serif', fill: k.home ? 0x8f1d14 : 0x231a12, fontWeight: k.home ? '700' : '500', ...(k.faint ? { fill: 0x7b6a58 } : {}) };
  }
}

const STORM_COLORS = { minor: 0x6c7f8e, moderate: 0x4c5d6e, severe: 0x2d3846 } as const;

export class MapView {
  readonly world: StaticWorld;
  private readonly opts: MapViewOptions;
  private app: Application | null = null;
  private host: HTMLElement | null = null;
  private readonly worldLayer = new Container();
  private readonly screenLayer = new Graphics();
  private readonly labelLayer = new Container();
  private readonly shipLayer = new Graphics();
  private readonly motion = new MotionTracker();
  private readonly facing: Record<string, 1 | -1> = {};
  private following = false;
  private baseSprite: Sprite | null = null;
  private tintSprite: Sprite | null = null;
  private fogSprite: Sprite | null = null;
  private view: Viewport = { width: 1, height: 1 };
  private lim: CameraLimits;
  private cam: Camera;
  private camTarget: Camera | null = null;
  private state: GameState | null = null;
  private scene: MapScene | null = null;
  private palette: MapPalette;
  private mode: MapModeId = 'political';
  private revealAll = false;
  private overlay: OverlayData | null = null;
  private tintKey = '';
  private fogKey = '';
  private labelDefs: MapLabelDef[] = [];
  private readonly labelPool: Record<string, Text> = {};
  private placedLabels: Set<string> = new Set();
  private markers: ScreenMarker[] = [];
  private selectedKey = '';
  private hoverKey = '';
  private dirty = true;
  private band: ZoomBand = 'world';
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;
  private readonly listeners: [string, EventListener][] = [];

  constructor(world: StaticWorld, opts: MapViewOptions = {}) {
    this.world = world;
    this.opts = opts;
    this.palette = readMapPalette();
    this.lim = cameraLimits(this.view, world.width, world.height);
    this.cam = { x: world.width / 2, y: world.height / 2, scale: 1 };
  }

  /** Creates the Pixi application inside `host` and bakes the base chart. */
  async mount(host: HTMLElement): Promise<void> {
    this.host = host;
    const app = new Application();
    await app.init({ resizeTo: host, background: CHART.parchmentDark, antialias: true, autoDensity: true, resolution: Math.min(2, globalThis.devicePixelRatio || 1) });
    if (this.destroyed) {
      app.destroy(true);
      return;
    }
    this.app = app;
    host.appendChild(app.canvas);
    app.canvas.style.display = 'block';
    app.canvas.style.touchAction = 'none';
    app.stage.addChild(this.worldLayer, this.screenLayer, this.labelLayer, this.shipLayer);
    this.measure();
    this.cam = clampCamera({ x: this.world.width / 2, y: this.world.height / 2, scale: fitScale(this.view, this.world.width, this.world.height) }, this.view, this.lim);
    this.bindPointer(app.canvas);
    this.resizeObserver = new ResizeObserver(() => {
      this.measure();
      this.cam = clampCamera(this.cam, this.view, this.lim);
      this.dirty = true;
    });
    this.resizeObserver.observe(host);
    app.ticker.add(() => this.tick());
    const base = await bakeBaseChart(this.world, BASE_P, (s) => this.opts.onProgress?.(s));
    if (this.destroyed) return;
    this.baseSprite = new Sprite(Texture.from(base));
    this.baseSprite.scale.set(1 / BASE_P);
    this.worldLayer.addChildAt(this.baseSprite, 0);
    this.rebuildOverlays(true);
    this.dirty = true;
  }

  /** Feeds a new game state (null: an empty chart). */
  setState(state: GameState | null): void {
    this.state = state;
    this.refreshScene();
  }

  setMode(mode: MapModeId): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.rebuildOverlays(true);
  }

  /** Developer "reveal map": no fog, every fleet and site. */
  setRevealAll(on: boolean): void {
    if (on === this.revealAll) return;
    this.revealAll = on;
    this.refreshScene();
  }

  setSelection(target: MapTarget | null): void {
    this.selectedKey = targetKey(target);
    this.dirty = true;
  }

  zoomBy(factor: number): void {
    this.cam = zoomAt(this.cam, this.view, this.lim, factor, this.view.width / 2, this.view.height / 2);
    this.camTarget = null;
    this.dirty = true;
  }

  zoomToBand(band: ZoomBand): void {
    const scale = band === 'world' ? fitScale(this.view, this.world.width, this.world.height) : BAND_PRESETS[band];
    this.flyTo({ ...this.cam, scale });
  }

  centreOn(pos: Vec2, scale?: number): void {
    this.flyTo({ x: pos[0], y: pos[1], scale: scale ?? Math.max(this.cam.scale, BAND_PRESETS.region) });
  }

  /** Centres on the player's attention (expedition or seat). */
  centreOnFocus(): void {
    if (this.scene?.focus) this.centreOn(this.scene.focus);
  }

  /** Follow the expedition (or its war-band ashore) with the camera; flies there first. Keeps the zoom. */
  setFollow(on: boolean): void {
    if (on === this.following) return;
    this.following = on;
    if (on) {
      const p = this.followPos();
      if (p) this.flyTo({ x: p[0], y: p[1], scale: this.cam.scale });
    }
    this.opts.onFollow?.(on);
  }

  get isFollowing(): boolean {
    return this.following;
  }

  /** The drawn (interpolated) position of the thing the camera follows. */
  private followPos(): Vec2 | null {
    const id = this.followId();
    if (id === null) return this.scene?.focus ?? null;
    return this.motion.sample(id, performance.now())?.pos ?? this.scene?.focus ?? null;
  }

  private followId(): string | null {
    const scene = this.scene;
    if (!scene) return null;
    const band = scene.bands.find((b) => b.pos === scene.focus);
    if (band) return band.id;
    const fleet = scene.fleets.find((f) => f.isExpedition);
    return fleet ? fleet.id : null;
  }

  pan(dx: number, dy: number): void {
    this.cam = panBy(this.cam, this.view, this.lim, dx, dy);
    this.camTarget = null;
    this.dirty = true;
  }

  /** Pans by screen pixels (keyboard). Detaches the follow camera. */
  panScreen(dxPx: number, dyPx: number): void {
    if (this.following) {
      this.following = false;
      this.opts.onFollow?.(false);
    }
    this.pan(dxPx / this.cam.scale, dyPx / this.cam.scale);
  }

  get zoomBandNow(): ZoomBand {
    return this.band;
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

  // ---------------------------------------------------------------------------------------------

  private measure(): void {
    const w = this.host?.clientWidth ?? 1;
    const h = this.host?.clientHeight ?? 1;
    this.view = { width: Math.max(1, w), height: Math.max(1, h) };
    this.lim = cameraLimits(this.view, this.world.width, this.world.height);
  }

  private flyTo(target: Camera): void {
    this.camTarget = clampCamera(target, this.view, this.lim);
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      this.cam = this.camTarget;
      this.camTarget = null;
    }
    this.dirty = true;
  }

  private refreshScene(): void {
    const knowledge = this.revealAll ? null : readKnowledge(this.world, this.state);
    const scene = buildMapScene(this.world, this.state, { palette: this.palette, knowledge, revealAll: this.revealAll });
    // §8.2: unknown land is blank parchment — no settlements or sites there (the player's own always show).
    if (knowledge) {
      scene.settlements = scene.settlements.filter((s) => s.isPlayer || knowledgeAt(knowledge, s.cell) !== KNOW_UNKNOWN);
      scene.sites = scene.sites.filter((s) => knowledgeAt(knowledge, s.cell) !== KNOW_UNKNOWN);
    }
    this.scene = scene;
    const now = performance.now();
    for (const f of scene.fleets) this.motion.update(f.id, f.pos, now, f.heading);
    for (const b of scene.bands) this.motion.update(b.id, b.pos, now, b.heading);
    this.motion.retain([...scene.fleets.map((f) => f.id), ...scene.bands.map((b) => b.id)]);
    this.labelDefs = buildLabelDefs(this.world, this.scene);
    const fogKey = this.revealAll ? 'none' : knowledgeSignature(knowledge);
    if (fogKey !== this.fogKey && this.app) {
      this.fogKey = fogKey;
      this.fogSprite?.destroy({ texture: true });
      this.fogSprite = null;
      if (knowledge) {
        this.fogSprite = new Sprite(Texture.from(bakeFog(this.world, knowledge, OVERLAY_P)));
        this.fogSprite.scale.set(1 / OVERLAY_P);
        this.worldLayer.addChild(this.fogSprite);
      }
    }
    this.rebuildOverlays(false);
    this.dirty = true;
  }

  private rebuildOverlays(force: boolean): void {
    if (!this.scene || !this.app) return;
    const overlay = buildOverlay(this.mode, { world: this.world, scene: this.scene, state: this.state, palette: this.palette });
    const key = `${this.mode}|${overlay.provinceOwner.join(',')}|${overlay.provinceFill.map((f) => (f ? `${f.color}:${f.alpha}:${f.hatch ? 1 : 0}` : '-')).join(',')}`;
    this.overlay = overlay;
    this.opts.onOverlay?.(overlay);
    if (!force && key === this.tintKey) return;
    this.tintKey = key;
    this.tintSprite?.destroy({ texture: true });
    this.tintSprite = new Sprite(Texture.from(bakeTint(this.world, overlay, OVERLAY_P)));
    this.tintSprite.scale.set(1 / OVERLAY_P);
    const baseIndex = this.baseSprite ? this.worldLayer.getChildIndex(this.baseSprite) + 1 : 0;
    this.worldLayer.addChildAt(this.tintSprite, baseIndex);
    this.dirty = true;
  }

  private tick(): void {
    const now = performance.now();
    if (this.motion.active(now)) this.dirty = true;
    if (this.following && !this.camTarget) {
      const p = this.followPos();
      if (p) {
        const next = followCamera(this.cam, this.view, this.lim, p);
        if (next !== this.cam) {
          this.cam = next;
          this.dirty = true;
        }
      }
    }
    if (this.camTarget) {
      const t = this.camTarget;
      const k = 0.18;
      const next: Camera = { x: this.cam.x + (t.x - this.cam.x) * k, y: this.cam.y + (t.y - this.cam.y) * k, scale: this.cam.scale * (t.scale / this.cam.scale) ** k };
      if (Math.abs(next.x - t.x) < 0.05 && Math.abs(next.y - t.y) < 0.05 && Math.abs(next.scale / t.scale - 1) < 0.002) {
        this.cam = t;
        this.camTarget = null;
      } else this.cam = clampCamera(next, this.view, this.lim);
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.draw();
  }

  private screenOf(p: Vec2): [number, number] {
    return worldToScreen(this.cam, this.view, p);
  }

  private draw(): void {
    const cam = this.cam;
    this.worldLayer.scale.set(cam.scale);
    this.worldLayer.position.set(this.view.width / 2 - cam.x * cam.scale, this.view.height / 2 - cam.y * cam.scale);
    const band = zoomBand(cam.scale);
    if (band !== this.band) {
      this.band = band;
      this.opts.onBand?.(band);
    }
    const g = this.screenLayer;
    g.clear();
    const ships = this.shipLayer;
    ships.clear();
    const now = performance.now();
    const markers: ScreenMarker[] = [];
    const obstacles: Obstacle[] = [];
    const scene = this.scene;
    if (!scene) return;
    const onScreen = (x: number, y: number, pad: number) => x > -pad && y > -pad && x < this.view.width + pad && y < this.view.height + pad;

    // Overlay lines (trade lanes, routes).
    for (const line of this.overlay?.lines ?? []) {
      const pts = line.points.flatMap((p) => this.screenOf(p));
      const runs = line.dash ? dashPolyline(pts, line.dash === 'dotted' ? 2 : 8, line.dash === 'dotted' ? 5 : 6) : [pts];
      for (const r of runs) this.polyline(g, r, line.width, line.color, line.alpha);
    }

    // Storm cells.
    for (const s of scene.storms) {
      const [x, y] = this.screenOf(s.pos);
      const r = s.radius * cam.scale;
      if (!onScreen(x, y, r)) continue;
      const color = STORM_COLORS[s.severity];
      g.circle(x, y, r).fill({ color, alpha: s.forecast ? 0.08 : 0.2 });
      g.circle(x, y, r).stroke({ width: s.forecast ? 1 : 2, color, alpha: s.forecast ? 0.5 : 0.75 });
      for (let i = 0; i < 3; i++) {
        const rr = r * (0.35 + i * 0.18);
        // Start each swirl on its own arc (a bare arc would be joined to the last point drawn).
        g.moveTo(x + rr * Math.cos(i), y + rr * Math.sin(i)).arc(x, y, rr, i, i + 3.6).stroke({ width: 1.2, color, alpha: 0.55 });
      }
      if (s.track.length > 0) this.polyline(g, [x, y, ...s.track.flatMap((p) => this.screenOf(p))], 1, color, 0.45);
      markers.push({ target: { kind: 'storm', stormId: s.id, pos: s.pos, cell: Math.floor(s.pos[1]) * this.world.width + Math.floor(s.pos[0]) }, x, y, r: Math.max(10, r * 0.6), priority: 0 });
    }

    // Sites (region and closer).
    if (band !== 'world') {
      for (const s of scene.sites) {
        const [x, y] = this.screenOf(s.pos);
        if (!onScreen(x, y, 20)) continue;
        const d = band === 'local' ? 7 : 5;
        g.poly([x, y - d, x + d, y, x, y + d, x - d, y]).fill({ color: s.cleared ? 0x9b8b70 : 0x6a3d2a }).stroke({ width: 1.2, color: CHART.ink });
        markers.push({ target: { kind: 'site', key: s.key, name: s.name, ...(s.siteId !== undefined ? { siteId: s.siteId } : {}), ...(s.geoId !== undefined ? { geoId: s.geoId } : {}), pos: s.pos, cell: s.cell }, x, y, r: d + 6, priority: 1 });
        obstacles.push({ x0: x - d, y0: y - d, x1: x + d, y1: y + d, owner: s.key });
      }
    }

    // Settlements.
    const player = scene.playerFactionId;
    for (const s of scene.settlements) {
      if (!settlementIconVisible(s.tier, band, s.isHome)) continue;
      const [x, y] = this.screenOf(s.pos);
      const size = settlementIconSize(s.tier, band) * (s.isHome ? 1.15 : 1);
      if (!onScreen(x, y, size)) continue;
      const faction = s.factionId !== undefined && this.state ? this.state.factions[s.factionId] : undefined;
      const color = faction ? factionColor(faction, this.palette, player) : CHART.border;
      const rank = tierRank(s.tier);
      const h = size / 2;
      const alpha = s.synthetic ? 0.5 : 1;
      if (rank >= 3) {
        g.rect(x - h * 0.8, y - h * 0.55, h * 1.6, h * 1.2).fill({ color: CHART.parchment, alpha }).stroke({ width: 1.6, color: CHART.ink, alpha });
        g.rect(x - h * 0.8, y - h * 0.55, h * 1.6, h * 0.4).fill({ color, alpha });
        g.poly([x - h * 0.3, y - h * 0.55, x, y - h * 1.0, x + h * 0.3, y - h * 0.55]).fill({ color: CHART.ink, alpha });
      } else if (rank === 2) {
        g.circle(x, y, h * 0.62).fill({ color: CHART.parchment, alpha }).stroke({ width: 1.6, color: CHART.ink, alpha });
        g.circle(x, y, h * 0.36).fill({ color, alpha });
      } else {
        g.circle(x, y, Math.max(2.5, h * 0.42)).fill({ color, alpha }).stroke({ width: 1.1, color: CHART.ink, alpha });
      }
      if (s.isPlayer) g.circle(x, y, h * 0.95).stroke({ width: 2, color: 0xc89b3c, alpha: 0.95 });
      if (s.isHome) g.star(x, y - h * 1.35, 5, h * 0.45, h * 0.2).fill({ color: 0xc89b3c }).stroke({ width: 1, color: CHART.ink });
      const key = `settlement|${s.key}`;
      if (this.selectedKey === key || this.hoverKey === key) g.circle(x, y, h + 4).stroke({ width: 2, color: this.selectedKey === key ? 0x8f1d14 : 0x2b1d0e, alpha: 0.8 });
      markers.push({ target: { kind: 'settlement', key: s.key, name: s.name, ...(s.settlementId !== undefined ? { settlementId: s.settlementId } : {}), ...(s.geoId !== undefined ? { geoId: s.geoId } : {}), pos: s.pos, cell: s.cell }, x, y, r: Math.max(8, h + 3), priority: 2 });
      obstacles.push({ x0: x - h, y0: y - h, x1: x + h, y1: y + h, owner: s.key });
    }

    // Fleets with their routes: the expedition is a longship, other houses' fleets smaller ships in their colour.
    const L = shipLength(cam.scale);
    for (const f of scene.fleets) {
      const m = this.motion.sample(f.id, now);
      const drawn: Vec2 = m?.pos ?? f.pos;
      const [x, y] = this.screenOf(drawn);
      if (f.route.length > 0 && !f.steered && (f.isPlayer || band !== 'world')) {
        const pts = [x, y, ...f.route.flatMap((p) => this.screenOf(p))];
        for (const r of dashPolyline(pts, 7, 5)) this.polyline(g, r, f.isExpedition ? 2.2 : 1.4, f.isPlayer ? 0x8f1d14 : f.color, 0.8);
        const end = this.screenOf(f.route[f.route.length - 1] as Vec2);
        g.circle(end[0], end[1], 4).fill({ color: f.isPlayer ? 0x8f1d14 : f.color, alpha: 0.9 });
      }
      const size = f.isPlayer ? L : Math.max(20, L * 0.6);
      if (!onScreen(x, y, size)) continue;
      const heading = m?.heading ?? f.heading;
      const pose = shipPose(heading, this.facing[f.id] ?? 1);
      this.facing[f.id] = pose.facing;
      const moving = m?.moving ?? 0;
      if (moving > 0 && m) {
        const [sx, sy] = this.screenOf([drawn[0] + m.dir[0], drawn[1] + m.dir[1]]);
        paintShapes(ships, wakeShapes(x, y, size, [sx - x, sy - y], moving));
      }
      if (f.isPlayer) paintShapes(ships, longshipShapes(x, y, { length: size, pose, color: f.color, rowing: f.rowing && moving > 0, phase: (now / 900) % 1 }));
      else paintShapes(ships, smallShipShapes(x, y, size, pose, f.color));
      const key = `fleet|${f.id}`;
      if (this.selectedKey === key) ships.circle(x, y - size * 0.15, size * 0.62).stroke({ width: 2, color: 0x8f1d14 });
      markers.push({ target: { kind: 'fleet', fleetId: f.id, pos: drawn, cell: Math.floor(drawn[1]) * this.world.width + Math.floor(drawn[0]) }, x, y: y - size * 0.15, r: size * 0.5, priority: 3 });
    }

    // War-bands ashore: a banner-bearer and his men.
    for (const b of scene.bands) {
      const m = this.motion.sample(b.id, now);
      const drawn: Vec2 = m?.pos ?? b.pos;
      const [x, y] = this.screenOf(drawn);
      const h = Math.max(28, L * 0.8);
      if (!onScreen(x, y, h)) continue;
      const pose = shipPose(m?.heading ?? b.heading, this.facing[b.id] ?? 1);
      this.facing[b.id] = pose.facing;
      ships.ellipse(x, y, h * 0.42, h * 0.1).fill({ color: CHART.ink, alpha: 0.18 });
      paintShapes(ships, bannerBearerShapes(x, y, h, b.color, pose.facing, (m?.moving ?? 0) > 0 ? (now / 450) % 1 : 0));
    }
    this.markers = markers;
    this.drawLabels(band, obstacles);
  }

  private polyline(g: Graphics, pts: readonly number[], width: number, color: number, alpha: number): void {
    if (pts.length < 4) return;
    g.moveTo(pts[0] as number, pts[1] as number);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i] as number, pts[i + 1] as number);
    g.stroke({ width, color, alpha, cap: 'round', join: 'round' });
  }

  private drawLabels(band: ZoomBand, obstacles: Obstacle[]): void {
    const candidates: LabelCandidate[] = [];
    const meta: Record<string, { def: MapLabelDef; size: number; spacing: number }> = {};
    for (const def of this.labelDefs) {
      if (!labelVisible(def, band)) continue;
      if (def.kind === 'settlement' && def.tier !== undefined && !settlementIconVisible(def.tier, band, def.home === true)) continue;
      const size = labelFontSize(def, band);
      const spacing = labelLetterSpacing(def, band);
      const [x, y] = this.screenOf(def.pos);
      const width = estimateTextWidth(def.text, size, spacing);
      const iconR = def.kind === 'settlement' && def.tier !== undefined ? settlementIconSize(def.tier, band) / 2 : 6;
      candidates.push({ id: def.id, x, y, width, height: size * 1.25, priority: labelPriority(def, band), placements: labelPlacements(def), offset: iconR + 3 });
      meta[def.id] = { def, size, spacing };
    }
    const placed = declutterLabels(candidates, this.view, obstacles, { previous: this.placedLabels, overscan: 40 });
    const shown: Record<string, true> = {};
    for (const p of placed) {
      const m = meta[p.id];
      if (!m) continue;
      let text = this.labelPool[p.id];
      const styleKey = `${m.def.kind}|${m.size}|${m.def.home ? 1 : 0}|${m.def.faint ? 1 : 0}`;
      if (!text) {
        text = new Text({ text: m.def.text, style: styleFor({ kind: m.def.kind, size: m.size, home: m.def.home === true, faint: m.def.faint === true }, m.spacing) });
        text.label = styleKey;
        this.labelPool[p.id] = text;
        this.labelLayer.addChild(text);
      } else if (text.label !== styleKey) {
        text.style = styleFor({ kind: m.def.kind, size: m.size, home: m.def.home === true, faint: m.def.faint === true }, m.spacing);
        text.label = styleKey;
      }
      if (text.text !== m.def.text) text.text = m.def.text;
      // Centre the real text in the slot the declutter reserved (estimated width).
      text.position.set(Math.round(p.x + (p.width - text.width) / 2), Math.round(p.y + (p.height - text.height) / 2));
      text.visible = true;
      shown[p.id] = true;
    }
    for (const [id, t] of Object.entries(this.labelPool)) if (!shown[id]) t.visible = false;
    this.placedLabels = new Set(Object.keys(shown));
  }

  // ---------------------------------------------------------------------------------------------
  // Pointer.

  private on(canvas: HTMLCanvasElement, type: string, fn: EventListener, opts?: AddEventListenerOptions): void {
    canvas.addEventListener(type, fn, opts);
    this.listeners.push([type, fn]);
  }

  private local(e: PointerEvent | WheelEvent): [number, number] {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  private targetAt(sx: number, sy: number): MapTarget | null {
    const m = pickMarker(this.markers, sx, sy);
    if (m) return m.target;
    const [wx, wy] = screenToWorld(this.cam, this.view, sx, sy);
    return cellTarget(this.world, [wx, wy]);
  }

  private bindPointer(canvas: HTMLCanvasElement): void {
    this.on(canvas, 'pointerdown', ((e: PointerEvent) => {
      const [x, y] = this.local(e);
      this.drag = { x, y, moved: false };
      canvas.setPointerCapture(e.pointerId);
    }) as EventListener);
    this.on(canvas, 'pointermove', ((e: PointerEvent) => {
      const [x, y] = this.local(e);
      if (this.drag) {
        const dx = x - this.drag.x;
        const dy = y - this.drag.y;
        if (this.drag.moved || Math.abs(dx) + Math.abs(dy) > 4) {
          this.drag = { x, y, moved: true };
          if (this.following) {
            // Dragging the map detaches the camera from the ship.
            this.following = false;
            this.opts.onFollow?.(false);
          }
          this.pan(-dx / this.cam.scale, -dy / this.cam.scale);
        }
        return;
      }
      const t = this.targetAt(x, y);
      const key = targetKey(t);
      if (key !== this.hoverKey) {
        this.hoverKey = t && t.kind !== 'sea' && t.kind !== 'land' ? key : '';
        this.dirty = true;
      }
      this.opts.onHover?.(t, x, y);
    }) as EventListener);
    this.on(canvas, 'pointerup', ((e: PointerEvent) => {
      const d = this.drag;
      this.drag = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (d && !d.moved) {
        const [x, y] = this.local(e);
        const t = this.targetAt(x, y);
        this.selectedKey = targetKey(t);
        this.dirty = true;
        this.opts.onSelect?.(t);
      }
    }) as EventListener);
    this.on(canvas, 'pointerleave', (() => {
      if (this.hoverKey !== '') {
        this.hoverKey = '';
        this.dirty = true;
      }
      this.opts.onHover?.(null, 0, 0);
    }) as EventListener);
    this.on(
      canvas,
      'wheel',
      ((e: WheelEvent) => {
        e.preventDefault();
        const [x, y] = this.local(e);
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
        this.cam = zoomAt(this.cam, this.view, this.lim, factor, x, y);
        this.camTarget = null;
        this.dirty = true;
      }) as EventListener,
      { passive: false },
    );
  }
}
