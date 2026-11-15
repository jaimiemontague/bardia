/**
 * The storylet engine (design §19.1, §10.3 petitions, §26.3).
 *
 * Firing a storylet:
 *   1. a trigger fires (monthly per scope kind, daily birthdays/voyage days, hourly scheduled entries, domain
 *      events through reactions, or the `fireStoryletTrigger` effect);
 *   2. candidates = storylets of that trigger whose scope can be bound, that are not `once`-spent, not on
 *      cooldown, not already active, whose `triggerParams` match and whose `when` holds;
 *   3. one candidate is drawn by weight from the 'narrative' stream (monthly: per scope kind, a budget of
 *      `tunables.monthly[kind]` = chance × max distinct storylets);
 *   4. the instance gets its text vars (standard vars, the firing's vars, then the storylet's `vars`),
 *      cooldown/once/marks are recorded, and it is delivered:
 *        - delegable + petitions policy 'delegate' → the steward applies defaultChoice at once;
 *        - delegable + an expiry + the ruler away from home → waits in the Affairs of State inbox and the
 *          steward applies defaultChoice when it expires;
 *        - otherwise → a 'storylet' pending decision (time stops) with resolved keys, vars and choice views.
 * Resolving (storyletChoice, delegation, expiry): effects are applied through ctx.applyEffects with the
 * scope placeholders substituted, a chronicle entry is written when the storylet/choice has a chronicleKey,
 * StoryletResolved is emitted and a choice's followUp fires immediately (depth-capped).
 */
import { CommandError } from '@sim/core/commands';
import { EffectError, type EffectData } from '@sim/core/effects';
import type { EntityLink } from '@sim/core/events';
import { isSafeRecordKey } from '@sim/core/keys';
import type { SimContext } from '@sim/core/module';
import type { GameState, JsonValue, PendingId, StoryletPayload, StoryletScope, TextVars } from '@sim/core/state';
import { addDays, dayIndex, DAYS_PER_YEAR, season, toCalendar } from '@sim/core/time';
import { ConditionRuntimeError, truthy, type EvalScope } from './conditions/scope';
import type { Evaluator } from './conditions/compile';
import { lookupRecord } from './conditions/paths';
import { SCOPE_KINDS, type CompiledStorylet, type NarrativeLibrary } from './library';
import { substituteEffect } from './params';
import { ensureSlice, noteMark, snapshotInstance, sortedInstances, type NarrativeSlice } from './slice';
import { matchTriggerParams, type Firing } from './triggers';
import type { ScopeBindings, StoryletChoiceView, StoryletInstance, StoryletResolution, StoryletScopeRef } from './types';

/** RNG stream for storylet selection and rand() during selection. */
export const NARRATIVE_STREAM = 'narrative';

// ---------------------------------------------------------------------------------------------
// Scopes.

/** Is the scope's entity still there (and, for holdings, still the player's)? */
export function isScopeValid(state: GameState, scope: StoryletScopeRef): boolean {
  const id = scope.id;
  switch (scope.kind) {
    case 'player':
      return true;
    case 'holding': {
      const s = lookupRecord(state.settlements, id);
      return s !== undefined && s.holding !== undefined && s.factionId === state.player.factionId;
    }
    case 'settlement':
      return lookupRecord(state.settlements, id) !== undefined;
    case 'faction':
      return lookupRecord(state.factions, id) !== undefined;
    case 'character':
      return lookupRecord(state.characters, id)?.alive === true;
    case 'fleet':
      return lookupRecord(state.fleets, id) !== undefined;
    default:
      return false;
  }
}

/** The scope a storylet of `kind` gets from a firing's bindings (undefined: cannot be bound). */
export function scopeFromBindings(state: GameState, kind: StoryletScope, b: ScopeBindings): StoryletScopeRef | undefined {
  let id: string | undefined;
  switch (kind) {
    case 'player':
      return { kind };
    case 'holding': {
      id = b.holding ?? b.settlement;
      const s = lookupRecord(state.settlements, id);
      if (!s || s.holding === undefined || s.factionId !== state.player.factionId) return undefined;
      break;
    }
    case 'settlement':
      id = b.settlement ?? b.holding;
      break;
    case 'faction':
      id = b.faction;
      break;
    case 'character':
      id = b.character;
      break;
    case 'fleet':
      id = b.fleet;
      break;
    default:
      return undefined;
  }
  return id === undefined ? undefined : { kind, id };
}

/** Condition bindings for a scope (merged over the firing's own bindings). */
export function bindingsForScope(state: GameState, scope: StoryletScopeRef, base: ScopeBindings = {}): ScopeBindings {
  const out: ScopeBindings = { ...base };
  const id = scope.id;
  switch (scope.kind) {
    case 'holding':
    case 'settlement': {
      const s = lookupRecord(state.settlements, id);
      if (s) {
        out.settlement = s.id;
        if (scope.kind === 'holding') out.holding = s.id;
        out.faction = s.factionId;
      }
      break;
    }
    case 'faction':
      if (id !== undefined) out.faction = id;
      break;
    case 'character': {
      const c = lookupRecord(state.characters, id);
      if (c) {
        out.character = c.id;
        if (c.factionId !== undefined && out.faction === undefined) out.faction = c.factionId;
      }
      break;
    }
    case 'fleet': {
      const f = lookupRecord(state.fleets, id);
      if (f) {
        out.fleet = f.id;
        out.faction = f.ownerId;
      }
      break;
    }
    default:
      break;
  }
  return out;
}

/** Text vars every instance gets from its context. */
export function standardVars(state: GameState, b: ScopeBindings): TextVars {
  const vars: TextVars = {};
  const ruler = lookupRecord(state.characters, state.player.rulerId);
  if (ruler) {
    vars.rulerName = ruler.name;
    vars.rulerSex = ruler.sex;
  }
  const capital = lookupRecord(state.settlements, state.player.capitalId);
  if (capital) vars.capitalName = capital.name;
  vars.year = toCalendar(state.time.hour).year;
  vars.season = season(state.time.hour);
  const settlement = lookupRecord(state.settlements, b.settlement);
  if (settlement) vars.settlementName = settlement.name;
  const holding = lookupRecord(state.settlements, b.holding);
  if (holding) vars.holdingName = holding.name;
  const faction = lookupRecord(state.factions, b.faction);
  if (faction) vars.factionName = faction.name;
  const character = lookupRecord(state.characters, b.character);
  if (character) {
    vars.characterName = character.name;
    vars.characterSex = character.sex;
  }
  const fleet = lookupRecord(state.fleets, b.fleet);
  const leader = fleet ? lookupRecord(state.characters, fleet.leaderId) : undefined;
  if (leader) vars.fleetLeaderName = leader.name;
  return vars;
}

function bindingRecord(b: ScopeBindings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(b)) if (typeof v === 'string') out[k] = v;
  return out;
}

/** Evaluates a condition; runtime errors (bad dynamic arguments) count as false. */
export function holds(fn: Evaluator | undefined, scope: EvalScope): boolean {
  if (!fn) return true;
  try {
    return truthy(fn(scope));
  } catch (err) {
    if (err instanceof ConditionRuntimeError) return false;
    throw err;
  }
}

function linkFor(scope: StoryletScopeRef): EntityLink | undefined {
  if (scope.id === undefined) return undefined;
  if (scope.kind === 'holding' || scope.kind === 'settlement') return { kind: 'settlement', id: scope.id };
  if (scope.kind === 'faction') return { kind: 'faction', id: scope.id };
  if (scope.kind === 'character') return { kind: 'character', id: scope.id };
  if (scope.kind === 'fleet') return { kind: 'fleet', id: scope.id };
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Candidates.

interface Candidate {
  c: CompiledStorylet;
  scope: StoryletScopeRef;
  weight: number;
}

function activeStoryletIds(slice: NarrativeSlice): Record<string, true> {
  const out: Record<string, true> = {};
  for (const inst of Object.values(slice.instances)) out[inst.storyletId] = true;
  return out;
}

function onCooldown(state: GameState, id: string): boolean {
  const cd = state.storylets.cooldowns;
  return Object.hasOwn(cd, id) && (cd[id] as number) > state.time.hour;
}

/** Cheap gates (no condition evaluation). */
function gatesOpen(state: GameState, c: CompiledStorylet, active: Readonly<Record<string, true>>): boolean {
  const id = c.def.id;
  if (Object.hasOwn(active, id)) return false;
  if (c.def.once === true && state.storylets.onceFired.includes(id)) return false;
  return !onCooldown(state, id);
}

function evalScope(ctx: SimContext, b: ScopeBindings, vars: TextVars | undefined, event: Readonly<Record<string, JsonValue>> | undefined, withRng: boolean): EvalScope {
  const s: { state: GameState; env: SimContext['env']; scope: Record<string, string>; rng?: EvalScope['rng']; vars?: TextVars; event?: Record<string, JsonValue> } = {
    state: ctx.state,
    env: ctx.env,
    scope: bindingRecord(b),
  };
  if (withRng) s.rng = ctx.rng(NARRATIVE_STREAM);
  if (vars !== undefined) s.vars = vars;
  if (event !== undefined) s.event = event as Record<string, JsonValue>;
  return s;
}

function eligible(ctx: SimContext, c: CompiledStorylet, scope: StoryletScopeRef, firing: Firing): boolean {
  if (!isScopeValid(ctx.state, scope)) return false;
  const b = bindingsForScope(ctx.state, scope, firing.bindings);
  return holds(c.when, evalScope(ctx, b, firing.vars ?? {}, firing.event ?? firing.params, true));
}

// ---------------------------------------------------------------------------------------------
// Firing and delivery.

function choiceViews(ctx: SimContext, c: CompiledStorylet, inst: StoryletInstance): StoryletChoiceView[] {
  const scope = evalScope(ctx, inst.bindings, inst.vars, inst.event, false);
  return c.choices.map((ch) => {
    const view: StoryletChoiceView = { index: ch.index, labelKey: ch.spec.labelKey, available: holds(ch.when, scope) };
    if (ch.spec.previewKey !== undefined) view.previewKey = ch.spec.previewKey;
    return view;
  });
}

function rulerAbroad(state: GameState): boolean {
  const ruler = lookupRecord(state.characters, state.player.rulerId);
  if (!ruler || ruler.location.kind !== 'settlement') return true;
  const at = lookupRecord(state.settlements, ruler.location.id);
  return !(at !== undefined && at.holding !== undefined && at.factionId === state.player.factionId);
}

/** Fires a storylet for a scope: builds the instance and delivers it. Returns the instance. */
export function fireStorylet(ctx: SimContext, lib: NarrativeLibrary, c: CompiledStorylet, scope: StoryletScopeRef, firing: Firing, chain: number): StoryletInstance {
  const draft = ctx.state;
  const slice = ensureSlice(draft);
  const now = draft.time.hour;
  const def = c.def;
  const bindings = bindingsForScope(draft, scope, firing.bindings);
  const event = firing.event ?? (Object.keys(firing.params).length > 0 ? { ...firing.params } : undefined);
  const vars: TextVars = { ...standardVars(draft, bindings), ...(firing.vars ?? {}) };
  if (c.vars.length > 0) {
    const s = evalScope(ctx, bindings, vars, event, true);
    for (const v of c.vars) {
      let value: TextVars[string] = null;
      try {
        value = v.fn(s);
      } catch (err) {
        if (!(err instanceof ConditionRuntimeError)) throw err;
      }
      vars[v.name] = value;
    }
  }
  // Bookkeeping at fire time: once, cooldown, daysSince/count marks.
  if (def.once === true && !draft.storylets.onceFired.includes(def.id)) draft.storylets.onceFired.push(def.id);
  if (c.cooldownDays > 0) draft.storylets.cooldowns[def.id] = addDays(now, c.cooldownDays);
  noteMark(slice, def.id, now);
  const inst: StoryletInstance = {
    id: ctx.newId('stl'),
    storyletId: def.id,
    trigger: def.trigger,
    scope: scope.id === undefined ? { kind: scope.kind } : { kind: scope.kind, id: scope.id },
    bindings,
    vars,
    firedHour: now,
    status: 'pending',
    chain,
  };
  if (event !== undefined) inst.event = event;
  deliver(ctx, lib, c, inst);
  return inst;
}

function deliver(ctx: SimContext, lib: NarrativeLibrary, c: CompiledStorylet, inst: StoryletInstance): void {
  const draft = ctx.state;
  const slice = ensureSlice(draft);
  const t = ctx.tunables.narrative;
  const def = c.def;
  const link = linkFor(inst.scope);
  const fired = (delivery: 'pending' | 'inbox' | 'delegated') =>
    ctx.emit({ type: 'StoryletFired', instanceId: inst.id, storyletId: def.id, trigger: inst.trigger, delivery, scope: { ...inst.scope } });
  if (c.delegable && draft.player.policies.petitions === 'delegate') {
    fired('delegated');
    resolveInstance(ctx, lib, inst, def.defaultChoice as number, 'delegated', false);
    ctx.notify('narrative.notify.delegated', link ? { priority: 'low', vars: { ...inst.vars }, link } : { priority: 'low', vars: { ...inst.vars } });
    return;
  }
  if (c.delegable && def.expiresInDays !== undefined && t.inboxWhenAbroad && rulerAbroad(draft)) {
    inst.status = 'waiting';
    inst.expiresHour = addDays(draft.time.hour, def.expiresInDays);
    slice.instances[inst.id] = inst;
    fired('inbox');
    enforceInboxCap(ctx, lib);
    const waiting = Object.values(ensureSlice(draft).instances).filter((i) => i.status === 'waiting').length;
    if (waiting > 0) ctx.notify('narrative.notify.inbox', link ? { priority: 'normal', vars: { count: waiting }, link } : { priority: 'normal', vars: { count: waiting } });
    return;
  }
  const payload: StoryletPayload = {
    storyletId: def.id,
    scope: { ...inst.scope },
    vars: { ...inst.vars },
    instanceId: inst.id,
    textKey: def.textKey,
    choices: choiceViews(ctx, c, inst),
    canDefer: def.expiresInDays !== undefined,
  };
  if (def.titleKey !== undefined) payload.titleKey = def.titleKey;
  if (def.illustration !== undefined) payload.illustration = def.illustration;
  if (def.defaultChoice !== undefined) payload.defaultChoice = def.defaultChoice;
  const decision = ctx.pend({ kind: 'storylet', payload });
  inst.pendingId = decision.id;
  slice.instances[inst.id] = inst;
  fired('pending');
}

function enforceInboxCap(ctx: SimContext, lib: NarrativeLibrary): void {
  const max = ctx.tunables.narrative.maxInbox;
  const slice = ensureSlice(ctx.state);
  const waiting = sortedInstances(slice.instances)
    .filter((i) => i.status === 'waiting')
    .map(snapshotInstance);
  for (let k = 0; waiting.length - k > max; k++) {
    const oldest = waiting[k] as StoryletInstance;
    settleWaiting(ctx, lib, oldest);
  }
}

/** Settles a waiting (inbox) instance with its default choice, or lapses it when its scope is gone. */
function settleWaiting(ctx: SimContext, lib: NarrativeLibrary, inst: StoryletInstance): void {
  const c = lib.storylets.byId[inst.storyletId];
  const link = linkFor(inst.scope);
  const opts = (priority: 'low' | 'normal') => (link ? { priority, vars: { ...inst.vars }, link } : { priority, vars: { ...inst.vars } });
  if (!c || c.def.defaultChoice === undefined || !isScopeValid(ctx.state, inst.scope)) {
    resolveInstance(ctx, lib, inst, null, 'lapsed', false);
    ctx.notify('narrative.notify.lapsed', opts('low'));
    return;
  }
  resolveInstance(ctx, lib, inst, c.def.defaultChoice, 'expired', false);
  ctx.notify('narrative.notify.expired', opts('normal'));
}

// ---------------------------------------------------------------------------------------------
// Resolution.

/**
 * Ends an instance: clears its decision, applies the choice (when not null), chronicles it, emits
 * StoryletResolved and fires the choice's follow-up. `fromCommand`: an EffectError becomes a CommandError
 * (the whole command is rejected and the state left untouched); otherwise it is reported and play goes on.
 */
export function resolveInstance(ctx: SimContext, lib: NarrativeLibrary, inst: StoryletInstance, index: number | null, how: StoryletResolution, fromCommand: boolean): void {
  const draft = ctx.state;
  const slice = ensureSlice(draft);
  if (Object.hasOwn(slice.instances, inst.id)) delete slice.instances[inst.id];
  if (inst.status === 'pending' && inst.pendingId !== undefined && draft.pending?.id === inst.pendingId) ctx.resolvePending(inst.pendingId as PendingId);
  const c = lib.storylets.byId[inst.storyletId];
  const choice = index !== null ? c?.choices[index] : undefined;
  if (c && choice) {
    try {
      const pc = {
        state: draft,
        bindings: inst.bindings,
        vars: inst.vars,
        evalScope: evalScope(ctx, inst.bindings, inst.vars, inst.event, true),
      };
      const effects: EffectData[] = choice.spec.effects.map((e) => substituteEffect(e as EffectData, pc));
      ctx.applyEffects(effects);
    } catch (err) {
      if (!(err instanceof EffectError)) throw err;
      if (fromCommand) throw new CommandError('effectFailed', `storylet ${inst.storyletId} choice ${index ?? '-'}: ${err.message}`);
      ctx.notify('narrative.notify.failed', { priority: 'low', vars: { ...inst.vars } });
    }
    const key = choice.spec.chronicleKey ?? c.def.chronicleKey;
    if (key !== undefined) {
      const refs = Object.values(inst.bindings).filter((v): v is string => typeof v === 'string');
      ctx.chronicle({
        kind: 'storylet',
        textKey: key,
        importance: c.def.importance ?? ctx.tunables.narrative.chronicleImportance,
        vars: { ...inst.vars },
        refs: refs.filter((v, i) => refs.indexOf(v) === i),
      });
    }
  }
  ctx.emit({ type: 'StoryletResolved', instanceId: inst.id, storyletId: inst.storyletId, choice: choice ? index : null, how, scope: { ...inst.scope } });
  const followUp = choice?.spec.followUp;
  if (followUp !== undefined) fireFollowUp(ctx, lib, inst, followUp);
}

function fireFollowUp(ctx: SimContext, lib: NarrativeLibrary, parent: StoryletInstance, targetId: string): void {
  if (parent.chain + 1 > ctx.tunables.narrative.maxFollowUpChain) return;
  const target = lib.storylets.byId[targetId];
  if (!target) return;
  const draft = ctx.state;
  const scope = target.def.scope === parent.scope.kind ? parent.scope : scopeFromBindings(draft, target.def.scope, parent.bindings);
  if (!scope || !isScopeValid(draft, scope)) return;
  if (target.def.once === true && draft.storylets.onceFired.includes(target.def.id)) return;
  const firing: Firing = { trigger: target.def.trigger, bindings: parent.bindings, params: {}, vars: parent.vars };
  if (parent.event !== undefined) firing.event = parent.event;
  const b = bindingsForScope(draft, scope, parent.bindings);
  if (!holds(target.when, evalScope(ctx, b, parent.vars, parent.event, true))) return;
  fireStorylet(ctx, lib, target, scope, firing, parent.chain + 1);
}

// ---------------------------------------------------------------------------------------------
// Triggers.

/** Fires an event-like trigger: at most one storylet, drawn by weight, after the trigger's chance roll. */
export function handleFiring(ctx: SimContext, lib: NarrativeLibrary, firing: Firing): StoryletInstance | undefined {
  const defs = lib.storylets.byTrigger[firing.trigger];
  if (!defs || defs.length === 0) return undefined;
  const t = ctx.tunables.narrative;
  const chance = Object.hasOwn(t.triggerChance, firing.trigger) ? (t.triggerChance[firing.trigger] as number) : t.triggerChanceDefault;
  if (chance <= 0) return undefined;
  const rng = ctx.rng(NARRATIVE_STREAM);
  if (chance < 1 && !rng.chance(chance)) return undefined;
  const draft = ctx.state;
  const active = activeStoryletIds(ensureSlice(draft));
  const candidates: Candidate[] = [];
  for (const c of defs) {
    if (!gatesOpen(draft, c, active)) continue;
    if (!matchTriggerParams(c.def.trigger, c.def.triggerParams, firing)) continue;
    const scope = scopeFromBindings(draft, c.def.scope, firing.bindings);
    if (!scope) continue;
    if (eligible(ctx, c, scope, firing)) candidates.push({ c, scope, weight: c.weight });
  }
  if (candidates.length === 0) return undefined;
  const pick = candidates.length === 1 ? candidates[0] : rng.weighted(candidates, (x) => x.weight);
  return pick ? fireStorylet(ctx, lib, pick.c, pick.scope, firing, 0) : undefined;
}

/** The characters of the player's court: ruler, kin, the expedition's lieutenants and holding governors. */
export function courtIds(state: GameState): string[] {
  const out: string[] = [];
  const seen: Record<string, true> = {};
  const add = (id: string | undefined) => {
    if (id === undefined || Object.hasOwn(seen, id)) return;
    const c = lookupRecord(state.characters, id);
    if (!c || !c.alive) return;
    seen[id] = true;
    out.push(id);
  };
  const ruler = lookupRecord(state.characters, state.player.rulerId);
  if (ruler) {
    add(ruler.id);
    for (const id of ruler.family.spouseIds) add(id);
    for (const id of ruler.family.childIds) add(id);
    add(ruler.family.fatherId);
    add(ruler.family.motherId);
    for (const parentId of [ruler.family.fatherId, ruler.family.motherId]) {
      const parent = lookupRecord(state.characters, parentId);
      if (parent) for (const id of parent.family.childIds) add(id);
    }
  }
  const fleet = lookupRecord(state.fleets, state.player.expeditionFleetId);
  if (fleet) {
    add(fleet.leaderId);
    for (const id of fleet.lieutenantIds) add(id);
  }
  const faction = lookupRecord(state.factions, state.player.factionId);
  if (faction) {
    for (const sid of faction.holdingIds) add(lookupRecord(state.settlements, sid)?.holding?.governorId);
  }
  return out;
}

/** Scope instances considered by the monthly trigger for one scope kind. */
export function monthlyScopes(state: GameState, kind: string): StoryletScopeRef[] {
  switch (kind) {
    case 'player':
      return [{ kind: 'player' }];
    case 'holding': {
      const f = lookupRecord(state.factions, state.player.factionId);
      if (!f) return [];
      return f.holdingIds.filter((id) => isScopeValid(state, { kind: 'holding', id })).map((id) => ({ kind: 'holding', id }));
    }
    case 'settlement': {
      const ruler = lookupRecord(state.characters, state.player.rulerId);
      return ruler?.location.kind === 'settlement' && lookupRecord(state.settlements, ruler.location.id) ? [{ kind: 'settlement', id: ruler.location.id }] : [];
    }
    case 'faction':
      return Object.keys(state.factions)
        .filter((id) => id !== state.player.factionId)
        .map((id) => ({ kind: 'faction', id }));
    case 'character':
      return courtIds(state).map((id) => ({ kind: 'character', id }));
    case 'fleet': {
      const id = state.player.expeditionFleetId;
      return id !== undefined && lookupRecord(state.fleets, id) ? [{ kind: 'fleet', id }] : [];
    }
    default:
      return [];
  }
}

/** Monthly system: onSeasonStart, then per scope kind a chance roll and up to `max` distinct storylets. */
export function runMonthly(ctx: SimContext, lib: NarrativeLibrary): void {
  const draft = ctx.state;
  const now = draft.time.hour;
  if (toCalendar(now).monthIndex % 3 === 0) handleFiring(ctx, lib, { trigger: 'onSeasonStart', bindings: {}, params: { season: season(now), player: true } });
  const t = ctx.tunables.narrative;
  const firing: Firing = { trigger: 'monthly', bindings: {}, params: {} };
  for (const kind of SCOPE_KINDS) {
    const defs = lib.storylets.monthlyByScope[kind];
    if (!defs || defs.length === 0) continue;
    const budget = Object.hasOwn(t.monthly, kind) ? t.monthly[kind] : undefined;
    if (!budget || budget.max <= 0 || budget.chance <= 0) continue;
    const rng = ctx.rng(NARRATIVE_STREAM);
    if (!rng.chance(budget.chance)) continue;
    const scopes = monthlyScopes(draft, kind);
    if (scopes.length === 0) continue;
    for (let k = 0; k < budget.max; k++) {
      const active = activeStoryletIds(ensureSlice(draft));
      const candidates: Candidate[] = [];
      for (const c of defs) {
        if (!gatesOpen(draft, c, active)) continue;
        for (const scope of scopes) if (eligible(ctx, c, scope, firing)) candidates.push({ c, scope, weight: c.weight });
      }
      if (candidates.length === 0) break;
      const pick = rng.weighted(candidates, (x) => x.weight);
      if (!pick) break;
      fireStorylet(ctx, lib, pick.c, pick.scope, firing, 0);
    }
  }
}

/** Daily system: inbox expiry, birthdays and ages of the court, the expedition's voyage day. */
export function runDaily(ctx: SimContext, lib: NarrativeLibrary): void {
  const draft = ctx.state;
  const instances = draft.storylets.instances;
  if (instances !== undefined) {
    const now = draft.time.hour;
    const due = sortedInstances(instances)
      .filter((i) => i.status === 'waiting' && i.expiresHour !== undefined && i.expiresHour <= now)
      .map(snapshotInstance);
    for (const inst of due) settleWaiting(ctx, lib, inst);
  }
  const byTrigger = lib.storylets.byTrigger;
  if ((byTrigger.onBirthday?.length ?? 0) > 0 || (byTrigger.onAgeReached?.length ?? 0) > 0) {
    const today = dayIndex(draft.time.hour);
    for (const id of courtIds(draft)) {
      const c = lookupRecord(draft.characters, id);
      if (!c) continue;
      const days = today - dayIndex(c.birthHour);
      if (days <= 0 || days % DAYS_PER_YEAR !== 0) continue;
      const age = days / DAYS_PER_YEAR;
      const bindings: ScopeBindings = { character: c.id };
      if (c.factionId !== undefined) bindings.faction = c.factionId;
      const params = { age, ruler: c.id === draft.player.rulerId, player: true };
      handleFiring(ctx, lib, { trigger: 'onBirthday', bindings, params });
      handleFiring(ctx, lib, { trigger: 'onAgeReached', bindings, params });
    }
  }
  if ((byTrigger.onVoyageDay?.length ?? 0) > 0) {
    const fleet = lookupRecord(draft.fleets, draft.player.expeditionFleetId);
    if (fleet && fleet.mode === 'sailing') {
      handleFiring(ctx, lib, { trigger: 'onVoyageDay', bindings: { fleet: fleet.id, faction: fleet.ownerId }, params: { voyageDays: fleet.voyageDays, player: true } });
    }
  }
}

/** Hourly system: fires scheduled storylets that are due (state.storylets.scheduled, core scheduleStorylet). */
export function runHourly(ctx: SimContext, lib: NarrativeLibrary): void {
  const draft = ctx.state;
  const list = draft.storylets.scheduled;
  if (list.length === 0) return;
  const now = draft.time.hour;
  let anyDue = false;
  for (const e of list) {
    if (e.atHour <= now) {
      anyDue = true;
      break;
    }
  }
  if (!anyDue) return;
  const due: { storyletId: string; atHour: number; scope?: { kind: StoryletScope; id?: string }; vars?: TextVars; order: number }[] = [];
  list.forEach((e, order) => {
    if (e.atHour > now) return;
    const entry: (typeof due)[number] = { storyletId: e.storyletId, atHour: e.atHour, order };
    if (e.scope !== undefined) entry.scope = e.scope.id === undefined ? { kind: e.scope.kind } : { kind: e.scope.kind, id: e.scope.id };
    if (e.vars !== undefined) entry.vars = { ...e.vars };
    due.push(entry);
  });
  draft.storylets.scheduled = list.filter((e) => e.atHour > now);
  due.sort((a, b) => a.atHour - b.atHour || a.order - b.order);
  for (const e of due) fireScheduled(ctx, lib, e.storyletId, e.scope, e.vars);
}

/** Fires a specific storylet now (scheduled entries): honours `once` and `when`, ignores trigger and cooldown. */
export function fireScheduled(ctx: SimContext, lib: NarrativeLibrary, storyletId: string, scopeIn: { kind: StoryletScope; id?: string } | undefined, vars: TextVars | undefined): StoryletInstance | undefined {
  const c = lib.storylets.byId[storyletId];
  if (!c) return undefined;
  const draft = ctx.state;
  const scope: StoryletScopeRef | undefined = scopeIn !== undefined ? scopeIn : c.def.scope === 'player' ? { kind: 'player' } : undefined;
  if (!scope || scope.kind !== c.def.scope || !isScopeValid(draft, scope)) return undefined;
  if (c.def.once === true && draft.storylets.onceFired.includes(c.def.id)) return undefined;
  if (Object.hasOwn(activeStoryletIds(ensureSlice(draft)), c.def.id)) return undefined;
  const firing: Firing = { trigger: 'scheduled', bindings: {}, params: {} };
  if (vars !== undefined) firing.vars = vars;
  if (!eligible(ctx, c, scope, firing)) return undefined;
  return fireStorylet(ctx, lib, c, scope, firing, 0);
}

// ---------------------------------------------------------------------------------------------
// The storyletChoice command.

/** Handles `storyletChoice { instanceId, choice }`. Throws CommandError for invalid requests. */
export function chooseStorylet(ctx: SimContext, lib: NarrativeLibrary, instanceId: string, choice: number | 'default' | 'later'): void {
  const draft = ctx.state;
  const slice = ensureSlice(draft);
  const inst = isSafeRecordKey(instanceId) && Object.hasOwn(slice.instances, instanceId) ? slice.instances[instanceId] : undefined;
  if (!inst) throw new CommandError('unknownStorylet', `No active storylet '${instanceId}'`);
  if (inst.status === 'pending' && (inst.pendingId === undefined || draft.pending?.id !== inst.pendingId)) {
    throw new CommandError('notCurrent', 'Resolve the current decision first');
  }
  const snapshot = snapshotInstance(inst);
  const c = lib.storylets.byId[snapshot.storyletId];
  if (!c || !isScopeValid(draft, snapshot.scope)) {
    resolveInstance(ctx, lib, snapshot, null, 'lapsed', true);
    ctx.notify('narrative.notify.lapsed', { priority: 'low', vars: { ...snapshot.vars } });
    return;
  }
  const def = c.def;
  if (choice === 'later') {
    if (snapshot.status !== 'pending') throw new CommandError('notPending', 'Only a pending storylet can be deferred');
    if (def.expiresInDays === undefined || def.defaultChoice === undefined) throw new CommandError('cannotDefer', `Storylet '${def.id}' cannot wait`);
    const live = slice.instances[snapshot.id] as StoryletInstance;
    live.status = 'waiting';
    delete live.pendingId;
    live.expiresHour = addDays(draft.time.hour, def.expiresInDays);
    ctx.resolvePending(snapshot.pendingId as PendingId);
    enforceInboxCap(ctx, lib);
    return;
  }
  let index: number;
  let how: StoryletResolution;
  if (choice === 'default') {
    if (def.defaultChoice === undefined) throw new CommandError('noDefault', `Storylet '${def.id}' has no default choice`);
    index = def.defaultChoice;
    how = 'default';
  } else {
    if (!Number.isInteger(choice) || choice < 0 || choice >= c.choices.length) throw new CommandError('badChoice', `Choice ${choice} does not exist`);
    const ch = c.choices[choice];
    if (!holds(ch?.when, evalScope(ctx, snapshot.bindings, snapshot.vars, snapshot.event, false))) {
      throw new CommandError('choiceUnavailable', `Choice ${choice} is not available`);
    }
    index = choice;
    how = 'chosen';
  }
  resolveInstance(ctx, lib, snapshot, index, how, true);
}

/** Recomputes the choice views of an active instance (pure; for the client and tests). */
export function viewChoices(ctx: Pick<SimContext, 'state' | 'env'>, lib: NarrativeLibrary, inst: StoryletInstance): StoryletChoiceView[] {
  const c = lib.storylets.byId[inst.storyletId];
  if (!c) return [];
  const scope: EvalScope = { state: ctx.state, env: ctx.env, scope: bindingRecord(inst.bindings), vars: inst.vars, ...(inst.event !== undefined ? { event: inst.event } : {}) };
  return c.choices.map((ch) => {
    const view: StoryletChoiceView = { index: ch.index, labelKey: ch.spec.labelKey, available: holds(ch.when, scope) };
    if (ch.spec.previewKey !== undefined) view.previewKey = ch.spec.previewKey;
    return view;
  });
}
