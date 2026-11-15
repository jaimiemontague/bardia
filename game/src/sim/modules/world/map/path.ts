/**
 * A* on the navigation grid (§8.3, §8.7). 8-neighbour moves; a diagonal move never cuts a corner (both orthogonal
 * neighbours must be passable). Costs are "time-like": step length (1 or √2 cells) × multiplier for sea paths,
 * step length ÷ terrain speed for land paths. Heuristics are octile distance scaled to stay admissible; sea paths
 * also use landmark lower bounds (alt.ts), which cut the search around landmasses without changing results' cost.
 *
 * Sea paths: sea cells for every ship; with `karvi`, also navigable rivers and lakes, and portage jumps (§8.8).
 * Pluggable costs: `cost(to, from, dir)` (wind, danger, storm avoidance; return a multiplier ≥ 0, Infinity
 * blocks), `costField` (per-cell multiplier), `blockedZones` (ice, §8.4) and `shoalPenalty` (deep-draught ships).
 *
 * Scratch buffers are shared and reused between queries (no per-query allocation of grid-sized arrays), so
 * the functions are not re-entrant: a cost hook must not start another path query (it throws).
 */
import balanceJson from '@content/data/balance.json';
import { ALT_UNITS_PER_CELL, ALT_UNREACHED, altTableOf } from './alt';
import { CellHeap } from './flood';
import {
  CELL_LAND,
  CELL_SEA,
  NAV_KARVI,
  NAV_SEA,
  ROAD_NONE,
  TERRAIN_FOREST,
  TERRAIN_HILLS,
  TERRAIN_MARSH,
  TERRAIN_MOUNTAIN,
  TERRAIN_PLAIN,
  type StaticWorld,
} from './model';

/** Cost hook: multiplier for the step from → to in direction `dir` (DIR_* index). ≥ 0; Infinity blocks. */
export type StepCost = (to: number, from: number, dir: number) => number;

export interface SeaPathOptions {
  /** Karvi (and river boats): navigable rivers/lakes and portages are allowed (§8.8). */
  karvi?: boolean;
  /** Multiplier hook (wind, known danger, storm avoidance). */
  cost?: StepCost;
  /** Per-cell multiplier (e.g. a danger field); Infinity blocks. */
  costField?: ArrayLike<number>;
  /** blockedZones[zoneIndex] = true closes that sea zone (seasonal ice). */
  blockedZones?: readonly boolean[];
  /** Multiplier for sea cells next to land (coastDist ≤ 1.5): the shoal penalty for deep-draught ships. */
  shoalPenalty?: number;
  /** Lower bound of every multiplier (keeps the heuristic admissible when hooks return < 1). Default 1. */
  minCostMultiplier?: number;
  /** > 1 trades optimality for speed (weighted A*). Default 1. */
  heuristicWeight?: number;
  /** Cost of crossing a portage in cell-steps (default: build.lanes.portageDays × nominal cells per day). */
  portageCost?: number;
  /** Give up after this many node expansions (returns null). Default: every cell. */
  maxExpansions?: number;
  /**
   * Use the landmark lower bound (alt.ts) besides straight-line distance (default true). It never changes the cost
   * of the path found, only how fast it is found; the landmark table is built on the first query of a world.
   */
  landmarks?: boolean;
}

/** Overland speed factors (§8.7). A factor ≤ 0 (or a missing mountain factor) makes the terrain impassable. */
export interface LandSpeeds {
  plain: number;
  forest: number;
  hills: number;
  marsh: number;
  road: number;
  mountain?: number;
}

/**
 * The §8.7 overland speed factors of the bundled balance table (`balance.overland.terrain`: plain 1, forest 0.6,
 * hills 0.7, marsh 0.5, road 1.3, mountains very slow). The default of findLandPath; sim code passes
 * `ctx.balance.overland.terrain` so tests and mods can substitute it. Spread it with `mountain: 0` to make
 * mountains impassable.
 */
export const BUNDLED_LAND_SPEEDS: Readonly<LandSpeeds> = balanceJson.overland.terrain;

export interface LandPathOptions {
  /** Speed factors per terrain class (default BUNDLED_LAND_SPEEDS). */
  speeds?: LandSpeeds;
  /** Multiplier hook (e.g. hostile provinces, known bands). */
  cost?: StepCost;
  costField?: ArrayLike<number>;
  heuristicWeight?: number;
  maxExpansions?: number;
}

export interface GridPath {
  /** Cells from start to goal inclusive. */
  cells: number[];
  /** Total cost (sea: multiplied cell-steps; land: cell-steps ÷ speed, i.e. "plain-cell days" units). */
  cost: number;
  /** Geometric length in cells (portage jumps excluded). */
  length: number;
  km: number;
  /** Portage indices crossed, in order (karvi sea paths). */
  portages: number[];
  /** Nodes expanded (diagnostics). */
  expansions: number;
}

interface Scratch {
  size: number;
  g: Float64Array;
  parent: Int32Array;
  seen: Uint32Array;
  closed: Uint32Array;
  /** Portage index used to arrive at a cell, or -1 for a grid step. */
  via: Int16Array;
  gen: number;
  heap: CellHeap;
  busy: boolean;
}

let scratch: Scratch | undefined;

function acquire(size: number): Scratch {
  if (scratch === undefined || scratch.size !== size) {
    scratch = {
      size,
      g: new Float64Array(size),
      parent: new Int32Array(size),
      seen: new Uint32Array(size),
      closed: new Uint32Array(size),
      via: new Int16Array(size),
      gen: 0,
      heap: new CellHeap(8192),
      busy: false,
    };
  }
  if (scratch.busy) throw new Error('map path queries are not re-entrant (a cost hook started another query)');
  scratch.busy = true;
  scratch.gen++;
  if (scratch.gen >= 0xffffffff) {
    scratch.seen.fill(0);
    scratch.closed.fill(0);
    scratch.gen = 1;
  }
  scratch.heap.clear();
  return scratch;
}

const SQRT2_M1 = Math.SQRT2 - 1;
/** Tie-break toward the goal among equal f (h × (1 + ε)); keeps paths within 0.01% of optimal. */
const TIE = 1.0001;

function octile(width: number, a: number, b: number): number {
  const ax = a % width;
  const bx = b % width;
  const dx = Math.abs(ax - bx);
  const dy = Math.abs((a - ax) / width - (b - bx) / width);
  return dx > dy ? dx + SQRT2_M1 * dy : dy + SQRT2_M1 * dx;
}

function reconstruct(world: StaticWorld, s: Scratch, from: number, to: number, expansions: number): GridPath {
  const cells: number[] = [];
  for (let c = to; c !== -1; c = c === from ? -1 : (s.parent[c] as number)) cells.push(c);
  cells.reverse();
  const W = world.width;
  let length = 0;
  const portages: number[] = [];
  for (let k = 1; k < cells.length; k++) {
    const a = cells[k - 1] as number;
    const b = cells[k] as number;
    const p = s.via[b] as number;
    if (p >= 0) {
      portages.push(p);
      continue;
    }
    const ax = a % W;
    const bx = b % W;
    const dx = Math.abs(ax - bx);
    const dy = Math.abs((a - ax) / W - (b - bx) / W);
    length += dx + dy === 2 ? Math.SQRT2 : 1;
  }
  return { cells, cost: s.g[to] as number, length, km: length * world.cellKm, portages, expansions };
}

/** Default portage cost in cell-steps. */
export function defaultPortageCost(world: StaticWorld): number {
  const lanes = world.geo.build.lanes;
  return (lanes.portageDays * lanes.nominalKmPerDay) / world.cellKm;
}

/**
 * Cheapest water path between two cells, or null when unreachable (or an end is not navigable for the vessel or
 * lies in a blocked zone). Typical queries take a few milliseconds on the 800 × 600 grid.
 */
export function findSeaPath(world: StaticWorld, from: number, to: number, options: SeaPathOptions = {}): GridPath | null {
  const size = world.size;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= size || to >= size) return null;
  const karvi = options.karvi === true;
  const bit = karvi ? NAV_KARVI : NAV_SEA;
  const nav = world.nav;
  const zoneOf = world.zoneOf;
  const blocked = options.blockedZones;
  const anyBlocked = blocked !== undefined && blocked.some((b) => b === true);
  const ok = (c: number): boolean => {
    if (((nav[c] as number) & bit) === 0) return false;
    if (!anyBlocked) return true;
    const z = zoneOf[c] as number;
    return z < 0 || (blocked as readonly boolean[])[z] !== true;
  };
  if (!ok(from) || !ok(to)) return null;
  const W = world.width;
  const H = world.height;
  const costHook = options.cost;
  const field = options.costField;
  const shoal = options.shoalPenalty ?? 1;
  const coastDist = world.coastDist;
  const kind = world.kind;
  const hScale = (options.minCostMultiplier ?? 1) * (options.heuristicWeight ?? 1) * TIE;
  const portageCost = options.portageCost ?? defaultPortageCost(world);
  const portageAt = world.portageAt;
  const portages = world.portages;
  const maxExp = options.maxExpansions ?? size;
  const tx = to % W;
  const ty = (to - tx) / W;
  // Landmark bound: the goal's distance to each landmark, compared with each cell's.
  const alt = options.landmarks === false ? undefined : altTableOf(world);
  const L = alt === undefined ? 0 : alt.count;
  const altDist = alt === undefined ? new Uint16Array(0) : alt.dist;
  const target = new Float64Array(L);
  for (let l = 0; l < L; l++) target[l] = altDist[to * L + l] as number;
  const invUnits = 1 / ALT_UNITS_PER_CELL;
  /** Admissible estimate in cells (before scaling) from cell n at (nx, ny) to the goal. */
  const estimate = (n: number, nx: number, ny: number): number => {
    const dx = nx > tx ? nx - tx : tx - nx;
    const dy = ny > ty ? ny - ty : ty - ny;
    let h = dx > dy ? dx + SQRT2_M1 * dy : dy + SQRT2_M1 * dx;
    const base = n * L;
    for (let l = 0; l < L; l++) {
      const a = altDist[base + l] as number;
      const b = target[l] as number;
      if (a === ALT_UNREACHED || b === ALT_UNREACHED) continue;
      const d = (a > b ? a - b : b - a) * invUnits;
      if (d > h) h = d;
    }
    return h;
  };
  const s = acquire(size);
  try {
    const { g, parent, seen, closed, heap, via } = s;
    const gen = s.gen;
    let c = from;
    let gc = 0;
    /** Relaxes the step c → n (cell n at nx, ny) of geometric length `len` in direction `dir`. */
    const relax = (n: number, nx: number, ny: number, len: number, dir: number): void => {
      if (closed[n] === gen) return;
      let mult = 1;
      if (field !== undefined) mult *= field[n] as number;
      if (shoal !== 1 && kind[n] === CELL_SEA && (coastDist[n] as number) <= 1.5) mult *= shoal;
      if (costHook !== undefined) mult *= costHook(n, c, dir);
      if (!(mult < Infinity) || !(mult >= 0)) return;
      const ng = gc + len * mult;
      if (seen[n] !== gen || ng < (g[n] as number)) {
        seen[n] = gen;
        g[n] = ng;
        parent[n] = c;
        via[n] = -1;
        heap.push(ng + estimate(n, nx, ny) * hScale, n);
      }
    };
    g[from] = 0;
    parent[from] = -1;
    via[from] = -1;
    seen[from] = gen;
    heap.push(estimate(from, from % W, (from - (from % W)) / W) * hScale, from);
    let expansions = 0;
    while (heap.size > 0) {
      c = heap.pop();
      if (closed[c] === gen) continue;
      closed[c] = gen;
      if (c === to) return reconstruct(world, s, from, to, expansions);
      if (++expansions > maxExp) return null;
      gc = g[c] as number;
      const x = c % W;
      const y = (c - x) / W;
      const e = x < W - 1 && ok(c + 1);
      const wst = x > 0 && ok(c - 1);
      const sth = y < H - 1 && ok(c + W);
      const nth = y > 0 && ok(c - W);
      if (e) relax(c + 1, x + 1, y, 1, 0);
      if (sth) relax(c + W, x, y + 1, 1, 2);
      if (wst) relax(c - 1, x - 1, y, 1, 4);
      if (nth) relax(c - W, x, y - 1, 1, 6);
      if (e && sth && ok(c + W + 1)) relax(c + W + 1, x + 1, y + 1, Math.SQRT2, 1);
      if (wst && sth && ok(c + W - 1)) relax(c + W - 1, x - 1, y + 1, Math.SQRT2, 3);
      if (wst && nth && ok(c - W - 1)) relax(c - W - 1, x - 1, y - 1, Math.SQRT2, 5);
      if (e && nth && ok(c - W + 1)) relax(c - W + 1, x + 1, y - 1, Math.SQRT2, 7);
      if (karvi) {
        const p = portageAt[c] as number;
        const pg = p >= 0 ? portages[p] : undefined;
        if (pg !== undefined && pg.valid) {
          const n = pg.fromCell === c ? pg.toCell : pg.fromCell;
          if (closed[n] !== gen && ok(n)) {
            const ng = gc + portageCost;
            if (seen[n] !== gen || ng < (g[n] as number)) {
              seen[n] = gen;
              g[n] = ng;
              parent[n] = c;
              via[n] = p;
              heap.push(ng + estimate(n, n % W, (n - (n % W)) / W) * hScale, n);
            }
          }
        }
      }
    }
    return null;
  } finally {
    s.busy = false;
  }
}

/** Speed factor table indexed by TERRAIN_* code (0 = impassable). */
function speedTable(speeds: LandSpeeds): Float64Array {
  const t = new Float64Array(5);
  t[TERRAIN_PLAIN] = Math.max(0, speeds.plain);
  t[TERRAIN_FOREST] = Math.max(0, speeds.forest);
  t[TERRAIN_HILLS] = Math.max(0, speeds.hills);
  t[TERRAIN_MOUNTAIN] = Math.max(0, speeds.mountain ?? 0);
  t[TERRAIN_MARSH] = Math.max(0, speeds.marsh);
  return t;
}

/**
 * Fastest overland path between two land cells (§8.7: terrain speed factors, roads at least `speeds.road`; lakes
 * and the sea block; mountains block unless `speeds.mountain` > 0), or null. Cost unit: cell-steps ÷ speed
 * ("plain cells"), so days = cost × cellKm ÷ (base km/day × other factors).
 */
export function findLandPath(world: StaticWorld, from: number, to: number, options: LandPathOptions = {}): GridPath | null {
  const size = world.size;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= size || to >= size) return null;
  const speeds = options.speeds ?? BUNDLED_LAND_SPEEDS;
  const table = speedTable(speeds);
  const roadSpeed = Math.max(0, speeds.road);
  const kind = world.kind;
  const terrain = world.terrain;
  const road = world.road;
  const speedOf = (c: number): number => {
    if (kind[c] !== CELL_LAND) return 0;
    const t = table[terrain[c] as number] as number;
    return road[c] !== ROAD_NONE && t > 0 ? Math.max(t, roadSpeed) : t;
  };
  if (speedOf(from) <= 0 || speedOf(to) <= 0) return null;
  let maxSpeed = roadSpeed;
  for (let i = 0; i < table.length; i++) if ((table[i] as number) > maxSpeed) maxSpeed = table[i] as number;
  if (maxSpeed <= 0) return null;
  const W = world.width;
  const H = world.height;
  const costHook = options.cost;
  const field = options.costField;
  const hScale = ((options.heuristicWeight ?? 1) * TIE) / maxSpeed;
  const maxExp = options.maxExpansions ?? size;
  const tx = to % W;
  const ty = (to - tx) / W;
  const s = acquire(size);
  try {
    const { g, parent, seen, closed, heap, via } = s;
    const gen = s.gen;
    let c = from;
    let gc = 0;
    /** Relaxes the step c → n into a cell of speed `sp`. */
    const relax = (n: number, nx: number, ny: number, len: number, dir: number, sp: number): void => {
      if (closed[n] === gen) return;
      let mult = 1;
      if (field !== undefined) mult *= field[n] as number;
      if (costHook !== undefined) mult *= costHook(n, c, dir);
      if (!(mult < Infinity) || !(mult >= 0)) return;
      const ng = gc + (len / sp) * mult;
      if (seen[n] !== gen || ng < (g[n] as number)) {
        seen[n] = gen;
        g[n] = ng;
        parent[n] = c;
        via[n] = -1;
        const dx = nx > tx ? nx - tx : tx - nx;
        const dy = ny > ty ? ny - ty : ty - ny;
        heap.push(ng + (dx > dy ? dx + SQRT2_M1 * dy : dy + SQRT2_M1 * dx) * hScale, n);
      }
    };
    g[from] = 0;
    parent[from] = -1;
    via[from] = -1;
    seen[from] = gen;
    heap.push(octile(W, from, to) * hScale, from);
    let expansions = 0;
    while (heap.size > 0) {
      c = heap.pop();
      if (closed[c] === gen) continue;
      closed[c] = gen;
      if (c === to) return reconstruct(world, s, from, to, expansions);
      if (++expansions > maxExp) return null;
      gc = g[c] as number;
      const x = c % W;
      const y = (c - x) / W;
      const se = x < W - 1 ? speedOf(c + 1) : 0;
      const sw = x > 0 ? speedOf(c - 1) : 0;
      const ss = y < H - 1 ? speedOf(c + W) : 0;
      const sn = y > 0 ? speedOf(c - W) : 0;
      if (se > 0) relax(c + 1, x + 1, y, 1, 0, se);
      if (ss > 0) relax(c + W, x, y + 1, 1, 2, ss);
      if (sw > 0) relax(c - 1, x - 1, y, 1, 4, sw);
      if (sn > 0) relax(c - W, x, y - 1, 1, 6, sn);
      if (se > 0 && ss > 0) {
        const sp = speedOf(c + W + 1);
        if (sp > 0) relax(c + W + 1, x + 1, y + 1, Math.SQRT2, 1, sp);
      }
      if (sw > 0 && ss > 0) {
        const sp = speedOf(c + W - 1);
        if (sp > 0) relax(c + W - 1, x - 1, y + 1, Math.SQRT2, 3, sp);
      }
      if (sw > 0 && sn > 0) {
        const sp = speedOf(c - W - 1);
        if (sp > 0) relax(c - W - 1, x - 1, y - 1, Math.SQRT2, 5, sp);
      }
      if (se > 0 && sn > 0) {
        const sp = speedOf(c - W + 1);
        if (sp > 0) relax(c - W + 1, x + 1, y - 1, Math.SQRT2, 7, sp);
      }
    }
    return null;
  } finally {
    s.busy = false;
  }
}
