/**
 * The real-time loop (design §7.2, §29.4): every animation frame converts wall-clock time into whole
 * game hours via the time controls and advances the session. Time runs only when the scene is a
 * real-time one (the map; any scene with the dev `forceRealtime` flag), the player has not paused,
 * no decision is pending, and nothing covers the scene (an overlay screen, a Critical notification,
 * the dev console) — those "soft-pause" without changing the player's pause state.
 * Play time is accrued for saves whenever a campaign is open and the tab is visible.
 */
import { useEffect, useRef } from 'react';
import type { GameMode } from '@sim/core/state';
import { RealtimeClock } from './clock';
import { useDevFlags } from './devFlags';
import { useGame } from './gameStore';
import { useNavigation } from './navigation';
import { useNotifications } from './notifications';
import type { ScreenRegistry } from './screenRegistry';
import { DEFAULT_REALTIME_MODES } from './services';

/** Inputs of the run decision (pure so it is unit tested). */
export interface RunConditions {
  hasSession: boolean;
  realtimeScene: boolean;
  paused: boolean;
  pending: boolean;
  overlays: number;
  critical: number;
  consoleOpen: boolean;
}

/** Why the clock is (not) running: 'running' or the first blocking reason. */
export type RunState = 'running' | 'noSession' | 'notRealtime' | 'paused' | 'pending' | 'overlay' | 'critical' | 'console';

/** Decides whether game time flows this frame. */
export function runState(c: RunConditions): RunState {
  if (!c.hasSession) return 'noSession';
  if (!c.realtimeScene) return 'notRealtime';
  if (c.pending) return 'pending';
  if (c.critical > 0) return 'critical';
  if (c.overlays > 0) return 'overlay';
  if (c.consoleOpen) return 'console';
  if (c.paused) return 'paused';
  return 'running';
}

/** Whether a game mode's scene runs in real time (screen flag, else the default modes, or forced). */
export function isRealtimeMode(mode: GameMode | string, registry: ScreenRegistry | null, force = false): boolean {
  if (force) return true;
  const screen = registry?.forMode(mode);
  if (screen?.realtime !== undefined) return screen.realtime;
  return (DEFAULT_REALTIME_MODES as readonly string[]).includes(mode);
}

/** Reads the current run conditions from the stores. */
export function currentRunConditions(registry: ScreenRegistry | null): RunConditions {
  const g = useGame.getState();
  const dev = useDevFlags.getState();
  return {
    hasSession: g.session !== null,
    realtimeScene: g.state ? isRealtimeMode(g.state.meta.mode, registry, dev.forceRealtime) : false,
    paused: g.paused,
    pending: (g.state?.pending ?? null) !== null,
    overlays: useNavigation.getState().stack.length,
    critical: useNotifications.getState().critical.length,
    consoleOpen: dev.consoleOpen,
  };
}

/** Longest frame counted towards play time (seconds). */
const MAX_PLAYTIME_STEP = 1;

/** Mounts the real-time loop while the game shell is on screen. */
export function useRealtimeLoop(registry: ScreenRegistry | null): void {
  const reg = useRef(registry);
  reg.current = registry;
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return undefined;
    const clock = new RealtimeClock();
    let last = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const dt = Math.max(0, now - last);
      last = now;
      const g = useGame.getState();
      if (g.session && document.visibilityState !== 'hidden') g.session.addPlaytime(Math.min(dt / 1000, MAX_PLAYTIME_STEP));
      if (runState(currentRunConditions(reg.current)) === 'running') {
        const hours = clock.tick(dt, g.speed);
        if (hours > 0) g.advanceHours(hours);
      } else {
        clock.reset();
      }
      raf = window.requestAnimationFrame(frame);
    };
    raf = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(raf);
  }, []);
}
