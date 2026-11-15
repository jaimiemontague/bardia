/**
 * English string tables (ICU MessageFormat), one pre-registered file per content area (areas.ts):
 * keys in en/<area>.json must start with '<area>.'. The simulation never contains English; it emits
 * keys + TextVars and the client formats them with intl-messageformat.
 *
 * Imported by the client, tools and tests — never by src/sim runtime code.
 */
import type { ContentArea } from '../areas';
import coreStrings from './en/core.json';
import worldStrings from './en/world.json';
import weatherStrings from './en/weather.json';
import encountersStrings from './en/encounters.json';
import expeditionsStrings from './en/expeditions.json';
import settlementsStrings from './en/settlements.json';
import newsStrings from './en/news.json';
import aiStrings from './en/ai.json';
import diplomacyStrings from './en/diplomacy.json';
import economyStrings from './en/economy.json';
import holdingsStrings from './en/holdings.json';
import militaryStrings from './en/military.json';
import peopleStrings from './en/people.json';
import faithStrings from './en/faith.json';
import intelStrings from './en/intel.json';
import questsStrings from './en/quests.json';
import narrativeStrings from './en/narrative.json';
import sagaStrings from './en/saga.json';
import battleStrings from './en/battle.json';
import duelStrings from './en/duel.json';
import seabattleStrings from './en/seabattle.json';
import uiStrings from './en/ui.json';
import menuStrings from './en/menu.json';
import hubStrings from './en/hub.json';
import mapStrings from './en/map.json';
import battleViewStrings from './en/battleView.json';
import duelViewStrings from './en/duelView.json';
import seaViewStrings from './en/seaView.json';
import codexStrings from './en/codex.json';
import portraitsStrings from './en/portraits.json';
import musicStrings from './en/music.json';

export type StringTable = Readonly<Record<string, string>>;

/** Area → raw string table (validated by content.test.ts: prefix rule and ICU syntax). */
export const EN_TABLES: { readonly [A in ContentArea]: unknown } = {
  core: coreStrings,
  world: worldStrings,
  weather: weatherStrings,
  encounters: encountersStrings,
  expeditions: expeditionsStrings,
  settlements: settlementsStrings,
  news: newsStrings,
  ai: aiStrings,
  diplomacy: diplomacyStrings,
  economy: economyStrings,
  holdings: holdingsStrings,
  military: militaryStrings,
  people: peopleStrings,
  faith: faithStrings,
  intel: intelStrings,
  quests: questsStrings,
  narrative: narrativeStrings,
  saga: sagaStrings,
  battle: battleStrings,
  duel: duelStrings,
  seabattle: seabattleStrings,
  ui: uiStrings,
  menu: menuStrings,
  hub: hubStrings,
  map: mapStrings,
  battleView: battleViewStrings,
  duelView: duelViewStrings,
  seaView: seaViewStrings,
  codex: codexStrings,
  portraits: portraitsStrings,
  music: musicStrings,
};

let merged: Record<string, string> | undefined;

/** Every English string, merged across areas. */
export function englishStrings(): StringTable {
  if (!merged) {
    merged = {};
    for (const table of Object.values(EN_TABLES)) {
      for (const [key, value] of Object.entries(table as Record<string, unknown>)) {
        if (typeof value === 'string') merged[key] = value;
      }
    }
  }
  return merged;
}

/** True if `key` has an English string. */
export function hasLocaleKey(key: string): boolean {
  return Object.hasOwn(englishStrings(), key);
}

/** The keys from `keys` that have no English string (deduplicated, in first-seen order). */
export function missingLocaleKeys(keys: Iterable<string>): string[] {
  const out: string[] = [];
  for (const key of keys) if (!hasLocaleKey(key) && !out.includes(key)) out.push(key);
  return out;
}
