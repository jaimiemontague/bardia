/**
 * The player's map knowledge (§8.2, §8.9): which cells are Charted (run-length rows, JSON-serialisable and cheap
 * to update), which settlements were Visited, and the charted share of every sea zone.
 *
 * Rows: `charted[y]` is a sorted list of disjoint half-open runs `[x0, x1, x2, x3, …]` (cells x0 ≤ x < x1, …).
 * Touching runs are merged, so every row has a canonical form and identical knowledge serialises identically.
 *
 * Writes replace whole rows (never mutate a row in place), so reading a row through the Immer draft only costs
 * one trap and the old row is shared with the previous state.
 */
import type { SimContext } from '@sim/core/module';
import type { GameState, Hour, SettlementId } from '@sim/core/state';
import { current, isDraft } from 'immer';
import { CELL_SEA, type StaticWorld } from './map';
import type { WorldData } from './data';
import type { KnowledgeState } from './types';

/** Current knowledge format version. */
export const KNOWLEDGE_VERSION = 1;

/** A plain (non-draft) view of a value that is only ever replaced, never mutated in place. */
export function plain<T>(value: T): T {
  return isDraft(value) ? (current(value as never) as T) : value;
}

/** An empty knowledge slice for a grid. */
export function emptyKnowledge(width: number, height: number): KnowledgeState {
  const charted: number[][] = [];
  for (let y = 0; y < height; y++) charted.push([]);
  return { version: KNOWLEDGE_VERSION, width, height, charted, visited: {}, zoneCharted: {}, zonesComplete: [] };
}

/** True if x is inside one of the row's runs (binary search). */
export function rowHas(row: readonly number[], x: number): boolean {
  let lo = 0;
  let hi = (row.length >> 1) - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const a = row[mid * 2] as number;
    const b = row[mid * 2 + 1] as number;
    if (x < a) hi = mid - 1;
    else if (x >= b) lo = mid + 1;
    else return true;
  }
  return false;
}

/**
 * Merges the run [a, b) into a row. Returns the new row, or null when every cell was already covered. `onNew`
 * receives each newly covered gap [x0, x1).
 */
export function mergeRun(row: readonly number[], a: number, b: number, onNew?: (x0: number, x1: number) => void): number[] | null {
  if (b <= a) return null;
  const n = row.length;
  // First run whose end reaches a (runs ending exactly at a touch and merge).
  let i = 0;
  while (i < n && (row[i + 1] as number) < a) i += 2;
  // Fully covered by an existing run?
  if (i < n && (row[i] as number) <= a && (row[i + 1] as number) >= b) return null;
  let start = a;
  let end = b;
  let j = i;
  let cursor = a;
  while (j < n && (row[j] as number) <= b) {
    const ra = row[j] as number;
    const rb = row[j + 1] as number;
    if (ra > cursor && onNew) onNew(cursor, Math.min(ra, b));
    if (rb > cursor) cursor = rb;
    if (ra < start) start = ra;
    if (rb > end) end = rb;
    j += 2;
  }
  if (cursor < b && onNew) onNew(cursor, b);
  const out = row.slice(0, i);
  out.push(start, end);
  for (let k = j; k < n; k++) out.push(row[k] as number);
  return out;
}

/** Number of cells a row covers. */
export function rowCount(row: readonly number[]): number {
  let n = 0;
  for (let i = 0; i < row.length; i += 2) n += (row[i + 1] as number) - (row[i] as number);
  return n;
}

/** Run-length rows from a full-grid mask (1 = charted). */
export function rowsFromMask(mask: Uint8Array, width: number, height: number): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    const base = y * width;
    let x = 0;
    while (x < width) {
      if (mask[base + x] === 0) {
        x++;
        continue;
      }
      const start = x;
      while (x < width && mask[base + x] !== 0) x++;
      row.push(start, x);
    }
    rows.push(row);
  }
  return rows;
}

/** True if the cell (x, y) is charted. */
export function isChartedAt(k: Pick<KnowledgeState, 'charted' | 'width' | 'height'>, x: number, y: number): boolean {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= k.width || cy >= k.height) return false;
  const row = k.charted[cy];
  return row !== undefined && rowHas(row, cx);
}

/** Charted sea cells per zone from a mask (start knowledge). */
export function zoneCountsFromMask(data: WorldData, mask: Uint8Array): Record<string, number> {
  const { sw, zoneIds } = data;
  const counts = new Int32Array(zoneIds.length);
  for (let i = 0; i < sw.size; i++) {
    if (mask[i] === 0 || sw.kind[i] !== CELL_SEA) continue;
    const z = sw.zoneOf[i] as number;
    if (z >= 0) counts[z] = (counts[z] as number) + 1;
  }
  const out: Record<string, number> = {};
  zoneIds.forEach((id, z) => {
    if ((counts[z] as number) > 0) out[id] = counts[z] as number;
  });
  return out;
}

/** The player's knowledge slice (created empty if missing). */
export function knowledgeOf(draft: GameState, sw: StaticWorld): KnowledgeState {
  if (!draft.knowledge) draft.knowledge = emptyKnowledge(sw.width, sw.height);
  return draft.knowledge;
}

/**
 * Charts a disc of `radius` cells around (cx, cy) in the draft. Returns the number of newly charted cells.
 * Updates the per-zone sea counts and emits SeaZoneCharted when a zone crosses the completion share.
 */
export function chartDisc(draft: GameState, ctx: SimContext, data: WorldData, cx: number, cy: number, radius: number): number {
  const { sw } = data;
  const k = knowledgeOf(draft, sw);
  const r = Math.max(0, radius);
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(sw.height - 1, Math.floor(cy + r));
  if (y0 > y1) return 0;
  // Rows are only ever replaced, never mutated in place: a row read through the draft is copied out
  // individually (cheap), never the whole 600-row table.
  const rows = k.charted;
  const zoneNew = new Int32Array(data.zoneIds.length);
  let added = 0;
  let touchedZones = false;
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    const half2 = r * r - dy * dy;
    if (half2 < 0) continue;
    const half = Math.sqrt(half2);
    const a = Math.max(0, Math.ceil(cx - half - 0.5));
    const b = Math.min(sw.width, Math.floor(cx + half - 0.5) + 1);
    if (b <= a) continue;
    const rowRef = rows[y];
    const row = rowRef === undefined ? [] : plain(rowRef);
    const next = mergeRun(row, a, b, (x0, x1) => {
      added += x1 - x0;
      const base = y * sw.width;
      for (let x = x0; x < x1; x++) {
        const c = base + x;
        if (sw.kind[c] !== CELL_SEA) continue;
        const z = sw.zoneOf[c] as number;
        if (z >= 0) {
          zoneNew[z] = (zoneNew[z] as number) + 1;
          touchedZones = true;
        }
      }
    });
    if (next) k.charted[y] = next;
  }
  if (touchedZones) addZoneCounts(ctx, data, k, zoneNew);
  return added;
}

/** Adds newly charted sea cells per zone and announces completed zones (§8.9). */
function addZoneCounts(ctx: SimContext, data: WorldData, k: KnowledgeState, zoneNew: Int32Array): void {
  const share = ctx.tunables.world.knowledge.zoneCompleteShare;
  data.zoneIds.forEach((id, z) => {
    const n = zoneNew[z] as number;
    if (n === 0) return;
    const prev = Object.hasOwn(k.zoneCharted, id) ? (k.zoneCharted[id] as number) : 0;
    const now = prev + n;
    k.zoneCharted[id] = now;
    const total = data.sw.seaZones[z]?.cells ?? 0;
    if (total > 0 && now >= share * total && !k.zonesComplete.includes(id)) {
      k.zonesComplete.push(id);
      ctx.emit({ type: 'SeaZoneCharted', zoneId: id, share: Math.round((now / total) * 1000) / 1000 });
      ctx.notify('world.notify.zoneCharted', { priority: 'normal', vars: { zoneId: id, zone: data.geo.seaZones[z]?.name ?? id } });
    }
  });
}

/** Marks a settlement visited now (and charts around it). */
export function visitSettlement(draft: GameState, ctx: SimContext, data: WorldData, settlementId: SettlementId, hour: Hour = ctx.hour): void {
  const s = draft.settlements[settlementId];
  if (!s) return;
  chartDisc(draft, ctx, data, s.mapPos.x, s.mapPos.y, ctx.tunables.world.knowledge.settlementRadius);
  const k = knowledgeOf(draft, data.sw);
  k.visited[settlementId] = hour;
}

/** Charted share (0–1) of a sea zone. */
export function zoneChartedShare(data: WorldData, k: KnowledgeState | undefined, zoneId: string): number {
  const z = data.zoneIds.indexOf(zoneId);
  if (z < 0 || !k) return 0;
  const total = data.sw.seaZones[z]?.cells ?? 0;
  const n = Object.hasOwn(k.zoneCharted, zoneId) ? (k.zoneCharted[zoneId] as number) : 0;
  return total > 0 ? Math.min(1, n / total) : 0;
}

/** Violations of the knowledge slice's shape (sorted, disjoint runs inside the grid). */
export function knowledgeInvariants(k: KnowledgeState | undefined): string[] {
  if (!k) return [];
  const out: string[] = [];
  if (k.charted.length !== k.height) out.push(`knowledge: ${k.charted.length} rows, expected ${k.height}`);
  k.charted.forEach((row, y) => {
    if (row.length % 2 !== 0) out.push(`knowledge: row ${y} has an odd length`);
    let prevEnd = -1;
    for (let i = 0; i < row.length; i += 2) {
      const a = row[i] as number;
      const b = row[i + 1] as number;
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b > k.width || a >= b || a <= prevEnd) {
        out.push(`knowledge: row ${y} run ${i / 2} [${a}, ${b}) is not sorted/disjoint/in the grid`);
        break;
      }
      prevEnd = b;
    }
  });
  return out;
}
