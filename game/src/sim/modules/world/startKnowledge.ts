/**
 * Start knowledge (design §8.2): "your homeland plus the Albrenn east coast are Charted (from your parent's
 * old sea-chart). Hvarn players also start with the Velkar river mouths Charted." Built once at world
 * generation as a full-grid mask, then stored as run-length rows (knowledge.ts).
 *
 *   - homeland: every land cell of the homeland and neutral regions, and sea within `homelandSeaBuffer` cells;
 *   - startCharts: land of the listed provinces (or just their coastal strip) and sea within `seaBuffer`,
 *     optionally only in some sea zones;
 *   - `start.chartVelkar` culture modifier: discs around the mouths of navigable rivers in `riverMouthRegions`.
 */
import type { CultureId } from '@content/schemas/ids';
import type { SimContext } from '@sim/core/module';
import { cellOfPos, type WorldData } from './data';
import { CELL_LAND, CELL_SEA, nearestLandCell } from './map';

const SQRT2 = Math.SQRT2;

/** Two-pass chamfer distance (1, √2) from the seed cells, ignoring obstacles; Infinity where unreachable. */
export function chamferDistance(width: number, height: number, seeds: Uint8Array): Float32Array {
  const d = new Float32Array(width * height).fill(Infinity);
  for (let i = 0; i < d.length; i++) if (seeds[i] !== 0) d[i] = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let v = d[i] as number;
      if (x > 0) v = Math.min(v, (d[i - 1] as number) + 1);
      if (y > 0) {
        v = Math.min(v, (d[i - width] as number) + 1);
        if (x > 0) v = Math.min(v, (d[i - width - 1] as number) + SQRT2);
        if (x < width - 1) v = Math.min(v, (d[i - width + 1] as number) + SQRT2);
      }
      d[i] = v;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      let v = d[i] as number;
      if (x < width - 1) v = Math.min(v, (d[i + 1] as number) + 1);
      if (y < height - 1) {
        v = Math.min(v, (d[i + width] as number) + 1);
        if (x < width - 1) v = Math.min(v, (d[i + width + 1] as number) + SQRT2);
        if (x > 0) v = Math.min(v, (d[i + width - 1] as number) + SQRT2);
      }
      d[i] = v;
    }
  }
  return d;
}

/** Marks sea cells within `buffer` of the seed land (optionally only in the given zones). */
function addSeaAround(data: WorldData, mask: Uint8Array, seeds: Uint8Array, buffer: number, zones?: readonly string[]): void {
  const { sw } = data;
  if (buffer <= 0) return;
  const dist = chamferDistance(sw.width, sw.height, seeds);
  const allowed = zones !== undefined ? data.zoneIds.map((id) => zones.includes(id)) : undefined;
  for (let i = 0; i < sw.size; i++) {
    if (sw.kind[i] !== CELL_SEA || (dist[i] as number) > buffer) continue;
    if (allowed !== undefined) {
      const z = sw.zoneOf[i] as number;
      if (z < 0 || allowed[z] !== true) continue;
    }
    mask[i] = 1;
  }
}

/** Marks a disc of cells. */
export function markDisc(width: number, height: number, mask: Uint8Array, cx: number, cy: number, r: number): void {
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(height - 1, Math.floor(cy + r));
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    const half2 = r * r - dy * dy;
    if (half2 < 0) continue;
    const half = Math.sqrt(half2);
    const a = Math.max(0, Math.ceil(cx - half - 0.5));
    const b = Math.min(width, Math.floor(cx + half - 0.5) + 1);
    for (let x = a; x < b; x++) mask[y * width + x] = 1;
  }
}

/** The start knowledge mask for a player of `culture` (1 = charted). */
export function startKnowledgeMask(ctx: SimContext, data: WorldData, culture: CultureId): Uint8Array {
  const { sw, geo } = data;
  const t = ctx.tunables.world.knowledge;
  const mask = new Uint8Array(sw.size);

  // Homeland (and neutral ground): all land, sea around it.
  const homeRegion = geo.regions.map((r) => r.homeland || r.neutral);
  const seeds = new Uint8Array(sw.size);
  for (let i = 0; i < sw.size; i++) {
    if (sw.kind[i] === CELL_SEA) continue;
    const r = sw.regionOf[i] as number;
    if (r >= 0 && homeRegion[r] === true) {
      mask[i] = 1;
      if (sw.kind[i] === CELL_LAND) seeds[i] = 1;
    }
  }
  addSeaAround(data, mask, seeds, t.homelandSeaBuffer);

  // Further charts (the parent's sea-chart of the Albrenn east coast).
  for (const chart of t.startCharts) {
    const provinces = chart.provinces.map((id) => sw.index.province[id]).filter((i): i is number => i !== undefined);
    if (provinces.length === 0) continue;
    const isMine: boolean[] = [];
    for (const p of provinces) isMine[p] = true;
    const s2 = new Uint8Array(sw.size);
    for (let i = 0; i < sw.size; i++) {
      if (sw.kind[i] !== CELL_LAND) continue;
      const p = sw.provinceOf[i] as number;
      if (p < 0 || isMine[p] !== true) continue;
      if (chart.coastOnly && (sw.coastDist[i] as number) > chart.landBuffer) continue;
      mask[i] = 1;
      s2[i] = 1;
    }
    addSeaAround(data, mask, s2, chart.seaBuffer, chart.zones);
  }

  // Hvarn: the Velkar river mouths.
  let chartRivers = 0;
  for (const b of ctx.content.cultures[culture].bonuses) chartRivers += b.modifiers['start.chartVelkar'] ?? 0;
  if (chartRivers > 0) {
    const wanted = geo.regions.map((r) => t.riverMouthRegions.includes(r.id));
    for (const river of geo.rivers) {
      if (!river.navigable) continue;
      const mouth = river.points[0];
      if (!mouth) continue;
      const cell = cellOfPos(sw, mouth[0], mouth[1]);
      const land = sw.kind[cell] === CELL_LAND ? cell : nearestLandCell(sw, cell, 8);
      const r = land >= 0 ? (sw.regionOf[land] as number) : -1;
      if (r < 0 || wanted[r] !== true) continue;
      markDisc(sw.width, sw.height, mask, mouth[0], mouth[1], t.riverMouthRadius);
    }
  }
  return mask;
}
