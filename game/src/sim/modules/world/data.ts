/**
 * The world module's view of the static geography: the geography pack, its rasterised StaticWorld (map engine,
 * ./map) and small derived lookups, memoized per geography object. Never stored in GameState; the state keeps
 * the digest in `state.worldIndex` (worldIndex.ts) for modules that cannot import this code.
 */
import { getGeography, type Geography, type ProvinceDef, type SettlementDef } from '@content/world';
import { hashString32 } from '@sim/core/rng';
import { getStaticWorld, type StaticWorld } from './map';

/** Geography + static world + lookups (treat as immutable; shared between operations). */
export interface WorldData {
  readonly geo: Geography;
  readonly sw: StaticWorld;
  /** Sea zone index → id. */
  readonly zoneIds: readonly string[];
  /** Geography province id → definition. */
  readonly provinceDefs: Readonly<Record<string, ProvinceDef>>;
  /** Geography settlement id → definition. */
  readonly settlementDefs: Readonly<Record<string, SettlementDef>>;
  /** Geography province ids of royal seats. */
  readonly seatProvinces: Readonly<Record<string, string>>;
  /** Fingerprint of the geography (stored in worldIndex to detect a changed pack on load). */
  readonly fingerprint: string;
}

const cache: { geo: Geography; data: WorldData }[] = [];
const CACHE_LIMIT = 2;

function fingerprintOf(geo: Geography): string {
  // Ids and positions of everything the world index depends on; cheap and stable.
  let text = `${geo.grid.width}x${geo.grid.height}@${geo.grid.cellKm}|${geo.build.seed}|`;
  for (const p of geo.provinces) text += `p:${p.id}:${p.regionId}:${p.kingdomId ?? '-'}:${p.anchor[0]},${p.anchor[1]};`;
  for (const s of geo.settlements) text += `s:${s.id}:${s.provinceId ?? '-'}:${s.tier}:${s.pos[0]},${s.pos[1]}:${s.coastal ? 1 : 0}${s.riverPort === true ? 'r' : ''};`;
  for (const z of geo.seaZones) text += `z:${z.id};`;
  return `${hashString32(text, 0x9e3779b9).toString(36)}-${hashString32(text, 0x85ebca6b).toString(36)}-${text.length.toString(36)}`;
}

function build(geo: Geography): WorldData {
  const sw = getStaticWorld(geo);
  const provinceDefs: Record<string, ProvinceDef> = {};
  for (const p of geo.provinces) provinceDefs[p.id] = p;
  const settlementDefs: Record<string, SettlementDef> = {};
  for (const s of geo.settlements) settlementDefs[s.id] = s;
  const seatProvinces: Record<string, string> = {};
  for (const k of geo.kingdoms) seatProvinces[k.seatProvinceId] = k.id;
  return {
    geo,
    sw,
    zoneIds: geo.seaZones.map((z) => z.id),
    provinceDefs,
    settlementDefs,
    seatProvinces,
    fingerprint: fingerprintOf(geo),
  };
}

/** The world data for a geography (default: the bundled pack), built on first use and memoized. */
export function worldData(geo: Geography = getGeography()): WorldData {
  for (const entry of cache) if (entry.geo === geo) return entry.data;
  const data = build(geo);
  cache.unshift({ geo, data });
  if (cache.length > CACHE_LIMIT) cache.length = CACHE_LIMIT;
  return data;
}

/** Cell index of a continuous position (clamped into the grid). */
export function cellOfPos(sw: StaticWorld, x: number, y: number): number {
  const cx = Math.min(sw.width - 1, Math.max(0, Math.floor(x)));
  const cy = Math.min(sw.height - 1, Math.max(0, Math.floor(y)));
  return cy * sw.width + cx;
}

/** Centre of a cell as a map position. */
export function cellCentrePos(sw: StaticWorld, cell: number): { x: number; y: number } {
  return { x: (cell % sw.width) + 0.5, y: Math.floor(cell / sw.width) + 0.5 };
}

/** Sea zone id of a cell, or null (land, rivers, lakes). */
export function zoneIdAt(data: WorldData, cell: number): string | null {
  const z = data.sw.zoneOf[cell] as number;
  return z >= 0 ? (data.zoneIds[z] ?? null) : null;
}
