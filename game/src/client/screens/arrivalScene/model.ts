/**
 * What the arrival scene shows, from the pending `arrival` payload and the state (pure): the settlement's
 * picture (tier, walls, culture, recent raids, seen from the ship or overland), the cue, what is known of the
 * place, and the options split into those in view (at most three plus "Sail on") and the rest behind More.
 */
import type { GameState, PendingDecision, Settlement, SettlementId, TextVars } from '@sim/core/state';
import type { ArrivalChoice, DecisionOption } from '@sim/modules/settlements/types';
import { ambienceOf, bannerColour, PLAYER_COLOUR, styleOfCulture, timeOfDay, type BuildStyle, type SettlementPictureModel } from '../../render/scenes/index';
import { hashString } from '../../render/scenes/paint';

/** A place raided, sacked or plundered within this many hours still shows the scars. */
export const SCAR_HOURS = 24 * 90;

export interface ArrivalView {
  settlement: Settlement;
  picture: SettlementPictureModel;
  assetId: string;
  cue: { mainKey: string; vars: TextVars };
  knownVars: TextVars;
  kickerVars: TextVars;
  inView: DecisionOption<ArrivalChoice>[];
  more: DecisionOption<ArrivalChoice>[];
}

/**
 * The painting of a land other than the north, by building style (styleOfCulture): one picture per land,
 * painted for one kind of place. Albric and Cael share the western lowland town; Corvani the walled city of the
 * warm south; Velkar the river stronghold; the Saraleonese the sun-baked port; the Kurgai the camp on the
 * grass. The northern cultures (Skarn, Hvarn, Eyjar, Isafolder, the Rime-hunters) keep the pictures by kind.
 */
export const LAND_ARRIVAL: Readonly<Record<Exclude<BuildStyle, 'north'>, string>> = {
  west: 'settlements.scene.arrival.town.west',
  south: 'settlements.scene.arrival.city.south',
  east: 'settlements.scene.arrival.fortress.east',
  sun: 'settlements.scene.arrival.town.sun',
  steppe: 'settlements.scene.arrival.village.steppe',
};

/**
 * Which painting an arrival shows. Coming overland, the view from the rise; a place raided not long ago, the
 * burned strand (the scars are the news); a cloister, the cloister (its painting is already a house of the
 * Lantern on a western shore). Otherwise a settlement of a land with its own painting shows that land's
 * picture whatever its kind (a city of the west arrives to the western town: the land is truer than the
 * size), and a northern settlement the picture of its kind.
 */
export function arrivalAssetId(a: { tier: string; culture: string | undefined; overland: boolean; scarred: boolean }): string {
  if (a.overland) return 'settlements.scene.overland';
  if (a.scarred) return 'settlements.scene.arrival.raided';
  if (a.tier === 'cloister') return 'settlements.scene.arrival.cloister';
  const style = styleOfCulture(a.culture);
  return style === 'north' ? `settlements.scene.arrival.${a.tier}` : LAND_ARRIVAL[style];
}

/** The settlement still shows the marks of a raid or a sack. */
export function isScarred(state: GameState, s: Settlement): boolean {
  const now = state.time.hour;
  if (s.devastationUntil !== undefined && s.devastationUntil > now) return true;
  const raided = (s as Settlement & { raidedHour?: number }).raidedHour;
  if (raided !== undefined && now - raided < SCAR_HOURS) return true;
  const fate = (s as Settlement & { lastFate?: { fate: string; hour: number } }).lastFate;
  return fate !== undefined && now - fate.hour < SCAR_HOURS && (fate.fate === 'raid' || fate.fate === 'sackAndBurn' || fate.fate === 'plunderAndLeave');
}

const DISPLAY_ORDER: readonly ArrivalChoice[] = ['enter', 'trade', 'parley', 'raid', 'assault', 'besiege', 'leave'];
const WANT_ORDER: readonly ArrivalChoice[] = ['enter', 'raid', 'assault', 'trade', 'parley'];

/** At most three open options (enter, raid, assault first) plus "Sail on"; everything else behind More. */
export function planArrival(options: readonly DecisionOption<ArrivalChoice>[]): { inView: DecisionOption<ArrivalChoice>[]; more: DecisionOption<ArrivalChoice>[] } {
  const leave = options.find((o) => o.id === 'leave');
  const picked = new Set<ArrivalChoice>();
  for (const id of WANT_ORDER) {
    if (picked.size >= 3) break;
    if (options.some((o) => o.id === id && o.available)) picked.add(id);
  }
  const order = (a: DecisionOption<ArrivalChoice>, b: DecisionOption<ArrivalChoice>) => DISPLAY_ORDER.indexOf(a.id) - DISPLAY_ORDER.indexOf(b.id);
  const inView = options.filter((o) => picked.has(o.id)).sort(order);
  if (leave) inView.push(leave);
  const more = options.filter((o) => !picked.has(o.id) && o.id !== 'leave').sort((a, b) => Number(b.available) - Number(a.available) || order(a, b));
  return { inView, more };
}

/** Men with the party at the settlement (fleet or war-band). */
function partyMen(state: GameState, fleetId?: string, armyId?: string): number {
  if (armyId !== undefined) {
    const a = state.armies?.[armyId as never] as { squads?: { men: number }[] } | undefined;
    if (a?.squads) return a.squads.reduce((n, q) => n + (q.men ?? 0), 0);
  }
  const f = fleetId !== undefined ? state.fleets[fleetId as never] : undefined;
  return f ? Object.values(f.men).reduce((n, v) => n + (v ?? 0), 0) : 0;
}

/** The scene's view of a pending arrival (null when the settlement is unknown). */
export function arrivalView(state: GameState, pending: PendingDecision): ArrivalView | null {
  const p = pending.payload as { settlementId: SettlementId; fleetId?: string; armyId?: string; options?: DecisionOption<ArrivalChoice>[]; own?: boolean };
  const s = state.settlements[p.settlementId];
  if (!s) return null;
  const fleet = p.fleetId !== undefined ? state.fleets[p.fleetId as never] : undefined;
  const overland = p.armyId !== undefined && p.fleetId === undefined;
  const own = p.own ?? s.factionId === state.player.factionId;
  const lord = state.factions[s.factionId];
  const scarred = isScarred(state, s);
  const ambience = ambienceOf(state, { ...(fleet ? { pos: fleet.pos } : { pos: s.mapPos }), zoneId: (fleet as { seaZoneId?: string | null } | undefined)?.seaZoneId ?? null });
  const picture: SettlementPictureModel = {
    ambience,
    tier: s.tier,
    fortTier: s.fortTier,
    style: styleOfCulture(s.culture),
    lantern: s.faith === 'lantern' || s.faith === 'goldenLantern',
    seed: hashString(s.id),
    colour: bannerColour(lord, state.player.factionId),
    ourColour: PLAYER_COLOUR,
    raided: scarred,
    coastal: s.coastal,
    view: overland ? 'land' : 'sea',
  };
  const tier = s.tier;
  const cueKey = own ? 'settlements.cue.own' : scarred ? 'settlements.cue.raided' : overland ? 'settlements.cue.overland' : `settlements.cue.${tier}`;
  return {
    settlement: s,
    picture,
    assetId: arrivalAssetId({ tier, culture: s.culture, overland, scarred }),
    cue: { mainKey: cueKey, vars: { settlement: s.name } },
    knownVars: { tier, pop: roundPop(s.pop), walls: String(s.fortTier), own: own ? 'yes' : 'no', lord: lord?.name ?? '', scarred: scarred ? 'yes' : 'no' },
    kickerVars: { tod: timeOfDay(ambience.hourOfDay), weather: ambience.weather.storm ? 'storm' : ambience.weather.fog ? 'fog' : 'clear', men: partyMen(state, p.fleetId, p.armyId), overland: overland ? 'yes' : 'no' },
    ...planArrival(p.options ?? []),
  };
}

/** A population as a traveller would put it. */
export function roundPop(n: number): number {
  if (n < 100) return Math.max(10, Math.round(n / 10) * 10);
  if (n < 1000) return Math.round(n / 50) * 50;
  return Math.round(n / 100) * 100;
}
