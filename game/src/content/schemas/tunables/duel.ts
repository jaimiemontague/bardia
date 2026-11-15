/**
 * Tunables owned by the 'duel' module: src/content/data/tunables/duel.json, read in sim code as
 * `ctx.tunables.duel`. The duel agent owns this file and the JSON; add keys to both (strict:
 * unknown keys are errors). The §31 formula tables stay in balance.json (frozen during the parallel
 * phase): HP/stamina/shield formulas, the §14.5 move table, the damage formula, parry windows, the
 * Assisted-Mode tell formula, auto-resolve weights and Duel Renown live under `balance.duel` /
 * `balance.weapons`. Everything here is the engine detail the design leaves open (arena sizes,
 * recovery and stagger timings, AI behaviour, outcome magnitudes) — first guesses for the duel-sim
 * balance harness (tools/duel-sim).
 */
import { z } from 'zod';
import { DUEL_WEAPON_IDS, DuelWeaponIdSchema } from '../ids';

const num = z.number().finite();
const nonNeg = z.number().finite().min(0);
const positive = z.number().finite().positive();
const prob = z.number().finite().min(0).max(1);
const count = z.number().int().min(0);
const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

const ArenaSchema = strict({
  /** Half the usable floor along the duel axis (metres from the centre). */
  halfWidthM: positive,
  /** Leaving the floor loses the duel (the holmgang square, §14.10); otherwise the edge is a wall. */
  ringOut: z.boolean(),
});

const DUEL_ARENAS = ['hall', 'deck', 'beach', 'holmgang', 'field'] as const;
const DUEL_ORIGINS = ['battle', 'boarding', 'tavern', 'thing', 'nemesis', 'guardian', 'storylet', 'practice', 'other'] as const;
const AI_STYLES = ['aggressive', 'defensive', 'tricky', 'brute'] as const;
const DIFFICULTIES = ['hearthside', 'raider', 'seaKing', 'longWinter'] as const;

const arenaMap = strict(Object.fromEntries(DUEL_ARENAS.map((k) => [k, ArenaSchema])) as Record<(typeof DUEL_ARENAS)[number], typeof ArenaSchema>);

/** Real-time AI behaviour per personality (§14 task: Aggressive, Defensive, Tricky, Brute). */
const AiStyleSchema = strict({
  /** Defence weights when an attack is read: parry / block / dodge / counter-strike / do nothing. */
  parry: nonNeg,
  block: nonNeg,
  dodge: nonNeg,
  counter: nonNeg,
  ignore: nonNeg,
  /** Offence: how often an attack is attempted (× the difficulty's decision cadence). */
  attackRate: positive,
  /** Offence weights: light strike / heavy strike / shield bash / feint / taunt / wait behind the guard. */
  light: nonNeg,
  heavy: nonNeg,
  bash: nonNeg,
  feint: nonNeg,
  taunt: nonNeg,
  wait: nonNeg,
  /** Share of light strikes aimed low when the foe's guard gives no hint. */
  lowShare: prob,
  /** Preferred distance as a share of the fighter's own reach. */
  rangeMult: positive,
  /** Below this stamina share the fighter backs off instead of attacking. */
  minStaminaShare: prob,
  /** Chance to strike the open height when the foe is seen guarding. */
  exploitGuard: prob,
  /** Chance (re-rolled at each decision) to hold the guard while waiting within the foe's reach. */
  idleGuard: prob,
  /** Chance to keep the guard held behind a parry attempt (no whiff penalty, but no free riposte bait either). */
  parryHold: prob,
});

/** Real-time AI reaction by game difficulty (ADR-003: difficulty changes reaction time and coordination, never stats). */
const AiDifficultySchema = strict({
  /** Time to perceive a new action of the opponent. */
  reactionMs: nonNeg,
  /** Uniform jitter added to the reaction time (0..jitter). */
  reactionJitterMs: nonNeg,
  /** Standard deviation of parry/dodge timing errors. */
  timingSdMs: nonNeg,
  /** Chance to misread a strike's height even when the glyph would show it. */
  readError: prob,
  /** Chance to not respond at all to a perceived attack. */
  mistakeChance: prob,
  /** Base cadence of offensive decisions. */
  decisionMs: positive,
  /** Assisted Mode: weight of exploiting the human's habits (0 = ignores them). */
  assistedAdapt: prob,
  /** Chance to abort the own wind-up (feint) on seeing the foe's blow will land first. */
  abortChance: prob,
});

const OutcomeSchema = strict({
  /** "Renown ++" for a kill (§14.9), as a multiple of the Duel Renown. */
  killRenownMult: nonNeg,
  /** Renown lost when the player's side loses, as a share of the Duel Renown. */
  loseRenownMult: nonNeg,
  /** Renown share when a champion (not the ruler) fights for the house. */
  championRenownMult: nonNeg,
  /** Dread gained when the player's side kills the foe ("Dread +"). */
  killDread: num,
  /** Opinion of the foe's faction when the player spares them ("the foe's kin owe you"). */
  spareOpinion: num,
  /** Opinion of the foe's faction when the player kills them (blood-feud). */
  killOpinion: num,
  /** Wound the loser of a fought duel always takes (blows were landed), unless the injury roll is worse. */
  loserWound: z.enum(['none', 'minor', 'serious']),
  /** Stat penalty assumed for a mortally wounded (bedridden) fighter forced into a duel. */
  mortalStatPenalty: prob,
  /** Origins where the winner may take the loser captive. */
  captureOrigins: z.array(z.enum(DUEL_ORIGINS)),
  /** Origins where the challenged player may decline, and the Renown it costs. */
  declineRenown: z.record(z.enum(DUEL_ORIGINS), num),
  /** XP for each fighter of a practice-yard bout (§14.6: small XP, no injuries). */
  practiceXp: nonNeg,
  /** At most this many successful taunts pay the taunt Renown on a win. */
  tauntBonusMax: count,
  /** Faction kinds whose rulers count as kings for Duel Renown tiers (others: jarls). */
  kingFactionKinds: z.array(z.string().min(1)),
  /** Character role kinds that count as hersir for Duel Renown tiers. */
  hersirRoles: z.array(z.string().min(1)),
  /** Champions (not the ruler) may fight in real time (§14.1 says auto-resolve or Assisted Mode). */
  championRealtime: z.boolean(),
  /** Chronicle importance of a player duel (kills and deaths add 1). */
  chronicleImportance: count,
  /**
   * Fought duels: the winner's injury chance (balance.health.duelWinnerInjuryChance) is scaled by the
   * HP it lost (full chance at ≤ 50% HP left, none unhurt). Auto-resolve always uses the full chance (§14.8).
   */
  winnerInjuryHpScaled: z.boolean(),
});

/** How an NPC's personality and traits pick its duel behaviour, mercy and nerve. */
const FighterSchema = strict({
  /** Style scores: personality axis weight + trait bonuses; highest wins (ties: listed order). */
  style: strict({
    aggressionWeight: num,
    cautionWeight: num,
    trickyBase: num,
    mightWeight: num,
    traits: strict(Object.fromEntries(AI_STYLES.map((k) => [k, z.record(z.string(), num)])) as Record<(typeof AI_STYLES)[number], z.ZodRecord<z.ZodString, typeof num>>),
  }),
  /** Chance to grant quarter / spare a beaten foe: base + (honor − 50)/100 × honorWeight + traits (+ stakes). */
  mercy: strict({ base: prob, honorWeight: num, deathStakes: num, min: prob, max: prob, traits: z.record(z.string(), num) }),
  /** HP share below which an NPC asks for quarter: base + (caution − 50)/100 × cautionWeight + traits; 0 = never. */
  yieldHp: strict({ base: prob, cautionWeight: num, max: prob, traits: z.record(z.string(), num) }),
  /** Chance an NPC winner takes the beaten foe captive where capture is allowed: base + (greed − 50)/100 × greedWeight. */
  capture: strict({ base: prob, greedWeight: num }),
  /** Starting HP floor (percent) for an already hurt fighter. */
  minStartHpPct: z.number().min(1).max(100),
  /** NPC weapon preference by style when the weapon tier allows it (else the culture's default weapon). */
  styleWeapon: z.object(Object.fromEntries(AI_STYLES.map((k) => [k, DuelWeaponIdSchema.optional()])) as Record<(typeof AI_STYLES)[number], z.ZodOptional<typeof DuelWeaponIdSchema>>).strict(),
});

export const schema = strict({
  arenas: arenaMap,
  /** Distance between the fighters when the duel starts. */
  startGapM: positive,
  /** Bodies never come closer than this. */
  minGapM: positive,
  /** Metres of strike distance per point of weapon reach (§14.4 reach 1.0 = this many metres). */
  reachMetresPerUnit: positive,
  walkSpeedMps: positive,
  backSpeedMps: positive,
  /** Movement while holding the guard, as a multiple of walking speed. */
  guardMoveMult: nonNeg,
  /** Agility above the pivot shortens wind-ups by this percentage per point (§5.2 "duel speed"). */
  agilitySpeedPct: num,
  /**
   * Melee above `meleeSpeedPivot` shortens wind-ups (and so recoveries) by this percentage per point:
   * a practised fighter's blows are economical. The design gives Melee only +3% damage and +8 ms
   * parry per point (§5.3), which alone barely separates two fighters in real time; this keeps a
   * Melee edge worth roughly what §14.8 auto-resolve says (tools/duel-sim --check).
   */
  meleeSpeedPct: num,
  meleeSpeedPivot: num,
  /** Bounds of the wind-up multiplier from Agility. */
  speedMultMin: positive,
  speedMultMax: positive,
  /** Equipment tier above 1 adds this percentage of damage (keeps real time in step with §14.8's weapon-tier weight). */
  weaponTierDamagePct: num,
  /** Recovery after a strike that connects / misses, as a multiple of its wind-up. */
  recoverMult: nonNeg,
  whiffRecoverMult: nonNeg,
  /** A clean hit interrupts the target's action for this long. */
  flinchMs: nonNeg,
  /** The attacker of a parried strike is staggered this long (the riposte opening). */
  parriedStaggerMs: nonNeg,
  /** A tapped parry that catches nothing leaves the fighter open this long (what a feint baits). */
  parryWhiffMs: nonNeg,
  /** Heavy-strike guard break (§14.5 40%): the blocker is staggered this long. */
  guardBreakStaggerMs: nonNeg,
  /** Hammer stagger on hit (§14.4 25%) lasts this long. */
  hammerStaggerMs: nonNeg,
  /** The hammer's stagger chance also applies to blows caught on a guard (it batters through). */
  staggerOnBlock: z.boolean(),
  /**
   * Poise: wind-ups a flinch cannot interrupt (the blows trade instead) — heavy strikes, and every
   * strike of the listed weapons (a two-handed axe is committed once it swings). A hammer stagger,
   * a parry, a bash or a guard break still stop them.
   */
  poise: strict({ heavy: z.boolean(), weapons: z.array(DuelWeaponIdSchema) }),
  /** Recovery after a feint (short, so the feinter can punish a baited parry). */
  feintRecoverMs: nonNeg,
  /** Edge inputs (strike, bash, dodge, …) pressed while busy are remembered this long. */
  inputBufferMs: nonNeg,
  bash: strict({
    windupMs: positive,
    recoverMs: nonNeg,
    reachM: positive,
    /** Bash against a fighter who is not guarding: a shove and a short flinch. */
    openStaggerMs: nonNeg,
    pushM: nonNeg,
  }),
  dodge: strict({ durationMs: positive, distanceM: nonNeg, recoverMs: nonNeg }),
  /** Holmgang: time to take up the next shield after one is hewn apart. */
  shieldSwapMs: nonNeg,
  /** Blocking with the haft (two-handed weapon, or a broken shield). */
  haftBlock: strict({ share: prob, wrongHeightShare: prob }),
  /** Stamina lost per point of damage caught on a block. */
  blockHitStaminaPerDamage: nonNeg,
  /** A single hit must deal at least this much HP damage to count as first blood. */
  firstBloodMinDamage: nonNeg,
  /** Duels still undecided after this long are judged on remaining HP. */
  timeLimitS: positive,
  /** After a refused plea for quarter the fighter cannot ask again for this long. */
  yieldRetryMs: nonNeg,
  assisted: strict({
    /** Stamina regained by each fighter at the end of every exchange. */
    regenPerExchange: nonNeg,
    /** Stamina cost of holding a guard for one exchange (≈ one second of §14.5 block). */
    guardStamina: nonNeg,
    /** Exchanges a fighter stays exhausted after hitting 0 stamina. */
    exhaustedExchanges: count,
    /** Chance an axe strike caught on a shield hooks it (no heavy strikes in Assisted Mode). */
    hookChance: prob,
    /** Exchanges before the duel is judged on remaining HP. */
    maxExchanges: z.number().int().positive(),
    /** Flavour-line variants per choice (duel.tell.<choice>.<n>). */
    tellVariants: z.number().int().positive(),
    /** After a refused plea for quarter a fighter cannot ask again for this many exchanges. */
    yieldRetryExchanges: count,
    /** Nominal seconds per exchange (reported duration of an Assisted duel). */
    exchangeSeconds: nonNeg,
    /**
     * Per-weapon damage multiplier in Assisted Mode only. An exchange is a fixed slice of time with
     * no footwork, so weapon tempo (wind-up) and reach are folded into one factor per weapon
     * (seeded from tempo: 550 ms ÷ wind-up; tuned with tools/duel-sim). Stats scale damage exactly
     * as in real time; this only keeps the weapon choice balanced.
     */
    weaponDamageMult: strict(Object.fromEntries(DUEL_WEAPON_IDS.map((w) => [w, positive])) as Record<(typeof DUEL_WEAPON_IDS)[number], typeof positive>),
  }),
  ai: strict({
    styles: strict(Object.fromEntries(AI_STYLES.map((k) => [k, AiStyleSchema])) as Record<(typeof AI_STYLES)[number], typeof AiStyleSchema>),
    difficulty: strict(Object.fromEntries(DIFFICULTIES.map((k) => [k, AiDifficultySchema])) as Record<(typeof DIFFICULTIES)[number], typeof AiDifficultySchema>),
    /** Per-second chance that an NPC below its quarter threshold asks for quarter. */
    yieldPerSecond: prob,
    /** Assisted Mode AI: multiplier of the guard choices' weight ((block + parry) × bias). */
    assistedGuardBias: nonNeg,
    /** A feint is cancelled after this share of the own wind-up (uniform in [min, max]). */
    feintAt: z.tuple([prob, prob]),
    /** Footwork dead band around the preferred distance (metres). */
    rangeSlackM: nonNeg,
    /** A tired fighter backs off to the foe's reach plus this margin (metres). */
    retreatMarginM: nonNeg,
    /** Holmgang: never step back when the square's edge is this close behind (metres). */
    edgeMarginM: nonNeg,
    /** Taunts only from this far outside the foe's reach (metres). */
    tauntSafeGapM: nonNeg,
    /** Per-decision taunt chance = style.taunt × this (when out of reach). */
    tauntChanceMult: nonNeg,
    /** Offence weight multipliers when the foe is seen guarding / open. */
    heavyVsGuardMult: nonNeg,
    bashVsGuardMult: nonNeg,
    bashVsOpenMult: nonNeg,
    /** Dodge weight multiplier against a blow from beyond the own reach (a forward dodge closes in). */
    outreachedDodgeMult: nonNeg,
    /** The abort-own-strike reflex is used only while this share of stamina would remain after the feint. */
    abortStaminaShare: prob,
    /**
     * The fighter's own skill sharpens its AI (not the difficulty): per point of Melee above
     * `meleePivot`, reaction time −reactionPctPerMelee%, mistakes −mistakePctPerMelee%, timing error
     * −timingPctPerMelee%, abort chance +abortPerMelee; per point of Wits above the attribute pivot,
     * misreads −readErrorPctPerWits%, compounding per point. (Below the pivot the AI gets worse.)
     */
    skill: strict({
      meleePivot: num,
      reactionPctPerMelee: num,
      mistakePctPerMelee: num,
      timingPctPerMelee: num,
      abortPerMelee: num,
      readErrorPctPerWits: num,
      /** Bounds of the compounded multiplier (of the difficulty's value). */
      multMin: positive,
      multMax: positive,
    }),
    /** Block weight multiplier against shield-breaking blows (two-handed axe). */
    shieldBreakerBlockMult: nonNeg,
  }),
  fighter: FighterSchema,
  /**
   * Nerve (§14.1 "Eidr's Favor applies", §22.6 duel omen, ADR-002 morale abstraction): the
   * `duel.nervePct` of the fighter's house's duel omen in force (faith tunables
   * `omens.extraModifiers.duel`) plus its traits'/feats' `duel.nervePct`, clamped to ±maxAbsPct.
   * Confidence is staying power: stamina max +staminaPctPerNervePct% per point, and the §14.8
   * DuelRating gains ratingPerNervePct per point (the "luck" term of auto-resolve).
   */
  nerve: strict({ staminaPctPerNervePct: num, ratingPerNervePct: num, maxAbsPct: nonNeg }),
  outcome: OutcomeSchema,
});
export type Tunables = z.infer<typeof schema>;
