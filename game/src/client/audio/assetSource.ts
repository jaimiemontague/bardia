/**
 * Audio asset resolution (§28.5): code refers to audio only by manifest id; the loader prefers the
 * owner's final file when it is present and falls back to the procedural placeholder otherwise.
 *
 * "Present" means listed in `public/assets/final-index.json` (written by the assets tool from the
 * files actually dropped under public/assets/). The index is optional: when it is missing or
 * unreadable every asset is a placeholder. Its exact shape is owned by the assets tool, so the
 * parser is tolerant: it accepts lists of paths and/or ids, `{ files | paths | ids | final: … }`
 * wrappers, id → path maps and status maps (only entries marked final count).
 *
 * Voice lines are found by locale key: a manifest `voice` entry whose `lineKey` matches (any area),
 * else the conventional path `voice/<role>/<key-as-kebab>.ogg` when that file is in the index.
 */
import { MANIFEST_FRAGMENTS } from '@content/assets/index';
import { AssetManifestFragmentSchema, type AssetEntry } from '@content/schemas/assets';
import type { VoiceRole } from './catalog';

/** Where a resolved audio asset comes from. */
export type AudioAssetStatus = 'final' | 'placeholder' | 'missing';

export interface AudioAssetInfo {
  readonly id: string;
  readonly status: AudioAssetStatus;
  /** The manifest entry (registered ids). */
  readonly entry?: AssetEntry;
  /** Path under public/assets/ where the final file goes. */
  readonly path?: string;
  /** URL of the final file (status 'final' only). */
  readonly url?: string;
}

/** The set of final files present (paths under public/assets/ and/or asset ids). */
export interface FinalIndex {
  readonly paths: ReadonlySet<string>;
  readonly ids: ReadonlySet<string>;
}

export const EMPTY_FINAL_INDEX: FinalIndex = { paths: new Set(), ids: new Set() };

const PATH_RE = /^[a-z0-9][a-z0-9_\-/]*\/[a-z0-9_\-/]*\.[a-z0-9]+$/;
const ID_RE = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_-]+)+$/;
const NOT_FINAL = new Set(['placeholder', 'missing', 'absent', 'pending']);

function classify(s: string, paths: Set<string>, ids: Set<string>): void {
  const p = s.replace(/^\.?\/+/, '').replace(/^public\/assets\//, '').replace(/^assets\//, '');
  if (PATH_RE.test(p)) paths.add(p);
  else if (ID_RE.test(s)) ids.add(s);
}

function isFinalMarker(v: unknown): boolean {
  if (v === false || v === null) return false;
  if (typeof v === 'string') return !NOT_FINAL.has(v.toLowerCase());
  if (typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (o.final === false || o.present === false || o.exists === false) return false;
    if (typeof o.status === 'string' && o.status.toLowerCase() !== 'final') return false;
  }
  return true;
}

function walk(v: unknown, paths: Set<string>, ids: Set<string>, depth: number): void {
  if (depth > 4) return;
  if (typeof v === 'string') return classify(v, paths, ids);
  if (Array.isArray(v)) {
    for (const x of v) walk(x, paths, ids, depth + 1);
    return;
  }
  if (v === null || typeof v !== 'object') return;
  const o = v as Record<string, unknown>;
  // An entry object { id, path, status? }.
  if ((typeof o.id === 'string' || typeof o.path === 'string') && isFinalMarker(o)) {
    if (typeof o.id === 'string') classify(o.id, paths, ids);
    if (typeof o.path === 'string') classify(o.path, paths, ids);
  }
  for (const [k, val] of Object.entries(o)) {
    const keyIsAsset = PATH_RE.test(k) || ID_RE.test(k);
    if (keyIsAsset) {
      if (!isFinalMarker(val)) continue;
      classify(k, paths, ids);
      if (typeof val === 'string') classify(val, paths, ids);
      else if (val !== null && typeof val === 'object') walk(val, paths, ids, depth + 1);
    } else if (val !== null && typeof val === 'object') {
      walk(val, paths, ids, depth + 1);
    }
  }
}

/** Parses a final-index document of any of the accepted shapes (unknown input → empty index). */
export function parseFinalIndex(raw: unknown): FinalIndex {
  const paths = new Set<string>();
  const ids = new Set<string>();
  walk(raw, paths, ids, 0);
  return { paths, ids };
}

/** Public base URL of the app (Vite `BASE_URL`, '/' elsewhere), always ending in '/'. */
export function publicBaseUrl(): string {
  let base = '/';
  try {
    base = import.meta.env?.BASE_URL ?? '/';
  } catch {
    base = '/';
  }
  return base.endsWith('/') ? base : `${base}/`;
}

/** URL of a file under public/assets/. */
export function finalAssetUrl(path: string, base = publicBaseUrl()): string {
  return `${base}assets/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Fetches and parses public/assets/final-index.json. Missing, non-JSON (a dev server's SPA
 * fallback page) or failed requests yield the empty index — never an error.
 */
export async function loadFinalIndex(fetchFn: typeof fetch | undefined = typeof fetch === 'function' ? fetch : undefined, base = publicBaseUrl()): Promise<FinalIndex> {
  if (!fetchFn) return EMPTY_FINAL_INDEX;
  try {
    const res = await fetchFn(`${base}assets/final-index.json`, { cache: 'no-cache' });
    if (!res.ok) return EMPTY_FINAL_INDEX;
    const text = await res.text();
    if (!/^\s*[[{]/.test(text)) return EMPTY_FINAL_INDEX;
    return parseFinalIndex(JSON.parse(text));
  } catch {
    return EMPTY_FINAL_INDEX;
  }
}

/**
 * The merged audio part of the asset manifest. Fragments are validated one by one and an invalid
 * fragment (another area mid-edit) is skipped rather than taking all audio down; `problems` lists
 * what was skipped.
 */
export function audioManifest(fragments: { readonly [area: string]: unknown } = MANIFEST_FRAGMENTS): {
  entries: Readonly<Record<string, AssetEntry>>;
  problems: string[];
} {
  const entries: Record<string, AssetEntry> = {};
  const problems: string[] = [];
  for (const [area, raw] of Object.entries(fragments)) {
    const parsed = AssetManifestFragmentSchema.safeParse(raw);
    if (!parsed.success) {
      problems.push(`assets/${area}: invalid fragment skipped (${parsed.error.issues[0]?.message ?? 'schema error'})`);
      continue;
    }
    for (const [id, e] of Object.entries(parsed.data)) if (e.kind !== 'image') entries[id] = e;
  }
  return { entries, problems };
}

/** camelCase / dotted key → lower-case kebab path segment ('hub.greatHall.title' → 'hub-great-hall-title'). */
export function kebabKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/** Conventional final-file path of a voice line: `voice/<role>/<kebab key>.ogg`. */
export function voiceLinePath(key: string, role: VoiceRole | string): string {
  return `voice/${kebabKey(role) || 'npc'}/${kebabKey(key) || 'line'}.ogg`;
}

/** Resolves audio asset ids and voice lines against the manifest and the final-file index. */
export class AudioAssetSource {
  private index: FinalIndex;
  private readonly entries: Readonly<Record<string, AssetEntry>>;
  private readonly byLineKey: Record<string, { id: string; entry: AssetEntry & { kind: 'voice' } }[]> = {};
  private readonly base: string;

  constructor(entries: Readonly<Record<string, AssetEntry>>, index: FinalIndex = EMPTY_FINAL_INDEX, base = publicBaseUrl()) {
    this.entries = entries;
    this.index = index;
    this.base = base;
    for (const [id, e] of Object.entries(entries)) {
      if (e.kind !== 'voice') continue;
      (this.byLineKey[e.lineKey] ??= []).push({ id, entry: e });
    }
  }

  /** Replaces the final-file index (after it loads). */
  setIndex(index: FinalIndex): void {
    this.index = index;
  }

  /** Number of final files known (paths + ids). */
  get finalCount(): number {
    return this.index.paths.size + this.index.ids.size;
  }

  private isFinal(id: string, path: string | undefined): boolean {
    return this.index.ids.has(id) || (path !== undefined && this.index.paths.has(path));
  }

  /** Resolves a registered audio id (unregistered ids are 'missing'). */
  resolve(id: string): AudioAssetInfo {
    const entry = Object.hasOwn(this.entries, id) ? this.entries[id] : undefined;
    if (!entry) return { id, status: 'missing' };
    if (this.isFinal(id, entry.path)) return { id, status: 'final', entry, path: entry.path, url: finalAssetUrl(entry.path, this.base) };
    return { id, status: 'placeholder', entry, path: entry.path };
  }

  /**
   * The voice-over file for a line: a manifest voice entry with this `lineKey` (preferring one for
   * the same voice), else the conventional path when present in the index.
   */
  voiceLine(key: string, role: VoiceRole | string): AudioAssetInfo {
    const candidates = Object.hasOwn(this.byLineKey, key) ? (this.byLineKey[key] ?? []) : [];
    const sorted = [...candidates].sort((a, b) => Number(b.entry.voice === role) - Number(a.entry.voice === role));
    for (const c of sorted) {
      if (this.isFinal(c.id, c.entry.path)) return { id: c.id, status: 'final', entry: c.entry, path: c.entry.path, url: finalAssetUrl(c.entry.path, this.base) };
    }
    const path = voiceLinePath(key, role);
    if (this.index.paths.has(path)) return { id: key, status: 'final', path, url: finalAssetUrl(path, this.base) };
    const first = sorted[0];
    return first ? { id: first.id, status: 'placeholder', entry: first.entry, path: first.entry.path } : { id: key, status: 'placeholder', path };
  }
}
