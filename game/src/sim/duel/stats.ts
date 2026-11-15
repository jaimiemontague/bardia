/**
 * Derived duel numbers (design §14.3–§14.5, §14.8) and the fighter profile builder. Pure: reads a
 * Character and the content catalogs, never GameState slices or Immer drafts beyond plain reads.
 *
 * Effective stats = stored attributes/skills + trait/feat `attr.*`/`skill.*` modifiers + temporary
 * injuries (§22.5 table rows with an attribute/skill amount), clamped to the §5.2/§5.3 ranges, then
 * scaled by the wound penalty (§22.5: minor −10%, serious −25%, mortal = tunables
 * `outcome.mortalStatPenalty`).
 */
import type { Content } from '@content/index';
import type { Balance } from '@content/schemas/balance';
import type { DuelWeaponId } from '@content/schemas/ids';
import type { Tunables as DuelTunables } from '@content/schemas/tunables/duel';
import { clamp } from '@sim/core/dmath';
import type { Character, Hour, Personality } from '@sim/core/state';
import { AI_STYLES, type AiStyle, type DuelistProfile, type DuelStakes } from './types';

/** The content a duel computation needs (a SimContext or the client's content both satisfy it). */
export interface DuelContent {
  balance: Balance;
  traits: Content['traits'];
  feats: Content['feats'];
  cultures: Content['cultures'];
  tunables: { duel: DuelTunables };
}

/** Narrow content for the pure engines (no catalogs). */
export interface DuelEngineContent {
  balance: Balance;
  tunables: { duel: DuelTunables };
}

/** Effective (fractional) fighting stats of a character. */
export interface FighterStats {
  might: number;
  agility: number;
  wits: number;
  vigor: number;
  melee: number;
  level: number;
}

/** Gear and per-duel bonuses of one fighter. */
export interface DuelGear {
  weapon: DuelWeaponId;
  armourTier: number;
  weaponTier: number;
  ratingBonus?: number;
  damagePct?: number;
}

const NEUTRAL_PERSONALITY: Personality = { aggression: 50, greed: 50, honor: 50, caution: 50, ambition: 50, piety: 50 };

// ---------------------------------------------------------------------------------------------
// §14.3 bars

/** `HP = 100 × (1 + 0.08 × (Vigor − 4))`. */
export function duelHpMax(balance: Balance, vigor: number): number {
  const d = balance.duel;
  return Math.max(1, d.hpBase * (1 + d.vigorSlope * (vigor - balance.character.attributePivot)));
}

/** `Stamina = 100 × (1 + 0.08 × (Vigor − 4))`. */
export function duelStaminaMax(balance: Balance, vigor: number): number {
  const d = balance.duel;
  return Math.max(1, d.staminaBase * (1 + d.vigorSlope * (vigor - balance.character.attributePivot)));
}

/** `ShieldHP = 40 + 10 × (armourTier − 1)`; two-handed weapons have no shield (0). */
export function duelShieldMax(balance: Balance, weapon: DuelWeaponId, armourTier: number): number {
  if (!balance.weapons[weapon].shield) return 0;
  return Math.max(1, balance.duel.shieldBase + balance.duel.shieldPerTier * (armourTier - 1));
}

/** `armourReduction = 0.06 × (armourTier − 1)` (before weapon specials), clamped to [0, 0.9]. */
export function armourReduction(balance: Balance, armourTier: number): number {
  return clamp(balance.duel.damage.armourPerTier * (armourTier - 1), 0, 0.9);
}

/** Share of armour a weapon ignores: spear thrusts 30%, hammer 50% (§14.4). */
export function weaponArmourIgnore(balance: Balance, weapon: DuelWeaponId): number {
  const s = balance.weapons[weapon].special;
  return clamp((s['thrustArmourIgnore'] ?? 0) + (s['armourIgnore'] ?? 0), 0, 1);
}

/** Parry window (ms): 180 + 10 × Agility + 8 × Melee + `duel.parryMs` (Duelist +40), plus an accessibility extension. */
export function parryWindowMs(balance: Balance, agility: number, melee: number, bonusMs: number, accessibilityMs = 0): number {
  const d = balance.duel;
  return Math.max(0, d.parryBaseMs + d.parryPerAgilityMs * agility + d.parryPerMeleeMs * melee + bonusMs) + clamp(accessibilityMs, 0, d.accessibilityParryMaxMs);
}

/**
 * Wind-up multiplier (§5.2 Agility "duel speed"): 1 − agilitySpeedPct% per point of Agility above the
 * attribute pivot − meleeSpeedPct% per point of Melee above `meleeSpeedPivot`, clamped to
 * [speedMultMin, speedMultMax]. Recoveries scale with the wind-up, so this is the fighter's tempo.
 */
export function windupSpeedMult(balance: Balance, tunables: DuelTunables, agility: number, melee: number = tunables.meleeSpeedPivot): number {
  const m = 1 - (tunables.agilitySpeedPct / 100) * (agility - balance.character.attributePivot) - (tunables.meleeSpeedPct / 100) * (melee - tunables.meleeSpeedPivot);
  return clamp(m, tunables.speedMultMin, tunables.speedMultMax);
}

/**
 * The §14.5 damage formula for one strike against one target:
 * `damageBase × moveMult × (1 − armourReduction × (1 − ignore)) × extra`.
 */
export function strikeDamage(attacker: DuelistProfile, defender: DuelistProfile, moveMult: number, extraMult = 1): number {
  const armour = defender.armourReduction * (1 - attacker.armourIgnore);
  return Math.max(0, attacker.damageBase * moveMult * (1 - armour) * extraMult);
}

/** `damageBase` of a fighter (see DuelistProfile.damageBase). */
export function damageBase(balance: Balance, tunables: DuelTunables, stats: FighterStats, gear: DuelGear, damagePctMods: number): number {
  const d = balance.duel.damage;
  const pivot = balance.character.attributePivot;
  const pct = damagePctMods + (gear.damagePct ?? 0) + tunables.weaponTierDamagePct * Math.max(0, gear.weaponTier - 1);
  return Math.max(
    0,
    balance.weapons[gear.weapon].damage * (1 + d.mightSlope * (stats.might - pivot)) * (1 + d.meleeSlope * stats.melee) * (1 + pct / 100),
  );
}

/**
 * §14.8 `DuelRating = 2×Melee + Might + Agility + Vigor/2 + 3×(weaponTier−1) + 3×(armourTier−1) +
 * level/2 + traits + relics`. Trait/feat terms are the `duel.rating` modifiers of traits.json and
 * feats.json (single source per rule: Brave +2, Towering +3, Wrathful +2, Craven −3).
 */
export function duelRating(balance: Balance, stats: FighterStats, gear: DuelGear, ratingMods: number): number {
  const w = balance.duel.rating;
  return (
    w.melee * stats.melee +
    w.might * stats.might +
    w.agility * stats.agility +
    w.vigor * stats.vigor +
    w.weaponTier * (gear.weaponTier - 1) +
    w.armourTier * (gear.armourTier - 1) +
    w.level * stats.level +
    ratingMods +
    (gear.ratingBonus ?? 0)
  );
}

// ---------------------------------------------------------------------------------------------
// Modifiers, effective stats, personality

/** Σ of one modifier key over a character's traits and feats (unknown ids contribute nothing). */
export function sumModifier(content: Pick<DuelContent, 'traits' | 'feats'>, traits: readonly string[], feats: readonly string[], key: string): number {
  let sum = 0;
  for (const t of traits) {
    const def = Object.hasOwn(content.traits, t) ? content.traits[t] : undefined;
    const v = def?.modifiers[key];
    if (v !== undefined) sum += v;
  }
  for (const f of feats) {
    const def = Object.hasOwn(content.feats, f) ? content.feats[f] : undefined;
    const v = def?.modifiers[key];
    if (v !== undefined) sum += v;
  }
  return sum;
}

/** True when any of the traits/feats carries `flag`. */
export function hasFlag(content: Pick<DuelContent, 'traits' | 'feats'>, traits: readonly string[], feats: readonly string[], flag: string): boolean {
  for (const t of traits) if (Object.hasOwn(content.traits, t) && content.traits[t]?.flags.includes(flag)) return true;
  for (const f of feats) if (Object.hasOwn(content.feats, f) && content.feats[f]?.flags.includes(flag)) return true;
  return false;
}

/** Effective fighting stats of a character at `hour` (see the file header). */
export function effectiveStats(content: DuelContent, ch: Character, hour: Hour): FighterStats {
  const b = content.balance;
  const cfg = b.character;
  const traits = ch.traits;
  const feats = ch.feats;
  let might = ch.attributes.might + sumModifier(content, traits, feats, 'attr.might');
  let agility = ch.attributes.agility + sumModifier(content, traits, feats, 'attr.agility');
  let wits = ch.attributes.wits + sumModifier(content, traits, feats, 'attr.wits');
  let vigor = ch.attributes.vigor + sumModifier(content, traits, feats, 'attr.vigor');
  let melee = (ch.skills.melee ?? 0) + sumModifier(content, traits, feats, 'skill.melee');
  for (const injury of ch.health.injuries) {
    if (injury.untilHour !== undefined && injury.untilHour <= hour) continue;
    const row = b.health.injuryTable.find((r) => r.id === injury.id);
    if (!row || row.amount === undefined) continue;
    if (row.skill === 'melee') melee += row.amount;
    switch (row.attribute) {
      case 'might':
        might += row.amount;
        break;
      case 'agility':
        agility += row.amount;
        break;
      case 'wits':
        wits += row.amount;
        break;
      case 'vigor':
        vigor += row.amount;
        break;
      default:
        break;
    }
  }
  might = clamp(might, cfg.attributeMin, cfg.attributeMax);
  agility = clamp(agility, cfg.attributeMin, cfg.attributeMax);
  wits = clamp(wits, cfg.attributeMin, cfg.attributeMax);
  vigor = clamp(vigor, cfg.attributeMin, cfg.attributeMax);
  melee = clamp(melee, 0, cfg.skillMax);
  const penalty = woundPenalty(content, ch.health.wound);
  const k = 1 - penalty;
  return { might: might * k, agility: agility * k, wits: wits * k, vigor: vigor * k, melee: melee * k, level: ch.level };
}

/** Stat penalty of a wound state (§22.5). */
export function woundPenalty(content: DuelContent, wound: Character['health']['wound']): number {
  const w = content.balance.health.wounds;
  switch (wound) {
    case 'minor':
      return w.minor.statPenalty;
    case 'serious':
      return w.serious.statPenalty;
    case 'mortal':
      return content.tunables.duel.outcome.mortalStatPenalty;
    default:
      return 0;
  }
}

function traitSum(table: Record<string, number>, traits: readonly string[]): number {
  let s = 0;
  for (const t of traits) if (Object.hasOwn(table, t)) s += table[t] ?? 0;
  return s;
}

/** AI personality from the character's personality axes, traits and Might (tunables `fighter.style`). */
export function duelStyle(tunables: DuelTunables, personality: Personality | undefined, traits: readonly string[], might: number): AiStyle {
  const s = tunables.fighter.style;
  const p = personality ?? NEUTRAL_PERSONALITY;
  const scores: Record<AiStyle, number> = {
    aggressive: p.aggression * s.aggressionWeight + traitSum(s.traits.aggressive, traits),
    defensive: p.caution * s.cautionWeight + traitSum(s.traits.defensive, traits),
    tricky: s.trickyBase + traitSum(s.traits.tricky, traits),
    brute: might * s.mightWeight + traitSum(s.traits.brute, traits),
  };
  let best: AiStyle = AI_STYLES[0];
  for (const style of AI_STYLES) if (scores[style] > scores[best]) best = style;
  return best;
}

/** Chance to grant quarter / spare a beaten foe (tunables `fighter.mercy`). */
export function mercyChance(tunables: DuelTunables, personality: Personality | undefined, traits: readonly string[], stakes: DuelStakes): number {
  const m = tunables.fighter.mercy;
  const honor = (personality ?? NEUTRAL_PERSONALITY).honor;
  const v = m.base + ((honor - 50) / 100) * m.honorWeight + traitSum(m.traits, traits) + (stakes === 'death' ? m.deathStakes : 0);
  return clamp(v, m.min, m.max);
}

/** HP share below which an NPC asks for quarter; 0 when the fighter never yields (Brave: `refusesToFleeDuel`). */
export function yieldThreshold(content: DuelContent, personality: Personality | undefined, traits: readonly string[], feats: readonly string[]): number {
  if (hasFlag(content, traits, feats, 'refusesToFleeDuel')) return 0;
  const y = content.tunables.duel.fighter.yieldHp;
  const caution = (personality ?? NEUTRAL_PERSONALITY).caution;
  return clamp(y.base + ((caution - 50) / 100) * y.cautionWeight + traitSum(y.traits, traits), 0, y.max);
}

/** Chance an NPC winner takes the beaten foe captive (tunables `fighter.capture`). */
export function captureChance(tunables: DuelTunables, personality: Personality | undefined): number {
  const c = tunables.fighter.capture;
  return clamp(c.base + (((personality ?? NEUTRAL_PERSONALITY).greed - 50) / 100) * c.greedWeight, 0, 1);
}

// ---------------------------------------------------------------------------------------------
// Weapons

/** Weapons a fighter can take with this weapon tier (§14.4; swords need tier 3), in balance order. */
export function allowedWeapons(balance: Balance, weaponTier: number): DuelWeaponId[] {
  return (Object.keys(balance.weapons) as DuelWeaponId[]).filter((w) => balance.weapons[w].minWeaponTier <= weaponTier);
}

/**
 * Default weapon (§14.4 "default by culture"): the style's preferred weapon (tunables
 * `fighter.styleWeapon`), else the culture's, else the first allowed one.
 */
export function defaultWeapon(content: DuelContent, cultureWeapon: DuelWeaponId | undefined, weaponTier: number, style?: AiStyle): DuelWeaponId {
  const allowed = allowedWeapons(content.balance, weaponTier);
  const styled = style !== undefined ? content.tunables.duel.fighter.styleWeapon[style] : undefined;
  if (styled !== undefined && allowed.includes(styled)) return styled;
  if (cultureWeapon !== undefined && allowed.includes(cultureWeapon)) return cultureWeapon;
  return allowed[0] ?? 'axe';
}

// ---------------------------------------------------------------------------------------------
// Profiles

/** Everything needed to build a profile without a Character (tools, tests, the battle Challenge). */
export interface ProfileInput {
  charId: DuelistProfile['charId'];
  name: string;
  sex?: 'male' | 'female';
  stats: FighterStats;
  gear: DuelGear;
  traits?: readonly string[];
  feats?: readonly string[];
  personality?: Personality;
  /** 0–100; default 100. */
  hpPct?: number;
  stakes: DuelStakes;
  holmgang: boolean;
  /** Overrides the style derived from personality/traits. */
  style?: AiStyle;
  /** Nerve from the house's duel omen in force (`duel.nervePct`); traits/feats add their own. */
  omenNervePct?: number;
}

/** Nerve in percent: the omen's `duel.nervePct` + traits'/feats' `duel.nervePct`, clamped to ±`nerve.maxAbsPct`. */
export function nervePct(content: DuelContent, omenNervePct: number, traits: readonly string[], feats: readonly string[]): number {
  const max = content.tunables.duel.nerve.maxAbsPct;
  return clamp(omenNervePct + sumModifier(content, traits, feats, 'duel.nervePct'), -max, max);
}

/** Builds a fighter profile from explicit stats and gear. */
export function buildProfile(content: DuelContent, input: ProfileInput): DuelistProfile {
  const b = content.balance;
  const t = content.tunables.duel;
  const traits = input.traits ?? [];
  const feats = input.feats ?? [];
  const { stats, gear } = input;
  const weapon = b.weapons[gear.weapon];
  const hpMax = duelHpMax(b, stats.vigor);
  const hpPct = clamp(input.hpPct ?? 100, t.fighter.minStartHpPct, 100);
  const shieldMax = duelShieldMax(b, gear.weapon, gear.armourTier);
  const shields = shieldMax > 0 ? (input.holmgang ? Math.max(1, b.duel.holmgang.shields) : 1) : 0;
  const reachUnits = weapon.reach + sumModifier(content, traits, feats, 'duel.reach');
  const dodgeMult = clamp(1 + sumModifier(content, traits, feats, 'duel.dodgePct') / 100, 0.1, 2);
  const style = input.style ?? duelStyle(t, input.personality, traits, stats.might);
  const nerve = nervePct(content, input.omenNervePct ?? 0, traits, feats);
  const profile: DuelistProfile = {
    charId: input.charId,
    name: input.name,
    weapon: gear.weapon,
    armourTier: gear.armourTier,
    weaponTier: gear.weaponTier,
    might: stats.might,
    agility: stats.agility,
    wits: stats.wits,
    vigor: stats.vigor,
    melee: stats.melee,
    level: stats.level,
    hpMax,
    hpStart: (hpMax * hpPct) / 100,
    staminaMax: duelStaminaMax(b, stats.vigor) * Math.max(0.1, 1 + (nerve * t.nerve.staminaPctPerNervePct) / 100),
    shieldMax,
    shields,
    parryWindowMs: parryWindowMs(b, stats.agility, stats.melee, sumModifier(content, traits, feats, 'duel.parryMs')),
    windupMs: weapon.windupMs * windupSpeedMult(b, t, stats.agility, stats.melee),
    reachM: Math.max(0.1, reachUnits * t.reachMetresPerUnit),
    damageBase: damageBase(b, t, stats, gear, sumModifier(content, traits, feats, 'duel.damagePct')),
    armourIgnore: weaponArmourIgnore(b, gear.weapon),
    armourReduction: armourReduction(b, gear.armourTier),
    dodgeMult,
    rating: duelRating(b, stats, gear, sumModifier(content, traits, feats, 'duel.rating')) + nerve * t.nerve.ratingPerNervePct,
    style,
    mercy: mercyChance(t, input.personality, traits, input.stakes),
    yieldHp: yieldThreshold(content, input.personality, traits, feats),
    captureChance: captureChance(t, input.personality),
  };
  if (input.sex !== undefined) profile.sex = input.sex;
  if (nerve !== 0) profile.nervePct = nerve;
  return profile;
}

/** Builds a fighter profile from a character (effective stats at `hour`). */
export function profileFromCharacter(
  content: DuelContent,
  ch: Character,
  gear: DuelGear,
  opts: { hour: Hour; stakes: DuelStakes; holmgang: boolean; omenNervePct?: number },
): DuelistProfile {
  const stats = effectiveStats(content, ch, opts.hour);
  const input: ProfileInput = {
    charId: ch.id,
    name: ch.name,
    sex: ch.sex,
    stats,
    gear,
    traits: ch.traits,
    feats: ch.feats,
    hpPct: ch.health.hpPct,
    stakes: opts.stakes,
    holmgang: opts.holmgang,
  };
  if (ch.personality !== undefined) input.personality = ch.personality;
  if (opts.omenNervePct !== undefined) input.omenNervePct = opts.omenNervePct;
  return buildProfile(content, input);
}
