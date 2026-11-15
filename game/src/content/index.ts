/**
 * Core content catalogs: imports the JSON data files (works in Vite, Vitest and tsx/Node) and
 * validates them with zod on first access. Module-owned tunables (src/content/tunables.ts) are part
 * of the validated Content. Domain content packs (world geography, storylets, relics, …) live in
 * their own folders with their own index.ts and are imported directly by the modules that need
 * them; locales and the asset manifest (src/content/locales, src/content/assets) are imported by the
 * client, tools and tests only — do not add any of those here (see ARCHITECTURE.md §9).
 */
import balanceJson from './data/balance.json';
import culturesJson from './data/cultures.json';
import featsJson from './data/feats.json';
import godsJson from './data/gods.json';
import namesJson from './data/names.json';
import titlesJson from './data/titles.json';
import traitsJson from './data/traits.json';
import upbringingsJson from './data/upbringings.json';
import { BalanceSchema, type Balance } from './schemas/balance';
import { CulturesSchema, type Cultures } from './schemas/cultures';
import { FeatsSchema, type Feats } from './schemas/feats';
import { GodsSchema, type Gods } from './schemas/gods';
import { NamesSchema, type NamesData } from './schemas/names';
import { TitlesSchema, type Titles } from './schemas/titles';
import { TraitsSchema, type Traits } from './schemas/traits';
import { UpbringingsSchema, type Upbringings } from './schemas/upbringings';
import { RAW_TUNABLES, TUNABLE_SCHEMAS, type ModuleTunables } from './tunables';
import type { z } from 'zod';

export type { Balance } from './schemas/balance';
export type { CultureDef, Cultures, Naming } from './schemas/cultures';
export type { FeatDef, Feats } from './schemas/feats';
export type { GodDef, Gods } from './schemas/gods';
export type { NamesData } from './schemas/names';
export type { TitleDef, Titles } from './schemas/titles';
export type { TraitDef, Traits } from './schemas/traits';
export type { UpbringingDef, UpbringingId, Upbringings } from './schemas/upbringings';
export type { ModuleTunables } from './tunables';

/** The validated core catalogs handed to the simulation as `ctx.content`. */
export interface Content {
  balance: Balance;
  cultures: Cultures;
  gods: Gods;
  traits: Traits;
  feats: Feats;
  titles: Titles;
  names: NamesData;
  upbringings: Upbringings;
  /** Module-owned tunables: `tunables.<moduleId>` (src/content/data/tunables/<moduleId>.json). */
  tunables: ModuleTunables;
}

type Catalogs = Omit<Content, 'tunables'>;

/** Raw (unvalidated) inputs, e.g. for tests or mods that override a catalog. */
export type RawContent = { [K in keyof Catalogs]: unknown } & { tunables: { [K in keyof ModuleTunables]: unknown } };

/** Thrown when a catalog fails validation; `issues` lists `file: path: message` lines. */
export class ContentValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Content validation failed:\n  ${issues.join('\n  ')}`);
    this.name = 'ContentValidationError';
  }
}

const SCHEMAS: { [K in keyof Catalogs]: z.ZodType<Catalogs[K], z.ZodTypeDef, unknown> } = {
  balance: BalanceSchema,
  cultures: CulturesSchema,
  gods: GodsSchema,
  traits: TraitsSchema,
  feats: FeatsSchema,
  titles: TitlesSchema,
  names: NamesSchema,
  upbringings: UpbringingsSchema,
};

/** The raw JSON bundled with the game. */
export const RAW_CONTENT: RawContent = {
  balance: balanceJson,
  cultures: culturesJson,
  gods: godsJson,
  traits: traitsJson,
  feats: featsJson,
  titles: titlesJson,
  names: namesJson,
  upbringings: upbringingsJson,
  tunables: RAW_TUNABLES,
};

/** Validates raw catalogs plus cross-catalog references. Throws ContentValidationError. */
export function validateContent(raw: RawContent): Content {
  const issues: string[] = [];
  const out: Partial<Content> = {};
  for (const key of Object.keys(SCHEMAS) as (keyof Catalogs)[]) {
    const result = SCHEMAS[key].safeParse(raw[key]);
    if (result.success) {
      (out as Record<string, unknown>)[key] = result.data;
    } else {
      for (const issue of result.error.issues) issues.push(`${key}: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
  }
  const tunables: Record<string, unknown> = {};
  for (const id of Object.keys(TUNABLE_SCHEMAS) as (keyof ModuleTunables)[]) {
    const result = TUNABLE_SCHEMAS[id].safeParse(raw.tunables?.[id]);
    if (result.success) tunables[id] = result.data;
    else for (const issue of result.error.issues) issues.push(`tunables/${id}: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  out.tunables = tunables as ModuleTunables;
  if (issues.length === 0) {
    const c = out as Content;
    // Cross references: culture unique units exist in balance.units and are bound to that culture.
    for (const [cid, culture] of Object.entries(c.cultures)) {
      for (const unitId of culture.uniqueUnits) {
        const unit = c.balance.units[unitId];
        if (!unit) issues.push(`cultures: ${cid}.uniqueUnits: unknown unit '${unitId}'`);
        else if (unit.culture !== cid) issues.push(`cultures: ${cid}.uniqueUnits: unit '${unitId}' belongs to culture '${String(unit.culture)}'`);
      }
    }
    // Upbringings reference real traits; step-7 options are positive creation traits.
    for (const [uid, u] of Object.entries(c.upbringings)) {
      if (!c.traits[u.startingTrait]) issues.push(`upbringings: ${uid}.startingTrait: unknown trait '${u.startingTrait}'`);
      if (new Set(u.traitOptions).size !== u.traitOptions.length) issues.push(`upbringings: ${uid}.traitOptions has duplicates`);
      for (const t of u.traitOptions) {
        const def = c.traits[t];
        if (!def) issues.push(`upbringings: ${uid}.traitOptions: unknown trait '${t}'`);
        else if (def.creation !== 'positive') issues.push(`upbringings: ${uid}.traitOptions: '${t}' is not a positive creation trait`);
      }
    }
    // Duel rating trait bonuses must reference real traits.
    for (const traitId of Object.keys(c.balance.duel.rating.traits)) {
      if (!c.traits[traitId]) issues.push(`balance: duel.rating.traits: unknown trait '${traitId}'`);
    }
    for (const row of c.balance.health.injuryTable) {
      if (row.trait && !c.traits[row.trait]) issues.push(`balance: health.injuryTable.${row.id}: unknown trait '${row.trait}'`);
      // Single source: a permanent injury is its trait; the row must not repeat the trait's penalty.
      if (row.trait && (row.skill !== undefined || row.attribute !== undefined || row.amount !== undefined)) {
        issues.push(`balance: health.injuryTable.${row.id}: a trait row must not also set skill/attribute/amount (the trait carries the effect)`);
      }
    }
    if (c.titles.length !== c.balance.xp.maxLevel) issues.push('titles: one title per level up to balance.xp.maxLevel is required');
  }
  if (issues.length > 0) throw new ContentValidationError(issues);
  return out as Content;
}

let cached: Content | undefined;

/** The validated bundled content (validated once, then cached). */
export function getContent(): Content {
  cached ??= validateContent(RAW_CONTENT);
  return cached;
}

/** Shortcut for `getContent().balance`. */
export function getBalance(): Balance {
  return getContent().balance;
}
