/**
 * Read-only news queries for the client (tavern "Any news?", the news log, dispatch cards) and for
 * tools. Pure: they read a frozen state (or a draft) and content, never mutate. Pass `getContent()`
 * on the client, or the SimContext inside the simulation.
 *
 *   keeperNews(state, 'set_12', content)      // what the keeper at set_12 can tell, best first
 *   newsKnownAt(state, 'set_12', content, { kind: 'battle' })
 *   playerNews(state, content)                // what the player has heard, newest first
 */
import type { Balance } from '@content/schemas/balance';
import type { Tunables as NewsTunables } from '@content/schemas/tunables/news';
import type { FactionId, GameState, Hour, JsonValue, NewsId, NewsItem, SettlementId, TextVars } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { copyDrift, copyHeardHour, copyHops, distortFacts } from './formulas';
import { copyTextVars, exactKeysOf, GENERIC_NEWS_KEY, isRumourCopy } from './store';
import type { NewsImportance, NewsVia } from './types';

/** The content a query needs (the client's `getContent()` and the sim's ctx both fit). */
export interface NewsQueryContent {
  readonly balance: Balance;
  readonly tunables: { readonly news: NewsTunables };
}

/** One copy of a news item as told at a place (numbers already drifted). */
export interface NewsView {
  id: NewsId;
  kind: string;
  importance: NewsImportance;
  /** Where it happened. */
  originId: SettlementId;
  /** Where this copy is known. */
  settlementId: SettlementId;
  /** Index of the copy in `reachedIds`. */
  copy: number;
  /** When it happened. */
  hour: Hour;
  /** When the word reached `settlementId`. */
  heardHour: Hour;
  /** Days since it happened (at `asOfHour`). */
  ageDays: number;
  hops: number;
  /** Product of the per-hop drifts applied to this copy's numbers. */
  drift: number;
  rumour: boolean;
  textKey: string;
  /** ICU vars for `textKey` (drifted primitive facts). */
  vars: TextVars;
  /** All facts as told here (drifted). */
  facts: Record<string, JsonValue>;
  refs: string[];
  factionIds: FactionId[];
}

/** Filters for newsKnownAt. */
export interface NewsQueryOptions {
  /** Default: state.time.hour. */
  asOfHour?: Hour;
  minImportance?: number;
  /** Items older than this many days are left out. */
  maxAgeDays?: number;
  kind?: string;
  limit?: number;
  /** How the copy is being told (affects the rumour flag; default 'keeper'). */
  via?: NewsVia;
}

/** Index of the copy of `item` known at `settlementId`, or −1. */
export function copyIndexAt(item: Pick<NewsItem, 'reachedIds'>, settlementId: SettlementId): number {
  return item.reachedIds.indexOf(settlementId);
}

/** The view of copy `copy` of an item. */
export function newsView(item: NewsItem, copy: number, content: NewsQueryContent, asOfHour: Hour, via: NewsVia = 'keeper'): NewsView {
  const ctx = { tunables: content.tunables } as const;
  const exact = exactKeysOf(ctx, item);
  const drift = copyDrift(item, copy);
  return {
    id: item.id,
    kind: item.kind,
    importance: item.importance,
    originId: item.originId,
    settlementId: item.reachedIds[copy] ?? item.originId,
    copy,
    hour: item.hour,
    heardHour: copyHeardHour(item, copy, content.balance.intel.news),
    ageDays: Math.max(0, (asOfHour - item.hour) / HOURS_PER_DAY),
    hops: copyHops(item, copy),
    drift,
    rumour: isRumourCopy(ctx, item, copy, via),
    textKey: item.textKey ?? GENERIC_NEWS_KEY,
    vars: copyTextVars(item, copy, exact),
    facts: distortFacts(item.facts, drift, exact),
    refs: [...(item.refs ?? [])],
    factionIds: [...(item.factionIds ?? [])],
  };
}

function byImportanceThenRecent(a: NewsView, b: NewsView): number {
  return b.importance - a.importance || b.hour - a.hour || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * The items known at a settlement (the per-settlement index), as told there: most important first,
 * then most recent. Copies whose arrival lies after `asOfHour` are left out.
 */
export function newsKnownAt(state: GameState, settlementId: SettlementId, content: NewsQueryContent, opts: NewsQueryOptions = {}): NewsView[] {
  const idx = state.newsIndex;
  const ids = idx && Object.hasOwn(idx.known, settlementId) ? (idx.known[settlementId] ?? []) : [];
  const asOf = opts.asOfHour ?? state.time.hour;
  const out: NewsView[] = [];
  for (const id of ids) {
    const item = Object.hasOwn(state.news, id) ? state.news[id] : undefined;
    if (!item) continue;
    if (opts.kind !== undefined && item.kind !== opts.kind) continue;
    if (opts.minImportance !== undefined && item.importance < opts.minImportance) continue;
    if (opts.maxAgeDays !== undefined && (asOf - item.hour) / HOURS_PER_DAY > opts.maxAgeDays) continue;
    const copy = copyIndexAt(item, settlementId);
    if (copy < 0) continue;
    const view = newsView(item, copy, content, asOf, opts.via ?? 'keeper');
    if (view.heardHour > asOf) continue;
    out.push(view);
  }
  out.sort(byImportanceThenRecent);
  return opts.limit !== undefined ? out.slice(0, Math.max(0, opts.limit)) : out;
}

/** What the mead-hall keeper at a settlement tells when asked "Any news?" (§20.2). */
export function keeperNews(state: GameState, settlementId: SettlementId, content: NewsQueryContent, opts: Omit<NewsQueryOptions, 'via'> = {}): NewsView[] {
  const k = content.tunables.news.keeper;
  return newsKnownAt(state, settlementId, content, { maxAgeDays: k.memoryDays, limit: k.maxItems, ...opts, via: 'keeper' });
}

/** A news item the player has heard, with the copy they know. */
export interface PlayerNewsView extends NewsView {
  heardByPlayerHour: Hour;
  via: NewsVia;
  /** False while it is still a rumour for the player. */
  confirmed: boolean;
  /** True when the player's own house took part (they witnessed it). */
  witnessed: boolean;
}

/** Everything the player has heard (newest first), optionally only since `sinceHour`. */
export function playerNews(state: GameState, content: NewsQueryContent, opts: { sinceHour?: Hour; limit?: number; includeWitnessed?: boolean } = {}): PlayerNewsView[] {
  const asOf = state.time.hour;
  const out: PlayerNewsView[] = [];
  for (const item of Object.values(state.news)) {
    const heard = item.playerHeard;
    if (!heard) continue;
    if (opts.sinceHour !== undefined && heard.hour < opts.sinceHour) continue;
    const witnessed = heard.via === 'witness';
    if (witnessed && opts.includeWitnessed === false) continue;
    const view = newsView(item, heard.copy, content, asOf, heard.via);
    out.push({ ...view, rumour: !heard.confirmed, heardByPlayerHour: heard.hour, via: heard.via, confirmed: heard.confirmed, witnessed });
  }
  out.sort((a, b) => b.heardByPlayerHour - a.heardByPlayerHour || byImportanceThenRecent(a, b));
  return opts.limit !== undefined ? out.slice(0, Math.max(0, opts.limit)) : out;
}

/** True if word of `newsId` has reached any holding of `factionId` (AI knowledge, §18.6). */
export function factionHasHeard(state: GameState, factionId: FactionId, newsId: NewsId): boolean {
  const item = Object.hasOwn(state.news, newsId) ? state.news[newsId] : undefined;
  const faction = state.factions[factionId];
  if (!item || !faction) return false;
  if (item.factionIds?.includes(factionId)) return true;
  for (const s of faction.holdingIds) if (item.reachedIds.includes(s)) return true;
  return false;
}
