/**
 * Zod schema for src/content/data/balance.json — every tunable named in design §31 plus the
 * §5.5/§9/§10.4/§11.1/§12/§14/§22 tables. All objects are strict: an unknown or misspelt key
 * is a validation error. `Balance` (z.infer) is the typed accessor used by the simulation.
 */
import { z } from 'zod';
import { count, enumMap, int, nonNeg, num, prob, range } from './common';
import {
  ATTRIBUTE_IDS,
  BUILDING_IDS,
  DIFFICULTY_IDS,
  DUEL_WEAPON_IDS,
  ECONOMY_STATE_IDS,
  FORMATION_IDS,
  GOD_IDS,
  GOOD_IDS,
  GodIdSchema,
  OMEN_IDS,
  SEASON_IDS,
  SETTLEMENT_TIER_IDS,
  SHIP_TYPE_IDS,
  SKILL_IDS,
  TAX_RATE_IDS,
  ShipTypeIdSchema,
  CultureIdSchema,
  FormationIdSchema,
  AttributeIdSchema,
  SkillIdSchema,
} from './ids';

const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

const DifficultyPresetSchema = strict({
  startSilver: nonNeg,
  startUnits: z.record(z.string(), count),
  lieutenants: count,
  ships: z.record(ShipTypeIdSchema, count),
  foodMonths: nonNeg,
  skillPoints: count,
  attributePoints: count,
  aiAggressionMult: nonNeg,
  aiIncomeMult: nonNeg,
  duelAssistDefault: z.boolean(),
  coalitionHomelandShare: prob,
  aiRaidCapPerYear: count,
  envoyMinIntervalDays: nonNeg,
});

const CharacterSchema = strict({
  attributeStart: int,
  attributeMin: int,
  attributeMax: int,
  attributeCreationCap: int,
  skillMax: int,
  skillCreationCap: int,
  upbringingSkillBonus: int,
  negativeTraitSkillPoints: int,
  traitInheritChance: prob,
  playerStartAge: count,
  adultAge: count,
  childStages: strict({ infant: count, child: count, youth: count, adult: count }),
  attributePivot: num,
  attributeEffects: strict({
    mightDuelDamage: num,
    agilityParryMs: num,
    witsSkillCheck: num,
    witsDiplomacy: num,
    witsXp: num,
    vigorHpStamina: num,
  }),
  skillEffects: strict({
    meleeDuelDamage: num,
    meleeParryMs: num,
    meleeSquadAtk: num,
    archeryAccuracy: num,
    archerySeaVolley: num,
    commandSquadCap: num,
    commandMorale: num,
    seafaringFleetSpeed: num,
    seafaringStormChance: num,
    wildcraftOverlandSpeed: num,
    speechcraftPrices: num,
    speechcraftDiplomacy: num,
    speechcraftRapport: num,
    stewardshipTax: num,
    stewardshipBuildTime: num,
    stewardshipUpkeep: num,
  }),
});

const XpSchema = strict({
  levelTable: z.array(count).min(2),
  formula: strict({ base: num, exponent: num, roundTo: num }),
  maxLevel: count,
  sources: strict({
    battleVictoryBase: num,
    battleVictoryPerEnemy: num,
    duelWinBase: num,
    duelWinPerLevel: num,
    raidPerSilver: num,
    tradePerProfit: num,
    relic: num,
    delve: range,
    diplomacy: range,
    provinceCharted: num,
    quest: range,
    thingCaseWon: num,
  }),
  witsBonusPerPoint: num,
  lieutenantMult: num,
  skillPointsPerLevel: count,
  attributePointLevels: z.array(count),
  featLevels: z.array(count),
  featChoices: count,
});

const RenownSchema = strict({
  tiers: z.array(strict({ id: z.string(), min: nonNeg })).min(1),
  decayPerMonth: prob,
  decayAfterIdleMonths: count,
  sources: strict({
    victory: range,
    relic: num,
    kingdomCrown: num,
    highKing: num,
    raidPer1000Silver: num,
    feast: range,
    marriageUp: num,
    thingCase: range,
    ambition: range,
    seaZoneCharted: num,
  }),
  aiRespectPerTier: num,
  allthingDivisor: num,
  berserkerDivisor: num,
});

const bounded = { min: num, max: num, start: num };

const StandingSchema = strict({
  honor: strict(bounded),
  dread: strict({ ...bounded, decayPerMonth: num }),
  favor: strict({
    ...bounded,
    neglectPerMonth: num,
    sacrifice: range,
    feast: num,
    relic: num,
    oathBroken: num,
    templeSteadRaided: num,
  }),
  faithWrath: strict({
    ...bounded,
    sackCloister: num,
    burnCloister: num,
    holyDayRaid: num,
    decayPerMonth: num,
    sermonsAt: num,
    musterAt: num,
    banAt: num,
    sermonsOpinion: num,
  }),
  piety: strict(bounded),
  honorActs: strict({
    keepOathPerMonth: num,
    keepOathMaxPerYear: num,
    payWeregild: num,
    spareYielding: num,
    releaseCaptives: range,
    breakTreaty: num,
    attackDuringTruce: num,
    harmEnvoy: num,
    breakThingPeace: num,
    openChallenge: num,
    declareWar: num,
    declareWarBreakingTreaty: num,
    declareWarDuringTruce: num,
    divorce: num,
  }),
});

const OmenModifierSchema = strict({ moralePct: num, stormMult: nonNeg, battleMorale: num });
const OmensSchema = strict({
  favorDivisor: num,
  dieSides: count,
  dieOffset: num,
  thresholds: strict({ ill: num, fair: num, blessed: num }),
  activities: strict({
    voyage: z.array(GodIdSchema),
    battle: z.array(GodIdSchema),
    duel: z.array(GodIdSchema),
    harvest: z.array(GodIdSchema),
  }),
  modifiers: enumMap(OMEN_IDS, OmenModifierSchema),
  luckShiftChance: prob,
  readCooldownDays: count,
});

const InjuryRowSchema = strict({
  max: z.number().int().min(1).max(100),
  id: z.string(),
  trait: z.string().optional(),
  skill: SkillIdSchema.optional(),
  attribute: AttributeIdSchema.optional(),
  amount: num.optional(),
  days: count.optional(),
  wound: z.enum(['minor', 'serious', 'mortal']).optional(),
});

const HealthSchema = strict({
  wounds: strict({
    minor: strict({ statPenalty: prob, recoveryDays: count }),
    serious: strict({ statPenalty: prob, recoveryDays: count, herbsMult: nonNeg }),
    mortal: strict({ deathChance: prob, deathWindowDays: count, healerRunecraft: count }),
  }),
  injuryTable: z
    .array(InjuryRowSchema)
    .min(1)
    .refine((rows) => rows[rows.length - 1]?.max === 100, { message: 'injuryTable must end at 100' })
    .refine((rows) => rows.every((r, i) => i === 0 || r.max > (rows[i - 1]?.max ?? 0)), {
      message: 'injuryTable rows must be ascending',
    }),
  healCost: range,
  duelWinnerInjuryChance: prob,
});

const attributeDelta = strict({
  might: int.optional(),
  agility: int.optional(),
  wits: int.optional(),
  vigor: int.optional(),
});

const AgingSchema = strict({
  stages: z.array(strict({ age: count, might: int.optional(), agility: int.optional(), wits: int.optional(), vigor: int.optional() })),
  lateDeclineStartAge: count,
  lateDeclineEveryYears: count,
  lateDecline: attributeDelta,
  deathChance: z.array(strict({ maxAge: count, p: prob })).min(1),
  vigorSlope: num,
  grayQueenFavorMin: num,
  grayQueenMult: nonNeg,
  checksPerYear: count,
});

const DynastySchema = strict({
  conceptionPerMonth: prob,
  conceptionAgeFactor: z.array(strict({ maxAge: count, f: nonNeg })),
  fjornaFavorDivisor: num,
  goldenSheafMult: nonNeg,
  pregnancyDays: count,
  twinChance: prob,
  childbirthRisk: prob,
  childIllnessPerYear: prob,
  childIllnessMaxAge: count,
  inLawOpinion: num,
  divorceInLawOpinion: num,
  tutorYearsPerSkillPoint: count,
  fosterLieutenantLoyalty: num,
  fosterAllyOpinion: num,
  childFateReadingCost: nonNeg,
  succession: strict({
    renownInherit: prob,
    honorInheritParent: prob,
    honorInheritOwn: prob,
    loyaltyHit: num,
    adoptionHonorMin: num,
  }),
});

const EconomySchema = strict({
  taxPerCapita: nonNeg,
  taxMult: enumMap(TAX_RATE_IDS, nonNeg),
  prosperity: enumMap(ECONOMY_STATE_IDS, nonNeg),
  governorStewardshipTax: num,
  marketTolls: z.array(nonNeg),
  straitsTollPerProvince: nonNeg,
  straitsTollMult: strict({ eyjar: nonNeg, other: nonNeg }),
  tributeShare: prob,
  vassalDuesShare: prob,
  lieutenantWage: nonNeg,
  factorWage: nonNeg,
  rationPrice: nonNeg,
  rationsPerTon: z.number().positive(),
  royalEstatesTaxBonus: num,
  arrears: strict({ morale: num, loyaltyPerMonth: num, lieutenantLoyalty: num, desertionPerMonth: prob }),
});

const MarketSchema = strict({
  priceExponent: num,
  priceClampMin: z.number().positive(),
  priceClampMax: z.number().positive(),
  buySpread: prob,
  sellSpread: prob,
  speechcraftPerPoint: num,
  tradePactTariffCut: prob,
  monthlyNoise: prob,
  famineRationsMult: nonNeg,
  goodHarvestRationsMult: nonNeg,
  haggleRoundsMax: count,
  tradeRouteSlots: z.array(count),
  tradeRouteSlotsPerCrown: count,
});

const GoodDefSchema = strict({ basePerTon: z.number().positive(), tags: z.array(z.string()) });

const BuildingTierSchema = strict({
  tier: count,
  cost: nonNeg.nullable(),
  days: count,
  upkeep: nonNeg,
  effects: z.record(z.string(), z.union([num, z.array(z.string()), z.boolean()])),
});
const BuildingDefSchema = strict({ minTier: count, tiers: z.array(BuildingTierSchema).min(1) });

const SettlementTierSchema = strict({
  pop: range,
  garrisonRatio: prob.optional(),
  garrisonFixed: range.optional(),
  silver: range,
  market: z.boolean(),
});

const FortTierSchema = strict({ tier: count, name: z.string(), defMult: z.number().positive(), gateHp: nonNeg, starveDays: count });

const HoldingsSchema = strict({
  garrisonMinPopShare: prob,
  buildSlots: count,
  buildSlotsHighStewardship: count,
  highStewardshipLevel: count,
  absenceDays: count,
  startLoyalty: num,
  colonize: strict({
    minColonists: count,
    rations: count,
    timber: nonNeg,
    iron: nonNeg,
    growthPerYear: num,
    startLoyalty: num,
  }),
  coronation: strict({ cost: nonNeg, renownMin: nonNeg, renownGain: num }),
  lieutenantCapacityPerCrown: count,
  petitionsPerMonth: range,
});

/** §22.9 Ambitions (the Renown reward range is renown.sources.ambition). */
const AmbitionsSchema = strict({
  offered: count,
  maxChosen: count,
  favorReward: num,
  loyaltyReward: num,
  failRenown: num,
  boastMult: nonNeg,
});

const LoyaltySchema = strict({
  min: num,
  max: num,
  tax: enumMap(TAX_RATE_IDS, num),
  victory: num,
  victoryMaxPerMonth: num,
  feast: num,
  absence: num,
  famine: num,
  raided: num,
  rulerCultureMismatch: num,
  rulerFaithMismatch: num,
  renownTierBonus: z.array(num),
  lowGarrison: num,
  drift: num,
  driftTarget: num,
  revoltBelow: num,
  revoltChancePerPoint: prob,
  highAt: num,
  highPoolMult: nonNeg,
  vassalDefectBelow: num,
  vassalIgnoredAttack: num,
  lieutenantDesertBelow: num,
});

const RecruitSchema = strict({
  poolRate: prob,
  loyaltyFactorBase: num,
  loyaltyFactorSlope: num,
  regenRate: prob,
  regenStewardshipBonus: num,
  cooldownDays: count,
  gatherDays: count,
  berserkerCap: count,
  berserkerRenownDivisor: z.number().positive(),
  levyShare: prob,
  levyServiceDays: count,
  promoteVeteranCost: nonNeg,
  promoteVeteranBattles: count,
  /** Level range of the character a promoted veteran becomes (§12.5). */
  promoteVeteranLevel: range,
  sellswordCost: range,
  sellswordLoyalty: num,
});

const SquadsSchema = strict({
  baseCap: count,
  capPerCommand: count,
  maxCap: count,
  maxPerBattle: count,
  veterancyBattles: z.array(count),
  veterancyPerStar: num,
  woundedRecoveryHomeDays: count,
  woundedRecoverySeaDays: count,
  lieutenantRisk: strict({ die: prob, wounded: prob, captured: prob }),
});

const FoodSchema = strict({
  rationsPerManPerDay: nonNeg,
  spoilStartDay: count,
  spoilPerDay: prob,
  saltSpoilMult: nonNeg,
  forageBase: nonNeg,
  forageSkillSlope: num,
  forageCap: nonNeg,
  saltasPearlConsumptionMult: nonNeg,
  harvestWeatherMod: range,
  farmsTierBonus: num,
  harvestMonthIndex: z.number().int().min(0).max(11),
  harvestDays: range,
  famine: strict({ loyalty: num, popPct: num, plagueMult: nonNeg }),
  starvation: strict({ moralePerDay: num, graceDays: count, deathPctPerDay: prob }),
  voyageFatigue: strict({ startDay: count, moralePerDay: num }),
  lowFoodWarnDays: count,
  toweringEatsMult: nonNeg,
});

const UnitDefSchema = strict({
  name: z.string(),
  side: z.enum(['player', 'enemy', 'guardian', 'beast']),
  culture: CultureIdSchema.optional(),
  replaces: z.string().optional(),
  bounty: nonNeg.optional(),
  wage: nonNeg.optional(),
  atk: nonNeg,
  def: nonNeg,
  ranged: strict({ atk: nonNeg, range: z.number().positive(), reloadS: z.number().positive() }).optional(),
  speed: z.number().positive(),
  morale: nonNeg,
  formations: z.array(FormationIdSchema).min(1),
  abilities: z.array(z.string()),
  shieldWallDef: z.number().positive().optional(),
  charge: z.number().positive().optional(),
  cavalry: z.boolean().optional(),
  single: z.boolean().optional(),
  hp: z.number().positive().optional(),
  maxPerSquad: count.optional(),
  requires: z.array(z.string()).optional(),
  specials: z.record(z.string(), num).optional(),
});

const EquipmentSchema = strict({
  maxTier: count,
  relicTier: count,
  bountyPerTierPerTrack: nonNeg,
  tiers: z
    .array(
      strict({
        tier: count,
        armour: z.string(),
        weapon: z.string(),
        mult: z.number().positive(),
        costFlat: nonNeg,
        costPerMan: nonNeg,
        smithyTier: count,
        ironT: nonNeg,
        requires: z.array(z.string()),
      }),
    )
    .min(1),
});

const ShipDefSchema = strict({
  name: z.string(),
  cost: nonNeg,
  buildDays: count,
  crewMin: count,
  crewMax: count,
  cargoT: nonNeg,
  sailKn: nonNeg,
  rowKn: nonNeg,
  hull: z.number().positive(),
  sail: z.number().positive(),
  upkeep: nonNeg,
  river: z.boolean(),
  timberT: nonNeg,
  buildable: z.boolean(),
  shipyardTier: count,
  founderSize: nonNeg,
  dread: nonNeg,
  fleetMorale: num,
  stormDamageMult: nonNeg,
  tags: z.array(z.string()),
});

const ShipyardSchema = strict({
  repairPerHull: nonNeg,
  repairPerSail: nonNeg,
  fieldRepairShare: prob,
  fieldRepairDays: count,
  timberSurchargePerTon: nonNeg,
  towSpeedMult: nonNeg,
  drakkarDreadCap: nonNeg,
});

const WIND_STRENGTHS = ['calm', 'light', 'fresh', 'strong', 'gale'] as const;
const POINTS_OF_SAIL = ['running', 'broadReach', 'beamReach', 'closeHauled', 'inIrons'] as const;

const SailingSchema = strict({
  windFactor: enumMap(POINTS_OF_SAIL, enumMap(WIND_STRENGTHS, nonNeg)),
  pointOfSailDeg: strict({ inIronsMax: num, closeHauledMax: num, beamReachMax: num, broadReachMax: num }),
  seafaringSpeedBonus: num,
  crewFactor: strict({ fullAt: prob, base: num, slope: num }),
  hullFactor: strict({ base: num, slope: num }),
  autoRowRatio: nonNeg,
  knotKmh: z.number().positive(),
  beachHours: count,
  openHours: count,
  staminaRowDrain: nonNeg,
  staminaRest: nonNeg,
  lowStamina: nonNeg,
  lowStaminaRowMult: nonNeg,
  leagueKm: z.number().positive(),
  cellKm: z.number().positive(),
  navGrid: z.tuple([count, count]),
  windUpdateHours: count,
});

const StormsSchema = strict({
  season: enumMap(SEASON_IDS, prob),
  zoneMod: strict({ openOcean: nonNeg, coastal: nonNeg }),
  seafaringReduction: num,
  omenMult: enumMap(OMEN_IDS, nonNeg),
  drownedBellMult: nonNeg,
  nightSailingMult: nonNeg,
  severity: strict({ minor: prob, moderate: prob, severe: prob }),
  winterSevereShift: prob,
  undermannedSevereShift: prob,
  founderBase: prob,
  undermannedFounderMult: nonNeg,
  shelterWithinDays: nonNeg,
  shelterAvoid: prob,
  shelterDelayDays: nonNeg,
  minorDelayDays: nonNeg,
  moderateMenLost: range,
  moderateCargoJettison: prob,
  warningSeafaringMin: count,
  earlyWarningHours: range,
  lateWarningHours: nonNeg,
  harshWintersMult: nonNeg,
});

const EncountersSchema = strict({
  sightBase: nonNeg,
  sightPerSeafaring: num,
  lookoutTrait: num,
  fogNightMult: nonNeg,
  hiddenChance: range,
  hiddenNightMult: nonNeg,
  evade: strict({ base: num, speedSlope: num, seafaringSlope: num, windEdge: num, min: prob, max: prob }),
  toll: strict({ powerLog2Mult: num, dreadMult: num, prideMax: num, noise: num, cargoShare: range }),
  fleeMoraleCost: num,
});

const OverlandSchema = strict({
  kmPerDay: nonNeg,
  terrain: strict({ forest: nonNeg, hills: nonNeg, marsh: nonNeg, plain: nonNeg, road: nonNeg, mountain: nonNeg }),
  wildcraftSlope: num,
  horsesMult: nonNeg,
  shipGuardPerShip: count,
  sightBase: nonNeg,
  sightPerWildcraft: num,
  lameMult: nonNeg,
  portageDays: range,
  portageMenPerShip: count,
});

const TerrainSchema = strict({
  def: nonNeg,
  rangedAcc: nonNeg,
  speed: nonNeg,
  rangeBonus: num.optional(),
  hiding: z.boolean().optional(),
  ambushBonus: z.boolean().optional(),
});

const BattleSchema = strict({
  tickHz: z.number().int().positive(),
  kMelee: nonNeg,
  figureMen: z.number().int().positive(),
  mapTiles: z.tuple([count, count]),
  tileMeters: z.number().positive(),
  commandBonus: num,
  veterancyBonus: num,
  tierStep: num,
  moraleMult: strict({ steady: nonNeg, wavering: nonNeg, routing: nonNeg }),
  waverAt: num,
  routAt: num,
  rallyAt: num,
  randRange: range,
  flank: strict({ front: nonNeg, side: nonNeg, rear: nonNeg }),
  charge: strict({
    durationS: nonNeg,
    runTiles: nonNeg,
    infantry: nonNeg,
    wedgeMult: nonNeg,
    vsShieldWall: nonNeg,
    chargerCasualtyMult: nonNeg,
  }),
  specials: strict({ bondiVsCavalry: nonNeg, skirmishersVsShieldWall: nonNeg }),
  woundedShare: prob,
  formations: strict({
    line: strict({ def: nonNeg, speed: nonNeg, frontage: count }),
    shieldWall: strict({
      def: nonNeg,
      defHuscarls: nonNeg,
      fjordWallBonus: num,
      speed: nonNeg,
      frontage: count,
      frontRangedMult: nonNeg,
      canCharge: z.boolean(),
    }),
    wedge: strict({ def: nonNeg, speed: nonNeg, frontage: count, chargeMult: nonNeg, sideFlank: nonNeg }),
    loose: strict({ def: nonNeg, speed: nonNeg, frontage: count, rangedAgainstMult: nonNeg }),
  }),
  terrain: strict({
    open: TerrainSchema,
    woods: TerrainSchema,
    hill: TerrainSchema,
    ford: TerrainSchema,
    marsh: TerrainSchema,
    palisade: TerrainSchema,
  }),
  ranged: strict({
    kRanged: nonNeg,
    volleyS: z.number().positive(),
    leaderArcheryBonus: num,
    accMin: prob,
    accSlope: num,
    elevationRangeMult: nonNeg,
    elevationAccBonus: num,
    fireArrowIgnite: prob,
    shieldWallFrontMult: nonNeg,
    smokeMult: nonNeg,
  }),
  morale: strict({
    perCommand: num,
    perVeterancy: num,
    omen: enumMap(OMEN_IDS, num),
    warHorn: num,
    brave: num,
    craven: num,
    dreadDrakkarMin: num,
    dreadDrakkarPenalty: num,
    lossesMult: num,
    firstFlanked: num,
    leaderKilled: num,
    adjacentRout: num,
    fireNearbyPerS: num,
    fireRadiusTiles: nonNeg,
    berserkersContactPerS: num,
    recoveryPerS: num,
    rally: num,
    rallyCooldownS: nonNeg,
    enemyChiefKilled: num,
    nightSurprise: num,
  }),
  fatigue: strict({
    max: nonNeg,
    lowAt: nonNeg,
    lowMult: nonNeg,
    runningPerS: num,
    fightingPerS: num,
    walkingPerS: num,
    restingPerS: num,
    afterFrenzy: nonNeg,
  }),
  fire: strict({
    spreadIntervalS: z.number().positive(),
    radiusTiles: nonNeg,
    baseChance: prob,
    windCosWeight: num,
    emberCloakMult: nonNeg,
    burnS: nonNeg,
    lootLossPerS: prob,
    torchS: nonNeg,
    wolfcoatTorchS: nonNeg,
  }),
  frenzy: strict({ durationS: nonNeg, atkMult: nonNeg, damageTakenMult: nonNeg }),
  playerSafety: strict({
    woundChancePerManLost: prob,
    woundHp: range,
    warnHpPct: prob,
    carryRadiusTiles: nonNeg,
    carriedMortalChance: prob,
    capturedShare: prob,
    deathShare: prob,
  }),
  lootGatherS: nonNeg,
  ramGateDps: nonNeg,
  raidTimerS: range,
  militiaPopShare: prob,
  challengeRangeTiles: nonNeg,
  maxPlayerSquads: count,
  maxEnemySquads: count,
  maxFigures: count,
  maxProjectiles: count,
  commanderReplanS: nonNeg,
  nightRaidWildcraftMin: count,
  nightRaidAsleepShare: prob,
  hideRevealTiles: nonNeg,
  abilityCooldownS: z.record(z.string(), nonNeg),
});

const AutoresolveSchema = strict({
  exponent: z.number().positive(),
  rangedWeight: nonNeg,
  moraleDivisor: z.number().positive(),
  situational: strict({ nightRaidAttacker: nonNeg, defenderInWoods: nonNeg, omenPct: num }),
  loser: strict({ base: num, slope: num, min: prob, max: prob }),
  winner: strict({ base: num, slope: num, min: prob, max: prob }),
  woundedShare: prob,
  routingCapturedShare: prob,
  assaultLootShare: prob,
  manualLootMax: prob,
  playerPenalty: enumMap(DIFFICULTY_IDS, prob),
  outcomeBands: strict({ decisive: prob, likely: prob, even: prob, risky: prob }),
});

const BoardingSchema = strict({
  drakkarMult: nonNeg,
  rounds: count,
  casualtyK: nonNeg,
  minPct: prob,
  maxPct: prob,
  moraleDivisor: z.number().positive(),
});

const SeaBattleSchema = strict({
  tickHz: z.number().int().positive(),
  arenaM: z.number().positive(),
  timeScale: z.number().positive(),
  archeryRangeM: nonNeg,
  fireArrowSailIgnite: prob,
  burningSailDps: nonNeg,
  douse: strict({ crewShare: prob, seconds: nonNeg, success: prob }),
  grapple: strict({ rangeM: nonNeg, maxRelSpeed: nonNeg }),
  galleyRamHull: range,
  seaFire: strict({ coneM: nonNeg, hullDps: nonNeg, seconds: nonNeg, morale: num }),
  ai: strict({ runBelowPct: prob, outnumberedRatio: nonNeg, patrolLossPct: prob }),
  autoresolve: strict({ archerShareBonus: num, windAdvantage: num }),
});

const DuelSchema = strict({
  tickHz: z.number().int().positive(),
  hpBase: z.number().positive(),
  staminaBase: z.number().positive(),
  vigorSlope: num,
  staminaRegenIdle: nonNeg,
  staminaRegenBlocking: nonNeg,
  shieldBase: nonNeg,
  shieldPerTier: nonNeg,
  damage: strict({ mightSlope: num, meleeSlope: num, armourPerTier: num }),
  parryBaseMs: nonNeg,
  parryPerAgilityMs: nonNeg,
  parryPerMeleeMs: nonNeg,
  riposteWindowMs: nonNeg,
  riposteMult: nonNeg,
  accessibilityParryMaxMs: nonNeg,
  slowMotion: z.number().positive(),
  exhaustion: strict({ seconds: nonNeg, damageMult: nonNeg }),
  moves: strict({
    light: strict({ stamina: nonNeg, damageMult: nonNeg }),
    heavy: strict({ stamina: nonNeg, damageMult: nonNeg, windupMult: nonNeg, guardBreak: prob, holdS: nonNeg }),
    block: strict({ staminaPerS: nonNeg, blockShare: prob, wrongHeightShare: prob }),
    parry: strict({ stamina: nonNeg }),
    bash: strict({ stamina: nonNeg, staggerMs: nonNeg, shieldDamage: nonNeg }),
    dodge: strict({ stamina: nonNeg, invulnMs: nonNeg }),
    feint: strict({ stamina: nonNeg }),
    taunt: strict({ vulnerableS: nonNeg, renownOnWin: num }),
    yield: strict({ holdS: nonNeg }),
  }),
  assisted: strict({
    wrongGuardMult: nonNeg,
    strikeVsBashMult: nonNeg,
    tellBase: prob,
    tellPerWits: num,
    tellWitsOffset: num,
    tellMin: prob,
    tellMax: prob,
  }),
  autoK: z.number().positive(),
  rating: strict({
    melee: num,
    might: num,
    agility: num,
    vigor: num,
    weaponTier: num,
    armourTier: num,
    level: num,
    traits: z.record(z.string(), num),
  }),
  renown: strict({
    base: num,
    perTier: num,
    tiers: strict({ commoner: count, hersir: count, jarl: count, king: count, nemesis: count }),
  }),
  spareHonor: num,
  glyphWitsLead: num,
  durationS: range,
  holmgang: strict({ shields: count, shieldRefills: count }),
});

const WeaponDefSchema = strict({
  name: z.string(),
  damage: z.number().positive(),
  windupMs: z.number().positive(),
  reach: z.number().positive(),
  shield: z.boolean(),
  minWeaponTier: count,
  special: z.record(z.string(), num),
});

const PACT_PRICE_KINDS = ['truce', 'treaty', 'trade', 'alliance'] as const;
const ACCEPT_ACTIONS = ['truce', 'treaty', 'trade', 'alliance', 'marriage', 'tribute', 'allegiance', 'passage', 'fosterage'] as const;

const DiplomacySchema = strict({
  opinionMin: num,
  opinionMax: num,
  acceptance: strict({
    opinionWeight: num,
    powerLog2Mult: num,
    powerMin: num,
    powerMax: num,
    honorWeight: num,
    dreadWeight: num,
    kin: num,
    giftCap: num,
    speechcraftPerPoint: num,
    noise: nonNeg,
    base: enumMap(ACCEPT_ACTIONS, num),
    trucePerWarMonth: num,
    truceWarCap: num,
    tradeNeedMax: num,
    allianceCommonEnemy: num,
    marriagePerStatusDiff: num,
    personality: strict({ proud: num, honorable: num, greedy: num, cautious: num }),
  }),
  oddsScale: z.number().positive(),
  oddsLabels: strict({ certain: prob, likely: prob, possible: prob, unlikely: prob }),
  showPercentSpeechcraft: count,
  opinionModifiers: strict({
    sharedFaith: num,
    sharedCulture: num,
    kinship: num,
    treaty: num,
    alliance: num,
    recentRaid: num,
    recentRaidDecay: nonNeg,
    brokenOath: num,
    brokenOathDecay: nonNeg,
    rivalClaim: num,
    slightedEnvoy: num,
    nemesis: num,
  }),
  stance: strict({ hostileBelow: num, friendlyAbove: num }),
  truceDays: count,
  gift: strict({ opinionPerIncome: num, cap: num, diminishWindowDays: count }),
  cooldownDays: z.record(z.string(), count),
  allianceMinOpinion: num,
  allianceFreeOpinion: num,
  allegiancePowerRatio: nonNeg,
  allegianceDread: num,
  envoyDeferDays: count,
  coalitionDreadAt: num,
});

const PricesSchema = strict({
  pact: strict({
    waiveAtS: num,
    theyPayAtS: num,
    slopeDivisor: z.number().positive(),
    basePrice: enumMap(PACT_PRICE_KINDS, nonNeg),
    sizeFactor: strict({ hamlet: nonNeg, village: nonNeg, town: nonNeg, city: nonNeg, capital: nonNeg, kingdom: nonNeg }),
  }),
  marriageGiftBase: nonNeg,
  statusTiers: strict({ hersir: count, jarl: count, king: count, highKing: count }),
  ransom: strict({
    rankValue: strict({
      warrior: nonNeg,
      hersir: nonNeg,
      jarlKin: nonNeg,
      abbot: nonNeg,
      kingKin: nonNeg,
      jarl: nonNeg,
      king: nonNeg,
    }),
    wealthTierStep: num,
  }),
  /** One-time tribute amount (§31.15). Its cooldown is diplomacy.cooldownDays.tribute; the ongoing share is economy.tributeShare. */
  tribute: strict({ base: prob, slope: prob, sDivisor: z.number().positive() }),
});

const WeregildSchema = strict({
  base: nonNeg,
  rankMult: strict({ commoner: nonNeg, hersir: nonNeg, jarlKin: nonNeg, jarl: nonNeg, king: nonNeg }),
});

const AllthingSchema = strict({
  opinionWeight: num,
  kin: num,
  dreadWeight: num,
  dreadMaxDays: nonNeg,
  bribeCap: num,
  honorWeight: num,
  renownDivisor: z.number().positive(),
  oathstone: num,
  crown: num,
  speech: range,
  nemesis: num,
  faithMismatchTraditionalist: num,
  votes: count,
  monthIndex: z.number().int().min(0).max(11),
  day: z.number().int().min(1).max(30),
});

const AiSchema = strict({
  raid: strict({ aggressionWeight: num, greedWeight: num, valueDivisor: num, daysDivisor: num, grievanceDivisor: num }),
  conquer: strict({ ambitionWeight: num, aggressionWeight: num }),
  fortify: strict({ maxFortTier: count }),
  truce: strict({ honorDivisor: num }),
  temperature: enumMap(DIFFICULTY_IDS, nonNeg),
  threatRadiusDays: nonNeg,
  decisionIntervalDays: count,
  personalityNoise: nonNeg,
});

const IntelSchema = strict({
  decayDays: z.number().positive(),
  staleDays: nonNeg,
  confidence: strict({ high: prob, medium: prob }),
  rangeSpread: nonNeg,
  news: strict({
    delayBase: num,
    delayPerImportance: num,
    reachBase: num,
    reachPerImportance: num,
    distortionPerHop: num,
  }),
});

const LootSchema = strict({
  goodsPortableShare: prob,
  raidMaxShare: prob,
  assaultMaxShare: prob,
  sackHoardBonus: prob,
  silverTonsPer100: nonNeg,
});

const SiegeSchema = strict({
  attackerDiseaseStartDay: count,
  attackerDiseasePerDay: prob,
  sortieChance: prob,
  sortieMoraleMin: num,
  termsChance: prob,
  termsFoodBelow: prob,
  ramDays: count,
  ramMen: count,
  ladderDays: count,
});

/** Generation defaults used by the entity factories (core/factory.ts). */
const DefaultsSchema = strict({
  fleetMorale: nonNeg,
  characterLoyalty: nonNeg,
  lieutenantLoyalty: nonNeg,
  rulerAge: range,
  leaderAge: range,
  lieutenantAge: range,
  fallbackAge: count,
  placeholderCapitalPop: count,
});

export const BalanceSchema = strict({
  $notes: z.array(z.string()).optional(),
  defaults: DefaultsSchema,
  difficulty: enumMap(DIFFICULTY_IDS, DifficultyPresetSchema),
  character: CharacterSchema,
  xp: XpSchema,
  renown: RenownSchema,
  standing: StandingSchema,
  omens: OmensSchema,
  health: HealthSchema,
  aging: AgingSchema,
  dynasty: DynastySchema,
  economy: EconomySchema,
  market: MarketSchema,
  goods: enumMap(GOOD_IDS, GoodDefSchema),
  buildings: enumMap(BUILDING_IDS, BuildingDefSchema),
  startBuildings: z.record(z.enum(BUILDING_IDS), count),
  settlementTiers: enumMap(SETTLEMENT_TIER_IDS, SettlementTierSchema),
  fortTiers: z.array(FortTierSchema).length(5),
  holdings: HoldingsSchema,
  loyalty: LoyaltySchema,
  ambitions: AmbitionsSchema,
  recruit: RecruitSchema,
  squads: SquadsSchema,
  food: FoodSchema,
  units: z.record(z.string().regex(/^[a-z][A-Za-z0-9]*$/), UnitDefSchema),
  equipment: EquipmentSchema,
  ships: enumMap(SHIP_TYPE_IDS, ShipDefSchema),
  shipyard: ShipyardSchema,
  sailing: SailingSchema,
  storms: StormsSchema,
  encounters: EncountersSchema,
  overland: OverlandSchema,
  battle: BattleSchema,
  autoresolve: AutoresolveSchema,
  boarding: BoardingSchema,
  seaBattle: SeaBattleSchema,
  duel: DuelSchema,
  weapons: enumMap(DUEL_WEAPON_IDS, WeaponDefSchema),
  diplomacy: DiplomacySchema,
  prices: PricesSchema,
  weregild: WeregildSchema,
  allthing: AllthingSchema,
  ai: AiSchema,
  intel: IntelSchema,
  loot: LootSchema,
  siege: SiegeSchema,
})
  .superRefine((b, ctx) => {
    // Cross-field checks.
    for (const [id, preset] of Object.entries(b.difficulty)) {
      for (const unitId of Object.keys(preset.startUnits)) {
        if (!b.units[unitId]) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `difficulty.${id}.startUnits: unknown unit '${unitId}'` });
      }
    }
    for (const [id, u] of Object.entries(b.units)) {
      if (u.replaces && !b.units[u.replaces]) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `units.${id}.replaces: unknown unit '${u.replaces}'` });
      }
      if (u.side === 'player' && (u.bounty === undefined || u.wage === undefined)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `units.${id}: player units need bounty and wage` });
      }
      if (u.single && u.hp === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `units.${id}: single entities need hp` });
      }
    }
    if (b.xp.levelTable.length !== b.xp.maxLevel) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'xp.levelTable length must equal xp.maxLevel' });
    }
    const sev = b.storms.severity;
    if (Math.abs(sev.minor + sev.moderate + sev.severe - 1) > 1e-9) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'storms.severity must sum to 1' });
    }
    b.fortTiers.forEach((t, i) => {
      if (t.tier !== i) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `fortTiers[${i}].tier must be ${i}` });
    });
    if (b.ambitions.maxChosen > b.ambitions.offered) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ambitions.maxChosen must not exceed ambitions.offered' });
    }
    // Smithy tiers and equipment tiers must agree (§12.4): equipment tier t (up to the smithy's
    // maximum) needs exactly the lowest smithy tier whose maxArmouryTier reaches t.
    const smithyMax = b.buildings.smithy.tiers.map((t) => ({ tier: t.tier, max: Number(t.effects.maxArmouryTier ?? 0) }));
    for (const eq of b.equipment.tiers) {
      if (eq.tier > b.equipment.maxTier || eq.smithyTier === 0) continue;
      const needed = smithyMax.find((s) => s.max >= eq.tier)?.tier;
      if (needed !== eq.smithyTier) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `equipment tier ${eq.tier} requires smithyTier ${eq.smithyTier}, but buildings.smithy first allows it at tier ${String(needed)}`,
        });
      }
    }
  });

export type Balance = z.infer<typeof BalanceSchema>;
export type UnitDef = Balance['units'][string];
export type ShipDef = Balance['ships'][keyof Balance['ships']];
export type GoodDef = Balance['goods'][keyof Balance['goods']];
export type BuildingDef = Balance['buildings'][keyof Balance['buildings']];
export type DifficultyPreset = Balance['difficulty'][keyof Balance['difficulty']];
export type WeaponDef = Balance['weapons'][keyof Balance['weapons']];

/** Re-exported so consumers can enumerate keyed tables without importing ids separately. */
export { ATTRIBUTE_IDS, GOD_IDS, SKILL_IDS };
