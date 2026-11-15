/**
 * Fault-tolerant view of the asset manifest. `assetManifest()` (content) throws when any fragment is
 * invalid; during parallel development one area's typo must not blank every image in the game, so
 * this view merges the fragments that validate and reports the others as issues.
 */
import { MANIFEST_FRAGMENTS, assetManifest, validateAssetManifest } from '@content/assets/index';
import { AssetEntrySchema, type AssetEntry } from '@content/schemas/assets';

let merged: Readonly<Record<string, AssetEntry>> | undefined;
let issues: string[] = [];
let override: Readonly<Record<string, AssetEntry>> | undefined;

function build(): Readonly<Record<string, AssetEntry>> {
  try {
    issues = [];
    return assetManifest();
  } catch {
    issues = validateAssetManifest();
    const out: Record<string, AssetEntry> = {};
    for (const [area, raw] of Object.entries(MANIFEST_FRAGMENTS)) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
      for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
        if (!id.startsWith(`${area}.`) || Object.hasOwn(out, id)) continue;
        const parsed = AssetEntrySchema.safeParse(entry);
        if (parsed.success) out[id] = parsed.data;
      }
    }
    return out;
  }
}

/** The merged manifest (valid entries only). */
export function manifest(): Readonly<Record<string, AssetEntry>> {
  if (override) return override;
  if (!merged) merged = build();
  return merged;
}

/** One manifest entry. */
export function manifestEntry(id: string): AssetEntry | undefined {
  const m = manifest();
  return Object.hasOwn(m, id) ? m[id] : undefined;
}

/** Validation issues found while building the tolerant view (empty when the manifest is valid). */
export function manifestIssues(): readonly string[] {
  manifest();
  return issues;
}

/** Test hook: replaces the manifest (pass undefined to restore the real one). */
export function setManifestForTests(entries: Readonly<Record<string, AssetEntry>> | undefined): void {
  override = entries;
}
