/**
 * Omens (design §4.4, §22.6, §31.12). A rune-seer (Old Ways) or the priests (Lantern "signs") read
 * an omen for each activity:
 *
 *   omenScore = Σ relevantFavor / favorDivisor + d6 − 3.5        (Lantern: piety / pietyDivisor)
 *   → Ill (< −2) / Uncertain (−2 … < 0) / Fair (0 … 3) / Blessed (> 3)
 *
 * then a Lucky / Ill-Omened ruler (`omen.shiftChance` trait and feat modifiers) moves the result one
 * step with that probability. Valgrim's Favor and `omen.accuracy` (Seer-Taught) add dice, keeping the
 * one nearest the mean ("more accurate omens": less variance, same expectation). A Skeptic
 * (`omen.ignoreIll`) shrugs off an Ill reading.
 *
 * ADR-002: an omen is the crew's and the household's confidence and the skipper's patience, never a
 * prophecy; the text reports what people believe.
 */
import type { Content } from '@content/index';
import type { Balance } from '@content/schemas/balance';
import { OMEN_IDS } from '@content/schemas/ids';
import { OMEN_ACTIVITIES, type OmenActivity, type Tunables } from '@content/schemas/tunables/faith';
import type { RandomSource } from '@sim/core/rng';
import type { CharId, GameState, GodId, Hour, OmenId, SettlementId } from '@sim/core/state';
import { addDays } from '@sim/core/time';
import { characterModifier, favorOf, isLanternFaith, OLD_WAYS } from './state';
import type { OmenReading, OmenReadings } from './types';

/** Inputs of one omen roll (everything except the dice). */
export interface OmenRollInput {
  /** Σ relevantFavor / favorDivisor (or piety / pietyDivisor, or an AI baseline). */
  base: number;
  /** Extra dice; the die nearest the mean is kept. */
  extraDice: number;
  /** Net Lucky/Ill-Omened chance: > 0 one step better with that chance, < 0 one step worse. */
  shiftChance: number;
  /** Skeptic: an Ill result counts as Uncertain. */
  ignoreIll: boolean;
}

/** The outcome of one omen roll. */
export interface OmenRoll {
  omen: OmenId;
  /** base + kept die − dieOffset. */
  score: number;
  /** The kept die. */
  die: number;
  /** Every die rolled (first = the plain d6). */
  dice: number[];
  /** −1, 0 or +1: the Lucky/Ill-Omened step applied. */
  shifted: number;
}

/** §22.6 bands: Ill (< ill) / Uncertain (< fair) / Fair (≤ blessed) / Blessed (> blessed). */
export function classifyOmen(score: number, thresholds: Balance['omens']['thresholds']): OmenId {
  if (score < thresholds.ill) return 'ill';
  if (score < thresholds.fair) return 'uncertain';
  if (score <= thresholds.blessed) return 'fair';
  return 'blessed';
}

/** Moves an omen `steps` along Ill → Uncertain → Fair → Blessed (clamped at both ends). */
export function shiftOmen(omen: OmenId, steps: number): OmenId {
  const i = OMEN_IDS.indexOf(omen);
  const j = Math.max(0, Math.min(OMEN_IDS.length - 1, i + steps));
  return OMEN_IDS[j] as OmenId;
}

/**
 * Rolls one omen. Draws exactly `1 + extraDice` dice plus one chance draw when `shiftChance ≠ 0`, so
 * the number of draws depends only on the inputs (deterministic replays).
 */
export function rollOmen(omens: Balance['omens'], input: OmenRollInput, rng: RandomSource): OmenRoll {
  const sides = Math.max(1, omens.dieSides);
  const mean = (sides + 1) / 2;
  const n = 1 + Math.max(0, Math.floor(input.extraDice));
  const dice: number[] = [];
  let die = 0;
  let bestDist = Infinity;
  for (let i = 0; i < n; i++) {
    const d = rng.int(1, sides);
    dice.push(d);
    const dist = Math.abs(d - mean);
    if (dist < bestDist) {
      bestDist = dist;
      die = d;
    }
  }
  const score = input.base + die - omens.dieOffset;
  let omen = classifyOmen(score, omens.thresholds);
  let shifted = 0;
  const p = Math.max(-1, Math.min(1, input.shiftChance));
  if (p > 0) {
    if (rng.chance(p)) shifted = 1;
  } else if (p < 0) {
    if (rng.chance(-p)) shifted = -1;
  }
  omen = shiftOmen(omen, shifted);
  if (input.ignoreIll && omen === 'ill') omen = 'uncertain';
  return { omen, score, die, dice, shifted };
}

/** Old Ways base: Σ Favor of the activity's gods (balance `omens.activities`) / favorDivisor. */
export function favorBase(balance: Balance, activity: OmenActivity, favor: Readonly<Record<GodId, number>>): number {
  let sum = 0;
  for (const god of balance.omens.activities[activity]) sum += Object.hasOwn(favor, god) ? (favor[god] ?? 0) : 0;
  return sum / balance.omens.favorDivisor;
}

/** Lantern base: piety / pietyDivisor (the same for every activity). */
export function pietyBase(t: Tunables, piety: number): number {
  return piety / t.omens.pietyDivisor;
}

/**
 * The §31.12 modifiers of an omen for an activity: balance `omens.modifiers[omen]` (moralePct,
 * stormMult, battleMorale) merged with `tunables.faith.omens.extraModifiers[activity][omen]`.
 * Exported for the client and tools; sim modules read the same two content tables directly.
 */
export function omenEffects(balance: Balance, t: Tunables, activity: OmenActivity, omen: OmenId): Record<string, number> {
  const base = balance.omens.modifiers[omen];
  const out: Record<string, number> = { moralePct: base.moralePct, stormMult: base.stormMult, battleMorale: base.battleMorale };
  const extra = t.omens.extraModifiers[activity][omen];
  for (const [k, v] of Object.entries(extra)) out[k] = (Object.hasOwn(out, k) ? (out[k] ?? 0) : 0) + v;
  return out;
}

/** The reading in force for an activity at `hour` (undefined when none or expired). */
export function currentOmen(readings: OmenReadings | undefined, activity: OmenActivity, hour: Hour): OmenReading | undefined {
  if (!readings || !Object.hasOwn(readings, activity)) return undefined;
  const r = readings[activity];
  return r && hour < r.untilHour ? r : undefined;
}

/** What a reading for one house is based on. */
export interface ReadingBasis {
  /** True for Lantern signs (piety), false for a rune-seer (Favor). */
  signs: boolean;
  /** Per-activity base value. */
  base: Record<OmenActivity, number>;
  extraDice: number;
  shiftChance: number;
  ignoreIll: boolean;
}

/**
 * The basis of a reading for the player's house: Favor for the Old Ways, Piety for the Lantern;
 * the ruler's traits/feats give the Lucky/Ill-Omened shift, extra dice and the Skeptic rule.
 */
export function playerReadingBasis(state: GameState, content: Content): ReadingBasis {
  const t = content.tunables.faith;
  const house = state.player.house;
  const ruler: CharId = state.player.rulerId;
  const signs = isLanternFaith(t, house.faith);
  const base = {} as Record<OmenActivity, number>;
  for (const a of OMEN_ACTIVITIES) {
    base[a] = signs ? pietyBase(t, house.piety ?? content.balance.standing.piety.start) : house.faith === OLD_WAYS ? favorBase(content.balance, a, house.favor) : t.omens.aiBaseline;
  }
  let extra = characterModifier(state, content, ruler, 'omen.accuracy');
  if (!signs && house.faith === OLD_WAYS) extra += Math.floor(Math.max(0, house.favor.valgrim) / t.omens.valgrimFavorPerExtraDie);
  return {
    signs,
    base,
    extraDice: Math.min(t.omens.maxExtraDice, Math.max(0, extra)),
    shiftChance: characterModifier(state, content, ruler, 'omen.shiftChance'),
    ignoreIll: characterModifier(state, content, ruler, 'omen.ignoreIll') > 0,
  };
}

/** The basis of an AI faction's monthly reading (Favor for Old Ways factions, the AI baseline otherwise). */
export function factionReadingBasis(state: GameState, content: Content, factionId: GameState['player']['factionId']): ReadingBasis {
  const t = content.tunables.faith;
  const faction = state.factions[factionId];
  const favor = favorOf(state, factionId);
  const oldWays = faction?.faith === OLD_WAYS && favor !== undefined;
  const base = {} as Record<OmenActivity, number>;
  for (const a of OMEN_ACTIVITIES) base[a] = oldWays ? favorBase(content.balance, a, favor) : t.omens.aiBaseline;
  const ruler = faction?.rulerId;
  let extra = characterModifier(state, content, ruler, 'omen.accuracy');
  if (oldWays) extra += Math.floor(Math.max(0, favor.valgrim) / t.omens.valgrimFavorPerExtraDie);
  return {
    signs: !oldWays && isLanternFaith(t, faction?.faith),
    base,
    extraDice: Math.min(t.omens.maxExtraDice, Math.max(0, extra)),
    shiftChance: characterModifier(state, content, ruler, 'omen.shiftChance'),
    ignoreIll: characterModifier(state, content, ruler, 'omen.ignoreIll') > 0,
  };
}

/** Rolls a full set of readings (one per activity, in OMEN_ACTIVITIES order) from a basis. */
export function rollReadings(
  content: Content,
  basis: ReadingBasis,
  rng: RandomSource,
  hour: Hour,
  settlementId?: SettlementId,
): { readings: OmenReadings; rolls: Record<OmenActivity, OmenRoll> } {
  const t = content.tunables.faith;
  const readings: OmenReadings = {};
  const rolls = {} as Record<OmenActivity, OmenRoll>;
  for (const a of OMEN_ACTIVITIES) {
    const roll = rollOmen(
      content.balance.omens,
      { base: basis.base[a], extraDice: basis.extraDice, shiftChance: basis.shiftChance, ignoreIll: basis.ignoreIll },
      rng,
    );
    rolls[a] = roll;
    // The stored score is informational (tooltips); the omen was classified from the exact value.
    const score = Math.round(roll.score * 100) / 100;
    const reading: OmenReading = { omen: roll.omen, score, readHour: hour, untilHour: addDays(hour, t.omens.durationDays[a]) };
    if (settlementId !== undefined) reading.settlementId = settlementId;
    if (basis.signs) reading.signs = true;
    readings[a] = reading;
  }
  return { readings, rolls };
}
