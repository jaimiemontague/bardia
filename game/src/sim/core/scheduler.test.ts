import { describe, expect, it } from 'vitest';
import { inDraft, testEnv, testState } from '../testing';
import { dispatch } from './dispatch';
import type { SimEvent } from './events';
import type { SimModule, SystemFn } from './module';
import { advance } from './scheduler';
import type { GameState, PendingId, SystemPhase } from './state';
import { HOURS_PER_DAY, HOURS_PER_MONTH, HOURS_PER_WEEK, HOURS_PER_YEAR } from './time';

type Log = string[];

/** A module whose systems append "id:phase@hour" to an external log. */
function recorder(id: string, order: number, log: Log, phases: SystemPhase[], extra: Partial<SimModule> = {}): SimModule {
  const systems: Partial<Record<SystemPhase, SystemFn>> = {};
  for (const p of phases) systems[p] = (draft) => void log.push(`${id}:${p}@${draft.time.hour}`);
  return { id, order, systems, ...extra };
}

describe('scheduler ordering', () => {
  it('runs hourly systems every hour in module order, then boundary systems', () => {
    const log: Log = [];
    const mods = [recorder('b', 20, log, ['hourly', 'daily']), recorder('a', 10, log, ['hourly', 'daily'])];
    const env = testEnv(mods);
    const r = advance(testState({ modules: mods }), 25, env);
    expect(r.hoursAdvanced).toBe(25);
    expect(r.state.time.hour).toBe(25);
    expect(log.slice(0, 4)).toEqual(['a:hourly@1', 'b:hourly@1', 'a:hourly@2', 'b:hourly@2']);
    const at24 = log.filter((l) => l.endsWith('@24'));
    expect(at24).toEqual(['a:hourly@24', 'b:hourly@24', 'a:daily@24', 'b:daily@24']);
    expect(log.filter((l) => l.includes('daily'))).toHaveLength(2);
  });

  it('fires weekly, monthly and yearly systems on their boundaries with events', () => {
    const log: Log = [];
    const mods = [recorder('m', 1, log, ['daily', 'weekly', 'monthly', 'yearly'])];
    const r = advance(testState({ modules: mods }), HOURS_PER_YEAR, testEnv(mods));
    expect(log.filter((l) => l.includes('daily'))).toHaveLength(360);
    expect(log.filter((l) => l.includes('weekly'))).toHaveLength(51);
    expect(log.filter((l) => l.includes('monthly'))).toHaveLength(12);
    expect(log.filter((l) => l.includes('yearly'))).toEqual([`m:yearly@${HOURS_PER_YEAR}`]);
    expect(log).toContain(`m:weekly@${HOURS_PER_WEEK}`);
    expect(log).toContain(`m:monthly@${HOURS_PER_MONTH}`);
    const atYear = log.filter((l) => l.endsWith(`@${HOURS_PER_YEAR}`));
    expect(atYear).toEqual([`m:daily@${HOURS_PER_YEAR}`, `m:monthly@${HOURS_PER_YEAR}`, `m:yearly@${HOURS_PER_YEAR}`]);
    const types = r.events.map((e) => e.type);
    expect(types.filter((t) => t === 'DayStarted')).toHaveLength(360);
    expect(types.filter((t) => t === 'MonthStarted')).toHaveLength(12);
    expect(types.filter((t) => t === 'YearStarted')).toHaveLength(1);
    expect(r.events.at(-1)).toEqual({ type: 'TimeAdvanced', fromHour: 0, toHour: HOURS_PER_YEAR, hours: HOURS_PER_YEAR });
    const year = r.events.find((e) => e.type === 'YearStarted');
    expect(year).toEqual({ type: 'YearStarted', hour: HOURS_PER_YEAR, year: 813 });
  });

  it('rejects non-integer or negative hours', () => {
    const env = testEnv();
    expect(() => advance(testState(), 1.5, env)).toThrow();
    expect(() => advance(testState(), -1, env)).toThrow();
    expect(advance(testState(), 0, env).hoursAdvanced).toBe(0);
  });
});

describe('scheduler pending-stop', () => {
  /** Module 'a' pends at a chosen hour/phase; 'b' runs after it. */
  function setup(pendAt: number, phase: SystemPhase) {
    const log: Log = [];
    const a: SimModule = {
      id: 'a',
      order: 1,
      systems: {
        [phase]: ((draft: GameState, ctx) => {
          log.push(`a:${phase}@${draft.time.hour}`);
          if (draft.time.hour === pendAt) ctx.pend({ kind: 'message', payload: { key: 'stop', vars: {} } });
        }) as SystemFn,
      },
    };
    const b = recorder('b', 2, log, ['hourly', 'daily', 'monthly']);
    const mods = [a, b];
    return { log, mods, env: testEnv(mods), state: testState({ modules: mods }) };
  }

  it('stops immediately, returns hours consumed, and never advances while pending', () => {
    const { log, env, state } = setup(5, 'hourly');
    const r = advance(state, 10, env);
    expect(r.hoursAdvanced).toBe(5);
    expect(r.state.time.hour).toBe(5);
    expect(r.pending?.kind).toBe('message');
    expect(r.state.pending?.source).toBe('a');
    expect(log.at(-1)).toBe('a:hourly@5'); // b's hourly for hour 5 did not run yet
    expect(r.state.time.resume).toEqual({ phase: 'hourly', after: 'a', afterOrder: 1 });
    const again = advance(r.state, 10, env);
    expect(again.hoursAdvanced).toBe(0);
    expect(again.state).toBe(r.state);
    expect(r.events.some((e: SimEvent) => e.type === 'PendingRaised')).toBe(true);
  });

  it('resumes the interrupted tick (no lost or duplicated systems) after the decision is resolved', () => {
    const { log, env, state } = setup(5, 'hourly');
    const stopped = advance(state, 10, env).state;
    const ack = dispatch(stopped, { type: 'acknowledge', pendingId: stopped.pending!.id as PendingId }, env);
    expect(ack.error).toBeUndefined();
    expect(ack.state.pending).toBeNull();
    log.length = 0;
    const r = advance(ack.state, 2, env);
    expect(log).toEqual(['b:hourly@5', 'a:hourly@6', 'b:hourly@6', 'a:hourly@7', 'b:hourly@7']);
    expect(r.state.time.hour).toBe(7);
    expect(r.state.time.resume).toBeUndefined();
  });

  it('resumes a boundary tick: remaining daily systems and the monthly phase still run', () => {
    const { log, env, state } = setup(HOURS_PER_MONTH, 'daily');
    const first = advance(state, HOURS_PER_MONTH + 5, env);
    const stopped = first.state;
    expect(stopped.time.hour).toBe(HOURS_PER_MONTH);
    const dayStartsAtBoundary = (evs: SimEvent[]) => evs.filter((e) => e.type === 'DayStarted' && e.hour === HOURS_PER_MONTH).length;
    expect(dayStartsAtBoundary(first.events)).toBe(1);
    expect(first.events.filter((e) => e.type === 'MonthStarted')).toHaveLength(0); // stopped before the monthly phase
    expect(log.at(-1)).toBe(`a:daily@${HOURS_PER_MONTH}`);
    const resolved = inDraft(stopped, env, (d, ctx) => ctx.resolvePending(d.pending!.id)).state;
    log.length = 0;
    const r = advance(resolved, 1, env);
    expect(log).toEqual([`b:daily@${HOURS_PER_MONTH}`, `b:monthly@${HOURS_PER_MONTH}`, `b:hourly@${HOURS_PER_MONTH + 1}`]);
    // The monthly phase starts fresh on resume (MonthStarted once); the daily phase is not re-announced.
    expect(r.events.filter((e) => e.type === 'MonthStarted')).toHaveLength(1);
    expect(dayStartsAtBoundary(r.events)).toBe(0);
  });

  it('queues a second decision raised while one is pending', () => {
    const env = testEnv();
    const { state } = inDraft(testState(), env, (_d, ctx) => {
      ctx.pend({ kind: 'message', payload: { key: 'one', vars: {} } });
      ctx.pend({ kind: 'message', payload: { key: 'two', vars: {} } });
    });
    expect(state.pending?.payload).toEqual({ key: 'one', vars: {} });
    expect(state.pendingQueue).toHaveLength(1);
    const first = dispatch(state, { type: 'acknowledge', pendingId: state.pending!.id as PendingId }, env).state;
    expect(first.pending?.payload).toEqual({ key: 'two', vars: {} });
    expect(first.pendingQueue).toHaveLength(0);
    expect(() => inDraft(first, env, (_d, ctx) => ctx.resolvePending('pnd_999'))).toThrow(/not the current pending/);
  });
});

describe('core wait command', () => {
  it('waits N days, refuses while pending, and waits until an important event', () => {
    const notifier: SimModule = {
      id: 'herald',
      order: 1,
      systems: {
        daily: (draft, ctx) => {
          if (draft.time.hour === 5 * HOURS_PER_DAY) ctx.notify('envoyArrives', { priority: 'high' });
        },
      },
    };
    const env = testEnv([notifier]);
    const state = testState({ modules: [notifier] });
    const two = dispatch(state, { type: 'wait', days: 2 }, env);
    expect(two.state.time.hour).toBe(48);
    expect(dispatch(state, { type: 'wait', days: 0 }, env).error?.code).toBe('invalidDays');
    const until = dispatch(state, { type: 'wait', untilEvent: true }, env);
    expect(until.state.time.hour).toBe(5 * HOURS_PER_DAY);
    const pendingState = inDraft(state, env, (_d, ctx) => void ctx.pend({ kind: 'message', payload: { key: 'x', vars: {} } })).state;
    expect(dispatch(pendingState, { type: 'wait', days: 1 }, env).error?.code).toBe('pendingDecision');
  });
});

describe('scheduler determinism', () => {
  it('identical inputs give identical states', () => {
    const roller: SimModule = {
      id: 'roller',
      order: 1,
      systems: {
        hourly: (draft, ctx) => {
          if (ctx.hour % 7 === 0) draft.flags.total = Number(draft.flags.total ?? 0) + (draft.time.hour % 3);
        },
      },
    };
    const run = () => advance(testState({ modules: [roller], seed: 'det' }), 500, testEnv([roller])).state;
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
