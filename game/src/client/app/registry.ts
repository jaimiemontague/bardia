/**
 * The app's screen registry, built from every `src/client/screens/*\/index.tsx` (ARCHITECTURE §14).
 * Only the shell imports this file; screens must not (it would create an import cycle).
 */
import { buildRegistry, type ScreenRegistry } from './screenRegistry';

const modules = import.meta.glob('../screens/*/index.tsx', { eager: true });

let registry: ScreenRegistry | undefined;

/** The registry of all screens found at build time. */
export function getScreenRegistry(): ScreenRegistry {
  if (!registry) {
    registry = buildRegistry(modules);
    if (import.meta.env.DEV) for (const p of registry.problems) console.warn(`[screens] ${p}`);
  }
  return registry;
}
