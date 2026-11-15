/**
 * Military module augmentations of the kernel types (ARCHITECTURE.md §4) and the module's public
 * contracts: recruitment, musters, equipment, ships and the shipyard queue, transfers, lieutenants,
 * squads, veterancy and wounded men (design §12, §31.5).
 *
 * Every augmented field is optional: core factories, old saves and other modules' tests build these
 * objects without knowing about them. Field names are distinctive (`woundedMen`, `vetBattles`, …) so
 * they never collide with another module's augmentation of the same interface.
 */
import type {
  ArmyId,
  CharId,
  FactionId,
  FleetId,
  FormationId,
  GoodId,
  Hour,
  MapPos,
  SettlementId,
  ShipId,
  ShipTypeId,
  UnitTypeId,
} from '@sim/core/state';

/** Men per unit type. */
export type MenRecord = Record<UnitTypeId, number>;

/** Id of a module-internal record (musters, transfers, ship orders). */
export type MilitaryRecordId = `rec_${string}`;

/** The two realm-wide equipment tracks (§12.4). */
export type ArmouryTrack = 'armour' | 'weapons';

/**
 * Wounded men of one unit type recovering in a container (§12.6). Progress accrues at the home rate
 * (1 / woundedRecoveryHomeDays per day) or the field rate (1 / woundedRecoverySeaDays); at 1 the men
 * rejoin the container's ranks with their veterancy. Progress is stored as of `sinceHour` and
 * extrapolated with `rate`, so batches are only rewritten when the rate changes.
 */
export interface WoundedBatch {
  unit: UnitTypeId;
  count: number;
  /** Recovery progress in [0, 1) as of `sinceHour`. */
  progress: number;
  /** Average battles survived by these men (veterancy is kept while they heal). */
  battles: number;
  /** Hour `progress` was last brought up to date. */
  sinceHour: Hour;
  /** Recovery per day since `sinceHour` (home or field rate × recovery modifiers). */
  rate: number;
}

/** Where men are: a settlement garrison, a holding's recruitment pool, a fleet or an army. */
export type MenContainerKind = 'settlement' | 'pool' | 'fleet' | 'army';

/** Reference to a men container as written in effects and commands (exactly one id). */
export interface MenContainerRef {
  settlementId?: SettlementId;
  fleetId?: FleetId;
  armyId?: ArmyId;
  /** With `settlementId`: the holding's recruitment pool instead of its garrison (men going home). */
  pool?: boolean;
}

/** A muster gathering at a holding (§12.1: recruits arrive after `recruit.gatherDays`). */
export interface MusterRecord {
  id: MilitaryRecordId;
  holdingId: SettlementId;
  factionId: FactionId;
  /** Recruits per unit type (veterans included). */
  units: MenRecord;
  /** Recruits per unit type who come from the pool's veterans, with their average battles. */
  veterans: Record<UnitTypeId, { count: number; battles: number }>;
  /** Join this fleet on arrival if it is still in the holding's harbour (else the garrison). */
  fleetId?: FleetId;
  startHour: Hour;
  arriveHour: Hour;
  bounty: number;
}

/** Men, ships and goods on the way between two holdings (§10.3 Transfers). */
export interface TransferRecord {
  id: MilitaryRecordId;
  factionId: FactionId;
  fromId: SettlementId;
  toId: SettlementId;
  men: MenRecord;
  /** Average battles per unit type of the men in transit. */
  vetBattles: Record<UnitTypeId, number>;
  shipIds: ShipId[];
  goods: Partial<Record<GoodId, number>>;
  departHour: Hour;
  arriveHour: Hour;
  days: number;
}

/** One ship in a shipyard's build queue (§12.7). */
export interface ShipOrder {
  id: MilitaryRecordId;
  type: ShipTypeId;
  /** Faction that ordered the ship (the order is cancelled if the holding changes hands). */
  factionId: FactionId;
  /** Chosen name; generated at launch when absent. */
  name?: string;
  buildHours: number;
  queuedHour: Hour;
  /** Hour building started; null while the order waits for a free slot. */
  startHour: Hour | null;
  /** Completion hour (projected while the order waits). */
  doneHour: Hour;
  /** Silver paid (ship cost + timber surcharge). */
  cost: number;
  /** Timber taken from the holding's market, tons. */
  timberT: number;
  /** Silver paid instead of missing timber. */
  timberSurcharge: number;
}

/** Battles won and lost by the player's faction since the last monthly loyalty pass. */
export interface MonthBattles {
  won: number;
  lost: number;
}

/** The military module's root slice. */
export interface MilitaryState {
  musters: MusterRecord[];
  transfers: TransferRecord[];
  /** Holding id → its shipyard queue (canonical; `holding.shipQueue` mirrors it). */
  shipyards: Record<SettlementId, ShipOrder[]>;
  /** `${settlementId}|${absoluteMonth}|${offerIndex}` → hour the sellsword was hired. */
  hiredOffers: Record<string, Hour>;
  /** Battle ids whose veterancy was applied (most recent last, capped). */
  battlesApplied: string[];
  monthBattles: MonthBattles;
  /**
   * Container id → hour its wounded were last written by this module. Entries at or after the start
   * hour of the running operation are read through the draft (base state is stale for them).
   */
  woundedDirty?: Record<string, Hour>;
  /** Earliest hour a muster, transfer or ship order falls due (the hourly system's gate). */
  nextDueHour?: Hour;
  /** Id of the army created by the latest spawnArmy effect (storylets chain on it). */
  lastSpawnedArmyId?: ArmyId;
}

// ---------------------------------------------------------------------------------------------
// Commands

/** `muster`: send the war-arrow at a holding — several unit types in one transaction (§12.1). */
export interface MusterCommand {
  holdingId: SettlementId;
  units: MenRecord;
  /** Optional fleet in the holding's harbour that the recruits board on arrival. */
  fleetId?: FleetId;
}

/** `queueShip`: order a ship at a holding's shipyard (§12.7). */
export interface QueueShipCommand {
  holdingId: SettlementId;
  shipType: ShipTypeId;
  name?: string;
  /** Pay the timber surcharge for timber missing from the holding's market (default true). */
  buyTimber?: boolean;
}

/** `repairShip`: repair ships at one of the realm's shipyards (8 s / hull point, 4 s / sail point). */
export interface RepairShipCommand {
  shipIds: ShipId[];
}

/** `upgradeArmoury`: raise the realm armour or weapon tier by one (§12.4). */
export interface UpgradeArmouryCommand {
  track: ArmouryTrack;
  /** Holding whose Smithy does the work and whose market supplies the iron (default: the capital). */
  holdingId?: SettlementId;
  /** Buy missing iron from the treasury (default: tunables.military.armoury.buyIronByDefault). */
  buyIron?: boolean;
}

/** `transfer`: move men, ships and goods between two holdings (§10.3). */
export interface TransferCommand {
  fromId: SettlementId;
  toId: SettlementId;
  men?: MenRecord;
  shipIds?: ShipId[];
  goods?: Partial<Record<GoodId, number>>;
}

/** `promoteLieutenant`: raise a veteran of a squad with ≥3 battles to a lieutenant (§12.5). */
export interface PromoteLieutenantCommand {
  unit: UnitTypeId;
  settlementId?: SettlementId;
  fleetId?: FleetId;
  armyId?: ArmyId;
}

/** `hireSellsword`: hire one of this month's sellsword offers in a mead-hall (§12.5). */
export interface HireSellswordCommand {
  settlementId: SettlementId;
  /** Index into `sellswordOffers(state, content, settlementId)`. */
  offer: number;
}

// ---------------------------------------------------------------------------------------------
// Effects

/** `addMen`: men join a container (default: the player's expedition fleet, else the capital garrison). Negative counts remove men without loss of life. */
export interface AddMenEffect extends MenContainerRef {
  unit: UnitTypeId;
  count: number;
  /** Average battles of the arriving men (veterancy). */
  battles?: number;
  /** The men arrive wounded and must recover first. */
  wounded?: boolean;
}

/**
 * `killMen`: casualties in a container (default: the player's expedition fleet, else the capital
 * garrison). `count` men die, `wounded` leave the ranks to recover (§12.6, only when the side held
 * the field), `captured` are lost to the enemy. Killed and captured men are deducted from their home
 * holding's population (`homeId`, else the container's home) unless `popLoss` is false.
 */
export interface KillMenEffect extends MenContainerRef {
  unit: UnitTypeId;
  count: number;
  wounded?: number;
  captured?: number;
  homeId?: SettlementId;
  popLoss?: boolean;
}

/** `moveMen`: move men between containers keeping their veterancy (garrison → fleet, fleet → pool …). */
export interface MoveMenEffect {
  from: MenContainerRef;
  to: MenContainerRef;
  men: MenRecord;
  /** Also move all of `from`'s wounded (keeping their recovery progress), e.g. when a fleet disbands. */
  wounded?: boolean;
}

/** One squad of a `spawnArmy` effect. */
export interface SpawnSquadSpec {
  unit: UnitTypeId;
  men: number;
  leaderId?: CharId;
  vetStars?: 0 | 1 | 2 | 3;
  formation?: FormationId;
}

/** `spawnArmy`: create an army (rebels, guardians, storylet forces). Its id is announced by ArmySpawned. */
export interface SpawnArmyEffect {
  /** Owner (default: the player's faction). */
  ownerId?: FactionId;
  /** Leader (default: the owner's ruler). */
  leaderId?: CharId;
  /** Where the army stands (default: the settlement's or the owner's capital position). */
  settlementId?: SettlementId;
  pos?: MapPos;
  homeId?: SettlementId;
  squads: SpawnSquadSpec[];
  /** Free-form tag echoed in ArmySpawned (e.g. 'rebels', 'quests:qst_4'). */
  tag?: string;
}

/**
 * `disbandArmy`: an army stands down — its men (and wounded) move to `to` (a fleet, garrison or pool) keeping
 * their veterancy, and the army is removed. Without `to` the men go home to the army's home holding's pool.
 */
export interface DisbandArmyEffect {
  armyId: ArmyId;
  to?: MenContainerRef;
}

/** `damageShip`: hull and sail damage (negative values repair; clamped to [0, max]). A hull at 0 sinks. */
export interface DamageShipEffect {
  shipId: ShipId;
  hull?: number;
  sail?: number;
  cause?: string;
}

/** `sinkShip`: the ship is lost (storm, sea battle, scuttling). */
export interface SinkShipEffect {
  shipId: ShipId;
  cause?: string;
}

/** `captureShip`: a prize changes hands; it joins `fleetId` (crewed if the fleet has the men, else towed). */
export interface CaptureShipEffect {
  shipId: ShipId;
  /** New owner (default: the fleet's owner, else the player's faction). */
  factionId?: FactionId;
  fleetId?: FleetId;
  /** Dock the prize at a settlement instead of joining a fleet. */
  settlementId?: SettlementId;
}

/** `addShip`: a new ship (storylet reward, gift) docked at a settlement or joining a fleet. */
export interface AddShipEffect {
  shipType: ShipTypeId;
  factionId?: FactionId;
  settlementId?: SettlementId;
  fleetId?: FleetId;
  name?: string;
}

// ---------------------------------------------------------------------------------------------
// Events

export interface MusterCompletedEvent {
  musterId: string;
  holdingId: SettlementId;
  factionId: FactionId;
  units: MenRecord;
  total: number;
  fleetId?: FleetId;
}

export interface ShipCompletedEvent {
  shipId: ShipId;
  shipType: ShipTypeId;
  name: string;
  settlementId: SettlementId;
  factionId: FactionId;
}

export interface ShipSunkEvent {
  shipId: ShipId;
  shipType: ShipTypeId;
  name: string;
  ownerId: FactionId;
  fleetId?: FleetId;
  cause: string;
}

export interface ShipCapturedEvent {
  shipId: ShipId;
  shipType: ShipTypeId;
  name: string;
  fromFactionId: FactionId;
  toFactionId: FactionId;
  fleetId?: FleetId;
  towed: boolean;
}

export interface TransferArrivedEvent {
  transferId: string;
  factionId: FactionId;
  fromId: SettlementId;
  toId: SettlementId;
  intercepted: boolean;
  men: MenRecord;
  menLost: number;
  shipIds: ShipId[];
}

export interface ArmouryUpgradedEvent {
  factionId: FactionId;
  track: ArmouryTrack;
  tier: number;
  cost: number;
}

export interface LieutenantJoinedEvent {
  charId: CharId;
  factionId: FactionId;
  source: 'sellsword' | 'veteran';
  cost: number;
}

export interface LieutenantDesertedEvent {
  charId: CharId;
  factionId: FactionId;
  toFactionId?: FactionId;
  loyalty: number;
}

export interface MenLostEvent {
  factionId?: FactionId;
  unit: UnitTypeId;
  killed: number;
  wounded: number;
  captured: number;
  container: { kind: MenContainerKind; id: string };
  homeId?: SettlementId;
}

export interface WoundedRecoveredEvent {
  container: { kind: MenContainerKind; id: string };
  factionId?: FactionId;
  men: MenRecord;
}

export interface ArmySpawnedEvent {
  armyId: ArmyId;
  ownerId: FactionId;
  tag?: string;
}

// ---------------------------------------------------------------------------------------------
// Augmentations

declare module '@sim/core/state' {
  interface GameState {
    military?: MilitaryState;
  }
  interface HoldingState {
    /** Average battles of the veterans in `pool.veterans`, per unit type. */
    veteranBattles?: Record<UnitTypeId, number>;
  }
  interface Settlement {
    /** Wounded garrison men recovering at home. */
    woundedMen?: WoundedBatch[];
    /** Average battles survived by the garrison's men, per unit type (veterancy, §12.6). */
    vetBattles?: Record<UnitTypeId, number>;
  }
  interface Fleet {
    /** Wounded men aboard, recovering (home rate while docked, sea rate otherwise). */
    woundedMen?: WoundedBatch[];
    /** Average battles survived by the fleet's men, per unit type. */
    vetBattles?: Record<UnitTypeId, number>;
  }
  interface Army {
    woundedMen?: WoundedBatch[];
    /** Holding the army's men come from (casualties reduce its population). */
    homeId?: SettlementId;
    /** Tag given by the spawnArmy effect. */
    spawnTag?: string;
  }
  interface Squad {
    /** Battles survived by this squad (vetStars follows balance.squads.veterancyBattles). */
    battles?: number;
  }
  interface Ship {
    /** Id of the transfer carrying this ship between holdings (neither docked nor in a fleet meanwhile). */
    transitId?: string;
    /** A prize without crew, towed by its fleet (fleet speed × balance.shipyard.towSpeedMult). */
    towed?: boolean;
    /** Days into the current beach field-repair session (§12.7). */
    fieldRepairDays?: number;
  }
  interface Character {
    /** Backstory id of a hired sellsword (locale key `military.backstory.<id>`). */
    backstory?: string;
    /** Hour the character entered the house's service as a lieutenant. */
    serviceSinceHour?: Hour;
  }
}

declare module '@sim/core/commands' {
  interface CommandMap {
    muster: MusterCommand;
    queueShip: QueueShipCommand;
    repairShip: RepairShipCommand;
    upgradeArmoury: UpgradeArmouryCommand;
    transfer: TransferCommand;
    promoteLieutenant: PromoteLieutenantCommand;
    hireSellsword: HireSellswordCommand;
  }
}

declare module '@sim/core/events' {
  interface EventMap {
    MusterCompleted: MusterCompletedEvent;
    ShipCompleted: ShipCompletedEvent;
    ShipSunk: ShipSunkEvent;
    ShipCaptured: ShipCapturedEvent;
    TransferArrived: TransferArrivedEvent;
    ArmouryUpgraded: ArmouryUpgradedEvent;
    LieutenantJoined: LieutenantJoinedEvent;
    LieutenantDeserted: LieutenantDesertedEvent;
    MenLost: MenLostEvent;
    WoundedRecovered: WoundedRecoveredEvent;
    ArmySpawned: ArmySpawnedEvent;
  }
}

declare module '@sim/core/effects' {
  interface EffectMap {
    addMen: AddMenEffect;
    killMen: KillMenEffect;
    moveMen: MoveMenEffect;
    spawnArmy: SpawnArmyEffect;
    disbandArmy: DisbandArmyEffect;
    damageShip: DamageShipEffect;
    sinkShip: SinkShipEffect;
    captureShip: CaptureShipEffect;
    addShip: AddShipEffect;
  }
}
