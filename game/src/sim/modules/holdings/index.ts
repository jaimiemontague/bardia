/**
 * 'holdings' simulation module (scheduler order 80).
 * Scope: Holdings, governors, taxes, buildings, loyalty and revolts, tributaries and vassals, crowns, colonies (§10, §31.7).
 * Owns (src/sim/core/ownership.ts — implement exactly these; never another module's):
 *   commands: setTax, queueBuilding, setGarrison
 *   events: RevoltStarted, HoldingAttacked, HoldingCaptured, BuildingCompleted
 * Note: Owns buildings (incl. the shipyard building); ships are queued by military.
 * Module-owned additions: root slice `holdingsState` (types.ts).
 * Effects used (owned elsewhere): core addSilver, changeLoyalty; military moveMen (garrison → pool;
 *   raw counts when military is absent).
 * Tunables: src/content/data/tunables/holdings.json (+ schemas/tunables/holdings.ts), read as ctx.tunables.holdings.
 * Strings/assets: src/content/locales/en/holdings.json and src/content/assets/manifest/holdings.json (prefix 'holdings.').
 * Gate: npm run verify:module -- holdings
 *
 * HOW IT CONNECTS (nothing is counted twice: this module writes the fields the others already read)
 *   - `holding.tax`: economy's monthly ledger taxes each holding with it (§31.1); this module adds the
 *     §31.7 loyalty term for it.
 *   - `holding.loyalty`: changed monthly through core `changeLoyalty`; military's recruitment pools read
 *     it (§31.5 poolMax, ×1.2 at 75+).
 *   - `settlement.buildings` / `fortTier`: raised when a queued tier completes; economy charges the
 *     upkeep and market tolls, military reads Hall (lieutenants, huscarls), Smithy (armoury tiers),
 *     Shipyard (ship types, parallel builds) and Mead-hall, faith reads the Grove, battles read `fortTier`.
 *   - garrisons: lowering one moves men to the holding's recruitment pool with military's `moveMen`;
 *     raising one is military's muster (pool → garrison) or transfer (holding → holding).
 *   - victories this month come from military's `monthBattles` tally (read before military's monthly
 *     reset, order 80 < 90); a raid is the settlements module's `raidedHour`.
 *
 * LEFT OUT (see the module report): revolts (`RevoltStarted`), `HoldingAttacked` / `HoldingCaptured`
 * (no module attacks the player's holdings yet), food harvest and consumption, petitions, governors.
 */
import type { Reactions, SimModule } from '@sim/core/module';
import './types';
import { handleQueueBuilding, handleSetGarrison, handleSetTax } from './commands';
import { holdingsInvariants } from './invariants';
import { HOLDINGS_COMMAND_SCHEMAS } from './schemas';
import { HOLDINGS_VERSION, initHoldings } from './slice';
import { dailyHoldings, hourlyBuildings, monthlyLoyalty, onFeastHeld } from './systems';

export type * from './types';
export * from './rules';
export { holdingsInvariants } from './invariants';

/** Reactions to events other modules declare; read defensively by name (no type dependency). */
const reactions = { FeastHeld: onFeastHeld } as unknown as Reactions;

export const module: SimModule = {
  id: 'holdings',
  order: 80,
  version: HOLDINGS_VERSION,
  init(draft, ctx) {
    initHoldings(draft, ctx);
  },
  migrate(draft, fromVersion, ctx) {
    // Version 0 is the kernel stub (no slice): treat the save as new to this module.
    if (fromVersion < 1) initHoldings(draft, ctx);
  },
  handlers: {
    setTax: handleSetTax,
    queueBuilding: handleQueueBuilding,
    setGarrison: handleSetGarrison,
  },
  commandSchemas: HOLDINGS_COMMAND_SCHEMAS,
  systems: {
    hourly: hourlyBuildings,
    daily: dailyHoldings,
    monthly: monthlyLoyalty,
  },
  reactions,
  invariants: holdingsInvariants,
};
