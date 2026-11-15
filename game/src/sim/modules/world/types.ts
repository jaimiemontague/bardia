/**
 * World module: kernel augmentations (ARCHITECTURE.md §4) and the module's public, state-resident contracts.
 * Every augmented field is OPTIONAL — core factories, older saves and other modules' tests build entities without
 * knowing about them. Other modules may `import type` from this file (they cannot import world runtime code).
 *
 * State the world module maintains for everyone:
 *   state.worldIndex   static geography digest (settlement → province/port/sea zone/lanes, provinces, realms);
 *   state.knowledge    the player's charted map (run-length rows) and visited settlements (§8.2);
 *   state.world        movement bookkeeping (the entities on the move, cached speed inputs).
 */
import type { ArmyId, FactionId, FleetId, Hour, MapPos, ProvinceId, SettlementId, SiteId } from '@sim/core/state';

// ---------------------------------------------------------------------------------------------
// Routes and movement.

/** Where a fleet or army is going (computeRoute `to`). */
export type RouteTarget = { settlementId: SettlementId } | { siteId: SiteId } | { x: number; y: number };

/** Why computeRoute could not produce a route (RouteFailed.reason). */
/** 'iced': only seasonal ice (§8, sea-zone ice months) closes the way; it opens when the ice breaks. */
export type RouteFailReason = 'unknownEntity' | 'invalidTarget' | 'noShips' | 'unreachable' | 'noStart' | 'iced';

/** A fleet or army on the move (state.world.movers). Speed inputs are cached daily and on computeRoute. */
export interface MoverState {
  kind: 'fleet' | 'army';
  /** Fleets: slowest sail and row speeds (knots) after per-ship hull factors (§31.2). */
  sailKn: number;
  rowKn: number;
  /** Fleets: (1 + seafaringSpeedBonus × party Seafaring) × crewFactor × speedMult. Armies: km per marching hour on plain. */
  mult: number;
  /** Karvi-only route allowed (every ship river-capable). */
  karvi: boolean;
  /** Owned by the player (sight-based charting, notifications). */
  player: boolean;
  /** Sight radius in cells by day (player entities; 0 otherwise). */
  sight: number;
  /** Night/fog multiplier of the sight radius (§31.4, with trait bonuses). */
  sightNight: number;
  /** Hour the cached inputs were computed. */
  refreshedHour: Hour;
  /** Cell of the last sight reveal (−1 none). */
  revealCell: number;
  /** Portages still ahead on the route, in order: reaching (x, y) starts a haul of `hours` to the next waypoint. */
  portages?: { x: number; y: number; hours: number; id: string }[];
}

/** Root slice `state.world` (movement bookkeeping). */
export interface WorldState {
  version: number;
  /** Entities with a route, keyed by fleet/army id (iteration order = insertion order). */
  movers: Record<string, MoverState>;
  /**
   * Landfall by touch (re-arm rule): per mover id, the places (settlement ids, or the expedition's fleet id for a
   * war-band ashore) whose touch radius the mover lies inside right now. A place in this list cannot trigger again
   * until the mover has left its radius. Only the player's expedition fleet and steered player armies have one.
   */
  touch?: Record<string, string[]>;
}

/** The eight compass headings the player steers by (north = up; y grows southward). */
export type SteerDir = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** steerEntity: hold a heading (or 'stop': heave to / halt). Cancels any route; a later computeRoute cancels it. */
export interface SteerEntityEffect {
  entityId: FleetId | ArmyId;
  dir: SteerDir | 'stop';
}

// ---------------------------------------------------------------------------------------------
// The world index (static geography digest kept in state for modules that cannot import the map engine).

/** A travel link from one settlement to another within the lane horizon. */
export interface Lane {
  to: SettlementId;
  /** Nominal days by sea between the two ports (null: no sea route). */
  seaDays: number | null;
  /** Nominal days overland (null: not on the same landmass). */
  landDays: number | null;
  /** The sea route needs karvi (rivers, lakes or portages). */
  karvi?: true;
}

/** Geography of one settlement. */
export interface SettlementGeo {
  /** Geography content id ('' for settlements founded during play). */
  geoId: string;
  provinceId: ProvinceId;
  regionId: string;
  /** Navigation-grid cell of the settlement. */
  cell: number;
  /** Water cell its ships berth at (−1: no harbour). */
  port: number;
  portKind: 'sea' | 'river' | null;
  /** Sea zone of the berth (null for river ports and inland settlements). */
  seaZoneId: string | null;
  /** The harbour is reachable from the Whale-Road only by karvi (rivers, portages, the Ember Sea). */
  karviOnly: boolean;
  /** Nearest settlements by travel days (sorted by the faster of the two). */
  lanes: Lane[];
}

/** Geography of one province. */
export interface ProvinceGeo {
  geoId: string;
  regionId: string;
  /** Realm (geography kingdom id) the province belongs to at the start, null if none. */
  kingdomId: string | null;
  homeland: boolean;
  colonized: boolean;
  /** Provinces sharing a land border. */
  neighbours: ProvinceId[];
  /** Provinces of the same region across a shared sea zone (islands). */
  seaNeighbours: ProvinceId[];
  /** Sea zones its coast touches. */
  seaZones: string[];
  coastal: boolean;
  /** The capital's intended position (geography anchor). */
  anchor: MapPos;
  tags: string[];
}

export interface KingdomGeo {
  name: string;
  regionId: string;
  /** Geography realm kind (kingdom, petty, realm, confederacy, empire, city). */
  kind: string;
  homeland: boolean;
  seatProvinceId: ProvinceId;
  provinceIds: ProvinceId[];
  /** Faction ruling the realm at the start. */
  factionId?: FactionId;
}

export interface RegionGeo {
  homeland: boolean;
  neutral: boolean;
  provinceIds: ProvinceId[];
}

export interface SeaZoneGeo {
  name: string;
  exposure: string;
  /** Sea cells in the zone (for charted %). */
  cells: number;
  /** Provinces whose coast touches the zone. */
  provinceIds: ProvinceId[];
}

/** Root slice `state.worldIndex`. Static after world generation (settlements founded later are added daily). */
export interface WorldIndex {
  version: number;
  /** Fingerprint of the geography the index was built from (rebuilt on load when it changes). */
  fingerprint: string;
  width: number;
  height: number;
  cellKm: number;
  settlements: Record<SettlementId, SettlementGeo>;
  provinces: Record<ProvinceId, ProvinceGeo>;
  regions: Record<string, RegionGeo>;
  kingdoms: Record<string, KingdomGeo>;
  seaZones: Record<string, SeaZoneGeo>;
  homelandProvinceIds: ProvinceId[];
  provinceByGeoId: Record<string, ProvinceId>;
  settlementByGeoId: Record<string, SettlementId>;
}

// ---------------------------------------------------------------------------------------------
// Knowledge (§8.2).

/** Root slice `state.knowledge`: the player's map. */
export interface KnowledgeState {
  version: number;
  width: number;
  height: number;
  /** Charted cells per row y: sorted, disjoint, half-open runs [x0, x1, x2, x3, …] (cells x0 ≤ x < x1 …). */
  charted: number[][];
  /** Settlements the player has visited → hour of the last visit. */
  visited: Record<SettlementId, Hour>;
  /** Charted sea cells per sea zone. */
  zoneCharted: Record<string, number>;
  /** Sea zones charted to `knowledge.zoneCompleteShare` (SeaZoneCharted already emitted). */
  zonesComplete: string[];
}

// ---------------------------------------------------------------------------------------------
// Events and effects.

/** Arrived: a fleet or army reached the end of its route (emitted by world only). */
export interface ArrivedEvent {
  fleetId?: FleetId;
  armyId?: ArmyId;
  /** Owner of the entity. */
  factionId: FactionId;
  /** Arrived at this settlement's harbour (fleets) or gates (armies). */
  settlementId?: SettlementId;
  siteId?: SiteId;
  /** Final position (cell coordinates). */
  cell: MapPos;
  /** The mover came within touch radius (landfall by touch) rather than reaching the end of a route. */
  touch?: true;
}

export interface ComputeRouteEffect {
  entityId: FleetId | ArmyId;
  to: RouteTarget;
  /** Route around known storm cells (state.weather.storms). */
  avoidStorms?: boolean;
  /** Docked/beached fleets set sail (default true). */
  depart?: boolean;
}

export interface RevealAreaEffect {
  x: number;
  y: number;
  /** Radius in cells (leagues). */
  radius: number;
}

export interface RevealSettlementEffect {
  settlementId: SettlementId;
  /** Charted radius around it (default knowledge.settlementRadius). */
  radius?: number;
  /** Also mark it visited (details known as of now). */
  visit?: boolean;
}

declare module '@sim/core/state' {
  interface GameOptions {
    /** Geography id of the starting jarldom (§5.1 step 8); default: a non-royal province of the player's culture. */
    startProvinceId?: string;
  }
  interface FactionKinds {
    /** The Kurgai khanate. */
    khanate: true;
    /** A Cael clan or a settler chieftaincy. */
    clan: true;
  }
  interface GameState {
    worldIndex?: WorldIndex;
    knowledge?: KnowledgeState;
    world?: WorldState;
  }
  interface Settlement {
    /** Geography content id of the settlement (landmark art, codex). */
    geoId?: string;
  }
  interface Province {
    geoId?: string;
    /** A neutral land (Thingey) that is not a real province. */
    neutral?: boolean;
  }
  interface Faction {
    /** Geography realm id the faction rules (seat factions) or belongs to. */
    kingdomId?: string;
    /** Province the faction's house comes from. */
    homeProvinceId?: ProvinceId;
    /** Neutral ground (Thingey): raiding it angers everyone. */
    neutral?: boolean;
  }
  interface Fleet {
    /** Sea zone of the fleet's position (null on rivers, lakes or land). */
    seaZoneId?: string | null;
    /** Expected arrival hour of the current route. */
    eta?: Hour;
    routeTarget?: RouteTarget;
    /** Sail through the night instead of beaching near the coast (§8.3 toggle). */
    sailThroughNight?: boolean;
    /** Rowing this hour (wind foul or calm). */
    rowing?: boolean;
    /** Hauling over a portage until this hour (§8.8). */
    portageUntil?: Hour;
    /** Relic/omen speed multiplier set by other modules (default 1). */
    speedMult?: number;
    /** The player holds this heading (steering); absent = not steered. */
    steer?: SteerDir;
  }
  interface Army {
    eta?: Hour;
    routeTarget?: RouteTarget;
    /** The player holds this heading (steering); absent = not steered. */
    steer?: SteerDir;
  }
}

declare module '@sim/core/events' {
  interface EventMap {
    Arrived: ArrivedEvent;
    /** computeRoute could not route the entity (its route is left empty). */
    RouteFailed: { entityId: string; reason: RouteFailReason };
    /** The player has charted a sea zone (§8.9: +Renown and XP are the saga module's to give). */
    SeaZoneCharted: { zoneId: string; share: number };
    /** A fleet starts hauling its ships over a portage. */
    PortageStarted: { fleetId: FleetId; portageId: string; untilHour: Hour };
  }
}

declare module '@sim/core/effects' {
  interface EffectMap {
    computeRoute: ComputeRouteEffect;
    steerEntity: SteerEntityEffect;
    revealArea: RevealAreaEffect;
    revealSettlement: RevealSettlementEffect;
  }
}
