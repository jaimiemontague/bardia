/**
 * Condition-language functions (§29.7) over the military module's data. Pure; they read the
 * player's realm unless a container or holding id is given (holding functions also use the storylet
 * scope's `holding` or `settlement` binding).
 */
import { SHIP_TYPE_IDS, type ShipTypeId } from '@content/schemas/ids';
import type { ConditionEvalContext, ConditionFns } from '@sim/core/module';
import type { SettlementId } from '@sim/core/state';
import { z } from 'zod';
import { lieutenantCapacity } from './lieutenants';
import { containerMen, containerVeterancy, realmMen } from './men';
import { musterCooldownLeft } from './muster';
import { factionCapitalId } from './realm';
import { shipsOf } from './ships';

const id = z.string().min(1);
const unitArg = z.string().regex(/^[a-z][A-Za-z0-9]*$/);

function scopedContainer(explicit: unknown): string | undefined {
  return typeof explicit === 'string' ? explicit : undefined;
}

function scopedHolding(ctx: ConditionEvalContext, explicit: unknown): SettlementId | undefined {
  if (typeof explicit === 'string') return explicit as SettlementId;
  for (const key of ['holding', 'settlement']) {
    if (Object.hasOwn(ctx.scope, key)) return ctx.scope[key] as SettlementId;
  }
  return factionCapitalId(ctx.state, ctx.state.player.factionId);
}

/** The military module's condition functions. */
export function militaryConditionFns(): ConditionFns {
  return {
    /** menOfType(unit[, containerId]) → men of that unit type in the realm (all containers) or in one container. */
    menOfType: {
      args: z.union([z.tuple([unitArg]), z.tuple([unitArg, id])]),
      returns: 'number',
      evaluate: ([unit, container], ctx) => {
        const c = scopedContainer(container);
        if (c !== undefined) return containerMen(ctx.state, c, String(unit));
        return realmMen(ctx.state, ctx.state.player.factionId, String(unit)).active;
      },
    },
    /** menTotal([containerId]) → men under arms in the realm (not wounded) or in one container. */
    menTotal: {
      args: z.union([z.tuple([]), z.tuple([id])]),
      returns: 'number',
      evaluate: ([container], ctx) => {
        const c = scopedContainer(container);
        if (c !== undefined) return containerMen(ctx.state, c);
        return realmMen(ctx.state, ctx.state.player.factionId).active;
      },
    },
    /** woundedMen() → wounded men recovering in the realm. */
    woundedMen: {
      args: z.tuple([]),
      returns: 'number',
      evaluate: (_args, ctx) => realmMen(ctx.state, ctx.state.player.factionId).wounded,
    },
    /** armouryTier() → the realm armour tier (1–6). */
    armouryTier: {
      args: z.tuple([]),
      returns: 'number',
      evaluate: (_args, ctx) => ctx.state.factions[ctx.state.player.factionId]?.armouryTier ?? 1,
    },
    /** weaponTier() → the realm weapon tier (1–6). */
    weaponTier: {
      args: z.tuple([]),
      returns: 'number',
      evaluate: (_args, ctx) => ctx.state.factions[ctx.state.player.factionId]?.weaponTier ?? 1,
    },
    /** shipCount([shipType]) → ships the player's house owns (optionally of one type). */
    shipCount: {
      args: z.union([z.tuple([]), z.tuple([z.enum(SHIP_TYPE_IDS)])]),
      returns: 'number',
      evaluate: ([type], ctx) => shipsOf(ctx.state, ctx.state.player.factionId, type as ShipTypeId | undefined).length,
    },
    /** lieutenantCount() → lieutenants serving the player's house. */
    lieutenantCount: {
      args: z.tuple([]),
      returns: 'number',
      evaluate: (_args, ctx) => lieutenantCapacity(ctx.state, ctx.env.content, ctx.state.player.factionId).used,
    },
    /** lieutenantSlots() → free lieutenant capacity. */
    lieutenantSlots: {
      args: z.tuple([]),
      returns: 'number',
      evaluate: (_args, ctx) => lieutenantCapacity(ctx.state, ctx.env.content, ctx.state.player.factionId).free,
    },
    /** recruitPool([holdingId]) → recruits available at a holding (default: the scope's holding, else the capital). */
    recruitPool: {
      args: z.union([z.tuple([]), z.tuple([id])]),
      returns: 'number',
      evaluate: ([holding], ctx) => {
        const h = scopedHolding(ctx, holding);
        return h !== undefined ? (ctx.state.settlements[h]?.holding?.pool.current ?? 0) : 0;
      },
    },
    /** musterReady([holdingId]) → true when the holding's muster cooldown is over. */
    musterReady: {
      args: z.union([z.tuple([]), z.tuple([id])]),
      returns: 'boolean',
      evaluate: ([holding], ctx) => {
        const h = scopedHolding(ctx, holding);
        return h !== undefined && ctx.state.settlements[h]?.holding !== undefined && musterCooldownLeft(ctx.state, ctx.env.content, h) === 0;
      },
    },
    /** vetStars(unit, containerId) → veterancy stars (0–3) of a unit type in a container. */
    vetStars: {
      args: z.tuple([unitArg, id]),
      returns: 'number',
      evaluate: ([unit, container], ctx) => containerVeterancy(ctx.state, ctx.env.balance, String(container), String(unit)).stars,
    },
  };
}
