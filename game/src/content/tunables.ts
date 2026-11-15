/**
 * Aggregates the module-owned tunables (one JSON + one strict zod schema per module, see areas.ts).
 * Pre-registered for every module id: module agents edit only their own two files, never this one.
 */
import type { z } from 'zod';
import worldJson from './data/tunables/world.json';
import { schema as worldSchema } from './schemas/tunables/world';
import weatherJson from './data/tunables/weather.json';
import { schema as weatherSchema } from './schemas/tunables/weather';
import encountersJson from './data/tunables/encounters.json';
import { schema as encountersSchema } from './schemas/tunables/encounters';
import expeditionsJson from './data/tunables/expeditions.json';
import { schema as expeditionsSchema } from './schemas/tunables/expeditions';
import settlementsJson from './data/tunables/settlements.json';
import { schema as settlementsSchema } from './schemas/tunables/settlements';
import newsJson from './data/tunables/news.json';
import { schema as newsSchema } from './schemas/tunables/news';
import aiJson from './data/tunables/ai.json';
import { schema as aiSchema } from './schemas/tunables/ai';
import diplomacyJson from './data/tunables/diplomacy.json';
import { schema as diplomacySchema } from './schemas/tunables/diplomacy';
import economyJson from './data/tunables/economy.json';
import { schema as economySchema } from './schemas/tunables/economy';
import holdingsJson from './data/tunables/holdings.json';
import { schema as holdingsSchema } from './schemas/tunables/holdings';
import militaryJson from './data/tunables/military.json';
import { schema as militarySchema } from './schemas/tunables/military';
import peopleJson from './data/tunables/people.json';
import { schema as peopleSchema } from './schemas/tunables/people';
import faithJson from './data/tunables/faith.json';
import { schema as faithSchema } from './schemas/tunables/faith';
import intelJson from './data/tunables/intel.json';
import { schema as intelSchema } from './schemas/tunables/intel';
import questsJson from './data/tunables/quests.json';
import { schema as questsSchema } from './schemas/tunables/quests';
import narrativeJson from './data/tunables/narrative.json';
import { schema as narrativeSchema } from './schemas/tunables/narrative';
import sagaJson from './data/tunables/saga.json';
import { schema as sagaSchema } from './schemas/tunables/saga';
import battleJson from './data/tunables/battle.json';
import { schema as battleSchema } from './schemas/tunables/battle';
import duelJson from './data/tunables/duel.json';
import { schema as duelSchema } from './schemas/tunables/duel';
import seabattleJson from './data/tunables/seabattle.json';
import { schema as seabattleSchema } from './schemas/tunables/seabattle';

/** Module id → its tunables schema. */
export const TUNABLE_SCHEMAS = {
  world: worldSchema,
  weather: weatherSchema,
  encounters: encountersSchema,
  expeditions: expeditionsSchema,
  settlements: settlementsSchema,
  news: newsSchema,
  ai: aiSchema,
  diplomacy: diplomacySchema,
  economy: economySchema,
  holdings: holdingsSchema,
  military: militarySchema,
  people: peopleSchema,
  faith: faithSchema,
  intel: intelSchema,
  quests: questsSchema,
  narrative: narrativeSchema,
  saga: sagaSchema,
  battle: battleSchema,
  duel: duelSchema,
  seabattle: seabattleSchema,
} as const;

/** Module id → raw (unvalidated) tunables JSON. */
export const RAW_TUNABLES: { [K in keyof typeof TUNABLE_SCHEMAS]: unknown } = {
  world: worldJson,
  weather: weatherJson,
  encounters: encountersJson,
  expeditions: expeditionsJson,
  settlements: settlementsJson,
  news: newsJson,
  ai: aiJson,
  diplomacy: diplomacyJson,
  economy: economyJson,
  holdings: holdingsJson,
  military: militaryJson,
  people: peopleJson,
  faith: faithJson,
  intel: intelJson,
  quests: questsJson,
  narrative: narrativeJson,
  saga: sagaJson,
  battle: battleJson,
  duel: duelJson,
  seabattle: seabattleJson,
};

/** The validated tunables of every module (`ctx.tunables.<moduleId>`). */
export type ModuleTunables = { [K in keyof typeof TUNABLE_SCHEMAS]: z.infer<(typeof TUNABLE_SCHEMAS)[K]> };
