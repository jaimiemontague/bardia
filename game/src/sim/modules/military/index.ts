/**
 * 'military' simulation module (scheduler order 90).
 * Scope: Recruitment pools and muster, equipment tiers, ships and shipyards, lieutenants, squads, veterancy (§12, §31.5).
 * Owns (src/sim/core/ownership.ts — implement exactly these; never another module's):
 *   effects: addMen, killMen, spawnArmy
 *   commands: muster, queueShip, repairShip, upgradeArmoury, transfer, promoteLieutenant, hireSellsword
 *   events: ShipCompleted, MusterCompleted
 *   state slices: ships, armies
 * Module-internal additions (owned implicitly): effects moveMen, damageShip, sinkShip, captureShip,
 * addShip; events ShipSunk, ShipCaptured, TransferArrived, ArmouryUpgraded, LieutenantJoined,
 * LieutenantDeserted, MenLost, WoundedRecovered, ArmySpawned; root slice `military`; condition
 * functions menOfType, menTotal, woundedMen, armouryTier, weaponTier, shipCount, lieutenantCount,
 * lieutenantSlots, recruitPool, musterReady, vetStars.
 * Note: Owns ships and the ship queue; holdings owns the shipyard building that gates them.
 * Tunables: src/content/data/tunables/military.json (+ schemas/tunables/military.ts), read as ctx.tunables.military.
 * Strings/assets: src/content/locales/en/military.json and src/content/assets/manifest/military.json (prefix 'military.').
 * Gate: npm run verify:module -- military
 *
 * Systems: hourly (gated by `military.nextDueHour`: muster arrivals, transfer arrivals, ship launches),
 * daily (wounded recovery, beach field repair, towed prizes, shipyard rescheduling), monthly (pool
 * regeneration, lieutenant loyalty and desertion, offer history).
 */
import { getContent } from '@content/index';
import type { Reactions, SimModule } from '@sim/core/module';
import './types';
import { militaryConditionFns } from './conditions';
import { handleUpgradeArmoury } from './equipment';
import { militaryInvariants } from './invariants';
import { handleHireSellsword, handlePromoteLieutenant, monthlyLieutenants, pruneHiredOffers } from './lieutenants';
import { applyAddMen, applyDisbandArmy, applyKillMen, applyMoveMen, applySpawnArmy, dailyWounded, onBattleEnded, onSeaBattleEnded } from './men';
import { handleMuster, processMusters } from './muster';
import { initPools, monthlyPools } from './pools';
import { MILITARY_COMMAND_SCHEMAS, MILITARY_EFFECT_SCHEMAS } from './schemas';
import {
  applyAddShip,
  applyCaptureShip,
  applyDamageShip,
  applySinkShip,
  dailyFieldRepair,
  dailyShipyards,
  dailyTowed,
  handleQueueShip,
  handleRepairShip,
  processShipyards,
} from './ships';
import { militaryOf, refreshNextDue } from './slice';
import { handleTransfer, processTransfers } from './transfer';

/**
 * Reactions to events declared by the battle and sea-battle sub-sims. They are registered by name and
 * read their payloads defensively, so this module does not depend on those folders' types.
 */
const reactions = {
  BattleEnded: onBattleEnded,
  SeaBattleEnded: onSeaBattleEnded,
} as unknown as Reactions;

export const module: SimModule = {
  id: 'military',
  order: 90,
  version: 1,
  init(draft, ctx) {
    militaryOf(draft);
    initPools(draft, ctx);
    refreshNextDue(militaryOf(draft));
  },
  handlers: {
    muster: handleMuster,
    queueShip: handleQueueShip,
    repairShip: handleRepairShip,
    upgradeArmoury: handleUpgradeArmoury,
    transfer: handleTransfer,
    promoteLieutenant: handlePromoteLieutenant,
    hireSellsword: handleHireSellsword,
  },
  commandSchemas: MILITARY_COMMAND_SCHEMAS,
  systems: {
    hourly(draft, ctx) {
      const due = draft.military?.nextDueHour;
      if (due === undefined || due > ctx.hour) return;
      processMusters(draft, ctx);
      processTransfers(draft, ctx);
      processShipyards(draft, ctx);
      refreshNextDue(militaryOf(draft));
    },
    daily(draft, ctx) {
      dailyWounded(draft, ctx);
      dailyFieldRepair(draft, ctx);
      dailyTowed(draft, ctx);
      if (draft.military && Object.keys(draft.military.shipyards).length > 0) {
        dailyShipyards(draft, ctx);
        refreshNextDue(draft.military);
      }
    },
    monthly(draft, ctx) {
      monthlyPools(draft, ctx);
      monthlyLieutenants(draft, ctx);
      pruneHiredOffers(draft, ctx);
    },
  },
  effects: {
    addMen: applyAddMen,
    killMen: applyKillMen,
    moveMen: applyMoveMen,
    spawnArmy: applySpawnArmy,
    disbandArmy: applyDisbandArmy,
    damageShip: applyDamageShip,
    sinkShip: applySinkShip,
    captureShip: applyCaptureShip,
    addShip: applyAddShip,
  },
  effectSchemas: MILITARY_EFFECT_SCHEMAS,
  reactions,
  conditionFns: militaryConditionFns(),
  invariants(state) {
    return militaryInvariants(state, getContent().balance);
  },
};

// ---------------------------------------------------------------------------------------------
// Public, pure API for the client, tools and tests (other sim modules use effects/events instead).

export type * from './types';
export { musterPreview, musterCooldownLeft, fleetInHarbour, type MusterPreview, type MusterLine, type MusterIssue } from './muster';
export { upgradePreview, trackTier, holdsRelic, type UpgradePreview, type UpgradeIssueCode } from './equipment';
export {
  shipOrderPreview,
  shipPrice,
  shipyardSlots,
  buildableShips,
  projectQueue,
  repairQuote,
  repairCost,
  repairYardFor,
  fleetCrewStatus,
  shipsOf,
  findShipDef,
  type ShipOrderPreview,
  type ShipOrderIssue,
  type RepairIssue,
} from './ships';
export { transferPreview, transferDays, interceptChance, type TransferPreview, type TransferIssue } from './transfer';
export {
  lieutenantsOf,
  lieutenantCapacity,
  candidatesForRole,
  sellswordOffers,
  hasSellswords,
  playerPresentAt,
  hireIssues,
  promoteIssues,
  lieutenantLoyaltyDelta,
  absoluteMonth,
  type SellswordOffer,
  type HireIssue,
  type PromoteIssue,
} from './lieutenants';
export { poolMax, poolRegen, poolForecast, governorStewardship } from './pools';
export { realmMen, containerMen, containerVeterancy, sumMen, mergeBattles } from './men';
export {
  findUnit,
  isPlayerUnit,
  playerUnitIds,
  baseUnitOf,
  cultureUniqueFor,
  musterRoster,
  cultureRoster,
  genericUnits,
  unmetRequirements,
  berserkerCap,
  equipmentSurcharge,
  unitBounty,
  unitWage,
  vetStarsFor,
  battlesForStars,
  squadCap,
  effectiveUnitStats,
} from './units';
export { realmModifier, effectiveSkill, buildingTier, factionCapitalId, holdingIdsOf, isAtWar, oldWaysFavor } from './realm';
export { readMilitary, shipOrdersOf } from './slice';
