import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { dispatch } from '@sim/core/dispatch';
import { createFleet } from '@sim/core/factory';
import type { FleetId, GameState, ShipId } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { advance } from '@sim/core/scheduler';
import { missingEventKeys } from '../../testing';
import { projectQueue, repairQuote, shipOrderPreview } from './ships';
import type { ShipOrder } from './types';
import { capitalOf, days, edit, militaryEnv, militaryState, mustDispatch, withMarket } from './testing';

const content = getContent();
const env = militaryEnv();

function home(culture: 'skarn' | 'hvarn' | 'eyjar' = 'skarn', treasury = 50000, timber = 500): GameState {
  const s = edit(militaryState({ player: { culture } }), env, (d) => {
    const f = d.factions[d.player.factionId];
    if (f) f.treasury = treasury;
  });
  return withMarket(s, env, capitalOf(s), { timber });
}

function playerShips(s: GameState): ShipId[] {
  return Object.values(s.ships)
    .filter((sh) => sh.ownerId === s.player.factionId)
    .map((sh) => sh.id);
}

describe('ship prices and culture modifiers (§12.7, cultures.json)', () => {
  it('Skarn: −15% cost and −20% build time; Hvarn +10% cost; Eyjar base', () => {
    const skarn = shipOrderPreview(home('skarn'), content, { holdingId: capitalOf(home('skarn')), shipType: 'knarr' });
    expect(skarn.cost).toBe(Math.round(900 * 0.85));
    expect(skarn.buildDays).toBe(Math.round(35 * 0.8));
    const hvarnState = home('hvarn');
    const hvarn = shipOrderPreview(hvarnState, content, { holdingId: capitalOf(hvarnState), shipType: 'knarr' });
    expect(hvarn.cost).toBe(990);
    expect(hvarn.buildDays).toBe(35);
    const eyjarState = home('eyjar');
    const eyjar = shipOrderPreview(eyjarState, content, { holdingId: capitalOf(eyjarState), shipType: 'karvi' });
    expect(eyjar.cost).toBe(500);
    expect(eyjar.buildDays).toBe(20);
  });

  it('takes timber from the market or charges the timber surcharge', () => {
    const s = home('eyjar', 50000, 10);
    const p = shipOrderPreview(s, content, { holdingId: capitalOf(s), shipType: 'karvi' });
    expect(p.timberT).toBe(20);
    expect(p.timberFromMarket).toBe(10);
    expect(p.timberSurcharge).toBe(10 * content.balance.shipyard.timberSurchargePerTon);
    expect(p.total).toBe(500 + 600);
    expect(dispatch(s, { type: 'queueShip', holdingId: capitalOf(s), shipType: 'karvi', buyTimber: false }, env).error?.code).toBe('timber');
    const r = mustDispatch(s, env, { type: 'queueShip', holdingId: capitalOf(s), shipType: 'karvi' });
    expect(r.state.markets[capitalOf(s)]?.stock.timber).toBe(0);
    expect(r.state.factions[r.state.player.factionId]?.treasury).toBe(50000 - 1100);
  });

  it('gates ship types by Shipyard tier and refuses unbuildable or unaffordable ships', () => {
    const s = home();
    const cap = capitalOf(s);
    expect(dispatch(s, { type: 'queueShip', holdingId: cap, shipType: 'snekkja' }, env).error?.code).toBe('shipyard');
    expect(dispatch(s, { type: 'queueShip', holdingId: cap, shipType: 'drakkar' }, env).error?.code).toBe('shipyard');
    expect(dispatch(s, { type: 'queueShip', holdingId: cap, shipType: 'galley' }, env).error?.code).toBe('notBuildable');
    const yard2 = edit(s, env, (d) => {
      const c = d.settlements[cap];
      if (c) c.buildings.shipyard = 2;
    });
    expect(dispatch(yard2, { type: 'queueShip', holdingId: cap, shipType: 'snekkja' }, env).error).toBeUndefined();
    expect(dispatch(yard2, { type: 'queueShip', holdingId: cap, shipType: 'drakkar' }, env).error?.code).toBe('shipyard');
    const poor = home('skarn', 100);
    expect(dispatch(poor, { type: 'queueShip', holdingId: cap, shipType: 'karvi' }, env).error?.code).toBe('treasury');
  });
});

describe('the build queue', () => {
  it('launches the ship exactly when its build time is over (ShipCompleted, Chronicle)', () => {
    const s0 = home('eyjar');
    const cap = capitalOf(s0);
    const before = playerShips(s0).length;
    const s1 = mustDispatch(s0, env, { type: 'queueShip', holdingId: cap, shipType: 'karvi', name: 'Gull-Wing' }).state;
    expect(s1.settlements[cap]?.holding?.shipQueue).toEqual([{ type: 'karvi', doneHour: 20 * HOURS_PER_DAY }]);
    const early = advance(s1, 20 * HOURS_PER_DAY - 1, env);
    expect(playerShips(early.state).length).toBe(before);
    const done = advance(early.state, 1, env);
    expect(playerShips(done.state).length).toBe(before + 1);
    const ev = done.events.find((e) => e.type === 'ShipCompleted');
    expect(ev).toMatchObject({ type: 'ShipCompleted', shipType: 'karvi', name: 'Gull-Wing', settlementId: cap });
    const ship = done.state.ships[(ev as { shipId: ShipId }).shipId];
    expect(ship).toMatchObject({ dockedAt: cap, hullHp: 60, sailHp: 30, ownerId: s0.player.factionId });
    expect(done.state.settlements[cap]?.holding?.shipQueue).toEqual([]);
    expect(done.state.military?.shipyards).toEqual({});
    expect(done.state.chronicle.some((c) => c.textKey === 'military.chronicle.shipLaunched')).toBe(true);
    expect(missingEventKeys(done.events)).toEqual([]);
  });

  it('builds in parallel slots by Shipyard tier (1/2/3)', () => {
    const s0 = home('eyjar');
    const cap = capitalOf(s0);
    let s1 = mustDispatch(s0, env, { type: 'queueShip', holdingId: cap, shipType: 'karvi' }).state;
    s1 = mustDispatch(s1, env, { type: 'queueShip', holdingId: cap, shipType: 'karvi' }).state;
    expect(s1.settlements[cap]?.holding?.shipQueue.map((q) => q.doneHour)).toEqual([480, 960]);
    const yard2 = edit(s0, env, (d) => {
      const c = d.settlements[cap];
      if (c) c.buildings.shipyard = 2;
    });
    let s2 = mustDispatch(yard2, env, { type: 'queueShip', holdingId: cap, shipType: 'karvi' }).state;
    s2 = mustDispatch(s2, env, { type: 'queueShip', holdingId: cap, shipType: 'karvi' }).state;
    s2 = mustDispatch(s2, env, { type: 'queueShip', holdingId: cap, shipType: 'knarr' }).state;
    expect(s2.settlements[cap]?.holding?.shipQueue.map((q) => q.doneHour)).toEqual([480, 480, 480 + 35 * 24]);
    const after = days(s2, env, 20).state;
    expect(playerShips(after).length).toBe(playerShips(s0).length + 2);
  });

  it('a Shipyard upgrade starts waiting orders at the next daily pass', () => {
    const s0 = home('eyjar');
    const cap = capitalOf(s0);
    let s = mustDispatch(s0, env, { type: 'queueShip', holdingId: cap, shipType: 'karvi' }).state;
    s = mustDispatch(s, env, { type: 'queueShip', holdingId: cap, shipType: 'karvi' }).state;
    s = edit(s, env, (d) => {
      const c = d.settlements[cap];
      if (c) c.buildings.shipyard = 2;
    });
    s = days(s, env, 1).state;
    const orders = s.military?.shipyards[cap] ?? [];
    expect(orders.map((o) => o.startHour)).toEqual([0, 24]);
    expect(s.settlements[cap]?.holding?.shipQueue.map((q) => q.doneHour)).toEqual([480, 24 + 480]);
  });

  it('cancels orders when the holding changes hands', () => {
    const s0 = home('eyjar');
    const cap = capitalOf(s0);
    const s1 = mustDispatch(s0, env, { type: 'queueShip', holdingId: cap, shipType: 'karvi' }).state;
    const lost = edit(s1, env, (d) => {
      const c = d.settlements[cap];
      if (c) c.factionId = 'fac_424242';
    });
    const r = days(lost, env, 25);
    expect(r.events.some((e) => e.type === 'ShipCompleted')).toBe(false);
    expect(r.state.military?.shipyards).toEqual({});
    expect(r.state.settlements[cap]?.holding?.shipQueue).toEqual([]);
  });

  it('caps the queue length', () => {
    let s = home('eyjar', 100000, 5000);
    const cap = capitalOf(s);
    for (let i = 0; i < content.tunables.military.shipQueueMax; i++) s = mustDispatch(s, env, { type: 'queueShip', holdingId: cap, shipType: 'karvi' }).state;
    expect(dispatch(s, { type: 'queueShip', holdingId: cap, shipType: 'karvi' }, env).error?.code).toBe('queueFull');
  });

  it('projectQueue respects slots, including fewer slots than orders already building', () => {
    const mk = (id: number, start: number | null, hours: number): ShipOrder => ({
      id: `rec_${id}`,
      type: 'karvi',
      factionId: 'fac_1',
      buildHours: hours,
      queuedHour: 0,
      startHour: start,
      doneHour: (start ?? 0) + hours,
      cost: 0,
      timberT: 0,
      timberSurcharge: 0,
    });
    const orders = [mk(1, 0, 100), mk(2, 0, 50), mk(3, null, 10), mk(4, null, 10)];
    projectQueue(orders, 1, 0);
    // Two building in one slot: the first waiting order starts when only one would remain (hour 50 → wait for 100).
    expect(orders[2]?.doneHour).toBe(110);
    expect(orders[3]?.doneHour).toBe(120);
    projectQueue(orders, 3, 0);
    // Three slots: the first waiting order starts at once, the second when it finishes (hour 10).
    expect(orders[2]?.doneHour).toBe(10);
    expect(orders[3]?.doneHour).toBe(20);
  });
});

describe('repairs, damage, sinking and prizes', () => {
  it('repairs at a shipyard for 8 s per hull point and 4 s per sail point', () => {
    const s0 = home();
    const shipId = playerShips(s0)[0] as ShipId;
    const damaged = edit(s0, env, (_d, ctx) => ctx.applyEffects([{ op: 'damageShip', shipId, hull: 30, sail: 10 }]));
    expect(damaged.ships[shipId]?.hullHp).toBe(50);
    const q = repairQuote(damaged, content, [shipId]);
    expect(q.total).toBe(30 * 8 + 10 * 4);
    const r = mustDispatch(damaged, env, { type: 'repairShip', shipIds: [shipId] });
    expect(r.state.ships[shipId]).toMatchObject({ hullHp: 80, sailHp: 40 });
    expect(r.state.factions[r.state.player.factionId]?.treasury).toBe(50000 - 280);
    expect(dispatch(r.state, { type: 'repairShip', shipIds: [shipId] }, env).error?.code).toBe('nothingToRepair');
  });

  it('refuses repairs away from a shipyard', () => {
    const s0 = home();
    const shipId = playerShips(s0)[0] as ShipId;
    const s1 = edit(s0, env, (d, ctx) => {
      ctx.applyEffects([{ op: 'damageShip', shipId, hull: 10 }]);
      const c = d.settlements[d.player.capitalId];
      if (c) c.buildings.shipyard = 0;
    });
    expect(dispatch(s1, { type: 'repairShip', shipIds: [shipId] }, env).error?.code).toBe('noShipyard');
  });

  it('a hull beaten to 0 sinks the ship and takes it out of its fleet', () => {
    let fleetId: FleetId = 'flt_0';
    const s0 = home();
    const ids = playerShips(s0);
    const s1 = edit(s0, env, (d, ctx) => {
      const f = createFleet(d, ctx, { ownerId: d.player.factionId, leaderId: d.player.rulerId, pos: { x: 0, y: 0 }, shipIds: ids, mode: 'sailing' });
      fleetId = f.id;
    });
    const r = edit(s1, env, (_d, ctx) => ctx.applyEffects([{ op: 'damageShip', shipId: ids[0] as ShipId, hull: 500, cause: 'storm' }]));
    expect(r.ships[ids[0] as ShipId]).toBeUndefined();
    expect(r.fleets[fleetId]?.shipIds).toEqual([ids[1]]);
    expect(r.chronicle.some((c) => c.textKey === 'military.chronicle.shipLost')).toBe(true);
    const r2 = edit(r, env, (_d, ctx) => ctx.applyEffects([{ op: 'sinkShip', shipId: ids[1] as ShipId, cause: 'founder' }]));
    expect(r2.fleets[fleetId]?.shipIds).toEqual([]);
    expect(r2.ships[ids[1] as ShipId]).toBeUndefined();
  });

  it('a captured ship is crewed when the fleet has the men, towed otherwise, and manned later', () => {
    let fleetId: FleetId = 'flt_0';
    let prize: ShipId = 'shp_0';
    const s0 = home();
    const ids = playerShips(s0);
    const s1 = edit(s0, env, (d, ctx) => {
      const enemy = Object.values(d.factions).find((f) => f.id !== d.player.factionId);
      const f = createFleet(d, ctx, {
        ownerId: d.player.factionId,
        leaderId: d.player.rulerId,
        pos: { x: 0, y: 0 },
        shipIds: ids,
        men: { bondi: 45 },
        mode: 'sailing',
      });
      fleetId = f.id;
      ctx.applyEffects([{ op: 'addShip', shipType: 'knarr', factionId: enemy?.id ?? d.player.factionId }]);
      prize = Object.keys(d.ships).at(-1) as ShipId;
    });
    // Two snekkjur need 40 men; a knarr 6 more: 45 men is not enough → towed.
    const towed = edit(s1, env, (_d, ctx) => ctx.applyEffects([{ op: 'captureShip', shipId: prize, fleetId }]));
    expect(towed.ships[prize]).toMatchObject({ ownerId: s0.player.factionId, locationFleetId: fleetId, towed: true });
    expect(towed.ships[prize]?.dockedAt).toBeUndefined();
    expect(towed.fleets[fleetId]?.shipIds).toContain(prize);
    const manned = edit(towed, env, (_d, ctx) => ctx.applyEffects([{ op: 'addMen', unit: 'bondi', count: 5, fleetId }]));
    const next = days(manned, env, 1).state;
    expect(next.ships[prize]?.towed).toBeUndefined();
  });

  it('beach field repair: 25% over 2 days with timber from cargo, up to the field cap', () => {
    let fleetId: FleetId = 'flt_0';
    const s0 = home();
    const ids = playerShips(s0);
    const s1 = edit(s0, env, (d, ctx) => {
      const f = createFleet(d, ctx, {
        ownerId: d.player.factionId,
        leaderId: d.player.rulerId,
        pos: { x: 5, y: 5 },
        shipIds: ids,
        cargo: { timber: 3 },
        mode: 'beached',
      });
      fleetId = f.id;
      ctx.applyEffects([{ op: 'damageShip', shipId: ids[0] as ShipId, hull: 60 }]);
    });
    expect(s1.ships[ids[0] as ShipId]?.hullHp).toBe(20);
    const d1 = days(s1, env, 1).state;
    expect(d1.ships[ids[0] as ShipId]?.hullHp).toBeCloseTo(30, 6);
    expect(d1.fleets[fleetId]?.cargo.timber).toBe(1);
    const d2 = days(d1, env, 1).state;
    expect(d2.ships[ids[0] as ShipId]?.hullHp).toBeCloseTo(40, 6);
    // A new session needs 2 t more timber; only 1 t is left.
    const d4 = days(d2, env, 2).state;
    expect(d4.ships[ids[0] as ShipId]?.hullHp).toBeCloseTo(40, 6);
    const stocked = edit(d4, env, (_d, ctx) => ctx.applyEffects([{ op: 'addGoods', good: 'timber', tons: 10, fleetId }]));
    const d10 = days(stocked, env, 10).state;
    expect(d10.ships[ids[0] as ShipId]?.hullHp).toBeCloseTo(80 * content.tunables.military.fieldRepair.maxShare, 6);
  });

  it('addShip docks a new ship at the capital or puts it in a fleet', () => {
    const s0 = home();
    const s1 = edit(s0, env, (_d, ctx) => ctx.applyEffects([{ op: 'addShip', shipType: 'riverboat', name: 'Reed-Runner' }]));
    const added = Object.values(s1.ships).find((sh) => sh.name === 'Reed-Runner');
    expect(added).toMatchObject({ type: 'riverboat', dockedAt: capitalOf(s0), ownerId: s0.player.factionId, hullHp: 40 });
  });
});
