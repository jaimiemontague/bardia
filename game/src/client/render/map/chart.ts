/**
 * Chart bakes (browser): the pure rasters and painters of this folder drawn into canvases the Pixi view uses as
 * textures. The base chart (sea, land, relief, terrain symbols, rivers, roads, province borders) is static and baked
 * once per world, in row chunks so the page stays responsive; the map-mode tint and the fog are re-baked when their
 * inputs change.
 */
import type { StaticWorld } from '@sim/modules/world/map/index';
import { CHART, toCss, toCssRgba } from './colors';
import { provinceBorders, riverPaths, roadPaths } from './geometry';
import { buildChartFields, chartColumnPlan, fogField, ownerBorderDistance, rasterizeChartRows, rasterizeFog, rasterizeTint, type ChartFields } from './raster';
import { drawRivers, drawRoads, drawSymbols, placeSymbols } from './symbols';
import type { OverlayData } from './types';

let fieldsMemo: { world: StaticWorld; fields: ChartFields } | undefined;

/** The chart fields of a world (memoized: ~0.1 s on the full map). */
export function chartFields(world: StaticWorld): ChartFields {
  if (fieldsMemo?.world === world) return fieldsMemo.fields;
  fieldsMemo = { world, fields: buildChartFields(world) };
  return fieldsMemo.fields;
}

function canvasOf(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) throw new Error('chart: no 2D canvas context');
  return { canvas, ctx };
}

function putRgba(ctx: CanvasRenderingContext2D, data: Uint8ClampedArray, w: number, h: number): void {
  const img = ctx.createImageData(w, h);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
}

/** Yields to the browser between chunks (a resolved promise in non-browser environments). */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => resolve()) : resolve()));
}

/**
 * Bakes the base chart at P pixels per cell. `onProgress` gets 0…1. Province borders are fine dashed ink, region
 * borders a firmer line; terrain symbols, rivers and roads are painted over the rasterised sea and land.
 */
export async function bakeBaseChart(world: StaticWorld, P: number, onProgress?: (share: number) => void): Promise<HTMLCanvasElement> {
  const f = chartFields(world);
  const W = world.width * P;
  const H = world.height * P;
  const { canvas, ctx } = canvasOf(W, H);
  const img = ctx.createImageData(W, H);
  const plan = chartColumnPlan(f, P);
  const chunk = Math.max(P * 8, Math.floor(H / 24));
  for (let y = 0; y < H; y += chunk) {
    rasterizeChartRows(f, P, img.data, y, Math.min(H, y + chunk), plan);
    onProgress?.((0.8 * Math.min(H, y + chunk)) / H);
    await nextFrame();
  }
  ctx.putImageData(img, 0, 0);
  drawRoads(ctx, roadPaths(world), P);
  ctx.setLineDash([]);
  drawRivers(ctx, riverPaths(world), P);
  onProgress?.(0.88);
  await nextFrame();
  drawSymbols(ctx, placeSymbols(world, f), P);
  onProgress?.(0.95);
  // Province borders: dashed ink inside a region, firmer between regions.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const b of provinceBorders(world)) {
    const regionSeam = b.regionA !== b.regionB;
    ctx.strokeStyle = regionSeam ? toCssRgba(CHART.ink, 0.55) : toCssRgba(CHART.ink, 0.32);
    ctx.lineWidth = Math.max(0.8, P * (regionSeam ? 0.32 : 0.18));
    ctx.setLineDash(regionSeam ? [] : [P * 0.7, P * 0.55]);
    ctx.beginPath();
    ctx.moveTo((b.points[0] ?? 0) * P, (b.points[1] ?? 0) * P);
    for (let k = 2; k < b.points.length; k += 2) ctx.lineTo((b.points[k] ?? 0) * P, (b.points[k + 1] ?? 0) * P);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  onProgress?.(1);
  return canvas;
}

/** Bakes a map-mode tint (province fills with a wash along realm borders) at P pixels per cell. */
export function bakeTint(world: StaticWorld, overlay: OverlayData, P: number): HTMLCanvasElement {
  const f = chartFields(world);
  const keys: Record<string, number> = {};
  const owner = new Int32Array(world.geo.provinces.length).fill(-1);
  overlay.provinceOwner.forEach((k, i) => {
    if (k === null) return;
    keys[k] ??= Object.keys(keys).length;
    owner[i] = keys[k] as number;
  });
  const data = rasterizeTint(world, f, overlay.provinceFill, P, { borderDist: ownerBorderDistance(world, owner), wash: overlay.wash });
  const { canvas, ctx } = canvasOf(world.width * P, world.height * P);
  putRgba(ctx, data, world.width * P, world.height * P);
  return canvas;
}

/** Bakes the fog of the unknown (null levels: no fog). */
export function bakeFog(world: StaticWorld, levels: Uint8Array, P: number): HTMLCanvasElement {
  const field = fogField(levels, world.width, world.height);
  const data = rasterizeFog(field, world.width, world.height, P);
  const { canvas, ctx } = canvasOf(world.width * P, world.height * P);
  putRgba(ctx, data, world.width * P, world.height * P);
  return canvas;
}

/** CSS colour helper re-exported for the view. */
export { toCss };
