/**
 * Wires the client services to the sim-event bus: notifications, narration/standing feeds,
 * auto-pause, autosave, and "set sail" auto-unpause when the scene becomes real-time. Installed once
 * at boot (main.tsx); tests install it around a core-only session.
 */
import type { GameMode } from '@sim/core/state';
import { useSettings } from '../settings/store';
import { getSaveManager, type SaveManager } from '../saves/saveManager';
import { autoPauseReason } from './autoPause';
import { AutosaveQueue, autosaveTrigger, shouldAutosave } from './autosave';
import { useFeeds } from './chronicleFeeds';
import { useGame } from './gameStore';
import { useNotifications } from './notifications';
import { onSimEvents } from './simEvents';

/** Game modes whose scene runs on the real-time clock by default (§7.2: the map). */
export const DEFAULT_REALTIME_MODES: readonly GameMode[] = ['map'];

export interface ServicesOptions {
  saveManager?: () => SaveManager;
  /** Override for which modes run in real time (default DEFAULT_REALTIME_MODES). */
  realtimeModes?: readonly string[];
}

/** Installs the services; returns the uninstall function. */
export function installGameServices(opts: ServicesOptions = {}): () => void {
  const realtimeModes = opts.realtimeModes ?? DEFAULT_REALTIME_MODES;
  // Autosaves are silent (§20: nothing on screen the player does not need); only a failure is announced.
  const autosaves = new AutosaveQueue(opts.saveManager ?? getSaveManager, () => {}, (err) => {
    console.error('[autosave] failed', err);
    useNotifications.getState().pushToast('ui.toast.autosaveFailed', { tone: 'danger' });
  });
  let lastMode: string | null = null;

  const off = onSimEvents((batch) => {
    const { events, state, origin } = batch;
    if (origin === 'startup') {
      useNotifications.getState().clear();
      useFeeds.getState().clear();
      lastMode = state.meta.mode;
    }
    useNotifications.getState().ingest(events, state.time.hour);
    useFeeds.getState().ingest(events, state.time.hour);

    const game = useGame.getState();
    // Entering a real-time scene (departure) starts the clock.
    const mode = state.meta.mode;
    if (origin !== 'startup' && mode !== lastMode && realtimeModes.includes(mode) && state.pending === null) game.setPaused(false);
    lastMode = mode;

    if (!useGame.getState().paused) {
      const reason = autoPauseReason(events, useSettings.getState().settings.gameplay.autoPause, state);
      if (reason) game.setPaused(true, reason);
    }

    const trigger = autosaveTrigger(batch);
    const session = game.session;
    if (trigger && session && shouldAutosave(trigger, useSettings.getState().settings.gameplay.autosave, state.meta.options.ironman === true)) {
      autosaves.request(session);
    }
  });
  return off;
}
