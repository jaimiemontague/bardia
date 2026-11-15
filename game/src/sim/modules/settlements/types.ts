/**
 * Settlements augmentations of the kernel types (ARCHITECTURE.md §4) and the module's public contracts
 * (design §9.5 arrival, §9.6 hub, §16 raids, conquest and aftermath, §20 mead-halls).
 *
 * The arrival and aftermath decisions carry `options` (every option with availability and the reason it is
 * greyed out) and `choices` (the commands the shell's generic decision modal can dispatch), so a dedicated
 * screen and the fallback modal show the same thing.
 */
import type { Command } from '@sim/core/commands';
import type { ArmyId, BattleId, CharId, FactionId, FleetId, GoodId, Hour, SettlementId, TextVars } from '@sim/core/state';

/** The Arrival Card's options (§9.5). */
export type ArrivalChoice = 'enter' | 'parley' | 'trade' | 'raid' | 'assault' | 'besiege' | 'leave';
export const ARRIVAL_CHOICES: readonly ArrivalChoice[] = ['enter', 'parley', 'trade', 'raid', 'assault', 'besiege', 'leave'];

/** The Aftermath screen's fates (§16.3). */
export type AftermathFate = 'sackAndBurn' | 'plunderAndLeave' | 'spare' | 'takeCaptives' | 'makeTributary' | 'annex' | 'liberate';
export const AFTERMATH_FATES: readonly AftermathFate[] = ['sackAndBurn', 'plunderAndLeave', 'spare', 'takeCaptives', 'makeTributary', 'annex', 'liberate'];

/** One option as shown (greyed out with the reason when unavailable). */
export interface DecisionOption<C extends string> {
  id: C;
  available: boolean;
  /** Locale key of why it is unavailable (`settlements.reason.<code>`). */
  reasonKey?: string;
  /** Preview numbers (silver, renown, dread, honor, opinion …) for the screen. */
  preview?: Record<string, number>;
}

/** A command button of the shell's generic decision modal. */
export interface DecisionChoice {
  id: string;
  labelKey: string;
  vars?: TextVars;
  command: Command;
  tone?: 'primary' | 'danger' | 'secondary';
  disabled?: boolean;
  previewKey?: string;
}

/** What the party at a settlement may plunder after a won raid or assault (the Cargo screen, §16.2). */
export interface LootWindow {
  settlementId: SettlementId;
  fleetId: FleetId;
  untilHour: Hour;
}

/** The module's root slice. */
export interface SettlementsState {
  version: number;
  /** Battles this module started: battle → where and how. */
  battles: Record<BattleId, { settlementId: SettlementId; approach: 'raid' | 'assault'; fleetId?: FleetId; armyId?: ArmyId }>;
  /** The settlement whose hub the player has entered (the client's hub screen). */
  inside?: SettlementId;
  loot?: LootWindow;
}

declare module '@sim/core/state' {
  interface GameState {
    settlementsState?: SettlementsState;
  }
  interface Settlement {
    /** Pays tribute to this faction (made tributary in an aftermath; the economy ledger reads it). */
    tributaryOf?: FactionId;
    /** Last time a player's party raided or plundered it. */
    raidedHour?: Hour;
    /** The last fate it met (§16.3) and by whom. */
    lastFate?: { fate: AftermathFate | 'raid'; hour: Hour; byFactionId: FactionId };
  }
  interface ArrivalPayload {
    options?: DecisionOption<ArrivalChoice>[];
    choices?: DecisionChoice[];
    /** The settlement belongs to the player's house. */
    own?: boolean;
  }
  interface AftermathPayload {
    approach?: 'raid' | 'assault';
    options?: DecisionOption<AftermathFate>[];
    choices?: DecisionChoice[];
  }
}

declare module '@sim/core/commands' {
  interface CommandMap {
    /** Answers the Arrival Card. Raid and assault start a battle (battle module); trade/enter open the hub. */
    resolveArrival: { choice: ArrivalChoice };
    /** Decides a taken settlement's fate (§16.3). Annexing needs a governor from the expedition. */
    chooseAftermath: { fate: AftermathFate; governorId?: CharId; garrison?: Record<string, number> };
    /** The Cargo screen (§16.2): take goods, burn them (Dread) or give them to the poor (Honor, Renown). */
    loadCargo: { take?: Partial<Record<GoodId, number>>; burn?: Partial<Record<GoodId, number>>; givePoor?: Partial<Record<GoodId, number>> };
    /** Mead-hall actions (§20.2): any news, travellers' talk, a drink, a round for the hall. */
    tavernAction: { settlementId: SettlementId; action: 'anyNews' | 'travellers' | 'drink' | 'buyRound' };
    /** Leaves the settlement hub or the Cargo screen (back to the map; ends the plunder window). */
    leaveSettlement: Record<never, never>;
  }
}

declare module '@sim/core/events' {
  interface EventMap {
    /** A settlement's fate after a raid or an assault (§16.3); no `byFactionId` = the player's deed. */
    SettlementFate: { settlementId: SettlementId; fate: AftermathFate | 'raid'; byFactionId?: FactionId; previousFactionId?: FactionId; clergy?: boolean };
    ArrivalResolved: { settlementId: SettlementId; choice: ArrivalChoice };
    SettlementEntered: { settlementId: SettlementId };
  }
}
