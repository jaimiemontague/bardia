/**
 * Entity factories used by world generation and modules. All randomness comes from named RNG
 * streams, so factories are deterministic. Pass the SimContext as `deps` inside an operation: draws
 * then go through `ctx.rng()` on the CALLING MODULE's own streams (`<moduleId>:factory` and
 * `<moduleId>:names`; kernel code uses the shared 'factory' and 'names'), so one module creating
 * more entities never changes the names or birthdays of entities another module creates.
 * Each factory inserts the entity into the state, keeps back-references consistent
 * (province.settlementIds, faction.holdingIds, ship.locationFleetId <-> fleet.shipIds) and returns
 * the entity.
 */
import type { Content } from '@content/index';
import type { HomelandCultureId } from '@content/schemas/ids';
import { SKILL_IDS } from '@content/schemas/ids';
import { clamp } from './dmath';
import { newId } from './ids';
import { generatePersonalName, generatePlaceName, generateShipName, NAMES_STREAM } from './names';
import { hostStream, type RandomSource } from './rng';
import type {
  Attributes,
  Character,
  CharacterLocation,
  CharacterRole,
  CharId,
  CultureId,
  EconomyStateId,
  Faction,
  FactionId,
  FactionKind,
  FaithId,
  Family,
  Fleet,
  FleetIntent,
  FleetMode,
  GameState,
  GoodId,
  Hour,
  MapPos,
  Personality,
  Province,
  ProvinceId,
  Relation,
  Settlement,
  SettlementId,
  SettlementTierId,
  Ship,
  ShipId,
  ShipTypeId,
  SkillId,
  UnitTypeId,
  FleetId,
  PortraitSpec,
  RulerCreation,
} from './state';
import { HOURS_PER_YEAR } from './time';

export { generateByname, generatePersonalName, generatePlaceName, generateShipName } from './names';

/** Shared RNG stream for non-name factory randomness used by kernel code (sex, birthdays, portraits). */
export const FACTORY_STREAM = 'factory';

/** What the factories need besides the state. A SimContext satisfies it (and should be passed). */
export interface FactoryDeps {
  content: Content;
  /** Per-operation RNG (SimContext.rng). Without it the functional API on `state` is used. */
  rng?(stream: string): RandomSource;
  /** Module whose streams are used ('core' or absent: the shared 'factory'/'names' streams). */
  readonly moduleId?: string;
}

/** The factory and name stream names for a caller (see the file header). */
export function factoryStreams(deps: Pick<FactoryDeps, 'moduleId'>): { factory: string; names: string } {
  const id = deps.moduleId;
  if (id === undefined || id === 'core') return { factory: FACTORY_STREAM, names: NAMES_STREAM };
  return { factory: `${id}:factory`, names: `${id}:names` };
}

function randomFor(state: GameState, deps: FactoryDeps): { factory: RandomSource; names: RandomSource } {
  const streams = factoryStreams(deps);
  const get = (stream: string): RandomSource => (deps.rng ? deps.rng(stream) : hostStream(state, stream));
  return { factory: get(streams.factory), names: get(streams.names) };
}

// ---------------------------------------------------------------------------------------------
// Relations

/** Canonical relation key: the two ids sorted and joined with '|'. */
export function relationKey(a: string, b: string): string {
  if (a === b) throw new RangeError(`relationKey: an entity has no relation with itself (${a})`);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Recomputes `opinion` as the clamped sum of its modifiers. */
export function recomputeOpinion(rel: Relation, min = -100, max = 100): number {
  let sum = 0;
  for (const m of rel.modifiers) sum += m.value;
  rel.opinion = clamp(sum, min, max);
  return rel.opinion;
}

/** Returns the relation between a and b, creating a neutral one if missing. */
export function getOrCreateRelation(state: GameState, a: string, b: string): Relation {
  const key = relationKey(a, b);
  let rel = state.relations[key];
  if (!rel) {
    const [x, y] = a < b ? [a, b] : [b, a];
    state.relations[key] = { a: x, b: y, opinion: 0, modifiers: [], stance: 'neutral', pacts: [], grievances: 0 };
    rel = state.relations[key] as Relation;
  }
  return rel;
}

/** The relation between a and b, if any. */
export function getRelation(state: GameState, a: string, b: string): Relation | undefined {
  return state.relations[relationKey(a, b)];
}

// ---------------------------------------------------------------------------------------------
// Characters

export interface CreateCharacterOptions {
  culture: CultureId;
  sex?: 'male' | 'female';
  faith?: FaithId;
  name?: string;
  byname?: string;
  /** Exact birth hour; otherwise derived from `age` (default balance.defaults.fallbackAge) with a random birthday. */
  birthHour?: Hour;
  age?: number;
  attributes?: Partial<Attributes>;
  skills?: Partial<Record<SkillId, number>>;
  traits?: string[];
  level?: number;
  location?: CharacterLocation;
  role?: CharacterRole;
  factionId?: FactionId;
  loyalty?: number;
  personality?: Personality;
  family?: Partial<Family>;
}

/** Creates a character (name generated from the culture's syllable tables if not given). */
export function createCharacter(state: GameState, deps: FactoryDeps, opts: CreateCharacterOptions): Character {
  const { content } = deps;
  const random = randomFor(state, deps);
  const culture = content.cultures[opts.culture];
  const ch = content.balance.character;
  const id = newId(state, 'chr');
  const sex = opts.sex ?? (random.factory.int(0, 1) === 0 ? 'male' : 'female');
  const birthHour =
    opts.birthHour ??
    state.time.hour - (opts.age ?? content.balance.defaults.fallbackAge) * HOURS_PER_YEAR - random.factory.int(0, HOURS_PER_YEAR - 1);
  const name = opts.name ?? generatePersonalName(random.names, culture.naming, sex);
  const skills = {} as Record<SkillId, number>;
  for (const s of SKILL_IDS) skills[s] = clamp(opts.skills?.[s] ?? 0, 0, ch.skillMax);
  const level = clamp(opts.level ?? 1, 1, content.balance.xp.maxLevel);
  const character: Character = {
    id,
    name,
    sex,
    culture: opts.culture,
    faith: opts.faith ?? culture.faith,
    birthHour,
    alive: true,
    attributes: {
      might: opts.attributes?.might ?? ch.attributeStart,
      agility: opts.attributes?.agility ?? ch.attributeStart,
      wits: opts.attributes?.wits ?? ch.attributeStart,
      vigor: opts.attributes?.vigor ?? ch.attributeStart,
    },
    skills,
    traits: [...(opts.traits ?? [])],
    feats: [],
    level,
    xp: content.balance.xp.levelTable[level - 1] ?? 0,
    health: { hpPct: 100, wound: 'none', injuries: [] },
    family: { spouseIds: [], childIds: [], ...opts.family },
    portrait: { seed: random.factory.u32() },
    location: opts.location ?? { kind: 'none' },
  };
  if (opts.byname !== undefined) character.byname = opts.byname;
  if (opts.role !== undefined) character.role = opts.role;
  if (opts.factionId !== undefined) character.factionId = opts.factionId;
  if (opts.loyalty !== undefined) character.loyalty = opts.loyalty;
  if (opts.personality !== undefined) character.personality = opts.personality;
  state.characters[id] = character;
  return character;
}

// ---------------------------------------------------------------------------------------------
// Factions

export interface CreateFactionOptions {
  culture: CultureId;
  kind: FactionKind;
  name?: string;
  faith?: FaithId;
  /** Existing ruler; otherwise one is created (age from balance.defaults.rulerAge). */
  rulerId?: CharId;
  treasury?: number;
  armouryTier?: number;
  weaponTier?: number;
  liegeId?: FactionId;
  colorIndex?: number;
}

export function createFaction(state: GameState, deps: FactoryDeps, opts: CreateFactionOptions): Faction {
  const id = newId(state, 'fac');
  const faith = opts.faith ?? deps.content.cultures[opts.culture].faith;
  let rulerId = opts.rulerId;
  if (rulerId === undefined) {
    const [lo, hi] = deps.content.balance.defaults.rulerAge;
    const ruler = createCharacter(state, deps, {
      culture: opts.culture,
      faith,
      age: randomFor(state, deps).factory.int(lo, hi),
      role: { kind: 'ruler', factionId: id },
      factionId: id,
    });
    rulerId = ruler.id;
  } else {
    const ruler = state.characters[rulerId];
    if (ruler) {
      ruler.factionId = id;
      ruler.role = { kind: 'ruler', factionId: id };
    }
  }
  const rulerName = state.characters[rulerId]?.name ?? 'Unknown';
  const faction: Faction = {
    id,
    name: opts.name ?? `House of ${rulerName}`,
    rulerId,
    culture: opts.culture,
    faith,
    kind: opts.kind,
    holdingIds: [],
    vassalIds: [],
    tributaryIds: [],
    treasury: Math.max(0, opts.treasury ?? 0),
    armouryTier: opts.armouryTier ?? 1,
    weaponTier: opts.weaponTier ?? 1,
  };
  if (opts.liegeId !== undefined) faction.liegeId = opts.liegeId;
  if (opts.colorIndex !== undefined) faction.colorIndex = opts.colorIndex;
  state.factions[id] = faction;
  return faction;
}

// ---------------------------------------------------------------------------------------------
// Provinces and settlements

export interface CreateProvinceOptions {
  name: string;
  regionId: string;
  homeland: boolean;
  kingdomId?: string;
}

/** Creates an empty province; its capitalId is set by the first createSettlement with `isCapital`. */
export function createProvince(state: GameState, opts: CreateProvinceOptions): Province {
  const id = newId(state, 'prv');
  const province: Province = {
    id,
    name: opts.name,
    regionId: opts.regionId,
    capitalId: 'set_0',
    settlementIds: [],
    homeland: opts.homeland,
    claimants: [],
  };
  if (opts.kingdomId !== undefined) province.kingdomId = opts.kingdomId;
  state.provinces[id] = province;
  return province;
}

export interface CreateSettlementOptions {
  culture: CultureId;
  provinceId: ProvinceId;
  factionId: FactionId;
  tier: SettlementTierId;
  pop: number;
  mapPos: MapPos;
  name?: string;
  faith?: FaithId;
  /** Existing leader; otherwise a leader (age from balance.defaults.leaderAge) is created living there. */
  leaderId?: CharId;
  economy?: EconomyStateId;
  silver?: number;
  garrison?: Record<UnitTypeId, number>;
  fortTier?: 0 | 1 | 2 | 3 | 4;
  armourTier?: number;
  weaponTier?: number;
  buildings?: Record<string, number>;
  coastal?: boolean;
  quirks?: string[];
  /** Make this the province capital. */
  isCapital?: boolean;
}

export function createSettlement(state: GameState, deps: FactoryDeps, opts: CreateSettlementOptions): Settlement {
  const id = newId(state, 'set');
  const culture = deps.content.cultures[opts.culture];
  const faith = opts.faith ?? culture.faith;
  const name = opts.name ?? generatePlaceName(randomFor(state, deps).names, culture.naming);
  let leaderId = opts.leaderId;
  if (leaderId === undefined) {
    const [lo, hi] = deps.content.balance.defaults.leaderAge;
    const leader = createCharacter(state, deps, {
      culture: opts.culture,
      faith,
      age: randomFor(state, deps).factory.int(lo, hi),
      location: { kind: 'settlement', id },
      role: { kind: 'npc', holdingId: id, factionId: opts.factionId },
      factionId: opts.factionId,
    });
    leaderId = leader.id;
  }
  const settlement: Settlement = {
    id,
    name,
    culture: opts.culture,
    faith,
    provinceId: opts.provinceId,
    factionId: opts.factionId,
    leaderId,
    tier: opts.tier,
    pop: Math.max(0, Math.round(opts.pop)),
    economy: opts.economy ?? 'fair',
    silver: Math.max(0, opts.silver ?? 0),
    garrison: { ...(opts.garrison ?? {}) },
    fortTier: opts.fortTier ?? 0,
    armourTier: opts.armourTier ?? 1,
    weaponTier: opts.weaponTier ?? 1,
    buildings: { ...(opts.buildings ?? {}) },
    npcIds: [],
    quirks: [...(opts.quirks ?? [])],
    coastal: opts.coastal ?? false,
    mapPos: { x: opts.mapPos.x, y: opts.mapPos.y },
  };
  state.settlements[id] = settlement;
  const province = state.provinces[opts.provinceId];
  if (province) {
    if (!province.settlementIds.includes(id)) province.settlementIds.push(id);
    if (opts.isCapital || province.capitalId === 'set_0') province.capitalId = id;
  }
  const faction = state.factions[opts.factionId];
  if (faction && !faction.holdingIds.includes(id)) faction.holdingIds.push(id);
  return settlement;
}

// ---------------------------------------------------------------------------------------------
// Ships and fleets

export interface CreateShipOptions {
  type: ShipTypeId;
  ownerId: FactionId;
  name?: string;
  /** Used for "… of {home}" names. */
  homeName?: string;
  dockedAt?: SettlementId;
}

export function createShip(state: GameState, deps: FactoryDeps, opts: CreateShipOptions): Ship {
  const def = deps.content.balance.ships[opts.type];
  const id = newId(state, 'shp');
  const ship: Ship = {
    id,
    type: opts.type,
    name: opts.name ?? generateShipName(randomFor(state, deps).names, deps.content.names, opts.homeName),
    hullHp: def.hull,
    sailHp: def.sail,
    ownerId: opts.ownerId,
  };
  if (opts.dockedAt !== undefined) ship.dockedAt = opts.dockedAt;
  state.ships[id] = ship;
  return ship;
}

export interface CreateFleetOptions {
  ownerId: FactionId;
  leaderId: CharId;
  pos: MapPos;
  shipIds?: ShipId[];
  lieutenantIds?: CharId[];
  men?: Record<UnitTypeId, number>;
  cargo?: Partial<Record<GoodId, number>>;
  silver?: number;
  rations?: number;
  morale?: number;
  mode?: FleetMode;
  intent?: FleetIntent;
}

/**
 * Creates a fleet. Ships listed in `shipIds` are moved into it: removed from any fleet they were in
 * (a ship is never in two fleets), linked with `locationFleetId` and undocked.
 */
export function createFleet(state: GameState, deps: FactoryDeps, opts: CreateFleetOptions): Fleet {
  const id: FleetId = newId(state, 'flt');
  const shipIds: ShipId[] = [];
  for (const shipId of opts.shipIds ?? []) if (!shipIds.includes(shipId)) shipIds.push(shipId);
  const fleet: Fleet = {
    id,
    ownerId: opts.ownerId,
    shipIds,
    leaderId: opts.leaderId,
    lieutenantIds: [...(opts.lieutenantIds ?? [])],
    men: { ...(opts.men ?? {}) },
    cargo: { ...(opts.cargo ?? {}) },
    silver: Math.max(0, opts.silver ?? 0),
    rations: Math.max(0, opts.rations ?? 0),
    morale: opts.morale ?? deps.content.balance.defaults.fleetMorale,
    crewStamina: 100,
    voyageDays: 0,
    pos: { x: opts.pos.x, y: opts.pos.y },
    route: [],
    mode: opts.mode ?? 'docked',
  };
  if (opts.intent !== undefined) fleet.intent = opts.intent;
  state.fleets[id] = fleet;
  for (const shipId of fleet.shipIds) {
    const ship = state.ships[shipId];
    if (!ship) continue;
    const previousId = ship.locationFleetId;
    if (previousId !== undefined && previousId !== id) {
      const previous = state.fleets[previousId];
      if (previous) previous.shipIds = previous.shipIds.filter((s) => s !== shipId);
    }
    ship.locationFleetId = id;
    delete ship.dockedAt;
  }
  return fleet;
}

// ---------------------------------------------------------------------------------------------
// Placeholder player (used by GameSession.newGame until the world module places the player).

export interface PlaceholderPlayerOptions {
  name?: string;
  sex?: 'male' | 'female';
  culture?: HomelandCultureId;
  /** The ruler's portrait (seed + explicit layer picks); default: a random seed. */
  portrait?: PortraitSpec;
  /** The New Saga wizard's raw choices, recorded on `player.creation` (applied by the people module). */
  creation?: RulerCreation;
}

/** Flag set on the placeholder home settlement id; the world module replaces it on init. */
export const PLACEHOLDER_HOME_FLAG = 'placeholderHome';

/**
 * Creates the player's house: faction, a 16-year-old ruler, a placeholder home province and
 * capital (difficulty-preset men, ships, food, start buildings), lieutenants and house standing.
 * The world module may re-home the player onto a real settlement (see ARCHITECTURE.md).
 */
export function createPlaceholderPlayer(state: GameState, deps: FactoryDeps, opts: PlaceholderPlayerOptions = {}): void {
  const { balance, cultures } = deps.content;
  const preset = balance.difficulty[state.meta.difficulty];
  const cultureId: CultureId = opts.culture ?? 'skarn';
  const culture = cultures[cultureId];

  const ruler = createCharacter(state, deps, {
    culture: cultureId,
    age: balance.character.playerStartAge,
    role: { kind: 'ruler' },
    ...(opts.sex !== undefined ? { sex: opts.sex } : {}),
    ...(opts.name !== undefined ? { name: opts.name } : {}),
  });
  const faction = createFaction(state, deps, {
    culture: cultureId,
    kind: 'player',
    rulerId: ruler.id,
    treasury: preset.startSilver,
    name: `House of ${ruler.name}`,
  });
  const province = createProvince(state, {
    name: generatePlaceName(randomFor(state, deps).names, culture.naming),
    regionId: 'placeholder',
    homeland: true,
  });
  // Culture bonuses are the single source of start-fortification differences ('fort.startTierDelta').
  let wallsDelta = 0;
  for (const bonus of culture.bonuses) wallsDelta += bonus.modifiers['fort.startTierDelta'] ?? 0;
  const wallsTier = clamp((balance.startBuildings.walls ?? 1) + wallsDelta, 0, 4);
  const buildings: Record<string, number> = { ...balance.startBuildings, walls: wallsTier };
  const pop = balance.defaults.placeholderCapitalPop;
  const capital = createSettlement(state, deps, {
    culture: cultureId,
    provinceId: province.id,
    factionId: faction.id,
    leaderId: ruler.id,
    tier: 'town',
    pop,
    mapPos: { x: 0, y: 0 },
    garrison: { ...preset.startUnits },
    fortTier: clamp(wallsTier, 0, 4) as 0 | 1 | 2 | 3 | 4,
    buildings,
    coastal: true,
    isCapital: true,
  });
  capital.holding = {
    governorId: ruler.id,
    tax: 'fair',
    loyalty: balance.holdings.startLoyalty,
    foodMonths: preset.foodMonths,
    pool: { max: 0, current: 0, veterans: {} },
    buildQueue: [],
    shipQueue: [],
    garrisonTarget: Math.ceil(pop * balance.holdings.garrisonMinPopShare),
  };
  ruler.location = { kind: 'settlement', id: capital.id };
  ruler.factionId = faction.id;
  ruler.role = { kind: 'ruler', holdingId: capital.id, factionId: faction.id };

  for (const [type, n] of Object.entries(preset.ships) as [ShipTypeId, number][]) {
    for (let i = 0; i < n; i++) createShip(state, deps, { type, ownerId: faction.id, homeName: capital.name, dockedAt: capital.id });
  }
  const [ltLo, ltHi] = balance.defaults.lieutenantAge;
  for (let i = 0; i < preset.lieutenants; i++) {
    createCharacter(state, deps, {
      culture: cultureId,
      age: randomFor(state, deps).factory.int(ltLo, ltHi),
      location: { kind: 'settlement', id: capital.id },
      role: { kind: 'lieutenant', factionId: faction.id },
      factionId: faction.id,
      loyalty: balance.defaults.lieutenantLoyalty,
    });
  }

  const favor = {} as GameState['player']['house']['favor'];
  for (const god of Object.keys(deps.content.gods) as (keyof typeof favor)[]) favor[god] = balance.standing.favor.start;
  state.player = {
    rulerId: ruler.id,
    factionId: faction.id,
    capitalId: capital.id,
    house: {
      renown: 0,
      honor: balance.standing.honor.start,
      dread: balance.standing.dread.start,
      favor,
      faithWrath: balance.standing.faithWrath.start,
      faith: culture.faith,
    },
    sagaLedger: { milestones: {}, ambitions: [] },
    knownMapRef: '',
    policies: { envoy: 'acceptFavorable', petitions: 'ask' },
  };
  if (opts.portrait !== undefined) ruler.portrait = JSON.parse(JSON.stringify(opts.portrait)) as PortraitSpec;
  if (opts.creation !== undefined) state.player.creation = JSON.parse(JSON.stringify(opts.creation)) as RulerCreation;
  state.flags[PLACEHOLDER_HOME_FLAG] = capital.id;
}
