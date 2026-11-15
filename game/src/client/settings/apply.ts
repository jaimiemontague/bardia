/**
 * Applies visual settings to the document root as data attributes and CSS custom properties, so
 * every component (and the Pixi renderers, via getComputedStyle) follows them without props:
 *
 *   --ui-scale, --text-scale          numbers (1 = 100 %)
 *   data-theme="oak|parchment"        surface palette
 *   data-contrast="high"              high-contrast UI
 *   data-font="standard|hyperlegible" body/display fonts
 *   data-cb="none|deuteranopia|…"     colour-blind palette (--cb-* and --faction-* variables)
 *   data-motion="reduced|full"        reduced motion (animations/transitions off)
 */
import type { Settings } from './schema';

/** Writes the settings to `root` (default: document.documentElement). */
export function applySettingsToDocument(settings: Settings, root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement): void {
  if (!root) return;
  root.style.setProperty('--ui-scale', String(settings.video.uiScale / 100));
  root.style.setProperty('--text-scale', String(settings.accessibility.textSize / 100));
  root.dataset.theme = settings.video.theme;
  root.dataset.contrast = settings.accessibility.highContrast ? 'high' : 'normal';
  root.dataset.font = settings.accessibility.font;
  root.dataset.cb = settings.accessibility.colorBlind;
  root.dataset.motion = settings.accessibility.reducedMotion ? 'reduced' : 'full';
  root.lang = settings.language;
}

/** Enters/leaves browser fullscreen to match the setting (best effort; needs a user gesture). */
export function syncFullscreen(want: boolean): void {
  if (typeof document === 'undefined') return;
  const isFull = document.fullscreenElement !== null && document.fullscreenElement !== undefined;
  try {
    if (want && !isFull) void document.documentElement.requestFullscreen?.().catch(() => {});
    else if (!want && isFull) void document.exitFullscreen?.().catch(() => {});
  } catch {
    // Fullscreen is unavailable (iframes, tests).
  }
}
