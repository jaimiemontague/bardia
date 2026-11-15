import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AssetEntry } from '@content/schemas/assets';
import { clearAssetCache, finalAssetUrl, paramsKey, resolveAsset, resolveAssetAsync, setCompositeFetchForTests } from './resolver/resolve';
import { findFinalFile, loadFinalIndex, parseFinalIndex, resetFinalIndex, setFinalIndex, finalIndexStatus, getFinalIndex } from './resolver/finalIndex';
import { setManifestForTests } from './resolver/manifest';
import { setAssetSettings, subscribeAssets } from './resolver/store';
import * as resolverEntry from './resolver/index';
import { portraitLayerPlan, decidePortraitLook, portraitParamsFrom } from './generators/portrait';

const ENTRIES: Record<string, AssetEntry> = {
  'hub.test.icon': { kind: 'image', path: 'hub/silver.png', size: [64, 64], placeholder: { generator: 'icon', params: { glyph: 'silver' }, label: 'Silver' } },
  'hub.test.panorama': { kind: 'image', path: 'hub/pano.png', size: [800, 450], placeholder: { generator: 'panorama', params: { culture: 'skarn' } } },
  'hub.test.unknownGen': { kind: 'image', path: 'hub/x.png', size: [100, 60], placeholder: { generator: 'doesNotExist' } },
  'hub.test.music': { kind: 'music', path: 'music/hall.ogg', durationS: 60, loop: true, placeholder: { generator: 'audio.none' } },
  'hub.test.strip': { kind: 'image', path: 'hub/strip.png', size: [32, 32], frames: 4, placeholder: { generator: 'unitSprite', params: { kind: 'axe', anim: 'walk' } } },
  'portraits.character': { kind: 'image', path: 'portraits/character.png', size: [512, 640], placeholder: { generator: 'portrait' } },
};

beforeEach(() => {
  setManifestForTests(ENTRIES);
  resetFinalIndex();
  setAssetSettings({ watermark: 'off', forcePlaceholders: false, devProbe: false });
  clearAssetCache();
});

afterEach(() => {
  setManifestForTests(undefined);
  setCompositeFetchForTests(undefined);
  resetFinalIndex();
  clearAssetCache();
});

describe('resolveAsset without final files', () => {
  it('renders the placeholder named by the manifest, deterministically', () => {
    const a = resolveAsset('hub.test.icon');
    expect(a.status).toBe('placeholder');
    expect(a.registered).toBe(true);
    expect(a.url.startsWith('data:image/svg+xml')).toBe(true);
    expect(a).toMatchObject({ width: 64, height: 64, path: 'hub/silver.png', generator: 'icon' });
    clearAssetCache();
    expect(resolveAsset('hub.test.icon').url).toBe(a.url);
  });

  it('merges caller params over manifest params', () => {
    const a = resolveAsset('hub.test.icon');
    const b = resolveAsset('hub.test.icon', { glyph: 'honor' });
    expect(b.url).not.toBe(a.url);
    expect(resolveAsset('hub.test.icon', { glyph: 'honor' })).toBe(b); // cached
    expect(paramsKey({ b: 1, a: 'x' })).toBe(paramsKey({ a: 'x', b: 1 }));
  });

  it('labels missing ids and unknown generators instead of throwing', () => {
    const m = resolveAsset('hub.nope.missing');
    expect(m).toMatchObject({ status: 'missing', registered: false });
    expect(decodeURIComponent(m.url)).toContain('hub.nope.missing');
    const u = resolveAsset('hub.test.unknownGen');
    expect(u.status).toBe('placeholder');
    expect(decodeURIComponent(u.url)).toContain('doesNotExist');
  });

  it('keeps sprite-strip metadata', () => {
    const s = resolveAsset('hub.test.strip');
    expect(s.frames).toBe(4);
    expect(decodeURIComponent(s.url)).toContain('width="128"');
  });

  it('leaves audio placeholders to the audio system', async () => {
    const a = resolveAsset('hub.test.music');
    expect(a).toMatchObject({ kind: 'music', status: 'placeholder', url: '' });
    expect((await resolveAssetAsync('hub.test.music')).url).toBe('');
  });

  it('draws the watermark when enabled', () => {
    setAssetSettings({ watermark: 'corner' });
    expect(decodeURIComponent(resolveAsset('hub.test.icon').url)).toContain('Silver');
  });
});

describe('resolveAsset with final files', () => {
  it('prefers the final file and busts caches by hash', () => {
    const notified: number[] = [];
    const off = subscribeAssets(() => notified.push(1));
    const before = resolveAsset('hub.test.icon');
    setFinalIndex({ format: 1, files: { 'hub/silver.png': { bytes: 10, hash: 'abc123', width: 64, height: 64 } } });
    off();
    expect(notified.length).toBeGreaterThan(0);
    const after = resolveAsset('hub.test.icon');
    expect(after.status).toBe('final');
    expect(after.url).toBe('/assets/hub/silver.png?v=abc123');
    expect(after.url).not.toBe(before.url);
    expect(finalAssetUrl('hub.test.icon')).toBe('/assets/hub/silver.png?v=abc123');
  });

  it('accepts another format at the same stem', () => {
    setFinalIndex({ format: 1, files: { 'hub/silver.webp': { bytes: 10, hash: 'h' }, 'music/hall.mp3': { bytes: 5, hash: 'm' } } });
    expect(resolveAsset('hub.test.icon').url).toBe('/assets/hub/silver.webp?v=h');
    expect(resolveAsset('hub.test.music')).toMatchObject({ status: 'final', url: '/assets/music/hall.mp3?v=m' });
    expect(findFinalFile('hub/silver.png', 'image')?.path).toBe('hub/silver.webp');
  });

  it('can be forced back to placeholders (globally or per call)', () => {
    setFinalIndex({ format: 1, files: { 'hub/silver.png': { bytes: 10, hash: 'a' } } });
    expect(resolveAsset('hub.test.icon', undefined, { placeholderOnly: true }).status).toBe('placeholder');
    setAssetSettings({ forcePlaceholders: true });
    expect(resolveAsset('hub.test.icon').status).toBe('placeholder');
    expect(finalAssetUrl('hub.test.icon')).toBeUndefined();
  });

  it('grades a final panorama to the requested season and time', () => {
    setFinalIndex({ format: 1, files: { 'hub/pano.png': { bytes: 10, hash: 'p' } } });
    expect(resolveAsset('hub.test.panorama', { season: 'winter', time: 'night' }).filter).toContain('brightness');
    expect(resolveAsset('hub.test.panorama', { season: 'summer', time: 'day' }).filter).toBeUndefined();
  });

  it('composes portraits from final layer pieces', async () => {
    const params = { seed: 77, culture: 'skarn', sex: 'male', age: 40 };
    const plan = portraitLayerPlan(decidePortraitLook(portraitParamsFrom(params)));
    const face = plan.find((l) => l.slot === 'face');
    expect(face).toBeDefined();
    if (!face) return;
    setManifestForTests({ ...ENTRIES, [face.assetId]: { kind: 'image', path: 'portraits/layers/face/x.png', size: [512, 640], placeholder: { generator: 'portraitLayer' } } });
    setFinalIndex({ format: 1, files: { 'portraits/layers/face/x.png': { bytes: 4, hash: 'f' } } });
    const fakePng = new Uint8Array([137, 80, 78, 71]);
    setCompositeFetchForTests((async () => new Response(fakePng, { status: 200, headers: { 'content-type': 'image/png' } })) as typeof fetch);
    const r = await resolveAssetAsync('portraits.character', params);
    expect(r.status).toBe('composite');
    const svg = decodeURIComponent(r.url);
    expect(svg).toContain('data:image/png;base64,iVBORw==');
    expect(svg).toContain('p-tint-face');
  });
});

describe('the final-file index', () => {
  it('parses tolerantly and refuses unsafe paths', () => {
    const idx = parseFinalIndex({ format: 1, files: { 'a/b.png': { bytes: 3, hash: 'x', width: 2, height: 2 }, '../etc/passwd': { bytes: 1, hash: 'y' }, '/abs.png': { bytes: 1, hash: 'z' }, 'bad.png': 7 } });
    expect(Object.keys(idx.files)).toEqual(['a/b.png']);
    expect(parseFinalIndex('nonsense').files).toEqual({});
  });

  it('loads over fetch, and treats a missing file or the SPA fallback as "no finals"', async () => {
    const ok = (async () => new Response(JSON.stringify({ format: 1, files: { 'x.png': { bytes: 1, hash: 'q' } } }), { headers: { 'content-type': 'application/json' } })) as typeof fetch;
    await loadFinalIndex({ fetchImpl: ok, force: true });
    expect(finalIndexStatus()).toBe('ready');
    expect(Object.keys(getFinalIndex().files)).toEqual(['x.png']);
    resetFinalIndex();
    const html = (async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })) as typeof fetch;
    await loadFinalIndex({ fetchImpl: html, force: true });
    expect(finalIndexStatus()).toBe('failed');
    expect(getFinalIndex().files).toEqual({});
    resetFinalIndex();
    const missing = (async () => new Response('nope', { status: 404 })) as typeof fetch;
    await loadFinalIndex({ fetchImpl: missing, force: true });
    expect(finalIndexStatus()).toBe('failed');
  });

  it('uses an injected index (Electron preload) without fetching', async () => {
    (globalThis as { __BARDIA_FINAL_ASSETS__?: unknown }).__BARDIA_FINAL_ASSETS__ = { format: 1, files: { 'hub/silver.png': { bytes: 1, hash: 'e' } } };
    try {
      await loadFinalIndex({ fetchImpl: (async () => { throw new Error('must not fetch'); }) as typeof fetch });
      expect(resolveAsset('hub.test.icon').status).toBe('final');
    } finally {
      delete (globalThis as { __BARDIA_FINAL_ASSETS__?: unknown }).__BARDIA_FINAL_ASSETS__;
    }
  });
});

describe('the resolver entry point for glob consumers (shell AssetImage)', () => {
  it('gives the placeholder of registered images only, ignoring final files', () => {
    const url = resolverEntry.resolvePlaceholderUrl('hub.test.icon');
    expect(url?.startsWith('data:image/svg+xml')).toBe(true);
    setFinalIndex({ format: 1, files: { 'hub/silver.png': { bytes: 10, hash: 'abc' } } });
    expect(resolverEntry.resolvePlaceholderUrl('hub.test.icon')).toBe(url);
    expect(resolverEntry.resolvePlaceholderUrl('hub.test.icon', { glyph: 'honor' })).not.toBe(url);
  });

  it('returns undefined (so the caller shows its own fallback) for unknown ids, audio and unknown generators', () => {
    expect(resolverEntry.resolvePlaceholderUrl('hub.nope.missing')).toBeUndefined();
    expect(resolverEntry.resolvePlaceholderUrl('hub.test.music')).toBeUndefined();
    expect(resolverEntry.resolvePlaceholderUrl('hub.test.unknownGen')).toBeUndefined();
  });

  it('never exports a placeholderUrl(id) that would shadow resolvePlaceholderUrl for glob consumers', () => {
    expect(Object.keys(resolverEntry)).not.toContain('placeholderUrl');
    expect(typeof resolverEntry.resolvePlaceholderUrl).toBe('function');
  });
});
