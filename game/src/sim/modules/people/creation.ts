/**
 * The first ruler from the New Saga wizard (§5.1): turns the raw choices recorded on
 * `player.creation` (allocated points, upbringing, traits) into the ruler's stored skills,
 * attributes, traits and upbringing. `buildCreation` is pure and is also what the wizard's preview
 * shows, so the preview and the created character always agree.
 *
 * Stored values are permanent: allocation + the upbringing's skill bonus + homeland bonuses
 * (`skill.*` / `attr.*` in cultures.json), clamped to the stat range. Trait modifiers are NOT baked
 * in: they stay in the traits' modifier bags and are added by `effectiveSkill`/`effectiveAttribute`
 * (ARCHITECTURE §9, single source per rule); `total` is that effective value.
 */
import type { Content, UpbringingId } from '@content/index';
import { ATTRIBUTE_IDS, SKILL_IDS, type AttributeId, type SkillId } from '@content/schemas/ids';
import { clamp } from '@sim/core/dmath';
import type { SimContext } from '@sim/core/module';
import type { CultureId, GameState, RulerCreation } from '@sim/core/state';
import { charOf } from './util';

/** One stat broken out by source. */
export interface CreationStat {
  /** Starting value before any choice (0 for skills, `attributeStart` for attributes). */
  base: number;
  allocated: number;
  upbringing: number;
  culture: number;
  /** From trait modifiers (applied at runtime, not stored). */
  traits: number;
  /** What the character stores: base + allocated + upbringing + culture, clamped. */
  stored: number;
  /** The effective value: stored + traits, clamped. */
  total: number;
}

export interface CreationResult {
  /** The upbringing, when it is a known one. */
  upbringing: UpbringingId | undefined;
  traits: string[];
  skills: Record<SkillId, CreationStat>;
  attributes: Record<AttributeId, CreationStat>;
}

function bonus(mods: Readonly<Record<string, number>> | undefined, key: string): number {
  return mods && Object.hasOwn(mods, key) ? (mods[key] ?? 0) : 0;
}

function opposed(content: Content, a: string, b: string): boolean {
  return content.traits[a]?.opposite === b || content.traits[b]?.opposite === a;
}

/** The starting traits a set of choices yields (unlocked starting trait, virtue, flaw), validated. */
export function creationTraits(content: Content, creation: RulerCreation): string[] {
  const upb = creation.upbringing !== undefined && Object.hasOwn(content.upbringings, creation.upbringing) ? content.upbringings[creation.upbringing as UpbringingId] : undefined;
  const out: string[] = [];
  const add = (id: string | null | undefined, ok: (id: string) => boolean) => {
    if (id === null || id === undefined || !Object.hasOwn(content.traits, id) || out.includes(id) || !ok(id)) return;
    if (out.some((o) => opposed(content, o, id))) return;
    out.push(id);
  };
  if (upb && creation.takeStartingTrait === true) add(upb.startingTrait, () => true);
  add(creation.positiveTrait, (id) => upb !== undefined && upb.traitOptions.includes(id));
  add(creation.negativeTrait, (id) => content.traits[id]?.creation === 'negative');
  return out;
}

/** The ruler a set of wizard choices produces, every stat broken out by source (pure). */
export function buildCreation(content: Content, culture: CultureId, creation: RulerCreation): CreationResult {
  const ch = content.balance.character;
  const upbringing = creation.upbringing !== undefined && Object.hasOwn(content.upbringings, creation.upbringing) ? (creation.upbringing as UpbringingId) : undefined;
  const upb = upbringing !== undefined ? content.upbringings[upbringing] : undefined;
  const traits = creationTraits(content, creation);
  const cultureDef = Object.hasOwn(content.cultures, culture) ? content.cultures[culture] : undefined;
  const cultureBonus = (key: string) => (cultureDef?.bonuses ?? []).reduce((sum, b) => sum + bonus(b.modifiers, key), 0);
  const traitBonus = (key: string) => traits.reduce((sum, t) => sum + bonus(content.traits[t]?.modifiers, key), 0);
  const points = (n: number | undefined, cap: number) => clamp(Math.round(Number.isFinite(n) ? (n as number) : 0), 0, cap);

  const skills = {} as Record<SkillId, CreationStat>;
  for (const s of SKILL_IDS) {
    const line: CreationStat = {
      base: 0,
      allocated: points(creation.skills?.[s], ch.skillCreationCap),
      upbringing: upb?.skill === s ? ch.upbringingSkillBonus : 0,
      culture: cultureBonus(`skill.${s}`),
      traits: traitBonus(`skill.${s}`),
      stored: 0,
      total: 0,
    };
    line.stored = clamp(line.base + line.allocated + line.upbringing + line.culture, 0, ch.skillMax);
    line.total = clamp(line.stored + line.traits, 0, ch.skillMax);
    skills[s] = line;
  }
  const attributes = {} as Record<AttributeId, CreationStat>;
  for (const a of ATTRIBUTE_IDS) {
    const line: CreationStat = {
      base: ch.attributeStart,
      allocated: points(creation.attributes?.[a], ch.attributeCreationCap - ch.attributeStart),
      upbringing: 0,
      culture: cultureBonus(`attr.${a}`),
      traits: traitBonus(`attr.${a}`),
      stored: 0,
      total: 0,
    };
    line.stored = clamp(line.base + line.allocated + line.culture, ch.attributeMin, ch.attributeMax);
    line.total = clamp(line.stored + line.traits, ch.attributeMin, ch.attributeMax);
    attributes[a] = line;
  }
  return { upbringing, traits, skills, attributes };
}

/**
 * Builds the player's first ruler from `player.creation` once (new games; saves without the record
 * are left alone). Traits are set directly: this is who the ruler has always been, not a change to
 * announce.
 */
export function applyCreation(draft: GameState, ctx: SimContext): void {
  const creation = draft.player.creation;
  if (!creation || creation.applied === true) return;
  const ruler = charOf(draft, draft.player.rulerId);
  if (ruler) {
    const r = buildCreation(ctx.content, ruler.culture, creation);
    for (const s of SKILL_IDS) ruler.skills[s] = r.skills[s].stored;
    for (const a of ATTRIBUTE_IDS) ruler.attributes[a] = r.attributes[a].stored;
    for (const t of r.traits) if (!ruler.traits.includes(t)) ruler.traits.push(t);
    if (r.upbringing !== undefined) ruler.upbringingId = r.upbringing;
  }
  creation.applied = true;
}
