/**
 * 'quests' simulation module (scheduler order 130).
 * Scope: Relics (revered objects), legends, delves with human/animal guardians and natural hazards, procedural quests, Trophy Hall (§21).
 * Owns (src/sim/core/ownership.ts — implement exactly these; never another module's):
 *   effects: startQuest, revealSite, giveRelic
 *   commands: delveChoice
 *   pending kinds: delve
 *   events: RelicFound, LegendLearned, QuestUpdated
 *   state slices: sites, quests, relics
 * Tunables: src/content/data/tunables/quests.json (+ schemas/tunables/quests.ts), read as ctx.tunables.quests.
 * Strings/assets: src/content/locales/en/quests.json and src/content/assets/manifest/quests.json (prefix 'quests.').
 * Gate: npm run verify:module -- quests
 *
 * STUB created by the kernel agent. The owning agent fleshes it out inside this folder only:
 * augment state/commands/events/effects (see ARCHITECTURE.md), add handlers, systems and tests.
 */
import type { SimModule } from '@sim/core/module';

export const module: SimModule = {
  id: 'quests',
  order: 130,
};
