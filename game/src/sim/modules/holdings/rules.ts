/**
 * The holdings rules as pure functions over a plain (or frozen) state. The command handlers and the
 * monthly system call these, and so does the Affairs of State screen for its previews, so the screen
 * can never disagree with the simulation:
 *
 *   buildings   next tier, cost, days, upkeep and effects from balance `buildings` (§10.4); a first
 *               tier the design prices "—" uses tunables `founding`; one tier at a time; harbour
 *               buildings need a coastal or river-port holding; build slots = balance
 *               `holdings.buildSlots` (`buildSlotsHighStewardship` with a governor of Stewardship ≥
 *               `highStewardshipLevel`), all slots build at once;
 *   loyalty     the §31.7 monthly delta: tax, victories this month (max +6), a feast, the ruler's
 *               absence over `absenceDays`, famine, a raid since the last pass, the ruler's culture
 *               and faith against the holding's, the Renown tier bonus, too few men at home (below
 *               `neededGarrison`), the ruler holding court there (tunables `loyalty.residence`), and a
 *               drift of 1 toward 50;
 *   garrison    the men at home: the garrison, the men of the house's fleets docked in the harbour (men
 *               mustered onto a fleet, a fleet back from sea) and the wounded healing there, never men
 *               at sea; the recommended minimum ceil(pop × garrisonMinPopShare) (§10.3, a warning), and the
 *               loyalty term below tunables `garrison.penaltyShareOfRecommended` of it; lowering a garrison sends
 *               men home to the pool (raising one is a muster or a transfer, owned by military).
 *
 * Income is the economy module's rule (`settlementTax`): the screen calls it with `withTax`.
 */
import type { Content } from '@content/index';
import { TAX_RATE_IDS, type TaxRateId } from '@content/schemas/ids';
import { clamp } from '@sim/core/dmath';
import type { Character, CharId, GameState, Hour, HoldingState, Settlement, SettlementId, UnitTypeId } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import type { HoldingsState, LoyaltyReason, QueueBuildingCommand, SetGarrisonCommand } from './types';

// ---------------------------------------------------------------------------------------------
// Small helpers.

function recNum(rec: Readonly<Record<string, number>> | undefined, key: string): number {
  if (!rec || !Object.hasOwn(rec, key)) return 0;
  const v = rec[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** True if `tax` is one of the design's four tax levels. */
export function isTaxRate(tax: unknown): tax is TaxRateId {
  return typeof tax === 'string' && (TAX_RATE_IDS as readonly string[]).includes(tax);
}

/** A settlement that is a holding of the player's house, else undefined. */
export function playerHolding(state: GameState, settlementId: SettlementId): (Settlement & { holding: HoldingState }) | undefined {
  if (!Object.hasOwn(state.settlements, settlementId)) return undefined;
  const s = state.settlements[settlementId];
  if (!s || !s.holding || s.factionId !== state.player.factionId) return undefined;
  return s as Settlement & { holding: HoldingState };
}

/** Ids of the player's holdings: the capital first, then the faction's other holdings in order. */
export function playerHoldingIds(state: GameState): SettlementId[] {
  const out: SettlementId[] = [];
  const cap = state.player.capitalId;
  if (playerHolding(state, cap)) out.push(cap);
  const faction = state.factions[state.player.factionId];
  for (const id of faction?.holdingIds ?? []) if (!out.includes(id) && playerHolding(state, id)) out.push(id);
  return out;
}

/** Σ of a modifier key over a character's traits and feats. */
function charModifier(content: Content, c: Character, key: string): number {
  let sum = 0;
  for (const t of c.traits) if (Object.hasOwn(content.traits, t)) sum += recNum(content.traits[t]?.modifiers, key);
  for (const f of c.feats) if (Object.hasOwn(content.feats, f)) sum += recNum(content.feats[f]?.modifiers, key);
  return sum;
}

/** A character's Stewardship with trait and feat modifiers (0 without a character). */
export function stewardshipOf(state: GameState, content: Content, charId: CharId | undefined): number {
  if (charId === undefined || !Object.hasOwn(state.characters, charId)) return 0;
  const c = state.characters[charId];
  if (!c) return 0;
  return clamp(recNum(c.skills, 'stewardship') + charModifier(content, c, 'skill.stewardship'), 0, content.balance.character.skillMax);
}

// ---------------------------------------------------------------------------------------------
// Buildings (§10.4).

/** One tier of a building as the holdings rules see it. */
export interface TierInfo {
  tier: number;
  cost: number;
  days: number;
  upkeep: number;
  effects: Record<string, number | string[] | boolean>;
  /** True when the cost and days come from tunables `founding` (the design prices the tier "—"). */
  founding: boolean;
}

/** The building ids the balance defines, in balance order. */
export function buildingIds(content: Content): string[] {
  return Object.keys(content.balance.buildings);
}

/** Highest tier of a building (0 when unknown). */
export function maxTier(content: Content, buildingId: string): number {
  if (!Object.hasOwn(content.balance.buildings, buildingId)) return 0;
  const def = content.balance.buildings[buildingId as keyof Content['balance']['buildings']];
  let max = 0;
  for (const row of def.tiers) max = Math.max(max, row.tier);
  return max;
}

/** A tier of a building: cost, days, upkeep, effects; undefined when it cannot be built. */
export function tierInfo(content: Content, buildingId: string, tier: number): TierInfo | undefined {
  if (!Object.hasOwn(content.balance.buildings, buildingId)) return undefined;
  const def = content.balance.buildings[buildingId as keyof Content['balance']['buildings']];
  const row = def.tiers.find((r) => r.tier === tier);
  if (!row) return undefined;
  const effects = { ...row.effects };
  if (row.cost !== null && row.days > 0) return { tier, cost: row.cost, days: row.days, upkeep: row.upkeep, effects, founding: false };
  const found = content.tunables.holdings.founding;
  if (!Object.hasOwn(found, buildingId)) return undefined;
  const f = found[buildingId];
  if (!f) return undefined;
  return { tier, cost: row.cost ?? f.cost, days: row.days > 0 ? row.days : f.days, upkeep: row.upkeep, effects, founding: true };
}

/** Current tier of a building in a settlement (0 when not built). */
export function currentTier(s: Settlement, buildingId: string): number {
  return Math.max(0, Math.floor(recNum(s.buildings, buildingId)));
}

/** True if a holding has a harbour (coastal, or a sea or river berth in the world index). */
export function hasHarbour(state: GameState, s: Settlement): boolean {
  if (s.coastal) return true;
  const index = (state as GameState & { worldIndex?: { settlements?: Record<string, { portKind?: unknown }> } }).worldIndex;
  const row = index?.settlements && Object.hasOwn(index.settlements, s.id) ? index.settlements[s.id] : undefined;
  return row?.portKind === 'sea' || row?.portKind === 'river';
}

/** Build slots of a holding (§10.3: one; two with a Stewardship-8 governor). */
export function buildSlots(state: GameState, content: Content, s: Settlement): number {
  const h = content.balance.holdings;
  const steward = stewardshipOf(state, content, s.holding?.governorId);
  return steward >= h.highStewardshipLevel ? h.buildSlotsHighStewardship : h.buildSlots;
}

/** Why a building cannot be queued (the first one is the command's error code). */
export type BuildIssue = 'notYourHolding' | 'unknownBuilding' | 'maxTier' | 'alreadyBuilding' | 'queueFull' | 'needsHarbour' | 'treasury';

/** Everything the screen shows about one building of a holding. */
export interface BuildingOption {
  buildingId: string;
  tier: number;
  maxTier: number;
  /** The current tier's row (undefined at tier 0). */
  now?: TierInfo;
  /** The next tier (undefined at the top tier). */
  next?: TierInfo;
  /** Monthly upkeep the next tier adds. */
  upkeepDelta: number;
  /** Projected completion hour if queued now. */
  doneHour?: Hour;
  /** The queue entry building this building, if any. */
  building?: { tier: number; doneHour: Hour; startHour: Hour; progress: number; daysLeft: number };
  issues: BuildIssue[];
  ok: boolean;
}

/** Start hour of a queue entry (its completion minus the tier's build days). */
export function queueStartHour(content: Content, entry: { buildingId: string; tier: number; doneHour: Hour }): Hour {
  const info = tierInfo(content, entry.buildingId, entry.tier);
  return entry.doneHour - (info?.days ?? 0) * HOURS_PER_DAY;
}

/** Progress of a queue entry at `hour`: fraction done (0–1) and whole days left. */
export function queueProgress(content: Content, entry: { buildingId: string; tier: number; doneHour: Hour }, hour: Hour): { startHour: Hour; progress: number; daysLeft: number } {
  const startHour = queueStartHour(content, entry);
  const span = entry.doneHour - startHour;
  const progress = span > 0 ? clamp((hour - startHour) / span, 0, 1) : 1;
  const daysLeft = Math.max(0, Math.ceil((entry.doneHour - hour) / HOURS_PER_DAY));
  return { startHour, progress, daysLeft };
}

/** One building of a holding with its next tier and every rule that blocks it. Pure. */
export function buildingOption(state: GameState, content: Content, holdingId: SettlementId, buildingId: string): BuildingOption {
  const s = playerHolding(state, holdingId);
  const issues: BuildIssue[] = [];
  const known = Object.hasOwn(content.balance.buildings, buildingId);
  const top = maxTier(content, buildingId);
  const tier = s ? currentTier(s, buildingId) : 0;
  if (!s) issues.push('notYourHolding');
  if (!known) issues.push('unknownBuilding');
  const nowInfo = tier > 0 ? tierInfo(content, buildingId, tier) : undefined;
  const next = known && tier < top ? tierInfo(content, buildingId, tier + 1) : undefined;
  if (known && !next) issues.push('maxTier');
  const queue = s?.holding.buildQueue ?? [];
  const entry = queue.find((q) => q.buildingId === buildingId);
  if (entry) issues.push('alreadyBuilding');
  else if (s && queue.length >= buildSlots(state, content, s)) issues.push('queueFull');
  if (s && known && content.tunables.holdings.harbourBuildings.includes(buildingId) && !hasHarbour(state, s)) issues.push('needsHarbour');
  const treasury = state.factions[state.player.factionId]?.treasury ?? 0;
  if (next && next.cost > treasury) issues.push('treasury');
  const option: BuildingOption = {
    buildingId,
    tier,
    maxTier: top,
    upkeepDelta: next ? next.upkeep - (nowInfo?.upkeep ?? 0) : 0,
    issues,
    ok: issues.length === 0,
  };
  if (nowInfo) option.now = nowInfo;
  if (next) {
    option.next = next;
    option.doneHour = state.time.hour + next.days * HOURS_PER_DAY;
  }
  if (entry) option.building = { tier: entry.tier, doneHour: entry.doneHour, ...queueProgress(content, entry, state.time.hour) };
  return option;
}

/** Every building of a holding (balance order). */
export function buildingOptions(state: GameState, content: Content, holdingId: SettlementId): BuildingOption[] {
  return buildingIds(content).map((id) => buildingOption(state, content, holdingId, id));
}

/** Preview of a `queueBuilding` command (the handler enforces exactly these rules). */
export function queuePreview(state: GameState, content: Content, cmd: QueueBuildingCommand): BuildingOption {
  return buildingOption(state, content, cmd.holdingId, cmd.buildingId);
}

/** Monthly building upkeep of a holding (§10.4; the economy ledger charges it). */
export function holdingUpkeep(content: Content, s: Settlement): number {
  let sum = 0;
  for (const id of Object.keys(s.buildings)) {
    const tier = currentTier(s, id);
    if (tier <= 0 || !Object.hasOwn(content.balance.buildings, id)) continue;
    const row = content.balance.buildings[id as keyof Content['balance']['buildings']].tiers.find((r) => r.tier === tier);
    sum += row?.upkeep ?? 0;
  }
  return sum;
}

/** Earliest completion hour of any build queue in the world (undefined when every queue is empty). */
export function earliestDone(state: GameState): Hour | undefined {
  let best: Hour | undefined;
  for (const id of playerHoldingIds(state)) {
    for (const q of state.settlements[id]?.holding?.buildQueue ?? []) if (best === undefined || q.doneHour < best) best = q.doneHour;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Garrison.

/** Men under arms in a settlement's garrison. */
export function garrisonMen(s: Settlement): number {
  let n = 0;
  for (const unit of Object.keys(s.garrison)) n += Math.max(0, recNum(s.garrison, unit));
  return n;
}

/** Recommended minimum garrison (§10.3: 5 % of the people). */
export function recommendedGarrison(content: Content, s: Settlement): number {
  return Math.ceil(Math.max(0, s.pop) * content.balance.holdings.garrisonMinPopShare);
}

/** Men at home below which the §31.7 low-garrison term applies (a share of the recommended minimum). */
export function neededGarrison(content: Content, s: Settlement): number {
  return Math.ceil(Math.max(0, s.pop) * content.balance.holdings.garrisonMinPopShare * content.tunables.holdings.garrison.penaltyShareOfRecommended);
}

/** The men under arms at home in a holding, by where they stand. */
export interface MenAtHome {
  /** The settlement's garrison. */
  garrison: number;
  /** Men of the owner's fleets docked in the harbour (the hird mustered onto ships, a fleet back from sea). */
  hird: number;
  /** Wounded healing in the settlement or aboard those fleets. */
  wounded: number;
  total: number;
}

function woundedCount(host: unknown): number {
  const batches = (host as { woundedMen?: unknown }).woundedMen;
  if (!Array.isArray(batches)) return 0;
  let n = 0;
  for (const b of batches) {
    const c = (b as { count?: unknown } | null)?.count;
    if (typeof c === 'number' && Number.isFinite(c)) n += Math.max(0, c);
  }
  return n;
}

/**
 * The men at home in a holding: its garrison, the men of its owner's fleets docked within military's
 * `dockRadius` of it, and the wounded healing there. Each man is in exactly one container (military's
 * rule), so nothing is counted twice; men at sea, beached or landed elsewhere are not at home. Pure.
 */
export function menAtHome(state: GameState, content: Content, s: Settlement): MenAtHome {
  const garrison = garrisonMen(s);
  let hird = 0;
  let wounded = woundedCount(s);
  const radius = content.tunables.military.dockRadius;
  for (const id of Object.keys(state.fleets)) {
    const f = state.fleets[id as keyof GameState['fleets']];
    if (!f || f.ownerId !== s.factionId || f.mode !== 'docked') continue;
    const dx = f.pos.x - s.mapPos.x;
    const dy = f.pos.y - s.mapPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > radius) continue;
    for (const unit of Object.keys(f.men)) hird += Math.max(0, recNum(f.men, unit));
    wounded += woundedCount(f);
  }
  return { garrison, hird, wounded, total: garrison + hird + wounded };
}

/** Why a garrison change is refused (the first one is the command's error code). */
export type GarrisonIssue = 'notYourHolding' | 'badCount' | 'raiseThroughMuster' | 'nothingToChange';

/** Preview of a `setGarrison` command. */
export interface GarrisonPreview {
  /** Men of each unit type sent home. */
  release: Record<UnitTypeId, number>;
  released: number;
  /** Garrison after the change. */
  after: number;
  /** Men at home after the change (garrison, docked fleets, wounded). */
  atHomeAfter: number;
  recommended: number;
  needed: number;
  belowRecommended: boolean;
  /** True when the change takes the men at home below the loyalty threshold. */
  belowNeeded: boolean;
  issues: GarrisonIssue[];
  ok: boolean;
}

/** Pure preview of a `setGarrison` command for the player's holding. */
export function garrisonPreview(state: GameState, content: Content, cmd: SetGarrisonCommand): GarrisonPreview {
  const s = playerHolding(state, cmd.holdingId);
  const issues: GarrisonIssue[] = [];
  const release: Record<UnitTypeId, number> = {};
  let released = 0;
  if (!s) issues.push('notYourHolding');
  for (const unit of Object.keys(cmd.units ?? {})) {
    const want = recNum(cmd.units, unit);
    const raw = Object.hasOwn(cmd.units, unit) ? cmd.units[unit] : undefined;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
      if (!issues.includes('badCount')) issues.push('badCount');
      continue;
    }
    const have = s ? Math.max(0, Math.floor(recNum(s.garrison, unit))) : 0;
    if (want > have) {
      if (!issues.includes('raiseThroughMuster')) issues.push('raiseThroughMuster');
      continue;
    }
    if (want < have) {
      release[unit] = have - want;
      released += have - want;
    }
  }
  if (released === 0 && issues.length === 0) issues.push('nothingToChange');
  const before = s ? garrisonMen(s) : 0;
  const recommended = s ? recommendedGarrison(content, s) : 0;
  const after = before - released;
  const atHomeAfter = (s ? menAtHome(state, content, s).total : 0) - released;
  const needed = s ? neededGarrison(content, s) : 0;
  return {
    release,
    released,
    after,
    atHomeAfter,
    recommended,
    needed,
    belowRecommended: atHomeAfter < recommended,
    belowNeeded: atHomeAfter < needed,
    issues,
    ok: issues.length === 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Loyalty (§10.5, §31.7).

/** Index of the house's Renown tier (balance `renown.tiers`, ascending). */
export function renownTierIndex(content: Content, renown: number): number {
  let idx = 0;
  content.balance.renown.tiers.forEach((t, i) => {
    if (renown >= t.min) idx = i;
  });
  return idx;
}

/** Battles won by the player's house this month (military's tally, read defensively). */
export function victoriesThisMonth(state: GameState): number {
  const m = (state as GameState & { military?: { monthBattles?: { won?: unknown } } }).military;
  const won = m?.monthBattles?.won;
  return typeof won === 'number' && Number.isFinite(won) ? Math.max(0, Math.floor(won)) : 0;
}

/** Days the ruler has been away from the house's holdings (0 at home). */
export function daysAway(state: GameState): number {
  const since = state.holdingsState?.awaySinceHour;
  if (since === undefined) return 0;
  return Math.max(0, Math.floor((state.time.hour - since) / HOURS_PER_DAY));
}

/** True if the ruler is in one of the house's holdings. */
export function rulerAtHome(state: GameState): boolean {
  const ruler = state.characters[state.player.rulerId];
  if (!ruler || !ruler.alive) return false;
  const loc = ruler.location;
  return loc.kind === 'settlement' && playerHolding(state, loc.id) !== undefined;
}

/** Options of the loyalty forecast. */
export interface LoyaltyOptions {
  /** Forecast as if the holding had this tax level. */
  tax?: TaxRateId;
  /** The slice to read (default `state.holdingsState`). */
  slice?: HoldingsState;
}

/** The §31.7 terms of a holding's monthly loyalty change (non-zero terms only, drift last). Pure. */
export function loyaltyReasons(state: GameState, content: Content, holdingId: SettlementId, opts: LoyaltyOptions = {}): LoyaltyReason[] {
  const s = playerHolding(state, holdingId);
  if (!s) return [];
  const L = content.balance.loyalty;
  const slice = opts.slice ?? state.holdingsState;
  const since = slice?.lastMonthlyHour ?? state.time.hour;
  const out: LoyaltyReason[] = [];
  const push = (r: LoyaltyReason) => {
    if (r.amount !== 0) out.push(r);
  };
  const tax = opts.tax ?? s.holding.tax;
  push({ id: 'tax', amount: isTaxRate(tax) ? L.tax[tax] : 0, vars: { tax } });
  const won = victoriesThisMonth(state);
  push({ id: 'victories', amount: Math.min(L.victoryMaxPerMonth, won * L.victory), vars: { count: won } });
  if (slice?.feastHour !== undefined && slice.feastHour > since) push({ id: 'feast', amount: L.feast });
  const away = daysAway(state);
  if (away > content.balance.holdings.absenceDays) push({ id: 'absence', amount: L.absence, vars: { days: away } });
  if (s.holding.foodMonths <= 0) push({ id: 'famine', amount: L.famine });
  const raided = (s as Settlement & { raidedHour?: unknown }).raidedHour;
  if (typeof raided === 'number' && raided > since) push({ id: 'raided', amount: L.raided });
  const ruler = state.characters[state.player.rulerId];
  if (ruler && ruler.culture !== s.culture) push({ id: 'rulerCulture', amount: L.rulerCultureMismatch, vars: { culture: s.culture } });
  if (ruler && ruler.faith !== s.faith) push({ id: 'rulerFaith', amount: L.rulerFaithMismatch, vars: { faith: s.faith } });
  const tierIdx = renownTierIndex(content, state.player.house.renown);
  const bonus = L.renownTierBonus[Math.min(tierIdx, L.renownTierBonus.length - 1)] ?? 0;
  push({ id: 'renown', amount: bonus, vars: { tier: content.balance.renown.tiers[tierIdx]?.id ?? '' } });
  const men = menAtHome(state, content, s).total;
  const min = neededGarrison(content, s);
  if (men < min) push({ id: 'lowGarrison', amount: L.lowGarrison, vars: { men, min } });
  if (ruler?.alive && ruler.location.kind === 'settlement' && ruler.location.id === s.id) push({ id: 'residence', amount: content.tunables.holdings.loyalty.residence });
  const loyalty = s.holding.loyalty;
  const drift = loyalty < L.driftTarget ? Math.min(L.drift, L.driftTarget - loyalty) : loyalty > L.driftTarget ? -Math.min(L.drift, loyalty - L.driftTarget) : 0;
  push({ id: 'drift', amount: drift, vars: { target: L.driftTarget } });
  return out;
}

/** Next month's loyalty change of a holding: its reasons, the sum and the resulting loyalty. Pure. */
export function loyaltyForecast(
  state: GameState,
  content: Content,
  holdingId: SettlementId,
  opts: LoyaltyOptions = {},
): { reasons: LoyaltyReason[]; delta: number; from: number; to: number } {
  const s = playerHolding(state, holdingId);
  const reasons = loyaltyReasons(state, content, holdingId, opts);
  const delta = reasons.reduce((sum, r) => sum + r.amount, 0);
  const from = s?.holding.loyalty ?? 0;
  const { min, max } = content.balance.loyalty;
  return { reasons, delta, from, to: clamp(from + delta, min, max) };
}

/** The loyalty band of a holding: 'unrest' below revoltBelow, 'loyal' at highAt or above. */
export function loyaltyBand(content: Content, loyalty: number): 'unrest' | 'uneasy' | 'content' | 'loyal' {
  const L = content.balance.loyalty;
  if (loyalty < L.revoltBelow) return 'unrest';
  if (loyalty >= L.highAt) return 'loyal';
  return loyalty < L.driftTarget ? 'uneasy' : 'content';
}

/**
 * The settlement with a different tax level (for previews through the economy module's
 * `settlementTax(state, content, withTax(s, tax))`). Pure; returns a new object.
 */
export function withTax(s: Settlement, tax: TaxRateId): Settlement {
  if (!s.holding) return s;
  return { ...s, holding: { ...s.holding, tax } };
}
