import { describe, expect, it } from 'vitest';
import { buildRegistry } from './screenRegistry';
import { isRealtimeMode, runState, type RunConditions } from './realtime';

const base: RunConditions = { hasSession: true, realtimeScene: true, paused: false, pending: false, overlays: 0, critical: 0, consoleOpen: false };

describe('real-time loop run decision (§7.2)', () => {
  it('runs only on a real-time scene with nothing in the way', () => {
    expect(runState(base)).toBe('running');
  });

  it('reports the first blocking reason', () => {
    expect(runState({ ...base, hasSession: false })).toBe('noSession');
    expect(runState({ ...base, realtimeScene: false })).toBe('notRealtime');
    expect(runState({ ...base, pending: true, paused: true })).toBe('pending');
    expect(runState({ ...base, critical: 1 })).toBe('critical');
    expect(runState({ ...base, overlays: 2 })).toBe('overlay');
    expect(runState({ ...base, consoleOpen: true })).toBe('console');
    expect(runState({ ...base, paused: true })).toBe('paused');
  });

  it('treats the map as real-time by default, lets screens override, and honours the dev flag', () => {
    const none = buildRegistry({});
    expect(isRealtimeMode('map', none)).toBe(true);
    expect(isRealtimeMode('hub', none)).toBe(false);
    expect(isRealtimeMode('hub', none, true)).toBe(true);
    const reg = buildRegistry({ './screens/x/index.tsx': { screen: { id: 'x', mode: 'delve', realtime: true, component: () => null } } });
    expect(isRealtimeMode('delve', reg)).toBe(true);
  });
});
