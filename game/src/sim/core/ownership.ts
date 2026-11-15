/**
 * Who owns what (machine-readable). Every design-level effect op (§19.1), command (§30.9), pending
 * decision kind, event (§30.10), condition-language function (§29.7) and root GameState slice has
 * exactly ONE owning module id. The owner declares the type (module augmentation) and implements
 * it; everyone else only uses it (applies the effect, dispatches the command, reacts to the event).
 *
 * src/sim/ownership.test.ts checks the running registry against these tables: an op/command/
 * condition function registered by a module other than its listed owner fails the build, and with
 * BARDIA_STRICT_OWNERSHIP=1 (the integrator's gate once modules are complete) every listed item
 * must be registered. Modules may add further items that are not listed here (module-internal
 * commands, events and ops); they own those implicitly. Changing an owner is an integrator edit.
 */

/** The design's effect primitives (§19.1). `kill(cause)` is the op `kill` with a `cause` field. */
export const DESIGN_EFFECT_PRIMITIVES = [
  'addSilver',
  'addGoods',
  'addMen',
  'killMen',
  'woundCharacter',
  'addTrait',
  'removeTrait',
  'marry',
  'birth',
  'kill',
  'capture',
  'giveItem',
  'changeOpinion',
  'changeLoyalty',
  'changeRenown',
  'changeHonor',
  'changeDread',
  'changeFavor',
  'setFlag',
  'startQuest',
  'revealSite',
  'addIntel',
  'giveRelic',
  'unlockCodex',
  'spawnFleet',
  'spawnArmy',
  'startBattle',
  'startDuel',
  'changeEconomy',
  'addNews',
  'scheduleStorylet',
] as const;

/** Effect op → owning module ('core' = the kernel). */
export const EFFECT_OWNERS: Readonly<Record<string, string>> = {
  // Kernel (pure-state ops; see core/effects.ts).
  addSilver: 'core',
  addGoods: 'core',
  addRations: 'core',
  changeOpinion: 'core',
  changeLoyalty: 'core',
  changeRenown: 'core',
  changeHonor: 'core',
  changeDread: 'core',
  changeFavor: 'core',
  setFlag: 'core',
  unlockCodex: 'core',
  scheduleStorylet: 'core',
  addChronicle: 'core',
  notify: 'core',
  narrate: 'core',
  // Characters.
  woundCharacter: 'people',
  addTrait: 'people',
  removeTrait: 'people',
  marry: 'people',
  birth: 'people',
  kill: 'people',
  capture: 'people',
  giveItem: 'people',
  // Men and armies.
  addMen: 'military',
  killMen: 'military',
  spawnArmy: 'military',
  // Fleets at sea.
  spawnFleet: 'expeditions',
  // Relics, sites, quests.
  startQuest: 'quests',
  revealSite: 'quests',
  giveRelic: 'quests',
  // Knowledge and rumour.
  addIntel: 'intel',
  addNews: 'news',
  // Settlement prosperity (the economy state of a settlement).
  changeEconomy: 'economy',
  // Sub-simulations (each raises its own setup decision).
  startBattle: 'battle',
  startDuel: 'duel',
  startSeaBattle: 'seabattle',
  // Module-owned additions registered by the wave-2 integrator (effect ops).
  // battle
  autoResolveBattle: 'battle',
  // economy (the house storehouse, state.storehouse)
  changeStores: 'economy',
  // faith
  faithDeed: 'faith',
  changeFaithWrath: 'faith',
  changePiety: 'faith',
  buildChapel: 'faith',
  // intel
  observeSettlement: 'intel',
  // military
  moveMen: 'military',
  disbandArmy: 'military',
  damageShip: 'military',
  sinkShip: 'military',
  captureShip: 'military',
  addShip: 'military',
  // narrative
  fireStoryletTrigger: 'narrative',
  composeVerse: 'narrative',
  // news
  hearNews: 'news',
  // people
  grantXp: 'people',
  releaseCharacter: 'people',
  grantDeedName: 'people',
  // seabattle
  autoResolveSeaBattle: 'seabattle',
  // world
  computeRoute: 'world',
  steerEntity: 'world',
  revealArea: 'world',
  revealSettlement: 'world',
};

/**
 * Design command (§30.9, camelCase) → owning module. 'session' = not a command (GameSession API);
 * 'client' = UI-only, never dispatched.
 */
export const COMMAND_OWNERS: Readonly<Record<string, string>> = {
  newGame: 'session',
  save: 'session',
  setTimeScale: 'client',
  wait: 'core',
  setPolicy: 'core',
  acknowledge: 'core',
  chooseAmbitions: 'saga',
  muster: 'military',
  queueShip: 'military',
  repairShip: 'military',
  upgradeArmoury: 'military',
  transfer: 'military',
  promoteLieutenant: 'military',
  hireSellsword: 'military',
  setTax: 'holdings',
  queueBuilding: 'holdings',
  setGarrison: 'holdings',
  assignRole: 'people',
  heal: 'people',
  designateHeir: 'people',
  adopt: 'people',
  foster: 'people',
  captivityAction: 'people',
  planExpedition: 'expeditions',
  launchExpedition: 'expeditions',
  setRoute: 'expeditions',
  makeLandfall: 'expeditions',
  returnToShips: 'expeditions',
  returnHome: 'expeditions',
  resolveEncounter: 'encounters',
  resolveArrival: 'settlements',
  chooseAftermath: 'settlements',
  loadCargo: 'settlements',
  tavernAction: 'settlements',
  trade: 'economy',
  haggle: 'economy',
  audience: 'diplomacy',
  respondEnvoy: 'diplomacy',
  thingAction: 'diplomacy',
  buyMap: 'intel',
  delveChoice: 'quests',
  storyletChoice: 'narrative',
  sacrifice: 'faith',
  readOmen: 'faith',
  startBattle: 'battle',
  applyBattleResult: 'battle',
  startDuel: 'duel',
  applyDuelResult: 'duel',
  startSeaBattle: 'seabattle',
  applySeaBattleResult: 'seabattle',
  // Module-owned additions registered by the wave-2 integrator (commands).
  // economy
  setTradeRoute: 'economy',
  clearTradeRoute: 'economy',
  // faith
  convertHouse: 'faith',
  giveAlms: 'faith',
  foundChapel: 'faith',
  // narrative
  sayLine: 'narrative',
  narrativeSession: 'narrative',
  // people
  allocatePoints: 'people',
  chooseFeat: 'people',  // Module-owned additions registered by the wave-3 modules (commands).
  // settlements
  leaveSettlement: 'settlements',
  // expeditions
  steer: 'expeditions',
};

/** Core pending kind → the module that raises it and the module whose command resolves it. */
export const PENDING_OWNERS: Readonly<Record<string, { raisedBy: string; resolvedBy: string; command: string }>> = {
  encounter: { raisedBy: 'encounters', resolvedBy: 'encounters', command: 'resolveEncounter' },
  arrival: { raisedBy: 'settlements', resolvedBy: 'settlements', command: 'resolveArrival' },
  envoy: { raisedBy: 'diplomacy', resolvedBy: 'diplomacy', command: 'respondEnvoy' },
  storylet: { raisedBy: 'narrative', resolvedBy: 'narrative', command: 'storyletChoice' },
  battleSetup: { raisedBy: 'battle', resolvedBy: 'battle', command: 'startBattle' },
  duel: { raisedBy: 'duel', resolvedBy: 'duel', command: 'startDuel' },
  seaBattle: { raisedBy: 'seabattle', resolvedBy: 'seabattle', command: 'startSeaBattle' },
  aftermath: { raisedBy: 'settlements', resolvedBy: 'settlements', command: 'chooseAftermath' },
  captivity: { raisedBy: 'people', resolvedBy: 'people', command: 'captivityAction' },
  succession: { raisedBy: 'people', resolvedBy: 'people', command: 'designateHeir' },
  thing: { raisedBy: 'diplomacy', resolvedBy: 'diplomacy', command: 'thingAction' },
  delve: { raisedBy: 'quests', resolvedBy: 'quests', command: 'delveChoice' },
  yearEnd: { raisedBy: 'saga', resolvedBy: 'saga', command: 'chooseAmbitions' },
  message: { raisedBy: 'any', resolvedBy: 'core', command: 'acknowledge' },
};

/**
 * Design event (§30.10) → the module that declares and emits it. Any module may REACT to any event
 * (SimModule.reactions); only the owner emits it. 'core:StandingChanged' marks a design event that
 * the kernel already provides under another name.
 */
export const EVENT_OWNERS: Readonly<Record<string, string>> = {
  TimeAdvanced: 'core',
  DayStarted: 'core',
  WeekStarted: 'core',
  MonthStarted: 'core',
  YearStarted: 'core',
  Notification: 'core',
  NarrationLine: 'core',
  ChronicleAdded: 'core',
  PendingRaised: 'core',
  PendingResolved: 'core',
  StandingChanged: 'core',
  LoyaltyChanged: 'core',
  OpinionChanged: 'core',
  CodexUnlocked: 'core',
  PolicyChanged: 'core',
  RenownChanged: 'core:StandingChanged',
  StormWarning: 'weather',
  StormHit: 'weather',
  EncounterSighted: 'encounters',
  Arrived: 'world',
  BattleStarted: 'battle',
  BattleEnded: 'battle',
  DuelEnded: 'duel',
  SeaBattleEnded: 'seabattle',
  SettlementFate: 'settlements',
  RelationChanged: 'diplomacy',
  PactSigned: 'diplomacy',
  PactBroken: 'diplomacy',
  EnvoyArrived: 'diplomacy',
  AllthingOpened: 'diplomacy',
  AcclamationResult: 'diplomacy',
  NewsHeard: 'news',
  IntelGained: 'intel',
  MapAcquired: 'intel',
  Birth: 'people',
  Death: 'people',
  Marriage: 'people',
  ComingOfAge: 'people',
  LevelUp: 'people',
  TitleChanged: 'people',
  CaptureStarted: 'people',
  Released: 'people',
  SuccessionOccurred: 'people',
  RevoltStarted: 'holdings',
  HoldingAttacked: 'holdings',
  HoldingCaptured: 'holdings',
  BuildingCompleted: 'holdings',
  ShipCompleted: 'military',
  MusterCompleted: 'military',
  RelicFound: 'quests',
  LegendLearned: 'quests',
  QuestUpdated: 'quests',
  OmenRead: 'faith',
  GameEnded: 'saga',
  // Module-owned additions registered by the wave-2 integrator (domain events).
  // duel
  DuelDeclined: 'duel',
  // economy
  ArrearsChanged: 'economy',
  EconomyChanged: 'economy',
  HaggleResponse: 'economy',
  LedgerReport: 'economy',
  TradeCompleted: 'economy',
  TradeRouteChanged: 'economy',
  TradeRouteIncident: 'economy',
  // faith
  AlmsGiven: 'faith',
  ChapelBuilt: 'faith',
  FaithDeed: 'faith',
  FaithWrathFell: 'faith',
  FaithWrathRose: 'faith',
  HoldingConverted: 'faith',
  HouseConverted: 'faith',
  OfferingMade: 'faith',
  // military
  ArmouryUpgraded: 'military',
  ArmySpawned: 'military',
  LieutenantDeserted: 'military',
  LieutenantJoined: 'military',
  MenLost: 'military',
  ShipCaptured: 'military',
  ShipSunk: 'military',
  TransferArrived: 'military',
  WoundedRecovered: 'military',
  // narrative
  LineSpoken: 'narrative',
  StoryletFired: 'narrative',
  StoryletResolved: 'narrative',
  VerseComposed: 'narrative',
  // news
  NewsConfirmed: 'news',
  // people
  CaptiveSentWord: 'people',
  CaptivityChoiceMade: 'people',
  CharacterAged: 'people',
  CharacterHealed: 'people',
  CharacterWounded: 'people',
  ChildAdopted: 'people',
  ChildConceived: 'people',
  ChildFellIll: 'people',
  ChildFostered: 'people',
  FealtySworn: 'people',
  FeatChosen: 'people',
  FosterlingTakenHostage: 'people',
  HeirDesignated: 'people',
  HouseFallsSilent: 'people',
  ItemGiven: 'people',
  LeaderReplaced: 'people',
  OldAgeWarned: 'people',
  RegencyEnded: 'people',
  RegencyStarted: 'people',
  RoleAssigned: 'people',
  TraitGained: 'people',
  TraitLost: 'people',
  XpGained: 'people',
  // weather
  StormWeathered: 'weather',
  // world
  PortageStarted: 'world',
  RouteFailed: 'world',
  SeaZoneCharted: 'world',  // Module-owned additions registered by the wave-3 modules (domain events).
  // expeditions
  ExpeditionLaunched: 'expeditions',
  ExpeditionReturned: 'expeditions',
  FleetSpawned: 'expeditions',
  LandfallMade: 'expeditions',
  PartyReturned: 'expeditions',
  FleetStarving: 'expeditions',
  ExpeditionLost: 'expeditions',
  ExpeditionLeaderless: 'expeditions',
  // settlements
  ArrivalResolved: 'settlements',
  SettlementEntered: 'settlements',
  // encounters (Module-owned addition)
  EncounterResolved: 'encounters',
};

/** Condition-language function (§29.7) → owning module. */
export const CONDITION_FN_OWNERS: Readonly<Record<string, string>> = {
  flag: 'core',
  season: 'core',
  opinion: 'core',
  hasTrait: 'people',
  daysSince: 'narrative',
  rand: 'narrative',
  count: 'narrative',
  // Module-owned additions registered by the wave-2 integrator (condition functions).
  // economy
  price: 'economy',
  stock: 'economy',
  economyState: 'economy',
  treasury: 'economy',
  inArrears: 'economy',
  tradeRoutes: 'economy',
  // faith
  favor: 'faith',
  omen: 'faith',
  faithWrath: 'faith',
  piety: 'faith',
  isConverted: 'faith',
  hasChapel: 'faith',
  canConvert: 'faith',
  recentLanternContact: 'faith',
  // intel
  hasIntel: 'intel',
  intelConfidence: 'intel',
  intelLabel: 'intel',
  holdsMap: 'intel',
  // military
  menOfType: 'military',
  menTotal: 'military',
  woundedMen: 'military',
  armouryTier: 'military',
  weaponTier: 'military',
  shipCount: 'military',
  lieutenantCount: 'military',
  lieutenantSlots: 'military',
  recruitPool: 'military',
  musterReady: 'military',
  vetStars: 'military',
  // news
  newsHeard: 'news',
  newsHeardCount: 'news',
  newsKnownAt: 'news',
  // people
  hasFeat: 'people',
  age: 'people',
  isAdult: 'people',
  lifeStage: 'people',
  isAlive: 'people',
  isMarried: 'people',
  isCaptive: 'people',
  isPregnant: 'people',
  hasHeir: 'people',
  level: 'people',
  skill: 'people',
  attribute: 'people',
  woundState: 'people',
  childCount: 'people',
  canMarry: 'people',
  isKin: 'people',
  // weather
  stormNear: 'weather',
  windStrength: 'weather',
  foggy: 'weather',
  iceBound: 'weather',
  stormRisk: 'weather',
  stormSeason: 'weather',
  // world
  provinceOf: 'world',
  regionOf: 'world',
  kingdomOf: 'world',
  isCoastal: 'world',
  distanceDays: 'world',
  charted: 'world',
  visited: 'world',
  homeland: 'world',  // Module-owned additions registered by the wave-3 modules (condition functions).
  // expeditions
  atSea: 'expeditions',
  rationDays: 'expeditions',
  fleetMorale: 'expeditions',
  voyageDays: 'expeditions',
  // settlements
  insideSettlement: 'settlements',
  lastFate: 'settlements',
};

/**
 * Root GameState slice → owning module. The owner initialises, migrates and runs the systems for
 * the slice; other modules change it only through the owner's effects/commands or the core
 * factories. 'core' slices are kernel bookkeeping (written through ctx helpers).
 */
export const SLICE_OWNERS: Readonly<Record<string, string>> = {
  meta: 'core',
  time: 'core',
  rng: 'core',
  pending: 'core',
  pendingQueue: 'core',
  flags: 'core',
  chronicle: 'core',
  codex: 'core',
  player: 'core',
  characters: 'people',
  factions: 'world',
  provinces: 'world',
  settlements: 'world',
  sites: 'quests',
  fleets: 'expeditions',
  ships: 'military',
  armies: 'military',
  relations: 'diplomacy',
  markets: 'economy',
  intel: 'intel',
  news: 'news',
  storylets: 'narrative',
  quests: 'quests',
  relics: 'quests',
  weather: 'weather',
  'subsims.battle': 'battle',
  'subsims.duel': 'duel',
  'subsims.seaBattle': 'seabattle',
};
