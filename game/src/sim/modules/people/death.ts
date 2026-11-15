/**
 * Death and succession (§23.4, §23.6, §24): the `kill` op and Death event, the player's succession
 * (adult heir → continue as the heir with the Renown/Honor inheritance rules and loyalty hits;
 * minor heir → regency decision; no heir → nearest adult kin; none → the house falls silent),
 * automatic succession of AI rulers, settlement leaders and governors left vacant, and regencies
 * ("play as regent" or "skip to coming of age").
 */
import { CommandError } from '@sim/core/commands';
import { createCharacter } from '@sim/core/factory';
import type { CommandHandler, SimContext } from '@sim/core/module';
import { runTicks } from '@sim/core/scheduler';
import type { Character, CharacterRole, CharId, FactionId, GameState, SettlementId } from '@sim/core/state';
import { childIds, defaultHeir, heirPool, livingSpouses, nearestAdultKin, siblingIds } from './kin';
import { refreshTitle } from './progression';
import type { RegencyMode, SuccessionKind } from './types';
import {
  ageOf,
  byAgeDesc,
  charOf,
  chronicleHouse,
  effectiveSkill,
  factionSeat,
  hourOfAge,
  isAdultAt,
  nameVars,
  notifyHouse,
  peopleState,
  playerHome,
  pushUnique,
  removeValue,
  STREAMS,
} from './util';

/** Flag set while an AI regent rules for a minor heir ("skip to coming of age"): launch no expeditions. */
export const REGENCY_SKIP_FLAG = 'people.regencySkip';

/** Roles that serve the house as officers (loyalty hits, regent candidates). */
const OFFICER_ROLES: readonly string[] = ['lieutenant', 'captain', 'governor', 'steward', 'envoy', 'seer'];

export interface KillOptions {
  killerId?: CharId;
  byFactionId?: FactionId;
}

/** The faction a character currently rules (faction.rulerId), if any. */
export function factionRuledBy(state: GameState, c: Character): FactionId | undefined {
  const fid = c.role?.kind === 'ruler' ? c.role.factionId ?? c.factionId : c.factionId;
  if (fid !== undefined && Object.hasOwn(state.factions, fid) && state.factions[fid]?.rulerId === c.id) return fid;
  if (c.id === state.player.rulerId) return state.player.factionId;
  return undefined;
}

/**
 * Kills a character: marks them dead, clears roles and module records, emits Death, then settles
 * every office they held (the player's succession, an AI faction's succession, settlement leaders,
 * governors). No-op for the already dead.
 */
export function killCharacter(draft: GameState, ctx: SimContext, c: Character, cause: string, opts: KillOptions = {}): void {
  if (!c.alive) return;
  const ps = peopleState(draft);
  const now = ctx.hour;
  const wasPlayerRuler = c.id === draft.player.rulerId;
  const rulerOf = factionRuledBy(draft, c);
  const regency = ps.regency;
  c.alive = false;
  c.death = { hour: now, cause };
  delete c.role;
  if (c.pregnancy) delete c.pregnancy;
  if (c.captivity) delete c.captivity;
  if (c.upbringing) delete c.upbringing;
  removeValue(ps.pregnantIds, c.id);
  removeValue(ps.woundedIds, c.id);
  removeValue(ps.captiveIds, c.id);
  removeValue(ps.fosterIds, c.id);
  const ruler = charOf(draft, draft.player.rulerId);
  if (ruler && ruler.family.heirId === c.id) delete ruler.family.heirId;
  resolveStalePending(draft, ctx, c.id);

  const event: {
    type: 'Death';
    charId: CharId;
    cause: string;
    age: number;
    wasPlayerRuler: boolean;
    factionId?: FactionId;
    killerId?: CharId;
    byFactionId?: FactionId;
    rulerOf?: FactionId;
  } = { type: 'Death', charId: c.id, cause, age: ageOf(c, now), wasPlayerRuler };
  if (c.factionId !== undefined) event.factionId = c.factionId;
  if (opts.killerId !== undefined) event.killerId = opts.killerId;
  if (opts.byFactionId !== undefined) event.byFactionId = opts.byFactionId;
  if (rulerOf !== undefined) event.rulerOf = rulerOf;
  ctx.emit(event);
  const vars = { cause, age: event.age };
  notifyHouse(ctx, c, 'people.notify.death', vars, wasPlayerRuler ? 'critical' : 'high', 'narrative.vignette.funeral');
  chronicleHouse(ctx, c, 'death', 'people.chronicle.death', wasPlayerRuler ? 5 : 3, vars);
  if (wasPlayerRuler) ctx.narrate('people.narration.rulerDied', nameVars(c), 'skald');

  endFosterlingsOf(draft, ctx, c);
  if (regency && regency.heirId === c.id) {
    // The minor heir died: the crown passes again from the ruler who left it.
    const reference = charOf(draft, regency.deceasedId) ?? c;
    const offices = regency.offices ?? [];
    endRegencyRecord(draft, ctx);
    playerSuccession(draft, ctx, reference, false, regency.regentId, offices);
  } else if (regency && regency.regentId === c.id) {
    replaceRegent(draft, ctx, c);
  } else if (wasPlayerRuler) {
    playerSuccession(draft, ctx, c, true);
  } else if (rulerOf !== undefined && rulerOf !== draft.player.factionId) {
    aiSuccession(draft, ctx, c, rulerOf);
  }
  fillVacantLeaders(draft, ctx, c);
}

/**
 * Resolves the current decision if it concerns this (dead) character: their feat choice or
 * captivity, or a regency decision for a minor heir who has died (the crown passes on and a fresh
 * decision is raised). Queued decisions about the dead are resolved harmlessly by their commands.
 */
function resolveStalePending(draft: GameState, ctx: SimContext, id: CharId): void {
  const p = draft.pending;
  if (!p || p.source !== 'people') return;
  if ((p.kind === 'featChoice' || p.kind === 'captivity') && p.payload.charId === id) ctx.resolvePending(p.id);
  else if (p.kind === 'succession' && p.payload.heirId === id) ctx.resolvePending(p.id);
}

/** Children fostered with a lieutenant who died come home. */
function endFosterlingsOf(draft: GameState, ctx: SimContext, mentor: Character): void {
  const ps = peopleState(draft);
  for (const id of [...ps.fosterIds]) {
    const child = charOf(draft, id);
    if (!child?.upbringing || child.upbringing.mentorId !== mentor.id) continue;
    delete child.upbringing;
    delete child.family.fosteredAt;
    removeValue(ps.fosterIds, id);
    ctx.emit({ type: 'ChildFostered', childId: id, mode: 'home' });
    notifyHouse(ctx, child, 'people.notify.fosterEnded');
  }
}

// ---------------------------------------------------------------------------------------------
// Offices: rulers, settlement leaders, governors.

/** Moves settlement leadership and governorships from one character to another (optionally restricted). */
function transferOffices(
  draft: GameState,
  fromId: CharId,
  toId: CharId,
  opts: { faction?: FactionId; only?: readonly SettlementId[] } = {},
): SettlementId[] {
  const moved: SettlementId[] = [];
  if (fromId === toId) return moved;
  const ids = opts.only ?? (Object.keys(draft.settlements) as SettlementId[]);
  for (const id of ids) {
    const s = Object.hasOwn(draft.settlements, id) ? draft.settlements[id] : undefined;
    if (!s || (opts.faction !== undefined && s.factionId !== opts.faction)) continue;
    let changed = false;
    if (s.leaderId === fromId) {
      s.leaderId = toId;
      changed = true;
    }
    if (s.holding && s.holding.governorId === fromId) {
      s.holding.governorId = toId;
      changed = true;
    }
    if (changed) moved.push(id);
  }
  return moved;
}

/** Installs a character as the player's ruler (taking over `previousId`'s offices, or only `only`). */
function installPlayerRuler(draft: GameState, ctx: SimContext, heir: Character, previousId: CharId, only?: readonly SettlementId[]): void {
  const fid = draft.player.factionId;
  draft.player.rulerId = heir.id;
  const faction = draft.factions[fid];
  if (faction) faction.rulerId = heir.id;
  heir.factionId = fid;
  const capital = Object.hasOwn(draft.settlements, draft.player.capitalId) ? draft.player.capitalId : undefined;
  const role: CharacterRole = { kind: 'ruler', factionId: fid };
  if (capital !== undefined) role.holdingId = capital;
  heir.role = role;
  transferOffices(draft, previousId, heir.id, only !== undefined ? { only } : {});
  if (heir.location.kind === 'none' && capital !== undefined) heir.location = { kind: 'settlement', id: capital };
  refreshTitle(draft, ctx, heir);
}

/** House standing passes to the heir (§23.4): Renown ½ + own; Honor ½ + ½ own. */
function inheritStanding(draft: GameState, ctx: SimContext, heir: Character): void {
  const s = ctx.balance.dynasty.succession;
  const house = draft.player.house;
  const renown = Math.round(s.renownInherit * house.renown + (heir.personalRenown ?? 0));
  const honor = Math.round(s.honorInheritParent * house.honor + s.honorInheritOwn * (heir.personalHonor ?? 0));
  if (renown !== house.renown) ctx.applyEffects([{ op: 'changeRenown', amount: renown - house.renown }]);
  if (honor !== house.honor) ctx.applyEffects([{ op: 'changeHonor', amount: honor - house.honor }]);
}

/** Vassal, lieutenant and holding loyalty fall when the crown passes (§23.4). */
function successionLoyaltyHit(draft: GameState, ctx: SimContext): void {
  const hit = ctx.balance.dynasty.succession.loyaltyHit;
  if (hit === 0) return;
  const fid = draft.player.factionId;
  for (const id of Object.keys(draft.characters) as CharId[]) {
    const c = draft.characters[id];
    if (!c?.alive || c.factionId !== fid || c.id === draft.player.rulerId) continue;
    if (c.role && OFFICER_ROLES.includes(c.role.kind)) ctx.applyEffects([{ op: 'changeLoyalty', charId: id, amount: hit }]);
  }
  const faction = draft.factions[fid];
  if (!faction) return;
  for (const sid of faction.holdingIds) {
    if (draft.settlements[sid]?.holding) ctx.applyEffects([{ op: 'changeLoyalty', settlementId: sid, amount: hit }]);
  }
  for (const vassal of faction.vassalIds) {
    if (vassal !== fid) ctx.applyEffects([{ op: 'changeOpinion', a: fid, b: vassal, amount: hit, reason: 'succession', decayPerMonth: 1 }]);
  }
}

function emitSuccession(
  ctx: SimContext,
  factionId: FactionId,
  deceasedId: CharId,
  heirId: CharId,
  kind: SuccessionKind,
  isPlayer: boolean,
  regentId?: CharId,
): void {
  const e: {
    type: 'SuccessionOccurred';
    factionId: FactionId;
    deceasedId: CharId;
    heirId: CharId;
    kind: SuccessionKind;
    isPlayer: boolean;
    regentId?: CharId;
  } = { type: 'SuccessionOccurred', factionId, deceasedId, heirId, kind, isPlayer };
  if (regentId !== undefined) e.regentId = regentId;
  ctx.emit(e);
}

/** The house falls silent: no heir, no kin (game over; saga turns this into GameEnded). */
function houseFalls(draft: GameState, ctx: SimContext, deceased: Character): void {
  const ps = peopleState(draft);
  if (ps.houseFallen) return;
  ps.houseFallen = true;
  ctx.emit({ type: 'HouseFallsSilent', factionId: draft.player.factionId, deceasedId: deceased.id });
  ctx.notify('people.notify.houseFallen', { priority: 'critical', vars: nameVars(deceased), illustration: 'people.illus.houseFallen' });
  ctx.chronicle({ kind: 'houseFallen', textKey: 'people.chronicle.houseFallen', importance: 5, vars: nameVars(deceased), refs: [deceased.id] });
  ctx.narrate('people.narration.houseFallen', nameVars(deceased), 'skald');
}

/**
 * The player's ruler died (or the minor heir of a regency did; `reference` is then the ruler whose
 * family the crown passes through and `inherit` is false — the standing already passed once).
 */
function playerSuccession(
  draft: GameState,
  ctx: SimContext,
  reference: Character,
  inherit: boolean,
  keepRegentId?: CharId,
  offices?: readonly SettlementId[],
): void {
  const now = ctx.hour;
  const t = ctx.tunables.people;
  let kind: SuccessionKind = 'heir';
  let heirId = defaultHeir(draft, reference);
  if (heirId === undefined) {
    heirId = nearestAdultKin(draft, reference, now, ctx.content, t.kinSearchDepth);
    kind = 'kin';
  }
  if (heirId === undefined && t.spouseCanInherit) {
    heirId = livingSpouses(draft, reference).find((id) => {
      const s = charOf(draft, id);
      return s !== undefined && isAdultAt(s, now, ctx.content) && !(s.role?.kind === 'ruler' && s.role.factionId !== draft.player.factionId);
    });
    kind = 'spouse';
  }
  const heir = charOf(draft, heirId);
  if (!heir) {
    houseFalls(draft, ctx, reference);
    return;
  }
  if (inherit) inheritStanding(draft, ctx, heir);
  const previousId = draft.player.rulerId;
  if (isAdultAt(heir, now, ctx.content)) {
    installPlayerRuler(draft, ctx, heir, previousId, offices);
    if (inherit) successionLoyaltyHit(draft, ctx);
    emitSuccession(ctx, draft.player.factionId, reference.id, heir.id, kind, true);
    ctx.notify('people.notify.succession', { priority: 'critical', vars: { ...nameVars(heir), ...nameVars(reference, 'deceased') }, link: { kind: 'character', id: heir.id } });
    ctx.chronicle({
      kind: 'succession',
      textKey: 'people.chronicle.succession',
      importance: 4,
      vars: { ...nameVars(heir), ...nameVars(reference, 'deceased') },
      refs: [heir.id, reference.id],
    });
    const storylet = t.oathTakingStoryletId;
    if (storylet !== '') ctx.applyEffects([{ op: 'scheduleStorylet', storyletId: storylet, inDays: 0, scope: { kind: 'character', id: heir.id } }]);
    return;
  }
  // A minor heir: a regent rules; the player decides how (play as the regent, or skip ahead).
  const candidates = regentCandidates(draft, ctx, reference, heir);
  const regentId = keepRegentId !== undefined && candidates.includes(keepRegentId) ? keepRegentId : candidates[0];
  startRegency(draft, ctx, heir, reference, 'play', regentId, offices);
  if (inherit) successionLoyaltyHit(draft, ctx);
  emitSuccession(ctx, draft.player.factionId, reference.id, heir.id, 'regency', true, regentId);
  ctx.chronicle({
    kind: 'succession',
    textKey: 'people.chronicle.regency',
    importance: 4,
    vars: { ...nameVars(heir), ...nameVars(reference, 'deceased'), ...nameVars(charOf(draft, regentId), 'regent'), hasRegent: regentId !== undefined ? 'yes' : 'no' },
    refs: [heir.id, reference.id],
  });
  const payload: {
    deceasedId: CharId;
    heirId: CharId;
    candidates: CharId[];
    factionId: FactionId;
    minor: boolean;
    regentCandidates: CharId[];
    mode: RegencyMode;
    regentId?: CharId;
  } = {
    deceasedId: reference.id,
    heirId: heir.id,
    candidates: heirPool(draft, reference),
    factionId: draft.player.factionId,
    minor: true,
    regentCandidates: candidates,
    mode: 'play',
  };
  if (regentId !== undefined) payload.regentId = regentId;
  const decision = ctx.pend({ kind: 'succession', payload });
  // What the generic decision modal shows: the news and the two ways to hold the hall (they need the id).
  const p = decision.payload;
  p.titleKey = 'people.succession.title';
  p.illustration = 'people.illus.succession';
  p.key = 'people.succession.body';
  p.vars = { name: heir.name, deceasedName: reference.name };
  p.choices = (['play', 'skip'] as const).map((mode) => ({
    id: mode,
    labelKey: mode === 'play' ? 'people.succession.playAsRegent' : 'people.succession.skip',
    command: { type: 'designateHeir' as const, heirId: heir.id, pendingId: decision.id, regency: mode, ...(regentId !== undefined ? { regentId } : {}) },
    tone: mode === 'play' ? ('primary' as const) : ('secondary' as const),
  }));
}

// ---------------------------------------------------------------------------------------------
// Regency

/** Regent score: Stewardship × loyalty (kin and spouses count as loyal as the default). */
function regentScore(draft: GameState, ctx: SimContext, c: Character): number {
  const loyalty = c.loyalty ?? ctx.balance.defaults.characterLoyalty;
  return effectiveSkill(c, 'stewardship', ctx.content) * (loyalty / 100) + loyalty / 10000;
}

/** Possible regents (spouse, sibling or lieutenant), best Stewardship × loyalty first. */
export function regentCandidates(draft: GameState, ctx: SimContext, reference: Character, heir: Character): CharId[] {
  const now = ctx.hour;
  const pool: CharId[] = [];
  const add = (id: CharId) => {
    const c = charOf(draft, id);
    if (!c?.alive || c.id === heir.id || c.id === reference.id || pool.includes(id)) return;
    if (c.location.kind === 'captive' || !isAdultAt(c, now, ctx.content)) return;
    if (c.role?.kind === 'ruler' && c.role.factionId !== draft.player.factionId) return;
    pool.push(id);
  };
  for (const id of livingSpouses(draft, reference)) add(id);
  for (const id of siblingIds(draft, reference)) add(id);
  for (const id of siblingIds(draft, heir)) add(id);
  const fid = draft.player.factionId;
  for (const id of Object.keys(draft.characters) as CharId[]) {
    const c = draft.characters[id];
    if (c?.alive && c.factionId === fid && c.role && OFFICER_ROLES.includes(c.role.kind)) add(id);
  }
  const score: Record<string, number> = {};
  for (const id of pool) {
    const c = charOf(draft, id);
    score[id] = c ? regentScore(draft, ctx, c) : 0;
  }
  const eldest = byAgeDesc(draft);
  return pool.sort((a, b) => (score[b] ?? 0) - (score[a] ?? 0) || eldest(a, b));
}

/** Starts (or restarts) a regency: the regent becomes the acting ruler. */
function startRegency(
  draft: GameState,
  ctx: SimContext,
  heir: Character,
  reference: Character,
  mode: RegencyMode,
  regentId: CharId | undefined,
  only?: readonly SettlementId[],
): void {
  const ps = peopleState(draft);
  const fid = draft.player.factionId;
  const previousId = draft.player.rulerId;
  heir.factionId = fid;
  if (heir.role?.kind === 'ruler') delete heir.role;
  const regent = charOf(draft, regentId);
  const actingId = regent?.id ?? heir.id;
  ps.regency = { heirId: heir.id, mode, deceasedId: reference.id, sinceHour: ctx.hour };
  if (regent) {
    ps.regency.regentId = regent.id;
    if (regent.role) ps.regency.regentPrevRole = { ...regent.role };
    regent.factionId = fid;
    const capital = Object.hasOwn(draft.settlements, draft.player.capitalId) ? draft.player.capitalId : undefined;
    regent.role = capital !== undefined ? { kind: 'regent', factionId: fid, holdingId: capital } : { kind: 'regent', factionId: fid };
  } else {
    // No regent: the minor rules alone.
    const capital = Object.hasOwn(draft.settlements, draft.player.capitalId) ? draft.player.capitalId : undefined;
    heir.role = capital !== undefined ? { kind: 'ruler', factionId: fid, holdingId: capital } : { kind: 'ruler', factionId: fid };
  }
  draft.player.rulerId = actingId;
  const faction = draft.factions[fid];
  if (faction) faction.rulerId = actingId;
  const moved = transferOffices(draft, previousId, actingId, only !== undefined ? { only } : {});
  ps.regency.offices = only !== undefined && previousId === actingId ? [...only] : moved;
  setRegencyMode(draft, mode);
  const e: { type: 'RegencyStarted'; heirId: CharId; mode: RegencyMode; regentId?: CharId } = { type: 'RegencyStarted', heirId: heir.id, mode };
  if (regent) e.regentId = regent.id;
  ctx.emit(e);
  ctx.notify('people.notify.regency', {
    priority: 'critical',
    vars: { ...nameVars(heir), ...nameVars(regent, 'regent'), hasRegent: regent ? 'yes' : 'no' },
    link: { kind: 'character', id: heir.id },
  });
}

function setRegencyMode(draft: GameState, mode: RegencyMode): void {
  const ps = peopleState(draft);
  if (ps.regency) ps.regency.mode = mode;
  if (mode === 'skip') draft.flags[REGENCY_SKIP_FLAG] = true;
  else if (Object.hasOwn(draft.flags, REGENCY_SKIP_FLAG)) delete draft.flags[REGENCY_SKIP_FLAG];
}

/** Restores the regent's former role and clears the regency record (no ruler change). */
function endRegencyRecord(draft: GameState, ctx: SimContext): void {
  const ps = peopleState(draft);
  const r = ps.regency;
  if (!r) return;
  const regent = charOf(draft, r.regentId);
  if (regent?.alive) {
    if (r.regentPrevRole) regent.role = { ...r.regentPrevRole };
    else delete regent.role;
  }
  delete ps.regency;
  if (Object.hasOwn(draft.flags, REGENCY_SKIP_FLAG)) delete draft.flags[REGENCY_SKIP_FLAG];
  const e: { type: 'RegencyEnded'; heirId: CharId; regentId?: CharId } = { type: 'RegencyEnded', heirId: r.heirId };
  if (r.regentId !== undefined) e.regentId = r.regentId;
  ctx.emit(e);
}

/** The heir comes of age (or an adult candidate is chosen): the regency ends and the heir rules. */
export function endRegency(draft: GameState, ctx: SimContext, kind: SuccessionKind = 'comingOfAge'): void {
  const ps = peopleState(draft);
  const r = ps.regency;
  if (!r) return;
  const heir = charOf(draft, r.heirId);
  const actingId = draft.player.rulerId;
  const offices = r.offices ?? [];
  endRegencyRecord(draft, ctx);
  if (!heir?.alive) return;
  installPlayerRuler(draft, ctx, heir, actingId, offices);
  emitSuccession(ctx, draft.player.factionId, r.deceasedId, heir.id, kind, true, r.regentId);
  ctx.notify('people.notify.regencyEnded', { priority: 'critical', vars: nameVars(heir), link: { kind: 'character', id: heir.id } });
  chronicleHouse(ctx, heir, 'succession', 'people.chronicle.regencyEnded', 3);
}

/** The regent died: the next candidate takes over, or the minor rules alone. */
function replaceRegent(draft: GameState, ctx: SimContext, dead: Character): void {
  const ps = peopleState(draft);
  const r = ps.regency;
  if (!r) return;
  const heir = charOf(draft, r.heirId);
  const reference = charOf(draft, r.deceasedId);
  if (!heir?.alive || !reference) return;
  const next = regentCandidates(draft, ctx, reference, heir)[0];
  const regent = charOf(draft, next);
  const fid = draft.player.factionId;
  const actingId = regent?.id ?? heir.id;
  if (regent) {
    r.regentId = regent.id;
    if (regent.role) r.regentPrevRole = { ...regent.role };
    else delete r.regentPrevRole;
    regent.factionId = fid;
    regent.role = { kind: 'regent', factionId: fid };
  } else {
    delete r.regentId;
    delete r.regentPrevRole;
    heir.role = { kind: 'ruler', factionId: fid };
  }
  draft.player.rulerId = actingId;
  const faction = draft.factions[fid];
  if (faction) faction.rulerId = actingId;
  const moved = transferOffices(draft, dead.id, actingId);
  const offices = r.offices ?? [];
  for (const id of moved) pushUnique(offices, id);
  r.offices = offices;
  emitSuccession(ctx, fid, dead.id, heir.id, 'regentReplaced', true, regent?.id);
  ctx.notify('people.notify.regentReplaced', { priority: 'high', vars: { ...nameVars(heir), ...nameVars(regent, 'regent'), hasRegent: regent ? 'yes' : 'no' } });
}

/** Called on a character's coming of age: ends the regency when it is the heir's. */
export function onHeirComingOfAge(draft: GameState, ctx: SimContext, c: Character): void {
  if (peopleState(draft).regency?.heirId === c.id) endRegency(draft, ctx, 'comingOfAge');
}

/** Yearly risk events while an AI regent rules ("skip to coming of age"). */
export function yearlyRegencyRisks(draft: GameState, ctx: SimContext): void {
  const r = peopleState(draft).regency;
  if (!r || r.mode !== 'skip') return;
  const t = ctx.tunables.people.regency;
  const rng = ctx.rng(STREAMS.succession);
  if (!rng.chance(t.riskChancePerYear)) return;
  const fid = draft.player.factionId;
  const faction = draft.factions[fid];
  if (!faction) return;
  const pick = rng.int(0, 2);
  if (pick === 0 && t.treasuryLossShare > 0) {
    const loss = Math.floor(faction.treasury * t.treasuryLossShare);
    if (loss > 0) ctx.applyEffects([{ op: 'addSilver', amount: -loss, factionId: fid }]);
    ctx.notify('people.notify.regencyRisk', { priority: 'normal', vars: { risk: 'treasury', amount: loss } });
  } else if (pick === 1 && t.holdingLoyaltyLoss > 0) {
    for (const sid of faction.holdingIds) {
      if (draft.settlements[sid]?.holding) ctx.applyEffects([{ op: 'changeLoyalty', settlementId: sid, amount: -t.holdingLoyaltyLoss }]);
    }
    ctx.notify('people.notify.regencyRisk', { priority: 'normal', vars: { risk: 'holdings', amount: t.holdingLoyaltyLoss } });
  } else if (t.lieutenantLoyaltyLoss > 0) {
    for (const id of Object.keys(draft.characters) as CharId[]) {
      const c = draft.characters[id];
      if (c?.alive && c.factionId === fid && c.role && OFFICER_ROLES.includes(c.role.kind) && c.role.kind !== 'regent') {
        ctx.applyEffects([{ op: 'changeLoyalty', charId: id, amount: -t.lieutenantLoyaltyLoss }]);
      }
    }
    ctx.notify('people.notify.regencyRisk', { priority: 'normal', vars: { risk: 'lieutenants', amount: t.lieutenantLoyaltyLoss } });
  }
}

// ---------------------------------------------------------------------------------------------
// AI succession and vacant offices.

/** Successor among the deceased's family: designated heir, adult then minor children, adult kin, spouse. */
function familySuccessor(draft: GameState, ctx: SimContext, deceased: Character, factionId: FactionId | undefined): CharId | undefined {
  const now = ctx.hour;
  const usable = (id: CharId | undefined): id is CharId => {
    const c = charOf(draft, id);
    if (!c?.alive || c.id === draft.player.rulerId) return false;
    if (c.role?.kind === 'ruler' && c.role.factionId !== factionId) return false;
    if (c.role?.kind === 'regent') return false;
    return true;
  };
  if (usable(deceased.family.heirId)) return deceased.family.heirId;
  const children = [...childIds(draft, deceased)].sort(byAgeDesc(draft)).filter(usable);
  const adult = children.find((id) => {
    const c = charOf(draft, id);
    return c !== undefined && isAdultAt(c, now, ctx.content);
  });
  if (adult !== undefined) return adult;
  if (children[0] !== undefined) return children[0];
  const kin = nearestAdultKin(draft, deceased, now, ctx.content, ctx.tunables.people.kinSearchDepth);
  if (usable(kin)) return kin;
  return livingSpouses(draft, deceased).find((id) => {
    const c = charOf(draft, id);
    return usable(id) && c !== undefined && isAdultAt(c, now, ctx.content);
  });
}

/** A new character to fill an office when no family is left. */
function newOfficeHolder(draft: GameState, ctx: SimContext, factionId: FactionId, at: SettlementId | undefined, asRuler: boolean): Character {
  const faction = draft.factions[factionId];
  const settlement = at !== undefined ? draft.settlements[at] : undefined;
  const culture = settlement?.culture ?? faction?.culture ?? 'skarn';
  const faith = settlement?.faith ?? faction?.faith;
  const [lo, hi] = asRuler ? ctx.balance.defaults.rulerAge : ctx.balance.defaults.leaderAge;
  const role: CharacterRole = asRuler ? { kind: 'ruler', factionId } : { kind: 'npc', factionId };
  if (at !== undefined) role.holdingId = at;
  const c = createCharacter(draft, ctx, {
    culture,
    ...(faith !== undefined ? { faith } : {}),
    age: ctx.rng(STREAMS.succession).int(lo, hi),
    role,
    factionId,
    location: at !== undefined ? { kind: 'settlement', id: at } : { kind: 'none' },
  });
  c.agedTo = ageOf(c, ctx.hour);
  return c;
}

/** An AI ruler died: the family (or a new line) takes the high seat. */
function aiSuccession(draft: GameState, ctx: SimContext, deceased: Character, factionId: FactionId): void {
  const faction = draft.factions[factionId];
  if (!faction) return;
  const seat = factionSeat(draft, factionId) ?? faction.holdingIds[0];
  let kind: SuccessionKind = 'heir';
  let heir = charOf(draft, familySuccessor(draft, ctx, deceased, factionId));
  if (!heir) {
    heir = newOfficeHolder(draft, ctx, factionId, seat, true);
    kind = 'newLine';
  }
  faction.rulerId = heir.id;
  heir.factionId = factionId;
  const role: CharacterRole = { kind: 'ruler', factionId };
  const holdingId = deceased.role?.holdingId ?? seat;
  if (holdingId !== undefined) role.holdingId = holdingId;
  heir.role = role;
  transferOffices(draft, deceased.id, heir.id, { faction: factionId });
  if (heir.location.kind !== 'captive' && seat !== undefined && heir.location.kind !== 'settlement') heir.location = { kind: 'settlement', id: seat };
  emitSuccession(ctx, factionId, deceased.id, heir.id, kind, false);
}

/** Settlements whose leader or governor died get a successor (the player's ruler for player holdings). */
function fillVacantLeaders(draft: GameState, ctx: SimContext, dead: Character): void {
  for (const id of Object.keys(draft.settlements) as SettlementId[]) {
    const s = draft.settlements[id];
    if (!s) continue;
    if (s.holding && s.holding.governorId === dead.id) s.holding.governorId = draft.player.rulerId;
    if (s.leaderId !== dead.id) continue;
    let next: Character | undefined;
    if (s.factionId === draft.player.factionId) next = charOf(draft, draft.player.rulerId);
    else {
      const ruler = charOf(draft, draft.factions[s.factionId]?.rulerId);
      const famId = familySuccessor(draft, ctx, dead, s.factionId);
      const fam = charOf(draft, famId);
      if (fam && fam.role?.kind !== 'ruler' && (fam.factionId === undefined || fam.factionId === s.factionId)) {
        next = fam;
        fam.factionId = s.factionId;
        fam.role = { kind: 'npc', holdingId: id, factionId: s.factionId };
        if (fam.location.kind !== 'captive') fam.location = { kind: 'settlement', id };
      } else if (ruler?.alive && ruler.role?.holdingId === id) {
        next = ruler;
      } else {
        next = newOfficeHolder(draft, ctx, s.factionId, id, false);
      }
    }
    if (!next?.alive || next.id === dead.id) continue;
    s.leaderId = next.id;
    ctx.emit({ type: 'LeaderReplaced', settlementId: id, previousId: dead.id, leaderId: next.id });
  }
}

// ---------------------------------------------------------------------------------------------
// designateHeir (also resolves the succession decision)

/** `designateHeir`: name an heir, or (with `pendingId`) settle the succession and the regency. */
export const handleDesignateHeir: CommandHandler<'designateHeir'> = (draft, cmd, ctx) => {
  const ps = peopleState(draft);
  if (cmd.pendingId !== undefined) {
    const p = draft.pending;
    if (!p || p.id !== cmd.pendingId || p.kind !== 'succession') throw new CommandError('notPending', `'${cmd.pendingId}' is not a pending succession`);
    if (!p.payload.candidates.includes(cmd.heirId)) throw new CommandError('notCandidate', 'That character cannot inherit');
    const heir = charOf(draft, cmd.heirId);
    if (!heir?.alive) throw new CommandError('dead', 'That heir is dead');
    const r = ps.regency;
    const offices = r?.offices;
    const reference = charOf(draft, p.payload.deceasedId);
    if (isAdultAt(heir, ctx.hour, ctx.content)) {
      if (r) endRegencyRecord(draft, ctx);
      installPlayerRuler(draft, ctx, heir, draft.player.rulerId, offices);
      emitSuccession(ctx, draft.player.factionId, p.payload.deceasedId, heir.id, 'heir', true);
      ctx.resolvePending(p.id);
      return;
    }
    const regentCandidatesList = p.payload.regentCandidates ?? [];
    if (cmd.regentId !== undefined && !regentCandidatesList.includes(cmd.regentId)) throw new CommandError('notRegentCandidate', 'That character cannot be regent');
    const mode: RegencyMode = cmd.regency ?? 'play';
    const wantedRegent = cmd.regentId ?? r?.regentId;
    if (reference && (!r || r.heirId !== heir.id || r.regentId !== wantedRegent)) {
      if (r) endRegencyRecord(draft, ctx);
      const regent = charOf(draft, wantedRegent);
      startRegency(draft, ctx, heir, reference, mode, regent?.alive ? regent.id : undefined, offices);
    } else {
      setRegencyMode(draft, mode);
    }
    ctx.resolvePending(p.id);
    if (mode === 'skip') skipToComingOfAge(draft, ctx, heir);
    return;
  }
  if (ps.regency) {
    // During a regency the only choice left is how it runs: play as the regent, or skip ahead
    // (again, after another decision interrupted the skip).
    const r = ps.regency;
    if (cmd.heirId !== r.heirId || cmd.regency === undefined) throw new CommandError('inRegency', 'The succession is already settled by the regency');
    if (draft.pending !== null) throw new CommandError('pendingDecision', 'Resolve the pending decision first');
    const heir = charOf(draft, r.heirId);
    if (!heir?.alive) throw new CommandError('dead', 'That heir is dead');
    setRegencyMode(draft, cmd.regency);
    ctx.notify('people.notify.regencyMode', { priority: 'normal', vars: { ...nameVars(heir), mode: cmd.regency } });
    if (cmd.regency === 'skip') skipToComingOfAge(draft, ctx, heir);
    return;
  }
  const ruler = charOf(draft, draft.player.rulerId);
  if (!ruler?.alive) throw new CommandError('noRuler', 'There is no living ruler');
  if (!heirPool(draft, ruler).includes(cmd.heirId)) throw new CommandError('notEligible', 'Only a child, sibling, niece, nephew or adopted child may be named heir');
  ruler.family.heirId = cmd.heirId;
  ctx.emit({ type: 'HeirDesignated', rulerId: ruler.id, heirId: cmd.heirId });
  const heir = charOf(draft, cmd.heirId);
  if (heir) notifyHouse(ctx, heir, 'people.notify.heirDesignated');
};

/** Runs the world forward until the heir comes of age (stops at any decision that needs the player). */
function skipToComingOfAge(draft: GameState, ctx: SimContext, heir: Character): void {
  const until = hourOfAge(heir, ctx.balance.character.adultAge);
  const hours = until - ctx.hour;
  if (hours <= 0) return;
  runTicks(draft, hours, ctx, () => peopleState(draft).regency === undefined);
}

/** Living members of the player's house who could be named heir now (for the UI). */
export function heirCandidates(state: GameState): CharId[] {
  const ruler = charOf(state, state.player.rulerId);
  return ruler ? heirPool(state, ruler) : [];
}
