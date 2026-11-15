import { describe, expect, it } from 'vitest';
import { getContent, type Content } from '@content/index';
import { dispatch } from '@sim/core/dispatch';
import { getOrCreateRelation } from '@sim/core/factory';
import type { GameState, SettlementId, ShipId } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { advance } from '@sim/core/scheduler';
import { missingEventKeys, testWorld } from '../../testing';
import { module as military } from './index';
import { interceptChance, transferPreview } from './transfer';
import { edit, militaryContent, mustDispatch } from './testing';

function world(content: Content = getContent()) {
  const w = testWorld({ modules: [military], content, factions: 2, settlementsPerFaction: 2, fleetsPerFaction: 0 });
  const [capital, village] = w.settlementIds[w.state.player.factionId] as [SettlementId, SettlementId];
  return { ...w, capital, village };
}

function dockedShips(s: GameState, at: SettlementId): ShipId[] {
  return Object.values(s.ships)
    .filter((sh) => sh.dockedAt === at && sh.locationFleetId === undefined)
    .map((sh) => sh.id);
}

describe('transfer', () => {
  it('moves men (with veterancy), ships and goods with travel time', () => {
    const w = world(militaryContent({ transfer: { interceptPerDay: 0, interceptCap: 0 } }));
    let s = edit(w.state, w.env, (d) => {
      const c = d.settlements[w.capital];
      if (c) c.vetBattles = { bondi: 2 };
    });
    const ships = dockedShips(s, w.capital);
    expect(ships.length).toBeGreaterThan(0);
    const timberBefore = s.markets[w.capital]?.stock.timber ?? 0;
    const p = transferPreview(s, w.env.content, { fromId: w.capital, toId: w.village, men: { bondi: 10 }, shipIds: ships, goods: { timber: 2 } });
    expect(p.ok).toBe(true);
    expect(p.days).toBe(1);
    s = mustDispatch(s, w.env, { type: 'transfer', fromId: w.capital, toId: w.village, men: { bondi: 10 }, shipIds: ships, goods: { timber: 2 } }).state;
    expect(s.settlements[w.capital]?.garrison.bondi).toBe(30);
    expect(s.markets[w.capital]?.stock.timber).toBe(timberBefore - 2);
    for (const id of ships) expect(s.ships[id]).toMatchObject({ transitId: s.military?.transfers[0]?.id });
    for (const id of ships) expect(s.ships[id]?.dockedAt).toBeUndefined();
    const villageTimber = s.markets[w.village]?.stock.timber ?? 0;
    const r = advance(s, HOURS_PER_DAY, w.env);
    const after = r.state;
    expect(after.settlements[w.village]?.garrison.bondi).toBe(40);
    expect(after.settlements[w.village]?.vetBattles?.bondi).toBe(0.5); // (30 × 0 + 10 × 2) / 40
    for (const id of ships) expect(after.ships[id]).toMatchObject({ dockedAt: w.village });
    for (const id of ships) expect(after.ships[id]?.transitId).toBeUndefined();
    expect(after.markets[w.village]?.stock.timber).toBe(villageTimber + 2);
    expect(r.events.find((e) => e.type === 'TransferArrived')).toMatchObject({ intercepted: false, men: { bondi: 10 }, menLost: 0 });
    expect(missingEventKeys(r.events)).toEqual([]);
  });

  it('an intercepted transfer loses men (home population falls), goods and ship condition', () => {
    const w = world(militaryContent({ transfer: { interceptPerDay: 1, interceptCap: 1, interceptPeaceMult: 1 } }));
    const ship = dockedShips(w.state, w.capital)[0] as ShipId;
    const pop = w.state.settlements[w.capital]?.pop ?? 0;
    let s = mustDispatch(w.state, w.env, { type: 'transfer', fromId: w.capital, toId: w.village, men: { bondi: 20 }, shipIds: [ship], goods: { iron: 4 } }).state;
    const ironBefore = s.markets[w.village]?.stock.iron ?? 0;
    const r = advance(s, HOURS_PER_DAY, w.env);
    s = r.state;
    expect(s.settlements[w.village]?.garrison.bondi).toBe(30 + 15);
    expect(s.settlements[w.capital]?.pop).toBe(pop - 5);
    expect(s.markets[w.village]?.stock.iron).toBeCloseTo(ironBefore + 2, 6);
    expect(s.ships[ship]?.hullHp).toBeCloseTo(80 * 0.8, 6);
    expect(r.events.find((e) => e.type === 'TransferArrived')).toMatchObject({ intercepted: true, menLost: 5 });
    expect(r.events.some((e) => e.type === 'Notification' && e.key === 'military.transfer.intercepted' && e.illustration === 'military.illus.transferIntercepted')).toBe(true);
    expect(missingEventKeys(r.events)).toEqual([]);
  });

  it('interception is likelier at war', () => {
    const w = world();
    const content = w.env.content;
    const peace = transferPreview(w.state, content, { fromId: w.capital, toId: w.village, men: { bondi: 1 } }).interceptChance;
    const atWar = edit(w.state, w.env, (d) => {
      const enemy = w.factionIds[1];
      if (enemy) getOrCreateRelation(d, d.player.factionId, enemy).stance = 'war';
    });
    const war = transferPreview(atWar, content, { fromId: w.capital, toId: w.village, men: { bondi: 1 } });
    expect(war.atWar).toBe(true);
    expect(war.interceptChance).toBeGreaterThan(peace);
    expect(interceptChance(atWar, content, 100, true)).toBe(content.tunables.military.transfer.interceptCap);
  });

  it('validates the shipment', () => {
    const w = world();
    const s = w.state;
    const code = (cmd: Parameters<typeof transferPreview>[2]) => dispatch(s, { type: 'transfer', ...cmd }, w.env).error?.code;
    expect(code({ fromId: w.capital, toId: w.capital, men: { bondi: 1 } })).toBe('sameHolding');
    expect(code({ fromId: w.capital, toId: w.village })).toBe('nothingToSend');
    expect(code({ fromId: w.capital, toId: w.village, men: { bondi: 999 } })).toBe('notEnoughMen');
    expect(code({ fromId: w.capital, toId: w.village, shipIds: ['shp_123456'] })).toBe('shipNotHere');
    expect(code({ fromId: w.capital, toId: w.village, goods: { amber: 9999 } })).toBe('notEnoughGoods');
    const enemyTown = w.settlementIds[w.factionIds[1] as never]?.[0] as SettlementId;
    expect(code({ fromId: w.capital, toId: enemyTown, men: { bondi: 1 } })).toBe('notYourHolding');
  });
});
