/**
 * Applying a sea-battle result to GameState — only through other modules' effects (§10, §13):
 *   military: sinkShip, damageShip, captureShip, addShip, killMen   (ships and men)
 *   core:     addGoods, addSilver, addRations                        (cargo, pitch, plunder)
 *   people:   kill, capture, woundCharacter                          (captains and the player)
 * The effect shapes are the owners' published types (`import type` of their augmentations), so a
 * drift in an owner's contract is a compile error here. The captain duel's own consequences
 * (injuries, the loser killed or taken) are applied by people's SeaBattleEnded reaction, never twice.
 *
 * `seaResultEffects` is pure (state read only) so tools and tests can inspect the list; the module
 * applies it with `applyEffectsChecked`, which skips ops that are not registered or whose parameters
 * the owner's schema rejects and reports them (SeaBattleEnded.unapplied) instead of crashing.
 */
import type { Balance } from '@content/schemas/balance';
import { EffectError, validateEffects, type Effect, type EffectData, type EffectOf } from '@sim/core/effects';
import type { SimContext } from '@sim/core/module';
import type { CharId, FleetId, GameState, GoodId, SeaBattleResult, SeaBattleSetup, SeaShipSetup, SeaSideSetup, ShipId } from '@sim/core/state';
// Type-only: brings the military and people effect augmentations (captureShip, killMen, kill, …) into scope.
import type { KillMenEffect } from '@sim/modules/military/types';
import type { WoundSeverity } from '@sim/modules/people/types';
import type { SeaShipOutcome, SeaSideKey } from './types';

const KEYS: [SeaSideKey, SeaSideKey] = ['attacker', 'defender'];

/** Cause recorded on ships lost in a sea battle (military renders it as "in battle"). */
const SHIP_LOSS_CAUSE = 'seaBattle';
/** Severity given to a captain or the player wounded in the fight. */
const BATTLE_WOUND: WoundSeverity = 'serious';

/** Splits `count` over a unit mix in proportion (largest remainder; deterministic by unit order). */
export function splitByUnits(men: Readonly<Record<string, number>>, count: number): { unit: string; count: number }[] {
  const units = Object.keys(men).filter((u) => (men[u] ?? 0) > 0);
  const total = units.reduce((n, u) => n + (men[u] ?? 0), 0);
  const want = Math.min(Math.max(0, Math.round(count)), total);
  if (want <= 0 || total <= 0) return [];
  const exact = units.map((u) => ((men[u] ?? 0) * want) / total);
  const out = exact.map((x) => Math.floor(x));
  let rest = want - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) out[order[k]!.i]! += 1;
  return units.map((unit, i) => ({ unit, count: Math.min(out[i] ?? 0, men[unit] ?? 0) })).filter((x) => x.count > 0);
}

/** Per-unit losses of a fleet: the killed, then the wounded, then the captured, never more than a unit has. */
export function splitLosses(
  men: Readonly<Record<string, number>>,
  losses: { killed: number; wounded: number; captured: number },
): { unit: string; killed: number; wounded: number; captured: number }[] {
  const left: Record<string, number> = { ...men };
  const rows: Record<string, { unit: string; killed: number; wounded: number; captured: number }> = {};
  const row = (unit: string) => (rows[unit] ??= { unit, killed: 0, wounded: 0, captured: 0 });
  for (const kind of ['killed', 'wounded', 'captured'] as const) {
    for (const { unit, count } of splitByUnits(left, losses[kind])) {
      row(unit)[kind] += count;
      left[unit] = (left[unit] ?? 0) - count;
    }
  }
  return Object.keys(men)
    .filter((u) => Object.hasOwn(rows, u))
    .map((u) => rows[u]!);
}

/** The outcome of a ship (from `result.ships`, else from the id lists). */
export function shipOutcome(result: SeaBattleResult, side: SeaSideKey, ship: SeaShipSetup): SeaShipOutcome {
  const found = result.ships?.find((o) => o.shipId === ship.shipId);
  if (found) return found;
  if (result.shipsCaptured.includes(ship.shipId)) {
    const by = result.capturedBy?.[ship.shipId] ?? (side === 'attacker' ? 'defender' : 'attacker');
    return { shipId: ship.shipId, side, status: 'captured', hullHp: ship.hullHp, sailHp: ship.sailHp, crew: 0, capturedBy: by };
  }
  if (result.shipsSunk.includes(ship.shipId)) {
    const burned = result.shipsBurned?.includes(ship.shipId) ?? false;
    return { shipId: ship.shipId, side, status: burned ? 'burned' : 'sunk', hullHp: 0, sailHp: 0, crew: 0 };
  }
  return { shipId: ship.shipId, side, status: 'active', hullHp: ship.hullHp, sailHp: ship.sailHp, crew: ship.crew };
}

/** A fleet id that still exists in the state (else undefined). */
function liveFleet(state: GameState, fleetId: FleetId | undefined): FleetId | undefined {
  return fleetId !== undefined && Object.hasOwn(state.fleets, fleetId) ? fleetId : undefined;
}

/**
 * Hull/sail damage of a ship the battle left afloat (survivor, escapee or prize). It keeps at least
 * 1 hull point, so rounding never lets the write-back sink a ship the battle did not.
 */
function damageEffect(ship: SeaShipSetup, o: SeaShipOutcome): EffectOf<'damageShip'> | undefined {
  const hull = Math.max(0, Math.min(ship.hullHp - 1, Math.round(ship.hullHp - o.hullHp)));
  const sail = Math.max(0, Math.round(ship.sailHp - o.sailHp));
  if (hull <= 0 && sail <= 0) return undefined;
  return { op: 'damageShip', shipId: ship.shipId, hull, sail, cause: SHIP_LOSS_CAUSE };
}

/** Ship effects of one side: sunk, captured (existing hulls change hands; explicit ones are new prizes), damaged. */
function shipEffects(state: GameState, result: SeaBattleResult, sides: [SeaSideSetup, SeaSideSetup], i: 0 | 1, out: Effect[], lost: number[], taken: number[]): void {
  const side = sides[i];
  const key = KEYS[i];
  for (const ship of side.ships) {
    const o = shipOutcome(result, key, ship);
    const exists = Object.hasOwn(state.ships, ship.shipId);
    const share = ship.cargoShare ?? 1 / side.ships.length;
    if (o.status === 'sunk' || o.status === 'burned') {
      lost[i]! += share;
      if (exists) out.push({ op: 'sinkShip', shipId: ship.shipId, cause: SHIP_LOSS_CAUSE });
      continue;
    }
    if (o.status === 'captured') {
      lost[i]! += share;
      taken[i]! += share;
      const captor = (o.capturedBy ?? KEYS[1 - i]!) === key ? side : sides[1 - i]!;
      const captorFleet = liveFleet(state, captor.fleetId);
      if (exists) {
        const dmg = damageEffect(ship, o);
        if (dmg) out.push(dmg);
        const e: EffectOf<'captureShip'> = { op: 'captureShip', shipId: ship.shipId, factionId: captor.factionId };
        if (captorFleet !== undefined) e.fleetId = captorFleet;
        out.push(e);
      } else {
        // An encounter's explicit ship: the prize enters the world as a new hull of that type.
        const e: EffectOf<'addShip'> = { op: 'addShip', shipType: ship.type, factionId: captor.factionId };
        if (captorFleet !== undefined) e.fleetId = captorFleet;
        if (ship.name !== undefined) e.name = ship.name.slice(0, 60);
        out.push(e);
      }
      continue;
    }
    if (exists) {
      const dmg = damageEffect(ship, o);
      if (dmg) out.push(dmg);
    }
  }
}

/** Builds the effect list that writes a result back to GameState (pure). */
export function seaResultEffects(state: GameState, _balance: Balance, setup: SeaBattleSetup, result: SeaBattleResult): Effect[] {
  const out: Effect[] = [];
  const sides: [SeaSideSetup, SeaSideSetup] = [setup.attacker, setup.defender];
  const lostCargoShare = [0, 0];
  const takenCargoShare = [0, 0]; // share of side i's cargo taken by the other side
  shipEffects(state, result, sides, 0, out, lostCargoShare, takenCargoShare);
  shipEffects(state, result, sides, 1, out, lostCargoShare, takenCargoShare);

  // Cargo: pitch burned by fire arrows, the holds of lost ships, plunder from prizes.
  sides.forEach((side, i) => {
    const fleetId = liveFleet(state, side.fleetId);
    const fleet = fleetId !== undefined ? state.fleets[fleetId] : undefined;
    const used = i === 0 ? (result.pitchUsedT?.attacker ?? 0) : (result.pitchUsedT?.defender ?? 0);
    const captorFleet = liveFleet(state, sides[1 - i]!.fleetId);
    const cargo: Partial<Record<GoodId, number>> = fleet ? { ...fleet.cargo } : { ...(side.cargo ?? {}) };
    if (fleet && used > 0) {
      const burned = round2(Math.min(used, cargo.pitch ?? 0));
      if (burned > 0) out.push({ op: 'addGoods', good: 'pitch', tons: -burned, fleetId: fleet.id });
      cargo.pitch = Math.max(0, (cargo.pitch ?? 0) - used);
    }
    const lost = Math.min(1, lostCargoShare[i] ?? 0);
    const taken = Math.min(lost, takenCargoShare[i] ?? 0);
    if (lost <= 0) return;
    for (const good of Object.keys(cargo) as GoodId[]) {
      const tons = cargo[good] ?? 0;
      if (tons <= 0) continue;
      const lose = round2(tons * lost);
      const take = round2(tons * taken);
      if (fleet && lose > 0) out.push({ op: 'addGoods', good, tons: -lose, fleetId: fleet.id });
      if (captorFleet !== undefined && take > 0) out.push({ op: 'addGoods', good, tons: take, fleetId: captorFleet });
    }
    const silver = fleet ? fleet.silver : (side.silver ?? 0);
    if (silver > 0) {
      const lose = Math.floor(silver * lost);
      const take = Math.floor(silver * taken);
      if (fleet && lose > 0) out.push({ op: 'addSilver', amount: -lose, fleetId: fleet.id });
      if (captorFleet !== undefined && take > 0) out.push({ op: 'addSilver', amount: take, fleetId: captorFleet });
    }
    const rations = fleet?.rations ?? 0;
    if (rations > 0) {
      const lose = Math.floor(rations * lost);
      const take = Math.floor(rations * taken);
      if (fleet && lose > 0) out.push({ op: 'addRations', count: -lose, fleetId: fleet.id });
      if (captorFleet !== undefined && take > 0) out.push({ op: 'addRations', count: take, fleetId: captorFleet });
    }
  });

  // Men: the killed and the captured leave the fleet, the wounded go to recover. Explicit (encounter)
  // crews are not in the fleet's muster, so only the fleet's share of the losses is written.
  sides.forEach((side, i) => {
    const fleetId = liveFleet(state, side.fleetId);
    const fleet = fleetId !== undefined ? state.fleets[fleetId] : undefined;
    const lost = result.crewLost.find((c) => c.side === KEYS[i]);
    if (!fleet || !lost) return;
    const fleetMen = sumMen(fleet.men);
    const setupMen = side.men ? sumMen(side.men) : fleetMen;
    const scale = setupMen > 0 ? Math.min(1, fleetMen / setupMen) : 1;
    const losses = { killed: Math.round(lost.killed * scale), wounded: Math.round(lost.wounded * scale), captured: Math.round(lost.captured * scale) };
    for (const r of splitLosses(fleet.men, losses)) {
      const e: KillMenEffect & { op: 'killMen' } = { op: 'killMen', fleetId: fleet.id, unit: r.unit, count: r.killed };
      if (r.wounded > 0) e.wounded = r.wounded;
      if (r.captured > 0) e.captured = r.captured;
      out.push(e);
    }
  });

  // Named characters (captains and the player). The captain duel's loser is people's to settle
  // (SeaBattleEnded reaction): it applies the duel's death or capture and the duel injuries.
  const fates = result.captainFates ?? {};
  const duel = result.captainDuel;
  const duelLoser = duelLoserId(setup, result);
  const injured: string[] = (duel?.injuries ?? []).map((x) => x.charId);
  for (const [charId, fate] of Object.entries(fates)) {
    if (!Object.hasOwn(state.characters, charId)) continue;
    const id = charId as CharId;
    const sideIdx = sides.findIndex((s) => s.captainId === id || (s.isPlayer && setup.playerCharId === id));
    const own = sideIdx >= 0 ? sides[sideIdx]! : undefined;
    const enemy = sideIdx >= 0 ? sides[1 - sideIdx]! : undefined;
    if (id === duelLoser && ((fate === 'dead' && duel?.loserFate === 'killed') || (fate === 'captured' && duel?.loserFate === 'captured'))) continue;
    if (fate === 'dead') {
      const e: EffectOf<'kill'> = { op: 'kill', charId: id, cause: SHIP_LOSS_CAUSE };
      if (enemy) e.byFactionId = enemy.factionId;
      out.push(e);
    } else if (fate === 'captured' && enemy && own && enemy.factionId !== own.factionId) {
      out.push({ op: 'capture', charId: id, byFactionId: enemy.factionId, cause: SHIP_LOSS_CAUSE });
    } else if (fate === 'wounded' && !injured.includes(id)) {
      out.push({ op: 'woundCharacter', charId: id, severity: BATTLE_WOUND, cause: SHIP_LOSS_CAUSE });
    }
  }
  return out;
}

/** The character who lost the captain duel: the duelists are the player and the enemy side's captain. */
function duelLoserId(setup: SeaBattleSetup, result: SeaBattleResult): CharId | undefined {
  const duel = result.captainDuel;
  const player = setup.playerCharId;
  if (!duel || player === undefined) return undefined;
  if (duel.winnerId !== player) return player;
  return (setup.attacker.isPlayer ? setup.defender : setup.attacker).captainId;
}

/**
 * Applies effects one by one; an op with no registered owner, invalid parameters, or an EffectError
 * from its handler is skipped and reported as `op: reason`.
 */
export function applyEffectsChecked(ctx: SimContext, effects: readonly (Effect | EffectData)[]): string[] {
  const unapplied: string[] = [];
  for (const e of effects) {
    if (!ctx.env.effects.has(e.op)) {
      unapplied.push(`${e.op}: not registered`);
      continue;
    }
    const issues = validateEffects(ctx.env, [e], e.op);
    if (issues.length > 0) {
      unapplied.push(`${e.op}: ${issues.join('; ')}`);
      continue;
    }
    try {
      ctx.applyEffects([e]);
    } catch (err) {
      if (err instanceof EffectError) unapplied.push(`${e.op}: ${err.message}`);
      else throw err;
    }
  }
  return unapplied;
}

/** Validates a result against its setup (ids, counts, winner); returns issues. */
export function validateSeaResult(setup: SeaBattleSetup, result: SeaBattleResult): string[] {
  const issues: string[] = [];
  const ids: Record<string, true> = {};
  for (const s of [...setup.attacker.ships, ...setup.defender.ships]) ids[s.shipId] = true;
  const known = (id: ShipId) => Object.hasOwn(ids, id);
  for (const id of [...result.shipsSunk, ...result.shipsCaptured, ...(result.shipsFled ?? []), ...(result.shipsBurned ?? [])]) {
    if (!known(id)) issues.push(`unknown ship ${id}`);
  }
  for (const id of result.shipsSunk) if (result.shipsCaptured.includes(id)) issues.push(`ship ${id} both sunk and captured`);
  for (const id of result.shipsBurned ?? []) if (!result.shipsSunk.includes(id)) issues.push(`burned ship ${id} not listed as sunk`);
  for (const o of result.ships ?? []) if (!known(o.shipId)) issues.push(`outcome for unknown ship ${o.shipId}`);
  const crew = [setup.attacker, setup.defender].map((s) => s.ships.reduce((n, x) => n + x.crew, 0));
  for (const c of result.crewLost) {
    const start = c.side === 'attacker' ? crew[0]! : crew[1]!;
    if (c.killed + c.wounded + c.captured > start + 0.5) issues.push(`${c.side} lost more men than it had`);
  }
  return issues;
}

function sumMen(men: Readonly<Record<string, number>>): number {
  let n = 0;
  for (const u of Object.keys(men)) n += Math.max(0, men[u] ?? 0);
  return n;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
