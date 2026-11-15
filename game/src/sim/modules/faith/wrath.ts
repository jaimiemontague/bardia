/**
 * Faith Wrath (design §4.4, §16.3, §16.4): the Lantern church's anger at the player's house, 0–100.
 * Sacking a cloister +15, burning one +10, raiding on a holy day +5, plundering/annexing Lantern
 * towns and taking clergy captive add more (tunables); it decays −2 per month.
 *
 * Thresholds (balance `standing.faithWrath`): 30 sermons (−10 opinion with every Lantern realm,
 * applied here as an opinion modifier while the level holds), 60 the Lantern Muster, 90 the Ban of
 * the Flame. Crossing a threshold emits FaithWrathRose / FaithWrathFell (diplomacy, ai and economy
 * react: the coalition fleet and the market ban are theirs).
 */
import type { Tunables } from '@content/schemas/tunables/faith';
import { clamp } from '@sim/core/dmath';
import type { SimContext } from '@sim/core/module';
import type { GameState, Hour, Settlement } from '@sim/core/state';
import { toCalendar } from '@sim/core/time';
import { ensureFaithState, isLanternFaith, lanternFactionIds } from './state';
import type { FaithWrathLevel } from './types';

/** Opinion-modifier reason used for the sermons (stacked/unstacked as the level changes). */
export const SERMONS_REASON = 'faith.sermons';

const LEVELS: readonly FaithWrathLevel[] = ['sermons', 'muster', 'ban'];

/** The thresholds in level order. */
export function wrathThresholds(balance: SimContext['balance']): [number, number, number] {
  const w = balance.standing.faithWrath;
  return [w.sermonsAt, w.musterAt, w.banAt];
}

/** Number of thresholds at or below `value` (0 = none, 3 = the Ban). */
export function wrathLevelOf(balance: SimContext['balance'], value: number): number {
  let level = 0;
  for (const th of wrathThresholds(balance)) if (value >= th) level++;
  return level;
}

/** True if `hour` falls on a Lantern holy day (tunables `wrath.holyDays`). */
export function isHolyDay(t: Tunables, hour: Hour): boolean {
  const c = toCalendar(hour);
  return t.wrath.holyDays.some((d) => d.monthIndex === c.monthIndex && d.day === c.day);
}

/**
 * Announces threshold crossings since the last announced level: events, notifications, chronicle,
 * and the sermons opinion modifier with every Lantern faction.
 */
export function reconcileWrathLevel(draft: GameState, ctx: SimContext): void {
  const fs = ensureFaithState(draft);
  const value = draft.player.house.faithWrath;
  const level = wrathLevelOf(ctx.balance, value);
  const before = fs.wrathLevel;
  if (level === before) return;
  const thresholds = wrathThresholds(ctx.balance);
  const t = ctx.tunables.faith;
  if (level > before) {
    for (let i = before; i < level; i++) {
      const name = LEVELS[i] as FaithWrathLevel;
      const threshold = thresholds[i] as number;
      ctx.emit({ type: 'FaithWrathRose', level: name, threshold, value });
      ctx.notify(`faith.wrath.rose.${name}`, {
        priority: i === 0 ? 'high' : 'critical',
        vars: { value, threshold, opinion: ctx.balance.standing.faithWrath.sermonsOpinion },
      });
      ctx.chronicle({ kind: 'faithWrath', textKey: `faith.chronicle.wrath.${name}`, importance: i + 2, vars: { value } });
      if (i === 0 && t.wrath.applySermonsOpinion) applySermons(draft, ctx, 1);
    }
  } else {
    for (let i = before - 1; i >= level; i--) {
      const name = LEVELS[i] as FaithWrathLevel;
      const threshold = thresholds[i] as number;
      ctx.emit({ type: 'FaithWrathFell', level: name, threshold, value });
      ctx.notify(`faith.wrath.fell.${name}`, { priority: 'normal', vars: { value, threshold } });
      if (i === 0 && t.wrath.applySermonsOpinion) applySermons(draft, ctx, -1);
    }
  }
  fs.wrathLevel = level;
}

/** Adds (sign +1) or lifts (sign −1) the sermons opinion modifier with every Lantern faction. */
function applySermons(draft: GameState, ctx: SimContext, sign: 1 | -1): void {
  const amount = ctx.balance.standing.faithWrath.sermonsOpinion * sign;
  if (amount === 0) return;
  const player = draft.player.factionId;
  for (const id of lanternFactionIds(draft, ctx.tunables.faith)) {
    ctx.applyEffects([{ op: 'changeOpinion', a: player, b: id, amount, reason: SERMONS_REASON, decayPerMonth: 0 }]);
  }
}

/**
 * Changes the player's Faith Wrath (clamped to balance `standing.faithWrath`), emits
 * StandingChanged and announces threshold crossings. Returns the change applied.
 */
export function changeFaithWrath(draft: GameState, ctx: SimContext, amount: number): number {
  if (amount === 0) return 0;
  const b = ctx.balance.standing.faithWrath;
  const house = draft.player.house;
  const before = house.faithWrath;
  const after = clamp(before + amount, b.min, b.max);
  house.faithWrath = after;
  const applied = after - before;
  if (applied !== 0) ctx.emit({ type: 'StandingChanged', stat: 'faithWrath', delta: applied, value: after });
  reconcileWrathLevel(draft, ctx);
  return applied;
}

/** How the Lantern judges a fate id (tunables `wrath.fateKinds`), or undefined for a harmless fate. */
export function fateKind(t: Tunables, fate: string): 'burn' | 'plunder' | 'captives' | 'annex' | undefined {
  const k = t.wrath.fateKinds;
  if (k.burn.includes(fate)) return 'burn';
  if (k.plunder.includes(fate)) return 'plunder';
  if (k.captives.includes(fate)) return 'captives';
  if (k.annex.includes(fate)) return 'annex';
  return undefined;
}

/**
 * Faith Wrath for the player's fate decision at a settlement (§16.3 column, §4.4 holy days).
 * Sack and Burn: burnCloister on a Lantern settlement (+ sackCloister at a cloister); Plunder:
 * plunderLantern (+ sackCloister); Take Captives: as Plunder, + clergyCaptives when the captives are
 * clergy (always at a cloister); Annex: annexLantern. Raids (burn/plunder/captives) on a Lantern
 * holy day add holyDayRaid. Returns the total before clamping.
 */
export function fateWrath(ctx: SimContext, settlement: Settlement, fate: string, clergy: boolean, hour: Hour): number {
  const t = ctx.tunables.faith;
  const kind = fateKind(t, fate);
  if (kind === undefined) return 0;
  const lantern = isLanternFaith(t, settlement.faith);
  const cloister = settlement.tier === 'cloister';
  if (!lantern && !cloister) return 0;
  const w = ctx.balance.standing.faithWrath;
  let total = 0;
  switch (kind) {
    case 'burn':
      total += w.burnCloister + (cloister ? w.sackCloister : 0);
      break;
    case 'plunder':
      total += t.wrath.plunderLantern + (cloister ? w.sackCloister : 0);
      break;
    case 'captives':
      total += t.wrath.plunderLantern + (cloister ? w.sackCloister : 0) + (clergy || cloister ? t.wrath.clergyCaptives : 0);
      break;
    case 'annex':
      total += t.wrath.annexLantern;
      break;
  }
  if (kind !== 'annex' && isHolyDay(t, hour)) total += w.holyDayRaid;
  return total;
}
