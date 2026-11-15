/**
 * 'news' simulation module (scheduler order 50).
 * Scope: news items and their propagation along the sea-lane and road network (§19.3, §31.19);
 * Hirdmaster dispatches; what mead-hall keepers know. The Chronicle itself is core (§19.4): news
 * adds an entry only when the player first hears an important item they did not witness.
 * Owns (src/sim/core/ownership.ts — implement exactly these; never another module's):
 *   effects: addNews
 *   events: NewsHeard
 *   state slices: news
 * Module-owned additions (not in ownership.ts; reported to the integrator):
 *   effects: hearNews
 *   events: NewsConfirmed
 *   condition fns: newsHeard, newsHeardCount, newsKnownAt
 *   state: GameState.newsIndex (active list, per-settlement known index, dedupe keys); NewsItem fields
 * Tunables: src/content/data/tunables/news.json (+ schemas/tunables/news.ts), read as ctx.tunables.news.
 * Strings/assets: src/content/locales/en/news.json and src/content/assets/manifest/news.json (prefix 'news.').
 * Gate: npm run verify:module -- news
 *
 * HOW IT WORKS
 *   - Items are made by reactions to other modules' domain events (reactions.ts) and by the
 *     `addNews` effect (storylets, quests, other modules). Each item starts known at its origin.
 *   - `daily`: the word spreads (propagate.ts) — delay = travelDays × (1.5 − 0.1 × importance),
 *     reach = 5 + 5 × importance travel-days, numbers drift ±10% per hop, copies more than
 *     `confirmHops` hops from the origin are rumours unless proclaimed or confirmed by a reliable source.
 *   - A copy reaching one of the player's holdings is a Hirdmaster dispatch: NewsHeard (+ a
 *     notification from `dispatch.minImportance`, a narration line and a Chronicle entry for the
 *     important ones).
 *   - `weekly`: items past their age (by importance) are pruned with their index entries.
 *   - Client queries: ./query.ts (keeperNews, newsKnownAt, playerNews, newsView); pure formulas: ./formulas.ts.
 */
import type { SimContext, SimModule, Reactions } from '@sim/core/module';
import type { GameState, NewsId } from '@sim/core/state';
import { NEWS_CONDITION_FNS } from './conditions';
import { NEWS_EFFECT_SCHEMAS, NEWS_EFFECTS } from './effects';
import { newsInvariants } from './invariants';
import { propagateNews } from './propagate';
import { NEWS_REACTIONS } from './reactions';
import { addKnown, emptyTransit, ensureNewsIndex, pruneNews } from './store';
import './types';

export type { NewsImportance, NewsIndexState, NewsSpec, NewsTransit, NewsVia, PlayerNewsCopy } from './types';
export { NEWS_VIAS } from './types';
export {
  copyDrift,
  copyHeardHour,
  copyHops,
  distortFacts,
  driftBounds,
  newsArrivalHour,
  newsDelayDays,
  newsDelayFactor,
  newsReachDays,
} from './formulas';
export { copyIndexAt, factionHasHeard, keeperNews, newsKnownAt, newsView, playerNews } from './query';
export type { NewsQueryContent, NewsQueryOptions, NewsView, PlayerNewsView } from './query';
export { createNews } from './store';

/**
 * Normalises the news slice: every item gets its propagation fields, and the known index and
 * active list are rebuilt from the items. Safe on a campaign already under way (module catch-up).
 */
export function normaliseNews(draft: GameState): void {
  const idx = ensureNewsIndex(draft);
  idx.known = {};
  const active: NewsId[] = [];
  for (const id of Object.keys(draft.news) as NewsId[]) {
    const item = draft.news[id];
    if (!item) continue;
    if (item.reachedIds.length === 0 || item.reachedIds[0] !== item.originId) item.reachedIds = [item.originId, ...item.reachedIds.filter((s) => s !== item.originId)];
    const n = item.reachedIds.length;
    if (!item.reachedDays || item.reachedDays.length !== n) item.reachedDays = item.reachedIds.map(() => 0);
    if (!item.reachedFrom || item.reachedFrom.length !== n) item.reachedFrom = item.reachedIds.map((_, i) => (i === 0 ? -1 : 0));
    if (item.expanded === undefined || item.expanded > n) item.expanded = n;
    if (!item.transit) item.transit = emptyTransit();
    for (const s of item.reachedIds) addKnown(idx, s, id);
    if (item.expanded < n || item.transit.to.length > 0) active.push(id);
  }
  idx.active = active;
  for (const [key, id] of Object.entries(idx.dedupe)) if (!Object.hasOwn(draft.news, id)) delete idx.dedupe[key];
}

export const module: SimModule = {
  id: 'news',
  order: 50,
  version: 1,
  init(draft) {
    normaliseNews(draft);
  },
  migrate(draft) {
    normaliseNews(draft);
  },
  systems: {
    daily: propagateNews,
    weekly(draft: GameState, ctx: SimContext) {
      pruneNews(draft, ctx);
    },
  },
  effects: NEWS_EFFECTS,
  effectSchemas: NEWS_EFFECT_SCHEMAS,
  // Foreign events are read defensively by name (reactions.ts), so their owners' payload types are not needed.
  reactions: NEWS_REACTIONS as unknown as Reactions,
  conditionFns: NEWS_CONDITION_FNS,
  invariants: (state) => newsInvariants(state),
};
