/**
 * Hover tooltips (pure apart from the i18n lookup): a title, a subtitle and label/value rows for whatever is under
 * the pointer. Every string is a `map.*` locale key (src/content/locales/en/map.json).
 */
import { TERRAIN_CLASSES } from '@content/world';
import type { Faction, GameState } from '@sim/core/state';
import { CELL_SEA, type StaticWorld } from '@sim/modules/world/map/index';
import { formatNumber, t } from '../../i18n/index';
import { seaLabelText } from './labels';
import type { MapScene, MapTarget } from './types';

export interface TooltipRow {
  label: string;
  value: string;
}

export interface TooltipContent {
  title: string;
  subtitle?: string;
  rows: TooltipRow[];
  /** A short hint line (what clicking does). */
  hint?: string;
}

export interface DescribeContext {
  world: StaticWorld;
  scene: MapScene;
  state: GameState | null;
}

/** The 8 compass points, clockwise from north. */
export const COMPASS_POINTS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;

/** Compass point key of a bearing in degrees. */
export function compassPoint(deg: number): (typeof COMPASS_POINTS)[number] {
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return COMPASS_POINTS[i]!;
}

function factionName(state: GameState | null, id: string | undefined): string | null {
  if (!state || !id || !state.factions || !Object.hasOwn(state.factions, id)) return null;
  return (state.factions[id as keyof typeof state.factions] as Faction).name;
}

function kingdomOfProvince(world: StaticWorld, provinceIndex: number): string | null {
  const p = world.geo.provinces[provinceIndex];
  if (!p?.kingdomId || !Object.hasOwn(world.index.kingdom, p.kingdomId)) return null;
  return world.geo.kingdoms[world.index.kingdom[p.kingdomId]!]?.name ?? null;
}

function leagues(n: number): string {
  return t('map.unit.leagues', { n: Math.max(0, Math.round(n)) });
}

/** Tooltip content for a target, or null when there is nothing to say. */
export function describeTarget(target: MapTarget, ctx: DescribeContext): TooltipContent | null {
  const { world, scene, state } = ctx;
  switch (target.kind) {
    case 'settlement': {
      const s = scene.settlements.find((m) => m.key === target.key);
      if (!s) return null;
      const rows: TooltipRow[] = [];
      const owner = factionName(state, s.factionId) ?? (s.provinceIndex >= 0 ? kingdomOfProvince(world, s.provinceIndex) : null);
      if (s.isHome) rows.push({ label: t('map.tip.seat'), value: t('map.tip.yourSeat') });
      else if (owner) rows.push({ label: t('map.tip.realm'), value: owner });
      const prov = world.geo.provinces[s.provinceIndex];
      if (prov) rows.push({ label: t('map.tip.province'), value: prov.name });
      rows.push({ label: t('map.tip.faith'), value: t(`map.faith.${s.faith}`) });
      if (s.economy) rows.push({ label: t('map.tip.economy'), value: t(`map.economy.${s.economy}`) });
      rows.push({ label: t('map.tip.harbour'), value: t(s.coastal ? 'map.tip.coastal' : 'map.tip.inland') });
      return {
        title: s.name,
        subtitle: t('map.tip.settlementLine', { tier: t(`map.tier.${s.tier}`), culture: t(`map.culture.${s.culture}`) }),
        rows,
        hint: t('map.tip.clickSelect'),
      };
    }
    case 'site': {
      const s = scene.sites.find((m) => m.key === target.key);
      if (!s) return null;
      return { title: s.name, subtitle: t(`map.site.${s.kind}`), rows: s.cleared ? [{ label: t('map.tip.state'), value: t('map.tip.cleared') }] : [], hint: t('map.tip.clickSelect') };
    }
    case 'fleet': {
      const f = scene.fleets.find((m) => m.id === target.fleetId);
      if (!f) return null;
      const rows: TooltipRow[] = [
        { label: t('map.tip.ships'), value: formatNumber(f.ships) },
        { label: t('map.tip.men'), value: formatNumber(f.men) },
      ];
      if (f.heading !== null) rows.push({ label: t('map.tip.heading'), value: t(`map.compass.${compassPoint(f.heading)}`) });
      const eta = f.legDays[f.legDays.length - 1];
      if (eta !== undefined && Number.isFinite(eta)) rows.push({ label: t('map.tip.eta'), value: t('map.unit.days', { n: Math.max(1, Math.ceil(eta)) }) });
      rows.push({ label: t('map.tip.state'), value: t(`map.fleetMode.${f.mode}`) });
      const owner = f.isPlayer ? t('map.tip.yourHouse') : (factionName(state, f.ownerId) ?? t('map.tip.unknownOwner'));
      return {
        title: f.isExpedition ? t('map.tip.yourExpedition') : t(`map.fleet.${f.kind}`),
        subtitle: owner,
        rows,
        ...(f.isPlayer ? { hint: t('map.tip.clickSelect') } : {}),
      };
    }
    case 'storm': {
      const s = scene.storms.find((m) => m.id === target.stormId);
      if (!s) return null;
      const rows: TooltipRow[] = [{ label: t('map.tip.extent'), value: leagues(s.radius * 2) }];
      const speed = Math.hypot(s.velocity[0], s.velocity[1]);
      if (speed > 0.01) {
        const deg = (Math.atan2(s.velocity[0], -s.velocity[1]) * 180) / Math.PI;
        rows.push({ label: t('map.tip.drift'), value: t('map.tip.driftValue', { dir: t(`map.compass.${compassPoint(deg)}`), n: Math.round(speed * 24) }) });
      }
      if (s.forecast) rows.push({ label: t('map.tip.forecast'), value: t('map.tip.forecastIn', { hours: Math.round(s.hoursAhead) }) });
      return { title: t(`map.storm.${s.severity}`), rows };
    }
    case 'sea': {
      const z = world.zoneOf[target.cell]!;
      const zone = z >= 0 ? world.geo.seaZones[z] : undefined;
      const rows: TooltipRow[] = [];
      const wind = z >= 0 ? scene.winds[z] : undefined;
      if (wind) {
        rows.push({
          label: t(wind.source === 'live' ? 'map.tip.wind' : 'map.tip.prevailing'),
          value: t('map.tip.windValue', { strength: t(`map.wind.${wind.strength}`), dir: t(`map.compass.${compassPoint(wind.fromDeg)}`) }),
        });
        if (wind.fog) rows.push({ label: t('map.tip.sky'), value: t('map.tip.fog') });
        if (wind.ice) rows.push({ label: t('map.tip.ice'), value: t('map.tip.iceClosed') });
      }
      if (world.kind[target.cell] === CELL_SEA) rows.push({ label: t('map.tip.offshore'), value: leagues(world.coastDist[target.cell]!) });
      return { title: zone ? seaLabelText(zone.name) : t('map.tip.openSea'), rows };
    }
    case 'land': {
      const p = world.provinceOf[target.cell]!;
      const r = world.regionOf[target.cell]!;
      const prov = p >= 0 ? world.geo.provinces[p] : undefined;
      const region = r >= 0 ? world.geo.regions[r] : undefined;
      const rows: TooltipRow[] = [];
      if (region && prov) rows.push({ label: t('map.tip.region'), value: region.name });
      const realm = p >= 0 ? kingdomOfProvince(world, p) : null;
      if (realm) rows.push({ label: t('map.tip.realm'), value: realm });
      const tc = world.terrain[target.cell]!;
      const terrain = TERRAIN_CLASSES[tc];
      if (world.kind[target.cell] === 2) rows.push({ label: t('map.tip.terrain'), value: t('map.terrain.lake') });
      else if (terrain) rows.push({ label: t('map.tip.terrain'), value: t(`map.terrain.${terrain}`) });
      if (world.river[target.cell]! > 0) rows.push({ label: t('map.tip.river'), value: t(world.river[target.cell] === 2 ? 'map.tip.navigable' : 'map.tip.stream') });
      return { title: prov?.name ?? region?.name ?? t('map.tip.wilds'), rows };
    }
  }
}
