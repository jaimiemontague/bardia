/**
 * 'saga' simulation module (scheduler order 150).
 * Scope: Renown/Honor/Dread bookkeeping, ambitions, year-end summary, saga epitaph, victory and defeat (§22.3-22.4, §22.9, §23.6, §24).
 * Owns (src/sim/core/ownership.ts — implement exactly these; never another module's):
 *   commands: chooseAmbitions
 *   pending kinds: yearEnd
 *   events: GameEnded
 * Note: Owns the RULES for standing (deed rewards, "the songs fade" decay, tiers); the numbers change through the core change* effects, and saga reacts to StandingChanged.
 * Tunables: src/content/data/tunables/saga.json (+ schemas/tunables/saga.ts), read as ctx.tunables.saga.
 * Strings/assets: src/content/locales/en/saga.json and src/content/assets/manifest/saga.json (prefix 'saga.').
 * Gate: npm run verify:module -- saga
 *
 * STUB created by the kernel agent. The owning agent fleshes it out inside this folder only:
 * augment state/commands/events/effects (see ARCHITECTURE.md), add handlers, systems and tests.
 */
import type { SimModule } from '@sim/core/module';

export const module: SimModule = {
  id: 'saga',
  order: 150,
};
