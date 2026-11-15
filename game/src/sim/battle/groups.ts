/**
 * The pre-battle Groups screen (§13.4 step 3, §12.3): the player lays out squads — a named leader,
 * one unit type, men per squad, formation and stance — from the men present. `applyGroups`
 * validates a layout against the setup's pools and caps and rewrites the player's squads (with
 * their source containers, so casualties are written back to the right fleet or garrison).
 * Squads that came with an army or were given explicitly keep their place; spare garrison and
 * militia men fight under sergeants, spare crews stay with the ships.
 */
import type { Content } from '@content/index';
import type { BattleSetup, SideSetup, Squad, UnitTypeId } from '@sim/core/state';
import { battleData, squadCap, unitOf } from './data';
import { poolTake, sergeantSquads, type UnitPool } from './setup';
import type { PlannedSquad } from './types';

function playerSide(setup: BattleSetup): SideSetup | undefined {
  return setup.attacker.isPlayer ? setup.attacker : setup.defender.isPlayer ? setup.defender : undefined;
}

/** Squads that are not re-assignable on the Groups screen (army squads, explicit squads, militia). */
function isFixed(sq: Squad): boolean {
  return (sq.sources ?? []).some((s) => s.kind === 'army' || s.kind === 'explicit');
}

/** Problems with a layout (empty when it can be applied). */
export function groupsIssues(setup: BattleSetup, planned: readonly PlannedSquad[], content: Content): string[] {
  const data = battleData(content);
  const side = playerSide(setup);
  if (!side) return ['the player does not fight in this battle'];
  const issues: string[] = [];
  const fixed = side.squads.filter(isFixed).length;
  const max = data.b.maxPlayerSquads - fixed;
  if (planned.length > max) issues.push(`at most ${max} squads`);
  const leaders = side.leaderIds ?? [];
  const seen: string[] = [];
  const perUnit: Record<UnitTypeId, number> = {};
  for (const p of planned) {
    if (!leaders.includes(p.leaderId)) issues.push(`${p.leaderId} cannot lead a squad here`);
    if (seen.includes(p.leaderId)) issues.push(`${p.leaderId} leads two squads`);
    seen.push(p.leaderId);
    if (!Object.hasOwn(side.available ?? {}, p.unit)) {
      issues.push(`no ${p.unit} are present`);
      continue;
    }
    const unit = unitOf(data, p.unit);
    const cap = squadCap(data.balance, setup.leaders?.[p.leaderId]?.command ?? 0, unit);
    if (p.men > cap) issues.push(`${p.leaderId} can lead at most ${cap} ${p.unit}`);
    if (p.formation !== undefined && !unit.formations.includes(p.formation)) issues.push(`${p.unit} cannot form ${p.formation}`);
    perUnit[p.unit] = (perUnit[p.unit] ?? 0) + p.men;
  }
  for (const unit of Object.keys(perUnit)) if ((perUnit[unit] ?? 0) > (side.available?.[unit] ?? 0)) issues.push(`only ${side.available?.[unit] ?? 0} ${unit} are present`);
  return issues;
}

/** Rewrites the player's squads from a validated layout (call `groupsIssues` first). */
export function applyGroups(setup: BattleSetup, planned: readonly PlannedSquad[], content: Content): void {
  const data = battleData(content);
  const side = playerSide(setup);
  if (!side) return;
  // Pools: crews first (the party leads its own men), then the garrison.
  const pools: UnitPool[] = [];
  const containers = [...(side.pools ?? [])].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'fleet' ? -1 : 1));
  for (const c of containers) {
    for (const unit of Object.keys(c.men)) {
      const men = Math.max(0, Math.floor(c.men[unit] ?? 0));
      if (men <= 0) continue;
      let p = pools.find((x) => x.unit === unit);
      if (!p) {
        p = { unit, men: 0, sources: [] };
        pools.push(p);
      }
      p.men += men;
      p.sources.push(c.id !== undefined ? { kind: c.kind, id: c.id, men } : { kind: c.kind, men });
    }
  }
  const fixed = side.squads.filter(isFixed);
  const squads: Squad[] = [...fixed];
  for (const p of planned) {
    const pool = pools.find((x) => x.unit === p.unit);
    if (!pool) continue;
    const sources = poolTake(pool, p.men);
    const men = sources.reduce((a, s) => a + s.men, 0);
    if (men <= 0) continue;
    const unit = unitOf(data, p.unit);
    const sq: Squad = { leaderId: p.leaderId, unit: p.unit, men, vetStars: 0, formation: p.formation ?? unit.formations[0] ?? 'line', sources };
    if (p.stance !== undefined) sq.stance = p.stance;
    squads.push(sq);
  }
  // Spare garrison men fight under sergeants (crews stay with the ships).
  const garrison: UnitPool[] = pools
    .map((p) => ({ unit: p.unit, men: 0, sources: p.sources.filter((s) => s.kind !== 'fleet' && s.men > 0).map((s) => ({ ...s })) }))
    .map((p) => ({ ...p, men: p.sources.reduce((a, s) => a + s.men, 0) }))
    .filter((p) => p.men > 0);
  const ref = planned[0]?.leaderId ?? side.squads[0]?.leaderId ?? 'chr_none';
  squads.push(...sergeantSquads(data, garrison, data.b.maxPlayerSquads - squads.length, ref));
  side.squads = squads;
}
