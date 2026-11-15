/**
 * The complete GameState and entity contracts (design §30, adapted to the owner decisions).
 *
 * EXTENSION RULE: every entity is an exported `interface` so modules can add fields with TypeScript
 * module augmentation instead of editing this file:
 *
 *   declare module '@sim/core/state' {
 *     interface Settlement { siege?: SiegeState }
 *     interface GameState { economyLedger?: Record<FactionId, Ledger> }
 *   }
 *
 * Open VOCABULARIES (game modes, faction/role/site/battle kinds, fleet modes and intents, pacts,
 * stances, intel fact keys, storylet scopes and triggers, character locations) are KEY REGISTRIES:
 * an interface whose keys are the members, with `type X = keyof XRegistry`. A module adds a member by
 * augmenting the registry (`interface PactKinds { coalition: true }`) — never by editing this file.
 *
 * Augmented fields MUST be optional (`?`): core factories, older saves and other modules' tests
 * build these objects without knowing about your field. Initialise them in your module's `init`
 * (new games) and `migrate` (old saves). State must stay JSON-serialisable: plain objects, arrays,
 * finite numbers, strings, booleans, null. No Map/Set/class instances/undefined-as-value/NaN.
 */
import type {
  CultureId,
  DifficultyId,
  DuelWeaponId,
  EconomyStateId,
  FaithId,
  FormationId,
  GodId,
  GoodId,
  OmenId,
  SettlementTierId,
  ShipTypeId,
  SkillId,
  TaxRateId,
} from '@content/schemas/ids';
import type { RngState } from './rng';
import type { Hour } from './time';

export type {
  CultureId,
  DifficultyId,
  DuelWeaponId,
  EconomyStateId,
  FaithId,
  FormationId,
  GodId,
  GoodId,
  OmenId,
  SettlementTierId,
  ShipTypeId,
  SkillId,
  TaxRateId,
} from '@content/schemas/ids';
export type { Hour } from './time';
export type { RngState } from './rng';

// ---------------------------------------------------------------------------------------------
// §30.1 Identifiers. Template-literal types: 'chr_42' is a CharId, 'set_42' is not.

export type CharId = `chr_${string}`;
export type SettlementId = `set_${string}`;
export type ProvinceId = `prv_${string}`;
export type FactionId = `fac_${string}`;
export type FleetId = `flt_${string}`;
export type ShipId = `shp_${string}`;
export type ArmyId = `arm_${string}`;
export type SiteId = `site_${string}`;
export type RelicId = `rel_${string}`;
export type QuestId = `qst_${string}`;
export type NewsId = `news_${string}`;
export type EventId = `evt_${string}`;
export type PendingId = `pnd_${string}`;
export type BattleId = `bat_${string}`;
export type DuelId = `duel_${string}`;
export type SeaBattleId = `sea_${string}`;
/** Unit type ids come from balance.json `units` (e.g. 'bondi', 'huscarls'). */
export type UnitTypeId = string;
/** Nominal branding helper for any other id kinds modules invent. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** JSON-safe value (for free-form facts and parameters). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
/** Variables for localized text templates (ICU MessageFormat). */
export type TextVars = Record<string, string | number | boolean | null>;
/** A 2-D map position in navigation-grid cells (or tiles in sub-sims). */
export interface MapPos {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------------------------
// §30.2 Root state.

/** Top-level screen modes (design §29.4 FSM). Augment `GameModes` to add members (`declare module '@sim/core/state' { interface GameModes { myKind: true } }`). */
export interface GameModes {
  hub: true;
  map: true;
  battle: true;
  duel: true;
  seaBattle: true;
  delve: true;
  thing: true;
  captivity: true;
  menu: true;
  ended: true;
}
export type GameMode = keyof GameModes;
export type SystemPhase = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';

/** New-saga toggles (§5.1 step 9). Augment to add options; give them defaults in your init. */
export interface GameOptions {
  ironman: boolean;
  gentleMode: boolean;
  duelAssist: boolean;
  autoResolveFair: boolean;
  harshWinters: boolean;
  blood: boolean;
  /** Marriages regardless of sex (§23.1, default on). */
  anySexMarriage: boolean;
}

export interface GameMeta {
  /** Core save schema version (see save/migrations.ts). */
  schemaVersion: number;
  gameVersion: string;
  seed: string;
  difficulty: DifficultyId;
  options: GameOptions;
  /** Next value of the global id counter (ids.ts). */
  nextId: number;
  mode: GameMode;
  /** Per-module data versions for module migrations (`SimModule.version`). */
  moduleVersions: Record<string, number>;
}

/** Where an interrupted scheduler tick resumes (set when a system pends mid-tick). */
export interface TickCursor {
  phase: SystemPhase;
  /** Id of the last module whose system ran in `phase` (informational). */
  after: string;
  /**
   * Order of that module; resume with the first system whose module order is greater.
   * Number.MIN_SAFE_INTEGER: the phase was announced (a reaction raised the decision) but no system ran.
   */
  afterOrder: number;
}

export interface TimeState {
  hour: Hour;
  resume?: TickCursor;
}

export interface StoryletsState {
  cooldowns: Record<string, Hour>;
  onceFired: string[];
  scheduled: ScheduledStorylet[];
}

export interface CodexState {
  /** topic id → hour unlocked */
  unlocked: Record<string, Hour>;
}

export interface GameState {
  meta: GameMeta;
  time: TimeState;
  rng: Record<string, RngState>;
  player: PlayerState;
  characters: Record<CharId, Character>;
  factions: Record<FactionId, Faction>;
  provinces: Record<ProvinceId, Province>;
  settlements: Record<SettlementId, Settlement>;
  sites: Record<SiteId, Site>;
  fleets: Record<FleetId, Fleet>;
  ships: Record<ShipId, Ship>;
  armies: Record<ArmyId, Army>;
  /** key = relationKey(a, b) = sorted `${a}|${b}` */
  relations: Record<string, Relation>;
  markets: Record<SettlementId, Market>;
  /** key = `${observer}|${settlementId}` */
  intel: Record<string, IntelRecord>;
  news: Record<NewsId, NewsItem>;
  storylets: StoryletsState;
  quests: Record<QuestId, QuestState>;
  relics: Record<RelicId, RelicState>;
  weather: WeatherState;
  chronicle: ChronicleEntry[];
  codex: CodexState;
  /** Active sub-simulation slots (setup + result references; internals live outside GameState). */
  subsims: SubSimSlots;
  /** The decision the player must make before time can advance. */
  pending: PendingDecision | null;
  /** Further decisions raised while one was already pending (FIFO). */
  pendingQueue: PendingDecision[];
  flags: Record<string, number | boolean | string>;
}

// ---------------------------------------------------------------------------------------------
// §30.3 Player, house and characters.

export interface Ambition {
  id: string;
  template: string;
  params: Record<string, JsonValue>;
  year: number;
  status: 'active' | 'done' | 'failed';
  boast: boolean;
}

/** Steward policies (§17.4, §10.3). Augment to add policies; `setPolicy` picks them up. */
export interface PlayerPolicies {
  envoy: 'acceptFavorable' | 'marriagesOnly' | 'defer' | 'rejectAll';
  petitions: 'delegate' | 'ask';
}

export interface PlayerHouse {
  renown: number;
  honor: number;
  dread: number;
  favor: Record<GodId, number>;
  piety?: number;
  faithWrath: number;
  faith: FaithId;
  /** Hour of the last Renown-earning deed (for "the songs fade" decay, §22.3). */
  lastRenownGainHour?: Hour;
}

export interface NemesisState {
  factionId: FactionId;
  stage: 1 | 2 | 3 | 4 | 5;
  ended: boolean;
}

/**
 * The New Saga wizard's choices for the first ruler (§5.1), recorded by `createPlaceholderPlayer`
 * from `NewGameOptions.player.creation`. Raw choices only (allocated points, picked ids): the people
 * module turns them into the ruler's skills, attributes, traits and upbringing on `init` and sets
 * `applied`; the world module reads `slainParent`. Absent in saves made before it existed.
 */
export interface RulerCreation {
  /** Upbringing id (upbringings.json). */
  upbringing?: string;
  /** Take the starting trait the upbringing unlocks. */
  takeStartingTrait?: boolean;
  /** The step-7 virtue (one of the upbringing's trait options). */
  positiveTrait?: string | null;
  /** The optional step-7 flaw. */
  negativeTrait?: string | null;
  /** Skill points ALLOCATED per skill (upbringing and homeland bonuses come on top). */
  skills?: Partial<Record<SkillId, number>>;
  /** Attribute points ALLOCATED above the starting value. */
  attributes?: Partial<Record<keyof Attributes, number>>;
  /** Which parent was the slain Jarl. */
  slainParent?: 'father' | 'mother';
  /** Set once the people module has built the ruler from these choices. */
  applied?: boolean;
}

export interface PlayerState {
  /** The wizard's choices for the first ruler (new games since creation choices were recorded). */
  creation?: RulerCreation;
  rulerId: CharId;
  factionId: FactionId;
  capitalId: SettlementId;
  house: PlayerHouse;
  sagaLedger: { milestones: Record<string, 'locked' | 'active' | 'done'>; ambitions: Ambition[] };
  /** Id of the knowledge bitset blob stored alongside the save (world module). */
  knownMapRef: string;
  expeditionFleetId?: FleetId;
  policies: PlayerPolicies;
  /** Placeholder until the world/diplomacy modules generate the Rival. */
  nemesis?: NemesisState;
}

export interface Attributes {
  might: number;
  agility: number;
  wits: number;
  vigor: number;
}

/** Wound severity, ordered (§22.5). Deliberately CLOSED: lasting harm beyond these is an injury trait. */
export type WoundState = 'none' | 'minor' | 'serious' | 'mortal';

export interface Injury {
  id: string;
  untilHour?: Hour;
}

export interface Health {
  hpPct: number;
  wound: WoundState;
  /** Hour the current wound heals (or, for mortal wounds, resolves). */
  woundUntilHour?: Hour;
  injuries: Injury[];
}

export interface Family {
  fatherId?: CharId;
  motherId?: CharId;
  spouseIds: CharId[];
  childIds: CharId[];
  heirId?: CharId;
  fosteredAt?: CharId | FactionId;
  adoptedById?: CharId;
}

/** Character role kinds. Augment `RoleKinds` to add members (`declare module '@sim/core/state' { interface RoleKinds { myKind: true } }`). */
export interface RoleKinds {
  ruler: true;
  lieutenant: true;
  governor: true;
  envoy: true;
  captain: true;
  regent: true;
  steward: true;
  npc: true;
}
export type RoleKind = keyof RoleKinds;

export interface CharacterRole {
  kind: RoleKind;
  holdingId?: SettlementId;
  fleetId?: FleetId;
  factionId?: FactionId;
}

/**
 * Where a character is: location kind → extra fields. Augment to add kinds, e.g.
 * `interface CharacterLocations { delve: { siteId: SiteId } }`.
 */
export interface CharacterLocations {
  settlement: { id: SettlementId };
  fleet: { id: FleetId };
  army: { id: ArmyId };
  captive: { at: SettlementId; by: FactionId };
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  none: {};
}
export type CharacterLocationKind = keyof CharacterLocations;
/** Discriminated union derived from CharacterLocations. */
export type CharacterLocation = { [K in CharacterLocationKind]: { kind: K } & CharacterLocations[K] }[CharacterLocationKind];

export interface MemoryEntry {
  about: CharId | FactionId;
  deed: string;
  hour: Hour;
  weight: number;
}

export interface Personality {
  aggression: number;
  greed: number;
  honor: number;
  caution: number;
  ambition: number;
  piety: number;
}

/** Procedural portrait recipe; placeholder art and final art both key off it (asset manifest). */
export interface PortraitSpec {
  seed: number;
  /** Optional explicit layer picks (layer name → variant index). */
  layers?: Record<string, number>;
}

export interface Character {
  id: CharId;
  name: string;
  byname?: string;
  sex: 'male' | 'female';
  culture: CultureId;
  faith: FaithId;
  birthHour: Hour;
  alive: boolean;
  death?: { hour: Hour; cause: string };
  attributes: Attributes;
  skills: Record<SkillId, number>;
  traits: string[];
  feats: string[];
  level: number;
  xp: number;
  health: Health;
  family: Family;
  role?: CharacterRole;
  /** Faction the character serves (for non-rulers); rulers: their faction. */
  factionId?: FactionId;
  loyalty?: number;
  personality?: Personality;
  portrait: PortraitSpec;
  location: CharacterLocation;
  memory?: MemoryEntry[];
  /** Special gear ids (§12.4) assigned to this character. */
  items?: string[];
}

// ---------------------------------------------------------------------------------------------
// §30.4 World entities.

export interface Province {
  id: ProvinceId;
  name: string;
  regionId: string;
  kingdomId?: string;
  capitalId: SettlementId;
  settlementIds: SettlementId[];
  homeland: boolean;
  claimants: CharId[];
}

/** Faction kinds. Augment `FactionKinds` to add members (`declare module '@sim/core/state' { interface FactionKinds { myKind: true } }`). */
export interface FactionKinds {
  kingdom: true;
  jarldom: true;
  petty: true;
  realm: true;
  city: true;
  empire: true;
  confederacy: true;
  church: true;
  player: true;
  nemesis: true;
}
export type FactionKind = keyof FactionKinds;

export interface AiPlan {
  kind: string;
  targetId?: string;
  steps: string[];
  step: number;
  sinceHour: Hour;
  timeoutHour?: Hour;
}

export interface Faction {
  id: FactionId;
  name: string;
  rulerId: CharId;
  culture: CultureId;
  faith: FaithId;
  kind: FactionKind;
  holdingIds: SettlementId[];
  vassalIds: FactionId[];
  tributaryIds: FactionId[];
  liegeId?: FactionId;
  treasury: number;
  armouryTier: number;
  weaponTier: number;
  aiPlan?: AiPlan;
  coalitionId?: string;
  /** Banner colour index for placeholder heraldry. */
  colorIndex?: number;
}

export interface HoldingState {
  governorId: CharId;
  tax: TaxRateId;
  loyalty: number;
  foodMonths: number;
  pool: { max: number; current: number; veterans: Record<UnitTypeId, number> };
  lastMusterHour?: Hour;
  buildQueue: { buildingId: string; tier: number; doneHour: Hour }[];
  shipQueue: { type: ShipTypeId; doneHour: Hour }[];
  garrisonTarget: number;
}

export interface SettlementDeed {
  kind: string;
  by: FactionId | CharId;
  hour: Hour;
  weight: number;
}

export interface Settlement {
  id: SettlementId;
  name: string;
  culture: CultureId;
  faith: FaithId;
  provinceId: ProvinceId;
  factionId: FactionId;
  leaderId: CharId;
  tier: SettlementTierId;
  pop: number;
  economy: EconomyStateId;
  silver: number;
  garrison: Record<UnitTypeId, number>;
  fortTier: 0 | 1 | 2 | 3 | 4;
  armourTier: number;
  weaponTier: number;
  buildings: Record<string, number>;
  npcIds: CharId[];
  quirks: string[];
  holding?: HoldingState;
  devastationUntil?: Hour;
  coastal: boolean;
  mapPos: MapPos;
  /** Player/faction deeds remembered here (§9.7). */
  deeds?: SettlementDeed[];
}

/** Relic/delve site kinds. Augment `SiteKinds` to add members (`declare module '@sim/core/state' { interface SiteKinds { myKind: true } }`). */
export interface SiteKinds {
  cave: true;
  barrow: true;
  tower: true;
  seaStack: true;
  shrine: true;
  wreck: true;
  ruinedHall: true;
  grove: true;
}
export type SiteKind = keyof SiteKinds;

export interface Site {
  id: SiteId;
  name: string;
  kind: SiteKind;
  mapPos: MapPos;
  revealed: boolean;
  delveId: string;
  relicId?: RelicId;
  cleared: boolean;
}

// ---------------------------------------------------------------------------------------------
// §30.5 Military and naval (unit and ship definitions live in balance.json).

export interface Ship {
  id: ShipId;
  type: ShipTypeId;
  name: string;
  hullHp: number;
  sailHp: number;
  ownerId: FactionId;
  locationFleetId?: FleetId;
  dockedAt?: SettlementId;
}

/** Fleet movement modes. Augment `FleetModes` to add members (`declare module '@sim/core/state' { interface FleetModes { myKind: true } }`). */
export interface FleetModes {
  sailing: true;
  beached: true;
  docked: true;
  landed: true;
}
export type FleetMode = keyof FleetModes;
/** Why a fleet is at sea. Augment `FleetIntents` to add members (`declare module '@sim/core/state' { interface FleetIntents { myKind: true } }`). */
export interface FleetIntents {
  expedition: true;
  trade: true;
  raid: true;
  patrol: true;
  transfer: true;
  colony: true;
  envoy: true;
  muster: true;
}
export type FleetIntent = keyof FleetIntents;

export interface Fleet {
  id: FleetId;
  ownerId: FactionId;
  shipIds: ShipId[];
  leaderId: CharId;
  lieutenantIds: CharId[];
  men: Record<UnitTypeId, number>;
  cargo: Partial<Record<GoodId, number>>;
  silver: number;
  rations: number;
  morale: number;
  crewStamina: number;
  voyageDays: number;
  pos: MapPos;
  route: MapPos[];
  mode: FleetMode;
  landPartyArmyId?: ArmyId;
  intent?: FleetIntent;
}

export interface Squad {
  leaderId: CharId;
  unit: UnitTypeId;
  men: number;
  vetStars: 0 | 1 | 2 | 3;
  formation: FormationId;
}

export interface Army {
  id: ArmyId;
  ownerId: FactionId;
  leaderId: CharId;
  squads: Squad[];
  pos: MapPos;
  route: MapPos[];
}

// ---------------------------------------------------------------------------------------------
// §30.6 Economy, diplomacy, intel.

export interface Market {
  stock: Partial<Record<GoodId, number>>;
  target: Partial<Record<GoodId, number>>;
  prod: Partial<Record<GoodId, number>>;
  cons: Partial<Record<GoodId, number>>;
  lastUpdate: Hour;
}

export interface OpinionModifier {
  reason: string;
  value: number;
  decayPerMonth: number;
  untilHour?: Hour;
}

/** Pact kinds between two actors (§17.3). Augment `PactKinds` to add members (`declare module '@sim/core/state' { interface PactKinds { myKind: true } }`). */
export interface PactKinds {
  truce: true;
  treaty: true;
  trade: true;
  alliance: true;
  marriage: true;
  tributary: true;
  vassal: true;
}
export type PactKind = keyof PactKinds;

export interface Pact {
  kind: PactKind;
  sinceHour: Hour;
  untilHour?: Hour;
}

/** Diplomatic stances. Augment `Stances` to add members (`declare module '@sim/core/state' { interface Stances { myKind: true } }`). */
export interface Stances {
  war: true;
  hostile: true;
  neutral: true;
  friendly: true;
  allied: true;
}
export type Stance = keyof Stances;

export interface Relation {
  a: string;
  b: string;
  /** Always clamp(Σ modifiers.value, opinionMin, opinionMax) — see recomputeOpinion(). */
  opinion: number;
  modifiers: OpinionModifier[];
  stance: Stance;
  pacts: Pact[];
  warSinceHour?: Hour;
  lastTributeHour?: Hour;
  grievances: number;
}

/** Kinds of facts an intel record can hold (§20). Augment `IntelFactKeys` to add members (`declare module '@sim/core/state' { interface IntelFactKeys { myKind: true } }`). */
export interface IntelFactKeys {
  garrison: true;
  fortTier: true;
  armour: true;
  weapons: true;
  silver: true;
  economy: true;
  leader: true;
  wars: true;
  relicRumor: true;
  fleets: true;
}
export type IntelFactKey = keyof IntelFactKeys;

export interface IntelFact {
  value: JsonValue;
  source: string;
  reliability: number;
  hour: Hour;
}

export interface IntelRecord {
  observer: FactionId;
  settlementId: SettlementId;
  facts: Partial<Record<IntelFactKey, IntelFact[]>>;
}

export interface NewsItem {
  id: NewsId;
  kind: string;
  originId: SettlementId;
  hour: Hour;
  importance: 1 | 2 | 3 | 4 | 5;
  facts: Record<string, JsonValue>;
  reachedIds: SettlementId[];
  distortion: number;
}

// ---------------------------------------------------------------------------------------------
// §30.7 Narrative, quests, relics.

/** What a storylet is about (§19.1). Augment `StoryletScopes` to add members (`declare module '@sim/core/state' { interface StoryletScopes { myKind: true } }`). */
export interface StoryletScopes {
  player: true;
  holding: true;
  settlement: true;
  faction: true;
  character: true;
  fleet: true;
}
export type StoryletScope = keyof StoryletScopes;

/** When a storylet is considered (§19.1). The narrative module owns the trigger engine; the module that raises the underlying event fires it. Augment `StoryletTriggers` to add members (`declare module '@sim/core/state' { interface StoryletTriggers { myKind: true } }`). */
export interface StoryletTriggers {
  monthly: true;
  onArrival: true;
  onEnterBuilding: true;
  onBattleEnd: true;
  onDuelEnd: true;
  onSeasonStart: true;
  onBirthday: true;
  onAgeReached: true;
  onRelationThreshold: true;
  onVoyageDay: true;
  onLanding: true;
  onNewsHeard: true;
  onRelicFound: true;
  onDeath: true;
  onThing: true;
  scheduled: true;
}
export type StoryletTrigger = keyof StoryletTriggers;

export interface ScheduledStorylet {
  storyletId: string;
  atHour: Hour;
  scope?: { kind: StoryletScope; id?: string };
  vars?: TextVars;
}

export interface RelicState {
  id: RelicId;
  holder: FactionId | 'site';
  siteId?: SiteId;
  attunedUntilHour?: Hour;
  knownToPlayer: 'unknown' | 'legend' | 'map' | 'held';
}

export interface QuestState {
  id: QuestId;
  template: string;
  params: Record<string, JsonValue>;
  step: number;
  deadlineHour?: Hour;
  status: 'active' | 'done' | 'failed';
}

export interface ChronicleEntry {
  hour: Hour;
  kind: string;
  importance: number;
  textKey: string;
  vars: TextVars;
  refs: string[];
}

// ---------------------------------------------------------------------------------------------
// Weather (owned by the weather module; minimal core shape).

export type WindStrength = 'calm' | 'light' | 'fresh' | 'strong' | 'gale';

export interface SeaZoneWeather {
  /** Direction the wind blows FROM, degrees clockwise from north. */
  windDir: number;
  windStr: WindStrength;
  fog: boolean;
  ice: boolean;
}

export interface StormCell {
  id: string;
  pos: MapPos;
  radius: number;
  severity: 'minor' | 'moderate' | 'severe';
  velocity: MapPos;
  untilHour: Hour;
}

export interface WeatherState {
  zones: Record<string, SeaZoneWeather>;
  storms: StormCell[];
  lastUpdateHour: Hour;
}

// ---------------------------------------------------------------------------------------------
// §30.8 Sub-simulation contracts (battle 20 Hz, duel 60 Hz, sea battle 20 Hz).

/** Battle kinds (§13.1, §30.8). Augment `BattleKinds` to add members (`declare module '@sim/core/state' { interface BattleKinds { myKind: true } }`). */
export interface BattleKinds {
  raid: true;
  assault: true;
  cloister: true;
  fortress: true;
  sortie: true;
  field: true;
  ambush: true;
  beach: true;
  defense: true;
  guardian: true;
}
export type BattleKind = keyof BattleKinds;

export interface SideSetup {
  factionId: FactionId;
  chiefId?: CharId;
  squads: Squad[];
  armourTier: number;
  weaponTier: number;
  moraleMods: number;
  isPlayer: boolean;
}

export interface BattleWeather {
  windDir: number;
  windStr: number;
  rain: boolean;
  night: boolean;
}

export interface BattleSetup {
  id: BattleId;
  kind: BattleKind;
  mapTemplate: string;
  seed: string;
  settlementId?: SettlementId;
  siteId?: SiteId;
  approach: 'night' | 'dawn' | 'challenge';
  attacker: SideSetup;
  defender: SideSetup;
  timerS?: number;
  weather: BattleWeather;
  omen?: OmenId;
}

export interface BattleCasualties {
  side: 'attacker' | 'defender';
  leaderId: CharId;
  killed: number;
  wounded: number;
  captured: number;
}

export interface BattleResult {
  winner: 'attacker' | 'defender' | 'none';
  retreated: boolean;
  casualties: BattleCasualties[];
  chief: { killed: boolean; captured: boolean };
  playerFate?: 'fine' | 'wounded' | 'captured' | 'dead';
  lootValue: number;
  lootGoods: Partial<Record<GoodId, number>>;
  buildingsBurned: number;
  durationS: number;
  xp: Record<CharId, number>;
  autoResolved: boolean;
}

export interface Duelist {
  charId: CharId;
  weapon: DuelWeaponId;
  armourTier: number;
  weaponTier: number;
}

export interface DuelSetup {
  id: DuelId;
  a: Duelist;
  b: Duelist;
  arena: 'hall' | 'deck' | 'beach' | 'holmgang' | 'field';
  stakes: 'firstBlood' | 'yield' | 'death';
  assisted: boolean;
  seed: string;
}

export interface DuelResult {
  winnerId: CharId;
  loserFate: 'spared' | 'yielded' | 'killed' | 'captured';
  injuries: { charId: CharId; injury: string }[];
  renown: number;
  autoResolved: boolean;
}

export interface SeaShipSetup {
  shipId: ShipId;
  type: ShipTypeId;
  hullHp: number;
  sailHp: number;
  crew: number;
  archers: number;
  boarders: number;
}

export interface SeaSideSetup {
  factionId: FactionId;
  fleetId?: FleetId;
  captainId?: CharId;
  ships: SeaShipSetup[];
  armourTier: number;
  weaponTier: number;
  morale: number;
  isPlayer: boolean;
  hasPitch: boolean;
}

export interface SeaBattleSetup {
  id: SeaBattleId;
  seed: string;
  attacker: SeaSideSetup;
  defender: SeaSideSetup;
  wind: { dir: number; str: WindStrength };
  arena: string;
}

export interface SeaBattleResult {
  winner: 'attacker' | 'defender' | 'none';
  retreated: boolean;
  shipsSunk: ShipId[];
  shipsCaptured: ShipId[];
  crewLost: { side: 'attacker' | 'defender'; killed: number; wounded: number; captured: number }[];
  captainDuel?: DuelResult;
  durationS: number;
  xp: Record<CharId, number>;
  autoResolved: boolean;
}

export interface ActiveSubSim<S, R> {
  id: string;
  status: 'setup' | 'running' | 'resolved';
  startedHour: Hour;
  setup: S;
  result?: R;
}

export interface SubSimSlots {
  battle?: ActiveSubSim<BattleSetup, BattleResult>;
  duel?: ActiveSubSim<DuelSetup, DuelResult>;
  seaBattle?: ActiveSubSim<SeaBattleSetup, SeaBattleResult>;
}

// ---------------------------------------------------------------------------------------------
// Pending decisions. Time never advances while `GameState.pending` is non-null.
// Payload interfaces are exported so owning modules can augment them with more fields; new kinds
// are added by augmenting `PendingPayloads`.

export interface EncounterPayload {
  fleetId: FleetId;
  otherFleetId?: FleetId;
  encounterKind: string;
}
export interface ArrivalPayload {
  settlementId: SettlementId;
  fleetId?: FleetId;
  armyId?: ArmyId;
}
export interface EnvoyPayload {
  fromFactionId: FactionId;
  envoyId?: CharId;
  proposal: string;
  terms: Record<string, JsonValue>;
  expiresHour?: Hour;
}
export interface StoryletPayload {
  storyletId: string;
  scope?: { kind: StoryletScope; id?: string };
  vars: TextVars;
}
export interface BattleSetupPayload {
  battleId: BattleId;
}
export interface DuelPayload {
  duelId: DuelId;
}
export interface SeaBattlePayload {
  seaBattleId: SeaBattleId;
}
export interface AftermathPayload {
  settlementId: SettlementId;
  battleId?: BattleId;
}
export interface CaptivityPayload {
  charId: CharId;
  captorFactionId: FactionId;
  at: SettlementId;
}
export interface SuccessionPayload {
  deceasedId: CharId;
  heirId?: CharId;
  candidates: CharId[];
}
export interface ThingPayload {
  year: number;
  stage: string;
}
export interface DelvePayload {
  siteId: SiteId;
  nodeId: string;
}
export interface YearEndPayload {
  year: number;
}
export interface MessagePayload {
  key: string;
  vars: TextVars;
  priority?: NotificationPriority;
}

/** Map of pending-decision kind → payload type. Augment to add kinds. */
export interface PendingPayloads {
  encounter: EncounterPayload;
  arrival: ArrivalPayload;
  envoy: EnvoyPayload;
  storylet: StoryletPayload;
  battleSetup: BattleSetupPayload;
  duel: DuelPayload;
  seaBattle: SeaBattlePayload;
  aftermath: AftermathPayload;
  captivity: CaptivityPayload;
  succession: SuccessionPayload;
  thing: ThingPayload;
  delve: DelvePayload;
  yearEnd: YearEndPayload;
  message: MessagePayload;
}

export type PendingKind = keyof PendingPayloads;

export type PendingDecisionOf<K extends PendingKind> = {
  id: PendingId;
  kind: K;
  /** Hour the decision was raised. */
  hour: Hour;
  /** Module that raised it (the one expected to resolve it). */
  source: string;
  payload: PendingPayloads[K];
};

export type PendingDecision = { [K in PendingKind]: PendingDecisionOf<K> }[PendingKind];

/** Shared by Notification events and message decisions. */
export type NotificationPriority = 'low' | 'normal' | 'high' | 'critical';
