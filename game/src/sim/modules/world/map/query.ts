/**
 * Read helpers over a StaticWorld: cell/coordinate conversion, what is at a point, nearest coast/sea/land
 * searches, seasonal ice closures and a directional (wind) cost builder for findSeaPath.
 */
import { icePeriodCovers, TERRAIN_CLASSES, type Point, type ProvinceDef, type RegionDef, type SeaZoneDef, type TerrainClass } from '@content/world';
import { nearestCellWhere } from './build';
import { CELL_LAND, CELL_SEA, DIR_BEARING_DEG, NAV_KARVI, NAV_SEA, TERRAIN_MOUNTAIN, TERRAIN_NONE, type Port, type StaticWorld } from './model';
import type { StepCost } from './path';

/** Cell index of integer cell coordinates, or −1 outside the grid. */
export function cellIndex(world: StaticWorld, x: number, y: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= world.width || y >= world.height) return -1;
  return y * world.width + x;
}

/** Cell containing a continuous point [x, y], or −1 outside the grid. */
export function cellAt(world: StaticWorld, p: Readonly<Point>): number {
  return cellIndex(world, Math.floor(p[0]), Math.floor(p[1]));
}

/** Integer coordinates of a cell. */
export function cellXY(world: StaticWorld, cell: number): [number, number] {
  const x = cell % world.width;
  return [x, (cell - x) / world.width];
}

/** Centre of a cell in continuous coordinates. */
export function cellCenter(world: StaticWorld, cell: number): [number, number] {
  const x = cell % world.width;
  return [x + 0.5, (cell - x) / world.width + 0.5];
}

export function isSea(world: StaticWorld, cell: number): boolean {
  return cell >= 0 && cell < world.size && world.kind[cell] === CELL_SEA;
}

export function isLand(world: StaticWorld, cell: number): boolean {
  return cell >= 0 && cell < world.size && world.kind[cell] === CELL_LAND;
}

/** Navigable by the vessel: any ship → sea only; karvi → sea, navigable rivers and lakes. */
export function isNavigable(world: StaticWorld, cell: number, karvi = false): boolean {
  return cell >= 0 && cell < world.size && ((world.nav[cell] as number) & (karvi ? NAV_KARVI : NAV_SEA)) !== 0;
}

/** Land cell with a 4-neighbour sea cell. */
export function isCoastalLand(world: StaticWorld, cell: number): boolean {
  if (!isLand(world, cell)) return false;
  const W = world.width;
  const x = cell % W;
  const k = world.kind;
  return (x > 0 && k[cell - 1] === CELL_SEA) || (x < W - 1 && k[cell + 1] === CELL_SEA) || (cell >= W && k[cell - W] === CELL_SEA) || (cell + W < world.size && k[cell + W] === CELL_SEA);
}

/** A beach (§8.7 "Make Landfall at any beach cell"): coastal land that is not mountain. */
export function isBeach(world: StaticWorld, cell: number): boolean {
  return isCoastalLand(world, cell) && world.terrain[cell] !== TERRAIN_MOUNTAIN;
}

/** Terrain class of a land cell, undefined for water. */
export function terrainAt(world: StaticWorld, cell: number): TerrainClass | undefined {
  if (cell < 0 || cell >= world.size) return undefined;
  const t = world.terrain[cell] as number;
  return t === TERRAIN_NONE ? undefined : TERRAIN_CLASSES[t];
}

/** Province definition at a cell (land or lake), undefined at sea, on neutral land or off the grid. */
export function provinceAt(world: StaticWorld, cell: number): ProvinceDef | undefined {
  if (cell < 0 || cell >= world.size) return undefined;
  const p = world.provinceOf[cell] as number;
  return p < 0 ? undefined : world.geo.provinces[p];
}

export function regionAt(world: StaticWorld, cell: number): RegionDef | undefined {
  if (cell < 0 || cell >= world.size) return undefined;
  const r = world.regionOf[cell] as number;
  return r < 0 ? undefined : world.geo.regions[r];
}

export function seaZoneAt(world: StaticWorld, cell: number): SeaZoneDef | undefined {
  if (cell < 0 || cell >= world.size) return undefined;
  const z = world.zoneOf[cell] as number;
  return z < 0 ? undefined : world.geo.seaZones[z];
}

/** Province definition by content id. */
export function provinceById(world: StaticWorld, id: string): ProvinceDef | undefined {
  const i = world.index.province[id];
  return i === undefined ? undefined : world.geo.provinces[i];
}

/** The port of a settlement (coastal or river port), if it has one. */
export function portOf(world: StaticWorld, settlementId: string): Port | undefined {
  const i = world.portOf[settlementId];
  return i === undefined ? undefined : world.ports[i];
}

/** Nearest sea cell within `radius` cells (Euclidean; ties → lower index), or −1. */
export function nearestSeaCell(world: StaticWorld, cell: number, radius = 16): number {
  return nearestCellWhere(world.width, world.height, cell, radius, (i) => world.kind[i] === CELL_SEA);
}

/** Nearest land cell within `radius` cells, or −1. */
export function nearestLandCell(world: StaticWorld, cell: number, radius = 16): number {
  return nearestCellWhere(world.width, world.height, cell, radius, (i) => world.kind[i] === CELL_LAND);
}

/** Nearest beach (coastal, non-mountain land) within `radius` cells, or −1. */
export function nearestBeachCell(world: StaticWorld, cell: number, radius = 16): number {
  return nearestCellWhere(world.width, world.height, cell, radius, (i) => isBeach(world, i));
}

/** Nearest cell navigable by the vessel within `radius` cells, or −1 (snaps a click or a settlement to water). */
export function nearestNavigableCell(world: StaticWorld, cell: number, karvi = false, radius = 16): number {
  const bit = karvi ? NAV_KARVI : NAV_SEA;
  return nearestCellWhere(world.width, world.height, cell, radius, (i) => ((world.nav[i] as number) & bit) !== 0);
}

/** Nearest coast to a point: the closest sea cell and the closest beach, with the distance (cells) to the sea. */
export function nearestCoast(world: StaticWorld, p: Readonly<Point>, radius = 32): { sea: number; beach: number; distance: number } {
  const c = cellAt(world, p);
  const sea = nearestSeaCell(world, c, radius);
  const beach = nearestBeachCell(world, sea === -1 ? c : sea, radius);
  const distance = c < 0 ? Infinity : world.kind[c] === CELL_SEA ? 0 : (world.coastDist[c] as number);
  return { sea, beach, distance };
}

/** Straight-line distance between two cells in cells. */
export function cellDistance(world: StaticWorld, a: number, b: number): number {
  const [ax, ay] = cellXY(world, a);
  const [bx, by] = cellXY(world, b);
  return Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
}

/**
 * Sea zones closed by ice on a calendar day (`monthIndex` 0–11, `day` 1–30): `blocked[zoneIndex]`, ready for
 * SeaPathOptions.blockedZones (§8.4: the Rimesea Frostmoot–Icebreak, the Gray Firth the first 10 days of Icebreak).
 */
export function iceBlockedZones(world: StaticWorld, monthIndex: number, day: number): boolean[] {
  return world.geo.seaZones.map((z) => z.ice.some((p) => icePeriodCovers(p, monthIndex, day)));
}

/**
 * Angle in degrees (0–180) between a heading (DIR_* index) and the direction the wind blows FROM: 0 = straight
 * into the wind (in irons), 180 = dead downwind (running).
 */
export function angleOffWind(windFromDeg: number, dir: number): number {
  const heading = DIR_BEARING_DEG[dir] as number;
  let d = Math.abs((((heading - windFromDeg) % 360) + 360) % 360);
  if (d > 180) d = 360 - d;
  return d;
}

/**
 * A cost hook from a per-zone, per-direction multiplier table (`table[zone × 8 + dir]`), e.g. 1 / wind factor
 * for each point of sail computed from balance.sailing. Cells outside any zone (rivers, lakes) use `fallback`.
 */
export function zoneDirectionCost(world: StaticWorld, table: ArrayLike<number>, fallback = 1): StepCost {
  const zoneOf = world.zoneOf;
  return (to, _from, dir) => {
    const z = zoneOf[to] as number;
    return z < 0 ? fallback : (table[z * 8 + dir] as number);
  };
}
