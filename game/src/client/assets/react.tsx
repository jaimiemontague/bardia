/**
 * React bindings of the asset library.
 *
 *   const a = useAsset('portraits.character', { seed, culture, age, sex });   // ResolvedAsset
 *   <AssetImage id="hub.panorama.skarn" params={{ season, time }} altKey="hub.panorama.alt" />
 *   <GlyphIcon glyph="silver" size={18} />                                   // inline, currentColor
 *
 * Components re-render when the final-file index loads, a composite portrait finishes, or the
 * watermark/force-placeholder settings change. The index starts loading on first use.
 */
import { useEffect, useMemo, useSyncExternalStore, type CSSProperties, type ReactElement } from 'react';
import { t } from '@client/i18n/index';
import type { GeneratorParams, ResolvedAsset } from './types';
import { resolveAsset, paramsKey, type ResolveOptions } from './resolver/resolve';
import { loadFinalIndex, finalIndexStatus } from './resolver/finalIndex';
import { assetsVersion, getAssetSettings, subscribeAssets, type AssetSettings } from './resolver/store';
import { inlineIconMarkup, type IconStyle } from './generators/icon';

/** Starts loading public/assets/final-index.json (idempotent). */
export function ensureFinalIndex(): void {
  if (finalIndexStatus() === 'idle') void loadFinalIndex();
}

/** Re-renders on any asset change; returns the change counter. */
export function useAssetsVersion(): number {
  return useSyncExternalStore(subscribeAssets, assetsVersion, assetsVersion);
}

/** The global asset settings (watermark, force placeholders, dev probe). */
export function useAssetSettings(): Readonly<AssetSettings> {
  useAssetsVersion();
  return getAssetSettings();
}

/** Resolves an asset id (re-resolving when params or the asset state change). */
export function useAsset(id: string, params?: GeneratorParams, opts: ResolveOptions = {}): ResolvedAsset {
  const v = useAssetsVersion();
  useEffect(ensureFinalIndex, []);
  const pk = paramsKey(params);
  // eslint-style note: params are compared by their stable key, not identity.
  return useMemo(() => resolveAsset(id, params, opts), [id, pk, opts.width, opts.height, opts.watermark, opts.placeholderOnly, v]); // eslint-disable-line react-hooks/exhaustive-deps
}

export interface AssetImageProps {
  id: string;
  params?: GeneratorParams;
  /** Alternative text (already localised). Use "" for decorative images. */
  alt?: string;
  /** Locale key of the alternative text (preferred over `alt`). */
  altKey?: string;
  altVars?: Readonly<Record<string, string | number>>;
  /** Display size in CSS px (defaults to the asset's natural size). */
  width?: number | string;
  height?: number | string;
  /** Sprite strips: which frame to show (0-based). */
  frame?: number;
  fit?: 'cover' | 'contain' | 'fill';
  className?: string;
  style?: CSSProperties;
  title?: string;
  /** Resolution options (placeholder render size, watermark override, placeholder only). */
  resolve?: ResolveOptions;
  onLoad?: () => void;
}

/**
 * An <img> for a manifest asset (or a <div> showing one frame of a sprite strip). Carries
 * data-asset-id / data-asset-status for tests and the gallery.
 */
export function AssetImage(props: AssetImageProps): ReactElement {
  const asset = useAsset(props.id, props.params, props.resolve);
  const alt = props.altKey ? t(props.altKey, props.altVars) : (props.alt ?? '');
  const frames = asset.frames ?? 1;
  const style: CSSProperties = {
    objectFit: props.fit ?? 'cover',
    ...(asset.filter ? { filter: asset.filter } : {}),
    ...props.style,
  };
  if (frames > 1 && props.frame !== undefined) {
    const f = Math.max(0, Math.min(frames - 1, Math.floor(props.frame)));
    return (
      <div
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        className={props.className}
        title={props.title}
        data-asset-id={asset.id}
        data-asset-status={asset.status}
        style={{
          width: props.width ?? asset.width,
          height: props.height ?? asset.height,
          backgroundImage: `url("${asset.url}")`,
          backgroundSize: `${frames * 100}% 100%`,
          backgroundPosition: `${frames > 1 ? (f / (frames - 1)) * 100 : 0}% 0%`,
          backgroundRepeat: 'no-repeat',
          ...(asset.filter ? { filter: asset.filter } : {}),
          ...props.style,
        }}
      />
    );
  }
  return (
    <img
      src={asset.url}
      alt={alt}
      width={typeof props.width === 'number' ? props.width : undefined}
      height={typeof props.height === 'number' ? props.height : undefined}
      className={props.className}
      title={props.title}
      draggable={false}
      decoding="async"
      data-asset-id={asset.id}
      data-asset-status={asset.status}
      onLoad={props.onLoad}
      style={{ ...(typeof props.width === 'string' ? { width: props.width } : {}), ...(typeof props.height === 'string' ? { height: props.height } : {}), ...style }}
    />
  );
}

let glyphSeq = 0;

export interface GlyphIconProps {
  /** Glyph id or content alias (silver, karvi, valgrim, smithy, …). */
  glyph: string;
  size?: number | string;
  /** flat (currentColor, default), carved, ink or outlined. */
  variant?: IconStyle;
  /** Accessible label (already localised); omit for decorative icons. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * An inline SVG glyph from the placeholder icon set. `flat` icons follow the CSS text colour, so
 * they sit in buttons and labels like a font icon. (Manifest icons with final art use AssetImage.)
 */
export function GlyphIcon(props: GlyphIconProps): ReactElement {
  const prefix = useMemo(() => `gi${++glyphSeq}`, []);
  const markup = useMemo(() => inlineIconMarkup(props.glyph, prefix, props.variant ?? 'flat'), [props.glyph, prefix, props.variant]);
  const size = props.size ?? '1em';
  const inner = markup.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={props.className}
      style={{ display: 'inline-block', verticalAlign: '-0.15em', flex: 'none', ...props.style }}
      role={props.label ? 'img' : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : true}
      focusable="false"
      data-glyph={props.glyph}
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}
