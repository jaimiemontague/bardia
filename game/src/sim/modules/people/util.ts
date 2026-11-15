/**
 * Shared helpers of the people module: ages and life stages, slice access, modifier bags (traits and
 * feats), effective attributes/skills, locations, relic and favor reads, notifications.
 * Pure functions over plain data or drafts; nothing here draws randomness.
 */
import type { Content } from '@content/index';
import type { AttributeId } from '@content/schemas/ids';
import { baseState } from '@sim/core/context';
import { clamp } from '@sim/core/dmath';
import { EffectError } from '@sim/core/effects';
import type { SimContext } from '@sim/core/module';
import type {
  Character,
  CharacterLocation,
  CharId,
  FactionId,
  GameState,
  GodId,
  Hour,
  NotificationPriority,
  SettlementId,
  SkillId,
  TextVars,
} from '@sim/core/state';
import { DAYS_PER_YEAR, HOURS_PER_DAY } from '@sim/core/time';
import type { LifeStage, PeopleState } from './types';

/** RNG streams of this module (one per concern, so adding draws in one never perturbs another). */
export const STREAMS = {
  progression: 'people:progression',
  health: 'people:health',
  aging: 'people:aging',
  dynasty: 'people:dynasty',
  captivity: 'people:captivity',
  succession: 'people:succession',
} as const;

// ---------------------------------------------------------------------------------------------
// Time and age. Ages count calendar days (360-day years), so a character turns N at the first hour
// of the birthday — consistent with the daily birthday pass.

/** Absolute day index of an hour. */
export function dayOf(hour: Hour): number {
  return Math.floor(hour / HOURS_PER_DAY);
}

/** Day of the year 0–359 of an hour (negative hours allowed). */
export function dayOfYear(hour: Hour): number {
  const d = dayOf(hour) % DAYS_PER_YEAR;
  return d < 0 ? d + DAYS_PER_YEAR : d;
}

/** Whole years of age at `hour` (calendar-day based). */
export function ageOf(c: Pick<Character, 'birthHour'>, hour: Hour): number {
  return Math.floor((dayOf(hour) - dayOf(c.birthHour)) / DAYS_PER_YEAR);
}

/** First hour of the day on which a character reaches `age`. */
export function hourOfAge(c: Pick<Character, 'birthHour'>, age: number): Hour {
  return (dayOf(c.birthHour) + age * DAYS_PER_YEAR) * HOURS_PER_DAY;
}

/** Child stage (§23.2) for an age. */
export function lifeStageOf(age: number, content: Content): LifeStage {
  const s = content.balance.character.childStages;
  if (age >= s.adult) return 'adult';
  if (age >= s.youth) return 'youth';
  if (age >= s.child) return 'child';
  return 'infant';
}

export function isAdultAt(c: Pick<Character, 'birthHour'>, hour: Hour, content: Content): boolean {
  return ageOf(c, hour) >= content.balance.character.adultAge;
}

// ---------------------------------------------------------------------------------------------
// State access.

/** The people slice, created on first use. */
export function peopleState(state: GameState): PeopleState {
  if (!state.people) state.people = { pregnantIds: [], woundedIds: [], captiveIds: [], fosterIds: [] };
  return state.people;
}

/**
 * Keys and rows of the last base characters table seen: a pure memo keyed by the table's identity,
 * used only while that table is frozen (Immer freezes every produced state), so it can never go stale.
 */
let keysOf: object | undefined;
let keyList: CharId[] = [];
let rowList: Character[] = [];

/** Characters created earlier in the current operation (memo keyed by the operation's draft table). */
let createdTable: object | undefined;
let createdIds: CharId[] = [];
let createdNext = 0;

/**
 * Ids of characters created earlier in this operation, in creation order. Ids come from the global
 * counter (`meta.nextId`), so they are exactly the `chr_<n>` keys with n from the operation's base
 * counter upward; the range is scanned once per operation, incrementally (no proxy row reads).
 */
function createdThisOperation(draft: GameState): readonly CharId[] {
  const table = draft.characters;
  if (baseState(table) === table) return []; // not a draft: the table is already current
  if (createdTable !== table) {
    createdTable = table;
    createdIds = [];
    createdNext = baseState(draft.meta).nextId;
  }
  const end = draft.meta.nextId;
  for (let n = createdNext; n < end; n++) {
    const id = `chr_${n}` as CharId;
    if (Object.hasOwn(table, id)) createdIds.push(id);
  }
  createdNext = end;
  return createdIds;
}

/**
 * Visits every character in table order — the operation's BASE rows (no proxy traps: reading rows
 * through the draft costs ~0.25 µs each; ARCHITECTURE §7) and then the characters created earlier
 * in this operation (live rows) — so the set and order visited are the same however the scheduler's
 * hours are split into operations (`advance(a); advance(b)` ≡ `advance(a + b)`, which the replay log
 * relies on).
 *
 * A base row may be stale: callers filter only on immutable fields (id, birthHour, sex) or on
 * `!row.alive` (death is permanent), never draw from a shared RNG stream per visited row (use
 * `charUniform`), and re-read `draft.characters[id]` to decide from current values.
 */
export function forEachCharacter(draft: GameState, visit: (id: CharId, row: Character) => void): void {
  const base = baseState(draft.characters);
  if (keysOf !== base || !Object.isFrozen(base)) {
    keyList = Object.keys(base) as CharId[];
    rowList = Object.values(base);
    keysOf = Object.isFrozen(base) ? base : undefined;
  }
  const ids = keyList;
  const rows = rowList;
  for (let i = 0; i < ids.length; i++) visit(ids[i] as CharId, rows[i] as Character);
  const created = createdThisOperation(draft);
  for (let i = 0; i < created.length; i++) {
    const id = created[i] as CharId;
    const row = draft.characters[id];
    if (row) visit(id, row);
  }
}

/** lowbias32 integer finaliser (exact 32-bit arithmetic; deterministic on every engine). */
function mix32(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * A uniform value in [0, 1) for one character in one pass: `salt` is drawn ONCE per pass from the
 * pass's RNG stream, then mixed with the character's id. Each character's value is independent of
 * which other rows were visited (stale base rows, dead characters), so a monthly pass gives the
 * same outcome however the operation was split.
 */
export function charUniform(salt: number, id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return mix32(mix32(h) ^ salt) / 4294967296;
}

/** A character by id, if it exists. */
export function charOf(state: GameState, id: string | undefined): Character | undefined {
  if (id === undefined || !Object.hasOwn(state.characters, id)) return undefined;
  return state.characters[id as CharId];
}

/** A character by id or an EffectError (content/caller bug). */
export function requireChar(state: GameState, id: string | undefined, what: string): Character {
  const c = charOf(state, id);
  if (!c) throw new EffectError(`${what}: unknown character ${String(id)}`);
  return c;
}

/** The character an effect targets: the given id, or the player's ruler. */
export function targetChar(state: GameState, id: CharId | undefined, what: string): Character {
  return requireChar(state, id ?? state.player.rulerId, what);
}

export function pushUnique<T>(list: T[], value: T): void {
  if (!list.includes(value)) list.push(value);
}

export function removeValue<T>(list: T[], value: T): boolean {
  const i = list.indexOf(value);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

/** Eldest first (earliest birth), ties by id for determinism. */
export function byAgeDesc(state: GameState) {
  return (a: CharId, b: CharId): number => {
    const ca = state.characters[a];
    const cb = state.characters[b];
    const d = (ca?.birthHour ?? 0) - (cb?.birthHour ?? 0);
    return d !== 0 ? d : a < b ? -1 : a > b ? 1 : 0;
  };
}

// ---------------------------------------------------------------------------------------------
// Houses, locations, factions.

/** Member of the player's house: the ruler or anyone serving the player's faction. */
export function isPlayerHouse(state: GameState, c: Character): boolean {
  return c.id === state.player.rulerId || (c.factionId !== undefined && c.factionId === state.player.factionId);
}

/** The settlement a character is in (or held captive at). */
export function locationSettlement(loc: CharacterLocation): SettlementId | undefined {
  if (loc.kind === 'settlement') return loc.id;
  if (loc.kind === 'captive') return loc.at;
  return undefined;
}

/** Two characters share a place (unknown locations count as together). */
export function together(a: CharacterLocation, b: CharacterLocation): boolean {
  if (a.kind === 'none' || b.kind === 'none') return true;
  if (a.kind !== b.kind) return false;
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  return ra.id === rb.id && ra.at === rb.at;
}

/** Where a faction keeps court: its ruler's settlement, else its first holding. */
export function factionSeat(state: GameState, factionId: FactionId | undefined): SettlementId | undefined {
  if (factionId === undefined || !Object.hasOwn(state.factions, factionId)) return undefined;
  const faction = state.factions[factionId];
  if (!faction) return undefined;
  const ruler = charOf(state, faction.rulerId);
  if (ruler && ruler.location.kind === 'settlement' && Object.hasOwn(state.settlements, ruler.location.id)) return ruler.location.id;
  for (const id of faction.holdingIds) if (Object.hasOwn(state.settlements, id)) return id;
  return undefined;
}

/** The player's home: the capital when it exists. */
export function playerHome(state: GameState): SettlementId | undefined {
  return Object.hasOwn(state.settlements, state.player.capitalId) ? state.player.capitalId : factionSeat(state, state.player.factionId);
}

/** Favor of one of the player's gods, read defensively (0 when absent). */
export function houseFavor(state: GameState, god: GodId): number {
  const favor = (state.player as { house?: { favor?: Partial<Record<GodId, number>> } }).house?.favor;
  const v = favor?.[god];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Whether the player's house holds a relic, by key (e.g. 'goldenSheaf'): a truthy flag
 * `relic.<key>`, or a relic held by the player's faction whose id is the key or `rel_<key>`, or
 * whose `defId`/`key` is the key.
 */
export function playerHoldsRelic(state: GameState, key: string): boolean {
  const flagKey = `relic.${key}`;
  if (Object.hasOwn(state.flags, flagKey) && state.flags[flagKey]) return true;
  const relicId = `rel_${key}`;
  for (const relic of Object.values(state.relics)) {
    if (relic.holder !== state.player.factionId) continue;
    const r = relic as unknown as Record<string, unknown>;
    if (relic.id === key || relic.id === relicId || r.defId === key || r.key === key) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Modifier bags (traits.json / feats.json; ARCHITECTURE.md §9). `*Mult` keys multiply, others add.

/** Σ of a flat modifier over the character's traits and feats. */
export function modifierSum(c: Character, content: Content, key: string): number {
  let sum = 0;
  for (const t of c.traits) {
    const v = content.traits[t]?.modifiers[key];
    if (v !== undefined) sum += v;
  }
  for (const f of c.feats) {
    const v = content.feats[f]?.modifiers[key];
    if (v !== undefined) sum += v;
  }
  return sum;
}

/** Π of a multiplier modifier over the character's traits and feats (1 when none). */
export function modifierMult(c: Character, content: Content, key: string): number {
  let mult = 1;
  for (const t of c.traits) {
    const v = content.traits[t]?.modifiers[key];
    if (v !== undefined) mult *= v;
  }
  for (const f of c.feats) {
    const v = content.feats[f]?.modifiers[key];
    if (v !== undefined) mult *= v;
  }
  return mult;
}

/** All modifiers of a character's traits and feats in one bag. */
export function modifierBag(c: Character, content: Content): Record<string, number> {
  const bag: Record<string, number> = {};
  const add = (mods: Record<string, number> | undefined) => {
    if (!mods) return;
    for (const [k, v] of Object.entries(mods)) {
      if (k.endsWith('Mult')) bag[k] = (bag[k] ?? 1) * v;
      else bag[k] = (bag[k] ?? 0) + v;
    }
  };
  for (const t of c.traits) add(content.traits[t]?.modifiers);
  for (const f of c.feats) add(content.feats[f]?.modifiers);
  return bag;
}

/** True if any trait or feat of the character carries the flag. */
export function hasModifierFlag(c: Character, content: Content, flag: string): boolean {
  for (const t of c.traits) if (content.traits[t]?.flags.includes(flag)) return true;
  for (const f of c.feats) if (content.feats[f]?.flags.includes(flag)) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// Effective stats: base + trait/feat modifiers + temporary injuries, reduced by the wound penalty.

/** Stat penalty of the current wound (§22.5). */
export function woundPenalty(c: Character, content: Content): number {
  const w = content.balance.health.wounds;
  switch (c.health.wound) {
    case 'minor':
      return w.minor.statPenalty;
    case 'serious':
      return w.serious.statPenalty;
    case 'mortal':
      return content.tunables.people.mortalStatPenalty;
    default:
      return 0;
  }
}

/** Σ of active temporary-injury deltas for an attribute or skill (broken hand, concussion …). */
export function injuryDelta(c: Character, content: Content, kind: 'attribute' | 'skill', id: string): number {
  let sum = 0;
  for (const inj of c.health.injuries) {
    const row = content.balance.health.injuryTable.find((r) => r.id === inj.id);
    if (!row || row.amount === undefined) continue;
    if (kind === 'attribute' ? row.attribute === id : row.skill === id) sum += row.amount;
  }
  return sum;
}

/** Attribute as used by checks: base + `attr.<id>` modifiers + injuries, × (1 − wound penalty), ≥ 0. */
export function effectiveAttribute(c: Character, attr: AttributeId, content: Content): number {
  const raw = c.attributes[attr] + modifierSum(c, content, `attr.${attr}`) + injuryDelta(c, content, 'attribute', attr);
  return Math.max(0, raw * (1 - woundPenalty(c, content)));
}

/** Skill as used by checks: base + `skill.<id>` modifiers + injuries, × (1 − wound penalty), ≥ 0. */
export function effectiveSkill(c: Character, skill: SkillId, content: Content): number {
  const raw = (c.skills[skill] ?? 0) + modifierSum(c, content, `skill.${skill}`) + injuryDelta(c, content, 'skill', skill);
  return Math.max(0, raw * (1 - woundPenalty(c, content)));
}

/** A clamped linear check: clamp(base + perPoint × (score − pivot), min, max). */
export function linearCheck(p: { base: number; perPoint: number; pivot: number; min: number; max: number }, score: number): number {
  return clamp(p.base + p.perPoint * (score - p.pivot), p.min, p.max);
}

// ---------------------------------------------------------------------------------------------
// Text (localisation keys + vars only; the client formats them).

/** Name variable of a character for ICU strings: `name`, or `<prefix>Name` (e.g. `spouseName`). */
export function nameVars(c: Character | undefined, prefix = ''): TextVars {
  return { [prefix === '' ? 'name' : `${prefix}Name`]: c?.name ?? '' };
}

/** Notify the player about someone of their house (no-op for others). `illustration`: the picture's asset id. */
export function notifyHouse(
  ctx: SimContext,
  c: Character,
  key: string,
  vars: TextVars = {},
  priority: NotificationPriority = 'normal',
  illustration?: string,
): void {
  if (!isPlayerHouse(ctx.state, c)) return;
  ctx.notify(key, { priority, vars: { ...nameVars(c), ...vars }, link: { kind: 'character', id: c.id }, ...(illustration !== undefined ? { illustration } : {}) });
}

/** Chronicle a deed of the player's house (no-op for others). */
export function chronicleHouse(
  ctx: SimContext,
  c: Character,
  kind: string,
  textKey: string,
  importance: number,
  vars: TextVars = {},
  refs: string[] = [],
): void {
  if (!isPlayerHouse(ctx.state, c)) return;
  ctx.chronicle({ kind, textKey, importance, vars: { ...nameVars(c), ...vars }, refs: [c.id, ...refs] });
}
