/**
 * 'weather' simulation module (scheduler order 20).
 * Scope: Wind per sea zone (6-hourly with hourly interpolation), storm cells, seasonal ice (§8.4, §31.2-31.3).
 * Owns (src/sim/core/ownership.ts — implement exactly these; never another module's):
 *   events: StormWarning, StormHit
 *   state slices: weather
 * Tunables: src/content/data/tunables/weather.json (+ schemas/tunables/weather.ts), read as ctx.tunables.weather.
 * Strings/assets: src/content/locales/en/weather.json and src/content/assets/manifest/weather.json (prefix 'weather.').
 * Gate: npm run verify:module -- weather
 *
 * Module-owned additions (not in ownership.ts; reported to the integrator):
 *   events:        StormWeathered
 *   condition fns: stormNear, windStrength, foggy, iceBound, stormRisk, stormSeason
 *   state:         SeaZoneWeather.speed/rain/track, StormCell.intensity/peakIntensity/peakRadius/bornHour/
 *                  zoneId/met/warned, WeatherState.seq
 * Effects used (owned elsewhere): core addRations/addGoods/addSilver; military killMen, damageShip,
 * sinkShip (skipped while the military module is absent).
 *
 * How it works: wind per zone from the geography's seasonal regimes + seeded AR(1) noise, sampled
 * every `balance.sailing.windUpdateHours` and interpolated hourly (wind.ts); storm cells born per
 * zone at the §31.3 world rate and drifting downwind (storms.ts); each cell rolls once per fleet it
 * reaches, with the fleet-level §31.3 factor (rules.ts); warnings to the player's fleets within the
 * party's Seafaring horizon (systems.ts). ADR-002: storms are weather; omens and relics only change
 * odds through morale and know-how, and the strings report belief, never divine action.
 */
import { getContent } from '@content/index';
import type { Geography } from '@content/world';
import type { SimModule } from '@sim/core/module';
import { weatherConditionFns } from './conditions';
import { weatherInvariants } from './invariants';
import { dailyWeather, hourlyWeather, initWeather, migrateWeather } from './systems';
import { buildWeatherGeography, weatherGeography, type WeatherGeography } from './zones';
import './types';

export type { StormHitEvent, StormSeverity, WindTrack } from './types';
export { weatherConditionFns } from './conditions';
export { weatherInvariants } from './invariants';
export {
  fleetStormOutlook,
  stormCellsNear,
  stormIsDangerous,
  stormTrack,
  visibleStormCells,
  windAt,
  windInZone,
  type FleetStormOutlook,
  type PointQueryOptions,
  type StormNear,
  type WindReading,
} from './queries';
export { aboardIds, catchChance, effectiveSeafaring, partyInfo, warningHorizon, type PartyInfo } from './rules';
export { expectedSpawns, meanSweptArea, stormAt, stormEta, zoneDailyRate, type StormShape } from './storms';
export { angleOffWindDeg, normDeg, pointOfSail, strengthOf, windFactor, type PointOfSail } from './wind';
export { zoneAt, weatherGeography, type WeatherGeography, type WeatherZone } from './zones';

/** Options for building a weather module (tests may pass their own geography). */
export interface WeatherModuleOptions {
  /** Geography whose sea zones the weather runs on (default: the bundled pack, loaded lazily). */
  geography?: Geography;
}

/** Builds the weather module (the registry uses `module`, built with the bundled geography). */
export function createWeatherModule(options: WeatherModuleOptions = {}): SimModule {
  let own: WeatherGeography | undefined;
  const wg = (): WeatherGeography => {
    if (options.geography === undefined) return weatherGeography();
    own ??= buildWeatherGeography(options.geography);
    return own;
  };
  return {
    id: 'weather',
    order: 20,
    version: 1,
    init: (draft, ctx) => initWeather(draft, ctx, wg()),
    migrate: (draft, fromVersion, ctx) => migrateWeather(draft, fromVersion, ctx, wg()),
    systems: {
      hourly: (draft, ctx) => hourlyWeather(draft, ctx, wg()),
      daily: (draft, ctx) => dailyWeather(draft, ctx, wg()),
    },
    conditionFns: weatherConditionFns(wg),
    invariants: (state) => weatherInvariants(state, getTunables(), getWindHours()),
  };
}

function getTunables() {
  return getContent().tunables.weather;
}

function getWindHours(): number {
  return Math.max(1, getContent().balance.sailing.windUpdateHours);
}

export const module: SimModule = createWeatherModule();
