/**
 * Proves the parallel-safe extension pattern: a module adds state fields, a command, an event,
 * an effect op, a pending kind and an id prefix purely through module augmentation — no kernel
 * file is edited — and everything is fully typed and routed at runtime.
 *
 * NOTE: augmentations are global to the TypeScript program, so test-only names are prefixed
 * `test`/`Test` and all added fields are optional.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { inDraft, testEnv, testState } from '../testing';
import type { Command, CommandOf } from '@sim/core/commands';
import { dispatch } from '@sim/core/dispatch';
import type { SimEvent } from '@sim/core/events';
import type { SimModule } from '@sim/core/module';
import { advance } from '@sim/core/scheduler';
import type { RelicDef, StoryletDef } from '@sim/core/defs';
import { validateEffects } from '@sim/core/effects';
import type { EntityLinkKind } from '@sim/core/events';
import type {
  CharacterLocation,
  FactionKind,
  PactKind,
  PendingDecision,
  RelicId,
  Settlement,
  SettlementId,
  SiteKind,
  StoryletTrigger,
} from '@sim/core/state';

declare module '@sim/core/state' {
  interface Settlement {
    testSiege?: { day: number; besiegerId: string };
  }
  interface GameState {
    testLedger?: Record<string, number>;
  }
  interface PendingPayloads {
    testPrompt: { question: string };
  }
  // Vocabulary registries: a module adds members without editing state.ts.
  interface PactKinds {
    testOath: true;
  }
  interface FactionKinds {
    testHorde: true;
  }
  interface SiteKinds {
    testCairn: true;
  }
  interface StoryletTriggers {
    testOnFeast: true;
  }
  interface CharacterLocations {
    testDelve: { siteId: string; depth: number };
  }
}
declare module '@sim/core/events' {
  interface EntityLinkKinds {
    testLedger: true;
  }
}
declare module '@sim/core/commands' {
  interface CommandMap {
    testBesiege: { settlementId: SettlementId };
  }
}
declare module '@sim/core/events' {
  interface EventMap {
    TestSiegeDay: { settlementId: SettlementId; day: number };
  }
}
declare module '@sim/core/effects' {
  interface EffectMap {
    testRecord: { key: string; amount: number };
  }
}
declare module '@sim/core/ids' {
  interface IdPrefixMap {
    tst: `tst_${string}`;
  }
}

const siegeModule: SimModule = {
  id: 'testSieges',
  order: 45,
  version: 1,
  init(draft) {
    draft.testLedger = {};
  },
  handlers: {
    testBesiege(draft, cmd, ctx) {
      expectTypeOf(cmd).toEqualTypeOf<CommandOf<'testBesiege'>>();
      const s = draft.settlements[cmd.settlementId];
      if (!s) return;
      s.testSiege = { day: 0, besiegerId: ctx.newId('tst') };
    },
  },
  systems: {
    daily(draft, ctx) {
      for (const s of Object.values(draft.settlements)) {
        if (!s.testSiege) continue;
        s.testSiege.day += 1;
        ctx.emit({ type: 'TestSiegeDay', settlementId: s.id, day: s.testSiege.day });
        ctx.applyEffects([{ op: 'testRecord', key: s.id, amount: 1 }]);
        if (s.testSiege.day === 3) ctx.pend({ kind: 'testPrompt', payload: { question: 'Storm the walls?' } });
      }
    },
  },
  effects: {
    testRecord(draft, e) {
      draft.testLedger ??= {};
      draft.testLedger[e.key] = (draft.testLedger[e.key] ?? 0) + e.amount;
    },
  },
};

describe('module augmentation pattern', () => {
  it('augmented types flow through Command, SimEvent, PendingDecision and entity interfaces', () => {
    expectTypeOf<Extract<Command, { type: 'testBesiege' }>>().toEqualTypeOf<{ type: 'testBesiege' } & { settlementId: SettlementId }>();
    expectTypeOf<Extract<SimEvent, { type: 'TestSiegeDay' }>['day']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<PendingDecision, { kind: 'testPrompt' }>['payload']>().toEqualTypeOf<{ question: string }>();
    expectTypeOf<Settlement['testSiege']>().toEqualTypeOf<{ day: number; besiegerId: string } | undefined>();
    // Core declarations are still present alongside the augmentation.
    expectTypeOf<Extract<Command, { type: 'wait' }>>().not.toBeNever();
  });

  it('vocabulary registries accept augmented members alongside the core ones', () => {
    expectTypeOf<'testOath'>().toMatchTypeOf<PactKind>();
    expectTypeOf<'truce'>().toMatchTypeOf<PactKind>();
    expectTypeOf<'testHorde'>().toMatchTypeOf<FactionKind>();
    expectTypeOf<'testCairn'>().toMatchTypeOf<SiteKind>();
    expectTypeOf<'testOnFeast'>().toMatchTypeOf<StoryletTrigger>();
    expectTypeOf<'testLedger'>().toMatchTypeOf<EntityLinkKind>();
    const loc: CharacterLocation = { kind: 'testDelve', siteId: 'site_1', depth: 2 };
    const core: CharacterLocation = { kind: 'captive', at: 'set_1', by: 'fac_1' };
    expect([loc.kind, core.kind]).toEqual(['testDelve', 'captive']);
    expectTypeOf<Extract<CharacterLocation, { kind: 'testDelve' }>['depth']>().toEqualTypeOf<number>();
  });

  it('storylet and relic definitions share one contract and validate their effects', () => {
    const storylet: StoryletDef = {
      id: 'testFeastBrawl',
      scope: 'holding',
      trigger: 'testOnFeast',
      when: "flag('feastHeld')",
      textKey: 'narrative.testFeastBrawl.text',
      choices: [
        { labelKey: 'narrative.testFeastBrawl.pay', effects: [{ op: 'addSilver', amount: -50 }, { op: 'changeHonor', amount: 2 }] },
        { labelKey: 'narrative.testFeastBrawl.fight', effects: [{ op: 'testRecord', key: 'brawls', amount: 1 }] },
      ],
    };
    const relic: RelicDef = {
      id: 'rel_1' as RelicId,
      nameKey: 'quests.relic.drownedBell',
      god: 'saltha',
      siteKind: 'cave',
      allowedRegions: ['eyjamark'],
      guardian: 'wreckers',
      effects: [{ op: 'changeFavor', god: 'saltha', amount: 5 }],
      legendKeys: ['quests.relic.drownedBell.legend1', 'quests.relic.drownedBell.legend2'],
    };
    const env = testEnv([siegeModule]);
    const all = [...storylet.choices.flatMap((c) => c.effects), ...relic.effects];
    expect(validateEffects(env, all)).toEqual([]);
    expect(env.balance.units[relic.guardian]?.side).toBe('guardian');
  });

  it('works end to end at runtime without touching kernel files', () => {
    const env = testEnv([siegeModule]);
    const state = testState({ modules: [siegeModule] });
    expect(state.testLedger).toEqual({});
    expect(state.meta.moduleVersions.testSieges).toBe(1);
    const capital = state.player.capitalId;
    const r1 = dispatch(state, { type: 'testBesiege', settlementId: capital }, env);
    expect(r1.error).toBeUndefined();
    expect(r1.state.settlements[capital]!.testSiege?.besiegerId).toMatch(/^tst_\d+$/);
    const r2 = advance(r1.state, 10 * 24, env);
    expect(r2.hoursAdvanced).toBe(72);
    expect(r2.pending?.kind).toBe('testPrompt');
    expect(r2.state.testLedger).toEqual({ [capital]: 3 });
    expect(r2.events.filter((e) => e.type === 'TestSiegeDay').map((e) => (e.type === 'TestSiegeDay' ? e.day : 0))).toEqual([1, 2, 3]);
    const cleared = inDraft(r2.state, env, (d, ctx) => ctx.resolvePending(d.pending!.id)).state;
    expect(advance(cleared, 24, env).state.settlements[capital]!.testSiege?.day).toBe(4);
  });
});
