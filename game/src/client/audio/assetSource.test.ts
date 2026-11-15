import { describe, expect, it } from 'vitest';
import type { AssetEntry } from '@content/schemas/assets';
import { AudioAssetSource, audioManifest, EMPTY_FINAL_INDEX, finalAssetUrl, kebabKey, loadFinalIndex, parseFinalIndex, voiceLinePath } from './assetSource';
import { buildAudioManifest } from './manifestSpec';

const entries: Record<string, AssetEntry> = {
  'music.track.duel': { kind: 'music', path: 'music/duel.ogg', loop: true, placeholder: { generator: 'audio.music' } },
  'music.sfx.ui.click': { kind: 'sfx', path: 'sfx/ui/click.ogg', placeholder: { generator: 'audio.sfx' } },
  'narrative.vo.intro': { kind: 'voice', path: 'voice/narrator/intro.ogg', lineKey: 'narrative.intro', voice: 'narrator', placeholder: { generator: 'tts' } },
  'narrative.vo.introSkald': { kind: 'voice', path: 'voice/skald/intro.ogg', lineKey: 'narrative.intro', voice: 'skald', placeholder: { generator: 'tts' } },
};

describe('final index parsing', () => {
  it('accepts a list of paths and ids', () => {
    const i = parseFinalIndex(['music/duel.ogg', 'music.sfx.ui.click', '/assets/sfx/sea/oars.ogg', 'public/assets/voice/npc/x.ogg']);
    expect([...i.paths].sort()).toEqual(['music/duel.ogg', 'sfx/sea/oars.ogg', 'voice/npc/x.ogg']);
    expect([...i.ids]).toEqual(['music.sfx.ui.click']);
  });

  it('accepts wrapper objects, id → path maps and entry objects', () => {
    expect([...parseFinalIndex({ version: 1, files: ['music/duel.ogg'] }).paths]).toEqual(['music/duel.ogg']);
    const map = parseFinalIndex({ assets: { 'music.track.duel': 'music/duel.ogg' } });
    expect([...map.ids]).toEqual(['music.track.duel']);
    expect([...map.paths]).toEqual(['music/duel.ogg']);
    const objs = parseFinalIndex({ entries: [{ id: 'music.track.duel', path: 'music/duel.ogg', status: 'final' }, { id: 'music.sfx.ui.click', path: 'sfx/ui/click.ogg', status: 'placeholder' }] });
    expect([...objs.ids]).toEqual(['music.track.duel']);
    expect([...objs.paths]).toEqual(['music/duel.ogg']);
  });

  it('ignores entries marked as not final, and garbage', () => {
    const i = parseFinalIndex({ 'music.track.duel': 'placeholder', 'music.sfx.ui.click': true, 'sfx/ui/coin.ogg': { final: false } });
    expect([...i.ids]).toEqual(['music.sfx.ui.click']);
    expect(i.paths.size).toBe(0);
    for (const junk of [null, 3, 'x', { generatedAt: '2026-10-31T10:00:00Z' }]) {
      const j = parseFinalIndex(junk);
      expect(j.paths.size + j.ids.size).toBe(0);
    }
  });

  it('loads the index over fetch and treats failures as absent', async () => {
    const ok = (body: string, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch;
    expect((await loadFinalIndex(ok('["music/duel.ogg"]'), '/')).paths.has('music/duel.ogg')).toBe(true);
    expect(await loadFinalIndex(ok('', 404), '/')).toBe(EMPTY_FINAL_INDEX);
    expect(await loadFinalIndex(ok('<!doctype html><html></html>'), '/')).toBe(EMPTY_FINAL_INDEX);
    expect(await loadFinalIndex(ok('{broken'), '/')).toBe(EMPTY_FINAL_INDEX);
    const throwing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await loadFinalIndex(throwing, '/')).toBe(EMPTY_FINAL_INDEX);
    expect(await loadFinalIndex(undefined, '/')).toBe(EMPTY_FINAL_INDEX);
  });
});

describe('AudioAssetSource', () => {
  it('prefers the final file when present, else the placeholder; unknown ids are missing', () => {
    const src = new AudioAssetSource(entries, parseFinalIndex(['music/duel.ogg']), '/game/');
    expect(src.resolve('music.track.duel')).toMatchObject({ status: 'final', url: '/game/assets/music/duel.ogg', path: 'music/duel.ogg' });
    expect(src.resolve('music.sfx.ui.click')).toMatchObject({ status: 'placeholder', path: 'sfx/ui/click.ogg' });
    expect(src.resolve('music.sfx.ui.click').url).toBeUndefined();
    expect(src.resolve('music.nope').status).toBe('missing');
    src.setIndex(parseFinalIndex(['music.sfx.ui.click']));
    expect(src.resolve('music.sfx.ui.click').status).toBe('final');
    expect(src.resolve('music.track.duel').status).toBe('placeholder');
  });

  it('finds voice lines by locale key, preferring the same voice, then the conventional path', () => {
    const src = new AudioAssetSource(entries, parseFinalIndex(['voice/narrator/intro.ogg', 'voice/skald/intro.ogg']), '/');
    expect(src.voiceLine('narrative.intro', 'skald')).toMatchObject({ status: 'final', id: 'narrative.vo.introSkald' });
    expect(src.voiceLine('narrative.intro', 'narrator')).toMatchObject({ status: 'final', id: 'narrative.vo.intro' });
    const conv = new AudioAssetSource(entries, parseFinalIndex([voiceLinePath('hub.greatHall.welcome', 'hirdmaster')]), '/');
    expect(conv.voiceLine('hub.greatHall.welcome', 'hirdmaster')).toMatchObject({ status: 'final', url: '/assets/voice/hirdmaster/hub-great-hall-welcome.ogg' });
    expect(conv.voiceLine('hub.greatHall.other', 'hirdmaster').status).toBe('placeholder');
  });

  it('kebab-cases keys into lower-case paths', () => {
    expect(kebabKey('hub.greatHall.title')).toBe('hub-great-hall-title');
    expect(kebabKey('music.sfx.sea.sailFlap')).toBe('music-sfx-sea-sail-flap');
    expect(voiceLinePath('narrative.prologue.line1', 'narrator')).toBe('voice/narrator/narrative-prologue-line1.ogg');
    expect(finalAssetUrl('music/a b.ogg', '/')).toBe('/assets/music/a%20b.ogg');
  });

  it('skips an invalid manifest fragment instead of failing all audio', () => {
    const { entries: merged, problems } = audioManifest({ music: buildAudioManifest(), hub: { 'hub.bad': { kind: 'nope' } } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/hub/);
    expect(Object.keys(merged).length).toBe(Object.keys(buildAudioManifest()).length);
  });
});
