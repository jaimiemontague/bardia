/**
 * Test fixtures for the encounters module (other modules' tests may import them): a small world with the
 * player's expedition at sea, a land party ashore, and fake battle/news/people/military modules that record
 * the effects encounters applies (so a test sees what would have happened without loading those modules).
 */
import type { SimModule } from '@sim/core/module';
import type { ArmyId, FactionId, FleetId, GameState, SettlementId } from '@sim/core/state';
import { getOrCreateRelation } from '@sim/core/factory';
import { inDraft, testWorld, type TestWorld } from '@sim/testing';
import type { EncountersState } from './types';
import { module } from './index';

/** Effects the fakes received, in order. */
export interface TestEffectLog {
  ops: { op: string; [k: string]: unknown }[];
}

/** How the fake sea/land battle ends: the player wins, loses, or nothing is emitted (time stays with the pre-battle decision). */
export type TestBattleEnd = 'win' | 'lose' | 'none';

/**
 * Fake modules for the ops encounters uses but does not own. `startSeaBattle` / `startBattle` record the
 * request and, unless `end` is 'none', emit the matching *Ended event at once with the given winner.
 */
export function testFakes(log: TestEffectLog, end: { value: TestBattleEnd } = { value: 'none' }): SimModule[] {
  const record = (op: string) => (_d: GameState, e: { op: string }) => {
    log.ops.push(JSON.parse(JSON.stringify(e)) as { op: string });
  };
  const ended = (type: 'SeaBattleEnded' | 'BattleEnded') => (d: GameState, e: { op: string; attacker?: { fleetId?: string; isPlayer?: boolean }; origin?: string }, ctx: { emit(ev: never): void }) => {
    log.ops.push(JSON.parse(JSON.stringify(e)) as { op: string });
    if (end.value === 'none') return;
    const weAttack = e.attacker?.isPlayer === true || (e.attacker?.fleetId !== undefined && e.attacker.fleetId === d.player.expeditionFleetId);
    const playerSide = weAttack ? 'attacker' : 'defender';
    const winner = end.value === 'win' ? playerSide : weAttack ? 'defender' : 'attacker';
    ctx.emit({ type, origin: e.origin, playerSide, result: { winner } } as never);
  };
  const ops = ['hearNews', 'observeSettlement', 'grantXp', 'woundCharacter', 'killMen', 'addNews'];
  const fx: Record<string, unknown> = {};
  for (const op of ops) fx[op] = record(op);
  fx['startSeaBattle'] = ended('SeaBattleEnded');
  fx['startBattle'] = ended('BattleEnded');
  return [{ id: 'testEncounterFakes', order: 990, effects: fx as SimModule['effects'] }];
}

/** A world with the player's expedition under way at sea next to faction 1's coast. */
export interface TestVoyage extends TestWorld {
  fleetId: FleetId;
  /** Faction 1 (its settlements lie near the fleet). */
  neighbour: FactionId;
  log: TestEffectLog;
  end: { value: TestBattleEnd };
}

/** Builds the voyage fixture. `zone` sets the fleet's sea zone (geography id). */
export function testVoyage(opts: { seed?: string; zone?: string | null; war?: boolean; fakes?: boolean; men?: number; silver?: number } = {}): TestVoyage {
  const log: TestEffectLog = { ops: [] };
  const end = { value: 'none' as TestBattleEnd };
  const modules = opts.fakes === false ? [module] : [module, ...testFakes(log, end)];
  const w = testWorld({ modules, factions: 3, seed: opts.seed ?? 'enc-test' });
  const player = w.state.player.factionId;
  const fleetId = (w.fleetIds[player] ?? [])[0] as FleetId;
  const neighbour = w.factionIds[1] as FactionId;
  const near = (w.settlementIds[neighbour] ?? [])[0] as SettlementId;
  const r = inDraft(w.state, w.env, (d) => {
    const f = d.fleets[fleetId];
    const s = d.settlements[near];
    if (!f || !s) throw new Error('fixture: no fleet');
    f.mode = 'sailing';
    f.pos = { x: s.mapPos.x - 6, y: s.mapPos.y + 4 };
    f.route = [{ x: s.mapPos.x + 60, y: s.mapPos.y + 20 }];
    f.voyageDays = 5;
    f.men = { bondi: opts.men ?? 40, archers: 10 };
    f.silver = opts.silver ?? 0;
    (f as typeof f & { seaZoneId?: string | null }).seaZoneId = opts.zone === undefined ? 'whaleRoad' : opts.zone;
    for (const id of f.shipIds) {
      const ship = d.ships[id];
      if (ship) {
        delete ship.dockedAt;
        ship.locationFleetId = f.id;
      }
    }
    d.player.expeditionFleetId = f.id;
    const ruler = d.characters[d.player.rulerId];
    if (ruler) ruler.location = { kind: 'fleet', id: f.id };
    d.meta.mode = 'map';
    if (opts.war) {
      const rel = getOrCreateRelation(d, player, neighbour);
      rel.stance = 'war';
    }
  });
  return { ...w, state: r.state, fleetId, neighbour, log, end };
}

/** Puts a land party of the expedition ashore (an army whose men left the fleet). */
export function testLandParty(v: TestVoyage, men = 40): { state: GameState; armyId: ArmyId } {
  let armyId = '' as ArmyId;
  const r = inDraft(v.state, v.env, (d, ctx) => {
    const f = d.fleets[v.fleetId];
    if (!f) throw new Error('fixture: no fleet');
    armyId = ctx.newId('arm');
    d.armies[armyId] = { id: armyId, ownerId: f.ownerId, leaderId: f.leaderId, squads: [{ leaderId: f.leaderId, unit: 'bondi', men, vetStars: 0, formation: 'line' }], pos: { x: f.pos.x + 3, y: f.pos.y }, route: [{ x: f.pos.x + 20, y: f.pos.y }] };
    f.mode = 'landed';
    f.route = [];
    (d as GameState & { expeditions?: { version: number; starving: Record<string, number>; landParties: Record<string, string> } }).expeditions = { version: 1, starving: {}, landParties: { [armyId]: f.id } };
    for (const id of [f.leaderId, d.player.rulerId]) {
      const c = d.characters[id];
      if (c) c.location = { kind: 'army', id: armyId };
    }
  });
  return { state: r.state, armyId };
}

/** The encounters slice of a state (empty when the module never ran). */
export function encountersSlice(state: GameState): EncountersState {
  return state.encounters ?? { version: 1, count: 0, quietUntil: {}, met: {}, fights: {} };
}
