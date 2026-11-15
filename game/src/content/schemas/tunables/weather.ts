/**
 * Tunables owned by the 'weather' module: src/content/data/tunables/weather.json, read in sim code as
 * `ctx.tunables.weather`. The weather agent owns this file and the JSON; add keys to both (strict:
 * unknown keys are errors). The §31 formula tables stay in balance.json (frozen during the parallel
 * phase): the storm formula (`storms`: season base, zone/omen/relic/night multipliers, severity
 * split and shifts, founder chance, shelter, moderate losses, warning horizons, harsh winters) and
 * the 6-hour wind cadence (`sailing.windUpdateHours`). Each sea zone's prevailing winds, storm
 * modifier and ice months live in the geography pack (src/content/data/world/base.json).
 *
 * Everything here is a value the design leaves open (first guesses for the balance harness).
 */
import { z } from 'zod';
import { count, enumMap, nonNeg, num, prob } from '../common';
import { SEASON_IDS } from '../ids';

const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
const positive = z.number().finite().positive();

/** Wind strength classes (§8.4), weakest first (mirrors WIND_STRENGTHS in src/content/world.ts). */
export const WEATHER_WIND_STRENGTHS = ['calm', 'light', 'fresh', 'strong', 'gale'] as const;
/** How a fleet in a given mode meets a storm. */
export const STORM_EXPOSURES = ['exposed', 'sheltered', 'immune'] as const;
export type StormExposure = (typeof STORM_EXPOSURES)[number];

/** `[lo, hi]` with 0 < lo ≤ hi. */
const positiveRange = z.tuple([positive, positive]).refine(([lo, hi]) => lo <= hi, { message: 'range: lo must be <= hi' });
/** A share range `[lo, hi]` within [0, 1]. */
const shareRange = z.tuple([prob, prob]).refine(([lo, hi]) => lo <= hi, { message: 'range: lo must be <= hi' });

const WindSchema = strict({
  /** Mean speed (knots) of each prevailing strength class; the seeded noise scatters around it. */
  strengthKn: enumMap(WEATHER_WIND_STRENGTHS, nonNeg),
  /** Lowest speed (knots) of each class above calm; speeds below `light` are calm. Ascending. */
  classMinKn: strict({ light: positive, fresh: positive, strong: positive, gale: positive }),
  /** Coefficient of variation of the speed noise (speed = mean × (1 + speedCv × n), n ~ N(0, 1)). */
  speedCv: nonNeg,
  /** Hard cap on any wind speed (knots). */
  maxKn: positive,
  /** Correlation of the seeded noise between consecutive 6-hour samples (AR(1); 0 = white noise). */
  persistence: z.number().finite().min(0).lt(1),
  /** Days on each side of a season boundary over which the prevailing regimes blend. */
  seasonBlendDays: z.number().finite().min(0).max(45),
  /** Extra knots in a zone while a storm cell's centre is in it, × the cell's intensity. */
  stormBoostKn: nonNeg,
  /** Point queries inside a storm: at least Strong; Gale from this cell intensity up. */
  stormGaleIntensity: prob,
  /** Point queries inside a storm: the wind veers this many degrees (cyclonic turning). */
  stormVeerDeg: num,
});

const FogSchema = strict({
  /** Long-run share of 6-hour periods with fog, by season (before the wind multiplier). */
  season: enumMap(SEASON_IDS, prob),
  /** Fog likelihood multiplier by wind class (fog forms in still air and blows away in a gale). */
  strengthMult: enumMap(WEATHER_WIND_STRENGTHS, nonNeg),
  /** Chance that fog (or clear air) carries over to the next 6-hour period beyond the long-run share. */
  persistence: z.number().finite().min(0).lt(1),
});

const RainSchema = strict({
  /** Long-run share of 6-hour periods with rain or showers, by season. */
  season: enumMap(SEASON_IDS, prob),
  persistence: z.number().finite().min(0).lt(1),
});

const StormsSchema = strict({
  /** Peak radius of a cell (navigation cells, 5 km each). */
  radiusCells: positiveRange,
  /** Drift speed (cells per hour), downwind of the zone's wind at birth. */
  speedCellsPerHour: positiveRange,
  /** Lifetime (hours). */
  ttlHours: positiveRange,
  /** Peak intensity (0–1): drawn size of the danger, wind boost and a small severity shift. */
  intensity: shareRange,
  /** Spread of the drift direction around downwind (degrees, 1 σ). */
  dirSpreadDeg: nonNeg,
  /** A cell's track passes within this many cells of one of its zone's seed points. */
  spawnJitterCells: nonNeg,
  /** A cell is born this share of its track length upwind of that point (0.5: the point is mid-track). */
  upwindStartFrac: prob,
  /** Share of the lifetime spent growing to peak, and decaying at the end. */
  growFrac: prob,
  decayFrac: prob,
  /** Radius at birth and death as a share of the peak radius. */
  minRadiusFactor: prob,
  /** A cell weaker than this cannot catch a fleet (a dying squall). */
  minHitIntensity: prob,
  /**
   * Spawn calibration. Each zone spawns cells so that a point at sea meets new cells at the §31.3
   * rate `season × zone stormMod` per day; this corrects for cells drifting out of their zone.
   */
  coverageCalibration: positive,
  /** Hard cap on live cells. */
  maxCells: count,
  /** Cells further than this outside the map are dropped. */
  mapMarginCells: nonNeg,
  /** Severity shift toward severe for the strongest cells (and toward minor for the weakest): ± this × (2·intensity − 1). */
  intensitySevereShift: prob,
  /** A cell's drawn severity class by current intensity. */
  severityClass: strict({ moderate: prob, severe: prob }),
  /** AI fleets are checked against the cells every this many hours (the swept path is tested, so nothing slips through). */
  checkHours: z.number().int().min(1).max(24),
  /** Fastest any fleet moves (cells per hour); bounds the cheap pre-filter on positions. */
  maxFleetCellsPerHour: positive,
  /** Night (open-sea legs sailed through the night: balance storms.nightSailingMult). Hours of the day, wrapping. */
  nightStartHour: z.number().int().min(0).max(23),
  nightEndHour: z.number().int().min(0).max(23),
  /** Fleet mode → exposure (unknown modes are exposed). */
  modes: z.record(z.string(), z.enum(STORM_EXPOSURES)),
  /** Player fleets in these modes get no StormWarning (a fleet docked in harbour). */
  noWarningModes: z.array(z.string()),
  /** The flag the quests module sets while the player's house holds the Drowned Bell (balance storms.drownedBellMult). */
  drownedBellFlag: z.string().min(1),
  /** stormSeason() is true while the season's base storm chance is at least this. */
  stormSeasonMin: prob,
  /** Longest look-ahead (hours) for storm ETAs and visibility. */
  forecastMaxHours: z.number().int().min(1).max(240),
});

const MinorSchema = strict({
  /** Sail damage per ship as a share of its sail points. */
  sailDamagePct: shareRange,
});

const ModerateSchema = strict({
  sailDamagePct: shareRange,
  hullDamagePct: shareRange,
  /** Share of the rations spoiled or washed overboard (cargo uses balance storms.moderateCargoJettison). */
  rationsLossPct: prob,
  delayDays: nonNeg,
});

const SevereSchema = strict({
  sailDamagePct: shareRange,
  hullDamagePct: shareRange,
  menLostPct: shareRange,
  cargoLossPct: prob,
  rationsLossPct: prob,
  delayDays: nonNeg,
  /** Share of a foundered ship's men the surviving ships pull from the water (room permitting). */
  founderRescueShare: prob,
});

const ZoneSchema = strict({
  /** Sea cells of the zone in the rasterised map (checked against the map by weather's stats test). */
  areaCells: positive,
  /** Extra spawn multiplier for this zone (default 1). */
  spawnMult: nonNeg.optional(),
  /** Fog multiplier for this zone (default 1). */
  fogMult: nonNeg.optional(),
});

export const schema = strict({
  wind: WindSchema,
  fog: FogSchema,
  rain: RainSchema,
  storms: StormsSchema,
  consequences: strict({ minor: MinorSchema, moderate: ModerateSchema, severe: SevereSchema }),
  /** Per sea zone (geography id). */
  zones: z.record(z.string(), ZoneSchema),
  /** Area assumed for a zone missing from `zones` (a mod's new zone). */
  defaultZoneAreaCells: positive,
})
  .superRefine((t, ctx) => {
    const m = t.wind.classMinKn;
    if (!(m.light < m.fresh && m.fresh < m.strong && m.strong < m.gale)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'wind.classMinKn must ascend light < fresh < strong < gale', path: ['wind', 'classMinKn'] });
    }
    if (t.storms.severityClass.moderate > t.storms.severityClass.severe) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'storms.severityClass.moderate must be <= severe', path: ['storms', 'severityClass'] });
    }
    if (t.storms.growFrac + t.storms.decayFrac > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'storms.growFrac + decayFrac must be <= 1', path: ['storms', 'growFrac'] });
    }
  });
export type Tunables = z.infer<typeof schema>;
