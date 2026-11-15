/**
 * Types and augmentations of the 'holdings' module (ARCHITECTURE §4).
 *
 * State-resident contract (§19): `state.holdingsState` = {
 *   version, lastMonthlyHour,
 *   awaySinceHour?  hour the ruler left the realm's holdings (absent while at home),
 *   feastHour?      hour of the player's house's last feast (FeastHeld),
 *   nextDueHour?    earliest completion hour of any build queue (hourly gate),
 *   reports         holding id → the last monthly loyalty pass with its reasons (the Affairs screen)
 * }.
 * Holding fields this module drives (kernel `HoldingState`): `tax` (economy's ledger reads it),
 * `loyalty` (military's recruitment pools read it), `buildQueue`; and `Settlement.buildings` /
 * `fortTier` on completion (economy upkeep and tolls, military shipyards/smithy/hall, faith grove).
 */
import type { TaxRateId } from '@content/schemas/ids';
import type { FactionId, Hour, SettlementId, UnitTypeId } from '@sim/core/state';

/** Why a holding's loyalty moves this month (§31.7). */
export type LoyaltyReasonId =
  | 'tax'
  | 'victories'
  | 'feast'
  | 'absence'
  | 'famine'
  | 'raided'
  | 'rulerCulture'
  | 'rulerFaith'
  | 'renown'
  | 'lowGarrison'
  | 'residence'
  | 'drift';

/** One term of the monthly loyalty change. */
export interface LoyaltyReason {
  id: LoyaltyReasonId;
  amount: number;
  /** Locale variables for the reason's line (`holdings.reason.<id>`). */
  vars?: Record<string, string | number>;
}

/** The monthly loyalty pass of one holding, kept so the screen can explain it. */
export interface LoyaltyReport {
  hour: Hour;
  before: number;
  after: number;
  reasons: LoyaltyReason[];
  /** Change from other causes since the previous pass (arrears, succession, conversion …). */
  external: number;
}

/** The holdings module's root slice. */
export interface HoldingsState {
  version: number;
  lastMonthlyHour: Hour;
  awaySinceHour?: Hour;
  feastHour?: Hour;
  nextDueHour?: Hour;
  reports: Record<SettlementId, LoyaltyReport>;
}

/** `setTax`: the tax level of one of the player's holdings (§10.3, §31.1). */
export interface SetTaxCommand {
  holdingId: SettlementId;
  tax: TaxRateId;
}

/** `queueBuilding`: build the next tier of a building in one of the player's holdings (§10.4). */
export interface QueueBuildingCommand {
  holdingId: SettlementId;
  buildingId: string;
}

/**
 * `setGarrison`: the men under arms kept at a holding, per unit type. Lowering a count sends those
 * men home to the holding's recruitment pool (they stop drawing wages; mustering them again costs the
 * bounty). Raising a garrison is a muster (military) or a transfer from another holding (military).
 */
export interface SetGarrisonCommand {
  holdingId: SettlementId;
  units: Record<UnitTypeId, number>;
}

/** A building tier finished (§10.4). */
export interface BuildingCompletedEvent {
  settlementId: SettlementId;
  factionId: FactionId;
  buildingId: string;
  tier: number;
}

declare module '@sim/core/state' {
  interface GameState {
    holdingsState?: HoldingsState;
  }
}

declare module '@sim/core/commands' {
  interface CommandMap {
    setTax: SetTaxCommand;
    queueBuilding: QueueBuildingCommand;
    setGarrison: SetGarrisonCommand;
  }
}

declare module '@sim/core/events' {
  interface EventMap {
    BuildingCompleted: BuildingCompletedEvent;
  }
}
