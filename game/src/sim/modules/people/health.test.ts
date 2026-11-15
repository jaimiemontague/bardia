import { getContent } from '@content/index';
import { dispatch } from '@sim/core/dispatch';
import { advance } from '@sim/core/scheduler';
import type { CharId, GameState } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { describe, expect, it } from 'vitest';
import { rollInjuryRow, woundCharacter } from './health';
import { build, makePerson, peopleTestEnv, peopleTestState } from './testing';
import { effectiveSkill } from './util';

const content = getContent();
const b = content.balance;
const env = peopleTestEnv();

function person(state: GameState, opts: Parameters<typeof makePerson>[2] = {}) {
  return build(state, env, (draft, ctx) => makePerson(draft, ctx, { ageYears: 30, factionId: draft.player.factionId, location: { kind: 'settlement', id: draft.player.capitalId }, ...opts }).id);
}

describe('wounds (§22.5)', () => {
  it('a lighter wound never replaces a worse one; the same wound twice is applied once', () => {
    const { state, value: id } = person(peopleTestState());
    const r = build(state, env, (draft, ctx) => {
      const c = draft.characters[id]!;
      woundCharacter(draft, ctx, c, 'serious', 'test');
      woundCharacter(draft, ctx, c, 'minor', 'test');
      woundCharacter(draft, ctx, c, 'serious', 'test');
    });
    const c = r.state.characters[id]!;
    expect(c.health.wound).toBe('serious');
    expect(c.health.hpPct).toBe(content.tunables.people.woundHpPct.serious);
    expect(c.health.woundUntilHour).toBe(r.state.time.hour + b.health.wounds.serious.recoveryDays * HOURS_PER_DAY);
    expect(r.events.filter((e) => e.type === 'CharacterWounded')).toHaveLength(1);
    expect(r.state.people?.woundedIds).toContain(id);
  });

  it('minor wounds heal after the recovery days at rest', () => {
    const { state, value: id } = person(peopleTestState());
    let s = build(state, env, (_d, ctx) => ctx.applyEffects([{ op: 'woundCharacter', charId: id, severity: 'minor' }])).state;
    s = advance(s, (b.health.wounds.minor.recoveryDays - 1) * HOURS_PER_DAY, env).state;
    expect(s.characters[id]!.health.wound).toBe('minor');
    const r = advance(s, 2 * HOURS_PER_DAY, env);
    expect(r.state.characters[id]!.health.wound).toBe('none');
    expect(r.state.characters[id]!.health.hpPct).toBe(100);
    expect(r.state.people?.woundedIds).not.toContain(id);
    expect(r.events.some((e) => e.type === 'CharacterHealed')).toBe(true);
  });

  it('the duel module’s parameter names (wound, injury as trait) are accepted', () => {
    const { state, value: id } = person(peopleTestState());
    const r = build(state, env, (_d, ctx) => {
      ctx.applyEffects([
        { op: 'woundCharacter', charId: id, wound: 'serious', injury: 'brokenHand', cause: 'duel' },
        { op: 'addTrait', charId: id, trait: 'lostEye' },
      ]);
    });
    const c = r.state.characters[id]!;
    expect(c.health.wound).toBe('serious');
    expect(c.health.injuries.map((i) => i.id)).toEqual(['brokenHand']);
    expect(c.traits).toContain('oneEyed');
  });

  it('a mortal wound kills about half of the stricken within the window; survivors are badly wounded', () => {
    const n = 400;
    const made = build(peopleTestState({ seed: 'mortal' }), env, (draft, ctx) => {
      const ids: CharId[] = [];
      for (let i = 0; i < n; i++) {
        const c = makePerson(draft, ctx, { ageYears: 30, location: { kind: 'settlement', id: draft.player.capitalId } });
        woundCharacter(draft, ctx, c, 'mortal', 'test');
        ids.push(c.id);
      }
      return ids;
    });
    const s = advance(made.state, (b.health.wounds.mortal.deathWindowDays + 2) * HOURS_PER_DAY, env).state;
    const dead = made.value.filter((id) => !s.characters[id]!.alive);
    const expected = n * b.health.wounds.mortal.deathChance;
    expect(Math.abs(dead.length - expected)).toBeLessThan(4 * Math.sqrt(n * 0.25));
    for (const id of made.value) {
      const c = s.characters[id]!;
      if (c.alive) expect(c.health.wound).toBe('serious');
      else expect(c.death?.cause).toBe('wounds');
    }
  });

  it('the Gray Queen’s Comb saves lieutenants once and speeds recovery', () => {
    let state = peopleTestState({ seed: 'comb' });
    state = build(state, env, (draft) => {
      draft.flags['relic.grayQueensComb'] = true;
    }).state;
    const made = build(state, env, (draft, ctx) => {
      const ids: CharId[] = [];
      for (let i = 0; i < 40; i++) {
        const c = makePerson(draft, ctx, { ageYears: 30, factionId: draft.player.factionId, role: { kind: 'lieutenant' }, location: { kind: 'settlement', id: draft.player.capitalId } });
        woundCharacter(draft, ctx, c, 'mortal', 'test');
        ids.push(c.id);
      }
      const m = makePerson(draft, ctx, { ageYears: 30, factionId: draft.player.factionId });
      woundCharacter(draft, ctx, m, 'minor', 'test');
      return { ids, minor: m.id };
    });
    expect(made.state.characters[made.value.minor]!.health.woundUntilHour).toBe(made.state.time.hour + Math.round(b.health.wounds.minor.recoveryDays * 0.5) * HOURS_PER_DAY);
    const s = advance(made.state, 12 * HOURS_PER_DAY, env).state;
    for (const id of made.value.ids) expect(s.characters[id]!.alive).toBe(true);
    expect(made.value.ids.some((id) => s.characters[id]!.combSaved)).toBe(true);
  });
});

describe('injuries (§22.5)', () => {
  it('the d100 table yields each row with its share', () => {
    const counts: Record<string, number> = {};
    const N = 20000;
    build(peopleTestState({ seed: 'injuries' }), env, (_d, ctx) => {
      for (let i = 0; i < N; i++) {
        const row = rollInjuryRow(ctx);
        counts[row.id] = (counts[row.id] ?? 0) + 1;
      }
    });
    let prev = 0;
    for (const row of b.health.injuryTable) {
      const p = (row.max - prev) / 100;
      prev = row.max;
      const sd = Math.sqrt(N * p * (1 - p));
      expect(Math.abs((counts[row.id] ?? 0) - N * p)).toBeLessThan(5 * sd);
    }
  });

  it('a broken hand lowers Melee for its days; a lost eye is the One-Eyed trait', () => {
    const { state, value: id } = person(peopleTestState(), { skills: { melee: 5 } });
    let s = build(state, env, (_d, ctx) => {
      ctx.applyEffects([
        { op: 'woundCharacter', charId: id, injury: 'brokenHand' },
        { op: 'woundCharacter', charId: id, injury: 'lostEye' },
      ]);
    }).state;
    const c = s.characters[id]!;
    expect(effectiveSkill(c, 'melee', content)).toBe(2);
    expect(c.traits).toContain('oneEyed');
    expect(effectiveSkill(c, 'archery', content)).toBe(0);
    s = advance(s, 61 * HOURS_PER_DAY, env).state;
    expect(s.characters[id]!.health.injuries).toEqual([]);
    expect(effectiveSkill(s.characters[id]!, 'melee', content)).toBe(5);
    expect(s.people?.woundedIds).not.toContain(id);
  });

  it('rejects unknown injuries and parameter-less wounds', () => {
    const { state, value: id } = person(peopleTestState());
    expect(() => build(state, env, (_d, ctx) => ctx.applyEffects([{ op: 'woundCharacter', charId: id, injury: 'dragonBite' }]))).toThrow(/unknown injury/);
    expect(() => build(state, env, (_d, ctx) => ctx.applyEffects([{ op: 'woundCharacter', charId: id }]))).toThrow(/woundCharacter/);
  });
});

describe('heal command', () => {
  it('a seer with Runecraft 6 saves a mortal wound for the top healing price; once per wound', () => {
    const env2 = peopleTestEnv();
    const base = peopleTestState();
    const made = build(base, env2, (draft, ctx) => {
      const at = draft.player.capitalId;
      const patient = makePerson(draft, ctx, { ageYears: 30, factionId: draft.player.factionId, location: { kind: 'settlement', id: at } });
      const seer = makePerson(draft, ctx, { ageYears: 40, factionId: draft.player.factionId, location: { kind: 'settlement', id: at }, skills: { runecraft: 6 } });
      woundCharacter(draft, ctx, patient, 'mortal', 'test');
      return { patient: patient.id, seer: seer.id };
    });
    const treasury = made.state.factions[made.state.player.factionId]!.treasury;
    const r = dispatch(made.state, { type: 'heal', charId: made.value.patient, method: 'seer' }, env2);
    expect(r.error).toBeUndefined();
    const c = r.state.characters[made.value.patient]!;
    expect(c.health.wound).toBe('serious');
    expect(c.health.woundUntilHour).toBe(r.state.time.hour + b.health.wounds.serious.recoveryDays * b.health.wounds.serious.herbsMult * HOURS_PER_DAY);
    expect(r.state.factions[r.state.player.factionId]!.treasury).toBe(treasury - b.health.healCost[1]);
    expect(dispatch(r.state, { type: 'heal', charId: made.value.patient, method: 'seer' }, env2).error?.code).toBe('alreadyTreated');
  });

  it('refuses without a skilled seer, a church, a wound or the silver', () => {
    const made = build(peopleTestState(), env, (draft, ctx) => {
      const at = draft.player.capitalId;
      const patient = makePerson(draft, ctx, { ageYears: 30, factionId: draft.player.factionId, location: { kind: 'settlement', id: at } });
      const hale = makePerson(draft, ctx, { ageYears: 30, factionId: draft.player.factionId, location: { kind: 'settlement', id: at } });
      woundCharacter(draft, ctx, patient, 'mortal', 'test');
      return { patient: patient.id, hale: hale.id };
    });
    expect(dispatch(made.state, { type: 'heal', charId: made.value.patient, method: 'seer' }, env).error?.code).toBe('noHealer');
    expect(dispatch(made.state, { type: 'heal', charId: made.value.patient, method: 'church' }, env).error?.code).toBe('cannotTreatMortal');
    expect(dispatch(made.state, { type: 'heal', charId: made.value.hale, method: 'seer' }, env).error?.code).toBe('notWounded');
    const minor = build(made.state, env, (draft, ctx) => {
      const c = draft.characters[made.value.hale]!;
      woundCharacter(draft, ctx, c, 'minor', 'test');
    }).state;
    expect(dispatch(minor, { type: 'heal', charId: made.value.hale, method: 'church' }, env).error?.code).toBe('noChurch');
    const lantern = build(minor, env, (draft) => {
      draft.settlements[draft.player.capitalId]!.faith = 'lantern';
    }).state;
    const ok = dispatch(lantern, { type: 'heal', charId: made.value.hale, method: 'church' }, env);
    expect(ok.error).toBeUndefined();
    expect(ok.state.factions[ok.state.player.factionId]!.treasury).toBe(lantern.factions[lantern.player.factionId]!.treasury - b.health.healCost[0]);
    const broke = build(lantern, env, (draft) => {
      draft.factions[draft.player.factionId]!.treasury = 0;
    }).state;
    const poor = build(broke, env, (draft, ctx) => {
      const c = draft.characters[made.value.patient]!;
      c.health.wound = 'none';
      woundCharacter(draft, ctx, c, 'serious', 'test');
    }).state;
    expect(dispatch(poor, { type: 'heal', charId: made.value.patient, method: 'church' }, env).error?.code).toBe('cannotAfford');
  });
});
