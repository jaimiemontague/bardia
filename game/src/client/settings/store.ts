/**
 * The settings store (zustand). Persists to localStorage under STORAGE_KEY on every change and
 * applies the visual settings to <html> (see apply.ts). Other client agents read settings with
 * `useSettings(selector)` or subscribe outside React with `useSettings.subscribe(...)`.
 *
 * Audio: the audio agent registers its mixer with `setAudioSink(fn)`; until then the sink is a
 * no-op placeholder. The sink receives the full audio settings on registration and on every change.
 */
import { create } from 'zustand';
import { parseSettings, defaultSettings, type AudioSettings, type Settings } from './schema';

export const STORAGE_KEY = 'bardia.settings.v1';

/** Deep-partial patch for `update`. */
export type SettingsPatch = { [K in keyof Settings]?: Settings[K] extends object ? Partial<Settings[K]> : Settings[K] };

export interface SettingsStore {
  settings: Settings;
  /** Merges a (one level deep) patch, validates and persists. */
  update(patch: SettingsPatch): void;
  /** Replaces one section field with a callback (for nested values such as autoPause). */
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
  /** Restores defaults for one section, or everything. */
  reset(section?: keyof Settings): void;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Whether a CSS media query matches (false where matchMedia is unavailable). */
function mediaMatches(query: string): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia(query).matches;
  } catch {
    return false;
  }
}

/**
 * First-run defaults: factory settings adjusted to the operating system's accessibility
 * preferences (reduced motion, more contrast). Once the player has saved settings these never
 * override them.
 */
export function firstRunSettings(): Settings {
  const d = defaultSettings();
  return parseSettings({
    ...d,
    accessibility: {
      ...d.accessibility,
      reducedMotion: mediaMatches('(prefers-reduced-motion: reduce)'),
      highContrast: mediaMatches('(prefers-contrast: more)'),
    },
  });
}

/** Reads persisted settings (first-run defaults when absent or unreadable). */
export function loadStoredSettings(): Settings {
  const s = storage();
  if (!s) return firstRunSettings();
  try {
    const raw = s.getItem(STORAGE_KEY);
    return raw ? parseSettings(JSON.parse(raw) as unknown) : firstRunSettings();
  } catch {
    return firstRunSettings();
  }
}

function persist(settings: Settings): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Quota or privacy mode: settings still apply for this session.
  }
}

function mergeSection<T>(current: T, patch: unknown): T {
  if (patch === undefined) return current;
  if (current !== null && typeof current === 'object' && !Array.isArray(current) && patch !== null && typeof patch === 'object' && !Array.isArray(patch)) {
    return { ...current, ...(patch as object) } as T;
  }
  return patch as T;
}

export const useSettings = create<SettingsStore>()((set, get) => ({
  settings: loadStoredSettings(),
  update(patch) {
    const cur = get().settings;
    const next: Record<string, unknown> = { ...cur };
    for (const [k, v] of Object.entries(patch)) next[k] = mergeSection((cur as Record<string, unknown>)[k], v);
    const settings = parseSettings(next);
    persist(settings);
    set({ settings });
  },
  set(key, value) {
    const settings = parseSettings({ ...get().settings, [key]: value });
    persist(settings);
    set({ settings });
  },
  reset(sectionKey) {
    const defaults = defaultSettings();
    const settings = sectionKey ? parseSettings({ ...get().settings, [sectionKey]: defaults[sectionKey] }) : defaults;
    persist(settings);
    set({ settings });
  },
}));

/** Re-reads localStorage (tests, or another tab changed settings). */
export function reloadSettingsFromStorage(): void {
  useSettings.setState({ settings: loadStoredSettings() });
}

// ---------------------------------------------------------------------------------------------
// Audio placeholder callback.

export type AudioSink = (audio: AudioSettings) => void;
let audioSink: AudioSink = () => {};
let lastAudioJson = JSON.stringify(useSettings.getState().settings.audio);

/** Registers the audio mixer callback (replaces the placeholder) and pushes the current values. */
export function setAudioSink(sink: AudioSink | null): void {
  audioSink = sink ?? (() => {});
  audioSink(useSettings.getState().settings.audio);
}

useSettings.subscribe((s) => {
  const json = JSON.stringify(s.settings.audio);
  if (json !== lastAudioJson) {
    lastAudioJson = json;
    audioSink(s.settings.audio);
  }
});
