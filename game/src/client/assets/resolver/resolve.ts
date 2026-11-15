/**
 * Asset resolution: manifest id (+ params) → a URL the client can show or play.
 *
 *   1. the owner's FINAL file at public/assets/<path> when the final-file index lists it (or an
 *      accepted alternative extension), graded with the generator's `finalFilter` when the params
 *      ask for something the file cannot encode (a panorama's season and time of day);
 *   2. for layered images (portraits): a COMPOSITE of whichever layer pieces have final files, the
 *      rest procedural — built asynchronously, the placeholder is shown meanwhile;
 *   3. otherwise the procedural PLACEHOLDER named by the entry's `placeholder.generator`, rendered
 *      from the merged params (manifest params, then the caller's) at the manifest size;
 *   4. an id missing from the manifest resolves to a labelled card (status 'missing') and warns
 *      once in dev builds, so a typo is visible but never crashes a screen.
 *
 * Results are cached (LRU); everything is deterministic for equal inputs.
 */
import type { AssetEntry } from '@content/schemas/assets';
import { BUILTIN_GENERATORS } from '../generators/index';
import { getAudioGenerator, getImageGenerator } from '../generators/registry';
import { cardSvg } from '../generators/misc';
import { svgToDataUrl } from '../svg/svg';
import type { WatermarkMode } from '../svg/paint';
import type { AssetKind, GeneratorParams, ImageGenerator, ParamValue, RenderContext, ResolvedAsset } from '../types';
import { finalFileUrl, findFinalFile, getFinalIndex, probeFinalFile } from './finalIndex';
import { manifestEntry } from './manifest';
import { getAssetSettings, notifyAssetsChanged, subscribeAssets } from './store';

void BUILTIN_GENERATORS; // importing the module registers the built-in generators

/** Per-call options. */
export interface ResolveOptions {
  /** Output size for placeholders (defaults to the manifest size, then the generator's). */
  width?: number;
  height?: number;
  /** Overrides the global watermark setting for this call. */
  watermark?: WatermarkMode;
  /** Skip final files (the gallery's side-by-side view). */
  placeholderOnly?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Cache

class Lru<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly capacity: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
  clear(): void {
    this.map.clear();
  }
  get size(): number {
    return this.map.size;
  }
}

const cache = new Lru<ResolvedAsset>(900);
const composites = new Lru<string>(200);
const compositePending: Record<string, true> = {};
let lastIndex = getFinalIndex();
const warned: Record<string, true> = {};

/** Clears every cached resolution (tests, settings changes). */
export function clearAssetCache(): void {
  cache.clear();
  composites.clear();
}

// Cached results depend on the final index; drop them when it changes.
subscribeAssets(() => {
  const idx = getFinalIndex();
  if (idx !== lastIndex) {
    lastIndex = idx;
    clearAssetCache();
  }
});

function isDev(): boolean {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
}

/** Stable string for params (sorted keys; arrays joined). */
export function paramsKey(params: GeneratorParams | undefined): string {
  if (!params) return '';
  const keys = Object.keys(params).sort();
  let out = '';
  for (const k of keys) {
    const v: ParamValue = params[k];
    if (v === undefined) continue;
    out += `${k}=${Array.isArray(v) ? (v as readonly string[]).join(',') : String(v)};`;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Helpers

function audioKind(kind: AssetKind): boolean {
  return kind === 'music' || kind === 'sfx' || kind === 'voice';
}

function mergedParams(entry: AssetEntry | undefined, params: GeneratorParams | undefined): GeneratorParams {
  return { ...(entry?.placeholder.params ?? {}), ...(params ?? {}) };
}

function renderContext(entry: AssetEntry | undefined, gen: ImageGenerator, opts: ResolveOptions): RenderContext {
  const size = entry && entry.kind === 'image' ? entry.size : gen.defaultSize;
  return {
    width: Math.max(1, Math.round(opts.width ?? size[0])),
    height: Math.max(1, Math.round(opts.height ?? size[1])),
    frames: entry && entry.kind === 'image' ? (entry.frames ?? 1) : 1,
    anchor: entry && entry.kind === 'image' && entry.anchor ? entry.anchor : [0.5, 0.5],
    label: entry?.placeholder.label,
    watermark: opts.watermark ?? getAssetSettings().watermark,
  };
}

function missingCard(id: string, opts: ResolveOptions, note: string): string {
  return svgToDataUrl(cardSvg({ title: id, subtitle: note, glyph: 'uiWarning', tone: 'iron', width: Math.round(opts.width ?? 320), height: Math.round(opts.height ?? 200) }));
}

/** Renders a generator directly (gallery, tools, previews): SVG markup. */
export function placeholderSvg(generatorId: string, params: GeneratorParams = {}, ctx: Partial<RenderContext> = {}): string {
  const gen = getImageGenerator(generatorId);
  if (!gen) return cardSvg({ title: `unknown generator '${generatorId}'`, glyph: 'uiWarning', tone: 'iron', width: Math.round(ctx.width ?? 320), height: Math.round(ctx.height ?? 200) });
  return gen.render(params, {
    width: Math.round(ctx.width ?? gen.defaultSize[0]),
    height: Math.round(ctx.height ?? gen.defaultSize[1]),
    frames: ctx.frames ?? 1,
    anchor: ctx.anchor ?? [0.5, 0.5],
    label: ctx.label,
    watermark: ctx.watermark ?? 'off',
  });
}

/** Renders a generator directly as a data URL. */
export function placeholderUrl(generatorId: string, params: GeneratorParams = {}, ctx: Partial<RenderContext> = {}): string {
  return svgToDataUrl(placeholderSvg(generatorId, params, ctx));
}

// ---------------------------------------------------------------------------------------------
// Composites (layered images with some final pieces)

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(bin);
}

const MIME: Readonly<Record<string, string>> = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', avif: 'image/avif', svg: 'image/svg+xml' };

/** Fetches a URL into a self-contained data URL (SVG <image> in an <img> may not load external URLs). */
export async function fetchAsDataUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const ext = (url.split('?')[0] ?? '').split('.').pop()?.toLowerCase() ?? '';
  const type = res.headers.get('content-type')?.split(';')[0] || MIME[ext] || 'application/octet-stream';
  return `data:${type};base64,${toBase64(new Uint8Array(await res.arrayBuffer()))}`;
}

/** Final files of a layered generator's pieces: layer id → URL (only the pieces that exist). */
function finalLayerUrls(gen: ImageGenerator, params: GeneratorParams): Record<string, string> {
  const out: Record<string, string> = {};
  if (!gen.layers) return out;
  for (const layerId of gen.layers(params)) {
    const e = manifestEntry(layerId);
    if (!e || e.kind !== 'image') continue;
    const f = findFinalFile(e.path, 'image');
    if (f) out[layerId] = finalFileUrl(f.path, f.info);
  }
  return out;
}

let compositeFetch: typeof fetch | undefined;
/** Test hook: the fetch used to load final layer pieces. */
export function setCompositeFetchForTests(f: typeof fetch | undefined): void {
  compositeFetch = f;
}

function startComposite(key: string, gen: ImageGenerator, params: GeneratorParams, ctx: RenderContext, layerUrls: Record<string, string>): void {
  if (compositePending[key] || !gen.renderWithLayers) return;
  compositePending[key] = true;
  const f = compositeFetch ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!f) return;
  void (async () => {
    try {
      const finals: Record<string, string> = {};
      for (const [id, url] of Object.entries(layerUrls)) {
        try {
          finals[id] = await fetchAsDataUrl(url, f);
        } catch (err) {
          if (isDev()) console.warn(`[assets] could not load final layer ${id} (${url})`, err);
        }
      }
      if (Object.keys(finals).length > 0 && gen.renderWithLayers) {
        composites.set(key, svgToDataUrl(gen.renderWithLayers(params, ctx, finals)));
        cache.clear();
        notifyAssetsChanged();
      }
    } finally {
      delete compositePending[key];
    }
  })();
}

// ---------------------------------------------------------------------------------------------
// Resolution

/**
 * Resolves an asset id to the best URL available now. Synchronous: a final file the index lists is
 * used at once; composites and dev probes complete later and notify subscribers (`useAsset`
 * re-renders), so callers outside React should use `resolveAssetAsync` when they need the final word.
 */
export function resolveAsset(id: string, params?: GeneratorParams, opts: ResolveOptions = {}): ResolvedAsset {
  const settings = getAssetSettings();
  const placeholderOnly = opts.placeholderOnly === true || settings.forcePlaceholders;
  const key = `${id}|${paramsKey(params)}|${opts.width ?? ''}x${opts.height ?? ''}|${opts.watermark ?? settings.watermark}|${placeholderOnly ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const result = resolveUncached(id, params, opts, placeholderOnly, key);
  cache.set(key, result);
  return result;
}

function resolveUncached(id: string, params: GeneratorParams | undefined, opts: ResolveOptions, placeholderOnly: boolean, key: string): ResolvedAsset {
  const entry = manifestEntry(id);
  if (!entry) {
    if (isDev() && !warned[id]) {
      warned[id] = true;
      console.warn(`[assets] '${id}' is not in the asset manifest (src/content/assets/manifest/<area>.json)`);
    }
    return { id, url: missingCard(id, opts, 'not in the asset manifest'), status: 'missing', kind: 'image', registered: false, width: opts.width ?? 320, height: opts.height ?? 200 };
  }
  const merged = mergedParams(entry, params);
  const base: ResolvedAsset = { id, url: '', status: 'placeholder', kind: entry.kind, registered: true, path: entry.path, generator: entry.placeholder.generator };
  if (entry.kind === 'image') {
    base.width = opts.width ?? entry.size[0];
    base.height = opts.height ?? entry.size[1];
    base.frames = entry.frames ?? 1;
    base.anchor = entry.anchor ?? [0.5, 0.5];
  }

  // 1. The owner's final file.
  const fileKind = audioKind(entry.kind) ? 'audio' : 'image';
  if (!placeholderOnly) {
    const found = findFinalFile(entry.path, fileKind);
    if (found) {
      const gen = getImageGenerator(entry.placeholder.generator);
      const filter = entry.kind === 'image' ? gen?.finalFilter?.(merged) : undefined;
      return { ...base, url: finalFileUrl(found.path, found.info), status: 'final', ...(filter ? { filter } : {}) };
    }
    probeFinalFile(entry.path);
  }

  if (audioKind(entry.kind)) {
    // Audio placeholders are synthesised by the audio system (resolveAssetAsync / AudioGenerator).
    return base;
  }

  // 2./3. Image placeholder (or composite of final layer pieces).
  const gen = getImageGenerator(entry.placeholder.generator);
  if (!gen) {
    if (isDev() && !warned[`gen:${entry.placeholder.generator}`]) {
      warned[`gen:${entry.placeholder.generator}`] = true;
      console.warn(`[assets] '${id}' names unknown placeholder generator '${entry.placeholder.generator}'`);
    }
    return { ...base, url: missingCard(id, { width: base.width, height: base.height }, `unknown generator '${entry.placeholder.generator}'`) };
  }
  const ctx = renderContext(entry, gen, opts);
  if (!placeholderOnly && gen.layers && gen.renderWithLayers) {
    const layerUrls = finalLayerUrls(gen, merged);
    if (Object.keys(layerUrls).length > 0) {
      const done = composites.get(key);
      if (done) return { ...base, url: done, status: 'composite' };
      startComposite(key, gen, merged, ctx, layerUrls);
    }
  }
  return { ...base, url: svgToDataUrl(gen.render(merged, ctx)) };
}

/**
 * Resolves and waits for anything asynchronous: a pending composite, or an audio placeholder from a
 * registered AudioGenerator. Never rejects for asset problems (falls back to the placeholder).
 */
export async function resolveAssetAsync(id: string, params?: GeneratorParams, opts: ResolveOptions = {}): Promise<ResolvedAsset> {
  const first = resolveAsset(id, params, opts);
  if (first.status === 'missing' || first.status === 'final') return first;
  const entry = manifestEntry(id);
  if (entry && audioKind(entry.kind)) {
    const agen = getAudioGenerator(entry.placeholder.generator);
    if (!agen) return first;
    try {
      const url = await agen.render(mergedParams(entry, params), { durationS: 'durationS' in entry ? entry.durationS : undefined, loop: 'loop' in entry ? entry.loop : undefined, label: entry.placeholder.label });
      return { ...first, url };
    } catch (err) {
      if (isDev()) console.warn(`[assets] audio placeholder for '${id}' failed`, err);
      return first;
    }
  }
  if (entry && entry.kind === 'image') {
    const gen = getImageGenerator(entry.placeholder.generator);
    if (gen?.layers && gen.renderWithLayers && !opts.placeholderOnly && !getAssetSettings().forcePlaceholders) {
      const merged = mergedParams(entry, params);
      const layerUrls = finalLayerUrls(gen, merged);
      if (Object.keys(layerUrls).length > 0) {
        const f = compositeFetch ?? fetch;
        const finals: Record<string, string> = {};
        for (const [lid, url] of Object.entries(layerUrls)) {
          try {
            finals[lid] = await fetchAsDataUrl(url, f);
          } catch {
            /* keep the procedural piece */
          }
        }
        if (Object.keys(finals).length > 0) return { ...first, status: 'composite', url: svgToDataUrl(gen.renderWithLayers(merged, renderContext(entry, gen, opts), finals)) };
      }
    }
  }
  return first;
}

/** Only the final-file URL of an id (audio manager, Pixi loaders), or undefined when absent. */
export function finalAssetUrl(id: string): string | undefined {
  const entry = manifestEntry(id);
  if (!entry || getAssetSettings().forcePlaceholders) return undefined;
  const f = findFinalFile(entry.path, audioKind(entry.kind) ? 'audio' : 'image');
  return f ? finalFileUrl(f.path, f.info) : undefined;
}

/** Loads a resolved image into an HTMLImageElement (canvas / Pixi texture sources). Browser only. */
export function loadAssetImage(id: string, params?: GeneratorParams, opts: ResolveOptions = {}): Promise<HTMLImageElement> {
  return resolveAssetAsync(id, params, opts).then(
    (r) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`could not load asset '${id}'`));
        img.src = r.url;
      }),
  );
}

/** Number of cached resolutions (diagnostics). */
export function assetCacheSize(): number {
  return cache.size;
}
