import { describe, expect, it } from 'vitest';
import { inDraft, testEnv, testState } from '../testing';
import { CommandError, type Command } from './commands';
import { baseState, MAX_REACTION_DEPTH, SimError } from './context';
import { dispatch } from './dispatch';
import { ModuleRegistryError } from './env';
import type { CommandHandlers, Reactions, SimModule } from './module';
import { hostStream, rngFloat, Rng } from './rng';
import { advance } from './scheduler';
import type { GameState } from './state';

const cmd = (c: Record<string, unknown>) => c as unknown as Command;

describe('events never hold Immer drafts', () => {
  const env = testEnv();

  it('notify / narrate with draft vars stay readable after the operation', () => {
    const { events } = inDraft(testState(), env, (d, ctx) => {
      ctx.notify('n', { vars: d.player.house as unknown as Record<string, number> });
      ctx.narrate('l', d.flags as never);
      d.player.house.renown = 7; // modified draft: the snapshot must carry the new value
    });
    expect(() => JSON.stringify(events)).not.toThrow();
    const n = events[0];
    expect(n?.type === 'Notification' && n.vars.renown).toBe(7);
  });

  it('notify carries an optional illustration (an image asset id) and leaves it out when not given', () => {
    const { events } = inDraft(testState(), env, (_d, ctx) => {
      ctx.notify('a', { priority: 'critical', illustration: 'people.illus.houseFallen' });
      ctx.notify('b');
    });
    expect(events[0]).toMatchObject({ type: 'Notification', key: 'a', illustration: 'people.illus.houseFallen' });
    expect(events[1] !== undefined && 'illustration' in events[1]).toBe(false);
  });

  it('a decision raised and resolved in one operation keeps a readable payload', () => {
    const { events, state } = inDraft(testState(), env, (d, ctx) => {
      const p = ctx.pend({ kind: 'message', payload: { key: 'k', vars: d.player.house as never } });
      ctx.resolvePending(p.id);
    });
    expect(state.pending).toBeNull();
    expect(() => JSON.stringify(events)).not.toThrow();
    expect(events.map((e) => e.type)).toEqual(['PendingRaised', 'PendingResolved']);
  });

  it('a decision left pending is the same object in the state and the event', () => {
    const { events, state } = inDraft(testState(), env, (_d, ctx) => void ctx.pend({ kind: 'message', payload: { key: 'k', vars: {} } }));
    const raised = events[0];
    expect(raised?.type === 'PendingRaised' && raised.decision).toEqual(state.pending);
  });
});

describe('reactions (modules observing other modules’ events)', () => {
  const ping: CommandHandlers = {
    ping: (_d: GameState, _c: unknown, ctx: { emit: (e: unknown) => void }) => ctx.emit({ type: 'TestPinged', n: 1 }),
  } as unknown as CommandHandlers;

  it('a command-raised event reaches another module’s reaction, in module order, attributed to that module', () => {
    const seen: string[] = [];
    const reactor = (id: string, order: number): SimModule => ({
      id,
      order,
      reactions: {
        TestPinged: (d: GameState, e: { n: number }, ctx: { moduleId: string }) => {
          seen.push(`${ctx.moduleId}:${e.n}`);
          d.flags[id] = e.n;
        },
      } as unknown as Reactions,
    });
    const env = testEnv([{ id: 'sender', order: 5, handlers: ping }, reactor('late', 90), reactor('early', 10)]);
    const r = dispatch(testState(), cmd({ type: 'ping' }), env);
    expect(r.error).toBeUndefined();
    expect(seen).toEqual(['early:1', 'late:1']);
    expect(r.state.flags).toMatchObject({ early: 1, late: 1 });
  });

  it('reaction chains run breadth-first and are capped', () => {
    const chain: SimModule = {
      id: 'chain',
      order: 20,
      reactions: {
        TestPinged: (_d: GameState, e: { n: number }, ctx: { emit: (e: unknown) => void }) => {
          if (e.n < 3) ctx.emit({ type: 'TestPinged', n: e.n + 1 });
        },
      } as unknown as Reactions,
    };
    const env = testEnv([{ id: 'sender', order: 5, handlers: ping }, chain]);
    const r = dispatch(testState(), cmd({ type: 'ping' }), env);
    expect(r.events.map((e) => (e as unknown as { n: number }).n)).toEqual([1, 2, 3]);

    const loop: SimModule = {
      id: 'loop',
      order: 20,
      reactions: { TestPinged: (_d: GameState, _e: unknown, ctx: { emit: (e: unknown) => void }) => ctx.emit({ type: 'TestPinged', n: 0 }) } as unknown as Reactions,
    };
    expect(() => dispatch(testState(), cmd({ type: 'ping' }), testEnv([{ id: 'sender', order: 5, handlers: ping }, loop]))).toThrow(SimError);
    expect(MAX_REACTION_DEPTH).toBeGreaterThan(2);
  });

  it('a CommandError thrown by a reaction rejects the whole command', () => {
    const veto: SimModule = {
      id: 'veto',
      order: 20,
      reactions: {
        TestPinged: () => {
          throw new CommandError('vetoed');
        },
      } as unknown as Reactions,
    };
    const state = testState();
    const r = dispatch(state, cmd({ type: 'ping' }), testEnv([{ id: 'sender', order: 5, handlers: ping }, veto]));
    expect(r.error?.code).toBe('vetoed');
    expect(r.state).toBe(state);
  });

  it('reactions to scheduler events run before the next system, and can stop time', () => {
    const log: string[] = [];
    const watcher: SimModule = {
      id: 'watcher',
      order: 50,
      reactions: {
        DayStarted: (d: GameState, _e: unknown, ctx: { pend: (r: unknown) => void }) => {
          log.push('react');
          if (d.time.hour === 48) ctx.pend({ kind: 'message', payload: { key: 'dawn', vars: {} } });
        },
      } as unknown as Reactions,
    };
    const daily: SimModule = { id: 'daily', order: 10, systems: { daily: () => void log.push('daily') } };
    const env = testEnv([watcher, daily]);
    const r = advance(testState({ modules: [watcher, daily] }), 72, env);
    expect(r.hoursAdvanced).toBe(48);
    expect(r.pending?.kind).toBe('message');
    expect(log).toEqual(['react', 'daily', 'react']); // day 2: reaction pends before the daily system runs
    const cleared = inDraft(r.state, env, (d, ctx) => ctx.resolvePending(d.pending!.id)).state;
    const r2 = advance(cleared, 24, env);
    expect(r2.events.filter((e) => e.type === 'DayStarted')).toHaveLength(1); // day 2 is not re-announced; day 3 is
    expect(log).toEqual(['react', 'daily', 'react', 'daily', 'react', 'daily']);
  });
});

describe('ctx.rng — per-operation cached streams', () => {
  const env = testEnv();

  it('draws the same sequence as the functional API and writes the stream back once', () => {
    const s0 = testState();
    const plain = JSON.parse(JSON.stringify(s0)) as GameState;
    const expected = Array.from({ length: 5 }, () => rngFloat(plain, 'weather'));
    let drawn: number[] = [];
    const { state } = inDraft(s0, env, (_d, ctx) => {
      drawn = Array.from({ length: 5 }, () => ctx.rng('weather').float());
    });
    expect(drawn).toEqual(expected);
    expect(state.rng.weather).toEqual(plain.rng.weather);
    // An untouched or never-drawn stream is not created.
    const { state: s2 } = inDraft(s0, env, (_d, ctx) => void ctx.rng('unused'));
    expect(Object.hasOwn(s2.rng, 'unused')).toBe(false);
    expect(ctx2Instance(s0)).toBeInstanceOf(Rng);
  });

  it('continues across operations and is reproducible', () => {
    const run = () => {
      let s = testState();
      const out: number[] = [];
      for (let i = 0; i < 3; i++) s = inDraft(s, env, (_d, ctx) => void out.push(ctx.rng('ai:fac_1').u32())).state;
      return out;
    };
    expect(run()).toEqual(run());
    const host = { rng: {}, meta: { seed: 'test-seed' } };
    const src = hostStream(host, 'ai:fac_1');
    expect(run()).toEqual([src.u32(), src.u32(), src.u32()]);
  });

  it('mixing ctx.rng and the functional API on one stream in one operation throws', () => {
    expect(() =>
      inDraft(testState(), env, (d, ctx) => {
        ctx.rng('weather').float();
        rngFloat(d, 'weather');
      }),
    ).toThrow(/both through ctx.rng\(\) and the functional rng API/);
  });

  it('a rejected command leaves the streams untouched', () => {
    const mod: SimModule = {
      id: 'dice',
      order: 1,
      handlers: {
        roll: (_d: GameState, _c: unknown, ctx: { rng: (s: string) => Rng }) => {
          ctx.rng('dice').u32();
          throw new CommandError('no');
        },
      } as unknown as CommandHandlers,
    };
    const state = testState();
    const r = dispatch(state, cmd({ type: 'roll' }), testEnv([mod]));
    expect(r.state).toBe(state);
    expect(Object.hasOwn(r.state.rng, 'dice')).toBe(false);
  });

  it('rejects reserved stream names', () => {
    expect(() => inDraft(testState(), env, (_d, ctx) => void ctx.rng('__proto__'))).toThrow(RangeError);
  });

  it('baseState reads the operation’s starting state without proxies', () => {
    const s0 = testState();
    inDraft(s0, env, (d) => {
      d.player.house.renown = 99;
      expect(baseState(d.player.house).renown).toBe(0);
      expect(d.player.house.renown).toBe(99);
      expect(baseState(s0)).toBe(s0);
    });
  });
});

describe('registry indexing of the new hooks', () => {
  it('rejects duplicate condition functions and effect schemas without handlers', () => {
    const fn = { args: { safeParse: () => ({ success: true }) }, returns: 'number', evaluate: () => 1 } as never;
    expect(() => testEnv([{ id: 'a', order: 1, conditionFns: { flag: fn } }])).toThrow(/condition function 'flag' is provided by both 'core' and 'a'/);
    expect(() => testEnv([{ id: 'a', order: 1, effectSchemas: { orphanOp: {} as never } as never }])).toThrow(ModuleRegistryError);
  });

  it('skips disabled modules and reports them', () => {
    const env = testEnv([{ id: 'broken', order: 1, enabled: false, systems: { hourly: () => { throw new Error('never runs'); } } }]);
    expect(env.disabled).toEqual(['broken']);
    expect(env.modules.map((m) => m.id)).toEqual(['core']);
    expect(() => advance(testState(), 5, env)).not.toThrow();
  });
});

function ctx2Instance(state: GameState): unknown {
  let out: unknown;
  inDraft(state, testEnv(), (_d, ctx) => {
    out = ctx.rng('x');
  });
  return out;
}
