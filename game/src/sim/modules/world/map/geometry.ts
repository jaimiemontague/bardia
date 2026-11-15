/**
 * Deterministic 2-D geometry for the map build: edge subdivision, fractal domain warp, even-odd scanline polygon
 * fill, 4-connected grid traversal of segments, and the exact Euclidean distance transform (Felzenszwalb &
 * Huttenlocher). Only +, −, ×, ÷, sqrt, floor and ceil are used, so results are bit-identical across engines.
 *
 * Points are stored flat: [x0, y0, x1, y1, …] in continuous cell coordinates.
 */
import type { NoiseSpec, Point } from '@content/world';
import { fbmSigned, hash2 } from './noise';

/** Result of subdividing a polyline: flat points and where each original vertex landed. */
export interface Subdivided {
  points: number[];
  /** vertexAt[i] = index (in points, as a point index) of original vertex i. */
  vertexAt: number[];
}

/**
 * Splits every edge longer than `maxSeg` into equal parts. For a closed ring the closing edge is subdivided too
 * (the first vertex is not repeated at the end).
 */
export function subdivide(points: readonly Point[], closed: boolean, maxSeg: number): Subdivided {
  const out: number[] = [];
  const vertexAt: number[] = [];
  const n = points.length;
  const edges = closed ? n : n - 1;
  for (let i = 0; i < n; i++) {
    const p = points[i] as Point;
    vertexAt.push(out.length / 2);
    out.push(p[0], p[1]);
    if (i >= edges) break;
    const q = points[(i + 1) % n] as Point;
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    const parts = Math.ceil(len / maxSeg);
    for (let k = 1; k < parts; k++) {
      const t = k / parts;
      out.push(p[0] + dx * t, p[1] + dy * t);
    }
  }
  return { points: out, vertexAt };
}

/**
 * Domain warp in place: every point moves by `spec.amplitude` × a 2-D fBm vector field evaluated at its original
 * position, so coincident points move identically (shared vertices stay shared).
 */
export function warpPoints(flat: number[], seedX: number, seedY: number, spec: NoiseSpec): void {
  if (spec.amplitude === 0) return;
  for (let i = 0; i < flat.length; i += 2) {
    const x = flat[i] as number;
    const y = flat[i + 1] as number;
    flat[i] = x + spec.amplitude * fbmSigned(x, y, seedX, spec);
    flat[i + 1] = y + spec.amplitude * fbmSigned(x, y, seedY, spec);
  }
}

const INV_U32 = 1 / 4294967296;

/** Hash of a point quantised to 1/1024 cell (stable under float noise below that). */
function pointKey(x: number, y: number, seed: number): number {
  return hash2(Math.round(x * 1024), Math.round(y * 1024), seed);
}

/**
 * Recursive midpoint displacement ("fractal coast"): every edge longer than `minSeg` gets its midpoint pushed
 * along the edge normal by up to ±`roughness` × its length, then both halves recurse. The push depends only on
 * the two endpoints (order-independent), so an edge shared by two polygons, or a river and its tributary, is
 * displaced identically and stays shared. Endpoints never move. The length scale is capped at `maxLen`, so a very
 * long straight edge (a region polygon crossing open sea) wiggles locally instead of bulging by a fraction of
 * its whole length. `displaceEdge` (optional) selects which input edges get detail at all. Returns flat points (closed rings do not repeat
 * the first point). `vertexAt` maps original vertices to output point indices.
 */
export function fractalize(
  points: readonly Point[],
  closed: boolean,
  roughness: number,
  minSeg: number,
  seed: number,
  maxLen = 24,
  displaceEdge?: (ax: number, ay: number, bx: number, by: number) => boolean,
): Subdivided {
  const out: number[] = [];
  const vertexAt: number[] = [];
  const n = points.length;
  const edges = closed ? n : n - 1;
  const emit = (ax: number, ay: number, bx: number, by: number, depth: number): void => {
    // Emits the interior points of edge a→b (not a, not b).
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len <= minSeg || depth > 12) return;
    const ka = pointKey(ax, ay, seed);
    const kb = pointKey(bx, by, seed);
    const lo = ka < kb ? ka : kb;
    const hi = ka < kb ? kb : ka;
    const r = hash2(lo, hi, seed ^ 0x2545f491) * INV_U32 * 2 - 1;
    // Normal from the canonical (lower-key first) direction, so a→b and b→a push the same way.
    const sx = ka <= kb ? dx : -dx;
    const sy = ka <= kb ? dy : -dy;
    const amp = r * roughness * Math.min(len, maxLen);
    const mx = (ax + bx) / 2 + (-sy / len) * amp;
    const my = (ay + by) / 2 + (sx / len) * amp;
    emit(ax, ay, mx, my, depth + 1);
    out.push(mx, my);
    emit(mx, my, bx, by, depth + 1);
  };
  for (let i = 0; i < n; i++) {
    const p = points[i] as Point;
    vertexAt.push(out.length / 2);
    out.push(p[0], p[1]);
    if (i >= edges) break;
    const q = points[(i + 1) % n] as Point;
    if (roughness > 0 && (displaceEdge === undefined || displaceEdge(p[0], p[1], q[0], q[1]))) emit(p[0], p[1], q[0], q[1], 0);
  }
  return { points: out, vertexAt };
}

/** Splits every edge of flat points longer than `maxSeg` (closed: includes the closing edge). */
export function subdivideFlat(flat: readonly number[], closed: boolean, maxSeg: number): number[] {
  const pts: Point[] = [];
  for (let i = 0; i < flat.length; i += 2) pts.push([flat[i] as number, flat[i + 1] as number]);
  return subdivide(pts, closed, maxSeg).points;
}

/** Bounding box of flat points. */
export function flatBounds(flat: readonly number[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < flat.length; i += 2) {
    const x = flat[i] as number;
    const y = flat[i + 1] as number;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function sortAscending(a: Float64Array, n: number): void {
  // Insertion sort: scanline intersection lists are short.
  for (let i = 1; i < n; i++) {
    const v = a[i] as number;
    let j = i - 1;
    while (j >= 0 && (a[j] as number) > v) {
      a[j + 1] = a[j] as number;
      j--;
    }
    a[j + 1] = v;
  }
}

/**
 * Even-odd scanline fill of a closed ring (flat points). Calls `span(y, x0, x1)` for every run of cells
 * x0 ≤ x < x1 in row y whose centres lie inside, clipped to the grid. Self-intersections and nested rings
 * (concatenated) follow the even-odd rule.
 */
export function fillPolygon(flat: readonly number[], width: number, height: number, span: (y: number, x0: number, x1: number) => void): void {
  const n = flat.length / 2;
  if (n < 3) return;
  const b = flatBounds(flat);
  const rowLo = Math.max(0, Math.ceil(b.minY - 0.5));
  const rowHi = Math.min(height - 1, Math.ceil(b.maxY - 0.5) - 1);
  if (rowHi < rowLo) return;
  const rows = rowHi - rowLo + 1;
  // Bucket edges by the rows they cross (counting sort).
  const counts = new Int32Array(rows + 1);
  const edgeLo = new Int32Array(n);
  const edgeHi = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const y1 = flat[i * 2 + 1] as number;
    const y2 = flat[j * 2 + 1] as number;
    if (y1 === y2) {
      edgeLo[i] = 1;
      edgeHi[i] = 0;
      continue;
    }
    const lo = Math.max(rowLo, Math.ceil(Math.min(y1, y2) - 0.5));
    const hi = Math.min(rowHi, Math.ceil(Math.max(y1, y2) - 0.5) - 1);
    edgeLo[i] = lo;
    edgeHi[i] = hi;
    for (let r = lo; r <= hi; r++) counts[r - rowLo + 1] = (counts[r - rowLo + 1] as number) + 1;
  }
  for (let r = 1; r <= rows; r++) counts[r] = (counts[r] as number) + (counts[r - 1] as number);
  const total = counts[rows] as number;
  const bucket = new Int32Array(total);
  const fillPos = counts.slice(0, rows);
  for (let i = 0; i < n; i++) {
    for (let r = edgeLo[i] as number; r <= (edgeHi[i] as number); r++) {
      const k = r - rowLo;
      bucket[fillPos[k] as number] = i;
      fillPos[k] = (fillPos[k] as number) + 1;
    }
  }
  let xs = new Float64Array(64);
  for (let r = 0; r < rows; r++) {
    const start = counts[r] as number;
    const end = counts[r + 1] as number;
    const m = end - start;
    if (m < 2) continue;
    if (xs.length < m) xs = new Float64Array(m * 2);
    const yc = rowLo + r + 0.5;
    for (let k = 0; k < m; k++) {
      const i = bucket[start + k] as number;
      const j = i + 1 === n ? 0 : i + 1;
      const x1 = flat[i * 2] as number;
      const y1 = flat[i * 2 + 1] as number;
      const x2 = flat[j * 2] as number;
      const y2 = flat[j * 2 + 1] as number;
      xs[k] = x1 + ((yc - y1) * (x2 - x1)) / (y2 - y1);
    }
    sortAscending(xs, m);
    for (let k = 0; k + 1 < m; k += 2) {
      const x0 = Math.max(0, Math.ceil((xs[k] as number) - 0.5));
      const x1 = Math.min(width, Math.ceil((xs[k + 1] as number) - 0.5));
      if (x1 > x0) span(rowLo + r, x0, x1);
    }
  }
}

/**
 * Visits every grid cell a segment passes through, in order, each consecutive pair sharing an edge (4-connected;
 * Amanatides–Woo traversal; an exact corner crossing steps x first). Cells outside the grid are skipped.
 */
export function traceSegment(x0: number, y0: number, x1: number, y1: number, width: number, height: number, visit: (x: number, y: number) => void): void {
  let cx = Math.floor(x0);
  let cy = Math.floor(y0);
  const ex = Math.floor(x1);
  const ey = Math.floor(y1);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = stepX > 0 ? (cx + 1 - x0) * tDeltaX : stepX < 0 ? (x0 - cx) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (cy + 1 - y0) * tDeltaY : stepY < 0 ? (y0 - cy) * tDeltaY : Infinity;
  const guard = Math.abs(ex - cx) + Math.abs(ey - cy) + 2;
  for (let n = 0; n <= guard; n++) {
    if (cx >= 0 && cy >= 0 && cx < width && cy < height) visit(cx, cy);
    if (cx === ex && cy === ey) break;
    if (tMaxX <= tMaxY) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      cy += stepY;
      tMaxY += tDeltaY;
    }
  }
}

/** Traces a flat polyline segment by segment; `visit` receives (x, y, pointIndexOfSegmentStart). Repeated cells at joints are reported once. */
export function tracePolyline(flat: readonly number[], width: number, height: number, visit: (x: number, y: number, segment: number) => void): void {
  let lastX = -1;
  let lastY = -1;
  for (let i = 0; i + 3 < flat.length; i += 2) {
    const seg = i / 2;
    traceSegment(flat[i] as number, flat[i + 1] as number, flat[i + 2] as number, flat[i + 3] as number, width, height, (x, y) => {
      if (x === lastX && y === lastY) return;
      lastX = x;
      lastY = y;
      visit(x, y, seg);
    });
  }
}

/** True if (x, y) is inside the closed ring (even-odd rule). */
export function pointInPolygon(x: number, y: number, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as Point;
    const b = ring[j] as Point;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

const EDT_INF = 1e20;

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -EDT_INF;
  z[1] = EDT_INF;
  for (let q = 1; q < n; q++) {
    const fq = (f[q] as number) + q * q;
    let s = (fq - ((f[v[k] as number] as number) + (v[k] as number) * (v[k] as number))) / (2 * q - 2 * (v[k] as number));
    while (s <= (z[k] as number)) {
      k--;
      s = (fq - ((f[v[k] as number] as number) + (v[k] as number) * (v[k] as number))) / (2 * q - 2 * (v[k] as number));
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = EDT_INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while ((z[k + 1] as number) < q) k++;
    const dq = q - (v[k] as number);
    d[q] = dq * dq + (f[v[k] as number] as number);
  }
}

/**
 * Exact Euclidean distance (in cells, between cell centres) from every cell to the nearest cell where
 * `isFeature(i)` is true. Cells with no feature anywhere get a large value (≥ 1e9).
 */
export function distanceTransform(width: number, height: number, isFeature: (i: number) => boolean): Float32Array {
  const size = width * height;
  const grid = new Float64Array(size);
  for (let i = 0; i < size; i++) grid[i] = isFeature(i) ? 0 : EDT_INF;
  const maxN = Math.max(width, height);
  const f = new Float64Array(maxN);
  const d = new Float64Array(maxN);
  const v = new Int32Array(maxN);
  const z = new Float64Array(maxN + 1);
  // Columns.
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x] as number;
    edt1d(f, height, d, v, z);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y] as number;
  }
  // Rows.
  const out = new Float32Array(size);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) f[x] = grid[row + x] as number;
    edt1d(f, width, d, v, z);
    for (let x = 0; x < width; x++) {
      const sq = d[x] as number;
      out[row + x] = sq >= EDT_INF / 2 ? 1e9 : Math.sqrt(sq);
    }
  }
  return out;
}
