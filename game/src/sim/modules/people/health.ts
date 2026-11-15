/**
 * Health (§22.5, §12.6): wounds (minor / serious / mortal) with recovery times, the d100 injury
 * table (permanent injuries are traits; temporary ones expire), the daily recovery pass with the
 * mortal-wound death window, and paid healing by a seer or a church (the `heal` command).
 */
import type { Content } from '@content/index';
import { CommandError } from '@sim/core/commands';
import { clamp, dpow } from '@sim/core/dmath';
import { EffectError } from '@sim/core/effects';
import type { CommandHandler, SimContext } from '@sim/core/module';
import type { Character, CharId, GameState, WoundState } from '@sim/core/state';
import { addDays } from '@sim/core/time';
import { killCharacter } from './death';
import { addTrait } from './traits';
import type { WoundSeverity } from './types';
import {
  charOf,
  effectiveSkill,
  isPlayerHouse,
  locationSettlement,
  modifierSum,
  notifyHouse,
  peopleState,
  playerHoldsRelic,
  pushUnique,
  removeValue,
  STREAMS,
} from './util';

/** Severity order of wound states. */
export const WOUND_ORDER: Readonly<Record<WoundState, number>> = { none: 0, minor: 1, serious: 2, mortal: 3 };

type InjuryRow = Content['balance']['health']['injuryTable'][number];

/** Recovery-time multiplier: traits (`health.recoveryPct`), Vigor, and the Gray Queen's Comb for the player's house. */
export function recoveryMult(state: GameState, c: Character, content: Content): number {
  const t = content.tunables.people;
  let mult = 1 - modifierSum(c, content, 'health.recoveryPct') / 100;
  const vigor = c.attributes.vigor + modifierSum(c, content, 'attr.vigor');
  mult *= 1 - t.vigorRecoveryPerPoint * (vigor - content.balance.character.attributePivot);
  if (isPlayerHouse(state, c) && playerHoldsRelic(state, t.relics.grayQueensComb)) mult *= t.combRecoveryMult;
  return clamp(mult, 0.1, 3);
}

function recoveryHours(state: GameState, c: Character, content: Content, days: number, now: number): number {
  return addDays(now, Math.max(1, Math.round(days * recoveryMult(state, c, content))));
}

/**
 * Wounds a character. A lighter wound never replaces a worse one; the same severity again only
 * extends the recovery (so a wound reported twice is not applied twice).
 */
export function woundCharacter(draft: GameState, ctx: SimContext, c: Character, severity: WoundSeverity, cause?: string): void {
  if (!c.alive) return;
  const h = c.health;
  const current = h.wound;
  if (WOUND_ORDER[severity] < WOUND_ORDER[current]) return;
  const w = ctx.balance.health.wounds;
  const now = ctx.hour;
  const worse = WOUND_ORDER[severity] > WOUND_ORDER[current];
  let until: number;
  if (severity === 'mortal') until = addDays(now, w.mortal.deathWindowDays);
  else until = recoveryHours(draft, c, ctx.content, severity === 'minor' ? w.minor.recoveryDays : w.serious.recoveryDays, now);
  if (!worse && h.woundUntilHour !== undefined) until = Math.max(until, h.woundUntilHour);
  h.wound = severity;
  h.woundUntilHour = until;
  h.hpPct = ctx.tunables.people.woundHpPct[severity];
  if (cause !== undefined) h.cause = cause;
  pushUnique(peopleState(draft).woundedIds, c.id);
  if (!worse) return;
  h.treated = false;
  if (severity === 'mortal') h.mortalChecks = 0;
  else delete h.mortalChecks;
  const e: { type: 'CharacterWounded'; charId: CharId; severity: WoundState; cause?: string } = { type: 'CharacterWounded', charId: c.id, severity };
  if (cause !== undefined) e.cause = cause;
  ctx.emit(e);
  notifyHouse(ctx, c, 'people.notify.wounded', { severity }, severity === 'mortal' ? 'critical' : 'high');
}

/** Rolls the d100 injury table (§22.5). */
export function rollInjuryRow(ctx: SimContext): InjuryRow {
  const table = ctx.balance.health.injuryTable;
  const d = ctx.rng(STREAMS.health).int(1, 100);
  return table.find((r) => d <= r.max) ?? (table[table.length - 1] as InjuryRow);
}

/**
 * Applies an injury by injury-table id (or, failing that, a trait id): permanent injuries add their
 * trait, temporary ones a timed modifier, 'mortalWound' a mortal wound, 'none' nothing.
 * Returns the applied injury id, or undefined for none.
 */
export function applyInjury(draft: GameState, ctx: SimContext, c: Character, injuryId: string, cause?: string): string | undefined {
  if (!c.alive) return undefined;
  const row = ctx.balance.health.injuryTable.find((r) => r.id === injuryId);
  if (!row) {
    if (Object.hasOwn(ctx.content.traits, injuryId)) {
      addTrait(ctx, c, injuryId, 'injury');
      return injuryId;
    }
    throw new EffectError(`woundCharacter: unknown injury '${injuryId}'`);
  }
  if (row.trait === undefined && row.wound === undefined && row.days === undefined) return undefined; // nothing lasting
  if (row.wound !== undefined) {
    woundCharacter(draft, ctx, c, row.wound, cause);
  } else if (row.trait !== undefined) {
    addTrait(ctx, c, row.trait, 'injury');
  } else if (row.days !== undefined) {
    const until = recoveryHours(draft, c, ctx.content, row.days, ctx.hour);
    const existing = c.health.injuries.find((i) => i.id === row.id);
    if (existing) existing.untilHour = Math.max(existing.untilHour ?? until, until);
    else c.health.injuries.push({ id: row.id, untilHour: until });
    pushUnique(peopleState(draft).woundedIds, c.id);
  }
  const e: { type: 'CharacterWounded'; charId: CharId; severity: WoundState; injury: string; cause?: string } = {
    type: 'CharacterWounded',
    charId: c.id,
    severity: c.health.wound,
    injury: row.id,
  };
  if (cause !== undefined) e.cause = cause;
  ctx.emit(e);
  notifyHouse(ctx, c, 'people.notify.injury', { injury: row.id }, 'high');
  return row.id;
}

/** Rolls and applies an injury. Returns the applied injury id (undefined: nothing lasting). */
export function rollAndApplyInjury(draft: GameState, ctx: SimContext, c: Character, cause?: string): string | undefined {
  return applyInjury(draft, ctx, c, rollInjuryRow(ctx).id, cause);
}

function downgradeToSerious(draft: GameState, ctx: SimContext, c: Character, herbs: boolean): void {
  const h = c.health;
  const w = ctx.balance.health.wounds;
  const days = w.serious.recoveryDays * (herbs ? w.serious.herbsMult : 1);
  h.wound = 'serious';
  h.woundUntilHour = recoveryHours(draft, c, ctx.content, days, ctx.hour);
  h.hpPct = ctx.tunables.people.woundHpPct.serious;
  delete h.mortalChecks;
}

function fullyHealed(c: Character): void {
  const h = c.health;
  h.wound = 'none';
  h.hpPct = 100;
  delete h.woundUntilHour;
  delete h.treated;
  delete h.mortalChecks;
  delete h.cause;
}

/** The Gray Queen's Comb saves each of the player's lieutenants from one mortal wound. */
function combSaves(state: GameState, c: Character, content: Content): boolean {
  return (
    c.id !== state.player.rulerId &&
    !c.combSaved &&
    isPlayerHouse(state, c) &&
    playerHoldsRelic(state, content.tunables.people.relics.grayQueensComb)
  );
}

/** Daily: recover wounds, roll mortal wounds (`deathChance` over `deathWindowDays` rolls), expire temporary injuries. */
export function dailyHealth(draft: GameState, ctx: SimContext): void {
  const ps = peopleState(draft);
  if (ps.woundedIds.length === 0) return;
  const now = ctx.hour;
  const mortal = ctx.balance.health.wounds.mortal;
  for (const id of [...ps.woundedIds]) {
    const c = charOf(draft, id);
    if (!c?.alive) {
      removeValue(ps.woundedIds, id);
      continue;
    }
    const h = c.health;
    if (h.wound === 'mortal') {
      const checks = h.mortalChecks ?? 0;
      if (checks >= mortal.deathWindowDays) {
        downgradeToSerious(draft, ctx, c, false);
        ctx.emit({ type: 'CharacterHealed', charId: c.id, method: 'survived' });
        notifyHouse(ctx, c, 'people.notify.survivedWound', {}, 'high');
      } else {
        h.mortalChecks = checks + 1;
        const pDay = 1 - dpow(1 - mortal.deathChance, 1 / Math.max(1, mortal.deathWindowDays));
        if (ctx.rng(STREAMS.health).chance(pDay)) {
          if (combSaves(draft, c, ctx.content)) {
            c.combSaved = true;
            downgradeToSerious(draft, ctx, c, false);
            ctx.emit({ type: 'CharacterHealed', charId: c.id, method: 'relic' });
            notifyHouse(ctx, c, 'people.notify.combSaved', {}, 'high');
          } else {
            killCharacter(draft, ctx, c, 'wounds');
            continue;
          }
        }
      }
    } else if (h.wound !== 'none' && (h.woundUntilHour === undefined || now >= h.woundUntilHour)) {
      fullyHealed(c);
      ctx.emit({ type: 'CharacterHealed', charId: c.id, method: 'rest' });
      notifyHouse(ctx, c, 'people.notify.recovered');
    }
    if (h.injuries.some((i) => i.untilHour !== undefined && i.untilHour <= now)) {
      const expired = h.injuries.filter((i) => i.untilHour !== undefined && i.untilHour <= now).map((i) => i.id);
      h.injuries = h.injuries.filter((i) => i.untilHour === undefined || i.untilHour > now);
      for (const injury of expired) notifyHouse(ctx, c, 'people.notify.injuryHealed', { injury });
    }
    if (h.wound === 'none' && !h.injuries.some((i) => i.untilHour !== undefined)) removeValue(ps.woundedIds, id);
  }
}

// ---------------------------------------------------------------------------------------------
// The heal command

function samePlace(a: Character, b: Character): boolean {
  const la = a.location as unknown as Record<string, unknown>;
  const lb = b.location as unknown as Record<string, unknown>;
  return (a.location.kind === 'settlement' || a.location.kind === 'fleet' || a.location.kind === 'army') && la.kind === lb.kind && la.id === lb.id;
}

/** The healer for a seer treatment: the given one, or the player's best seer at the patient's side. */
function findHealer(draft: GameState, ctx: SimContext, patient: Character, healerId: CharId | undefined): Character {
  if (healerId !== undefined) {
    const h = charOf(draft, healerId);
    if (!h?.alive || !isPlayerHouse(draft, h) || h.location.kind === 'captive' || h.id === patient.id) {
      throw new CommandError('noHealer', 'That healer cannot tend the patient');
    }
    if (!samePlace(h, patient)) throw new CommandError('healerAway', 'The healer is not with the patient');
    return h;
  }
  let best: Character | undefined;
  let bestScore = -1;
  const minRune = ctx.tunables.people.seerMinRunecraft;
  for (const id of Object.keys(draft.characters) as CharId[]) {
    const h = draft.characters[id];
    if (!h?.alive || h.id === patient.id || h.location.kind === 'captive' || !isPlayerHouse(draft, h) || !samePlace(h, patient)) continue;
    const rune = effectiveSkill(h, 'runecraft', ctx.content);
    if (rune < minRune && h.role?.kind !== 'seer') continue; // not a seer at all
    const score = rune + (h.role?.kind === 'seer' ? 0.5 : 0);
    if (score > bestScore) {
      best = h;
      bestScore = score;
    }
  }
  if (!best) throw new CommandError('noHealer', 'No seer is with the patient');
  return best;
}

/** `heal`: a seer or church tends a wound (cost from balance.health.healCost by severity). */
export const handleHeal: CommandHandler<'heal'> = (draft, cmd, ctx) => {
  const c = charOf(draft, cmd.charId);
  if (!c) throw new CommandError('unknownCharacter', `No character ${cmd.charId}`);
  if (!c.alive) throw new CommandError('dead', `${c.name} is dead`);
  if (!isPlayerHouse(draft, c)) throw new CommandError('notYours', `${c.name} does not serve your house`);
  if (c.location.kind === 'captive') throw new CommandError('captive', `${c.name} is held captive`);
  const h = c.health;
  const hasTemp = h.injuries.some((i) => i.untilHour !== undefined && i.untilHour > ctx.hour);
  if (h.wound === 'none' && !hasTemp) throw new CommandError('notWounded', `${c.name} needs no healing`);
  if (h.treated) throw new CommandError('alreadyTreated', 'This wound has already been tended');
  const severity: WoundSeverity = h.wound === 'none' ? 'minor' : h.wound;
  const w = ctx.balance.health.wounds;
  const t = ctx.tunables.people;
  if (cmd.method === 'seer') {
    const healer = findHealer(draft, ctx, c, cmd.healerId);
    const rune = effectiveSkill(healer, 'runecraft', ctx.content);
    const needed = severity === 'mortal' ? w.mortal.healerRunecraft : t.seerMinRunecraft;
    if (rune < needed) throw new CommandError('healerTooUnskilled', `The seer needs Runecraft ${needed}`);
  } else {
    if (severity === 'mortal') throw new CommandError('cannotTreatMortal', 'Only a skilled seer can save a mortal wound');
    const at = locationSettlement(c.location);
    const s = at !== undefined ? draft.settlements[at] : undefined;
    if (!s || !t.churchFaiths.includes(s.faith)) throw new CommandError('noChurch', 'There is no church here');
  }
  const [lo, hi] = ctx.balance.health.healCost;
  const cost = Math.round(lo + (hi - lo) * t.healCostShare[severity]);
  const faction = draft.factions[draft.player.factionId];
  if (!faction || faction.treasury < cost) throw new CommandError('cannotAfford', `Healing costs ${cost} silver`);
  if (cost > 0) ctx.applyEffects([{ op: 'addSilver', amount: -cost, factionId: draft.player.factionId }]);
  const now = ctx.hour;
  const herbs = w.serious.herbsMult;
  if (severity === 'mortal') downgradeToSerious(draft, ctx, c, true);
  else if (h.wound !== 'none' && h.woundUntilHour !== undefined) h.woundUntilHour = now + Math.ceil((h.woundUntilHour - now) * herbs);
  for (const inj of h.injuries) if (inj.untilHour !== undefined && inj.untilHour > now) inj.untilHour = now + Math.ceil((inj.untilHour - now) * herbs);
  h.treated = true;
  ctx.emit({ type: 'CharacterHealed', charId: c.id, method: cmd.method });
  notifyHouse(ctx, c, 'people.notify.healed', { method: cmd.method, cost });
};
