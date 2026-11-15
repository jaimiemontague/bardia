/**
 * Invariants of the military module's data (tests, fuzzers and `npm run sim`): no negative or
 * fractional men anywhere, sane pools, wounded batches and veterancy, ships in at most one place with
 * hull and sail within bounds, the ship queue mirror in sync, and equipment tiers in range.
 */
import type { Balance } from '@content/schemas/balance';
import type { FleetId, GameState, SettlementId, ShipId } from '@sim/core/state';
import { findShipDef } from './ships';
import type { WoundedBatch } from './types';

function checkMen(out: string[], where: string, men: Readonly<Record<string, number>> | undefined): void {
  if (!men) return;
  for (const [unit, n] of Object.entries(men)) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) out.push(`${where}: men[${unit}] = ${String(n)}`);
  }
}

function checkVet(out: string[], where: string, vet: Readonly<Record<string, number>> | undefined): void {
  if (!vet) return;
  for (const [unit, b] of Object.entries(vet)) {
    if (typeof b !== 'number' || !Number.isFinite(b) || b < 0) out.push(`${where}: vetBattles[${unit}] = ${String(b)}`);
  }
}

function checkWounded(out: string[], where: string, list: readonly WoundedBatch[] | undefined): void {
  if (!list) return;
  list.forEach((b, i) => {
    if (!Number.isInteger(b.count) || b.count <= 0) out.push(`${where}: woundedMen[${i}].count = ${b.count}`);
    if (!(b.progress >= 0 && b.progress < 1)) out.push(`${where}: woundedMen[${i}].progress = ${b.progress}`);
    if (!(b.battles >= 0) || !Number.isFinite(b.battles)) out.push(`${where}: woundedMen[${i}].battles = ${b.battles}`);
    if (!Number.isInteger(b.sinceHour)) out.push(`${where}: woundedMen[${i}].sinceHour = ${b.sinceHour}`);
    if (!(b.rate >= 0) || !Number.isFinite(b.rate)) out.push(`${where}: woundedMen[${i}].rate = ${b.rate}`);
  });
}

/** Violations of the military invariants (empty when the state is consistent). */
export function militaryInvariants(state: GameState, balance: Balance): string[] {
  const out: string[] = [];
  for (const [id, s] of Object.entries(state.settlements)) {
    checkMen(out, `settlement ${id} garrison`, s.garrison);
    checkVet(out, `settlement ${id}`, s.vetBattles);
    checkWounded(out, `settlement ${id}`, s.woundedMen);
    if (!(s.pop >= 0) || !Number.isFinite(s.pop)) out.push(`settlement ${id}: pop ${s.pop}`);
    const h = s.holding;
    if (h) {
      const pool = h.pool;
      if (!Number.isInteger(pool.current) || pool.current < 0) out.push(`holding ${id}: pool.current ${pool.current}`);
      if (!Number.isInteger(pool.max) || pool.max < 0) out.push(`holding ${id}: pool.max ${pool.max}`);
      checkMen(out, `holding ${id} pool.veterans`, pool.veterans);
      let vets = 0;
      for (const n of Object.values(pool.veterans ?? {})) vets += n;
      if (vets > pool.current) out.push(`holding ${id}: ${vets} pool veterans exceed pool.current ${pool.current}`);
      checkVet(out, `holding ${id} veteranBattles`, h.veteranBattles);
    }
  }
  for (const [id, f] of Object.entries(state.fleets)) {
    checkMen(out, `fleet ${id}`, f.men);
    checkVet(out, `fleet ${id}`, f.vetBattles);
    checkWounded(out, `fleet ${id}`, f.woundedMen);
  }
  for (const [id, a] of Object.entries(state.armies)) {
    a.squads.forEach((sq, i) => {
      if (!Number.isInteger(sq.men) || sq.men < 0) out.push(`army ${id}: squads[${i}].men = ${sq.men}`);
      if (sq.battles !== undefined && (!(sq.battles >= 0) || !Number.isFinite(sq.battles))) out.push(`army ${id}: squads[${i}].battles = ${sq.battles}`);
      if (![0, 1, 2, 3].includes(sq.vetStars)) out.push(`army ${id}: squads[${i}].vetStars = ${String(sq.vetStars)}`);
    });
    checkWounded(out, `army ${id}`, a.woundedMen);
  }
  // Ships: in at most one fleet, at most one place, hull and sail within bounds.
  const inFleet: Record<string, FleetId> = {};
  for (const [fid, f] of Object.entries(state.fleets)) {
    for (const sid of f.shipIds) {
      const prev = inFleet[sid];
      if (prev !== undefined) out.push(`ship ${sid} is in fleets ${prev} and ${fid}`);
      else inFleet[sid] = fid as FleetId;
    }
  }
  const m = state.military;
  for (const [sid, ship] of Object.entries(state.ships)) {
    const places = (ship.locationFleetId !== undefined ? 1 : 0) + (ship.dockedAt !== undefined ? 1 : 0) + (ship.transitId !== undefined ? 1 : 0);
    if (places > 1) out.push(`ship ${sid} is in ${places} places (fleet/dock/transfer)`);
    const def = findShipDef(balance, ship.type);
    if (!def) out.push(`ship ${sid}: unknown type ${ship.type}`);
    else {
      if (!(ship.hullHp >= 0 && ship.hullHp <= def.hull + 1e-9)) out.push(`ship ${sid}: hull ${ship.hullHp} outside [0, ${def.hull}]`);
      if (!(ship.sailHp >= 0 && ship.sailHp <= def.sail + 1e-9)) out.push(`ship ${sid}: sail ${ship.sailHp} outside [0, ${def.sail}]`);
    }
    if (ship.transitId !== undefined && !m?.transfers.some((t) => t.id === ship.transitId && t.shipIds.includes(sid as ShipId))) {
      out.push(`ship ${sid}: in transfer ${ship.transitId}, which does not carry it`);
    }
  }
  for (const f of Object.values(state.factions)) {
    for (const [name, tier] of [['armouryTier', f.armouryTier], ['weaponTier', f.weaponTier]] as const) {
      if (!Number.isInteger(tier) || tier < 1 || tier > balance.equipment.relicTier) out.push(`faction ${f.id}: ${name} ${tier}`);
    }
  }
  if (m) {
    for (const mu of m.musters) {
      checkMen(out, `muster ${mu.id}`, mu.units);
      if (!state.settlements[mu.holdingId]) out.push(`muster ${mu.id}: unknown holding ${mu.holdingId}`);
    }
    for (const t of m.transfers) {
      checkMen(out, `transfer ${t.id}`, t.men);
      for (const sid of t.shipIds) if (state.ships[sid]?.transitId !== t.id) out.push(`transfer ${t.id}: ship ${sid} is not marked in transit`);
    }
    for (const [hid, orders] of Object.entries(m.shipyards)) {
      const holding = state.settlements[hid as SettlementId]?.holding;
      const mirror = holding?.shipQueue ?? [];
      if (mirror.length !== orders.length || orders.some((o, i) => mirror[i]?.type !== o.type || mirror[i]?.doneHour !== o.doneHour)) {
        out.push(`holding ${hid}: shipQueue mirror out of sync with ${orders.length} orders`);
      }
      for (const o of orders) {
        if (o.startHour !== null && o.doneHour !== o.startHour + o.buildHours) out.push(`ship order ${o.id}: doneHour != startHour + buildHours`);
      }
    }
    if (m.nextDueHour !== undefined && !Number.isInteger(m.nextDueHour)) out.push(`military.nextDueHour ${m.nextDueHour}`);
  }
  return out;
}
