/**
 * Safe access to the validated content catalogs for UI code: screens show a readable error panel
 * instead of crashing when a catalog fails validation (useful while content is being authored).
 */
import { ContentValidationError, getContent, type Content } from '@content/index';

export type ContentResult = { ok: true; content: Content } | { ok: false; error: string; issues: string[] };

let cached: ContentResult | undefined;

/** Validated content, or the validation error (cached after the first success). */
export function loadContent(): ContentResult {
  if (cached?.ok) return cached;
  try {
    cached = { ok: true, content: getContent() };
  } catch (err) {
    const issues = err instanceof ContentValidationError ? err.issues : [];
    cached = { ok: false, error: err instanceof Error ? err.message : String(err), issues };
  }
  return cached;
}

/** Forgets a failed result so the next call retries (hot reload of content). */
export function retryContent(): void {
  if (cached && !cached.ok) cached = undefined;
}
