/**
 * 'people' simulation module (scheduler order 100).
 * Scope: Characters: progression (XP, levels, titles, feats), health and injuries, aging, marriage,
 * children, succession, captivity (§5.2–§5.4, §12.5–§12.6, §14.9, §22, §23).
 * Owns (src/sim/core/ownership.ts):
 *   effects: woundCharacter, addTrait, removeTrait, marry, birth, kill, capture, giveItem
 *            (+ grantXp, releaseCharacter, grantDeedName)
 *   commands: assignRole, heal, designateHeir, adopt, foster, captivityAction (+ allocatePoints, chooseFeat)
 *   pending kinds: captivity, succession (+ featChoice)
 *   events: Birth, Death, Marriage, ComingOfAge, LevelUp, TitleChanged, CaptureStarted, Released,
 *           SuccessionOccurred (+ HouseFallsSilent and the others declared in ./types)
 *   condition fns: hasTrait (+ hasFeat, age, isAdult, lifeStage, isAlive, isMarried, isCaptive,
 *                  isPregnant, hasHeir, level, skill, attribute, woundState, childCount, canMarry, isKin)
 *   state slices: characters (+ the `people` root slice: indices and the regency)
 *   vocabularies/policies: RoleKinds.seer; PlayerPolicies.levelUpPoints, PlayerPolicies.captivityRansom
 * Captivity is owned here: the steward ransoms the house's captives under `captivityRansom`; other
 * modules free captives with `releaseCharacter` (ransom paid by others, exchanges, rescues).
 * Hooks for others: HouseFallsSilent (saga → GameEnded), FealtySworn (diplomacy → vassal pact),
 * CaptiveSentWord (AI rescues), flag `people.regencySkip` (no expeditions while an AI regent rules),
 * OldAgeWarned + tunables oldAgeStoryletId / oathTakingStoryletId (narrative).
 * Determinism: every pass over the characters table is split-invariant (`advance(a); advance(b)` ≡
 * `advance(a + b)`, see util.forEachCharacter / charUniform), which the replay log relies on.
 * Tunables: ctx.tunables.people. Strings: src/content/locales/en/people.json (prefix 'people.').
 * Gate: npm run verify:module -- people
 */
import { getContent } from '@content/index';
import { EffectError } from '@sim/core/effects';
import { isSafeRecordKey } from '@sim/core/keys';
import type { Reactions, SimContext, SimModule } from '@sim/core/module';
import type { GameState } from '@sim/core/state';
import './types';
import { dailyAging, monthlyNaturalDeath } from './aging';
import { applyCreation } from './creation';
import { captureCharacter, handleCaptivityAction, monthlyCaptivity, releaseCharacter, weeklyCaptivity } from './captivity';
import { peopleConditionFns } from './conditions';
import { handleDesignateHeir, killCharacter, yearlyRegencyRisks } from './death';
import { birthEffect, dailyPregnancies, handleAdopt, handleFoster, marry, monthlyChildIllness, monthlyConception, monthlyFosterage } from './dynasty';
import { applyInjury, dailyHealth, handleHeal, rollAndApplyInjury, woundCharacter } from './health';
import { peopleInvariants, reconcileIndices } from './invariants';
import { grantDeedName, grantXp, handleAllocatePoints, handleChooseFeat, refreshTitle } from './progression';
import { onBattleEnded, onDuelEnded, onSeaBattleEnded, onStandingChanged } from './reactions';
import { handleAssignRole } from './roles';
import { COMMAND_SCHEMAS, EFFECT_SCHEMAS } from './schemas';
import { addTrait, removeTrait } from './traits';
import { ageOf, charOf, forEachCharacter, notifyHouse, peopleState, pushUnique, removeValue, requireChar, targetChar } from './util';

/** New game, a save made before this module existed, or an older module version. */
function setup(draft: GameState, ctx: SimContext): void {
  peopleState(draft);
  const policies = draft.player.policies;
  if (policies.levelUpPoints === undefined) policies.levelUpPoints = 'auto';
  if (policies.captivityRansom === undefined) policies.captivityRansom = 'payIfAffordable';
  applyCreation(draft, ctx);
  reconcileIndices(draft, ctx);
  const now = ctx.hour;
  forEachCharacter(draft, (id, row) => {
    if (!row.alive || row.agedTo !== undefined) return;
    const c = draft.characters[id];
    if (c) c.agedTo = ageOf(c, now);
  });
  const ruler = charOf(draft, draft.player.rulerId);
  if (ruler) refreshTitle(draft, ctx, ruler);
}

/**
 * Events owned by modules whose types this module does not import (battle, duel, seabattle):
 * subscribed by name and read defensively (see reactions.ts).
 */
const EXTERNAL_REACTIONS = {
  BattleEnded: onBattleEnded,
  DuelEnded: onDuelEnded,
  SeaBattleEnded: onSeaBattleEnded,
} as unknown as Reactions;

export const module: SimModule = {
  id: 'people',
  order: 100,
  version: 1,
  init: setup,
  migrate(draft, _fromVersion, ctx) {
    setup(draft, ctx);
  },
  handlers: {
    assignRole: handleAssignRole,
    heal: handleHeal,
    designateHeir: handleDesignateHeir,
    adopt: handleAdopt,
    foster: handleFoster,
    captivityAction: handleCaptivityAction,
    allocatePoints: handleAllocatePoints,
    chooseFeat: handleChooseFeat,
  },
  commandSchemas: COMMAND_SCHEMAS,
  systems: {
    daily(draft, ctx) {
      dailyHealth(draft, ctx);
      dailyPregnancies(draft, ctx);
      dailyAging(draft, ctx);
    },
    weekly(draft, ctx) {
      weeklyCaptivity(draft, ctx);
    },
    monthly(draft, ctx) {
      monthlyCaptivity(draft, ctx);
      monthlyNaturalDeath(draft, ctx);
      monthlyConception(draft, ctx);
      monthlyChildIllness(draft, ctx);
      monthlyFosterage(draft, ctx);
      const ruler = charOf(draft, draft.player.rulerId);
      if (ruler) refreshTitle(draft, ctx, ruler);
    },
    yearly(draft, ctx) {
      yearlyRegencyRisks(draft, ctx);
    },
  },
  effects: {
    woundCharacter(draft, e, ctx) {
      const c = targetChar(draft, e.charId, 'woundCharacter');
      const severity = e.severity ?? (e.wound !== undefined && e.wound !== 'none' ? e.wound : undefined);
      if (severity !== undefined) woundCharacter(draft, ctx, c, severity, e.cause);
      if (e.injury !== undefined) applyInjury(draft, ctx, c, e.injury, e.cause);
      if (e.rollInjury === true) rollAndApplyInjury(draft, ctx, c, e.cause);
    },
    addTrait(draft, e, ctx) {
      const c = targetChar(draft, e.charId, 'addTrait');
      // An injury-table id ('lostEye', 'brokenHand' …) applies that injury (its trait, or a timed hurt).
      if (!Object.hasOwn(ctx.content.traits, e.trait) && ctx.balance.health.injuryTable.some((r) => r.id === e.trait)) applyInjury(draft, ctx, c, e.trait, e.source);
      else addTrait(ctx, c, e.trait, e.source ?? 'event');
    },
    removeTrait(draft, e, ctx) {
      removeTrait(ctx, targetChar(draft, e.charId, 'removeTrait'), e.trait);
    },
    marry(draft, e, ctx) {
      marry(draft, ctx, targetChar(draft, e.charId, 'marry'), requireChar(draft, e.spouseId, 'marry'));
    },
    birth(draft, e, ctx) {
      birthEffect(draft, ctx, e);
    },
    kill(draft, e, ctx) {
      const c = targetChar(draft, e.charId, 'kill');
      const captor = e.byFactionId;
      // Gentle Mode: the player's character is captured rather than killed in duels (§5.1).
      if (
        draft.meta.options.gentleMode &&
        e.cause === 'duel' &&
        c.id === draft.player.rulerId &&
        captor !== undefined &&
        captor !== c.factionId &&
        Object.hasOwn(draft.factions, captor)
      ) {
        captureCharacter(draft, ctx, c, captor, { cause: 'duel' });
        return;
      }
      killCharacter(draft, ctx, c, e.cause, {
        ...(e.killerId !== undefined ? { killerId: e.killerId } : {}),
        ...(captor !== undefined ? { byFactionId: captor } : {}),
      });
    },
    capture(draft, e, ctx) {
      const c = targetChar(draft, e.charId, 'capture');
      const captor = e.byFactionId ?? e.captorFactionId;
      if (captor === undefined) throw new EffectError('capture needs byFactionId');
      if (c.factionId !== undefined && c.factionId === captor) throw new EffectError(`capture: ${c.id} already serves ${captor}`);
      captureCharacter(draft, ctx, c, captor, {
        ...(e.at !== undefined ? { at: e.at } : {}),
        ...(e.ransom !== undefined ? { ransom: e.ransom } : {}),
        ...(e.cause !== undefined ? { cause: e.cause } : {}),
        ...(e.hostage !== undefined ? { hostage: e.hostage } : {}),
      });
    },
    giveItem(draft, e, ctx) {
      const c = targetChar(draft, e.charId, 'giveItem');
      if (!isSafeRecordKey(e.itemId)) throw new EffectError(`giveItem: bad item id '${String(e.itemId)}'`);
      if (e.fromCharId !== undefined) {
        const from = requireChar(draft, e.fromCharId, 'giveItem');
        if (!from.items || !removeValue(from.items, e.itemId)) throw new EffectError(`giveItem: ${from.id} does not hold '${e.itemId}'`);
        if (from.items.length === 0) delete from.items;
      }
      c.items ??= [];
      pushUnique(c.items, e.itemId);
      const ev: { type: 'ItemGiven'; charId: typeof c.id; itemId: string; fromCharId?: typeof c.id } = { type: 'ItemGiven', charId: c.id, itemId: e.itemId };
      if (e.fromCharId !== undefined) ev.fromCharId = e.fromCharId;
      ctx.emit(ev);
      notifyHouse(ctx, c, 'people.notify.itemGiven', { item: e.itemId });
    },
    grantXp(draft, e, ctx) {
      grantXp(draft, ctx, targetChar(draft, e.charId, 'grantXp'), e.amount, e.source ?? 'event');
    },
    releaseCharacter(draft, e, ctx) {
      releaseCharacter(draft, ctx, requireChar(draft, e.charId, 'releaseCharacter'), e.reason ?? 'released', e.to);
    },
    grantDeedName(draft, e, ctx) {
      grantDeedName(draft, ctx, targetChar(draft, e.charId, 'grantDeedName'), e.key, e.vars);
    },
  },
  effectSchemas: EFFECT_SCHEMAS,
  reactions: {
    ...EXTERNAL_REACTIONS,
    StandingChanged(draft, e, ctx) {
      onStandingChanged(draft, e, ctx);
    },
  },
  conditionFns: peopleConditionFns(),
  invariants(state) {
    return peopleInvariants(state, getContent());
  },
};
