/**
 * Economy module augmentations of the kernel types (ARCHITECTURE.md §4) and the module's public
 * contracts: markets and prices (§11.2), trading and haggling (§11.3), trade routes (§11.4), the
 * monthly ledger (§11.5, §31.1), debt and arrears (§11.7) and the economy state of settlements
 * (§9.4).
 *
 * THE HOUSE STOREHOUSE (`state.storehouse`, economy-owned root slice; §11.3 "yours and theirs"):
 *   - One storehouse per house, at the player's capital (`state.player.capitalId`; it moves with the capital).
 *     It is the house's own stock, separate from the town market's (`state.markets[capital].stock`).
 *   - Units: `goods` are TONS per good (as market stocks and fleet cargo); `goods` never holds 'rations'.
 *     `rations` is a COUNT (as `fleet.rations`, ARCHITECTURE §10). The boundary converts with
 *     `balance.economy.rationsPerTon` only where rations meet a market (a trade of N t of rations moves
 *     round(N × rationsPerTon) rations in or out of the storehouse).
 *   - Filled by: a fleet standing down at home (cargo and leftover rations, expeditions → `changeStores`),
 *     trades at the capital (`trade` with no fleet, or `storehouse: true`) and the new-game seed
 *     (`tunables.economy.storehouse`: rations for `startRationDays` of the capital garrison, `startGoods`).
 *     Emptied by: the Expedition Planner's launch (cargo and rations, free) and sales at the capital.
 *   - Rations here are provisions for voyages; they are not the population's food stores
 *     (`holding.foodMonths`, holdings), which keep their meaning.
 *
 * Every augmented field is optional (core factories, old saves and other modules' tests build these
 * objects without knowing about them). Field names are distinctive so they never collide with another
 * module's augmentation of the same interface.
 */
import type {
  CharId,
  EconomyStateId,
  FactionId,
  FleetId,
  GoodId,
  Hour,
  SettlementId,
  ShipId,
} from '@sim/core/state';

/** Tons per good (buy/sell lists, cargo moves). */
export type GoodTons = Partial<Record<GoodId, number>>;

/** Id of a trade route (generic module-record prefix). */
export type TradeRouteId = `rec_${string}`;

// ---------------------------------------------------------------------------------------------
// State

/** A temporary price modifier (`eventMod` of the §11.2 formula): famine, good harvest, war scare … */
export interface PriceEvent {
  good: GoodId;
  mult: number;
  untilHour: Hour;
  /** One settlement's market … */
  settlementId?: SettlementId;
  /** … or every market in a region (province.regionId); neither = every market. */
  regionId?: string;
  reason: string;
}

/** Unpaid expenses of a house (§11.7). */
export interface ArrearsState {
  amount: number;
  /** Consecutive month ends with arrears outstanding. */
  months: number;
  sinceHour: Hour;
}

/** The last monthly ledger of a house, compact (every faction, for the AI, intel and the client). */
export interface LedgerSummary {
  hour: Hour;
  /** Taxes + market tolls + straits tolls (the base of tribute and vassal dues). */
  domainIncome: number;
  income: number;
  expenses: number;
  net: number;
  treasury: number;
  arrears: number;
}

/** Status of a trade route. */
export type TradeRouteStatus = 'active' | 'suspended';

/** Why a route is suspended. */
export type TradeRouteSuspension = 'war' | 'ship' | 'captain' | 'market' | 'embargo';

/** A knarr and captain looping between two markets with chosen goods (§11.4). */
export interface TradeRoute {
  id: TradeRouteId;
  factionId: FactionId;
  shipId: ShipId;
  /** A lieutenant captain; absent = a hired factor (balance.economy.factorWage per month). */
  captainId?: CharId;
  fromId: SettlementId;
  toId: SettlementId;
  /** Bought at `fromId`, sold at `toId`. */
  outbound: GoodId[];
  /** Bought at `toId`, sold at `fromId`. */
  inbound: GoodId[];
  sinceHour: Hour;
  roundTripDays: number;
  /** Fraction of a round trip carried over to next month. */
  tripProgress: number;
  status: TradeRouteStatus;
  suspended?: TradeRouteSuspension;
  trips: number;
  /** Lifetime net profit and the last month's. */
  profit: number;
  lastProfit: number;
  losses: number;
}

/** The house storehouse at the capital (see the header for units). */
export interface Storehouse {
  /** Trade goods, tons (never 'rations'). */
  goods: GoodTons;
  /** Provisions, a count (1 ration = 1 man for 1 day). */
  rations: number;
}

/** An open haggle over one batch at one market (§11.3: 1–3 rounds). */
export interface HaggleSession {
  settlementId: SettlementId;
  fleetId?: FleetId;
  /** The batch moves in and out of the house storehouse (home trade). */
  storehouse?: boolean;
  buy: GoodTons;
  sell: GoodTons;
  /** Rounds played so far. */
  round: number;
  /** The player's latest ask, percent. */
  askPct: number;
  /** What the merchant currently offers, percent in the player's favour. */
  offerPct: number;
  /** 'final': no rounds left (accept or walk away). */
  status: 'open' | 'final';
  /** Sessions expire when time passes. */
  hour: Hour;
}

/** The economy module's root slice. */
export interface EconomyState {
  ledgers: Record<FactionId, LedgerSummary>;
  /** The player's last full ledger (the monthly report panel). */
  lastReport?: LedgerReport;
  arrears: Record<FactionId, ArrearsState>;
  routes: Record<TradeRouteId, TradeRoute>;
  priceEvents: PriceEvent[];
  /** Event term of each settlement's economy score (changeEconomy `score`), fading monthly. */
  eventScore: Record<SettlementId, number>;
  /** Harbour blockades: settlement → hour the blockade lifts. */
  blockades: Record<SettlementId, Hour>;
  /** The player's rapport with each market's merchant (§11.3). */
  rapport: Record<SettlementId, number>;
  haggle?: HaggleSession;
}

// ---------------------------------------------------------------------------------------------
// Ledger report (§11.5)

export type LedgerIncomeKey = 'taxes' | 'marketTolls' | 'straitsTolls' | 'tribute' | 'vassalDues' | 'tradeRoutes';
export type LedgerExpenseKey = 'wages' | 'lieutenants' | 'ships' | 'buildings' | 'factors' | 'tributePaid';
export type LedgerLineKey = LedgerIncomeKey | LedgerExpenseKey;

export const LEDGER_INCOME_KEYS: readonly LedgerIncomeKey[] = ['taxes', 'marketTolls', 'straitsTolls', 'tribute', 'vassalDues', 'tradeRoutes'];
export const LEDGER_EXPENSE_KEYS: readonly LedgerExpenseKey[] = ['wages', 'lieutenants', 'ships', 'buildings', 'factors', 'tributePaid'];

/**
 * One row of a ledger line's breakdown tooltip. `id` is a settlement, unit type, ship type,
 * character, faction, province or route id depending on the line; `count` is men, ships or trips.
 */
export interface LedgerItem {
  id: string;
  amount: number;
  count?: number;
  /** Extra numbers for the tooltip (pop, tax rate index, prosperity, stewardship …). */
  info?: Record<string, number | string>;
}

/** A house's monthly ledger (the player's is emitted as the LedgerReport event and kept in the slice). */
export interface LedgerReport {
  factionId: FactionId;
  hour: Hour;
  year: number;
  monthIndex: number;
  income: Record<LedgerIncomeKey, number>;
  expenses: Record<LedgerExpenseKey, number>;
  breakdown: Record<LedgerLineKey, LedgerItem[]>;
  totalIncome: number;
  totalExpenses: number;
  net: number;
  treasuryBefore: number;
  treasuryAfter: number;
  /** Expenses (incl. old arrears) actually paid this month. */
  paid: number;
  arrearsBefore: number;
  arrearsAfter: number;
}

// ---------------------------------------------------------------------------------------------
// Commands

/**
 * `trade`: buy and sell goods at a market (§11.3). Sales are applied before purchases. Who holds the goods:
 *   - `fleetId`: that fleet, lying in the harbour;
 *   - `storehouse: true`: the house storehouse (only at the player's capital; the treasury pays);
 *   - neither: abroad, the expedition (else the first fleet of the player's in the harbour); at the capital,
 *     a fleet of the player's lying there, or the storehouse when no fleet of the player's is in the harbour.
 */
export interface TradeCommand {
  settlementId: SettlementId;
  buy?: GoodTons;
  sell?: GoodTons;
  /** The fleet whose cargo holds the goods. */
  fleetId?: FleetId;
  /** Trade from the house storehouse at the capital. */
  storehouse?: boolean;
}

/** `haggle`: bargain over one batch for 1–3 rounds, then accept or walk away (§11.3). */
export interface HaggleCommand {
  settlementId: SettlementId;
  action: 'offer' | 'accept' | 'walkAway';
  /** With the first 'offer': the batch (as in `trade`). Later offers reuse the open session's batch. */
  buy?: GoodTons;
  sell?: GoodTons;
  fleetId?: FleetId;
  /** With the first 'offer': bargain over goods in the house storehouse (as in `trade`). */
  storehouse?: boolean;
  /** With 'offer': the improvement asked for, percent of the listed price (1 … tunables.haggle.maxAskPct). */
  askPct?: number;
}

/** `setTradeRoute`: assign a knarr and a captain (a lieutenant, or a hired factor) to a loop between two markets (§11.4). */
export interface SetTradeRouteCommand {
  /** Edit this route instead of opening a new one. */
  routeId?: TradeRouteId;
  shipId: ShipId;
  /** Omit to hire a factor. */
  captainId?: CharId;
  fromId: SettlementId;
  toId: SettlementId;
  outbound: GoodId[];
  inbound?: GoodId[];
}

/**
 * `changeStores` (economy-owned effect): add to (or, with negative values, take from) the house storehouse.
 * Amounts floor at 0. Used by expeditions (launch, stand-down), storylets and quests.
 */
export interface ChangeStoresEffect {
  /** Tons per good (never 'rations'; use `rations`). */
  goods?: GoodTons;
  /** A count of rations. */
  rations?: number;
}

/** `clearTradeRoute`: end a route; the knarr returns to its harbour and a factor is paid off. */
export interface ClearTradeRouteCommand {
  routeId: TradeRouteId;
}

// ---------------------------------------------------------------------------------------------
// Effects

/** Price-event presets (multipliers from balance.market, durations from tunables.economy.events). */
export type PriceEventPreset = 'famine' | 'goodHarvest';

/**
 * `changeEconomy`: change the economy of a settlement (default: the player's capital) or of every
 * settlement in a region — its economy state (§9.4), its drift score, its market prices (event
 * modifiers), its market stocks or its harbour blockade. At least one change must be given.
 */
export interface ChangeEconomyEffect {
  settlementId?: SettlementId;
  regionId?: string;
  /** Set the economy state outright (applied before `steps`). */
  set?: EconomyStateId;
  /** Move the economy state this many steps (+ richer, − poorer), clamped to ruined … thriving. */
  steps?: number;
  /** Add to the settlement's event score (feeds the monthly drift; fades by tunables.economy.drift.eventDecay). */
  score?: number;
  /** A temporary price modifier. */
  price?: { good: GoodId; mult: number; days: number };
  preset?: PriceEventPreset;
  /** Add (or with negative values remove) market stock, tons. */
  goods?: GoodTons;
  /** Scale every market stock by (1 + stockPct/100), e.g. −50 after a sack. */
  stockPct?: number;
  /** Blockade the harbour for this many days (0 lifts a blockade). */
  blockadeDays?: number;
  /** Why (echoed in EconomyChanged and in price events). */
  reason?: string;
}

// ---------------------------------------------------------------------------------------------
// Events

export interface LedgerReportEvent {
  report: LedgerReport;
}

export interface TradeCompletedEvent {
  settlementId: SettlementId;
  /** The fleet that traded (absent for a storehouse trade). */
  fleetId?: FleetId;
  /** The goods moved in and out of the house storehouse. */
  storehouse?: boolean;
  bought: GoodTons;
  sold: GoodTons;
  spent: number;
  earned: number;
  /** Haggled improvement applied, percent (0 for a plain trade). */
  haggledPct: number;
}

export interface HaggleResponseEvent {
  settlementId: SettlementId;
  round: number;
  outcome: 'accepted' | 'countered' | 'refused';
  askPct: number;
  offerPct: number;
  rapport: number;
  final: boolean;
}

export interface TradeRouteChangedEvent {
  routeId: TradeRouteId;
  factionId: FactionId;
  change: 'set' | 'updated' | 'cleared' | 'suspended' | 'resumed' | 'lost';
  reason?: string;
}

export interface TradeRouteIncidentEvent {
  routeId: TradeRouteId;
  factionId: FactionId;
  kind: 'piracy' | 'storm';
  /** Value of the cargo lost, silver. */
  lossValue: number;
  shipLost: boolean;
}

export interface EconomyChangedEvent {
  settlementId: SettlementId;
  from: EconomyStateId;
  to: EconomyStateId;
  cause: string;
}

export interface ArrearsChangedEvent {
  factionId: FactionId;
  amount: number;
  months: number;
  cleared: boolean;
}

// ---------------------------------------------------------------------------------------------
// Augmentations

declare module '@sim/core/state' {
  interface GameState {
    economy?: EconomyState;
    /** The house storehouse at the capital (economy; see the header). */
    storehouse?: Storehouse;
  }
  interface Market {
    /** Tons moved through this market per month (moving average of merchant flows, trades and routes). */
    tradeVolume?: number;
    /** Tons traded by the player and routes since the last monthly update (folded into tradeVolume). */
    tradeTons?: number;
  }
  interface Ship {
    /** The trade route this knarr runs (it is away trading and cannot join a fleet). */
    tradeRouteId?: TradeRouteId;
  }
  interface PlayerPolicies {
    /** Pause time when the monthly ledger arrives: never, only on a deficit, or always (§11.5 "auto-pause optional"). */
    ledgerPause?: 'off' | 'deficit' | 'always';
  }
}

declare module '@sim/core/commands' {
  interface CommandMap {
    trade: TradeCommand;
    haggle: HaggleCommand;
    setTradeRoute: SetTradeRouteCommand;
    clearTradeRoute: ClearTradeRouteCommand;
  }
}

declare module '@sim/core/events' {
  interface EventMap {
    LedgerReport: LedgerReportEvent;
    TradeCompleted: TradeCompletedEvent;
    HaggleResponse: HaggleResponseEvent;
    TradeRouteChanged: TradeRouteChangedEvent;
    TradeRouteIncident: TradeRouteIncidentEvent;
    EconomyChanged: EconomyChangedEvent;
    ArrearsChanged: ArrearsChangedEvent;
  }
}

declare module '@sim/core/effects' {
  interface EffectMap {
    changeEconomy: ChangeEconomyEffect;
    changeStores: ChangeStoresEffect;
  }
}

