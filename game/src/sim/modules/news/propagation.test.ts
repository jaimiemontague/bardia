import { getContent } from '@content/index';
import type { SimEvent } from '@sim/core/events';
import type { GameState, NewsItem, SettlementId } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { missingEventKeys } from '@sim/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { copyDrift, driftBounds, newsArrivalHour, newsReachDays } from './formulas';
import { newsInvariants } from './invariants';
import { clearNewsNetworkCache, newsNetworkOf, travelDaysFrom } from './network';
import { copyIndexAt, keeperNews, newsKnownAt } from './query';
import { advanceDays, newsContent, newsTestWorld, withNews } from './testing';

// A clean chain: every settlement links only to its neighbours (MST of a straight line).
const chainContent = newsContent({ network: { neighbours: 1 } });
const b = getContent().balance.intel.news;
const LEG = (24 * 5 * 1.3) / 120; // 1.3 sea-days between neighbours 24 cells apart

function item(state: GameState, id: string): NewsItem {
  const it = state.news[id as `news_${string}`];
  if (!it) throw new Error(`no item ${id}`);
  return it;
}

function heardEvents(events: readonly SimEvent[]) {
  return events.filter((e): e is Extract<SimEvent, { type: 'NewsHeard' }> => e.type === 'NewsHeard');
}

describe('propagation timing (§19.3)', () => {
  it('reaches each settlement at hour + travelDays × (1.5 − 0.1 × importance), on the next daily tick', () => {
    const w = newsTestWorld({ cols: 8, content: chainContent });
    const origin = w.ids[0] as SettlementId;
    const { state: s0, id } = withNews(w.state, w.env, { kind: 'battle', originId: origin, importance: 2, facts: { killed: 300 } });
    let state = s0;
    const expected = w.ids.map((_, k) => newsArrivalHour(0, k * LEG, 2, b));
    for (let day = 1; day <= 20; day++) {
      state = advanceDays(state, w.env, 1).state;
      const it = item(state, id);
      w.ids.forEach((sid, k) => {
        const due = (expected[k] as number) <= state.time.hour;
        const withinReach = k * LEG <= newsReachDays(2, b);
        expect(it.reachedIds.includes(sid), `day ${day} node ${k}`).toBe(due && withinReach);
      });
      expect(newsInvariants(state)).toEqual([]);
    }
    const it = item(state, id);
    // Arrival order follows distance; days and sources form the chain.
    expect(it.reachedIds).toEqual(w.ids.slice(0, it.reachedIds.length));
    it.reachedDays?.forEach((d, k) => expect(d).toBeCloseTo(k * LEG, 9));
    expect(it.reachedFrom).toEqual(it.reachedIds.map((_, k) => k - 1));
  });

  it('stops at the reach limit and then leaves the active list', () => {
    const w = newsTestWorld({ cols: 12, content: chainContent });
    const { state: s0, id } = withNews(w.state, w.env, { kind: 'battle', originId: w.ids[0] as SettlementId, importance: 1 });
    const state = advanceDays(s0, w.env, 40).state;
    const it = item(state, id);
    const maxK = Math.floor(newsReachDays(1, b) / LEG + 1e-9);
    expect(it.reachedIds.length).toBe(maxK + 1);
    expect(it.transit?.to).toEqual([]);
    expect(state.newsIndex?.active).not.toContain(id);
    // Importance 5 reaches farther.
    const { state: s1, id: big } = withNews(w.state, w.env, { kind: 'battle', originId: w.ids[0] as SettlementId, importance: 5 });
    expect(item(advanceDays(s1, w.env, 40).state, big).reachedIds.length).toBe(12);
  });

  it('news created in the past catches up at once', () => {
    const w = newsTestWorld({ cols: 6, content: chainContent });
    const later = advanceDays(w.state, w.env, 30).state;
    const { state: s0, id } = withNews(later, w.env, { kind: 'battle', originId: w.ids[0] as SettlementId, importance: 3, hour: later.time.hour - 20 * HOURS_PER_DAY });
    const s1 = advanceDays(s0, w.env, 1).state;
    expect(item(s1, id).reachedIds.length).toBe(6);
  });

  it('property: every copy travelled the shortest road, and everything within reach hears it', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ x: fc.integer({ min: 0, max: 400 }), y: fc.integer({ min: 0, max: 300 }), coastal: fc.boolean() }), { minLength: 3, maxLength: 24 }),
        fc.integer({ min: 1, max: 5 }),
        (positions, importance) => {
          clearNewsNetworkCache();
          const w = newsTestWorld({ positions });
          const { state: s0, id } = withNews(w.state, w.env, { kind: 'battle', originId: w.ids[0] as SettlementId, importance });
          const state = advanceDays(s0, w.env, 50).state;
          const it = item(state, id);
          const net = newsNetworkOf(state, w.env.balance, w.env.content.tunables.news);
          const dist = travelDaysFrom(net, w.ids[0] as SettlementId);
          const reach = newsReachDays(importance, b);
          for (const sid of w.ids) {
            const d = dist[net.index[sid] as number] as number;
            const k = it.reachedIds.indexOf(sid);
            if (d <= reach - 1e-6) {
              if (k < 0) return false;
              if (Math.abs((it.reachedDays?.[k] ?? -1) - d) > 1e-6) return false;
            } else if (d > reach + 1e-6 && k >= 0) return false;
          }
          return newsInvariants(state).length === 0;
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('distortion and rumours', () => {
  it('numbers drift within ±10% per hop; the origin keeps the truth', () => {
    const w = newsTestWorld({ cols: 10, content: chainContent });
    const { state: s0, id } = withNews(w.state, w.env, { kind: 'battle', originId: w.ids[0] as SettlementId, importance: 5, facts: { killed: 10000, place: 'Testford' } });
    const state = advanceDays(s0, w.env, 30).state;
    const it = item(state, id);
    for (let k = 0; k < it.reachedIds.length; k++) {
      const sid = it.reachedIds[k] as SettlementId;
      const view = newsKnownAt(state, sid, getContent()).find((v) => v.id === id);
      expect(view).toBeDefined();
      const [lo, hi] = driftBounds(view?.hops ?? 0, 0.1);
      const told = view?.facts['killed'] as number;
      expect(told).toBeGreaterThanOrEqual(Math.floor(10000 * lo));
      expect(told).toBeLessThanOrEqual(Math.ceil(10000 * hi));
      expect(told).toBe(Math.round(10000 * copyDrift(it, k)));
      expect(view?.facts['place']).toBe('Testford');
      if (k === 0) expect(told).toBe(10000);
    }
  });

  it('copies beyond confirmHops are rumours; proclaimed kinds never are', () => {
    const w = newsTestWorld({ cols: 5, content: chainContent });
    const { state: s0, id } = withNews(w.state, w.env, { kind: 'battle', originId: w.ids[0] as SettlementId, importance: 4 });
    const { state: s1, id: pact } = withNews(s0, w.env, { kind: 'pactSigned', originId: w.ids[0] as SettlementId, importance: 4 });
    const state = advanceDays(s1, w.env, 20).state;
    const at = (k: number, newsId: string) => newsKnownAt(state, w.ids[k] as SettlementId, getContent()).find((v) => v.id === newsId);
    expect(at(0, id)?.rumour).toBe(false);
    expect(at(1, id)?.rumour).toBe(false); // confirmHops = 1: an eyewitness from next door
    expect(at(2, id)?.rumour).toBe(true);
    expect(at(4, id)?.rumour).toBe(true);
    expect(at(4, pact)?.rumour).toBe(false);
  });
});

describe('Hirdmaster dispatches', () => {
  it('emits NewsHeard once when the word reaches a player holding, with a notification by importance', () => {
    const w = newsTestWorld({ cols: 6, content: chainContent, playerHoldings: [5] });
    // Origin far from the player's capital (ids[0]) but next to the holding at ids[5].
    const { state: s0, id } = withNews(w.state, w.env, { kind: 'battle', originId: w.ids[3] as SettlementId, importance: 4, facts: { attacker: 'A', defender: 'B', place: 'P', victor: 'attacker', killed: 900 } });
    const r = advanceDays(s0, w.env, 20);
    const heard = heardEvents(r.events).filter((e) => e.newsId === id);
    expect(heard).toHaveLength(1);
    const first = heard[0];
    expect(first?.via).toBe('dispatch');
    // The nearer holding (two hops) hears first, before the capital (three hops).
    expect(first?.settlementId).toBe(w.ids[5]);
    expect(first?.hops).toBe(2);
    expect(first?.rumour).toBe(true);
    const it = item(r.state, id);
    expect(it.playerHeard?.copy).toBe(copyIndexAt(it, w.ids[5] as SettlementId));
    const notes = r.events.filter((e) => e.type === 'Notification' && e.key === 'news.item.battle');
    expect(notes).toHaveLength(1);
    expect(notes[0]?.type === 'Notification' && notes[0].priority).toBe('normal');
    expect(r.events.some((e) => e.type === 'NarrationLine' && e.key === 'news.dispatch.messenger' && e.voice === 'hirdmaster')).toBe(true);
    expect(r.events.some((e) => e.type === 'ChronicleAdded' && e.entry.textKey === 'news.item.battle')).toBe(true);
    expect(missingEventKeys(r.events)).toEqual([]);
  });

  it('minor items arrive silently; witnessed items are never dispatched', () => {
    const w = newsTestWorld({ cols: 4, content: chainContent });
    const { state: s0, id: minor } = withNews(w.state, w.env, { kind: 'battle', originId: w.ids[1] as SettlementId, importance: 1 });
    const { state: s1, id: own } = withNews(s0, w.env, { kind: 'battle', originId: w.ids[2] as SettlementId, importance: 3, factionIds: [w.state.player.factionId] });
    const r = advanceDays(s1, w.env, 10);
    expect(heardEvents(r.events).map((e) => e.newsId)).toEqual([minor]);
    expect(r.events.filter((e) => e.type === 'Notification')).toHaveLength(0);
    expect(item(r.state, own).playerHeard).toEqual({ hour: 0, copy: 0, via: 'witness', confirmed: true });
  });

  it('an event at a player holding is dispatched at once, undistorted and confirmed', () => {
    const w = newsTestWorld({ cols: 3, content: chainContent });
    const r = withNews(w.state, w.env, { kind: 'stormWreck', originId: w.ids[0] as SettlementId, importance: 2, facts: { ships: 3, place: 'X', faction: 'none' } });
    const heard = heardEvents(r.events);
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ hops: 0, rumour: false, via: 'dispatch', settlementId: w.ids[0] });
  });
});

describe('keepers', () => {
  it('a keeper tells what reached the settlement, most important first, within memory', () => {
    const w = newsTestWorld({ cols: 4, content: chainContent });
    let state = w.state;
    for (const importance of [1, 3, 2, 5, 4]) state = withNews(state, w.env, { kind: 'battle', originId: w.ids[3] as SettlementId, importance }).state;
    state = advanceDays(state, w.env, 15).state;
    const told = keeperNews(state, w.ids[2] as SettlementId, getContent());
    expect(told.map((v) => v.importance)).toEqual([5, 4, 3, 2, 1]);
    expect(keeperNews(state, w.ids[2] as SettlementId, getContent(), { limit: 2 })).toHaveLength(2);
    // Past the keeper's memory the items are no longer told.
    const old = advanceDays(state, w.env, getContent().tunables.news.keeper.memoryDays + 1).state;
    expect(keeperNews(old, w.ids[2] as SettlementId, getContent())).toEqual([]);
    expect(newsKnownAt(old, w.ids[2] as SettlementId, getContent()).length).toBeGreaterThan(0);
  });
});
