/**
 * Tunables owned by the 'battle' module: src/content/data/tunables/battle.json, read in sim code as
 * `ctx.tunables.battle` (and by the pure engine through `content.tunables.battle`). The §31 formula
 * tables stay in balance.json (frozen during the parallel phase; `balance.battle`, `balance.squads`,
 * `balance.loot`, `balance.fortTiers`, `balance.autoresolve`); everything else the tactical engine
 * needs lives here: movement geometry, pathing budgets, map-template parameters, building kinds,
 * raid waves, night surprise, player-safety extras, loot carrying, XP and the pseudo-units (monks)
 * that balance.json does not define. Nothing here repeats a balance.json value.
 */
import { z } from 'zod';

const num = z.number().finite();
const nonNeg = z.number().finite().min(0);
const pos = z.number().finite().positive();
const prob = z.number().finite().min(0).max(1);
const count = z.number().int().min(0);
const intRange = z.tuple([count, count]).refine(([lo, hi]) => lo <= hi, 'range lo must be <= hi');
const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
const id = z.string().regex(/^[a-z][A-Za-z0-9]*$/);

const MAP_STYLES = ['north', 'albric', 'cael', 'corvani', 'velkar', 'kurgai', 'saraleonese'] as const;
const TEMPLATE_IDS = [
  'village',
  'town',
  'cityQuarter',
  'cloister',
  'fortress',
  'field',
  'forest',
  'riverCrossing',
  'beach',
  'caveMouth',
] as const;
const BUILDING_KINDS = [
  'longhall',
  'keep',
  'house',
  'storehouse',
  'church',
  'shrine',
  'barracks',
  'workshop',
  'stable',
  'granary',
  'tent',
  'cloisterHall',
  'boathouse',
] as const;
const templateId = z.enum(TEMPLATE_IDS);

/** A pseudo-unit the engine needs that balance.json does not define (same shape as a unit row). */
const ExtraUnitSchema = strict({
  name: z.string(),
  side: z.enum(['player', 'enemy', 'guardian', 'beast']),
  atk: nonNeg,
  def: nonNeg,
  speed: pos,
  morale: nonNeg,
  formations: z.array(z.enum(['line', 'shieldWall', 'wedge', 'loose'])).min(1),
  abilities: z.array(z.string()),
  /** Non-combatants surrender as soon as an enemy reaches them. */
  nonCombatant: z.boolean().optional(),
});

const BuildingKindSchema = strict({
  /** Footprint [w, h] in tiles before style scaling. */
  size: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
  /** 0..1 before the style multiplier. */
  flammability: prob,
  /** Relative share of the site's portable wealth held in this building's cache (0 = no cache). */
  lootWeight: nonNeg,
});

const TemplateSchema = strict({
  /** Map size override in tiles (default balance.battle.mapTiles). */
  size: z.tuple([z.number().int().min(24), z.number().int().min(24)]).optional(),
  houses: intRange,
  storehouses: intRange,
  extras: z.array(z.enum(BUILDING_KINDS)),
  /** Share of the map covered by woods / marsh, and the hill-noise share raised to hill height. */
  woods: prob,
  hills: prob,
  marsh: prob,
  /** Sea along the attackers' edge when the place is coastal. */
  coastal: z.boolean(),
  /** Chance that a river crosses the map. */
  river: prob,
  /** Half extents of the settlement core [rx, ry] in tiles (0 = no settlement). */
  core: z.tuple([count, count]),
  /** Street grid spacing in tiles (0 = main roads only). */
  streetSpacing: count,
  /** Default fort tier when the setup has none (cloister precinct wall, fortress ring). */
  minFortTier: z.number().int().min(0).max(4),
});

export const schema = strict({
  // ---- movement geometry ------------------------------------------------------------------
  /** Running speed multiplier over the walking speed (charge, rout, retreat, `run` orders). */
  runSpeedMult: pos,
  turnRateDegPerS: pos,
  /** Gap between footprints at which two squads are in melee contact. */
  meleeReachTiles: pos,
  /** Squads already in contact stay in it until their gap opens past meleeReachTiles × this (no flicker). */
  contactHoldMult: z.number().finite().min(1),
  /** A flanking enemy must draw off this far (gap, tiles) before its next contact counts as a new "first flanked contact". */
  flankForgetTiles: nonNeg,
  /** A squad closing on its attack target faces the target (not its path) within this gap (tiles). */
  faceFoeTiles: nonNeg,
  /** Shoulder width of one man in tiles (1 m; a tile is 2 m). */
  manWidthTiles: pos,
  rankDepthTiles: pos,
  looseSpacingMult: pos,
  minSquadHalfTiles: pos,
  arriveRadiusTiles: pos,
  /** Figures (1 per balance.battle.figureMen men) chase their formation slot this much faster than the squad. */
  figureFollowSpeedMult: pos,
  maxPathSearchesPerTick: z.number().int().min(1),
  repathIntervalS: pos,
  /** Engage-stance squads attack enemies that come this close on their own. */
  autoEngageRangeTiles: nonNeg,
  /** Skirmish stance backs away while a melee enemy is closer than this share of its range. */
  skirmishKeepFrac: prob,
  safeRadiusTiles: nonNeg,
  adjacentRadiusTiles: nonNeg,
  rallyRadiusTiles: nonNeg,
  sightTiles: pos,
  nightSightTiles: pos,
  visibilityIntervalTicks: z.number().int().min(1),
  /** |angle| from the facing below which a blow lands on the front; above rearArcDeg on the rear. */
  frontArcDeg: z.number().min(0).max(180),
  rearArcDeg: z.number().min(0).max(180),
  terrainSpeed: strict({ road: pos, sand: pos, rubble: pos, ditch: pos }),
  /** Tiles at or above this height count as hill terrain. */
  hillHeight: count,
  /** Speed while climbing a wall with ladders, or scrambling over walls/houses/water when fleeing. */
  climbSpeedMult: pos,
  /**
   * Costs (in open-tile steps) of the "desperate" moves a routing or retreating squad may make so
   * that Retreat to Ships always reaches the extraction zone: over a wall, through a house, swimming.
   */
  retreatCost: strict({ wall: pos, building: pos, water: pos }),

  // ---- weather and fire -------------------------------------------------------------------
  windStrength: strict({ calm: nonNeg, light: nonNeg, fresh: nonNeg, strong: nonNeg, gale: nonNeg }),
  defaultWind: strict({ dir: num, str: z.enum(['calm', 'light', 'fresh', 'strong', 'gale']) }),
  nightFireMult: nonNeg,
  rainFireMult: nonNeg,
  torchRadiusTiles: pos,
  gateBurnDps: nonNeg,
  gateFlammability: prob,
  douseS: pos,
  douseChance: prob,

  // ---- ranged -----------------------------------------------------------------------------
  projectileSpeedTilesPerS: pos,
  /** Arrow sprites per volley (visual only; the volley's hits are one deterministic impact). */
  visualArrowsPerVolley: z.number().int().min(1),
  volleyRadiusTiles: pos,
  volleyAreaAccMult: nonNeg,
  /** Pitch (tons) one volley of fire arrows burns (§12.2 "Fire Arrows (uses pitch)"). */
  pitchPerFireVolleyT: nonNeg,

  // ---- loot, gates, siege -----------------------------------------------------------------
  carryValuePerMan: pos,
  loadSpeedPenalty: prob,
  gatherRadiusTiles: pos,
  gateHackDpsPerMan: nonNeg,

  // ---- leaders, player safety, challenge --------------------------------------------------
  /** Wound HP reduction per armour tier above 1 (§31.10 "× (1 − armourReduction)"). */
  armourReductionPerTier: prob,
  /** Fate of a chief whose bodyguard squad is wiped out: share killed (the rest captured). */
  chiefDestroyedKilledShare: prob,
  challenge: strict({
    acceptChance: prob,
    refusedMorale: num,
    acceptTraits: z.array(z.string()),
    /** Morale of the side whose champion lost a duel without dying or being taken (yielded/spared). */
    yieldedMorale: num,
    /** Placeholder duel auto-resolve: logistic slope over the rating difference. */
    ratingK: pos,
    /** Placeholder duel auto-resolve: loser fate shares (killed, captured, yielded; rest spared). */
    killedShare: prob,
    capturedShare: prob,
    yieldedShare: prob,
  }),
  /** Morale gained by a side when it kills or captures the enemy chief (§13.6 "rises with"). */
  chiefKilledEnemyBonus: num,
  /** HP one "man" stands for when a single beast (balance unit `single`) takes casualties. */
  singleHpPerMan: pos,
  maulIntervalS: pos,

  // ---- battle kinds -----------------------------------------------------------------------
  raid: strict({
    initialGuardShare: prob,
    waveStartS: nonNeg,
    waveIntervalS: pos,
    /** Raid timer by settlement tier (clamped to balance.battle.raidTimerS). */
    timerByTier: z.record(id, pos),
    /** Seconds before the end at which the "horns" warning event is raised. */
    warnBeforeS: nonNeg,
  }),
  asleep: strict({ alertRadiusTiles: nonNeg, wakeS: nonNeg, unformedS: nonNeg, unformedMult: nonNeg }),
  keepHoldS: pos,
  keepRadiusTiles: pos,
  maxDurationS: pos,
  /** The battle ends when no one has struck a blow for this long (not raids: they have a timer). */
  stalemateS: pos,
  /** A stalled battle goes to a side standing with at least this multiple of the other's men. */
  stalemateEdge: z.number().finite().min(1),
  endGraceS: nonNeg,
  xp: strict({ perEnemyCap: nonNeg, loserShare: prob, presentBase: nonNeg }),
  /** Default size of an AI squad led by an unnamed sergeant (grows up to balance.squads.maxCap). */
  enemySquadMen: z.number().int().min(1),
  militiaUnitByCulture: z.record(id, id),
  defaultMilitiaUnit: id,
  /** Battle kinds whose defenders add militia (balance.battle.militiaPopShare) when walls ≥ 1. */
  militiaKinds: z.array(id),
  guardiansBySiteKind: z.record(id, z.array(z.tuple([id, z.number().int().min(1)])).min(1)),
  /** Monks fleeing with the treasure (cloister raids): men = clamp(pop × popShare, count). */
  monks: strict({ count: intRange, popShare: prob, lootShare: prob, unit: id }),
  extraUnits: z.record(id, ExtraUnitSchema),
  /** Cooldowns for abilities balance.battle.abilityCooldownS does not list. */
  extraAbilityCooldownS: z.record(id, nonNeg),
  /** Character item ids or relic ids (`rel_<id>`) of the War-Horn (+15 morale, §31.10/§21.2). */
  warHornItems: z.array(z.string()),
  /** Item or relic ids of Skell's Ember-Cloak (fire spread ×2). */
  emberCloakItems: z.array(z.string()),
  /** Relic ids of the Weeping Shield (the holder's settlements defend at +1 fortification tier). */
  weepingShieldRelics: z.array(z.string()),
  /** Faction id used for sides that belong to no faction (wild beasts, guardians without a lord). */
  wildFactionId: z.string().regex(/^fac_.+$/),
  /** Field battles away from settlements pick a template by weight (§13.2: open, forest or river). */
  fieldTemplates: z.array(z.tuple([templateId, pos])).min(1),
  /**
   * What applyBattleResult writes with effects besides men (`killMen`): `characters` — leader fates
   * and XP through woundCharacter/capture/kill/grantXp (off while the people module applies them
   * from BattleEnded itself); `lootToWinner` — loot leaves the place for the winner's fleet/treasury.
   */
  resultEffects: strict({ characters: z.boolean(), lootToWinner: z.boolean() }),
  /** Battle AI reaction time by difficulty (§18.10; difficulty changes timing, never stats). */
  aiReactionS: z.record(id, pos),

  // ---- map generation ---------------------------------------------------------------------
  cultureStyle: z.record(id, z.enum(MAP_STYLES)),
  styleFlammabilityMult: strict({
    north: nonNeg,
    albric: nonNeg,
    cael: nonNeg,
    corvani: nonNeg,
    velkar: nonNeg,
    kurgai: nonNeg,
    saraleonese: nonNeg,
  }),
  buildings: strict({
    longhall: BuildingKindSchema,
    keep: BuildingKindSchema,
    house: BuildingKindSchema,
    storehouse: BuildingKindSchema,
    church: BuildingKindSchema,
    shrine: BuildingKindSchema,
    barracks: BuildingKindSchema,
    workshop: BuildingKindSchema,
    stable: BuildingKindSchema,
    granary: BuildingKindSchema,
    tent: BuildingKindSchema,
    cloisterHall: BuildingKindSchema,
    boathouse: BuildingKindSchema,
  }),
  templates: strict({
    village: TemplateSchema,
    town: TemplateSchema,
    cityQuarter: TemplateSchema,
    cloister: TemplateSchema,
    fortress: TemplateSchema,
    field: TemplateSchema,
    forest: TemplateSchema,
    riverCrossing: TemplateSchema,
    beach: TemplateSchema,
    caveMouth: TemplateSchema,
  }),
  /** Settlement tier → map template (raids, assaults, defences). */
  templateByTier: z.record(id, templateId),
  /** Relic-site kind → map template (guardian fights). */
  templateBySiteKind: z.record(id, templateId),
  /** Battle kinds fought away from a settlement → map template. */
  templateByKind: z.record(id, templateId),

  /**
   * Auto-resolve details around the §31.11 formulas (which stay in balance.autoresolve): the noise
   * and shown bands of the casualty shares, how a side's losses spread over its squads, leader risk
   * and the reported duration. src/sim/battle/autoresolve.ts.
   */
  autoresolve: strict({
    /** Relative noise (sd) on a side's casualty share, truncated at ±bandSd sd and kept inside the §31.11 clamps. */
    noiseSd: nonNeg,
    /** Width of the casualty bands shown before battle, in sd of `noiseSd` (the noise never leaves them). */
    bandSd: pos,
    /** Loss weight of a squad by role when a side's casualties are spread over its squads (melee 1). */
    lossWeight: strict({ ranged: nonNeg, cavalry: nonNeg, single: nonNeg }),
    /** Battle kinds whose beaten defenders' chief is at stake (killed or taken; surrender when taken). */
    chiefKinds: z.array(id),
    /** A beaten attacker who came by sea in these kinds falls back to the ships (`retreated`). */
    seaRetreatKinds: z.array(id),
    /** The winners' leaders face the §12.5 risk scaled by winnerShare/loserShare × this. */
    winnerRiskMult: nonNeg,
    /** Reported duration: min + span × closeness (1 at even odds). */
    durationS: strict({ min: nonNeg, span: nonNeg }),
    /** Off-screen battles (`autoResolveBattle` effect) charge the player penalty only when the player leads a squad. */
    offscreenPenaltyNeedsPlayer: z.boolean(),
  }),
  /**
   * Battle AI (§13.7, §18.10): src/sim/battle/ai/. Difficulty changes reaction time (aiReactionS) and
   * coordination only — never stats.
   */
  ai: strict({
    /** Coordination by difficulty (0..1): focus of force, forming up before an advance, flanking. */
    coordination: z.record(id, prob),
    /** Seconds an enemy squad out of sight is still remembered where it was last seen. */
    memoryS: pos,
    /** Share of a never-seen enemy squad's strength counted by the commander (scouts' estimate). */
    unseenEstimate: prob,
    commander: strict({
      /** Utility bonus for keeping the current plan (hysteresis). */
      planInertia: nonNeg,
      /** Gumbel temperature on the plan utilities at coordination 0 (falls to half at 1). */
      planNoise: nonNeg,
      /** Spread of the per-battle temperament (−bold … +cautious), drawn from the AI's own seed. */
      boldnessSd: nonNeg,
      /** Withdraw when the force ratio is below this and the side has lost `withdrawLossShare`. */
      withdrawRatio: pos,
      withdrawLossShare: prob,
      /** Force ratio at which attacking is as good as holding. */
      attackRatio: pos,
      /** Extra attack utility of the attacking side (it came to fight). */
      attackerAggression: num,
      /** Attackers in open battle may hold at most this long before they must go in. */
      attackerHoldMaxS: nonNeg,
      /** Utility of a good defensive position (hill, woods, walls) for Hold / Defend-in-depth. */
      terrainBonus: nonNeg,
      /** Encircle needs this many squads, a mobile squad and this coordination. */
      encircleMinSquads: z.number().int().min(2),
      encircleMinCoordination: prob,
      encircleBonus: num,
      /** Forming-up line this far short of the enemy before a coordinated advance. */
      stagingDistTiles: pos,
      /** Longest wait on the forming-up line; and the share of squads that must be there. */
      stagingWaitS: nonNeg,
      stagingShare: prob,
      /** Flankers circle this far beyond the enemy's end of line. */
      flankOffsetTiles: pos,
      /** Defend-in-depth: second line this far behind the first (open ground). */
      depthTiles: pos,
      /** Squads at least this fast (tiles/s) count as mobile (flankers). */
      mobileSpeed: pos,
    }),
    squad: strict({
      jobInertia: nonNeg,
      /** Engage utility halves at this distance. */
      falloffTiles: pos,
      /** Holding squads only engage enemies within this distance of their post. */
      leashTiles: pos,
      isolationRadiusTiles: pos,
      flankBonus: nonNeg,
      /** Bonus for joining a fight friends are already in, × coordination. */
      focusBonus: nonNeg,
      archerPriority: nonNeg,
      chiefPriority: nonNeg,
      playerPriority: nonNeg,
      lootCarrierPriority: nonNeg,
      /** Bonus for enemies threatening our chief (Guard Chief). */
      guardChiefBonus: nonNeg,
      guardChiefRadiusTiles: pos,
      routingTargetMult: nonNeg,
      pursuitTiles: nonNeg,
      /** A squad below this morale out of contact falls back to recover; in contact it disengages when also locally outmatched. */
      fallBackMorale: nonNeg,
      fallBackLocalRatio: nonNeg,
      /** Morale (share of its start) at which a fallen-back squad returns to the fight. */
      recoverShare: prob,
      /** Ranged squads stand at this share of their range from their target. */
      rangedStandoffFrac: prob,
      /** Ranged squads back off from melee enemies closer than this. */
      rangedDangerTiles: pos,
      /** Douse burning buildings/gates within this distance (defenders, not engaged). */
      douseRadiusTiles: pos,
      /** No enemy closer than this to douse or secure loot. */
      safeWorkTiles: pos,
      /** Re-issue a move only when its goal moved this far. */
      reissueTiles: pos,
      /** Local strength is summed within this radius. */
      localRadiusTiles: pos,
    }),
    abilities: strict({
      chargeMaxGapTiles: pos,
      /** Shield wall against enemies (or a charge) this close, and after a volley within this many seconds. */
      shieldWallThreatTiles: pos,
      shieldWallFireS: nonNeg,
      /** Rally when the morale shortfall of squads in reach adds up to this (or one of them is routing). */
      rallyDeficit: nonNeg,
      frenzyGapTiles: nonNeg,
      hideMinEnemyGapTiles: pos,
      /** An area volley needs this many enemy men under it (or men locked in melee with friends). */
      volleyMinMen: nonNeg,
      /** A leader challenges the enemy chief when his duel rating is better by this (or his side is losing). */
      challengeEdge: num,
      /** Fire arrows on buildings near enemies only when this share of the loot ceiling is already taken (raids). */
      fireArrowLootDone: prob,
    }),
    raid: strict({
      /** Head for the ships once this share of the carrying capacity is filled. */
      loadedShare: prob,
      /** Extract when the time left is under travel time × safety + margin. */
      extractSafety: pos,
      extractMarginS: nonNeg,
      cacheDangerTiles: pos,
      /** Defenders carry a cache off when raiders come within this and they are nearer. */
      secureLootTiles: pos,
      /** Loot utility relative to fighting. */
      lootWeight: nonNeg,
    }),
    assault: strict({
      /** Squads sent to break a gate at once. */
      breachers: z.number().int().min(1),
      /** Waiting squads keep this far from the walls until a gate opens. */
      waitOffWallTiles: pos,
      /** Defenders hold a gate post until enemies inside the walls outnumber them by this. */
      fallBackRatio: pos,
      /** Attackers stand on the objective (keep, barrow) when no defender is within this. */
      objectiveClearTiles: pos,
    }),
  }),
  /** Engine event log cap (oldest entries are dropped). */
  eventLogMax: z.number().int().min(16),
});
export type Tunables = z.infer<typeof schema>;
export type BattleMapStyle = (typeof MAP_STYLES)[number];
export type BattleTemplateId = (typeof TEMPLATE_IDS)[number];
export type BattleBuildingKind = (typeof BUILDING_KINDS)[number];
export const BATTLE_TEMPLATE_IDS: readonly BattleTemplateId[] = TEMPLATE_IDS;
export const BATTLE_BUILDING_KINDS: readonly BattleBuildingKind[] = BUILDING_KINDS;
export const BATTLE_MAP_STYLES: readonly BattleMapStyle[] = MAP_STYLES;
