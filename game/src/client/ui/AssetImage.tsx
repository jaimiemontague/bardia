/**
 * Images by asset-manifest id (design §27.4: every asset goes through a manifest id so the owner's
 * final files drop in without code changes).
 *
 *   <AssetImage id="menu.backdrop.main" alt="" fallback={<ProceduralBackdrop />} />
 *
 * When the asset library (src/client/assets) is present, its index-aware <AssetImage> does the
 * work: the owner's final file when public/assets/final-index.json lists it, otherwise the
 * procedural placeholder — with no request for files that are not there. Without the library (it
 * is discovered at build time, so the shell never depends on it) the chain is: the final file at
 * public/assets/<path> → the library resolver's placeholder → the caller's `fallback` element, and
 * missing final files are remembered for the session so they are requested only once.
 */
import { useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { assetManifest, MANIFEST_FRAGMENTS } from '@content/assets/index';

interface ManifestImage {
  path: string;
  size?: readonly [number, number];
}

const missing = new Set<string>();

/** Looks up an image entry; tolerant of other areas' invalid fragments (parallel work). */
export function lookupImageAsset(id: string): ManifestImage | undefined {
  try {
    const entry = assetManifest()[id];
    if (entry && entry.kind === 'image') return { path: entry.path, size: entry.size };
    if (entry) return undefined;
  } catch {
    // Another area's fragment is invalid right now; fall back to a raw scan.
  }
  const area = id.split('.')[0] ?? '';
  const frag = (MANIFEST_FRAGMENTS as Readonly<Record<string, unknown>>)[area];
  if (frag && typeof frag === 'object' && Object.hasOwn(frag, id)) {
    const raw = (frag as Record<string, { kind?: unknown; path?: unknown; size?: unknown }>)[id];
    if (raw && raw.kind === 'image' && typeof raw.path === 'string') {
      return { path: raw.path, size: Array.isArray(raw.size) ? (raw.size as unknown as [number, number]) : undefined };
    }
  }
  return undefined;
}

/** Public URL of an asset's final file. */
export function finalAssetUrl(path: string): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  return `${base.endsWith('/') ? base : `${base}/`}assets/${path}`;
}

/** The asset library's component (subset of its props used here). */
type LibraryAssetImage = (props: { id: string; alt?: string; fit?: 'cover' | 'contain' | 'fill'; className?: string; style?: CSSProperties }) => ReactElement;
const libraryModules = import.meta.glob('../assets/react.tsx', { eager: true }) as Record<string, Record<string, unknown>>;

function libraryAssetImage(): LibraryAssetImage | null {
  for (const mod of Object.values(libraryModules)) if (typeof mod.AssetImage === 'function') return mod.AssetImage as LibraryAssetImage;
  return null;
}

type PlaceholderResolver = (id: string) => string | undefined;
const resolverModules = import.meta.glob('../assets/resolver/index.ts', { eager: true }) as Record<string, Record<string, unknown>>;

/** The asset library's synchronous placeholder URL for an id, when it provides one. */
function placeholderUrl(id: string): string | undefined {
  for (const mod of Object.values(resolverModules)) {
    const fn = (mod.placeholderUrl ?? mod.resolvePlaceholderUrl) as PlaceholderResolver | undefined;
    if (typeof fn === 'function') {
      try {
        const url = fn(id);
        if (typeof url === 'string' && url.length > 0) return url;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export interface AssetImageProps {
  id: string;
  alt: string;
  fallback?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Render as a CSS background-filling cover image. */
  cover?: boolean;
}

/** An image resolved through the asset manifest (see the module comment). */
export function AssetImage(props: AssetImageProps): ReactElement {
  const Library = libraryAssetImage();
  if (Library && lookupImageAsset(props.id)) {
    const cls = ['asset-image', props.cover && 'asset-cover', props.className].filter(Boolean).join(' ');
    return <Library id={props.id} alt={props.alt} fit={props.cover ? 'cover' : 'contain'} className={cls} style={props.style} />;
  }
  return <ShellAssetImage {...props} />;
}

/** The shell's own chain, used when the asset library is absent. */
function ShellAssetImage({ id, alt, fallback = null, className, style, cover = false }: AssetImageProps): ReactElement {
  const entry = lookupImageAsset(id);
  const finalUrl = entry ? finalAssetUrl(entry.path) : undefined;
  const [stage, setStage] = useState<'final' | 'placeholder' | 'fallback'>(() => (finalUrl && !missing.has(finalUrl) ? 'final' : 'placeholder'));
  const ph = stage === 'placeholder' ? placeholderUrl(id) : undefined;
  const cls = ['asset-image', cover && 'asset-cover', className].filter(Boolean).join(' ');

  if (stage === 'final' && finalUrl) {
    return (
      <img
        className={cls}
        style={style}
        src={finalUrl}
        alt={alt}
        data-asset-id={id}
        data-asset-status="final"
        onError={() => {
          missing.add(finalUrl);
          setStage('placeholder');
        }}
      />
    );
  }
  if (ph) return <img className={cls} style={style} src={ph} alt={alt} data-asset-id={id} data-asset-status="placeholder" onError={() => setStage('fallback')} />;
  return (
    <div className={cls} style={style} role={alt ? 'img' : undefined} aria-label={alt || undefined} data-asset-id={id} data-asset-status="fallback">
      {fallback}
    </div>
  );
}
