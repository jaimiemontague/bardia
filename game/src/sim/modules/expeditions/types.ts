/**
 * Expeditions augmentations of the kernel types (ARCHITECTURE.md §4) and the module's public contracts
 * (design §6.1, §8.3–§8.7, SCR-07 Expedition Planner).
 *
 * STATE: the `fleets` slice is this module's (the world module moves fleets along their routes). The player's
 * current expedition is `state.player.expeditionFleetId`; `state.expeditions` keeps the last plan ("Repeat
 * last"), per-fleet starvation counters and the land parties ashore (army → its fleet).
 *
 * THE MARCH (a land expedition, owner play-test 2026-11-14): the player sets out from home on foot. It reuses the
 * fleet-plus-land-party machinery: the expedition is a fleet record with no ships (`fleet.overland`, its baggage:
 * food, silver, trade goods and plunder, the leaders' roll, voyage days and morale) whose men all march as its
 * land party (the war-band, an army the player steers). The baggage record always stands where the war-band is.
 */
import type { ArmyId, CharId, FactionId, FleetId, FleetIntent, GoodId, MapPos, SettlementId, ShipId, ShipTypeId, TextVars, UnitTypeId } from '@sim/core/state';
import type { SteerDir } from '../world/types';

/** What the player's steer command holds: a compass heading, or 'stop' (heave to / halt). */
export type SteerOrder = SteerDir | 'stop';

/** How an expedition travels: by sea in ships (the default), or overland on foot (the march). */
export type TravelMode = 'sea' | 'land';

/** What the Expedition Planner sends (SCR-07). */
export interface ExpeditionPlan {
  /** The holding the expedition sets out from (default: the capital). */
  fromId?: SettlementId;
  /** The leader first; the others sail as lieutenants. */
  leaderIds: CharId[];
  shipIds: ShipId[];
  men: Partial<Record<UnitTypeId, number>>;
  /** Rations loaded (count; 1 per man per day): from the house storehouse at the capital, else the holding's food stores. */
  rations: number;
  /** Trade goods loaded from the house storehouse at the capital (tons). */
  cargo?: Partial<Record<GoodId, number>>;
  /** Silver taken from the treasury to trade abroad. */
  silver?: number;
  intent?: FleetIntent;
  /** 'land': a march overland (no ships; the men carry everything). Default 'sea'. */
  travel?: TravelMode;
}

/** One finding of the planner's inline validation (no pop-ups, SCR-07). */
export interface ExpeditionIssue {
  severity: 'error' | 'warning';
  /** Locale key `expeditions.issue.<code>`. */
  code: string;
  vars?: TextVars;
}

/** The planner's live preview of a plan. */
export interface ExpeditionPreview {
  ok: boolean;
  issues: ExpeditionIssue[];
  fromId: SettlementId | null;
  men: number;
  crewMin: number;
  crewMax: number;
  cargoTons: number;
  cargoCapacity: number;
  /** Rations the holding can spare, and how many days the planned rations last. */
  rationsAvailable: number;
  rationDays: number;
  /** Garrison left at home and the recommended minimum (max(20, 5 % of pop)). */
  homeGarrison: number;
  homeGarrisonMin: number;
  /** Monthly wages and ship upkeep of the expedition. */
  upkeepPerMonth: number;
  /** How the plan travels. */
  travel: TravelMode;
  /** The most rations the plan can take: what the holds leave free (sea) or what the men can carry (land). */
  rationsCapacity: number;
}

/** The module's root slice. */
export interface ExpeditionsState {
  version: number;
  lastPlan?: ExpeditionPlan;
  /** Consecutive days at 0 rations, per fleet. */
  starving: Record<FleetId, number>;
  /** Land parties ashore: army → the fleet it came from. */
  landParties: Record<ArmyId, FleetId>;
}

/** `spawnFleet` (§19.1; AI raids and merchants, storylets): a new fleet of new or existing ships. */
export interface SpawnFleetEffect {
  ownerId?: FactionId;
  /** New ships of these types (built for the owner), and/or existing ships (moved into the fleet). */
  shipTypes?: ShipTypeId[];
  shipIds?: ShipId[];
  men: Partial<Record<UnitTypeId, number>>;
  /** Leader (default: the owner's ruler). */
  leaderId?: CharId;
  /** Where it appears: a settlement's harbour or a map position. */
  settlementId?: SettlementId;
  pos?: MapPos;
  rations?: number;
  silver?: number;
  cargo?: Partial<Record<GoodId, number>>;
  intent?: FleetIntent;
  /** Sail at once for a target (world's computeRoute). */
  to?: { settlementId: SettlementId } | { x: number; y: number };
  /** Echoed in FleetSpawned. */
  tag?: string;
}

/**
 * Why an expedition was lost (it could no longer sail; the survivors came home at once):
 *   shipsLost  no ship of the fleet is left afloat (foundered, sunk or taken)
 *   noCrew     ships remain but no man is left aboard to work them (and no party is ashore)
 *   noWayHome  no harbour of the house can be reached by sea, and not because of ice
 *   vanished   the fleet record is gone (defensive: another module removed it)
 *   noMen      a march: no man of the war-band is left standing (killed, starved, the war-band gone)
 */
export type ExpeditionLostCause = 'shipsLost' | 'noCrew' | 'noWayHome' | 'vanished' | 'noMen';

/** Why the expedition cannot take an order right now (`expeditionBlock`; the HUD greys the order out). */
export type ExpeditionBlock = 'noShips' | 'noCrew' | 'noLeader' | 'noMen';

/** A march's baggage marker (`fleet.overland`): the fleet has no ships and its men march as its land party. */
export interface OverlandBaggage {
  /** Tons the war-band can carry now (men × march.carryTonsPerMan): rations, trade goods and plunder together. */
  carryT: number;
}

declare module '@sim/core/state' {
  interface GameState {
    expeditions?: ExpeditionsState;
  }
  interface Fleet {
    /** Bound for the home port after `returnHome`: the expedition stands down on arrival. */
    homeward?: boolean;
    /** The holding a homeward fleet stands down at when it is not the capital (the capital cannot be reached). */
    homewardTo?: SettlementId;
    /**
     * A march (a land expedition): this fleet record is the war-band's baggage and has no ships. Settlements (the
     * Cargo window) and economy read `carryT` as the hold's capacity.
     */
    overland?: OverlandBaggage;
  }
}

declare module '@sim/core/commands' {
  interface CommandMap {
    /** Validates a plan and keeps it as the "Repeat last" template (no men, ships or silver move). */
    planExpedition: ExpeditionPlan;
    /**
     * Musters the expedition: ships, men, rations, cargo and silver leave the holding as one fleet; with
     * `travel: 'land'` the men march out as a war-band carrying the rest (no ships).
     */
    launchExpedition: ExpeditionPlan;
    /** Sets a course (world's computeRoute) for the expedition, or another of the player's fleets. */
    setRoute: { fleetId?: FleetId; to: { settlementId: SettlementId } | { siteId: string } | { x: number; y: number }; avoidStorms?: boolean };
    /** Lands a party at the nearest beach; a ship-guard stays with the fleet (§8.7). */
    makeLandfall: { fleetId?: FleetId; shipGuard?: number };
    /** The land party marches back to its ships (always available, L12). */
    returnToShips: { armyId?: ArmyId };
    /** Sails home and stands the expedition down there (men to the garrison, silver to the treasury, goods to the storehouse). */
    returnHome: { fleetId?: FleetId };
    /**
     * The player steers directly (world's steerEntity): the expedition fleet, or the war-band ashore when one is
     * (or the army named). Sent only when the held direction changes; cancels a set course and a homecoming.
     */
    steer: { dir: SteerOrder; fleetId?: FleetId; armyId?: ArmyId };
  }
}

declare module '@sim/core/events' {
  interface EventMap {
    ExpeditionLaunched: { fleetId: FleetId; fromId: SettlementId; men: number; ships: number; travel?: 'land'; armyId?: ArmyId };
    /** The expedition stood down at home with what it brought back. */
    ExpeditionReturned: { fleetId: FleetId; atId: SettlementId; silver: number; goods: Partial<Record<GoodId, number>>; men: number; rations?: number };
    FleetSpawned: { fleetId: FleetId; ownerId: FactionId; tag?: string };
    LandfallMade: { fleetId: FleetId; armyId: ArmyId; men: number };
    PartyReturned: { fleetId: FleetId; armyId: ArmyId; men: number };
    /** A fleet ran out of rations (each day it starves). */
    FleetStarving: { fleetId: FleetId; days: number; deaths: number };
    /**
     * The expedition could no longer sail and was lost; the survivors came home at once (an ExpeditionReturned
     * for the stand-down follows). `menLost` are the men this rule took (not those the storm or battle killed).
     */
    ExpeditionLost: { fleetId: FleetId; cause: ExpeditionLostCause; atId?: SettlementId; survivors: number; menLost: number; silverLost: number; tonsLost: number };
    /** No one is left to lead the expedition: the crews turned for home on their own. */
    ExpeditionLeaderless: { fleetId: FleetId };
  }
}

declare module '@sim/core/effects' {
  interface EffectMap {
    spawnFleet: SpawnFleetEffect;
  }
}
