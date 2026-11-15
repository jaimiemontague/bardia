import { headlessCommand } from './headless';
import { describe, expect, it } from 'vitest';
import { checkInvariants } from './core/env';
import type { SimModule } from './core/module';
import { formatDate } from './core/time';
import { GameSession as RegistrySession } from './game';
import { GameSession, ReplayDivergenceError } from './session';

const noModules = { modules: [] as SimModule[] };

describe('GameSession', () => {
  it('newGame sets meta, hour 0, a placeholder player and runs module init in order', () => {
    const order: string[] = [];
    const mods: SimModule[] = [
      { id: 'second', order: 20, init: () => void order.push('second') },
      { id: 'first', order: 10, init: (d) => void (order.push('first'), (d.flags.firstRan = true)) },
    ];
    const s = GameSession.newGame({ seed: 'abc', difficulty: 'longWinter', options: { ironman: true } }, { modules: mods });
    const state = s.getState();
    expect(order).toEqual(['first', 'second']);
    expect(state.flags.firstRan).toBe(true);
    expect(state.meta).toMatchObject({ seed: 'abc', difficulty: 'longWinter', schemaVersion: 1, mode: 'hub' });
    expect(state.meta.options.ironman).toBe(true);
    expect(state.meta.options.duelAssist).toBe(false); // Long Winter preset default
    expect(state.time.hour).toBe(0);
    expect(formatDate(state.time.hour)).toBe('1 Icebreak 812 A.S.');
    expect(state.characters[state.player.rulerId]?.role?.kind).toBe('ruler');
    expect(state.factions[state.player.factionId]?.treasury).toBe(800);
    expect(checkInvariants(state, s.env)).toEqual([]);
    expect(Object.isFrozen(state)).toBe(true);
  });

  it('is deterministic per seed and differs across seeds', () => {
    const a = JSON.stringify(GameSession.newGame({ seed: 'same' }, noModules).getState());
    const b = JSON.stringify(GameSession.newGame({ seed: 'same' }, noModules).getState());
    const c = JSON.stringify(GameSession.newGame({ seed: 'other' }, noModules).getState());
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('runs with the full module registry for a year headlessly and stays valid', () => {
    const s = RegistrySession.newGame({ seed: 'year' });
    let hours = 0;
    for (let guard = 0; hours < 8640 && guard < 2000; guard++) {
      const r = s.advance(8640 - hours);
      hours += r.hoursAdvanced;
      if (r.pending) {
        const h = headlessCommand(s.getState(), r.pending);
        expect('command' in h ? '' : h.error).toBe('');
        if ('command' in h) expect(s.dispatch(h.command).error).toBeUndefined();
      }
    }
    expect(hours).toBe(8640);
    expect(formatDate(s.getState().time.hour)).toBe('1 Icebreak 813 A.S.');
    expect(checkInvariants(s.getState(), s.env)).toEqual([]);
  });

  it('notifies subscribers and supports unsubscribe', () => {
    const s = GameSession.newGame({ seed: 'subs' }, noModules);
    const seen: number[] = [];
    const off = s.subscribe((state, events) => seen.push(state.time.hour, events.length));
    s.advance(2);
    off();
    s.advance(2);
    expect(seen).toEqual([2, 1]); // hour 2, one TimeAdvanced event
  });

  it('logs commands and advances; replay reproduces the identical state', () => {
    const mod: SimModule = {
      id: 'dice',
      order: 1,
      systems: { daily: (d, ctx) => void (d.flags.roll = (Number(d.flags.roll ?? 0) + ctx.hour) % 97) },
    };
    const deps = { modules: [mod] };
    const s = GameSession.newGame({ seed: 'replay', difficulty: 'raider' }, deps);
    s.advance(30);
    s.dispatch({ type: 'setPolicy', policy: 'envoy', value: 'defer' });
    s.dispatch({ type: 'wait', days: 5 });
    expect(s.dispatch({ type: 'wait', days: -1 }).error).toBeDefined(); // failed commands are not logged
    s.advance(100);
    expect(s.commandLog.map((e) => e.kind)).toEqual(['advance', 'command', 'command', 'advance']);
    const replayed = GameSession.replay(s.newGameOptions!, s.commandLog, deps);
    expect(JSON.stringify(replayed.getState())).toBe(JSON.stringify(s.getState()));
    const tampered = [{ ...s.commandLog[0]!, hour: 5 }];
    expect(() => GameSession.replay(s.newGameOptions!, tampered, deps)).toThrow(ReplayDivergenceError);
  });

  it('consecutive advances share one log entry and replay identically, including a pending stop', () => {
    const mod: SimModule = {
      id: 'herald',
      order: 1,
      systems: {
        hourly: (d, ctx) => {
          d.flags.ticks = Number(d.flags.ticks ?? 0) + ctx.rng('herald').int(1, 6);
          if (d.time.hour === 50) ctx.pend({ kind: 'message', payload: { key: 'hail', vars: {} } });
        },
      },
    };
    const deps = { modules: [mod] };
    const s = GameSession.newGame({ seed: 'merge' }, deps);
    for (let i = 0; i < 40; i++) s.advance(1);
    expect(s.commandLog).toEqual([{ kind: 'advance', hour: 0, hours: 40 }]);
    for (let i = 0; i < 6; i++) s.advance(3); // stops at hour 50 inside the 4th call
    expect(s.getState().time.hour).toBe(50);
    expect(s.commandLog).toEqual([{ kind: 'advance', hour: 0, hours: 52 }]);
    s.dispatch({ type: 'acknowledge', pendingId: s.getState().pending!.id });
    s.advance(5);
    s.advance(5);
    expect(s.commandLog.map((e) => e.kind)).toEqual(['advance', 'command', 'advance']);
    expect(s.commandLog[2]).toEqual({ kind: 'advance', hour: 50, hours: 10 });
    const replayed = GameSession.replay(s.newGameOptions!, s.commandLog, deps);
    expect(JSON.stringify(replayed.getState())).toBe(JSON.stringify(s.getState()));
  });

  it('load runs init for modules the save has never seen and records their version', () => {
    const blob = GameSession.newGame({ seed: 'd' }, noModules).save();
    const herald: SimModule = { id: 'herald', order: 7, version: 2, init: (d) => void (d.flags.heraldReady = true), migrate: () => { throw new Error('not for new modules'); } };
    const plain: SimModule = { id: 'plain', order: 8, init: (d) => void (d.flags.plainReady = true) };
    const loaded = GameSession.load(blob, { modules: [herald, plain] });
    expect(loaded.getState().flags).toMatchObject({ heraldReady: true, plainReady: true });
    expect(loaded.getState().meta.moduleVersions).toMatchObject({ herald: 2, plain: 0 });
    // Loading again does not re-run init.
    const again = GameSession.load(loaded.save(), { modules: [{ ...plain, init: () => { throw new Error('ran twice'); } }] });
    expect(again.getState().meta.moduleVersions.plain).toBe(0);
  });

  it('a pending decision stops advance; acknowledging resumes', () => {
    const mod: SimModule = {
      id: 'herald',
      order: 1,
      systems: { hourly: (d, ctx) => void (d.time.hour === 10 && ctx.pend({ kind: 'message', payload: { key: 'hail', vars: {} } })) },
    };
    const s = GameSession.newGame({ seed: 'pend' }, { modules: [mod] });
    const r = s.advance(48);
    expect(r.hoursAdvanced).toBe(10);
    expect(s.advance(5).hoursAdvanced).toBe(0);
    expect(s.dispatch({ type: 'acknowledge', pendingId: r.pending!.id }).error).toBeUndefined();
    expect(s.advance(5).hoursAdvanced).toBe(5);
    expect(s.getState().time.hour).toBe(15);
  });
});
