/**
 * Intel augmentations of the kernel types (ARCHITECTURE.md §4) and the intel module's public contracts
 * (design §20.4, §18.6, §31.19). Every augmented field is optional.
 *
 * STATE CONTRACT (`state.intel`, owned by intel; the client and the AI read it through ./query.ts):
 *   `state.intel['<observer>|<settlementId>']` = { observer, settlementId, facts: { <key>: IntelFact[] } }
 *   - observer: the faction that holds the knowledge (the player's faction, or an AI faction, §18.6);
 *   - each fact list holds the reports about one fact kind, NEWEST FIRST, at most
 *     `tunables.intel.maxReportsPerFact`; a newer report from the same source replaces the older one;
 *   - `IntelFact` = { value, source, reliability (0–1), hour (when it was TRUE, not when heard) }.
 *   Fact values: garrison { total, units: { <unitId>: n } }, fortTier n, armour n, weapons n, silver n,
 *   economy '<state>', leader { name, traits[] }, wars [factionIds], relicRumor { relicId?, siteId?, hint? },
 *   fleets { ships, fleets }.
 * Confidence and display: confidence = reliability × e^(−ageDays/90); High ≥ 0.7, Medium ≥ 0.4, Low,
 * Stale after 180 days; numbers are shown as value × (1 ± 0.5 × (1 − confidence)) (formulas.ts).
 */
import type { FactionId, Hour, IntelFactKey, JsonValue, SettlementId, SiteId } from '@sim/core/state';

/** Where a report came from (design §20.4 table; reliability per source in tunables.intel.sources). */
export type IntelSource = 'server' | 'keeper' | 'drunk' | 'merchant' | 'envoy' | 'scout' | 'ravenQuill' | 'sighting' | 'rumour' | 'spy' | 'mapHolder';

/** All `IntelSource` values. */
export const INTEL_SOURCES: readonly IntelSource[] = ['server', 'keeper', 'drunk', 'merchant', 'envoy', 'scout', 'ravenQuill', 'sighting', 'rumour', 'spy', 'mapHolder'];

/** Every fact kind of §20.4 (the core vocabulary), in display order. */
export const INTEL_FACT_KEYS: readonly IntelFactKey[] = ['garrison', 'fortTier', 'armour', 'weapons', 'silver', 'economy', 'leader', 'wars', 'relicRumor', 'fleets'];

/** Confidence label (§20.4). */
export type IntelLabel = 'high' | 'medium' | 'low' | 'stale';

/** A map the player's house holds (§20.5 step 2–3): it reveals a site. */
export interface HeldMap {
  siteId: SiteId;
  hour: Hour;
  /** Where it was bought or won (absent for maps from quests or relics). */
  fromSettlementId?: SettlementId;
  /** Silver paid (0 when won or given). */
  price: number;
}

declare module '@sim/core/state' {
  interface PlayerHouse {
    /** Maps held by the house, by site (intel module). */
    maps?: Record<SiteId, HeldMap>;
  }
}

declare module '@sim/core/commands' {
  interface CommandMap {
    /**
     * Buy a map from a map-holder (§20.5): pays `price` from the treasury, records the map in the house
     * and applies the quests module's `revealSite` effect (skipped while quests is absent). `settlementId`
     * is where the deal is struck (the ruler or the expedition must be there unless `remote`).
     */
    buyMap: { siteId: SiteId; settlementId: SettlementId; price: number; sellerId?: string };
  }
}

declare module '@sim/core/events' {
  interface EventMap {
    /** An observer learned facts about a settlement (player and AI alike; the client shows the player's). */
    IntelGained: { observer: FactionId; settlementId: SettlementId; keys: IntelFactKey[]; source: string; reliability: number };
    /** The player's house acquired a map that reveals a site. */
    MapAcquired: { siteId: SiteId; settlementId?: SettlementId; price: number };
  }
}

declare module '@sim/core/effects' {
  interface EffectMap {
    /**
     * Record reported facts (design §19.1 `addIntel`): `facts` maps fact kinds to the values reported.
     * Observer defaults to the player's faction; reliability defaults to the source's (tunables); `hour`
     * (when the facts were true) defaults to now.
     */
    addIntel: {
      settlementId: SettlementId;
      facts: Partial<Record<IntelFactKey, JsonValue>>;
      source: string;
      observer?: FactionId;
      reliability?: number;
      hour?: Hour;
    };
    /**
     * An observer learns the TRUTH about a settlement as a source of the given reliability sees it: the
     * current values of `keys` (default: every fact kind the source can see), numbers blurred by
     * `(1 − reliability) × tunables.intel.noise.scale` (module-owned op; scouts, servers, envoys, AI spies).
     */
    observeSettlement: {
      settlementId: SettlementId;
      source: string;
      observer?: FactionId;
      keys?: IntelFactKey[];
      reliability?: number;
    };
  }
}
