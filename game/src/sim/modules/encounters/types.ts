/**
 * Encounters augmentations of the kernel types (ARCHITECTURE.md §4) and the module's public contracts
 * (design §8.6, §8.7 land encounters, §15.1, §31.4).
 *
 * The `encounter` decision carries everything the shell's generic decision modal renders (`titleKey`,
 * `key` + `vars`, `choices`), plus the numbers drawn when the encounter was sighted (sizes, pride, deals)
 * so the options and their odds are the same when the player answers.
 */
import type { Command } from '@sim/core/commands';
import type { ArmyId, CharId, FactionId, FleetId, GoodId, Hour, ShipTypeId, TextVars, UnitTypeId } from '@sim/core/state';

/** What was sighted. Sea: merchant, patrol, raiders, warfleet. Land: outlaws, landPatrol. */
export type EncounterKind = 'merchant' | 'patrol' | 'raiders' | 'warfleet' | 'outlaws' | 'landPatrol';
export const SEA_KINDS: readonly EncounterKind[] = ['merchant', 'patrol', 'raiders', 'warfleet'];
export const LAND_KINDS: readonly EncounterKind[] = ['outlaws', 'landPatrol'];

/** 'sighted': the first card. 'caught': they ran us down (sea) or sprang an ambush (land). */
export type EncounterStage = 'sighted' | 'caught';

/** The options of an encounter card (§8.6, §15.1). */
export type EncounterChoice = 'hail' | 'trade' | 'payToll' | 'demandToll' | 'attack' | 'evade' | 'flee' | 'pass' | 'yield' | 'fight' | 'slipAway' | 'fallBack';
export const ENCOUNTER_CHOICES: readonly EncounterChoice[] = ['hail', 'trade', 'payToll', 'demandToll', 'attack', 'evade', 'flee', 'pass', 'yield', 'fight', 'slipAway', 'fallBack'];

/** A ship of the other party (virtual ships for encounters without a real fleet). */
export interface EncounterShip {
  type: ShipTypeId;
  crew: number;
}

/** The small deal a merchant offers (§15.1 Trade), fixed when they are sighted. */
export type TradeDeal = { kind: 'sell'; good: GoodId; tons: number; silver: number } | { kind: 'buy'; rations: number; silver: number };

/** How a toll would be paid: silver from the ships, the rest in provisions. */
export interface TollPayment {
  silver: number;
  rations: number;
}

/** One option as computed for the card (pure; recomputed when the player answers). */
export interface EncounterOption {
  id: EncounterChoice;
  available: boolean;
  /** Why it is unavailable (`encounters.reason.<code>`). */
  reason?: string;
  /** Success chance 0..1 for risky options (evade, flee: the chance they catch you, demandToll, attack). */
  chance?: number;
  /** The companion whose skill counts (named on the button). */
  whoId?: CharId;
  /** Numbers for the label and preview (silver, tons, rations …). */
  vars?: TextVars;
}

/** A command button of the shell's generic decision modal. */
export interface EncounterDecisionChoice {
  id: string;
  labelKey: string;
  vars?: TextVars;
  command: Command;
  tone?: 'primary' | 'danger' | 'secondary';
  disabled?: boolean;
  previewKey?: string;
}

/** The other party, as drawn when sighted. */
export interface EncounterParty {
  /** Their lord (absent for outlaws: a nameless band). */
  factionId?: FactionId;
  /** A real fleet in sight (AI fleets, §8.6 visible encounters). */
  fleetId?: FleetId;
  ships: EncounterShip[];
  /** Fighting men per unit type. */
  men: Record<UnitTypeId, number>;
  silver: number;
  cargo: Partial<Record<GoodId, number>>;
  armourTier: number;
  weaponTier: number;
  morale: number;
  seafaring: number;
  wildcraft: number;
  /** Their speed in knots (sea). */
  kn: number;
  /** Toll pride (§31.4, 0..prideMax). */
  pride: number;
}

/** Fields the encounters module adds to the core `encounter` payload. */
export interface EncounterPayloadExt {
  encounterId: string;
  kind: EncounterKind;
  stage: EncounterStage;
  domain: 'sea' | 'land';
  /** The land party (land encounters). */
  armyId?: ArmyId;
  zoneId?: string | null;
  /** They mean us harm (raiders, outlaws, enemies at war): a failed evasion lets them close. */
  aggressive: boolean;
  atWar: boolean;
  party: EncounterParty;
  deal?: TradeDeal;
  toll: TollPayment;
  /** Text variant index (1-based) of `key`. */
  variant: number;
  /** The option the headless runner (and a careful player) takes: always safe. */
  defaultChoice: EncounterChoice;
  titleKey: string;
  key: string;
  vars: TextVars;
  options: EncounterOption[];
  choices: EncounterDecisionChoice[];
}

/** A fight this module started, waiting for its BattleEnded / SeaBattleEnded. */
export interface EncounterFight {
  kind: EncounterKind;
  domain: 'sea' | 'land';
  factionId?: FactionId;
  /** The other party's wealth when they were virtual ships (plunder on victory). */
  plunderSilver: number;
  plunderGoods: Partial<Record<GoodId, number>>;
  /** Our fleet (plunder goes here). */
  fleetId: FleetId;
  /** We struck first at people who meant no harm. */
  unprovoked: boolean;
  hour: Hour;
}

/** The module's root slice. */
export interface EncountersState {
  version: number;
  /** Encounters raised so far (also the source of `enc_` numbers in tests). */
  count: number;
  /** No new encounter for this fleet / army before this hour. */
  quietUntil: Record<string, Hour>;
  /** Real fleets already met → hour (they are not met again for `realFleets.cooldownDays`). */
  met: Record<string, Hour>;
  /** Fights started from an encounter: encounter id → what to settle after the battle. */
  fights: Record<string, EncounterFight>;
}

declare module '@sim/core/state' {
  interface GameState {
    encounters?: EncountersState;
  }
  interface EncounterPayload extends Partial<EncounterPayloadExt> {}
}

declare module '@sim/core/commands' {
  interface CommandMap {
    /** Answers the pending encounter card. */
    resolveEncounter: { choice: EncounterChoice };
  }
}

declare module '@sim/core/events' {
  interface EventMap {
    /** Something was sighted at sea or on the march; the card is pending. */
    EncounterSighted: { encounterId: string; kind: EncounterKind; stage: EncounterStage; domain: 'sea' | 'land'; fleetId: FleetId; armyId?: ArmyId; factionId?: FactionId; aggressive: boolean };
    /** The player answered an encounter card. */
    EncounterResolved: { encounterId: string; kind: EncounterKind; choice: EncounterChoice; outcome: string; factionId?: FactionId };
  }
}

declare module '@sim/core/ids' {
  interface IdPrefixMap {
    enc: `enc_${string}`;
  }
}
