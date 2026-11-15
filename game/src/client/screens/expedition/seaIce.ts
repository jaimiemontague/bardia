/**
 * Is the sea at a harbour iced in, and when does it thaw? The client never re-implements the ice rule: "iced
 * now" is the weather module's own daily flag (`state.weather.zones[zone].ice`, the flag the world module's
 * router closes zones by), and the thaw date is read from the same geography ice periods with the content's
 * own `icePeriodCovers`, one calendar day at a time. Shared by the hall (Counsel, First Voyage), the planner
 * (why Launch is disabled) and the expedition HUD.
 */
import { getGeography, icePeriodCovers, type Geography } from '@content/world';
import type { GameState, SettlementId } from '@sim/core/state';
import { DAYS_PER_YEAR, HOURS_PER_DAY, toCalendar, type Hour } from '@sim/core/time';

/** The ice at one harbour. */
export interface HarbourIce {
  /** The harbour's sea zone (undefined: inland, or the world index is not built). */
  zoneId?: string;
  /** Proper noun of the zone from the geography pack ("the Rimesea"); data, not UI text. */
  zoneName?: string;
  /** The zone is closed by ice today. */
  iced: boolean;
  /** First hour (start of a day) when the zone is open again; set only while iced. */
  thawHour?: Hour;
  /** Whole days to wait from now until the thaw (what a `wait { days }` needs); set only while iced. */
  daysToThaw?: number;
}

/** The sea zone a settlement's harbour lies in (world index), if any. */
export function harbourZoneId(state: GameState, settlementId: SettlementId): string | undefined {
  const entry = state.worldIndex?.settlements[settlementId];
  return entry?.seaZoneId ?? undefined;
}

/**
 * Ice at a settlement's harbour (default: the player's capital). `geo` defaults to the bundled geography
 * (tests may pass another).
 */
export function harbourIce(
  state: GameState,
  settlementId: SettlementId = state.player.capitalId,
  geo?: Geography,
): HarbourIce {
  const zoneId = harbourZoneId(state, settlementId);
  if (zoneId === undefined) return { iced: false };
  return zoneIce(state, zoneId, geo);
}

/** Ice in one sea zone now, and the thaw if it is closed. */
export function zoneIce(state: GameState, zoneId: string, geo?: Geography): HarbourIce {
  const def = (geo ?? getGeography()).seaZones.find((z) => z.id === zoneId);
  const out: HarbourIce = { zoneId, iced: false };
  if (def) out.zoneName = def.name;
  const live = Object.hasOwn(state.weather.zones, zoneId) ? state.weather.zones[zoneId] : undefined;
  if (live?.ice !== true) return out;
  out.iced = true;
  if (!def) return out;
  const now = state.time.hour;
  const today = Math.floor(now / HOURS_PER_DAY) * HOURS_PER_DAY;
  for (let d = 1; d <= DAYS_PER_YEAR; d++) {
    const at = today + d * HOURS_PER_DAY;
    const c = toCalendar(at);
    if (def.ice.some((p) => icePeriodCovers(p, c.monthIndex, c.day))) continue;
    out.thawHour = at;
    out.daysToThaw = Math.max(1, Math.ceil((at - now) / HOURS_PER_DAY));
    break;
  }
  return out;
}
