/**
 * Terrain symbols of the illuminated chart: little inked peaks for mountains, bumps for hills, trees for forests
 * (conifers in the cold north, broadleaves in the temperate lands, umbrella pines in the warm south) and reed
 * tufts for marshes; plus rivers and roads. Placement is pure and deterministic (a jittered grid hashed from the
 * cell coordinates); drawing targets the small subset of CanvasRenderingContext2D used here, so the chart can be
 * baked on a canvas or an OffscreenCanvas.
 */
import { CELL_SEA, RIVER_NAVIGABLE, ROAD_IMPERIAL, TERRAIN_FOREST, TERRAIN_HILLS, TERRAIN_MARSH, TERRAIN_MOUNTAIN, type StaticWorld } from '@sim/modules/world/map/index';
import type { Climate } from '@content/world';
import { CHART, toCss, toCssRgba } from './colors';
import type { NetworkPath } from './geometry';
import { hash2, type ChartFields } from './raster';

export type SymbolKind = 'mountain' | 'hill' | 'conifer' | 'broadleaf' | 'pine' | 'marsh';

export interface TerrainSymbol {
  kind: SymbolKind;
  /** Base centre (cell coordinates). */
  x: number;
  y: number;
  /** Width in cells (height follows the kind). */
  size: number;
  /** 0…1 variation seed (peak shape, snow, lean). */
  variant: number;
  /** Snow-capped (mountains in cold lands). */
  snow: boolean;
}

/** Spacing (cells) of the placement grid per terrain class. */
export const SYMBOL_SPACING = { mountain: 2.15, hills: 2.5, forest: 1.45, marsh: 2.2 } as const;

/** Places terrain symbols over the world (sorted back to front: by y, then x). */
export function placeSymbols(world: StaticWorld, fields: Pick<ChartFields, 'sdf' | 'lake'>): TerrainSymbol[] {
  const out: TerrainSymbol[] = [];
  const climates: Climate[] = world.geo.regions.map((r) => r.climate);
  const { width: W, height: H, terrain, kind, elevation, regionOf, river, road } = world;
  const sample = (x: number, y: number): number => {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    return cx < 0 || cy < 0 || cx >= W || cy >= H ? -1 : cy * W + cx;
  };
  const clear = (c: number, x: number, y: number, margin: number): boolean => {
    if (kind[c] === CELL_SEA) return false;
    if (fields.sdf[c]! < margin) return false;
    if (fields.lake[c]! > -0.9) return false;
    // Keep rivers and roads readable.
    for (const [dx, dy] of [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6]] as const) {
      const n = sample(x + dx, y + dy);
      if (n < 0 || river[n]! !== 0 || road[n]! !== 0) return false;
    }
    return true;
  };
  const pass = (terrainClass: number, spacing: number, seed: number, make: (c: number, x: number, y: number, h: number) => TerrainSymbol | null) => {
    const cols = Math.ceil(W / spacing);
    const rows = Math.ceil(H / spacing);
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const h = hash2(gx, gy, seed);
        const h2 = hash2(gx, gy, seed + 1);
        // Offset every other row for a woven look, then jitter.
        const x = (gx + (gy % 2) * 0.5 + (h - 0.5) * 0.7) * spacing;
        const y = (gy + (h2 - 0.5) * 0.7) * spacing;
        const c = sample(x, y);
        if (c < 0 || terrain[c] !== terrainClass) continue;
        const s = make(c, x, y, hash2(gx, gy, seed + 2));
        if (s) out.push(s);
      }
    }
  };
  pass(TERRAIN_MOUNTAIN, SYMBOL_SPACING.mountain, 101, (c, x, y, h) => {
    if (!clear(c, x, y, 0.9)) return null;
    const e = elevation[c]! / 255;
    const r = regionOf[c]!;
    const cl = r >= 0 ? climates[r] : undefined;
    const cold = cl === 'polar' || cl === 'boreal' || cl === 'volcanic';
    return { kind: 'mountain', x, y, size: 1.7 + e * 1.1 + h * 0.45, variant: h, snow: cold && e > 0.55 };
  });
  pass(TERRAIN_HILLS, SYMBOL_SPACING.hills, 202, (c, x, y, h) => {
    if (!clear(c, x, y, 0.7) || h < 0.12) return null;
    return { kind: 'hill', x, y, size: 1.45 + h * 0.6, variant: h, snow: false };
  });
  pass(TERRAIN_FOREST, SYMBOL_SPACING.forest, 303, (c, x, y, h) => {
    if (!clear(c, x, y, 0.55) || h < 0.08) return null;
    const r = regionOf[c]!;
    const cl = r >= 0 ? climates[r] : undefined;
    let k: SymbolKind = 'broadleaf';
    if (cl === 'boreal' || cl === 'polar' || cl === 'volcanic') k = h < 0.85 ? 'conifer' : 'broadleaf';
    else if (cl === 'oceanic') k = h < 0.45 ? 'conifer' : 'broadleaf';
    else if (cl === 'warm') k = h < 0.6 ? 'pine' : 'broadleaf';
    else if (cl === 'steppe') k = h < 0.3 ? 'conifer' : 'broadleaf';
    else k = h < 0.18 ? 'conifer' : 'broadleaf';
    return { kind: k, x, y, size: 0.95 + h * 0.4, variant: h, snow: false };
  });
  pass(TERRAIN_MARSH, SYMBOL_SPACING.marsh, 404, (c, x, y, h) => {
    if (!clear(c, x, y, 0.6) || h < 0.2) return null;
    return { kind: 'marsh', x, y, size: 1.1 + h * 0.4, variant: h, snow: false };
  });
  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Drawing (canvas 2D).

/** The canvas calls the chart painter uses (CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D both fit). */
export interface Paint2D {
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, a0: number, a1: number): void;
  fill(): void;
  stroke(): void;
  setLineDash(segments: number[]): void;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  globalAlpha: number;
}

const INK = toCss(CHART.ink);
const MOUNTAIN_LIT = toCss(0xefe4c6);
const MOUNTAIN_SHADE = toCssRgba(0x6e5a44, 0.55);
const SNOW = '#fbfaf4';
const HILL_SHADE = toCssRgba(0x7d6446, 0.32);
const CONIFER = toCss(0x4f6b45);
const CONIFER_SHADE = toCss(0x3a5236);
const BROADLEAF = toCss(0x6f8a4e);
const BROADLEAF_SHADE = toCss(0x52693a);
const PINE = toCss(0x6b7f45);
const MARSH = toCss(0x5d735a);

/** Draws terrain symbols; P = pixels per cell. */
export function drawSymbols(ctx: Paint2D, symbols: readonly TerrainSymbol[], P: number): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const ink = Math.max(0.7, P * 0.2);
  for (const s of symbols) {
    const x = s.x * P;
    const y = s.y * P;
    const w = s.size * P;
    switch (s.kind) {
      case 'mountain':
        drawMountain(ctx, x, y, w, s.variant, s.snow, ink);
        break;
      case 'hill':
        drawHill(ctx, x, y, w, s.variant, ink);
        break;
      case 'conifer':
        drawConifer(ctx, x, y, w, s.variant);
        break;
      case 'broadleaf':
        drawBroadleaf(ctx, x, y, w, s.variant);
        break;
      case 'pine':
        drawPine(ctx, x, y, w, s.variant);
        break;
      case 'marsh':
        drawMarsh(ctx, x, y, w, s.variant, ink);
        break;
    }
  }
  ctx.globalAlpha = 1;
}

function drawMountain(ctx: Paint2D, x: number, y: number, w: number, v: number, snow: boolean, ink: number): void {
  const h = w * (0.62 + v * 0.22);
  const peakX = x - w * (0.06 + (v - 0.5) * 0.12);
  const left = x - w / 2;
  const right = x + w / 2;
  // Body (lit).
  ctx.globalAlpha = 1;
  ctx.fillStyle = MOUNTAIN_LIT;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(peakX - w * 0.08, y - h * 0.7);
  ctx.lineTo(peakX, y - h);
  ctx.lineTo(peakX + w * 0.12, y - h * 0.78);
  ctx.lineTo(right, y);
  ctx.closePath();
  ctx.fill();
  // Shaded east flank.
  ctx.fillStyle = MOUNTAIN_SHADE;
  ctx.beginPath();
  ctx.moveTo(peakX, y - h);
  ctx.lineTo(peakX + w * 0.12, y - h * 0.78);
  ctx.lineTo(right, y);
  ctx.lineTo(peakX + w * 0.1, y);
  ctx.lineTo(peakX + w * 0.04, y - h * 0.45);
  ctx.closePath();
  ctx.fill();
  if (snow) {
    ctx.fillStyle = SNOW;
    ctx.beginPath();
    ctx.moveTo(peakX - w * 0.13, y - h * 0.62);
    ctx.lineTo(peakX - w * 0.08, y - h * 0.7);
    ctx.lineTo(peakX, y - h);
    ctx.lineTo(peakX + w * 0.12, y - h * 0.78);
    ctx.lineTo(peakX + w * 0.16, y - h * 0.68);
    ctx.lineTo(peakX + w * 0.05, y - h * 0.74);
    ctx.lineTo(peakX - w * 0.04, y - h * 0.64);
    ctx.closePath();
    ctx.fill();
  }
  // Ink: the ridge line (no base line, as on old charts).
  ctx.strokeStyle = INK;
  ctx.lineWidth = ink;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(peakX - w * 0.08, y - h * 0.7);
  ctx.lineTo(peakX, y - h);
  ctx.lineTo(peakX + w * 0.12, y - h * 0.78);
  ctx.lineTo(right, y);
  ctx.stroke();
  // Hatching on the shaded flank.
  ctx.lineWidth = ink * 0.6;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  for (let i = 1; i <= 2; i++) {
    const t = i / 3;
    const sx = peakX + w * 0.12 * (1 - t) + (right - w * 0.1) * t * 0.6 + w * 0.05;
    const sy = y - h * (0.78 - 0.5 * t);
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - w * 0.06, y - h * 0.08);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawHill(ctx: Paint2D, x: number, y: number, w: number, v: number, ink: number): void {
  const h = w * (0.34 + v * 0.1);
  ctx.globalAlpha = 1;
  ctx.fillStyle = HILL_SHADE;
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.quadraticCurveTo(x + w * 0.42, y - h * 0.9, x + w / 2, y);
  ctx.lineTo(x + w * 0.08, y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = ink * 0.9;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.quadraticCurveTo(x - w * 0.42, y - h * 0.95, x, y - h);
  ctx.quadraticCurveTo(x + w * 0.42, y - h * 0.95, x + w / 2, y);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawConifer(ctx: Paint2D, x: number, y: number, w: number, v: number): void {
  const h = w * (1.25 + v * 0.3);
  const half = w * 0.36;
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = CONIFER;
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + half, y - h * 0.18);
  ctx.lineTo(x - half, y - h * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = CONIFER_SHADE;
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + half, y - h * 0.18);
  ctx.lineTo(x, y - h * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = CONIFER_SHADE;
  ctx.lineWidth = Math.max(0.6, w * 0.1);
  ctx.beginPath();
  ctx.moveTo(x, y - h * 0.18);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawBroadleaf(ctx: Paint2D, x: number, y: number, w: number, v: number): void {
  const r = w * (0.36 + v * 0.06);
  const cy = y - r * 1.35;
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = BROADLEAF_SHADE;
  ctx.lineWidth = Math.max(0.6, w * 0.1);
  ctx.beginPath();
  ctx.moveTo(x, cy + r * 0.6);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.fillStyle = BROADLEAF;
  ctx.beginPath();
  ctx.ellipse(x, cy, r, r * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = BROADLEAF_SHADE;
  ctx.beginPath();
  ctx.ellipse(x + r * 0.28, cy + r * 0.22, r * 0.62, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawPine(ctx: Paint2D, x: number, y: number, w: number, v: number): void {
  // An umbrella pine: a tall trunk under a flat crown.
  const h = w * (1.2 + v * 0.2);
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = toCss(0x5a4a33);
  ctx.lineWidth = Math.max(0.6, w * 0.09);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w * 0.04, y - h * 0.7);
  ctx.stroke();
  ctx.fillStyle = PINE;
  ctx.beginPath();
  ctx.ellipse(x + w * 0.04, y - h * 0.78, w * 0.48, w * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawMarsh(ctx: Paint2D, x: number, y: number, w: number, v: number, ink: number): void {
  ctx.strokeStyle = MARSH;
  ctx.lineWidth = ink * 0.8;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.45, y);
  ctx.lineTo(x + w * 0.45, y);
  ctx.moveTo(x - w * 0.25, y + w * 0.16);
  ctx.lineTo(x + w * 0.3, y + w * 0.16);
  // Reeds.
  const n = 3 + Math.floor(v * 2);
  for (let i = 0; i < n; i++) {
    const rx = x - w * 0.28 + (w * 0.56 * i) / Math.max(1, n - 1);
    const lean = (i - (n - 1) / 2) * w * 0.05;
    ctx.moveTo(rx, y);
    ctx.lineTo(rx + lean, y - w * (0.3 + ((i * 7 + Math.floor(v * 10)) % 3) * 0.08));
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Draws traced rivers (navigable ones broader, widening towards their mouth). */
export function drawRivers(ctx: Paint2D, rivers: readonly NetworkPath[], P: number): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = toCss(CHART.river);
  ctx.globalAlpha = 0.95;
  for (const r of rivers) {
    const base = r.value === RIVER_NAVIGABLE ? 0.5 : 0.26;
    const n = r.points.length / 2;
    // Draw in short runs so the width can taper from the mouth to the source.
    const step = 6;
    for (let i = 0; i < n - 1; i += step) {
      const j = Math.min(n - 1, i + step);
      const mid = (i + j) / 2 / Math.max(1, n - 1);
      const towardsMouth = r.mouthAtStart && !r.mouthAtEnd ? 1 - mid : r.mouthAtEnd && !r.mouthAtStart ? mid : 0.6;
      ctx.lineWidth = Math.max(0.8, P * base * (0.7 + 0.5 * towardsMouth));
      ctx.beginPath();
      ctx.moveTo(r.points[2 * i]! * P, r.points[2 * i + 1]! * P);
      for (let k = i + 1; k <= j; k++) ctx.lineTo(r.points[2 * k]! * P, r.points[2 * k + 1]! * P);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/** Draws roads: imperial roads as a red-brown dashed line, tracks as faint dots. */
export function drawRoads(ctx: Paint2D, roads: readonly NetworkPath[], P: number): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const r of roads) {
    const imperial = r.value === ROAD_IMPERIAL;
    ctx.strokeStyle = toCss(imperial ? CHART.roadImperial : CHART.road);
    ctx.globalAlpha = imperial ? 0.75 : 0.5;
    ctx.lineWidth = Math.max(0.8, P * (imperial ? 0.24 : 0.16));
    ctx.setLineDash(imperial ? [P * 0.9, P * 0.45] : [P * 0.18, P * 0.5]);
    ctx.beginPath();
    ctx.moveTo(r.points[0]! * P, r.points[1]! * P);
    for (let k = 2; k < r.points.length; k += 2) ctx.lineTo(r.points[k]! * P, r.points[k + 1]! * P);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}
