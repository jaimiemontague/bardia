/**
 * Grid pathfinding for the tactical engine: A* (8-connected, no corner cutting) and Dijkstra
 * distance fields over a per-tile cost array (`Infinity` = blocked; a cost is the time to cross a
 * tile relative to open ground). All buffers are typed arrays reused between searches (a
 * generation stamp avoids clearing them), so a search on a 96×72 map costs well under a millisecond
 * and allocates nothing but the output path.
 */

const SQRT2 = 1.4142135623730951;
/** Neighbour offsets: 4 orthogonal then 4 diagonal. */
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

/** Outcome of a path search. */
export const PathStatus = {
  None: 0,
  Full: 1,
  /** The goal was unreachable; the path leads to the reachable tile nearest to it. */
  Partial: 2,
} as const;
export type PathStatus = (typeof PathStatus)[keyof typeof PathStatus];

/** A min-heap of tile indices keyed by float priorities (lazy deletion). */
class Heap {
  private idx: Int32Array;
  private key: Float64Array;
  size = 0;
  constructor(capacity: number) {
    this.idx = new Int32Array(capacity);
    this.key = new Float64Array(capacity);
  }
  clear(): void {
    this.size = 0;
  }
  push(i: number, k: number): void {
    if (this.size === this.idx.length) {
      const ni = new Int32Array(this.idx.length * 2);
      ni.set(this.idx);
      const nk = new Float64Array(this.key.length * 2);
      nk.set(this.key);
      this.idx = ni;
      this.key = nk;
    }
    let pos = this.size++;
    const idx = this.idx;
    const key = this.key;
    while (pos > 0) {
      const parent = (pos - 1) >> 1;
      if (key[parent]! <= k) break;
      idx[pos] = idx[parent]!;
      key[pos] = key[parent]!;
      pos = parent;
    }
    idx[pos] = i;
    key[pos] = k;
  }
  /** Key of the top element (call only when size > 0). */
  topKey(): number {
    return this.key[0]!;
  }
  pop(): number {
    const idx = this.idx;
    const key = this.key;
    const top = idx[0]!;
    const n = --this.size;
    if (n > 0) {
      const li = idx[n]!;
      const lk = key[n]!;
      let pos = 0;
      for (;;) {
        let child = 2 * pos + 1;
        if (child >= n) break;
        if (child + 1 < n && key[child + 1]! < key[child]!) child++;
        if (key[child]! >= lk) break;
        idx[pos] = idx[child]!;
        key[pos] = key[child]!;
        pos = child;
      }
      idx[pos] = li;
      key[pos] = lk;
    }
    return top;
  }
}

/** Reusable pathfinder bound to one grid size. */
export class PathGrid {
  readonly n: number;
  private readonly g: Float64Array;
  private readonly came: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private gen = 0;
  private readonly heap: Heap;
  /** Nodes expanded by the last search (diagnostics / perf tests). */
  lastExpanded = 0;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.n = w * h;
    this.g = new Float64Array(this.n);
    this.came = new Int32Array(this.n);
    this.seen = new Uint32Array(this.n);
    this.closed = new Uint32Array(this.n);
    this.heap = new Heap(Math.max(64, this.n));
  }

  private nextGen(): number {
    this.gen++;
    if (this.gen >= 0xffffffff) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    return this.gen;
  }

  /**
   * A* from `start` to `goal` over `cost` (per tile, Infinity = blocked; the start tile may be
   * blocked). Writes tile indices from the first step after `start` to the end into `out` (cleared
   * first). `minCost` is the cheapest tile cost on the map (keeps the heuristic admissible).
   */
  findPath(cost: Float32Array, start: number, goal: number, out: number[], minCost = 1, maxExpand = Infinity): PathStatus {
    out.length = 0;
    if (start === goal) return PathStatus.Full;
    const w = this.w;
    const h = this.h;
    const gen = this.nextGen();
    const g = this.g;
    const came = this.came;
    const seen = this.seen;
    const closed = this.closed;
    const heap = this.heap;
    heap.clear();
    const gx = goal % w;
    const gy = (goal - gx) / w;
    const heur = (i: number): number => {
      const x = i % w;
      const y = (i - x) / w;
      const dx = Math.abs(x - gx);
      const dy = Math.abs(y - gy);
      return minCost * (dx > dy ? dx - dy + SQRT2 * dy : dy - dx + SQRT2 * dx);
    };
    g[start] = 0;
    came[start] = -1;
    seen[start] = gen;
    heap.push(start, heur(start));
    let best = start;
    let bestH = heur(start);
    let expanded = 0;
    let found = false;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (cur === goal) {
        found = true;
        break;
      }
      if (++expanded > maxExpand) break;
      const hc = heur(cur);
      if (hc < bestH) {
        bestH = hc;
        best = cur;
      }
      const cx = cur % w;
      const cy = (cur - cx) / w;
      const cCost = cur === start && !Number.isFinite(cost[cur]!) ? 1 : cost[cur]!;
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k]!;
        const ny = cy + DY[k]!;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        const nc = cost[ni]!;
        if (!Number.isFinite(nc) || closed[ni] === gen) continue;
        let step = (cCost + nc) * 0.5;
        if (k >= 4) {
          // No corner cutting: both orthogonal neighbours must be open.
          if (!Number.isFinite(cost[cy * w + nx]!) || !Number.isFinite(cost[ny * w + cx]!)) continue;
          step *= SQRT2;
        }
        const ng = g[cur]! + step;
        if (seen[ni] !== gen || ng < g[ni]!) {
          seen[ni] = gen;
          g[ni] = ng;
          came[ni] = cur;
          heap.push(ni, ng + heur(ni));
        }
      }
    }
    this.lastExpanded = expanded;
    const end = found ? goal : best;
    if (end === start) return found ? PathStatus.Full : PathStatus.None;
    let c = end;
    while (c !== start && c !== -1) {
      out.push(c);
      c = came[c]!;
    }
    out.reverse();
    return found ? PathStatus.Full : PathStatus.Partial;
  }

  /**
   * Dijkstra distance field from `sources` over `cost` into `out` (Infinity where unreachable).
   * Diagonal moves follow the same no-corner-cutting rule as findPath.
   */
  field(cost: Float32Array, sources: readonly number[], out: Float32Array): void {
    const w = this.w;
    const h = this.h;
    out.fill(Infinity);
    const heap = this.heap;
    heap.clear();
    for (const s of sources) {
      if (!Number.isFinite(cost[s]!)) continue;
      out[s] = 0;
      heap.push(s, 0);
    }
    while (heap.size > 0) {
      const d = heap.topKey();
      const cur = heap.pop();
      if (d > out[cur]!) continue;
      const cx = cur % w;
      const cy = (cur - cx) / w;
      const cCost = cost[cur]!;
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k]!;
        const ny = cy + DY[k]!;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        const nc = cost[ni]!;
        if (!Number.isFinite(nc)) continue;
        let step = (cCost + nc) * 0.5;
        if (k >= 4) {
          if (!Number.isFinite(cost[cy * w + nx]!) || !Number.isFinite(cost[ny * w + cx]!)) continue;
          step *= SQRT2;
        }
        // Keys are rounded to float32 like the stored distances, so a popped entry compares equal
        // to its own field value (a float64 key would look "stale" against the rounded store).
        const nd = Math.fround(d + step);
        if (nd < out[ni]!) {
          out[ni] = nd;
          heap.push(ni, nd);
        }
      }
    }
  }
}

/**
 * Greedy string pulling: drops waypoints while the straight segment from the current anchor stays on
 * tiles that are walkable and no more expensive than the costliest tile of the skipped stretch (so a
 * path that deliberately avoids woods is not straightened through them). Returns a new array.
 */
export function smoothPath(cost: Float32Array, w: number, startTile: number, path: readonly number[]): number[] {
  if (path.length <= 2) return path.slice();
  const out: number[] = [];
  let anchor = startTile;
  let i = 0;
  while (i < path.length) {
    let far = i;
    let maxCost = Math.max(cost[anchor]!, cost[path[i]!]!);
    for (let j = i + 1; j < path.length; j++) {
      maxCost = Math.max(maxCost, cost[path[j]!]!);
      if (!lineClear(cost, w, anchor, path[j]!, maxCost)) break;
      far = j;
    }
    out.push(path[far]!);
    anchor = path[far]!;
    i = far + 1;
  }
  return out;
}

/** True when every tile sampled along the segment between two tile centres is finite and ≤ maxCost. */
export function lineClear(cost: Float32Array, w: number, a: number, b: number, maxCost: number): boolean {
  const ax = (a % w) + 0.5;
  const ay = Math.floor(a / w) + 0.5;
  const bx = (b % w) + 0.5;
  const by = Math.floor(b / w) + 0.5;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(len / 0.25);
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const x = Math.floor(ax + dx * t);
    const y = Math.floor(ay + dy * t);
    const c = cost[y * w + x]!;
    if (!Number.isFinite(c) || c > maxCost + 1e-6) return false;
    // Do not slip between two blocked diagonal tiles.
    const x2 = Math.floor(ax + dx * t + 0.3 * Math.sign(dx));
    const y2 = Math.floor(ay + dy * t + 0.3 * Math.sign(dy));
    if (x2 !== x && y2 !== y && !Number.isFinite(cost[y * w + x2]!) && !Number.isFinite(cost[y2 * w + x]!)) return false;
  }
  return true;
}
