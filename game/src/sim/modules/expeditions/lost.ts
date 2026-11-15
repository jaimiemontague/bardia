/**
 * The expedition always finds its way back to the hall.
 *
 * DEAD ENDS this file closes (each was a soft-lock before: map mode with no order that could succeed):
 *   - no ship afloat (storm, sea battle sunk or taken), at sea or with a party ashore → lost ('shipsLost')
 *   - ships but no man aboard and none ashore (starvation, a battle that killed every crewman) → lost ('noCrew')
 *   - no harbour of the house reachable by sea, ice aside (capital lost, no water) → nearest own harbour, else
 *     lost ('noWayHome'); ice only delays (the player waits for the thaw, the crews eat or starve meanwhile)
 *   - every leader dead, taken or mortally wounded → a lieutenant takes command; with none left the crews turn
 *     for home on their own and take no other course (`noLeader`)
 *   - the fleet record gone while `player.expeditionFleetId` still names it → lost ('vanished')
 *   - a land party whose army is gone, map mode with no expedition, a "homeward" flag with no course left
 *     → repaired quietly
 *
 * LOST: the survivors come home at once (no voyage home is modelled, so nothing can stall on the way). Of the
 * men still aboard, `lost.survivorShare` reach home after a shipwreck, `lost.overlandSurvivorShare` when the
 * ships could not sail on (and for a land party ashore). Men the storm or battle already killed stay dead.
 * Cargo, silver and rations aboard are lost; ships still afloat are scuttled. Living leaders aboard come home,
 * each wounded with `lost.leaderWoundChance` (people's woundCharacter). The fleet stands down through
 * `standDown` like any homecoming. A ruler who is dead or held captive is the people module's (succession,
 * captivity): those flows end at the hall too, because the expedition no longer holds the scene.
 *
 * WHEN: the cheap checks run hourly (after the weather's storms in the same hour), when a decision is resolved
 * (sea battles and encounters are settled through commands), and daily after provisions (starvation). The
 * leader check and any route-finding run daily only. Nothing acts while a decision is pending.
 *
 * THE MARCH (a land expedition: a shipless baggage fleet whose men march as its war-band) has its own dead ends:
 *   - no man of the war-band left standing (killed, starved to the last, the army gone) → lost ('noMen'); the
 *     leaders come home
 *   - every leader dead or taken → a lieutenant takes command; with none left the war-band marches home on its
 *     own (a route on the land grid) and takes no other order
 *   - no holding of the house reachable on foot → lost ('noWayHome'): the survivors find their own way home
 *   - starving: men die as at sea; when the last one falls the march is lost ('noMen')
 * Every day the baggage follows the war-band, stragglers left in the baggage rejoin it, the carrying limit
 * follows the men (goods beyond it are left behind).
 */
import type { SimContext } from '@sim/core/module';
import type { ArmyId, Character, CharId, Fleet, FleetId, GameState, GoodId, SettlementId } from '@sim/core/state';
import { armyMenTotal, dist2, homeFor, homeHarbours, isOverland, live, menTotal, sliceOf, standDown, standDownMarch, warBandOf } from './homecoming';
import type { ExpeditionBlock, ExpeditionLostCause } from './types';
import './types';

type ExpeditionFleet = Fleet & { homeward?: boolean; homewardTo?: SettlementId };

/** Land parties ashore from a fleet (army ids, in insertion order). */
export function partiesOf(state: GameState, fleetId: FleetId): ArmyId[] {
  const parties = state.expeditions?.landParties ?? {};
  const out: ArmyId[] = [];
  for (const armyId of Object.keys(parties) as ArmyId[]) if (parties[armyId] === fleetId) out.push(armyId);
  return out;
}

/** Can this character command the expedition: alive, free, not dying, and with the fleet or its party ashore. */
export function ableLeader(c: Character | undefined, fleetId: FleetId, parties: readonly ArmyId[]): boolean {
  if (!c || !c.alive || c.health.wound === 'mortal') return false;
  if (c.location.kind === 'fleet') return c.location.id === fleetId;
  if (c.location.kind === 'army') return parties.includes(c.location.id);
  return false;
}

/** The leader, the lieutenants and the ruler (when aboard), without repeats. */
function commandCandidates(state: GameState, f: Fleet): CharId[] {
  const out: CharId[] = [];
  for (const id of [f.leaderId, ...f.lieutenantIds, state.player.rulerId]) if (!out.includes(id)) out.push(id);
  return out;
}

/** True when someone aboard (or with the party ashore) can still lead the expedition. */
export function hasAbleLeader(state: GameState, f: Fleet): boolean {
  const parties = partiesOf(state, f.id);
  return commandCandidates(state, f).some((id) => ableLeader(state.characters[id], f.id, parties));
}

/**
 * Why the player's expedition cannot take a new course (or land men) right now; undefined when it can.
 * Pure: the commands and the HUD share it. "Sail home" is never blocked by it (it always ends at the hall).
 */
export function expeditionBlock(state: GameState, fleetId: FleetId | undefined = state.player.expeditionFleetId): ExpeditionBlock | undefined {
  const f = fleetId !== undefined && Object.hasOwn(state.fleets, fleetId) ? state.fleets[fleetId] : undefined;
  if (!f) return undefined;
  if (isOverland(f)) {
    const band = warBandOf(state, f.id);
    if (band === undefined || armyMenTotal(state, band) + menTotal(f.men) === 0) return 'noMen';
    if (!hasAbleLeader(state, f)) return 'noLeader';
    return undefined;
  }
  if (f.shipIds.length === 0) return 'noShips';
  const ashore = partiesOf(state, f.id).length > 0;
  if (menTotal(f.men) === 0 && !ashore) return 'noCrew';
  if (!hasAbleLeader(state, f)) return 'noLeader';
  return undefined;
}

/** Why the expedition can no longer sail at all (lost), or undefined. */
function lostCause(state: GameState, f: Fleet): ExpeditionLostCause | undefined {
  if (isOverland(f)) {
    const band = warBandOf(state, f.id);
    return band === undefined || armyMenTotal(state, band) + menTotal(f.men) === 0 ? 'noMen' : undefined;
  }
  if (f.shipIds.length === 0) return 'shipsLost';
  if (menTotal(f.men) === 0 && partiesOf(state, f.id).length === 0) return 'noCrew';
  return undefined;
}

/** Characters located in a fleet or army (ids, sorted), read from a live snapshot. */
function charactersAt(draft: GameState, kind: 'fleet' | 'army', id: string): CharId[] {
  const chars = live(draft.characters);
  const out: CharId[] = [];
  for (const cid of Object.keys(chars) as CharId[]) {
    const loc = chars[cid]?.location;
    if (loc && loc.kind === kind && loc.id === id) out.push(cid);
  }
  return out.sort();
}

/** Men of an army by unit. */
function armyMen(draft: GameState, armyId: ArmyId): Record<string, number> {
  const out: Record<string, number> = {};
  for (const sq of draft.armies[armyId]?.squads ?? []) if (sq.men > 0) out[sq.unit] = (out[sq.unit] ?? 0) + sq.men;
  return out;
}

/** Kills `1 − share` of each unit in a container (military's killMen; else the record directly). Returns the dead. */
function thin(draft: GameState, ctx: SimContext, ref: { fleetId: FleetId } | { armyId: ArmyId }, men: Readonly<Record<string, number>>, share: number): number {
  let dead = 0;
  for (const unit of Object.keys(men).sort()) {
    const n = Math.max(0, Math.floor(men[unit] ?? 0));
    const lose = n - Math.floor(n * share);
    if (lose <= 0) continue;
    dead += lose;
    if (ctx.env.effects.has('killMen')) {
      ctx.applyEffects([{ op: 'killMen', ...ref, unit, count: lose } as never]);
    } else if ('fleetId' in ref) {
      const f = draft.fleets[ref.fleetId];
      if (f) {
        f.men[unit] = n - lose;
        if (f.men[unit] === 0) delete f.men[unit];
      }
    } else {
      let left = lose;
      for (const sq of draft.armies[ref.armyId]?.squads ?? []) {
        if (sq.unit !== unit || left <= 0) continue;
        const k = Math.min(sq.men, left);
        sq.men -= k;
        left -= k;
      }
    }
  }
  return dead;
}

/**
 * The expedition is lost: the survivors come home at once (see the file header for the rule). Always ends
 * with no expedition, the scene back at the hall (unless the game has ended) and the slice clean.
 */
export function loseExpedition(draft: GameState, ctx: SimContext, fleetId: FleetId, cause: ExpeditionLostCause): void {
  const t = ctx.tunables.expeditions.lost;
  const has = (op: string) => ctx.env.effects.has(op);
  const slice = sliceOf(draft);
  const record = Object.hasOwn(draft.fleets, fleetId) ? draft.fleets[fleetId] : undefined;
  // A fleet record that is no longer the player's is never touched: only the expedition's people come home.
  const f = record?.ownerId === draft.player.factionId ? record : undefined;
  const overland = isOverland(f);
  const atId = homeFor(draft, f?.pos);
  let menLost = 0;

  // The men still aboard: after a shipwreck some reach the shore; men who abandon ships that cannot sail walk.
  if (f) menLost += thin(draft, ctx, { fleetId }, { ...f.men }, cause === 'shipsLost' ? t.survivorShare : t.overlandSurvivorShare);

  // Land parties ashore march home overland; their leaders come home with the others.
  for (const armyId of partiesOf(draft, fleetId)) {
    delete slice.landParties[armyId];
    if (!Object.hasOwn(draft.armies, armyId)) continue;
    for (const cid of charactersAt(draft, 'army', armyId)) {
      const c = draft.characters[cid];
      if (c) c.location = f ? { kind: 'fleet', id: fleetId } : atId !== undefined ? { kind: 'settlement', id: atId } : { kind: 'none' };
    }
    menLost += thin(draft, ctx, { armyId }, armyMen(draft, armyId), t.overlandSurvivorShare);
    if (has('disbandArmy')) {
      const to = f ? { fleetId } : atId !== undefined ? { settlementId: atId } : undefined;
      ctx.applyEffects([{ op: 'disbandArmy', armyId, ...(to ? { to } : {}) } as never]);
    }
  }

  // Cargo, silver and rations aboard are lost; ships still afloat are scuttled.
  let silverLost = 0;
  let tonsLost = 0;
  if (f) {
    silverLost = Math.max(0, Math.floor(f.silver));
    for (const [good, v] of Object.entries(f.cargo) as [GoodId, number][]) if (good !== 'rations') tonsLost += Math.max(0, v ?? 0);
    f.silver = 0;
    f.cargo = {};
    f.rations = 0;
    if (has('sinkShip')) for (const shipId of [...f.shipIds]) ctx.applyEffects([{ op: 'sinkShip', shipId, cause: 'scuttled' } as never]);
  }

  // Living leaders aboard come home, some of them hurt.
  const aboard = f ? charactersAt(draft, 'fleet', fleetId) : [];
  if (t.leaderWound !== 'none' && has('woundCharacter')) {
    const rng = ctx.rng('expeditions:lost');
    for (const cid of aboard) {
      const c = draft.characters[cid];
      if (!c?.alive) continue;
      if (rng.chance(t.leaderWoundChance)) ctx.applyEffects([{ op: 'woundCharacter', charId: cid, severity: t.leaderWound, cause: 'shipwreck' } as never]);
    }
  }

  // Stop the fleet through the world's own path: a course that cannot be plotted clears the fleet's route and
  // its entry in the world's mover index ('site_lost' is never minted: ids are numbered), so the index never
  // names a fleet that is gone.
  if ((f || !record) && !overland && has('computeRoute')) ctx.applyEffects([{ op: 'computeRoute', entityId: fleetId, to: { siteId: 'site_lost' } } as never]);

  // Home, through the same stand-down as any homecoming.
  let survivors = 0;
  const at = atId !== undefined ? draft.settlements[atId] : undefined;
  if (f && atId !== undefined && at) {
    survivors = standDown(draft, ctx, fleetId, atId, { quiet: true })?.men ?? 0;
  } else {
    // No fleet record, or no holding left to come home to: clear what remains. Ships that still name the
    // fleet are brought into the home harbour.
    const ships = live(draft.ships);
    for (const shipId of Object.keys(ships) as (keyof typeof ships)[]) {
      if ((record && !f) || ships[shipId]?.locationFleetId !== fleetId) continue;
      const ship = draft.ships[shipId];
      if (!ship) continue;
      delete ship.locationFleetId;
      if (atId !== undefined) ship.dockedAt = atId;
    }
    if (f) delete draft.fleets[fleetId];
    for (const cid of charactersAt(draft, 'fleet', fleetId)) {
      const c = draft.characters[cid];
      if (c) c.location = atId !== undefined ? { kind: 'settlement', id: atId } : { kind: 'none' };
    }
    delete slice.starving[fleetId];
    if (draft.player.expeditionFleetId === fleetId) {
      delete draft.player.expeditionFleetId;
      if (draft.meta.mode !== 'ended') draft.meta.mode = 'hub';
    }
    // The other modules' bookkeeping for a homecoming (the visit, the loot screen, encounter cooldowns).
    if (atId !== undefined) ctx.emit({ type: 'ExpeditionReturned', fleetId, atId, silver: 0, goods: {}, men: 0 });
  }

  const vars = { place: at?.name ?? '', survivors, lost: menLost, silver: silverLost, tons: Math.round(tonsLost * 10) / 10 };
  // A march has its own words (no ships to scuttle).
  const words = overland ? `march.${cause}` : cause;
  const event: { type: 'ExpeditionLost'; fleetId: FleetId; cause: ExpeditionLostCause; atId?: SettlementId; survivors: number; menLost: number; silverLost: number; tonsLost: number } = {
    type: 'ExpeditionLost',
    fleetId,
    cause,
    survivors,
    menLost,
    silverLost,
    tonsLost: vars.tons,
  };
  if (atId !== undefined) event.atId = atId;
  ctx.emit(event);
  ctx.notify(`expeditions.notify.lost.${words}`, { priority: 'critical', vars, ...(atId !== undefined ? { link: { kind: 'settlement' as const, id: atId } } : {}) });
  ctx.narrate(`expeditions.narration.lost.${words}`, vars, 'skald');
  ctx.chronicle({ kind: 'expeditions.lost', textKey: `expeditions.chronicle.lost.${words}`, importance: 3, vars, refs: [fleetId] });
}

/** How a try to sail home went. */
export type SailHomeResult = 'home' | 'sailing' | 'iced' | 'unreachable' | 'noNavigation';

/**
 * Sets the expedition's course for home: the capital, else (when the capital cannot be reached by sea for a
 * reason other than ice) the house's nearest other harbour. Stands down at once when already there. Never
 * throws; the caller decides what 'iced' and 'unreachable' mean.
 */
export function sailHome(draft: GameState, ctx: SimContext, fleetId: FleetId): SailHomeResult {
  const f = draft.fleets[fleetId] as ExpeditionFleet | undefined;
  if (!f) return 'unreachable';
  const t = ctx.tunables.expeditions;
  const targets = homeHarbours(draft, f.pos, t.lost.fallbackHarbours);
  const capital = draft.player.capitalId;
  let iced = false;
  for (const sid of targets) {
    const s = draft.settlements[sid];
    if (!s) continue;
    if (dist2(f.pos, s.mapPos) <= t.homeRadius ** 2 && f.mode !== 'sailing') {
      standDown(draft, ctx, fleetId, sid);
      return 'home';
    }
    if (!ctx.env.effects.has('computeRoute')) return 'noNavigation';
    const before = ctx.events.length;
    ctx.applyEffects([{ op: 'computeRoute', entityId: fleetId, to: { settlementId: sid } } as never]);
    const emitted = ctx.events.slice(before);
    const failed = emitted.find((e) => e.type === ('RouteFailed' as never) && (e as unknown as { entityId?: string }).entityId === fleetId) as unknown as { reason?: string } | undefined;
    if (failed) {
      if (failed.reason === 'iced') {
        iced = true;
        // The capital is iced in: wait for the thaw rather than unload elsewhere.
        if (sid === capital) break;
      }
      continue;
    }
    const g = draft.fleets[fleetId] as ExpeditionFleet | undefined;
    if (!g) return 'home';
    g.homeward = true;
    if (sid !== capital) g.homewardTo = sid;
    else if (g.homewardTo !== undefined) delete g.homewardTo;
    // Already there (computeRoute emitted Arrived at once): stand down now.
    if (g.route.length === 0 && emitted.some((e) => e.type === ('Arrived' as never))) {
      standDown(draft, ctx, fleetId, sid);
      return 'home';
    }
    return 'sailing';
  }
  return iced ? 'iced' : 'unreachable';
}

/** How a try to march home went. */
export type MarchHomeResult = 'home' | 'marching' | 'unreachable' | 'noNavigation';

/** Holdings a march can come home to, best first: the capital (while it is the house's), then the nearest others. */
function homeHoldings(state: GameState, pos: { x: number; y: number }, fallbacks: number): SettlementId[] {
  const player = state.player.factionId;
  const cap = state.player.capitalId;
  const out: SettlementId[] = [];
  if (Object.hasOwn(state.settlements, cap) && state.settlements[cap]?.factionId === player) out.push(cap);
  const others: { id: SettlementId; d: number }[] = [];
  for (const s of Object.values(state.settlements)) if (s.factionId === player && s.id !== cap) others.push({ id: s.id, d: dist2(pos, s.mapPos) });
  others.sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
  for (const o of others.slice(0, Math.max(0, fallbacks))) out.push(o.id);
  return out;
}

/**
 * Sets the march's war-band on the road home: the capital, else (when it cannot be reached on foot) the house's
 * nearest other holding. Stands down at once when already there. Never throws.
 */
export function marchHome(draft: GameState, ctx: SimContext, fleetId: FleetId): MarchHomeResult {
  const f = draft.fleets[fleetId] as ExpeditionFleet | undefined;
  const armyId = warBandOf(draft, fleetId);
  const army = armyId !== undefined ? draft.armies[armyId] : undefined;
  if (!f || !army || armyId === undefined) return 'unreachable';
  const t = ctx.tunables.expeditions;
  const capital = draft.player.capitalId;
  for (const sid of homeHoldings(draft, army.pos, t.march.fallbackHoldings)) {
    const s = draft.settlements[sid];
    if (!s) continue;
    if (dist2(army.pos, s.mapPos) <= t.homeRadius ** 2) {
      standDownMarch(draft, ctx, fleetId, sid);
      return 'home';
    }
    if (!ctx.env.effects.has('computeRoute')) return 'noNavigation';
    const before = ctx.events.length;
    ctx.applyEffects([{ op: 'computeRoute', entityId: armyId, to: { settlementId: sid } } as never]);
    const emitted = ctx.events.slice(before);
    if (emitted.some((e) => e.type === ('RouteFailed' as never) && (e as unknown as { entityId?: string }).entityId === armyId)) continue;
    const g = draft.fleets[fleetId] as ExpeditionFleet | undefined;
    if (!g) return 'home';
    g.homeward = true;
    if (sid !== capital) g.homewardTo = sid;
    else if (g.homewardTo !== undefined) delete g.homewardTo;
    if ((draft.armies[armyId]?.route.length ?? 0) === 0 && emitted.some((e) => e.type === ('Arrived' as never))) {
      standDownMarch(draft, ctx, fleetId, sid);
      return 'home';
    }
    return 'marching';
  }
  return 'unreachable';
}

/** Leaderless: a lieutenant (or the ruler aboard) takes command; with none, the crews turn for home. */
function checkCommand(draft: GameState, ctx: SimContext, f: ExpeditionFleet): void {
  const parties = partiesOf(draft, f.id);
  if (ableLeader(draft.characters[f.leaderId], f.id, parties)) return;
  const next = commandCandidates(draft, f).find((id) => id !== f.leaderId && ableLeader(draft.characters[id], f.id, parties));
  if (next !== undefined) {
    // The fallen and the taken leave the roll; the wounded stay aboard as lieutenants.
    const rest = [f.leaderId, ...f.lieutenantIds].filter((cid, i, all) => {
      const c = draft.characters[cid];
      return all.indexOf(cid) === i && cid !== next && c !== undefined && c.alive && c.location.kind !== 'captive';
    });
    f.leaderId = next;
    f.lieutenantIds = rest;
    return;
  }
  // No one can lead a march: the war-band walks home on its own.
  if (isOverland(f)) {
    const band = warBandOf(draft, f.id);
    if (f.homeward && band !== undefined && (draft.armies[band]?.route.length ?? 0) > 0) return;
    const r = marchHome(draft, ctx, f.id);
    if (r === 'unreachable') {
      loseExpedition(draft, ctx, f.id, 'noWayHome');
      return;
    }
    if (r === 'marching') {
      ctx.emit({ type: 'ExpeditionLeaderless', fleetId: f.id });
      ctx.notify('expeditions.notify.marchLeaderless', { priority: 'critical', link: { kind: 'fleet', id: f.id } });
    }
    return;
  }
  // No one can lead. A party ashore marches back to the ships first.
  if (parties.length > 0) {
    if (!ctx.env.effects.has('computeRoute')) return;
    for (const armyId of parties) {
      const army = draft.armies[armyId];
      if (!army || army.route.length > 0) continue;
      ctx.applyEffects([{ op: 'computeRoute', entityId: armyId, to: { x: f.pos.x, y: f.pos.y } } as never]);
    }
    return;
  }
  if (f.homeward && f.route.length > 0) return;
  const r = sailHome(draft, ctx, f.id);
  if (r === 'unreachable') {
    loseExpedition(draft, ctx, f.id, 'noWayHome');
    return;
  }
  if (r === 'sailing') {
    ctx.emit({ type: 'ExpeditionLeaderless', fleetId: f.id });
    ctx.notify('expeditions.notify.leaderless', { priority: 'critical', link: { kind: 'fleet', id: f.id } });
  }
}

/**
 * The guarantee: run hourly, on every resolved decision and daily (`daily` adds the leader check and any
 * route-finding). Brings a lost expedition home, repairs dangling references, and keeps map mode only while
 * an expedition is out. Does nothing while a decision is pending.
 */
export function guardExpedition(draft: GameState, ctx: SimContext, daily: boolean): void {
  if (draft.pending !== null) return;
  const id = draft.player.expeditionFleetId;
  if (id === undefined) {
    if (draft.meta.mode === 'map') draft.meta.mode = 'hub';
    return;
  }
  const f = Object.hasOwn(draft.fleets, id) ? (draft.fleets[id] as ExpeditionFleet) : undefined;
  if (!f || f.ownerId !== draft.player.factionId) {
    loseExpedition(draft, ctx, id, 'vanished');
    return;
  }
  if (isOverland(f)) {
    guardMarch(draft, ctx, f, daily);
    return;
  }
  // Land parties whose army is gone: the fleet is no longer waiting for them.
  const slice = draft.expeditions;
  if (slice) {
    for (const armyId of partiesOf(draft, id)) {
      if (Object.hasOwn(draft.armies, armyId)) continue;
      delete slice.landParties[armyId];
      for (const cid of charactersAt(draft, 'army', armyId)) {
        const c = draft.characters[cid];
        if (c) c.location = { kind: 'fleet', id };
      }
      if (f.mode === 'landed' && partiesOf(draft, id).length === 0) f.mode = 'beached';
    }
  }
  const cause = lostCause(draft, f);
  if (cause !== undefined) {
    loseExpedition(draft, ctx, id, cause);
    return;
  }
  if (!daily) return;
  // A homeward flag with no course left (the course was cleared, or home was taken): orders open again.
  if (f.homeward && f.route.length === 0 && f.mode !== 'sailing') {
    delete f.homeward;
    if (f.homewardTo !== undefined) delete f.homewardTo;
  }
  checkCommand(draft, ctx, f);
}

/**
 * The march's share of the guarantee (see the file header): lost when no man is left, the baggage at the
 * war-band's side, stragglers into the war-band; daily the carrying limit and the leader check.
 */
function guardMarch(draft: GameState, ctx: SimContext, f: ExpeditionFleet, daily: boolean): void {
  const slice = sliceOf(draft);
  // Party entries whose army is gone are dropped (their leaders back on the baggage roll).
  for (const armyId of partiesOf(draft, f.id)) {
    if (Object.hasOwn(draft.armies, armyId)) continue;
    delete slice.landParties[armyId];
    for (const cid of charactersAt(draft, 'army', armyId)) {
      const c = draft.characters[cid];
      if (c) c.location = { kind: 'fleet', id: f.id };
    }
  }
  const cause = lostCause(draft, f);
  if (cause !== undefined) {
    loseExpedition(draft, ctx, f.id, cause);
    return;
  }
  const armyId = warBandOf(draft, f.id) as ArmyId;
  const army = draft.armies[armyId];
  if (!army) return;
  // Men that found their way into the baggage (a storylet's recruits) join the war-band.
  if (menTotal(f.men) > 0 && ctx.env.effects.has('moveMen')) ctx.applyEffects([{ op: 'moveMen', from: { fleetId: f.id }, to: { armyId }, men: { ...f.men } } as never]);
  // The baggage goes where the war-band goes.
  if (f.pos.x !== army.pos.x || f.pos.y !== army.pos.y) f.pos = { x: army.pos.x, y: army.pos.y };
  if (!daily) return;
  carryLimit(draft, ctx, f, armyMenTotal(draft, armyId) + charactersAt(draft, 'army', armyId).length);
  if (f.homeward && army.route.length === 0) {
    delete f.homeward;
    if (f.homewardTo !== undefined) delete f.homewardTo;
  }
  checkCommand(draft, ctx, f);
}

/** The war-band's carrying limit follows its marchers; trade goods and plunder beyond it are left behind (cheapest first). */
function carryLimit(draft: GameState, ctx: SimContext, f: ExpeditionFleet, marchers: number): void {
  const capacity = Math.round(marchers * ctx.tunables.expeditions.march.carryTonsPerMan * 1000) / 1000;
  if (f.overland && f.overland.carryT !== capacity) f.overland.carryT = capacity;
  let used = Math.max(0, f.rations) / ctx.balance.economy.rationsPerTon;
  // The cheapest goods (by base price per ton) are left first.
  const price = (g: GoodId) => (ctx.balance.goods as Record<string, { basePerTon?: number } | undefined>)[g]?.basePerTon ?? 0;
  const goods = (Object.keys(f.cargo) as GoodId[]).filter((g) => g !== 'rations' && (f.cargo[g] ?? 0) > 0).sort((a, b) => price(a) - price(b) || (a < b ? -1 : 1));
  for (const g of goods) used += f.cargo[g] ?? 0;
  let over = Math.round((used - capacity) * 1000) / 1000;
  if (over <= 0) return;
  let dropped = 0;
  for (const g of goods) {
    if (over <= 0) break;
    const have = f.cargo[g] ?? 0;
    const drop = Math.min(have, over);
    const left = Math.round((have - drop) * 1000) / 1000;
    if (left > 0) f.cargo[g] = left;
    else delete f.cargo[g];
    over = Math.round((over - drop) * 1000) / 1000;
    dropped += drop;
  }
  if (dropped > 0) ctx.notify('expeditions.notify.leftBehind', { priority: 'normal', vars: { tons: Math.round(dropped * 10) / 10 }, link: { kind: 'fleet', id: f.id } });
}
