/**
 * One-call audio start-up for the app shell (main.tsx):
 *
 *   const stopAudio = bootAudio();   // gesture unlock + settings bridge + sim-event stingers
 *
 * Each part is optional so the integrator can wire them separately.
 */
import { getAudioManager } from './hooks';
import { connectAudioSettings } from './settingsBridge';
import { installSimAudioCues } from './simCues';

export interface BootAudioOptions {
  /** Unlock audio on the first pointer/key gesture (default true). */
  autoUnlock?: boolean;
  /** Follow the shared player settings store (default true). */
  settings?: boolean;
  /** Play stingers/cues for sim events (default true). */
  simCues?: boolean;
}

/** Starts the audio services; returns a function that uninstalls them. */
export function bootAudio(opts: BootAudioOptions = {}): () => void {
  const audio = getAudioManager();
  const offs: (() => void)[] = [];
  if (opts.autoUnlock !== false) offs.push(audio.installAutoUnlock());
  if (opts.settings !== false) offs.push(connectAudioSettings(audio));
  if (opts.simCues !== false) offs.push(installSimAudioCues(audio));
  return () => {
    for (const off of offs.reverse()) off();
  };
}
