import { getContent } from '@content/index';
import { missingLocaleKeys } from '@content/locales/index';
import { createSimEnv, checkInvariants } from '@sim/core/env';
import { createNewGameState, upgradeLoadedState } from '@sim/core/lifecycle';
import type { SimContext } from '@sim/core/module';
import { advance } from '@sim/core/scheduler';
import type { CharId, FactionId, GameState, SettlementId } from '@sim/core/state';
import { HOURS_PER_DAY, HOURS_PER_MONTH, HOURS_PER_YEAR } from '@sim/core/time';
import { inDraft, missingEventKeys, testWorld } from '@sim/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { module as people } from './index';
import { build, linkParent, linkSpouses, makePerson, peopleTestEnv, peopleTestState, testHouse } from './testing';

/** A living population: couples with children, widowed elders, lieutenants, NPC households. */
function populate(draft: GameState, ctx: SimContext, households: number, factions: readonly FactionId[], homes: readonly SettlementId[]): CharId[] {
  const rng = ctx.rng('test:populate');
  const ids: CharId[] = [];
  for (let i = 0; i < households; i++) {
    const factionId = factions[i % factions.length] as FactionId;
    const home = homes[i % homes.length] as SettlementId;
    const at = { kind: 'settlement' as const, id: home };
    const age = rng.int(18, 60);
    const wife = makePerson(draft, ctx, { ageYears: age, sex: 'female', factionId, location: at, attributes: { vigor: rng.int(2, 7) } });
    const husband = makePerson(draft, ctx, { ageYears: age + rng.int(0, 8), sex: 'male', factionId, location: at, traits: rng.chance(0.3) ? ['brave'] : [] });
    linkSpouses(wife, husband);
    ids.push(wife.id, husband.id);
    const kids = Math.min(rng.int(0, 4), Math.max(0, age - 17));
    for (let k = 0; k < kids; k++) {
      const kid = makePerson(draft, ctx, { ageYears: rng.int(0, Math.min(15, age - 17)), factionId, location: at });
      linkParent(wife, kid);
      linkParent(husband, kid);
      ids.push(kid.id);
    }
    if (i % 5 === 0) {
      const elder = makePerson(draft, ctx, { ageYears: rng.int(60, 85), factionId, location: at });
      linkParent(elder, husband);
      ids.push(elder.id);
    }
    if (i % 7 === 0 && factionId === draft.player.factionId) {
      ids.push(makePerson(draft, ctx, { ageYears: rng.int(20, 40), factionId, role: { kind: 'lieutenant' }, location: at, loyalty: 60 }).id);
    }
  }
  return ids;
}

/** A populated three-faction world whose ruler (30) has a spouse and two children, so successions happen. */
function populatedWorld(seed: string, households: number) {
  const w = testWorld({ modules: [people], factions: 3, seed });
  const house = testHouse(w.state, w.env, { rulerAge: 30, childAges: [9, 4] });
  const homes = Object.values(w.settlementIds).flat();
  const r = build(house.state, w.env, (draft, ctx) => populate(draft, ctx, households, w.factionIds, homes));
  return { ...w, state: r.state, ids: [house.rulerId, house.spouseId, ...house.childIds, ...r.value] };
}

/** Advances, resolving people decisions the way an idle player would (first options, regency 'play'). */
function run(state: GameState, env: ReturnType<typeof peopleTestEnv>, hours: number): { state: GameState; events: ReturnType<typeof advance>['events'] } {
  let s = state;
  const events: ReturnType<typeof advance>['events'] = [];
  let left = hours;
  let guard = 0;
  while (left > 0 && guard++ < 10000) {
    const r = advance(s, left, env);
    events.push(...r.events);
    s = r.state;
    left -= r.hoursAdvanced;
    const p = s.pending;
    if (!p) continue;
    const env2 = env;
    const resolve = (cmd: Parameters<typeof import('@sim/core/dispatch').dispatch>[1]) => {
      const d = dispatchCmd(s, cmd, env2);
      events.push(...d.events);
      s = d.state;
    };
    if (p.kind === 'featChoice') resolve({ type: 'chooseFeat', pendingId: p.id, featId: p.payload.options[0]! });
    else if (p.kind === 'succession') resolve({ type: 'designateHeir', pendingId: p.id, heirId: p.payload.heirId!, regency: 'play' });
    else if (p.kind === 'captivity') resolve({ type: 'captivityAction', pendingId: p.id, choice: 'escape' });
    else break;
  }
  return { state: s, events };
}

import { dispatch as dispatchCmd } from '@sim/core/dispatch';

/** Timing budgets hold as written in a dedicated run (BARDIA_STRICT_PERF=1, e.g. `npm run perf`); the parallel full suite gets slack. */
const PERF_SLACK = process.env['BARDIA_STRICT_PERF'] === '1' ? 1 : 4;

describe('people module: whole-system properties', () => {
  it('is deterministic: same seed and inputs give identical state and events', () => {
    const a = populatedWorld('det', 60);
    const b = populatedWorld('det', 60);
    const ra = run(a.state, a.env, 2 * HOURS_PER_YEAR);
    const rb = run(b.state, b.env, 2 * HOURS_PER_YEAR);
    expect(JSON.stringify(ra.state)).toBe(JSON.stringify(rb.state));
    expect(JSON.stringify(ra.events)).toBe(JSON.stringify(rb.events));
    const c = populatedWorld('det-other', 60);
    expect(JSON.stringify(run(c.state, c.env, 2 * HOURS_PER_YEAR).state.characters)).not.toBe(JSON.stringify(ra.state.characters));
  });

  it('advance(a) then advance(b) equals advance(a + b): the replay log merges consecutive advances', () => {
    const populated = populatedWorld('chunks', 80);
    const enemy = populated.factionIds[1] as FactionId;
    // Wounds (incl. mortal), injuries and captives, so the index-driven daily/weekly/monthly passes run too.
    const prepared = build(populated.state, populated.env, (draft, ctx) => {
      const adults = populated.ids.filter((id) => draft.characters[id]!.birthHour < -20 * HOURS_PER_YEAR && id !== draft.player.rulerId);
      adults.slice(0, 24).forEach((id, i) => {
        if (i % 4 === 0) ctx.applyEffects([{ op: 'woundCharacter', charId: id, severity: 'mortal' }]);
        else if (i % 4 === 1) ctx.applyEffects([{ op: 'woundCharacter', charId: id, severity: 'serious', rollInjury: true }]);
        else if (draft.characters[id]!.factionId !== enemy) ctx.applyEffects([{ op: 'capture', charId: id, byFactionId: enemy }]);
      });
    });
    const w = { ...populated, state: prepared.state };
    const total = 2 * HOURS_PER_YEAR + 5 * HOURS_PER_DAY + 7;
    const whole = run(w.state, w.env, total).state;
    // Uneven pieces: hours, days, a month boundary cut mid-way, a year in one go.
    const pieces = [5, 3 * HOURS_PER_DAY, HOURS_PER_MONTH + 11, 17 * HOURS_PER_DAY, HOURS_PER_YEAR];
    let s = w.state;
    let left = total;
    for (let i = 0; left > 0; i++) {
      const h = Math.min(left, pieces[i % pieces.length]!);
      s = run(s, w.env, h).state;
      left -= h;
    }
    expect(JSON.stringify(s)).toBe(JSON.stringify(whole));
  });

  it('keeps every invariant over a long run; every emitted text key has a string', () => {
    const w = populatedWorld('long', 150);
    let s = w.state;
    expect(checkInvariants(s, w.env)).toEqual([]);
    let births = 0;
    let deaths = 0;
    for (let year = 0; year < 6; year++) {
      const r = run(s, w.env, HOURS_PER_YEAR);
      s = r.state;
      births += r.events.filter((e) => e.type === 'Birth').length;
      deaths += r.events.filter((e) => e.type === 'Death').length;
      expect(checkInvariants(s, w.env)).toEqual([]);
      expect(missingEventKeys(r.events)).toEqual([]);
    }
    expect(births).toBeGreaterThan(20);
    expect(deaths).toBeGreaterThan(5);
    // Every faction still has a living ruler; every settlement a living leader.
    for (const f of Object.values(s.factions)) {
      if (f.id === s.player.factionId && s.people?.houseFallen) continue;
      expect(s.characters[f.rulerId]?.alive).toBe(true);
    }
    // A fallen house is game over: its hall keeps its last lord.
    for (const st of Object.values(s.settlements)) {
      if (st.factionId === s.player.factionId && s.people?.houseFallen) continue;
      expect(s.characters[st.leaderId]?.alive).toBe(true);
    }
  });

  it('initialises on a campaign already under way (a save made before the module existed)', () => {
    const bare = createSimEnv({ modules: [] });
    const old = createNewGameState({ seed: 'old-save' }, bare).state;
    const prepared = inDraft(old, bare, (draft) => {
      const ruler = draft.characters[draft.player.rulerId]!;
      ruler.health.wound = 'serious';
      ruler.health.woundUntilHour = 100;
    }).state;
    const env = peopleTestEnv();
    const up = upgradeLoadedState(prepared, env).state;
    expect(up.meta.moduleVersions.people).toBe(people.version);
    expect(up.people?.woundedIds).toEqual([up.player.rulerId]);
    expect(up.player.policies.levelUpPoints).toBe('auto');
    expect(up.characters[up.player.rulerId]!.agedTo).toBe(16);
    expect(up.characters[up.player.rulerId]!.title).toBe('people.title.1');
    expect(checkInvariants(up, env)).toEqual([]);
  });

  it('survives random sequences of character effects without breaking an invariant', () => {
    const w = populatedWorld('fuzz', 12);
    const ids = w.ids;
    const enemy = w.factionIds[1] as FactionId;
    const opArb = fc.oneof(
      fc.record({ k: fc.constant('wound' as const), i: fc.nat(ids.length - 1), s: fc.constantFrom('minor' as const, 'serious' as const, 'mortal' as const) }),
      fc.record({ k: fc.constant('injury' as const), i: fc.nat(ids.length - 1) }),
      fc.record({ k: fc.constant('kill' as const), i: fc.nat(ids.length - 1) }),
      fc.record({ k: fc.constant('capture' as const), i: fc.nat(ids.length - 1) }),
      fc.record({ k: fc.constant('release' as const), i: fc.nat(ids.length - 1) }),
      fc.record({ k: fc.constant('xp' as const), i: fc.nat(ids.length - 1), n: fc.integer({ min: 1, max: 3000 }) }),
      fc.record({ k: fc.constant('birth' as const), i: fc.nat(ids.length - 1) }),
      fc.record({ k: fc.constant('days' as const), n: fc.integer({ min: 1, max: 40 }) }),
    );
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 25 }), (ops) => {
        let s = w.state;
        for (const op of ops) {
          if (op.k === 'days') {
            s = run(s, w.env, op.n * HOURS_PER_DAY).state;
            continue;
          }
          const id = ids[op.i] as CharId;
          const c = s.characters[id];
          if (!c?.alive) continue;
          s = build(s, w.env, (draft, ctx) => {
            switch (op.k) {
              case 'wound':
                ctx.applyEffects([{ op: 'woundCharacter', charId: id, severity: op.s }]);
                break;
              case 'injury':
                ctx.applyEffects([{ op: 'woundCharacter', charId: id, rollInjury: true }]);
                break;
              case 'kill':
                ctx.applyEffects([{ op: 'kill', charId: id, cause: 'battle' }]);
                break;
              case 'capture':
                if (draft.characters[id]!.factionId !== enemy) ctx.applyEffects([{ op: 'capture', charId: id, byFactionId: enemy }]);
                break;
              case 'release':
                ctx.applyEffects([{ op: 'releaseCharacter', charId: id }]);
                break;
              case 'xp':
                ctx.applyEffects([{ op: 'grantXp', charId: id, amount: op.n }]);
                break;
              case 'birth':
                if (draft.characters[id]!.sex === 'female') ctx.applyEffects([{ op: 'birth', motherId: id }]);
                break;
            }
          }).state;
          if (s.pending?.kind === 'featChoice') s = dispatchCmd(s, { type: 'chooseFeat', pendingId: s.pending.id, featId: s.pending.payload.options[0]! }, w.env).state;
          if (s.pending?.kind === 'succession') s = dispatchCmd(s, { type: 'designateHeir', pendingId: s.pending.id, heirId: s.pending.payload.heirId! }, w.env).state;
          if (s.pending?.kind === 'captivity') s = dispatchCmd(s, { type: 'captivityAction', pendingId: s.pending.id, choice: 'wait' }, w.env).state;
          expect(checkInvariants(s, w.env)).toEqual([]);
        }
      }),
      { numRuns: 25, seed: 4242 },
    );
  });
});

describe('content references', () => {
  it('people tunables name only existing traits and feats, and every feat has an affinity', () => {
    const content = getContent();
    const t = content.tunables.people;
    for (const trait of [...Object.values(t.educationTraitBySkill), t.fosteredAbroadTrait]) expect(Object.hasOwn(content.traits, trait)).toBe(true);
    expect(Object.keys(t.featAffinity).sort()).toEqual(Object.keys(content.feats).sort());
    for (const row of content.balance.health.injuryTable) if (row.trait !== undefined) expect(Object.hasOwn(content.traits, row.trait)).toBe(true);
    expect(missingLocaleKeys(content.balance.health.injuryTable.map((r) => `people.injury.${r.id}`).filter((k) => k !== 'people.injury.none'))).toEqual([]);
  });
});

describe('performance (ARCHITECTURE §7)', () => {
  function bigState(n: number) {
    const env = peopleTestEnv();
    const r = build(peopleTestState({ seed: 'perf' }), env, (draft, ctx) => {
      const rng = ctx.rng('test:perf');
      const at = { kind: 'settlement' as const, id: draft.player.capitalId };
      for (let i = 0; i < n / 2; i++) {
        const wife = makePerson(draft, ctx, { ageYears: rng.int(0, 70), sex: 'female', location: at });
        const husband = makePerson(draft, ctx, { ageYears: rng.int(16, 70), sex: 'male', location: at });
        if (rng.chance(0.5) && wife.birthHour <= -16 * HOURS_PER_YEAR) linkSpouses(wife, husband);
      }
    });
    // Start mid-year, away from any month boundary.
    const s = advance(r.state, 40 * HOURS_PER_DAY + 3, env).state;
    return { env, state: s };
  }

  function median(xs: number[]): number {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] as number;
  }

  it('the daily pass over 2,000 characters takes well under 1 ms', () => {
    const { env, state } = bigState(2000);
    expect(Object.keys(state.characters).length).toBeGreaterThanOrEqual(2000);
    const daily = people.systems!.daily!;
    const times: number[] = [];
    inDraft(state, env, (draft, ctx) => {
      for (let i = 0; i < 60; i++) daily(draft, ctx); // warm-up
      for (let i = 0; i < 201; i++) {
        const t0 = performance.now();
        daily(draft, ctx);
        times.push(performance.now() - t0);
      }
    });
    const m = median(times);
    console.log(`people daily pass, 2000 characters: median ${(m * 1000).toFixed(1)} µs`);
    expect(m).toBeLessThan(0.5);
  });

  it('a whole game day stays within budget and a month boundary within 10 ms', () => {
    const { env, state } = bigState(2000);
    const dayTimes: number[] = [];
    let s = state;
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now();
      s = advance(s, HOURS_PER_DAY, env).state;
      dayTimes.push(performance.now() - t0);
    }
    const monthTimes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const toBoundary = HOURS_PER_MONTH - (s.time.hour % HOURS_PER_MONTH);
      s = advance(s, toBoundary - 1, env).state;
      const t0 = performance.now();
      s = advance(s, 1, env).state;
      monthTimes.push(performance.now() - t0);
    }
    console.log(`people: day median ${median(dayTimes).toFixed(3)} ms, month boundary median ${median(monthTimes).toFixed(3)} ms`);
    expect(median(dayTimes)).toBeLessThan(2 * PERF_SLACK);
    expect(median(monthTimes)).toBeLessThan(10 * PERF_SLACK);
  });
});
