/**
 * Family and dynasty (§23.1–§23.3): marriage, monthly conception (§23.2 formula with Fjorna's
 * Favor and the Golden Sheaf), pregnancy and birth (twins, childbirth risk), child illness (Gentle
 * Mode: no child deaths), coming of age at 16 (inherited and education traits, skills and
 * attributes), tutoring and fosterage, and adoption.
 */
import type { Content } from '@content/index';
import { SKILL_IDS, type AttributeId, type SkillId } from '@content/schemas/ids';
import { CommandError } from '@sim/core/commands';
import { clamp } from '@sim/core/dmath';
import { EffectError } from '@sim/core/effects';
import { createCharacter, getRelation } from '@sim/core/factory';
import type { CommandHandler, SimContext } from '@sim/core/module';
import type { Character, CharacterLocation, CharId, FactionId, Family, GameState } from '@sim/core/state';
import { addDays, DAYS_PER_MONTH, DAYS_PER_YEAR, HOURS_PER_DAY } from '@sim/core/time';
import { captureCharacter, releaseCharacter } from './captivity';
import { killCharacter, onHeirComingOfAge } from './death';
import { kinDistance, livingSpouses } from './kin';
import { inclinedSkills, refreshTitle } from './progression';
import { addTrait } from './traits';
import type { Upbringing } from './types';
import {
  ageOf,
  charUniform,
  charOf,
  chronicleHouse,
  dayOf,
  effectiveSkill,
  factionSeat,
  forEachCharacter,
  houseFavor,
  isAdultAt,
  isPlayerHouse,
  locationSettlement,
  nameVars,
  notifyHouse,
  peopleState,
  playerHoldsRelic,
  playerHome,
  pushUnique,
  removeValue,
  STREAMS,
  together,
} from './util';

const OFFICER_ROLES: readonly string[] = ['lieutenant', 'captain', 'governor', 'steward', 'envoy', 'seer'];

// ---------------------------------------------------------------------------------------------
// Marriage (§23.1)

/** Why two characters cannot marry (undefined: they can). */
export function marriageBlocker(state: GameState, content: Content, a: Character, b: Character, hour: number): string | undefined {
  const t = content.tunables.people;
  if (a.id === b.id) return 'self';
  if (!a.alive || !b.alive) return 'dead';
  if (!isAdultAt(a, hour, content) || !isAdultAt(b, hour, content)) return 'minor';
  if (a.family.spouseIds.includes(b.id)) return 'alreadyMarried';
  if (livingSpouses(state, a).length >= t.maxLivingSpouses || livingSpouses(state, b).length >= t.maxLivingSpouses) return 'married';
  if (!state.meta.options.anySexMarriage && a.sex === b.sex) return 'sameSex';
  if (t.closeKinDistance > 0 && kinDistance(state, a.id, b.id, t.closeKinDistance) !== undefined) return 'kin';
  return undefined;
}

/** Leads (or keeps) a household that a spouse may join. */
function householdRank(state: GameState, c: Character): number {
  if (c.id === state.player.rulerId) return 3;
  if (isPlayerHouse(state, c)) return 2;
  if (c.role?.kind === 'ruler') return 1;
  return 0;
}

/** A spouse with no office of their own moves into the other's household. */
function joinHousehold(draft: GameState, ctx: SimContext, newcomer: Character, host: Character): void {
  if (newcomer.role?.kind === 'ruler') return;
  if (newcomer.role !== undefined && newcomer.role.kind !== 'npc') return;
  if (newcomer.role?.holdingId !== undefined) return;
  const factionId = host.id === draft.player.rulerId || isPlayerHouse(draft, host) ? draft.player.factionId : host.factionId;
  if (factionId === undefined) return;
  const home = locationSettlement(host.location) ?? factionSeat(draft, factionId);
  if (newcomer.captivity) {
    if (newcomer.captivity.byFactionId !== factionId) return; // held by someone else: stays a captive
    newcomer.factionId = factionId;
    releaseCharacter(draft, ctx, newcomer, 'marriage', home);
    return;
  }
  newcomer.factionId = factionId;
  delete newcomer.role;
  if (home !== undefined && host.location.kind !== 'captive') newcomer.location = { kind: 'settlement', id: home };
}

/** Marries two characters; in-laws gain opinion and the lesser household joins the greater. */
export function marry(draft: GameState, ctx: SimContext, a: Character, b: Character): void {
  const blocker = marriageBlocker(draft, ctx.content, a, b, ctx.hour);
  if (blocker !== undefined) throw new EffectError(`marry: ${a.id} and ${b.id} cannot marry (${blocker})`);
  const factionA = a.factionId;
  const factionB = b.factionId;
  pushUnique(a.family.spouseIds, b.id);
  pushUnique(b.family.spouseIds, a.id);
  const ra = householdRank(draft, a);
  const rb = householdRank(draft, b);
  if (ra > rb) joinHousehold(draft, ctx, b, a);
  else if (rb > ra) joinHousehold(draft, ctx, a, b);
  if (factionA !== undefined && factionB !== undefined && factionA !== factionB) {
    ctx.applyEffects([{ op: 'changeOpinion', a: factionA, b: factionB, amount: ctx.balance.dynasty.inLawOpinion, reason: 'kinship' }]);
  }
  const e: { type: 'Marriage'; aId: CharId; bId: CharId; factionAId?: Character['factionId']; factionBId?: Character['factionId'] } = {
    type: 'Marriage',
    aId: a.id,
    bId: b.id,
  };
  if (factionA !== undefined) e.factionAId = factionA;
  if (factionB !== undefined) e.factionBId = factionB;
  ctx.emit(e);
  const subject = isPlayerHouse(draft, a) ? a : b;
  const partner = subject === a ? b : a;
  notifyHouse(ctx, subject, 'people.notify.marriage', nameVars(partner, 'spouse'), subject.id === draft.player.rulerId ? 'high' : 'normal');
  chronicleHouse(ctx, subject, 'marriage', 'people.chronicle.marriage', subject.id === draft.player.rulerId ? 3 : 2, nameVars(partner, 'spouse'), [partner.id]);
}

// ---------------------------------------------------------------------------------------------
// Conception, pregnancy, birth (§23.2)

function fertileMaxAge(content: Content): number {
  let max = 0;
  for (const row of content.balance.dynasty.conceptionAgeFactor) if (row.f > 0) max = Math.max(max, row.maxAge);
  return max;
}

/** Monthly conception chance of a bearer: 5% × ageFactor × (1 + Fjorna/100) × (Golden Sheaf ? 1.2 : 1). */
export function conceptionChance(state: GameState, content: Content, bearer: Character, hour: number): number {
  const d = content.balance.dynasty;
  const age = ageOf(bearer, hour);
  if (age < content.balance.character.adultAge) return 0;
  const f = d.conceptionAgeFactor.find((r) => age <= r.maxAge)?.f ?? 0;
  if (f <= 0) return 0;
  let p = d.conceptionPerMonth * f;
  if (isPlayerHouse(state, bearer)) {
    p *= Math.max(0, 1 + houseFavor(state, 'fjorna') / d.fjornaFavorDivisor);
    if (playerHoldsRelic(state, content.tunables.people.relics.goldenSheaf)) p *= d.goldenSheafMult;
  }
  return clamp(p, 0, 1);
}

/** The bearer's living husband who is with her and free (undefined: no conception possible). */
function sireFor(state: GameState, ctx: SimContext, bearer: Character): Character | undefined {
  for (const id of livingSpouses(state, bearer)) {
    const s = charOf(state, id);
    if (!s || s.sex !== 'male' || s.location.kind === 'captive') continue;
    if (ctx.tunables.people.conception.requireTogether && !together(bearer.location, s.location)) continue;
    return s;
  }
  return undefined;
}

/** Starts a pregnancy (twins decided now). */
export function conceive(draft: GameState, ctx: SimContext, mother: Character, father: Character | undefined): void {
  if (!mother.alive || mother.pregnancy) return;
  const d = ctx.balance.dynasty;
  const dueHour = addDays(ctx.hour, d.pregnancyDays);
  mother.pregnancy = { conceivedHour: ctx.hour, dueHour, twins: ctx.rng(STREAMS.dynasty).chance(d.twinChance) };
  if (father) mother.pregnancy.fatherId = father.id;
  pushUnique(peopleState(draft).pregnantIds, mother.id);
  const e: { type: 'ChildConceived'; motherId: CharId; dueHour: number; fatherId?: CharId } = { type: 'ChildConceived', motherId: mother.id, dueHour };
  if (father) e.fatherId = father.id;
  ctx.emit(e);
  const subject = isPlayerHouse(draft, mother) ? mother : father;
  if (subject) notifyHouse(ctx, subject, 'people.notify.conceived', nameVars(mother, 'mother'));
}

/** Upper bound of `conceptionChance` at an age factor, over every Favor and relic (Fjorna's Favor ≤ its maximum). */
function conceptionBound(content: Content, ageFactor: number): number {
  const d = content.balance.dynasty;
  const favorMult = Math.max(1, 1 + content.balance.standing.favor.max / d.fjornaFavorDivisor);
  return clamp(d.conceptionPerMonth * ageFactor * favorMult * Math.max(1, d.goldenSheafMult), 0, 1);
}

/**
 * Monthly: married couples may conceive. Each fertile woman conceives when her own uniform value
 * (`charUniform`) is below her current chance; the bound skips most of them without a draft read.
 */
export function monthlyConception(draft: GameState, ctx: SimContext): void {
  const now = ctx.hour;
  const content = ctx.content;
  const d = content.balance.dynasty;
  const adult = content.balance.character.adultAge;
  const maxAge = fertileMaxAge(content);
  const postpartum = ctx.tunables.people.conception.postpartumDays;
  const salt = ctx.rng(STREAMS.dynasty).u32();
  forEachCharacter(draft, (id, row) => {
    if (!row.alive || row.sex !== 'female') return;
    const age = ageOf(row, now);
    if (age < adult || age > maxAge) return;
    const f = d.conceptionAgeFactor.find((r) => age <= r.maxAge)?.f ?? 0;
    if (f <= 0) return;
    const u = charUniform(salt, id);
    if (u >= conceptionBound(content, f)) return;
    const c = draft.characters[id];
    if (!c?.alive || c.pregnancy || c.family.spouseIds.length === 0 || c.location.kind === 'captive') return;
    if (c.lastBirthHour !== undefined && now - c.lastBirthHour < postpartum * HOURS_PER_DAY) return;
    const sire = sireFor(draft, ctx, c);
    if (sire && u < conceptionChance(draft, content, c, now)) conceive(draft, ctx, c, sire);
  });
}

export interface ChildOptions {
  sex?: 'male' | 'female';
  name?: string;
  twin?: boolean;
}

/** Creates a newborn of the given parents (or a foundling of the player's house) and links the family. */
export function createChild(draft: GameState, ctx: SimContext, mother: Character | undefined, father: Character | undefined, opts: ChildOptions = {}): Character {
  const parents = [mother, father].filter((p): p is Character => p !== undefined);
  const ruler = parents.find((p) => p.id === draft.player.rulerId);
  const housed = parents.find((p) => isPlayerHouse(draft, p));
  const lead = ruler ?? housed ?? father ?? mother;
  const playerChild = housed !== undefined || parents.length === 0;
  const factionId = playerChild ? draft.player.factionId : lead?.factionId;
  const culture = lead?.culture ?? draft.factions[draft.player.factionId]?.culture ?? charOf(draft, draft.player.rulerId)?.culture ?? 'skarn';
  const faith = lead?.faith;
  let location: CharacterLocation = { kind: 'none' };
  const free = parents.find((p) => p.location.kind !== 'captive' && p.alive);
  if (mother && mother.location.kind !== 'captive') location = mother.location;
  else if (free) location = free.location;
  else if (playerChild) {
    const home = playerHome(draft);
    if (home !== undefined) location = { kind: 'settlement', id: home };
  }
  const family: Partial<Family> = {};
  if (mother) family.motherId = mother.id;
  if (father) family.fatherId = father.id;
  const child = createCharacter(draft, ctx, {
    culture,
    ...(faith !== undefined ? { faith } : {}),
    ...(opts.sex !== undefined ? { sex: opts.sex } : {}),
    ...(opts.name !== undefined ? { name: opts.name } : {}),
    birthHour: ctx.hour,
    location: location.kind === 'captive' ? { kind: 'none' } : { ...location },
    ...(factionId !== undefined ? { factionId } : {}),
    family,
  });
  child.agedTo = 0;
  if (mother) pushUnique(mother.family.childIds, child.id);
  if (father) pushUnique(father.family.childIds, child.id);
  if (mother?.captivity) captureCharacter(draft, ctx, child, mother.captivity.byFactionId, { at: mother.captivity.at, ransom: 0, cause: 'bornInCaptivity' });
  const e: { type: 'Birth'; childId: CharId; twin: boolean; motherId?: CharId; fatherId?: CharId; factionId?: Character['factionId'] } = {
    type: 'Birth',
    childId: child.id,
    twin: opts.twin === true,
  };
  if (mother) e.motherId = mother.id;
  if (father) e.fatherId = father.id;
  if (factionId !== undefined) e.factionId = factionId;
  ctx.emit(e);
  if (playerChild) {
    const parentsKind = mother && father ? 'both' : mother ? 'mother' : father ? 'father' : 'none';
    const vars = { ...nameVars(mother, 'mother'), ...nameVars(father, 'father'), parents: parentsKind, twin: opts.twin === true ? 'yes' : 'no' };
    notifyHouse(ctx, child, 'people.notify.birth', vars, ruler ? 'high' : 'normal');
    chronicleHouse(ctx, child, 'birth', 'people.chronicle.birth', ruler ? 3 : 2, vars, parents.map((p) => p.id));
    if (ruler) ctx.narrate('people.narration.childBorn', { ...nameVars(child), ...nameVars(ruler, 'parent') }, 'skald');
  }
  return child;
}

/** Daily: pregnancies come to term. */
export function dailyPregnancies(draft: GameState, ctx: SimContext): void {
  const ps = peopleState(draft);
  if (ps.pregnantIds.length === 0) return;
  for (const id of [...ps.pregnantIds]) {
    const c = charOf(draft, id);
    if (!c?.alive || !c.pregnancy) {
      removeValue(ps.pregnantIds, id);
      if (c?.pregnancy) delete c.pregnancy;
      continue;
    }
    if (ctx.hour >= c.pregnancy.dueHour) deliver(draft, ctx, c);
  }
}

/** Childbirth: one or two children; the mother survives unless the childbirth risk strikes (never in Gentle Mode). */
export function deliver(draft: GameState, ctx: SimContext, mother: Character): void {
  const preg = mother.pregnancy;
  if (!preg) return;
  delete mother.pregnancy;
  removeValue(peopleState(draft).pregnantIds, mother.id);
  mother.lastBirthHour = ctx.hour;
  const father = charOf(draft, preg.fatherId);
  const n = preg.twins ? 2 : 1;
  for (let i = 0; i < n; i++) createChild(draft, ctx, mother, father, { twin: n === 2 });
  if (!draft.meta.options.gentleMode && ctx.rng(STREAMS.dynasty).chance(ctx.balance.dynasty.childbirthRisk)) killCharacter(draft, ctx, mother, 'childbirth');
}

// ---------------------------------------------------------------------------------------------
// Child illness (§23.2)

/** A healer near the child: a seer's hut in the settlement, or a household seer of the player's house there. */
function healerNear(draft: GameState, ctx: SimContext, child: Character): boolean {
  const at = locationSettlement(child.location);
  if (at === undefined) return false;
  const s = draft.settlements[at];
  if (s && (s.buildings.seersHut ?? 0) >= 1) return true;
  if (!isPlayerHouse(draft, child)) return false;
  const min = ctx.tunables.people.childIllness.healerMinRunecraft;
  for (const id of Object.keys(draft.characters) as CharId[]) {
    const h = draft.characters[id];
    if (!h?.alive || h.id === child.id || !isPlayerHouse(draft, h) || locationSettlement(h.location) !== at || h.location.kind === 'captive') continue;
    if (h.role?.kind === 'seer' || effectiveSkill(h, 'runecraft', ctx.content) >= min) return true;
  }
  return false;
}

/**
 * Monthly: young children may fall ill (3%/year to age 5; a healer reduces it; Gentle Mode: none
 * die). Each child's own uniform value (`charUniform`) decides; the rare sick child draws its fate.
 */
export function monthlyChildIllness(draft: GameState, ctx: SimContext): void {
  const d = ctx.balance.dynasty;
  const t = ctx.tunables.people.childIllness;
  const pBase = d.childIllnessPerYear / Math.max(1, ctx.balance.aging.checksPerYear);
  if (pBase <= 0) return;
  const now = ctx.hour;
  const rng = ctx.rng(STREAMS.dynasty);
  const salt = rng.u32();
  const gentle = draft.meta.options.gentleMode;
  forEachCharacter(draft, (id, row) => {
    if (!row.alive || ageOf(row, now) > d.childIllnessMaxAge || dayOf(row.birthHour) === dayOf(now)) return;
    const u = charUniform(salt, id);
    if (u >= pBase) return;
    const c = draft.characters[id];
    if (!c?.alive) return;
    if (u >= pBase * t.healerMult && healerNear(draft, ctx, c)) return;
    const died = !gentle && rng.chance(t.deathChance);
    ctx.emit({ type: 'ChildFellIll', charId: c.id, died });
    if (died) killCharacter(draft, ctx, c, 'illness');
    else notifyHouse(ctx, c, 'people.notify.childRecovered');
  });
}

// ---------------------------------------------------------------------------------------------
// Coming of age (§23.3)

function giveSkillPoints(c: Character, content: Content, order: readonly SkillId[], points: number, cap: number): void {
  const limit = Math.min(cap, content.balance.character.skillMax);
  const sequence = [...order, ...inclinedSkills(c)];
  for (const s of sequence) {
    while (points > 0 && (c.skills[s] ?? 0) < limit) {
      c.skills[s] = (c.skills[s] ?? 0) + 1;
      points--;
    }
    if (points <= 0) return;
  }
}

function giveAttributePoints(c: Character, order: readonly AttributeId[], points: number, cap: number): void {
  let guard = 0;
  while (points > 0 && guard++ < 64) {
    const next = order.find((a) => c.attributes[a] < cap) ?? (['might', 'agility', 'wits', 'vigor'] as const).find((a) => c.attributes[a] < cap);
    if (next === undefined) return;
    c.attributes[next] += 1;
    points--;
    // Alternate between the preferred attributes.
    if (order.length > 1) order = [...order.slice(1), order[0] as AttributeId];
  }
}

/** At 16: inherited traits (30% per parent trait), one education trait, skills and attributes; fosterage ends. */
export function comingOfAge(draft: GameState, ctx: SimContext, c: Character): void {
  const rng = ctx.rng(STREAMS.dynasty);
  const content = ctx.content;
  const t = ctx.tunables.people;
  const gained: string[] = [];
  for (const pid of [c.family.fatherId, c.family.motherId]) {
    const parent = charOf(draft, pid);
    if (!parent) continue;
    for (const trait of parent.traits) {
      const def = content.traits[trait];
      if (!def?.inheritable || c.traits.includes(trait)) continue;
      if (def.opposite !== undefined && c.traits.includes(def.opposite)) continue;
      if (rng.chance(content.balance.character.traitInheritChance) && addTrait(ctx, c, trait, 'inherited')) gained.push(trait);
    }
  }
  const up = c.upbringing;
  const focus: SkillId = up?.focusSkill ?? rng.pick(SKILL_IDS);
  const education = up?.mode === 'ally' ? t.fosteredAbroadTrait : t.educationTraitBySkill[focus];
  if (Object.hasOwn(content.traits, education) && addTrait(ctx, c, education, 'education')) gained.push(education);
  const secondary = rng.pick(SKILL_IDS.filter((s) => s !== focus));
  giveSkillPoints(c, content, [focus, secondary], t.comingOfAge.skillPoints, t.comingOfAge.skillCap);
  giveAttributePoints(c, [t.skillAttribute[focus], t.skillAttribute[secondary]], t.comingOfAge.attributePoints, content.balance.character.attributeCreationCap);
  if (up) endFosterage(draft, ctx, c, false);
  ctx.emit({ type: 'ComingOfAge', charId: c.id, age: ageOf(c, ctx.hour), traitsGained: gained });
  notifyHouse(ctx, c, 'people.notify.comingOfAge', {}, 'high');
  chronicleHouse(ctx, c, 'comingOfAge', 'people.chronicle.comingOfAge', 2);
  refreshTitle(draft, ctx, c);
  onHeirComingOfAge(draft, ctx, c);
}

// ---------------------------------------------------------------------------------------------
// Tutoring and fosterage (§23.3)

/** Ends a child's upbringing arrangement; a fosterling abroad comes home. */
export function endFosterage(draft: GameState, ctx: SimContext, c: Character, announce: boolean): void {
  const up = c.upbringing;
  if (!up) return;
  delete c.upbringing;
  delete c.family.fosteredAt;
  removeValue(peopleState(draft).fosterIds, c.id);
  if (up.mode === 'ally' && c.location.kind !== 'captive') {
    const home = isPlayerHouse(draft, c) ? playerHome(draft) : factionSeat(draft, c.factionId);
    if (home !== undefined) c.location = { kind: 'settlement', id: home };
  }
  if (announce) {
    ctx.emit({ type: 'ChildFostered', childId: c.id, mode: 'home' });
    notifyHouse(ctx, c, 'people.notify.fosterEnded');
  }
}

/** Monthly: tutoring progress (+1 focus skill per `tutorYearsPerSkillPoint` years); fosterlings at a hostile court become hostages. */
export function monthlyFosterage(draft: GameState, ctx: SimContext): void {
  const ps = peopleState(draft);
  if (ps.fosterIds.length === 0) return;
  const t = ctx.tunables.people.fosterage;
  const need = ctx.balance.dynasty.tutorYearsPerSkillPoint * DAYS_PER_YEAR;
  const skillMax = ctx.balance.character.skillMax;
  for (const id of [...ps.fosterIds]) {
    const c = charOf(draft, id);
    if (!c?.alive || !c.upbringing) {
      removeValue(ps.fosterIds, id);
      continue;
    }
    const up = c.upbringing;
    if (up.mode === 'lieutenant') {
      const mentor = charOf(draft, up.mentorId);
      if (!mentor?.alive || !isPlayerHouse(draft, mentor)) {
        endFosterage(draft, ctx, c, true);
        continue;
      }
    } else if (up.mode === 'ally') {
      const host = up.factionId;
      if (host === undefined || !Object.hasOwn(draft.factions, host)) {
        endFosterage(draft, ctx, c, true);
        continue;
      }
      const rel = getRelation(draft, draft.player.factionId, host);
      if (rel && (rel.stance === 'war' || rel.opinion < t.hostageOpinionBelow)) {
        captureCharacter(draft, ctx, c, host, { hostage: true, cause: 'hostage', ...(locationSettlement(c.location) !== undefined ? { at: locationSettlement(c.location) } : {}) });
        ctx.emit({ type: 'FosterlingTakenHostage', childId: c.id, factionId: host });
        continue;
      }
    }
    up.progressDays += DAYS_PER_MONTH;
    if (need <= 0) continue;
    while (up.progressDays >= need) {
      up.progressDays -= need;
      if ((c.skills[up.focusSkill] ?? 0) < skillMax) {
        c.skills[up.focusSkill] = (c.skills[up.focusSkill] ?? 0) + 1;
        notifyHouse(ctx, c, 'people.notify.tutorProgress', { skill: up.focusSkill });
      }
    }
  }
}

/** `foster`: tutor at home, foster with a lieutenant or an allied court, or bring the child home. */
export const handleFoster: CommandHandler<'foster'> = (draft, cmd, ctx) => {
  const child = charOf(draft, cmd.childId);
  if (!child) throw new CommandError('unknownCharacter', `No character ${cmd.childId}`);
  if (!child.alive) throw new CommandError('dead', `${child.name} is dead`);
  if (child.factionId !== draft.player.factionId) throw new CommandError('notYours', `${child.name} is not of your house`);
  if (child.location.kind === 'captive') throw new CommandError('captive', `${child.name} is held captive`);
  if (cmd.mode === 'home') {
    if (!child.upbringing) throw new CommandError('notFostered', `${child.name} is not being fostered`);
    endFosterage(draft, ctx, child, true);
    return;
  }
  const t = ctx.tunables.people.fosterage;
  const age = ageOf(child, ctx.hour);
  if (age < t.minAge || age > t.maxAge) throw new CommandError('wrongAge', `Children are fostered between ${t.minAge} and ${t.maxAge}`);
  const credited = [...(child.fosteredWith ?? [])];
  const d = ctx.balance.dynasty;
  let up: Upbringing;
  let fosteredAt: CharId | FactionId | undefined;
  let move: Character['location'] | undefined;
  const bonuses: (() => void)[] = [];
  if (cmd.mode === 'tutor') {
    if (cmd.focusSkill === undefined) throw new CommandError('focusRequired', 'Choose a skill for the tutor');
    up = { mode: 'tutor', focusSkill: cmd.focusSkill, sinceHour: ctx.hour, progressDays: 0 };
  } else if (cmd.mode === 'lieutenant') {
    const lt = charOf(draft, cmd.lieutenantId);
    if (!lt?.alive || lt.id === child.id || !isPlayerHouse(draft, lt) || !lt.role || !OFFICER_ROLES.includes(lt.role.kind)) {
      throw new CommandError('notLieutenant', 'Choose one of your lieutenants');
    }
    if (lt.location.kind === 'captive' || !isAdultAt(lt, ctx.hour, ctx.content)) throw new CommandError('notLieutenant', 'That lieutenant cannot foster a child now');
    const best = inclinedSkills(lt)[0] ?? 'melee';
    up = { mode: 'lieutenant', focusSkill: best, mentorId: lt.id, sinceHour: ctx.hour, progressDays: 0 };
    fosteredAt = lt.id;
    if (!credited.includes(lt.id)) {
      credited.push(lt.id);
      bonuses.push(() => ctx.applyEffects([{ op: 'changeLoyalty', charId: lt.id, amount: d.fosterLieutenantLoyalty }]));
    }
  } else {
    const host = cmd.factionId;
    if (host === undefined || host === draft.player.factionId || !Object.hasOwn(draft.factions, host)) throw new CommandError('notAllied', 'Choose an allied court');
    const rel = getRelation(draft, draft.player.factionId, host);
    const allied = rel !== undefined && rel.stance !== 'war' && (rel.stance === 'allied' || rel.stance === 'friendly' || rel.opinion >= t.allyMinOpinion);
    if (!allied) throw new CommandError('notAllied', 'Only an allied court will foster your child');
    const seat = factionSeat(draft, host);
    if (seat === undefined) throw new CommandError('noCourt', 'That house keeps no court');
    up = { mode: 'ally', focusSkill: 'speechcraft', factionId: host, sinceHour: ctx.hour, progressDays: 0 };
    fosteredAt = host;
    move = { kind: 'settlement', id: seat };
    if (!credited.includes(host)) {
      credited.push(host);
      bonuses.push(() => {
        ctx.applyEffects([{ op: 'changeOpinion', a: draft.player.factionId, b: host, amount: d.fosterAllyOpinion, reason: 'fosterage' }]);
        child.skills.speechcraft = Math.min(ctx.balance.character.skillMax, (child.skills.speechcraft ?? 0) + 1);
      });
    }
  }
  if (child.upbringing) endFosterage(draft, ctx, child, false);
  child.upbringing = up;
  pushUnique(peopleState(draft).fosterIds, child.id);
  if (fosteredAt !== undefined) child.family.fosteredAt = fosteredAt;
  if (move) child.location = move;
  if (credited.length > 0) child.fosteredWith = credited;
  for (const apply of bonuses) apply();
  const e: { type: 'ChildFostered'; childId: CharId; mode: Upbringing['mode']; mentorId?: CharId; factionId?: Character['factionId'] } = {
    type: 'ChildFostered',
    childId: child.id,
    mode: up.mode,
  };
  if (up.mentorId !== undefined) e.mentorId = up.mentorId;
  if (up.factionId !== undefined) e.factionId = up.factionId;
  ctx.emit(e);
  notifyHouse(ctx, child, 'people.notify.fostered', { mode: up.mode, skill: up.focusSkill });
};

// ---------------------------------------------------------------------------------------------
// Adoption (§23.4)

/** `adopt`: the ruler adopts a ward fostered at their court or a kin's child (Honor ≥ adoptionHonorMin). */
export const handleAdopt: CommandHandler<'adopt'> = (draft, cmd, ctx) => {
  const ruler = charOf(draft, draft.player.rulerId);
  if (!ruler?.alive) throw new CommandError('noRuler', 'There is no living ruler');
  const child = charOf(draft, cmd.childId);
  if (!child) throw new CommandError('unknownCharacter', `No character ${cmd.childId}`);
  if (!child.alive) throw new CommandError('dead', `${child.name} is dead`);
  if (child.id === ruler.id || ruler.family.childIds.includes(child.id)) throw new CommandError('alreadyChild', `${child.name} is already your child`);
  if (child.family.adoptedById !== undefined && charOf(draft, child.family.adoptedById)?.alive) throw new CommandError('alreadyAdopted', `${child.name} was adopted by another`);
  if (child.role?.kind === 'ruler') throw new CommandError('notEligible', 'A ruler cannot be adopted');
  if (draft.player.house.honor < ctx.balance.dynasty.succession.adoptionHonorMin) {
    throw new CommandError('notRecognized', 'The Allthing will not recognise an adoption by one so dishonoured');
  }
  const ward = child.family.fosteredAt === ruler.id || child.family.fosteredAt === draft.player.factionId;
  const kin = kinDistance(draft, ruler.id, child.id, ctx.tunables.people.kinSearchDepth) !== undefined;
  if (!ward && !kin) throw new CommandError('notEligible', 'Only a ward of your court or a kinsman’s child may be adopted');
  // A ward whose adoptive parent has died passes to the new one (one adoptive parent at a time).
  const previous = charOf(draft, child.family.adoptedById);
  if (previous) removeValue(previous.family.childIds, child.id);
  child.family.adoptedById = ruler.id;
  pushUnique(ruler.family.childIds, child.id);
  child.factionId = draft.player.factionId;
  if (ward) delete child.family.fosteredAt;
  ctx.emit({ type: 'ChildAdopted', childId: child.id, parentId: ruler.id });
  notifyHouse(ctx, child, 'people.notify.adopted', nameVars(ruler, 'parent'), 'high');
  chronicleHouse(ctx, child, 'adoption', 'people.chronicle.adopted', 2, nameVars(ruler, 'parent'), [ruler.id]);
};

/** Effect `birth`: a child is born now (validated parents), or a foundling joins the player's house. */
export function birthEffect(draft: GameState, ctx: SimContext, e: { motherId?: CharId; fatherId?: CharId; sex?: 'male' | 'female'; name?: string; twins?: boolean }): void {
  const mother = e.motherId !== undefined ? charOf(draft, e.motherId) : undefined;
  const father = e.fatherId !== undefined ? charOf(draft, e.fatherId) : undefined;
  if (e.motherId !== undefined && !mother) throw new EffectError(`birth: unknown mother ${e.motherId}`);
  if (e.fatherId !== undefined && !father) throw new EffectError(`birth: unknown father ${e.fatherId}`);
  if (mother && !mother.alive) throw new EffectError(`birth: mother ${mother.id} is dead`);
  const n = e.twins ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const opts: ChildOptions = { twin: n === 2 };
    if (e.sex !== undefined) opts.sex = e.sex;
    if (e.name !== undefined && i === 0) opts.name = e.name;
    createChild(draft, ctx, mother, father, opts);
  }
  if (mother) mother.lastBirthHour = ctx.hour;
}
