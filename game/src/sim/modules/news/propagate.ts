/**
 * Daily news propagation (design §19.3): Dijkstra spread over time. Each active item keeps the
 * copies heard so far (`reachedIds`, `reachedDays`, `reachedFrom`) and the word on the road
 * (`transit`). Every day, for each active item:
 *   1. the onward roads of copies not yet expanded are walked: a neighbour m of copy i, at
 *      cumulative travel-days D = days(i) + link, is scheduled at item.hour + D × (1.5 − 0.1 × imp)
 *      days, unless D exceeds the reach (5 + 5 × imp) or an earlier arrival is already on the road;
 *   2. arrivals due by now are heard in arrival order (ties: first scheduled) and expanded in turn.
 * The result equals running Dijkstra once at creation, but it uses the network as it is when the
 * word actually travels, keeps only the frontier in state, and never needs the network at creation
 * (reactions stay cheap). A copy reaching one of the player's holdings is a Hirdmaster dispatch.
 *
 * Hot path (ARCHITECTURE §7): an idle item costs O(1) (`nextAt`); a working item is copied into
 * plain arrays once, processed without proxy traps, and written back once.
 */
import { baseState } from '@sim/core/context';
import type { SimContext } from '@sim/core/module';
import type { GameState, Hour, NewsId, NewsItem, SettlementId } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { newsDelayFactor, newsReachDays, type NewsBalance } from './formulas';
import { newsNetworkOf, type NewsNetwork } from './network';
import { addKnown, ensureNewsIndex, hearCopy, playerHoldingLookup } from './store';
import type { NewsIndexState } from './types';

// Scratch marks for "node already reached by the item being processed" (generation-stamped).
let stamp = new Int32Array(0);
let generation = 0;

function nextGeneration(size: number): number {
  if (stamp.length < size) {
    stamp = new Int32Array(Math.max(size, stamp.length * 2, 64));
    generation = 0;
  }
  if (generation >= 0x7ffffff0) {
    stamp.fill(0);
    generation = 0;
  }
  return ++generation;
}

interface Env {
  readonly net: NewsNetwork;
  readonly now: Hour;
  readonly holdings: Readonly<Record<string, true>>;
  readonly settlements: Readonly<Record<string, unknown>>;
  readonly b: NewsBalance;
  readonly idx: NewsIndexState;
}

/** Minimum of the live arrivals (Infinity when none). */
function minAt(at: readonly number[]): number {
  let m = Infinity;
  for (const v of at) if (v < m) m = v;
  return m;
}

/**
 * Advances one item to `env.now`. Returns true while it is still spreading (copies to expand or
 * arrivals on the road).
 */
function propagateItem(draft: GameState, ctx: SimContext, item: NewsItem, env: Env): boolean {
  const reachedProxy = item.reachedIds;
  const reachedLen = reachedProxy.length;
  let expanded = item.expanded ?? 0;
  const transit = item.transit;
  const onRoad = transit ? transit.to.length : 0;
  if (expanded >= reachedLen) {
    if (onRoad === 0) {
      if (item.nextAt !== undefined) delete item.nextAt;
      return false;
    }
    const next = item.nextAt ?? minAt(transit?.at ?? []);
    if (next > env.now) return true;
  }
  const { net } = env;
  // Plain working copies.
  const tTo: string[] = transit ? Array.from(transit.to) : [];
  const tAt: number[] = transit ? Array.from(transit.at) : [];
  const tDays: number[] = transit ? Array.from(transit.days) : [];
  const tFrom: number[] = transit ? Array.from(transit.from) : [];
  const slot: Record<string, number> = {};
  tTo.forEach((to, j) => {
    slot[to] = j;
  });
  const reached: string[] = Array.from(reachedProxy);
  const daysProxy = item.reachedDays;
  const days: number[] = daysProxy && daysProxy.length === reachedLen ? Array.from(daysProxy) : reached.map(() => 0);
  const fromProxy = item.reachedFrom;
  const from: number[] = fromProxy && fromProxy.length === reachedLen ? Array.from(fromProxy) : reached.map((_, i) => (i === 0 ? -1 : 0));
  const gen = nextGeneration(net.ids.length);
  for (const id of reached) {
    const n = Object.hasOwn(net.index, id) ? net.index[id] : undefined;
    if (n !== undefined) stamp[n] = gen;
  }
  const factor = newsDelayFactor(item.importance, env.b) * HOURS_PER_DAY;
  const reach = (item.reachDays ?? newsReachDays(item.importance, env.b)) + 1e-9;
  let removed = 0;
  for (;;) {
    // 1. Walk the roads out of every copy heard but not yet expanded.
    while (expanded < reached.length) {
      const copy = expanded++;
      const id = reached[copy] as string;
      const n = Object.hasOwn(net.index, id) ? net.index[id] : undefined;
      if (n === undefined) continue;
      const base = days[copy] ?? 0;
      for (let e = net.start[n] as number; e < (net.start[n + 1] as number); e++) {
        const m = net.to[e] as number;
        if (stamp[m] === gen) continue;
        const cum = base + (net.days[e] as number);
        if (cum > reach) continue;
        const at = item.hour + Math.round(cum * factor);
        const target = net.ids[m] as string;
        const j = Object.hasOwn(slot, target) ? slot[target] : undefined;
        if (j === undefined) {
          slot[target] = tTo.length;
          tTo.push(target);
          tAt.push(at);
          tDays.push(cum);
          tFrom.push(copy);
        } else if ((tAt[j] as number) > at || ((tAt[j] as number) === at && (tDays[j] as number) > cum)) {
          tAt[j] = at;
          tDays[j] = cum;
          tFrom[j] = copy;
        }
      }
    }
    // 2. Hear the earliest arrival that is due (removed slots hold Infinity).
    let pick = -1;
    let pickAt = env.now + 1;
    for (let j = 0; j < tAt.length; j++) {
      const at = tAt[j] as number;
      if (at < pickAt) {
        pickAt = at;
        pick = j;
      }
    }
    if (pick < 0) break;
    const to = tTo[pick] as string;
    const d = tDays[pick] as number;
    const f = tFrom[pick] as number;
    tAt[pick] = Infinity;
    delete slot[to];
    removed++;
    const m = Object.hasOwn(net.index, to) ? net.index[to] : undefined;
    if (m !== undefined) {
      if (stamp[m] === gen) continue;
      stamp[m] = gen;
    }
    if (!Object.hasOwn(env.settlements, to)) continue;
    reached.push(to);
    days.push(d);
    from.push(f);
  }
  // Write back: new copies, the known index, dispatches, the compacted road.
  const added = reached.length - reachedLen;
  if (added > 0) {
    const daysDraft = item.reachedDays && item.reachedDays.length === reachedLen ? item.reachedDays : (item.reachedDays = days.slice(0, reachedLen));
    const fromDraft = item.reachedFrom && item.reachedFrom.length === reachedLen ? item.reachedFrom : (item.reachedFrom = from.slice(0, reachedLen));
    reachedProxy.push(...(reached.slice(reachedLen) as SettlementId[]));
    daysDraft.push(...days.slice(reachedLen));
    fromDraft.push(...from.slice(reachedLen));
    for (let copy = reachedLen; copy < reached.length; copy++) {
      const to = reached[copy] as SettlementId;
      addKnown(env.idx, to, item.id);
      if (Object.hasOwn(env.holdings, to)) hearCopy(draft, ctx, item, copy, 'dispatch', to);
    }
  }
  if (removed > 0 || tTo.length !== onRoad || !transit) {
    const live = { to: [] as SettlementId[], at: [] as Hour[], days: [] as number[], from: [] as number[] };
    for (let j = 0; j < tTo.length; j++) {
      if (tAt[j] === Infinity) continue;
      live.to.push(tTo[j] as SettlementId);
      live.at.push(tAt[j] as number);
      live.days.push(tDays[j] as number);
      live.from.push(tFrom[j] as number);
    }
    item.transit = live;
  } else {
    // Only decrease-key updates: write the changed arrivals in place.
    for (let j = 0; j < tTo.length; j++) {
      if (transit.at[j] !== tAt[j]) transit.at[j] = tAt[j] as number;
      if (transit.days[j] !== tDays[j]) transit.days[j] = tDays[j] as number;
      if (transit.from[j] !== tFrom[j]) transit.from[j] = tFrom[j] as number;
    }
  }
  const next = minAt(tAt);
  if (next === Infinity) {
    if (item.nextAt !== undefined) delete item.nextAt;
  } else if (item.nextAt !== next) item.nextAt = next;
  if (item.expanded !== expanded) item.expanded = expanded;
  return expanded < reached.length || next !== Infinity;
}

/** The daily news system: spreads every active item to today. */
export function propagateNews(draft: GameState, ctx: SimContext): void {
  const idx = draft.newsIndex;
  if (!idx || idx.active.length === 0) return;
  const env: Env = {
    net: newsNetworkOf(draft, ctx.balance, ctx.tunables.news),
    now: draft.time.hour,
    holdings: playerHoldingLookup(draft),
    settlements: baseState(draft.settlements),
    b: ctx.balance.intel.news,
    idx: ensureNewsIndex(draft),
  };
  const ids = Array.from(idx.active) as NewsId[];
  const still: NewsId[] = [];
  for (const id of ids) {
    const item = Object.hasOwn(draft.news, id) ? draft.news[id] : undefined;
    if (!item) continue;
    if (propagateItem(draft, ctx, item, env)) still.push(id);
  }
  if (still.length !== ids.length || idx.active.length !== ids.length) {
    // Keep anything appended while this ran (defensive; reactions run after the system).
    idx.active = [...still, ...Array.from(idx.active).slice(ids.length)];
  }
}
