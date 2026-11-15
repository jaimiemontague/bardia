/**
 * Shared types of the world-map renderer (SCR-12, design §8.10, §25.4, §27.1).
 *
 * The renderer is split into pure, unit-tested builders (camera math, label declutter, overlay data, scene
 * extraction from GameState, rasters, border geometry, hit tests) and the Pixi/React layers that draw their output.
 * Coordinates are navigation-grid cells (800 × 600, 1 cell = 5 km = 1 league; x east, y south) unless a name says
 * `screen` (CSS pixels inside the map viewport).
 */
import type { CultureId, FaithId, SettlementTierId, EconomyStateId } from '@content/schemas/ids';
import type { ArmyId, FactionId, FleetId, FleetIntent, FleetMode, SettlementId, SiteId, SiteKind, WindStrength } from '@sim/core/state';

/** A continuous point in cell coordinates. */
export type Vec2 = readonly [number, number];

/** The map modes (§8.10): pluggable overlays with a legend. */
export const MAP_MODES = ['political', 'relations', 'economy', 'intelAge', 'tradeRoutes', 'faith'] as const;
export type MapModeId = (typeof MAP_MODES)[number];

/** Named zoom levels (§8.10). */
export const ZOOM_BANDS = ['world', 'region', 'local'] as const;
export type ZoomBand = (typeof ZOOM_BANDS)[number];

/** Knowledge layers (§8.2): what the player's house knows of a cell. */
export const KNOW_UNKNOWN = 0;
export const KNOW_CHARTED = 1;
export const KNOW_VISITED = 2;
export type KnowledgeLevel = typeof KNOW_UNKNOWN | typeof KNOW_CHARTED | typeof KNOW_VISITED;

/** Culture families used for settlement icon styles (one icon set per family, §27.2 "~40 settlement icons"). */
export const ICON_STYLES = ['north', 'west', 'south', 'east'] as const;
export type IconStyle = (typeof ICON_STYLES)[number];

/** Fleet icon kinds (§8.6: merchant, raider, patrol, war fleet, envoy ship, Lantern Muster; plus own and colony). */
export const FLEET_ICON_KINDS = ['expedition', 'merchant', 'raider', 'patrol', 'war', 'envoy', 'muster', 'colony'] as const;
export type FleetIconKind = (typeof FLEET_ICON_KINDS)[number];

/** A settlement on the map: from GameState, from the geography pack, or a province capital still to be authored. */
export interface SettlementMarker {
  /** Stable key (`s:<settlementId>`, `g:<geoId>` or `c:<provinceId>`). */
  key: string;
  name: string;
  tier: SettlementTierId;
  culture: CultureId;
  faith: FaithId;
  pos: Vec2;
  cell: number;
  /** Geography province index under the settlement (−1: none). */
  provinceIndex: number;
  settlementId?: SettlementId;
  /** Geography settlement id (or the province id for a synthetic capital). */
  geoId?: string;
  factionId?: FactionId;
  economy?: EconomyStateId;
  /** Held by the player's house. */
  isPlayer: boolean;
  /** The player's seat. */
  isHome: boolean;
  /** Seat of a province (geography capital or the state province's capital). */
  isProvinceCapital: boolean;
  coastal: boolean;
  /** Not in GameState or the geography pack yet: drawn from the province's planned capital (authoring aid). */
  synthetic: boolean;
}

export interface SiteMarker {
  key: string;
  name: string;
  kind: SiteKind;
  pos: Vec2;
  cell: number;
  siteId?: SiteId;
  geoId?: string;
  cleared: boolean;
}

export interface FleetMarker {
  id: FleetId;
  ownerId: FactionId;
  isPlayer: boolean;
  /** The player's current expedition. */
  isExpedition: boolean;
  pos: Vec2;
  /** Compass bearing of travel in degrees (0 = north, 90 = east), or null when unknown/at rest. */
  heading: number | null;
  /** Remaining waypoints (current position excluded). */
  route: Vec2[];
  /** Cumulative estimated days to reach each waypoint (same length as `route`). */
  legDays: number[];
  mode: FleetMode;
  intent?: FleetIntent;
  ships: number;
  men: number;
  kind: FleetIconKind;
  /** Owner banner colour (0xRRGGBB). */
  color: number;
  /** The crews are at the oars this hour (wind foul or calm). */
  rowing: boolean;
  /** The player is steering it (a held heading) rather than following a set course. */
  steered: boolean;
}

/** A war-band on land (the player's landing party). */
export interface BandMarker {
  id: ArmyId;
  isPlayer: boolean;
  pos: Vec2;
  /** Compass bearing of travel, or null at rest. */
  heading: number | null;
  steered: boolean;
  men: number;
  color: number;
}

export type StormSeverity = 'minor' | 'moderate' | 'severe';

export interface StormMarker {
  id: string;
  pos: Vec2;
  radius: number;
  severity: StormSeverity;
  /** Drift in cells per hour. */
  velocity: Vec2;
  untilHour: number;
  /** Not yet arrived: shown with forecast styling (dashed, faded). */
  forecast: boolean;
  /** Hours until the storm forms (forecast) or 0. */
  hoursAhead: number;
  /** Projected centre after 12, 24 and 48 hours (clipped to its lifetime). */
  track: Vec2[];
}

/** Wind at a sea zone (live weather, or the zone's seasonal prevailing wind when no weather is simulated yet). */
export interface WindSample {
  zoneIndex: number;
  /** Direction the wind blows FROM, compass degrees. */
  fromDeg: number;
  strength: WindStrength;
  fog: boolean;
  ice: boolean;
  source: 'live' | 'prevailing';
}

/** What the map shows, extracted from GameState (pure, defensive: missing slices give empty lists). */
export interface MapScene {
  hour: number;
  playerFactionId: FactionId | null;
  settlements: SettlementMarker[];
  sites: SiteMarker[];
  fleets: FleetMarker[];
  /** The player's war-bands ashore. */
  bands: BandMarker[];
  storms: StormMarker[];
  /** Per sea zone (index = geo.seaZones index). */
  winds: WindSample[];
  /** Where the player's attention is: the war-band ashore, else the expedition fleet, else the home seat (null when unknown). */
  focus: Vec2 | null;
}

/** A colour-coded legend row; every colour also carries an icon/glyph so meaning never relies on hue alone (§25.7). */
export interface LegendItem {
  /** Locale key of the label (with `vars`), or a literal name in `label`. */
  labelKey?: string;
  label?: string;
  vars?: Readonly<Record<string, string | number>>;
  color: number;
  /** Glyph drawn in the legend swatch. */
  glyph: LegendGlyph;
  /** Line sample instead of a fill swatch. */
  line?: 'solid' | 'dashed' | 'dotted';
}

export type LegendGlyph = 'none' | 'crown' | 'cross' | 'dot' | 'ring' | 'diamond' | 'triangle' | 'square' | 'star' | 'hatch' | 'wave' | 'eye';

/** A polyline drawn by an overlay (trade lanes, routes). */
export interface OverlayLine {
  points: Vec2[];
  color: number;
  /** Width in screen pixels. */
  width: number;
  alpha: number;
  dash?: 'dashed' | 'dotted';
}

/** Per-province fill of a map mode. */
export interface ProvinceFill {
  color: number;
  alpha: number;
  /** Hatched (no data / contested) — drawn as a pattern by the renderer. */
  hatch?: boolean;
}

/** The output of a map mode's data builder (pure). */
export interface OverlayData {
  mode: MapModeId;
  /** Index = geo.provinces index; null leaves the province untinted. */
  provinceFill: (ProvinceFill | null)[];
  /**
   * Owner key per province (index = geo.provinces index) used to draw realm borders between provinces of
   * different owners; null = unowned.
   */
  provinceOwner: (string | null)[];
  /** Owner key → border colour. */
  ownerColor: Readonly<Record<string, number>>;
  lines: OverlayLine[];
  legend: LegendItem[];
  /** Locale key of a note under the legend (e.g. "no intel yet"). */
  noteKey?: string;
  /** Strength of the inner-border wash (0 = flat tint, 1 = strong band along realm borders). */
  wash: number;
}

/** Something under the pointer or selected. */
export type MapTarget =
  | { kind: 'settlement'; key: string; name: string; settlementId?: SettlementId; geoId?: string; pos: Vec2; cell: number }
  | { kind: 'site'; key: string; name: string; siteId?: SiteId; geoId?: string; pos: Vec2; cell: number }
  | { kind: 'fleet'; fleetId: FleetId; pos: Vec2; cell: number }
  | { kind: 'storm'; stormId: string; pos: Vec2; cell: number }
  | { kind: 'sea'; pos: Vec2; cell: number; zoneId: string | null }
  | { kind: 'land'; pos: Vec2; cell: number; provinceId: string | null; regionId: string | null };

/** What the map selection callback receives. */
export type MapSelection = MapTarget;
