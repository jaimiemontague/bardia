/**
 * Vector geometry extracted from the static world's grids (pure): province/realm border polylines along cell edges,
 * river and road networks traced through their cells, and smoothing (midpoint + Chaikin) that turns grid staircases
 * into hand-drawn curves. Polylines are flat number arrays [x0, y0, x1, y1, …] in cell coordinates.
 */
import { CELL_LAKE, CELL_LAND, CELL_SEA, RIVER_NAVIGABLE, RIVER_NONE, ROAD_IMPERIAL, ROAD_NONE, type StaticWorld } from '@sim/modules/world/map/index';

/** A border between two labelled areas (province indices; −1 = neutral land). */
export interface BorderChain {
  a: number;
  b: number;
  /** Smoothed polyline (cell coordinates). */
  points: number[];
  /** Region indices on each side (−1 unknown): realm borders between regions are drawn stronger. */
  regionA: number;
  regionB: number;
}

/** A traced river or road. */
export interface NetworkPath {
  /** River index into geo.rivers (−1 for roads/unnamed streams). */
  id: number;
  /** RIVER_* or ROAD_* value of the run. */
  value: number;
  points: number[];
  /** The first/last point touches the sea, a lake or another river (rivers widen towards their mouth). */
  mouthAtStart: boolean;
  mouthAtEnd: boolean;
}

// ---------------------------------------------------------------------------------------------
// Smoothing.

/**
 * Replaces interior vertices by the midpoints of their edges (endpoints kept). A unit staircase becomes a straight
 * diagonal; repeated application is a corner-cutting subdivision.
 */
export function midpointPass(pts: readonly number[], closed = false): number[] {
  const n = pts.length / 2;
  if (n < 3) return pts.slice();
  const out: number[] = [];
  if (closed) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      out.push((pts[2 * i]! + pts[2 * j]!) / 2, (pts[2 * i + 1]! + pts[2 * j + 1]!) / 2);
    }
    return out;
  }
  out.push(pts[0]!, pts[1]!);
  for (let i = 0; i < n - 1; i++) out.push((pts[2 * i]! + pts[2 * i + 2]!) / 2, (pts[2 * i + 1]! + pts[2 * i + 3]!) / 2);
  out.push(pts[2 * n - 2]!, pts[2 * n - 1]!);
  return out;
}

/** One Chaikin corner-cutting iteration (open polylines keep their endpoints). */
export function chaikin(pts: readonly number[], closed = false): number[] {
  const n = pts.length / 2;
  if (n < 3) return pts.slice();
  const out: number[] = [];
  const cut = (i: number, j: number) => {
    const ax = pts[2 * i]!;
    const ay = pts[2 * i + 1]!;
    const bx = pts[2 * j]!;
    const by = pts[2 * j + 1]!;
    out.push(ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25, ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75);
  };
  if (closed) {
    for (let i = 0; i < n; i++) cut(i, (i + 1) % n);
    return out;
  }
  out.push(pts[0]!, pts[1]!);
  for (let i = 0; i < n - 1; i++) cut(i, i + 1);
  // Replace the first and last cut points by the true endpoints.
  out.splice(2, 2);
  out.splice(out.length - 2, 2);
  out.push(pts[2 * n - 2]!, pts[2 * n - 1]!);
  return out;
}

/** Midpoint pass then `iterations` Chaikin passes: grid staircases → smooth hand-drawn curves. */
export function smoothPolyline(pts: readonly number[], iterations = 2, closed = false): number[] {
  let out = midpointPass(pts, closed);
  for (let i = 0; i < iterations; i++) out = chaikin(out, closed);
  return out;
}

/** Drops vertices closer than `minDist` to the previous kept one (endpoints kept). */
export function decimate(pts: readonly number[], minDist: number): number[] {
  const n = pts.length / 2;
  if (n <= 2) return pts.slice();
  const out = [pts[0]!, pts[1]!];
  let lx = pts[0]!;
  let ly = pts[1]!;
  const d2 = minDist * minDist;
  for (let i = 1; i < n - 1; i++) {
    const x = pts[2 * i]!;
    const y = pts[2 * i + 1]!;
    if ((x - lx) * (x - lx) + (y - ly) * (y - ly) >= d2) {
      out.push(x, y);
      lx = x;
      ly = y;
    }
  }
  out.push(pts[2 * n - 2]!, pts[2 * n - 1]!);
  return out;
}

/** Length of a polyline. */
export function polylineLength(pts: readonly number[]): number {
  let len = 0;
  for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!);
  return len;
}

// ---------------------------------------------------------------------------------------------
// Borders along cell edges.

/**
 * Cell-edge borders between differently labelled cells. `label(cell)` returns the area label or `null` for cells
 * that take no part (sea, lakes): edges next to them are coastlines, not borders. Returns one chain list per label
 * pair, chained into polylines through grid vertices ((W+1) × (H+1) lattice) and smoothed.
 */
export function extractBorders(width: number, height: number, label: (cell: number) => number | null, smooth = 2): { a: number; b: number; points: number[] }[] {
  // Collect edges per pair: vertex ids are vy * (W + 1) + vx.
  const VW = width + 1;
  const pairEdges = new Map<string, { a: number; b: number; edges: number[] }>();
  const addEdge = (la: number, lb: number, v0: number, v1: number) => {
    const a = Math.min(la, lb);
    const b = Math.max(la, lb);
    const key = `${a}|${b}`;
    let rec = pairEdges.get(key);
    if (!rec) {
      rec = { a, b, edges: [] };
      pairEdges.set(key, rec);
    }
    rec.edges.push(v0, v1);
  };
  const labels = new Int32Array(width * height);
  const NONE = -2147483648;
  for (let c = 0; c < width * height; c++) {
    const l = label(c);
    labels[c] = l === null ? NONE : l;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = y * width + x;
      const l = labels[c]!;
      if (l === NONE) continue;
      if (x + 1 < width) {
        const r = labels[c + 1]!;
        if (r !== NONE && r !== l) addEdge(l, r, y * VW + x + 1, (y + 1) * VW + x + 1);
      }
      if (y + 1 < height) {
        const d = labels[c + width]!;
        if (d !== NONE && d !== l) addEdge(l, d, (y + 1) * VW + x, (y + 1) * VW + x + 1);
      }
    }
  }
  const out: { a: number; b: number; points: number[] }[] = [];
  const keys = [...pairEdges.keys()].sort();
  for (const key of keys) {
    const rec = pairEdges.get(key)!;
    for (const chain of chainEdges(rec.edges)) {
      const pts: number[] = [];
      for (const v of chain.vertices) pts.push(v % VW, Math.floor(v / VW));
      out.push({ a: rec.a, b: rec.b, points: smooth > 0 ? smoothPolyline(pts, smooth, chain.closed) : pts });
    }
  }
  return out;
}

/** Chains undirected edges (flat vertex pairs) into maximal paths and cycles. */
export function chainEdges(edges: readonly number[]): { vertices: number[]; closed: boolean }[] {
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    const l = adj.get(a);
    if (l) l.push(b);
    else adj.set(a, [b]);
  };
  for (let i = 0; i < edges.length; i += 2) {
    link(edges[i]!, edges[i + 1]!);
    link(edges[i + 1]!, edges[i]!);
  }
  const used = new Set<string>();
  const ek = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const chains: { vertices: number[]; closed: boolean }[] = [];
  const walk = (start: number, next: number): number[] => {
    const path = [start, next];
    used.add(ek(start, next));
    let cur = next;
    for (;;) {
      const nb = adj.get(cur) ?? [];
      if (nb.length !== 2) break;
      const cand = nb.find((v) => !used.has(ek(cur, v)));
      if (cand === undefined) break;
      used.add(ek(cur, cand));
      path.push(cand);
      cur = cand;
    }
    return path;
  };
  const verts = [...adj.keys()].sort((a, b) => a - b);
  // Open chains start at endpoints and junctions.
  for (const v of verts) {
    const nb = adj.get(v)!;
    if (nb.length === 2) continue;
    for (const n of nb) if (!used.has(ek(v, n))) chains.push({ vertices: walk(v, n), closed: false });
  }
  // What is left are cycles.
  for (const v of verts) {
    for (const n of adj.get(v)!) {
      if (used.has(ek(v, n))) continue;
      const path = walk(v, n);
      const closed = path.length > 2 && path[path.length - 1] === path[0];
      if (closed) path.pop();
      chains.push({ vertices: path, closed });
    }
  }
  return chains;
}

/** Province borders of the static world (land cells only; lakes and sea excluded), with region indices. */
export function provinceBorders(world: StaticWorld, smooth = 2): BorderChain[] {
  const { kind, provinceOf, regionOf } = world;
  const raw = extractBorders(
    world.width,
    world.height,
    (c) => (kind[c] === CELL_SEA || kind[c] === CELL_LAKE ? null : (provinceOf[c] as number)),
    smooth,
  );
  // Region of each side: any cell of that province (neutral land: −1).
  const regionOfProvince = world.provinces.map((p) => p.regionIndex);
  const neutralRegion = (() => {
    for (let c = 0; c < world.size; c++) if (kind[c] !== CELL_SEA && provinceOf[c] === -1) return regionOf[c] as number;
    return -1;
  })();
  return raw.map((r) => ({
    ...r,
    regionA: r.a >= 0 ? (regionOfProvince[r.a] ?? -1) : neutralRegion,
    regionB: r.b >= 0 ? (regionOfProvince[r.b] ?? -1) : neutralRegion,
  }));
}

// ---------------------------------------------------------------------------------------------
// Networks (rivers, roads) traced through cells.

/**
 * Traces 4-connected networks: `group(cell)` returns a group id (cells join only within a group) or −1. Returns cell
 * paths between endpoints/junctions, then cycles; isolated cells give single-cell paths.
 */
export function traceCellPaths(width: number, height: number, group: (cell: number) => number): { group: number; cells: number[] }[] {
  const size = width * height;
  const g = new Int32Array(size);
  for (let c = 0; c < size; c++) g[c] = group(c);
  const nbs = (c: number): number[] => {
    const id = g[c]!;
    const out: number[] = [];
    const x = c % width;
    if (x + 1 < width && g[c + 1] === id) out.push(c + 1);
    if (c + width < size && g[c + width] === id) out.push(c + width);
    if (x > 0 && g[c - 1] === id) out.push(c - 1);
    if (c >= width && g[c - width] === id) out.push(c - width);
    return out;
  };
  const used = new Set<number>();
  const ek = (a: number, b: number) => (a < b ? a * size + b : b * size + a);
  const paths: { group: number; cells: number[] }[] = [];
  const walk = (start: number, next: number): number[] => {
    const path = [start, next];
    used.add(ek(start, next));
    let cur = next;
    for (;;) {
      const nb = nbs(cur);
      if (nb.length !== 2) break;
      const cand = nb.find((v) => !used.has(ek(cur, v)));
      if (cand === undefined) break;
      used.add(ek(cur, cand));
      path.push(cand);
      cur = cand;
    }
    return path;
  };
  for (let c = 0; c < size; c++) {
    if (g[c]! < 0) continue;
    const nb = nbs(c);
    if (nb.length === 0) {
      paths.push({ group: g[c]!, cells: [c] });
      continue;
    }
    if (nb.length === 2) continue;
    for (const n of nb) if (!used.has(ek(c, n))) paths.push({ group: g[c]!, cells: walk(c, n) });
  }
  for (let c = 0; c < size; c++) {
    if (g[c]! < 0) continue;
    for (const n of nbs(c)) if (!used.has(ek(c, n))) paths.push({ group: g[c]!, cells: walk(c, n) });
  }
  return paths;
}

/** Rivers as smoothed polylines; ends that meet water or another river are extended to touch it. */
export function riverPaths(world: StaticWorld, smooth = 2): NetworkPath[] {
  const { river, riverOf, kind, width, size } = world;
  // Group = river index × 3 + navigability so runs split where a river stops being navigable.
  const groupOf = (c: number) => (river[c] === RIVER_NONE || kind[c] !== CELL_LAND ? -1 : ((riverOf[c] as number) + 1) * 3 + (river[c] as number));
  const traced = traceCellPaths(world.width, world.height, groupOf);
  const out: NetworkPath[] = [];
  const centre = (c: number): [number, number] => [(c % width) + 0.5, Math.floor(c / width) + 0.5];
  // Where an end touches water or a different river cell, the touching point (edge midpoint or that cell's centre).
  const joinPoint = (end: number, prev: number | undefined, g: number): { p: [number, number]; water: boolean } | null => {
    const x = end % width;
    const cands = [x + 1 < width ? end + 1 : -1, end + width < size ? end + width : -1, x > 0 ? end - 1 : -1, end >= width ? end - width : -1];
    // Prefer water (mouths), then other river runs (confluences, navigability changes).
    for (const n of cands) {
      if (n < 0 || n === prev) continue;
      if (kind[n] === CELL_SEA || kind[n] === CELL_LAKE) {
        const [ax, ay] = centre(end);
        const [bx, by] = centre(n);
        return { p: [(ax + bx) / 2 + (bx - ax) * 0.25, (ay + by) / 2 + (by - ay) * 0.25], water: true };
      }
    }
    for (const n of cands) {
      if (n < 0 || n === prev) continue;
      const gn = groupOf(n);
      if (gn >= 0 && gn !== g) return { p: centre(n), water: false };
    }
    return null;
  };
  for (const t of traced) {
    const cells = t.cells;
    const pts: number[] = [];
    const startJoin = joinPoint(cells[0]!, cells[1], t.group);
    const endJoin = cells.length > 0 ? joinPoint(cells[cells.length - 1]!, cells[cells.length - 2], t.group) : null;
    if (startJoin) pts.push(startJoin.p[0], startJoin.p[1]);
    for (const c of cells) {
      const [x, y] = centre(c);
      pts.push(x, y);
    }
    if (endJoin) pts.push(endJoin.p[0], endJoin.p[1]);
    if (pts.length < 4) continue;
    const value = t.group % 3;
    out.push({
      id: Math.floor(t.group / 3) - 1,
      value: value === RIVER_NAVIGABLE ? RIVER_NAVIGABLE : 1,
      points: smooth > 0 ? smoothPolyline(pts, smooth) : pts,
      mouthAtStart: startJoin?.water ?? false,
      mouthAtEnd: endJoin?.water ?? false,
    });
  }
  return out;
}

/** Roads (tracks and imperial roads) as smoothed polylines. */
export function roadPaths(world: StaticWorld, smooth = 1): NetworkPath[] {
  const { road, kind, width } = world;
  const traced = traceCellPaths(world.width, world.height, (c) => (road[c] === ROAD_NONE || kind[c] !== CELL_LAND ? -1 : (road[c] as number)));
  const out: NetworkPath[] = [];
  for (const t of traced) {
    if (t.cells.length < 2) continue;
    const pts: number[] = [];
    for (const c of t.cells) pts.push((c % width) + 0.5, Math.floor(c / width) + 0.5);
    out.push({ id: -1, value: t.group === ROAD_IMPERIAL ? ROAD_IMPERIAL : 1, points: smooth > 0 ? smoothPolyline(pts, smooth) : pts, mouthAtStart: false, mouthAtEnd: false });
  }
  return out;
}

/**
 * Splits a polyline into dashes: `dash` drawn, `gap` skipped, measured along the line (same units as the points),
 * starting `phase` into the pattern. Returns flat polylines, one per dash.
 */
export function dashPolyline(pts: readonly number[], dash: number, gap: number, phase = 0): number[][] {
  const out: number[][] = [];
  if (pts.length < 4 || dash <= 0) return out;
  const period = dash + Math.max(0, gap);
  let t = ((phase % period) + period) % period; // position within the pattern
  let current: number[] | null = t < dash ? [pts[0]!, pts[1]!] : null;
  for (let i = 2; i < pts.length; i += 2) {
    let ax = pts[i - 2]!;
    let ay = pts[i - 1]!;
    const bx = pts[i]!;
    const by = pts[i + 1]!;
    let segLen = Math.hypot(bx - ax, by - ay);
    while (segLen > 1e-9) {
      const inDash = t < dash;
      const left = inDash ? dash - t : period - t;
      if (left >= segLen) {
        t += segLen;
        if (inDash) current!.push(bx, by);
        segLen = 0;
      } else {
        const k = left / segLen;
        const mx = ax + (bx - ax) * k;
        const my = ay + (by - ay) * k;
        if (inDash) {
          current!.push(mx, my);
          out.push(current!);
          current = null;
        } else {
          current = [mx, my];
        }
        t = (t + left) % period;
        ax = mx;
        ay = my;
        segLen -= left;
      }
    }
  }
  if (current && current.length >= 4) out.push(current);
  return out;
}
