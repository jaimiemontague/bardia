/**
 * Every room under ./rooms, found by glob: a room file exports its `InteriorRoomDef` (any named export with an
 * id, a Painting and a people table), so adding `rooms/shipyard.tsx` adds it to the gallery with no edit here.
 */
import type { InteriorRoomDef } from './types';

function isRoom(v: unknown): v is InteriorRoomDef {
  if (v === null || typeof v !== 'object') return false;
  const r = v as Partial<InteriorRoomDef>;
  return typeof r.id === 'string' && typeof r.titleKey === 'string' && typeof r.Painting === 'function' && Array.isArray(r.people);
}

/** Collects room definitions from module namespaces (exported for tests). */
export function collectRooms(modules: Readonly<Record<string, unknown>>): Record<string, InteriorRoomDef> {
  const out: Record<string, InteriorRoomDef> = {};
  for (const mod of Object.values(modules)) {
    if (mod === null || typeof mod !== 'object') continue;
    for (const v of Object.values(mod as Record<string, unknown>)) if (isRoom(v)) out[v.id] = v;
  }
  return out;
}

const ROOMS = collectRooms(import.meta.glob('./rooms/*.tsx', { eager: true }));

/** All room ids, sorted. */
export function roomIds(): string[] {
  return Object.keys(ROOMS).sort();
}

/** A room by building id. */
export function roomById(id: string): InteriorRoomDef | undefined {
  return Object.hasOwn(ROOMS, id) ? ROOMS[id] : undefined;
}
