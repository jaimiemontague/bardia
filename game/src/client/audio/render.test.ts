import { describe, expect, it } from 'vitest';
import { buildAudioManifest } from './manifestSpec';
import { defaultRenderSeconds, renderPlaceholder, specFromRecipe } from './render';
import { TestAudioContext } from './testFakes';

const offline = (channels: number, length: number, sampleRate: number) => {
  void channels;
  void length;
  return new TestAudioContext(sampleRate) as unknown as OfflineAudioContext;
};

describe('placeholder generators', () => {
  it('every audio manifest entry has a placeholder recipe the generators understand', () => {
    for (const [id, e] of Object.entries(buildAudioManifest())) {
      const spec = specFromRecipe(e.placeholder.generator, e.placeholder.params ?? {}, e.placeholder.label);
      expect(spec, id).toBeDefined();
      if (spec) expect(defaultRenderSeconds(spec)).toBeGreaterThan(0);
    }
  });

  it('rejects recipes with unknown generators or params', () => {
    expect(specFromRecipe('audio.music', { state: 'nope' })).toBeUndefined();
    expect(specFromRecipe('panorama', {})).toBeUndefined();
    expect(specFromRecipe('audio.sfx', { sfx: 'ui.nope' })).toBeUndefined();
  });

  it('renders every kind offline without errors', async () => {
    const specs = [
      { kind: 'music', state: 'corvaine' },
      { kind: 'stem', state: 'battleRaid', level: 'high' },
      { kind: 'stinger', id: 'birth' },
      { kind: 'sfx', id: 'sea.waves', params: { wind: 'strong' } },
      { kind: 'sfx', id: 'battle.warHorn', params: { call: 'charge' } },
      { kind: 'voice', role: 'seer', text: 'The birds flew west.' },
    ] as const;
    for (const spec of specs) {
      const buf = await renderPlaceholder(spec, { seconds: 4, sampleRate: 8000, createOffline: offline });
      expect(buf.sampleRate).toBe(8000);
    }
  });
});
