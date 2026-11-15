/**
 * Scheduled faith rules, init/migrate and invariants.
 *
 * monthly: the player's neglect (Favor toward 0, or Piety for a Lantern house), Faith Wrath decay,
 *          AI factions (Favor setup, neglect, offerings, omen readings), holding conversion,
 *          bookkeeping pruning. Runs once per month for ~all factions: O(factions × gods).
 * daily:   expire the player's omens (O(4)).
 */
import { getContent, type Content } from '@content/index';
import { GOD_IDS, OMEN_IDS } from '@content/schemas/ids';
import type { SimContext } from '@sim/core/module';
import type { FactionId, GameState, SettlementId } from '@sim/core/state';
import { progressHoldingConversion } from './conversion';
import { aiOffering, ensureFactionFavor, neglectFavor, neglectPiety } from './favor';
import { factionReadingBasis, rollReadings } from './omens';
import { ensureFaithState, isLanternFaith, monthOf, OLD_WAYS, pruneMonthCounters } from './state';
import type { OmenReadings } from './types';
import { changeFaithWrath, reconcileWrathLevel, wrathLevelOf } from './wrath';

/** Rolls an AI faction's monthly readings (stream 'faith:ai'). */
function readAiOmens(draft: GameState, ctx: SimContext, factionId: FactionId): void {
  const faction = draft.factions[factionId];
  if (!faction) return;
  const ruler = draft.characters[faction.rulerId];
  if (!ruler || !ruler.alive) {
    if (faction.omens) delete faction.omens;
    return;
  }
  const basis = factionReadingBasis(draft, ctx.content, factionId);
  faction.omens = rollReadings(ctx.content, basis, ctx.rng('faith:ai'), draft.time.hour).readings;
}

/** AI factions other than the player's, in insertion order (one ownKeys trap on the draft). */
function aiFactionIds(draft: GameState): FactionId[] {
  const player = draft.player.factionId;
  return (Object.keys(draft.factions) as FactionId[]).filter((id) => id !== player);
}

/** The faith module's `init`: new games and saves made before the module existed. */
export function initFaith(draft: GameState, ctx: SimContext): void {
  const t = ctx.tunables.faith;
  const fs = ensureFaithState(draft);
  const house = draft.player.house;
  house.omens ??= {};
  house.chapels ??= [];
  if (isLanternFaith(t, house.faith) && house.piety === undefined) house.piety = ctx.balance.standing.piety.start;
  fs.wrathLevel = wrathLevelOf(ctx.balance, house.faithWrath);
  for (const id of aiFactionIds(draft)) {
    ensureFactionFavor(draft, ctx, id);
    if (t.omens.aiMonthlyReadings) readAiOmens(draft, ctx, id);
  }
}

/** The faith module's `migrate` (version 1 is the first; keeps the slice complete). */
export function migrateFaith(draft: GameState, _fromVersion: number, ctx: SimContext): void {
  initFaith(draft, ctx);
}

/** Monthly rules (see the file header). */
export function monthlyFaith(draft: GameState, ctx: SimContext): void {
  const t = ctx.tunables.faith;
  const fs = ensureFaithState(draft);
  const month = monthOf(draft.time.hour);
  const house = draft.player.house;
  const player = draft.player.factionId;

  if (house.faith === OLD_WAYS) neglectFavor(draft, ctx, player, month);
  else if (isLanternFaith(t, house.faith)) neglectPiety(draft, ctx, month);

  const decay = ctx.balance.standing.faithWrath.decayPerMonth;
  if (decay > 0 && house.faithWrath > ctx.balance.standing.faithWrath.min) {
    changeFaithWrath(draft, ctx, -Math.min(decay, house.faithWrath - ctx.balance.standing.faithWrath.min));
  } else {
    reconcileWrathLevel(draft, ctx);
  }

  for (const id of aiFactionIds(draft)) {
    if (ensureFactionFavor(draft, ctx, id)) {
      neglectFavor(draft, ctx, id, month);
      aiOffering(draft, ctx, id);
    }
    if (t.omens.aiMonthlyReadings) readAiOmens(draft, ctx, id);
  }

  progressHoldingConversion(draft, ctx);

  // Bookkeeping: drop last month's counters and stale entries.
  pruneMonthCounters(fs.offerings, month);
  pruneMonthCounters(fs.alms, month);
  pruneMonthCounters(fs.deeds, month);
  for (const id of Object.keys(fs.tended) as FactionId[]) {
    const rec = fs.tended[id];
    if (!rec) continue;
    for (const god of GOD_IDS) if (Object.hasOwn(rec, god) && (rec[god] ?? 0) < month - 1) delete rec[god];
    if (Object.keys(rec).length === 0 || !(id === player || Object.hasOwn(draft.factions, id))) delete fs.tended[id];
  }
  const cooldownH = ctx.balance.omens.readCooldownDays * 24;
  for (const id of Object.keys(fs.seerReadHour) as SettlementId[]) {
    if ((fs.seerReadHour[id] ?? 0) + cooldownH <= draft.time.hour) delete fs.seerReadHour[id];
  }
}

/** Daily: the player's expired omens are removed. */
export function dailyFaith(draft: GameState): void {
  const omens = draft.player.house.omens;
  if (!omens) return;
  const hour = draft.time.hour;
  for (const key of Object.keys(omens) as (keyof OmenReadings)[]) {
    const r = omens[key];
    if (!r || r.untilHour <= hour) delete omens[key];
  }
}

function checkReadings(out: string[], where: string, readings: OmenReadings | undefined): void {
  if (!readings) return;
  for (const [activity, r] of Object.entries(readings)) {
    if (!r) continue;
    if (!(OMEN_IDS as readonly string[]).includes(r.omen)) out.push(`${where}.${activity}: unknown omen '${String(r.omen)}'`);
    if (!Number.isFinite(r.score)) out.push(`${where}.${activity}: score ${r.score}`);
    if (!(r.untilHour > r.readHour)) out.push(`${where}.${activity}: untilHour ${r.untilHour} <= readHour ${r.readHour}`);
  }
}

/** Faith invariants (ranges, readings, bookkeeping, conversion consistency). */
export function faithInvariants(state: GameState, content: Content = getContent()): string[] {
  const out: string[] = [];
  const b = content.balance.standing;
  const t = content.tunables.faith;
  const house = state.player.house;
  const inRange = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo && v <= hi;
  for (const god of GOD_IDS) {
    const v = house.favor[god];
    if (!inRange(v, b.favor.min, b.favor.max)) out.push(`house favor ${god} = ${v} outside [${b.favor.min}, ${b.favor.max}]`);
  }
  if (!inRange(house.faithWrath, b.faithWrath.min, b.faithWrath.max)) out.push(`faithWrath ${house.faithWrath} out of range`);
  if (house.piety !== undefined && !inRange(house.piety, b.piety.min, b.piety.max)) out.push(`piety ${house.piety} out of range`);
  if (isLanternFaith(t, house.faith) && house.piety === undefined && state.faith?.conversion) out.push('converted house without piety');
  checkReadings(out, 'house.omens', house.omens);
  const chapels = house.chapels ?? [];
  chapels.forEach((id, i) => {
    if (!Object.hasOwn(state.settlements, id)) out.push(`chapel at unknown settlement ${id}`);
    if (chapels.indexOf(id) !== i) out.push(`chapel ${id} listed twice`);
  });
  for (const f of Object.values(state.factions)) {
    if (f.favor) {
      for (const god of GOD_IDS) {
        const v = f.favor[god];
        if (!inRange(v, b.favor.min, b.favor.max)) out.push(`faction ${f.id} favor ${god} = ${v} out of range`);
      }
    }
    checkReadings(out, `faction ${f.id}.omens`, f.omens);
  }
  const fs = state.faith;
  if (fs) {
    if (fs.wrathLevel !== wrathLevelOf(content.balance, house.faithWrath)) {
      out.push(`faith.wrathLevel ${fs.wrathLevel} does not match Faith Wrath ${house.faithWrath} (written outside the faith module?)`);
    }
    for (const table of [fs.offerings, fs.alms, fs.deeds]) {
      for (const [id, c] of Object.entries(table)) {
        for (const [k, n] of Object.entries(c.counts)) if (!Number.isInteger(n) || n < 0) out.push(`faith counter ${id}.${k} = ${n}`);
      }
    }
    const conv = fs.conversion;
    if (conv) {
      if (!isLanternFaith(t, house.faith)) out.push(`conversion recorded but the house keeps ${house.faith}`);
      for (const [id, share] of Object.entries(conv.shares)) if (!(share >= 0 && share <= 1)) out.push(`conversion share ${id} = ${share}`);
      for (const [id, r] of Object.entries(conv.resentment)) if (!(r >= 0) || !Number.isFinite(r)) out.push(`resentment ${id} = ${r}`);
    }
  }
  return out;
}
