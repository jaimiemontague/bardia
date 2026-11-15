/**
 * Faith politics (design §17.7): chapels, conversion of the player's house to the Lantern, and the
 * slow conversion of its holdings.
 *
 * Requirements: a chapel (the Missionary "Welcome" choice builds the first through `buildChapel`)
 * and Lantern opinion ≥ 20 (the mean opinion of the house with every Lantern faction).
 * Gains: the house, its ruler (and kin) and its faction adopt the Lantern; opinion +20 with every
 * Lantern faction; Faith Wrath resets. Costs: Favor and omens are replaced by Piety (priests read
 * signs); every traditionalist holding takes loyalty −20 once, and its resentment (kept in
 * `state.faith.conversion.resentment` for the holdings module) fades over 5 years. Each holding's
 * folk convert at 5 % a year (× chapelShareMult with a chapel there) and its faith flips at
 * `flipShare`. Berserkers and traditionalist Allthing support are other modules' rules: they read
 * `house.faith` / `house.convertedHour` or react to HouseConverted.
 */
import type { Tunables } from '@content/schemas/tunables/faith';
import { getRelation } from '@sim/core/factory';
import type { SimContext } from '@sim/core/module';
import type { CharId, FaithId, GameState, SettlementId } from '@sim/core/state';
import { MONTHS_PER_YEAR } from '@sim/core/time';
import { applyDeed } from './favor';
import { ensureFaithState, isLanternFaith, lanternFactionIds, playerHoldingIds } from './state';
import { changeFaithWrath } from './wrath';

/** Opinion-modifier reason for the conversion's Lantern diplomacy bonus. */
export const CONVERSION_REASON = 'faith.conversion';

/** Mean opinion of the player's faction with every Lantern faction (0 when there are none). */
export function lanternOpinion(state: GameState, t: Tunables): number {
  const ids = lanternFactionIds(state, t);
  if (ids.length === 0) return 0;
  let sum = 0;
  for (const id of ids) sum += getRelation(state, state.player.factionId, id)?.opinion ?? 0;
  return sum / ids.length;
}

/** True if the player's house has at least one chapel standing in a settlement it still holds. */
export function hasChapel(state: GameState): boolean {
  const chapels = state.player.house.chapels;
  if (!chapels) return false;
  return chapels.some((id) => state.settlements[id]?.factionId === state.player.factionId);
}

/** Why the house cannot convert now (empty = it can). Codes match the convertHouse CommandErrors. */
export function conversionBlockers(state: GameState, t: Tunables): string[] {
  const out: string[] = [];
  if (isLanternFaith(t, state.player.house.faith)) out.push('alreadyConverted');
  if (!hasChapel(state)) out.push('noChapel');
  if (lanternOpinion(state, t) < t.conversion.minLanternOpinion) out.push('lanternOpinionTooLow');
  return out;
}

/**
 * Adds a chapel to a player holding (idempotent). Emits ChapelBuilt; a Lantern house earns the
 * `chapelBuilt` deed (Piety). Returns false if the settlement is not a player holding or already has one.
 */
export function addChapel(draft: GameState, ctx: SimContext, settlementId: SettlementId): boolean {
  const s = draft.settlements[settlementId];
  if (!s || s.factionId !== draft.player.factionId) return false;
  const house = draft.player.house;
  house.chapels ??= [];
  if (house.chapels.includes(settlementId)) return false;
  house.chapels.push(settlementId);
  ctx.emit({ type: 'ChapelBuilt', settlementId });
  ctx.notify('faith.chapel.built', { priority: 'normal', vars: { settlement: s.name }, link: { kind: 'settlement', id: settlementId } });
  if (isLanternFaith(ctx.tunables.faith, house.faith)) applyDeed(draft, ctx, draft.player.factionId, 'chapelBuilt');
  return true;
}

/** The ruler and (with `convertKin`) the ruler's living spouses and children in the player's faction. */
function convertingCharacters(state: GameState, t: Tunables): CharId[] {
  const ruler = state.characters[state.player.rulerId];
  if (!ruler) return [];
  const out: CharId[] = [ruler.id];
  if (!t.conversion.convertKin) return out;
  for (const id of [...ruler.family.spouseIds, ...ruler.family.childIds]) {
    const c = state.characters[id];
    if (c && c.alive && c.factionId === state.player.factionId && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Converts the player's house (requirements are checked by the command). Writes the `faith` field of
 * the house, the faction, the ruler and kin; applies the §17.7 gains and costs; emits HouseConverted.
 */
export function convertPlayerHouse(draft: GameState, ctx: SimContext): void {
  const t = ctx.tunables.faith;
  const target: FaithId = t.conversion.targetFaith;
  const house = draft.player.house;
  const fromFaith = house.faith;
  const factionId = draft.player.factionId;
  const fs = ensureFaithState(draft);

  house.faith = target;
  house.convertedHour = draft.time.hour;
  const faction = draft.factions[factionId];
  if (faction) faction.faith = target;
  for (const id of convertingCharacters(draft, t)) {
    const c = draft.characters[id];
    if (c) c.faith = target;
  }

  // Favor and omens are replaced by Piety; priests read signs from now on.
  house.omens = {};
  if (house.piety === undefined || house.piety < t.piety.startOnConversion) {
    const before = house.piety ?? ctx.balance.standing.piety.start;
    house.piety = Math.min(ctx.balance.standing.piety.max, Math.max(before, t.piety.startOnConversion));
    if (house.piety !== before) ctx.emit({ type: 'StandingChanged', stat: 'piety', delta: house.piety - before, value: house.piety });
  }

  // Faith Wrath resets.
  if (house.faithWrath !== 0) changeFaithWrath(draft, ctx, -house.faithWrath);

  // Lantern diplomacy.
  for (const id of lanternFactionIds(draft, t)) {
    ctx.applyEffects([{ op: 'changeOpinion', a: factionId, b: id, amount: t.conversion.lanternDiplomacy, reason: CONVERSION_REASON, decayPerMonth: 0 }]);
  }

  // Traditionalist holdings resent it; every holding starts converting.
  const conversion = { hour: draft.time.hour, fromFaith, shares: {} as Record<SettlementId, number>, resentment: {} as Record<SettlementId, number> };
  for (const id of playerHoldingIds(draft)) {
    const s = draft.settlements[id];
    if (!s || isLanternFaith(t, s.faith)) continue;
    conversion.shares[id] = 0;
    if (t.conversion.traditionalistLoyalty !== 0) {
      ctx.applyEffects([{ op: 'changeLoyalty', settlementId: id, amount: t.conversion.traditionalistLoyalty }]);
      conversion.resentment[id] = Math.abs(t.conversion.traditionalistLoyalty);
    }
  }
  fs.conversion = conversion;

  ctx.emit({ type: 'HouseConverted', factionId, fromFaith, faith: target });
  ctx.notify('faith.conversion.done', { priority: 'high', vars: { faith: target } });
  ctx.chronicle({ kind: 'conversion', textKey: 'faith.chronicle.conversion', importance: 4, vars: { faith: target } });
}

/**
 * Monthly progress of a converted house's holdings: shares grow by holdingSharePerYear / 12
 * (× chapelShareMult with a chapel there); a holding whose share reaches flipShare adopts the
 * house's faith (HoldingConverted). Resentment fades linearly over resentmentYears.
 */
export function progressHoldingConversion(draft: GameState, ctx: SimContext): void {
  const fs = draft.faith;
  const conv = fs?.conversion;
  if (!conv) return;
  const t = ctx.tunables.faith;
  const house = draft.player.house;
  const chapels = house.chapels ?? [];
  const perMonth = t.conversion.holdingSharePerYear / MONTHS_PER_YEAR;
  for (const id of Object.keys(conv.shares) as SettlementId[]) {
    const s = draft.settlements[id];
    if (!s || s.factionId !== draft.player.factionId) {
      delete conv.shares[id];
      continue;
    }
    if (isLanternFaith(t, s.faith)) {
      delete conv.shares[id];
      continue;
    }
    const rate = perMonth * (chapels.includes(id) ? t.conversion.chapelShareMult : 1);
    const share = Math.min(1, (conv.shares[id] ?? 0) + rate);
    if (share >= t.conversion.flipShare - 1e-9) {
      const fromFaith = s.faith;
      s.faith = house.faith;
      delete conv.shares[id];
      delete conv.resentment[id];
      ctx.emit({ type: 'HoldingConverted', settlementId: id, fromFaith, faith: house.faith });
      ctx.notify('faith.conversion.holding', { priority: 'normal', vars: { settlement: s.name }, link: { kind: 'settlement', id } });
    } else {
      conv.shares[id] = share;
    }
  }
  const fade = Math.abs(t.conversion.traditionalistLoyalty) / (t.conversion.resentmentYears * MONTHS_PER_YEAR);
  for (const id of Object.keys(conv.resentment) as SettlementId[]) {
    const left = (conv.resentment[id] ?? 0) - fade;
    if (left <= 1e-9) delete conv.resentment[id];
    else conv.resentment[id] = left;
  }
}
