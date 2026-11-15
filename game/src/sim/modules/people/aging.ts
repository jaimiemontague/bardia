/**
 * Aging (§22.7): birthdays are processed daily (§22.7 attribute changes at 35/46/56 and every five
 * years from 66; coming of age at 16), and natural death is checked monthly at 1/12 of the annual
 * chance, scaled by Vigor and the Gray Queen's Favor. The first failed check is a warning (the
 * OldAgeWarned event — the "Old age weighs on you" storylet hook); the next one is death.
 */
import type { Content } from '@content/index';
import { ATTRIBUTE_IDS } from '@content/schemas/ids';
import { clamp } from '@sim/core/dmath';
import type { SimContext } from '@sim/core/module';
import type { Attributes, Character, GameState } from '@sim/core/state';
import { killCharacter } from './death';
import { comingOfAge } from './dynasty';
import {
  ageOf,
  charUniform,
  dayOf,
  dayOfYear,
  forEachCharacter,
  houseFavor,
  isPlayerHouse,
  modifierSum,
  notifyHouse,
  STREAMS,
} from './util';

/** Attribute changes for reaching `age` (§22.7 stages and the late decline). */
export function agingDeltas(age: number, content: Content): Partial<Attributes> {
  const a = content.balance.aging;
  const out: Partial<Attributes> = {};
  const add = (d: Partial<Attributes>) => {
    for (const k of ATTRIBUTE_IDS) {
      const v = d[k];
      if (v !== undefined && v !== 0) out[k] = (out[k] ?? 0) + v;
    }
  };
  for (const stage of a.stages) if (stage.age === age) add(stage);
  if (age >= a.lateDeclineStartAge && a.lateDeclineEveryYears > 0 && (age - a.lateDeclineStartAge) % a.lateDeclineEveryYears === 0) add(a.lateDecline);
  return out;
}

/** Whether reaching `age` changes anything (a §22.7 stage, the late decline, or coming of age). */
export function isAgeMilestone(age: number, content: Content): boolean {
  return age === content.balance.character.adultAge || Object.keys(agingDeltas(age, content)).length > 0;
}

/** Applies everything that happens on reaching `age`. */
function reachAge(draft: GameState, ctx: SimContext, c: Character, age: number): void {
  const ch = ctx.balance.character;
  const deltas = agingDeltas(age, ctx.content);
  for (const k of ATTRIBUTE_IDS) {
    const v = deltas[k];
    if (v !== undefined) c.attributes[k] = clamp(c.attributes[k] + v, ch.attributeMin, ch.attributeMax);
  }
  if (Object.keys(deltas).length > 0) notifyHouse(ctx, c, 'people.notify.aging', { age });
  if (age === ch.adultAge) comingOfAge(draft, ctx, c);
}

/**
 * A birthday: every milestone age not yet processed is applied in order (catch-up after missed
 * days). `agedTo` is written only when a milestone applies, so ordinary birthdays leave the
 * characters table untouched (keeping the base-state scans cache-warm).
 */
export function celebrateBirthday(draft: GameState, ctx: SimContext, c: Character): void {
  const age = ageOf(c, ctx.hour);
  const from = c.agedTo === undefined ? age : c.agedTo + 1;
  let applied = false;
  for (let a = Math.max(1, from); a <= age && c.alive; a++) {
    if (!isAgeMilestone(a, ctx.content)) continue;
    reachAge(draft, ctx, c, a);
    applied = true;
  }
  if (applied) c.agedTo = age;
  // Every house member's birthday, and anyone's milestone (the world's other birthdays are noise).
  if (c.alive && (applied || isPlayerHouse(draft, c))) ctx.emit({ type: 'CharacterAged', charId: c.id, age });
}

/** Daily: today's birthdays (a base-state scan over every character; ARCHITECTURE §7). */
export function dailyAging(draft: GameState, ctx: SimContext): void {
  const now = ctx.hour;
  const today = dayOfYear(now);
  const todayIndex = dayOf(now);
  forEachCharacter(draft, (id, row) => {
    if (!row.alive || dayOfYear(row.birthHour) !== today || dayOf(row.birthHour) === todayIndex) return;
    const c = draft.characters[id];
    if (c?.alive) celebrateBirthday(draft, ctx, c);
  });
}

/** Annual natural-death chance for an age (§22.7 table). */
export function annualDeathChance(age: number, content: Content): number {
  const table = content.balance.aging.deathChance;
  return (table.find((r) => age <= r.maxAge) ?? table[table.length - 1])?.p ?? 0;
}

/** Monthly natural-death chance: annual × (1 − 0.05·(Vigor − 4)) × (Gray Queen ≥ 20 ? 0.9 : 1) / 12 (effective Vigor ≥ 0). */
export function monthlyDeathChance(state: GameState, content: Content, c: Character, age: number): number {
  const a = content.balance.aging;
  const vigor = Math.max(0, c.attributes.vigor + modifierSum(c, content, 'attr.vigor'));
  let p = annualDeathChance(age, content) * Math.max(0, 1 - a.vigorSlope * (vigor - content.balance.character.attributePivot));
  if (isPlayerHouse(state, c) && houseFavor(state, 'grayQueen') >= a.grayQueenFavorMin) p *= a.grayQueenMult;
  return p / Math.max(1, a.checksPerYear);
}

/** An upper bound of `monthlyDeathChance` at `age` over every Vigor and Favor (effective Vigor ≥ 0). */
function monthlyDeathBound(content: Content, age: number): number {
  const a = content.balance.aging;
  const vigorFactor = Math.max(0, 1 + a.vigorSlope * content.balance.character.attributePivot);
  return (annualDeathChance(age, content) * vigorFactor * Math.max(1, a.grayQueenMult)) / Math.max(1, a.checksPerYear);
}

/**
 * Monthly natural-death checks for adults (children face illness instead). Each adult fails when
 * their own uniform value (`charUniform`) is below their current chance; the bound skips the
 * hale majority without reading them through the draft.
 */
export function monthlyNaturalDeath(draft: GameState, ctx: SimContext): void {
  const now = ctx.hour;
  const content = ctx.content;
  const adult = content.balance.character.adultAge;
  const salt = ctx.rng(STREAMS.aging).u32();
  const storylet = ctx.tunables.people.oldAgeStoryletId;
  forEachCharacter(draft, (id, row) => {
    if (!row.alive) return;
    const age = ageOf(row, now);
    if (age < adult) return;
    const u = charUniform(salt, id);
    if (u >= monthlyDeathBound(content, age)) return;
    const c = draft.characters[id];
    if (!c?.alive || u >= monthlyDeathChance(draft, content, c, age)) return;
    if (c.oldAgeWarnedHour === undefined) {
      c.oldAgeWarnedHour = now;
      ctx.emit({ type: 'OldAgeWarned', charId: c.id, age });
      notifyHouse(ctx, c, 'people.notify.oldAge', { age }, c.id === draft.player.rulerId ? 'high' : 'normal', 'people.illus.sickness');
      if (storylet !== '' && isPlayerHouse(draft, c)) {
        ctx.applyEffects([{ op: 'scheduleStorylet', storyletId: storylet, inDays: 0, scope: { kind: 'character', id: c.id } }]);
      }
      return;
    }
    killCharacter(draft, ctx, c, 'oldAge');
  });
}
