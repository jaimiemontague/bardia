import { getContent } from '@content/index';
import { advance } from '@sim/core/scheduler';
import type { CharId } from '@sim/core/state';
import { DAYS_PER_YEAR, HOURS_PER_DAY, HOURS_PER_YEAR } from '@sim/core/time';
import { describe, expect, it } from 'vitest';
import { agingDeltas, annualDeathChance, monthlyDeathChance } from './aging';
import { build, makePerson, peopleTestEnv, peopleTestState } from './testing';
import { ageOf } from './util';

const content = getContent();
const env = peopleTestEnv();

describe('aging effects (§22.7)', () => {
  it('stage deltas at 35/46/56 and every five years from 66', () => {
    expect(agingDeltas(35, content)).toEqual({ wits: 1 });
    expect(agingDeltas(46, content)).toEqual({ might: -1, agility: -1 });
    expect(agingDeltas(56, content)).toEqual({ might: -1, agility: -1, vigor: -1 });
    expect(agingDeltas(66, content)).toEqual({ might: -1, agility: -1, vigor: -1 });
    expect(agingDeltas(71, content)).toEqual({ might: -1, agility: -1, vigor: -1 });
    for (const age of [16, 30, 34, 40, 50, 60, 67, 70, 72]) expect(agingDeltas(age, content)).toEqual({});
  });

  it('a birthday applies the new age; missed years are caught up in order', () => {
    const made = build(peopleTestState(), env, (draft, ctx) => {
      // Turns 35 at the start of day 1.
      const a = makePerson(draft, ctx, { birthHour: (1 - 35 * DAYS_PER_YEAR) * HOURS_PER_DAY, attributes: { wits: 4 } });
      // Turns 47 on day 1 but was last aged at 44: 45, 46 and 47 are applied.
      const b = makePerson(draft, ctx, { birthHour: (1 - 47 * DAYS_PER_YEAR) * HOURS_PER_DAY, attributes: { wits: 4, might: 6, agility: 6 } });
      b.agedTo = 44;
      // Ordinary birthdays (30): announced for the player's house only.
      makePerson(draft, ctx, { birthHour: (1 - 30 * DAYS_PER_YEAR) * HOURS_PER_DAY });
      const kin = makePerson(draft, ctx, { birthHour: (1 - 30 * DAYS_PER_YEAR) * HOURS_PER_DAY, factionId: draft.player.factionId });
      return { a: a.id, b: b.id, kin: kin.id };
    });
    expect(ageOf(made.state.characters[made.value.a]!, 0)).toBe(34);
    const r = advance(made.state, 24, env);
    const a = r.state.characters[made.value.a]!;
    expect(a.attributes.wits).toBe(5);
    expect(a.agedTo).toBe(35);
    const b = r.state.characters[made.value.b]!;
    expect(b.attributes).toMatchObject({ wits: 4, might: 5, agility: 5 });
    expect(b.agedTo).toBe(47);
    const aged = r.events.flatMap((e) => (e.type === 'CharacterAged' ? [e.charId] : []));
    expect(aged.sort()).toEqual([made.value.a, made.value.b, made.value.kin].sort());
  });

  it('attributes never fall below the minimum', () => {
    const made = build(peopleTestState(), env, (draft, ctx) => makePerson(draft, ctx, { birthHour: (1 - 56 * DAYS_PER_YEAR) * HOURS_PER_DAY, attributes: { might: 1, agility: 1, vigor: 1 } }).id);
    const r = advance(made.state, 24, env);
    expect(r.state.characters[made.value]!.attributes).toMatchObject({ might: 1, agility: 1, vigor: 1 });
  });
});

describe('natural death (§22.7)', () => {
  it('annual chances follow the table; Vigor and the Gray Queen scale the monthly check', () => {
    expect(annualDeathChance(20, content)).toBe(0.005);
    expect(annualDeathChance(39, content)).toBe(0.005);
    expect(annualDeathChance(40, content)).toBe(0.015);
    expect(annualDeathChance(65, content)).toBe(0.09);
    expect(annualDeathChance(80, content)).toBe(0.35);
    const r = build(peopleTestState(), env, (draft, ctx) => {
      const npc = makePerson(draft, ctx, { ageYears: 70, attributes: { vigor: 4 } });
      const hardy = makePerson(draft, ctx, { ageYears: 70, attributes: { vigor: 6 } });
      const kin = makePerson(draft, ctx, { ageYears: 70, attributes: { vigor: 4 }, factionId: draft.player.factionId });
      const base = monthlyDeathChance(draft, ctx.content, npc, 70);
      const vig = monthlyDeathChance(draft, ctx.content, hardy, 70);
      const before = monthlyDeathChance(draft, ctx.content, kin, 70);
      draft.player.house.favor.grayQueen = 20;
      const blessed = monthlyDeathChance(draft, ctx.content, kin, 70);
      return { base, vig, before, blessed };
    });
    expect(r.value.base).toBeCloseTo(0.18 / 12, 10);
    expect(r.value.vig).toBeCloseTo((0.18 * 0.9) / 12, 10);
    expect(r.value.before).toBeCloseTo(r.value.base, 10);
    expect(r.value.blessed).toBeCloseTo(r.value.base * 0.9, 10);
  });

  it('over a year, the share of 72-year-olds failing a check matches 1 − (1 − p/12)^12; a first failure only warns', () => {
    const n = 3000;
    const made = build(peopleTestState({ seed: 'old-age' }), env, (draft, ctx) => {
      const ids: CharId[] = [];
      for (let i = 0; i < n; i++) ids.push(makePerson(draft, ctx, { ageYears: 72, attributes: { vigor: 4 } }).id);
      return ids;
    });
    const r = advance(made.state, HOURS_PER_YEAR, env);
    const s = r.state;
    const p = annualDeathChance(72, content) / 12;
    const expectFailed = n * (1 - (1 - p) ** 12);
    const failed = made.value.filter((id) => !s.characters[id]!.alive || s.characters[id]!.oldAgeWarnedHour !== undefined);
    expect(Math.abs(failed.length - expectFailed)).toBeLessThan(4 * Math.sqrt(n * (1 - (1 - p) ** 12) * (1 - p) ** 12));
    const dead = made.value.filter((id) => !s.characters[id]!.alive);
    for (const id of dead) {
      expect(s.characters[id]!.death?.cause).toBe('oldAge');
      expect(s.characters[id]!.oldAgeWarnedHour).toBeDefined();
    }
    // Two failures are needed: deaths are far rarer than warnings.
    expect(dead.length).toBeLessThan(failed.length / 3);
    expect(r.events.filter((e) => e.type === 'OldAgeWarned').length).toBe(failed.length);
  });

  it('children do not die of old age', () => {
    const made = build(peopleTestState({ seed: 'kids' }), env, (draft, ctx) => {
      const ids: CharId[] = [];
      for (let i = 0; i < 500; i++) ids.push(makePerson(draft, ctx, { ageYears: 7 }).id);
      return ids;
    });
    const s = advance(made.state, HOURS_PER_YEAR, env).state;
    expect(made.value.every((id) => s.characters[id]!.alive)).toBe(true);
  });
});
