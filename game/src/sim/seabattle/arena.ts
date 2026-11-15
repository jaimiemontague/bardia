/**
 * Sea-battle arena (design §15.2: about 2 × 2 km with islands, rocks and shallows), generated from
 * the battle seed and the encounter's coastline context (template + coast bearing).
 *
 * The arena is a square grid of `cellM` cells (default 10 m → 200 × 200) holding a terrain code,
 * plus two chamfer distance fields used by the AI and physics:
 *   - `hazardDist`: metres to the nearest land/rock cell (every hull must avoid it);
 *   - `shallowDist`: metres to the nearest shallow/land/rock cell (deep-draft hulls ground there).
 * Pure and deterministic: the same seed, template and options always give the same arena.
 */
import { clamp, datan2, dcos, dsin, PI, SQRT2, TWO_PI } from '@sim/core/dmath';
import { Rng } from '@sim/core/rng';
import type { Tunables as SeaTunables } from '@content/schemas/tunables/seabattle';
import { DEG, headingX, headingY, wrap2Pi } from './geom';

/** Terrain codes stored in `SeaArena.terrain`. */
export const TERRAIN = { deep: 0, shallow: 1, land: 2, rock: 3 } as const;
export type TerrainCode = (typeof TERRAIN)[keyof typeof TERRAIN];

export type ArenaTemplate = SeaTunables['arenas'][string];

/** A round feature (island, rock or shoal) for rendering and debugging. */
export interface ArenaFeature {
  x: number;
  y: number;
  r: number;
}

/** Where a side starts: centroid and the heading its ships face (toward the enemy). */
export interface ArenaSpawn {
  x: number;
  y: number;
  heading: number;
}

export interface SeaArena {
  /** Template id actually used (after the fallback). */
  template: string;
  sizeM: number;
  cellM: number;
  /** Grid width/height in cells. */
  w: number;
  h: number;
  /** Terrain code per cell, row-major (y * w + x). */
  terrain: Uint8Array;
  /** Metres to the nearest land or rock cell. */
  hazardDist: Float32Array;
  /** Metres to the nearest shallow, land or rock cell. */
  shallowDist: Float32Array;
  islands: ArenaFeature[];
  rocks: ArenaFeature[];
  shoals: ArenaFeature[];
  /** Compass bearings (radians) from the centre to each coast edge. */
  coasts: number[];
  /** Index 0 = attacker, 1 = defender. */
  spawn: [ArenaSpawn, ArenaSpawn];
}

/** Options for generateArena. */
export interface ArenaOptions {
  seed: string;
  templateId: string;
  /** Degrees; snapped to the nearest edge. Drawn from the seed when absent. */
  coastBearing?: number;
  sizeM: number;
  tunables: SeaTunables;
  /** A side that flees from the start (merchants): it starts in the centre, its pursuers close behind. */
  chased?: 0 | 1;
}

const BIG = 1e9;

/** Builds the arena for a battle. */
export function generateArena(opts: ArenaOptions): SeaArena {
  const t = opts.tunables;
  const templateId = Object.hasOwn(t.arenas, opts.templateId) ? opts.templateId : t.arenaGen.fallback;
  const tpl = t.arenas[templateId];
  if (!tpl) throw new RangeError(`seabattle: unknown arena template '${opts.templateId}' and no fallback '${t.arenaGen.fallback}'`);
  const rng = Rng.derive(opts.seed, 'arena');
  const cellM = t.arenaGen.cellM;
  const sizeM = opts.sizeM;
  const w = Math.max(8, Math.round(sizeM / cellM));
  const h = w;
  const terrain = new Uint8Array(w * h);
  const center = sizeM / 2;

  // Coasts: the first on the edge nearest the given bearing, the second on the opposite edge.
  const edge0 = opts.coastBearing !== undefined ? Math.round(wrap2Pi(opts.coastBearing * DEG) / (PI / 2)) % 4 : rng.int(0, 3);
  const coasts: number[] = [];
  const coastDepths: number[] = [];
  for (let c = 0; c < tpl.coasts; c++) {
    const edge = (edge0 + 2 * c) % 4;
    coasts.push(edge * (PI / 2));
    const depth = rng.range(tpl.coastDepthM[0], tpl.coastDepthM[1]);
    coastDepths.push(depth);
    rasterCoast(terrain, w, h, cellM, edge, depth, tpl.coastRoughnessM, rng);
  }

  // Spawn axis: along the channel/coast when there is land on an edge, else any direction.
  const axis = coasts.length > 0 ? wrap2Pi((coasts[0] as number) + PI / 2 + (rng.chance(0.5) ? PI : 0)) : rng.range(0, TWO_PI);
  const half = Math.min(t.battle.spawnSeparationM / 2, sizeM / 2 - t.battle.spawnClearM * 0.5);
  let cx = center;
  let cy = center;
  if (coasts.length === 1) {
    // Shift the battle line away from a single coast so both fleets start in open water.
    const away = (coasts[0] as number) + PI;
    const shift = Math.max(0, (coastDepths[0] as number) + t.battle.spawnClearM + 60 - center);
    cx += headingX(away) * shift;
    cy += headingY(away) * shift;
  }
  let spawn: [ArenaSpawn, ArenaSpawn];
  if (opts.chased === undefined) {
    spawn = [
      { x: cx - headingX(axis) * half, y: cy - headingY(axis) * half, heading: axis },
      { x: cx + headingX(axis) * half, y: cy + headingY(axis) * half, heading: wrap2Pi(axis + PI) },
    ];
  } else {
    // The chased side in the centre heading away; the chasers behind it, heading after it.
    const sep = t.battle.chaseSpawnSeparationM;
    const chased: ArenaSpawn = { x: cx, y: cy, heading: axis };
    const chasers: ArenaSpawn = { x: cx - headingX(axis) * sep, y: cy - headingY(axis) * sep, heading: axis };
    spawn = opts.chased === 0 ? [chased, chasers] : [chasers, chased];
  }

  const clearOf = (x: number, y: number, r: number): boolean => {
    for (const s of spawn) {
      const dx = x - s.x;
      const dy = y - s.y;
      const need = t.battle.spawnClearM + r + 40;
      if (dx * dx + dy * dy < need * need) return false;
    }
    return true;
  };

  const islands = placeFeatures(rng, rng.int(tpl.islands[0], tpl.islands[1]), tpl.islandRadiusM, sizeM, 80, clearOf);
  for (const f of islands) rasterBlob(terrain, w, h, cellM, f, TERRAIN.land, 0.3, rng, false);
  // Rocks and shoals stand in open water (never on the land laid down above).
  const inWater = (x: number, y: number, r: number): boolean => {
    if (!clearOf(x, y, r)) return false;
    const cx = Math.floor(x / cellM);
    const cy = Math.floor(y / cellM);
    return cx >= 0 && cy >= 0 && cx < w && cy < h && terrain[cy * w + cx] === TERRAIN.deep;
  };
  const rocks = placeFeatures(rng, rng.int(tpl.rocks[0], tpl.rocks[1]), tpl.rockRadiusM, sizeM, 40, inWater);
  for (const f of rocks) rasterBlob(terrain, w, h, cellM, f, TERRAIN.rock, 0.15, rng, true);
  const shoals = placeFeatures(rng, rng.int(tpl.shoals[0], tpl.shoals[1]), tpl.shoalRadiusM, sizeM, 60, inWater);
  for (const f of shoals) rasterBlob(terrain, w, h, cellM, f, TERRAIN.shallow, 0.35, rng, true);

  for (const s of spawn) carve(terrain, w, h, cellM, s.x, s.y, t.battle.spawnClearM);

  // Shallow bands around land and rocks.
  const landDist = chamfer(terrain, w, h, cellM, (c) => c === TERRAIN.land);
  const rockDist = chamfer(terrain, w, h, cellM, (c) => c === TERRAIN.rock);
  for (let i = 0; i < terrain.length; i++) {
    if (terrain[i] !== TERRAIN.deep) continue;
    if ((landDist[i] as number) <= tpl.shallowsM || (rockDist[i] as number) <= tpl.rockShallowsM) terrain[i] = TERRAIN.shallow;
  }
  // Keep the start areas clear of the bands too (a slightly smaller radius keeps edges soft).
  for (const s of spawn) carve(terrain, w, h, cellM, s.x, s.y, t.battle.spawnClearM * 0.8);

  const hazardDist = chamfer(terrain, w, h, cellM, (c) => c === TERRAIN.land || c === TERRAIN.rock);
  const shallowDist = chamfer(terrain, w, h, cellM, (c) => c !== TERRAIN.deep);
  return { template: templateId, sizeM, cellM, w, h, terrain, hazardDist, shallowDist, islands, rocks, shoals, coasts, spawn };
}

/** Terrain code at a point (open deep water outside the grid). */
export function terrainAt(arena: SeaArena, x: number, y: number): TerrainCode {
  const cx = Math.floor(x / arena.cellM);
  const cy = Math.floor(y / arena.cellM);
  if (cx < 0 || cy < 0 || cx >= arena.w || cy >= arena.h) return TERRAIN.deep;
  return arena.terrain[cy * arena.w + cx] as TerrainCode;
}

/** Metres to the nearest hazard for a hull (deep-draft hulls also avoid shallows); large outside. */
export function hazardDistance(arena: SeaArena, x: number, y: number, deepDraft: boolean): number {
  const cx = Math.floor(x / arena.cellM);
  const cy = Math.floor(y / arena.cellM);
  if (cx < 0 || cy < 0 || cx >= arena.w || cy >= arena.h) return BIG;
  const i = cy * arena.w + cx;
  return (deepDraft ? arena.shallowDist[i] : arena.hazardDist[i]) as number;
}

/** True when no land lies on the segment (rocks and shallows do not block arrows). */
export function lineOfSight(arena: SeaArena, x0: number, y0: number, x1: number, y1: number, samples: number): boolean {
  for (let k = 1; k <= samples; k++) {
    const f = k / (samples + 1);
    if (terrainAt(arena, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f) === TERRAIN.land) return false;
  }
  return true;
}

/**
 * Start positions for `count` ships of a side: rows of `perRow` abreast, flagship in the centre of
 * the front row, later rows further from the enemy. Each spot is moved to the nearest open deep
 * water if the formation does not fit the cleared area.
 */
export function formationSpots(
  arena: SeaArena,
  side: 0 | 1,
  count: number,
  lineSpacingM: number,
  rowSpacingM: number,
  perRow: number,
): { x: number; y: number; heading: number }[] {
  const s = arena.spawn[side];
  const fx = headingX(s.heading);
  const fy = headingY(s.heading);
  // Right-hand vector (90° clockwise of the facing).
  const rx = -fy;
  const ry = fx;
  const out: { x: number; y: number; heading: number }[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const k = i % perRow;
    const slot = k === 0 ? 0 : k % 2 === 1 ? (k + 1) / 2 : -k / 2;
    let x = s.x + rx * slot * lineSpacingM - fx * row * rowSpacingM;
    let y = s.y + ry * slot * lineSpacingM - fy * row * rowSpacingM;
    const open = nearestOpen(arena, x, y);
    x = open.x;
    y = open.y;
    out.push({ x, y, heading: s.heading });
  }
  return out;
}

/** Nearest cell centre in deep water at least 30 m from shallows (spiral search). */
export function nearestOpen(arena: SeaArena, x: number, y: number): { x: number; y: number } {
  const ok = (px: number, py: number) => hazardDistance(arena, px, py, true) >= 30 && px > 0 && py > 0 && px < arena.sizeM && py < arena.sizeM;
  if (ok(x, y)) return { x, y };
  const c = arena.cellM;
  for (let r = 1; r < arena.w; r++) {
    for (let k = 0; k < 8 * r; k++) {
      const a = (k / (8 * r)) * TWO_PI;
      const px = x + dsin(a) * r * c;
      const py = y - dcos(a) * r * c;
      if (ok(px, py)) return { x: px, y: py };
    }
  }
  return { x, y };
}

// ---------------------------------------------------------------------------------------------
// Generation helpers.

function placeFeatures(
  rng: Rng,
  n: number,
  radius: readonly [number, number],
  sizeM: number,
  edgeMargin: number,
  clearOf: (x: number, y: number, r: number) => boolean,
): ArenaFeature[] {
  const out: ArenaFeature[] = [];
  for (let i = 0; i < n; i++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const r = rng.range(radius[0], radius[1]);
      const x = rng.range(edgeMargin, sizeM - edgeMargin);
      const y = rng.range(edgeMargin, sizeM - edgeMargin);
      if (!clearOf(x, y, r)) continue;
      let overlaps = false;
      for (const f of out) {
        const dx = f.x - x;
        const dy = f.y - y;
        const min = (f.r + r) * 0.9;
        if (dx * dx + dy * dy < min * min) overlaps = true;
      }
      if (overlaps) continue;
      out.push({ x, y, r });
      break;
    }
  }
  return out;
}

/** Smooth periodic noise: `k` random control values around a circle, smoothstep-interpolated. */
function ringNoise(rng: Rng, k: number): number[] {
  const v: number[] = [];
  for (let i = 0; i < k; i++) v.push(rng.range(-1, 1));
  return v;
}

function sampleRing(v: readonly number[], angle: number): number {
  const k = v.length;
  const pos = (wrap2Pi(angle) / TWO_PI) * k;
  const i0 = Math.floor(pos) % k;
  const i1 = (i0 + 1) % k;
  const f = pos - Math.floor(pos);
  const s = f * f * (3 - 2 * f);
  return (v[i0] as number) * (1 - s) + (v[i1] as number) * s;
}

/** Rasterises a noisy disc. `onlyDeep`: paint only over deep water (shoals/rocks never erase land). */
function rasterBlob(
  terrain: Uint8Array,
  w: number,
  h: number,
  cellM: number,
  f: ArenaFeature,
  code: number,
  wobble: number,
  rng: Rng,
  onlyDeep: boolean,
): void {
  const noise = ringNoise(rng, 8);
  const maxR = f.r * (1 + wobble);
  // Features smaller than a cell still occupy the cell they stand in.
  const ccx = Math.floor(f.x / cellM);
  const ccy = Math.floor(f.y / cellM);
  if (ccx >= 0 && ccy >= 0 && ccx < w && ccy < h) {
    const ci = ccy * w + ccx;
    if (!onlyDeep || terrain[ci] === 0) terrain[ci] = code;
  }
  const x0 = Math.max(0, Math.floor((f.x - maxR) / cellM));
  const x1 = Math.min(w - 1, Math.floor((f.x + maxR) / cellM));
  const y0 = Math.max(0, Math.floor((f.y - maxR) / cellM));
  const y1 = Math.min(h - 1, Math.floor((f.y + maxR) / cellM));
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const px = (cx + 0.5) * cellM - f.x;
      const py = (cy + 0.5) * cellM - f.y;
      const d2 = px * px + py * py;
      if (d2 > maxR * maxR) continue;
      const r = f.r * (1 + wobble * sampleRing(noise, datan2(px, -py)));
      if (d2 > r * r) continue;
      const i = cy * w + cx;
      if (onlyDeep && terrain[i] !== 0) continue;
      terrain[i] = code;
    }
  }
}

/**
 * Land along one edge (0 = north, 1 = east, 2 = south, 3 = west) reaching `depth` metres in, with a
 * two-octave wiggle of amplitude `rough`.
 */
function rasterCoast(terrain: Uint8Array, w: number, h: number, cellM: number, edge: number, depth: number, rough: number, rng: Rng): void {
  const n = edge === 0 || edge === 2 ? w : h;
  const coarse = ringNoise(rng, 6);
  const fine = ringNoise(rng, 14);
  for (let a = 0; a < n; a++) {
    const u = (a + 0.5) / n;
    const reach = depth + rough * (sampleRing(coarse, u * TWO_PI) + 0.4 * sampleRing(fine, u * TWO_PI));
    const cells = clamp(Math.round(reach / cellM), 0, n);
    for (let d = 0; d < cells; d++) {
      let cx: number;
      let cy: number;
      if (edge === 0) {
        cx = a;
        cy = d;
      } else if (edge === 2) {
        cx = a;
        cy = h - 1 - d;
      } else if (edge === 1) {
        cx = w - 1 - d;
        cy = a;
      } else {
        cx = d;
        cy = a;
      }
      terrain[cy * w + cx] = TERRAIN.land;
    }
  }
}

function carve(terrain: Uint8Array, w: number, h: number, cellM: number, x: number, y: number, r: number): void {
  const x0 = Math.max(0, Math.floor((x - r) / cellM));
  const x1 = Math.min(w - 1, Math.floor((x + r) / cellM));
  const y0 = Math.max(0, Math.floor((y - r) / cellM));
  const y1 = Math.min(h - 1, Math.floor((y + r) / cellM));
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const px = (cx + 0.5) * cellM - x;
      const py = (cy + 0.5) * cellM - y;
      if (px * px + py * py <= r * r) terrain[cy * w + cx] = TERRAIN.deep;
    }
  }
}

/** Two-pass chamfer distance (metres) to the cells matching `isSource`. */
function chamfer(terrain: Uint8Array, w: number, h: number, cellM: number, isSource: (code: number) => boolean): Float32Array {
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = isSource(terrain[i] as number) ? 0 : BIG;
  const a = cellM;
  const b = cellM * SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i] as number;
      if (x > 0) v = Math.min(v, (d[i - 1] as number) + a);
      if (y > 0) {
        v = Math.min(v, (d[i - w] as number) + a);
        if (x > 0) v = Math.min(v, (d[i - w - 1] as number) + b);
        if (x < w - 1) v = Math.min(v, (d[i - w + 1] as number) + b);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i] as number;
      if (x < w - 1) v = Math.min(v, (d[i + 1] as number) + a);
      if (y < h - 1) {
        v = Math.min(v, (d[i + w] as number) + a);
        if (x < w - 1) v = Math.min(v, (d[i + w + 1] as number) + b);
        if (x > 0) v = Math.min(v, (d[i + w - 1] as number) + b);
      }
      d[i] = v;
    }
  }
  return d;
}
