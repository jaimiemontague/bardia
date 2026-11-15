import { describe, expect, it } from 'vitest';
import { inDraft, testEnv, testState } from '../testing';
import { z } from 'zod';
import { CORE_EFFECTS, EffectError, validateEffects, type EffectData } from './effects';
import { createFleet, createShip } from './factory';
import { relationKey } from './factory';
import type { ConditionEvalContext, EffectHandlers, EffectSchemas, SimModule } from './module';
import type { FactionId, GameState } from './state';

function apply(state: GameState, effects: EffectData[], modules: SimModule[] = []) {
  return inDraft(state, testEnv(modules), (_d, ctx) => ctx.applyEffects(effects));
}

describe('core effects', () => {
  it('addSilver: player treasury by default, floors at 0; fleets and settlements', () => {
    const s = testState();
    const fac = s.player.factionId;
    const before = s.factions[fac]!.treasury;
    expect(apply(s, [{ op: 'addSilver', amount: 250 }]).state.factions[fac]!.treasury).toBe(before + 250);
    expect(apply(s, [{ op: 'addSilver', amount: -1e9 }]).state.factions[fac]!.treasury).toBe(0);
    expect(apply(s, [{ op: 'addSilver', amount: 40, settlementId: s.player.capitalId }]).state.settlements[s.player.capitalId]!.silver).toBe(40);
    expect(() => apply(s, [{ op: 'addSilver', amount: 'lots' }])).toThrow(EffectError);
    expect(() => apply(s, [{ op: 'addSilver', amount: 1, fleetId: 'flt_404' }])).toThrow(/unknown fleet/);
  });

  it('addGoods into a fleet or a market', () => {
    const env = testEnv();
    const base = inDraft(testState(), env, (d) => {
      d.markets[d.player.capitalId] = { stock: {}, target: {}, prod: {}, cons: {}, lastUpdate: 0 };
    }).state;
    const r = apply(base, [{ op: 'addGoods', good: 'iron', tons: 3 }, { op: 'addGoods', good: 'iron', tons: -1 }]);
    expect(r.state.markets[base.player.capitalId]!.stock.iron).toBe(2);
  });

  it('rations go to fleet.rations (a count), never to fleet cargo; addRations adds by count', () => {
    const env = testEnv();
    const base = inDraft(testState(), env, (d, ctx) => {
      const ship = createShip(d, ctx, { type: 'knarr', ownerId: d.player.factionId });
      const fleet = createFleet(d, ctx, { ownerId: d.player.factionId, leaderId: d.player.rulerId, pos: { x: 0, y: 0 }, shipIds: [ship.id], rations: 100 });
      d.player.expeditionFleetId = fleet.id;
    }).state;
    const fleetId = base.player.expeditionFleetId!;
    const r = apply(base, [
      { op: 'addGoods', good: 'rations', tons: 2 },
      { op: 'addGoods', good: 'salt', tons: 1.5 },
      { op: 'addRations', count: 250 },
      { op: 'addRations', count: -10000, fleetId },
    ]);
    const fleet = r.state.fleets[fleetId]!;
    expect(fleet.rations).toBe(0);
    expect(fleet.cargo).toEqual({ salt: 1.5 });
    const r2 = apply(base, [{ op: 'addGoods', good: 'rations', tons: 0.5 }]);
    expect(r2.state.fleets[fleetId]!.rations).toBe(100 + 0.5 * testEnv().balance.economy.rationsPerTon);
    expect(() => apply(testState(), [{ op: 'addRations', count: 5 }])).toThrow(/no expedition fleet/);
  });

  it('changeOpinion stacks same-reason modifiers and clamps opinion', () => {
    const s = testState();
    const a: FactionId = s.player.factionId;
    const r = apply(s, [
      { op: 'changeOpinion', a, b: 'fac_999', amount: 30, reason: 'gift', decayPerMonth: 2 },
      { op: 'changeOpinion', a: 'fac_999', b: a, amount: 30, reason: 'gift', decayPerMonth: 2 },
      { op: 'changeOpinion', a, b: 'fac_999', amount: 90, reason: 'oath' },
    ]);
    const rel = r.state.relations[relationKey(a, 'fac_999')]!;
    expect(rel.modifiers).toEqual([
      { reason: 'gift', value: 60, decayPerMonth: 2 },
      { reason: 'oath', value: 90, decayPerMonth: 0 },
    ]);
    expect(rel.opinion).toBe(100);
    expect(r.events.filter((e) => e.type === 'OpinionChanged')).toHaveLength(3);
  });

  it('changeLoyalty for holdings and characters, clamped 0..100', () => {
    const s = testState();
    const r = apply(s, [{ op: 'changeLoyalty', settlementId: s.player.capitalId, amount: 500 }]);
    expect(r.state.settlements[s.player.capitalId]!.holding!.loyalty).toBe(100);
    const r2 = apply(s, [{ op: 'changeLoyalty', charId: s.player.rulerId, amount: -500 }]);
    expect(r2.state.characters[s.player.rulerId]!.loyalty).toBe(0);
    expect(() => apply(s, [{ op: 'changeLoyalty', amount: 1 }])).toThrow(EffectError);
  });

  it('changeRenown/Honor/Dread/Favor respect balance ranges', () => {
    const s = testState();
    const r = apply(s, [
      { op: 'changeRenown', amount: 75 },
      { op: 'changeHonor', amount: -500 },
      { op: 'changeDread', amount: 120 },
      { op: 'changeFavor', god: 'saltha', amount: 100 },
    ]);
    const h = r.state.player.house;
    expect(h.renown).toBe(75);
    expect(h.lastRenownGainHour).toBe(0);
    expect(h.honor).toBe(-100);
    expect(h.dread).toBe(100);
    expect(h.favor.saltha).toBe(50);
    expect(r.events.filter((e) => e.type === 'StandingChanged')).toHaveLength(4);
    expect(() => apply(s, [{ op: 'changeFavor', god: 'thor', amount: 1 }])).toThrow(/invalid 'changeFavor' effect: god/);
  });

  it('flags, chronicle, notify, narrate, codex, scheduleStorylet', () => {
    const s = testState();
    const r = apply(s, [
      { op: 'setFlag', flag: 'metTheSeer' },
      { op: 'setFlag', flag: 'count', value: 3 },
      { op: 'addChronicle', kind: 'raid', textKey: 'chron.raid', importance: 3, vars: { place: 'Gullhythe' }, refs: ['set_1'] },
      { op: 'notify', key: 'note.x', priority: 'critical' },
      { op: 'narrate', key: 'line.y', voice: 'hirdmaster' },
      { op: 'unlockCodex', topic: 'storms' },
      { op: 'unlockCodex', topic: 'storms' },
      { op: 'scheduleStorylet', storyletId: 'oldAgeWarning', inDays: 10 },
    ]);
    expect(r.state.flags).toMatchObject({ metTheSeer: true, count: 3 });
    expect(r.state.chronicle.at(-1)).toEqual({ hour: 0, kind: 'raid', importance: 3, textKey: 'chron.raid', vars: { place: 'Gullhythe' }, refs: ['set_1'] });
    expect(r.state.codex.unlocked).toEqual({ storms: 0 });
    expect(r.state.storylets.scheduled).toEqual([{ storyletId: 'oldAgeWarning', atHour: 240 }]);
    expect(r.events.map((e) => e.type)).toEqual(['ChronicleAdded', 'Notification', 'NarrationLine', 'CodexUnlocked']);
  });

  it('prototype-member keys are handled as plain keys or rejected', () => {
    const s = testState();
    const r = apply(s, [{ op: 'unlockCodex', topic: 'toString' }]);
    expect(r.state.codex.unlocked).toEqual({ toString: 0 });
    expect(() => apply(s, [{ op: 'unlockCodex', topic: 'constructor' }])).toThrow(EffectError);
    expect(() => apply(s, [{ op: 'setFlag', flag: '__proto__' }])).toThrow(EffectError);
    // Handlers check own keys even when called without schema validation.
    expect(() => inDraft(s, testEnv(), (d, ctx) => CORE_EFFECTS.changeFavor!(d, { op: 'changeFavor', god: 'toString' as never, amount: 1 }, ctx))).toThrow(/unknown god/);
  });

  it('validateEffects checks ops and parameters against the registry (for content loading)', () => {
    const env = testEnv();
    expect(validateEffects(env, [{ op: 'addSilver', amount: 200 }, { op: 'changeFavor', god: 'saltha', amount: 2 }])).toEqual([]);
    const issues = validateEffects(
      env,
      [{ op: 'addSilver', amount: 'lots' }, { op: 'summonGiant' }, { noOp: true }, { op: 'addGoods', good: 'gold', tons: 1 }, { op: 'notify', key: 'k', extra: 1 }],
      'storylet x',
    );
    expect(issues).toHaveLength(5);
    expect(issues[0]).toMatch(/^storylet x\[0\] \(addSilver\): amount/);
    expect(issues[1]).toMatch(/unknown effect op 'summonGiant'/);
    expect(issues[2]).toMatch(/without op/);
  });

  it('module effect schemas validate parameters and hand the parsed output to the handler', () => {
    let seen: unknown;
    const mod: SimModule = {
      id: 'military',
      order: 90,
      effects: { testAddMen: (_d: GameState, e: unknown) => void (seen = e) } as unknown as EffectHandlers,
      effectSchemas: {
        testAddMen: z.object({ op: z.literal('testAddMen'), unit: z.string(), count: z.number().int().positive().default(10) }).strict(),
      } as unknown as EffectSchemas,
    };
    const env = testEnv([mod]);
    expect(validateEffects(env, [{ op: 'testAddMen', unit: 'bondi', count: -1 }])).toHaveLength(1);
    apply(testState(), [{ op: 'testAddMen', unit: 'bondi' }], [mod]);
    expect(seen).toEqual({ op: 'testAddMen', unit: 'bondi', count: 10 });
    expect(() => apply(testState(), [{ op: 'testAddMen', unit: 3 }], [mod])).toThrow(/invalid 'testAddMen' effect/);
  });

  it('core condition functions: flag, season, opinion', () => {
    const env = testEnv();
    const state = apply(testState(), [
      { op: 'setFlag', flag: 'metTheSeer' },
      { op: 'changeOpinion', a: 'fac_1', b: 'fac_2', amount: 30 },
    ]).state;
    const ctx: ConditionEvalContext = { state, env, scope: {} };
    const call = (name: string, args: (string | number)[]) => env.conditionFns.get(name)!.fn.evaluate(args, ctx);
    expect(call('flag', ['metTheSeer'])).toBe(true);
    expect(call('flag', ['nope'])).toBe(false);
    expect(call('flag', ['toString'])).toBe(false);
    expect(call('season', [])).toBe('spring');
    expect(call('opinion', ['fac_2', 'fac_1'])).toBe(30);
    expect(call('opinion', ['fac_1', 'fac_9'])).toBe(0);
    expect(env.conditionFns.get('flag')!.fn.args.safeParse(['x']).success).toBe(true);
    expect(env.conditionFns.get('flag')!.fn.args.safeParse([1, 2]).success).toBe(false);
  });

  it('unknown ops throw; module-registered ops are routed to their module', () => {
    const s = testState();
    expect(() => apply(s, [{ op: 'summonGiant' }])).toThrow(/unknown effect op 'summonGiant'/);
    expect(() => apply(s, [{ notAnOp: 1 } as unknown as EffectData])).toThrow(/without op/);
    const mod: SimModule = {
      id: 'military',
      order: 90,
      effects: {
        addMen: (draft: GameState, e: { unit: string; count: number }, ctx: { moduleId: string }) => {
          const g = draft.settlements[draft.player.capitalId]!.garrison;
          g[e.unit] = (g[e.unit] ?? 0) + e.count;
          draft.flags.ranAs = ctx.moduleId;
        },
      } as unknown as EffectHandlers,
    };
    const r = apply(s, [{ op: 'addMen', unit: 'huscarls', count: 5 }], [mod]);
    expect(r.state.settlements[s.player.capitalId]!.garrison.huscarls).toBe(5);
    expect(r.state.flags.ranAs).toBe('military');
  });
});
