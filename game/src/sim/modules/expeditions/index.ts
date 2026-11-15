/**
 * 'expeditions' simulation module (scheduler order 40).
 * Scope: Expedition planner validation, sailing, rowing, beaching, provisions, morale, landfall and overland travel, Return to Ships (§6.1, §8.3-8.7).
 * Owns (src/sim/core/ownership.ts — implement exactly these; never another module's):
 *   effects: spawnFleet
 *   commands: planExpedition, launchExpedition, setRoute, makeLandfall, returnToShips, returnHome
 *   module-owned command: steer (the player holds a heading; world's steerEntity moves the entity)
 *   state slices: fleets
 * Module-owned additions: events ExpeditionLaunched, ExpeditionReturned, FleetSpawned, LandfallMade,
 *   PartyReturned, FleetStarving, ExpeditionLost, ExpeditionLeaderless; condition fns atSea, rationDays, fleetMorale,
 *   voyageDays; state `expeditions`; reacts to Arrived and PendingResolved.
 * Effects used (owned elsewhere): world computeRoute; military moveMen, spawnArmy, disbandArmy, killMen, addShip,
 *   sinkShip; people woundCharacter;
 *   economy changeStores (the house storehouse at the capital).
 * Tunables: src/content/data/tunables/expeditions.json (+ schemas/tunables/expeditions.ts), read as ctx.tunables.expeditions.
 * Strings/assets: src/content/locales/en/expeditions.json and src/content/assets/manifest/expeditions.json (prefix 'expeditions.').
 * Gate: npm run verify:module -- expeditions
 *
 * HOW IT WORKS
 *   - launchExpedition: ships, men (military moveMen keeps veterancy), rations and trade goods from the house
 *     storehouse at the capital (economy's changeStores; elsewhere rations from the holding's food stores) and
 *     silver leave the holding as one fleet; the leaders board; the scene turns to the map.
 *   - setRoute: world's computeRoute; the world module sails the fleet hourly and emits Arrived.
 *   - steer: world's steerEntity for the expedition fleet, or the war-band ashore. The world module moves it hourly
 *     along the heading and emits Arrived (touch) when it comes within reach of a settlement or, for a war-band,
 *     of its ships (it boards again). Touching the home harbour after having left it only stops the ship there
 *     (a notice says so); "Come home" (returnHome within reach of home) ends the voyage.
 *   - daily: rations (1 per man per day, Towering eats double), coastal foraging (§31.6), starvation (morale −10
 *     a day, after 3 days 1 % of the men a day), voyage fatigue after day 20 (morale −1 a day), low-food warning.
 *   - Arrived at one of the house's harbours: the voyage counter resets; at the home port after `returnHome`
 *     the expedition stands down (men to the garrison, silver to the treasury, goods and leftover rations to
 *     the house storehouse; never to the market).
 *   - makeLandfall / returnToShips: a land party (military spawnArmy) marches; back at the ships it disbands
 *     into the fleet again.
 *   - lost.ts: the expedition always finds its way back to the hall. A fleet with no ship afloat, no crew, or
 *     no sea road home is lost and the survivors come home at once; a leaderless crew sails home on its own;
 *     dangling references are repaired (hourly, on every resolved decision, daily).
 *   - THE MARCH (launchExpedition with `travel: 'land'`, owner play-test 2026-11-14): no ships. The expedition is
 *     a shipless fleet record (`fleet.overland`, the baggage: food, silver, goods, plunder, the leaders' roll) and
 *     every man marches as its land party (the war-band, military's spawnArmy) from the holding's gates, in any
 *     season (ice closes only the sea). The player steers the war-band (steer), sends it to a place (setRoute) or
 *     home (returnHome: "March home"); it eats from the baggage daily, meets land encounters, reaches settlements
 *     by touch (settlements' arrival for a war-band; plunder rides in the baggage within men × carryTonsPerMan
 *     tons). Walking into the hall halts it there; "Come home" (returnHome) stands it down. makeLandfall and returnToShips do not apply.
 */
import { CommandError } from '@sim/core/commands';
import { clamp } from '@sim/core/dmath';
import { EffectError } from '@sim/core/effects';
import { createFleet, createShip } from '@sim/core/factory';
import type { CommandSchemas, ConditionFns, EffectSchemas, Reactions, SimContext, SimModule } from '@sim/core/module';
import type { ArmyId, CharId, Fleet, FleetId, GameState, GoodId, SettlementId, UnitTypeId } from '@sim/core/state';
import { z } from 'zod';
import type { GoodTons } from '../economy/types';
import { armyMenTotal, isOverland, live, menTotal, moveMen, sliceOf, standDown, standDownMarch, VERSION, warBandOf } from './homecoming';
import { expeditionBlock, guardExpedition, loseExpedition, marchHome, sailHome } from './lost';
import { currentExpedition, marchCarry, storehouseFor, travelOf, validateExpedition } from './plan';
import type { ExpeditionPlan, SpawnFleetEffect, SteerOrder } from './types';
import './types';

export type { ExpeditionBlock, ExpeditionIssue, ExpeditionLostCause, ExpeditionPlan, ExpeditionPreview, ExpeditionsState, OverlandBaggage, SpawnFleetEffect, SteerOrder, TravelMode } from './types';
export { cargoAvailable, currentExpedition, hasLandRoute, leadersAtHolding, marchCarry, planOrigin, planShortfall, rationsAvailable, shipsAtHolding, storehouseFor, suggestPlan, travelOf, validateExpedition } from './plan';
export { ableLeader, expeditionBlock, guardExpedition, hasAbleLeader, loseExpedition, marchHome, partiesOf, sailHome } from './lost';
export { armyMenTotal, homeFor, homeHarbours, isOverland, standDown, standDownMarch, warBandOf } from './homecoming';

function cleanPlan(p: ExpeditionPlan): ExpeditionPlan {
  const men: Record<string, number> = {};
  for (const [u, n] of Object.entries(p.men)) if ((n ?? 0) > 0) men[u] = Math.floor(n ?? 0);
  const out: ExpeditionPlan = { leaderIds: [...p.leaderIds], shipIds: [...p.shipIds], men, rations: Math.floor(p.rations) };
  if (p.fromId !== undefined) out.fromId = p.fromId;
  if (p.cargo !== undefined) out.cargo = { ...p.cargo };
  if (p.silver !== undefined) out.silver = Math.floor(p.silver);
  if (p.intent !== undefined) out.intent = p.intent;
  if (p.travel === 'land') out.travel = 'land';
  return out;
}

/** The player's fleet a command addresses (explicit, else the expedition). */
function playerFleet(draft: GameState, fleetId: FleetId | undefined): Fleet {
  const id = fleetId ?? currentExpedition(draft);
  const f = id !== undefined ? draft.fleets[id] : undefined;
  if (!f) throw new CommandError('noFleet', 'There is no expedition at sea.');
  if (f.ownerId !== draft.player.factionId) throw new CommandError('notYourFleet', 'That fleet is not yours.');
  return f;
}

/** The march's baggage fleet a command addresses through its war-band (undefined for a sea expedition). */
function marchOf(draft: GameState, fleet: Fleet): ArmyId | undefined {
  return isOverland(fleet) ? warBandOf(draft, fleet.id) : undefined;
}

/** Refuses a new course or a landing the expedition cannot take (no ships, no crew, no one to lead). */
function assertCanSail(draft: GameState, fleet: Fleet): void {
  if (fleet.id !== draft.player.expeditionFleetId) return;
  const block = expeditionBlock(draft, fleet.id);
  if (block !== undefined) throw new CommandError(block, `expeditions.error.${block}`);
}

// ---------------------------------------------------------------------------------------------
// Commands.

function handlePlan(draft: GameState, cmd: ExpeditionPlan, ctx: SimContext): void {
  const preview = validateExpedition(draft, ctx.content, cmd);
  const blocking = preview.issues.find((i) => i.severity === 'error' && i.code !== 'alreadyAtSea');
  if (blocking) throw new CommandError(blocking.code, `expeditions.issue.${blocking.code}`, blocking.vars as never);
  sliceOf(draft).lastPlan = cleanPlan(cmd);
}

function handleLaunch(draft: GameState, cmd: ExpeditionPlan, ctx: SimContext): void {
  const preview = validateExpedition(draft, ctx.content, cmd);
  const blocking = preview.issues.find((i) => i.severity === 'error');
  if (blocking || preview.fromId === null) throw new CommandError(blocking?.code ?? 'notYourHolding', `expeditions.issue.${blocking?.code ?? 'notYourHolding'}`, blocking?.vars as never);
  const fromId = preview.fromId;
  const s = draft.settlements[fromId];
  if (!s) throw new CommandError('notYourHolding', 'expeditions.issue.notYourHolding');
  const plan = cleanPlan(cmd);
  const land = travelOf(plan) === 'land';
  if (land && !(ctx.env.effects.has('spawnArmy') && ctx.env.effects.has('disbandArmy'))) throw new CommandError('noArmies', 'expeditions.error.noArmies');
  const [leaderId, ...lieutenants] = plan.leaderIds as [CharId, ...CharId[]];
  const fleet = createFleet(draft, ctx, {
    ownerId: draft.player.factionId,
    leaderId,
    lieutenantIds: lieutenants,
    pos: { ...s.mapPos },
    shipIds: land ? [] : plan.shipIds,
    men: {},
    rations: plan.rations,
    silver: plan.silver ?? 0,
    mode: land ? 'landed' : 'docked',
    intent: plan.intent ?? 'expedition',
  });
  if (land) fleet.overland = { carryT: marchCarry(ctx.content, preview.men + plan.leaderIds.length).tons };
  moveMen(draft, ctx, { settlementId: fromId }, { fleetId: fleet.id }, plan.men as Record<string, number>);
  // Rations and cargo from the house storehouse at the capital (validated above: never more than it holds).
  // Elsewhere (or without the economy module) rations come from the holding's food stores (§31.6:
  // months −= rations / (pop × 30)) and no cargo can be loaded.
  if (storehouseFor(draft, fromId) && ctx.env.effects.has('changeStores')) {
    const goods: GoodTons = {};
    for (const [good, t] of Object.entries(plan.cargo ?? {}) as [GoodId, number][]) {
      if (!(t > 0) || good === 'rations') continue;
      goods[good] = -t;
      fleet.cargo[good] = Math.round(((fleet.cargo[good] ?? 0) + t) * 1000) / 1000;
    }
    if (plan.rations > 0 || Object.keys(goods).length > 0) ctx.applyEffects([{ op: 'changeStores', goods, rations: -plan.rations } as never]);
  } else if (s.holding && plan.rations > 0) {
    s.holding.foodMonths = Math.max(0, Math.round((s.holding.foodMonths - plan.rations / (Math.max(1, s.pop) * 30)) * 1000) / 1000);
  }
  const faction = draft.factions[draft.player.factionId];
  if (faction && (plan.silver ?? 0) > 0) faction.treasury = Math.max(0, faction.treasury - (plan.silver ?? 0));
  for (const id of plan.leaderIds) {
    const c = draft.characters[id];
    if (c) c.location = { kind: 'fleet', id: fleet.id };
  }
  draft.player.expeditionFleetId = fleet.id;
  sliceOf(draft).lastPlan = plan;
  draft.meta.mode = 'map';
  if (land) {
    const armyId = marchOut(draft, ctx, fleet.id, fromId);
    ctx.emit({ type: 'ExpeditionLaunched', fleetId: fleet.id, fromId, men: preview.men, ships: 0, travel: 'land', armyId });
    ctx.notify('expeditions.notify.marched', { priority: 'normal', vars: { men: preview.men, days: preview.rationDays }, link: { kind: 'army', id: armyId } });
    return;
  }
  ctx.emit({ type: 'ExpeditionLaunched', fleetId: fleet.id, fromId, men: preview.men, ships: plan.shipIds.length });
  ctx.notify('expeditions.notify.launched', { priority: 'normal', vars: { men: preview.men, ships: plan.shipIds.length, days: preview.rationDays }, link: { kind: 'fleet', id: fleet.id } });
}

/**
 * The march sets out: every man of the baggage fleet forms the war-band at the holding's gates (military's
 * spawnArmy; the men leave the baggage as at a landfall) and the leaders march with it. Returns the army.
 */
function marchOut(draft: GameState, ctx: SimContext, fleetId: FleetId, fromId: SettlementId): ArmyId {
  const fleet = draft.fleets[fleetId] as Fleet;
  const party: Record<string, number> = {};
  for (const u of Object.keys(fleet.men).sort()) if ((fleet.men[u] ?? 0) > 0) party[u] = fleet.men[u] ?? 0;
  const leaders = [fleet.leaderId, ...fleet.lieutenantIds];
  const squads = Object.entries(party).map(([unit, men], i) => ({ unit, men, leaderId: leaders[i % leaders.length] as CharId }));
  const before = ctx.events.length;
  ctx.applyEffects([{ op: 'spawnArmy', ownerId: fleet.ownerId, leaderId: fleet.leaderId, pos: { ...fleet.pos }, homeId: fromId, squads, tag: `march:${fleetId}` } as never]);
  const spawned = ctx.events.slice(before).find((e) => e.type === ('ArmySpawned' as never)) as unknown as { armyId?: ArmyId } | undefined;
  const armyId = spawned?.armyId;
  if (armyId === undefined) throw new EffectError('launchExpedition: no war-band was spawned');
  for (const [unit, n] of Object.entries(party)) {
    if (ctx.env.effects.has('addMen')) ctx.applyEffects([{ op: 'addMen', fleetId, unit, count: -n } as never]);
    else {
      fleet.men[unit] = (fleet.men[unit] ?? 0) - n;
      if (fleet.men[unit] === 0) delete fleet.men[unit];
    }
  }
  sliceOf(draft).landParties[armyId] = fleetId;
  const chars = live(draft.characters);
  for (const id of Object.keys(chars) as CharId[]) {
    const loc = chars[id]?.location;
    if (loc?.kind !== 'fleet' || loc.id !== fleetId) continue;
    const c = draft.characters[id];
    if (c) c.location = { kind: 'army', id: armyId };
  }
  return armyId;
}

function handleSetRoute(draft: GameState, cmd: { fleetId?: FleetId; to: Record<string, unknown>; avoidStorms?: boolean }, ctx: SimContext): void {
  const fleet = playerFleet(draft, cmd.fleetId);
  if (!ctx.env.effects.has('computeRoute')) throw new CommandError('noNavigation', 'expeditions.error.noNavigation');
  if (isOverland(fleet)) {
    // The march: the war-band takes the road there (world's land route).
    const armyId = marchOf(draft, fleet);
    if (armyId === undefined) throw new CommandError('noParty', 'expeditions.error.noParty');
    assertCanSail(draft, fleet);
    const before = ctx.events.length;
    ctx.applyEffects([{ op: 'computeRoute', entityId: armyId, to: cmd.to } as never]);
    const failed = ctx.events.slice(before).find((e) => e.type === ('RouteFailed' as never) && (e as unknown as { entityId: string }).entityId === armyId) as unknown as { reason?: string } | undefined;
    if (failed) throw new CommandError(`route.${failed.reason ?? 'unreachable'}`, `world.route.failed.${failed.reason ?? 'unreachable'}`);
    const f = draft.fleets[fleet.id] as Fleet & { homeward?: boolean; homewardTo?: SettlementId };
    if (f.homeward) delete f.homeward;
    if (f.homewardTo !== undefined) delete f.homewardTo;
    return;
  }
  if (fleet.mode === 'landed' || Object.values(sliceOf(draft).landParties).includes(fleet.id)) throw new CommandError('partyAshore', 'expeditions.error.partyAshore');
  assertCanSail(draft, fleet);
  const before = ctx.events.length;
  ctx.applyEffects([{ op: 'computeRoute', entityId: fleet.id, to: cmd.to, ...(cmd.avoidStorms !== undefined ? { avoidStorms: cmd.avoidStorms } : {}) } as never]);
  const failed = ctx.events.slice(before).find((e) => e.type === ('RouteFailed' as never) && (e as unknown as { entityId: string }).entityId === fleet.id) as unknown as { reason?: string } | undefined;
  if (failed) throw new CommandError(`route.${failed.reason ?? 'unreachable'}`, `world.route.failed.${failed.reason ?? 'unreachable'}`);
  // A new course cancels a pending homecoming.
  const f = draft.fleets[fleet.id] as Fleet & { homeward?: boolean; homewardTo?: SettlementId };
  if (f.homeward) delete f.homeward;
  if (f.homewardTo !== undefined) delete f.homewardTo;
}

/**
 * Sails home and stands the expedition down there. Always ends at the hall unless the way is iced in: a fleet
 * that can no longer sail is lost (the survivors come home at once); when the capital cannot be reached by sea
 * the fleet makes for the house's nearest other harbour, and with none reachable it is abandoned.
 */
function handleReturnHome(draft: GameState, cmd: { fleetId?: FleetId }, ctx: SimContext): void {
  const fleet = playerFleet(draft, cmd.fleetId);
  const expedition = fleet.id === draft.player.expeditionFleetId;
  if (isOverland(fleet)) {
    // March home: the war-band takes the road to the hall (or the nearest holding it can reach on foot).
    if (expeditionBlock(draft, fleet.id) === 'noMen') {
      loseExpedition(draft, ctx, fleet.id, 'noMen');
      return;
    }
    const r = marchHome(draft, ctx, fleet.id);
    if (r === 'noNavigation') throw new CommandError('noNavigation', 'expeditions.error.noNavigation');
    if (r === 'unreachable') loseExpedition(draft, ctx, fleet.id, 'noWayHome');
    return;
  }
  const block = expedition ? expeditionBlock(draft, fleet.id) : undefined;
  if (block === 'noShips' || block === 'noCrew') {
    loseExpedition(draft, ctx, fleet.id, block === 'noShips' ? 'shipsLost' : 'noCrew');
    return;
  }
  if (Object.values(sliceOf(draft).landParties).includes(fleet.id)) throw new CommandError('partyAshore', 'expeditions.error.partyAshore');
  if (!draft.settlements[draft.player.capitalId]) throw new CommandError('noHome', 'expeditions.error.noHome');
  const r = sailHome(draft, ctx, fleet.id);
  if (r === 'noNavigation') throw new CommandError('noNavigation', 'expeditions.error.noNavigation');
  if (r === 'iced') throw new CommandError('route.iced', 'world.route.failed.iced');
  if (r === 'unreachable') {
    if (!expedition) throw new CommandError('route.unreachable', 'world.route.failed.unreachable');
    loseExpedition(draft, ctx, fleet.id, 'noWayHome');
  }
}

/**
 * The player steers: the war-band ashore when there is one (or the army named), else the expedition fleet. Any
 * order (a heading or 'stop') cancels a set course and a pending homecoming. World's steerEntity does the moving.
 */
function handleSteer(draft: GameState, cmd: { dir: SteerOrder; fleetId?: FleetId; armyId?: ArmyId }, ctx: SimContext): void {
  if (!ctx.env.effects.has('steerEntity')) throw new CommandError('noNavigation', 'expeditions.error.noNavigation');
  const slice = sliceOf(draft);
  let entityId: FleetId | ArmyId;
  let baggage: Fleet | undefined;
  if (cmd.armyId !== undefined) {
    if (!Object.hasOwn(slice.landParties, cmd.armyId) || !draft.armies[cmd.armyId]) throw new CommandError('noParty', 'expeditions.error.noParty');
    entityId = cmd.armyId;
    const owner = draft.fleets[slice.landParties[cmd.armyId] as FleetId];
    if (owner && isOverland(owner)) baggage = owner;
  } else {
    const fleet = playerFleet(draft, cmd.fleetId);
    const party = (Object.keys(slice.landParties) as ArmyId[]).find((a) => slice.landParties[a] === fleet.id && draft.armies[a] !== undefined);
    if (isOverland(fleet)) {
      // The march: the keys steer the war-band.
      if (party === undefined) throw new CommandError('noParty', 'expeditions.error.noParty');
      entityId = party;
      baggage = fleet;
    } else if (party !== undefined && cmd.fleetId === undefined) entityId = party;
    else {
      if (party !== undefined || fleet.mode === 'landed') throw new CommandError('partyAshore', 'expeditions.error.partyAshore');
      assertCanSail(draft, fleet);
      entityId = fleet.id;
    }
  }
  // A march that can no longer take orders (no one to lead) walks home on its own.
  if (baggage) assertCanSail(draft, baggage);
  const before = ctx.events.length;
  ctx.applyEffects([{ op: 'steerEntity', entityId, dir: cmd.dir } as never]);
  const failed = ctx.events.slice(before).find((e) => e.type === ('RouteFailed' as never) && (e as unknown as { entityId: string }).entityId === entityId) as unknown as { reason?: string } | undefined;
  if (failed) throw new CommandError(`route.${failed.reason ?? 'unreachable'}`, `world.route.failed.${failed.reason ?? 'unreachable'}`);
  const f = (entityId.startsWith('flt_') ? draft.fleets[entityId as FleetId] : baggage ? draft.fleets[baggage.id] : undefined) as (Fleet & { homeward?: boolean; homewardTo?: SettlementId }) | undefined;
  if (f?.homeward) delete f.homeward;
  if (f?.homewardTo !== undefined) delete f.homewardTo;
}

function handleLandfall(draft: GameState, cmd: { fleetId?: FleetId; shipGuard?: number }, ctx: SimContext): void {
  const fleet = playerFleet(draft, cmd.fleetId);
  const slice = sliceOf(draft);
  if (isOverland(fleet)) throw new CommandError('onTheMarch', 'expeditions.error.onTheMarch');
  if (Object.values(slice.landParties).includes(fleet.id)) throw new CommandError('partyAshore', 'expeditions.error.partyAshore');
  assertCanSail(draft, fleet);
  if (!ctx.env.effects.has('spawnArmy')) throw new CommandError('noArmies', 'expeditions.error.noArmies');
  if (fleet.mode === 'sailing' && fleet.route.length > 0) throw new CommandError('underSail', 'expeditions.error.underSail');
  const guardMin = ctx.balance.overland.shipGuardPerShip * fleet.shipIds.length;
  const guard = Math.max(guardMin, Math.floor(cmd.shipGuard ?? guardMin));
  const total = menTotal(fleet.men);
  if (total - guard <= 0) throw new CommandError('noPartyMen', 'expeditions.error.noPartyMen');
  // The ship-guard is drawn from the cheapest men first; the rest land.
  const units = Object.keys(fleet.men).sort((a, b) => (ctx.balance.units[a]?.wage ?? 0) - (ctx.balance.units[b]?.wage ?? 0) || (a < b ? -1 : 1));
  let keep = guard;
  const party: Record<string, number> = {};
  for (const u of units) {
    const n = fleet.men[u] ?? 0;
    const stay = Math.min(n, keep);
    keep -= stay;
    if (n - stay > 0) party[u] = n - stay;
  }
  const leaders = [fleet.leaderId, ...fleet.lieutenantIds];
  const squads = Object.entries(party).map(([unit, men], i) => ({ unit, men, leaderId: leaders[i % leaders.length] as CharId }));
  const before = ctx.events.length;
  ctx.applyEffects([{ op: 'spawnArmy', ownerId: fleet.ownerId, leaderId: fleet.leaderId, pos: { ...fleet.pos }, squads, tag: `landParty:${fleet.id}` } as never]);
  const spawned = ctx.events.slice(before).find((e) => e.type === ('ArmySpawned' as never)) as unknown as { armyId?: ArmyId } | undefined;
  const armyId = spawned?.armyId;
  if (armyId === undefined) throw new EffectError('makeLandfall: no army was spawned');
  // The landing men leave the fleet (no loss of life).
  for (const [unit, n] of Object.entries(party)) {
    if (ctx.env.effects.has('addMen')) ctx.applyEffects([{ op: 'addMen', fleetId: fleet.id, unit, count: -n } as never]);
    else {
      fleet.men[unit] = (fleet.men[unit] ?? 0) - n;
      if (fleet.men[unit] === 0) delete fleet.men[unit];
    }
  }
  slice.landParties[armyId] = fleet.id;
  const f = draft.fleets[fleet.id];
  if (f) f.mode = 'landed';
  for (const id of leaders) {
    const c = draft.characters[id];
    if (c && c.location.kind === 'fleet' && c.location.id === fleet.id) c.location = { kind: 'army', id: armyId };
  }
  const ruler = draft.characters[draft.player.rulerId];
  if (ruler && ruler.location.kind === 'fleet' && ruler.location.id === fleet.id) ruler.location = { kind: 'army', id: armyId };
  ctx.emit({ type: 'LandfallMade', fleetId: fleet.id, armyId, men: menTotal(party) });
}

function handleReturnToShips(draft: GameState, cmd: { armyId?: ArmyId }, ctx: SimContext): void {
  const slice = sliceOf(draft);
  const armyId = cmd.armyId ?? (Object.keys(slice.landParties)[0] as ArmyId | undefined);
  const fleetId = armyId !== undefined ? slice.landParties[armyId] : undefined;
  const army = armyId !== undefined ? draft.armies[armyId] : undefined;
  const fleet = fleetId !== undefined ? draft.fleets[fleetId] : undefined;
  if (!armyId || !army || !fleet) throw new CommandError('noParty', 'expeditions.error.noParty');
  if (isOverland(fleet)) throw new CommandError('onTheMarch', 'expeditions.error.onTheMarch');
  const near = (army.pos.x - fleet.pos.x) ** 2 + (army.pos.y - fleet.pos.y) ** 2 <= ctx.tunables.expeditions.reboardRadius ** 2;
  if (near) {
    reboard(draft, ctx, armyId, fleet.id);
    return;
  }
  if (!ctx.env.effects.has('computeRoute')) throw new CommandError('noNavigation', 'expeditions.error.noNavigation');
  ctx.applyEffects([{ op: 'computeRoute', entityId: armyId, to: { x: fleet.pos.x, y: fleet.pos.y } } as never]);
}

function reboard(draft: GameState, ctx: SimContext, armyId: ArmyId, fleetId: FleetId): void {
  const army = draft.armies[armyId];
  const fleet = draft.fleets[fleetId];
  if (!army || !fleet) return;
  let men = 0;
  for (const sq of army.squads) men += Math.max(0, sq.men);
  for (const c of Object.values(draft.characters)) if (c.location.kind === 'army' && c.location.id === armyId) c.location = { kind: 'fleet', id: fleetId };
  if (ctx.env.effects.has('disbandArmy')) ctx.applyEffects([{ op: 'disbandArmy', armyId, to: { fleetId } } as never]);
  delete sliceOf(draft).landParties[armyId];
  fleet.mode = 'beached';
  ctx.emit({ type: 'PartyReturned', fleetId, armyId, men });
}

// ---------------------------------------------------------------------------------------------
// spawnFleet.

function applySpawnFleet(draft: GameState, e: SpawnFleetEffect, ctx: SimContext): void {
  const ownerId = e.ownerId ?? draft.player.factionId;
  const owner = draft.factions[ownerId];
  if (!owner) throw new EffectError(`spawnFleet: unknown faction ${ownerId}`);
  const leaderId = e.leaderId ?? owner.rulerId;
  if (!draft.characters[leaderId]) throw new EffectError(`spawnFleet: unknown leader ${leaderId}`);
  const at = e.settlementId !== undefined ? draft.settlements[e.settlementId] : undefined;
  if (e.settlementId !== undefined && !at) throw new EffectError(`spawnFleet: unknown settlement ${e.settlementId}`);
  const pos = e.pos ?? at?.mapPos;
  if (!pos) throw new EffectError('spawnFleet: needs settlementId or pos');
  const shipIds = [...(e.shipIds ?? [])];
  for (const id of shipIds) if (!draft.ships[id]) throw new EffectError(`spawnFleet: unknown ship ${id}`);
  for (const type of e.shipTypes ?? []) {
    if (!ctx.balance.ships[type]) throw new EffectError(`spawnFleet: unknown ship type ${type}`);
    shipIds.push(createShip(draft, ctx, { type, ownerId, ...(at ? { homeName: at.name } : {}) }).id);
  }
  if (shipIds.length === 0) throw new EffectError('spawnFleet: no ships');
  const men: Record<UnitTypeId, number> = {};
  for (const [u, n] of Object.entries(e.men)) if ((n ?? 0) > 0) men[u] = Math.floor(n ?? 0);
  const fleet = createFleet(draft, ctx, {
    ownerId,
    leaderId,
    pos: { x: pos.x, y: pos.y },
    shipIds,
    men,
    rations: e.rations ?? menTotal(men) * ctx.tunables.expeditions.spawnRationDays,
    silver: e.silver ?? 0,
    cargo: { ...(e.cargo ?? {}) },
    mode: at ? 'docked' : 'sailing',
    ...(e.intent !== undefined ? { intent: e.intent } : {}),
  });
  ctx.emit({ type: 'FleetSpawned', fleetId: fleet.id, ownerId, ...(e.tag !== undefined ? { tag: e.tag } : {}) });
  if (e.to && ctx.env.effects.has('computeRoute')) ctx.applyEffects([{ op: 'computeRoute', entityId: fleet.id, to: e.to } as never]);
}

// ---------------------------------------------------------------------------------------------
// Daily provisions (§8.5, §31.6).

type Characters = GameState['characters'];

function eaters(chars: Characters, ctx: SimContext, f: Fleet): number {
  let men = menTotal(f.men);
  const towering = ctx.balance.food.toweringEatsMult;
  for (const id of [f.leaderId, ...f.lieutenantIds]) {
    const c = chars[id];
    if (c?.alive) men += c.traits.includes('towering') ? towering : 1;
  }
  return men;
}

function partySkill(chars: Characters, f: Fleet, skill: 'wildcraft' | 'seafaring'): number {
  let best = 0;
  for (const id of [f.leaderId, ...f.lieutenantIds]) best = Math.max(best, chars[id]?.skills[skill] ?? 0);
  return best;
}

/** Men of an army by unit type. */
function armyMenByUnit(draft: GameState, armyId: ArmyId): Record<string, number> {
  const out: Record<string, number> = {};
  for (const sq of draft.armies[armyId]?.squads ?? []) if (sq.men > 0) out[sq.unit] = (out[sq.unit] ?? 0) + sq.men;
  return out;
}

/** Deaths of a starving day spread over the unit types round-robin: unit → count. */
function starvationDeaths(men: Readonly<Record<string, number>>, deaths: number): Record<string, number> {
  const units = Object.keys(men).filter((u) => (men[u] ?? 0) > 0).sort();
  const byUnit: Record<string, number> = {};
  let left = Math.min(deaths, menTotal(men));
  for (let k = 0; left > 0 && units.length > 0; k++) {
    const u = units[k % units.length] as string;
    if ((byUnit[u] ?? 0) >= (men[u] ?? 0)) continue;
    byUnit[u] = (byUnit[u] ?? 0) + 1;
    left -= 1;
  }
  return byUnit;
}

/**
 * One day of food, foraging, starvation and fatigue for every fleet away from home. Reads a live snapshot of
 * the fleets and characters (proxy reads of 150 fleets and their leaders cost more than the snapshot) and
 * writes only the fields that change.
 */
export function dailyProvisions(draft: GameState, ctx: SimContext): void {
  const food = ctx.balance.food;
  const t = ctx.tunables.expeditions;
  const slice = sliceOf(draft);
  const rng = ctx.rng('expeditions');
  const fleets = live(draft.fleets);
  let chars: Characters | undefined;
  const people = (): Characters => (chars ??= live(draft.characters));
  const player = draft.player.factionId;
  for (const id of Object.keys(fleets) as FleetId[]) {
    const s = fleets[id];
    if (!s || s.mode === 'docked') continue;
    // A march: the war-band eats from its baggage (its men are in the army, not the fleet).
    const band = s.overland !== undefined ? warBandOf(draft, id) : undefined;
    const bandMen = band !== undefined ? armyMenByUnit(draft, band) : undefined;
    const men = eaters(people(), ctx, s) + (bandMen ? menTotal(bandMen) : 0);
    if (men <= 0) continue;
    let need = Math.ceil(men * food.rationsPerManPerDay);
    // Coastal foraging and fishing (§31.6): fleets that lie on a beach (coastal legs beach at night) or land.
    // A war-band on the march forages by Wildcraft alone.
    if (t.forageModes.includes(s.mode)) {
      const skill = bandMen ? partySkill(people(), s, 'wildcraft') : (partySkill(people(), s, 'wildcraft') + partySkill(people(), s, 'seafaring')) / 2;
      const per = Math.min(food.forageCap, food.forageBase * (1 + food.forageSkillSlope * skill));
      need = Math.max(0, need - Math.floor(men * per));
    }
    const eaten = Math.min(need, s.rations);
    let rations = s.rations - eaten;
    // Spoilage without salt after day 30.
    if (s.voyageDays >= food.spoilStartDay && rations > 0) {
      const salted = (s.cargo.salt ?? 0) > 0;
      const spoil = Math.floor(rations * food.spoilPerDay * (salted ? food.saltSpoilMult : 1));
      if (spoil > 0) rations -= spoil;
    }
    const voyageDays = s.voyageDays + 1;
    let morale = s.morale;
    const f = draft.fleets[id] as Fleet;
    if (rations !== s.rations) f.rations = rations;
    f.voyageDays = voyageDays;
    if (eaten < need) {
      const days = (slice.starving[id] ?? 0) + 1;
      slice.starving[id] = days;
      morale += food.starvation.moralePerDay;
      let deaths = 0;
      if (days > food.starvation.graceDays) {
        const pool = bandMen ?? s.men;
        const n = menTotal(pool);
        deaths = Math.min(n, Math.max(1, Math.floor(n * food.starvation.deathPctPerDay + rng.float())));
        // One killMen per unit type (not one per man).
        for (const [u, count] of Object.entries(starvationDeaths(pool, deaths))) {
          if (ctx.env.effects.has('killMen')) ctx.applyEffects([{ op: 'killMen', ...(band !== undefined ? { armyId: band } : { fleetId: id }), unit: u, count, popLoss: false } as never]);
          else if (band === undefined) f.men[u] = (f.men[u] ?? 0) - count;
        }
      }
      ctx.emit({ type: 'FleetStarving', fleetId: id, days, deaths });
      if (s.ownerId === player) ctx.notify('expeditions.notify.starving', { priority: 'critical', vars: { days, deaths }, link: { kind: 'fleet', id }, illustration: 'narrative.vignette.famine' });
    } else if (slice.starving[id] !== undefined) delete slice.starving[id];
    if (voyageDays > food.voyageFatigue.startDay) morale += food.voyageFatigue.moralePerDay;
    morale = clamp(Math.round(morale), 0, 100) + 0;
    if (morale !== s.morale) f.morale = morale;
    // Low food warning (§7.2 auto-pause).
    if (s.ownerId === player && eaten >= need && need > 0) {
      const days = Math.floor(rations / Math.max(1, Math.ceil(men * food.rationsPerManPerDay)));
      if (days === food.lowFoodWarnDays) ctx.notify('expeditions.notify.lowFood', { priority: 'critical', vars: { days }, link: { kind: 'fleet', id } });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Reactions.

/**
 * The march's war-band reached a settlement (by touch, or at the end of a road). At a holding of the house the
 * march rests (the fatigue counter resets); walking back into the hall, or reaching the holding a "March home"
 * was bound for, stands it down. Foreign places are settlements' (the arrival decision).
 */
function marchArrived(draft: GameState, ctx: SimContext, fleetId: FleetId, settlementId: SettlementId | undefined, touched: boolean): void {
  const f = draft.fleets[fleetId] as (Fleet & { homeward?: boolean; homewardTo?: SettlementId }) | undefined;
  if (!f || settlementId === undefined) return;
  const s = draft.settlements[settlementId];
  if (!s) return;
  const home = f.homewardTo ?? draft.player.capitalId;
  if (s.factionId !== f.ownerId) {
    if (f.homeward && settlementId === home) {
      delete f.homeward;
      if (f.homewardTo !== undefined) delete f.homewardTo;
    }
    return;
  }
  if (f.voyageDays !== 0) f.voyageDays = 0;
  const expedition = fleetId === draft.player.expeditionFleetId;
  if (f.homeward && settlementId === home) standDownMarch(draft, ctx, fleetId, settlementId);
  // Walking into the hall only halts the war-band there: the player ends the march with "Come home".
  else if (expedition && settlementId === draft.player.capitalId) {
    f.cameHome = true;
    if (touched) ctx.notify('expeditions.notify.atHomeMarch', { priority: 'normal', vars: { place: s.name }, link: { kind: 'settlement', id: settlementId } });
  }
}

type Loose = Record<string, unknown>;

const REACTIONS: Record<string, (draft: GameState, e: Loose, ctx: SimContext) => void> = {
  Arrived(draft, e, ctx) {
    const fleetId = typeof e['fleetId'] === 'string' ? (e['fleetId'] as FleetId) : undefined;
    const armyId = typeof e['armyId'] === 'string' ? (e['armyId'] as ArmyId) : undefined;
    const settlementId = typeof e['settlementId'] === 'string' ? (e['settlementId'] as SettlementId) : undefined;
    const slice = sliceOf(draft);
    if (armyId !== undefined && Object.hasOwn(slice.landParties, armyId)) {
      const fid = slice.landParties[armyId] as FleetId;
      const army = draft.armies[armyId];
      const fleet = draft.fleets[fid];
      if (fleet && isOverland(fleet)) {
        marchArrived(draft, ctx, fid, settlementId, e['touch'] === true);
        return;
      }
      if (army && fleet && (army.pos.x - fleet.pos.x) ** 2 + (army.pos.y - fleet.pos.y) ** 2 <= ctx.tunables.expeditions.reboardRadius ** 2) reboard(draft, ctx, armyId, fid);
      return;
    }
    if (fleetId === undefined) return;
    const touched = e['touch'] === true;
    const f = draft.fleets[fleetId] as (Fleet & { homeward?: boolean; homewardTo?: SettlementId }) | undefined;
    if (!f || settlementId === undefined) return;
    const s = draft.settlements[settlementId];
    if (!s) return;
    const home = f.homewardTo ?? draft.player.capitalId;
    if (s.factionId !== f.ownerId) {
      // Home is no longer the house's: the homecoming is off and the orders open again.
      if (f.homeward && settlementId === home) {
        delete f.homeward;
        if (f.homewardTo !== undefined) delete f.homewardTo;
      }
      return;
    }
    // Landfall at a friendly harbour resets the voyage-fatigue counter (§8.5).
    if (f.voyageDays !== 0) f.voyageDays = 0;
    if (f.homeward && settlementId === home) standDown(draft, ctx, fleetId, settlementId);
    // Steering into the home harbour only brings the ship to rest there (owner walk-through 2026-11-14): the
    // player ends the voyage with "Come home" (returnHome), never by an accidental touch.
    else if (fleetId === draft.player.expeditionFleetId && settlementId === draft.player.capitalId) {
      f.cameHome = true;
      if (touched) ctx.notify('expeditions.notify.atHome', { priority: 'normal', vars: { place: s.name }, link: { kind: 'settlement', id: settlementId } });
    }
  },
  /** Sea battles and encounters are settled through commands: check the expedition once everything has reacted. */
  PendingResolved(draft, _e, ctx) {
    guardExpedition(draft, ctx, false);
  },
};

// ---------------------------------------------------------------------------------------------
// Schemas, conditions, invariants.

const prefixed = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_.+$`), `must be a ${prefix}_ id`);
const menRecord = z.record(z.string().min(1), z.number().int().min(0));
const goodsRecord = z.record(z.string().min(1), z.number().finite().min(0));
const PlanShape = {
  fromId: prefixed('set').optional(),
  leaderIds: z.array(prefixed('chr')).min(1).max(8),
  shipIds: z.array(prefixed('shp')).max(40),
  men: menRecord,
  rations: z.number().int().min(0),
  cargo: goodsRecord.optional(),
  silver: z.number().int().min(0).optional(),
  intent: z.string().min(1).optional(),
  travel: z.enum(['sea', 'land']).optional(),
};
const target = z.union([z.object({ settlementId: prefixed('set') }).strict(), z.object({ siteId: prefixed('site') }).strict(), z.object({ x: z.number().finite(), y: z.number().finite() }).strict()]);

export const EXPEDITIONS_COMMAND_SCHEMAS: CommandSchemas = {
  planExpedition: z.object({ type: z.literal('planExpedition'), ...PlanShape }),
  launchExpedition: z.object({ type: z.literal('launchExpedition'), ...PlanShape }),
  setRoute: z.object({ type: z.literal('setRoute'), fleetId: prefixed('flt').optional(), to: target, avoidStorms: z.boolean().optional() }),
  makeLandfall: z.object({ type: z.literal('makeLandfall'), fleetId: prefixed('flt').optional(), shipGuard: z.number().int().min(0).optional() }),
  returnToShips: z.object({ type: z.literal('returnToShips'), armyId: prefixed('arm').optional() }),
  returnHome: z.object({ type: z.literal('returnHome'), fleetId: prefixed('flt').optional() }),
  steer: z.object({
    type: z.literal('steer'),
    dir: z.enum(['stop', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']),
    fleetId: prefixed('flt').optional(),
    armyId: prefixed('arm').optional(),
  }),
};

export const EXPEDITIONS_EFFECT_SCHEMAS: EffectSchemas = {
  spawnFleet: z
    .object({
      op: z.literal('spawnFleet'),
      ownerId: prefixed('fac').optional(),
      shipTypes: z.array(z.string().min(1)).optional(),
      shipIds: z.array(prefixed('shp')).optional(),
      men: menRecord,
      leaderId: prefixed('chr').optional(),
      settlementId: prefixed('set').optional(),
      pos: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().optional(),
      rations: z.number().int().min(0).optional(),
      silver: z.number().int().min(0).optional(),
      cargo: goodsRecord.optional(),
      intent: z.string().min(1).optional(),
      to: z.union([z.object({ settlementId: prefixed('set') }).strict(), z.object({ x: z.number().finite(), y: z.number().finite() }).strict()]).optional(),
      tag: z.string().min(1).optional(),
    })
    .strict(),
};

const expeditionFleet = (state: GameState): Fleet | undefined => {
  const id = currentExpedition(state);
  return id !== undefined ? state.fleets[id] : undefined;
};

export const EXPEDITIONS_CONDITION_FNS: ConditionFns = {
  /** atSea(): the player's expedition is out. */
  atSea: { args: z.tuple([]), returns: 'boolean', evaluate: (_a, ctx) => expeditionFleet(ctx.state) !== undefined },
  /** rationDays(): days the expedition's rations last (0 without an expedition). */
  rationDays: {
    args: z.tuple([]),
    returns: 'number',
    evaluate: (_a, ctx) => {
      const f = expeditionFleet(ctx.state);
      if (!f) return 0;
      const band = isOverland(f) ? armyMenTotal(ctx.state, warBandOf(ctx.state, f.id)) : 0;
      return Math.floor(f.rations / Math.max(1, menTotal(f.men) + band));
    },
  },
  fleetMorale: { args: z.tuple([]), returns: 'number', evaluate: (_a, ctx) => expeditionFleet(ctx.state)?.morale ?? 0 },
  voyageDays: { args: z.tuple([]), returns: 'number', evaluate: (_a, ctx) => expeditionFleet(ctx.state)?.voyageDays ?? 0 },
};

/** Expeditions invariants. */
export function expeditionsInvariants(state: GameState): string[] {
  const out: string[] = [];
  const exp = state.player.expeditionFleetId;
  if (exp !== undefined && !Object.hasOwn(state.fleets, exp)) out.push(`expeditions: expedition fleet ${exp} does not exist`);
  for (const f of Object.values(state.fleets)) {
    if (!(f.rations >= 0) || !Number.isFinite(f.rations)) out.push(`fleet ${f.id}: rations ${f.rations}`);
    if (!(f.morale >= 0 && f.morale <= 100)) out.push(`fleet ${f.id}: morale ${f.morale}`);
    if (!Object.hasOwn(state.factions, f.ownerId)) out.push(`fleet ${f.id}: unknown owner ${f.ownerId}`);
    for (const sid of f.shipIds) if (state.ships[sid]?.locationFleetId !== f.id) out.push(`fleet ${f.id}: ship ${sid} does not name it`);
    for (const [u, n] of Object.entries(f.men)) if (!(Number.isInteger(n) && n >= 0)) out.push(`fleet ${f.id}: ${u} ${n}`);
    if (f.overland !== undefined && f.shipIds.length > 0) out.push(`fleet ${f.id}: a march carries no ships`);
    if (f.overland !== undefined && !(f.overland.carryT >= 0)) out.push(`fleet ${f.id}: carryT ${f.overland.carryT}`);
  }
  for (const [armyId, fleetId] of Object.entries(state.expeditions?.landParties ?? {})) {
    if (!Object.hasOwn(state.armies, armyId)) out.push(`expeditions: land party ${armyId} is gone`);
    if (!Object.hasOwn(state.fleets, fleetId)) out.push(`expeditions: land party ${armyId} has no fleet ${fleetId}`);
  }
  return out;
}

export const module: SimModule = {
  id: 'expeditions',
  order: 40,
  version: VERSION,
  init(draft) {
    sliceOf(draft);
  },
  migrate(draft) {
    // v2 (the march) added only optional fields: `plan.travel`, `fleet.overland`.
    sliceOf(draft).version = VERSION;
  },
  handlers: {
    planExpedition: (d, c, ctx) => handlePlan(d, c as ExpeditionPlan, ctx),
    launchExpedition: (d, c, ctx) => handleLaunch(d, c as ExpeditionPlan, ctx),
    setRoute: (d, c, ctx) => handleSetRoute(d, c as never, ctx),
    makeLandfall: (d, c, ctx) => handleLandfall(d, c, ctx),
    returnToShips: (d, c, ctx) => handleReturnToShips(d, c, ctx),
    returnHome: (d, c, ctx) => handleReturnHome(d, c, ctx),
    steer: (d, c, ctx) => handleSteer(d, c, ctx),
  },
  commandSchemas: EXPEDITIONS_COMMAND_SCHEMAS,
  effects: { spawnFleet: (d, e, ctx) => applySpawnFleet(d, e as SpawnFleetEffect, ctx) },
  effectSchemas: EXPEDITIONS_EFFECT_SCHEMAS,
  systems: {
    hourly: (d, ctx) => guardExpedition(d, ctx, false),
    daily: (d, ctx) => {
      dailyProvisions(d, ctx);
      guardExpedition(d, ctx, true);
    },
  },
  reactions: REACTIONS as unknown as Reactions,
  conditionFns: EXPEDITIONS_CONDITION_FNS,
  invariants: (state) => expeditionsInvariants(state),
};
