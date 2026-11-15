/**
 * 'faith' simulation module (scheduler order 110).
 * Scope: Gods' Favor and omens as morale/luck abstractions, the Lantern's Faith Wrath, piety, conversion (§4.4, §22.6, §31.12).
 * Owns (src/sim/core/ownership.ts — implement exactly these; never another module's):
 *   commands: sacrifice, readOmen
 *   events: OmenRead
 * Note: Owns Favor decay, omens and piety rules; Favor numbers change through the core changeFavor effect.
 * Tunables: src/content/data/tunables/faith.json (+ schemas/tunables/faith.ts), read as ctx.tunables.faith.
 * Strings/assets: src/content/locales/en/faith.json and src/content/assets/manifest/faith.json (prefix 'faith.').
 * Gate: npm run verify:module -- faith
 *
 * Module-owned additions (not in ownership.ts; reported to the integrator):
 *   commands: convertHouse, giveAlms, foundChapel
 *   effects:  faithDeed, changeFaithWrath, changePiety, buildChapel
 *   events:   OfferingMade, AlmsGiven, FaithDeed, FaithWrathRose, FaithWrathFell, HouseConverted,
 *             HoldingConverted, ChapelBuilt
 *   condition fns: favor, omen, faithWrath, piety, isConverted, hasChapel, canConvert, recentLanternContact
 *   state: GameState.faith (bookkeeping), PlayerHouse.omens/chapels/convertedHour, Faction.favor/omens
 *
 * ADR-002: gods exist only as belief. Favor, omens and Piety model morale, luck, prestige and the
 * household's confidence; nothing here is divine action, and every string reports belief.
 */
import type { Reactions, SimModule } from '@sim/core/module';
import { FAITH_COMMAND_SCHEMAS, FAITH_HANDLERS } from './commands';
import { FAITH_CONDITION_FNS } from './conditions';
import { FAITH_EFFECT_SCHEMAS, FAITH_EFFECTS } from './effects';
import { LOOSE_REACTIONS } from './reactions';
import { dailyFaith, faithInvariants, initFaith, migrateFaith, monthlyFaith } from './systems';
import './types';

export type { DeedOutcome, FaithState, FaithWrathLevel, OmenReading, OmenReadings } from './types';
export { classifyOmen, currentOmen, omenEffects, rollOmen, shiftOmen } from './omens';

export const module: SimModule = {
  id: 'faith',
  order: 110,
  version: 1,
  init: initFaith,
  migrate: migrateFaith,
  handlers: FAITH_HANDLERS,
  commandSchemas: FAITH_COMMAND_SCHEMAS,
  systems: { daily: (draft) => dailyFaith(draft), monthly: monthlyFaith },
  effects: FAITH_EFFECTS,
  effectSchemas: FAITH_EFFECT_SCHEMAS,
  // Foreign events are read defensively by name (see reactions.ts), so their owners' payload types
  // are not needed here.
  reactions: LOOSE_REACTIONS as unknown as Reactions,
  conditionFns: FAITH_CONDITION_FNS,
  invariants: (state) => faithInvariants(state),
};
