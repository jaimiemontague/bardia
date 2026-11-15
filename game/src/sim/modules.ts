/**
 * The module registry, in scheduler order (design §29.3):
 * movement/world → weather → encounters → food/expeditions → (settlements) → news → ai →
 * (diplomacy) → economy → holdings/loyalty → military/recruitment → people/dynasty → faith →
 * intel → quests → narrative/storylets → saga, then the sub-simulation owners (no systems).
 *
 * Every module id already has a folder and an entry here, so module agents never edit this file.
 * A module that is broken mid-work can set `enabled: false` in its own index.ts to drop out of
 * every SimEnv until it is green again.
 * The order actually used comes from each module's `order` field (unique; validated at startup).
 */
import type { SimModule } from './core/module';
import { module as world } from './modules/world/index';
import { module as weather } from './modules/weather/index';
import { module as encounters } from './modules/encounters/index';
import { module as expeditions } from './modules/expeditions/index';
import { module as settlements } from './modules/settlements/index';
import { module as news } from './modules/news/index';
import { module as ai } from './modules/ai/index';
import { module as diplomacy } from './modules/diplomacy/index';
import { module as economy } from './modules/economy/index';
import { module as holdings } from './modules/holdings/index';
import { module as military } from './modules/military/index';
import { module as people } from './modules/people/index';
import { module as faith } from './modules/faith/index';
import { module as intel } from './modules/intel/index';
import { module as quests } from './modules/quests/index';
import { module as narrative } from './modules/narrative/index';
import { module as saga } from './modules/saga/index';
import { module as battle } from './battle/index';
import { module as duel } from './duel/index';
import { module as seabattle } from './seabattle/index';

export const MODULES: readonly SimModule[] = [
  world,
  weather,
  encounters,
  expeditions,
  settlements,
  news,
  ai,
  diplomacy,
  economy,
  holdings,
  military,
  people,
  faith,
  intel,
  quests,
  narrative,
  saga,
  battle,
  duel,
  seabattle,
];

/** Every registered module id, in registry order. */
export const MODULE_IDS: readonly string[] = MODULES.map((m) => m.id);

/**
 * The registry filtered to the given module ids (unknown ids throw). Tools use it to honour a
 * `--modules a,b` flag or the BARDIA_MODULES environment variable, so the integrator can run the
 * sim with a broken module left out.
 */
export function selectModules(ids: readonly string[] | undefined, all: readonly SimModule[] = MODULES): readonly SimModule[] {
  if (ids === undefined) return all;
  const unknown = ids.filter((id) => !all.some((m) => m.id === id));
  if (unknown.length > 0) throw new RangeError(`selectModules: unknown module id(s) ${unknown.join(', ')}`);
  return all.filter((m) => ids.includes(m.id));
}
