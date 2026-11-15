/**
 * The game store (zustand): the single bridge between React and the GameSession (ARCHITECTURE §14).
 *
 *   const state = useGame((s) => s.state);                 // frozen GameState (never mutate)
 *   const dispatch = useGame((s) => s.dispatch);           // → DispatchResult (error shown as a toast)
 *   useGameState((st) => st.player.house.renown)           // selector over GameState (null-safe)
 *
 * The session is created through an injectable SessionFactory (main.tsx installs the registry-bound
 * one; tests use core-only sessions), so this file never loads the module registry itself.
 * Every committed update bumps `revision` and publishes its events on the sim-event bus.
 */
import { create } from 'zustand';
import type { Command } from '@sim/core/commands';
import type { DispatchResult } from '@sim/core/dispatch';
import type { NewGameOptions } from '@sim/core/lifecycle';
import type { AdvanceResult } from '@sim/core/scheduler';
import type { GameState, PendingDecision } from '@sim/core/state';
import type { GameSession } from '@sim/session';
import { publishSimEvents } from './simEvents';
import { stepSpeed, type TimeSpeed } from './clock';

/** Creates and loads sessions (the registry-bound GameSession in the app; subsets in tests). */
export interface SessionFactory {
  newGame(options: NewGameOptions): GameSession;
  load(blob: string): GameSession;
}

let factory: SessionFactory | null = null;

/** Installs the session factory (main.tsx at boot; tests in setup). */
export function setSessionFactory(f: SessionFactory): void {
  factory = f;
}

/** The installed factory (throws when none is installed — a boot error, not a player error). */
export function getSessionFactory(): SessionFactory {
  if (!factory) throw new Error('No session factory installed (call setSessionFactory at boot).');
  return factory;
}

export interface GameError {
  code: string;
  message: string;
}

/** Where the current session came from (saves, Ironman). */
export interface SessionOrigin {
  /** Save slot this session was loaded from or last saved to. */
  slotId: string | null;
}

export interface GameStore {
  session: GameSession | null;
  state: GameState | null;
  /** Increments on every committed state change. */
  revision: number;
  paused: boolean;
  /** Why time was auto-paused (locale key), cleared on unpause. */
  pauseReason: string | null;
  speed: TimeSpeed;
  /** The last rejected command or failed operation. */
  error: GameError | null;
  origin: SessionOrigin;

  /** Starts a new campaign. Throws (and records `error`) if the simulation cannot create it. */
  startNewGame(options: NewGameOptions): GameSession;
  /** Loads a save blob. Throws (and records `error`) on a corrupt or incompatible save. */
  loadFromBlob(blob: string, origin?: Partial<SessionOrigin>): GameSession;
  /** Adopts an existing session (tests, replays). */
  attach(session: GameSession, origin?: Partial<SessionOrigin>): void;
  /** Leaves the game (back to the main menu). */
  quit(): void;
  /** Dispatches a command; rejected commands set `error` and return the failure. */
  dispatch(cmd: Command): DispatchResult | null;
  /** Advances game time by whole hours (stops at a pending decision). */
  advanceHours(hours: number): AdvanceResult | null;
  setSpeed(speed: TimeSpeed): void;
  stepSpeed(dir: 1 | -1): void;
  setPaused(paused: boolean, reason?: string | null): void;
  togglePause(): void;
  clearError(): void;
  setOrigin(origin: Partial<SessionOrigin>): void;
}

let unsubscribeSession: (() => void) | null = null;
let lastOrigin: { origin: 'dispatch' | 'advance'; command?: Command } = { origin: 'advance' };

export const useGame = create<GameStore>()((set, get) => {
  function adopt(session: GameSession, origin: Partial<SessionOrigin> | undefined): void {
    unsubscribeSession?.();
    unsubscribeSession = session.subscribe((state, events) => {
      set((s) => ({ state, revision: s.revision + 1 }));
      const o = lastOrigin;
      publishSimEvents({ events, state, origin: o.origin, ...(o.command ? { command: o.command } : {}) });
    });
    const state = session.getState();
    set((s) => ({
      session,
      state,
      revision: s.revision + 1,
      paused: true,
      pauseReason: null,
      error: null,
      origin: { slotId: origin?.slotId ?? null },
    }));
    publishSimEvents({ events: session.startupEvents, state, origin: 'startup' });
  }

  function fail(code: string, err: unknown): GameError {
    const e = { code, message: err instanceof Error ? err.message : String(err) };
    set({ error: e });
    return e;
  }

  return {
    session: null,
    state: null,
    revision: 0,
    paused: true,
    pauseReason: null,
    speed: 1,
    error: null,
    origin: { slotId: null },

    startNewGame(options) {
      let session: GameSession;
      try {
        session = getSessionFactory().newGame(options);
      } catch (err) {
        fail('newGameFailed', err);
        throw err;
      }
      adopt(session, { slotId: null });
      return session;
    },

    loadFromBlob(blob, origin) {
      let session: GameSession;
      try {
        session = getSessionFactory().load(blob);
      } catch (err) {
        fail('loadFailed', err);
        throw err;
      }
      adopt(session, origin);
      return session;
    },

    attach(session, origin) {
      adopt(session, origin);
    },

    quit() {
      unsubscribeSession?.();
      unsubscribeSession = null;
      set((s) => ({ session: null, state: null, revision: s.revision + 1, paused: true, pauseReason: null, origin: { slotId: null } }));
    },

    dispatch(cmd) {
      const session = get().session;
      if (!session) return null;
      lastOrigin = { origin: 'dispatch', command: cmd };
      let result: DispatchResult;
      try {
        result = session.dispatch(cmd);
      } catch (err) {
        fail('simError', err);
        console.error('[game] command crashed the simulation', cmd, err);
        return null;
      } finally {
        lastOrigin = { origin: 'advance' };
      }
      if (result.error) set({ error: { code: result.error.code, message: result.error.message } });
      return result;
    },

    advanceHours(hours) {
      const session = get().session;
      if (!session || hours <= 0 || !Number.isInteger(hours)) return null;
      if (session.getState().pending !== null) return null;
      lastOrigin = { origin: 'advance' };
      try {
        const r = session.advance(hours);
        if (r.pending) set({ paused: true, pauseReason: 'ui.time.pausedForDecision' });
        return r;
      } catch (err) {
        fail('simError', err);
        set({ paused: true, pauseReason: 'ui.time.pausedForError' });
        console.error('[game] advance crashed the simulation', err);
        return null;
      }
    },

    setSpeed(speed) {
      set({ speed, paused: false, pauseReason: null });
    },

    stepSpeed(dir) {
      set((s) => ({ speed: stepSpeed(s.speed, dir) }));
    },

    setPaused(paused, reason = null) {
      set({ paused, pauseReason: paused ? reason : null });
    },

    togglePause() {
      set((s) => ({ paused: !s.paused, pauseReason: null }));
    },

    clearError() {
      set({ error: null });
    },

    setOrigin(origin) {
      set((s) => ({ origin: { ...s.origin, ...origin } }));
    },
  };
});

/** Selector over the current GameState; returns `fallback` while no game is loaded. */
export function useGameState<T>(selector: (state: GameState) => T, fallback: T): T;
export function useGameState<T>(selector: (state: GameState) => T): T | undefined;
export function useGameState<T>(selector: (state: GameState) => T, fallback?: T): T | undefined {
  return useGame((s) => (s.state ? selector(s.state) : fallback));
}

/** The pending decision, if any. */
export function usePending(): PendingDecision | null {
  return useGame((s) => s.state?.pending ?? null);
}
