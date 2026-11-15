/**
 * Expedition planning (SCR-07; design §6.1, §31.6): the planner's inline validation as a pure function the
 * client calls on every change, and the numbers the launch uses. Errors block the launch; warnings inform.
 *
 *   capacity   men within Σ crewMin … Σ crewMax of the chosen ships; cargo + rations within Σ cargoT
 *   leaders    alive, of the house, free, at the holding; the first leads
 *   ships      the house's, docked at the holding, not running a trade route
 *   men        from the holding's garrison
 *   rations    from the house storehouse at the capital (economy's `state.storehouse`, a count); from any other
 *              holding (or without the economy module) from its food stores: foodMonths × pop × 30 (§31.6)
 *   cargo      from the house storehouse at the capital (tons); nothing is ever taken from a market
 *   home       a garrison left behind of at least max(20, 5 % of pop) is recommended
 *
 * A MARCH (`travel: 'land'`) takes no ships: at least one man, food for at most march.foodDaysPerMan days per
 * man, and food and goods within men x march.carryTonsPerMan tons. Ice does not stop it. A warning says when no
 * road leads from the holding to any other settlement (a small island).
 */
import type { Content } from '@content/index';
import type { CharId, FleetId, GameState, GoodId, SettlementId, ShipId, UnitTypeId } from '@sim/core/state';
import type { GoodTons, Storehouse } from '../economy/types';
import type { ExpeditionIssue, ExpeditionPlan, ExpeditionPreview, TravelMode } from './types';

const DAYS_PER_MONTH = 30;

/** How a plan travels (default: by sea). */
export function travelOf(plan: Pick<ExpeditionPlan, 'travel'>): TravelMode {
  return plan.travel === 'land' ? 'land' : 'sea';
}

/** What `marchers` (the men and the leaders who march with them) carry: rations (at most `foodDaysPerMan` days each) and tons in all. */
export function marchCarry(content: Content, marchers: number): { rations: number; tons: number } {
  const m = content.tunables.expeditions.march;
  const n = Math.max(0, Math.floor(marchers));
  return { rations: Math.floor(n * m.foodDaysPerMan * content.balance.food.rationsPerManPerDay), tons: Math.round(n * m.carryTonsPerMan * 1000) / 1000 };
}

/**
 * Does a road lead from a holding to any other settlement (world's lanes with a land leg)? Unknown (no world
 * index) counts as yes.
 */
export function hasLandRoute(state: GameState, settlementId: SettlementId): boolean {
  const idx = (state as GameState & { worldIndex?: { settlements: Record<string, { lanes?: { landDays: number | null }[] }> } }).worldIndex;
  const entry = idx?.settlements[settlementId];
  if (!entry) return true;
  return (entry.lanes ?? []).some((l) => l.landDays !== null && Number.isFinite(l.landDays));
}

/** The holding a plan sets out from (default: the capital), if it is the player's. */
export function planOrigin(state: GameState, plan: Pick<ExpeditionPlan, 'fromId'>): SettlementId | null {
  const id = plan.fromId ?? state.player.capitalId;
  const s = state.settlements[id];
  return s && s.factionId === state.player.factionId ? id : null;
}

/** The house storehouse an expedition from `settlementId` loads from (the capital's, when the economy keeps one). */
export function storehouseFor(state: GameState, settlementId: SettlementId): Storehouse | undefined {
  const store = state.storehouse;
  return store !== undefined && settlementId === state.player.capitalId ? store : undefined;
}

/**
 * Rations an expedition from a holding can load: the storehouse's at the capital; elsewhere (or without the
 * economy module) what the holding's food stores can spare (§31.6: months × pop × 30).
 */
export function rationsAvailable(state: GameState, settlementId: SettlementId): number {
  const store = storehouseFor(state, settlementId);
  if (store) return Math.max(0, Math.floor(store.rations));
  const s = state.settlements[settlementId];
  if (!s?.holding) return 0;
  return Math.max(0, Math.floor(s.holding.foodMonths * Math.max(1, s.pop) * DAYS_PER_MONTH));
}

/** Tons of a trade good an expedition from a holding can load (the capital's storehouse; nothing elsewhere). */
export function cargoAvailable(state: GameState, settlementId: SettlementId, good: GoodId): number {
  return Math.max(0, storehouseFor(state, settlementId)?.goods[good] ?? 0);
}

/** What a plan needs that the storehouse lacks: rations (a count) and goods (tons). Pure. */
export function planShortfall(state: GameState, plan: Pick<ExpeditionPlan, 'fromId' | 'rations' | 'cargo'>): { rations: number; goods: GoodTons } {
  const fromId = planOrigin(state, plan) ?? state.player.capitalId;
  const rations = Math.max(0, Math.floor(plan.rations) - rationsAvailable(state, fromId));
  const goods: GoodTons = {};
  for (const [good, t] of Object.entries(plan.cargo ?? {}) as [GoodId, number][]) {
    if (good === 'rations' || !(t > 0)) continue;
    const short = Math.round((t - cargoAvailable(state, fromId, good)) * 1000) / 1000;
    if (short > 0) goods[good] = short;
  }
  return { rations, goods };
}

/** The player's expedition fleet at sea, if any. */
export function currentExpedition(state: GameState): FleetId | undefined {
  const id = state.player.expeditionFleetId;
  return id !== undefined && Object.hasOwn(state.fleets, id) ? id : undefined;
}

/** Ships of the house docked at a holding and free to sail (not on a trade route, not in a fleet). */
export function shipsAtHolding(state: GameState, settlementId: SettlementId): ShipId[] {
  const out: ShipId[] = [];
  for (const ship of Object.values(state.ships)) {
    if (ship.ownerId !== state.player.factionId || ship.dockedAt !== settlementId || ship.locationFleetId !== undefined) continue;
    if ((ship as { tradeRouteId?: string }).tradeRouteId !== undefined) continue;
    out.push(ship.id);
  }
  return out.sort();
}

/** Characters of the house who could sail from a holding (the ruler, kin and lieutenants who are there). */
export function leadersAtHolding(state: GameState, settlementId: SettlementId, adultAge: number, now: number): CharId[] {
  const out: CharId[] = [];
  for (const c of Object.values(state.characters)) {
    if (!c.alive || c.location.kind !== 'settlement' || c.location.id !== settlementId) continue;
    if (c.id !== state.player.rulerId && c.factionId !== state.player.factionId) continue;
    if ((now - c.birthHour) / (DAYS_PER_MONTH * 12 * 24) < adultAge) continue;
    if (c.id !== state.player.rulerId && c.role?.kind !== 'lieutenant' && c.role?.kind !== 'captain') continue;
    out.push(c.id);
  }
  // The ruler first, then by name.
  const name = (id: CharId) => state.characters[id]?.name ?? '';
  return out.sort((a, b) => (a === state.player.rulerId ? -1 : b === state.player.rulerId ? 1 : name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : a < b ? -1 : 1));
}

function sumMen(men: Partial<Record<UnitTypeId, number>>): number {
  let n = 0;
  for (const v of Object.values(men)) n += Math.max(0, Math.floor(v ?? 0));
  return n;
}

/** Validates a plan and computes the planner's preview (pure). */
export function validateExpedition(state: GameState, content: Content, plan: ExpeditionPlan): ExpeditionPreview {
  const b = content.balance;
  const issues: ExpeditionIssue[] = [];
  const err = (code: string, vars?: ExpeditionIssue['vars']) => issues.push({ severity: 'error', code, ...(vars ? { vars } : {}) });
  const warn = (code: string, vars?: ExpeditionIssue['vars']) => issues.push({ severity: 'warning', code, ...(vars ? { vars } : {}) });
  const fromId = planOrigin(state, plan);
  const s = fromId !== null ? state.settlements[fromId] : undefined;
  if (!s || fromId === null) err('notYourHolding');
  if (currentExpedition(state) !== undefined) err('alreadyAtSea');
  const travel = travelOf(plan);
  const land = travel === 'land';

  // Leaders.
  const leaders = plan.leaderIds.filter((id, i) => plan.leaderIds.indexOf(id) === i);
  if (leaders.length === 0) err('noLeader');
  if (leaders.length !== plan.leaderIds.length) err('duplicateLeader');
  for (const id of leaders) {
    const c = state.characters[id];
    if (!c || !c.alive) err('leaderUnavailable', { name: id });
    else if (c.location.kind !== 'settlement' || c.location.id !== fromId) err('leaderNotHere', { name: c.name });
    else if (c.id !== state.player.rulerId && c.factionId !== state.player.factionId) err('leaderNotYours', { name: c.name });
  }

  // Ships.
  let crewMin = 0;
  let crewMax = 0;
  let capacity = 0;
  let shipUpkeep = 0;
  const ships = plan.shipIds.filter((id, i) => plan.shipIds.indexOf(id) === i);
  if (land && ships.length > 0) err('marchNoShips');
  if (!land && ships.length === 0) err('noShips');
  if (ships.length !== plan.shipIds.length) err('duplicateShip');
  for (const id of land ? [] : ships) {
    const ship = state.ships[id];
    const def = ship ? b.ships[ship.type] : undefined;
    if (!ship || !def || ship.ownerId !== state.player.factionId) {
      err('shipUnavailable', { ship: id });
      continue;
    }
    if (ship.dockedAt !== fromId || ship.locationFleetId !== undefined) err('shipNotHere', { ship: ship.name });
    if ((ship as { tradeRouteId?: string }).tradeRouteId !== undefined) err('shipTrading', { ship: ship.name });
    if (ship.hullHp <= 0) err('shipWrecked', { ship: ship.name });
    crewMin += def.crewMin;
    crewMax += def.crewMax;
    capacity += def.cargoT;
    shipUpkeep += def.upkeep;
  }

  // Men.
  const men = sumMen(plan.men);
  let wages = 0;
  for (const [unit, n] of Object.entries(plan.men)) {
    const count = Math.max(0, Math.floor(n ?? 0));
    if (count === 0) continue;
    if (!Number.isInteger(n) || (n ?? 0) < 0) err('badCount', { unit });
    const have = s?.garrison[unit] ?? 0;
    if (count > have) err('notEnoughMen', { unit, have, want: count });
    wages += count * (b.units[unit]?.wage ?? 0);
  }
  if (!land && ships.length > 0 && men < crewMin) err('undermanned', { men, min: crewMin });
  if (!land && men > crewMax && ships.length > 0) err('overcrowded', { men, max: crewMax });
  if (land && men === 0) err('noMarchers');
  // On the march the leaders carry their share and eat theirs.
  const marchers = men > 0 ? men + leaders.length : 0;
  const carry = marchCarry(content, marchers);
  if (land) capacity = carry.tons;

  // Rations and cargo.
  const rations = Math.max(0, Math.floor(plan.rations));
  const available = fromId !== null ? rationsAvailable(state, fromId) : 0;
  if (!Number.isFinite(plan.rations) || plan.rations < 0) err('badRations');
  if (rations > available) err('notEnoughFood', { have: available, want: rations });
  if (land && men > 0 && rations > carry.rations) err('tooMuchFood', { days: content.tunables.expeditions.march.foodDaysPerMan });
  const perDay = Math.max(1, (land ? marchers : men) * b.food.rationsPerManPerDay);
  const rationDays = men > 0 ? Math.floor(rations / perDay) : 0;
  if (men > 0 && rationDays < 7) warn('shortRations', { days: rationDays });
  let cargoTons = rations / b.economy.rationsPerTon;
  for (const [good, t] of Object.entries(plan.cargo ?? {}) as [GoodId, number][]) {
    const tons = Math.max(0, t ?? 0);
    if (tons === 0) continue;
    if (good === 'rations') {
      err('rationsAsCargo');
      continue;
    }
    if (fromId === null || tons > cargoAvailable(state, fromId, good) + 1e-9) err('notInStores', { good });
    cargoTons += tons;
  }
  if (cargoTons > capacity + 1e-9 && ships.length > 0) err('holdFull', { tons: Math.round(cargoTons * 10) / 10, capacity });
  if (land && men > 0 && cargoTons > capacity + 1e-9) err('tooHeavy', { tons: Math.round(cargoTons * 10) / 10, capacity: Math.round(capacity * 10) / 10 });
  if (land && fromId !== null && !hasLandRoute(state, fromId)) warn('noLandRoute', { place: s?.name ?? '' });
  const silver = Math.max(0, Math.floor(plan.silver ?? 0));
  if (silver > (state.factions[state.player.factionId]?.treasury ?? 0)) err('notEnoughSilver', { silver });

  // Home defence.
  const homeGarrison = Math.max(0, sumMen(s?.garrison ?? {}) - men);
  const homeGarrisonMin = Math.max(20, Math.ceil((s?.pop ?? 0) * b.holdings.garrisonMinPopShare));
  if (s && homeGarrison < homeGarrisonMin) warn('thinGarrison', { left: homeGarrison, min: homeGarrisonMin });

  // The most rations the plan can take: the holds' free room at sea, what the men carry on the march.
  let goodsTons = 0;
  for (const [good, t] of Object.entries(plan.cargo ?? {}) as [GoodId, number][]) if (good !== 'rations') goodsTons += Math.max(0, t ?? 0);
  const roomRations = Math.max(0, Math.floor((capacity - goodsTons) * b.economy.rationsPerTon + 1e-6));
  const rationsCapacity = land ? Math.min(carry.rations, roomRations) : roomRations;

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
    fromId,
    men,
    crewMin,
    crewMax,
    cargoTons: Math.round(cargoTons * 100) / 100,
    cargoCapacity: capacity,
    rationsAvailable: available,
    rationDays,
    homeGarrison,
    homeGarrisonMin,
    upkeepPerMonth: Math.round(wages + shipUpkeep),
    travel,
    rationsCapacity,
  };
}

/**
 * A sensible default plan (the planner's starting point and "Quick muster"): the ruler and the first
 * lieutenant, as many free ships as the garrison can crew, men up to the crews' capacity while leaving the
 * recommended garrison (but never fewer than the ships' minimum crews: the thin-garrison warning says so),
 * and rations for `days` days (or what the stores and holds can take; with `ignoreStores`, what the holds can
 * take, so the shortfall can be bought).
 */
export function suggestPlan(state: GameState, content: Content, days = 30, opts: { ignoreStores?: boolean; travel?: TravelMode } = {}): ExpeditionPlan {
  const b = content.balance;
  const fromId = planOrigin(state, {}) ?? state.player.capitalId;
  const s = state.settlements[fromId];
  const leaders = leadersAtHolding(state, fromId, b.character.adultAge, state.time.hour).slice(0, 2);
  const total = sumMen(s?.garrison ?? {});
  if (opts.travel === 'land') return suggestMarch(state, content, days, opts.ignoreStores === true, fromId, leaders, total);
  // Ships the garrison can crew, the largest holds first.
  const def = (id: ShipId) => b.ships[state.ships[id]?.type ?? 'snekkja'];
  const free = shipsAtHolding(state, fromId).sort((x, y) => (def(y)?.cargoT ?? 0) - (def(x)?.cargoT ?? 0) || (x < y ? -1 : 1));
  const ships: ShipId[] = [];
  let crewMin = 0;
  let crewMax = 0;
  for (const id of free) {
    const d = def(id);
    if (!d || crewMin + d.crewMin > total) continue;
    ships.push(id);
    crewMin += d.crewMin;
    crewMax += d.crewMax;
  }
  ships.sort();
  const keep = Math.max(20, Math.ceil((s?.pop ?? 0) * b.holdings.garrisonMinPopShare));
  let room = ships.length === 0 ? 0 : Math.min(crewMax, total, Math.max(crewMin, total - keep));
  const men: Partial<Record<UnitTypeId, number>> = {};
  // Best units first (by wage), so the levy stays home.
  const units = Object.keys(s?.garrison ?? {}).sort((x, y) => (b.units[y]?.wage ?? 0) - (b.units[x]?.wage ?? 0) || (x < y ? -1 : 1));
  for (const u of units) {
    if (room <= 0) break;
    const take = Math.min(room, s?.garrison[u] ?? 0);
    if (take > 0) men[u] = take;
    room -= take;
  }
  const n = sumMen(men);
  let capacity = 0;
  for (const id of ships) capacity += def(id)?.cargoT ?? 0;
  const perDay = Math.max(1, n * b.food.rationsPerManPerDay);
  const stores = opts.ignoreStores === true ? Infinity : rationsAvailable(state, fromId);
  const rations = Math.max(0, Math.min(Math.ceil(perDay * days), stores, Math.floor(capacity * b.economy.rationsPerTon)));
  return { fromId, leaderIds: leaders, shipIds: ships, men, rations };
}

/**
 * The march's default plan: the leaders as by sea, every man but the recommended garrison (best units first; at
 * least one man when the garrison has any), and food for `days` days within what the men carry and the stores
 * hold.
 */
function suggestMarch(state: GameState, content: Content, days: number, ignoreStores: boolean, fromId: SettlementId, leaders: CharId[], total: number): ExpeditionPlan {
  const b = content.balance;
  const s = state.settlements[fromId];
  const keep = Math.max(20, Math.ceil((s?.pop ?? 0) * b.holdings.garrisonMinPopShare));
  let room = total - keep > 0 ? total - keep : Math.ceil(total / 2);
  const men: Partial<Record<UnitTypeId, number>> = {};
  const units = Object.keys(s?.garrison ?? {}).sort((x, y) => (b.units[y]?.wage ?? 0) - (b.units[x]?.wage ?? 0) || (x < y ? -1 : 1));
  for (const u of units) {
    if (room <= 0) break;
    const take = Math.min(room, s?.garrison[u] ?? 0);
    if (take > 0) men[u] = take;
    room -= take;
  }
  const n = sumMen(men);
  const marchers = n > 0 ? n + leaders.length : 0;
  const carry = marchCarry(content, marchers);
  const perDay = Math.max(1, marchers * b.food.rationsPerManPerDay);
  const stores = ignoreStores ? Infinity : rationsAvailable(state, fromId);
  const rations = Math.max(0, Math.min(Math.ceil(perDay * days), stores, carry.rations, Math.floor(carry.tons * b.economy.rationsPerTon)));
  return { fromId, leaderIds: leaders, shipIds: [], men, rations, travel: 'land' };
}
