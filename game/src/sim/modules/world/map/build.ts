/**
 * buildStaticWorld: rasterises and analyses the geography pack into a StaticWorld (pure and deterministic).
 *
 * Pipeline:
 *   1. landmasses (subdivided, fractally warped coasts, even-odd scanline fill) → land; authored lakes cut in;
 *   2. regions from their (warped) polygons, first listed wins; stray land goes to the nearest region;
 *   3. coast-distance field (exact Euclidean distance transform);
 *   4. terrain per region rule (elevation/moisture fBm), explicit terrain areas, procedural lakes;
 *   5. rivers (warped polylines, 4-connected) and roads as overlays;
 *   6. provinces: nearest anchor (Voronoi between domain-warped positions) within the cell's region, preferring
 *      anchors on the same land component; main-anchor cells always belong to their province;
 *   7. sea zones: polygons, then a geodesic flood from the zone seeds over the sea;
 *   8. navigation masks, sea and karvi components (portages join karvi components), ports, sea lanes, summaries.
 */
import type { Geography, NoiseSpec, Point, TerrainRule } from '@content/world';
import { distanceTransform, fillPolygon, fractalize, subdivide, tracePolyline, warpPoints } from './geometry';
import { components4, geodesicFlood } from './flood';
import { fbm, fbmSigned, hashString, subSeed } from './noise';
import { buildSeaLanes, type LaneNode } from './lanes';
import {
  CELL_LAKE,
  CELL_LAND,
  CELL_SEA,
  LAKE_PROCEDURAL,
  NAV_KARVI,
  NAV_SEA,
  RIVER_NAVIGABLE,
  RIVER_STREAM,
  ROAD_IMPERIAL,
  ROAD_TRACK,
  TERRAIN_FOREST,
  TERRAIN_HILLS,
  TERRAIN_MARSH,
  TERRAIN_MOUNTAIN,
  TERRAIN_NONE,
  TERRAIN_PLAIN,
  type CellBounds,
  type GeoIndex,
  type Port,
  type PortageInfo,
  type ProvinceInfo,
  type RegionInfo,
  type SeaZoneInfo,
  type StaticWorld,
} from './model';

function indexOf<T extends { id: string }>(rows: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {};
  rows.forEach((r, i) => {
    if (!Object.hasOwn(out, r.id)) out[r.id] = i;
  });
  return out;
}

/** id → index tables for a geography. */
export function buildGeoIndex(geo: Geography): GeoIndex {
  return {
    landmass: indexOf(geo.landmasses),
    province: indexOf(geo.provinces),
    region: indexOf(geo.regions),
    seaZone: indexOf(geo.seaZones),
    kingdom: indexOf(geo.kingdoms),
    river: indexOf(geo.rivers),
    lake: indexOf(geo.lakes),
    portage: indexOf(geo.portages),
    settlement: indexOf(geo.settlements),
    site: indexOf(geo.sites),
  };
}

function mergeNoise(base: NoiseSpec, override: Partial<NoiseSpec> | false | undefined): NoiseSpec | undefined {
  if (override === false) return undefined;
  return override === undefined ? base : { ...base, ...override };
}

/**
 * Shapes a ring or polyline: fractal midpoint displacement (roughness 0 = off), then subdivision and the domain
 * warp (`spec` undefined or amplitude 0 = no warp). Coincident input points stay coincident. `vertexAt` maps
 * input vertices to output point indices.
 */
function shapeLine(
  pts: readonly Point[],
  closed: boolean,
  roughness: number,
  minSeg: number,
  spec: NoiseSpec | undefined,
  maxSeg: number,
  seedX: number,
  seedY: number,
  fractalSeed: number,
  displaceEdge?: (ax: number, ay: number, bx: number, by: number) => boolean,
): { points: number[]; vertexAt: number[] } {
  const fr = fractalize(pts, closed, roughness, minSeg, fractalSeed, FRACTAL_MAX_LEN, displaceEdge);
  if (spec === undefined || spec.amplitude === 0) return fr;
  const flatPts: Point[] = [];
  for (let i = 0; i < fr.points.length; i += 2) flatPts.push([fr.points[i] as number, fr.points[i + 1] as number]);
  const sub = subdivide(flatPts, closed, Math.min(maxSeg, spec.wavelength / 4));
  warpPoints(sub.points, seedX, seedY, spec);
  return { points: sub.points, vertexAt: fr.vertexAt.map((k) => sub.vertexAt[k] as number) };
}

/** A shaped closed ring (fractal detail + warp) with seeds derived from one label. */
function warpedRing(
  ring: readonly Point[],
  spec: NoiseSpec | undefined,
  maxSeg: number,
  seed: number,
  label: string,
  roughness = 0,
  minSeg = 1,
  displaceEdge?: (ax: number, ay: number, bx: number, by: number) => boolean,
): number[] {
  return shapeLine(ring, true, roughness, minSeg, spec, maxSeg, subSeed(seed, `${label}:x`), subSeed(seed, `${label}:y`), subSeed(seed, 'fractal'), displaceEdge).points;
}

/** Length scale cap of the fractal displacement (cells). */
const FRACTAL_MAX_LEN = 24;

function emptyBounds(): CellBounds {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function grow(b: CellBounds, x: number, y: number): void {
  if (x < b.minX) b.minX = x;
  if (x > b.maxX) b.maxX = x;
  if (y < b.minY) b.minY = y;
  if (y > b.maxY) b.maxY = y;
}

function pointCell(width: number, height: number, p: Point): number {
  const x = Math.floor(p[0]);
  const y = Math.floor(p[1]);
  if (x < 0 || y < 0 || x >= width || y >= height) return -1;
  return y * width + x;
}

/**
 * Nearest cell (Euclidean between centres, ties → lower index) within `radius` of `cell` satisfying `ok`, or −1.
 */
export function nearestCellWhere(width: number, height: number, cell: number, radius: number, ok: (i: number) => boolean): number {
  if (cell < 0) return -1;
  const cx = cell % width;
  const cy = (cell - cx) / width;
  if (ok(cell)) return cell;
  let best = -1;
  let bestD = Infinity;
  const r = Math.ceil(radius);
  const r2 = radius * radius;
  for (let ring = 1; ring <= r; ring++) {
    // Any hit in ring k is at distance ≥ k; once best ≤ ring, outer rings cannot win.
    if (best !== -1 && bestD <= ring * ring) break;
    for (let dy = -ring; dy <= ring; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= height) continue;
      const edge = dy === -ring || dy === ring;
      for (let dx = -ring; dx <= ring; dx += edge ? 1 : 2 * ring) {
        const x = cx + dx;
        if (x < 0 || x >= width) continue;
        const d = dx * dx + dy * dy;
        if (d > r2) continue;
        const i = y * width + x;
        if ((d < bestD || (d === bestD && i < best)) && ok(i)) {
          best = i;
          bestD = d;
        }
      }
    }
  }
  return best;
}

/** Separable box blur (radius r) of a w × h float grid, in place. */
function boxBlur(grid: Float32Array, w: number, h: number, r: number): void {
  const tmp = new Float32Array(Math.max(w, h));
  const span = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += x >= 0 && x < w ? (grid[y * w + x] as number) : 0;
    for (let x = 0; x < w; x++) {
      tmp[x] = acc / span;
      const add = x + r + 1;
      const sub = x - r;
      if (add < w) acc += grid[y * w + add] as number;
      if (sub >= 0) acc -= grid[y * w + sub] as number;
    }
    for (let x = 0; x < w; x++) grid[y * w + x] = tmp[x] as number;
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += y >= 0 && y < h ? (grid[y * w + x] as number) : 0;
    for (let y = 0; y < h; y++) {
      tmp[y] = acc / span;
      const add = y + r + 1;
      const sub = y - r;
      if (add < h) acc += grid[add * w + x] as number;
      if (sub >= 0) acc -= grid[sub * w + x] as number;
    }
    for (let y = 0; y < h; y++) grid[y * w + x] = tmp[y] as number;
  }
}

const AREA_BLUR = 3;
/** Share of an island's cells one region needs to take the whole island. */
const ISLAND_MAJORITY = 0.97;

/**
 * Biases the elevation/moisture fields inside an explicit terrain area. The area mask is blurred so the influence
 * fades over a few cells; the noise in the fields then shapes an organic edge instead of the polygon outline.
 */
function applyAreaBias(ring: number[], terrainClass: string, W: number, H: number, kind: Uint8Array, ruleOf: (i: number) => TerrainRule, eField: Float32Array, mField: Float32Array): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < ring.length; k += 2) {
    minX = Math.min(minX, ring[k] as number);
    maxX = Math.max(maxX, ring[k] as number);
    minY = Math.min(minY, ring[k + 1] as number);
    maxY = Math.max(maxY, ring[k + 1] as number);
  }
  const m = 2 * AREA_BLUR + 1;
  const x0 = Math.max(0, Math.floor(minX) - m);
  const y0 = Math.max(0, Math.floor(minY) - m);
  const x1 = Math.min(W, Math.ceil(maxX) + m);
  const y1 = Math.min(H, Math.ceil(maxY) + m);
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw <= 0 || bh <= 0) return;
  const mask = new Float32Array(bw * bh);
  fillPolygon(ring, W, H, (y, a, b) => {
    for (let x = a; x < b; x++) if (x >= x0 && x < x1 && y >= y0 && y < y1) mask[(y - y0) * bw + (x - x0)] = 1;
  });
  boxBlur(mask, bw, bh, AREA_BLUR);
  boxBlur(mask, bw, bh, AREA_BLUR);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const infl = mask[(y - y0) * bw + (x - x0)] as number;
      if (infl <= 0.001) continue;
      const i = y * W + x;
      if (kind[i] === CELL_SEA) continue;
      const rule = ruleOf(i);
      const hills = rule.elevation.hills;
      const mountain = rule.elevation.mountain;
      const forest = rule.moisture.forest;
      const marsh = rule.moisture.marsh;
      const e = eField[i] as number;
      switch (terrainClass) {
        case 'mountain':
          eField[i] = e + (mountain + 0.1 - 0.5) * infl;
          break;
        case 'hills':
          eField[i] = e + ((hills + mountain) / 2 - 0.5) * infl;
          break;
        case 'forest':
          mField[i] = (mField[i] as number) + (Math.min(marsh - 0.02, forest + 0.12) - 0.5) * infl;
          eField[i] = e - Math.max(0, e - (hills - 0.03)) * infl;
          break;
        case 'marsh':
          mField[i] = (mField[i] as number) + (marsh + 0.08 - 0.5) * infl;
          eField[i] = e - Math.max(0, e - (hills - 0.05)) * infl;
          break;
        default:
          mField[i] = (mField[i] as number) + (forest - 0.14 - 0.5) * infl;
          eField[i] = e - Math.max(0, e - (hills - 0.04)) * infl;
      }
    }
  }
}

/**
 * Province contiguity cleanup: a 4-connected piece of a province's land (land and lake cells) that holds none of
 * its anchors but borders land of other provinces of the same region is a Voronoi spill (border warp, fjords
 * cutting a province); it joins the same-region neighbour it shares the longest border with (ties → lower
 * province index). Slivers of at most SLIVER_CELLS cells left at a region seam with no same-region neighbour join
 * the adjoining province of the other region (and its region). Islands (pieces bordering only water) keep their
 * nearest-anchor province. Two passes, so a piece freed by the first can settle in the second. Mutates
 * `provinceOf` and `regionOf`.
 */
function absorbDetachedPieces(W: number, kind: Uint8Array, regionOf: Int16Array, provinceOf: Int16Array, provinceRegion: Int16Array, anchorCells: readonly number[][]): void {
  const size = kind.length;
  const piece = new Int32Array(size);
  const stack = new Int32Array(size);
  const cells: number[] = [];
  for (let pass = 0; pass < 2; pass++) {
    piece.fill(-1);
    const anchoredPiece: Record<string, true> = {};
    const pieceStart: number[] = [];
    // Label pieces.
    for (let start = 0; start < size; start++) {
      const p = provinceOf[start] as number;
      if (p < 0 || piece[start] !== -1 || kind[start] === CELL_SEA) continue;
      const id = pieceStart.length;
      pieceStart.push(start);
      let sp = 0;
      const push = (n: number): void => {
        if (piece[n] === -1 && provinceOf[n] === p && kind[n] !== CELL_SEA) {
          piece[n] = id;
          stack[sp++] = n;
        }
      };
      stack[sp++] = start;
      piece[start] = id;
      while (sp > 0) {
        const c = stack[--sp] as number;
        const x = c % W;
        if (x > 0) push(c - 1);
        if (x < W - 1) push(c + 1);
        if (c >= W) push(c - W);
        if (c + W < size) push(c + W);
      }
    }
    anchorCells.forEach((list, p) => {
      for (const c of list) if (c >= 0 && provinceOf[c] === p && (piece[c] as number) >= 0) anchoredPiece[piece[c] as number] = true;
    });
    let changed = false;
    for (let id = 0; id < pieceStart.length; id++) {
      if (Object.hasOwn(anchoredPiece, id)) continue;
      const start = pieceStart[id] as number;
      const p = provinceOf[start] as number;
      const r = regionOf[start] as number;
      // Collect the piece and count border contacts per neighbouring province (same region / other regions).
      cells.length = 0;
      const same: Record<string, number> = {};
      const other: Record<string, number> = {};
      let sp = 0;
      const seen = -2 - id; // temporary mark
      const look = (n: number): void => {
        if (kind[n] === CELL_SEA) return;
        const q = provinceOf[n] as number;
        if (q === p) {
          if (piece[n] === id) {
            piece[n] = seen;
            stack[sp++] = n;
          }
        } else if (q >= 0) {
          const bucket = regionOf[n] === r ? same : other;
          bucket[q] = (bucket[q] ?? 0) + 1;
        }
      };
      stack[sp++] = start;
      piece[start] = seen;
      while (sp > 0) {
        const c = stack[--sp] as number;
        cells.push(c);
        const x = c % W;
        if (x > 0) look(c - 1);
        if (x < W - 1) look(c + 1);
        if (c >= W) look(c - W);
        if (c + W < size) look(c + W);
      }
      for (const c of cells) piece[c] = id;
      let best = mostContacts(same);
      // A sliver left at a region seam (no same-region neighbour) joins the adjoining province of the other region.
      const crossRegion = best < 0 && cells.length <= SLIVER_CELLS;
      if (crossRegion) best = mostContacts(other);
      if (best < 0) continue;
      const region = crossRegion ? (provinceRegion[best] as number) : r;
      for (const c of cells) {
        provinceOf[c] = best;
        regionOf[c] = region;
      }
      changed = true;
    }
    if (!changed) break;
  }
}

/** Largest pieces moved across a region seam by the contiguity cleanup (cells). */
const SLIVER_CELLS = 12;

/** Key with the largest count (ties → lower numeric key), or −1. */
function mostContacts(counts: Record<string, number>): number {
  let best = -1;
  let bestN = 0;
  for (const key of Object.keys(counts)) {
    const q = Number(key);
    const n = counts[key] as number;
    if (n > bestN || (n === bestN && q < best)) {
      best = q;
      bestN = n;
    }
  }
  return best;
}

/** Builds the static world from a (validated) geography. Pure: same geography → identical arrays. */
export function buildStaticWorld(geo: Geography): StaticWorld {
  const W = geo.grid.width;
  const H = geo.grid.height;
  const size = W * H;
  const build = geo.build;
  const seed = hashString(build.seed);
  const index = buildGeoIndex(geo);
  const maxSeg = build.maxSegment;

  // 1. Land and authored lakes.
  const kind = new Uint8Array(size);
  const landmassOf = new Int16Array(size).fill(-1);
  geo.landmasses.forEach((lm, li) => {
    const ring = warpedRing(lm.polygon, mergeNoise(build.coast, lm.noise), maxSeg, seed, `land:${lm.id}`, lm.fractal ?? build.fractal.coast, build.fractal.minSegment);
    fillPolygon(ring, W, H, (y, x0, x1) => {
      const row = y * W;
      for (let x = x0; x < x1; x++) {
        kind[row + x] = CELL_LAND;
        landmassOf[row + x] = li;
      }
    });
  });
  const lakeOf = new Int16Array(size).fill(-1);
  geo.lakes.forEach((lake, li) => {
    const ring = warpedRing(lake.polygon, mergeNoise(build.lakes, lake.noise), maxSeg, seed, `lake:${lake.id}`, lake.fractal ?? build.fractal.lakes, build.fractal.minSegment);
    fillPolygon(ring, W, H, (y, x0, x1) => {
      const row = y * W;
      for (let x = x0; x < x1; x++) {
        if (kind[row + x] === CELL_LAND) {
          kind[row + x] = CELL_LAKE;
          lakeOf[row + x] = li;
        }
      }
    });
  });

  // Land components (lakes count as land; later lake/river edits never change them).
  const landComp = components4(W, H, (i) => kind[i] !== CELL_SEA);
  const landComponent = landComp.id;

  // 2. Regions.
  const regionOf = new Int16Array(size).fill(-1);
  // Region borders get fractal detail only on edges that run mostly over land; edges in open water stay exact, so
  // a border drawn down the middle of a narrow channel never strays onto either shore.
  const edgeOverLand = (ax: number, ay: number, bx: number, by: number): boolean => {
    const len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    const steps = Math.max(2, Math.ceil(len / 2));
    let onLand = 0;
    for (let k = 1; k < steps; k++) {
      const x = Math.floor(ax + ((bx - ax) * k) / steps);
      const y = Math.floor(ay + ((by - ay) * k) / steps);
      if (x >= 0 && y >= 0 && x < W && y < H && kind[y * W + x] !== CELL_SEA) onLand++;
    }
    return onLand * 2 >= steps - 1;
  };
  // Landmasses bound to a region (islands) are claimed wholesale first.
  {
    const regionOfLandmass = new Int16Array(geo.landmasses.length).fill(-1);
    geo.regions.forEach((region, ri) => {
      for (const id of region.landmasses ?? []) {
        const li = index.landmass[id];
        if (li !== undefined && regionOfLandmass[li] === -1) regionOfLandmass[li] = ri;
      }
    });
    for (let i = 0; i < size; i++) {
      const lm = landmassOf[i] as number;
      if (lm >= 0 && kind[i] !== CELL_SEA) regionOf[i] = regionOfLandmass[lm] as number;
    }
  }
  geo.regions.forEach((region, ri) => {
    region.polygons.forEach((poly) => {
      const ring = warpedRing(poly, undefined, maxSeg, seed, 'regions', build.fractal.regions, build.fractal.minSegment, edgeOverLand);
      fillPolygon(ring, W, H, (y, x0, x1) => {
        const row = y * W;
        for (let x = x0; x < x1; x++) {
          const i = row + x;
          if (kind[i] !== CELL_SEA && regionOf[i] === -1) regionOf[i] = ri;
        }
      });
    });
  });
  const unclaimedByRegion = new Array<number>(geo.regions.length).fill(0);
  {
    const stray: number[] = [];
    for (let i = 0; i < size; i++) if (kind[i] !== CELL_SEA && regionOf[i] === -1) stray.push(i);
    const late: number[] = [];
    for (const i of stray) {
      const n = nearestCellWhere(W, H, i, 6, (j) => kind[j] !== CELL_SEA && regionOf[j] !== -1);
      if (n === -1) late.push(i);
      else late.push(-1 - n);
    }
    // Two-phase so that assignments do not cascade in scan order.
    stray.forEach((i, k) => {
      const v = late[k] as number;
      if (v < 0) {
        const r = regionOf[-1 - v] as number;
        regionOf[i] = r;
        unclaimedByRegion[r] = (unclaimedByRegion[r] as number) + 1;
      }
    });
    const far = stray.filter((_, k) => (late[k] as number) >= 0);
    if (far.length > 0) {
      const passable = new Uint8Array(size).fill(1);
      const sources: number[] = [];
      const labels: number[] = [];
      for (let i = 0; i < size; i++) {
        if (regionOf[i] !== -1) {
          sources.push(i);
          labels.push(regionOf[i] as number);
        }
      }
      if (sources.length > 0) {
        const flood = geodesicFlood(W, H, passable, sources, labels);
        for (const i of far) {
          const r = flood.label[i] as number;
          if (r >= 0) {
            regionOf[i] = r;
            unclaimedByRegion[r] = (unclaimedByRegion[r] as number) + 1;
          }
        }
      }
    }
  }

  // An island (land component) that is almost entirely one region belongs wholly to it, so a warped region
  // polygon cannot nibble the tip of an island across a narrow channel.
  {
    const nr = geo.regions.length + 1;
    const counts = new Int32Array(landComp.sizes.length * nr);
    for (let i = 0; i < size; i++) {
      const c = landComponent[i] as number;
      if (c >= 0) counts[c * nr + (regionOf[i] as number) + 1] = (counts[c * nr + (regionOf[i] as number) + 1] as number) + 1;
    }
    const majority = new Int32Array(landComp.sizes.length).fill(-2);
    landComp.sizes.forEach((total, c) => {
      let best = -1;
      let bestN = -1;
      let distinct = 0;
      for (let r = 0; r < nr; r++) {
        const n = counts[c * nr + r] as number;
        if (n > 0) distinct++;
        if (n > bestN) {
          bestN = n;
          best = r - 1;
        }
      }
      if (distinct > 1 && best >= 0 && bestN >= total * ISLAND_MAJORITY) majority[c] = best;
    });
    for (let i = 0; i < size; i++) {
      const c = landComponent[i] as number;
      if (c >= 0 && (majority[c] as number) >= 0) regionOf[i] = majority[c] as number;
    }
  }

  // 3. Coast distance.
  const distToSea = distanceTransform(W, H, (i) => kind[i] === CELL_SEA);
  const distToLand = distanceTransform(W, H, (i) => kind[i] !== CELL_SEA);
  const coastDist = new Float32Array(size);
  for (let i = 0; i < size; i++) coastDist[i] = kind[i] === CELL_SEA ? (distToLand[i] as number) : (distToSea[i] as number);

  // 4. Terrain: elevation/moisture fields per region rule, biased by the explicit areas (soft-edged), classified.
  const terrain = new Uint8Array(size).fill(TERRAIN_NONE);
  const relief = new Float32Array(size);
  const eField = new Float32Array(size);
  const mField = new Float32Array(size);
  const elevSeed = subSeed(seed, 'terrain:elevation');
  const moistSeed = subSeed(seed, 'terrain:moisture');
  const detailSeed = subSeed(seed, 'terrain:detail');
  const lakeSeed = subSeed(seed, 'terrain:lakes');
  const rules: TerrainRule[] = geo.regions.map((r) => r.terrain);
  const ruleOf = (i: number): TerrainRule => rules[Math.max(0, regionOf[i] as number)] as TerrainRule;
  for (let i = 0; i < size; i++) {
    if (kind[i] === CELL_SEA) continue;
    const rule = ruleOf(i);
    const x = (i % W) + 0.5;
    const y = Math.floor(i / W) + 0.5;
    const ev = rule.elevation;
    eField[i] = fbm(x, y, elevSeed, ev.wavelength, 5, 0.5) + ev.coastGain * Math.min(coastDist[i] as number, ev.coastCap);
    mField[i] = fbm(x, y, moistSeed, rule.moisture.wavelength, 4, 0.5);
  }
  geo.terrain.areas.forEach((area) => {
    const ring = warpedRing(area.polygon, mergeNoise(build.terrainAreas, area.noise), maxSeg, seed, `area:${area.id}`, build.fractal.terrainAreas, build.fractal.minSegment);
    applyAreaBias(ring, area.terrain, W, H, kind, (i) => ruleOf(i), eField, mField);
  });
  for (let i = 0; i < size; i++) {
    if (kind[i] === CELL_SEA) continue;
    const rule = ruleOf(i);
    const ev = rule.elevation;
    const e = eField[i] as number;
    const m = mField[i] as number;
    const t = e >= ev.mountain ? TERRAIN_MOUNTAIN : e >= ev.hills ? TERRAIN_HILLS : m >= rule.moisture.marsh ? TERRAIN_MARSH : m >= rule.moisture.forest ? TERRAIN_FOREST : TERRAIN_PLAIN;
    terrain[i] = t;
    // Render relief: 0 at sea level, 1 at the region's mountain line, plus fine detail on rough ground.
    const x = (i % W) + 0.5;
    const y = Math.floor(i / W) + 0.5;
    const detail = fbm(x, y, detailSeed, 5, 3, 0.55) - 0.5;
    const rough = t === TERRAIN_MOUNTAIN ? 0.9 : t === TERRAIN_HILLS ? 0.45 : 0.12;
    let r = ev.mountain > 0 ? Math.max(0, e) / ev.mountain : 0;
    if (r > 1) r = 1 + (r - 1) * 0.35; // compress high plateaus so peaks stand out
    relief[i] = r + detail * rough;
  }

  // Protected cells: anchors, settlements and sites never become procedural lakes.
  const protect = new Uint8Array(size);
  const protectAround = (p: Point, radius: number) => {
    const cx = Math.floor(p[0]);
    const cy = Math.floor(p[1]);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && y >= 0 && x < W && y < H) protect[y * W + x] = 1;
      }
    }
  };
  for (const p of geo.provinces) {
    protectAround(p.anchor, 2);
    for (const a of p.anchors ?? []) protectAround(a, 1);
  }
  for (const s of geo.settlements) protectAround(s.pos, 2);
  for (const s of geo.sites) protectAround(s.pos, 1);
  for (const pg of geo.portages) {
    protectAround(pg.from, 1);
    protectAround(pg.to, 1);
  }

  for (let i = 0; i < size; i++) {
    if (kind[i] !== CELL_LAND || protect[i] === 1) continue;
    const r = regionOf[i] as number;
    const lakes = r < 0 ? undefined : rules[r]?.lakes;
    if (lakes === undefined || terrain[i] === TERRAIN_MOUNTAIN || (coastDist[i] as number) < lakes.minSeaDist) continue;
    const x = (i % W) + 0.5;
    const y = Math.floor(i / W) + 0.5;
    if (fbm(x, y, lakeSeed, lakes.wavelength, 3, 0.5) >= lakes.threshold) {
      kind[i] = CELL_LAKE;
      lakeOf[i] = LAKE_PROCEDURAL;
    }
  }

  // 5. Rivers and roads (one shared warp field per kind, so joins and shared vertices stay joined).
  const river = new Uint8Array(size);
  const riverOf = new Int16Array(size).fill(-1);
  const riverSeedX = subSeed(seed, 'rivers:x');
  const riverSeedY = subSeed(seed, 'rivers:y');
  geo.rivers.forEach((rv, ri) => {
    const sub = shapeLine(rv.points, false, build.fractal.rivers, build.fractal.minSegment, build.rivers, maxSeg, riverSeedX, riverSeedY, subSeed(seed, 'fractal'));
    const navLimit = !rv.navigable ? -1 : rv.navigableTo === undefined ? Infinity : (sub.vertexAt[rv.navigableTo] as number);
    tracePolyline(sub.points, W, H, (x, y, segment) => {
      const i = y * W + x;
      if (kind[i] === CELL_LAKE && lakeOf[i] === LAKE_PROCEDURAL) {
        kind[i] = CELL_LAND;
        lakeOf[i] = -1;
      }
      if (kind[i] !== CELL_LAND) return;
      const value = segment < navLimit ? RIVER_NAVIGABLE : RIVER_STREAM;
      if ((river[i] as number) < value || riverOf[i] === -1) {
        if ((river[i] as number) < value) river[i] = value;
        if (riverOf[i] === -1 || value === RIVER_NAVIGABLE) riverOf[i] = ri;
      }
    });
  });
  const road = new Uint8Array(size);
  const roadSeedX = subSeed(seed, 'roads:x');
  const roadSeedY = subSeed(seed, 'roads:y');
  for (const rd of geo.terrain.roads) {
    const sub = shapeLine(rd.points, false, build.fractal.roads, build.fractal.minSegment, build.roads, maxSeg, roadSeedX, roadSeedY, subSeed(seed, 'fractal'));
    const value = rd.kind === 'imperial' ? ROAD_IMPERIAL : ROAD_TRACK;
    tracePolyline(sub.points, W, H, (x, y) => {
      const i = y * W + x;
      if (kind[i] === CELL_LAKE && lakeOf[i] === LAKE_PROCEDURAL) {
        kind[i] = CELL_LAND;
        lakeOf[i] = -1;
      }
      if (kind[i] === CELL_LAND && (road[i] as number) < value) road[i] = value;
    });
  }

  // Final terrain/elevation for water cells.
  const elevation = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    if (kind[i] !== CELL_LAND) {
      terrain[i] = TERRAIN_NONE;
      continue;
    }
    elevation[i] = 1 + Math.round(Math.min(Math.max(relief[i] as number, 0), 1.5) * (254 / 1.5));
  }

  // 6. Provinces.
  const provinceOf = new Int16Array(size).fill(-1);
  const pb = build.provinceBorders;
  const pwx = subSeed(seed, 'provinces:x');
  const pwy = subSeed(seed, 'provinces:y');
  const warpX = (x: number, y: number) => (pb.amplitude === 0 ? x : x + pb.amplitude * fbmSigned(x, y, pwx, pb));
  const warpY = (x: number, y: number) => (pb.amplitude === 0 ? y : y + pb.amplitude * fbmSigned(x, y, pwy, pb));
  interface Anchor {
    wx: number;
    wy: number;
    province: number;
  }
  // anchors[region] = all anchors; byComp[region][comp] = anchors on that land component.
  const anchorsByRegion: Anchor[][] = geo.regions.map(() => []);
  const anchorsByRegionComp: Record<string, Anchor[]>[] = geo.regions.map(() => ({}));
  geo.provinces.forEach((p, pi) => {
    const ri = index.region[p.regionId];
    if (ri === undefined) return;
    for (const pt of [p.anchor, ...(p.anchors ?? [])]) {
      const a: Anchor = { wx: warpX(pt[0], pt[1]), wy: warpY(pt[0], pt[1]), province: pi };
      (anchorsByRegion[ri] as Anchor[]).push(a);
      const cell = pointCell(W, H, pt);
      const comp = cell >= 0 ? (landComponent[cell] as number) : -1;
      if (comp >= 0) ((anchorsByRegionComp[ri] as Record<string, Anchor[]>)[comp] ??= []).push(a);
    }
  });
  const neutralRegion = geo.regions.map((r) => r.neutral);
  for (let i = 0; i < size; i++) {
    if (kind[i] === CELL_SEA) continue;
    const r = regionOf[i] as number;
    if (r < 0 || neutralRegion[r] === true) continue;
    const comp = landComponent[i] as number;
    const byComp = anchorsByRegionComp[r] as Record<string, Anchor[]>;
    const list = Object.hasOwn(byComp, comp) ? (byComp[comp] as Anchor[]) : (anchorsByRegion[r] as Anchor[]);
    if (list.length === 0) continue;
    const x = (i % W) + 0.5;
    const y = Math.floor(i / W) + 0.5;
    const wx = warpX(x, y);
    const wy = warpY(x, y);
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < list.length; k++) {
      const a = list[k] as Anchor;
      const dx = a.wx - wx;
      const dy = a.wy - wy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = a.province;
      }
    }
    provinceOf[i] = best;
  }
  geo.provinces.forEach((p, pi) => {
    const cell = pointCell(W, H, p.anchor);
    if (cell >= 0 && kind[cell] === CELL_LAND && regionOf[cell] === index.region[p.regionId]) provinceOf[cell] = pi;
  });
  absorbDetachedPieces(
    W,
    kind,
    regionOf,
    provinceOf,
    Int16Array.from(geo.provinces.map((p) => index.region[p.regionId] ?? -1)),
    geo.provinces.map((p) => [p.anchor, ...(p.anchors ?? [])].map((a) => pointCell(W, H, a))),
  );

  // 7. Sea zones.
  const zoneOf = new Int16Array(size).fill(-1);
  geo.seaZones.forEach((zone, zi) => {
    for (const poly of zone.polygons ?? []) {
      const flat: number[] = [];
      for (const p of poly) flat.push(p[0], p[1]);
      fillPolygon(flat, W, H, (y, x0, x1) => {
        const row = y * W;
        for (let x = x0; x < x1; x++) if (kind[row + x] === CELL_SEA && zoneOf[row + x] === -1) zoneOf[row + x] = zi;
      });
    }
  });
  {
    const seaMask = new Uint8Array(size);
    for (let i = 0; i < size; i++) seaMask[i] = kind[i] === CELL_SEA ? 1 : 0;
    const sources: number[] = [];
    const labels: number[] = [];
    for (let i = 0; i < size; i++) {
      if (zoneOf[i] !== -1) {
        sources.push(i);
        labels.push(zoneOf[i] as number);
      }
    }
    geo.seaZones.forEach((zone, zi) => {
      for (const s of zone.seeds) {
        const c = pointCell(W, H, s);
        if (c >= 0 && kind[c] === CELL_SEA && zoneOf[c] === -1) {
          sources.push(c);
          labels.push(zi);
        }
      }
    });
    const flood = geodesicFlood(W, H, seaMask, sources, labels);
    for (let i = 0; i < size; i++) {
      if (kind[i] !== CELL_SEA || zoneOf[i] !== -1) continue;
      let z = flood.label[i] as number;
      if (z < 0) {
        // An enclosed pocket no seed reaches: nearest seed as the crow flies.
        const x = (i % W) + 0.5;
        const y = Math.floor(i / W) + 0.5;
        let bestD = Infinity;
        geo.seaZones.forEach((zone, zi) => {
          for (const s of zone.seeds) {
            const d = (s[0] - x) * (s[0] - x) + (s[1] - y) * (s[1] - y);
            if (d < bestD) {
              bestD = d;
              z = zi;
            }
          }
        });
      }
      zoneOf[i] = z;
    }
  }

  // 8. Navigation masks and components.
  const nav = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const k = kind[i];
    if (k === CELL_SEA) nav[i] = NAV_SEA | NAV_KARVI;
    else if (k === CELL_LAKE) {
      const li = lakeOf[i] as number;
      if (li >= 0 && geo.lakes[li]?.navigable === true) nav[i] = NAV_KARVI;
    } else if (river[i] === RIVER_NAVIGABLE) nav[i] = NAV_KARVI;
  }
  const seaComp = components4(W, H, (i) => kind[i] === CELL_SEA);
  const karviComp = components4(W, H, (i) => ((nav[i] as number) & NAV_KARVI) !== 0);
  const portageAt = new Int16Array(size).fill(-1);
  const portages: PortageInfo[] = geo.portages.map((pg, pi) => {
    const isRiverWater = (i: number) => ((nav[i] as number) & NAV_KARVI) !== 0 && kind[i] !== CELL_SEA;
    const isAnyWater = (i: number) => ((nav[i] as number) & NAV_KARVI) !== 0;
    const pick = (p: Point) => {
      const c = pointCell(W, H, p);
      const r = nearestCellWhere(W, H, c, 4, isRiverWater);
      return r !== -1 ? r : nearestCellWhere(W, H, c, 4, isAnyWater);
    };
    const fromCell = pick(pg.from);
    const toCell = pick(pg.to);
    const valid = fromCell !== -1 && toCell !== -1 && fromCell !== toCell;
    if (valid) {
      portageAt[fromCell] = pi;
      portageAt[toCell] = pi;
    }
    return { index: pi, id: pg.id, fromCell, toCell, valid };
  });
  // Union karvi components across portages.
  const karviComponent = karviComp.id;
  {
    const parent = karviComp.sizes.map((_, i) => i);
    const find = (a: number): number => {
      let r = a;
      while (parent[r] !== r) r = parent[r] as number;
      while (parent[a] !== r) {
        const next = parent[a] as number;
        parent[a] = r;
        a = next;
      }
      return r;
    };
    for (const pg of portages) {
      if (!pg.valid) continue;
      const a = find(karviComponent[pg.fromCell] as number);
      const b = find(karviComponent[pg.toCell] as number);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
    for (let i = 0; i < size; i++) {
      const c = karviComponent[i] as number;
      if (c >= 0) karviComponent[i] = find(c);
    }
  }
  const refZone = index.seaZone[build.referenceSeaZone];
  let refCell = -1;
  if (refZone !== undefined) {
    for (const s of geo.seaZones[refZone]?.seeds ?? []) {
      const c = pointCell(W, H, s);
      if (c >= 0 && kind[c] === CELL_SEA) {
        refCell = c;
        break;
      }
    }
  }
  const referenceSeaComponent = refCell >= 0 ? (seaComp.id[refCell] as number) : -1;
  const referenceKarviComponent = refCell >= 0 ? (karviComponent[refCell] as number) : -1;

  // Ports.
  const ports: Port[] = [];
  const portOf: Record<string, number> = {};
  const seaCompSize = seaComp.sizes;
  geo.settlements.forEach((s) => {
    if (!s.coastal && s.riverPort !== true) return;
    const landCell = pointCell(W, H, s.pos);
    if (landCell < 0) return;
    let cell = -1;
    let kindOf: 'sea' | 'river' = 'sea';
    if (s.coastal) {
      cell = nearestCellWhere(W, H, landCell, build.portSearchRadius, (i) => kind[i] === CELL_SEA && (seaCompSize[seaComp.id[i] as number] as number) >= build.minPortWaterCells);
      if (cell === -1) cell = nearestCellWhere(W, H, landCell, build.portSearchRadius, (i) => kind[i] === CELL_SEA);
    } else {
      kindOf = 'river';
      cell = nearestCellWhere(W, H, landCell, build.riverPortMaxCells, (i) => ((nav[i] as number) & NAV_KARVI) !== 0 && kind[i] !== CELL_SEA);
    }
    if (cell === -1) return;
    const lx = landCell % W;
    const ly = (landCell - lx) / W;
    const px = cell % W;
    const py = (cell - px) / W;
    const port: Port = {
      index: ports.length,
      settlementId: s.id,
      landCell,
      cell,
      kind: kindOf,
      zone: kindOf === 'sea' ? (zoneOf[cell] as number) : -1,
      distance: Math.sqrt((lx - px) * (lx - px) + (ly - py) * (ly - py)),
      seaReachable: kindOf === 'sea' && referenceSeaComponent >= 0 && seaComp.id[cell] === referenceSeaComponent,
      karviReachable: referenceKarviComponent >= 0 && karviComponent[cell] === referenceKarviComponent,
    };
    portOf[s.id] = port.index;
    ports.push(port);
  });

  // Summaries.
  const provinces: ProvinceInfo[] = geo.provinces.map((p, pi) => ({
    index: pi,
    id: p.id,
    regionIndex: index.region[p.regionId] ?? -1,
    landCells: 0,
    coastCells: 0,
    bounds: emptyBounds(),
    centroid: [0, 0],
    labelAt: [0, 0],
    anchorCell: pointCell(W, H, p.anchor),
    neighbours: [],
    seaZones: [],
  }));
  const regions: RegionInfo[] = geo.regions.map((r, ri) => ({ index: ri, id: r.id, landCells: 0, bounds: emptyBounds(), unclaimedCells: unclaimedByRegion[ri] as number }));
  const seaZones: SeaZoneInfo[] = geo.seaZones.map((z, zi) => ({ index: zi, id: z.id, cells: 0, bounds: emptyBounds() }));
  const sumX = new Float64Array(provinces.length);
  const sumY = new Float64Array(provinces.length);
  const neighbourSeen: Record<string, true>[] = provinces.map(() => ({}));
  const zoneSeen: Record<string, true>[] = provinces.map(() => ({}));
  /** Records what lies beyond a province cell's edge; true when it is the sea. */
  const touchesSea = (p: number, n: number): boolean => {
    const k = kind[n];
    if (k === CELL_SEA) {
      const z = zoneOf[n] as number;
      if (z >= 0) (zoneSeen[p] as Record<string, true>)[z] = true;
      return true;
    }
    const q = provinceOf[n] as number;
    if (q >= 0 && q !== p && k === CELL_LAND) (neighbourSeen[p] as Record<string, true>)[q] = true;
    return false;
  };
  for (let i = 0; i < size; i++) {
    const x = i % W;
    const y = (i - x) / W;
    if (kind[i] === CELL_SEA) {
      const z = zoneOf[i] as number;
      if (z >= 0) {
        const info = seaZones[z] as SeaZoneInfo;
        info.cells++;
        grow(info.bounds, x, y);
      }
      continue;
    }
    const r = regionOf[i] as number;
    if (kind[i] === CELL_LAND && r >= 0) {
      const info = regions[r] as RegionInfo;
      info.landCells++;
      grow(info.bounds, x, y);
    }
    const p = provinceOf[i] as number;
    if (p < 0 || kind[i] !== CELL_LAND) continue;
    const info = provinces[p] as ProvinceInfo;
    info.landCells++;
    grow(info.bounds, x, y);
    sumX[p] = (sumX[p] as number) + x + 0.5;
    sumY[p] = (sumY[p] as number) + y + 0.5;
    let coast = false;
    if (x > 0 && touchesSea(p, i - 1)) coast = true;
    if (x < W - 1 && touchesSea(p, i + 1)) coast = true;
    if (y > 0 && touchesSea(p, i - W)) coast = true;
    if (y < H - 1 && touchesSea(p, i + W)) coast = true;
    if (coast) info.coastCells++;
  }
  provinces.forEach((info, pi) => {
    const def = geo.provinces[pi];
    if (info.landCells > 0) info.centroid = [(sumX[pi] as number) / info.landCells, (sumY[pi] as number) / info.landCells];
    info.neighbours = Object.keys(neighbourSeen[pi] as Record<string, true>).map(Number).sort((a, b) => a - b);
    info.seaZones = Object.keys(zoneSeen[pi] as Record<string, true>).map(Number).sort((a, b) => a - b);
    if (def?.label !== undefined) info.labelAt = [def.label[0], def.label[1]];
    else if (info.landCells > 0) {
      const c = pointCell(W, H, info.centroid);
      const n = nearestCellWhere(W, H, c, 40, (i) => provinceOf[i] === pi && kind[i] === CELL_LAND);
      info.labelAt = n === -1 ? info.centroid : [(n % W) + 0.5, Math.floor(n / W) + 0.5];
    }
  });

  const partial = {
    geo,
    width: W,
    height: H,
    size,
    cellKm: geo.grid.cellKm,
    kind,
    terrain,
    elevation,
    road,
    river,
    riverOf,
    lakeOf,
    landmassOf,
    landComponent,
    regionOf,
    provinceOf,
    zoneOf,
    coastDist,
    nav,
    seaComponent: seaComp.id,
    karviComponent,
    seaComponentSize: seaCompSize,
    referenceSeaComponent,
    referenceKarviComponent,
    portages,
    portageAt,
    provinces,
    regions,
    seaZones,
    ports,
    portOf,
    index,
  };
  const nodes: LaneNode[] = ports.map((p) => ({ id: p.settlementId, cell: p.cell }));
  const lanes = buildSeaLanes(partial, nodes);
  return { ...partial, lanes };
}
