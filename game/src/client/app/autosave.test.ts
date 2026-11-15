import { describe, expect, it } from 'vitest';
import type { SimEvent } from '@sim/core/events';
import { GameSession } from '@sim/session';
import { MemorySaveBackend } from '../saves/backend';
import { SaveManager, type SaveMeta } from '../saves/saveManager';
import { AutosaveQueue, autosaveTrigger, shouldAutosave } from './autosave';

const session = GameSession.newGame({ seed: 'auto' }, { modules: [] });
const state = session.getState();
const ev = (e: Record<string, unknown>): SimEvent => e as unknown as SimEvent;

describe('autosave triggers (§29.9)', () => {
  it('detects month start, departures and battles; ignores startup batches', () => {
    expect(autosaveTrigger({ events: [ev({ type: 'MonthStarted', hour: 720, year: 812, monthIndex: 1 })], state, origin: 'advance' })).toBe('monthStart');
    expect(autosaveTrigger({ events: [], state, origin: 'dispatch', command: { type: 'launchExpedition' } as never })).toBe('departure');
    expect(autosaveTrigger({ events: [ev({ type: 'BattleStarted' }), ev({ type: 'MonthStarted' })], state, origin: 'advance' })).toBe('battleStart');
    expect(autosaveTrigger({ events: [ev({ type: 'MonthStarted' })], state, origin: 'startup' })).toBeNull();
    expect(autosaveTrigger({ events: [ev({ type: 'DayStarted' })], state, origin: 'advance' })).toBeNull();
  });

  it('honours the setting, and Ironman always saves', () => {
    expect(shouldAutosave('arrival', 'standard', false)).toBe(true);
    expect(shouldAutosave('arrival', 'monthly', false)).toBe(false);
    expect(shouldAutosave('monthStart', 'monthly', false)).toBe(true);
    expect(shouldAutosave('monthStart', 'off', false)).toBe(false);
    expect(shouldAutosave('arrival', 'off', true)).toBe(true);
  });

  it('serialises writes and keeps only the newest queued request', async () => {
    const backend = new MemorySaveBackend();
    const saved: SaveMeta[] = [];
    let now = 0;
    const m = new SaveManager(backend, () => ++now);
    const q = new AutosaveQueue(() => m, (meta) => saved.push(meta));
    q.request(session);
    expect(q.busy).toBe(true);
    q.request(session);
    q.request(session);
    await new Promise((r) => setTimeout(r, 20));
    expect(saved.map((s) => s.id)).toEqual(['auto-1', 'auto-2']);
    expect(q.busy).toBe(false);
  });
});
