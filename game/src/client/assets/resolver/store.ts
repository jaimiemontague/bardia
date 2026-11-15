/**
 * Change notification and global settings for the asset library. React hooks subscribe here and
 * re-resolve when the final-file index loads, a composite finishes, a generator registers late, or
 * the watermark / force-placeholder settings change.
 */
import type { WatermarkMode } from '../svg/paint';

let version = 0;
const listeners = new Set<() => void>();

/** Bumps the version and notifies subscribers. */
export function notifyAssetsChanged(): void {
  version++;
  for (const l of [...listeners]) {
    try {
      l();
    } catch (err) {
      console.error('[assets] listener failed', err);
    }
  }
}

/** Subscribes to asset changes; returns the unsubscribe function. */
export function subscribeAssets(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Monotonic change counter (useSyncExternalStore snapshot). */
export function assetsVersion(): number {
  return version;
}

export interface AssetSettings {
  /** Label watermark drawn on placeholders (§27.3 "labelled"). */
  watermark: WatermarkMode;
  /** Ignore final files (gallery comparison, debugging). */
  forcePlaceholders: boolean;
  /** In dev builds, probe the server for a final file the index does not list yet. */
  devProbe: boolean;
}

const settings: AssetSettings = { watermark: 'off', forcePlaceholders: false, devProbe: true };

/** Current settings (read-only snapshot). */
export function getAssetSettings(): Readonly<AssetSettings> {
  return settings;
}

/** Updates settings and re-resolves every mounted asset. */
export function setAssetSettings(patch: Partial<AssetSettings>): void {
  let changed = false;
  for (const [k, v] of Object.entries(patch) as [keyof AssetSettings, AssetSettings[keyof AssetSettings]][]) {
    if (v !== undefined && settings[k] !== v) {
      (settings as unknown as Record<string, unknown>)[k] = v;
      changed = true;
    }
  }
  if (changed) notifyAssetsChanged();
}

/** Shorthand: the placeholder watermark mode. */
export function setPlaceholderWatermark(mode: WatermarkMode): void {
  setAssetSettings({ watermark: mode });
}
