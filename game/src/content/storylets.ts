/**
 * The storylet content pack (design §19.1, §19.2, §26.3, §30.7): zod schemas, the bundled loader and the
 * structural checks that need no simulation registry.
 *
 * Files (src/content/data/storylets/<pack>.json), each `{ "$notes"?: string, "storylets": StoryletDef[] }`.
 * Storylets are JSON (no build step); every player-visible string is a localisation key in
 * src/content/locales/en/narrative.json and every illustration an asset-manifest id.
 *
 * The narrative module adds the checks that need the simulation registry at load time: condition
 * expressions (§29.7) are parsed and type-checked against the registered condition functions and the
 * path catalogue, effects are validated with `validateEffects(env, …)`, and triggers/scopes are checked
 * against the trigger registry (src/sim/modules/narrative/library.ts).
 *
 * Effect parameters may reference the storylet's scope and variables:
 *   "$settlement" | "$holding" | "$capital"   → a settlement id      "$faction" | "$player" → a faction id
 *   "$character" | "$ruler"                    → a character id       "$fleet"               → a fleet id
 *   { "$var": "name" }                          → the instance variable `name` (see `vars`)
 *   { "$expr": "floor(holding.pop / 50)" }      → a condition-language expression evaluated when applied
 *
 * Content layer: imports only zod and relative paths (ARCHITECTURE.md §1).
 */
import { z } from 'zod';
import battleJson from './data/storylets/battle.json';
import personalJson from './data/storylets/personal.json';
import petitionsJson from './data/storylets/petitions.json';
import voyageJson from './data/storylets/voyage.json';

/** The storylet packs (src/content/data/storylets/<pack>.json). */
export const STORYLET_PACKS = ['petitions', 'personal', 'voyage', 'battle'] as const;
export type StoryletPackId = (typeof STORYLET_PACKS)[number];

/** Raw (unvalidated) pack JSON, by pack id. */
export const RAW_STORYLET_PACKS: { readonly [P in StoryletPackId]: unknown } = {
  petitions: petitionsJson,
  personal: personalJson,
  voyage: voyageJson,
  battle: battleJson,
};

// ---------------------------------------------------------------------------------------------
// Building blocks.

/** camelCase identifier (storylet ids, triggers, scopes, variable names). */
export const CamelIdSchema = z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'must be a camelCase identifier');
/** Dotted localisation key or asset id, e.g. 'narrative.storylet.ratsInTheStores.text'. */
export const DottedKeySchema = z
  .string()
  .regex(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_-]+)+$/, "must be a dotted key with an area prefix (e.g. 'narrative.x.y')");
/** A condition-language expression (§29.7). Parsed and type-checked by the narrative module. */
export const ExpressionSchema = z.string().min(1).max(2000);
/** Effect data `{ op, ...params }`; the op's own zod schema is applied by the narrative module at load. */
export const EffectDataSchema = z.object({ op: z.string().min(1) }).passthrough();

const TriggerParamValueSchema = z.union([z.string(), z.number().finite(), z.boolean()]);

/** One choice of a storylet (§19.1). */
export const StoryletChoiceSchema = z
  .object({
    /** Localisation key of the button label. */
    labelKey: DottedKeySchema,
    /** Condition-language expression; the choice is shown disabled when false. rand() is not allowed here. */
    when: ExpressionSchema.optional(),
    /** Localisation key of the consequence preview shown on hover. */
    previewKey: DottedKeySchema.optional(),
    /** Applied in order when chosen. */
    effects: z.array(EffectDataSchema),
    /** Storylet id to chain into immediately after this choice. */
    followUp: CamelIdSchema.optional(),
    /** Chronicle entry written when this choice is taken (overrides the storylet's `chronicleKey`). */
    chronicleKey: DottedKeySchema.optional(),
  })
  .strict();

/** A storylet (§19.1, §30.7) plus the narrative module's optional extensions. */
export const StoryletSchema = z
  .object({
    id: CamelIdSchema,
    /** player | holding | settlement | faction | character | fleet (an augmentable registry). */
    scope: CamelIdSchema,
    /** monthly | onArrival | … | scheduled (an augmentable registry). */
    trigger: CamelIdSchema,
    /** Trigger parameters matched by equality against the firing (e.g. { "player": true }). */
    triggerParams: z.record(CamelIdSchema, TriggerParamValueSchema).optional(),
    /** Eligibility condition (§29.7). */
    when: ExpressionSchema.optional(),
    weight: z.number().finite().positive().optional(),
    cooldownDays: z.number().int().min(0).optional(),
    once: z.boolean().optional(),
    textKey: DottedKeySchema,
    /** Short title for inbox lists and notifications. */
    titleKey: DottedKeySchema.optional(),
    /** Asset-manifest id. */
    illustration: DottedKeySchema.optional(),
    /** Days a deferred storylet waits in the inbox before the default choice is applied. */
    expiresInDays: z.number().int().min(1).optional(),
    /** Index into `choices` used when the storylet is ignored, delegated or expires. */
    defaultChoice: z.number().int().min(0).optional(),
    /** May the steward settle it (petitions policy)? Default: true for holding storylets with a default choice. */
    delegable: z.boolean().optional(),
    /** Chronicle importance of the outcome (with `chronicleKey` on the storylet or the choice). */
    importance: z.number().finite().min(0).optional(),
    /** Chronicle entry written when the storylet resolves (a choice's `chronicleKey` overrides it). */
    chronicleKey: DottedKeySchema.optional(),
    /** Instance variables: name → expression, evaluated once when the storylet fires (text vars + { "$var" }). */
    vars: z.record(CamelIdSchema, ExpressionSchema).optional(),
    choices: z.array(StoryletChoiceSchema).min(1).max(8),
  })
  .strict();

export const StoryletPackSchema = z
  .object({
    /** Free-form notes for writers; ignored by the game. */
    $notes: z.string().optional(),
    storylets: z.array(StoryletSchema),
  })
  .strict();

export type StoryletContentChoice = z.infer<typeof StoryletChoiceSchema>;
export type StoryletContent = z.infer<typeof StoryletSchema>;

/** Thrown by getStorylets() when the bundled pack is invalid; `issues` lists `pack: path: message` lines. */
export class StoryletContentError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Storylet content validation failed:\n  ${issues.join('\n  ')}`);
    this.name = 'StoryletContentError';
  }
}

/** Result of validating storylet packs: the storylets in pack order and any issues found. */
export interface StoryletPackResult {
  storylets: StoryletContent[];
  issues: string[];
}

/**
 * Validates raw packs (schema + structure): unique ids across packs, `defaultChoice` in range and
 * unconditional, `expiresInDays` only with a default choice, and follow-ups that exist.
 */
export function validateStoryletPacks(raw: Readonly<Record<string, unknown>>): StoryletPackResult {
  const issues: string[] = [];
  const storylets: StoryletContent[] = [];
  const seen: Record<string, string> = {};
  for (const [pack, data] of Object.entries(raw)) {
    const parsed = StoryletPackSchema.safeParse(data);
    if (!parsed.success) {
      for (const i of parsed.error.issues) issues.push(`${pack}: ${i.path.join('.') || '(root)'}: ${i.message}`);
      continue;
    }
    for (const s of parsed.data.storylets) {
      const where = `${pack}: ${s.id}`;
      if (Object.hasOwn(seen, s.id)) issues.push(`${where}: duplicate storylet id (also in ${seen[s.id]})`);
      else seen[s.id] = pack;
      if (s.defaultChoice !== undefined) {
        const choice = s.choices[s.defaultChoice];
        if (!choice) issues.push(`${where}: defaultChoice ${s.defaultChoice} is out of range (${s.choices.length} choices)`);
        else if (choice.when !== undefined) issues.push(`${where}: the default choice must not have a 'when' condition`);
      }
      if (s.expiresInDays !== undefined && s.defaultChoice === undefined) issues.push(`${where}: expiresInDays needs a defaultChoice`);
      if (s.delegable === true && s.defaultChoice === undefined) issues.push(`${where}: delegable storylets need a defaultChoice`);
      storylets.push(s);
    }
  }
  for (const s of storylets) {
    s.choices.forEach((c, i) => {
      if (c.followUp !== undefined && !Object.hasOwn(seen, c.followUp)) issues.push(`${s.id}: choice ${i} follows up unknown storylet '${c.followUp}'`);
    });
  }
  return { storylets, issues };
}

let cached: readonly StoryletContent[] | undefined;

/** The validated bundled storylets (validated once, then cached). Throws StoryletContentError. */
export function getStorylets(): readonly StoryletContent[] {
  if (cached === undefined) {
    const r = validateStoryletPacks(RAW_STORYLET_PACKS);
    if (r.issues.length > 0) throw new StoryletContentError(r.issues);
    cached = r.storylets;
  }
  return cached;
}
