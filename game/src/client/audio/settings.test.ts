import { describe, expect, it } from 'vitest';
import { OUTPUT_BUSES } from './catalog';
import {
  busGain,
  dbToGain,
  DEFAULT_AUDIO_SETTINGS,
  DUCK_DB,
  duckGain,
  effectiveGain,
  gainToDb,
  loadAudioSettings,
  mergeAudioSettings,
  parseAudioSettings,
  saveAudioSettings,
  sliderToGain,
} from './settings';

const base = () => mergeAudioSettings(DEFAULT_AUDIO_SETTINGS, {});

describe('bus math', () => {
  it('slider curve: 0 is silent, 1 is unity, monotonic square law', () => {
    expect(sliderToGain(0)).toBe(0);
    expect(sliderToGain(1)).toBe(1);
    expect(sliderToGain(-3)).toBe(0);
    expect(sliderToGain(7)).toBe(1);
    let prev = 0;
    for (let p = 0.01; p <= 1.0001; p += 0.01) {
      const g = sliderToGain(p);
      expect(g).toBeGreaterThan(prev);
      prev = g;
    }
    expect(sliderToGain(0.5)).toBeCloseTo(0.25, 12);
    expect(gainToDb(sliderToGain(0.8))).toBeCloseTo(-3.88, 2);
    expect(gainToDb(sliderToGain(0.1))).toBeCloseTo(-40, 6);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
    expect(gainToDb(0)).toBe(-Infinity);
  });

  it('bus gain = master × bus; mute zeroes everything', () => {
    const s = mergeAudioSettings(base(), { volumes: { master: 0.5, music: 0.8 } });
    expect(busGain(s, 'music')).toBeCloseTo(sliderToGain(0.5) * sliderToGain(0.8), 12);
    expect(busGain(mergeAudioSettings(s, { volumes: { master: 0 } }), 'music')).toBe(0);
    expect(busGain(mergeAudioSettings(s, { volumes: { music: 1, master: 1 } }), 'music')).toBe(1);
    const muted = mergeAudioSettings(s, { muted: true });
    for (const b of OUTPUT_BUSES) expect(busGain(muted, b)).toBe(0);
  });

  it('ducks every bus but voice while a voice line plays (when enabled)', () => {
    const s = base();
    for (const b of OUTPUT_BUSES) {
      expect(duckGain(s, b, false)).toBe(1);
      expect(duckGain(s, b, true)).toBeCloseTo(dbToGain(DUCK_DB[b]), 12);
    }
    expect(duckGain(s, 'voice', true)).toBe(1);
    expect(duckGain(s, 'music', true)).toBeLessThan(0.3);
    expect(duckGain(mergeAudioSettings(s, { ducking: false }), 'music', true)).toBe(1);
  });

  it('mutes on blur only when the option is on', () => {
    const s = base();
    expect(effectiveGain(s, 'sfx', { voiceActive: false, blurred: true })).toBe(0);
    const keep = mergeAudioSettings(s, { muteOnBlur: false });
    expect(effectiveGain(keep, 'sfx', { voiceActive: false, blurred: true })).toBeCloseTo(busGain(keep, 'sfx'), 12);
    expect(effectiveGain(s, 'music', { voiceActive: true, blurred: false })).toBeCloseTo(busGain(s, 'music') * dbToGain(DUCK_DB.music), 12);
  });
});

describe('settings parsing and persistence', () => {
  it('merges patches with clamping', () => {
    const s = mergeAudioSettings(base(), { volumes: { sfx: 3, voice: -1 }, narrationSpeed: 9 });
    expect(s.volumes.sfx).toBe(1);
    expect(s.volumes.voice).toBe(0);
    expect(s.narrationSpeed).toBe(1.5);
    expect(s.volumes.master).toBe(DEFAULT_AUDIO_SETTINGS.volumes.master);
  });

  it('recovers field by field from bad stored data', () => {
    const s = parseAudioSettings({ volumes: { master: 'loud', music: 0.3 }, muted: 'yes', placeholderVoice: 'robot', narrationSpeed: 1.2, extra: 1 });
    expect(s.volumes.master).toBe(DEFAULT_AUDIO_SETTINGS.volumes.master);
    expect(s.volumes.music).toBe(0.3);
    expect(s.muted).toBe(false);
    expect(s.placeholderVoice).toBe('off');
    expect(s.narrationSpeed).toBe(1.2);
    expect(parseAudioSettings(42)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings(undefined)).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it('placeholder voice is off by default (opt-in TTS)', () => {
    expect(DEFAULT_AUDIO_SETTINGS.placeholderVoice).toBe('off');
  });

  it('round-trips through storage and survives broken storage', () => {
    const store: Record<string, string> = {};
    const storage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) };
    const s = mergeAudioSettings(base(), { volumes: { music: 0.25 }, ducking: false, placeholderVoice: 'tones' });
    saveAudioSettings(s, storage);
    expect(loadAudioSettings(storage)).toEqual(s);
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(loadAudioSettings(broken)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(() => saveAudioSettings(s, broken)).not.toThrow();
    expect(loadAudioSettings({ getItem: () => '{not json' })).toEqual(DEFAULT_AUDIO_SETTINGS);
  });
});
