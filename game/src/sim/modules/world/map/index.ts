/**
 * The deterministic map engine (public API). See README.md in this folder.
 *
 *   const world = getStaticWorld();                 // bundled geography, built once and memoized
 *   const cell = cellAt(world, settlement.pos);
 *   const path = findSeaPath(world, portOf(world, 'kolvik')!.cell, target, { karvi: true, blockedZones });
 *
 * Self-contained: it imports only @content/world, the bundled balance table (default overland speeds) and its own
 * files, so it can move to a shared folder. Pure and deterministic: no Map/Set, no transcendental Math.
 */
import { getGeography, type Geography } from '@content/world';
import { buildStaticWorld } from './build';
import type { StaticWorld } from './model';

export * from './model';
export { ALT_LANDMARKS, ALT_UNREACHED, altTableOf, buildAltTable, prepareSeaRouting, type AltTable } from './alt';
export { buildStaticWorld, buildGeoIndex, nearestCellWhere } from './build';
export { buildSeaLanes, laneDaysFrom, laneRoute, type LaneNode, type LaneRoute, type LaneWorld } from './lanes';
export {
  BUNDLED_LAND_SPEEDS,
  defaultPortageCost,
  findLandPath,
  findSeaPath,
  type GridPath,
  type LandPathOptions,
  type LandSpeeds,
  type SeaPathOptions,
  type StepCost,
} from './path';
export {
  angleOffWind,
  cellAt,
  cellCenter,
  cellDistance,
  cellIndex,
  cellXY,
  iceBlockedZones,
  isBeach,
  isCoastalLand,
  isLand,
  isNavigable,
  isSea,
  nearestBeachCell,
  nearestCoast,
  nearestLandCell,
  nearestNavigableCell,
  nearestSeaCell,
  portOf,
  provinceAt,
  provinceById,
  regionAt,
  seaZoneAt,
  terrainAt,
  zoneDirectionCost,
} from './query';
export { detachedProvincePieces, validateGeographyFull, validateWorld, type ProvincePiece } from './validate';

const cache: { geo: Geography; world: StaticWorld }[] = [];
const CACHE_LIMIT = 2;

/**
 * The static world for a geography (default: the bundled, validated pack), built on first use and memoized by
 * object identity (the two most recent geographies). Treat the result as immutable.
 */
export function getStaticWorld(geo: Geography = getGeography()): StaticWorld {
  for (const entry of cache) if (entry.geo === geo) return entry.world;
  const world = buildStaticWorld(geo);
  cache.unshift({ geo, world });
  if (cache.length > CACHE_LIMIT) cache.length = CACHE_LIMIT;
  return world;
}

/** Drops memoized worlds (tests, hot-reload of the geography in tools). */
export function clearStaticWorldCache(): void {
  cache.length = 0;
}
