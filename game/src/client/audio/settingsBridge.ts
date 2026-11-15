/**
 * Bridge between the shared player settings (src/client/settings: §25.8 Audio volumes 0–100 and
 * narration on/off, §25.7 narration speed) and the AudioManager's own settings (which add mute,
 * mute-on-blur, ducking and the placeholder voice). The settings store owns the shared fields; the
 * manager follows them through `setAudioSink`, and changes made through the manager (the audio lab)
 * are written back so both stay in sync.
 */
import type { Settings } from '@client/settings/schema';
import { setAudioSink, useSettings } from '@client/settings/store';
import { BUS_IDS, type BusId } from './catalog';
import type { AudioManager } from './audioManager';
import type { AudioSettings, AudioSettingsPatch } from './settings';

/** §25.7 narration speed choices → speech-rate multiplier ('instant' plays as fast as is intelligible). */
export const NARRATION_SPEED_FACTORS: Readonly<Record<Settings['accessibility']['narrationSpeed'], number>> = {
  slow: 0.8,
  normal: 1,
  fast: 1.25,
  instant: 1.5,
};

/** The audio-settings patch implied by the shared settings. */
export function patchFromClientSettings(s: { audio: Settings['audio']; accessibility?: Pick<Settings['accessibility'], 'narrationSpeed'> }): AudioSettingsPatch {
  const volumes: Partial<Record<BusId, number>> = {};
  for (const b of BUS_IDS) volumes[b] = Math.min(100, Math.max(0, s.audio[b])) / 100;
  const patch: AudioSettingsPatch = { volumes, narration: s.audio.narration };
  if (s.accessibility) patch.narrationSpeed = NARRATION_SPEED_FACTORS[s.accessibility.narrationSpeed] ?? 1;
  return patch;
}

/** The shared audio section implied by the manager's settings (volumes as whole percent). */
export function clientAudioFromSettings(a: AudioSettings): Settings['audio'] {
  return {
    master: Math.round(a.volumes.master * 100),
    music: Math.round(a.volumes.music * 100),
    sfx: Math.round(a.volumes.sfx * 100),
    ambience: Math.round(a.volumes.ambience * 100),
    voice: Math.round(a.volumes.voice * 100),
    narration: a.narration,
  };
}

function sameAudio(a: Settings['audio'], b: Settings['audio']): boolean {
  return a.master === b.master && a.music === b.music && a.sfx === b.sfx && a.ambience === b.ambience && a.voice === b.voice && a.narration === b.narration;
}

/** Connects a manager to the settings store (both directions). Returns the disconnect function. */
export function connectAudioSettings(manager: AudioManager): () => void {
  let applying = false;
  const apply = (audio: Settings['audio']) => {
    applying = true;
    try {
      manager.setSettings(patchFromClientSettings({ audio, accessibility: useSettings.getState().settings.accessibility }));
    } finally {
      applying = false;
    }
  };
  setAudioSink(apply);
  let lastSpeed = useSettings.getState().settings.accessibility.narrationSpeed;
  const offSpeed = useSettings.subscribe((s) => {
    const speed = s.settings.accessibility.narrationSpeed;
    if (speed === lastSpeed) return;
    lastSpeed = speed;
    manager.setSettings({ narrationSpeed: NARRATION_SPEED_FACTORS[speed] ?? 1 });
  });
  const offManager = manager.subscribe(() => {
    if (applying) return;
    const want = clientAudioFromSettings(manager.settings);
    const have = useSettings.getState().settings.audio;
    if (!sameAudio(want, have)) useSettings.getState().update({ audio: want });
  });
  return () => {
    setAudioSink(null);
    offSpeed();
    offManager();
  };
}
