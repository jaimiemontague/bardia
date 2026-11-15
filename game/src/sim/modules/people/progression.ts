/**
 * Character progression (§22.1–§22.2, §22.8, §12.5): XP with the Wits bonus and the lieutenant
 * multiplier, levels from the §22.1 table, skill/attribute points (auto-assigned by inclination or
 * left for the player), Saga Feats at levels 5/10/15/20, titles with Honor/Dread variants, and
 * deed-names that override the title.
 */
import type { Content } from '@content/index';
import { ATTRIBUTE_IDS, SKILL_IDS, type AttributeId } from '@content/schemas/ids';
import type { TitleCondition } from '@content/schemas/titles';
import { levelForXp } from '@sim/core/balance';
import { CommandError } from '@sim/core/commands';
import type { CommandHandler, SimContext } from '@sim/core/module';
import type { Character, GameState, PlayerHouse, SkillId, TextVars } from '@sim/core/state';
import { charOf, chronicleHouse, injuryDelta, isPlayerHouse, modifierSum, notifyHouse, STREAMS } from './util';

// ---------------------------------------------------------------------------------------------
// XP and levels

/** Wits as it affects learning: base + trait modifiers + injuries (wounds do not slow learning). */
function learningWits(c: Character, content: Content): number {
  return c.attributes.wits + modifierSum(c, content, 'attr.wits') + injuryDelta(c, content, 'attribute', 'wits');
}

/** XP multiplier: Wits ±2%/pt around the pivot; non-rulers learn at the lieutenant rate (§12.5). */
export function xpMultiplier(state: GameState, c: Character, content: Content): number {
  const b = content.balance;
  let mult = 1 + b.xp.witsBonusPerPoint * (learningWits(c, content) - b.character.attributePivot);
  const isRuler = c.id === state.player.rulerId || c.role?.kind === 'ruler';
  if (!isRuler) mult *= b.xp.lieutenantMult;
  return Math.max(0, mult);
}

/**
 * Grants experience (rounded after multipliers) and processes every level reached. Returns the
 * XP actually gained (0 for the dead or non-positive amounts).
 */
export function grantXp(draft: GameState, ctx: SimContext, c: Character, amount: number, source: string): number {
  if (!c.alive || !(amount > 0) || !Number.isFinite(amount)) return 0;
  const gained = Math.round(amount * xpMultiplier(draft, c, ctx.content));
  if (gained <= 0) return 0;
  c.xp += gained;
  ctx.emit({ type: 'XpGained', charId: c.id, amount: gained, source });
  const target = Math.min(levelForXp(ctx.balance, c.xp), ctx.balance.xp.maxLevel);
  while (c.level < target) levelUp(draft, ctx, c);
  return gained;
}

/** The player decides this character's level-up points. */
export function allocatesManually(state: GameState, c: Character): boolean {
  if (c.id === state.player.rulerId) return true;
  return isPlayerHouse(state, c) && state.player.policies.levelUpPoints === 'manual';
}

function levelUp(draft: GameState, ctx: SimContext, c: Character): void {
  const xp = ctx.balance.xp;
  c.level += 1;
  const level = c.level;
  const skillPoints = xp.skillPointsPerLevel;
  const attributePoints = xp.attributePointLevels.includes(level) ? 1 : 0;
  const featLevel = xp.featLevels.includes(level);
  if (allocatesManually(draft, c)) {
    c.unspentSkillPoints = (c.unspentSkillPoints ?? 0) + skillPoints;
    if (attributePoints > 0) c.unspentAttributePoints = (c.unspentAttributePoints ?? 0) + attributePoints;
  } else {
    autoAllocate(c, ctx.content, skillPoints, attributePoints);
  }
  ctx.emit({ type: 'LevelUp', charId: c.id, level, skillPoints, attributePoints, featLevel });
  const isRuler = c.id === draft.player.rulerId;
  notifyHouse(ctx, c, 'people.notify.levelUp', { level }, isRuler ? 'high' : 'normal');
  if (isRuler && featLevel) chronicleHouse(ctx, c, 'levelUp', 'people.chronicle.levelUp', 2, { level });
  refreshTitle(draft, ctx, c);
  if (featLevel) offerFeat(draft, ctx, c, level);
}

// ---------------------------------------------------------------------------------------------
// Inclination: NPCs (and lieutenants under the auto policy) grow along their best skills.

/** Skills ordered by inclination: highest base value first, ties in canonical order. */
export function inclinedSkills(c: Character): SkillId[] {
  return SKILL_IDS.map((s, i) => [s, i] as const)
    .sort((a, b) => (c.skills[b[0]] ?? 0) - (c.skills[a[0]] ?? 0) || a[1] - b[1])
    .map(([s]) => s);
}

/** The skill one point goes to: the lower of the two inclined skills, else the best uncapped one. */
export function nextInclinedSkill(c: Character, content: Content, preferred?: SkillId): SkillId | undefined {
  const cap = content.balance.character.skillMax;
  const order = inclinedSkills(c);
  if (preferred !== undefined && (c.skills[preferred] ?? 0) < cap) return preferred;
  const top = order.slice(0, 2).filter((s) => (c.skills[s] ?? 0) < cap);
  if (top.length > 0) return top.reduce((lo, s) => ((c.skills[s] ?? 0) < (c.skills[lo] ?? 0) ? s : lo));
  return order.find((s) => (c.skills[s] ?? 0) < cap);
}

/** The attribute one point goes to: the one the leading skill favours, else the best uncapped one. */
export function nextInclinedAttribute(c: Character, content: Content, leading?: SkillId): AttributeId | undefined {
  const cap = content.balance.character.attributeMax;
  const skill = leading ?? inclinedSkills(c)[0];
  const favoured = skill !== undefined ? content.tunables.people.skillAttribute[skill] : undefined;
  if (favoured !== undefined && c.attributes[favoured] < cap) return favoured;
  return ATTRIBUTE_IDS.map((a, i) => [a, i] as const)
    .filter(([a]) => c.attributes[a] < cap)
    .sort((a, b) => c.attributes[b[0]] - c.attributes[a[0]] || a[1] - b[1])
    .map(([a]) => a)[0];
}

/** Spends points by inclination (points that cannot be placed under the caps are lost). */
export function autoAllocate(c: Character, content: Content, skillPoints: number, attributePoints: number, focus?: SkillId): void {
  for (let i = 0; i < skillPoints; i++) {
    const s = nextInclinedSkill(c, content, focus);
    if (s === undefined) break;
    c.skills[s] = (c.skills[s] ?? 0) + 1;
  }
  for (let i = 0; i < attributePoints; i++) {
    const a = nextInclinedAttribute(c, content, focus);
    if (a === undefined) break;
    c.attributes[a] += 1;
  }
}

// ---------------------------------------------------------------------------------------------
// Saga Feats

/** Feats already on offer to this character in an unresolved featChoice (one XP grant can cross two feat levels). */
function featsOnOffer(state: GameState, c: Character): string[] {
  const out: string[] = [];
  for (const p of [state.pending, ...state.pendingQueue]) {
    if (p?.kind === 'featChoice' && p.payload.charId === c.id) out.push(...p.payload.options);
  }
  return out;
}

function offerFeat(draft: GameState, ctx: SimContext, c: Character, level: number): void {
  const offered = c.id === draft.player.rulerId ? featsOnOffer(draft, c) : [];
  let pool = Object.keys(ctx.content.feats).filter((f) => !c.feats.includes(f));
  // Never offer the same feat twice at once, unless that would leave nothing to choose from.
  if (pool.some((f) => !offered.includes(f))) pool = pool.filter((f) => !offered.includes(f));
  if (pool.length === 0) return;
  const options = ctx.rng(STREAMS.progression).shuffle(pool).slice(0, ctx.balance.xp.featChoices);
  if (c.id === draft.player.rulerId) {
    const decision = ctx.pend({ kind: 'featChoice', payload: { charId: c.id, level, options } });
    // What the generic decision modal shows: one button per feat offered (they need the id).
    const p = decision.payload;
    p.titleKey = 'people.featChoice.title';
    p.illustration = 'people.illus.featChoice';
    p.key = 'people.featChoice.body';
    p.vars = { name: c.name };
    p.choices = options.map((featId) => ({
      id: featId,
      labelKey: 'people.featChoice.option',
      vars: { name: ctx.content.feats[featId]?.name ?? featId, description: ctx.content.feats[featId]?.description ?? '' },
      command: { type: 'chooseFeat' as const, pendingId: decision.id, featId },
    }));
    notifyHouse(ctx, c, 'people.notify.featChoice', { level }, 'high');
    return;
  }
  if (!ctx.tunables.people.npcFeats) return;
  const pick = bestFeatFor(c, options, ctx.content);
  if (pick !== undefined) addFeat(ctx, c, pick);
}

/** The offered feat whose affinity skill the character is best at (ties: first offered). */
export function bestFeatFor(c: Character, options: readonly string[], content: Content): string | undefined {
  let best: string | undefined;
  let bestScore = -Infinity;
  for (const f of options) {
    const skill = content.tunables.people.featAffinity[f];
    const score = skill !== undefined ? (c.skills[skill] ?? 0) : 0;
    if (score > bestScore) {
      best = f;
      bestScore = score;
    }
  }
  return best;
}

function addFeat(ctx: SimContext, c: Character, featId: string): void {
  if (c.feats.includes(featId)) return;
  c.feats.push(featId);
  ctx.emit({ type: 'FeatChosen', charId: c.id, featId });
}

/** `chooseFeat`: resolve the current featChoice decision. */
export const handleChooseFeat: CommandHandler<'chooseFeat'> = (draft, cmd, ctx) => {
  const p = draft.pending;
  if (!p || p.id !== cmd.pendingId || p.kind !== 'featChoice') throw new CommandError('notPending', `'${cmd.pendingId}' is not a pending feat choice`);
  if (!p.payload.options.includes(cmd.featId)) throw new CommandError('invalidFeat', `'${cmd.featId}' was not offered`);
  const c = charOf(draft, p.payload.charId);
  if (c?.feats.includes(cmd.featId) && p.payload.options.some((f) => !c.feats.includes(f))) {
    throw new CommandError('featKnown', `${c.name} already has '${cmd.featId}'`);
  }
  if (c?.alive) {
    addFeat(ctx, c, cmd.featId);
    notifyHouse(ctx, c, 'people.notify.featChosen', { feat: cmd.featId });
  }
  ctx.resolvePending(p.id);
};

// ---------------------------------------------------------------------------------------------
// Point allocation by the player

/** `allocatePoints`: spend unspent skill/attribute points. */
export const handleAllocatePoints: CommandHandler<'allocatePoints'> = (draft, cmd, ctx) => {
  const c = charOf(draft, cmd.charId);
  if (!c) throw new CommandError('unknownCharacter', `No character ${cmd.charId}`);
  if (!c.alive) throw new CommandError('dead', `${c.name} is dead`);
  if (!isPlayerHouse(draft, c)) throw new CommandError('notYours', `${c.name} does not serve your house`);
  const ch = ctx.balance.character;
  const skills = Object.entries(cmd.skills ?? {}) as [SkillId, number][];
  const attributes = Object.entries(cmd.attributes ?? {}) as [AttributeId, number][];
  let skillTotal = 0;
  for (const [s, n] of skills) {
    if (!(SKILL_IDS as readonly string[]).includes(s)) throw new CommandError('unknownSkill', `Unknown skill '${s}'`);
    if (!Number.isInteger(n) || n < 0) throw new CommandError('invalidPoints', 'Points must be non-negative integers');
    if ((c.skills[s] ?? 0) + n > ch.skillMax) throw new CommandError('skillCap', `${s} cannot exceed ${ch.skillMax}`);
    skillTotal += n;
  }
  let attributeTotal = 0;
  for (const [a, n] of attributes) {
    if (!(ATTRIBUTE_IDS as readonly string[]).includes(a)) throw new CommandError('unknownAttribute', `Unknown attribute '${a}'`);
    if (!Number.isInteger(n) || n < 0) throw new CommandError('invalidPoints', 'Points must be non-negative integers');
    if (c.attributes[a] + n > ch.attributeMax) throw new CommandError('attributeCap', `${a} cannot exceed ${ch.attributeMax}`);
    attributeTotal += n;
  }
  if (skillTotal === 0 && attributeTotal === 0) throw new CommandError('nothingToAllocate', 'No points given');
  if (skillTotal > (c.unspentSkillPoints ?? 0)) throw new CommandError('notEnoughPoints', 'Not enough skill points');
  if (attributeTotal > (c.unspentAttributePoints ?? 0)) throw new CommandError('notEnoughPoints', 'Not enough attribute points');
  for (const [s, n] of skills) c.skills[s] = (c.skills[s] ?? 0) + n;
  for (const [a, n] of attributes) c.attributes[a] += n;
  c.unspentSkillPoints = (c.unspentSkillPoints ?? 0) - skillTotal;
  c.unspentAttributePoints = (c.unspentAttributePoints ?? 0) - attributeTotal;
  if (c.unspentSkillPoints === 0) delete c.unspentSkillPoints;
  if (c.unspentAttributePoints === 0) delete c.unspentAttributePoints;
};

// ---------------------------------------------------------------------------------------------
// Titles and deed-names

function conditionMet(when: TitleCondition, house: PlayerHouse): boolean {
  const value =
    when.stat === 'honor' ? house.honor : when.stat === 'dread' ? house.dread : when.stat === 'renown' ? house.renown : house.honor - house.dread;
  switch (when.op) {
    case 'gte':
      return value >= when.value;
    case 'gt':
      return value > when.value;
    case 'lte':
      return value <= when.value;
    default:
      return value < when.value;
  }
}

/**
 * Locale key of a character's level title: `people.title.<level>`, or `people.title.<level>.v<i>`
 * for the first matching Honor/Dread variant. Variants read the player's house standings, so they
 * apply to the player's ruler only.
 */
export function titleKeyFor(state: GameState, content: Content, c: Character): string {
  const titles = content.titles;
  const def = titles[Math.min(Math.max(c.level, 1), titles.length) - 1];
  if (!def) return 'people.title.1';
  if (c.id === state.player.rulerId) {
    for (let i = 0; i < def.variants.length; i++) {
      const v = def.variants[i];
      if (v && conditionMet(v.when, state.player.house)) return `people.title.${def.level}.v${i}`;
    }
  }
  return `people.title.${def.level}`;
}

/** Recomputes the title; emits TitleChanged when it differs. */
export function refreshTitle(draft: GameState, ctx: SimContext, c: Character): void {
  if (!c.alive) return;
  const key = titleKeyFor(draft, ctx.content, c);
  if (c.title === key) return;
  const previous = c.title;
  c.title = key;
  const event: { type: 'TitleChanged'; charId: Character['id']; titleKey: string; previousKey?: string; deedNameKey?: string } = {
    type: 'TitleChanged',
    charId: c.id,
    titleKey: key,
  };
  if (previous !== undefined) event.previousKey = previous;
  if (c.deedName) event.deedNameKey = c.deedName.key;
  ctx.emit(event);
  if (previous !== undefined && c.id === draft.player.rulerId) notifyHouse(ctx, c, 'people.notify.titleChanged', { titleKey: key });
}

/** Grants a deed-name (overrides the level title in display). */
export function grantDeedName(draft: GameState, ctx: SimContext, c: Character, key: string, vars?: TextVars): void {
  c.deedName = vars !== undefined ? { key, vars: { ...vars }, hour: ctx.hour } : { key, hour: ctx.hour };
  const titleKey = c.title ?? titleKeyFor(draft, ctx.content, c);
  ctx.emit({ type: 'TitleChanged', charId: c.id, titleKey, deedNameKey: key });
  notifyHouse(ctx, c, 'people.notify.deedName', {}, 'high');
  chronicleHouse(ctx, c, 'deedName', 'people.chronicle.deedName', 3);
}
