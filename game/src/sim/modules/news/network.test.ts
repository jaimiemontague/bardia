import { getContent } from '@content/index';
import type { GameState, Settlement, SettlementId } from '@sim/core/state';
import { describe, expect, it } from 'vitest';
import {
  buildNewsNetwork,
  clearNewsNetworkCache,
  compileNetwork,
  fallbackDays,
  fallbackParams,
  newsNetworkOf,
  travelDaysFrom,
  worldIndexLinks,
  type NewsNetwork,
} from './network';
import { newsTestWorld } from './testing';

const content = getContent();
const params = fallbackParams(content.balance, content.tunables.news);

function table(points: { x: number; y: number; coastal?: boolean }[]): Record<string, Settlement> {
  const out: Record<string, Settlement> = {};
  points.forEach((p, i) => {
    out[`set_${i + 1}`] = { id: `set_${i + 1}`, mapPos: { x: p.x, y: p.y }, coastal: p.coastal ?? true } as unknown as Settlement;
  });
  return out;
}

function neighbours(net: NewsNetwork, id: string): string[] {
  const n = net.index[id] as number;
  const out: string[] = [];
  for (let e = net.start[n] as number; e < (net.start[n + 1] as number); e++) out.push(net.ids[net.to[e] as number] as string);
  return out.sort();
}

describe('fallback network', () => {
  it('sea between coastal settlements, land otherwise', () => {
    const a = { id: 'set_1' as SettlementId, x: 0, y: 0, coastal: true };
    const b = { id: 'set_2' as SettlementId, x: 24, y: 0, coastal: true };
    const c = { id: 'set_3' as SettlementId, x: 24, y: 0, coastal: false };
    expect(fallbackDays(a, b, params)).toBeCloseTo((24 * 5 * 1.3) / 120, 12);
    expect(fallbackDays(a, c, params)).toBeCloseTo((24 * 5 * 1.25) / 30, 12);
    expect(fallbackDays(a, b, params, false)).toBeCloseTo((24 * 5 * 1.25) / 30, 12);
  });

  it('links nearest neighbours symmetrically and bridges distant clusters', () => {
    // Two clusters ~ 60 cells apart (6.5 sea days): too far for a neighbour link with a small cap, bridged by the MST.
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
      { x: 70, y: 0 },
      { x: 80, y: 0 },
    ];
    const net = buildNewsNetwork(table(pts), undefined, { ...params, neighbours: 2, maxEdgeDays: 3 });
    expect(net.source).toBe('fallback');
    expect(neighbours(net, 'set_1')).toEqual(['set_2', 'set_3']);
    expect(neighbours(net, 'set_4')).toContain('set_5');
    // The bridge: set_2 (x 10) ↔ set_4 (x 70).
    expect(neighbours(net, 'set_2')).toContain('set_4');
    expect(Number.isFinite(travelDaysFrom(net, 'set_1' as SettlementId)[net.index['set_5'] as number] as number)).toBe(true);
    // A cap below the bridge length leaves the clusters apart.
    const apart = buildNewsNetwork(table(pts), undefined, { ...params, neighbours: 2, maxEdgeDays: 3, bridgeMaxDays: 2 });
    expect(travelDaysFrom(apart, 'set_1' as SettlementId)[apart.index['set_5'] as number]).toBe(Infinity);
  });

  it('compileNetwork keeps the shortest of duplicate links and ignores unknown ids', () => {
    const ids = ['set_1', 'set_2'] as SettlementId[];
    const net = compileNetwork(
      ids,
      [
        { a: 'set_1' as SettlementId, b: 'set_2' as SettlementId, days: 5 },
        { a: 'set_2' as SettlementId, b: 'set_1' as SettlementId, days: 3 },
        { a: 'set_1' as SettlementId, b: 'set_9' as SettlementId, days: 1 },
      ],
      'fallback',
    );
    expect(Array.from(net.days)).toEqual([3, 3]);
    expect(Array.from(net.start)).toEqual([0, 1, 2]);
  });
});

describe('state.worldIndex links', () => {
  const settlements = table([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 200, y: 0, coastal: false },
    { x: 205, y: 0 },
  ]);

  it('reads settlement-id links, node-index lanes and geography ids', () => {
    expect(worldIndexLinks({ links: [{ a: 'set_1', b: 'set_2', days: 4 }] }, settlements)).toEqual([{ a: 'set_1', b: 'set_2', days: 4 }]);
    const lanes = { lanes: { nodes: ['kolby', 'set_2'], lanes: [{ a: 0, b: 1, days: 7 }] }, settlementByGeoId: { kolby: 'set_1' } };
    expect(worldIndexLinks(lanes, settlements)).toEqual([{ a: 'set_1', b: 'set_2', days: 7 }]);
    expect(worldIndexLinks({ links: [{ a: 'set_1', b: 'set_99', days: 4 }, { a: 'set_1', b: 'set_2', days: -1 }] }, settlements)).toBeUndefined();
    expect(worldIndexLinks(undefined, settlements)).toBeUndefined();
    expect(worldIndexLinks({ unrelated: true }, settlements)).toBeUndefined();
  });

  it('world links replace sea guesses; inland and untouched settlements keep fallback links', () => {
    const net = buildNewsNetwork(settlements, { links: [{ a: 'set_1', b: 'set_2', days: 9 }] }, params);
    expect(net.source).toBe('world');
    const fromA = travelDaysFrom(net, 'set_1' as SettlementId);
    expect(fromA[net.index['set_2'] as number]).toBeCloseTo(9, 9);
    // set_4 is touched by no world link: it keeps its fallback links (incl. sea), so it is reachable.
    expect(Number.isFinite(fromA[net.index['set_4'] as number] as number)).toBe(true);
    // set_3 is inland: overland links connect it.
    expect(neighbours(net, 'set_3').length).toBeGreaterThan(0);
  });
});

describe('memoized network of a state', () => {
  it('reuses the network while settlements keep their places, rebuilds when they move', () => {
    clearNewsNetworkCache();
    const w = newsTestWorld({ cols: 4 });
    const n1 = newsNetworkOf(w.state, content.balance, content.tunables.news);
    expect(newsNetworkOf(w.state, content.balance, content.tunables.news)).toBe(n1);
    // A structurally equal state (different object) hits the signature cache.
    const copy = JSON.parse(JSON.stringify(w.state)) as GameState;
    expect(newsNetworkOf(copy, content.balance, content.tunables.news)).toBe(n1);
    const moved = JSON.parse(JSON.stringify(w.state)) as GameState;
    (moved.settlements[w.ids[3] as SettlementId] as Settlement).mapPos.x += 500;
    expect(newsNetworkOf(moved, content.balance, content.tunables.news)).not.toBe(n1);
  });
});
