/**
 * Audio settings (§25.8 Audio: master, music, SFX, ambience, voice; narration on/off; §25.7
 * separate volume sliders, narration speed, subtitles always available) and the pure bus math the
 * AudioManager applies to its WebAudio buses and to Howler-played final files alike.
 */
import { z } from 'zod';
import { BUS_IDS, type BusId, type OutputBus } from './catalog';

/** How narration lines are voiced when no final VO file exists (§26.6, §28.5). */
export const PLACEHOLDER_VOICE_MODES = ['off', 'tones', 'tts'] as const;
export type PlaceholderVoiceMode = (typeof PLACEHOLDER_VOICE_MODES)[number];

export interface AudioSettings {
  /** Slider positions 0..1 per bus (perceptual; see `sliderToGain`). */
  volumes: Record<BusId, number>;
  /** Global mute. */
  muted: boolean;
  /** Silence everything while the window is hidden or unfocused. */
  muteOnBlur: boolean;
  /** Lower music/ambience/SFX while a voice line plays (§28.4). */
  ducking: boolean;
  /** §25.8 "narration on/off": play voice-over at all (subtitles are emitted regardless). */
  narration: boolean;
  /** Placeholder voice for lines without final VO: silent, tone-coded murmur, or labelled TTS. Off by default. */
  placeholderVoice: PlaceholderVoiceMode;
  /** §25.7 narration speed multiplier (TTS rate and subtitle timing). */
  narrationSpeed: number;
}

export const NARRATION_SPEED_RANGE = [0.75, 1.5] as const;

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  volumes: { master: 0.8, music: 0.7, sfx: 0.8, ambience: 0.7, voice: 0.9 },
  muted: false,
  muteOnBlur: true,
  ducking: true,
  narration: true,
  placeholderVoice: 'off',
  narrationSpeed: 1,
};

const vol = z.number().finite().min(0).max(1).optional().catch(undefined);
const flag = z.boolean().optional().catch(undefined);

/** Lenient schema for persisted settings: every field optional, each bad value falls back to its default. */
export const AudioSettingsSchema = z
  .object({
    volumes: z
      .object({ master: vol, music: vol, sfx: vol, ambience: vol, voice: vol })
      .strip()
      .optional()
      .catch(undefined),
    muted: flag,
    muteOnBlur: flag,
    ducking: flag,
    narration: flag,
    placeholderVoice: z.enum(PLACEHOLDER_VOICE_MODES).optional().catch(undefined),
    narrationSpeed: z.number().finite().min(NARRATION_SPEED_RANGE[0]).max(NARRATION_SPEED_RANGE[1]).optional().catch(undefined),
  })
  .strip();

/** A partial settings change (volumes may be partial too). */
export type AudioSettingsPatch = Partial<Omit<AudioSettings, 'volumes'>> & { volumes?: Partial<Record<BusId, number>> };

/** Applies a patch, clamping volumes to 0..1 and the narration speed to its range. */
export function mergeAudioSettings(base: AudioSettings, patch: AudioSettingsPatch): AudioSettings {
  const volumes = { ...base.volumes };
  for (const b of BUS_IDS) {
    const v = patch.volumes?.[b];
    if (typeof v === 'number' && Number.isFinite(v)) volumes[b] = clamp01(v);
  }
  const speed = patch.narrationSpeed ?? base.narrationSpeed;
  return {
    volumes,
    muted: patch.muted ?? base.muted,
    muteOnBlur: patch.muteOnBlur ?? base.muteOnBlur,
    ducking: patch.ducking ?? base.ducking,
    narration: patch.narration ?? base.narration,
    placeholderVoice: patch.placeholderVoice ?? base.placeholderVoice,
    narrationSpeed: Math.min(NARRATION_SPEED_RANGE[1], Math.max(NARRATION_SPEED_RANGE[0], Number.isFinite(speed) ? speed : 1)),
  };
}

/** Parses stored settings (unknown JSON) onto the defaults; anything invalid is ignored. */
export function parseAudioSettings(raw: unknown): AudioSettings {
  const parsed = AudioSettingsSchema.safeParse(raw);
  if (!parsed.success) return { ...DEFAULT_AUDIO_SETTINGS, volumes: { ...DEFAULT_AUDIO_SETTINGS.volumes } };
  const d = parsed.data;
  const patch: AudioSettingsPatch = {};
  if (d.volumes) {
    const volumes: Partial<Record<BusId, number>> = {};
    for (const b of BUS_IDS) {
      const v = d.volumes[b];
      if (v !== undefined) volumes[b] = v;
    }
    patch.volumes = volumes;
  }
  if (d.muted !== undefined) patch.muted = d.muted;
  if (d.muteOnBlur !== undefined) patch.muteOnBlur = d.muteOnBlur;
  if (d.ducking !== undefined) patch.ducking = d.ducking;
  if (d.narration !== undefined) patch.narration = d.narration;
  if (d.placeholderVoice !== undefined) patch.placeholderVoice = d.placeholderVoice;
  if (d.narrationSpeed !== undefined) patch.narrationSpeed = d.narrationSpeed;
  return mergeAudioSettings(DEFAULT_AUDIO_SETTINGS, patch);
}

const STORAGE_KEY = 'bardia.audio.settings.v1';

/** Loads settings from localStorage (defaults when absent, blocked or corrupt). */
export function loadAudioSettings(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): AudioSettings {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    return parseAudioSettings(text ? JSON.parse(text) : undefined);
  } catch {
    return parseAudioSettings(undefined);
  }
}

/** Saves settings to localStorage (silently ignored when storage is unavailable). */
export function saveAudioSettings(settings: AudioSettings, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage blocked or full: settings stay in memory */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// Bus math

/** Exponent of the volume-slider curve (square law: a standard perceptual fader). */
export const SLIDER_EXPONENT = 2;

/** Ducking depth per bus while a voice line plays (dB). Voice itself is never ducked. */
export const DUCK_DB: Readonly<Record<OutputBus, number>> = { music: -12, ambience: -9, sfx: -5, voice: 0 };
/** Ducking attack / release times (seconds). */
export const DUCK_ATTACK_S = 0.25;
export const DUCK_RELEASE_S = 0.9;

function clamp01(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

/** Decibels → linear gain. */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/** Linear gain → decibels (−Infinity for 0). */
export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}

/**
 * Perceptual slider curve (square law): 0 is silence, 1 is unity; 0.8 ≈ −3.9 dB, 0.5 ≈ −12 dB,
 * 0.1 = −40 dB. Monotonic, and gentle enough that the default positions stay loud enough.
 */
export function sliderToGain(position: number): number {
  const p = clamp01(position);
  return p === 0 ? 0 : p ** SLIDER_EXPONENT;
}

/** master × bus slider gain (0 when muted). */
export function busGain(settings: AudioSettings, bus: OutputBus): number {
  if (settings.muted) return 0;
  return sliderToGain(settings.volumes.master) * sliderToGain(settings.volumes[bus]);
}

/** The ducking multiplier for a bus (1 when no voice is playing or ducking is off). */
export function duckGain(settings: AudioSettings, bus: OutputBus, voiceActive: boolean): number {
  if (!voiceActive || !settings.ducking) return 1;
  return dbToGain(DUCK_DB[bus]);
}

/** Runtime conditions that change the effective gain. */
export interface BusConditions {
  /** A voice line is playing (ducking). */
  voiceActive: boolean;
  /** The window is hidden/unfocused. */
  blurred: boolean;
}

/** The gain a sound on `bus` finally gets: master × bus × ducking × blur mute. */
export function effectiveGain(settings: AudioSettings, bus: OutputBus, conditions: BusConditions): number {
  if (conditions.blurred && settings.muteOnBlur) return 0;
  return busGain(settings, bus) * duckGain(settings, bus, conditions.voiceActive);
}
