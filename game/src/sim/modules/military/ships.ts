/**
 * Ships and the shipyard (§12.7, §10.4): the build queue per holding with parallel slots by Shipyard
 * tier, timber or a timber surcharge, culture/ruler modifiers (`ship.costPct`, `ship.buildTimePct`:
 * Skarn −15% cost / −20% time, Hvarn +10% cost), launches (ShipCompleted), shipyard repair (8 s per
 * hull point, 4 s per sail point), beach field repair, and the damageShip / sinkShip / captureShip /
 * addShip effects used by weather, the sea battle and storylets.
 */
import type { Content } from '@content/index';
import type { Balance, ShipDef } from '@content/schemas/balance';
import { SHIP_TYPE_IDS, type ShipTypeId } from '@content/schemas/ids';
import { CommandError } from '@sim/core/commands';
import { baseState } from '@sim/core/context';
import { EffectError } from '@sim/core/effects';
import type { SimEventOf } from '@sim/core/events';
import { createShip } from '@sim/core/factory';
import type { SimContext } from '@sim/core/module';
import type { FactionId, Fleet, FleetId, GameState, Hour, SettlementId, Ship, ShipId } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { sumMen } from './men';
import { buildingList, buildingNumber, buildingTier, distance, factionCapitalId, holdingIdsOf, holdingOf, realmModifier } from './realm';
import { militaryOf, refreshNextDue, shipOrdersOf } from './slice';
import type {
  AddShipEffect,
  CaptureShipEffect,
  DamageShipEffect,
  QueueShipCommand,
  RepairShipCommand,
  ShipOrder,
  SinkShipEffect,
} from './types';

/** The ship definition for a type id, or undefined for unknown ids. */
export function findShipDef(balance: Balance, type: string): ShipDef | undefined {
  return (SHIP_TYPE_IDS as readonly string[]).includes(type) ? balance.ships[type as ShipTypeId] : undefined;
}

/** Parallel build slots of a holding's shipyard (0 without one). */
export function shipyardSlots(state: GameState, balance: Balance, holdingId: SettlementId): number {
  const tier = buildingTier(state.settlements[holdingId], 'shipyard');
  return tier > 0 ? Math.max(0, Math.floor(buildingNumber(balance, 'shipyard', tier, 'parallelBuilds'))) : 0;
}

/** Ship types a holding's shipyard can build (its tier's `ships` list, buildable types only). */
export function buildableShips(state: GameState, balance: Balance, holdingId: SettlementId): ShipTypeId[] {
  const tier = buildingTier(state.settlements[holdingId], 'shipyard');
  if (tier <= 0) return [];
  const listed = buildingList(balance, 'shipyard', tier, 'ships');
  return SHIP_TYPE_IDS.filter((t) => listed.includes(t) && balance.ships[t].buildable && balance.ships[t].shipyardTier <= tier);
}

/** Ship cost and build days for a faction after `ship.costPct` / `ship.buildTimePct` modifiers. */
export function shipPrice(state: GameState, content: Content, factionId: FactionId, type: ShipTypeId): { cost: number; days: number; costPct: number; timePct: number } {
  const def = content.balance.ships[type];
  const costPct = realmModifier(state, content, factionId, 'ship.costPct');
  const timePct = realmModifier(state, content, factionId, 'ship.buildTimePct');
  return {
    cost: Math.max(0, Math.round(def.cost * (1 + costPct / 100))),
    days: Math.max(1, Math.round(def.buildDays * (1 + timePct / 100))),
    costPct,
    timePct,
  };
}

/**
 * Projects when each waiting order starts and finishes, given the orders already building and the
 * number of parallel slots (orders start in queue order as slots free up). Waiting orders keep
 * `startHour: null`; their `doneHour` becomes the projection. With no slots nothing is projected.
 */
export function projectQueue(orders: ShipOrder[], slots: number, now: Hour): void {
  if (slots <= 0) return;
  let active: number[] = [];
  for (const o of orders) if (o.startHour !== null) active.push(o.doneHour);
  for (const o of orders) {
    if (o.startHour !== null) continue;
    active.sort((a, b) => a - b);
    let start = now;
    if (active.length >= slots) start = Math.max(now, active[active.length - slots] as number);
    active = active.filter((end) => end > start);
    o.doneHour = start + o.buildHours;
    active.push(o.doneHour);
  }
}

/** A rule a ship order breaks (the first is the command's error code). */
export type ShipOrderIssue = 'notYourHolding' | 'unknownShip' | 'notBuildable' | 'shipyard' | 'queueFull' | 'timber' | 'treasury';

/** What the Shipyard screen shows for one order. */
export interface ShipOrderPreview {
  holdingId: SettlementId;
  shipType: string;
  shipyardTier: number;
  requiredTier: number;
  slots: number;
  queueLength: number;
  queueMax: number;
  baseCost: number;
  costPct: number;
  cost: number;
  baseDays: number;
  timePct: number;
  buildDays: number;
  timberT: number;
  timberFromMarket: number;
  timberMissing: number;
  timberSurcharge: number;
  total: number;
  projectedDoneHour: Hour;
  issues: ShipOrderIssue[];
  ok: boolean;
}

/** Pure preview of `queueShip` for the player's faction. */
export function shipOrderPreview(state: GameState, content: Content, cmd: QueueShipCommand): ShipOrderPreview {
  const balance = content.balance;
  const factionId = state.player.factionId;
  const holding = holdingOf(state, cmd.holdingId, factionId);
  const def = findShipDef(balance, cmd.shipType);
  const issues: ShipOrderIssue[] = [];
  if (!holding) issues.push('notYourHolding');
  const shipyardTier = buildingTier(state.settlements[cmd.holdingId], 'shipyard');
  const slots = shipyardSlots(state, balance, cmd.holdingId);
  const orders = shipOrdersOf(state, cmd.holdingId);
  const queueMax = content.tunables.military.shipQueueMax;
  let cost = 0;
  let days = 0;
  let costPct = 0;
  let timePct = 0;
  if (!def) issues.push('unknownShip');
  else {
    if (!def.buildable) issues.push('notBuildable');
    else if (!buildableShips(state, balance, cmd.holdingId).includes(cmd.shipType)) issues.push('shipyard');
    const price = shipPrice(state, content, factionId, cmd.shipType);
    cost = price.cost;
    days = price.days;
    costPct = price.costPct;
    timePct = price.timePct;
  }
  if (orders.length >= queueMax) issues.push('queueFull');
  const timberT = def?.timberT ?? 0;
  const stock = state.markets[cmd.holdingId]?.stock.timber ?? 0;
  const timberFromMarket = Math.min(timberT, Math.max(0, stock));
  const timberMissing = Math.max(0, timberT - timberFromMarket);
  const buyTimber = cmd.buyTimber ?? true;
  const timberSurcharge = Math.ceil(timberMissing * balance.shipyard.timberSurchargePerTon);
  if (timberMissing > 0 && !buyTimber) issues.push('timber');
  const total = cost + (buyTimber ? timberSurcharge : 0);
  if (total > (state.factions[factionId]?.treasury ?? 0)) issues.push('treasury');
  const projected: ShipOrder[] = orders.map((o) => ({ ...o }));
  const probe: ShipOrder = {
    id: 'rec_preview',
    type: (def ? cmd.shipType : 'karvi') as ShipTypeId,
    factionId,
    buildHours: days * HOURS_PER_DAY,
    queuedHour: state.time.hour,
    startHour: null,
    doneHour: state.time.hour + days * HOURS_PER_DAY,
    cost: total,
    timberT: timberFromMarket,
    timberSurcharge: buyTimber ? timberSurcharge : 0,
  };
  projected.push(probe);
  projectQueue(projected, slots, state.time.hour);
  return {
    holdingId: cmd.holdingId,
    shipType: cmd.shipType,
    shipyardTier,
    requiredTier: def?.shipyardTier ?? 0,
    slots,
    queueLength: orders.length,
    queueMax,
    baseCost: def?.cost ?? 0,
    costPct,
    cost,
    baseDays: def?.buildDays ?? 0,
    timePct,
    buildDays: days,
    timberT,
    timberFromMarket,
    timberMissing,
    timberSurcharge: buyTimber ? timberSurcharge : 0,
    total,
    projectedDoneHour: probe.doneHour,
    issues,
    ok: issues.length === 0,
  };
}

/** Writes the public mirror `holding.shipQueue` from the canonical orders. */
function syncMirror(draft: GameState, holdingId: SettlementId, orders: readonly ShipOrder[]): void {
  const holding = draft.settlements[holdingId]?.holding;
  if (!holding) return;
  holding.shipQueue = orders.map((o) => ({ type: o.type, doneHour: o.doneHour }));
}

/** Starts waiting orders whose projected start has come. */
function startDue(orders: ShipOrder[], slots: number, now: Hour): void {
  projectQueue(orders, slots, now);
  let building = orders.filter((o) => o.startHour !== null).length;
  for (const o of orders) {
    if (building >= slots) break;
    if (o.startHour !== null) continue;
    const start = o.doneHour - o.buildHours;
    if (start > now) break;
    o.startHour = start;
    building += 1;
  }
}

/** `queueShip` handler. */
export function handleQueueShip(draft: GameState, cmd: QueueShipCommand, ctx: SimContext): void {
  const p = shipOrderPreview(draft, ctx.content, cmd);
  const first = p.issues[0];
  if (first) throw new CommandError(first, `queueShip rejected: ${first}`);
  const factionId = draft.player.factionId;
  const effects: Parameters<SimContext['applyEffects']>[0][number][] = [{ op: 'addSilver', amount: -p.total, factionId }];
  if (p.timberFromMarket > 0) effects.push({ op: 'addGoods', good: 'timber', tons: -p.timberFromMarket, settlementId: cmd.holdingId });
  ctx.applyEffects(effects);
  const m = militaryOf(draft);
  const orders = Object.hasOwn(m.shipyards, cmd.holdingId) ? (m.shipyards[cmd.holdingId] as ShipOrder[]) : (m.shipyards[cmd.holdingId] = []);
  const order: ShipOrder = {
    id: ctx.newId('rec'),
    type: cmd.shipType,
    factionId,
    buildHours: p.buildDays * HOURS_PER_DAY,
    queuedHour: ctx.hour,
    startHour: null,
    doneHour: ctx.hour + p.buildDays * HOURS_PER_DAY,
    cost: p.total,
    timberT: p.timberFromMarket,
    timberSurcharge: p.timberSurcharge,
  };
  if (cmd.name !== undefined && cmd.name.trim().length > 0) order.name = cmd.name.trim();
  orders.push(order);
  startDue(orders, p.slots, ctx.hour);
  syncMirror(draft, cmd.holdingId, orders);
  refreshNextDue(m);
}

function launch(draft: GameState, ctx: SimContext, holdingId: SettlementId, order: ShipOrder): void {
  const s = draft.settlements[holdingId];
  if (!s) return;
  const opts: Parameters<typeof createShip>[2] = { type: order.type, ownerId: s.factionId, homeName: s.name, dockedAt: s.id };
  if (order.name !== undefined) opts.name = order.name;
  const ship = createShip(draft, ctx, opts);
  ctx.emit({ type: 'ShipCompleted', shipId: ship.id, shipType: ship.type, name: ship.name, settlementId: s.id, factionId: s.factionId });
  if (s.factionId === draft.player.factionId) {
    ctx.notify('military.ship.completed', {
      vars: { holding: s.name, shipType: ship.type, ship: ship.name },
      link: { kind: 'settlement', id: s.id },
    });
    ctx.chronicle({
      kind: 'military.shipLaunched',
      textKey: 'military.chronicle.shipLaunched',
      importance: ship.type === 'drakkar' ? 2 : 1,
      vars: { ship: ship.name, shipType: ship.type, holding: s.name },
      refs: [ship.id, s.id],
    });
  }
}

/** Launches finished ships and starts waiting orders (all queues). */
export function processShipyards(draft: GameState, ctx: SimContext): void {
  const m = militaryOf(draft);
  for (const key of Object.keys(m.shipyards)) {
    const holdingId = key as SettlementId;
    const orders = m.shipyards[holdingId];
    if (!orders || orders.length === 0) {
      delete m.shipyards[holdingId];
      continue;
    }
    const s = draft.settlements[holdingId];
    if (!s || !s.holding) {
      delete m.shipyards[holdingId];
      continue;
    }
    let changed = dropForeignOrders(orders, s.factionId);
    const slots = shipyardSlots(draft, ctx.balance, holdingId);
    for (let guard = 0; guard < orders.length + 1; guard++) {
      const done = orders.filter((o) => o.startHour !== null && o.doneHour <= ctx.hour).sort((a, b) => a.doneHour - b.doneHour);
      if (done.length === 0) break;
      for (const o of done) {
        orders.splice(orders.indexOf(o), 1);
        launch(draft, ctx, holdingId, o);
      }
      startDue(orders, slots, ctx.hour);
      changed = true;
    }
    if (changed) syncMirror(draft, holdingId, orders);
    if (orders.length === 0) delete m.shipyards[holdingId];
  }
}

/** Removes orders placed by a faction that no longer owns the shipyard (the work is lost). */
function dropForeignOrders(orders: ShipOrder[], ownerId: FactionId): boolean {
  const before = orders.length;
  for (let i = orders.length - 1; i >= 0; i--) if (orders[i]?.factionId !== ownerId) orders.splice(i, 1);
  return orders.length !== before;
}

/**
 * Daily: orders at holdings that changed hands are cancelled; shipyard upgrades start waiting orders
 * early; projections and the public mirror are refreshed.
 */
export function dailyShipyards(draft: GameState, ctx: SimContext): void {
  const m = militaryOf(draft);
  for (const key of Object.keys(m.shipyards)) {
    const holdingId = key as SettlementId;
    const orders = m.shipyards[holdingId] ?? [];
    const s = draft.settlements[holdingId];
    if (s?.holding) dropForeignOrders(orders, s.factionId);
    if (!s || !s.holding || orders.length === 0) {
      delete m.shipyards[holdingId];
      if (s?.holding) s.holding.shipQueue = [];
      continue;
    }
    startDue(orders, shipyardSlots(draft, ctx.balance, holdingId), ctx.hour);
    syncMirror(draft, holdingId, orders);
  }
}

// ---------------------------------------------------------------------------------------------
// Repairs

/** Where a ship can be repaired: the player's holding with a shipyard whose harbour it lies in. */
export function repairYardFor(state: GameState, content: Content, ship: Ship): SettlementId | undefined {
  const factionId = state.player.factionId;
  if (ship.dockedAt !== undefined) {
    const s = holdingOf(state, ship.dockedAt, factionId);
    return s && buildingTier(s, 'shipyard') > 0 ? s.id : undefined;
  }
  if (ship.locationFleetId === undefined) return undefined;
  const fleet = state.fleets[ship.locationFleetId];
  if (!fleet || fleet.mode !== 'docked') return undefined;
  const radius = content.tunables.military.dockRadius;
  let best: SettlementId | undefined;
  let bestDist = Infinity;
  for (const id of holdingIdsOf(state, factionId)) {
    const s = state.settlements[id];
    if (!s || buildingTier(s, 'shipyard') <= 0) continue;
    const d = distance(fleet.pos, s.mapPos);
    if (d <= radius && d < bestDist) {
      best = id;
      bestDist = d;
    }
  }
  return best;
}

/** Silver to repair a ship fully at a shipyard (§12.7: repairPerHull × hull + repairPerSail × sail missing). */
export function repairCost(balance: Balance, ship: Ship): number {
  const def = findShipDef(balance, ship.type);
  if (!def) return 0;
  const hull = Math.max(0, def.hull - ship.hullHp);
  const sail = Math.max(0, def.sail - ship.sailHp);
  return Math.ceil(hull * balance.shipyard.repairPerHull + sail * balance.shipyard.repairPerSail);
}

export type RepairIssue = 'unknownShip' | 'notYourShip' | 'noShipyard' | 'nothingToRepair' | 'treasury';

/** Pure repair quote for the player's ships. */
export function repairQuote(
  state: GameState,
  content: Content,
  shipIds: readonly ShipId[],
): { ships: { shipId: ShipId; cost: number; yardId?: SettlementId; issue?: RepairIssue }[]; total: number; issues: RepairIssue[]; ok: boolean } {
  const ships: { shipId: ShipId; cost: number; yardId?: SettlementId; issue?: RepairIssue }[] = [];
  const issues: RepairIssue[] = [];
  let total = 0;
  for (const shipId of shipIds) {
    const ship = state.ships[shipId];
    if (!ship) {
      ships.push({ shipId, cost: 0, issue: 'unknownShip' });
      if (!issues.includes('unknownShip')) issues.push('unknownShip');
      continue;
    }
    if (ship.ownerId !== state.player.factionId) {
      ships.push({ shipId, cost: 0, issue: 'notYourShip' });
      if (!issues.includes('notYourShip')) issues.push('notYourShip');
      continue;
    }
    const cost = repairCost(content.balance, ship);
    const yardId = repairYardFor(state, content, ship);
    if (yardId === undefined && cost > 0) {
      ships.push({ shipId, cost, issue: 'noShipyard' });
      if (!issues.includes('noShipyard')) issues.push('noShipyard');
      continue;
    }
    const row: { shipId: ShipId; cost: number; yardId?: SettlementId } = { shipId, cost };
    if (yardId !== undefined) row.yardId = yardId;
    ships.push(row);
    total += cost;
  }
  if (issues.length === 0 && total === 0) issues.push('nothingToRepair');
  if (total > (state.factions[state.player.factionId]?.treasury ?? 0)) issues.push('treasury');
  return { ships, total, issues, ok: issues.length === 0 };
}

/** `repairShip` handler: full repair at the shipyard for silver. */
export function handleRepairShip(draft: GameState, cmd: RepairShipCommand, ctx: SimContext): void {
  const q = repairQuote(draft, ctx.content, cmd.shipIds);
  const first = q.issues[0];
  if (first) throw new CommandError(first, `repairShip rejected: ${first}`);
  ctx.applyEffects([{ op: 'addSilver', amount: -q.total, factionId: draft.player.factionId }]);
  for (const row of q.ships) {
    const ship = draft.ships[row.shipId];
    const def = ship ? findShipDef(ctx.balance, ship.type) : undefined;
    if (!ship || !def) continue;
    ship.hullHp = def.hull;
    ship.sailHp = def.sail;
    delete ship.fieldRepairDays;
  }
}

/**
 * Daily: beach field repair (§12.7: 25% over 2 days with timber from the cargo, up to
 * fieldRepair.maxShare). Beached fleets and damaged ships are found in the operation's base state, so
 * a fleet that beaches (or a ship damaged) earlier in the same operation starts repairs at the next
 * operation; only ships that need work are touched through the draft.
 */
export function dailyFieldRepair(draft: GameState, ctx: SimContext): void {
  const fr = ctx.tunables.military.fieldRepair;
  const yard = ctx.balance.shipyard;
  const days = Math.max(1, yard.fieldRepairDays);
  const perDay = yard.fieldRepairShare / days;
  const base = baseState(draft);
  for (const id in base.fleets) {
    const bf = base.fleets[id as FleetId];
    if (!bf || bf.mode !== 'beached' || bf.shipIds.length === 0) continue;
    let fleet: Fleet | undefined;
    for (const shipId of bf.shipIds) {
      const bs = base.ships[shipId];
      const def = bs ? findShipDef(ctx.balance, bs.type) : undefined;
      if (!bs || !def) continue;
      if (bs.fieldRepairDays === undefined && bs.hullHp >= def.hull * fr.maxShare && bs.sailHp >= def.sail * fr.maxShare) continue;
      fleet ??= draft.fleets[id as FleetId];
      const ship = draft.ships[shipId];
      if (!fleet || !ship || ship.locationFleetId !== fleet.id) continue;
      const hullCap = def.hull * fr.maxShare;
      const sailCap = def.sail * fr.maxShare;
      if (ship.hullHp >= hullCap && ship.sailHp >= sailCap) {
        if (ship.fieldRepairDays !== undefined) delete ship.fieldRepairDays;
        continue;
      }
      let session = ship.fieldRepairDays;
      if (session === undefined) {
        // A new session needs timber from the cargo (§12.7).
        const timber = fleet.cargo.timber ?? 0;
        if (timber + 1e-9 < fr.timberPerShip) continue;
        if (fr.timberPerShip > 0) ctx.applyEffects([{ op: 'addGoods', good: 'timber', tons: -fr.timberPerShip, fleetId: fleet.id }]);
        session = 0;
      }
      if (ship.hullHp < hullCap) ship.hullHp = Math.min(hullCap, ship.hullHp + perDay * def.hull);
      if (ship.sailHp < sailCap) ship.sailHp = Math.min(sailCap, ship.sailHp + perDay * def.sail);
      session += 1;
      if (session >= days) delete ship.fieldRepairDays;
      else ship.fieldRepairDays = session;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Crews, prizes and losses

/** Crew status of a fleet: men aboard versus the minimum crews of its crewed (not towed) ships. */
export function fleetCrewStatus(state: GameState, balance: Balance, fleetId: FleetId): { men: number; crewMin: number; crewMax: number; towed: number } {
  const fleet = state.fleets[fleetId];
  if (!fleet) return { men: 0, crewMin: 0, crewMax: 0, towed: 0 };
  let crewMin = 0;
  let crewMax = 0;
  let towed = 0;
  for (const id of fleet.shipIds) {
    const ship = state.ships[id];
    const def = ship ? findShipDef(balance, ship.type) : undefined;
    if (!ship || !def) continue;
    if (ship.towed) towed += 1;
    else {
      crewMin += def.crewMin;
      crewMax += def.crewMax;
    }
  }
  return { men: sumMen(fleet.men), crewMin, crewMax, towed };
}

/** Daily: towed prizes are manned once their fleet has the men for their minimum crew. */
export function dailyTowed(draft: GameState, ctx: SimContext): void {
  const ships = baseState(draft.ships);
  const fleets: FleetId[] = [];
  for (const id in ships) {
    const s = ships[id as ShipId];
    if (s?.towed && s.locationFleetId !== undefined && !fleets.includes(s.locationFleetId)) fleets.push(s.locationFleetId);
  }
  for (const fleetId of fleets) {
    const fleet = draft.fleets[fleetId];
    if (!fleet) continue;
    let spare = fleetCrewStatus(draft, ctx.balance, fleetId);
    for (const shipId of fleet.shipIds) {
      const ship = draft.ships[shipId];
      const def = ship ? findShipDef(ctx.balance, ship.type) : undefined;
      if (!ship?.towed || !def) continue;
      if (spare.men - spare.crewMin < def.crewMin) continue;
      delete ship.towed;
      spare = { ...spare, crewMin: spare.crewMin + def.crewMin };
    }
  }
}

function detachShip(draft: GameState, ship: Ship): void {
  if (ship.locationFleetId !== undefined) {
    const fleet = draft.fleets[ship.locationFleetId];
    if (fleet) fleet.shipIds = fleet.shipIds.filter((id) => id !== ship.id);
    delete ship.locationFleetId;
  }
  delete ship.dockedAt;
  if (ship.transitId !== undefined) {
    const m = draft.military;
    const t = m?.transfers.find((x) => x.id === ship.transitId);
    if (t) t.shipIds = t.shipIds.filter((id) => id !== ship.id);
    delete ship.transitId;
  }
}

function attachToFleet(draft: GameState, ship: Ship, fleet: Fleet): void {
  detachShip(draft, ship);
  if (!fleet.shipIds.includes(ship.id)) fleet.shipIds.push(ship.id);
  ship.locationFleetId = fleet.id;
}

/** Removes a ship from the world (sinkShip and a hull beaten to 0). */
export function sinkShipNow(draft: GameState, ctx: SimContext, shipId: ShipId, cause: string): void {
  const ship = draft.ships[shipId];
  if (!ship) return;
  const fleetId = ship.locationFleetId;
  detachShip(draft, ship);
  delete draft.ships[shipId];
  const event: SimEventOf<'ShipSunk'> = { type: 'ShipSunk', shipId, shipType: ship.type, name: ship.name, ownerId: ship.ownerId, cause };
  if (fleetId !== undefined) event.fleetId = fleetId;
  ctx.emit(event);
  if (ship.ownerId === draft.player.factionId) {
    ctx.notify('military.ship.sunk', { priority: 'high', vars: { ship: ship.name, shipType: ship.type, cause } });
    ctx.chronicle({
      kind: 'military.shipLost',
      textKey: 'military.chronicle.shipLost',
      importance: 2,
      vars: { ship: ship.name, shipType: ship.type, cause },
      refs: [shipId],
    });
  }
}

/** damageShip effect. */
export function applyDamageShip(draft: GameState, e: DamageShipEffect, ctx: SimContext): void {
  const ship = draft.ships[e.shipId];
  if (!ship) throw new EffectError(`damageShip: unknown ship ${e.shipId}`);
  const def = findShipDef(ctx.balance, ship.type);
  if (!def) throw new EffectError(`damageShip: ship ${e.shipId} has unknown type ${ship.type}`);
  const hull = e.hull ?? 0;
  const sail = e.sail ?? 0;
  if (!Number.isFinite(hull) || !Number.isFinite(sail)) throw new EffectError('damageShip: hull and sail must be finite');
  ship.hullHp = Math.min(def.hull, Math.max(0, ship.hullHp - hull));
  ship.sailHp = Math.min(def.sail, Math.max(0, ship.sailHp - sail));
  if (ship.hullHp <= 0) sinkShipNow(draft, ctx, ship.id, e.cause ?? 'damage');
}

/** sinkShip effect. */
export function applySinkShip(draft: GameState, e: SinkShipEffect, ctx: SimContext): void {
  if (!draft.ships[e.shipId]) throw new EffectError(`sinkShip: unknown ship ${e.shipId}`);
  sinkShipNow(draft, ctx, e.shipId, e.cause ?? 'lost');
}

/** captureShip effect: the prize joins a fleet (crewed when the men suffice, else towed) or docks at a settlement. */
export function applyCaptureShip(draft: GameState, e: CaptureShipEffect, ctx: SimContext): void {
  const ship = draft.ships[e.shipId];
  if (!ship) throw new EffectError(`captureShip: unknown ship ${e.shipId}`);
  const def = findShipDef(ctx.balance, ship.type);
  if (!def) throw new EffectError(`captureShip: ship ${e.shipId} has unknown type ${ship.type}`);
  if (e.fleetId !== undefined && e.settlementId !== undefined) throw new EffectError('captureShip: give fleetId or settlementId, not both');
  const fleet = e.fleetId !== undefined ? draft.fleets[e.fleetId] : undefined;
  if (e.fleetId !== undefined && !fleet) throw new EffectError(`captureShip: unknown fleet ${e.fleetId}`);
  const dock = e.settlementId !== undefined ? draft.settlements[e.settlementId] : undefined;
  if (e.settlementId !== undefined && !dock) throw new EffectError(`captureShip: unknown settlement ${e.settlementId}`);
  const toFactionId = e.factionId ?? fleet?.ownerId ?? dock?.factionId ?? draft.player.factionId;
  if (!draft.factions[toFactionId]) throw new EffectError(`captureShip: unknown faction ${toFactionId}`);
  const fromFactionId = ship.ownerId;
  ship.ownerId = toFactionId;
  delete ship.fieldRepairDays;
  let towed = false;
  if (fleet) {
    const crew = fleetCrewStatus(draft, ctx.balance, fleet.id);
    towed = crew.men - crew.crewMin < def.crewMin;
    attachToFleet(draft, ship, fleet);
  } else if (dock) {
    detachShip(draft, ship);
    ship.dockedAt = dock.id;
  } else {
    detachShip(draft, ship);
    const home = factionCapitalId(draft, toFactionId);
    if (home !== undefined) ship.dockedAt = home;
  }
  if (towed) ship.towed = true;
  else delete ship.towed;
  const event: SimEventOf<'ShipCaptured'> = {
    type: 'ShipCaptured',
    shipId: ship.id,
    shipType: ship.type,
    name: ship.name,
    fromFactionId,
    toFactionId,
    towed,
  };
  if (fleet) event.fleetId = fleet.id;
  ctx.emit(event);
  if (toFactionId === draft.player.factionId) {
    ctx.chronicle({
      kind: 'military.shipCaptured',
      textKey: 'military.chronicle.shipCaptured',
      importance: 2,
      vars: { ship: ship.name, shipType: ship.type },
      refs: [ship.id],
    });
  }
}

/** addShip effect: a new ship docked at a settlement (default: the faction's capital) or joining a fleet. */
export function applyAddShip(draft: GameState, e: AddShipEffect, ctx: SimContext): void {
  const def = findShipDef(ctx.balance, e.shipType);
  if (!def) throw new EffectError(`addShip: unknown ship type ${e.shipType}`);
  if (e.fleetId !== undefined && e.settlementId !== undefined) throw new EffectError('addShip: give fleetId or settlementId, not both');
  const fleet = e.fleetId !== undefined ? draft.fleets[e.fleetId] : undefined;
  if (e.fleetId !== undefined && !fleet) throw new EffectError(`addShip: unknown fleet ${e.fleetId}`);
  const ownerId = e.factionId ?? fleet?.ownerId ?? draft.player.factionId;
  if (!draft.factions[ownerId]) throw new EffectError(`addShip: unknown faction ${ownerId}`);
  const dockId = fleet ? undefined : (e.settlementId ?? factionCapitalId(draft, ownerId));
  const dock = dockId !== undefined ? draft.settlements[dockId] : undefined;
  if (e.settlementId !== undefined && !dock) throw new EffectError(`addShip: unknown settlement ${e.settlementId}`);
  const opts: Parameters<typeof createShip>[2] = { type: e.shipType, ownerId };
  if (dock) {
    opts.dockedAt = dock.id;
    opts.homeName = dock.name;
  }
  if (e.name !== undefined) opts.name = e.name;
  const ship = createShip(draft, ctx, opts);
  if (fleet) attachToFleet(draft, ship, fleet);
}

/** Ships of a faction (optionally of one type). */
export function shipsOf(state: GameState, factionId: FactionId, type?: ShipTypeId): Ship[] {
  const out: Ship[] = [];
  for (const id in state.ships) {
    const s = state.ships[id as ShipId];
    if (s && s.ownerId === factionId && (type === undefined || s.type === type)) out.push(s);
  }
  return out;
}
