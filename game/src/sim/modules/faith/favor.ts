/**
 * Favor and Piety rules (design §4.4, §22.6). The player's Favor numbers change through the core
 * `changeFavor` effect (clamping + StandingChanged); an Old Ways AI faction's Favor lives on
 * `faction.favor` and is clamped here with the same balance range. Piety is the converted house's
 * single meter (balance `standing.piety`).
 *
 * Gains come from deeds (tunables `deeds`, applied by reactions and by the `faithDeed` effect),
 * offerings at a grove (diminishing returns per god per month, grove tier multiplier) and alms.
 * Neglect pulls every untended god's Favor one step toward 0 each month.
 */
import type { Content } from '@content/index';
import type { Balance } from '@content/schemas/balance';
import { GOD_IDS } from '@content/schemas/ids';
import type { DeedDef, OfferingKind, OfferingSize, Tunables } from '@content/schemas/tunables/faith';
import { clamp } from '@sim/core/dmath';
import type { SimContext } from '@sim/core/module';
import type { FactionId, GameState, GodId, Settlement } from '@sim/core/state';
import {
  bumpMonthCount,
  ensureFaithState,
  faithOf,
  favorOf,
  gainMultiplier,
  isLanternFaith,
  monthCount,
  monthOf,
  OLD_WAYS,
} from './state';
import type { DeedOutcome } from './types';

/** Rounds half away from zero (so −2.5 → −3 like +2.5 → +3). */
export function roundAway(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/** The diminishing-returns multiplier of the n-th (1-based) offering; the last entry repeats. */
export function diminishingMult(table: readonly number[], nth: number): number {
  const i = Math.max(0, Math.min(table.length - 1, nth - 1));
  return table[i] ?? 0;
}

/** Favor multiplier of a grove tier (balance `buildings.grove` effects.favorGainMult; 1 below tier 1). */
export function groveMultiplier(balance: Balance, tier: number): number {
  let mult = 1;
  for (const row of balance.buildings.grove.tiers) {
    if (row.tier <= tier) {
      const m = row.effects['favorGainMult'];
      if (typeof m === 'number') mult = m;
    }
  }
  return mult;
}

/** The grove tier a settlement offers: its grove building, or a temple-stead's implied grove. */
export function groveTierOf(t: Tunables, settlement: Settlement): number {
  const built = Object.hasOwn(settlement.buildings, 'grove') ? (settlement.buildings['grove'] ?? 0) : 0;
  if (settlement.tier === 'templeStead' && settlement.faith === OLD_WAYS) return Math.max(built, t.sacrifice.templeSteadGroveTier);
  return built;
}

/**
 * Favor from one grove offering (§22.6: +2 to +8 to one god, diminishing per month):
 * lerp(sacrifice) × kindMult × diminishing[nth] × groveMult × gainMult, rounded.
 */
export function sacrificeGain(
  balance: Balance,
  t: Tunables,
  size: OfferingSize,
  kind: OfferingKind,
  nth: number,
  groveMult: number,
  gainMult: number,
): number {
  const [lo, hi] = balance.standing.favor.sacrifice;
  const raw = lo + (hi - lo) * t.sacrifice.sizes[size].rangePos;
  return roundAway(raw * t.sacrifice.kindMult[kind] * diminishingMult(t.sacrifice.diminishing, nth) * groveMult * gainMult);
}

/** Piety from alms: size × diminishing[nth] × gainMult, rounded. */
export function almsGain(t: Tunables, size: OfferingSize, nth: number, gainMult: number): number {
  return roundAway(t.alms.sizes[size].piety * diminishingMult(t.alms.diminishing, nth) * gainMult);
}

/** Records that a god's Favor rose this month for a faction (it is spared next month's neglect). */
export function markTended(draft: GameState, factionId: FactionId, god: GodId, month: number): void {
  const fs = ensureFaithState(draft);
  let rec = Object.hasOwn(fs.tended, factionId) ? fs.tended[factionId] : undefined;
  if (!rec) {
    rec = {};
    fs.tended[factionId] = rec;
  }
  rec[god] = month;
}

/**
 * Changes one god's Favor for a faction and returns the change actually applied (after clamping).
 * The player goes through the core `changeFavor` effect; AI factions are clamped here. Gains mark
 * the god as tended when `tend` is set (offerings and deeds — not neglect).
 */
export function changeFactionFavor(draft: GameState, ctx: SimContext, factionId: FactionId, god: GodId, amount: number, tend: boolean): number {
  if (amount === 0) return 0;
  let applied = 0;
  if (factionId === draft.player.factionId) {
    const before = draft.player.house.favor[god];
    ctx.applyEffects([{ op: 'changeFavor', god, amount }]);
    applied = draft.player.house.favor[god] - before;
  } else {
    const faction = draft.factions[factionId];
    if (!faction || !faction.favor) return 0;
    const b = ctx.balance.standing.favor;
    const before = faction.favor[god];
    const after = clamp(before + amount, b.min, b.max);
    faction.favor[god] = after;
    applied = after - before;
  }
  if (tend && applied > 0) markTended(draft, factionId, god, monthOf(draft.time.hour));
  return applied;
}

/**
 * Changes the player's Piety (clamped to balance `standing.piety`), emits StandingChanged and
 * returns the change applied. Gains mark the month as tended when `tend` is set.
 */
export function changePlayerPiety(draft: GameState, ctx: SimContext, amount: number, tend: boolean): number {
  if (amount === 0) return 0;
  const b = ctx.balance.standing.piety;
  const house = draft.player.house;
  const before = house.piety ?? b.start;
  const after = clamp(before + amount, b.min, b.max);
  house.piety = after;
  const applied = after - before;
  if (applied !== 0) ctx.emit({ type: 'StandingChanged', stat: 'piety', delta: applied, value: after });
  if (tend && applied > 0) ensureFaithState(draft).pietyTendedMonth = monthOf(draft.time.hour);
  return applied;
}

/** The gods a deed touches: an explicit override, the deed's `gods`, or gods.json `favorRises`. */
export function deedGods(content: Content, deedKey: string, def: DeedDef, override?: GodId): GodId[] {
  if (override !== undefined) return [override];
  if (def.gods === 'all') return [...GOD_IDS];
  if (def.gods) return [...def.gods];
  const out: GodId[] = [];
  for (const god of GOD_IDS) if (content.gods[god].favorRises.includes(deedKey)) out.push(god);
  return out;
}

/** The deed's base Favor amount (its `amount`, or the named balance key). */
export function deedFavorAmount(balance: Balance, def: DeedDef): number {
  if (def.amount !== undefined) return def.amount;
  if (def.balanceKey !== undefined) return balance.standing.favor[def.balanceKey];
  return 0;
}

/** Options of a deed application. */
export interface DeedOptions {
  /** Explicit god (a relic's god). */
  god?: GodId;
  /** Multiplier on the deed's amounts (storm severity …). Default 1. */
  scale?: number;
}

/**
 * Applies a deed to a faction's house: Favor for the Old Ways (the player, or an AI faction with a
 * Favor record), Piety for a Lantern player house. Respects `maxPerMonth`. Returns the outcome, or
 * undefined when the deed is unknown, over its monthly limit or changes nothing (a deed that moves
 * nothing because Favor/Piety is already at its bound does not count against `maxPerMonth`). For the player's house it emits
 * FaithDeed and (unless the deed opts out) a low-priority notification `faith.deed.<key>`.
 */
export function applyDeed(draft: GameState, ctx: SimContext, factionId: FactionId, deedKey: string, opts: DeedOptions = {}): DeedOutcome | undefined {
  const t = ctx.tunables.faith;
  const def = Object.hasOwn(t.deeds, deedKey) ? t.deeds[deedKey] : undefined;
  if (!def) return undefined;
  const isPlayer = factionId === draft.player.factionId;
  const faith = faithOf(draft, factionId);
  if (!isPlayer && faith === OLD_WAYS) ensureFactionFavor(draft, ctx, factionId);
  const oldWays = faith === OLD_WAYS && favorOf(draft, factionId) !== undefined;
  const lantern = isPlayer && isLanternFaith(t, faith);
  if (!oldWays && !lantern) return undefined;
  const fs = ensureFaithState(draft);
  const month = monthOf(draft.time.hour);
  if (def.maxPerMonth !== undefined && monthCount(fs.deeds, factionId, deedKey, month) >= def.maxPerMonth) return undefined;
  const scale = opts.scale ?? 1;
  const outcome: DeedOutcome = { favor: {}, piety: 0 };
  let changed = false;
  if (oldWays) {
    let amount = deedFavorAmount(ctx.balance, def) * scale;
    if (amount > 0) amount *= gainMultiplier(draft, ctx.content, factionId, 'favor.gainPct');
    const rounded = roundAway(amount);
    if (rounded !== 0) {
      for (const god of deedGods(ctx.content, deedKey, def, opts.god)) {
        const applied = changeFactionFavor(draft, ctx, factionId, god, rounded, true);
        outcome.favor[god] = applied;
        if (applied !== 0) changed = true;
      }
    }
  } else if (def.piety !== undefined) {
    let amount = def.piety * scale;
    if (amount > 0) amount *= gainMultiplier(draft, ctx.content, factionId, 'piety.gainPct');
    const rounded = roundAway(amount);
    if (rounded !== 0) {
      outcome.piety = changePlayerPiety(draft, ctx, rounded, true);
      changed = outcome.piety !== 0;
    }
  }
  if (!changed) return undefined;
  bumpMonthCount(fs.deeds, factionId, deedKey, month);
  if (!isPlayer) return outcome; // AI Favor is read from state; no event noise for the world's deeds
  ctx.emit({ type: 'FaithDeed', factionId, deed: deedKey, favor: { ...outcome.favor }, piety: outcome.piety });
  if (def.notify !== false) {
    const vars: Record<string, string | number> = { piety: outcome.piety };
    const gods = Object.keys(outcome.favor) as GodId[];
    vars['god'] = gods[0] ?? '';
    vars['amount'] = gods.length > 0 ? (outcome.favor[gods[0] as GodId] ?? 0) : outcome.piety;
    vars['signs'] = lantern ? 'lantern' : 'oldways';
    ctx.notify(`faith.deed.${deedKey}`, { priority: 'low', vars });
  }
  return outcome;
}

/**
 * Monthly neglect (§22.6: −1 per month toward 0) for a faction's gods. With
 * `favor.neglectOnlyIfUntended`, a god whose Favor rose in the previous month (or this one) is spared.
 */
export function neglectFavor(draft: GameState, ctx: SimContext, factionId: FactionId, month: number): void {
  const t = ctx.tunables.faith;
  const step = ctx.balance.standing.favor.neglectPerMonth;
  if (step <= 0) return;
  const favor = favorOf(draft, factionId);
  if (!favor) return;
  const fs = ensureFaithState(draft);
  const tended = Object.hasOwn(fs.tended, factionId) ? fs.tended[factionId] : undefined;
  for (const god of GOD_IDS) {
    const v = favor[god];
    if (v === 0 || v === undefined) continue;
    const last = tended && Object.hasOwn(tended, god) ? tended[god] : undefined;
    if (t.favor.neglectOnlyIfUntended && last !== undefined && last >= month - 1) continue;
    const delta = v > 0 ? -Math.min(step, v) : Math.min(step, -v);
    changeFactionFavor(draft, ctx, factionId, god, delta, false);
  }
}

/** Monthly Piety neglect for the player's Lantern house (no alms and no pious deed last month). */
export function neglectPiety(draft: GameState, ctx: SimContext, month: number): void {
  const step = ctx.tunables.faith.piety.neglectPerMonth;
  if (step <= 0) return;
  const piety = draft.player.house.piety;
  if (piety === undefined || piety <= ctx.balance.standing.piety.min) return;
  const last = ensureFaithState(draft).pietyTendedMonth;
  if (last !== undefined && last >= month - 1) return;
  changePlayerPiety(draft, ctx, -Math.min(step, piety - ctx.balance.standing.piety.min), false);
}

/** The god an AI ruler offers to: the lowest Favor (ties: GOD_IDS order). */
export function aiOfferingGod(favor: Readonly<Record<GodId, number>>): GodId {
  let best: GodId = GOD_IDS[0];
  for (const god of GOD_IDS) if ((favor[god] ?? 0) < (favor[best] ?? 0)) best = god;
  return best;
}

/**
 * Monthly AI offering: with chance offeringChance × personality.piety / 100, an Old Ways AI ruler
 * who can afford it (treasury ≥ cost × minTreasuryMult) makes a silver offering to its least
 * favoured god at its own grove (capital grove tier).
 */
export function aiOffering(draft: GameState, ctx: SimContext, factionId: FactionId): void {
  const t = ctx.tunables.faith;
  const faction = draft.factions[factionId];
  if (!faction || !faction.favor || faction.faith !== OLD_WAYS) return;
  const ruler = draft.characters[faction.rulerId];
  if (!ruler || !ruler.alive) return;
  const piety = ruler.personality?.piety ?? 50;
  const rng = ctx.rng('faith:ai');
  if (!rng.chance(clamp((t.favor.ai.offeringChance * piety) / 100, 0, 1))) return;
  const size = t.favor.ai.offeringSize;
  const cost = t.sacrifice.sizes[size].silver;
  if (faction.treasury < cost * t.favor.ai.minTreasuryMult) return;
  const god = aiOfferingGod(faction.favor);
  const fs = ensureFaithState(draft);
  const month = monthOf(draft.time.hour);
  const nth = monthCount(fs.offerings, factionId, god, month) + 1;
  let groveTier = 0;
  for (const id of faction.holdingIds) {
    const s = draft.settlements[id];
    if (s) groveTier = Math.max(groveTier, groveTierOf(t, s));
  }
  const gain = sacrificeGain(ctx.balance, t, size, 'silver', nth, groveMultiplier(ctx.balance, groveTier), gainMultiplier(draft, ctx.content, factionId, 'favor.gainPct'));
  ctx.applyEffects([{ op: 'addSilver', amount: -cost, factionId }]);
  bumpMonthCount(fs.offerings, factionId, god, month);
  if (gain !== 0) changeFactionFavor(draft, ctx, factionId, god, gain, true);
}

/**
 * Gives an Old Ways AI faction its Favor record if it has none (new games, factions founded
 * mid-campaign, old saves). Returns true if the faction keeps the Old Ways.
 */
export function ensureFactionFavor(draft: GameState, ctx: SimContext, factionId: FactionId): boolean {
  const faction = draft.factions[factionId];
  if (!faction || faction.faith !== OLD_WAYS || factionId === draft.player.factionId) return false;
  if (!faction.favor) faction.favor = initialAiFavor(ctx.balance, ctx.tunables.faith, draft.characters[faction.rulerId]?.personality?.piety);
  return true;
}

/** Starting Favor of an Old Ways AI faction: balance start shifted by the ruler's personality piety. */
export function initialAiFavor(balance: Balance, t: Tunables, personalityPiety: number | undefined): Record<GodId, number> {
  const b = balance.standing.favor;
  const shift = personalityPiety === undefined ? 0 : roundAway((personalityPiety - 50) / t.favor.aiPietyDivisor);
  const v = clamp(b.start + shift, b.min, b.max);
  const out = {} as Record<GodId, number>;
  for (const god of GOD_IDS) out[god] = v;
  return out;
}
