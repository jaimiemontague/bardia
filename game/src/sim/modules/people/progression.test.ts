import { getContent } from '@content/index';
import { missingLocaleKeys } from '@content/locales/index';
import { levelForXp, xpForLevel } from '@sim/core/balance';
import { dispatch } from '@sim/core/dispatch';
import type { CharId, GameState } from '@sim/core/state';
import { describe, expect, it } from 'vitest';
import { grantXp, titleKeyFor, xpMultiplier } from './progression';
import { build, makePerson, peopleTestEnv, peopleTestState } from './testing';

const content = getContent();
const b = content.balance;

function ruler(state: GameState) {
  return state.characters[state.player.rulerId]!;
}

describe('XP and levels (§22.1)', () => {
  it('the level table is round10(100·(n−1)^1.7) and levelForXp inverts it', () => {
    const expected = [0, 100, 320, 650, 1060, 1540, 2100, 2730, 3430, 4190, 5010, 5890, 6830, 7830, 8880, 9990, 11140, 12350, 13610, 14920];
    expect(b.xp.levelTable).toEqual(expected);
    expected.forEach((xp, i) => {
      expect(levelForXp(b, xp)).toBe(i + 1);
      if (xp > 0) expect(levelForXp(b, xp - 1)).toBe(i);
      expect(xpForLevel(b, i + 1)).toBe(xp);
    });
  });

  it('Wits adds 2% per point around the pivot; non-rulers learn at ×0.75', () => {
    const env = peopleTestEnv();
    const r = build(peopleTestState(), env, (draft, ctx) => {
      const lt = makePerson(draft, ctx, { ageYears: 25, factionId: draft.player.factionId, role: { kind: 'lieutenant' } });
      const me = draft.characters[draft.player.rulerId]!;
      me.attributes.wits = 4;
      const base = xpMultiplier(draft, me, ctx.content);
      me.attributes.wits = 7;
      const sharp = xpMultiplier(draft, me, ctx.content);
      lt.attributes.wits = 4;
      return { base, sharp, lt: xpMultiplier(draft, lt, ctx.content) };
    });
    expect(r.value.base).toBeCloseTo(1);
    expect(r.value.sharp).toBeCloseTo(1.06);
    expect(r.value.lt).toBeCloseTo(0.75);
  });

  it('the ruler banks points, gets a feat decision at level 5, and chooses one', () => {
    const env = peopleTestEnv();
    const r = build(peopleTestState(), env, (draft, ctx) => {
      const me = draft.characters[draft.player.rulerId]!;
      me.attributes.wits = 4;
      return grantXp(draft, ctx, me, 1060, 'test');
    });
    expect(r.value).toBe(1060);
    const me = ruler(r.state);
    expect(me.level).toBe(5);
    expect(me.unspentSkillPoints).toBe(4);
    expect(me.unspentAttributePoints).toBe(1);
    expect(r.events.filter((e) => e.type === 'LevelUp').map((e) => (e as { level: number }).level)).toEqual([2, 3, 4, 5]);
    const p = r.state.pending;
    expect(p?.kind).toBe('featChoice');
    if (p?.kind !== 'featChoice') throw new Error('no feat choice');
    expect(p.payload.options).toHaveLength(b.xp.featChoices);
    expect(new Set(p.payload.options).size).toBe(b.xp.featChoices);
    // The generic decision modal can show it: one button per feat, each a ready command.
    expect(p.payload.choices?.map((c) => c.command)).toEqual(p.payload.options.map((featId) => ({ type: 'chooseFeat', pendingId: p.id, featId })));
    expect(p.payload.choices?.[0]?.vars.name).toBe(getContent().feats[p.payload.options[0]!]?.name);
    const bad = dispatch(r.state, { type: 'chooseFeat', pendingId: p.id, featId: 'notAFeat' }, env);
    expect(bad.error?.code).toBeDefined();
    const pick = p.payload.options[1]!;
    const ok = dispatch(r.state, { type: 'chooseFeat', pendingId: p.id, featId: pick }, env);
    expect(ok.error).toBeUndefined();
    expect(ruler(ok.state).feats).toEqual([pick]);
    expect(ok.state.pending).toBeNull();
    expect(ok.events.some((e) => e.type === 'FeatChosen')).toBe(true);
    expect(ruler(ok.state).title).toBe('people.title.5');
  });

  it('one grant crossing two feat levels queues two decisions with disjoint offers', () => {
    const env = peopleTestEnv();
    const r = build(peopleTestState(), env, (draft, ctx) => {
      const me = draft.characters[draft.player.rulerId]!;
      me.attributes.wits = 4;
      grantXp(draft, ctx, me, b.xp.levelTable[9]!, 'test');
    });
    expect(ruler(r.state).level).toBe(10);
    const first = r.state.pending;
    const second = r.state.pendingQueue[0];
    if (first?.kind !== 'featChoice' || second?.kind !== 'featChoice') throw new Error('expected two feat choices');
    expect(first.payload.level).toBe(5);
    expect(second.payload.level).toBe(10);
    expect(first.payload.options.filter((f) => second.payload.options.includes(f))).toEqual([]);
    const s1 = dispatch(r.state, { type: 'chooseFeat', pendingId: first.id, featId: first.payload.options[0]! }, env).state;
    expect(s1.pending?.id).toBe(second.id);
    const s2 = dispatch(s1, { type: 'chooseFeat', pendingId: second.id, featId: second.payload.options[2]! }, env).state;
    expect(ruler(s2).feats).toEqual([first.payload.options[0], second.payload.options[2]]);
    expect(s2.pending).toBeNull();
  });

  it('lieutenants grow by inclination under the auto policy and pick feats by affinity', () => {
    const env = peopleTestEnv();
    const r = build(peopleTestState(), env, (draft, ctx) => {
      const lt = makePerson(draft, ctx, {
        ageYears: 25,
        factionId: draft.player.factionId,
        role: { kind: 'lieutenant' },
        skills: { seafaring: 4, melee: 3 },
        attributes: { wits: 4 },
      });
      grantXp(draft, ctx, lt, Math.ceil(1060 / b.xp.lieutenantMult), 'test');
      return lt.id;
    });
    const lt = r.state.characters[r.value]!;
    expect(lt.level).toBe(5);
    expect(lt.unspentSkillPoints).toBeUndefined();
    const total = Object.values(lt.skills).reduce((a, n) => a + n, 0);
    expect(total).toBe(4 + 3 + 4);
    // Points alternate between the two inclined skills.
    expect(lt.skills.seafaring + lt.skills.melee).toBe(11);
    expect(lt.attributes.vigor + lt.attributes.might).toBe(9); // +1 to the favoured attribute
    expect(lt.feats).toHaveLength(1);
    expect(r.state.pending).toBeNull();
  });

  it('allocatePoints validates and spends the banked points', () => {
    const env = peopleTestEnv();
    let state = build(peopleTestState(), env, (draft, ctx) => {
      grantXp(draft, ctx, draft.characters[draft.player.rulerId]!, 650, 'test');
    }).state;
    const id = state.player.rulerId;
    expect(ruler(state).unspentSkillPoints).toBe(3);
    const before = ruler(state).skills.speechcraft;
    expect(dispatch(state, { type: 'allocatePoints', charId: id, skills: { speechcraft: 4 } }, env).error?.code).toBe('notEnoughPoints');
    expect(dispatch(state, { type: 'allocatePoints', charId: id, attributes: { wits: 1 } }, env).error?.code).toBe('notEnoughPoints');
    expect(dispatch(state, { type: 'allocatePoints', charId: id }, env).error?.code).toBe('nothingToAllocate');
    const ok = dispatch(state, { type: 'allocatePoints', charId: id, skills: { speechcraft: 2, runecraft: 1 } }, env);
    expect(ok.error).toBeUndefined();
    state = ok.state;
    expect(ruler(state).skills.speechcraft).toBe(before + 2);
    expect(ruler(state).unspentSkillPoints).toBeUndefined();
  });

  it('the manual policy leaves lieutenants’ points for the player', () => {
    const env = peopleTestEnv();
    let state = peopleTestState();
    state = dispatch(state, { type: 'setPolicy', policy: 'levelUpPoints', value: 'manual' }, env).state;
    const r = build(state, env, (draft, ctx) => {
      const lt = makePerson(draft, ctx, { ageYears: 25, factionId: draft.player.factionId, role: { kind: 'lieutenant' }, attributes: { wits: 4 } });
      grantXp(draft, ctx, lt, 200, 'test');
      return lt.id;
    });
    expect(r.state.characters[r.value]!.unspentSkillPoints).toBe(1);
  });
});

describe('titles and deed-names (§22.2)', () => {
  it('every title and Honor/Dread variant has a string', () => {
    const keys: string[] = [];
    for (const t of content.titles) {
      keys.push(`people.title.${t.level}`);
      t.variants.forEach((_, i) => keys.push(`people.title.${t.level}.v${i}`));
    }
    expect(missingLocaleKeys(keys)).toEqual([]);
  });

  it('variants read the house standings for the ruler; a standing change re-titles', () => {
    const env = peopleTestEnv();
    let state = build(peopleTestState(), env, (draft, ctx) => {
      const me = draft.characters[draft.player.rulerId]!;
      me.attributes.wits = 4;
      draft.player.house.honor = 10;
      draft.player.house.dread = 40;
      grantXp(draft, ctx, me, b.xp.levelTable[7]!, 'test');
    }).state;
    if (state.pending) state = dispatch(state, { type: 'chooseFeat', pendingId: state.pending.id, featId: (state.pending.payload as { options: string[] }).options[0]! }, env).state;
    expect(ruler(state).title).toBe('people.title.8.v0');
    expect(titleKeyFor(state, content, ruler(state))).toBe('people.title.8.v0');
    const r = build(state, env, (draft, ctx) => {
      ctx.applyEffects([{ op: 'changeHonor', amount: 50 }]);
    });
    expect(ruler(r.state).title).toBe('people.title.8');
    expect(r.events.some((e) => e.type === 'TitleChanged')).toBe(true);
  });

  it('grantDeedName overrides the title', () => {
    const env = peopleTestEnv();
    const r = build(peopleTestState(), env, (draft, ctx) => {
      ctx.applyEffects([{ op: 'grantDeedName', key: 'people.deedName.bane', vars: { target: 'Ketilmund' } }]);
    });
    expect(ruler(r.state).deedName).toMatchObject({ key: 'people.deedName.bane', vars: { target: 'Ketilmund' } });
    const ev = r.events.find((e) => e.type === 'TitleChanged') as { deedNameKey?: string } | undefined;
    expect(ev?.deedNameKey).toBe('people.deedName.bane');
  });

  it('grantXp effect validates and is a no-op for the dead', () => {
    const env = peopleTestEnv();
    const r = build(peopleTestState(), env, (draft, ctx) => {
      const c = makePerson(draft, ctx, { ageYears: 30 });
      c.alive = false;
      c.death = { hour: 0, cause: 'test' };
      ctx.applyEffects([{ op: 'grantXp', charId: c.id, amount: 500, source: 'test' }]);
      return c.id as CharId;
    });
    expect(r.state.characters[r.value]!.xp).toBe(0);
    expect(() => build(peopleTestState(), env, (_d, ctx) => ctx.applyEffects([{ op: 'grantXp', amount: -5 }]))).toThrow(/grantXp/);
  });
});
