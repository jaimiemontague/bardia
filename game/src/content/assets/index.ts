/**
 * The asset manifest (design §27.3-27.4, §28), split into one pre-registered fragment per content
 * area (areas.ts): ids in manifest/<area>.json must start with '<area>.'. Code and content refer to
 * every image, music track, sound and voice line ONLY by its manifest id. Each entry names the path
 * where the owner's final file goes and a procedural placeholder recipe; the client's loader prefers
 * the final file when it exists and falls back to the placeholder, so final assets need no code
 * changes.
 *
 * Imported by the client, tools and tests — never by src/sim runtime code.
 */
import { AssetManifestFragmentSchema, type AssetEntry } from '../schemas/assets';
import type { ContentArea } from '../areas';
import coreAssets from './manifest/core.json';
import worldAssets from './manifest/world.json';
import weatherAssets from './manifest/weather.json';
import encountersAssets from './manifest/encounters.json';
import expeditionsAssets from './manifest/expeditions.json';
import settlementsAssets from './manifest/settlements.json';
import newsAssets from './manifest/news.json';
import aiAssets from './manifest/ai.json';
import diplomacyAssets from './manifest/diplomacy.json';
import economyAssets from './manifest/economy.json';
import holdingsAssets from './manifest/holdings.json';
import militaryAssets from './manifest/military.json';
import peopleAssets from './manifest/people.json';
import faithAssets from './manifest/faith.json';
import intelAssets from './manifest/intel.json';
import questsAssets from './manifest/quests.json';
import narrativeAssets from './manifest/narrative.json';
import sagaAssets from './manifest/saga.json';
import battleAssets from './manifest/battle.json';
import duelAssets from './manifest/duel.json';
import seabattleAssets from './manifest/seabattle.json';
import uiAssets from './manifest/ui.json';
import menuAssets from './manifest/menu.json';
import hubAssets from './manifest/hub.json';
import mapAssets from './manifest/map.json';
import battleViewAssets from './manifest/battleView.json';
import duelViewAssets from './manifest/duelView.json';
import seaViewAssets from './manifest/seaView.json';
import codexAssets from './manifest/codex.json';
import portraitsAssets from './manifest/portraits.json';
import musicAssets from './manifest/music.json';

/** Area → raw manifest fragment (validated by validateAssetManifest / content.test.ts). */
export const MANIFEST_FRAGMENTS: { readonly [A in ContentArea]: unknown } = {
  core: coreAssets,
  world: worldAssets,
  weather: weatherAssets,
  encounters: encountersAssets,
  expeditions: expeditionsAssets,
  settlements: settlementsAssets,
  news: newsAssets,
  ai: aiAssets,
  diplomacy: diplomacyAssets,
  economy: economyAssets,
  holdings: holdingsAssets,
  military: militaryAssets,
  people: peopleAssets,
  faith: faithAssets,
  intel: intelAssets,
  quests: questsAssets,
  narrative: narrativeAssets,
  saga: sagaAssets,
  battle: battleAssets,
  duel: duelAssets,
  seabattle: seabattleAssets,
  ui: uiAssets,
  menu: menuAssets,
  hub: hubAssets,
  map: mapAssets,
  battleView: battleViewAssets,
  duelView: duelViewAssets,
  seaView: seaViewAssets,
  codex: codexAssets,
  portraits: portraitsAssets,
  music: musicAssets,
};

/** Validates every fragment (schema + '<area>.' prefix + unique ids); returns issues. */
export function validateAssetManifest(fragments: { readonly [area: string]: unknown } = MANIFEST_FRAGMENTS): string[] {
  const issues: string[] = [];
  const seen: Record<string, string> = {};
  for (const [area, raw] of Object.entries(fragments)) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push(`assets/${area}: a fragment must be an object of id → entry`);
      continue;
    }
    const parsed = AssetManifestFragmentSchema.safeParse(raw);
    if (!parsed.success) {
      for (const i of parsed.error.issues) issues.push(`assets/${area}: ${i.path.join('.') || '(root)'}: ${i.message}`);
    }
    for (const id of Object.keys(raw)) {
      if (!id.startsWith(`${area}.`)) issues.push(`assets/${area}: id '${id}' must start with '${area}.'`);
      const other = seen[id];
      if (other !== undefined) issues.push(`assets: id '${id}' is defined in both ${other} and ${area}`);
      seen[id] = area;
    }
  }
  return issues;
}

let manifest: Record<string, AssetEntry> | undefined;

/** The merged, validated manifest (throws on invalid fragments). */
export function assetManifest(): Readonly<Record<string, AssetEntry>> {
  if (!manifest) {
    const issues = validateAssetManifest();
    if (issues.length > 0) throw new Error(`Asset manifest is invalid:\n  ${issues.join('\n  ')}`);
    manifest = {};
    for (const raw of Object.values(MANIFEST_FRAGMENTS)) Object.assign(manifest, AssetManifestFragmentSchema.parse(raw));
  }
  return manifest;
}
