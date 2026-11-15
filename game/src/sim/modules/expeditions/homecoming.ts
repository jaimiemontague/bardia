/**
 * The stand-down at home and the helpers shared by the commands (index.ts) and the lost-expedition rule
 * (lost.ts): the module slice, men counts, moving men, and the house's harbours to come home to.
 *
 * Every way an expedition ends goes through `standDown`, so the storehouse, the garrison, the characters'
 * locations, `player.expeditionFleetId` and `meta.mode` always end up consistent.
 */
import type { SimContext } from '@sim/core/module';
import type { ArmyId, Fleet, FleetId, GameState, GoodId, MapPos, SettlementId } from '@sim/core/state';
import { current, isDraft } from 'immer';
import { storehouseFor } from './plan';
import type { ExpeditionsState } from './types';
import './types';

/** The module's data version (2: the march, `plan.travel` and `fleet.overland`; no data change needed). */
export const VERSION = 2;

/** The module slice (created when missing). */
export function sliceOf(draft: GameState): ExpeditionsState {
  draft.expeditions ??= { version: VERSION, starving: {}, landParties: {} };
  const s = draft.expeditions;
  s.starving ??= {};
  s.landParties ??= {};
  return s;
}

/** Men in a unit → count record. */
export function menTotal(men: Readonly<Record<string, number>>): number {
  let n = 0;
  for (const v of Object.values(men)) n += Math.max(0, v);
  return n;
}

/** The live value of a draft subtree as plain data (replay-safe, unlike the operation's base state). */
export function live<T>(value: T): T {
  return isDraft(value) ? (current(value as never) as T) : value;
}

/** Moves men between containers (military's moveMen when present, else the raw records). */
export function moveMen(
  draft: GameState,
  ctx: SimContext,
  from: { settlementId?: SettlementId; fleetId?: FleetId },
  to: { settlementId?: SettlementId; fleetId?: FleetId },
  men: Record<string, number>,
): void {
  if (Object.keys(men).length === 0) return;
  if (ctx.env.effects.has('moveMen')) {
    ctx.applyEffects([{ op: 'moveMen', from, to, men } as never]);
    return;
  }
  const table = (ref: typeof from): Record<string, number> | undefined =>
    ref.settlementId !== undefined ? draft.settlements[ref.settlementId]?.garrison : ref.fleetId !== undefined ? draft.fleets[ref.fleetId]?.men : undefined;
  const a = table(from);
  const b = table(to);
  if (!a || !b) return;
  for (const [u, n] of Object.entries(men)) {
    const take = Math.min(n, a[u] ?? 0);
    a[u] = (a[u] ?? 0) - take;
    if (a[u] === 0) delete a[u];
    b[u] = (b[u] ?? 0) + take;
  }
}

/** Squared distance between two map positions. */
export function dist2(a: MapPos, b: MapPos): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/**
 * Harbours an expedition can come home to, best first: the capital (while it is the house's), then the
 * house's other coastal holdings nearest to `pos` (at most `fallbacks` of them).
 */
export function homeHarbours(state: GameState, pos: MapPos | undefined, fallbacks: number): SettlementId[] {
  const player = state.player.factionId;
  const cap = state.player.capitalId;
  const out: SettlementId[] = [];
  const capital = Object.hasOwn(state.settlements, cap) ? state.settlements[cap] : undefined;
  if (capital && capital.factionId === player) out.push(cap);
  if (fallbacks <= 0) return out;
  const others: { id: SettlementId; d: number }[] = [];
  for (const s of Object.values(state.settlements)) {
    if (s.factionId !== player || s.id === cap || !s.coastal) continue;
    others.push({ id: s.id, d: pos ? dist2(pos, s.mapPos) : 0 });
  }
  others.sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
  for (const o of others.slice(0, fallbacks)) out.push(o.id);
  return out;
}

/**
 * Where the survivors of a lost expedition go: the capital while it is the house's, else the house's
 * holding nearest to `pos` (coastal or not), else undefined (the house holds nothing).
 */
export function homeFor(state: GameState, pos: MapPos | undefined): SettlementId | undefined {
  const first = homeHarbours(state, pos, 0)[0];
  if (first !== undefined) return first;
  let best: { id: SettlementId; d: number } | undefined;
  for (const s of Object.values(state.settlements)) {
    if (s.factionId !== state.player.factionId) continue;
    const d = pos ? dist2(pos, s.mapPos) : 0;
    if (!best || d < best.d || (d === best.d && s.id < best.id)) best = { id: s.id, d };
  }
  return best?.id;
}

/** What a stand-down brought home. */
export interface StandDownResult {
  men: number;
  silver: number;
  tons: number;
  rations: number;
}

/**
 * The expedition stands down at a holding: men to the garrison, silver to the treasury, goods to the house
 * storehouse (economy's changeStores; elsewhere than the capital the goods are carted there too), leftover
 * rations to the storehouse at the capital or the holding's food stores elsewhere. Ships dock there; everyone
 * aboard goes ashore there. Ends map mode when it was the player's expedition. `quiet` skips the homecoming
 * notification (the lost-expedition rule says what happened itself).
 */
export function standDown(draft: GameState, ctx: SimContext, fleetId: FleetId, atId: SettlementId, opts: { quiet?: boolean } = {}): StandDownResult | undefined {
  const f = draft.fleets[fleetId];
  const s = draft.settlements[atId];
  if (!f || !s) return undefined;
  const men = { ...f.men } as Record<string, number>;
  const menCount = menTotal(men);
  if (ctx.env.effects.has('moveMen')) ctx.applyEffects([{ op: 'moveMen', from: { fleetId }, to: { settlementId: atId }, men, wounded: true } as never]);
  else moveMen(draft, ctx, { fleetId }, { settlementId: atId }, men);
  const silver = Math.max(0, Math.floor(f.silver));
  const faction = draft.factions[f.ownerId];
  if (faction && silver > 0) faction.treasury += silver;
  const goods: Partial<Record<GoodId, number>> = {};
  for (const [good, t] of Object.entries(f.cargo) as [GoodId, number][]) if (t > 0 && good !== 'rations') goods[good] = t;
  const rations = Math.max(0, Math.floor(f.rations));
  const atCapital = storehouseFor(draft, atId) !== undefined;
  const stores = draft.storehouse !== undefined && ctx.env.effects.has('changeStores');
  const toStore = stores && atCapital ? rations : 0;
  if (stores && (toStore > 0 || Object.keys(goods).length > 0)) ctx.applyEffects([{ op: 'changeStores', goods, rations: toStore } as never]);
  if (toStore === 0 && s.holding && rations > 0) {
    // Leftover rations return to the holding's food stores.
    s.holding.foodMonths = Math.round((s.holding.foodMonths + rations / (Math.max(1, s.pop) * 30)) * 1000) / 1000;
  }
  let tons = 0;
  for (const v of Object.values(goods)) tons += v ?? 0;
  for (const id of f.shipIds) {
    const ship = draft.ships[id];
    if (!ship) continue;
    delete ship.locationFleetId;
    ship.dockedAt = atId;
  }
  // Everyone aboard goes ashore (the leaders, the ruler, anyone else the fleet carried).
  const chars = live(draft.characters);
  for (const id of Object.keys(chars) as (keyof typeof chars)[]) {
    const loc = chars[id]?.location;
    if (loc?.kind !== 'fleet' || loc.id !== fleetId) continue;
    const c = draft.characters[id];
    if (c) c.location = { kind: 'settlement', id: atId };
  }
  delete draft.fleets[fleetId];
  const slice = sliceOf(draft);
  delete slice.starving[fleetId];
  if (draft.player.expeditionFleetId === fleetId) {
    delete draft.player.expeditionFleetId;
    if (draft.meta.mode !== 'ended') draft.meta.mode = 'hub';
  }
  ctx.emit({ type: 'ExpeditionReturned', fleetId, atId, silver, goods, men: menCount, rations });
  if (!opts.quiet) {
    if (tons > 0) ctx.notify('expeditions.notify.returnedGoods', { priority: 'normal', vars: { silver, men: menCount, place: s.name, tons: Math.round(tons * 10) / 10 }, link: { kind: 'settlement', id: atId } });
    else ctx.notify('expeditions.notify.returned', { priority: 'normal', vars: { silver, men: menCount, place: s.name }, link: { kind: 'settlement', id: atId } });
  }
  return { men: menCount, silver, tons, rations };
}

// ---------------------------------------------------------------------------------------------
// The march (a land expedition): a shipless baggage fleet whose men march as its war-band.

/** Is this fleet a march's baggage (no ships; its men march as its land party)? */
export function isOverland(f: Fleet | undefined): boolean {
  return f !== undefined && f.overland !== undefined;
}

/** The war-band of a march (the first land party of the fleet whose army exists), if any. */
export function warBandOf(state: GameState, fleetId: FleetId): ArmyId | undefined {
  const parties = state.expeditions?.landParties ?? {};
  for (const armyId of Object.keys(parties) as ArmyId[]) if (parties[armyId] === fleetId && Object.hasOwn(state.armies, armyId)) return armyId;
  return undefined;
}

/** Men of an army (all squads). */
export function armyMenTotal(state: GameState, armyId: ArmyId | undefined): number {
  if (armyId === undefined) return 0;
  let n = 0;
  for (const sq of state.armies[armyId]?.squads ?? []) n += Math.max(0, sq.men);
  return n;
}

/**
 * The march stands down at a holding: the war-band rejoins its baggage (military's disbandArmy into the fleet;
 * its leaders with it), then the usual stand-down (men to the garrison, silver to the treasury, goods and food
 * to the storehouse, the scene back at the hall).
 */
export function standDownMarch(draft: GameState, ctx: SimContext, fleetId: FleetId, atId: SettlementId, opts: { quiet?: boolean } = {}): StandDownResult | undefined {
  const slice = sliceOf(draft);
  for (const armyId of Object.keys(slice.landParties) as ArmyId[]) {
    if (slice.landParties[armyId] !== fleetId) continue;
    delete slice.landParties[armyId];
    if (!Object.hasOwn(draft.armies, armyId)) continue;
    const chars = live(draft.characters);
    for (const id of Object.keys(chars) as (keyof typeof chars)[]) {
      const loc = chars[id]?.location;
      if (loc?.kind !== 'army' || loc.id !== armyId) continue;
      const c = draft.characters[id];
      if (c) c.location = { kind: 'fleet', id: fleetId };
    }
    if (ctx.env.effects.has('disbandArmy')) ctx.applyEffects([{ op: 'disbandArmy', armyId, to: { fleetId } } as never]);
  }
  return standDown(draft, ctx, fleetId, atId, opts);
}
