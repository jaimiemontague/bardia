/**
 * News invariants (tests and fuzzers): item shape, copy chains, the transit frontier, and the
 * consistency of the per-settlement known index and the active list with the items.
 */
import type { GameState, NewsId } from '@sim/core/state';
import './types';

const EPS = 1e-6;

/** Human-readable violations of the news invariants. */
export function newsInvariants(state: GameState): string[] {
  const out: string[] = [];
  const idx = state.newsIndex;
  const knownPairs: Record<string, true> = {};
  for (const [key, item] of Object.entries(state.news)) {
    const id = key as NewsId;
    const where = `news ${id}`;
    if (!Number.isInteger(item.importance) || item.importance < 1 || item.importance > 5) out.push(`${where}: importance ${item.importance}`);
    if (!(item.distortion >= 0 && item.distortion <= 0.95)) out.push(`${where}: distortion ${item.distortion}`);
    if (!Number.isInteger(item.hour) || item.hour < 0 || item.hour > state.time.hour) out.push(`${where}: hour ${item.hour} (now ${state.time.hour})`);
    const reached = item.reachedIds;
    if (reached.length === 0 || reached[0] !== item.originId) out.push(`${where}: reachedIds must start with the origin ${item.originId}`);
    const seen: Record<string, true> = {};
    for (const s of reached) {
      if (Object.hasOwn(seen, s)) out.push(`${where}: ${s} reached twice`);
      seen[s] = true;
      knownPairs[`${s}|${id}`] = true;
      const list = idx && Object.hasOwn(idx.known, s) ? idx.known[s] : undefined;
      if (!list || !list.includes(id)) out.push(`${where}: missing from newsIndex.known[${s}]`);
    }
    const days = item.reachedDays;
    const from = item.reachedFrom;
    if (days && days.length !== reached.length) out.push(`${where}: reachedDays length ${days.length} != ${reached.length}`);
    if (from && from.length !== reached.length) out.push(`${where}: reachedFrom length ${from.length} != ${reached.length}`);
    if (from && from[0] !== -1) out.push(`${where}: the origin copy must have reachedFrom −1`);
    if (from && days) {
      for (let i = 1; i < from.length; i++) {
        const p = from[i] as number;
        if (!Number.isInteger(p) || p < 0 || p >= i) out.push(`${where}: copy ${i} heard from ${p}`);
        else if ((days[i] as number) + EPS < (days[p] as number)) out.push(`${where}: copy ${i} is nearer than its source`);
      }
      if (item.reachDays !== undefined) for (const d of days) if (d > item.reachDays + EPS) out.push(`${where}: copy beyond reach (${d} > ${item.reachDays})`);
    }
    if (item.expanded !== undefined && (item.expanded < 0 || item.expanded > reached.length)) out.push(`${where}: expanded ${item.expanded}`);
    const t = item.transit;
    if (t) {
      const n = t.to.length;
      if (t.at.length !== n || t.days.length !== n || t.from.length !== n) out.push(`${where}: transit arrays differ in length`);
      const onRoad: Record<string, true> = {};
      for (let k = 0; k < n; k++) {
        const to = t.to[k] as string;
        if (Object.hasOwn(seen, to)) out.push(`${where}: ${to} is both reached and on the road`);
        if (Object.hasOwn(onRoad, to)) out.push(`${where}: ${to} on the road twice`);
        onRoad[to] = true;
        if ((t.at[k] as number) < item.hour) out.push(`${where}: arrival before the event`);
        const f = t.from[k] as number;
        if (!Number.isInteger(f) || f < 0 || f >= reached.length) out.push(`${where}: transit from copy ${f}`);
      }
    }
    const spreading = (item.expanded ?? 0) < reached.length || (t !== undefined && t.to.length > 0);
    if (spreading && (!idx || !idx.active.includes(id))) out.push(`${where}: spreading but not in newsIndex.active`);
    if (item.playerHeard && (item.playerHeard.copy < 0 || item.playerHeard.copy >= reached.length)) out.push(`${where}: playerHeard.copy ${item.playerHeard.copy}`);
  }
  if (idx) {
    const activeSeen: Record<string, true> = {};
    for (const id of idx.active) {
      if (Object.hasOwn(activeSeen, id)) out.push(`newsIndex.active lists ${id} twice`);
      activeSeen[id] = true;
      if (!Object.hasOwn(state.news, id)) out.push(`newsIndex.active lists missing ${id}`);
    }
    for (const [s, ids] of Object.entries(idx.known)) {
      if (ids.length === 0) out.push(`newsIndex.known[${s}] is empty`);
      for (const id of ids) if (!Object.hasOwn(knownPairs, `${s}|${id}`)) out.push(`newsIndex.known[${s}] lists ${id}, which has not reached it`);
    }
    for (const [k, id] of Object.entries(idx.dedupe)) if (!Object.hasOwn(state.news, id)) out.push(`newsIndex.dedupe[${k}] points at missing ${id}`);
  }
  return out;
}
