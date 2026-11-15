/**
 * Tunables owned by the 'seabattle' module: src/content/data/tunables/seabattle.json, read in sim code as
 * `ctx.tunables.seabattle`. The seabattle agent owns this file and the JSON; add keys to both (strict:
 * unknown keys are errors). The §31 formula tables stay in balance.json (frozen during the parallel
 * phase): the wind polar (§31.2), boarding (§31.13), sea-battle constants (§15.2) and auto-resolve
 * (§15.5/§31.11) are read from `ctx.balance`. Everything here is a value the design does not give and
 * is a first guess for the balance harness (tools/sea-sim).
 */
import { z } from 'zod';

const finite = z.number().finite();
const nonNeg = z.number().finite().min(0);
const positive = z.number().finite().positive();
const share = z.number().finite().min(0).max(1);
const range = z.tuple([nonNeg, nonNeg]).refine(([a, b]) => a <= b, 'range must be [min, max] with min <= max');
const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

/** Hull geometry and handling of one ship type (sea-battle only; balance.json holds the §12.7 table). */
const ShipHandlingSchema = strict({
  /** Overall length and beam in metres (hull capsule for collisions, grappling and rendering). */
  lengthM: positive,
  beamM: positive,
  /** Turn rate in degrees per battle second at full steerage way. */
  turnDegS: positive,
  /** true: grounds in shallows; false: crosses shallows slowly (shallow-draft Northern hulls). */
  deepDraft: z.boolean(),
});

const DeckShareSchema = strict({ boarders: share, archers: share, rowers: share });

/** Arena template (design §15.2: about 2 × 2 km with islands, rocks and shallows). */
const ArenaTemplateSchema = strict({
  /** Coast edges: 0 open sea, 1 a coastline along one edge, 2 coastlines on opposite edges (strait, fjord, river). */
  coasts: z.number().int().min(0).max(2),
  /** How far the land reaches in from its edge, metres [min, max] of the mean line. */
  coastDepthM: range,
  /** Amplitude of the coastline's wiggle (metres). */
  coastRoughnessM: nonNeg,
  islands: range,
  islandRadiusM: range,
  rocks: range,
  rockRadiusM: range,
  /** Shallow patches in open water. */
  shoals: range,
  shoalRadiusM: range,
  /** Width of the shallow band around land (metres) and around rocks. */
  shallowsM: nonNeg,
  rockShallowsM: nonNeg,
});

export const schema = strict({
  /** Hull geometry, turn rate and draft per ship type. */
  ships: strict({
    karvi: ShipHandlingSchema,
    snekkja: ShipHandlingSchema,
    drakkar: ShipHandlingSchema,
    knarr: ShipHandlingSchema,
    galley: ShipHandlingSchema,
    riverboat: ShipHandlingSchema,
  }),
  physics: strict({
    /** m/s per knot. */
    knotMs: positive,
    /** Time constants (battle seconds) for gaining and losing way. */
    accelS: positive,
    decelS: positive,
    /** Turn-rate multiplier under oars, and the floor/full-speed of sail steerage. */
    oarsTurnMult: positive,
    sailTurnMinFactor: share,
    sailTurnFullSpeedMs: positive,
    /** Backing water: share of forward rowing speed. */
    reverseRowMult: share,
    /** Rowers needed for full rowing speed, as a share of crewMax (the oar benches). */
    oarsShareOfCrewMax: share,
    /** Stamina (0–100) drained per battle second at full stroke; recovered per second when not rowing. */
    rowStaminaDrainPerS: nonNeg,
    staminaRecoverPerS: nonNeg,
    /** Stamina drain grows with stroke rate as throttle^exp (easy rowing saves the crew). */
    staminaThrottleExp: positive,
    /** Sail speed at 1 sail HP as a share of an undamaged sail (falls to 0 at 0 HP). */
    sailHpSpeedFloor: share,
    /** Decay of collision push-velocity per battle second. */
    pushDecayPerS: positive,
    /** Share of closing speed returned as push-apart velocity in a collision. */
    restitution: share,
    /** Hull damage per m/s of closing speed above collisionMinSpeedMs (ship–ship). */
    collisionDamagePerMs: nonNeg,
    collisionMinSpeedMs: nonNeg,
    /** Hull damage per m/s when striking a rock / running onto land or (deep-draft) shallows. */
    rockDamagePerMs: nonNeg,
    groundDamagePerMs: nonNeg,
    /** Seconds stuck after running aground, then seconds backing water once refloated. */
    groundedS: nonNeg,
    groundedBackOffS: nonNeg,
    /**
     * Striking land, a rock or (deep-draft) shallows at this speed or faster runs the hull aground
     * (damage + groundedS). A slower touch only stops the ship, which fends off and backs away from
     * the contact for bumpBackOffS.
     */
    groundMinSpeedMs: nonNeg,
    bumpBackOffS: nonNeg,
    /** Speed multiplier for shallow-draft hulls crossing shallows. */
    shallowSpeedMult: share,
    /** A ship this far outside the arena edge has left the battle. */
    exitMarginM: nonNeg,
    /** Rowing speed ∝ (rowers / benches)^rowPowerExp below a full bench (drag grows with speed). */
    rowPowerExp: positive,
    /** AI ships that are not fleeing keep this far inside the arena edge. */
    edgeAvoidM: nonNeg,
  }),
  archery: strict({
    /** Shield-rail cover on deck: multiplies hits. */
    deckCover: share,
    /** Ranged attack of a man on the bow who is not a trained archer (levy hunting bows). */
    levyRangedAtk: nonNeg,
    /** Fire arrows are fewer and slower to loose: hit multiplier. */
    fireArrowHitMult: share,
    /** Pitch (tons) one ship's fire-arrow volley uses; default stock when a side has pitch but no amount. */
    pitchPerVolleyT: nonNeg,
    defaultPitchT: nonNeg,
    /** Terrain samples along the line of sight (land blocks arrows). */
    losSamples: z.number().int().min(1).max(32),
    /** Fire arrows are loosed by default when pitch is aboard (pre-battle toggle). */
    fireArrowsDefault: z.boolean(),
  }),
  /**
   * The volley the player looses by hand from the steered ship's side (hold Space to draw, let go to
   * loose). Ranges in metres, times in battle seconds unless named real.
   */
  aim: strict({
    /** Shortest and longest bowshot the aim marker runs between, out from the ship's side. */
    minRangeM: positive,
    maxRangeM: positive,
    /** Real seconds for the marker to run from the shortest to the longest bowshot (then back). */
    sweepRealS: positive,
    /** Radius of the fall of shot: a hull within this of the aim point is under the arrows. */
    fallRadiusM: positive,
    /** Hand-loosed volleys hit this much harder than the captains' own (aimed, all bows at once). */
    aimedHitMult: positive,
    /** Power left at the longest bowshot (1 at the shortest, straight line between). */
    farHitMult: share,
    /** Centring needed for the full blow: hits ∝ min(1, centring / fullCentring), centring 1 = dead centre. */
    fullCentring: positive,
    /** Battle seconds to nock again after a hand-loosed volley. */
    nockS: positive,
    /** Flight time: flightBaseS + range / arrowSpeedMs battle seconds. */
    flightBaseS: nonNeg,
    arrowSpeedMs: positive,
  }),
  fire: strict({
    /** Morale per battle second aboard a burning ship. */
    burningMoralePerS: finite,
    /** When a burning sail burns out: chance the hull catches, its damage rate and duration. */
    sailBurnoutHullChance: share,
    sailBurnoutHullDps: nonNeg,
    sailBurnoutHullS: nonNeg,
    /** Douse success multiplier against sea-fire (naphtha is hard to put out with water). */
    seaFireDouseMult: share,
    /** Sea-fire siphon: cone half-angle, reload, charges carried, share of crew in the cone lost. */
    seaFireHalfAngleDeg: positive,
    seaFireCooldownS: nonNeg,
    seaFireCharges: z.number().int().min(0),
    seaFireCrewLossPct: share,
    /** Cultures whose galleys carry the siphon (§12.7: the Saraleon variant). */
    seaFireCultures: z.array(z.string().min(1)),
    /** Ignition chance multiplier against a furled (struck) sail. */
    furledIgniteMult: share,
  }),
  ram: strict({
    /** Closing speeds (m/s) for the minimum and the maximum ram damage of balance.seaBattle.galleyRamHull. */
    minSpeedMs: positive,
    fullSpeedMs: positive,
    /** Seconds before the galley can ram again, and how long it backs water after a strike. */
    cooldownS: nonNeg,
    backOffS: nonNeg,
    /** Damage the ramming galley takes, share of crew lost on the rammed ship, morale shock. */
    selfDamage: nonNeg,
    crewLossPct: share,
    morale: finite,
    /** The ram must hit within this many metres of the target hull. */
    reachM: nonNeg,
  }),
  boarding: strict({
    /** Seconds the grapple lines must hold before the boarders cross. */
    grappleSetupS: nonNeg,
    /** Cut-free contest: attempt interval and P = clamp(base × free / (free + holders), min, max). */
    cutFreeIntervalS: positive,
    cutFreeBase: share,
    cutFreeMin: share,
    cutFreeMax: share,
    regrappleCooldownS: nonNeg,
    /** Battle seconds per deck-fight round (§31.13 resolves three). */
    deckRoundS: positive,
    /** Share of each deck role that fights: the boarding side keeps rowers at the oars to hold the ships together. */
    attackerShare: DeckShareSchema,
    defenderShare: DeckShareSchema,
    /** An attacking ship left with less than this share of its starting crew strikes to the defender. */
    surrenderCrewPct: share,
    /** Chance a captain falls in a lost deck fight, scaled by the share of his crew lost. */
    captainDeckKillChance: share,
    /** A routing or merchant ship strikes its colours when an enemy is this close and not slower. */
    caughtRangeM: nonNeg,
    /** Stakes of the captain duel after a boarding (§14.1). */
    duelStakes: z.enum(['firstBlood', 'yield', 'death']),
    /** Merchant crews strike as soon as they are grappled (§15.3 "surrender when caught"). */
    merchantStrikesWhenGrappled: z.boolean(),
  }),
  morale: strict({
    /** Side-wide morale when its flagship is lost. */
    flagshipLost: finite,
    /** No enemy within this radius: morale recovers and routed ships may rally. */
    safeRadiusM: nonNeg,
  }),
  sinking: strict({
    /** Share of the crew of a sunk ship that survives the water, and the radius rescuers or captors must be within. */
    swimSurvival: share,
    rescueRadiusM: nonNeg,
    /** Captains (and the player) are more likely to reach a friendly hull. */
    captainSurvival: share,
    flagshipTransferRadiusM: nonNeg,
    /** Chance the player is wounded when the flagship goes down under him. */
    playerWoundOnTransfer: share,
  }),
  ai: strict({
    replanS: positive,
    /** Board when own deck power ≥ this × the target's. */
    boardAdvantage: positive,
    /** Keep-range distance as a share of balance.seaBattle.archeryRangeM. */
    keepRangeShare: share,
    lookaheadS: positive,
    upwindBiasDeg: nonNeg,
    /** Galleys charge targets within this distance when the ram is ready. */
    ramRangeM: nonNeg,
    /** Use oars instead of sail within this distance of the target (fine control). */
    closeQuartersM: nonNeg,
    /** Use sail when stamina falls below this and the sail gives at least sailIfStaminaRatio of row speed. */
    restStamina: nonNeg,
    sailIfStaminaRatio: share,
    /** A grappled ship tries to cut free when its deck power is below this × the boarder's. */
    cutFreeBelowRatio: positive,
    /** Directions sampled when choosing where to flee. */
    fleeRays: z.number().int().min(4).max(64),
    /** Keep the current target unless another is closer than this share of its distance. */
    targetStickiness: share,
    /** Distance multiplier for targets the ship can board with advantage (lower = preferred). */
    boardTargetBias: positive,
    /** Gap (metres) between hulls when coming alongside to grapple. */
    alongsideGapM: nonNeg,
    /** Throttle when closing from beyond cruiseBeyondM (saves the rowers for the fight). */
    cruiseThrottle: share,
    cruiseBeyondM: nonNeg,
    /** A galley rams only targets whose speed away from it is below this × its own speed (or that are close). */
    ramCatchRatio: positive,
    /** Board a wavering or routed target already at this deck-power ratio. */
    boardWaveringAdvantage: positive,
  }),
  orders: strict({
    followSpacingM: positive,
    screenDistM: positive,
    /** Click-to-move target reached within this radius. */
    arriveRadiusM: positive,
  }),
  battle: strict({
    /** Battle-time cap (seconds); a battle still undecided ends as a draw. */
    maxBattleS: positive,
    /** After a side sounds the retreat, ships still in the arena after this long slip away. */
    retreatTimeoutS: positive,
    /** Distance between the two sides' lines at the start, ship spacing in a line, ships abreast per row. */
    spawnSeparationM: positive,
    lineSpacingM: positive,
    rowSpacingM: positive,
    shipsPerRow: z.number().int().min(1),
    /** Radius around each side's start kept clear of islands, rocks and shoals. */
    spawnClearM: nonNeg,
    /** A merchant side starts in the centre with its pursuers this close (the encounter's intercept). */
    chaseSpawnSeparationM: positive,
    /** After the retreat timeout, ships with no enemy this close slip away. */
    slipAwayClearM: nonNeg,
  }),
  /** Default deck assignment (§15.2 slider) by role; rowers are the remainder. */
  deck: strict({
    default: strict({ archers: share, boarders: share }),
    merchant: strict({ archers: share, boarders: share }),
  }),
  /** Building a battle from GameState. */
  setup: strict({
    /** Unit assumed for explicit ships given without a unit mix. */
    defaultUnit: z.string().min(1),
    /** Crew of an explicit ship given without a count, as a share of crewMax. */
    explicitCrewShare: share,
    /** Wind strength weights when neither the caller nor the weather gives the wind. */
    windWeights: strict({ calm: nonNeg, light: nonNeg, fresh: nonNeg, strong: nonNeg, gale: nonNeg }),
  }),
  autoresolve: strict({
    /** §12.7 drakkar dread: +5 each, capped (as a percentage bonus to fleet power). */
    dreadCap: nonNeg,
    galleyRamMult: positive,
    seaFireMult: positive,
    /** Power multiplier for a side loosing fire arrows (pitch aboard). */
    fireArrowsMult: positive,
    /** Big-hull edge of drakkars in deck fights (×1.1 deck power compounding with crew concentration), weighted by their crew share. */
    drakkarMult: positive,
    /**
     * Calibration of the sea power ratio to the engine (parity harness, §33 M5 ①): the §31.11
     * curve is applied to r^ratioSharpness. 1 = exactly the land curve.
     */
    ratioSharpness: positive,
    /** Share of the loser's lost ships taken as prizes (the rest sink); merchants always strike. */
    captureShare: share,
    /** Loser ships lost per unit of casualty share. */
    shipLossPerCasualty: nonNeg,
    /** The winner loses a ship when its casualty share exceeds this. */
    winnerShipLossAt: share,
    /** Hull damage (share of hullMax) per unit of casualty share. */
    hullDamagePerCasualty: nonNeg,
    /** The faster fleet holds the weather gauge when its speed exceeds the other's by this share. */
    gaugeSpeedEdge: nonNeg,
    /** Hull share left on captured prizes. */
    prizeHullShare: range,
    /** Battle seconds reported for an auto-resolved fight [min, max]. */
    durationS: range,
  }),
  xp: strict({ base: nonNeg, win: nonNeg, perShip: nonNeg }),
  arenaGen: strict({
    /** Terrain grid cell size (metres). */
    cellM: positive,
    /** Template used when the setup's arena id is unknown. */
    fallback: z.string().min(1),
  }),
  arenas: z.record(z.string().regex(/^[a-z][A-Za-z0-9]*$/), ArenaTemplateSchema),
});
export type Tunables = z.infer<typeof schema>;
