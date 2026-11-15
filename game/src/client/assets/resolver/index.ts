/**
 * Resolver entry point for code that discovers the asset library at build time
 * (`import.meta.glob('../assets/resolver/index.ts')`, as the shell's `ui/AssetImage` does) so it
 * keeps working while the library is absent.
 *
 *   resolvePlaceholderUrl(id) → the procedural placeholder of a manifest IMAGE id as a data URL,
 *                               or undefined for unknown ids and audio (the caller shows its own
 *                               fallback). Final files are the caller's business here.
 *
 * NOTE: this module deliberately does not export a function named `placeholderUrl`: glob
 * consumers look for `placeholderUrl ?? resolvePlaceholderUrl` with an `(id)` signature, while the
 * library's own `placeholderUrl(generatorId, params, ctx)` renders a generator directly.
 */
import type { GeneratorParams } from '../types';
import { resolveAsset, resolveAssetAsync, finalAssetUrl, type ResolveOptions } from './resolve';
import { manifestEntry } from './manifest';
import { getImageGenerator } from '../generators/registry';

/**
 * The placeholder image of a manifest id (data URL), rendered at the manifest size from the
 * manifest's recipe merged with `params`. Undefined when the id is not a registered image or names
 * a generator that is not registered (so the caller's own fallback shows instead of an error card).
 */
export function resolvePlaceholderUrl(id: string, params?: GeneratorParams, opts: Omit<ResolveOptions, 'placeholderOnly'> = {}): string | undefined {
  const entry = manifestEntry(id);
  if (!entry || entry.kind !== 'image' || !getImageGenerator(entry.placeholder.generator)) return undefined;
  const r = resolveAsset(id, params, { ...opts, placeholderOnly: true });
  return r.status === 'missing' || r.url === '' ? undefined : r.url;
}

export { resolveAsset, resolveAssetAsync, finalAssetUrl, type ResolveOptions };
