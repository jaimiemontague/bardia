/**
 * 'ai' simulation module (scheduler order 60).
 * Scope: Strategic AI: personalities, beliefs, utility actions, plans, spying, coalitions (§18, §31.18).
 * Owns (src/sim/core/ownership.ts — implement exactly these; never another module's):
 *   (no design-listed items; module-internal ones only)
 * Tunables: src/content/data/tunables/ai.json (+ schemas/tunables/ai.ts), read as ctx.tunables.ai.
 * Strings/assets: src/content/locales/en/ai.json and src/content/assets/manifest/ai.json (prefix 'ai.').
 * Gate: npm run verify:module -- ai
 *
 * STUB created by the kernel agent. The owning agent fleshes it out inside this folder only:
 * augment state/commands/events/effects (see ARCHITECTURE.md), add handlers, systems and tests.
 */
import type { SimModule } from '@sim/core/module';

export const module: SimModule = {
  id: 'ai',
  order: 60,
};
