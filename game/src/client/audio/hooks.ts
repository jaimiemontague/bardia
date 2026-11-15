/**
 * React-facing audio API. Screens never construct audio objects; they declare what they want:
 *
 *   useMusicState('homeSkarn');                      // while mounted (stacked: the latest wins)
 *   useMusicIntensity(battlePressure);               // 0..1, adaptive stems
 *   useSfxLoop('sea.waves', { wind: 'strong' });     // ambience bed while mounted
 *   playSfx('ui.coin');                              // one-shot from an event handler
 *   const line = useSubtitle();                      // current narration subtitle (or undefined)
 *   sayLine({ key: 'narrative.arrival.fjord', voice: 'narrator' });
 *
 * `bootAudio()` (called once by the app shell) installs the gesture unlock and the settings bridge.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { t } from '@client/i18n/index';
import type { MusicRequest, SfxId, SfxParams, StingerId } from './catalog';
import { AudioManager, type AudioManagerOptions, type AudioStatus, type SfxHandle } from './audioManager';
import type { AudioSettings, AudioSettingsPatch } from './settings';
import { VoiceManager, type SayRequest, type SubtitleLine, type VoiceManagerOptions } from './voiceManager';

let audio: AudioManager | undefined;
let voice: VoiceManager | undefined;
let pendingOptions: AudioManagerOptions | undefined;
let pendingVoiceOptions: Partial<VoiceManagerOptions> | undefined;

/**
 * Sets the options of the audio singletons before their first use (tests inject fakes; the app may
 * pass a seed). Calling it after creation disposes and recreates them.
 */
export function configureAudio(options: AudioManagerOptions = {}, voiceOptions: Partial<VoiceManagerOptions> = {}): void {
  voice?.stopAll();
  audio?.dispose();
  audio = undefined;
  voice = undefined;
  pendingOptions = options;
  pendingVoiceOptions = voiceOptions;
}

/** The app-wide AudioManager (created on first use). */
export function getAudioManager(): AudioManager {
  audio ??= new AudioManager(pendingOptions);
  return audio;
}

/** The app-wide VoiceManager (formats lines with the client i18n). */
export function getVoiceManager(): VoiceManager {
  voice ??= new VoiceManager(getAudioManager(), { format: (key, vars) => t(key, vars), ...pendingVoiceOptions });
  return voice;
}

/** Plays a sound effect (one-shot or loop) by catalog id. */
export function playSfx<I extends SfxId>(id: I, params?: SfxParams<I>): SfxHandle {
  return getAudioManager().playSfx(id, params);
}

/** Plays a music stinger over the current music. */
export function playStinger(id: StingerId): void {
  getAudioManager().playStinger(id);
}

/** Queues a narration line (subtitle always; voice when available and enabled). */
export function sayLine(req: SayRequest): number {
  return getVoiceManager().say(req);
}

/**
 * Requests a music state while the component is mounted. Requests stack: the most recently mounted
 * requester wins, and unmounting returns to the one below (or the base music). `null`/`undefined`
 * withdraws the request without unmounting.
 */
export function useMusicState(state: MusicRequest | null | undefined): void {
  const token = useRef<number | undefined>(undefined);
  useEffect(() => {
    const m = getAudioManager();
    return () => {
      if (token.current !== undefined) m.popMusic(token.current);
      token.current = undefined;
    };
  }, []);
  useEffect(() => {
    const m = getAudioManager();
    if (state === null || state === undefined) {
      if (token.current !== undefined) m.popMusic(token.current);
      token.current = undefined;
      return;
    }
    if (token.current === undefined) token.current = m.pushMusic(state);
    else m.updateMusic(token.current, state);
  }, [state]);
}

/** Sets the music intensity (0..1) while mounted; `undefined` leaves it alone. */
export function useMusicIntensity(intensity: number | undefined): void {
  useEffect(() => {
    if (intensity !== undefined) getAudioManager().setIntensity(intensity);
  }, [intensity]);
}

/**
 * Keeps a looping sound effect playing while mounted and `enabled`. Changing the parameters
 * restarts it with a short crossfade.
 */
export function useSfxLoop<I extends SfxId>(id: I, params?: SfxParams<I>, enabled = true, fadeS = 0.6): void {
  const key = JSON.stringify(params ?? {});
  useEffect(() => {
    if (!enabled) return;
    const h = getAudioManager().playSfx(id, JSON.parse(key) as SfxParams<I>);
    return () => h.stop(fadeS);
  }, [id, key, enabled, fadeS]);
}

/** The audio status (re-renders on change). */
export function useAudioStatus(): AudioStatus {
  const m = getAudioManager();
  return useSyncExternalStore(
    (cb) => m.subscribe(cb),
    () => m.getStatus(),
    () => m.getStatus(),
  );
}

/** The audio settings and an updater. */
export function useAudioSettings(): [AudioSettings, (patch: AudioSettingsPatch) => void] {
  const status = useAudioStatus();
  return [status.settings, (patch) => getAudioManager().setSettings(patch)];
}

/** The narration subtitle currently presented (undefined between lines). */
export function useSubtitle(): SubtitleLine | undefined {
  const [line, setLine] = useState<SubtitleLine | undefined>(() => getVoiceManager().currentLine);
  useEffect(() => {
    const vm = getVoiceManager();
    setLine(vm.currentLine);
    return vm.onSubtitle((e) => setLine(e.type === 'start' ? e.line : vm.currentLine));
  }, []);
  return line;
}

/** Installs the first-gesture unlock while mounted (the app shell or the audio lab). */
export function useAudioAutoUnlock(): void {
  useEffect(() => getAudioManager().installAutoUnlock(), []);
}
