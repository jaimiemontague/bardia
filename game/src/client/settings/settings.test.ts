// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultBindings } from '../input/bindings';
import { applySettingsToDocument } from './apply';
import { defaultSettings, parseSettings } from './schema';
import { firstRunSettings, loadStoredSettings, reloadSettingsFromStorage, setAudioSink, STORAGE_KEY, useSettings } from './store';

afterEach(() => {
  localStorage.clear();
  useSettings.getState().reset();
  vi.unstubAllGlobals();
});

describe('first-run settings', () => {
  it('follow the OS reduced-motion and more-contrast preferences until the player saves settings', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduced-motion') || q.includes('contrast'), media: q }));
    localStorage.clear();
    expect(firstRunSettings().accessibility.reducedMotion).toBe(true);
    expect(firstRunSettings().accessibility.highContrast).toBe(true);
    expect(loadStoredSettings().accessibility.reducedMotion).toBe(true);
    // Saved settings win over the OS.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ accessibility: { reducedMotion: false } }));
    expect(loadStoredSettings().accessibility.reducedMotion).toBe(false);
    expect(loadStoredSettings().accessibility.highContrast).toBe(false);
  });

  it('are the factory defaults where matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(firstRunSettings()).toEqual(defaultSettings());
  });
});

describe('settings schema (§25.7, §25.8)', () => {
  it('fills every default and clamps ranges', () => {
    const s = parseSettings({ video: { uiScale: 300 }, accessibility: { textSize: 10 } });
    expect(s.video.uiScale).toBe(150);
    expect(s.accessibility.textSize).toBe(90);
    expect(s.audio.master).toBe(defaultSettings().audio.master);
    expect(s.gameplay.autoPause.critical).toBe(true);
  });

  it('recovers field by field from corrupt or old data', () => {
    const s = parseSettings({ video: 'broken', audio: { music: 'loud', sfx: 42 }, accessibility: { colorBlind: 'purple', font: 'hyperlegible' }, junk: 1 });
    expect(s.video).toEqual(defaultSettings().video);
    expect(s.audio.music).toBe(defaultSettings().audio.music);
    expect(s.audio.sfx).toBe(42);
    expect(s.accessibility.colorBlind).toBe('none');
    expect(s.accessibility.font).toBe('hyperlegible');
    expect(parseSettings(null)).toEqual(defaultSettings());
  });

  it('keeps known bindings, normalises combos and drops unknown actions', () => {
    const s = parseSettings({ controls: { bindings: { 'open.codex': ['Shift + Ctrl+KeyH', 7], ghost: ['KeyX'] } } });
    expect(s.controls.bindings['open.codex']).toEqual(['Ctrl+Shift+KeyH']);
    expect(s.controls.bindings.ghost).toBeUndefined();
    expect(s.controls.bindings['time.togglePause']).toEqual(defaultBindings()['time.togglePause']);
  });
});

describe('settings store', () => {
  it('persists changes to localStorage and reloads them', () => {
    useSettings.getState().update({ accessibility: { textSize: 130 } });
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { accessibility?: { textSize?: number } };
    expect(raw.accessibility?.textSize).toBe(130);
    useSettings.setState({ settings: defaultSettings() });
    reloadSettingsFromStorage();
    expect(useSettings.getState().settings.accessibility.textSize).toBe(130);
    expect(useSettings.getState().settings.accessibility.font).toBe('standard');
  });

  it('resets one section without touching the others', () => {
    useSettings.getState().update({ accessibility: { highContrast: true }, video: { uiScale: 125 } });
    useSettings.getState().reset('accessibility');
    expect(useSettings.getState().settings.accessibility.highContrast).toBe(false);
    expect(useSettings.getState().settings.video.uiScale).toBe(125);
  });

  it('calls the audio placeholder callback with the current volumes and on change', () => {
    const calls: number[] = [];
    setAudioSink((a) => calls.push(a.music));
    useSettings.getState().update({ audio: { music: 33 } });
    useSettings.getState().update({ video: { uiScale: 110 } });
    setAudioSink(null);
    expect(calls).toEqual([defaultSettings().audio.music, 33]);
  });

  it('applies visual settings to <html> as variables and data attributes', () => {
    const s = parseSettings({ video: { uiScale: 125, theme: 'parchment' }, accessibility: { textSize: 140, highContrast: true, font: 'hyperlegible', colorBlind: 'tritanopia', reducedMotion: true } });
    applySettingsToDocument(s);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--ui-scale')).toBe('1.25');
    expect(root.style.getPropertyValue('--text-scale')).toBe('1.4');
    expect(root.dataset).toMatchObject({ theme: 'parchment', contrast: 'high', font: 'hyperlegible', cb: 'tritanopia', motion: 'reduced' });
  });
});
