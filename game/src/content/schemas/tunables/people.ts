/**
 * Tunables owned by the 'people' module: src/content/data/tunables/people.json, read in sim code as
 * `ctx.tunables.people`. The people agent owns this file and the JSON; add keys to both (strict:
 * unknown keys are errors). The §31 formula tables stay in balance.json (frozen during the parallel
 * phase); everything here is a value the design leaves open (first guesses for the balance harness).
 */
import { z } from 'zod';
import { AttributeIdSchema, FaithIdSchema, SkillIdSchema } from '../ids';

const num = z.number().finite();
const nonNeg = z.number().finite().min(0);
const prob = z.number().finite().min(0).max(1);
const count = z.number().int().min(0);
const skill = SkillIdSchema;
const attribute = AttributeIdSchema;
const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
const perSkill = <V extends z.ZodTypeAny>(value: V) =>
  strict({
    melee: value,
    archery: value,
    command: value,
    seafaring: value,
    wildcraft: value,
    speechcraft: value,
    stewardship: value,
    runecraft: value,
  });

/** A clamped linear check: P = clamp(base + perPoint × (score − pivot), min, max). */
const check = strict({ base: prob, perPoint: num, pivot: num, min: prob, max: prob });

export const schema = z
  .object({
    /** HP shown for each wound state. */
    woundHpPct: strict({ none: nonNeg, minor: nonNeg, serious: nonNeg, mortal: nonNeg }),
    /** Stat penalty while mortally wounded (bedridden); minor/serious come from balance.health.wounds. */
    mortalStatPenalty: prob,
    /** Wound/injury recovery time −X per point of effective Vigor above the attribute pivot (§5.2). */
    vigorRecoveryPerPoint: num,
    /** Fraction of the balance.health.healCost range charged per wound severity. */
    healCostShare: strict({ minor: prob, serious: prob, mortal: prob }),
    /** Faiths whose settlements keep a church that tends the wounded. */
    churchFaiths: z.array(FaithIdSchema),
    /** Minimum Runecraft for a seer to treat minor and serious wounds (mortal: balance.health.wounds.mortal.healerRunecraft). */
    seerMinRunecraft: count,
    /** Relic keys checked for the Golden Sheaf / Gray Queen's Comb (flag `relic.<key>` or a held relic with that id/defId). */
    relics: strict({ goldenSheaf: z.string().min(1), grayQueensComb: z.string().min(1) }),
    /** Gray Queen's Comb: wounded recover 2× faster (recovery-time multiplier). */
    combRecoveryMult: nonNeg,
    conception: strict({
      /** Spouses must share a location (an unknown location counts as together). */
      requireTogether: z.boolean(),
      postpartumDays: count,
    }),
    childIllness: strict({
      deathChance: prob,
      /** Risk multiplier when a healer tends the child. */
      healerMult: nonNeg,
      healerMinRunecraft: count,
    }),
    comingOfAge: strict({
      skillPoints: count,
      attributePoints: count,
      /** Cap per skill for the points granted at 16 (tutoring may already exceed it). */
      skillCap: count,
    }),
    fosterage: strict({
      minAge: count,
      maxAge: count,
      /** An allied court: stance allied/friendly, or opinion at least this. */
      allyMinOpinion: num,
      /** The fosterling becomes a hostage when the host's opinion drops below this or war breaks out. */
      hostageOpinionBelow: num,
      /** A hostage is sent home once the two houses are at peace and opinion is back to at least this. */
      hostageReturnOpinion: num,
    }),
    /** Education trait gained at 16 per tutoring focus skill (§23.3). */
    educationTraitBySkill: perSkill(z.string().min(1)),
    /** Education trait of a child fostered at an allied court. */
    fosteredAbroadTrait: z.string().min(1),
    /** Attribute an inclination toward a skill favours when auto-assigning attribute points. */
    skillAttribute: perSkill(attribute),
    /** Skill each Saga Feat suits (NPC feat picks by inclination). */
    featAffinity: z.record(z.string().regex(/^[a-z][A-Za-z0-9]*$/), skill),
    /** NPCs pick a Saga Feat automatically at feat levels. */
    npcFeats: z.boolean(),
    /** Depth of the family-tree search for "nearest adult kin" (§23.4). */
    kinSearchDepth: count,
    /** A surviving spouse inherits when no blood kin is left. */
    spouseCanInherit: z.boolean(),
    /** Blood relatives within this many parent/child steps may not marry. */
    closeKinDistance: count,
    maxLivingSpouses: z.number().int().min(1),
    captivity: strict({
      /** Agility + Wildcraft + Wits check; each failed attempt raises the guard. */
      escape: check,
      escapeGuardStep: prob,
      /** Speechcraft (+ Wits) check to lower the ransom. */
      bargain: check,
      bargainRansomCut: prob,
      /** The ransom never drops below this share of the original. */
      bargainRansomFloor: prob,
      /** Monthly Vigor check (failure: serious wound; two in a row: mortal). */
      vigor: check,
      /** Swearing fealty to the captor costs this share of the house's Renown. */
      fealtyRenownLoss: prob,
      /** After sending word, each allied faction may mount a rescue each week. */
      rescueChancePerAllyWeekly: prob,
      /** Weekly escape chance of NPC captives (scaled by their escape check). */
      npcEscapeWeekly: prob,
      /** NPC captives held by the AI are ransomed by their kin after this many days. */
      npcRansomDays: count,
      /**
       * The steward ransoms the house's other captives (kin, lieutenants) once word has had this many
       * days to reach home, under the `captivityRansom` policy and if the treasury can pay.
       */
      houseRansomDays: count,
      /** Ransom wealth tier = floor(treasury / this), capped (§31.15). */
      wealthTierSilver: z.number().finite().positive(),
      wealthTierMax: count,
    }),
    regency: strict({
      /** "Skip to coming of age": risk events rolled per year of regency. */
      riskChancePerYear: prob,
      treasuryLossShare: prob,
      holdingLoyaltyLoss: nonNeg,
      lieutenantLoyaltyLoss: nonNeg,
    }),
    /** Storylet scheduled on the old-age warning (empty: none; the OldAgeWarned event is always emitted). */
    oldAgeStoryletId: z.string(),
    /** Oath-taking storylet scheduled after an adult succession (empty: none; SuccessionOccurred is always emitted). */
    oathTakingStoryletId: z.string(),
  })
  .strict();
export type Tunables = z.infer<typeof schema>;
