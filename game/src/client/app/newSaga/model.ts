/**
 * The New Saga wizard model (design §5.1): the player's choices, their rules (points, caps, trait
 * exclusions), per-step validation, "Random" and "Recommended" fills, the character preview and the
 * mapping onto `NewGameOptions`. Pure functions over content catalogs, so it is unit tested without
 * React and the same rules drive Quick Start.
 *
 * Randomness here is the client's (wizard dice), never the simulation's: callers pass a seeded `Rng`
 * so tests are deterministic. The campaign seed is a separate, player-visible choice.
 */
import type { Content, UpbringingId } from '@content/index';
import type { AttributeId, DifficultyId, HomelandCultureId, SkillId } from '@content/schemas/ids';
import { ATTRIBUTE_IDS, DIFFICULTY_IDS, HOMELAND_CULTURE_IDS, SKILL_IDS } from '@content/schemas/ids';
import { UPBRINGING_IDS } from '@content/schemas/upbringings';
import type { NewGameOptions } from '@sim/core/lifecycle';
import type { PlaceholderPlayerOptions } from '@sim/core/factory';
import type { GameOptions, RulerCreation } from '@sim/core/state';
import { buildCreation, creationTraits, type CreationStat } from '@sim/modules/people/creation';
import { generatePersonalName } from '@sim/core/names';
import type { RandomSource } from '@sim/core/rng';
import type { JarldomOption } from './provinces';

/** Wizard steps in order (§5.1 steps 1–10). */
export const WIZARD_STEPS = ['identity', 'homeland', 'parentage', 'upbringing', 'skills', 'attributes', 'trait', 'jarldom', 'difficulty', 'confirm'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Toggles of step 9 (GameOptions minus the ones the wizard does not show). */
export type SagaToggles = Pick<GameOptions, 'ironman' | 'gentleMode' | 'duelAssist' | 'autoResolveFair' | 'harshWinters' | 'blood'>;
export const TOGGLE_IDS = ['ironman', 'gentleMode', 'duelAssist', 'autoResolveFair', 'harshWinters', 'blood'] as const satisfies readonly (keyof SagaToggles)[];

/** Portrait layer pickers offered at step 1 (keys understood by the portrait painter). */
export const PORTRAIT_LAYERS = ['face', 'hair', 'beard', 'skin'] as const;
export type PortraitLayerKey = (typeof PORTRAIT_LAYERS)[number];
/** Variant counts per picker (the painter wraps indices, so these only bound the UI counter). */
export const PORTRAIT_LAYER_COUNTS: Readonly<Record<PortraitLayerKey, number>> = { face: 6, hair: 16, beard: 9, skin: 8 };

export interface NewSagaChoices {
  name: string;
  sex: 'male' | 'female';
  portrait: { seed: number; layers: Partial<Record<PortraitLayerKey, number>>; scars: boolean };
  culture: HomelandCultureId;
  /** Which parent was the slain Jarl (the other survives as counsellor/regent). */
  slainParent: 'father' | 'mother';
  upbringing: UpbringingId;
  /** Take the optional starting trait the upbringing unlocks. */
  takeStartingTrait: boolean;
  /** Points ALLOCATED per skill (bonuses are added on top). */
  skills: Record<SkillId, number>;
  /** Points ALLOCATED per attribute above the starting value. */
  attributes: Record<AttributeId, number>;
  positiveTrait: string | null;
  negativeTrait: string | null;
  /** Chosen province id from the world pack (null: let the world module choose). */
  startProvinceId: string | null;
  difficulty: DifficultyId;
  toggles: SagaToggles;
  seed: string;
}

function zeroSkills(): Record<SkillId, number> {
  return Object.fromEntries(SKILL_IDS.map((s) => [s, 0])) as Record<SkillId, number>;
}
function zeroAttributes(): Record<AttributeId, number> {
  return Object.fromEntries(ATTRIBUTE_IDS.map((a) => [a, 0])) as Record<AttributeId, number>;
}

/** A campaign seed word ("ketil-4821"). */
export function randomSeed(rng: RandomSource): string {
  const words = ['ash', 'brine', 'ember', 'fjord', 'gale', 'horn', 'iron', 'keel', 'mead', 'oar', 'rune', 'salt', 'skerry', 'thorn', 'wave', 'wolf'];
  return `${rng.pick(words)}-${rng.int(1000, 9999)}`;
}

/** Toggle defaults for a difficulty (Duel Assist follows the preset, §5.5). */
export function defaultToggles(content: Content, difficulty: DifficultyId): SagaToggles {
  return {
    ironman: false,
    gentleMode: false,
    duelAssist: content.balance.difficulty[difficulty].duelAssistDefault,
    autoResolveFair: false,
    harshWinters: false,
    blood: true,
  };
}

/** Fresh choices: recommended mechanics with a random identity. */
export function initialChoices(content: Content, rng: RandomSource): NewSagaChoices {
  const base: NewSagaChoices = {
    name: '',
    sex: 'female',
    portrait: { seed: rng.u32(), layers: {}, scars: false },
    culture: 'skarn',
    slainParent: 'father',
    upbringing: 'hirdRaised',
    takeStartingTrait: true,
    skills: zeroSkills(),
    attributes: zeroAttributes(),
    positiveTrait: null,
    negativeTrait: null,
    startProvinceId: null,
    difficulty: 'raider',
    toggles: defaultToggles(content, 'raider'),
    seed: randomSeed(rng),
  };
  let c = randomizeStep('identity', base, content, rng, []);
  for (const step of WIZARD_STEPS) if (step !== 'identity') c = recommendStep(step, c, content, []);
  return c;
}

// ---------------------------------------------------------------------------------------------
// Rules

/** Skill points available (difficulty preset + the negative-trait bonus). */
export function skillPointsAvailable(c: NewSagaChoices, content: Content): number {
  const preset = content.balance.difficulty[c.difficulty];
  return preset.skillPoints + (c.negativeTrait ? content.balance.character.negativeTraitSkillPoints : 0);
}
export function skillPointsSpent(c: NewSagaChoices): number {
  return SKILL_IDS.reduce((sum, s) => sum + c.skills[s], 0);
}
export function attributePointsAvailable(c: NewSagaChoices, content: Content): number {
  return content.balance.difficulty[c.difficulty].attributePoints;
}
export function attributePointsSpent(c: NewSagaChoices): number {
  return ATTRIBUTE_IDS.reduce((sum, a) => sum + c.attributes[a], 0);
}
/** Highest allocation one attribute may take (cap 7 at creation, from a start of 4). */
export function attributeAllocCap(content: Content): number {
  return content.balance.character.attributeCreationCap - content.balance.character.attributeStart;
}

/** The traits the character would start with (starting trait if taken, virtue, flaw), validated by the people module. */
export function chosenTraits(c: NewSagaChoices, content: Content): string[] {
  return creationTraits(content, creationOf(c));
}

/** Negative creation traits, alphabetical by id. */
export function negativeTraitIds(content: Content): string[] {
  return Object.entries(content.traits)
    .filter(([, t]) => t.creation === 'negative')
    .map(([id]) => id)
    .sort();
}

/** True if `trait` conflicts (is the opposite of) any trait in `others`. */
export function traitConflicts(trait: string, others: readonly string[], content: Content): boolean {
  const def = content.traits[trait];
  if (!def) return true;
  return others.some((o) => o !== trait && (def.opposite === o || content.traits[o]?.opposite === trait));
}

/** One stat broken out by source (the people module's creation rules). */
export type StatLine = CreationStat;

export interface CharacterPreview {
  skills: Record<SkillId, StatLine>;
  attributes: Record<AttributeId, StatLine>;
  traits: string[];
}

/**
 * Final skills and attributes with every source broken out (for the tooltips and the summary).
 * This is the people module's `buildCreation`, the very function that builds the ruler in the new
 * game, so the preview and the created character agree.
 */
export function previewCharacter(c: NewSagaChoices, content: Content): CharacterPreview {
  const r = buildCreation(content, c.culture, creationOf(c));
  return { skills: r.skills, attributes: r.attributes, traits: r.traits };
}

// ---------------------------------------------------------------------------------------------
// Validation (issues are locale keys under menu.newSaga.issue.*)

export const NAME_MAX = 24;
const NAME_RE = /^[\p{L}][\p{L}' \-]*$/u;

/** Normalises a typed name (trim, collapse spaces). */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** Issues blocking a step (empty = the step is complete). */
export function validateStep(step: WizardStep, c: NewSagaChoices, content: Content, jarldoms: readonly JarldomOption[] = []): string[] {
  const issues: string[] = [];
  const ch = content.balance.character;
  switch (step) {
    case 'identity': {
      const n = cleanName(c.name);
      if (n.length === 0) issues.push('menu.newSaga.issue.nameEmpty');
      else if (n.length > NAME_MAX) issues.push('menu.newSaga.issue.nameLong');
      else if (!NAME_RE.test(n)) issues.push('menu.newSaga.issue.nameChars');
      break;
    }
    case 'homeland':
      if (!(HOMELAND_CULTURE_IDS as readonly string[]).includes(c.culture)) issues.push('menu.newSaga.issue.homeland');
      break;
    case 'parentage':
      break;
    case 'upbringing':
      if (!Object.hasOwn(content.upbringings, c.upbringing)) issues.push('menu.newSaga.issue.upbringing');
      break;
    case 'skills': {
      const spent = skillPointsSpent(c);
      const avail = skillPointsAvailable(c, content);
      if (spent > avail) issues.push('menu.newSaga.issue.skillsOver');
      else if (spent < avail) issues.push('menu.newSaga.issue.skillsLeft');
      if (SKILL_IDS.some((s) => c.skills[s] < 0 || c.skills[s] > ch.skillCreationCap)) issues.push('menu.newSaga.issue.skillCap');
      break;
    }
    case 'attributes': {
      const spent = attributePointsSpent(c);
      const avail = attributePointsAvailable(c, content);
      if (spent > avail) issues.push('menu.newSaga.issue.attributesOver');
      else if (spent < avail) issues.push('menu.newSaga.issue.attributesLeft');
      if (ATTRIBUTE_IDS.some((a) => c.attributes[a] < 0 || c.attributes[a] > attributeAllocCap(content))) issues.push('menu.newSaga.issue.attributeCap');
      break;
    }
    case 'trait': {
      const options = content.upbringings[c.upbringing].traitOptions;
      if (!c.positiveTrait) issues.push('menu.newSaga.issue.traitMissing');
      else if (!options.includes(c.positiveTrait)) issues.push('menu.newSaga.issue.traitNotOffered');
      if (c.negativeTrait) {
        if (content.traits[c.negativeTrait]?.creation !== 'negative') issues.push('menu.newSaga.issue.negativeInvalid');
        const others = chosenTraits({ ...c, negativeTrait: null }, content);
        if (traitConflicts(c.negativeTrait, others, content)) issues.push('menu.newSaga.issue.traitConflict');
      }
      break;
    }
    case 'jarldom':
      if (c.startProvinceId !== null && jarldoms.length > 0 && !jarldoms.some((j) => j.provinceId === c.startProvinceId && j.culture === c.culture)) {
        issues.push('menu.newSaga.issue.jarldom');
      }
      break;
    case 'difficulty':
      if (!(DIFFICULTY_IDS as readonly string[]).includes(c.difficulty)) issues.push('menu.newSaga.issue.difficulty');
      if (c.seed.trim().length === 0) issues.push('menu.newSaga.issue.seed');
      break;
    case 'confirm':
      for (const s of WIZARD_STEPS) if (s !== 'confirm') issues.push(...validateStep(s, c, content, jarldoms));
      break;
  }
  return issues;
}

/** The first step with issues (or null when everything is valid). */
export function firstInvalidStep(c: NewSagaChoices, content: Content, jarldoms: readonly JarldomOption[] = []): WizardStep | null {
  for (const s of WIZARD_STEPS) if (s !== 'confirm' && validateStep(s, c, content, jarldoms).length > 0) return s;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Random / Recommended

/** Recommended upbringing per homeland (a strong, readable first campaign). */
export const RECOMMENDED_UPBRINGING: Readonly<Record<HomelandCultureId, UpbringingId>> = { skarn: 'hirdRaised', hvarn: 'bowyersChild', eyjar: 'thingSpeakersChild' };

/** Skill priorities after the upbringing's own skill. */
const SKILL_PRIORITY: readonly SkillId[] = ['command', 'melee', 'seafaring', 'speechcraft', 'stewardship', 'archery', 'wildcraft', 'runecraft'];

/** Attribute priorities per upbringing skill. */
const ATTRIBUTE_PRIORITY: Readonly<Record<SkillId, readonly AttributeId[]>> = {
  melee: ['might', 'vigor', 'agility', 'wits'],
  archery: ['agility', 'wits', 'vigor', 'might'],
  command: ['wits', 'vigor', 'might', 'agility'],
  seafaring: ['vigor', 'wits', 'agility', 'might'],
  wildcraft: ['agility', 'vigor', 'wits', 'might'],
  speechcraft: ['wits', 'vigor', 'agility', 'might'],
  stewardship: ['wits', 'vigor', 'might', 'agility'],
  runecraft: ['wits', 'vigor', 'agility', 'might'],
};

/** Preferred step-7 traits, best first (the first one offered by the upbringing wins). */
const TRAIT_PREFERENCE: readonly string[] = ['brave', 'ambitious', 'just', 'lucky', 'silverTongued', 'seaBorn', 'beloved', 'patient', 'strong', 'quick', 'honest', 'temperate'];

/** Round-robin point allocation over a priority list, respecting a per-entry cap. */
function allocate<K extends string>(keys: readonly K[], points: number, cap: number): Record<K, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  let left = points;
  while (left > 0) {
    let placed = false;
    for (const k of keys) {
      if (left <= 0) break;
      if (out[k] < cap) {
        out[k] += 1;
        left -= 1;
        placed = true;
      }
    }
    if (!placed) break;
  }
  return out;
}

function allocateRandom<K extends string>(keys: readonly K[], points: number, cap: number, rng: RandomSource): Record<K, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (let left = points; left > 0; left--) {
    const open = keys.filter((k) => out[k] < cap);
    if (open.length === 0) break;
    const k = rng.pick(open);
    out[k] += 1;
  }
  return out;
}

/** Keeps dependent choices valid after a change (trait offers, point budgets, caps). */
export function reconcile(c: NewSagaChoices, content: Content): NewSagaChoices {
  let next = c;
  const options = content.upbringings[next.upbringing].traitOptions;
  if (next.positiveTrait && !options.includes(next.positiveTrait)) next = { ...next, positiveTrait: null };
  if (next.negativeTrait && traitConflicts(next.negativeTrait, chosenTraits({ ...next, negativeTrait: null }, content), content)) next = { ...next, negativeTrait: null };
  const skillCap = content.balance.character.skillCreationCap;
  let skills = { ...next.skills };
  for (const s of SKILL_IDS) skills[s] = Math.max(0, Math.min(skillCap, Math.round(skills[s] ?? 0)));
  let over = SKILL_IDS.reduce((a, s) => a + skills[s], 0) - skillPointsAvailable({ ...next, skills }, content);
  // Remove surplus from the lowest-priority skills first.
  for (const s of [...SKILL_IDS].reverse()) {
    while (over > 0 && skills[s] > 0) {
      skills = { ...skills, [s]: skills[s] - 1 };
      over--;
    }
  }
  const attrCap = attributeAllocCap(content);
  let attributes = { ...next.attributes };
  for (const a of ATTRIBUTE_IDS) attributes[a] = Math.max(0, Math.min(attrCap, Math.round(attributes[a] ?? 0)));
  let aOver = ATTRIBUTE_IDS.reduce((s, a) => s + attributes[a], 0) - attributePointsAvailable(next, content);
  for (const a of [...ATTRIBUTE_IDS].reverse()) {
    while (aOver > 0 && attributes[a] > 0) {
      attributes = { ...attributes, [a]: attributes[a] - 1 };
      aOver--;
    }
  }
  return { ...next, skills, attributes };
}

/**
 * Changes the difficulty preset (§5.5) while keeping the saga valid: the player's own toggles are
 * kept (Duel Assist follows the new preset's default), a smaller point budget is trimmed by
 * `reconcile`, and a larger one is topped up in the recommended order — but only when the old
 * allocation was complete, so a half-finished allocation is never silently rearranged.
 */
export function withDifficulty(c: NewSagaChoices, difficulty: DifficultyId, content: Content): NewSagaChoices {
  const skillsDone = skillPointsSpent(c) >= skillPointsAvailable(c, content);
  const attrsDone = attributePointsSpent(c) >= attributePointsAvailable(c, content);
  const toggles: SagaToggles = { ...c.toggles, duelAssist: defaultToggles(content, difficulty).duelAssist };
  let next = reconcile({ ...c, difficulty, toggles }, content);
  if (skillsDone) next = { ...next, skills: topUp(next.skills, recommendedSkillOrder(next, content), skillPointsAvailable(next, content), content.balance.character.skillCreationCap) };
  if (attrsDone) next = { ...next, attributes: topUp(next.attributes, ATTRIBUTE_PRIORITY[content.upbringings[next.upbringing].skill], attributePointsAvailable(next, content), attributeAllocCap(content)) };
  return next;
}

/** Skill order the Recommended fill uses: the upbringing's skill, then the general priorities. */
function recommendedSkillOrder(c: NewSagaChoices, content: Content): SkillId[] {
  const own = content.upbringings[c.upbringing].skill;
  return [own, ...SKILL_PRIORITY.filter((s) => s !== own)];
}

/** Adds unspent points (up to `budget`) round-robin over `order`, never removing any. */
function topUp<K extends string>(current: Readonly<Record<K, number>>, order: readonly K[], budget: number, cap: number): Record<K, number> {
  const out = { ...current } as Record<K, number>;
  let left = budget - order.reduce((s, k) => s + (out[k] ?? 0), 0);
  while (left > 0) {
    let placed = false;
    for (const k of order) {
      if (left <= 0) break;
      if ((out[k] ?? 0) < cap) {
        out[k] = (out[k] ?? 0) + 1;
        left--;
        placed = true;
      }
    }
    if (!placed) break;
  }
  return out;
}

/** "Random" for one step. */
export function randomizeStep(step: WizardStep, c: NewSagaChoices, content: Content, rng: RandomSource, jarldoms: readonly JarldomOption[]): NewSagaChoices {
  switch (step) {
    case 'identity': {
      const sex = rng.chance(0.5) ? 'male' : 'female';
      const name = generatePersonalName(rng, content.cultures[c.culture].naming, sex);
      const layers: Partial<Record<PortraitLayerKey, number>> = {};
      return { ...c, sex, name, portrait: { seed: rng.u32(), layers, scars: rng.chance(0.2) } };
    }
    case 'homeland':
      return reconcile({ ...c, culture: rng.pick(HOMELAND_CULTURE_IDS), startProvinceId: null }, content);
    case 'parentage':
      return { ...c, slainParent: rng.chance(0.5) ? 'father' : 'mother' };
    case 'upbringing':
      return reconcile({ ...c, upbringing: rng.pick(UPBRINGING_IDS), takeStartingTrait: rng.chance(0.7) }, content);
    case 'skills':
      return { ...c, skills: allocateRandom(SKILL_IDS, skillPointsAvailable(c, content), content.balance.character.skillCreationCap, rng) };
    case 'attributes':
      return { ...c, attributes: allocateRandom(ATTRIBUTE_IDS, attributePointsAvailable(c, content), attributeAllocCap(content), rng) };
    case 'trait': {
      const positiveTrait = rng.pick(content.upbringings[c.upbringing].traitOptions);
      const base = { ...c, positiveTrait, negativeTrait: null };
      const negatives = negativeTraitIds(content).filter((t) => !traitConflicts(t, chosenTraits(base, content), content));
      const negativeTrait = negatives.length > 0 && rng.chance(0.35) ? rng.pick(negatives) : null;
      return reconcile({ ...base, negativeTrait }, content);
    }
    case 'jarldom': {
      const mine = jarldoms.filter((j) => j.culture === c.culture);
      return { ...c, startProvinceId: mine.length > 0 ? rng.pick(mine).provinceId : null };
    }
    case 'difficulty': {
      const difficulty = rng.pick(DIFFICULTY_IDS);
      const toggles: SagaToggles = { ...defaultToggles(content, difficulty), ironman: c.toggles.ironman };
      return { ...withDifficulty({ ...c, toggles }, difficulty, content), seed: randomSeed(rng) };
    }
    case 'confirm':
      return c;
  }
}

/** "Recommended" for one step. */
export function recommendStep(step: WizardStep, c: NewSagaChoices, content: Content, jarldoms: readonly JarldomOption[]): NewSagaChoices {
  switch (step) {
    case 'identity':
      return c.name.trim() ? c : { ...c, name: content.cultures[c.culture].naming.examples[c.sex][0] ?? 'Sigrun' };
    case 'homeland':
      return reconcile({ ...c, culture: 'skarn', startProvinceId: c.culture === 'skarn' ? c.startProvinceId : null }, content);
    case 'parentage':
      return { ...c, slainParent: 'father' };
    case 'upbringing':
      return reconcile({ ...c, upbringing: RECOMMENDED_UPBRINGING[c.culture], takeStartingTrait: true }, content);
    case 'skills': {
      const own = content.upbringings[c.upbringing].skill;
      const order = [own, ...SKILL_PRIORITY.filter((s) => s !== own)].slice(0, 5);
      return { ...c, skills: { ...zeroSkills(), ...allocate(order, skillPointsAvailable(c, content), content.balance.character.skillCreationCap) } };
    }
    case 'attributes': {
      const own = content.upbringings[c.upbringing].skill;
      return { ...c, attributes: allocate(ATTRIBUTE_PRIORITY[own], attributePointsAvailable(c, content), attributeAllocCap(content)) };
    }
    case 'trait': {
      const options = content.upbringings[c.upbringing].traitOptions;
      const pick = TRAIT_PREFERENCE.find((t) => options.includes(t)) ?? options[0] ?? null;
      return reconcile({ ...c, positiveTrait: pick, negativeTrait: null }, content);
    }
    case 'jarldom': {
      const mine = jarldoms.filter((j) => j.culture === c.culture).sort((a, b) => a.difficultyPips - b.difficultyPips || a.name.localeCompare(b.name));
      return { ...c, startProvinceId: mine[0]?.provinceId ?? null };
    }
    case 'difficulty':
      return withDifficulty({ ...c, toggles: defaultToggles(content, 'raider') }, 'raider', content);
    case 'confirm':
      return c;
  }
}

/**
 * Quick Start (§5.1): a random identity, homeland, slain parent, upbringing (with its starting
 * trait) and virtue from that upbringing's offers, no flaw; skills and attributes spent in the
 * recommended order for that upbringing; the recommended jarldom and the Raider preset. Varied
 * rulers, every one a sensible, complete build.
 */
export function quickStartChoices(content: Content, rng: RandomSource, jarldoms: readonly JarldomOption[] = []): NewSagaChoices {
  let c = initialChoices(content, rng);
  c = randomizeStep('homeland', c, content, rng, jarldoms);
  c = randomizeStep('identity', c, content, rng, jarldoms);
  c = randomizeStep('parentage', c, content, rng, jarldoms);
  c = reconcile({ ...c, upbringing: rng.pick(UPBRINGING_IDS), takeStartingTrait: true }, content);
  c = reconcile({ ...c, positiveTrait: rng.pick(content.upbringings[c.upbringing].traitOptions), negativeTrait: null }, content);
  for (const step of ['difficulty', 'skills', 'attributes', 'jarldom'] as const) c = recommendStep(step, c, content, jarldoms);
  return c;
}

// ---------------------------------------------------------------------------------------------
// Mapping onto the simulation

/** The wizard's raw choices as the simulation records them (`player.creation`). */
export function creationOf(c: NewSagaChoices): RulerCreation {
  return {
    upbringing: c.upbringing,
    takeStartingTrait: c.takeStartingTrait,
    positiveTrait: c.positiveTrait,
    negativeTrait: c.negativeTrait,
    skills: { ...c.skills },
    attributes: { ...c.attributes },
    slainParent: c.slainParent,
  };
}

/**
 * Builds the NewGameOptions for GameSession.newGame: identity on `player`, the portrait and the raw
 * creation choices (`player.creation`, turned into the ruler by the people module and read by the
 * world module for the slain parent), the chosen province on `options.startProvinceId` (world
 * module), the toggles on `options`, difficulty and seed. Plain JSON, so replays reproduce them.
 */
export function toNewGameOptions(c: NewSagaChoices, _content?: Content): NewGameOptions {
  const layers: Record<string, number> = {};
  for (const k of PORTRAIT_LAYERS) {
    const v = c.portrait.layers[k];
    if (v !== undefined) layers[k] = v;
  }
  if (c.portrait.scars) layers.scar = 1;
  const player: PlaceholderPlayerOptions = {
    name: cleanName(c.name),
    sex: c.sex,
    culture: c.culture,
    portrait: Object.keys(layers).length > 0 ? { seed: c.portrait.seed, layers } : { seed: c.portrait.seed },
    creation: creationOf(c),
  };
  const startProvince: Record<string, string> = c.startProvinceId ? { startProvinceId: c.startProvinceId } : {};
  const options: Partial<GameOptions> = { ...c.toggles, ...startProvince };
  return { seed: c.seed.trim(), difficulty: c.difficulty, options, player };
}
