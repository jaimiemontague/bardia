/**
 * The world geography pack (design §4.2, §8.1, §8.4, §8.8, §9.8, §32.1–§32.3): zod schemas, the bundled loader and
 * the reference/consistency checks that do not need the rasterised map.
 *
 * Files (src/content/data/world/):
 *   base.json                    grid, build parameters, landmasses, lakes, rivers, portages, terrain, sea zones,
 *                                regions and kingdoms (owned by the cartographer);
 *   regions/<pack>.json          { provinces, settlements, sites } for one group of regions (packs below). Region
 *                                authors fill `settlements` and `sites`; provinces come from the cartographer.
 *
 * Coordinates are navigation-grid cells (800 × 600, 1 cell = 5 km, x east, y south). A point [x, y] is continuous:
 * cell (i, j) covers [i, i+1) × [j, j+1), so [412.5, 160.5] is the centre of cell (412, 160).
 *
 * Regions own land in two ways: whole landmasses (islands, `RegionDef.landmasses`) and polygons that split shared
 * landmasses (the Northland between Skarnheim and Hvarnland; the continent between Corvaine, the Velkar rivers and
 * Saraleon). Provinces are cut from their region by nearest anchor; each province `anchor` is the intended capital
 * site (on the coast for harbour capitals), extra `anchors` shape the province.
 *
 * Spatial checks (settlements on land and inside their province, coastal flags, port reachability, coverage) need
 * the rasterised map and live in src/sim/modules/world/map/validate.ts; tools/validate-geography runs both.
 *
 * Content layer: imports only zod and relative paths (ARCHITECTURE.md §1). Names in this pack are proper nouns
 * (data), not UI text.
 */
import { z } from 'zod';
import baseJson from './data/world/base.json';
import albrennCaelJson from './data/world/regions/albrenn-cael.json';
import corvaineJson from './data/world/regions/corvaine.json';
import eastAndWestJson from './data/world/regions/east-and-west.json';
import homelandsJson from './data/world/regions/homelands.json';
import { CultureIdSchema, FaithIdSchema, SEASON_IDS, SettlementTierIdSchema } from './schemas/ids';

// ---------------------------------------------------------------------------------------------
// Vocabularies.

/** Land terrain classes (§8.1). Roads are a separate overlay (`terrain.roads`). */
export const TERRAIN_CLASSES = ['plain', 'forest', 'hills', 'mountain', 'marsh'] as const;
export type TerrainClass = (typeof TERRAIN_CLASSES)[number];

/** Wind strength classes (§8.4), weakest first. */
export const WIND_STRENGTHS = ['calm', 'light', 'fresh', 'strong', 'gale'] as const;
export type WindStrength = (typeof WIND_STRENGTHS)[number];

/** Month keys in calendar order (index 0 = Icebreak … 11 = Frostmoot; mirrors MONTHS in src/sim/core/time.ts). */
export const MONTH_KEYS = [
  'icebreak',
  'seedtide',
  'greening',
  'highsun',
  'hayfall',
  'ripening',
  'reaping',
  'slaughtermonth',
  'fogmonth',
  'yuledark',
  'wolfmonth',
  'frostmoot',
] as const;
export type MonthKey = (typeof MONTH_KEYS)[number];

/** Site kinds (§9.8; mirrors `SiteKinds` in src/sim/core/state.ts). */
export const SITE_KINDS = ['cave', 'barrow', 'tower', 'seaStack', 'shrine', 'wreck', 'ruinedHall', 'grove'] as const;
export type SiteKindId = (typeof SITE_KINDS)[number];

/** Sea-zone storm exposure (§31.3 zoneMod: open ocean 1.5, coastal 0.8). */
export const SEA_EXPOSURES = ['openOcean', 'coastal'] as const;
export type SeaExposure = (typeof SEA_EXPOSURES)[number];

/** Realm kinds (a subset of the sim's `FactionKinds` vocabulary). */
export const REALM_KINDS = ['kingdom', 'petty', 'realm', 'confederacy', 'empire', 'city'] as const;
export type RealmKind = (typeof REALM_KINDS)[number];

/** Render climates for regions (map colouring only). */
export const CLIMATES = ['polar', 'boreal', 'temperate', 'oceanic', 'warm', 'steppe', 'volcanic'] as const;
export type Climate = (typeof CLIMATES)[number];

/** The region packs (src/content/data/world/regions/<pack>.json). */
export const REGION_PACKS = ['homelands', 'albrenn-cael', 'corvaine', 'east-and-west'] as const;
export type RegionPackId = (typeof REGION_PACKS)[number];

// ---------------------------------------------------------------------------------------------
// Building blocks.

const finite = z.number().finite();
const positive = z.number().finite().positive();
const nonNeg = z.number().finite().min(0);

/** A content id: camelCase, starts with a lower-case letter. */
export const GeoIdSchema = z.string().regex(/^[a-z][A-Za-z0-9]*$/, 'ids are camelCase ([a-z][A-Za-z0-9]*)');
const Name = z.string().min(1).max(60);
const Notes = z.string().max(400);
const Tag = z.string().regex(/^[a-z][A-Za-z0-9]*$/);

/** A point [x, y] in continuous cell coordinates. */
export const PointSchema = z.tuple([finite, finite]);
export type Point = z.infer<typeof PointSchema>;
/** A closed polygon (the last vertex connects back to the first; do not repeat it). */
export const PolygonSchema = z.array(PointSchema).min(3);
export type Polygon = z.infer<typeof PolygonSchema>;
/** An open polyline. */
export const PolylineSchema = z.array(PointSchema).min(2);
export type Polyline = z.infer<typeof PolylineSchema>;

/**
 * Fractal perturbation (domain warp) applied to a polygon's or polyline's vertices after subdividing its edges:
 * each vertex moves by `amplitude` cells × a 2-D fBm vector field with base `wavelength` (cells), `octaves` layers
 * and `persistence` (amplitude ratio per octave). `amplitude: 0` disables it.
 */
export const NoiseSpecSchema = z
  .object({
    amplitude: nonNeg,
    wavelength: positive,
    octaves: z.number().int().min(1).max(8),
    persistence: z.number().finite().gt(0).max(1),
  })
  .strict();
export type NoiseSpec = z.infer<typeof NoiseSpecSchema>;
const NoiseOverride = NoiseSpecSchema.partial().strict();
/** Midpoint-displacement roughness (see BuildParams.fractal). */
const Roughness = z.number().finite().min(0).max(0.45);

// ---------------------------------------------------------------------------------------------
// base.json

export const GridSchema = z
  .object({ width: z.number().int().min(16).max(4096), height: z.number().int().min(16).max(4096), cellKm: positive })
  .strict();

export const BuildParamsSchema = z
  .object({
    /** Seed for every procedural layer (coast warp, terrain noise, border noise). Changing it changes the map. */
    seed: z.string().min(1),
    /** Default coastline perturbation for landmasses (overridable per landmass). */
    coast: NoiseSpecSchema,
    /** Default perturbation for lakes. */
    lakes: NoiseSpecSchema,
    /** Meander perturbation for rivers and roads (endpoints and shared vertices move consistently). */
    rivers: NoiseSpecSchema,
    roads: NoiseSpecSchema,
    /** Perturbation of region polygons (makes region borders through continuous land look natural). */
    regions: NoiseSpecSchema,
    /** Default perturbation of terrain-area polygons. */
    terrainAreas: NoiseSpecSchema,
    /**
     * Fractal detail by recursive midpoint displacement (applied before the warp): each edge's midpoint moves along
     * its normal by up to ±roughness × its length, recursively down to `minSegment` cells. Shared edges (region
     * borders, river joins) are displaced identically. 0 disables; ~0.2–0.3 looks natural.
     */
    fractal: z
      .object({
        coast: Roughness,
        lakes: Roughness,
        regions: Roughness,
        rivers: Roughness,
        roads: Roughness,
        terrainAreas: Roughness,
        minSegment: z.number().finite().min(0.5).max(8),
      })
      .strict(),
    /** Longest edge (cells) after subdivision, before the warp. */
    maxSegment: z.number().finite().min(0.25).max(8),
    /**
     * Province borders: land cells go to the nearest anchor of their region (Voronoi), measured between
     * domain-warped positions; this is the warp (amplitude in cells), which makes borders wander naturally.
     */
    provinceBorders: NoiseSpecSchema,
    /** Sea zone every port must be reachable from by sea (the Whale-Road), unless flagged landlocked. */
    referenceSeaZone: GeoIdSchema,
    /** A settlement is coastal when its cell is within this many cells of a sea cell. */
    coastalMaxCells: positive,
    /** A settlement flagged non-coastal must be at least this far from the sea (cells). */
    inlandMinCells: positive,
    /** A river port must be within this many cells of navigable river/lake water. */
    riverPortMaxCells: positive,
    /** How far (cells) port detection searches for the nearest sea cell. */
    portSearchRadius: z.number().int().min(1).max(32),
    /** Ports avoid enclosed sea pockets smaller than this many cells (noise artefacts) when a larger sea is in range. */
    minPortWaterCells: z.number().int().min(1),
    /** Every province needs at least this many land cells. */
    minProvinceCells: z.number().int().min(1),
    /** Minimum distance (cells) between any two settlements/sites. */
    minPointSpacing: nonNeg,
    /** A site may lie at most this many cells off land (wrecks on reefs, sea-stacks). */
    siteMaxSeaCells: nonNeg,
    /** Sea-lane graph parameters (nominal travel-day estimates for economy/news/AI). */
    lanes: z
      .object({
        /** A typical merchant day's run (km/day) for the nominal day estimates. */
        nominalKmPerDay: positive,
        /** Days added per portage crossed (§8.8: 2–6 days; the nominal estimate uses this). */
        portageDays: nonNeg,
        /** Drop a lane a→b when some a→c→b is at most this factor longer (and both legs are shorter). */
        pruneDetour: z.number().finite().min(1).max(2),
      })
      .strict(),
  })
  .strict();
export type BuildParams = z.infer<typeof BuildParamsSchema>;

export const LandmassSchema = z
  .object({
    id: GeoIdSchema,
    name: Name.optional(),
    kind: z.enum(['mainland', 'island']),
    polygon: PolygonSchema,
    /** Overrides of build.coast for this landmass; `false` disables perturbation (tiny islets). */
    noise: z.union([NoiseOverride, z.literal(false)]).optional(),
    /** Overrides build.fractal.coast (0 disables). */
    fractal: Roughness.optional(),
    notes: Notes.optional(),
  })
  .strict();
export type LandmassDef = z.infer<typeof LandmassSchema>;

export const LakeSchema = z
  .object({
    id: GeoIdSchema,
    name: Name.optional(),
    polygon: PolygonSchema,
    /** Karvi may sail it (it must touch a navigable river). */
    navigable: z.boolean(),
    noise: z.union([NoiseOverride, z.literal(false)]).optional(),
    /** Overrides build.fractal.lakes. */
    fractal: Roughness.optional(),
  })
  .strict();
export type LakeDef = z.infer<typeof LakeSchema>;

export const RiverSchema = z
  .object({
    id: GeoIdSchema,
    name: Name,
    /** Mouth first (in the sea, in a lake, or on a vertex of the river it joins), source last. */
    points: PolylineSchema,
    /** Karvi (and river boats) may enter it (§8.8). */
    navigable: z.boolean(),
    /** If set, only vertices 0..navigableTo (from the mouth) are navigable; the upper course is not. */
    navigableTo: z.number().int().min(1).optional(),
    /** Render width class (1 = stream, 3 = great river). */
    width: z.number().int().min(1).max(3),
  })
  .strict();
export type RiverDef = z.infer<typeof RiverSchema>;

export const PortageSchema = z
  .object({
    id: GeoIdSchema,
    name: Name,
    /** Both ends must be on navigable water (river/lake cells). Karvi are hauled overland between them. */
    from: PointSchema,
    to: PointSchema,
    /** §8.8: 2–6 days, 10 men per ship. */
    days: z.tuple([nonNeg, nonNeg]).refine(([lo, hi]) => lo <= hi, 'days: lo must be <= hi'),
    toll: z.boolean(),
  })
  .strict();
export type PortageDef = z.infer<typeof PortageSchema>;

export const TerrainAreaSchema = z
  .object({
    id: GeoIdSchema,
    terrain: z.enum(TERRAIN_CLASSES),
    polygon: PolygonSchema,
    noise: z.union([NoiseOverride, z.literal(false)]).optional(),
  })
  .strict();
export type TerrainAreaDef = z.infer<typeof TerrainAreaSchema>;

export const RoadSchema = z
  .object({ id: GeoIdSchema, name: Name.optional(), points: PolylineSchema, kind: z.enum(['imperial', 'track']) })
  .strict();
export type RoadDef = z.infer<typeof RoadSchema>;

export const TerrainSchema = z
  .object({
    /** Explicit areas, applied in order after the region noise rules (later areas win). */
    areas: z.array(TerrainAreaSchema),
    roads: z.array(RoadSchema),
  })
  .strict();

/**
 * Per-region terrain rule. For each land cell: e = fBm(elevation) + coastGain × min(distance to sea, coastCap);
 * e ≥ mountain → mountain, e ≥ hills → hills; otherwise m = fBm(moisture): m ≥ marsh → marsh, m ≥ forest → forest,
 * else plain. fBm values are in [0, 1]. Optional `lakes` scatters small procedural lakes (non-navigable) where a
 * third fBm field ≥ threshold, at least `minSeaDist` cells from the sea and never on mountains, anchors or rivers.
 */
export const TerrainRuleSchema = z
  .object({
    elevation: z
      .object({
        wavelength: positive,
        coastGain: finite,
        coastCap: nonNeg,
        hills: finite,
        mountain: finite,
      })
      .strict(),
    moisture: z.object({ wavelength: positive, forest: finite, marsh: finite }).strict(),
    lakes: z.object({ wavelength: positive, threshold: finite, minSeaDist: nonNeg }).strict().optional(),
  })
  .strict();
export type TerrainRule = z.infer<typeof TerrainRuleSchema>;

export const WindSchema = z
  .object({
    /** Prevailing direction the wind blows FROM, compass degrees (0 = from the north, 90 = from the east). */
    fromDeg: z.number().finite().min(0).lt(360),
    strength: z.enum(WIND_STRENGTHS),
    /** Typical spread of the seeded noise around the prevailing direction (degrees). */
    spreadDeg: z.number().finite().min(0).max(180),
  })
  .strict();
export type WindDef = z.infer<typeof WindSchema>;

const MonthDay = z.object({ month: z.enum(MONTH_KEYS), day: z.number().int().min(1).max(30) }).strict();
/** An inclusive ice period; it may wrap the year end (from Frostmoot to Icebreak). */
export const IcePeriodSchema = z.object({ from: MonthDay, to: MonthDay }).strict();
export type IcePeriod = z.infer<typeof IcePeriodSchema>;

export const SeaZoneSchema = z
  .object({
    id: GeoIdSchema,
    name: Name,
    exposure: z.enum(SEA_EXPOSURES),
    /** §31.3 storm zone modifier (open ocean 1.5, coastal 0.8). */
    stormMod: positive,
    /** §31.4 hidden-encounter base chance per day (0.02–0.06). */
    traffic: z.number().finite().min(0.02).max(0.06),
    winds: z.object(Object.fromEntries(SEASON_IDS.map((s) => [s, WindSchema])) as Record<(typeof SEASON_IDS)[number], typeof WindSchema>).strict(),
    ice: z.array(IcePeriodSchema),
    /** Relative weights of hidden-encounter types in this zone (§31.4). */
    encounterMix: z.object({ merchant: nonNeg, raider: nonNeg, patrol: nonNeg, fleet: nonNeg }).strict(),
    /** Seed points: sea cells are assigned to the zone of the geodesically nearest seed. */
    seeds: z.array(PointSchema).min(1),
    /** Optional explicit areas (sea cells inside are assigned to this zone before the seed flood). */
    polygons: z.array(PolygonSchema).optional(),
    /** Not connected to the Whale-Road by open sea (reached only by river, e.g. the Ember Sea). */
    riverAccessOnly: z.boolean().optional(),
    /** Label position for maps. */
    label: PointSchema,
  })
  .strict();
export type SeaZoneDef = z.infer<typeof SeaZoneSchema>;

export const RegionSchema = z
  .object({
    id: GeoIdSchema,
    name: Name,
    homeland: z.boolean(),
    /** A neutral area that belongs to no province (Thingey). */
    neutral: z.boolean(),
    culture: CultureIdSchema.nullable(),
    faith: FaithIdSchema.nullable(),
    climate: z.enum(CLIMATES),
    /**
     * Landmasses (ids) that belong wholly to this region (islands): their land is claimed before any region polygon
     * is applied. A landmass may be listed by one region only.
     */
    landmasses: z.array(GeoIdSchema).optional(),
    /**
     * Areas claimed by this region on land no `landmasses` entry claimed, in priority order across regions (the
     * first region listed wins overlaps). Used to split shared landmasses (the Northland, the continent).
     */
    polygons: z.array(PolygonSchema),
    terrain: TerrainRuleSchema,
    label: PointSchema,
  })
  .strict()
  .refine((r) => r.polygons.length > 0 || (r.landmasses?.length ?? 0) > 0, { message: 'a region needs polygons or landmasses', path: ['polygons'] });
export type RegionDef = z.infer<typeof RegionSchema>;

export const KingdomSchema = z
  .object({
    id: GeoIdSchema,
    name: Name,
    regionId: GeoIdSchema,
    kind: z.enum(REALM_KINDS),
    culture: CultureIdSchema,
    faith: FaithIdSchema,
    homeland: z.boolean(),
    /** Province holding the royal seat (coronation site, §10.8). */
    seatProvinceId: GeoIdSchema,
    /** Banner colour for maps (hex). */
    color: z.string().regex(/^#[0-9a-f]{6}$/),
  })
  .strict();
export type KingdomDef = z.infer<typeof KingdomSchema>;

export const GeographyBaseSchema = z
  .object({
    version: z.literal(1),
    grid: GridSchema,
    build: BuildParamsSchema,
    landmasses: z.array(LandmassSchema).min(1),
    lakes: z.array(LakeSchema),
    rivers: z.array(RiverSchema),
    portages: z.array(PortageSchema),
    terrain: TerrainSchema,
    seaZones: z.array(SeaZoneSchema).min(1),
    regions: z.array(RegionSchema).min(1),
    kingdoms: z.array(KingdomSchema),
  })
  .strict();
export type GeographyBase = z.infer<typeof GeographyBaseSchema>;

// ---------------------------------------------------------------------------------------------
// regions/<pack>.json

export const ProvinceSchema = z
  .object({
    id: GeoIdSchema,
    name: Name,
    regionId: GeoIdSchema,
    /** Realm the province belongs to at the start (null: unclaimed/uncolonized). */
    kingdomId: GeoIdSchema.nullable(),
    /** Counts for the High Seat (§32.1). */
    homeland: z.boolean(),
    /** Name of the capital settlement (null for uncolonized provinces; region authors create the settlement). */
    capital: Name.nullable(),
    /** false for the uncolonized frontier provinces (Isafold, Greenshore; §10.9). */
    colonized: z.boolean(),
    /** Main anchor: the capital's intended position. Province cells are assigned to the nearest anchor. */
    anchor: PointSchema,
    /** Extra anchors that shape the province (islands, long coasts). */
    anchors: z.array(PointSchema).optional(),
    /** Map label position (default: the province's centroid). */
    label: PointSchema.optional(),
    /** Default culture/faith for settlements here (null: uninhabited). */
    culture: CultureIdSchema.nullable(),
    faith: FaithIdSchema.nullable(),
    /** Gameplay tags: straits, iron, furs, lakes, ironBogs, gatewayEast, iceInIcebreak, emporium, portage, … */
    tags: z.array(Tag),
    /** Names of the key sites region authors must place (uncolonized provinces, §32.1). */
    keySites: z.array(Name).optional(),
    notes: Notes.optional(),
  })
  .strict();
export type ProvinceDef = z.infer<typeof ProvinceSchema>;

export const SettlementSchema = z
  .object({
    id: GeoIdSchema,
    name: Name,
    /** null only for settlements on a neutral isle (Thingey). */
    provinceId: GeoIdSchema.nullable(),
    tier: SettlementTierIdSchema,
    culture: CultureIdSchema,
    faith: FaithIdSchema,
    pos: PointSchema,
    /** Within build.coastalMaxCells of the sea (validated against the map); coastal settlements get a port. */
    coastal: z.boolean(),
    /** On a navigable river or lake (karvi port), e.g. Velkar river towns. */
    riverPort: z.boolean().optional(),
    /** Port intentionally unreachable from the Whale-Road by sea (validation exemption). */
    landlocked: z.boolean().optional(),
    /** Landmark art/description key hint for cities and capitals. */
    landmark: z.string().max(80).optional(),
    /** Patron saint of a cloister (lanternhouse), e.g. "St. Aoda's". */
    saint: Name.optional(),
    notes: Notes.optional(),
  })
  .strict();
export type SettlementDef = z.infer<typeof SettlementSchema>;

export const SiteSchema = z
  .object({
    id: GeoIdSchema,
    name: Name,
    kind: z.enum(SITE_KINDS),
    pos: PointSchema,
    /** Relic catalogue key when this is one of the relic sites (§21.2, §32.3). */
    relicKey: GeoIdSchema.optional(),
    notes: Notes.optional(),
  })
  .strict();
export type SiteDef = z.infer<typeof SiteSchema>;

export const RegionPackSchema = z
  .object({
    provinces: z.array(ProvinceSchema),
    settlements: z.array(SettlementSchema),
    sites: z.array(SiteSchema),
  })
  .strict();
export type RegionPack = z.infer<typeof RegionPackSchema>;

// ---------------------------------------------------------------------------------------------
// The merged geography.

/** base.json plus every region pack, merged (packs in REGION_PACKS order). */
export interface Geography extends GeographyBase {
  provinces: ProvinceDef[];
  settlements: SettlementDef[];
  sites: SiteDef[];
  /** Which pack each province/settlement/site id came from (tools and error messages). */
  packOf: Record<string, RegionPackId>;
}

/** Raw (unvalidated) inputs: base.json and the region packs. */
export interface RawGeography {
  base: unknown;
  packs: Record<RegionPackId, unknown>;
}

/** The JSON bundled with the game. */
export const RAW_GEOGRAPHY: RawGeography = {
  base: baseJson,
  packs: {
    homelands: homelandsJson,
    'albrenn-cael': albrennCaelJson,
    corvaine: corvaineJson,
    'east-and-west': eastAndWestJson,
  },
};

/** Thrown when the geography fails validation; `issues` lists `file: path: message` lines. */
export class GeographyValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Geography validation failed:\n  ${issues.join('\n  ')}`);
    this.name = 'GeographyValidationError';
  }
}

function zodIssues(file: string, error: z.ZodError): string[] {
  return error.issues.map((i) => `${file}: ${i.path.join('.') || '(root)'}: ${i.message}`);
}

/**
 * Parses and merges the raw geography without the cross-reference checks. Throws GeographyValidationError on
 * schema errors.
 */
export function parseGeography(raw: RawGeography = RAW_GEOGRAPHY): Geography {
  const issues: string[] = [];
  const base = GeographyBaseSchema.safeParse(raw.base);
  if (!base.success) issues.push(...zodIssues('world/base.json', base.error));
  const provinces: ProvinceDef[] = [];
  const settlements: SettlementDef[] = [];
  const sites: SiteDef[] = [];
  const packOf: Record<string, RegionPackId> = {};
  for (const pack of REGION_PACKS) {
    const parsed = RegionPackSchema.safeParse(raw.packs[pack]);
    if (!parsed.success) {
      issues.push(...zodIssues(`world/regions/${pack}.json`, parsed.error));
      continue;
    }
    for (const p of parsed.data.provinces) {
      provinces.push(p);
      packOf[`province:${p.id}`] = pack;
    }
    for (const s of parsed.data.settlements) {
      settlements.push(s);
      packOf[`settlement:${s.id}`] = pack;
    }
    for (const s of parsed.data.sites) {
      sites.push(s);
      packOf[`site:${s.id}`] = pack;
    }
  }
  if (issues.length > 0 || !base.success) throw new GeographyValidationError(issues);
  return { ...base.data, provinces, settlements, sites, packOf };
}

/** Result of a validation pass: errors fail the build, warnings are reported (e.g. unfinished packs). */
export interface GeographyReport {
  errors: string[];
  warnings: string[];
}

function duplicates(values: readonly string[]): string[] {
  const seen: Record<string, true> = {};
  const dups: string[] = [];
  for (const v of values) {
    if (Object.hasOwn(seen, v)) dups.push(v);
    else seen[v] = true;
  }
  return dups;
}

function indexById<T extends { id: string }>(rows: readonly T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const r of rows) out[r.id] = r;
  return out;
}

function inGrid(geo: GeographyBase, [x, y]: Point): boolean {
  return x >= 0 && y >= 0 && x < geo.grid.width && y < geo.grid.height;
}

function monthDayIndex(md: { month: MonthKey; day: number }): number {
  return MONTH_KEYS.indexOf(md.month) * 30 + (md.day - 1);
}

/**
 * True if the ice period covers the given calendar day (`monthIndex` 0–11, `day` 1–30). Periods may wrap the
 * year end (from > to).
 */
export function icePeriodCovers(period: IcePeriod, monthIndex: number, day: number): boolean {
  const d = monthIndex * 30 + (day - 1);
  const a = monthDayIndex(period.from);
  const b = monthDayIndex(period.to);
  return a <= b ? d >= a && d <= b : d >= a || d <= b;
}

/**
 * Cross-reference and consistency checks that do not need the map: unique ids and names, references between
 * provinces/regions/kingdoms/settlements, points inside the grid, river indices, cloister saints, capitals.
 */
export function checkGeographyReferences(geo: Geography): GeographyReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const where = (kind: string, id: string) => `world/regions/${geo.packOf[`${kind}:${id}`] ?? '?'}.json: ${kind} '${id}'`;

  const uniqueIds = (label: string, ids: string[]) => {
    for (const d of duplicates(ids)) errors.push(`${label}: duplicate id '${d}'`);
  };
  uniqueIds('landmasses', geo.landmasses.map((l) => l.id));
  uniqueIds('lakes', geo.lakes.map((l) => l.id));
  uniqueIds('rivers', geo.rivers.map((r) => r.id));
  uniqueIds('portages', geo.portages.map((p) => p.id));
  uniqueIds('terrain.areas', geo.terrain.areas.map((a) => a.id));
  uniqueIds('terrain.roads', geo.terrain.roads.map((r) => r.id));
  uniqueIds('seaZones', geo.seaZones.map((z) => z.id));
  uniqueIds('regions', geo.regions.map((r) => r.id));
  uniqueIds('kingdoms', geo.kingdoms.map((k) => k.id));
  uniqueIds('provinces', geo.provinces.map((p) => p.id));
  uniqueIds('settlements+sites', [...geo.settlements.map((s) => s.id), ...geo.sites.map((s) => s.id)]);
  for (const d of duplicates(geo.provinces.map((p) => p.name))) errors.push(`provinces: duplicate name '${d}'`);
  for (const d of duplicates(geo.settlements.map((s) => s.name))) errors.push(`settlements: duplicate name '${d}'`);
  for (const d of duplicates(geo.sites.map((s) => s.name))) errors.push(`sites: duplicate name '${d}'`);
  for (const d of duplicates(geo.seaZones.map((s) => s.name))) errors.push(`seaZones: duplicate name '${d}'`);
  for (const d of duplicates(geo.rivers.map((s) => s.name))) errors.push(`rivers: duplicate name '${d}'`);

  const regions = indexById(geo.regions);
  const kingdoms = indexById(geo.kingdoms);
  const provinces = indexById(geo.provinces);

  const checkPoints = (label: string, pts: readonly Point[]) => {
    pts.forEach((p, i) => {
      if (!inGrid(geo, p)) errors.push(`${label}: point ${i} [${p[0]}, ${p[1]}] is outside the ${geo.grid.width}×${geo.grid.height} grid`);
    });
  };
  for (const l of geo.landmasses) checkPoints(`landmass '${l.id}'`, l.polygon.map(([x, y]) => [Math.min(Math.max(x, 0), geo.grid.width - 0.001), Math.min(Math.max(y, 0), geo.grid.height - 0.001)] as Point));
  for (const l of geo.lakes) checkPoints(`lake '${l.id}'`, l.polygon);
  for (const z of geo.seaZones) {
    checkPoints(`seaZone '${z.id}' seeds`, z.seeds);
    checkPoints(`seaZone '${z.id}' label`, [z.label]);
  }
  const referenceZone = geo.seaZones.find((z) => z.id === geo.build.referenceSeaZone);
  if (referenceZone === undefined) errors.push(`build.referenceSeaZone: unknown sea zone '${geo.build.referenceSeaZone}'`);
  else if (referenceZone.riverAccessOnly === true) errors.push(`build.referenceSeaZone: '${referenceZone.id}' is river-access-only`);
  for (const r of geo.regions) checkPoints(`region '${r.id}' label`, [r.label]);
  const landmassIds = indexById(geo.landmasses);
  const landmassRegion: Record<string, string> = {};
  for (const r of geo.regions) {
    for (const id of r.landmasses ?? []) {
      if (!Object.hasOwn(landmassIds, id)) errors.push(`region '${r.id}': unknown landmass '${id}'`);
      else if (Object.hasOwn(landmassRegion, id)) errors.push(`region '${r.id}': landmass '${id}' already belongs to region '${landmassRegion[id]}'`);
      else landmassRegion[id] = r.id;
    }
  }
  for (const p of geo.portages) checkPoints(`portage '${p.id}'`, [p.from, p.to]);
  for (const r of geo.rivers) {
    if (r.navigableTo !== undefined) {
      if (!r.navigable) errors.push(`river '${r.id}': navigableTo set on a non-navigable river`);
      if (r.navigableTo >= r.points.length) errors.push(`river '${r.id}': navigableTo ${r.navigableTo} ≥ point count ${r.points.length}`);
    }
  }

  for (const k of geo.kingdoms) {
    if (!Object.hasOwn(regions, k.regionId)) errors.push(`kingdom '${k.id}': unknown region '${k.regionId}'`);
    const seat = provinces[k.seatProvinceId];
    if (seat === undefined) errors.push(`kingdom '${k.id}': unknown seat province '${k.seatProvinceId}'`);
    else if (seat.kingdomId !== k.id) errors.push(`kingdom '${k.id}': seat province '${seat.id}' belongs to '${String(seat.kingdomId)}'`);
  }

  const provinceCountByRegion: Record<string, number> = {};
  for (const p of geo.provinces) {
    const at = where('province', p.id);
    const region = regions[p.regionId];
    if (region === undefined) errors.push(`${at}: unknown region '${p.regionId}'`);
    else {
      provinceCountByRegion[p.regionId] = (provinceCountByRegion[p.regionId] ?? 0) + 1;
      if (region.neutral) errors.push(`${at}: region '${region.id}' is neutral and cannot hold provinces`);
      if (region.homeland !== p.homeland) errors.push(`${at}: homeland flag ${p.homeland} differs from region '${region.id}' (${region.homeland})`);
    }
    if (p.kingdomId !== null) {
      const k = kingdoms[p.kingdomId];
      if (k === undefined) errors.push(`${at}: unknown kingdom '${p.kingdomId}'`);
      else if (k.regionId !== p.regionId) errors.push(`${at}: kingdom '${k.id}' is in region '${k.regionId}', not '${p.regionId}'`);
    }
    if (p.colonized && p.capital === null) errors.push(`${at}: a colonized province needs a capital name`);
    if (!p.colonized && p.kingdomId !== null) errors.push(`${at}: an uncolonized province cannot belong to a kingdom`);
    if ((p.culture === null) !== (p.faith === null)) errors.push(`${at}: culture and faith must both be set or both null`);
    checkPoints(at, [p.anchor, ...(p.anchors ?? []), ...(p.label === undefined ? [] : [p.label])]);
  }
  for (const r of geo.regions) {
    if (!r.neutral && (provinceCountByRegion[r.id] ?? 0) === 0) errors.push(`region '${r.id}': no provinces`);
  }

  // Settlements and sites (filled by the region authors).
  const settlementsByProvince: Record<string, SettlementDef[]> = {};
  for (const s of geo.settlements) {
    const at = where('settlement', s.id);
    checkPoints(at, [s.pos]);
    if (s.provinceId !== null) {
      if (!Object.hasOwn(provinces, s.provinceId)) errors.push(`${at}: unknown province '${s.provinceId}'`);
      else (settlementsByProvince[s.provinceId] ??= []).push(s);
    }
    if (s.tier === 'cloister' && s.saint === undefined) errors.push(`${at}: a cloister needs a saint`);
    if (s.tier !== 'cloister' && s.saint !== undefined) errors.push(`${at}: only cloisters have a saint`);
    if (s.riverPort === true && s.coastal) warnings.push(`${at}: both coastal and riverPort; the sea port is used`);
  }
  for (const s of geo.sites) checkPoints(where('site', s.id), [s.pos]);

  if (geo.settlements.length === 0) warnings.push('settlements: none yet (region authors fill the packs)');
  for (const p of geo.provinces) {
    const list = settlementsByProvince[p.id] ?? [];
    if (geo.settlements.length > 0 && p.colonized && list.length === 0) warnings.push(`${where('province', p.id)}: no settlements yet`);
    if (p.capital !== null && list.length > 0 && !list.some((s) => s.name === p.capital)) {
      errors.push(`${where('province', p.id)}: capital '${p.capital}' is not a settlement in this province`);
    }
  }
  return { errors, warnings };
}

/**
 * Parses, merges and cross-checks a geography. Throws GeographyValidationError on schema or reference errors
 * (warnings are ignored here; tools/validate-geography prints them).
 */
export function loadGeography(raw: RawGeography = RAW_GEOGRAPHY): Geography {
  const geo = parseGeography(raw);
  const report = checkGeographyReferences(geo);
  if (report.errors.length > 0) throw new GeographyValidationError(report.errors);
  return geo;
}

let bundled: Geography | undefined;

/** The bundled geography, validated once and memoized (treat it as immutable). */
export function getGeography(): Geography {
  bundled ??= loadGeography(RAW_GEOGRAPHY);
  return bundled;
}
