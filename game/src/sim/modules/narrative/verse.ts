/**
 * The skald's kenning generator (design §19.4 year-end verse, §23.6 saga epitaph, §26.2–§26.3). Exposed as
 * the `composeVerse` effect op (the saga module applies it and reads `state.storylets.verses[targetKey]`)
 * and as the pure function `composeVerseLines` (tools, tests, previews).
 *
 * Algorithm (deterministic for a given random source; the effect uses the 'narrative:verse' stream):
 *   1. Deeds are ranked by importance (default 1; ties keep input order) and taken while the verse has room
 *      (`maxDeeds[kind]`) and the deed's kind is under its diversity cap (`maxPerKind`, e.g. 2 battles,
 *      1 marriage).
 *   2. Lines: an opening ('<kind>.open'), one line per taken deed ('deed.<deedKind>', falling back to
 *      'deed.default'), a closing ('<kind>.close', or 'epitaph.close.tier<N>' when `tier` is given and
 *      the bank has that group).
 *   3. Template choice: among the group's templates whose `needs` vars are all available (deed vars, the
 *      subject's `name`, `year`), preferring templates not yet used in this verse; one uniform draw.
 *   4. Slots, in sorted slot-name order: a kenning from the slot's bank, preferring kennings not yet used in
 *      this verse; weight 1, × `staveBonus` when the kenning's stave equals the first letter of the template's
 *      stave var (alliteration with the place or foe); one weighted draw.
 *   5. A line is { key: template key, vars: subject + deed vars + slot → kenning KEY, keyVars: slot names }.
 *      The client resolves each keyVar's kenning key to text, then formats the template (resolveVerseLine).
 */
import type { VerseBankContent, VerseTemplateContent } from '@content/lines';
import type { RandomSource } from '@sim/core/rng';
import type { TextVars } from '@sim/core/state';
import type { ComposeVerseParams, VerseDeed, VerseLine } from './types';

/** Verse limits (tunables.narrative.verse). */
export interface VerseLimits {
  maxDeeds: { yearEnd: number; epitaph: number };
  maxPerKind: Readonly<Record<string, number>>;
  defaultMaxPerKind: number;
  staveBonus: number;
}

type Request = Pick<ComposeVerseParams, 'kind' | 'deeds' | 'subject' | 'year' | 'tier'>;

/** Deeds that make it into the verse, in order. */
export function selectDeeds(deeds: readonly VerseDeed[], kind: Request['kind'], limits: VerseLimits): VerseDeed[] {
  const ranked = deeds.map((d, i) => ({ d, i })).sort((a, b) => (b.d.importance ?? 1) - (a.d.importance ?? 1) || a.i - b.i);
  const perKind: Record<string, number> = {};
  const out: VerseDeed[] = [];
  const max = limits.maxDeeds[kind];
  for (const { d } of ranked) {
    if (out.length >= max) break;
    const cap = Object.hasOwn(limits.maxPerKind, d.kind) ? (limits.maxPerKind[d.kind] as number) : limits.defaultMaxPerKind;
    const used = Object.hasOwn(perKind, d.kind) ? (perKind[d.kind] as number) : 0;
    if (used >= cap) continue;
    perKind[d.kind] = used + 1;
    out.push(d);
  }
  return out;
}

function templatesOf(bank: VerseBankContent, group: string): readonly VerseTemplateContent[] {
  return Object.hasOwn(bank.templates, group) ? (bank.templates[group] as VerseTemplateContent[]) : [];
}

function usable(t: VerseTemplateContent, vars: Readonly<TextVars>): boolean {
  return (t.needs ?? []).every((v) => Object.hasOwn(vars, v) && vars[v] !== null && vars[v] !== '');
}

function pickTemplate(bank: VerseBankContent, group: string, vars: Readonly<TextVars>, usedTemplates: Record<string, true>, rng: RandomSource): VerseTemplateContent | undefined {
  const ok = templatesOf(bank, group).filter((t) => usable(t, vars));
  if (ok.length === 0) return undefined;
  const fresh = ok.filter((t) => !Object.hasOwn(usedTemplates, t.key));
  const pool = fresh.length > 0 ? fresh : ok;
  return rng.pick(pool);
}

function fillLine(bank: VerseBankContent, t: VerseTemplateContent, vars: TextVars, usedKennings: Record<string, true>, rng: RandomSource, staveBonus: number): VerseLine {
  const out: TextVars = { ...vars };
  const slots = Object.keys(t.slots ?? {}).sort();
  const staveSource = t.stave !== undefined ? vars[t.stave] : undefined;
  const stave = typeof staveSource === 'string' && staveSource.length > 0 ? staveSource[0]?.toLowerCase() : undefined;
  for (const slot of slots) {
    const bankId = (t.slots as Record<string, string>)[slot] as string;
    const entries = Object.hasOwn(bank.kennings, bankId) ? (bank.kennings[bankId] ?? []) : [];
    if (entries.length === 0) continue;
    const fresh = entries.filter((k) => !Object.hasOwn(usedKennings, k.key));
    const pool = fresh.length > 0 ? fresh : entries;
    const k = rng.weighted(pool, (x) => (stave !== undefined && x.stave === stave ? staveBonus : 1)) ?? pool[0];
    if (!k) continue;
    usedKennings[k.key] = true;
    out[slot] = k.key;
  }
  return { key: t.key, vars: out, keyVars: slots.filter((s) => Object.hasOwn(out, s)) };
}

/** Composes a verse. Pure given `rng`. */
export function composeVerseLines(bank: VerseBankContent, req: Request, rng: RandomSource, limits: VerseLimits): VerseLine[] {
  const base: TextVars = {};
  if (req.subject !== undefined) {
    base.name = req.subject.name;
    if (req.subject.sex !== undefined) base.sex = req.subject.sex;
  }
  if (req.year !== undefined) base.year = req.year;
  const usedTemplates: Record<string, true> = {};
  const usedKennings: Record<string, true> = {};
  const lines: VerseLine[] = [];
  const emit = (groups: readonly string[], vars: TextVars) => {
    for (const g of groups) {
      const t = pickTemplate(bank, g, vars, usedTemplates, rng);
      if (!t) continue;
      usedTemplates[t.key] = true;
      lines.push(fillLine(bank, t, vars, usedKennings, rng, limits.staveBonus));
      return;
    }
  };
  emit([`${req.kind}.open`], base);
  for (const deed of selectDeeds(req.deeds, req.kind, limits)) emit([`deed.${deed.kind}`, 'deed.default'], { ...base, ...(deed.vars ?? {}) });
  const close = req.tier !== undefined && req.kind === 'epitaph' ? [`epitaph.close.tier${req.tier}`, 'epitaph.close'] : [`${req.kind}.close`];
  emit(close, base);
  return lines;
}

/**
 * Renders a verse line with a lookup (the client passes its i18n formatter): each keyVar's kenning key is
 * resolved first, then the template is formatted with the resolved vars.
 */
export function resolveVerseLine(line: VerseLine, lookup: (key: string, vars?: Readonly<TextVars>) => string): string {
  const vars: TextVars = { ...line.vars };
  for (const k of line.keyVars) {
    const v = vars[k];
    if (typeof v === 'string') vars[k] = lookup(v);
  }
  return lookup(line.key, vars);
}
