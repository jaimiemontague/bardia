/**
 * Weather functions of the condition language (design §29.7), pure reads of `state.weather`.
 *
 *   stormNear()            a live storm cell covers the scoped fleet (scope.fleet, else the expedition)
 *   stormNear(n)           … or is within n cells of it
 *   windStrength(zone?)    'calm' | 'light' | 'fresh' | 'strong' | 'gale' in a zone (default: scope.zone,
 *                          else the scoped fleet's zone)
 *   foggy(zone?)           fog in that zone
 *   iceBound(zone?)        the zone is closed by ice today
 *   stormRisk(zone?)       the season's world-level daily storm chance there (§31.3 seasonBase × zoneMod,
 *                          harsh winters included), e.g. `stormRisk() > 0.1`
 *   stormSeason()          the current season's base storm chance is at least `storms.stormSeasonMin`
 *                          (autumn and winter with the bundled numbers)
 */
import type { ConditionEvalContext, ConditionFns } from '@sim/core/module';
import type { FleetId, GameState } from '@sim/core/state';
import { season } from '@sim/core/time';
import { z } from 'zod';
import { canHit } from './storms';
import { weatherGeography, zoneIndexAt, type WeatherGeography } from './zones';

const zoneArg = z.union([z.tuple([]), z.tuple([z.string().min(1)])]);

function scopedFleet(state: GameState, scope: Readonly<Record<string, string>>) {
  const id = (Object.hasOwn(scope, 'fleet') ? scope['fleet'] : undefined) ?? state.player.expeditionFleetId;
  if (id === undefined || !Object.hasOwn(state.fleets, id)) return undefined;
  return state.fleets[id as FleetId];
}

/** The zone id named by the argument, the scope's `zone`, or the scoped fleet's position. */
function zoneOf(args: readonly unknown[], ctx: ConditionEvalContext, wg: WeatherGeography): string | undefined {
  const given = typeof args[0] === 'string' ? args[0] : Object.hasOwn(ctx.scope, 'zone') ? ctx.scope['zone'] : undefined;
  if (given !== undefined) return given;
  const fleet = scopedFleet(ctx.state, ctx.scope);
  if (fleet === undefined) return undefined;
  const zi = zoneIndexAt(wg, fleet.pos.x, fleet.pos.y);
  return zi >= 0 ? wg.zones[zi]?.id : undefined;
}

function zoneState(state: GameState, id: string | undefined) {
  return id !== undefined && Object.hasOwn(state.weather.zones, id) ? state.weather.zones[id] : undefined;
}

/** The weather module's condition functions (pass a geography getter for tests; default: the bundled pack). */
export function weatherConditionFns(getWg: () => WeatherGeography = () => weatherGeography()): ConditionFns {
  return {
    stormNear: {
      args: z.union([z.tuple([]), z.tuple([z.number().finite().min(0)])]),
      returns: 'boolean',
      evaluate: (args, ctx) => {
        const fleet = scopedFleet(ctx.state, ctx.scope);
        if (fleet === undefined) return false;
        const extra = typeof args[0] === 'number' ? args[0] : 0;
        const t = ctx.env.content.tunables.weather;
        for (const c of ctx.state.weather.storms) {
          if (!canHit(c, t)) continue;
          const r = c.radius + extra;
          const dx = c.pos.x - fleet.pos.x;
          const dy = c.pos.y - fleet.pos.y;
          if (dx * dx + dy * dy <= r * r) return true;
        }
        return false;
      },
    },
    windStrength: {
      args: zoneArg,
      returns: 'string',
      evaluate: (args, ctx) => zoneState(ctx.state, zoneOf(args, ctx, getWg()))?.windStr ?? 'calm',
    },
    foggy: {
      args: zoneArg,
      returns: 'boolean',
      evaluate: (args, ctx) => zoneState(ctx.state, zoneOf(args, ctx, getWg()))?.fog === true,
    },
    iceBound: {
      args: zoneArg,
      returns: 'boolean',
      evaluate: (args, ctx) => zoneState(ctx.state, zoneOf(args, ctx, getWg()))?.ice === true,
    },
    stormRisk: {
      args: zoneArg,
      returns: 'number',
      evaluate: (args, ctx) => {
        const wg = getWg();
        const id = zoneOf(args, ctx, wg);
        const zi = id !== undefined && Object.hasOwn(wg.byId, id) ? wg.byId[id] : undefined;
        const zone = zi !== undefined ? wg.zones[zi] : undefined;
        if (zone === undefined) return 0;
        const b = ctx.env.balance.storms;
        const s = season(ctx.state.time.hour);
        const harsh = ctx.state.meta.options.harshWinters === true && s === 'winter' ? b.harshWintersMult : 1;
        return b.season[s] * zone.stormMod * harsh;
      },
    },
    stormSeason: {
      args: z.tuple([]),
      returns: 'boolean',
      evaluate: (_args, ctx) => ctx.env.balance.storms.season[season(ctx.state.time.hour)] >= ctx.env.content.tunables.weather.storms.stormSeasonMin,
    },
  };
}
