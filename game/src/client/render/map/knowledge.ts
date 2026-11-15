/**
 * Knowledge layers (§8.2) for the fog overlay: per cell 0 unknown (blank parchment), 1 charted, 2 visited.
 *
 * The world module owns knowledge and is being built in parallel, so `readKnowledge` probes the plausible shapes
 * defensively and returns null (no fog: everything charted) when it finds none. Accepted shapes, on
 * `state.knowledge`, `state.world.knowledge`, `state.mapKnowledge` or `state.player.knowledge`:
 *
 *   { levels: number[] | base64 string }                  one byte per cell (0/1/2)
 *   { charted?: bits, visited?: bits }                    bitsets (base64, 1 bit per cell, LSB first) or cell lists
 *   { chartedProvinces?, visitedProvinces?: string[] }    geography province ids (or names)
 *   { chartedZones?, visitedZones?: string[] }            geography sea-zone ids
 *   { visitedSettlements?: { x, y }[] | string[] }        positions (or geography ids) visited
 *
 * `syntheticKnowledge` builds a grid from seeds (preview, tests).
 */
import { CELL_SEA, type StaticWorld } from '@sim/modules/world/map/index';
import { KNOW_CHARTED, KNOW_UNKNOWN, KNOW_VISITED, type Vec2 } from './types';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX: Record<string, number> = Object.fromEntries([...B64].map((c, i) => [c, i]));
B64_INDEX['-'] = 62;
B64_INDEX['_'] = 63;

/** Decodes standard or URL-safe base64 (padding optional); invalid characters are skipped. */
export function decodeBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/\-_]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const a = B64_INDEX[clean[i]!] ?? 0;
    const b = B64_INDEX[clean[i + 1]!] ?? 0;
    const c = i + 2 < clean.length ? (B64_INDEX[clean[i + 2]!] ?? 0) : -1;
    const d = i + 3 < clean.length ? (B64_INDEX[clean[i + 3]!] ?? 0) : -1;
    const n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (c >= 0 && o < out.length) out[o++] = (n >> 8) & 255;
    if (d >= 0 && o < out.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** A bitset (base64 string) or a list of cell indices → per-cell flags. */
function cellsOf(v: unknown, size: number): Uint8Array | null {
  if (typeof v === 'string' && v.length > 0) {
    const bytes = decodeBase64(v);
    if (bytes.length * 8 < size) return null;
    const out = new Uint8Array(size);
    for (let c = 0; c < size; c++) out[c] = (bytes[c >> 3]! >> (c & 7)) & 1;
    return out;
  }
  if (Array.isArray(v)) {
    const out = new Uint8Array(size);
    let any = false;
    for (const c of v) {
      if (typeof c === 'number' && Number.isInteger(c) && c >= 0 && c < size) {
        out[c] = 1;
        any = true;
      }
    }
    return any || v.length === 0 ? out : null;
  }
  return null;
}

function levelsOf(v: unknown, size: number): Uint8Array | null {
  if (typeof v === 'string') {
    const bytes = decodeBase64(v);
    return bytes.length >= size ? bytes.subarray(0, size) : null;
  }
  if (Array.isArray(v) && v.length === size) {
    const out = new Uint8Array(size);
    for (let c = 0; c < size; c++) out[c] = Math.max(0, Math.min(2, Number(v[c]) | 0));
    return out;
  }
  return null;
}

/** Province indices named by geography id or name. */
function provinceIndices(world: StaticWorld, v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const byName: Record<string, number> = {};
  world.geo.provinces.forEach((p, i) => (byName[p.name.toLowerCase()] = i));
  const out: number[] = [];
  for (const id of v) {
    if (typeof id !== 'string') continue;
    const i = Object.hasOwn(world.index.province, id) ? world.index.province[id] : byName[id.toLowerCase()];
    if (i !== undefined) out.push(i);
  }
  return out;
}

function zoneIndices(world: StaticWorld, v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const id of v) if (typeof id === 'string' && Object.hasOwn(world.index.seaZone, id)) out.push(world.index.seaZone[id]!);
  return out;
}

/** Raises cells in a disc to at least `level`. */
export function markDisc(levels: Uint8Array, world: Pick<StaticWorld, 'width' | 'height'>, centre: Vec2, radius: number, level: number): void {
  const r = Math.max(0, radius);
  const x0 = Math.max(0, Math.floor(centre[0] - r));
  const x1 = Math.min(world.width - 1, Math.ceil(centre[0] + r));
  const y0 = Math.max(0, Math.floor(centre[1] - r));
  const y1 = Math.min(world.height - 1, Math.ceil(centre[1] + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - centre[0];
      const dy = y + 0.5 - centre[1];
      if (dx * dx + dy * dy > r2) continue;
      const c = y * world.width + x;
      if (levels[c]! < level) levels[c] = level;
    }
  }
}

/** Raises every cell of the given provinces (land and lakes) and sea zones to at least `level`. */
export function markAreas(levels: Uint8Array, world: StaticWorld, provinces: readonly number[], zones: readonly number[], level: number): void {
  if (provinces.length === 0 && zones.length === 0) return;
  const pset = new Uint8Array(world.provinces.length);
  for (const p of provinces) if (p >= 0 && p < pset.length) pset[p] = 1;
  const zset = new Uint8Array(world.seaZones.length);
  for (const z of zones) if (z >= 0 && z < zset.length) zset[z] = 1;
  for (let c = 0; c < world.size; c++) {
    if (levels[c]! >= level) continue;
    const k = world.kind[c];
    if (k === CELL_SEA) {
      const z = world.zoneOf[c]!;
      if (z >= 0 && zset[z]) levels[c] = level;
    } else {
      const p = world.provinceOf[c]!;
      if (p >= 0 && pset[p]) levels[c] = level;
    }
  }
}

/**
 * Charts the sea within `reach` cells of charted land (a coast you know comes with its offshore waters) and the
 * coast within `reach` of charted sea.
 */
export function chartCoastalFringe(levels: Uint8Array, world: StaticWorld, reach = 3): void {
  const W = world.width;
  const H = world.height;
  const src = Uint8Array.from(levels);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = y * W + x;
      if (src[c]! === KNOW_UNKNOWN) continue;
      if (world.coastDist[c]! > reach + 0.5) continue;
      markDisc(levels, world, [x + 0.5, y + 0.5], reach, KNOW_CHARTED);
    }
  }
}

function probe(state: unknown): Record<string, unknown> | null {
  if (!isRecord(state)) return null;
  const candidates = [state.knowledge, isRecord(state.world) ? state.world.knowledge : undefined, state.mapKnowledge, isRecord(state.player) ? state.player.knowledge : undefined];
  for (const c of candidates) if (isRecord(c)) return c;
  return null;
}

/** Run-length rows (the world module's `state.knowledge.charted`): row y = [x0, x1, x2, x3, …] half-open runs. */
function runRows(v: unknown, world: Pick<StaticWorld, 'width' | 'height'>): Uint8Array | null {
  if (!Array.isArray(v) || v.length !== world.height || !v.every((row) => Array.isArray(row))) return null;
  const out = new Uint8Array(world.width * world.height);
  v.forEach((row: unknown[], y) => {
    for (let i = 0; i + 1 < row.length; i += 2) {
      const a = Math.max(0, Math.floor(Number(row[i])));
      const b = Math.min(world.width, Math.floor(Number(row[i + 1])));
      for (let x = a; x < b; x++) out[y * world.width + x] = KNOW_CHARTED;
    }
  });
  return out;
}

/** Knowledge levels from GameState, or null when the state carries none (draw without fog). */
export function readKnowledge(world: StaticWorld, state: unknown): Uint8Array | null {
  const k = probe(state);
  if (!k) return null;
  const size = world.size;
  // The world module's shape: { charted: runs per row, visited: { settlementId: hour } }.
  const rows = runRows(k.charted, world);
  if (rows) {
    if (isRecord(k.visited) && isRecord(state) && isRecord(state.settlements)) {
      const settlements = state.settlements;
      for (const id of Object.keys(k.visited)) {
        const s = settlements[id];
        const pos = isRecord(s) && isRecord(s.mapPos) && typeof s.mapPos.x === 'number' && typeof s.mapPos.y === 'number' ? ([s.mapPos.x, s.mapPos.y] as const) : null;
        if (pos) markDisc(rows, world, pos, 4, KNOW_VISITED);
      }
    }
    return rows;
  }
  const direct = levelsOf(k.levels ?? k.cells, size);
  if (direct) return Uint8Array.from(direct);
  const levels = new Uint8Array(size);
  let found = false;
  const charted = cellsOf(k.charted, size);
  const visited = cellsOf(k.visited, size);
  if (charted) {
    found = true;
    for (let c = 0; c < size; c++) if (charted[c]) levels[c] = KNOW_CHARTED;
  }
  if (visited) {
    found = true;
    for (let c = 0; c < size; c++) if (visited[c]) levels[c] = KNOW_VISITED;
  }
  const cp = provinceIndices(world, k.chartedProvinces);
  const cz = zoneIndices(world, k.chartedZones);
  const vp = provinceIndices(world, k.visitedProvinces);
  const vz = zoneIndices(world, k.visitedZones);
  if (Array.isArray(k.chartedProvinces) || Array.isArray(k.chartedZones) || Array.isArray(k.visitedProvinces) || Array.isArray(k.visitedZones)) found = true;
  markAreas(levels, world, cp, cz, KNOW_CHARTED);
  markAreas(levels, world, vp, vz, KNOW_VISITED);
  if (Array.isArray(k.visitedSettlements)) {
    found = true;
    for (const v of k.visitedSettlements) {
      let pos: Vec2 | null = null;
      if (isRecord(v) && typeof v.x === 'number' && typeof v.y === 'number') pos = [v.x, v.y];
      else if (typeof v === 'string' && Object.hasOwn(world.index.settlement, v)) {
        const s = world.geo.settlements[world.index.settlement[v]!];
        if (s) pos = s.pos;
      }
      if (pos) markDisc(levels, world, pos, 4, KNOW_VISITED);
    }
  }
  return found ? levels : null;
}

/** A seed of synthetic knowledge. */
export interface KnowledgeSeed {
  pos: Vec2;
  radius: number;
  level: typeof KNOW_CHARTED | typeof KNOW_VISITED;
}

/** Builds knowledge from seeds, provinces and sea zones (dev preview and tests). */
export function syntheticKnowledge(world: StaticWorld, opts: { seeds?: readonly KnowledgeSeed[]; chartedProvinces?: readonly number[]; chartedZones?: readonly number[]; visitedProvinces?: readonly number[]; fringe?: number }): Uint8Array {
  const levels = new Uint8Array(world.size);
  markAreas(levels, world, opts.chartedProvinces ?? [], opts.chartedZones ?? [], KNOW_CHARTED);
  markAreas(levels, world, opts.visitedProvinces ?? [], [], KNOW_VISITED);
  for (const s of opts.seeds ?? []) markDisc(levels, world, s.pos, s.radius, s.level);
  if ((opts.fringe ?? 0) > 0) chartCoastalFringe(levels, world, opts.fringe);
  return levels;
}

/** Level of a cell (no knowledge = everything charted). */
export function knowledgeAt(levels: Uint8Array | null, cell: number): number {
  if (!levels) return KNOW_CHARTED;
  return cell >= 0 && cell < levels.length ? levels[cell]! : KNOW_UNKNOWN;
}

/** A cheap fingerprint of a knowledge grid (decides whether the fog texture must be rebuilt). */
export function knowledgeSignature(levels: Uint8Array | null): string {
  if (!levels) return 'none';
  let h = 2166136261;
  let n1 = 0;
  let n2 = 0;
  for (let c = 0; c < levels.length; c++) {
    const v = levels[c]!;
    if (v === 1) n1++;
    else if (v === 2) n2++;
    if (v !== 0) h = Math.imul(h ^ (c * 3 + v), 16777619);
  }
  return `${n1}:${n2}:${(h >>> 0).toString(36)}`;
}
