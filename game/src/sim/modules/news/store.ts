/**
 * The news store: creating items, recording copies as the word arrives, the per-settlement
 * known-news index, the player's hearing of items (Hirdmaster dispatches, keepers, envoys,
 * merchants) and pruning. All writes go through the draft; scans of the whole table use baseState.
 */
import type { Tunables as NewsTunables } from '@content/schemas/tunables/news';
import { EffectError } from '@sim/core/effects';
import { baseState } from '@sim/core/context';
import { isSafeRecordKey } from '@sim/core/keys';
import type { SimContext } from '@sim/core/module';
import type { FactionId, GameState, JsonValue, MapPos, NewsId, NewsItem, NotificationPriority, SettlementId, TextVars } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { copyDrift, copyHops, distortFacts, maxAgeDays, newsReachDays, toImportance } from './formulas';
import type { NewsIndexState, NewsSpec, NewsTransit, NewsVia } from './types';
import './types';

/** Anything carrying the news tunables (a SimContext, the client's content). */
export interface NewsTunablesHost {
  readonly tunables: { readonly news: NewsTunables };
}

/** Locale key of the headline used when a kind has no string of its own. */
export const GENERIC_NEWS_KEY = 'news.item.generic';
/** Locale key of the Hirdmaster's narration when an important dispatch arrives. */
export const DISPATCH_NARRATION_KEY = 'news.dispatch.messenger';

/** An empty transit list. */
export function emptyTransit(): NewsTransit {
  return { to: [], at: [], days: [], from: [] };
}

/** The news bookkeeping slice, created on first use. */
export function ensureNewsIndex(draft: GameState): NewsIndexState {
  if (!draft.newsIndex) draft.newsIndex = { active: [], known: {}, dedupe: {} };
  const idx = draft.newsIndex;
  if (!idx.active) idx.active = [];
  if (!idx.known) idx.known = {};
  if (!idx.dedupe) idx.dedupe = {};
  return idx;
}

/** Adds an item id to a settlement's known list. */
export function addKnown(idx: NewsIndexState, settlementId: SettlementId, id: NewsId): void {
  const list = Object.hasOwn(idx.known, settlementId) ? idx.known[settlementId] : undefined;
  if (list) list.push(id);
  else idx.known[settlementId] = [id];
}

function removeKnown(idx: NewsIndexState, settlementId: SettlementId, id: NewsId): void {
  const list = Object.hasOwn(idx.known, settlementId) ? idx.known[settlementId] : undefined;
  if (!list) return;
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  if (list.length === 0) delete idx.known[settlementId];
}

/** The settlement nearest to a map position (scan of the table as the operation began), if any. */
export function nearestSettlement(state: GameState, pos: MapPos): SettlementId | undefined {
  const table = baseState(state.settlements);
  let best: SettlementId | undefined;
  let bestD = Infinity;
  for (const id of Object.keys(table)) {
    const s = table[id as SettlementId];
    if (!s?.mapPos) continue;
    const dx = s.mapPos.x - pos.x;
    const dy = s.mapPos.y - pos.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = id as SettlementId;
    }
  }
  if (best === undefined) {
    // Settlements created in this operation are invisible to baseState; fall back to the draft.
    for (const [id, s] of Object.entries(state.settlements)) {
      const dx = s.mapPos.x - pos.x;
      const dy = s.mapPos.y - pos.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = id as SettlementId;
      }
    }
  }
  return best;
}

/** True if `settlementId` is one of the player's holdings. */
export function isPlayerHolding(state: GameState, settlementId: SettlementId): boolean {
  const faction = state.factions[state.player.factionId];
  return faction !== undefined && faction.holdingIds.includes(settlementId);
}

/** Lookup of the player's holdings (one read of the faction's holding list). */
export function playerHoldingLookup(state: GameState): Record<string, true> {
  const out: Record<string, true> = {};
  const faction = state.factions[state.player.factionId];
  if (faction) for (const id of faction.holdingIds) out[id] = true;
  return out;
}

function cloneFacts(facts: Readonly<Record<string, JsonValue>> | undefined): Record<string, JsonValue> {
  return facts ? (JSON.parse(JSON.stringify(facts)) as Record<string, JsonValue>) : {};
}

/** Headline key for a kind (the kind's own `news.item.<kind>` when the kind is known, else generic). */
export function headlineKey(ctx: SimContext, kind: string, override?: string): string {
  if (override !== undefined && override.length > 0) return override;
  return Object.hasOwn(ctx.tunables.news.kinds, kind) ? `news.item.${kind}` : GENERIC_NEWS_KEY;
}

/**
 * Creates a news item and records the origin's own copy. Returns its id, or undefined when the
 * importance is below `tunables.news.minImportance` or the dedupe key is taken. Throws EffectError
 * when no origin can be found.
 */
export function createNews(draft: GameState, ctx: SimContext, spec: NewsSpec): NewsId | undefined {
  const t = ctx.tunables.news;
  const b = ctx.balance.intel.news;
  if (typeof spec.kind !== 'string' || spec.kind.length === 0) throw new EffectError('addNews: kind is required');
  const kindDef = Object.hasOwn(t.kinds, spec.kind) ? t.kinds[spec.kind] : undefined;
  const importance = toImportance(spec.importance ?? kindDef?.importance ?? 2);
  if (importance < t.minImportance) return undefined;
  let originId: SettlementId | undefined;
  if (spec.originId !== undefined) {
    if (!Object.hasOwn(draft.settlements, spec.originId)) throw new EffectError(`addNews: unknown settlement ${spec.originId}`);
    originId = spec.originId;
  } else if (spec.pos !== undefined) originId = nearestSettlement(draft, spec.pos);
  if (originId === undefined) throw new EffectError('addNews: needs originId or pos (and at least one settlement)');
  const idx = ensureNewsIndex(draft);
  const dedupeKey = spec.dedupeKey !== undefined && isSafeRecordKey(spec.dedupeKey) ? spec.dedupeKey : undefined;
  if (dedupeKey !== undefined && Object.hasOwn(idx.dedupe, dedupeKey)) {
    const existing = idx.dedupe[dedupeKey] as NewsId;
    if (Object.hasOwn(draft.news, existing)) return undefined;
    delete idx.dedupe[dedupeKey];
  }
  const now = draft.time.hour;
  const hour = spec.hour !== undefined && Number.isFinite(spec.hour) ? Math.max(0, Math.min(now, Math.round(spec.hour))) : now;
  const distortion = spec.distortion !== undefined && Number.isFinite(spec.distortion) ? Math.max(0, Math.min(0.95, spec.distortion)) : b.distortionPerHop;
  const id = ctx.newId('news');
  const item: NewsItem = {
    id,
    kind: spec.kind,
    originId,
    hour,
    importance,
    facts: cloneFacts(spec.facts),
    reachedIds: [originId],
    distortion,
    textKey: headlineKey(ctx, spec.kind, spec.textKey),
    seed: ctx.rng('news').u32(),
    reachedDays: [0],
    reachedFrom: [-1],
    expanded: 0,
    transit: emptyTransit(),
    reachDays: newsReachDays(importance, b),
  };
  if (spec.refs && spec.refs.length > 0) item.refs = [...spec.refs];
  const factions = spec.factionIds?.filter((f, i, all) => typeof f === 'string' && all.indexOf(f) === i);
  if (factions && factions.length > 0) item.factionIds = factions;
  if (spec.confirmed ?? kindDef?.confirmed ?? false) item.confirmed = true;
  if (spec.exactFacts && spec.exactFacts.length > 0) item.exactFacts = [...spec.exactFacts];
  if (dedupeKey !== undefined) {
    item.dedupeKey = dedupeKey;
    idx.dedupe[dedupeKey] = id;
  }
  draft.news[id] = item;
  idx.active.push(id);
  addKnown(idx, originId, id);
  const live = draft.news[id] as NewsItem;
  if (factions?.includes(draft.player.factionId)) {
    live.playerHeard = { hour: now, copy: 0, via: 'witness', confirmed: true };
  } else if (isPlayerHolding(draft, originId)) {
    hearCopy(draft, ctx, live, 0, 'dispatch', originId);
  }
  return id;
}

/** The exact (never-drifting) fact keys of an item. */
export function exactKeysOf(ctx: NewsTunablesHost, item: Pick<NewsItem, 'exactFacts'>): string[] {
  const base = ctx.tunables.news.exactFactKeys;
  return item.exactFacts && item.exactFacts.length > 0 ? [...base, ...item.exactFacts] : [...base];
}

/** ICU vars of copy `copy`: the item's primitive facts after drifting (numbers ±distortion per hop). */
export function copyTextVars(item: NewsItem, copy: number, exactKeys: readonly string[]): TextVars {
  const facts = distortFacts(item.facts, copyDrift(item, copy), exactKeys);
  const vars: TextVars = {};
  for (const [k, v] of Object.entries(facts)) {
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') vars[k] = v;
  }
  return vars;
}

/** True if copy `copy`, heard via `via`, is a rumour for the player (§19.3). */
export function isRumourCopy(ctx: NewsTunablesHost, item: NewsItem, copy: number, via: NewsVia): boolean {
  if (item.confirmed === true || via === 'witness') return false;
  const t = ctx.tunables.news;
  if ((t.reliableVia as readonly string[]).includes(via)) return false;
  return copyHops(item, copy) > t.confirmHops;
}

function dispatchPriority(ctx: SimContext, importance: number): NotificationPriority {
  const d = ctx.tunables.news.dispatch;
  if (importance >= d.highImportance) return 'high';
  if (importance >= d.normalImportance) return 'normal';
  return 'low';
}

/**
 * The player hears copy `copy` of an item via `via` at `settlementId`. First hearing: records it,
 * emits NewsHeard and (dispatches) the Hirdmaster's notification/narration, and chronicles important
 * items. Later hearings upgrade the player's copy when it is closer to the origin and emit
 * NewsConfirmed when a rumour becomes confirmed. Returns true on a first hearing.
 */
export function hearCopy(draft: GameState, ctx: SimContext, item: NewsItem, copy: number, via: NewsVia, settlementId: SettlementId): boolean {
  const rumour = isRumourCopy(ctx, item, copy, via);
  const known = item.playerHeard;
  if (known) {
    const better = copyHops(item, copy) < copyHops(item, known.copy);
    if (better) known.copy = copy;
    if (!known.confirmed && !rumour) {
      known.confirmed = true;
      ctx.emit({ type: 'NewsConfirmed', newsId: item.id, kind: item.kind, via, settlementId });
    }
    return false;
  }
  item.playerHeard = { hour: draft.time.hour, copy, via, confirmed: !rumour };
  const hops = copyHops(item, copy);
  ctx.emit({
    type: 'NewsHeard',
    newsId: item.id,
    kind: item.kind,
    importance: toImportance(item.importance),
    originId: item.originId,
    settlementId,
    via,
    hops,
    rumour,
  });
  const t = ctx.tunables.news;
  const textKey = item.textKey ?? GENERIC_NEWS_KEY;
  const vars = copyTextVars(item, copy, exactKeysOf(ctx, item));
  if (via === 'dispatch' && item.importance >= t.dispatch.minImportance) {
    const holding = draft.settlements[settlementId]?.name ?? '';
    ctx.notify(textKey, {
      priority: dispatchPriority(ctx, item.importance),
      vars: { ...vars, holding, rumour },
      link: { kind: 'settlement', id: item.originId },
    });
    if (item.importance >= t.dispatch.narrateMinImportance) ctx.narrate(DISPATCH_NARRATION_KEY, { holding }, 'hirdmaster');
  }
  if (item.importance >= t.dispatch.chronicleMinImportance) {
    ctx.chronicle({ kind: 'news', textKey, importance: item.importance, vars, refs: [item.originId, ...(item.refs ?? [])] });
  }
  return true;
}

/** Removes an item and every index entry pointing at it. */
export function removeNews(draft: GameState, id: NewsId): void {
  const item = Object.hasOwn(draft.news, id) ? draft.news[id] : undefined;
  const idx = ensureNewsIndex(draft);
  if (item) {
    for (const s of item.reachedIds) removeKnown(idx, s, id);
    if (item.dedupeKey !== undefined && Object.hasOwn(idx.dedupe, item.dedupeKey) && idx.dedupe[item.dedupeKey] === id) delete idx.dedupe[item.dedupeKey];
    delete draft.news[id];
  }
  const a = idx.active.indexOf(id);
  if (a >= 0) idx.active.splice(a, 1);
}

/**
 * Drops items older than their importance's `prune.maxAgeDays`, then the least important and oldest
 * items beyond `prune.maxItems`. Returns the number removed.
 */
export function pruneNews(draft: GameState, ctx: SimContext): number {
  const t = ctx.tunables.news;
  const now = draft.time.hour;
  let removed = 0;
  // Age filter on the table as the operation began: hour and importance never change.
  const base = baseState(draft.news);
  for (const id of Object.keys(base) as NewsId[]) {
    const item = base[id];
    if (!item) continue;
    if ((now - item.hour) / HOURS_PER_DAY > maxAgeDays(item.importance, t.prune.maxAgeDays)) {
      removeNews(draft, id);
      removed++;
    }
  }
  const ids = Object.keys(draft.news) as NewsId[];
  if (ids.length > t.prune.maxItems) {
    const rows = ids.map((id) => {
      const item = draft.news[id] as NewsItem;
      return { id, importance: item.importance, hour: item.hour };
    });
    rows.sort((a, b) => a.importance - b.importance || a.hour - b.hour || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (let i = 0; i < rows.length - t.prune.maxItems; i++) {
      removeNews(draft, (rows[i] as { id: NewsId }).id);
      removed++;
    }
  }
  return removed;
}

/** The faction ids that appear in a list of possibly-missing values (deduplicated, in order). */
export function factionList(...ids: (FactionId | undefined)[]): FactionId[] {
  const out: FactionId[] = [];
  for (const id of ids) if (id !== undefined && !out.includes(id)) out.push(id);
  return out;
}
