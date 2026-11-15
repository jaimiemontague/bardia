/**
 * The path catalogue of the condition language (design §29.7: "paths are type-checked at content build").
 *
 * Roots: player, house, ruler, time (always), vars, event (storylet context), and the entity roots bound by
 * the scope: settlement, holding, faction, character, fleet. Each root has a static type made of kernel
 * fields (state.ts) and VIRTUAL fields computed from state (age, isPlayerHolding, opinion …). Data owned by
 * other modules beyond the kernel contract is reached through their condition functions, not paths.
 *
 * Semantics: a path through something missing evaluates to null; records of numbers default to 0
 * (`settlement.buildings.smithy`, `house.favor.skell`); a path that ends at an entity evaluates to the
 * entity's id (`ruler`, `faction.ruler`), so `hasTrait(ruler, 'brave')` reads naturally.
 */
import {
  ATTRIBUTE_IDS,
  CULTURE_IDS,
  ECONOMY_STATE_IDS,
  FAITH_IDS,
  GOD_IDS,
  GOOD_IDS,
  SEASON_IDS,
  SETTLEMENT_TIER_IDS,
  SKILL_IDS,
  TAX_RATE_IDS,
} from '@content/schemas/ids';
import { getRelation } from '@sim/core/factory';
import { isSafeRecordKey } from '@sim/core/keys';
import type { Character, Faction, Fleet, PlayerHouse, PlayerState, Settlement } from '@sim/core/state';
import { ageInYears, dayIndex, DAYS_PER_YEAR, season, toCalendar, weekdayIndex } from '@sim/core/time';
import { toValue, type EvalScope, type Value } from './scope';

export type LeafKind = 'number' | 'string' | 'boolean';
export type EntityKind = 'character' | 'settlement' | 'holding' | 'faction' | 'fleet' | 'player' | 'house' | 'time';

/** A virtual field: computed from the containing object. */
export type Getter = (obj: never, s: EvalScope) => unknown;

export type PathType =
  | { readonly t: 'leaf'; readonly of: LeafKind; readonly values?: readonly string[] }
  | { readonly t: 'object'; readonly fields: Readonly<Record<string, PathField>> }
  | { readonly t: 'record'; readonly of: PathType; readonly keys?: readonly string[]; readonly fallback?: Value }
  | { readonly t: 'entity'; readonly entity: EntityKind }
  | { readonly t: 'any' };

export interface PathField {
  readonly type: PathType;
  /** Present for virtual fields. */
  readonly get?: Getter;
  /** One-line description (codex/tooling). */
  readonly doc?: string;
}

// ---------------------------------------------------------------------------------------------
// Type builders.

const num: PathType = { t: 'leaf', of: 'number' };
const str: PathType = { t: 'leaf', of: 'string' };
const bool: PathType = { t: 'leaf', of: 'boolean' };
const oneOf = (values: readonly string[]): PathType => ({ t: 'leaf', of: 'string', values });
const entity = (kind: EntityKind): PathType => ({ t: 'entity', entity: kind });
const field = (type: PathType, doc?: string): PathField => (doc === undefined ? { type } : { type, doc });
function virtual<T>(type: PathType, get: (obj: T, s: EvalScope) => unknown, doc?: string): PathField {
  const f = { type, get: get as unknown as Getter };
  return doc === undefined ? f : { ...f, doc };
}

// ---------------------------------------------------------------------------------------------
// Lookups (own properties only; ids are validated).

function rec<T>(table: Readonly<Record<string, T>>, id: unknown): T | undefined {
  return typeof id === 'string' && isSafeRecordKey(id) && Object.hasOwn(table, id) ? table[id] : undefined;
}
function charOf(s: EvalScope, id: unknown): Character | undefined {
  return rec(s.state.characters, id);
}
function factionOf(s: EvalScope, id: unknown): Faction | undefined {
  return rec(s.state.factions, id);
}
function settlementOf(s: EvalScope, id: unknown): Settlement | undefined {
  return rec(s.state.settlements, id);
}
function fleetOf(s: EvalScope, id: unknown): Fleet | undefined {
  return rec(s.state.fleets, id);
}
function livingCount(s: EvalScope, ids: readonly string[]): number {
  let n = 0;
  for (const id of ids) if (charOf(s, id)?.alive === true) n++;
  return n;
}
function sumValues(record: Readonly<Record<string, number>>): number {
  let n = 0;
  for (const v of Object.values(record)) if (Number.isFinite(v)) n += v;
  return n;
}
function isKinOfRuler(s: EvalScope, c: Character): boolean {
  const ruler = charOf(s, s.state.player.rulerId);
  if (!ruler) return false;
  if (c.id === ruler.id) return true;
  const f = ruler.family;
  if (f.spouseIds.includes(c.id) || f.childIds.includes(c.id) || f.fatherId === c.id || f.motherId === c.id) return true;
  const sameParent = (a: string | undefined, b: string | undefined) => a !== undefined && a === b;
  return sameParent(c.family.fatherId, f.fatherId) || sameParent(c.family.motherId, f.motherId);
}

// ---------------------------------------------------------------------------------------------
// Entity types.

const SEXES = ['male', 'female'] as const;
const WOUNDS = ['none', 'minor', 'serious', 'mortal'] as const;
const PERSONALITY = ['aggression', 'greed', 'honor', 'caution', 'ambition', 'piety'] as const;

const CHARACTER: PathType = {
  t: 'object',
  fields: {
    id: field(str),
    name: field(str),
    byname: field(str),
    sex: field(oneOf(SEXES)),
    culture: field(oneOf(CULTURE_IDS)),
    faith: field(oneOf(FAITH_IDS)),
    alive: field(bool),
    level: field(num),
    xp: field(num),
    loyalty: field(num, 'null until a loyalty has been set'),
    factionId: field(str),
    attributes: field({ t: 'record', of: num, keys: ATTRIBUTE_IDS, fallback: 0 }),
    skills: field({ t: 'record', of: num, keys: SKILL_IDS, fallback: 0 }),
    personality: field({ t: 'record', of: num, keys: PERSONALITY, fallback: null }),
    health: field({ t: 'object', fields: { hpPct: field(num), wound: field(oneOf(WOUNDS)) } }),
    role: field({ t: 'object', fields: { kind: field(str), holdingId: field(str), fleetId: field(str), factionId: field(str) } }),
    location: field({ t: 'object', fields: { kind: field(str), id: field(str), at: field(str), by: field(str) } }),
    age: virtual<Character>(num, (c, s) => ageInYears(c.birthHour, s.state.time.hour), 'full years of age'),
    isRuler: virtual<Character>(bool, (c, s) => c.id === s.state.player.rulerId),
    isKin: virtual<Character>(bool, (c, s) => isKinOfRuler(s, c), "the player ruler, their spouses, children, parents or siblings"),
    inPlayerFaction: virtual<Character>(bool, (c, s) => c.factionId === s.state.player.factionId),
    married: virtual<Character>(bool, (c, s) => livingCount(s, c.family.spouseIds) > 0),
    spouseCount: virtual<Character>(num, (c, s) => livingCount(s, c.family.spouseIds)),
    childCount: virtual<Character>(num, (c, s) => livingCount(s, c.family.childIds)),
    traitCount: virtual<Character>(num, (c) => c.traits.length),
    atHome: virtual<Character>(bool, (c, s) => {
      if (c.location.kind !== 'settlement') return false;
      const at = settlementOf(s, c.location.id);
      return at !== undefined && at.holding !== undefined && at.factionId === s.state.player.factionId;
    }),
    faction: virtual<Character>(entity('faction'), (c, s) => factionOf(s, c.factionId)),
    spouse: virtual<Character>(entity('character'), (c, s) => c.family.spouseIds.map((id) => charOf(s, id)).find((x) => x?.alive === true)),
    father: virtual<Character>(entity('character'), (c, s) => charOf(s, c.family.fatherId)),
    mother: virtual<Character>(entity('character'), (c, s) => charOf(s, c.family.motherId)),
    heir: virtual<Character>(entity('character'), (c, s) => charOf(s, c.family.heirId)),
  },
};

const SETTLEMENT_FIELDS: Record<string, PathField> = {
  id: field(str),
  name: field(str),
  culture: field(oneOf(CULTURE_IDS)),
  faith: field(oneOf(FAITH_IDS)),
  tier: field(oneOf(SETTLEMENT_TIER_IDS)),
  pop: field(num),
  economy: field(oneOf(ECONOMY_STATE_IDS)),
  silver: field(num),
  fortTier: field(num),
  armourTier: field(num),
  weaponTier: field(num),
  coastal: field(bool),
  factionId: field(str),
  provinceId: field(str),
  leaderId: field(str),
  buildings: field({ t: 'record', of: num, fallback: 0 }),
  holding: field({
    t: 'object',
    fields: { governorId: field(str), tax: field(oneOf(TAX_RATE_IDS)), loyalty: field(num), foodMonths: field(num), garrisonTarget: field(num) },
  }),
  isHolding: virtual<Settlement>(bool, (x) => x.holding !== undefined),
  isPlayerHolding: virtual<Settlement>(bool, (x, s) => x.holding !== undefined && x.factionId === s.state.player.factionId),
  isCapital: virtual<Settlement>(bool, (x, s) => x.id === s.state.player.capitalId),
  garrisonTotal: virtual<Settlement>(num, (x) => sumValues(x.garrison)),
  devastated: virtual<Settlement>(bool, (x, s) => x.devastationUntil !== undefined && x.devastationUntil > s.state.time.hour),
  faction: virtual<Settlement>(entity('faction'), (x, s) => factionOf(s, x.factionId)),
  leader: virtual<Settlement>(entity('character'), (x, s) => charOf(s, x.leaderId)),
  governor: virtual<Settlement>(entity('character'), (x, s) => charOf(s, x.holding?.governorId)),
};

const SETTLEMENT: PathType = { t: 'object', fields: SETTLEMENT_FIELDS };

/** A holding: the settlement plus its holding fields flattened (`holding.loyalty`). */
const HOLDING: PathType = {
  t: 'object',
  fields: {
    ...SETTLEMENT_FIELDS,
    loyalty: virtual<Settlement>(num, (x) => x.holding?.loyalty),
    tax: virtual<Settlement>(oneOf(TAX_RATE_IDS), (x) => x.holding?.tax),
    foodMonths: virtual<Settlement>(num, (x) => x.holding?.foodMonths),
    garrisonTarget: virtual<Settlement>(num, (x) => x.holding?.garrisonTarget),
    governorId: virtual<Settlement>(str, (x) => x.holding?.governorId),
  },
};

const FACTION: PathType = {
  t: 'object',
  fields: {
    id: field(str),
    name: field(str),
    kind: field(str),
    culture: field(oneOf(CULTURE_IDS)),
    faith: field(oneOf(FAITH_IDS)),
    treasury: field(num),
    armouryTier: field(num),
    weaponTier: field(num),
    rulerId: field(str),
    liegeId: field(str),
    holdingCount: virtual<Faction>(num, (f) => f.holdingIds.length),
    vassalCount: virtual<Faction>(num, (f) => f.vassalIds.length),
    tributaryCount: virtual<Faction>(num, (f) => f.tributaryIds.length),
    isPlayer: virtual<Faction>(bool, (f, s) => f.id === s.state.player.factionId),
    opinion: virtual<Faction>(num, (f, s) => (f.id === s.state.player.factionId ? 0 : (getRelation(s.state, f.id, s.state.player.factionId)?.opinion ?? 0)), 'opinion between this faction and the player'),
    stance: virtual<Faction>(str, (f, s) => getRelation(s.state, f.id, s.state.player.factionId)?.stance ?? 'neutral', 'stance towards the player'),
    atWar: virtual<Faction>(bool, (f, s) => getRelation(s.state, f.id, s.state.player.factionId)?.stance === 'war'),
    ruler: virtual<Faction>(entity('character'), (f, s) => charOf(s, f.rulerId)),
    liege: virtual<Faction>(entity('faction'), (f, s) => factionOf(s, f.liegeId)),
  },
};

const FLEET: PathType = {
  t: 'object',
  fields: {
    id: field(str),
    ownerId: field(str),
    leaderId: field(str),
    silver: field(num),
    rations: field(num),
    morale: field(num),
    crewStamina: field(num),
    voyageDays: field(num),
    mode: field(str),
    intent: field(str),
    cargo: field({ t: 'record', of: num, keys: GOOD_IDS, fallback: 0 }),
    shipCount: virtual<Fleet>(num, (f) => f.shipIds.length),
    menTotal: virtual<Fleet>(num, (f) => sumValues(f.men)),
    isPlayer: virtual<Fleet>(bool, (f, s) => f.ownerId === s.state.player.factionId),
    leader: virtual<Fleet>(entity('character'), (f, s) => charOf(s, f.leaderId)),
    owner: virtual<Fleet>(entity('faction'), (f, s) => factionOf(s, f.ownerId)),
  },
};

const HOUSE: PathType = {
  t: 'object',
  fields: {
    renown: field(num),
    honor: field(num),
    dread: field(num),
    piety: field(num),
    faithWrath: field(num),
    faith: field(oneOf(FAITH_IDS)),
    favor: field({ t: 'record', of: num, keys: GOD_IDS, fallback: 0 }),
  },
};

const PLAYER: PathType = {
  t: 'object',
  fields: {
    rulerId: field(str),
    factionId: field(str),
    capitalId: field(str),
    house: field(entity('house')),
    policies: field({ t: 'record', of: str }),
    treasury: virtual<PlayerState>(num, (p, s) => factionOf(s, p.factionId)?.treasury, "the player faction's silver"),
    holdingCount: virtual<PlayerState>(num, (p, s) => factionOf(s, p.factionId)?.holdingIds.length),
    ruler: virtual<PlayerState>(entity('character'), (p, s) => charOf(s, p.rulerId)),
    faction: virtual<PlayerState>(entity('faction'), (p, s) => factionOf(s, p.factionId)),
    capital: virtual<PlayerState>(entity('settlement'), (p, s) => settlementOf(s, p.capitalId)),
    expedition: virtual<PlayerState>(entity('fleet'), (p, s) => fleetOf(s, p.expeditionFleetId)),
    atSea: virtual<PlayerState>(bool, (p, s) => charOf(s, p.rulerId)?.location.kind === 'fleet'),
  },
};

const TIME: PathType = {
  t: 'object',
  fields: {
    hour: virtual<object>(num, (_o, s) => s.state.time.hour),
    year: virtual<object>(num, (_o, s) => toCalendar(s.state.time.hour).year),
    month: virtual<object>(num, (_o, s) => toCalendar(s.state.time.hour).monthIndex, '0 = Icebreak … 11 = Frostmoot'),
    day: virtual<object>(num, (_o, s) => toCalendar(s.state.time.hour).day, '1–30'),
    dayOfYear: virtual<object>(num, (_o, s) => ((dayIndex(s.state.time.hour) % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR),
    weekday: virtual<object>(num, (_o, s) => weekdayIndex(s.state.time.hour), '0 = Moonday'),
    season: virtual<object>(oneOf(SEASON_IDS), (_o, s) => season(s.state.time.hour)),
  },
};

/** Entity kind → its object type. */
export const ENTITY_TYPES: Readonly<Record<EntityKind, PathType>> = {
  character: CHARACTER,
  settlement: SETTLEMENT,
  holding: HOLDING,
  faction: FACTION,
  fleet: FLEET,
  player: PLAYER,
  house: HOUSE,
  time: TIME,
};

// ---------------------------------------------------------------------------------------------
// Roots.

const TIME_SENTINEL: object = Object.freeze({});

export interface RootDef {
  readonly type: PathType;
  readonly resolve: (s: EvalScope) => unknown;
}

/** Every root of the language. Which ones an expression may use depends on its context (checker). */
export const ROOTS: Readonly<Record<string, RootDef>> = {
  player: { type: entity('player'), resolve: (s) => s.state.player },
  house: { type: entity('house'), resolve: (s) => s.state.player.house as PlayerHouse },
  ruler: { type: entity('character'), resolve: (s) => charOf(s, s.state.player.rulerId) },
  time: { type: entity('time'), resolve: () => TIME_SENTINEL },
  vars: { type: { t: 'any' }, resolve: (s) => s.vars },
  event: { type: { t: 'any' }, resolve: (s) => s.event },
  settlement: { type: entity('settlement'), resolve: (s) => settlementOf(s, s.scope.settlement) },
  holding: { type: entity('holding'), resolve: (s) => settlementOf(s, s.scope.holding) },
  faction: { type: entity('faction'), resolve: (s) => factionOf(s, s.scope.faction) },
  character: { type: entity('character'), resolve: (s) => charOf(s, s.scope.character) },
  fleet: { type: entity('fleet'), resolve: (s) => fleetOf(s, s.scope.fleet) },
};

/** Roots available to every expression. */
export const GLOBAL_ROOTS: readonly string[] = ['player', 'house', 'ruler', 'time', 'vars'];
/** Roots bound to entity ids by a scope. */
export const ENTITY_ROOTS: readonly string[] = ['settlement', 'holding', 'faction', 'character', 'fleet'];

/** Follows entity references to the object type. */
export function derefType(type: PathType): PathType {
  return type.t === 'entity' ? ENTITY_TYPES[type.entity] : type;
}

// ---------------------------------------------------------------------------------------------
// Runtime path compilation.

type Step = (v: unknown, s: EvalScope) => unknown;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function fieldStep(key: string): Step {
  return (v) => (isObject(v) && !Array.isArray(v) && Object.hasOwn(v, key) ? v[key] : undefined);
}

function recordStep(key: string, fallback: Value | undefined): Step {
  return (v) => {
    if (!isObject(v) || Array.isArray(v)) return undefined;
    return Object.hasOwn(v, key) ? v[key] : fallback;
  };
}

function virtualStep(get: Getter): Step {
  return (v, s) => (get as unknown as (o: unknown, s: EvalScope) => unknown)(v, s);
}

/** Final value of a path: scalars as they are; an entity (object with a string id) becomes its id. */
function finish(v: unknown): Value {
  if (isObject(v) && !Array.isArray(v)) return typeof v.id === 'string' ? v.id : null;
  return toValue(v);
}

/**
 * Compiles a path to a getter. Unknown roots or fields compile to generic own-property reads (the static
 * checker reports them); evaluation never throws.
 */
export function compilePath(root: string, segments: readonly string[]): (s: EvalScope) => Value {
  const def = Object.hasOwn(ROOTS, root) ? ROOTS[root] : undefined;
  if (!def) return () => null;
  const steps: Step[] = [];
  let type: PathType | undefined = def.type;
  for (const seg of segments) {
    const t: PathType | undefined = type === undefined ? undefined : derefType(type);
    if (t?.t === 'object' && Object.hasOwn(t.fields, seg)) {
      const f = t.fields[seg] as PathField;
      steps.push(f.get ? virtualStep(f.get) : fieldStep(seg));
      type = f.type;
    } else if (t?.t === 'record') {
      steps.push(recordStep(seg, t.fallback));
      type = t.of;
    } else {
      steps.push(fieldStep(seg));
      type = undefined;
    }
  }
  const resolve = def.resolve;
  return (s) => {
    let v = resolve(s);
    for (let i = 0; i < steps.length; i++) {
      if (v === undefined || v === null) return null;
      v = (steps[i] as Step)(v, s);
    }
    return finish(v);
  };
}

/** Static type of a path's value, or an error message. `values` lists the allowed strings of enum fields. */
export type PathCheck = { ok: true; type: LeafKind | 'any'; values?: readonly string[] } | { ok: false; message: string };

/** Type-checks a path against the catalogue (roots must already be allowed by the caller). */
export function checkPath(root: string, segments: readonly string[], suggest: (name: string, options: readonly string[]) => string): PathCheck {
  const def = Object.hasOwn(ROOTS, root) ? ROOTS[root] : undefined;
  if (!def) return { ok: false, message: `unknown root '${root}'${suggest(root, Object.keys(ROOTS))}` };
  let type: PathType = def.type;
  let where = root;
  for (const seg of segments) {
    const t = derefType(type);
    if (t.t === 'any') return { ok: true, type: 'any' };
    if (t.t === 'leaf') return { ok: false, message: `'${where}' is a ${t.of}; it has no field '${seg}'` };
    if (t.t === 'object') {
      if (!Object.hasOwn(t.fields, seg)) return { ok: false, message: `'${where}' has no field '${seg}'${suggest(seg, Object.keys(t.fields))}` };
      type = (t.fields[seg] as PathField).type;
    } else if (t.t === 'record') {
      if (!isSafeRecordKey(seg)) return { ok: false, message: `'${seg}' is not a valid key` };
      if (t.keys !== undefined && !t.keys.includes(seg)) return { ok: false, message: `'${where}' has no key '${seg}'${suggest(seg, t.keys)}` };
      type = t.of;
    } else {
      return { ok: false, message: `cannot read '${seg}' of '${where}'` };
    }
    where = `${where}.${seg}`;
  }
  if (type.t === 'entity') return { ok: true, type: 'string' };
  if (type.t === 'leaf') return type.values ? { ok: true, type: type.of, values: type.values } : { ok: true, type: type.of };
  if (type.t === 'any') return { ok: true, type: 'any' };
  const fields = type.t === 'object' ? Object.keys(type.fields) : (type.keys ?? []);
  return { ok: false, message: `'${where}' is not a value; pick a field${fields.length > 0 ? ` (e.g. ${where}.${fields[0] as string})` : ''}` };
}

/** Field names of a root's type (tooling: autocompletion and the writers' reference). */
export function fieldsOf(root: string): string[] {
  const def = Object.hasOwn(ROOTS, root) ? ROOTS[root] : undefined;
  if (!def) return [];
  const t = derefType(def.type);
  return t.t === 'object' ? Object.keys(t.fields) : [];
}

/** Own-property record lookup with id validation (shared by the engine). */
export const lookupRecord = rec;
