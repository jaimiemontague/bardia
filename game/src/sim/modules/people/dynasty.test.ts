import { getContent } from '@content/index';
import { dispatch } from '@sim/core/dispatch';
import { checkInvariants } from '@sim/core/env';
import { relationKey } from '@sim/core/factory';
import { advance } from '@sim/core/scheduler';
import type { CharId, FactionId, GameState } from '@sim/core/state';
import { DAYS_PER_YEAR, HOURS_PER_DAY, HOURS_PER_MONTH, HOURS_PER_YEAR } from '@sim/core/time';
import { testWorld } from '@sim/testing';
import { describe, expect, it } from 'vitest';
import { conceive, conceptionChance } from './dynasty';
import { module as people } from './index';
import { build, linkParent, linkSpouses, makePerson, peopleTestEnv, peopleTestState, testHouse } from './testing';

const content = getContent();
const b = content.balance;
const env = peopleTestEnv();

describe('marriage (§23.1)', () => {
  it('links both spouses, brings the spouse into the house and warms the in-laws', () => {
    const w = testWorld({ modules: [people], factions: 2 });
    const other = w.factionIds[1] as FactionId;
    const r = build(w.state, w.env, (draft, ctx) => {
      const bride = makePerson(draft, ctx, { ageYears: 20, sex: draft.characters[draft.player.rulerId]!.sex === 'male' ? 'female' : 'male', factionId: other });
      ctx.applyEffects([{ op: 'marry', spouseId: bride.id }]);
      return bride.id;
    });
    const ruler = r.state.characters[r.state.player.rulerId]!;
    const spouse = r.state.characters[r.value]!;
    expect(ruler.family.spouseIds).toEqual([spouse.id]);
    expect(spouse.family.spouseIds).toEqual([ruler.id]);
    expect(spouse.factionId).toBe(r.state.player.factionId);
    expect(spouse.location).toEqual({ kind: 'settlement', id: r.state.player.capitalId });
    expect(r.state.relations[relationKey(r.state.player.factionId, other)]?.opinion).toBe(b.dynasty.inLawOpinion);
    expect(r.events.some((e) => e.type === 'Marriage')).toBe(true);
  });

  it('refuses minors, the married, close kin and (with the option off) same-sex couples', () => {
    const base = testHouse(peopleTestState(), env, { rulerAge: 40, childAges: [18, 17, 10] });
    const [a, b2, kid] = base.childIds as [CharId, CharId, CharId];
    const tryMarry = (state: GameState, x: CharId, y: CharId) => () => build(state, env, (_d, ctx) => ctx.applyEffects([{ op: 'marry', charId: x, spouseId: y }]));
    const stranger = build(base.state, env, (draft, ctx) => makePerson(draft, ctx, { ageYears: 20 }).id);
    expect(tryMarry(stranger.state, a, b2)).toThrow(/kin/);
    expect(tryMarry(stranger.state, kid, stranger.value)).toThrow(/minor/);
    expect(tryMarry(stranger.state, base.rulerId, stranger.value)).toThrow(/married/);
    const sameSex = build(stranger.state, env, (draft) => {
      draft.meta.options.anySexMarriage = false;
      draft.characters[stranger.value]!.sex = draft.characters[a]!.sex;
    }).state;
    expect(tryMarry(sameSex, a, stranger.value)).toThrow(/sameSex/);
    const ok = build(stranger.state, env, (_d, ctx) => ctx.applyEffects([{ op: 'marry', charId: a, spouseId: stranger.value }]));
    expect(ok.state.characters[a]!.family.spouseIds).toContain(stranger.value);
  });
});

function couples(state: GameState, n: number, wifeAge: number, house: boolean) {
  return build(state, env, (draft, ctx) => {
    const ids: CharId[] = [];
    const at = draft.player.capitalId;
    const factionId = house ? draft.player.factionId : undefined;
    for (let i = 0; i < n; i++) {
      const wife = makePerson(draft, ctx, { ageYears: wifeAge, sex: 'female', location: { kind: 'settlement', id: at }, ...(factionId ? { factionId } : {}) });
      const husband = makePerson(draft, ctx, { ageYears: wifeAge + 2, sex: 'male', location: { kind: 'settlement', id: at }, ...(factionId ? { factionId } : {}) });
      linkSpouses(wife, husband);
      ids.push(wife.id);
    }
    return ids;
  });
}

describe('children (§23.2)', () => {
  it('conception chance: 5% × ageFactor × (1 + Fjorna/100) × Golden Sheaf', () => {
    const r = build(peopleTestState(), env, (draft, ctx) => {
      const npc = makePerson(draft, ctx, { ageYears: 25, sex: 'female' });
      const old = makePerson(draft, ctx, { ageYears: 35, sex: 'female' });
      const late = makePerson(draft, ctx, { ageYears: 46, sex: 'female' });
      const kin = makePerson(draft, ctx, { ageYears: 25, sex: 'female', factionId: draft.player.factionId });
      draft.player.house.favor.fjorna = 50;
      draft.flags['relic.goldenSheaf'] = true;
      return {
        npc: conceptionChance(draft, ctx.content, npc, ctx.hour),
        old: conceptionChance(draft, ctx.content, old, ctx.hour),
        late: conceptionChance(draft, ctx.content, late, ctx.hour),
        kin: conceptionChance(draft, ctx.content, kin, ctx.hour),
      };
    });
    expect(r.value.npc).toBeCloseTo(0.05);
    expect(r.value.old).toBeCloseTo(0.03);
    expect(r.value.late).toBe(0);
    expect(r.value.kin).toBeCloseTo(0.05 * 1.5 * 1.2);
    // A held relic record counts like the flag (quests' relic id `rel_goldenSheaf`); another house's does not.
    const relic = build(peopleTestState(), env, (draft, ctx) => {
      const kin = makePerson(draft, ctx, { ageYears: 25, sex: 'female', factionId: draft.player.factionId });
      draft.relics.rel_goldenSheaf = { id: 'rel_goldenSheaf', holder: 'site', knownToPlayer: 'legend' };
      const before = conceptionChance(draft, ctx.content, kin, ctx.hour);
      draft.relics.rel_goldenSheaf.holder = draft.player.factionId;
      return { before, held: conceptionChance(draft, ctx.content, kin, ctx.hour) };
    });
    expect(relic.value.held).toBeCloseTo(relic.value.before * 1.2);
  });

  it('about 5% of young couples conceive in a month (fertility statistics)', () => {
    const n = 3000;
    const made = couples(peopleTestState({ seed: 'fertility' }), n, 25, false);
    const s = advance(made.state, HOURS_PER_MONTH, env).state;
    const pregnant = made.value.filter((id) => s.characters[id]!.pregnancy !== undefined).length;
    expect(Math.abs(pregnant - n * 0.05)).toBeLessThan(4 * Math.sqrt(n * 0.05 * 0.95));
    expect(s.people?.pregnantIds.length).toBe(pregnant);
  });

  it('spouses apart do not conceive', () => {
    const made = build(peopleTestState({ seed: 'apart' }), env, (draft, ctx) => {
      const ids: CharId[] = [];
      for (let i = 0; i < 300; i++) {
        const wife = makePerson(draft, ctx, { ageYears: 25, sex: 'female', location: { kind: 'settlement', id: draft.player.capitalId } });
        const husband = makePerson(draft, ctx, { ageYears: 27, sex: 'male', location: { kind: 'fleet', id: 'flt_999' } });
        linkSpouses(wife, husband);
        ids.push(wife.id);
      }
      return ids;
    });
    const s = advance(made.state, 3 * HOURS_PER_MONTH, env).state;
    expect(made.value.some((id) => s.characters[id]!.pregnancy !== undefined)).toBe(false);
  });

  it('a pregnancy comes to term after 270 days; the child joins both parents and the house', () => {
    const house = testHouse(peopleTestState(), env, { rulerAge: 25 });
    const made = build(house.state, env, (draft, ctx) => {
      const ruler = draft.characters[house.rulerId]!;
      const spouse = draft.characters[house.spouseId]!;
      const mother = ruler.sex === 'female' ? ruler : spouse;
      const father = mother === ruler ? spouse : ruler;
      conceive(draft, ctx, mother, father);
      mother.pregnancy!.twins = false;
      return { mother: mother.id, father: father.id };
    });
    let s = advance(made.state, (b.dynasty.pregnancyDays - 1) * HOURS_PER_DAY, { ...env }).state;
    expect(s.characters[made.value.mother]!.pregnancy).toBeDefined();
    const r = advance(s, 2 * HOURS_PER_DAY, env);
    s = r.state;
    const mother = s.characters[made.value.mother]!;
    expect(mother.pregnancy).toBeUndefined();
    const births = r.events.filter((e) => e.type === 'Birth') as { childId: CharId }[];
    expect(births.length).toBeGreaterThanOrEqual(1);
    const child = s.characters[births[0]!.childId]!;
    expect(child.family).toMatchObject({ motherId: made.value.mother, fatherId: made.value.father });
    expect(s.characters[made.value.father]!.family.childIds).toContain(child.id);
    expect(mother.family.childIds).toContain(child.id);
    expect(child.factionId).toBe(s.player.factionId);
    expect(child.agedTo).toBe(0);
  });

  it('Gentle Mode: no childbirth deaths and no child deaths from illness', () => {
    const made = build(peopleTestState({ seed: 'gentle', options: { gentleMode: true } }), env, (draft, ctx) => {
      const kids: CharId[] = [];
      for (let i = 0; i < 1500; i++) kids.push(makePerson(draft, ctx, { ageYears: 1 }).id);
      const mothers: CharId[] = [];
      for (let i = 0; i < 300; i++) {
        const m = makePerson(draft, ctx, { ageYears: 25, sex: 'female' });
        conceive(draft, ctx, m, undefined);
        m.pregnancy!.dueHour = 48;
        mothers.push(m.id);
      }
      return { kids, mothers };
    });
    const r = advance(made.state, HOURS_PER_YEAR, env);
    expect(made.value.kids.every((id) => r.state.characters[id]!.alive)).toBe(true);
    expect(made.value.mothers.every((id) => r.state.characters[id]!.alive)).toBe(true);
    expect(r.events.filter((e) => e.type === 'ChildFellIll').length).toBeGreaterThan(10);
  });

  it('without Gentle Mode some sick children die (about 3%/year × deathChance)', () => {
    const n = 3000;
    const made = build(peopleTestState({ seed: 'harsh' }), env, (draft, ctx) => {
      const kids: CharId[] = [];
      for (let i = 0; i < n; i++) kids.push(makePerson(draft, ctx, { ageYears: 2 }).id);
      return kids;
    });
    const r = advance(made.state, HOURS_PER_YEAR, env);
    const dead = made.value.filter((id) => !r.state.characters[id]!.alive).length;
    const expected = n * (1 - (1 - b.dynasty.childIllnessPerYear / 12) ** 12) * content.tunables.people.childIllness.deathChance;
    expect(Math.abs(dead - expected)).toBeLessThan(5 * Math.sqrt(expected));
  });
});

describe('coming of age and upbringing (§23.3)', () => {
  it('at 16: inherited traits, an education trait from the tutor’s focus, skills and attributes', () => {
    const made = build(peopleTestState({ seed: 'coa' }), env, (draft, ctx) => {
      const father = makePerson(draft, ctx, { ageYears: 40, sex: 'male', traits: ['brave', 'towering'] });
      const mother = makePerson(draft, ctx, { ageYears: 38, sex: 'female', traits: ['honest'] });
      const kid = makePerson(draft, ctx, { birthHour: (1 - 16 * DAYS_PER_YEAR) * HOURS_PER_DAY, factionId: draft.player.factionId });
      linkParent(father, kid);
      linkParent(mother, kid);
      kid.upbringing = { mode: 'tutor', focusSkill: 'stewardship', sinceHour: 0, progressDays: 0 };
      kid.skills.stewardship = 2;
      draft.people!.fosterIds.push(kid.id);
      return kid.id;
    });
    const r = advance(made.state, 24, env);
    const kid = r.state.characters[made.value]!;
    expect(kid.traits).toContain('merchantRaised');
    expect(kid.skills.stewardship).toBe(content.tunables.people.comingOfAge.skillCap);
    const skillTotal = Object.values(kid.skills).reduce((a, n) => a + n, 0);
    expect(skillTotal).toBe(2 + content.tunables.people.comingOfAge.skillPoints);
    const attrTotal = kid.attributes.might + kid.attributes.agility + kid.attributes.wits + kid.attributes.vigor;
    expect(attrTotal).toBe(16 + content.tunables.people.comingOfAge.attributePoints);
    expect(kid.upbringing).toBeUndefined();
    expect(r.state.people?.fosterIds).not.toContain(kid.id);
    expect(kid.title).toBe('people.title.1');
    expect(r.events.some((e) => e.type === 'ComingOfAge')).toBe(true);
  });

  it('each inheritable parent trait passes with the inheritance chance', () => {
    const n = 1500;
    const made = build(peopleTestState({ seed: 'inherit' }), env, (draft, ctx) => {
      const father = makePerson(draft, ctx, { ageYears: 40, sex: 'male', traits: ['brave'] });
      const kids: CharId[] = [];
      for (let i = 0; i < n; i++) {
        const kid = makePerson(draft, ctx, { birthHour: (1 - 16 * DAYS_PER_YEAR) * HOURS_PER_DAY });
        linkParent(father, kid);
        kids.push(kid.id);
      }
      return kids;
    });
    const s = advance(made.state, 24, env).state;
    const brave = made.value.filter((id) => s.characters[id]!.traits.includes('brave')).length;
    const p = b.character.traitInheritChance;
    expect(Math.abs(brave - n * p)).toBeLessThan(4 * Math.sqrt(n * p * (1 - p)));
  });

  it('a tutor adds a point to the focus skill every three years', () => {
    const house = testHouse(peopleTestState(), env, { rulerAge: 35, childAges: [7] });
    const kid = house.childIds[0]!;
    const r = dispatch(house.state, { type: 'foster', childId: kid, mode: 'tutor', focusSkill: 'runecraft' }, env);
    expect(r.error).toBeUndefined();
    const before = r.state.characters[kid]!.skills.runecraft;
    const s = advance(r.state, 3 * HOURS_PER_YEAR + HOURS_PER_MONTH, env).state;
    expect(s.characters[kid]!.skills.runecraft).toBe(before + 1);
    expect(dispatch(house.state, { type: 'foster', childId: kid, mode: 'tutor' }, env).error?.code).toBe('focusRequired');
  });

  it('fostering with a lieutenant raises loyalty once; ages outside 6–15 are refused', () => {
    const house = testHouse(peopleTestState(), env, { rulerAge: 40, childAges: [9, 4] });
    const lt = build(house.state, env, (draft, ctx) =>
      makePerson(draft, ctx, { ageYears: 30, factionId: draft.player.factionId, role: { kind: 'lieutenant' }, loyalty: 50, skills: { seafaring: 6 } }).id,
    );
    const [nine, four] = house.childIds as [CharId, CharId];
    expect(dispatch(lt.state, { type: 'foster', childId: four, mode: 'lieutenant', lieutenantId: lt.value }, env).error?.code).toBe('wrongAge');
    let s = dispatch(lt.state, { type: 'foster', childId: nine, mode: 'lieutenant', lieutenantId: lt.value }, env).state;
    expect(s.characters[lt.value]!.loyalty).toBe(50 + b.dynasty.fosterLieutenantLoyalty);
    expect(s.characters[nine]!.upbringing).toMatchObject({ mode: 'lieutenant', focusSkill: 'seafaring', mentorId: lt.value });
    s = dispatch(s, { type: 'foster', childId: nine, mode: 'home' }, env).state;
    s = dispatch(s, { type: 'foster', childId: nine, mode: 'lieutenant', lieutenantId: lt.value }, env).state;
    expect(s.characters[lt.value]!.loyalty).toBe(50 + b.dynasty.fosterLieutenantLoyalty);
  });

  it('an allied court fosters the child abroad; if relations sour the child becomes a hostage', () => {
    const w = testWorld({ modules: [people], factions: 2 });
    const ally = w.factionIds[1] as FactionId;
    const house = testHouse(w.state, w.env, { rulerAge: 40, childAges: [10] });
    const kid = house.childIds[0]!;
    expect(dispatch(house.state, { type: 'foster', childId: kid, mode: 'ally', factionId: ally }, w.env).error?.code).toBe('notAllied');
    const friendly = build(house.state, w.env, (draft) => {
      draft.relations[relationKey(draft.player.factionId, ally)]!.stance = 'friendly';
    }).state;
    const r = dispatch(friendly, { type: 'foster', childId: kid, mode: 'ally', factionId: ally }, w.env);
    expect(r.error).toBeUndefined();
    const child = r.state.characters[kid]!;
    expect(child.skills.speechcraft).toBe(1);
    expect(child.family.fosteredAt).toBe(ally);
    expect(child.location.kind === 'settlement' && r.state.settlements[child.location.id]?.factionId).toBe(ally);
    expect(r.state.relations[relationKey(r.state.player.factionId, ally)]!.opinion).toBe(b.dynasty.fosterAllyOpinion);
    const war = build(r.state, w.env, (draft) => {
      draft.relations[relationKey(draft.player.factionId, ally)]!.stance = 'war';
    }).state;
    const h = advance(war, HOURS_PER_MONTH, w.env);
    const hostage = h.state.characters[kid]!;
    expect(hostage.location.kind).toBe('captive');
    expect(hostage.captivity?.hostage).toBe(true);
    expect(h.events.some((e) => e.type === 'FosterlingTakenHostage')).toBe(true);
  });
});

describe('adoption (§23.4)', () => {
  it('a kinsman’s child or a ward may be adopted unless Honor is below the threshold', () => {
    const made = build(peopleTestState(), env, (draft, ctx) => {
      const ruler = draft.characters[draft.player.rulerId]!;
      const parent = makePerson(draft, ctx, { ageYears: 50, sex: 'female' });
      const sibling = makePerson(draft, ctx, { ageYears: 30, sex: 'male' });
      linkParent(parent, ruler);
      linkParent(parent, sibling);
      const niece = makePerson(draft, ctx, { ageYears: 6 });
      linkParent(sibling, niece);
      const stranger = makePerson(draft, ctx, { ageYears: 6 });
      const ward = makePerson(draft, ctx, { ageYears: 8 });
      ward.family.fosteredAt = ruler.id;
      return { niece: niece.id, stranger: stranger.id, ward: ward.id };
    });
    expect(dispatch(made.state, { type: 'adopt', childId: made.value.stranger }, env).error?.code).toBe('notEligible');
    const ok = dispatch(made.state, { type: 'adopt', childId: made.value.niece }, env);
    expect(ok.error).toBeUndefined();
    const niece = ok.state.characters[made.value.niece]!;
    expect(niece.family.adoptedById).toBe(ok.state.player.rulerId);
    expect(ok.state.characters[ok.state.player.rulerId]!.family.childIds).toContain(niece.id);
    expect(niece.factionId).toBe(ok.state.player.factionId);
    expect(dispatch(ok.state, { type: 'adopt', childId: made.value.niece }, env).error?.code).toBe('alreadyChild');
    const shamed = build(made.state, env, (draft) => {
      draft.player.house.honor = -60;
    }).state;
    expect(dispatch(shamed, { type: 'adopt', childId: made.value.ward }, env).error?.code).toBe('notRecognized');
    expect(dispatch(made.state, { type: 'adopt', childId: made.value.ward }, env).error).toBeUndefined();
  });

  it('a ward whose adoptive parent died passes to the new parent; a living adopter keeps the child', () => {
    const made = build(peopleTestState(), env, (draft, ctx) => {
      const ruler = draft.characters[draft.player.rulerId]!;
      const adopter = makePerson(draft, ctx, { ageYears: 50 });
      const ward = makePerson(draft, ctx, { ageYears: 8 });
      ward.family.fosteredAt = ruler.id;
      ward.family.adoptedById = adopter.id;
      adopter.family.childIds.push(ward.id);
      return { adopter: adopter.id, ward: ward.id };
    });
    expect(dispatch(made.state, { type: 'adopt', childId: made.value.ward }, env).error?.code).toBe('alreadyAdopted');
    const widowed = build(made.state, env, (_d, ctx) => ctx.applyEffects([{ op: 'kill', charId: made.value.adopter, cause: 'oldAge' }])).state;
    const ok = dispatch(widowed, { type: 'adopt', childId: made.value.ward }, env);
    expect(ok.error).toBeUndefined();
    expect(ok.state.characters[made.value.ward]!.family.adoptedById).toBe(ok.state.player.rulerId);
    expect(ok.state.characters[made.value.adopter]!.family.childIds).not.toContain(made.value.ward);
    expect(checkInvariants(ok.state, env)).toEqual([]);
  });

  it('the birth effect brings a foundling into the player’s house', () => {
    const r = build(peopleTestState(), env, (_d, ctx) => ctx.applyEffects([{ op: 'birth', name: 'Foundling' }]));
    const births = r.events.filter((e) => e.type === 'Birth') as { childId: CharId }[];
    expect(births).toHaveLength(1);
    const c = r.state.characters[births[0]!.childId]!;
    expect(c.name).toBe('Foundling');
    expect(c.factionId).toBe(r.state.player.factionId);
  });
});
