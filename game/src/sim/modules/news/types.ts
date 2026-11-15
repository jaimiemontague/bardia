/**
 * News augmentations of the kernel types (ARCHITECTURE.md §4) and the news module's public
 * contracts (design §19.3, §31.19). Every augmented field is optional: core factories, old saves and
 * other modules' tests build these objects without knowing about them.
 *
 * STATE CONTRACT (what other modules and the client may read):
 *   - `state.news[id]` — one news item. Core fields: `kind`, `originId` (where it happened), `hour`
 *     (when), `importance` 1–5, `facts` (names and numbers; the TRUE values), `reachedIds`
 *     (settlements the word has reached, in arrival order; `reachedIds[0]` is the origin),
 *     `distortion` (± drift per hop, e.g. 0.1).
 *     News fields: `reachedDays[i]` (travel-days from the origin to copy i), `reachedFrom[i]` (index of
 *     the copy it was heard from; −1 for the origin), `transit` (the word on the road: arrivals
 *     scheduled but not yet heard), `playerHeard` (the copy the player knows), `confirmed`
 *     (proclaimed: never a rumour), `textKey`/`refs`/`factionIds` for the UI.
 *   - `state.newsIndex.known[settlementId]` — ids of the items known at a settlement (arrival order),
 *     i.e. what its mead-hall keeper can tell (§20.2 "Any news?").
 * The copy at a settlement carries numbers drifted ±distortion per hop; read it through the pure
 * helpers in ./query.ts (newsView, newsKnownAt, keeperNews, playerNews) instead of re-deriving it.
 */
import type { FactionId, Hour, JsonValue, MapPos, NewsId, SettlementId } from '@sim/core/state';

/** How the player came to hear an item. */
export type NewsVia = 'witness' | 'dispatch' | 'keeper' | 'envoy' | 'merchant';

/** All `NewsVia` values (for schemas and tests). */
export const NEWS_VIAS: readonly NewsVia[] = ['witness', 'dispatch', 'keeper', 'envoy', 'merchant'];

/** News items' importance (design §19.3). */
export type NewsImportance = 1 | 2 | 3 | 4 | 5;

/**
 * The word on the road: arrivals computed but not yet heard, as parallel arrays (cheap through an
 * Immer draft). Entry k: the word reaches `to[k]` at `at[k]`, `days[k]` travel-days from the origin,
 * carried from copy `from[k]` (an index into `reachedIds`).
 */
export interface NewsTransit {
  to: SettlementId[];
  at: Hour[];
  days: number[];
  from: number[];
}

/** The copy of an item the player knows (the best one heard so far). */
export interface PlayerNewsCopy {
  /** Hour the player heard it. */
  hour: Hour;
  /** Index into `reachedIds` of the copy heard (0 = the origin's own, undistorted account). */
  copy: number;
  via: NewsVia;
  /** True once a reliable source has confirmed it (no longer a rumour for the player). */
  confirmed: boolean;
}

/** The news module's bookkeeping slice. */
export interface NewsIndexState {
  /** Items still spreading (unexpanded copies or arrivals on the road), in creation order. */
  active: NewsId[];
  /** Settlement → ids of the items known there, in arrival order (the keeper's knowledge). */
  known: Record<SettlementId, NewsId[]>;
  /** dedupeKey → item (so one event reported twice makes one item). */
  dedupe: Record<string, NewsId>;
}

/** What `createNews` / the `addNews` effect need to make an item. */
export interface NewsSpec {
  kind: string;
  /** Where it happened. Either this or `pos` is required. */
  originId?: SettlementId;
  /** A map position (cells); the nearest settlement becomes the origin. */
  pos?: MapPos;
  importance?: number;
  facts?: Record<string, JsonValue>;
  textKey?: string;
  refs?: string[];
  factionIds?: FactionId[];
  /** When it happened (default now; may lie in the past, never in the future). */
  hour?: Hour;
  /** Drift per hop (default balance.intel.news.distortionPerHop). */
  distortion?: number;
  /** Proclaimed news (a coronation, a pact sworn before witnesses): never a rumour. */
  confirmed?: boolean;
  /** Numeric facts that never drift (in addition to tunables.news.exactFactKeys). */
  exactFacts?: string[];
  /** One item per key: a second spec with the same key is ignored while the first item lives. */
  dedupeKey?: string;
}

declare module '@sim/core/state' {
  interface NewsItem {
    /** Locale key of the headline (default `news.item.<kind>`); its ICU vars are the item's facts. */
    textKey?: string;
    /** Entity ids the UI may link to (settlements, factions, characters …). */
    refs?: string[];
    /** Factions involved (the player's faction here means the player witnessed it). */
    factionIds?: FactionId[];
    /** Per-item seed for the deterministic per-hop drift. */
    seed?: number;
    /** Travel-days from the origin to each copy (parallel to `reachedIds`). */
    reachedDays?: number[];
    /** Index of the copy each copy was heard from (parallel to `reachedIds`; −1 for the origin). */
    reachedFrom?: number[];
    /** Copies whose onward roads have been walked (`reachedIds[0 .. expanded-1]`). */
    expanded?: number;
    /** Arrivals on the road. */
    transit?: NewsTransit;
    /** Earliest arrival hour on the road (absent when nothing is on the road): idle items cost O(1). */
    nextAt?: Hour;
    /** Maximum travel-days from the origin (design: 5 + 5 × importance). */
    reachDays?: number;
    /** Proclaimed: never a rumour. */
    confirmed?: boolean;
    /** Numeric facts that never drift. */
    exactFacts?: string[];
    /** The copy the player knows, once heard. */
    playerHeard?: PlayerNewsCopy;
    dedupeKey?: string;
  }
  interface GameState {
    /** News bookkeeping: spreading items and the per-settlement known-news index. */
    newsIndex?: NewsIndexState;
  }
}

declare module '@sim/core/events' {
  interface EventMap {
    /**
     * The player learned of a news item for the first time: a Hirdmaster's messenger brought it
     * from one of the player's holdings ('dispatch'), or a keeper, envoy or merchant told it.
     */
    NewsHeard: {
      newsId: NewsId;
      kind: string;
      importance: NewsImportance;
      originId: SettlementId;
      /** Where the player heard it (the holding, tavern or the source's home). */
      settlementId: SettlementId;
      via: NewsVia;
      /** Hops between the origin and the copy heard. */
      hops: number;
      rumour: boolean;
    };
    /** A rumour the player had heard was confirmed by a reliable source. */
    NewsConfirmed: { newsId: NewsId; kind: string; via: NewsVia; settlementId: SettlementId };
  }
}

declare module '@sim/core/effects' {
  interface EffectMap {
    /**
     * Create a news item (design §19.1 `addNews`). Origin: `originId`, or the settlement nearest to
     * `pos`. Importance defaults to the kind's (tunables.news.kinds) or 2.
     */
    addNews: {
      kind: string;
      originId?: SettlementId;
      pos?: MapPos;
      importance?: number;
      facts?: Record<string, JsonValue>;
      textKey?: string;
      refs?: string[];
      factionIds?: FactionId[];
      hour?: Hour;
      distortion?: number;
      confirmed?: boolean;
      exactFacts?: string[];
      dedupeKey?: string;
    };
    /**
     * The player hears the news known at a settlement (a keeper's "Any news?", an envoy from that
     * court, a merchant from that port): marks the items heard and emits NewsHeard for each new one.
     */
    hearNews: {
      settlementId: SettlementId;
      via?: Exclude<NewsVia, 'witness' | 'dispatch'>;
      /** At most this many items (default: tunables.news.keeper.maxItems), most important first. */
      maxItems?: number;
      minImportance?: number;
    };
  }
}
