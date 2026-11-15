/**
 * Line pools and the skald's word banks (design §26.3, §19.4, §23.6): zod schemas, the bundled loader and
 * structural checks.
 *
 * Files (src/content/data/lines/):
 *   <role>.json   `{ "$notes"?, "pools": LinePool[] }` — role × context pools ('smith.greeting'), each line with an
 *                 optional condition (§29.7) and weight. The narrative module selects lines deterministically with
 *                 per-session anti-repetition memory (no line of a pool repeats within a session while unused
 *                 eligible lines remain) and weights that decay with use.
 *   verse.json    `{ "$notes"?, "kennings": { bank: Kenning[] }, "templates": { group: VerseTemplate[] } }` — the
 *                 kenning generator for the year-end verse and the saga epitaph.
 *
 * Every string is a localisation key (src/content/locales/en/narrative.json). Kennings are keys too: a verse line
 * carries the template key plus vars whose VALUES are kenning keys (listed in `keyVars`), which the client resolves
 * before formatting the template.
 *
 * Content layer: imports only zod and relative paths (ARCHITECTURE.md §1).
 */
import { z } from 'zod';
import keeperJson from './data/lines/keeper.json';
import smithJson from './data/lines/smith.json';
import verseJson from './data/lines/verse.json';
import { CamelIdSchema, DottedKeySchema, ExpressionSchema } from './storylets';

/** Line-pool packs (src/content/data/lines/<pack>.json). */
export const LINE_PACKS = ['smith', 'keeper'] as const;
export type LinePackId = (typeof LINE_PACKS)[number];

/** Raw (unvalidated) line-pool packs, by pack id. */
export const RAW_LINE_PACKS: { readonly [P in LinePackId]: unknown } = {
  smith: smithJson,
  keeper: keeperJson,
};

/** Raw (unvalidated) verse bank. */
export const RAW_VERSE_BANK: unknown = verseJson;

/** Scope roots a pool may ask the caller to bind (entity roots of the condition language). */
export const LINE_SCOPE_ROOTS = ['settlement', 'holding', 'faction', 'character', 'fleet'] as const;
export type LineScopeRoot = (typeof LINE_SCOPE_ROOTS)[number];

/** One line of a pool. */
export const LineSchema = z
  .object({
    /** Unique within its pool. */
    id: CamelIdSchema,
    textKey: DottedKeySchema,
    /** Condition (§29.7) over the pool's scope roots plus player/house/ruler/time/vars. */
    when: ExpressionSchema.optional(),
    /** Relative weight (default 10). */
    weight: z.number().finite().positive().optional(),
    /** Narration voice override (§26.2); asset-manifest voice lines key off textKey. */
    voice: z.string().min(1).optional(),
  })
  .strict();

/** A role × context pool, e.g. 'smith.greeting'. */
export const LinePoolSchema = z
  .object({
    /** `${role}.${context}`. */
    id: z.string().regex(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/, "must be 'role.context'"),
    role: CamelIdSchema,
    context: CamelIdSchema,
    /** Entity roots the caller binds (by id) when asking for a line. */
    scope: z.array(z.enum(LINE_SCOPE_ROOTS)),
    /** Default narration voice for the pool. */
    voice: z.string().min(1).optional(),
    lines: z.array(LineSchema).min(1),
  })
  .strict()
  .refine((p) => p.id === `${p.role}.${p.context}`, { message: "pool id must equal 'role.context'" });

export const LinePackSchema = z
  .object({
    $notes: z.string().optional(),
    pools: z.array(LinePoolSchema),
  })
  .strict();

/** One kenning: its localisation key and the stave (lower-case initial sound) used for alliteration. */
export const KenningSchema = z
  .object({
    key: DottedKeySchema,
    stave: z.string().regex(/^[a-z]$/, 'stave must be one lower-case letter').optional(),
  })
  .strict();

/** A verse line template: a localisation key whose slot vars are filled from kenning banks. */
export const VerseTemplateSchema = z
  .object({
    key: DottedKeySchema,
    /** Template var → kenning bank. */
    slots: z.record(CamelIdSchema, CamelIdSchema).optional(),
    /** Vars the deed (or subject) must provide for this template to be usable. */
    needs: z.array(CamelIdSchema).optional(),
    /** Var whose value's initial letter the slots should alliterate with. */
    stave: CamelIdSchema.optional(),
  })
  .strict();

/** Template groups every bank must provide. */
export const REQUIRED_VERSE_GROUPS = ['yearEnd.open', 'yearEnd.close', 'epitaph.open', 'epitaph.close', 'deed.default'] as const;

export const VerseBankSchema = z
  .object({
    $notes: z.string().optional(),
    kennings: z.record(CamelIdSchema, z.array(KenningSchema).min(1)),
    /** Group ('yearEnd.open', 'deed.battle', 'epitaph.close.tier3', …) → templates. */
    templates: z.record(
      z.string().regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/, "group must be dotted camelCase (e.g. 'deed.battle')"),
      z.array(VerseTemplateSchema).min(1),
    ),
  })
  .strict();

export type LineContent = z.infer<typeof LineSchema>;
export type LinePoolContent = z.infer<typeof LinePoolSchema>;
export type KenningContent = z.infer<typeof KenningSchema>;
export type VerseTemplateContent = z.infer<typeof VerseTemplateSchema>;
export type VerseBankContent = z.infer<typeof VerseBankSchema>;

/** Thrown by the bundled loaders when content is invalid. */
export class LineContentError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Line/verse content validation failed:\n  ${issues.join('\n  ')}`);
    this.name = 'LineContentError';
  }
}

/** Validates raw line packs: schema, unique pool ids across packs and unique line ids within a pool. */
export function validateLinePacks(raw: Readonly<Record<string, unknown>>): { pools: LinePoolContent[]; issues: string[] } {
  const issues: string[] = [];
  const pools: LinePoolContent[] = [];
  const seen: Record<string, string> = {};
  for (const [pack, data] of Object.entries(raw)) {
    const parsed = LinePackSchema.safeParse(data);
    if (!parsed.success) {
      for (const i of parsed.error.issues) issues.push(`${pack}: ${i.path.join('.') || '(root)'}: ${i.message}`);
      continue;
    }
    for (const pool of parsed.data.pools) {
      if (Object.hasOwn(seen, pool.id)) issues.push(`${pack}: duplicate pool '${pool.id}' (also in ${seen[pool.id]})`);
      else seen[pool.id] = pack;
      const ids: Record<string, true> = {};
      for (const line of pool.lines) {
        if (Object.hasOwn(ids, line.id)) issues.push(`${pack}: ${pool.id}: duplicate line id '${line.id}'`);
        ids[line.id] = true;
      }
      pools.push(pool);
    }
  }
  return { pools, issues };
}

/** Validates a raw verse bank: schema, required groups and slots that name existing kenning banks. */
export function validateVerseBank(raw: unknown): { bank: VerseBankContent | undefined; issues: string[] } {
  const parsed = VerseBankSchema.safeParse(raw);
  if (!parsed.success) return { bank: undefined, issues: parsed.error.issues.map((i) => `verse: ${i.path.join('.') || '(root)'}: ${i.message}`) };
  const bank = parsed.data;
  const issues: string[] = [];
  for (const group of REQUIRED_VERSE_GROUPS) if (!Object.hasOwn(bank.templates, group)) issues.push(`verse: missing template group '${group}'`);
  for (const [group, templates] of Object.entries(bank.templates)) {
    templates.forEach((t, i) => {
      for (const [slot, b] of Object.entries(t.slots ?? {})) {
        if (!Object.hasOwn(bank.kennings, b)) issues.push(`verse: ${group}[${i}]: slot '${slot}' names unknown kenning bank '${b}'`);
        if ((t.needs ?? []).includes(slot)) issues.push(`verse: ${group}[${i}]: '${slot}' is both a slot and a needed var`);
      }
    });
  }
  return { bank, issues };
}

let cachedPools: readonly LinePoolContent[] | undefined;
let cachedBank: VerseBankContent | undefined;

/** The validated bundled line pools (validated once, then cached). Throws LineContentError. */
export function getLinePools(): readonly LinePoolContent[] {
  if (cachedPools === undefined) {
    const r = validateLinePacks(RAW_LINE_PACKS);
    if (r.issues.length > 0) throw new LineContentError(r.issues);
    cachedPools = r.pools;
  }
  return cachedPools;
}

/** The validated bundled verse bank (validated once, then cached). Throws LineContentError. */
export function getVerseBank(): VerseBankContent {
  if (cachedBank === undefined) {
    const r = validateVerseBank(RAW_VERSE_BANK);
    if (r.issues.length > 0 || r.bank === undefined) throw new LineContentError(r.issues);
    cachedBank = r.bank;
  }
  return cachedBank;
}
