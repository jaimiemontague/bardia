/**
 * Landmark ("ALT") lower bounds for sea routing. For a few landmark cells L the water distance d(L, ·) is
 * precomputed; by the triangle inequality |d(L, t) − d(L, n)| ≤ d(n, t), so max over landmarks is an admissible
 * and consistent A* heuristic that, unlike straight-line distance, "knows" about landmasses in the way.
 *
 * Distances are chamfer distances (orthogonal 1, diagonal 1.4 cells: never more than the true 1 / √2 step lengths)
 * over karvi-navigable water (sea, navigable rivers and lakes) with portages as near-free links. Karvi water is a
 * superset of sea water and portages only shorten routes, so the bound holds for every vessel, every cost hook
 * with multipliers ≥ 1 (or ≥ minCostMultiplier, which scales it) and every set of blocked zones.
 *
 * The table is built on first use per world (about 0.1 s) and cached; `prepareSeaRouting` builds it eagerly.
 */
import { CHAMFER_ORTHO, geodesicFlood, type FloodLink } from './flood';
import { CELL_SEA, NAV_KARVI, type StaticWorld } from './model';

/** Unreached marker in `AltTable.dist`. */
export const ALT_UNREACHED = 0xffff;

export interface AltTable {
  /** Number of landmarks. */
  count: number;
  /** Landmark cells. */
  landmarks: number[];
  /** dist[cell × count + l]: chamfer units (5 per cell) from landmark l, or ALT_UNREACHED. */
  dist: Uint16Array;
}

/** How many landmarks the table holds. */
export const ALT_LANDMARKS = 8;

const cache: { world: StaticWorld; table: AltTable }[] = [];

/**
 * Builds the landmark table for a world: farthest-point landmarks (sea cells) by water distance, starting from the
 * sea cell farthest from the reference zone's first seed. Deterministic.
 */
export function buildAltTable(world: StaticWorld, count = ALT_LANDMARKS): AltTable {
  const size = world.size;
  const W = world.width;
  const H = world.height;
  const mask = new Uint8Array(size);
  for (let i = 0; i < size; i++) mask[i] = ((world.nav[i] as number) & NAV_KARVI) !== 0 ? 1 : 0;
  const links: FloodLink[] = world.portages.filter((p) => p.valid).map((p) => ({ a: p.fromCell, b: p.toCell, cost: 1, tag: p.index }));
  // Start: a water cell of the reference component (the first seed of the reference zone), else the first water cell.
  let start = -1;
  const ref = world.index.seaZone[world.geo.build.referenceSeaZone];
  for (const seed of ref === undefined ? [] : (world.geo.seaZones[ref]?.seeds ?? [])) {
    const c = Math.floor(seed[1]) * W + Math.floor(seed[0]);
    if (c >= 0 && c < size && world.kind[c] === CELL_SEA) {
      start = c;
      break;
    }
  }
  if (start === -1) for (let i = 0; i < size && start === -1; i++) if (mask[i] === 1) start = i;
  const dist = new Uint16Array(size * count).fill(ALT_UNREACHED);
  const landmarks: number[] = [];
  if (start === -1) return { count: 0, landmarks, dist: new Uint16Array(0) };
  const minDist = new Int32Array(size).fill(-1);
  // Landmarks sit at sea (river heads are poor landmarks for sea routes); distances still run over karvi water.
  const isSea = (i: number) => world.kind[i] === CELL_SEA && (world.coastDist[i] as number) >= 3;
  let next = argmax(geodesicFlood(W, H, mask, [start], [0], links).dist, isSea);
  for (let l = 0; l < count && next !== -1; l++) {
    landmarks.push(next);
    const d = geodesicFlood(W, H, mask, [next], [0], links).dist;
    for (let i = 0; i < size; i++) {
      const v = d[i] as number;
      if (v < 0) continue;
      dist[i * count + l] = v >= ALT_UNREACHED ? ALT_UNREACHED - 1 : v;
      const m = minDist[i] as number;
      if (m === -1 || v < m) minDist[i] = v;
    }
    next = argmax(minDist, isSea);
    if (next !== -1 && minDist[next] === 0) next = -1;
  }
  if (landmarks.length < count) {
    // Fewer distinct landmarks than slots (tiny worlds): compact the table.
    const n = landmarks.length;
    const compact = new Uint16Array(size * n);
    for (let i = 0; i < size; i++) for (let l = 0; l < n; l++) compact[i * n + l] = dist[i * count + l] as number;
    return { count: n, landmarks, dist: compact };
  }
  return { count, landmarks, dist };
}

/** Index of the largest non-negative value among cells passing `ok` (ties → lower index), or −1. */
function argmax(values: Int32Array, ok: (i: number) => boolean): number {
  let best = -1;
  let bestV = -1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    if (v > bestV && ok(i)) {
      bestV = v;
      best = i;
    }
  }
  return best;
}

/** The landmark table of a world, built on first use and cached (the two most recent worlds). */
export function altTableOf(world: StaticWorld): AltTable {
  for (const entry of cache) if (entry.world === world) return entry.table;
  const table = buildAltTable(world);
  cache.unshift({ world, table });
  if (cache.length > 2) cache.length = 2;
  return table;
}

/** Builds the sea-routing acceleration data now (e.g. behind a loading screen) instead of on the first query. */
export function prepareSeaRouting(world: StaticWorld): void {
  altTableOf(world);
}

/** Chamfer units per cell in AltTable.dist. */
export const ALT_UNITS_PER_CELL = CHAMFER_ORTHO;
