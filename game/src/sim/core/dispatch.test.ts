import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { testEnv, testState } from '../testing';
import { CommandError, type Command } from './commands';
import { dispatch } from './dispatch';
import { ModuleRegistryError } from './env';
import type { CommandHandlers, CommandSchemas, EffectHandlers, SimModule } from './module';

/** Fake commands are not in CommandMap, so tests cast them. */
const cmd = (c: Record<string, unknown>) => c as unknown as Command;

function fakeModule(id: string, order: number, extra: Partial<SimModule> = {}): SimModule {
  return { id, order, ...extra };
}

describe('dispatch', () => {
  it('returns an error (and the same state) for an unknown command', () => {
    const env = testEnv();
    const state = testState();
    const r = dispatch(state, cmd({ type: 'noSuchCommand' }), env);
    expect(r.error?.code).toBe('unknownCommand');
    expect(r.state).toBe(state);
    expect(r.events).toEqual([]);
    expect(dispatch(state, cmd({}), env).error?.code).toBe('invalidCommand');
  });

  it('routes a command to its single handler and returns events', () => {
    const mod = fakeModule('alpha', 1, {
      handlers: {
        ping: (draft: { flags: Record<string, unknown> }, c: { n: number }, ctx: { notify: (k: string) => void }) => {
          draft.flags.ping = c.n;
          ctx.notify('pinged');
        },
      } as unknown as CommandHandlers,
    });
    const env = testEnv([mod]);
    const state = testState();
    const r = dispatch(state, cmd({ type: 'ping', n: 7 }), env);
    expect(r.error).toBeUndefined();
    expect(r.state.flags.ping).toBe(7);
    expect(state.flags.ping).toBeUndefined(); // immutable update
    expect(r.events).toEqual([{ type: 'Notification', priority: 'normal', key: 'pinged', vars: {} }]);
    expect(Object.isFrozen(r.state)).toBe(true);
  });

  it('CommandError rejects without changing state or emitting events', () => {
    const mod = fakeModule('alpha', 1, {
      handlers: {
        fail: (draft: { flags: Record<string, unknown> }, _c: unknown, ctx: { notify: (k: string) => void }) => {
          draft.flags.touched = true;
          ctx.notify('half-done');
          throw new CommandError('notAllowed', 'Nope', { why: 'test' });
        },
      } as unknown as CommandHandlers,
    });
    const state = testState();
    const r = dispatch(state, cmd({ type: 'fail' }), testEnv([mod]));
    expect(r.error).toEqual({ code: 'notAllowed', message: 'Nope', details: { why: 'test' } });
    expect(r.state).toBe(state);
    expect(r.events).toEqual([]);
  });

  it('non-CommandError exceptions are bugs and propagate', () => {
    const mod = fakeModule('alpha', 1, {
      handlers: {
        boom: () => {
          throw new TypeError('bug');
        },
      } as unknown as CommandHandlers,
    });
    expect(() => dispatch(testState(), cmd({ type: 'boom' }), testEnv([mod]))).toThrow(TypeError);
  });

  it('validates commands with an optional zod schema', () => {
    const mod = fakeModule('alpha', 1, {
      handlers: { typed: () => {} } as unknown as CommandHandlers,
      commandSchemas: { typed: z.object({ type: z.literal('typed'), n: z.number().int() }) } as unknown as CommandSchemas,
    });
    const env = testEnv([mod]);
    expect(dispatch(testState(), cmd({ type: 'typed', n: 1.5 }), env).error?.code).toBe('invalidCommand');
    expect(dispatch(testState(), cmd({ type: 'typed', n: 1 }), env).error).toBeUndefined();
  });

  it('handlers receive the schema output (defaults, trims) with type kept; the log keeps the raw input', async () => {
    let received: unknown;
    const mod = fakeModule('alpha', 1, {
      handlers: { probe: (_d: unknown, c: unknown) => void (received = c) } as unknown as CommandHandlers,
      commandSchemas: {
        probe: z.object({ n: z.number().int().default(3), name: z.string().trim() }),
      } as unknown as CommandSchemas,
    });
    const raw = cmd({ type: 'probe', name: '  Ketil  ' });
    expect(dispatch(testState(), raw, testEnv([mod])).error).toBeUndefined();
    expect(received).toEqual({ type: 'probe', n: 3, name: 'Ketil' }); // schema without 'type': type re-attached
    const { GameSession } = await import('../session');
    const s = GameSession.newGame({ seed: 'parsed' }, { modules: [mod] });
    s.dispatch(raw);
    expect(s.commandLog[0]).toEqual({ kind: 'command', hour: 0, command: raw });
  });

  it('setPolicy accepts only keys present in state, never prototype members', () => {
    const env = testEnv();
    for (const policy of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(dispatch(testState(), cmd({ type: 'setPolicy', policy, value: 'x' }), env).error?.code).toBe('unknownPolicy');
    }
  });

  it('core setPolicy and acknowledge', () => {
    const env = testEnv();
    const state = testState();
    const r = dispatch(state, { type: 'setPolicy', policy: 'envoy', value: 'rejectAll' }, env);
    expect(r.state.player.policies.envoy).toBe('rejectAll');
    expect(r.events[0]).toEqual({ type: 'PolicyChanged', policy: 'envoy', value: 'rejectAll' });
    expect(dispatch(state, cmd({ type: 'setPolicy', policy: 'nonsense', value: 1 }), env).error?.code).toBe('unknownPolicy');
    expect(dispatch(state, { type: 'acknowledge', pendingId: 'pnd_1' }, env).error?.code).toBe('notPending');
  });
});

describe('module registry validation (startup errors)', () => {
  it('rejects two modules handling the same command type', () => {
    const h = { dup: () => {} } as unknown as CommandHandlers;
    expect(() => testEnv([fakeModule('a', 1, { handlers: h }), fakeModule('b', 2, { handlers: h })])).toThrow(ModuleRegistryError);
    try {
      testEnv([fakeModule('a', 1, { handlers: h }), fakeModule('b', 2, { handlers: h })]);
    } catch (e) {
      expect((e as ModuleRegistryError).problems).toEqual(["command 'dup' is handled by both 'a' and 'b'"]);
    }
  });

  it('rejects a module that re-handles a core command', () => {
    const h = { wait: () => {} } as unknown as CommandHandlers;
    expect(() => testEnv([fakeModule('a', 1, { handlers: h })])).toThrow(/command 'wait' is handled by both 'core' and 'a'/);
  });

  it('rejects duplicate effect ops, ids, orders and bad ids', () => {
    const e = { addSilver: () => {} } as unknown as EffectHandlers;
    expect(() => testEnv([fakeModule('a', 1, { effects: e })])).toThrow(/effect op 'addSilver'/);
    expect(() => testEnv([fakeModule('a', 1), fakeModule('a', 2)])).toThrow(/registered 2 times/);
    expect(() => testEnv([fakeModule('a', 1), fakeModule('b', 1)])).toThrow(/share order 1/);
    expect(() => testEnv([fakeModule('Bad-Id', 1)])).toThrow(/must match/);
    const s = { orphan: z.any() } as unknown as CommandSchemas;
    expect(() => testEnv([fakeModule('a', 1, { commandSchemas: s })])).toThrow(/schema for 'orphan' but no handler/);
  });

  it('the real registry is valid and ordered', async () => {
    const { MODULES } = await import('../modules');
    const env = testEnv(MODULES);
    const ids = env.modules.map((m) => m.id);
    expect(ids[0]).toBe('core');
    expect(ids.slice(1, 6)).toEqual(['world', 'weather', 'encounters', 'expeditions', 'settlements']);
    expect(ids).toContain('saga');
    expect(ids.slice(-3)).toEqual(['battle', 'duel', 'seabattle']);
    expect(env.modules.length).toBe(21);
  });
});
