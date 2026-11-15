import { getContent } from '@content/index';
import { checkInvariants } from '@sim/core/env';
import { dispatch } from '@sim/core/dispatch';
import { advance } from '@sim/core/scheduler';
import type { CharId, FactionId, GameState } from '@sim/core/state';
import { HOURS_PER_DAY, HOURS_PER_MONTH, HOURS_PER_WEEK } from '@sim/core/time';
import { inDraft, testWorld } from '@sim/testing';
import { describe, expect, it } from 'vitest';
import { bargainChance, escapeChance, monthlyCaptivity, ransomFor, weeklyCaptivity } from './captivity';
import { module as people } from './index';
import { build, makePerson, testHouse } from './testing';

const content = getContent();
const b = content.balance;

function world(seed = 'captivity') {
  const w = testWorld({ modules: [people], factions: 2, seed });
  return { ...w, enemy: w.factionIds[1] as FactionId };
}

function captureRuler(state: GameState, env: ReturnType<typeof world>['env'], enemy: FactionId) {
  return build(state, env, (_d, ctx) => ctx.applyEffects([{ op: 'capture', byFactionId: enemy, cause: 'battle' }]));
}

describe('capture and release (§23.5)', () => {
  it('capturing the ruler holds them at the captor’s court and raises the captivity decision', () => {
    const w = world();
    const r = captureRuler(w.state, w.env, w.enemy);
    const ruler = r.state.characters[r.state.player.rulerId]!;
    expect(ruler.location.kind).toBe('captive');
    expect(ruler.captivity?.byFactionId).toBe(w.enemy);
    const treasury = w.state.factions[w.state.player.factionId]!.treasury;
    const tier = Math.min(10, Math.floor(treasury / 2000));
    expect(ruler.captivity?.ransom).toBe(Math.round(b.prices.ransom.rankValue.jarl * (1 + b.prices.ransom.wealthTierStep * tier)));
    expect(r.state.people?.captiveIds).toEqual([ruler.id]);
    const p = r.state.pending;
    expect(p?.kind).toBe('captivity');
    if (p?.kind !== 'captivity') throw new Error('no captivity');
    expect(p.payload).toMatchObject({ charId: ruler.id, captorFactionId: w.enemy, ransom: ruler.captivity?.ransom, canPay: false });
    // The generic decision modal can show it: text and one button per choice, each a ready command.
    expect(p.payload).toMatchObject({ titleKey: 'people.captivity.title', key: 'people.captivity.body', vars: { name: ruler.name, ransom: ruler.captivity?.ransom } });
    expect(p.payload.choices?.map((c) => c.id)).toEqual(['wait', 'escape', 'bargain', 'sendWord', 'swearFealty']);
    expect(p.payload.choices?.[0]?.command).toEqual({ type: 'captivityAction', pendingId: p.id, choice: 'wait' });
    expect(r.events.some((e) => e.type === 'CaptureStarted')).toBe(true);
    expect(checkInvariants(r.state, w.env)).toEqual([]);
  });

  it('the duel module’s captorFactionId is accepted; a faction cannot capture its own', () => {
    const w = world();
    const r = build(w.state, w.env, (draft, ctx) => {
      const npc = makePerson(draft, ctx, { ageYears: 30, factionId: draft.player.factionId, location: { kind: 'settlement', id: draft.player.capitalId } });
      ctx.applyEffects([{ op: 'capture', charId: npc.id, captorFactionId: w.enemy }]);
      return npc.id;
    });
    expect(r.state.characters[r.value]!.captivity?.byFactionId).toBe(w.enemy);
    expect(() =>
      build(w.state, w.env, (draft, ctx) => ctx.applyEffects([{ op: 'capture', charId: draft.player.rulerId, byFactionId: draft.player.factionId }])),
    ).toThrow(/already serves/);
  });

  it('waiting pays the ransom when the steward can; the refuse policy never pays', () => {
    const w = world();
    const rich = build(w.state, w.env, (draft) => {
      draft.factions[draft.player.factionId]!.treasury = 20000;
    }).state;
    const c = captureRuler(rich, w.env, w.enemy).state;
    const ransom = c.characters[c.player.rulerId]!.captivity!.ransom;
    const enemyTreasury = c.factions[w.enemy]!.treasury;
    const refused = dispatch(dispatch(c, { type: 'setPolicy', policy: 'captivityRansom', value: 'refuse' }, w.env).state, { type: 'captivityAction', pendingId: c.pending!.id, choice: 'wait' }, w.env);
    expect(refused.state.characters[c.player.rulerId]!.captivity).toBeDefined();
    const paid = dispatch(c, { type: 'captivityAction', pendingId: c.pending!.id, choice: 'wait' }, w.env);
    expect(paid.error).toBeUndefined();
    const ruler = paid.state.characters[c.player.rulerId]!;
    expect(ruler.captivity).toBeUndefined();
    expect(ruler.location).toEqual({ kind: 'settlement', id: paid.state.player.capitalId });
    expect(paid.state.factions[paid.state.player.factionId]!.treasury).toBe(20000 - ransom);
    expect(paid.state.factions[w.enemy]!.treasury).toBe(enemyTreasury + ransom);
    expect(paid.state.pending).toBeNull();
    expect(paid.events.some((e) => e.type === 'Released' && (e as { reason: string }).reason === 'ransomed')).toBe(true);
    expect(checkInvariants(paid.state, w.env)).toEqual([]);
  });

  it('a failed escape tightens the guard and may injure; success frees the captive', () => {
    const w = world('escape');
    let s = captureRuler(w.state, w.env, w.enemy).state;
    const id = s.player.rulerId;
    let freed = false;
    let failures = 0;
    for (let week = 0; week < 60 && !freed; week++) {
      const p = s.pending!;
      expect(p.kind).toBe('captivity');
      const guard = s.characters[id]!.captivity!.guard;
      s = dispatch(s, { type: 'captivityAction', pendingId: p.id, choice: 'escape' }, w.env).state;
      const c = s.characters[id]!;
      if (!c.alive) break;
      if (!c.captivity) freed = true;
      else {
        failures++;
        expect(c.captivity.guard).toBe(guard + 1);
        s = advance(s, HOURS_PER_WEEK, w.env).state;
      }
    }
    expect(failures).toBeGreaterThan(0);
    expect(checkInvariants(s, w.env)).toEqual([]);
  });

  it('escape and bargain chances follow their checks; bargaining never drops below the floor', () => {
    const w = world('bargain');
    const r = build(w.state, w.env, (draft, ctx) => {
      const clumsy = makePerson(draft, ctx, { ageYears: 30, attributes: { agility: 1, wits: 1 } });
      const nimble = makePerson(draft, ctx, { ageYears: 30, attributes: { agility: 8, wits: 8 }, skills: { wildcraft: 6 } });
      const craven = makePerson(draft, ctx, { ageYears: 30, attributes: { agility: 8, wits: 8 }, skills: { wildcraft: 6 }, traits: ['craven'] });
      return { clumsy: escapeChance(clumsy, ctx), nimble: escapeChance(nimble, ctx), craven: escapeChance(craven, ctx) };
    });
    const t = content.tunables.people.captivity;
    expect(r.value.clumsy).toBe(t.escape.min);
    expect(r.value.nimble).toBeCloseTo(t.escape.base + t.escape.perPoint * (22 - t.escape.pivot));
    expect(r.value.craven).toBeCloseTo(r.value.nimble * 1.3);
    let s = build(captureRuler(w.state, w.env, w.enemy).state, w.env, (draft) => {
      const me = draft.characters[draft.player.rulerId]!;
      me.skills.speechcraft = 10;
      me.attributes.wits = 10;
    }).state;
    const id = s.player.rulerId;
    // Speechcraft 10 + (Wits 10 − pivot 4) / 2 = 13.
    expect(bargainChance(s.characters[id]!, { content, tunables: content.tunables })).toBeCloseTo(Math.min(t.bargain.max, t.bargain.base + t.bargain.perPoint * (13 - t.bargain.pivot)));
    const base = s.characters[id]!.captivity!.baseRansom;
    for (let i = 0; i < 12; i++) {
      s = dispatch(s, { type: 'captivityAction', pendingId: s.pending!.id, choice: 'bargain' }, w.env).state;
      s = advance(s, HOURS_PER_WEEK, w.env).state;
      if (!s.characters[id]!.captivity) break;
    }
    const rec = s.characters[id]!.captivity;
    if (rec) {
      expect(rec.ransom).toBeGreaterThanOrEqual(Math.round(base * t.bargainRansomFloor));
      expect(rec.ransom).toBeLessThan(base);
    }
  });

  it('send word once; swear fealty frees the ruler at the price of half the Renown', () => {
    const w = world();
    const c = build(captureRuler(w.state, w.env, w.enemy).state, w.env, (draft) => {
      draft.player.house.renown = 300;
    }).state;
    const sent = dispatch(c, { type: 'captivityAction', pendingId: c.pending!.id, choice: 'sendWord' }, w.env);
    expect(sent.events.some((e) => e.type === 'CaptiveSentWord')).toBe(true);
    const next = advance(sent.state, HOURS_PER_WEEK, w.env).state;
    if (next.pending?.kind === 'captivity') {
      expect(dispatch(next, { type: 'captivityAction', pendingId: next.pending.id, choice: 'sendWord' }, w.env).error?.code).toBe('alreadySent');
    }
    const sworn = dispatch(c, { type: 'captivityAction', pendingId: c.pending!.id, choice: 'swearFealty' }, w.env);
    expect(sworn.state.characters[c.player.rulerId]!.captivity).toBeUndefined();
    expect(sworn.state.player.house.renown).toBe(150);
    expect(sworn.events.some((e) => e.type === 'FealtySworn' && (e as { liegeFactionId: string }).liegeFactionId === w.enemy)).toBe(true);
  });

  it('releaseCharacter (ransom paid by others) frees a captive and sends them home', () => {
    const w = world();
    const made = build(w.state, w.env, (draft, ctx) => {
      const lt = makePerson(draft, ctx, { ageYears: 30, factionId: draft.player.factionId, role: { kind: 'lieutenant' } });
      ctx.applyEffects([{ op: 'capture', charId: lt.id, byFactionId: w.enemy }]);
      return lt.id;
    });
    expect(made.state.pending).toBeNull();
    const r = build(made.state, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'releaseCharacter', charId: made.value, reason: 'ransomed' }]));
    expect(r.state.characters[made.value]!.location).toEqual({ kind: 'settlement', id: r.state.player.capitalId });
    expect(r.state.people?.captiveIds).toEqual([]);
  });
});

describe('long captivity', () => {
  it('monthly Vigor checks wound about the expected share of captives; a second failure is mortal', () => {
    const w = world('vigor');
    const n = 1000;
    const made = build(w.state, w.env, (draft, ctx) => {
      const ids: CharId[] = [];
      for (let i = 0; i < n; i++) {
        const c = makePerson(draft, ctx, { ageYears: 30, attributes: { vigor: 4 }, factionId: draft.player.factionId, location: { kind: 'settlement', id: draft.player.capitalId } });
        ctx.applyEffects([{ op: 'capture', charId: c.id, byFactionId: w.enemy }]);
        ids.push(c.id);
      }
      return ids;
    });
    const s = inDraft(made.state, w.env, (draft, ctx) => monthlyCaptivity(draft, ctx)).state;
    const wounded = made.value.filter((id) => s.characters[id]!.health.wound === 'serious');
    const pFail = 1 - content.tunables.people.captivity.vigor.base;
    expect(Math.abs(wounded.length - n * pFail)).toBeLessThan(4 * Math.sqrt(n * pFail * (1 - pFail)));
    expect(checkInvariants(s, w.env)).toEqual([]);
    // Those who failed and fail again are mortally wounded; a success resets the count.
    const again = inDraft(s, w.env, (draft, ctx) => monthlyCaptivity(draft, ctx)).state;
    for (const id of wounded) {
      const c = again.characters[id]!;
      expect(c.captivity!.vigorFails).toBe(c.health.wound === 'mortal' ? 2 : 0);
    }
    expect(wounded.some((id) => again.characters[id]!.health.wound === 'mortal')).toBe(true);
  });

  it('hostages live at court (no Vigor checks) and go home once the houses are at peace again', () => {
    const w = world('hostage');
    const made = build(w.state, w.env, (draft, ctx) => {
      const kid = makePerson(draft, ctx, { ageYears: 10, factionId: draft.player.factionId, location: { kind: 'settlement', id: draft.player.capitalId } });
      ctx.applyEffects([
        { op: 'capture', charId: kid.id, byFactionId: w.enemy, hostage: true },
        { op: 'changeOpinion', a: draft.player.factionId, b: w.enemy, amount: -40, reason: 'test' },
      ]);
      return kid.id;
    });
    const held = inDraft(made.state, w.env, (draft, ctx) => monthlyCaptivity(draft, ctx)).state;
    expect(held.characters[made.value]!.captivity?.hostage).toBe(true);
    expect(held.characters[made.value]!.health.wound).toBe('none');
    const mended = build(held, w.env, (draft, ctx) => ctx.applyEffects([{ op: 'changeOpinion', a: draft.player.factionId, b: w.enemy, amount: 45, reason: 'test' }])).state;
    const home = inDraft(mended, w.env, (draft, ctx) => monthlyCaptivity(draft, ctx));
    expect(home.state.characters[made.value]!.location).toEqual({ kind: 'settlement', id: home.state.player.capitalId });
    expect(home.events.some((e) => e.type === 'Released' && e.reason === 'hostageReturned')).toBe(true);
    expect(checkInvariants(home.state, w.env)).toEqual([]);
  });

  it('the steward ransoms the house’s captive kin and lieutenants once word reaches home, if the policy allows', () => {
    const w = world('house-ransom');
    const made = build(w.state, w.env, (draft, ctx) => {
      draft.factions[draft.player.factionId]!.treasury = 5000;
      const lt = makePerson(draft, ctx, { ageYears: 30, factionId: draft.player.factionId, role: { kind: 'lieutenant' }, attributes: { agility: 1, wits: 1 } });
      ctx.applyEffects([{ op: 'capture', charId: lt.id, byFactionId: w.enemy }]);
      return lt.id;
    });
    const ransom = made.state.characters[made.value]!.captivity!.ransom;
    const enemyTreasury = made.state.factions[w.enemy]!.treasury;
    const refused = dispatch(made.state, { type: 'setPolicy', policy: 'captivityRansom', value: 'refuse' }, w.env).state;
    const later = (s: GameState) => advance(s, (content.tunables.people.captivity.houseRansomDays + 8) * HOURS_PER_DAY, w.env).state;
    const paid = later(made.state);
    expect(paid.characters[made.value]!.captivity).toBeUndefined();
    expect(paid.factions[paid.player.factionId]!.treasury).toBe(5000 - ransom);
    expect(paid.factions[w.enemy]!.treasury).toBe(enemyTreasury + ransom);
    expect(later(refused).characters[made.value]!.captivity?.byFactionId).toBe(w.enemy);
  });

  it('a child born in captivity stays with the mother, never escapes alone, and goes home with her', () => {
    const w = world('born-captive');
    const made = build(w.state, w.env, (draft, ctx) => {
      const mother = makePerson(draft, ctx, { ageYears: 25, sex: 'female', factionId: draft.player.factionId });
      ctx.applyEffects([{ op: 'capture', charId: mother.id, byFactionId: w.enemy }]);
      ctx.applyEffects([{ op: 'birth', motherId: mother.id }]);
      return mother.id;
    });
    const kid = made.state.characters[made.value]!.family.childIds[0]!;
    expect(made.state.characters[kid]!.captivity?.byFactionId).toBe(w.enemy);
    // A year of weekly passes under the refuse policy: the child neither escapes nor is ransomed apart from the mother.
    let s = dispatch(made.state, { type: 'setPolicy', policy: 'captivityRansom', value: 'refuse' }, w.env).state;
    s = build(s, w.env, (draft) => {
      draft.characters[made.value]!.attributes.agility = 1;
    }).state;
    for (let week = 0; week < 52; week++) {
      s = inDraft(s, w.env, (draft, ctx) => weeklyCaptivity(draft, ctx)).state;
      if (!s.characters[made.value]!.captivity) break;
      expect(s.characters[kid]!.captivity?.byFactionId).toBe(w.enemy);
    }
    const freed = build(s, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'releaseCharacter', charId: made.value, reason: 'ransomed' }])).state;
    expect(freed.characters[kid]!.captivity).toBeUndefined();
    expect(freed.characters[kid]!.location).toEqual(freed.characters[made.value]!.location);
    expect(checkInvariants(freed, w.env)).toEqual([]);
  });

  it('AI-held NPC captives escape or are ransomed by their kin in time', () => {
    const w = testWorld({ modules: [people], factions: 3, seed: 'npc-captives' });
    const [, f1, f2] = w.factionIds as [FactionId, FactionId, FactionId];
    const made = build(w.state, w.env, (draft, ctx) => {
      const ids: CharId[] = [];
      for (let i = 0; i < 50; i++) {
        const c = makePerson(draft, ctx, { ageYears: 30, factionId: f1 });
        ctx.applyEffects([{ op: 'capture', charId: c.id, byFactionId: f2 }]);
        ids.push(c.id);
      }
      return ids;
    });
    const s = advance(made.state, (content.tunables.people.captivity.npcRansomDays + 10) * HOURS_PER_DAY, w.env).state;
    for (const id of made.value) {
      const c = s.characters[id]!;
      if (c.alive) expect(c.captivity).toBeUndefined();
    }
    expect(checkInvariants(s, w.env)).toEqual([]);
  });

  it('Gentle Mode: the player’s ruler is captured rather than killed in a duel', () => {
    const w = testWorld({ modules: [people], factions: 2, options: { gentleMode: true } });
    const enemy = w.factionIds[1] as FactionId;
    const r = build(w.state, w.env, (draft, ctx) => ctx.applyEffects([{ op: 'kill', charId: draft.player.rulerId, cause: 'duel', byFactionId: enemy }]));
    const ruler = r.state.characters[r.state.player.rulerId]!;
    expect(ruler.alive).toBe(true);
    expect(ruler.captivity?.byFactionId).toBe(enemy);
  });

  it('a ruler who dies in captivity is succeeded and the stale decision is cleared', () => {
    const w = world();
    const house = testHouse(w.state, w.env, { rulerAge: 45, childAges: [20] });
    const c = captureRuler(house.state, w.env, w.enemy).state;
    expect(c.pending?.kind).toBe('captivity');
    const r = build(c, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'kill', charId: house.rulerId, cause: 'captivity' }]));
    expect(r.state.pending).toBeNull();
    expect(r.state.player.rulerId).toBe(house.childIds[0]);
    expect(r.state.people?.captiveIds).toEqual([]);
    expect(checkInvariants(r.state, w.env)).toEqual([]);
    expect(ransomFor(r.state, { balance: b, tunables: content.tunables }, r.state.characters[house.childIds[0]!]!)).toBeGreaterThan(0);
  });
});
