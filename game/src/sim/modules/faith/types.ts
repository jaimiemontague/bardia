/**
 * Faith augmentations of the kernel types (ARCHITECTURE.md §4) and the faith module's public
 * contracts. Every augmented field is optional: core factories, old saves and other modules' tests
 * build these objects without knowing about them.
 *
 * What other modules read (state contract):
 *   - `state.player.house.omens[activity]`  the player's current omen per activity (check `untilHour`);
 *   - `state.factions[id].omens[activity]`  an AI faction's omens (re-read every month);
 *   - `state.factions[id].favor[god]`       an Old Ways AI faction's Favor;
 *   - `state.player.house.chapels`          holdings with a Lantern chapel;
 *   - `state.player.house.convertedHour`    set once the house has adopted the Lantern;
 *   - `state.faith.conversion.resentment`   remaining traditionalist resentment per holding (§17.7).
 * Omen modifiers: `balance.omens.modifiers[omen]` + `tunables.faith.omens.extraModifiers[activity][omen]`.
 */
import type { OfferingKind, OfferingSize, OmenActivity } from '@content/schemas/tunables/faith';
import type { FactionId, FaithId, GodId, Hour, OmenId, SettlementId } from '@sim/core/state';

export type { OfferingKind, OfferingSize, OmenActivity } from '@content/schemas/tunables/faith';

/** One omen reading (rune-seer for the Old Ways, priests' signs for the Lantern). */
export interface OmenReading {
  omen: OmenId;
  /** The final §22.6 omen score (before a Lucky/Ill-Omened step). */
  score: number;
  readHour: Hour;
  /** The reading is in force while `state.time.hour < untilHour`. */
  untilHour: Hour;
  /** Where it was read (absent for AI readings). */
  settlementId?: SettlementId;
  /** True when Lantern priests gave signs instead of a rune-seer reading. */
  signs?: boolean;
}

export type OmenReadings = Partial<Record<OmenActivity, OmenReading>>;

/** Per-faction bookkeeping keyed by absolute month index (lazy monthly reset). */
export interface MonthCounter {
  month: number;
  counts: Record<string, number>;
}

/** Progress of the house's conversion to the Lantern (§17.7). */
export interface ConversionState {
  hour: Hour;
  fromFaith: FaithId;
  /** Holding → share of its folk that has converted (0–1). Removed once the holding's faith flips. */
  shares: Record<SettlementId, number>;
  /** Holding → resentment points left (fades linearly to 0 over `resentmentYears`). */
  resentment: Record<SettlementId, number>;
}

/** The faith module's root slice (bookkeeping only; player-visible values live on the house). */
export interface FaithState {
  /** Offerings per faction this month: god → count. */
  offerings: Record<FactionId, MonthCounter>;
  /** Alms per faction this month (key 'alms'). */
  alms: Record<FactionId, MonthCounter>;
  /** Deeds per faction this month: deed key → count (for `maxPerMonth`). */
  deeds: Record<FactionId, MonthCounter>;
  /** Faction → god → absolute month index in which that god's Favor last rose (neglect rule). */
  tended: Record<FactionId, Partial<Record<GodId, number>>>;
  /** Absolute month index in which the player's Piety last rose. */
  pietyTendedMonth?: number;
  /** Seer/priest (settlement) → hour of the last reading there (once per month per seer). */
  seerReadHour: Record<SettlementId, Hour>;
  /** Faith Wrath threshold level last announced (0 = none, 1 sermons, 2 muster, 3 ban). */
  wrathLevel: number;
  /** Hour of the house's last trade/visit/envoy contact with the Lantern (Missionary trigger). */
  lanternContactHour?: Hour;
  conversion?: ConversionState;
}

/** Faith Wrath threshold levels (§4.4). */
export type FaithWrathLevel = 'sermons' | 'muster' | 'ban';

/** A deed's applied result (returned by the deed rules, carried by FaithDeed events). */
export interface DeedOutcome {
  favor: Partial<Record<GodId, number>>;
  piety: number;
}

declare module '@sim/core/state' {
  interface PlayerHouse {
    /** Current omens per activity (Old Ways seer or Lantern signs). */
    omens?: OmenReadings;
    /** Holdings with a Lantern chapel (the Missionary "Welcome" choice builds the first). */
    chapels?: SettlementId[];
    /** Hour the house adopted the Lantern. */
    convertedHour?: Hour;
  }
  interface Faction {
    /** Old Ways AI factions: Favor per god (same range as the player's). */
    favor?: Record<GodId, number>;
    /** AI factions' omens, re-read every month. */
    omens?: OmenReadings;
  }
  interface GameState {
    faith?: FaithState;
  }
}

declare module '@sim/core/commands' {
  interface CommandMap {
    /** Offer silver or livestock to one god at a grove (the ruler must be at a holding with a grove, or a temple-stead). */
    sacrifice: { god: GodId; kind: OfferingKind; size: OfferingSize; settlementId?: SettlementId };
    /** Consult the rune-seer (or, for a Lantern house, the priests): omens for every activity. */
    readOmen: { settlementId?: SettlementId };
    /** Adopt the Lantern (§17.7): needs a chapel and Lantern opinion ≥ the threshold. */
    convertHouse: Record<never, never>;
    /** Lantern houses: give alms at a church or chapel (Piety). */
    giveAlms: { size: OfferingSize; settlementId?: SettlementId };
    /** Lantern houses: found a chapel in one of your holdings (Piety; faster conversion there). */
    foundChapel: { settlementId: SettlementId };
  }
}

declare module '@sim/core/events' {
  interface EventMap {
    /** The player consulted a seer (or priests): the new readings. */
    OmenRead: {
      factionId: FactionId;
      settlementId: SettlementId;
      signs: boolean;
      readings: Partial<Record<OmenActivity, { omen: OmenId; score: number }>>;
    };
    /** An offering was made at a grove. */
    OfferingMade: {
      factionId: FactionId;
      god: GodId;
      kind: OfferingKind;
      size: OfferingSize;
      gain: number;
      /** 1 for the first offering to this god this month. */
      nth: number;
      settlementId?: SettlementId;
    };
    /** Alms were given (Lantern houses). */
    AlmsGiven: { factionId: FactionId; size: OfferingSize; piety: number; nth: number; settlementId: SettlementId };
    /** A deed moved a house's Favor or Piety. */
    FaithDeed: { factionId: FactionId; deed: string; favor: Partial<Record<GodId, number>>; piety: number };
    /** Faith Wrath crossed a threshold upward (§4.4: 30 sermons, 60 Lantern Muster, 90 Ban of the Flame). */
    FaithWrathRose: { level: FaithWrathLevel; threshold: number; value: number };
    /** Faith Wrath fell back below a threshold. */
    FaithWrathFell: { level: FaithWrathLevel; threshold: number; value: number };
    /** The player's house adopted a new faith (§17.7). */
    HouseConverted: { factionId: FactionId; fromFaith: FaithId; faith: FaithId };
    /** A holding's folk turned to the house's faith. */
    HoldingConverted: { settlementId: SettlementId; fromFaith: FaithId; faith: FaithId };
    /** A Lantern chapel was built in a holding. */
    ChapelBuilt: { settlementId: SettlementId };
  }
}

declare module '@sim/core/effects' {
  interface EffectMap {
    /** Apply a deed's Favor/Piety rule (tunables.faith.deeds) to a house (default: the player's). */
    faithDeed: { deed: string; factionId?: FactionId; god?: GodId; scale?: number };
    /** Change the player's Faith Wrath (clamped; threshold events). */
    changeFaithWrath: { amount: number };
    /** Change the player's Piety (clamped). */
    changePiety: { amount: number };
    /** Build a Lantern chapel in a player holding (default: the capital). */
    buildChapel: { settlementId?: SettlementId };
  }
}
