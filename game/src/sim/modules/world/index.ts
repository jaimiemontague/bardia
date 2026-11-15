/**
 * 'world' simulation module (scheduler order 10).
 * Scope: Map access, navigation (A*), knowledge/fog, fleet and army movement; world generation from the map + seed (rulers, families, economies, the Rival) and re-homing the placeholder player (§8, §29.6, B5).
 * Owns (src/sim/core/ownership.ts — implement exactly these; never another module's):
 *   events: Arrived
 *   state slices: factions, provinces, settlements
 * Module-owned additions (not in ownership.ts; reported to the integrator):
 *   effects: computeRoute, steerEntity, revealArea, revealSettlement
 *   events: RouteFailed, SeaZoneCharted, PortageStarted
 *   condition fns: provinceOf, regionOf, kingdomOf, isCoastal, distanceDays, charted, visited, homeland
 *   state: GameState.worldIndex, GameState.knowledge, GameState.world; Settlement.geoId; Province.geoId/neutral;
 *          Faction.kingdomId/homeProvinceId/neutral; Fleet.seaZoneId/eta/routeTarget/sailThroughNight/rowing/
 *          portageUntil/speedMult; Army.eta/routeTarget; GameOptions.startProvinceId; FactionKinds khanate, clan
 * Tunables: src/content/data/tunables/world.json (+ schemas/tunables/world.ts), read as ctx.tunables.world.
 * Strings/assets: src/content/locales/en/world.json and src/content/assets/manifest/world.json (prefix 'world.').
 * Gate: npm run verify:module -- world
 *
 * HOW IT WORKS
 *   - init (new game): world generation (worldgen.ts → politics.ts → player.ts), the state-resident
 *     geography digest `state.worldIndex` (worldIndex.ts) and the player's start knowledge
 *     (startKnowledge.ts). On a save made before this module existed (no placeholder), only the digest,
 *     knowledge and movement slices are created.
 *   - hourly: the entities on the move (movement.ts). daily: new settlements join the index; movers'
 *     cached speeds are refreshed.
 *   - effects: computeRoute (A* + waypoints + ETA), steerEntity (the player holds a heading; steering.ts),
 *     revealArea / revealSettlement (knowledge).
 *   - landfall by touch: the player's expedition fleet (steered, or on a course) and steered war-bands stop and
 *     raise Arrived (touch: true) when they come within reach of a settlement (re-arm rule in state.world.touch).
 *   - version 2 (2026-11-14): state.world.touch, Fleet/Army.steer. migrate primes the touch list of an expedition
 *     already under way, so an old save never triggers at the harbour it lies in.
 */
import type { SimContext, SimModule } from '@sim/core/module';
import type { ArmyId, FleetId, GameState, SettlementId } from '@sim/core/state';
import { z } from 'zod';
import { WORLD_CONDITION_FNS } from './conditions';
import { worldData, type WorldData } from './data';
import { worldInvariants } from './invariants';
import { chartDisc, emptyKnowledge, KNOWLEDGE_VERSION, plain, rowsFromMask, visitSettlement, zoneCountsFromMask } from './knowledge';
import { applyPlan, applySteer, clearRoute, moveEntities, planRoute, primeTouch, refreshMovers, WORLD_STATE_VERSION, worldSlice } from './movement';
import { STEER_DIRS } from './steering';
import { chooseRival, playerFamily, rehomePlayer } from './player';
import { seedRelations } from './politics';
import { markDisc, startKnowledgeMask } from './startKnowledge';
import type { WorldIndex } from './types';
import { buildWorldIndex, indexNewSettlement } from './worldIndex';
import { chooseStartProvince, GEN_STREAM, generatePolities, placeholderHome } from './worldgen';
import './types';

export type { ArrivedEvent, KnowledgeState, Lane, MoverState, ProvinceGeo, RouteTarget, SettlementGeo, SteerDir, WorldIndex, WorldState } from './types';
export { STEER_DIRS, steerBearing, steerMove, steerVector } from './steering';
export { distanceDays, WORLD_CONDITION_FNS } from './conditions';
export { worldData, type WorldData } from './data';
export { isChartedAt, rowHas, zoneChartedShare } from './knowledge';
export { planRoute, smoothPath, type PlannedPortage, type RoutePlan, type RouteResult } from './movement';
export { armySpeed, bearingDeg, crewFactor, fleetSpeed, hullFactor, hourlySpeed, offWindDeg, pointOfSail, windFactor } from './sailing';
export { chooseStartProvince, isEligibleStart, splitGarrison } from './worldgen';
export { worldInvariants } from './invariants';

const prefixed = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_.+$`), `must be a ${prefix}_ id`);
const finite = z.number().finite();
const RouteTargetSchema = z.union([
  z.object({ settlementId: prefixed('set') }).strict(),
  z.object({ siteId: prefixed('site') }).strict(),
  z.object({ x: finite, y: finite }).strict(),
]);

/** Builds (or rebuilds, when the geography changed) the world index. */
function ensureIndex(draft: GameState, ctx: SimContext, data: WorldData): void {
  const idx: WorldIndex | undefined = draft.worldIndex;
  if (idx && idx.fingerprint === data.fingerprint) return;
  draft.worldIndex = buildWorldIndex(draft, data, ctx.tunables.world, ctx.balance);
}

/** Knowledge slice for a campaign already under way (the player's holdings known, the homeland charted). */
function ensureKnowledge(draft: GameState, ctx: SimContext, data: WorldData): void {
  const k = draft.knowledge;
  if (k && k.width === data.sw.width && k.height === data.sw.height) return;
  draft.knowledge = emptyKnowledge(data.sw.width, data.sw.height);
  const culture = draft.factions[draft.player.factionId]?.culture ?? 'skarn';
  const mask = startKnowledgeMask(ctx, data, culture);
  draft.knowledge.charted = rowsFromMask(mask, data.sw.width, data.sw.height);
  draft.knowledge.zoneCharted = zoneCountsFromMask(data, mask);
}

/** New game: the whole world. */
function generateWorld(draft: GameState, ctx: SimContext, data: WorldData): void {
  const t = ctx.tunables.world;
  const rng = ctx.rng(GEN_STREAM);
  const playerFaction = draft.factions[draft.player.factionId];
  const culture = playerFaction?.culture ?? 'skarn';
  const start = chooseStartProvince(data, t, culture, draft.meta.options.startProvinceId, rng);
  const gen = generatePolities(draft, ctx, data, start);
  rehomePlayer(draft, ctx, gen);
  draft.worldIndex = buildWorldIndex(draft, data, t, ctx.balance);
  seedRelations(draft, ctx, rng, gen);
  const rivalId = chooseRival(draft, ctx, rng, gen);
  const family = playerFamily(draft, ctx, rng);

  // Knowledge: the start charts, the player's own lands visited.
  const { sw } = data;
  const mask = startKnowledgeMask(ctx, data, culture);
  const own = draft.factions[draft.player.factionId]?.holdingIds ?? [];
  for (const sid of own) {
    const s = draft.settlements[sid];
    if (s) markDisc(sw.width, sw.height, mask, s.mapPos.x, s.mapPos.y, t.knowledge.settlementRadius);
  }
  draft.knowledge = { version: KNOWLEDGE_VERSION, width: sw.width, height: sw.height, charted: rowsFromMask(mask, sw.width, sw.height), visited: {}, zoneCharted: zoneCountsFromMask(data, mask), zonesComplete: [] };
  for (const sid of own) draft.knowledge.visited[sid] = ctx.hour;
  draft.world = { version: WORLD_STATE_VERSION, movers: {} };

  // The broken feast (§4.5).
  const rival = rivalId !== undefined ? draft.factions[rivalId] : undefined;
  const rivalRuler = rival ? draft.characters[rival.rulerId] : undefined;
  const slain = family.slain !== undefined ? draft.characters[family.slain] : undefined;
  if (rival && rivalRuler && slain) {
    ctx.chronicle({
      kind: 'world.parentSlain',
      textKey: 'world.chronicle.parentSlain',
      importance: 4,
      vars: { parent: slain.name, rival: rivalRuler.name, house: rival.name },
      refs: [slain.id, rivalRuler.id, rival.id],
    });
  }
}

export const module: SimModule = {
  id: 'world',
  order: 10,
  version: 2,
  init(draft, ctx) {
    const data = worldData();
    if (placeholderHome(draft) !== undefined && !draft.worldIndex) generateWorld(draft, ctx, data);
    ensureIndex(draft, ctx, data);
    ensureKnowledge(draft, ctx, data);
    worldSlice(draft);
  },
  migrate(draft, fromVersion, ctx) {
    const data = worldData();
    ensureIndex(draft, ctx, data);
    ensureKnowledge(draft, ctx, data);
    const w = worldSlice(draft);
    if (fromVersion < 2) {
      // v2: steering and landfall by touch. An expedition already out lies within reach of nothing new.
      w.version = WORLD_STATE_VERSION;
      const fid = draft.player.expeditionFleetId;
      if (fid !== undefined && draft.fleets[fid]) primeTouch(draft, ctx, data, fid, 'fleet');
    }
  },
  systems: {
    hourly(draft, ctx) {
      moveEntities(draft, ctx, worldData());
    },
    daily(draft, ctx) {
      const data = worldData();
      const idx = draft.worldIndex;
      if (idx) {
        const ids = Reflect.ownKeys(draft.settlements) as SettlementId[];
        const fresh = ids.filter((id) => !Object.hasOwn(idx.settlements, id));
        if (fresh.length > 0) {
          // One plain snapshot for the whole batch (positions of every settlement, the index so far).
          const view = { settlements: plain(draft.settlements), index: { ...plain(idx.settlements) } };
          for (const id of fresh) {
            if (indexNewSettlement(draft, data, ctx.tunables.world, ctx.balance, id, view)) {
              const g = idx.settlements[id];
              if (g) view.index[id] = g;
            }
          }
        }
      }
      refreshMovers(draft, ctx);
    },
  },
  effects: {
    computeRoute(draft, e, ctx) {
      const id = e.entityId as FleetId | ArmyId;
      const r = planRoute(draft, ctx.content, id, e.to, { ...(e.avoidStorms !== undefined ? { avoidStorms: e.avoidStorms } : {}) });
      if (!r.ok) {
        clearRoute(draft, id);
        ctx.emit({ type: 'RouteFailed', entityId: id, reason: r.reason });
        return;
      }
      applyPlan(draft, ctx, id, r.plan, e.depart !== false);
      if (r.plan.waypoints.length === 0) {
        // Already there.
        const entity = id.startsWith('flt_') ? draft.fleets[id as FleetId] : draft.armies[id as ArmyId];
        if (entity) {
          entity.route = [];
          delete entity.eta;
          ctx.emit({
            type: 'Arrived',
            ...(id.startsWith('flt_') ? { fleetId: id as FleetId } : { armyId: id as ArmyId }),
            factionId: entity.ownerId,
            ...(r.plan.settlementId !== undefined ? { settlementId: r.plan.settlementId } : {}),
            ...(r.plan.siteId !== undefined ? { siteId: r.plan.siteId } : {}),
            cell: { x: entity.pos.x, y: entity.pos.y },
          });
        }
      }
    },
    steerEntity(draft, e, ctx) {
      applySteer(draft, ctx, e);
    },
    revealArea(draft, e, ctx) {
      chartDisc(draft, ctx, worldData(), e.x, e.y, e.radius);
    },
    revealSettlement(draft, e, ctx) {
      const s = draft.settlements[e.settlementId];
      if (!s) return;
      const data = worldData();
      chartDisc(draft, ctx, data, s.mapPos.x, s.mapPos.y, e.radius ?? ctx.tunables.world.knowledge.settlementRadius);
      if (e.visit === true) visitSettlement(draft, ctx, data, e.settlementId);
    },
  },
  effectSchemas: {
    computeRoute: z
      .object({
        op: z.literal('computeRoute'),
        entityId: z.union([prefixed('flt'), prefixed('arm')]),
        to: RouteTargetSchema,
        avoidStorms: z.boolean().optional(),
        depart: z.boolean().optional(),
      })
      .strict(),
    steerEntity: z
      .object({
        op: z.literal('steerEntity'),
        entityId: z.union([prefixed('flt'), prefixed('arm')]),
        dir: z.enum(['stop', ...STEER_DIRS] as unknown as ['stop', ...string[]]),
      })
      .strict(),
    revealArea: z.object({ op: z.literal('revealArea'), x: finite, y: finite, radius: z.number().finite().min(0).max(400) }).strict(),
    revealSettlement: z.object({ op: z.literal('revealSettlement'), settlementId: prefixed('set'), radius: z.number().finite().min(0).max(400).optional(), visit: z.boolean().optional() }).strict(),
  },
  conditionFns: WORLD_CONDITION_FNS,
  invariants: (state) => worldInvariants(state),
};
