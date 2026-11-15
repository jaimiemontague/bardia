/**
 * Static-world data model: cell codes, direction tables and the StaticWorld shape produced by buildStaticWorld.
 *
 * The static world is derived from the geography pack (src/content/world.ts) and never stored in GameState; it is
 * rebuilt deterministically (and memoized) whenever needed. Grids are row-major typed arrays of width × height
 * cells: cell index = y × width + x, cell (x, y) covers [x, x+1) × [y, y+1) in continuous cell coordinates.
 */
import type { Geography } from '@content/world';

// ---------------------------------------------------------------------------------------------
// Cell codes.

/** `kind` values. */
export const CELL_SEA = 0;
export const CELL_LAND = 1;
export const CELL_LAKE = 2;

/** `terrain` values for land cells (TERRAIN_CLASSES order in src/content/world.ts); water cells hold TERRAIN_NONE. */
export const TERRAIN_PLAIN = 0;
export const TERRAIN_FOREST = 1;
export const TERRAIN_HILLS = 2;
export const TERRAIN_MOUNTAIN = 3;
export const TERRAIN_MARSH = 4;
export const TERRAIN_NONE = 255;

/** `river` values (an overlay on land cells). */
export const RIVER_NONE = 0;
/** A stream or the unnavigable upper course of a river. */
export const RIVER_STREAM = 1;
/** Karvi and river boats may sail it (§8.8). */
export const RIVER_NAVIGABLE = 2;

/** `road` values (an overlay on land cells). */
export const ROAD_NONE = 0;
export const ROAD_TRACK = 1;
export const ROAD_IMPERIAL = 2;

/** `nav` bit flags: which vessels may enter a cell. */
export const NAV_SEA = 1;
/** Karvi-navigable water: sea, navigable lakes and navigable rivers. */
export const NAV_KARVI = 2;

/** `lakeOf` value of procedural (rule-generated) lakes; authored lakes hold their index in geo.lakes. */
export const LAKE_PROCEDURAL = -2;

// ---------------------------------------------------------------------------------------------
// Directions (8-neighbourhood). Index order: E, SE, S, SW, W, NW, N, NE.

export const DIR_DX: readonly number[] = [1, 1, 0, -1, -1, -1, 0, 1];
export const DIR_DY: readonly number[] = [0, 1, 1, 1, 0, -1, -1, -1];
/** Compass bearing of each direction of travel (0 = north, 90 = east; y grows southward). */
export const DIR_BEARING_DEG: readonly number[] = [90, 135, 180, 225, 270, 315, 0, 45];
/** Step length of each direction in cells. */
export const DIR_LEN: readonly number[] = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];

// ---------------------------------------------------------------------------------------------
// Derived records.

/** Axis-aligned cell bounds (inclusive). */
export interface CellBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ProvinceInfo {
  index: number;
  id: string;
  regionIndex: number;
  /** Land cells (lake cells inside the province are not counted). */
  landCells: number;
  /** Land cells with a 4-neighbour sea cell. */
  coastCells: number;
  bounds: CellBounds;
  /** Mean position of the land cells (continuous coordinates). */
  centroid: [number, number];
  /** Where to draw the name (geo label, else the land cell nearest the centroid). */
  labelAt: [number, number];
  /** Cell of the main anchor (the intended capital position). */
  anchorCell: number;
  /** Indices of provinces sharing a land border, ascending. */
  neighbours: number[];
  /** Indices of the sea zones this province's coast touches, ascending. */
  seaZones: number[];
}

export interface RegionInfo {
  index: number;
  id: string;
  landCells: number;
  bounds: CellBounds;
  /** Land cells that no region polygon covered (assigned to the nearest region; a hint for the cartographer). */
  unclaimedCells: number;
}

export interface SeaZoneInfo {
  index: number;
  id: string;
  cells: number;
  bounds: CellBounds;
}

export interface PortageInfo {
  index: number;
  id: string;
  /** Navigable-water cells at each end (karvi are hauled overland between them). */
  fromCell: number;
  toCell: number;
  /** False when an end is not on karvi-navigable water (a validation error). */
  valid: boolean;
}

/** The water cell a coastal or river settlement's ships use. */
export interface Port {
  index: number;
  settlementId: string;
  /** The settlement's own cell. */
  landCell: number;
  /** The water cell ships berth at (sea for 'sea' ports; navigable river/lake for 'river' ports). */
  cell: number;
  kind: 'sea' | 'river';
  /** Sea zone of the berth (sea ports) or −1 (river ports). */
  zone: number;
  /** Distance settlement → berth (cells). */
  distance: number;
  /** Reachable from the reference sea zone by any ship (sea ports only). */
  seaReachable: boolean;
  /** Reachable from the reference sea zone by karvi (rivers, lakes and portages allowed). */
  karviReachable: boolean;
}

/** A sea lane between two ports: a hint edge for economy, news and AI (§8.1 "sea-lanes"). */
export interface SeaLane {
  index: number;
  /** Port indices (a < b). */
  a: number;
  b: number;
  /** Approximate water distance in cells and km. */
  cells: number;
  km: number;
  /** Nominal travel days (build.lanes.nominalKmPerDay plus portage days). */
  days: number;
  /** Uses rivers, lakes or portages: only karvi and river boats. */
  karviOnly: boolean;
  /** Portages crossed. */
  portages: number;
}

export interface SeaLaneGraph {
  /** Node i is port i (`StaticWorld.ports[i]`; settlement ids in `nodes`). */
  nodes: string[];
  lanes: SeaLane[];
  /** Lane indices per node, ascending. */
  adjacency: number[][];
}

/** id → index lookups for the geography tables. */
export interface GeoIndex {
  landmass: Record<string, number>;
  province: Record<string, number>;
  region: Record<string, number>;
  seaZone: Record<string, number>;
  kingdom: Record<string, number>;
  river: Record<string, number>;
  lake: Record<string, number>;
  portage: Record<string, number>;
  settlement: Record<string, number>;
  site: Record<string, number>;
}

/**
 * The rasterised, analysed world. All arrays have `size` = width × height entries. Treat everything as read-only:
 * the object is memoized and shared.
 */
export interface StaticWorld {
  readonly geo: Geography;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly cellKm: number;
  /** CELL_SEA | CELL_LAND | CELL_LAKE. */
  readonly kind: Uint8Array;
  /** TERRAIN_* for land cells, TERRAIN_NONE for water. */
  readonly terrain: Uint8Array;
  /** Render relief 1–255 for land cells (0 for water). */
  readonly elevation: Uint8Array;
  /** ROAD_* overlay. */
  readonly road: Uint8Array;
  /** RIVER_* overlay. */
  readonly river: Uint8Array;
  /** Index into geo.rivers, or −1. */
  readonly riverOf: Int16Array;
  /** Index into geo.lakes, LAKE_PROCEDURAL, or −1. */
  readonly lakeOf: Int16Array;
  /** Index of the last geo.landmasses polygon covering the cell, or −1. */
  readonly landmassOf: Int16Array;
  /** 4-connected land component id (land and lake cells), or −1 for sea. */
  readonly landComponent: Int32Array;
  /** Index into geo.regions (land and lake cells), or −1. */
  readonly regionOf: Int16Array;
  /** Index into geo.provinces (land and lake cells; −1 on neutral land and at sea). */
  readonly provinceOf: Int16Array;
  /** Index into geo.seaZones for sea cells, or −1. */
  readonly zoneOf: Int16Array;
  /** Euclidean distance (cells) to the nearest cell of the other medium: land/lake → nearest sea, sea → nearest land. */
  readonly coastDist: Float32Array;
  /** NAV_* bit flags. */
  readonly nav: Uint8Array;
  /** 4-connected components of sea cells (all ships), or −1. */
  readonly seaComponent: Int32Array;
  /** Components of karvi-navigable water joined by portages, or −1. */
  readonly karviComponent: Int32Array;
  /** Cells per seaComponent id. */
  readonly seaComponentSize: number[];
  /** Components of the reference sea zone (build.referenceSeaZone). */
  readonly referenceSeaComponent: number;
  readonly referenceKarviComponent: number;
  /** Portage end cells per geo.portages entry. */
  readonly portages: PortageInfo[];
  /** Portage index at each end cell, or −1 (karvi pathfinding jumps between the ends). */
  readonly portageAt: Int16Array;
  readonly provinces: ProvinceInfo[];
  readonly regions: RegionInfo[];
  readonly seaZones: SeaZoneInfo[];
  /** One port per coastal or river-port settlement, in geo.settlements order. */
  readonly ports: Port[];
  /** Settlement id → port index. */
  readonly portOf: Record<string, number>;
  readonly lanes: SeaLaneGraph;
  readonly index: GeoIndex;
}
