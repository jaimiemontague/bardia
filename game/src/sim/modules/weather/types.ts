/**
 * Weather augmentations of the kernel types (ARCHITECTURE.md §4) and the weather module's public
 * contracts. Every augmented field is optional: core factories, old saves and other modules' tests
 * build these objects without knowing about them.
 *
 * State contract (what other modules read; `state.weather` is owned by this module):
 *   - `weather.zones[seaZoneId]` (geography sea-zone ids, e.g. 'whaleRoad'):
 *       `windDir`  direction the wind blows FROM, compass degrees [0, 360) (interpolated hourly);
 *       `windStr`  strength class calm | light | fresh | strong | gale;
 *       `speed`    wind speed in knots;
 *       `fog`, `rain`, `ice` (ice: the zone is closed by its geography ice months today).
 *   - `weather.storms[]` live storm cells: `pos` (navigation cells), `velocity` (cells per hour),
 *     `radius` (cells), `intensity` (0–1), `severity` (drawn class), `untilHour` (dies then).
 *     Position at a later hour h ≈ pos + velocity × (h − now) (see `stormAt` in storms.ts).
 * Events: StormWarning (to the player's fleets), StormHit (any fleet caught), StormWeathered.
 */
import type { FactionId, FleetId, Hour, MapPos, ShipId } from '@sim/core/state';

/** Storm outcome severity (§8.4, §31.3). */
export type StormSeverity = 'minor' | 'moderate' | 'severe';

/** The 6-hour keyframes a zone's wind is interpolated between (hourly, shortest arc). */
export interface WindTrack {
  /** Wind (from-direction, degrees; speed, knots) at `weather.lastUpdateHour`. */
  fromDir: number;
  fromKn: number;
  /** Wind at `weather.lastUpdateHour + windUpdateHours`. */
  toDir: number;
  toKn: number;
  /** AR(1) noise state behind the `to` sample (direction and speed, ~N(0, 1)). */
  nDir: number;
  nKn: number;
}

declare module '@sim/core/state' {
  interface SeaZoneWeather {
    /** Wind speed in knots (interpolated hourly with `windDir`; `windStr` is its class). */
    speed?: number;
    /** Rain or showers over the zone (always while a storm cell's centre is in it). */
    rain?: boolean;
    /** Interpolation keyframes (weather-internal bookkeeping). */
    track?: WindTrack;
  }
  interface StormCell {
    /** Current intensity 0–1 (grows, peaks, decays over the cell's life). */
    intensity?: number;
    peakIntensity?: number;
    /** Peak radius (cells); `radius` is the current one. */
    peakRadius?: number;
    bornHour?: Hour;
    /** Sea zone the cell was born in. */
    zoneId?: string;
    /** Fleets this cell has already resolved (each storm rolls once per fleet, §8.4). */
    met?: FleetId[];
    /** Player fleets already warned about this cell. */
    warned?: FleetId[];
  }
  interface WeatherState {
    /** Next storm-cell serial (ids are `storm_<n>`; kept here so weather never shifts entity ids). */
    seq?: number;
  }
}

/** One fleet caught by a storm (§31.3); `lost` when no ship survived. */
export interface StormHitEvent {
  fleetId: FleetId;
  ownerId: FactionId;
  stormId: string;
  severity: StormSeverity;
  /** The fleet was beached, docked or ashore: effects were reduced by balance storms.shelterAvoid. */
  sheltered: boolean;
  menLost: number;
  shipsLost: ShipId[];
  shipsDamaged: number;
  /** Share of the cargo jettisoned or lost (0–1). */
  cargoLostPct: number;
  rationsLost: number;
  silverLost: number;
  /** Time the fleet loses (the expeditions module holds it; §8.4 "+1 day" etc.). */
  delayHours: number;
  /** Every ship foundered: the fleet is gone. */
  lost: boolean;
  pos: MapPos;
  zoneId?: string;
}

declare module '@sim/core/events' {
  interface EventMap {
    /** A storm cell will reach one of the player's fleets within the warning horizon (§8.4). */
    StormWarning: {
      fleetId: FleetId;
      stormId: string;
      /** Hours until the cell reaches the fleet (if it holds its position). */
      etaHours: number;
      /** The horizon the party's Seafaring allows (24–48 h at Seafaring ≥ 4, else 12 h, + feats). */
      horizonHours: number;
      severity: StormSeverity;
      zoneId?: string;
      pos: MapPos;
    };
    /** A storm caught a fleet (any owner). */
    StormHit: StormHitEvent;
    /** A storm passed over a fleet without catching it. */
    StormWeathered: { fleetId: FleetId; ownerId: FactionId; stormId: string; sheltered: boolean };
  }
}
