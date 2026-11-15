import { getContent } from '@content/index';
import { checkInvariants } from '@sim/core/env';
import { dispatch } from '@sim/core/dispatch';
import { advance } from '@sim/core/scheduler';
import type { CharId, FactionId, GameState } from '@sim/core/state';
import { DAYS_PER_YEAR, HOURS_PER_DAY } from '@sim/core/time';
import { testWorld } from '@sim/testing';
import { describe, expect, it } from 'vitest';
import { REGENCY_SKIP_FLAG } from './death';
import { module as people } from './index';
import { build, linkParent, linkSpouses, makePerson, peopleTestEnv, peopleTestState, testHouse } from './testing';

const b = getContent().balance;
const env = peopleTestEnv();

function kill(state: GameState, id: CharId, cause = 'battle') {
  return build(state, env, (_d, ctx) => ctx.applyEffects([{ op: 'kill', charId: id, cause }]));
}

function lieutenants(state: GameState): CharId[] {
  return Object.values(state.characters)
    .filter((c) => c.alive && c.role?.kind === 'lieutenant' && c.factionId === state.player.factionId)
    .map((c) => c.id);
}

describe('succession: adult heir (§23.4)', () => {
  it('the eldest child continues the saga with half the Renown and Honor; loyalty falls by 10', () => {
    const house = testHouse(peopleTestState(), env, { rulerAge: 50, childAges: [22, 19] });
    const prepared = build(house.state, env, (draft) => {
      draft.player.house.renown = 200;
      draft.player.house.honor = 40;
    }).state;
    const lts = lieutenants(prepared);
    const loyaltyBefore = lts.map((id) => prepared.characters[id]!.loyalty ?? 0);
    const holdingLoyalty = prepared.settlements[prepared.player.capitalId]!.holding!.loyalty;
    const r = kill(prepared, house.rulerId);
    const s = r.state;
    const heir = house.childIds[0]!;
    expect(s.player.rulerId).toBe(heir);
    expect(s.factions[s.player.factionId]!.rulerId).toBe(heir);
    expect(s.characters[heir]!.role).toMatchObject({ kind: 'ruler', factionId: s.player.factionId, holdingId: s.player.capitalId });
    expect(s.settlements[s.player.capitalId]!.leaderId).toBe(heir);
    expect(s.settlements[s.player.capitalId]!.holding!.governorId).toBe(heir);
    expect(s.player.house.renown).toBe(100);
    expect(s.player.house.honor).toBe(20);
    lts.forEach((id, i) => expect(s.characters[id]!.loyalty).toBe((loyaltyBefore[i] ?? 0) + b.dynasty.succession.loyaltyHit));
    expect(s.settlements[s.player.capitalId]!.holding!.loyalty).toBe(holdingLoyalty + b.dynasty.succession.loyaltyHit);
    const dead = s.characters[house.rulerId]!;
    expect(dead.alive).toBe(false);
    expect(dead.role).toBeUndefined();
    expect(r.events.map((e) => e.type)).toEqual(expect.arrayContaining(['Death', 'SuccessionOccurred']));
    expect(checkInvariants(s, env)).toEqual([]);
  });

  it('a designated heir is preferred; only kin may be designated', () => {
    const house = testHouse(peopleTestState(), env, { rulerAge: 50, childAges: [22, 19] });
    const younger = house.childIds[1]!;
    const stranger = build(house.state, env, (draft, ctx) => makePerson(draft, ctx, { ageYears: 30 }).id);
    expect(dispatch(stranger.state, { type: 'designateHeir', heirId: stranger.value }, env).error?.code).toBe('notEligible');
    const named = dispatch(stranger.state, { type: 'designateHeir', heirId: younger }, env);
    expect(named.error).toBeUndefined();
    expect(named.state.characters[house.rulerId]!.family.heirId).toBe(younger);
    expect(kill(named.state, house.rulerId).state.player.rulerId).toBe(younger);
  });
});

describe('succession: minor heir and regency', () => {
  function minorHouse(childBirthdayInDays: number) {
    const house = testHouse(peopleTestState(), env, { rulerAge: 40, childAges: [] });
    const made = build(house.state, env, (draft, ctx) => {
      const ruler = draft.characters[house.rulerId]!;
      const spouse = draft.characters[house.spouseId]!;
      spouse.skills.stewardship = 6;
      const kid = makePerson(draft, ctx, {
        birthHour: (childBirthdayInDays - 16 * DAYS_PER_YEAR) * HOURS_PER_DAY,
        factionId: draft.player.factionId,
        location: { kind: 'settlement', id: draft.player.capitalId },
      });
      linkParent(ruler, kid);
      linkParent(spouse, kid);
      return kid.id;
    });
    return { ...house, state: made.state, kid: made.value };
  }

  it('raises the succession decision; the regent acts; the heir rules at 16', () => {
    const h = minorHouse(10);
    const r = kill(h.state, h.rulerId);
    const p = r.state.pending;
    expect(p?.kind).toBe('succession');
    if (p?.kind !== 'succession') throw new Error('no succession');
    expect(p.payload).toMatchObject({ deceasedId: h.rulerId, heirId: h.kid, minor: true, regentId: h.spouseId, mode: 'play' });
    expect(p.payload.regentCandidates?.[0]).toBe(h.spouseId);
    // The generic decision modal can show it: the news and both ways to hold the hall, as ready commands.
    expect(p.payload).toMatchObject({ titleKey: 'people.succession.title', key: 'people.succession.body', illustration: 'people.illus.succession' });
    expect(p.payload.choices?.map((c) => c.command)).toEqual([
      { type: 'designateHeir', heirId: h.kid, pendingId: p.id, regency: 'play', regentId: h.spouseId },
      { type: 'designateHeir', heirId: h.kid, pendingId: p.id, regency: 'skip', regentId: h.spouseId },
    ]);
    expect(r.state.player.rulerId).toBe(h.spouseId);
    expect(r.state.characters[h.spouseId]!.role?.kind).toBe('regent');
    expect(r.state.people?.regency).toMatchObject({ heirId: h.kid, regentId: h.spouseId, mode: 'play' });
    const ok = dispatch(r.state, { type: 'designateHeir', pendingId: p.id, heirId: h.kid, regency: 'play' }, env);
    expect(ok.error).toBeUndefined();
    expect(ok.state.pending).toBeNull();
    expect(checkInvariants(ok.state, env)).toEqual([]);
    const later = advance(ok.state, 11 * HOURS_PER_DAY, env);
    expect(later.state.player.rulerId).toBe(h.kid);
    expect(later.state.people?.regency).toBeUndefined();
    expect(later.state.characters[h.kid]!.role?.kind).toBe('ruler');
    expect(later.state.characters[h.spouseId]!.role).toBeUndefined();
    expect(later.state.settlements[later.state.player.capitalId]!.leaderId).toBe(h.kid);
    expect(later.events.map((e) => e.type)).toEqual(expect.arrayContaining(['ComingOfAge', 'RegencyEnded', 'SuccessionOccurred']));
    expect(checkInvariants(later.state, env)).toEqual([]);
  });

  it('“skip to coming of age” runs the world forward under the AI regent', () => {
    const h = minorHouse(40);
    const r = kill(h.state, h.rulerId);
    const p = r.state.pending!;
    const before = r.state.time.hour;
    const ok = dispatch(r.state, { type: 'designateHeir', pendingId: p.id, heirId: h.kid, regency: 'skip' }, env);
    expect(ok.error).toBeUndefined();
    expect(ok.state.time.hour).toBeGreaterThanOrEqual(before + 39 * HOURS_PER_DAY);
    expect(ok.state.player.rulerId).toBe(h.kid);
    expect(ok.state.flags[REGENCY_SKIP_FLAG]).toBeUndefined();
    expect(ok.state.people?.regency).toBeUndefined();
  });

  it('during a regency the player may switch to skipping ahead, and only the regency’s heir is accepted', () => {
    const h = minorHouse(40);
    const r = kill(h.state, h.rulerId);
    const playing = dispatch(r.state, { type: 'designateHeir', pendingId: r.state.pending!.id, heirId: h.kid, regency: 'play' }, env).state;
    expect(playing.people?.regency?.mode).toBe('play');
    expect(dispatch(playing, { type: 'designateHeir', heirId: h.spouseId, regency: 'skip' }, env).error?.code).toBe('inRegency');
    expect(dispatch(playing, { type: 'designateHeir', heirId: h.kid }, env).error?.code).toBe('inRegency');
    const before = playing.time.hour;
    const skipped = dispatch(playing, { type: 'designateHeir', heirId: h.kid, regency: 'skip' }, env);
    expect(skipped.error).toBeUndefined();
    expect(skipped.state.time.hour).toBeGreaterThanOrEqual(before + 39 * HOURS_PER_DAY);
    expect(skipped.state.player.rulerId).toBe(h.kid);
    expect(skipped.state.people?.regency).toBeUndefined();
    expect(checkInvariants(skipped.state, env)).toEqual([]);
  });

  it('an adult candidate may be chosen instead of the minor heir', () => {
    const h = minorHouse(200);
    const withSibling = build(h.state, env, (draft, ctx) => {
      const ruler = draft.characters[h.rulerId]!;
      const parent = makePerson(draft, ctx, { ageYears: 70, sex: 'female' });
      parent.alive = false;
      parent.death = { hour: 0, cause: 'oldAge' };
      const sib = makePerson(draft, ctx, { ageYears: 35, factionId: draft.player.factionId });
      linkParent(parent, ruler);
      linkParent(parent, sib);
      return sib.id;
    });
    const r = kill(withSibling.state, h.rulerId);
    const p = r.state.pending!;
    if (p.kind !== 'succession') throw new Error('no succession');
    expect(p.payload.candidates).toEqual([h.kid, withSibling.value]);
    const ok = dispatch(r.state, { type: 'designateHeir', pendingId: p.id, heirId: withSibling.value }, env);
    expect(ok.error).toBeUndefined();
    expect(ok.state.player.rulerId).toBe(withSibling.value);
    expect(ok.state.people?.regency).toBeUndefined();
    expect(ok.state.characters[h.spouseId]!.role).toBeUndefined();
    expect(checkInvariants(ok.state, env)).toEqual([]);
  });

  it('a dead regent is replaced; a dead minor heir passes the crown on', () => {
    const h = minorHouse(200);
    const twin = build(h.state, env, (draft, ctx) => {
      const k2 = makePerson(draft, ctx, { ageYears: 9, factionId: draft.player.factionId });
      linkParent(draft.characters[h.rulerId]!, k2);
      linkParent(draft.characters[h.spouseId]!, k2);
      return k2.id;
    });
    let s = kill(twin.state, h.rulerId).state;
    s = dispatch(s, { type: 'designateHeir', pendingId: s.pending!.id, heirId: h.kid }, env).state;
    const afterRegent = kill(s, h.spouseId);
    expect(afterRegent.state.people?.regency?.heirId).toBe(h.kid);
    expect(afterRegent.state.player.rulerId).not.toBe(h.spouseId);
    expect(afterRegent.events.some((e) => e.type === 'SuccessionOccurred' && (e as { kind: string }).kind === 'regentReplaced')).toBe(true);
    expect(checkInvariants(afterRegent.state, env)).toEqual([]);
    const afterHeir = kill(afterRegent.state, h.kid, 'illness');
    expect(afterHeir.state.people?.regency?.heirId).toBe(twin.value);
    expect(checkInvariants(afterHeir.state, env)).toEqual([]);
  });

  it('a minor heir who dies before the regency decision is made gets a fresh decision for the next heir', () => {
    const h = minorHouse(200);
    const twin = build(h.state, env, (draft, ctx) => {
      const k2 = makePerson(draft, ctx, { ageYears: 9, factionId: draft.player.factionId });
      linkParent(draft.characters[h.rulerId]!, k2);
      linkParent(draft.characters[h.spouseId]!, k2);
      return k2.id;
    });
    const s = kill(twin.state, h.rulerId).state;
    const first = s.pending!;
    const r = kill(s, h.kid, 'illness');
    const p = r.state.pending;
    if (p?.kind !== 'succession') throw new Error('no fresh succession decision');
    expect(p.id).not.toBe(first.id);
    expect(p.payload.heirId).toBe(twin.value);
    expect(r.state.pendingQueue).toEqual([]);
    expect(r.state.people?.regency?.heirId).toBe(twin.value);
    const ok = dispatch(r.state, { type: 'designateHeir', pendingId: p.id, heirId: twin.value }, env);
    expect(ok.error).toBeUndefined();
    expect(checkInvariants(ok.state, env)).toEqual([]);
  });
});

describe('succession: no heir', () => {
  it('the nearest adult kin inherits, then a spouse', () => {
    const made = build(peopleTestState(), env, (draft, ctx) => {
      const ruler = draft.characters[draft.player.rulerId]!;
      const parent = makePerson(draft, ctx, { ageYears: 45, sex: 'male' });
      linkParent(parent, ruler);
      return parent.id;
    });
    const r = kill(made.state, made.state.player.rulerId);
    expect(r.state.player.rulerId).toBe(made.value);
    expect(r.events.some((e) => e.type === 'SuccessionOccurred' && (e as { kind: string }).kind === 'kin')).toBe(true);
    const married = build(peopleTestState(), env, (draft, ctx) => {
      const ruler = draft.characters[draft.player.rulerId]!;
      const spouse = makePerson(draft, ctx, { ageYears: 20 });
      linkSpouses(ruler, spouse);
      return spouse.id;
    });
    expect(kill(married.state, married.state.player.rulerId).state.player.rulerId).toBe(married.value);
  });

  it('with no kin at all, the house falls silent', () => {
    const state = peopleTestState();
    const r = kill(state, state.player.rulerId);
    expect(r.events.some((e) => e.type === 'HouseFallsSilent')).toBe(true);
    expect(r.events.some((e) => e.type === 'Notification' && e.key === 'people.notify.houseFallen' && e.illustration === 'people.illus.houseFallen')).toBe(true);
    expect(r.events.some((e) => e.type === 'Notification' && e.key === 'people.notify.death' && e.illustration === 'narrative.vignette.funeral')).toBe(true);
    expect(r.state.people?.houseFallen).toBe(true);
    expect(checkInvariants(r.state, env)).toEqual([]);
  });
});

describe('AI rulers and vacant offices', () => {
  it('an AI ruler’s adult child takes the high seat; with no family a new line rises', () => {
    const w = testWorld({ modules: [people], factions: 3 });
    const [, f1, f2] = w.factionIds as [FactionId, FactionId, FactionId];
    const made = build(w.state, w.env, (draft, ctx) => {
      const ruler = draft.characters[draft.factions[f1]!.rulerId]!;
      const son = makePerson(draft, ctx, { ageYears: 24, sex: 'male', culture: ruler.culture });
      linkParent(ruler, son);
      return son.id;
    });
    let s = build(made.state, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'kill', charId: made.state.factions[f1]!.rulerId, cause: 'oldAge' }])).state;
    expect(s.factions[f1]!.rulerId).toBe(made.value);
    expect(s.characters[made.value]!.role).toMatchObject({ kind: 'ruler', factionId: f1 });
    const old2 = s.factions[f2]!.rulerId;
    s = build(s, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'kill', charId: old2, cause: 'oldAge' }])).state;
    const newRuler = s.characters[s.factions[f2]!.rulerId]!;
    expect(newRuler.id).not.toBe(old2);
    expect(newRuler.alive).toBe(true);
    expect(newRuler.culture).toBe(s.factions[f2]!.culture);
    expect(checkInvariants(s, w.env)).toEqual([]);
  });

  it('a dead settlement leader is replaced; a dead governor hands the holding back to the ruler', () => {
    const w = testWorld({ modules: [people], factions: 2 });
    const npcSettlement = w.settlementIds[w.factionIds[1] as FactionId]![0]!;
    const leader = w.state.settlements[npcSettlement]!.leaderId;
    let r = build(w.state, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'kill', charId: leader, cause: 'oldAge' }]));
    const next = r.state.settlements[npcSettlement]!.leaderId;
    expect(next).not.toBe(leader);
    expect(r.state.characters[next]!.alive).toBe(true);
    expect(r.events.some((e) => e.type === 'LeaderReplaced')).toBe(true);
    const lt = lieutenants(r.state)[0]!;
    const capital = r.state.player.capitalId;
    const gov = dispatch(r.state, { type: 'assignRole', charId: lt, role: 'governor', holdingId: capital }, w.env);
    expect(gov.error).toBeUndefined();
    expect(gov.state.settlements[capital]!.holding!.governorId).toBe(lt);
    r = build(gov.state, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'kill', charId: lt, cause: 'battle' }]));
    expect(r.state.settlements[capital]!.holding!.governorId).toBe(r.state.player.rulerId);
    expect(checkInvariants(r.state, w.env)).toEqual([]);
  });
});
