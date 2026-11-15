/**
 * Lieutenants (hersir, §12.5): capacity by Hall tier (+ crowns), hiring sellswords in mead-halls
 * (deterministic monthly offers with backstories, traits and a loyalty of 40), promoting veterans of
 * squads with ≥3 battles, the monthly loyalty drift from the drivers the module can observe
 * (victories, defeats, governorships, honour alignment, ambition, the ruler's `loyalty.lieutenants`
 * modifiers) and desertion or defection below 20. Role assignment itself is the people module's
 * `assignRole`; the helpers here tell the client who is available.
 */
import type { Content } from '@content/index';
import type { CultureId, SkillId } from '@content/schemas/ids';
import { CommandError } from '@sim/core/commands';
import { baseState } from '@sim/core/context';
import { clamp } from '@sim/core/dmath';
import type { SimEventOf } from '@sim/core/events';
import { createCharacter, generatePersonalName } from '@sim/core/factory';
import type { SimContext } from '@sim/core/module';
import { Rng, type RandomSource } from '@sim/core/rng';
import type { Attributes, Character, CharacterLocation, CharId, FactionId, GameState, Hour, RoleKind, SettlementId } from '@sim/core/state';
import { HOURS_PER_MONTH, HOURS_PER_YEAR } from '@sim/core/time';
import { resolveContainer, type MenContainer } from './men';
import { buildingNumber, buildingTier, distance, factionCapitalId, isKinOf, realmModifier, recNum } from './realm';
import { militaryOf } from './slice';
import type { HireSellswordCommand, MenContainerRef, PromoteLieutenantCommand } from './types';
import { findUnit } from './units';

/** Characters serving a faction in a lieutenant role (alive, not the ruler), in state order. */
export function lieutenantsOf(state: GameState, content: Content, factionId: FactionId): Character[] {
  const roles = content.tunables.military.lieutenants.roles;
  const rulerId = state.factions[factionId]?.rulerId;
  const out: Character[] = [];
  for (const id in state.characters) {
    const c = state.characters[id as CharId];
    if (!c || !c.alive || c.factionId !== factionId || c.id === rulerId) continue;
    if (c.role && roles.includes(c.role.kind)) out.push(c);
  }
  return out;
}

/** Number of `crown:<kingdom>` flags (each crown adds Hall capacity, §12.5). */
export function crownCount(state: GameState, prefix: string): number {
  let n = 0;
  for (const key of Object.keys(state.flags)) {
    if (!key.startsWith(prefix)) continue;
    const v = state.flags[key];
    if (v !== false && v !== 0 && v !== '') n += 1;
  }
  return n;
}

/** Lieutenant capacity: the capital Hall tier's capacity (2/4/7) + 1 per crown. */
export function lieutenantCapacity(
  state: GameState,
  content: Content,
  factionId: FactionId,
): { capacity: number; used: number; free: number; hallTier: number; crowns: number } {
  const t = content.tunables.military.lieutenants;
  const capital = factionCapitalId(state, factionId);
  const hallTier = buildingTier(capital !== undefined ? state.settlements[capital] : undefined, 'hall');
  const crowns = factionId === state.player.factionId ? crownCount(state, t.crownFlagPrefix) : 0;
  const capacity = buildingNumber(content.balance, 'hall', hallTier, 'lieutenantCapacity') + crowns * content.balance.holdings.lieutenantCapacityPerCrown;
  const rulerId = state.factions[factionId]?.rulerId;
  let used = 0;
  for (const c of lieutenantsOf(state, content, factionId)) {
    if (!t.countKinInCapacity && rulerId !== undefined && isKinOf(state, c.id, rulerId)) continue;
    used += 1;
  }
  return { capacity, used, free: Math.max(0, capacity - used), hallTier, crowns };
}

/**
 * Who can take a role (for the people module's `assignRole` on the client): the faction's
 * lieutenants and adult kin of the ruler who are alive, free (not captive) and not already in that role.
 */
export function candidatesForRole(state: GameState, content: Content, factionId: FactionId, role: RoleKind): Character[] {
  const rulerId = state.factions[factionId]?.rulerId;
  const adultHours = content.balance.character.adultAge * HOURS_PER_YEAR;
  const out: Character[] = [];
  for (const id in state.characters) {
    const c = state.characters[id as CharId];
    if (!c || !c.alive || c.id === rulerId || c.location.kind === 'captive' || c.health.wound === 'mortal') continue;
    if (state.time.hour - c.birthHour < adultHours) continue;
    const serves = c.factionId === factionId && c.role !== undefined && content.tunables.military.lieutenants.roles.includes(c.role.kind);
    const kin = rulerId !== undefined && isKinOf(state, c.id, rulerId);
    if (!serves && !kin) continue;
    if (c.role?.kind === role) continue;
    out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Sellswords

/** One sellsword offered in a mead-hall this month (deterministic; previewable by the client). */
export interface SellswordOffer {
  index: number;
  settlementId: SettlementId;
  /** Absolute month index (hour / 720). */
  month: number;
  name: string;
  sex: 'male' | 'female';
  culture: CultureId;
  age: number;
  level: number;
  attributes: Attributes;
  skills: Partial<Record<SkillId, number>>;
  traits: string[];
  backstory: string;
  /** Locale key of the backstory text. */
  backstoryKey: string;
  price: number;
  portraitSeed: number;
  hired: boolean;
}

/** True if the settlement's mead-hall has sellswords (a mead-hall building or a large settlement tier). */
export function hasSellswords(state: GameState, content: Content, settlementId: SettlementId): boolean {
  const s = state.settlements[settlementId];
  if (!s) return false;
  return buildingTier(s, 'meadhall') > 0 || content.tunables.military.sellswords.settlementTiers.includes(s.tier);
}

/** Absolute month index of an hour. */
export function absoluteMonth(hour: Hour): number {
  return Math.floor(hour / HOURS_PER_MONTH);
}

function offerKey(settlementId: SettlementId, month: number, index: number): string {
  return `${settlementId}|${month}|${index}`;
}

function distributePoints(rng: RandomSource, skills: readonly SkillId[], points: number, max: number, weighted: boolean): Partial<Record<SkillId, number>> {
  const out: Partial<Record<SkillId, number>> = {};
  const weights = skills.map((_, i) => (weighted ? skills.length - i : 1));
  for (let p = 0; p < points; p++) {
    const skill = rng.weighted(skills, (s, i) => ((out[s] ?? 0) < max ? (weights[i] ?? 0) : 0));
    if (skill === undefined) break;
    out[skill] = (out[skill] ?? 0) + 1;
  }
  return out;
}

function pickTraits(rng: RandomSource, content: Content, pool: readonly string[], n: number): string[] {
  const out: string[] = [];
  for (const t of rng.shuffle([...pool])) {
    if (out.length >= n) break;
    const def = Object.hasOwn(content.traits, t) ? content.traits[t] : undefined;
    if (!def) continue;
    if (out.some((o) => o === def.opposite || content.traits[o]?.opposite === t)) continue;
    out.push(t);
  }
  return out;
}

/**
 * This month's sellswords at a settlement's mead-hall. Generated from a generator seeded by the
 * campaign seed, the settlement and the month — pure and identical for the client preview and the
 * `hireSellsword` handler. Empty when the mead-hall has no sellswords.
 */
export function sellswordOffers(state: GameState, content: Content, settlementId: SettlementId): SellswordOffer[] {
  const s = state.settlements[settlementId];
  if (!s || !hasSellswords(state, content, settlementId)) return [];
  const t = content.tunables.military.sellswords;
  const balance = content.balance;
  const month = absoluteMonth(state.time.hour);
  const rng = new Rng(`${state.meta.seed}|military:sellswords|${settlementId}|${month}`);
  const hired = state.military?.hiredOffers ?? {};
  const count = rng.int(t.offers[0], t.offers[1]);
  const [ageLo, ageHi] = content.tunables.military.lieutenantAge;
  const [costLo, costHi] = balance.recruit.sellswordCost;
  const [lvlLo, lvlHi] = t.level;
  const ch = balance.character;
  const out: SellswordOffer[] = [];
  for (let index = 0; index < count; index++) {
    const foreign = rng.chance(t.foreignChance);
    const choices = t.foreignCultures.filter((c) => c !== s.culture);
    const culture: CultureId = foreign && choices.length > 0 ? rng.pick(choices) : s.culture;
    const sex: 'male' | 'female' = rng.chance(t.femaleChance) ? 'female' : 'male';
    const level = rng.int(lvlLo, lvlHi);
    const age = rng.int(Math.ceil(ageLo), Math.max(Math.ceil(ageLo), Math.floor(ageHi)));
    const attr = () => clamp(ch.attributeStart + rng.int(t.attributeSpread[0], t.attributeSpread[1]), ch.attributeMin, ch.attributeMax);
    const attributes: Attributes = { might: attr(), agility: attr(), wits: attr(), vigor: attr() };
    const points = t.skillPointsBase + t.skillPointsPerLevel * (level - 1);
    const skills = distributePoints(rng, t.skills, points, ch.skillMax, false);
    const traits = pickTraits(rng, content, t.traitPool, rng.int(t.traitCount[0], t.traitCount[1]));
    const backstory = rng.pick(t.backstories);
    const frac = lvlHi > lvlLo ? (level - lvlLo) / (lvlHi - lvlLo) : 0;
    const raw = (costLo + (costHi - costLo) * frac) * (1 + rng.range(-t.priceNoise, t.priceNoise));
    const price = clamp(Math.round(raw / t.priceRound) * t.priceRound, costLo, costHi);
    const name = generatePersonalName(rng, content.cultures[culture].naming, sex);
    const portraitSeed = rng.u32();
    out.push({
      index,
      settlementId,
      month,
      name,
      sex,
      culture,
      age,
      level,
      attributes,
      skills,
      traits,
      backstory,
      backstoryKey: `military.backstory.${backstory}`,
      price,
      portraitSeed,
      hired: Object.hasOwn(hired, offerKey(settlementId, month, index)),
    });
  }
  return out;
}

/** True if the player's ruler is at the settlement, or aboard a fleet in its harbour (not sailing). */
export function playerPresentAt(state: GameState, content: Content, settlementId: SettlementId): boolean {
  const ruler = state.characters[state.player.rulerId];
  const s = state.settlements[settlementId];
  if (!ruler || !s) return false;
  const loc = ruler.location;
  if (loc.kind === 'settlement') return loc.id === settlementId;
  if (loc.kind === 'fleet') {
    const f = state.fleets[loc.id];
    return f !== undefined && f.mode !== 'sailing' && distance(f.pos, s.mapPos) <= content.tunables.military.dockRadius;
  }
  return false;
}

export type HireIssue = 'noSellswords' | 'notPresent' | 'unknownOffer' | 'alreadyHired' | 'capacity' | 'treasury';

/** Validation of `hireSellsword` (pure). */
export function hireIssues(state: GameState, content: Content, cmd: HireSellswordCommand): { offer?: SellswordOffer; issues: HireIssue[] } {
  const issues: HireIssue[] = [];
  if (!hasSellswords(state, content, cmd.settlementId)) return { issues: ['noSellswords'] };
  if (!playerPresentAt(state, content, cmd.settlementId)) issues.push('notPresent');
  const offer = sellswordOffers(state, content, cmd.settlementId).find((o) => o.index === cmd.offer);
  if (!offer) return { issues: [...issues, 'unknownOffer'] };
  if (offer.hired) issues.push('alreadyHired');
  if (lieutenantCapacity(state, content, state.player.factionId).free <= 0) issues.push('capacity');
  if (offer.price > (state.factions[state.player.factionId]?.treasury ?? 0)) issues.push('treasury');
  return { offer, issues };
}

/** `hireSellsword` handler. */
export function handleHireSellsword(draft: GameState, cmd: HireSellswordCommand, ctx: SimContext): void {
  const { offer, issues } = hireIssues(draft, ctx.content, cmd);
  const first = issues[0];
  if (first || !offer) throw new CommandError(first ?? 'unknownOffer', `hireSellsword rejected: ${first ?? 'unknownOffer'}`);
  const factionId = draft.player.factionId;
  ctx.applyEffects([{ op: 'addSilver', amount: -offer.price, factionId }]);
  const c = createCharacter(draft, ctx, {
    culture: offer.culture,
    sex: offer.sex,
    name: offer.name,
    age: offer.age,
    attributes: offer.attributes,
    skills: offer.skills,
    traits: offer.traits,
    level: offer.level,
    location: { kind: 'settlement', id: cmd.settlementId },
    role: { kind: 'lieutenant', factionId },
    factionId,
    loyalty: ctx.balance.recruit.sellswordLoyalty,
  });
  c.portrait = { seed: offer.portraitSeed };
  c.backstory = offer.backstory;
  c.serviceSinceHour = ctx.hour;
  militaryOf(draft).hiredOffers[offerKey(cmd.settlementId, offer.month, offer.index)] = ctx.hour;
  ctx.emit({ type: 'LieutenantJoined', charId: c.id, factionId, source: 'sellsword', cost: offer.price });
  ctx.notify('military.lieutenant.hired', { vars: { name: c.name, price: offer.price }, link: { kind: 'character', id: c.id } });
}

/** Drops hired-offer records older than `historyMonths`. */
export function pruneHiredOffers(draft: GameState, ctx: SimContext): void {
  const m = militaryOf(draft);
  const keep = absoluteMonth(ctx.hour) - ctx.tunables.military.sellswords.historyMonths;
  for (const key of Object.keys(m.hiredOffers)) {
    const month = Number(key.split('|')[1]);
    if (!Number.isFinite(month) || month < keep) delete m.hiredOffers[key];
  }
}

// ---------------------------------------------------------------------------------------------
// Promoting veterans

export type PromoteIssue = 'badSource' | 'notYours' | 'unknownUnit' | 'noMen' | 'tooGreen' | 'capacity' | 'treasury';

/** The container, the battles of its men of `unit` and whether the promotion is allowed (pure checks). */
export function promoteIssues(state: GameState, content: Content, cmd: PromoteLieutenantCommand): { battles: number; issues: PromoteIssue[] } {
  const issues: PromoteIssue[] = [];
  const refs = [cmd.settlementId, cmd.fleetId, cmd.armyId].filter((x) => x !== undefined).length;
  if (refs !== 1) return { battles: 0, issues: ['badSource'] };
  if (!findUnit(content.balance, cmd.unit)) return { battles: 0, issues: ['unknownUnit'] };
  const factionId = state.player.factionId;
  let owner: FactionId | undefined;
  let men = 0;
  let battles = 0;
  if (cmd.settlementId !== undefined) {
    const s = state.settlements[cmd.settlementId];
    owner = s?.factionId;
    men = recNum(s?.garrison, cmd.unit);
    battles = recNum(s?.vetBattles, cmd.unit);
  } else if (cmd.fleetId !== undefined) {
    const f = state.fleets[cmd.fleetId];
    owner = f?.ownerId;
    men = recNum(f?.men, cmd.unit);
    battles = recNum(f?.vetBattles, cmd.unit);
  } else if (cmd.armyId !== undefined) {
    const a = state.armies[cmd.armyId];
    owner = a?.ownerId;
    for (const sq of a?.squads ?? []) {
      if (sq.unit !== cmd.unit || sq.men <= 0) continue;
      men += sq.men;
      battles = Math.max(battles, sq.battles ?? 0);
    }
  }
  if (owner !== factionId) issues.push('notYours');
  if (men <= 0) issues.push('noMen');
  if (battles < content.balance.recruit.promoteVeteranBattles) issues.push('tooGreen');
  if (lieutenantCapacity(state, content, factionId).free <= 0) issues.push('capacity');
  if (content.balance.recruit.promoteVeteranCost > (state.factions[factionId]?.treasury ?? 0)) issues.push('treasury');
  return { battles, issues };
}

function locationOf(c: MenContainer): CharacterLocation {
  if (c.kind === 'fleet') return { kind: 'fleet', id: c.id as `flt_${string}` };
  if (c.kind === 'army') return { kind: 'army', id: c.id as `arm_${string}` };
  return { kind: 'settlement', id: c.id as SettlementId };
}

/** `promoteLieutenant` handler: one veteran leaves the ranks and becomes a level 1–3 lieutenant. */
export function handlePromoteLieutenant(draft: GameState, cmd: PromoteLieutenantCommand, ctx: SimContext): void {
  const { battles, issues } = promoteIssues(draft, ctx.content, cmd);
  const first = issues[0];
  if (first) throw new CommandError(first, `promoteLieutenant rejected: ${first}`);
  const factionId = draft.player.factionId;
  const ref: MenContainerRef = {};
  if (cmd.settlementId !== undefined) ref.settlementId = cmd.settlementId;
  if (cmd.fleetId !== undefined) ref.fleetId = cmd.fleetId;
  if (cmd.armyId !== undefined) ref.armyId = cmd.armyId;
  const container = resolveContainer(draft, ctx.content, ref, 'promoteLieutenant');
  const balance = ctx.balance;
  const vt = ctx.tunables.military.veterans;
  const rng = ctx.rng('military:veterans');
  const [lo, hi] = balance.recruit.promoteVeteranLevel;
  const level = clamp(rng.int(Math.ceil(lo), Math.floor(hi)) + (battles >= vt.levelBonusBattles ? 1 : 0), Math.ceil(lo), Math.floor(hi));
  const [ageLo, ageHi] = ctx.tunables.military.lieutenantAge;
  const age = rng.int(Math.ceil(ageLo), Math.max(Math.ceil(ageLo), Math.floor(ageHi)));
  const skills = distributePoints(rng, vt.skills, vt.skillPointsBase + vt.skillPointsPerLevel * (level - 1), balance.character.skillMax, true);
  const traits = rng.chance(vt.traitChance) ? pickTraits(rng, ctx.content, vt.traitPool, 1) : [];
  const sex: 'male' | 'female' = rng.chance(ctx.tunables.military.sellswords.femaleChance) ? 'female' : 'male';
  let culture: CultureId = draft.factions[factionId]?.culture ?? 'skarn';
  if (container.kind === 'settlement') culture = draft.settlements[container.id as SettlementId]?.culture ?? culture;
  else if (container.homeId !== undefined) culture = draft.settlements[container.homeId]?.culture ?? culture;
  ctx.applyEffects([{ op: 'addSilver', amount: -balance.recruit.promoteVeteranCost, factionId }]);
  const army = cmd.armyId !== undefined ? draft.armies[cmd.armyId] : undefined;
  if (army) {
    // The veteran comes from the most experienced squad of that unit type.
    let best: (typeof army.squads)[number] | undefined;
    for (const sq of army.squads) if (sq.unit === cmd.unit && sq.men > 0 && (best === undefined || (sq.battles ?? 0) > (best.battles ?? 0))) best = sq;
    if (best) best.men -= 1;
    army.squads = army.squads.filter((sq) => sq.men > 0);
  } else container.remove(cmd.unit, 1);
  const c = createCharacter(draft, ctx, {
    culture,
    sex,
    age,
    skills,
    traits,
    level,
    location: locationOf(container),
    role: { kind: 'lieutenant', factionId },
    factionId,
    loyalty: balance.defaults.lieutenantLoyalty,
  });
  c.serviceSinceHour = ctx.hour;
  ctx.emit({ type: 'LieutenantJoined', charId: c.id, factionId, source: 'veteran', cost: balance.recruit.promoteVeteranCost });
  ctx.notify('military.lieutenant.promoted', { vars: { name: c.name, unit: cmd.unit }, link: { kind: 'character', id: c.id } });
}

// ---------------------------------------------------------------------------------------------
// Monthly loyalty drift and desertion

/** The monthly loyalty change of one lieutenant from the observable §12.5 drivers (pure). */
export function lieutenantLoyaltyDelta(state: GameState, content: Content, c: Character): number {
  const t = content.tunables.military.lieutenants;
  const factionId = c.factionId;
  if (factionId === undefined) return 0;
  const loyalty = c.loyalty ?? content.balance.defaults.characterLoyalty;
  const target = t.driftTarget + realmModifier(state, content, factionId, 'loyalty.lieutenants');
  const diff = target - loyalty;
  let delta = Math.sign(diff) * Math.min(t.drift, Math.abs(diff));
  if (factionId === state.player.factionId) {
    const mb = state.military?.monthBattles ?? { won: 0, lost: 0 };
    delta += Math.min(t.victoryMax, t.victory * mb.won);
    delta += Math.max(t.defeatMax, t.defeat * mb.lost);
    if (c.traits.includes('honest')) {
      const honor = state.player.house.honor;
      if (honor >= t.honestHighHonorAt) delta += t.honestHighHonor;
      else if (honor <= t.honestLowHonorAt) delta += t.honestLowHonor;
    }
  }
  const governs = c.role?.kind === 'governor';
  if (governs) delta += t.governor;
  else if (c.traits.includes('ambitious')) delta += t.ambitiousIdle;
  return delta;
}

function leadsSomething(state: GameState, charId: CharId): boolean {
  for (const id in state.fleets) if (state.fleets[id as keyof typeof state.fleets]?.leaderId === charId) return true;
  for (const id in state.armies) if (state.armies[id as keyof typeof state.armies]?.leaderId === charId) return true;
  return false;
}

function desert(draft: GameState, ctx: SimContext, charId: CharId, rng: RandomSource): void {
  const c = draft.characters[charId];
  if (!c || c.factionId === undefined) return;
  const t = ctx.tunables.military.lieutenants;
  const fromFaction = c.factionId;
  const nemesis = draft.player.nemesis;
  const rival = nemesis && !nemesis.ended && draft.factions[nemesis.factionId] && nemesis.factionId !== fromFaction ? nemesis.factionId : undefined;
  const defect = rival !== undefined && rng.chance(t.defectChance);
  const rulerId = draft.factions[fromFaction]?.rulerId;
  for (const id of draft.factions[fromFaction]?.holdingIds ?? []) {
    const h = draft.settlements[id]?.holding;
    if (h && h.governorId === charId && rulerId !== undefined) h.governorId = rulerId;
  }
  for (const id in draft.fleets) {
    const f = draft.fleets[id as keyof typeof draft.fleets];
    if (f && f.lieutenantIds.includes(charId)) f.lieutenantIds = f.lieutenantIds.filter((x) => x !== charId);
  }
  if (c.location.kind === 'fleet' || c.location.kind === 'army') c.location = { kind: 'none' };
  const loyalty = c.loyalty ?? 0;
  if (defect && rival !== undefined) {
    c.factionId = rival;
    c.role = { kind: 'lieutenant', factionId: rival };
    c.loyalty = t.defectorLoyalty;
  } else {
    delete c.factionId;
    c.role = { kind: 'npc' };
  }
  const event: SimEventOf<'LieutenantDeserted'> = { type: 'LieutenantDeserted', charId, factionId: fromFaction, loyalty };
  if (defect && rival !== undefined) event.toFactionId = rival;
  ctx.emit(event);
  if (fromFaction === draft.player.factionId) {
    ctx.notify(defect ? 'military.lieutenant.defected' : 'military.lieutenant.deserted', {
      priority: 'high',
      vars: { name: c.name },
      link: { kind: 'character', id: charId },
      illustration: 'military.illus.desertion',
    });
    ctx.chronicle({
      kind: 'military.desertion',
      textKey: defect ? 'military.chronicle.defected' : 'military.chronicle.deserted',
      importance: 2,
      vars: { name: c.name },
      refs: [charId],
    });
  }
}

/** Monthly: the player's lieutenants drift in loyalty; those below the threshold may desert or defect. */
export function monthlyLieutenants(draft: GameState, ctx: SimContext): void {
  const factionId = draft.player.factionId;
  const faction = draft.factions[factionId];
  const m = militaryOf(draft);
  if (!faction) {
    m.monthBattles = { won: 0, lost: 0 };
    return;
  }
  const t = ctx.tunables.military.lieutenants;
  const threshold = ctx.balance.loyalty.lieutenantDesertBelow;
  const rng = ctx.rng('military:loyalty');
  const roles = t.roles;
  const chars = baseState(draft.characters);
  const ids: CharId[] = [];
  for (const id in chars) {
    const c = chars[id as CharId];
    if (c && c.alive && c.factionId === factionId && c.id !== faction.rulerId && c.role && roles.includes(c.role.kind)) ids.push(id as CharId);
  }
  for (const id of ids) {
    const c = draft.characters[id];
    if (!c) continue;
    const delta = lieutenantLoyaltyDelta(draft, ctx.content, c);
    if (delta !== 0) ctx.applyEffects([{ op: 'changeLoyalty', charId: id, amount: delta }]);
    const loyalty = draft.characters[id]?.loyalty ?? ctx.balance.defaults.characterLoyalty;
    if (loyalty >= threshold || c.location.kind === 'captive' || leadsSomething(draft, id)) continue;
    const kin = isKinOf(draft, id, faction.rulerId);
    const chance = clamp((t.desertBase + t.desertPerPoint * (threshold - loyalty)) * (kin ? t.kinDesertMult : 1), 0, 1);
    if (rng.chance(chance)) desert(draft, ctx, id, rng);
  }
  m.monthBattles = { won: 0, lost: 0 };
}
