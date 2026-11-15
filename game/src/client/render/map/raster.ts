/**
 * Pixel rasters of the procedural sea-chart (pure; no DOM): the painted base (parchment lands with hill shading,
 * a painted sea deepening away from the coast with inked water-lines, lakes), the map-mode tint (province washes
 * that follow the smooth coastline and strengthen along realm borders) and the knowledge fog (blank parchment over
 * the unknown, a faint veil over charted-but-unvisited lands).
 *
 * Smooth coastlines at any resolution come from bilinear interpolation of a signed distance field built from the
 * static world's exact coast distances (zero contour = the cell boundary between land and sea). Rasters are written
 * row ranges at a time so the client can bake a large chart across several frames.
 */
import { CELL_LAKE, CELL_SEA, TERRAIN_FOREST, TERRAIN_HILLS, TERRAIN_MARSH, TERRAIN_MOUNTAIN, TERRAIN_NONE, type StaticWorld } from '@sim/modules/world/map/index';
import type { Climate } from '@content/world';
import { CHART, rgbOf } from './colors';
import { KNOW_CHARTED, KNOW_UNKNOWN, type ProvinceFill } from './types';

// ---------------------------------------------------------------------------------------------
// Deterministic noise (render only; no game state depends on it).

/** 32-bit integer hash of two ints and a seed → [0, 1). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [−1, 1] with lattice spacing `cell` (in the same units as x, y). */
export function valueNoise(x: number, y: number, cell: number, seed = 0): number {
  const u = x / cell;
  const v = y / cell;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fx = u - i;
  const fy = v - j;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(i, j, seed);
  const b = hash2(i + 1, j, seed);
  const c = hash2(i, j + 1, seed);
  const d = hash2(i + 1, j + 1, seed);
  return (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * 2 - 1;
}

/** Two-octave value noise in [−1, 1]. */
export function fbm(x: number, y: number, cell: number, seed = 0): number {
  return valueNoise(x, y, cell, seed) * 0.66 + valueNoise(x, y, cell / 2.7, seed + 17) * 0.34;
}

// ---------------------------------------------------------------------------------------------
// Terrain colours (watercolour washes over parchment) per render climate.

type TerrainTable = readonly [plain: number, forest: number, hills: number, mountain: number, marsh: number];

/** Land tints per climate and terrain class (TERRAIN_* order). */
export const TERRAIN_TINTS: Readonly<Record<Climate, TerrainTable>> = {
  temperate: [0xe3d3a3, 0xb3b884, 0xd8c08c, 0xc6b393, 0xbfbd93],
  oceanic: [0xdcd6a3, 0xa9b583, 0xd2c290, 0xc0b397, 0xb8bc96],
  boreal: [0xdcd3a7, 0x9fae80, 0xd0c299, 0xc3b8a2, 0xb6b896],
  polar: [0xecebe2, 0xc9d0c1, 0xe2e1d6, 0xf3f2ec, 0xd8dccf],
  steppe: [0xe9d59e, 0xbcb985, 0xdcc48d, 0xcab796, 0xc9c196],
  warm: [0xebd298, 0xbcb47e, 0xdfc38a, 0xcdb48f, 0xc8bf8f],
  volcanic: [0xd9d0b2, 0xb3b691, 0xc8bb9d, 0xa79d8f, 0xbdbca0],
};

/** The chart's per-cell fields (built once per static world, ~0.1 s on the full map). */
export interface ChartFields {
  width: number;
  height: number;
  /** Signed distance to the coast in cells: positive on land and lakes, negative at sea; zero on the cell edge. */
  sdf: Float32Array;
  /** Signed distance to lake shores in cells: positive inside lakes, negative elsewhere (smooth lake outlines). */
  lake: Float32Array;
  /** Land colour per cell, RGB triples (0–255), with hill shading; water cells hold their neighbours' colour. */
  land: Float32Array;
  /** Low-frequency variation of the sea (−1…1) for painterly depth. */
  seaTone: Float32Array;
}

/**
 * Chamfer distance (cells, ≈ Euclidean) from every cell to the nearest cell where `mask` is set (0 on those cells).
 */
export function distanceToMask(mask: Uint8Array, W: number, H: number): Float32Array {
  const dist = new Float32Array(W * H);
  for (let c = 0; c < dist.length; c++) dist[c] = mask[c] ? 0 : Infinity;
  const D = Math.SQRT2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = y * W + x;
      let v = dist[c]!;
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, dist[c - 1]! + 1);
      if (y > 0) {
        v = Math.min(v, dist[c - W]! + 1);
        if (x > 0) v = Math.min(v, dist[c - W - 1]! + D);
        if (x + 1 < W) v = Math.min(v, dist[c - W + 1]! + D);
      }
      dist[c] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const c = y * W + x;
      let v = dist[c]!;
      if (v === 0) continue;
      if (x + 1 < W) v = Math.min(v, dist[c + 1]! + 1);
      if (y + 1 < H) {
        v = Math.min(v, dist[c + W]! + 1);
        if (x + 1 < W) v = Math.min(v, dist[c + W + 1]! + D);
        if (x > 0) v = Math.min(v, dist[c + W - 1]! + D);
      }
      dist[c] = v;
    }
  }
  return dist;
}

/** Builds the chart fields from the static world. */
export function buildChartFields(world: StaticWorld): ChartFields {
  const { width: W, height: H, size, kind, terrain, elevation, coastDist, regionOf } = world;
  const sdf = new Float32Array(size);
  const seaTone = new Float32Array(size);
  const climates: Climate[] = world.geo.regions.map((r) => r.climate);
  const defaultTable = TERRAIN_TINTS.temperate;

  // Coast and lake distance fields.
  const lakeMask = new Uint8Array(size);
  const notLake = new Uint8Array(size);
  for (let c = 0; c < size; c++) {
    const k = kind[c]!;
    const d = coastDist[c]!;
    sdf[c] = k === CELL_SEA ? -(d - 0.5) : d - 0.5;
    if (k === CELL_LAKE) lakeMask[c] = 1;
    else notLake[c] = 1;
  }
  const toLake = distanceToMask(lakeMask, W, H);
  const toShore = distanceToMask(notLake, W, H);
  const lake = new Float32Array(size);
  for (let c = 0; c < size; c++) lake[c] = lakeMask[c] ? toShore[c]! - 0.5 : -(Math.min(toLake[c]!, 64) - 0.5);

  // Terrain tints (blurred below into soft watercolour transitions).
  const tr = new Float32Array(size);
  const tg = new Float32Array(size);
  const tb = new Float32Array(size);
  const has = new Uint8Array(size);
  for (let c = 0; c < size; c++) {
    const k = kind[c]!;
    if (k === CELL_SEA) continue;
    const t = terrain[c]!;
    const r = regionOf[c]!;
    const table = (r >= 0 ? TERRAIN_TINTS[climates[r] ?? 'temperate'] : defaultTable) ?? defaultTable;
    const base = k === CELL_LAKE || t === TERRAIN_NONE ? table[0] : (table[t] ?? table[0]);
    const [br, bg, bb] = rgbOf(base);
    tr[c] = br;
    tg[c] = bg;
    tb[c] = bb;
    has[c] = 1;
  }
  // Water cells take their land neighbours' tint so sampling at the coast never bleeds blue or black.
  const [pr, pg, pb] = rgbOf(TERRAIN_TINTS.temperate[0]);
  for (let pass = 0; pass < 2; pass++) {
    const filled: number[] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = y * W + x;
        if (has[c]) continue;
        let n = 0;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if ((dx === 0 && dy === 0) || xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            const cc = yy * W + xx;
            if (has[cc]) {
              sr += tr[cc]!;
              sg += tg[cc]!;
              sb += tb[cc]!;
              n++;
            }
          }
        }
        if (n > 0) {
          tr[c] = sr / n;
          tg[c] = sg / n;
          tb[c] = sb / n;
          filled.push(c);
        }
      }
    }
    for (const c of filled) has[c] = 1;
  }
  for (let c = 0; c < size; c++) {
    if (has[c]) continue;
    tr[c] = pr;
    tg[c] = pg;
    tb[c] = pb;
  }
  const br2 = boxBlur(tr, W, H, 1, 1);
  const bg2 = boxBlur(tg, W, H, 1, 1);
  const bb2 = boxBlur(tb, W, H, 1, 1);

  // Hill shading (unblurred), mottling and snow.
  const land = new Float32Array(size * 3);
  const LX = -0.62;
  const LY = -0.62;
  const LZ = 0.48;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = y * W + x;
      const k = kind[c]!;
      if (k === CELL_SEA) {
        seaTone[c] = fbm(x, y, 38, 11) * 0.8 + fbm(x, y, 9, 23) * 0.2;
        land[c * 3] = br2[c]!;
        land[c * 3 + 1] = bg2[c]!;
        land[c * 3 + 2] = bb2[c]!;
        continue;
      }
      const t = terrain[c]!;
      const e = elevation[c]! / 255;
      const eAt = (xx: number, yy: number) => {
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) return e;
        const cc = yy * W + xx;
        return kind[cc] === CELL_SEA ? Math.max(0, e - 0.04) : elevation[cc]! / 255;
      };
      const gx = (eAt(x + 1, y) - eAt(x - 1, y)) * 0.5;
      const gy = (eAt(x, y + 1) - eAt(x, y - 1)) * 0.5;
      const relief = t === TERRAIN_MOUNTAIN ? 5 : t === TERRAIN_HILLS ? 5 : 4;
      const nx = -gx * relief;
      const ny = -gy * relief;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const lambert = (nx * LX + ny * LY + LZ) * inv;
      const shade = Math.max(0.84, Math.min(1.1, 1 + (lambert - LZ) * 0.7));
      const mott = 1 + fbm(x, y, 22, 5) * 0.03 + fbm(x, y, 6, 9) * 0.018;
      const lift = 1 + (e - 0.35) * 0.05;
      const f = shade * mott * lift;
      let rr = br2[c]! * f;
      let gg = bg2[c]! * f;
      let b2 = bb2[c]! * f;
      const r = regionOf[c]!;
      const climate = r >= 0 ? climates[r] : undefined;
      if (t === TERRAIN_MOUNTAIN && (climate === 'polar' || climate === 'boreal' || climate === 'volcanic') && e > 0.7) {
        const s = Math.min(1, (e - 0.7) / 0.2) * 0.45;
        rr = rr * (1 - s) + 244 * shade * s;
        gg = gg * (1 - s) + 244 * shade * s;
        b2 = b2 * (1 - s) + 240 * shade * s;
      }
      land[c * 3] = rr;
      land[c * 3 + 1] = gg;
      land[c * 3 + 2] = b2;
    }
  }
  return { width: W, height: H, sdf, lake, land, seaTone };
}

// ---------------------------------------------------------------------------------------------
// Sampling helpers.

/** Column sampling plan for one output resolution: cell indices and weights per output pixel column. */
interface Plan {
  i0: Int32Array;
  i1: Int32Array;
  fx: Float32Array;
}

function columnPlan(W: number, P: number, outW: number): Plan {
  const i0 = new Int32Array(outW);
  const i1 = new Int32Array(outW);
  const fx = new Float32Array(outW);
  for (let px = 0; px < outW; px++) {
    const u = (px + 0.5) / P - 0.5;
    const i = Math.floor(u);
    fx[px] = u - i;
    i0[px] = Math.max(0, Math.min(W - 1, i));
    i1[px] = Math.max(0, Math.min(W - 1, i + 1));
  }
  return { i0, i1, fx };
}

function rowOf(H: number, P: number, py: number): { j0: number; j1: number; fy: number } {
  const v = (py + 0.5) / P - 0.5;
  const j = Math.floor(v);
  return { j0: Math.max(0, Math.min(H - 1, j)), j1: Math.max(0, Math.min(H - 1, j + 1)), fy: v - j };
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------------------------
// The painted base.

const SEA_STOPS: readonly (readonly [depth: number, color: number])[] = [
  [0, CHART.seaShore],
  [1.6, CHART.seaShallow],
  [5.5, CHART.seaMid],
  [14, CHART.seaDeep],
  [34, CHART.seaAbyss],
];
const SEA_RGB = SEA_STOPS.map(([d, c]) => [d, ...rgbOf(c)] as const);

/** Depths (cells offshore) of the inked water-lines and their strengths. */
export const WATER_LINES: readonly (readonly [depth: number, alpha: number])[] = [
  [0.62, 0.42],
  [1.35, 0.3],
  [2.3, 0.19],
  [3.6, 0.1],
];

/**
 * Rasterises output rows [y0, y1) of the base chart at `P` pixels per cell into `out` (RGBA, width W×P). Coast and
 * water-line widths are given in output pixels, so the look holds at any P.
 */
export function rasterizeChartRows(f: ChartFields, P: number, out: Uint8ClampedArray, y0: number, y1: number, plan?: Plan): void {
  const W = f.width;
  const H = f.height;
  const outW = W * P;
  const p = plan ?? columnPlan(W, P, outW);
  const { sdf, lake, land, seaTone } = f;
  const [ir, ig, ib] = rgbOf(CHART.ink);
  const [sir, sig, sib] = rgbOf(CHART.seaInk);
  const [lr, lg, lb] = rgbOf(CHART.lake);
  const [lir, lig, lib] = rgbOf(CHART.lakeInk);
  const px1 = 1 / P; // one output pixel in cells
  const inkLand = 0.95 * px1 + 0.02;
  const inkSea = 0.2 * px1;
  const lakeInk = 0.45 * px1;
  const lineHalf = 0.5 * px1;
  for (let py = y0; py < y1; py++) {
    const { j0, j1, fy } = rowOf(H, P, py);
    const r0 = j0 * W;
    const r1 = j1 * W;
    let o = py * outW * 4;
    for (let px = 0; px < outW; px++, o += 4) {
      const i0 = p.i0[px]!;
      const i1 = p.i1[px]!;
      const fx = p.fx[px]!;
      const c00 = r0 + i0;
      const c10 = r0 + i1;
      const c01 = r1 + i0;
      const c11 = r1 + i1;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const s = sdf[c00]! * w00 + sdf[c10]! * w10 + sdf[c01]! * w01 + sdf[c11]! * w11;
      const grain = (hash2(px, py, 3) - 0.5) * 0.05;
      let r: number;
      let g: number;
      let b: number;
      if (s < 0) {
        // Painted sea.
        const tone = seaTone[c00]! * w00 + seaTone[c10]! * w10 + seaTone[c01]! * w01 + seaTone[c11]! * w11;
        const d = -s;
        const dd = d * (1 + tone * 0.22);
        let k = 0;
        while (k < SEA_RGB.length - 2 && dd > SEA_RGB[k + 1]![0]) k++;
        const a = SEA_RGB[k]!;
        const z = SEA_RGB[k + 1]!;
        const t = Math.max(0, Math.min(1, (dd - a[0]) / (z[0] - a[0])));
        r = a[1] + (z[1] - a[1]) * t;
        g = a[2] + (z[2] - a[2]) * t;
        b = a[3] + (z[3] - a[3]) * t;
        // Brush texture: faint horizontal strokes in open water.
        const stroke = valueNoise(px * 0.9, py * 3.2, 9, 41) * 0.035 * smoothstep(1.2, 5, d);
        const m = 1 + grain * 0.6 + stroke;
        r *= m;
        g *= m;
        b *= m;
        // Inked water-lines following the coast.
        for (const [ld, la] of WATER_LINES) {
          const dist = Math.abs(d - ld);
          if (dist < lineHalf + px1) {
            const cov = Math.max(0, Math.min(1, (lineHalf + px1 - dist) * P)) * la;
            r += (sir - r) * cov;
            g += (sig - g) * cov;
            b += (sib - b) * cov;
          }
        }
        // The coastline ink, half of it on the sea side.
        if (d < inkSea + px1) {
          const cov = Math.max(0, Math.min(1, (inkSea + px1 - d) * P)) * 0.9;
          r += (ir - r) * cov;
          g += (ig - g) * cov;
          b += (ib - b) * cov;
        }
      } else {
        r = land[c00 * 3]! * w00 + land[c10 * 3]! * w10 + land[c01 * 3]! * w01 + land[c11 * 3]! * w11;
        g = land[c00 * 3 + 1]! * w00 + land[c10 * 3 + 1]! * w10 + land[c01 * 3 + 1]! * w01 + land[c11 * 3 + 1]! * w11;
        b = land[c00 * 3 + 2]! * w00 + land[c10 * 3 + 2]! * w10 + land[c01 * 3 + 2]! * w01 + land[c11 * 3 + 2]! * w11;
        // Pigment pools along the shore (the darker rim of a watercolour wash).
        const rim = 1 - 0.09 * (1 - smoothstep(0.05, 1.3, s));
        const m = (1 + grain) * rim;
        r *= m;
        g *= m;
        b *= m;
        // Lakes: the zero contour of the lake distance field, inked like the coast.
        const lk = lake[c00]! * w00 + lake[c10]! * w10 + lake[c01]! * w01 + lake[c11]! * w11;
        if (lk > -lakeInk - px1) {
          const depth = smoothstep(0, 2.5, lk);
          const inside = Math.max(0, Math.min(1, lk * P + 0.5));
          const lm = 1 + grain * 0.6;
          r += (lr * (1 - depth * 0.12) * lm - r) * inside;
          g += (lg * (1 - depth * 0.1) * lm - g) * inside;
          b += (lb * (1 - depth * 0.06) * lm - b) * inside;
          const edge = Math.max(0, Math.min(1, (lakeInk + px1 - Math.abs(lk)) * P)) * 0.8;
          r += (lir - r) * edge;
          g += (lig - g) * edge;
          b += (lib - b) * edge;
        }
        if (s < inkLand + px1) {
          const cov = Math.max(0, Math.min(1, (inkLand + px1 - s) * P)) * 0.9;
          r += (ir - r) * cov;
          g += (ig - g) * cov;
          b += (ib - b) * cov;
        }
      }
      // Age stains across the whole sheet.
      const stain = 1 + valueNoise(px, py, 65 * P, 77) * 0.025;
      out[o] = r * stain;
      out[o + 1] = g * stain;
      out[o + 2] = b * stain;
      out[o + 3] = 255;
    }
  }
}

/** Rasterises the whole base chart (tests, tools); the client bakes it in row chunks with `rasterizeChartRows`. */
export function rasterizeChart(f: ChartFields, P: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(f.width * P * f.height * P * 4);
  rasterizeChartRows(f, P, out, 0, f.height * P, columnPlan(f.width, P, f.width * P));
  return out;
}

/** A reusable column plan (the client passes it to every chunk). */
export function chartColumnPlan(f: ChartFields, P: number): Plan {
  return columnPlan(f.width, P, f.width * P);
}

// ---------------------------------------------------------------------------------------------
// Map-mode tint.

/**
 * Distance (cells, chamfer approximation) from each land cell to the nearest land cell of a different owner; ∞
 * where no realm border exists on that land component. `owner` gives an owner id per province index (−1 = none).
 */
export function ownerBorderDistance(world: StaticWorld, owner: Int32Array): Float32Array {
  const { width: W, height: H, size, kind, provinceOf } = world;
  const dist = new Float32Array(size).fill(Infinity);
  const ownerAt = (c: number) => {
    if (kind[c] === CELL_SEA || kind[c] === CELL_LAKE) return -2;
    const p = provinceOf[c]!;
    return p >= 0 ? (owner[p] ?? -1) : -1;
  };
  const own = new Int32Array(size);
  for (let c = 0; c < size; c++) own[c] = ownerAt(c);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = y * W + x;
      const o = own[c]!;
      if (o === -2) continue;
      if ((x + 1 < W && own[c + 1]! !== o && own[c + 1]! !== -2) || (x > 0 && own[c - 1]! !== o && own[c - 1]! !== -2) || (y + 1 < H && own[c + W]! !== o && own[c + W]! !== -2) || (y > 0 && own[c - W]! !== o && own[c - W]! !== -2)) dist[c] = 0.5;
    }
  }
  const D = Math.SQRT2;
  const relax = (c: number, n: number, w: number) => {
    const v = dist[n]! + w;
    if (v < dist[c]!) dist[c] = v;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = y * W + x;
      if (own[c] === -2) continue;
      if (x > 0) relax(c, c - 1, 1);
      if (y > 0) {
        relax(c, c - W, 1);
        if (x > 0) relax(c, c - W - 1, D);
        if (x + 1 < W) relax(c, c - W + 1, D);
      }
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const c = y * W + x;
      if (own[c] === -2) continue;
      if (x + 1 < W) relax(c, c + 1, 1);
      if (y + 1 < H) {
        relax(c, c + W, 1);
        if (x + 1 < W) relax(c, c + W + 1, D);
        if (x > 0) relax(c, c + W - 1, D);
      }
    }
  }
  return dist;
}

/**
 * Rasterises a map-mode tint at `P` pixels per cell (RGBA, straight alpha): each province's fill blended
 * bilinearly between cells (soft watercolour seams), clipped to the smooth coastline and lakes, and strengthened in a
 * band along realm borders (`wash` 0…1, `washWidth` cells). Hatched fills draw diagonal ink hatching.
 */
export function rasterizeTint(
  world: StaticWorld,
  f: ChartFields,
  fills: readonly (ProvinceFill | null)[],
  P: number,
  opts: { borderDist?: Float32Array; wash?: number; washWidth?: number } = {},
): Uint8ClampedArray {
  const W = world.width;
  const H = world.height;
  const outW = W * P;
  const outH = H * P;
  const out = new Uint8ClampedArray(outW * outH * 4);
  const { provinceOf, kind } = world;
  // Per-cell premultiplied colour and alpha.
  const cr = new Float32Array(world.size);
  const cg = new Float32Array(world.size);
  const cb = new Float32Array(world.size);
  const ca = new Float32Array(world.size);
  const hatch = new Uint8Array(world.size);
  const wash = Math.max(0, Math.min(1, opts.wash ?? 0));
  const washWidth = Math.max(0.5, opts.washWidth ?? 3.2);
  const bd = opts.borderDist;
  for (let c = 0; c < world.size; c++) {
    if (kind[c] === CELL_SEA || kind[c] === CELL_LAKE) continue;
    const p = provinceOf[c]!;
    const fill = p >= 0 ? fills[p] : null;
    if (!fill) continue;
    let a = fill.alpha;
    if (bd && wash > 0) {
      const d = bd[c]!;
      const band = d === Infinity ? 0 : Math.max(0, 1 - d / washWidth);
      a = a * (1 - wash * 0.55) + a * wash * 1.25 * band * band;
    }
    a = Math.max(0, Math.min(1, a));
    const [r, g, b] = rgbOf(fill.color);
    cr[c] = r * a;
    cg[c] = g * a;
    cb[c] = b * a;
    ca[c] = a;
    if (fill.hatch) hatch[c] = 1;
  }
  const plan = columnPlan(W, P, outW);
  const { sdf, lake } = f;
  const [ir, ig, ib] = rgbOf(CHART.inkSoft);
  for (let py = 0; py < outH; py++) {
    const { j0, j1, fy } = rowOf(H, P, py);
    const r0 = j0 * W;
    const r1 = j1 * W;
    let o = py * outW * 4;
    for (let px = 0; px < outW; px++, o += 4) {
      const i0 = plan.i0[px]!;
      const i1 = plan.i1[px]!;
      const fx = plan.fx[px]!;
      const c00 = r0 + i0;
      const c10 = r0 + i1;
      const c01 = r1 + i0;
      const c11 = r1 + i1;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const a = ca[c00]! * w00 + ca[c10]! * w10 + ca[c01]! * w01 + ca[c11]! * w11;
      if (a <= 0.003) continue;
      const s = sdf[c00]! * w00 + sdf[c10]! * w10 + sdf[c01]! * w01 + sdf[c11]! * w11;
      let cov = Math.max(0, Math.min(1, s * P + 0.5));
      const lk = lake[c00]! * w00 + lake[c10]! * w10 + lake[c01]! * w01 + lake[c11]! * w11;
      cov *= 1 - Math.max(0, Math.min(1, lk * P + 0.5));
      if (cov <= 0) continue;
      let r = (cr[c00]! * w00 + cr[c10]! * w10 + cr[c01]! * w01 + cr[c11]! * w11) / a;
      let g = (cg[c00]! * w00 + cg[c10]! * w10 + cg[c01]! * w01 + cg[c11]! * w11) / a;
      let b = (cb[c00]! * w00 + cb[c10]! * w10 + cb[c01]! * w01 + cb[c11]! * w11) / a;
      let alpha = a * cov;
      const nearest = fx < 0.5 ? (fy < 0.5 ? c00 : c01) : fy < 0.5 ? c10 : c11;
      if (hatch[nearest] && (px + py) % 7 < 1) {
        r = ir;
        g = ig;
        b = ib;
        alpha = Math.max(alpha, 0.38 * cov);
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = alpha * 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Knowledge fog.

/** Fog opacity per knowledge level (unknown: blank parchment; charted: a faint veil; visited: clear). */
export const FOG_ALPHA: readonly [unknown: number, charted: number, visited: number] = [1, 0.14, 0];

/** Separable box blur (radius r cells) of a W×H float field, `passes` times (≈ Gaussian for 2–3 passes). */
export function boxBlur(field: Float32Array, W: number, H: number, r: number, passes = 2): Float32Array {
  const cur = Float32Array.from(field);
  const tmp = new Float32Array(field.length);
  const R = Math.max(1, Math.round(r));
  const norm = 1 / (2 * R + 1);
  for (let p = 0; p < passes; p++) {
    // Horizontal: cur → tmp (edges clamp).
    for (let y = 0; y < H; y++) {
      const row = y * W;
      let acc = 0;
      for (let k = -R; k <= R; k++) acc += cur[row + Math.max(0, Math.min(W - 1, k))]!;
      for (let x = 0; x < W; x++) {
        tmp[row + x] = acc * norm;
        acc += cur[row + Math.min(W - 1, x + R + 1)]! - cur[row + Math.max(0, x - R)]!;
      }
    }
    // Vertical: tmp → cur.
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let k = -R; k <= R; k++) acc += tmp[Math.max(0, Math.min(H - 1, k)) * W + x]!;
      for (let y = 0; y < H; y++) {
        cur[y * W + x] = acc * norm;
        acc += tmp[Math.min(H - 1, y + R + 1) * W + x]! - tmp[Math.max(0, y - R) * W + x]!;
      }
    }
  }
  return cur;
}

/** Per-cell fog opacity from knowledge levels, softened by a blur (cells). */
export function fogField(levels: Uint8Array, W: number, H: number, blur = 1.5): Float32Array {
  const a = new Float32Array(W * H);
  for (let c = 0; c < a.length; c++) {
    const l = levels[c]!;
    a[c] = l === KNOW_UNKNOWN ? FOG_ALPHA[0] : l === KNOW_CHARTED ? FOG_ALPHA[1] : FOG_ALPHA[2];
  }
  return blur > 0 ? boxBlur(a, W, H, blur, 2) : a;
}

/**
 * Rasterises the fog at P pixels per cell: parchment with paper grain and faint "terra incognita" hatching where
 * nothing is known, a sepia veil over charted-but-unvisited places.
 */
export function rasterizeFog(field: Float32Array, W: number, H: number, P: number): Uint8ClampedArray {
  const outW = W * P;
  const outH = H * P;
  const out = new Uint8ClampedArray(outW * outH * 4);
  const plan = columnPlan(W, P, outW);
  const [pr, pg, pb] = rgbOf(CHART.parchment);
  const [dr, dg, db] = rgbOf(CHART.parchmentDark);
  const [hr, hg, hb] = rgbOf(CHART.inkSoft);
  const [vr, vg, vb] = rgbOf(0xcdb98e);
  for (let py = 0; py < outH; py++) {
    const { j0, j1, fy } = rowOf(H, P, py);
    let o = py * outW * 4;
    for (let px = 0; px < outW; px++, o += 4) {
      const i0 = plan.i0[px]!;
      const i1 = plan.i1[px]!;
      const fx = plan.fx[px]!;
      const a = field[j0 * W + i0]! * (1 - fx) * (1 - fy) + field[j0 * W + i1]! * fx * (1 - fy) + field[j1 * W + i0]! * (1 - fx) * fy + field[j1 * W + i1]! * fx * fy;
      if (a <= 0.004) continue;
      // Blend from the charted veil colour (thin) to full parchment (opaque).
      const k = smoothstep(FOG_ALPHA[1], 0.85, a);
      const n = valueNoise(px, py, 34, 5) * 0.5 + valueNoise(px, py, 7, 6) * 0.25 + (hash2(px, py, 8) - 0.5) * 0.25;
      let r = vr + (pr - vr) * k;
      let g = vg + (pg - vg) * k;
      let b = vb + (pb - vb) * k;
      const t = 0.5 + n * 0.5;
      r += (dr - r) * t * 0.35 * k;
      g += (dg - g) * t * 0.35 * k;
      b += (db - b) * t * 0.35 * k;
      // Terra incognita hatching, only deep in the unknown.
      if (a > 0.9 && (px - py + 4096 * P) % (6 * P) < Math.max(1, P * 0.5)) {
        const h = 0.07 * smoothstep(0.9, 1, a);
        r += (hr - r) * h;
        g += (hg - g) * h;
        b += (hb - b) * h;
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = Math.min(1, a) * 255;
    }
  }
  return out;
}

/** True when a cell is land or lake (not sea). */
export function isLandish(world: StaticWorld, cell: number): boolean {
  return cell >= 0 && cell < world.size && world.kind[cell] !== CELL_SEA;
}

/** Terrain classes used for symbol placement (re-exported for the renderer). */
export const TERRAIN = { forest: TERRAIN_FOREST, hills: TERRAIN_HILLS, mountain: TERRAIN_MOUNTAIN, marsh: TERRAIN_MARSH } as const;
