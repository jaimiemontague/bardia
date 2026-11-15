/**
 * Ruling houses and settlement leaders for world generation (§17.1, §18.2, §23): rulers with parents, siblings,
 * spouses and children, generated with the core `createCharacter` factory (culture names, the world module's
 * factory/name streams). Personalities are the culture template plus normal noise (balance.ai.personalityNoise)
 * plus trait shifts (§18.2). Family links are symmetric (the people module's invariants).
 */
import type { Tunables as WorldTunables } from '@content/schemas/tunables/world';
import { SKILL_IDS, type CultureId, type FaithId, type SkillId } from '@content/schemas/ids';
import { clamp } from '@sim/core/dmath';
import { createCharacter } from '@sim/core/factory';
import type { SimContext } from '@sim/core/module';
import type { Rng } from '@sim/core/rng';
import type { Character, CharId, FactionId, GameState, Hour, Personality } from '@sim/core/state';
import { HOURS_PER_YEAR } from '@sim/core/time';

type RulerProfile = WorldTunables['worldgen']['ruler'];
type LeaderProfile = WorldTunables['worldgen']['leader'];
type Profile = (RulerProfile | LeaderProfile) & { cultureSkills?: RulerProfile['cultureSkills']; giftChance?: number; flawChance?: number };

const AXES = ['aggression', 'greed', 'honor', 'caution', 'ambition', 'piety'] as const;

/** A personality from the culture template + noise + trait shifts, each axis an integer 0–100 (§18.2). */
export function makePersonality(ctx: SimContext, rng: Rng, culture: CultureId, traits: readonly string[]): Personality {
  const t = ctx.tunables.world.personality;
  const template = Object.hasOwn(t.templates, culture) ? (t.templates[culture] as Personality) : t.defaultTemplate;
  const noise = ctx.balance.ai.personalityNoise;
  const out = {} as Personality;
  for (const axis of AXES) {
    let v = template[axis] + rng.normal(0, noise);
    for (const trait of traits) v += Object.hasOwn(t.traitShifts, trait) ? (t.traitShifts[trait]?.[axis] ?? 0) : 0;
    out[axis] = clamp(Math.round(v), 0, 100) + 0; // + 0: never −0 (JSON round-trips must be exact)
  }
  return out;
}

/** Applies a personality delta (Rival shifts), clamped. */
export function shiftPersonality(p: Personality, delta: Partial<Record<keyof Personality, number | undefined>>): Personality {
  const out = { ...p };
  for (const axis of AXES) out[axis] = clamp(Math.round(out[axis] + (delta[axis] ?? 0)), 0, 100) + 0;
  return out;
}

/** Trait ids of a kind in catalogue order. */
function traitsOfKind(ctx: SimContext, kind: string): string[] {
  return Object.keys(ctx.content.traits).filter((id) => ctx.content.traits[id]?.kind === kind);
}

/** True if `trait` conflicts with one of `have` (opposites). */
export function traitConflicts(ctx: SimContext, have: readonly string[], trait: string): boolean {
  const def = ctx.content.traits[trait];
  if (!def) return true;
  if (have.includes(trait)) return true;
  for (const h of have) {
    if (def.opposite === h) return true;
    if (ctx.content.traits[h]?.opposite === trait) return true;
  }
  return false;
}

/** Random traits: `count` personality traits without opposites, plus a gift/flaw by chance. */
export function pickTraits(ctx: SimContext, rng: Rng, count: number, giftChance = 0, flawChance = 0): string[] {
  const out: string[] = [];
  const pool = traitsOfKind(ctx, 'personality');
  for (let tries = 0; out.length < count && tries < count * 6 && pool.length > 0; tries++) {
    const t = rng.pick(pool);
    if (!traitConflicts(ctx, out, t)) out.push(t);
  }
  if (giftChance > 0 && rng.chance(giftChance)) {
    const gifts = traitsOfKind(ctx, 'gift');
    if (gifts.length > 0) {
      const g = rng.pick(gifts);
      if (!traitConflicts(ctx, out, g)) out.push(g);
    }
  }
  if (flawChance > 0 && rng.chance(flawChance)) {
    const flaws = traitsOfKind(ctx, 'flaw');
    if (flaws.length > 0) {
      const f = rng.pick(flaws);
      if (!traitConflicts(ctx, out, f)) out.push(f);
    }
  }
  return out;
}

/** Culture bonuses' flat skill modifiers (`skill.<id>`), baked into generated characters like the player's. */
function cultureSkillBonus(ctx: SimContext, culture: CultureId, skill: SkillId): number {
  let sum = 0;
  for (const b of ctx.content.cultures[culture].bonuses) sum += b.modifiers[`skill.${skill}`] ?? 0;
  return sum;
}

export interface PersonOptions {
  culture: CultureId;
  faith?: FaithId;
  sex?: 'male' | 'female';
  age: number;
  profile: 'ruler' | 'leader';
  factionId?: FactionId;
  /** Give the character an AI personality (rulers and leaders). */
  personality: boolean;
  traits?: string[];
}

/** Generates a living character (location 'none'; placed by the caller). */
export function generatePerson(draft: GameState, ctx: SimContext, rng: Rng, o: PersonOptions): Character {
  const wg = ctx.tunables.world.worldgen;
  const profile: Profile = o.profile === 'ruler' ? wg.ruler : wg.leader;
  const ch = ctx.balance.character;
  const age = Math.max(0, Math.floor(o.age));
  const adultShare = age >= ch.adultAge ? 1 : age / ch.adultAge;
  const attributes = {
    might: clamp(Math.round(rng.int(profile.attributes[0], profile.attributes[1]) * (0.6 + 0.4 * adultShare)), ch.attributeMin, ch.attributeMax),
    agility: clamp(Math.round(rng.int(profile.attributes[0], profile.attributes[1]) * (0.6 + 0.4 * adultShare)), ch.attributeMin, ch.attributeMax),
    wits: clamp(rng.int(profile.attributes[0], profile.attributes[1]), ch.attributeMin, ch.attributeMax),
    vigor: clamp(Math.round(rng.int(profile.attributes[0], profile.attributes[1]) * (0.6 + 0.4 * adultShare)), ch.attributeMin, ch.attributeMax),
  };
  const skills: Partial<Record<SkillId, number>> = {};
  for (const s of SKILL_IDS) {
    const [lo, hi] = profile.skills[s];
    const bonus = profile.cultureSkills && Object.hasOwn(profile.cultureSkills, o.culture) ? (profile.cultureSkills[o.culture]?.[s] ?? 0) : 0;
    const base = Math.floor((rng.int(lo, hi) + bonus) * adultShare);
    skills[s] = clamp(base + (adultShare >= 1 ? cultureSkillBonus(ctx, o.culture, s) : 0), 0, ch.skillMax);
  }
  const level = age < ch.adultAge ? 1 : clamp(1 + Math.floor((age - ch.adultAge) / profile.yearsPerLevel) + rng.int(-1, 1), 1, Math.min(profile.maxLevel, ctx.balance.xp.maxLevel));
  const count = age < ch.adultAge ? 0 : rng.int(profile.personalityTraits[0], profile.personalityTraits[1]);
  const traits = o.traits ?? pickTraits(ctx, rng, count, age < ch.adultAge ? 0 : (profile.giftChance ?? 0), age < ch.adultAge ? 0 : (profile.flawChance ?? 0));
  const sex = o.sex ?? (rng.chance(profile.femaleChance) ? 'female' : 'male');
  const c = createCharacter(draft, ctx, {
    culture: o.culture,
    sex,
    age,
    attributes,
    skills,
    traits,
    level,
    ...(o.faith !== undefined ? { faith: o.faith } : {}),
    ...(o.factionId !== undefined ? { factionId: o.factionId } : {}),
  });
  if (o.personality) c.personality = makePersonality(ctx, rng, o.culture, traits);
  return c;
}

/** Links a parent and a child (both directions). */
export function linkChild(parent: Character, child: Character): void {
  if (!parent.family.childIds.includes(child.id)) parent.family.childIds.push(child.id);
  if (parent.sex === 'male') child.family.fatherId = parent.id;
  else child.family.motherId = parent.id;
}

/** Marries two characters (both directions). */
export function linkSpouses(a: Character, b: Character): void {
  if (!a.family.spouseIds.includes(b.id)) a.family.spouseIds.push(b.id);
  if (!b.family.spouseIds.includes(a.id)) b.family.spouseIds.push(a.id);
}

/** Marks a generated character dead some time ago (no role, no location). */
export function markDead(c: Character, hour: Hour, cause: string): void {
  c.alive = false;
  c.death = { hour, cause };
  delete c.role;
  c.location = { kind: 'none' };
}

/** Age in whole years at `now`. */
export function ageAt(c: Character, now: Hour): number {
  return Math.floor((now - c.birthHour) / HOURS_PER_YEAR);
}

/** A generated ruling house. */
export interface House {
  factionId?: FactionId;
  culture: CultureId;
  faith: FaithId;
  rulerId: CharId;
  fatherId: CharId;
  motherId: CharId;
  spouseId?: CharId;
  childIds: CharId[];
  siblingIds: CharId[];
  /** Every living member except the ruler (placed at court unless governing). */
  members: CharId[];
  /** Kin of the faction this house married into (kinship ties). */
  kinFactions: FactionId[];
  /** Capital position of the house (foreign-spouse matching). */
  pos?: { x: number; y: number };
}

export interface HouseOptions {
  culture: CultureId;
  faith: FaithId;
  rulerAge: number;
  /** Make the ruler a sibling of this earlier house's ruler (the Varenne heirs). */
  siblingOf?: House;
  /** Earlier houses a foreign spouse may come from (same faith, nearby). */
  spouseCandidates: readonly House[];
}

function sexOpposite(sex: 'male' | 'female'): 'male' | 'female' {
  return sex === 'male' ? 'female' : 'male';
}

/**
 * Generates a ruler and their family: parents (the father dead — the ruler inherited), siblings, a spouse (by
 * chance from another house: a kinship tie) and children. Every character is created with location 'none'.
 */
export function generateHouse(draft: GameState, ctx: SimContext, rng: Rng, o: HouseOptions): House {
  const fam = ctx.tunables.world.worldgen.family;
  const now = ctx.hour;
  const minAge = ctx.balance.character.adultAge;

  // Parents (shared with an earlier house for sibling rulers).
  let father: Character;
  let mother: Character;
  let rulerAge = Math.max(minAge, Math.floor(o.rulerAge));
  if (o.siblingOf && draft.characters[o.siblingOf.fatherId] && draft.characters[o.siblingOf.motherId]) {
    father = draft.characters[o.siblingOf.fatherId] as Character;
    mother = draft.characters[o.siblingOf.motherId] as Character;
    const motherAgeNow = Math.floor((now - mother.birthHour) / HOURS_PER_YEAR);
    rulerAge = clamp(rulerAge, minAge, Math.max(minAge, motherAgeNow - fam.childbearingAge[0]));
  } else {
    const fatherAt = rng.int(fam.parentAgeAtBirth[0], fam.parentAgeAtBirth[1]);
    const motherAt = clamp(rng.int(fam.parentAgeAtBirth[0], fam.parentAgeAtBirth[1]) - 2, fam.childbearingAge[0], fam.childbearingAge[1]);
    father = generatePerson(draft, ctx, rng, { culture: o.culture, faith: o.faith, sex: 'male', age: rulerAge + fatherAt, profile: 'leader', personality: false });
    mother = generatePerson(draft, ctx, rng, { culture: o.culture, faith: o.faith, sex: 'female', age: rulerAge + motherAt, profile: 'leader', personality: false });
    // The father ruled before; he is dead (the ruler inherited). The mother may live as a dowager.
    const fatherDiedYearsAgo = rng.int(0, Math.max(0, Math.min(rulerAge - minAge, 15)));
    markDead(father, now - fatherDiedYearsAgo * HOURS_PER_YEAR - rng.int(24, HOURS_PER_YEAR - 1), rulerAge + fatherAt > 60 ? 'oldAge' : rng.chance(0.5) ? 'battle' : 'illness');
  }
  const ownParents = !(o.siblingOf && draft.characters[o.siblingOf.fatherId] === father);
  const motherAgeNow = ageAt(mother, now);

  // The ruler.
  const ruler = generatePerson(draft, ctx, rng, { culture: o.culture, faith: o.faith, age: rulerAge, profile: 'ruler', personality: true });
  linkChild(father, ruler);
  linkChild(mother, ruler);
  const members: CharId[] = [];

  // Siblings (born while the mother could bear children; none after the father's death).
  const kinFactions: FactionId[] = [];
  const siblingIds: CharId[] = [];
  const fatherDeathAgo = father.death ? Math.floor((now - father.death.hour) / HOURS_PER_YEAR) : 0;
  const siblingCount = o.siblingOf ? 0 : (rng.weighted(fam.siblingWeights.map((_, i) => i), (_, i) => fam.siblingWeights[i] ?? 0) ?? 0);
  for (let i = 0; i < siblingCount; i++) {
    const lo = Math.max(fatherDeathAgo + 1, motherAgeNow - fam.childbearingAge[1], 1);
    const hi = Math.min(motherAgeNow - fam.childbearingAge[0], rulerAge + fam.siblingAgeGap);
    if (hi < lo) break;
    const age = clamp(rulerAge + rng.int(-fam.siblingAgeGap, fam.siblingAgeGap), lo, hi);
    const sib = generatePerson(draft, ctx, rng, { culture: o.culture, faith: o.faith, age, profile: 'leader', personality: age >= minAge });
    linkChild(father, sib);
    linkChild(mother, sib);
    siblingIds.push(sib.id);
    members.push(sib.id);
  }

  // The mother dies after her youngest child was born, or lives on as a dowager.
  if (ownParents && mother.alive) {
    let youngest = rulerAge;
    for (const id of siblingIds) youngest = Math.min(youngest, ageAt(draft.characters[id] as Character, now));
    if (motherAgeNow > fam.parentMaxAge || rng.chance(fam.parentDeathChance)) {
      const ago = rng.int(0, Math.max(0, youngest - 1));
      markDead(mother, now - ago * HOURS_PER_YEAR - rng.int(24, HOURS_PER_YEAR - 1), motherAgeNow - ago > 60 ? 'oldAge' : 'illness');
    }
  }
  if (mother.alive && ownParents) members.push(mother.id);
  if (o.siblingOf?.factionId !== undefined) kinFactions.push(o.siblingOf.factionId);

  // Spouse.
  let spouse: Character | undefined;
  if (rulerAge >= fam.minMarriageAge && rng.chance(fam.spouseChance)) {
    const gap = rng.int(fam.spouseAgeGap[0], fam.spouseAgeGap[1]);
    const spouseSex = sexOpposite(ruler.sex);
    const spouseAge = Math.max(fam.minMarriageAge, ruler.sex === 'male' ? rulerAge - gap : rulerAge + gap);
    // A foreign bride or groom: a younger sibling of another house's ruler.
    const candidates = o.spouseCandidates.filter((h) => {
      const m = draft.characters[h.motherId];
      if (!m || h.factionId === undefined) return false;
      const mAge = ageAt(m, now);
      return spouseAge <= mAge - fam.childbearingAge[0] && spouseAge >= mAge - fam.childbearingAge[1];
    });
    if (candidates.length > 0 && rng.chance(fam.foreignSpouseChance)) {
      const other = rng.pick(candidates);
      const oFather = draft.characters[other.fatherId];
      const oMother = draft.characters[other.motherId];
      if (oFather && oMother) {
        spouse = generatePerson(draft, ctx, rng, { culture: other.culture, faith: other.faith, sex: spouseSex, age: spouseAge, profile: 'leader', personality: false });
        linkChild(oFather, spouse);
        linkChild(oMother, spouse);
        if (other.factionId !== undefined) kinFactions.push(other.factionId);
      }
    }
    spouse ??= generatePerson(draft, ctx, rng, { culture: o.culture, faith: o.faith, sex: spouseSex, age: spouseAge, profile: 'leader', personality: false });
    linkSpouses(ruler, spouse);
    members.push(spouse.id);
  }

  // Children of the ruler and spouse.
  const childIds: CharId[] = [];
  if (spouse) {
    const mom = ruler.sex === 'female' ? ruler : spouse;
    const momAge = ageAt(mom, now);
    let age = Math.min(momAge - fam.childbearingAge[0], rng.int(Math.max(0, momAge - fam.childbearingAge[1]), Math.max(0, momAge - fam.childbearingAge[0])));
    while (age >= 0 && childIds.length < fam.maxChildren) {
      if (momAge - age >= fam.childbearingAge[0] && momAge - age <= fam.childbearingAge[1] && rng.chance(fam.childChance)) {
        const child = generatePerson(draft, ctx, rng, { culture: ruler.culture, faith: ruler.faith, age, profile: 'leader', personality: age >= minAge });
        linkChild(ruler, child);
        linkChild(spouse, child);
        childIds.push(child.id);
        members.push(child.id);
      }
      age -= rng.int(fam.childGapYears[0], fam.childGapYears[1]);
    }
    if (childIds.length > 0) ruler.family.heirId = childIds[0] as CharId;
  }

  return {
    culture: o.culture,
    faith: o.faith,
    rulerId: ruler.id,
    fatherId: father.id,
    motherId: mother.id,
    ...(spouse ? { spouseId: spouse.id } : {}),
    childIds,
    siblingIds,
    members,
    kinFactions,
  };
}

/** Living adult members of a house who could govern a settlement, oldest first (deterministic). */
export function adultKin(draft: GameState, house: House, now: Hour, adultAge: number): CharId[] {
  const ids = [...house.siblingIds, ...house.childIds].filter((id) => {
    const c = draft.characters[id];
    return c !== undefined && c.alive && ageAt(c, now) >= adultAge;
  });
  return ids.sort((a, b) => (draft.characters[a]?.birthHour ?? 0) - (draft.characters[b]?.birthHour ?? 0) || (a < b ? -1 : 1));
}
