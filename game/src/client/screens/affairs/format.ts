/**
 * Small display helpers of the Affairs of State screen (no game rules: every number comes from the
 * holdings and economy modules' pure functions).
 */
import type { Content } from '@content/index';
import type { BuildIssue, GarrisonIssue, TierInfo } from '@sim/modules/holdings/rules';
import type { LoyaltyReason } from '@sim/modules/holdings/types';
import { formatNumber, t, tOr } from '../../i18n/index';

/** A signed whole number with a true minus sign ("+3", "−2", "0"). */
export function signed(n: number): string {
  const r = Math.round(n * 10) / 10;
  if (r > 0) return `+${formatNumber(r)}`;
  if (r < 0) return `−${formatNumber(-r)}`;
  return '0';
}

/** Tone class of a signed amount. */
export function toneOf(n: number): string {
  return n > 0 ? 'tone-good' : n < 0 ? 'tone-bad' : 'muted';
}

/** Display name of a building. */
export function buildingName(id: string): string {
  return tOr(`holdings.building.${id}`, id);
}

/** Display name of a unit type. */
export function unitName(content: Content | undefined, id: string): string {
  return tOr(`military.unit.${id}`, content?.balance.units[id]?.name ?? id);
}

/** One line of a loyalty reason. */
export function reasonText(r: LoyaltyReason): string {
  return t(`holdings.reason.${r.id}`, r.vars ?? {});
}

/** Text of a build issue. */
export function buildIssueText(issue: BuildIssue): string {
  return t(`holdings.issue.${issue}`);
}

/** Text of a garrison issue. */
export function garrisonIssueText(issue: GarrisonIssue): string {
  return t(`holdings.garrisonIssue.${issue}`);
}

/** The effects of a building tier as display lines. */
export function effectLines(info: TierInfo | undefined): string[] {
  if (!info) return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(info.effects)) {
    if (value === false || value === 0) continue;
    if (Array.isArray(value)) {
      const names = value.map((v) => tOr(`military.shipType.${v}`, v)).join(', ');
      out.push(tOr(`holdings.effect.${key}`, `${key}: ${names}`, { value: names }));
    } else if (typeof value === 'number') {
      out.push(tOr(`holdings.effect.${key}`, `${key}: ${value}`, { value }));
    } else {
      out.push(tOr(`holdings.effect.${key}`, key, { value: 1 }));
    }
  }
  return out;
}
