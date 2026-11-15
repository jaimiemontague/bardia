/**
 * The muster ("send the war-arrow", §12.1, §31.5): validation and the preview the Muster screen
 * shows (bounty with the equipment surcharge and culture modifiers, new monthly upkeep, pool
 * remaining, cooldown, berserker cap), the command handler and the arrival after the gathering days.
 * The handler and the client share `musterPreview`, so the screen can never disagree with the rules.
 */
import type { Content } from '@content/index';
import { CommandError } from '@sim/core/commands';
import type { SimEventOf } from '@sim/core/events';
import type { SimContext } from '@sim/core/module';
import type { FleetId, GameState, Hour, SettlementId, UnitTypeId } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { fleetContainer, realmMen, settlementContainer } from './men';
import { takeVeterans } from './pools';
import { distance, holdingOf, recNum } from './realm';
import { militaryOf, refreshNextDue } from './slice';
import type { MenRecord, MusterCommand, MusterRecord } from './types';
import { berserkerCap, findUnit, isCappedByRenown, unitBounty, unitWage, unmetRequirements } from './units';

/** A rule the muster breaks (the first one is the command's error code). */
export interface MusterIssue {
  code:
    | 'notYourHolding'
    | 'cooldown'
    | 'noUnits'
    | 'badCount'
    | 'unknownUnit'
    | 'notRecruitable'
    | 'requirement'
    | 'berserkerCap'
    | 'poolExhausted'
    | 'treasury'
    | 'fleetNotInHarbour';
  unit?: UnitTypeId;
  detail?: string;
}

/** One unit type on the Muster screen. */
export interface MusterLine {
  unit: UnitTypeId;
  count: number;
  /** Recruits who will come from the pool's veterans of this type. */
  veterans: number;
  bountyEach: number;
  bounty: number;
  wageEach: number;
  /** Monthly wages this line adds. */
  upkeep: number;
  /** Requirement codes that block this unit at the holding ([] when recruitable). */
  unmet: string[];
}

/** Everything the Muster screen shows, plus whether the command would succeed. */
export interface MusterPreview {
  holdingId: SettlementId;
  lines: MusterLine[];
  total: number;
  bounty: number;
  upkeepDelta: number;
  poolCurrent: number;
  poolRemaining: number;
  /** Hours until the cooldown ends (0 = ready). */
  cooldownHoursLeft: number;
  berserkerCap: number;
  berserkersInService: number;
  treasury: number;
  arriveHour: Hour;
  issues: MusterIssue[];
  ok: boolean;
}

/** Hours until a holding may muster again (0 = ready). */
export function musterCooldownLeft(state: GameState, content: Content, holdingId: SettlementId): number {
  const last = state.settlements[holdingId]?.holding?.lastMusterHour;
  if (last === undefined) return 0;
  return Math.max(0, last + content.balance.recruit.cooldownDays * HOURS_PER_DAY - state.time.hour);
}

/** True if a fleet is in the harbour of a settlement (docked within tunables.military.dockRadius). */
export function fleetInHarbour(state: GameState, content: Content, fleetId: FleetId, settlementId: SettlementId): boolean {
  const f = state.fleets[fleetId];
  const s = state.settlements[settlementId];
  if (!f || !s) return false;
  return f.mode === 'docked' && distance(f.pos, s.mapPos) <= content.tunables.military.dockRadius;
}

/**
 * Pure muster preview for the player's faction: costs, upkeep, pool and every rule the command
 * enforces (cooldown, pool, Hall II, culture uniques, berserker cap, treasury). Units with a count of
 * 0 are listed with their prices (so the screen can show the whole roster) but are not mustered.
 */
export function musterPreview(state: GameState, content: Content, cmd: MusterCommand): MusterPreview {
  const balance = content.balance;
  const factionId = state.player.factionId;
  const faction = state.factions[factionId];
  const holding = holdingOf(state, cmd.holdingId, factionId);
  const issues: MusterIssue[] = [];
  const lines: MusterLine[] = [];
  const cooldownHoursLeft = holding ? musterCooldownLeft(state, content, cmd.holdingId) : 0;
  const poolCurrent = holding?.holding?.pool.current ?? 0;
  const cap = berserkerCap(state, balance);
  const inService = Object.keys(balance.units)
    .filter((u) => isCappedByRenown(balance, u))
    .reduce((n, u) => n + realmMen(state, factionId, u).total, 0);
  const treasury = faction?.treasury ?? 0;
  if (!holding) issues.push({ code: 'notYourHolding' });
  if (cooldownHoursLeft > 0) issues.push({ code: 'cooldown', detail: String(Math.ceil(cooldownHoursLeft / HOURS_PER_DAY)) });
  let total = 0;
  let bounty = 0;
  let upkeep = 0;
  let capped = 0;
  for (const unit of Object.keys(cmd.units)) {
    const count = recNum(cmd.units, unit);
    if (!Number.isInteger(count) || count < 0) {
      issues.push({ code: 'badCount', unit });
      continue;
    }
    if (!findUnit(balance, unit)) {
      issues.push({ code: 'unknownUnit', unit });
      continue;
    }
    const unmet = holding ? unmetRequirements(state, content, holding, unit) : [];
    const bountyEach = unitBounty(state, content, factionId, unit);
    const wageEach = unitWage(balance, unit);
    const vetHave = holding?.holding ? recNum(holding.holding.pool.veterans, unit) : 0;
    lines.push({
      unit,
      count,
      veterans: Math.min(count, vetHave),
      bountyEach,
      bounty: bountyEach * count,
      wageEach,
      upkeep: wageEach * count,
      unmet,
    });
    if (count === 0) continue;
    if (unmet.length > 0) {
      const code = unmet.includes('notRecruitable') ? 'notRecruitable' : unmet.includes('unknownUnit') ? 'unknownUnit' : 'requirement';
      issues.push({ code, unit, detail: unmet.join(',') });
    }
    total += count;
    bounty += bountyEach * count;
    upkeep += wageEach * count;
    if (isCappedByRenown(balance, unit)) capped += count;
  }
  if (total === 0 && !issues.some((i) => i.code === 'badCount' || i.code === 'unknownUnit')) issues.push({ code: 'noUnits' });
  if (capped > 0 && inService + capped > cap) issues.push({ code: 'berserkerCap', detail: `${Math.max(0, cap - inService)}` });
  if (total > poolCurrent) issues.push({ code: 'poolExhausted', detail: String(poolCurrent) });
  if (bounty > treasury) issues.push({ code: 'treasury', detail: String(bounty) });
  if (cmd.fleetId !== undefined && !fleetInHarbour(state, content, cmd.fleetId, cmd.holdingId)) issues.push({ code: 'fleetNotInHarbour' });
  if (cmd.fleetId !== undefined && state.fleets[cmd.fleetId]?.ownerId !== factionId && !issues.some((i) => i.code === 'fleetNotInHarbour')) {
    issues.push({ code: 'fleetNotInHarbour' });
  }
  return {
    holdingId: cmd.holdingId,
    lines,
    total,
    bounty,
    upkeepDelta: upkeep,
    poolCurrent,
    poolRemaining: Math.max(0, poolCurrent - total),
    cooldownHoursLeft,
    berserkerCap: cap,
    berserkersInService: inService,
    treasury,
    arriveHour: state.time.hour + balance.recruit.gatherDays * HOURS_PER_DAY,
    issues,
    ok: issues.length === 0,
  };
}

/** `muster` handler: pays the bounty, draws the pool (veterans first) and starts the gathering. */
export function handleMuster(draft: GameState, cmd: MusterCommand, ctx: SimContext): void {
  const preview = musterPreview(draft, ctx.content, cmd);
  const first = preview.issues[0];
  if (first) throw new CommandError(first.code, `muster rejected: ${first.code}${first.unit ? ` (${first.unit})` : ''}`, { ...first });
  const s = draft.settlements[cmd.holdingId];
  const holding = s?.holding;
  if (!s || !holding) throw new CommandError('notYourHolding');
  ctx.applyEffects([{ op: 'addSilver', amount: -preview.bounty, factionId: draft.player.factionId }]);
  const units: MenRecord = {};
  const veterans: MusterRecord['veterans'] = {};
  for (const line of preview.lines) {
    if (line.count <= 0) continue;
    units[line.unit] = line.count;
    const vets = takeVeterans(holding, line.unit, line.count);
    if (vets.count > 0) veterans[line.unit] = { count: vets.count, battles: vets.battles };
  }
  holding.pool.current = Math.max(0, holding.pool.current - preview.total);
  holding.lastMusterHour = ctx.hour;
  const m = militaryOf(draft);
  const record: MusterRecord = {
    id: ctx.newId('rec'),
    holdingId: cmd.holdingId,
    factionId: draft.player.factionId,
    units,
    veterans,
    startHour: ctx.hour,
    arriveHour: preview.arriveHour,
    bounty: preview.bounty,
  };
  if (cmd.fleetId !== undefined) record.fleetId = cmd.fleetId;
  m.musters.push(record);
  refreshNextDue(m);
}

/** Musters whose gathering is over join their holding's garrison (or the named fleet still in harbour). */
export function processMusters(draft: GameState, ctx: SimContext): void {
  const m = militaryOf(draft);
  if (m.musters.length === 0) return;
  const due = m.musters.filter((mu) => mu.arriveHour <= ctx.hour);
  if (due.length === 0) return;
  m.musters = m.musters.filter((mu) => mu.arriveHour > ctx.hour);
  for (const mu of due) {
    const s = draft.settlements[mu.holdingId];
    if (!s) continue;
    const fleet = mu.fleetId !== undefined ? draft.fleets[mu.fleetId] : undefined;
    const intoFleet = fleet !== undefined && fleet.ownerId === mu.factionId && fleetInHarbour(draft, ctx.content, fleet.id, s.id);
    // A holding lost while the men gathered: they stay home and return to its pool.
    if (s.factionId !== mu.factionId) {
      if (s.holding) for (const unit of Object.keys(mu.units)) s.holding.pool.current += recNum(mu.units, unit);
      continue;
    }
    const target = intoFleet && fleet ? fleetContainer(draft, fleet) : settlementContainer(draft, s);
    let total = 0;
    for (const unit of Object.keys(mu.units)) {
      const count = recNum(mu.units, unit);
      const vet = Object.hasOwn(mu.veterans, unit) ? mu.veterans[unit] : undefined;
      const vets = Math.min(count, vet?.count ?? 0);
      if (vets > 0) target.add(unit, vets, vet?.battles ?? 0);
      if (count - vets > 0) target.add(unit, count - vets, 0);
      total += count;
    }
    const event: SimEventOf<'MusterCompleted'> = {
      type: 'MusterCompleted',
      musterId: mu.id,
      holdingId: mu.holdingId,
      factionId: mu.factionId,
      units: { ...mu.units },
      total,
    };
    if (intoFleet && fleet) event.fleetId = fleet.id;
    ctx.emit(event);
    if (mu.factionId === draft.player.factionId) {
      ctx.notify('military.muster.completed', {
        vars: { count: total, holding: s.name },
        link: { kind: 'settlement', id: s.id },
        illustration: 'military.illus.muster',
      });
    }
  }
}
