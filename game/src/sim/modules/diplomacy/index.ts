/**
 * 'diplomacy' simulation module (scheduler order 65).
 * Scope: Relations, pacts, audience actions, envoys, honor rules, the Allthing and the Nemesis (§17, §31.14-31.17).
 * Owns (src/sim/core/ownership.ts — implement exactly these; never another module's):
 *   commands: audience, respondEnvoy, thingAction
 *   pending kinds: envoy, thing
 *   events: RelationChanged, PactSigned, PactBroken, EnvoyArrived, AllthingOpened, AcclamationResult
 *   state slices: relations
 * Note: Owns relations, pacts and the Allthing; opinion modifiers are added with the core changeOpinion effect.
 * Tunables: src/content/data/tunables/diplomacy.json (+ schemas/tunables/diplomacy.ts), read as ctx.tunables.diplomacy.
 * Strings/assets: src/content/locales/en/diplomacy.json and src/content/assets/manifest/diplomacy.json (prefix 'diplomacy.').
 * Gate: npm run verify:module -- diplomacy
 *
 * STUB created by the kernel agent. The owning agent fleshes it out inside this folder only:
 * augment state/commands/events/effects (see ARCHITECTURE.md), add handlers, systems and tests.
 */
import type { SimModule } from '@sim/core/module';

export const module: SimModule = {
  id: 'diplomacy',
  order: 65,
};
