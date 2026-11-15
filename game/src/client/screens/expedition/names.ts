/**
 * Display names shared by the expedition-loop screens (planner, map orders, arrival, aftermath, market,
 * cargo, ledger): units and ships from the balance tables (until their locale keys exist), goods from
 * `economy.good.<id>`.
 */
import type { Content } from '@content/index';
import { tOr } from '../../i18n/index';

export function unitName(content: Content | null, id: string): string {
  return tOr(`core.unit.${id}.name`, content?.balance.units[id]?.name ?? id);
}

export function shipTypeName(content: Content | null, id: string): string {
  const ships = content?.balance.ships as Readonly<Record<string, { name?: string } | undefined>> | undefined;
  return tOr(`core.ship.${id}.name`, ships?.[id]?.name ?? id);
}

export function goodName(id: string): string {
  return tOr(`economy.good.${id}`, id);
}

export function sumMen(men: Readonly<Record<string, number | undefined>>): number {
  let n = 0;
  for (const v of Object.values(men)) n += Math.max(0, v ?? 0);
  return n;
}

/** Tons with one decimal (or two below one ton). */
export function formatTons(t: number): string {
  return t >= 1 ? (Math.round(t * 10) / 10).toString() : (Math.round(t * 100) / 100).toString();
}
