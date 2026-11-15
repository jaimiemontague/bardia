/**
 * Types of the tactical battle engine (pure TS, mutable, outside Immer). The engine state is a
 * plain object graph with typed arrays for the map, costs and figures; it is never stored in
 * GameState (only BattleSetup and BattleResult are).
 */
import type { Rng } from '@sim/core/rng';
import type { BattleId, BattleResult, BattleSetup, CharId, FormationId, SideSetup, TextVars } from '@sim/core/state';
import type { AbilityId, BattleData, ResolvedUnit } from '../data';
import type { BattleMap } from '../map/grid';
import type { PathGrid } from '../path';
import type { BattleDuelRecord, BattleLeaderFate, BattleLeaderInfo, BattleSideKey, SquadSourceShare, SquadStance } from '../types';

/** 0 = attacker, 1 = defender. */
export type SideIdx = 0 | 1;
export const SIDE_KEYS: readonly [BattleSideKey, BattleSideKey] = ['attacker', 'defender'];
export function sideIdx(key: BattleSideKey): SideIdx {
  return key === 'attacker' ? 0 : 1;
}

/** Lifecycle of a squad on the field. */
export type SquadStatus = 'reserve' | 'asleep' | 'active' | 'routing' | 'escaped' | 'destroyed' | 'surrendered';

/** What a squad is doing (set by orders and the AI). */
export type SquadTaskKind = 'none' | 'move' | 'attack' | 'loot' | 'torch' | 'gate' | 'douse' | 'retreat' | 'volley' | 'drive';

export interface SquadTask {
  kind: SquadTaskKind;
  /** Destination (move, loot, torch, gate, douse, retreat target tile centre). */
  x: number;
  y: number;
  /** Facing to take on arrival (radians), or null. */
  facing: number | null;
  run: boolean;
  /** Squad index (attack), cache index (loot), building index (torch/douse), gate index (gate, douse with gateTarget). */
  target: number;
  /** torch/douse aim at a gate instead of a building. */
  gateTarget: boolean;
  /** volley: fire arrows. */
  fire: boolean;
}

/** One squad on the field. */
export interface BSquad {
  idx: number;
  id: string;
  side: SideIdx;
  unitId: string;
  unit: ResolvedUnit;
  leaderId: CharId;
  leader: BattleLeaderInfo | null;
  unnamed: boolean;
  isChief: boolean;
  isPlayer: boolean;
  /** The named leader still leads (not dead, captured or carried off). */
  leaderPresent: boolean;
  sources: SquadSourceShare[];
  startMen: number;
  men: number;
  /** Men removed by casualties (killed + wounded + captured split at the end). */
  lost: number;
  /** Men of this squad captured while it surrendered. */
  surrenderedMen: number;
  /** Fractional casualties waiting to become whole men. */
  casAcc: number;
  /** Fractional casualties taken this tick (morale). */
  casTick: number;
  /** Single beasts: hit points (men stays 1 until hp reaches 0). */
  hp: number;
  hpMax: number;
  vet: number;
  formation: FormationId;
  stance: SquadStance;
  status: SquadStatus;
  morale: number;
  moraleStart: number;
  stamina: number;
  x: number;
  y: number;
  /** Position at the start of the tick (render interpolation). */
  px: number;
  py: number;
  facing: number;
  /** cos/sin of facing (forward unit vector). */
  fx: number;
  fy: number;
  pFacing: number;
  /** Half extents of the formation footprint (right axis / forward axis). */
  hw: number;
  hd: number;
  task: SquadTask;
  /** Queued move waypoints (x, y pairs) after the current task. */
  waypoints: number[];
  path: number[];
  pathPos: number;
  pathGoal: number;
  pathPending: boolean;
  pathRetreat: boolean;
  repathT: number;
  /** Activity this tick (fatigue, render). */
  moving: boolean;
  running: boolean;
  fighting: boolean;
  /** Bitmask of enemy squad indices in melee contact. */
  contacts: number;
  /** Enemy squads that already triggered the "first flanked contact" morale hit. */
  flankedBy: number;
  /** Enemy squad this squad strikes in melee (−1 none). */
  meleeTarget: number;
  /** Tiles run toward the charge target. */
  runDist: number;
  chargeArmed: boolean;
  chargeT: number;
  chargeBlockedT: number;
  frenzyT: number;
  hidden: boolean;
  /** Ability cooldowns remaining (s), indexed like ABILITY_IDS. */
  cooldowns: number[];
  reloadT: number;
  loot: number;
  gatherT: number;
  actT: number;
  asleepT: number;
  unformedT: number;
  arrivalT: number;
  maulT: number;
  /** Ever routed (lieutenant risk is rolled once). */
  routedOnce: boolean;
  /** Retreating to the extraction zone on orders (saved there). */
  retreating: boolean;
  /** Direct control (task 'drive'): unit direction of travel on the map (screen up = −y). */
  driveX: number;
  driveY: number;
  /** Squads driven by the same order move at the pace of the slowest of them (order sequence number). */
  driveGroup: number;
  /** Side (+1 / −1) a driven squad last turned to slip past an obstacle (kept so it does not dither). */
  driveSlide: number;
  /** Released after a drive: stands its ground (the stance does not send it off) until the next order. */
  driveHeld: boolean;
  /** Seconds since the squad last took or dealt damage. */
  quietT: number;
  /** Player's hit points (0..100) when `isPlayer`. */
  playerHp: number;
  playerWarned: boolean;
  fig0: number;
  figN: number;
}

/** Per-side state. */
export interface BSide {
  idx: SideIdx;
  key: BattleSideKey;
  setup: SideSetup;
  isPlayer: boolean;
  weaponMult: number;
  armourMult: number;
  armourTier: number;
  hasPitch: boolean;
  /** Pitch carried (tons; Infinity when not counted) and burned by fire arrows so far. */
  pitchT: number;
  pitchUsed: number;
  hasRam: boolean;
  ladders: boolean;
  fireSpreadMult: number;
  emberCloak: boolean;
  /** Omen attack factor (§31.10/§31.12) for this side. */
  omenAtk: number;
  chiefIdx: number;
  chiefId: CharId | null;
  chiefFate: 'fine' | 'killed' | 'captured' | 'defeated';
  retreatAll: boolean;
  /** Raid timer ran out: the retreat was sounded by the engine. */
  retreatForced: boolean;
  lootSecured: number;
  /** Visibility of every squad to this side (1 = seen). */
  visible: Uint8Array;
  /** Movement cost per tile (Infinity = blocked). */
  cost: Float32Array;
  minCost: number;
  /** Desperate costs (walls, houses, water passable) used by retreats and routs. */
  retreatCost: Float32Array;
  /** Distance to this side's extraction zone over retreatCost. */
  retreatField: Float32Array;
  defeatedT: number;
}

export interface BBuilding {
  idx: number;
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  doorX: number;
  doorY: number;
  flammability: number;
  isKeep: boolean;
  isTreasury: boolean;
  burning: boolean;
  burnT: number;
  collapsed: boolean;
  igniter: SideIdx;
  /** Indices of buildings within the spread radius. */
  neighbors: number[];
  /** Cache index held by this building (−1 none). */
  cache: number;
}

export interface BGate {
  idx: number;
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  outX: number;
  outY: number;
  inX: number;
  inY: number;
  hp: number;
  hpMax: number;
  broken: boolean;
  burning: boolean;
}

export interface BCache {
  idx: number;
  id: string;
  x: number;
  y: number;
  value: number;
  /** Building index (−1 for loot dropped on the ground). */
  building: number;
  treasury: boolean;
}

/** A volley in flight: hits land when it arrives. */
export interface Impact {
  t: number;
  side: SideIdx;
  shooter: number;
  /** Squad index, or −1 for an area volley. */
  target: number;
  x: number;
  y: number;
  hits: number;
  area: boolean;
  fire: boolean;
}

/** Arrow sprites (render only). */
export interface ProjectilePool {
  n: number;
  x0: Float32Array;
  y0: Float32Array;
  x1: Float32Array;
  y1: Float32Array;
  t0: Float32Array;
  dur: Float32Array;
  fire: Uint8Array;
}

/** Figures (1 per balance.battle.figureMen men): render-level positions following formation slots. */
export interface FigurePool {
  n: number;
  x: Float32Array;
  y: Float32Array;
  px: Float32Array;
  py: Float32Array;
  squad: Int16Array;
  /** 0 = gone (casualty / escaped). */
  alive: Uint8Array;
}

/** Engine events (battle log, audio cues, narration); `key` is a locale key under `battle.event.`. */
export type BattleEngineEventKind =
  | 'routed'
  | 'rallied'
  | 'destroyed'
  | 'escaped'
  | 'surrendered'
  | 'leaderDown'
  | 'chiefKilled'
  | 'chiefCaptured'
  | 'buildingIgnited'
  | 'buildingCollapsed'
  | 'fireDoused'
  | 'gateBroken'
  | 'lootGathered'
  | 'lootSecured'
  | 'lootDropped'
  | 'charge'
  | 'chargeBroken'
  | 'volley'
  | 'rally'
  | 'frenzy'
  | 'hide'
  | 'challengeRefused'
  | 'duelRequested'
  | 'duelResolved'
  | 'reinforcements'
  | 'awake'
  | 'playerWounded'
  | 'lifeThread'
  | 'playerDown'
  | 'raidTimerWarning'
  | 'raidTimerExpired'
  | 'retreatSounded'
  | 'objectiveTaken'
  | 'ended';

export interface BattleEngineEvent {
  tick: number;
  kind: BattleEngineEventKind;
  key: string;
  side?: BattleSideKey;
  squad?: string;
  target?: string;
  x?: number;
  y?: number;
  value?: number;
  vars?: TextVars;
}

/** Orders the client (or the AI) gives. Squads, buildings, gates and caches are referenced by id. */
export type BattleOrder =
  | { kind: 'move'; squads: string[]; x: number; y: number; facing?: number; run?: boolean; queue?: boolean }
  | { kind: 'attack'; squads: string[]; target: string; run?: boolean }
  | { kind: 'formation'; squads: string[]; formation: FormationId }
  | { kind: 'stance'; squads: string[]; stance: SquadStance }
  /**
   * `ahead`: a charge with no target runs at the nearest seen enemy inside the cone in front of the
   * squad (tunables.drive.chargeConeDeg / chargeRangeTiles).
   */
  | { kind: 'ability'; squad: string; ability: AbilityId; x?: number; y?: number; target?: string; fire?: boolean; ahead?: boolean }
  /**
   * Direct control (W A S D): the squads walk (or run) that way until the next drive, keeping their
   * places in the line at the pace of the slowest. dx/dy are screen directions (dy −1 = up); 0, 0
   * stops the squads still driving, and they hold their ground.
   */
  | { kind: 'drive'; squads: string[]; dx: -1 | 0 | 1; dy: -1 | 0 | 1; run?: boolean }
  | { kind: 'loot'; squads: string[]; cache: string }
  | { kind: 'halt'; squads: string[] }
  | { kind: 'retreat'; squads: string[] }
  | { kind: 'retreatAll' }
  | { kind: 'duelOutcome'; winnerId: CharId; loserFate: BattleDuelRecord['loserFate'] };

/** An order as recorded for replays (applied at the start of `tick`). */
export interface RecordedOrder {
  tick: number;
  side: BattleSideKey;
  order: BattleOrder;
}

/** Everything needed to replay a battle deterministically (with the same setup and content). */
export interface BattleReplay {
  battleId: BattleId;
  seed: string;
  /** Sides controlled by a human (their orders are in `orders`; the others run the AI). */
  humanSides: BattleSideKey[];
  orders: RecordedOrder[];
  /** Ticks simulated when the replay was taken. */
  ticks: number;
}

/** A pending duel between a challenger and the enemy chief (the client runs the duel engine). */
export interface DuelRequest {
  challengerId: CharId;
  challengerSquad: string;
  chiefId: CharId;
  chiefSquad: string;
  /** Side of the challenger. */
  side: BattleSideKey;
}

export type EngineStatus = 'running' | 'duelRequested' | 'ended';

export interface EndState {
  winner: 'attacker' | 'defender' | 'none';
  /** rout, chief taken, objective held, a side withdrew, raid timer ran out (raiders sailed), raiders got away with loot, surrender, time limit, wiped out. */
  reason: 'rout' | 'chief' | 'objective' | 'retreat' | 'raidTimer' | 'extracted' | 'surrender' | 'timeout' | 'destroyed';
  retreated: boolean;
  surrendered: boolean;
  tick: number;
}

/** The battle AI seam (src/sim/battle/ai/ provides implementations). */
export interface BattleAiController {
  /**
   * Called every tick for its side; the controller decides when to think. `issue` applies an order
   * at once and returns its error code (null = accepted), like `applyOrder`.
   */
  update(state: BattleState, side: SideIdx, issue: (order: BattleOrder) => string | null): void;
}
export type BattleAiFactory = (state: BattleState, side: SideIdx) => BattleAiController;

export interface EngineOptions {
  /** Sides a human controls (default: the setup's player side). The rest are AI-controlled. */
  humanSides?: BattleSideKey[];
  /** AI factory (default: the folder's AI). */
  ai?: BattleAiFactory;
}

/** The whole mutable engine state. */
export interface BattleState {
  setup: BattleSetup;
  data: BattleData;
  map: BattleMap;
  pg: PathGrid;
  rng: Rng;
  tick: number;
  dt: number;
  timeS: number;
  status: EngineStatus;
  squads: BSquad[];
  sides: [BSide, BSide];
  buildings: BBuilding[];
  gates: BGate[];
  caches: BCache[];
  impacts: Impact[];
  projectiles: ProjectilePool;
  figures: FigurePool;
  events: BattleEngineEvent[];
  queued: { side: SideIdx; order: BattleOrder }[];
  log: RecordedOrder[];
  humanSides: [boolean, boolean];
  ai: [BattleAiController | null, BattleAiController | null];
  duel: DuelRequest | null;
  duels: BattleDuelRecord[];
  leaderFates: Record<string, BattleLeaderFate>;
  /** Loot value placed in caches at the start (ceiling × portable wealth). */
  lootTotal: number;
  /** Portable wealth of the place (silver + goods value). */
  portableValue: number;
  lootBurned: number;
  buildingsBurned: number;
  raidTimerS: number;
  raidWarned: boolean;
  /** Seconds attackers have held the objective/keep uncontested. */
  objectiveHoldT: number;
  /** The guardian objective (barrow entrance) has been breached. */
  objectiveBreached: boolean;
  /** Night alarm raised (asleep squads wake after a delay). */
  alarmT: number;
  night: boolean;
  /** Fire-spread clock. */
  fireClockT: number;
  /** Tiles near burning buildings (smoke), recomputed when fires change. */
  smoke: Uint8Array;
  smokeDirty: boolean;
  costsDirty: boolean;
  /** Squads with a pending path request, in request order. */
  pathQueue: number[];
  /** Drive orders given so far (each one forms a group that keeps pace together). */
  driveSeq: number;
  cosFront: number;
  cosRear: number;
  end: EndState | null;
  result: BattleResult | null;
}
