# The map engine (`src/sim/modules/world/map`)

Pure, deterministic TypeScript that turns the geography pack (`src/content/data/world/**`, schema and loader in
`src/content/world.ts`) into a rasterised, analysed **static world**: land, lakes, terrain, rivers, roads, regions,
provinces, sea zones, a coast-distance field, navigation masks, ports and a sea-lane graph, plus A\* routing over it.
The static world is **never stored in GameState**: it is rebuilt from the pack (same pack → identical arrays) and
memoized. No `Map`/`Set`, no `Math.random`/`Date`, no engine-dependent `Math.*` (only `+ − × ÷ sqrt floor ceil`).

Import it from the world module as `./map` (or `@sim/modules/world/map/index` from tools and the client). Other
modules may only `import type` across module folders (ARCHITECTURE.md §1): they reach map data through effects,
events, condition functions and state the world module maintains, or receive a `StaticWorld` from the world module.

```ts
import { getStaticWorld, findSeaPath, portOf, iceBlockedZones, cellAt } from './map';
const world = getStaticWorld();                                   // bundled pack, built once (~0.25 s) and memoized
const from = portOf(world, 'kolvik')!.cell;                       // a settlement's berth (sea or river port)
const to = cellAt(world, [612.5, 360.5]);
const path = findSeaPath(world, from, to, { karvi: true, blockedZones: iceBlockedZones(world, month, day) });
// path: { cells, cost, length (cells), km, portages, expansions } | null
```

## Coordinates and grids

* Grid 800 × 600 cells, 1 cell = 5 km (one league), x east, y south. A point `[x, y]` is continuous; cell `(i, j)`
  covers `[i, i+1) × [j, j+1)`; cell index = `y × width + x`. `cellAt(world, [x, y])`, `cellXY`, `cellCenter`.
* Every grid in `StaticWorld` is a typed array of `size = width × height` entries. Treat all of it as read-only.

| field | type | meaning |
|---|---|---|
| `kind` | `Uint8Array` | `CELL_SEA` 0, `CELL_LAND` 1, `CELL_LAKE` 2 |
| `terrain` | `Uint8Array` | land: `TERRAIN_PLAIN` 0, `FOREST` 1, `HILLS` 2, `MOUNTAIN` 3, `MARSH` 4; water: `TERRAIN_NONE` 255 |
| `elevation` | `Uint8Array` | render relief 1–255 on land, 0 on water |
| `road` | `Uint8Array` | `ROAD_NONE`, `ROAD_TRACK`, `ROAD_IMPERIAL` |
| `river`, `riverOf` | `Uint8Array`, `Int16Array` | `RIVER_NONE`, `RIVER_STREAM`, `RIVER_NAVIGABLE` (karvi); index into `geo.rivers` |
| `lakeOf` | `Int16Array` | index into `geo.lakes`, `LAKE_PROCEDURAL` (−2) or −1 |
| `landmassOf`, `landComponent` | `Int16Array`, `Int32Array` | last covering landmass; 4-connected land+lake component |
| `regionOf`, `provinceOf` | `Int16Array` | indices into `geo.regions` / `geo.provinces` (land and lake cells; −1 at sea, on neutral land) |
| `zoneOf` | `Int16Array` | index into `geo.seaZones` for sea cells, else −1 |
| `coastDist` | `Float32Array` | exact Euclidean distance (cells) land/lake → nearest sea, sea → nearest land |
| `nav` | `Uint8Array` | bit flags `NAV_SEA` (every ship) and `NAV_KARVI` (sea + navigable rivers and lakes) |
| `seaComponent`, `karviComponent` | `Int32Array` | 4-connected components (karvi ones joined across portages) |
| `portageAt` | `Int16Array` | portage index at a portage end cell, else −1 |

Summaries: `provinces: ProvinceInfo[]` (land/coast cell counts, bounds, centroid, `labelAt`, `anchorCell`,
`neighbours` (land borders), `seaZones` touched), `regions: RegionInfo[]`, `seaZones: SeaZoneInfo[]`,
`portages: PortageInfo[]`, `ports: Port[]` + `portOf: Record<settlementId, portIndex>`, `lanes: SeaLaneGraph`,
`index: GeoIndex` (id → index for landmasses, provinces, regions, seaZones, kingdoms, rivers, lakes, portages,
settlements, sites), `referenceSeaComponent` / `referenceKarviComponent` (the Whale-Road's), `geo` (the pack).

## Building

```ts
getStaticWorld(geo?: Geography): StaticWorld          // memoized by object identity (two most recent); default: bundled pack
clearStaticWorldCache(): void
buildStaticWorld(geo: Geography): StaticWorld         // unmemoized, pure
buildGeoIndex(geo: Geography): GeoIndex
```

Pipeline (`build.ts`): landmass polygons get fractal midpoint displacement (shared edges stay shared) and an fBm
domain warp, then an even-odd scanline fill; authored lakes are cut in. Regions claim their `landmasses` (islands)
wholesale, then their polygons (first listed wins; region seams get fractal detail only over land); stray land joins
the nearest region; an island ≥ 97 % one region becomes all that region. Terrain = per-region elevation/moisture fBm
rules, softly biased by the terrain areas, plus procedural lakes; rivers and roads are traced 4-connected. Provinces:
nearest anchor (Voronoi between domain-warped positions) within the cell's region, preferring anchors on the same
land component; each main anchor cell is forced to its province; a contiguity pass gives detached pieces to the
neighbour they share the longest border with (islands keep their nearest province). Sea zones: zone polygons, then a
geodesic flood from the seeds. Then nav masks, components, ports and the sea-lane graph.

## Queries (`query.ts`)

```ts
cellIndex(world, x: number, y: number): number                       // −1 off-grid / non-integer
cellAt(world, p: Point): number
cellXY(world, cell): [number, number]
cellCenter(world, cell): [number, number]
cellDistance(world, a, b): number                                    // straight line, cells
isSea(world, cell) / isLand(world, cell): boolean
isNavigable(world, cell, karvi = false): boolean
isCoastalLand(world, cell): boolean                                  // land with a 4-neighbour sea cell
isBeach(world, cell): boolean                                        // coastal land that is not mountain (§8.7 landfall)
terrainAt(world, cell): TerrainClass | undefined
provinceAt(world, cell): ProvinceDef | undefined
regionAt(world, cell): RegionDef | undefined
seaZoneAt(world, cell): SeaZoneDef | undefined
provinceById(world, id): ProvinceDef | undefined
portOf(world, settlementId): Port | undefined
nearestSeaCell(world, cell, radius = 16): number                     // −1 if none within radius
nearestLandCell(world, cell, radius = 16): number
nearestBeachCell(world, cell, radius = 16): number
nearestNavigableCell(world, cell, karvi = false, radius = 16): number // snap a click or settlement to water
nearestCoast(world, p: Point, radius = 32): { sea: number; beach: number; distance: number }
nearestCellWhere(width, height, cell, radius, ok: (i) => boolean): number   // generic ring search, ties → lower index
iceBlockedZones(world, monthIndex: 0–11, day: 1–30): boolean[]       // per sea zone; for SeaPathOptions.blockedZones
angleOffWind(windFromDeg, dir: DIR_* index): number                  // 0 = into the wind … 180 = dead downwind
zoneDirectionCost(world, table: ArrayLike<number>, fallback = 1): StepCost  // table[zone × 8 + dir] multipliers
```

Directions: `DIR_DX`, `DIR_DY`, `DIR_BEARING_DEG` (compass bearing of travel), `DIR_LEN` (1 or √2); index order
E, SE, S, SW, W, NW, N, NE. Month index 0 = Icebreak … 11 = Frostmoot (`MONTH_KEYS` in `@content/world`).

## Routing (`path.ts`, `alt.ts`)

```ts
findSeaPath(world, from: number, to: number, options?: SeaPathOptions): GridPath | null
findLandPath(world, from: number, to: number, options?: LandPathOptions): GridPath | null
defaultPortageCost(world): number            // cell-steps: build.lanes.portageDays × nominal cells per day
prepareSeaRouting(world): void               // builds the landmark table now (≈0.14 s) instead of on the first query
BUNDLED_LAND_SPEEDS: LandSpeeds              // balance.overland.terrain (sim code passes ctx.balance.overland.terrain)

interface SeaPathOptions {
  karvi?: boolean;                // rivers, navigable lakes and portage jumps (§8.8)
  cost?: StepCost;                // (to, from, dir) => multiplier ≥ 0; Infinity blocks (wind, danger, storms)
  costField?: ArrayLike<number>;  // per-cell multiplier; Infinity blocks
  blockedZones?: readonly boolean[];  // e.g. iceBlockedZones(...)
  shoalPenalty?: number;          // multiplier on sea cells with coastDist ≤ 1.5 (deep-draught ships)
  minCostMultiplier?: number;     // lower bound of all multipliers if hooks return < 1 (default 1)
  heuristicWeight?: number;       // > 1: weighted A* (faster, may be suboptimal)
  portageCost?: number;           // cell-steps per portage (default defaultPortageCost)
  maxExpansions?: number;         // give up → null
  landmarks?: boolean;            // landmark lower bound (default true; never changes the cost found)
}
interface LandSpeeds { plain; forest; hills; marsh; road; mountain? }   // speed factors; ≤ 0 or missing mountain = impassable
interface LandPathOptions { speeds?: LandSpeeds; cost?: StepCost; costField?: ArrayLike<number>; heuristicWeight?; maxExpansions? }
interface GridPath { cells: number[]; cost: number; length: number; km: number; portages: number[]; expansions: number }
type StepCost = (to: number, from: number, dir: number) => number;
```

* 8-neighbour moves, never cutting a corner (both orthogonal neighbours must be passable).
* Sea cost = Σ step length × multipliers (cells). Without hooks `cost === length`. Land cost = Σ step length ÷ speed
  ("plain cells"): days = cost × cellKm ÷ (balance.overland.kmPerDay × other factors). Roads give at least the road
  speed; lakes and the sea block land paths.
* Results are optimal for the given costs (A\* with an admissible, consistent heuristic: octile distance and, for sea
  paths, landmark bounds from `alt.ts`). Equal-cost ties resolve deterministically.
* Not re-entrant: shared scratch buffers; a cost hook must not start another query (it throws).
* Performance (Node, the bundled map): build ≈ 0.2–0.3 s; sea queries between random ports ≈ 1–2 ms on average,
  p95 ≈ 7 ms, worst ≈ 10 ms; the landmark table costs ≈ 0.14 s once per world.

## Ports and sea lanes (`lanes.ts`)

A coastal settlement's port is its nearest sea cell (within `build.portSearchRadius`, preferring seas of at least
`build.minPortWaterCells` cells); a `riverPort` settlement's port is the nearest navigable river/lake cell within
`build.riverPortMaxCells`. `Port = { index, settlementId, landCell, cell, kind: 'sea' | 'river', zone, distance,
seaReachable, karviReachable }`.

```ts
world.lanes: SeaLaneGraph   // { nodes: settlementId[] (node i = port i), lanes: SeaLane[], adjacency: laneIndex[][] }
// SeaLane = { index, a, b, cells, km, days, karviOnly, portages }
laneDaysFrom(graph, from: number, karvi = false): Float64Array      // nominal days to every node (Infinity: unreachable)
laneRoute(graph, from: number, to: number, karvi = false): LaneRoute | null   // { nodes, lanes, days, km }
buildSeaLanes(world: LaneWorld, nodes: LaneNode[]): SeaLaneGraph    // custom node sets (tools, provisional ports)
```

Lanes join ports whose water catchments touch (one multi-source flood over the sea, one over karvi water with
portages); `days = km ÷ build.lanes.nominalKmPerDay + portages × build.lanes.portageDays`; long lanes nearly matched by
a two-leg detour are pruned (`build.lanes.pruneDetour`). They are hints for economy, news and AI, not fleet routes.

## Validation (`validate.ts`) and tools

```ts
validateGeographyFull(geo): { report: { errors: string[]; warnings: string[] }; world: StaticWorld | undefined }
validateWorld(world): GeographyReport          // spatial checks only
detachedProvincePieces(world): ProvincePiece[] // { province, cell, cells, touchesOtherLand }
```

Checks: every province has ≥ `build.minProvinceCells` land cells and owns its anchor; no province spills across a
border; settlements on land, in their province, `coastal` consistent with the distance to the sea, ports reachable
from the Whale-Road by sea (karvi for river ports and Ember Sea ports; `landlocked: true` exempts others); sites on
land (or just offshore); no two points closer than `build.minPointSpacing`; sea zones connected as declared;
navigable rivers and lakes connected to the sea; portages on navigable water. Schema and reference checks (unique ids
and names, kingdoms, capitals, saints) live in `src/content/world.ts`.

* `npm run tool -- validate-geography [--strict] [--quiet]` — schema, references and the spatial checks.
* `npm run tool -- map-preview [--scale n] [--region id | --bbox x0,y0,x1,y1] [--layers overview,terrain,provinces,seazones|all] [--grid n] [--no-labels]`
  — PNGs in `tools/out/` (terrain with relief, rivers, roads, borders, anchors, settlements, sites; political map;
  sea zones with winds, ice, ports and lanes; provisional lanes from coastal anchors until settlements exist).

## For region authors

Fill `settlements` and `sites` in `src/content/data/world/regions/<pack>.json` (schemas `SettlementSchema`,
`SiteSchema` in `src/content/world.ts`). Each province's `anchor` is the intended capital site — for harbour capitals
it sits within 1–2 cells of the sea (or beside its navigable river), so a capital placed at the anchor validates as
coastal with a reachable port. Keep settlements ≥ 2.5 cells apart, mark `coastal: true` within 3 cells of the sea
(inland ones must be ≥ 2 cells away), `riverPort: true` for Velkar river towns, a `saint` for every cloister. Run the
validator and the preview after each batch.
