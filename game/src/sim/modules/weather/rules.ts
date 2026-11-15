/**
 * The fleet side of a storm (design §8.4, §31.3): who is aboard and how good a seaman the party is,
 * the chance a cell that reaches the fleet catches it, the severity roll, and the consequences as
 * effect data (core addRations/addGoods/addSilver, military killMen/damageShip/sinkShip).
 *
 * Pure functions; the systems pass drafts, base state or snapshots. Effects are built as plain
 * `EffectData` so this module needs no compile-time link to the military module's op types.
 */
import type { Content } from '@content/index';
import type { Balance } from '@content/schemas/balance';
import type { Tunables as WeatherTunables } from '@content/schemas/tunables/weather';
import type { EffectData } from '@sim/core/effects';
import type { RandomSource } from '@sim/core/rng';
import type { Character, CharId, FactionId, FleetId, GameState, GoodId, Hour, OmenId, ShipId, ShipTypeId } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import type { StormSeverity } from './types';

/** Reads a character from whatever state view the caller has (draft, base state, frozen state). */
export type CharLookup = (id: CharId) => Character | undefined;

const OMENS: readonly OmenId[] = ['ill', 'uncertain', 'fair', 'blessed'];

// ---------------------------------------------------------------------------------------------
// The party aboard.

type Bag = Record<string, number> | undefined;

/** Σ of a dotted modifier over a character's traits, feats and culture bonuses. */
export function characterModifier(content: Content, c: Character, key: string): number {
  let v = 0;
  const traits = content.traits as Record<string, { modifiers?: Bag } | undefined>;
  const feats = content.feats as Record<string, { modifiers?: Bag } | undefined>;
  for (const id of c.traits) {
    const m = Object.hasOwn(traits, id) ? traits[id]?.modifiers : undefined;
    if (m !== undefined && typeof m[key] === 'number') v += m[key];
  }
  for (const id of c.feats) {
    const m = Object.hasOwn(feats, id) ? feats[id]?.modifiers : undefined;
    if (m !== undefined && typeof m[key] === 'number') v += m[key];
  }
  const cultures = content.cultures as Record<string, { bonuses?: { modifiers: Bag }[] } | undefined>;
  const culture = Object.hasOwn(cultures, c.culture) ? cultures[c.culture] : undefined;
  for (const b of culture?.bonuses ?? []) {
    const m = b.modifiers;
    if (m !== undefined && typeof m[key] === 'number') v += m[key];
  }
  return v;
}

/** A character's Seafaring with trait, feat and culture modifiers (never below 0). */
export function effectiveSeafaring(content: Content, c: Character): number {
  const base = (c.skills as Record<string, number | undefined>).seafaring ?? 0;
  return Math.max(0, base + characterModifier(content, c, 'skill.seafaring'));
}

/** Fields of a fleet the party rules read. */
export interface FleetCrewRef {
  id: FleetId;
  leaderId: CharId;
  lieutenantIds: readonly CharId[];
}

/**
 * Ids of the characters aboard a fleet: its leader, its lieutenants and the player's ruler when the
 * ruler's location is this fleet (alive and not captive; no duplicates).
 */
export function aboardIds(fleet: FleetCrewRef, lookup: CharLookup, rulerId?: CharId): CharId[] {
  const out: CharId[] = [];
  const add = (id: CharId | undefined) => {
    if (id === undefined || out.includes(id)) return;
    const c = lookup(id);
    if (c === undefined || !c.alive || c.location.kind === 'captive') return;
    out.push(id);
  };
  add(fleet.leaderId);
  for (const id of fleet.lieutenantIds) add(id);
  if (rulerId !== undefined) {
    const r = lookup(rulerId);
    if (r !== undefined && r.location.kind === 'fleet' && r.location.id === fleet.id) add(rulerId);
  }
  return out;
}

/** What the people aboard bring to a storm. */
export interface PartyInfo {
  /** Best effective Seafaring aboard (§8.4 "party Seafaring"). */
  seafaring: number;
  /** Best (lowest) `storm.chancePct` aboard (Sea-Wise −20). */
  chancePct: number;
  /** Best (lowest) `storm.damagePct` aboard (Sea-Born −20). */
  damagePct: number;
  /** Best (highest) `storm.warningHours` aboard (Far-Seer +24). */
  warningHours: number;
}

/** The party's storm numbers (all zero for a fleet with nobody aboard). */
export function partyInfo(content: Content, fleet: FleetCrewRef, lookup: CharLookup, rulerId?: CharId): PartyInfo {
  const ids = aboardIds(fleet, lookup, rulerId);
  if (ids.length === 0) return { seafaring: 0, chancePct: 0, damagePct: 0, warningHours: 0 };
  let seafaring = 0;
  let chancePct = Infinity;
  let damagePct = Infinity;
  let warningHours = -Infinity;
  for (const id of ids) {
    const c = lookup(id) as Character;
    seafaring = Math.max(seafaring, effectiveSeafaring(content, c));
    chancePct = Math.min(chancePct, characterModifier(content, c, 'storm.chancePct'));
    damagePct = Math.min(damagePct, characterModifier(content, c, 'storm.damagePct'));
    warningHours = Math.max(warningHours, characterModifier(content, c, 'storm.warningHours'));
  }
  return { seafaring, chancePct, damagePct, warningHours };
}

/**
 * How far ahead (hours) the party sees a storm coming (§8.4, §31.3): at Seafaring ≥ the warning
 * minimum, from the low end of `earlyWarningHours` rising with Seafaring to the high end at the skill
 * maximum; below it, `lateWarningHours`. Plus the party's `storm.warningHours`.
 */
export function warningHorizon(balance: Balance, party: PartyInfo): number {
  const s = balance.storms;
  let h: number = s.lateWarningHours;
  if (party.seafaring >= s.warningSeafaringMin) {
    const span = balance.character.skillMax - s.warningSeafaringMin;
    const f = span > 0 ? Math.min(1, (party.seafaring - s.warningSeafaringMin) / span) : 1;
    h = s.earlyWarningHours[0] + (s.earlyWarningHours[1] - s.earlyWarningHours[0]) * f;
  }
  return Math.max(0, Math.round(h + party.warningHours));
}

// ---------------------------------------------------------------------------------------------
// The catch chance.

function rec(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/**
 * The voyage omen in force for a fleet owner (the faith module writes `player.house.omens.voyage`
 * and `factions[id].omens.voyage`; read defensively — faith may be absent).
 */
export function voyageOmen(state: GameState, ownerId: FactionId, hour: Hour): OmenId | undefined {
  const holder = ownerId === state.player.factionId ? rec(state.player.house) : Object.hasOwn(state.factions, ownerId) ? rec(state.factions[ownerId]) : undefined;
  const reading = rec(rec(holder?.['omens'])?.['voyage']);
  if (reading === undefined) return undefined;
  const omen = reading['omen'];
  const until = reading['untilHour'];
  if (typeof omen !== 'string' || !(OMENS as readonly string[]).includes(omen)) return undefined;
  if (typeof until === 'number' && hour >= until) return undefined;
  return omen as OmenId;
}

/** True when the player's house holds the Drowned Bell (the quests module's flag). */
export function holdsDrownedBell(state: GameState, ownerId: FactionId, t: WeatherTunables): boolean {
  if (ownerId !== state.player.factionId) return false;
  const flag = t.storms.drownedBellFlag;
  return Object.hasOwn(state.flags, flag) && Boolean(state.flags[flag]);
}

/** True when `hourOfDay` (0–23) lies in the night window (which may wrap midnight). */
export function isNightHour(hourOfDay: number, t: WeatherTunables): boolean {
  const a = t.storms.nightStartHour;
  const b = t.storms.nightEndHour;
  if (a === b) return false;
  return a < b ? hourOfDay >= a && hourOfDay < b : hourOfDay >= a || hourOfDay < b;
}

/** Inputs of the fleet-level storm factor. */
export interface CatchInput {
  seafaring: number;
  chancePct: number;
  omen?: OmenId | undefined;
  drownedBell: boolean;
  /** Sailing through the night on an open-sea leg (§8.3: storm chance × 1.2). */
  nightSailing: boolean;
}

/**
 * The fleet-level factor of §31.3, `(1 − 0.04 × Seafaring) × omen × relic` (× night sailing × the
 * party's `storm.chancePct`), clamped to [0, 1]: the chance that a cell reaching the fleet catches it.
 */
export function catchChance(balance: Balance, input: CatchInput): number {
  const s = balance.storms;
  const skill = Math.max(0, 1 - s.seafaringReduction * input.seafaring);
  const omen = input.omen !== undefined ? s.omenMult[input.omen] : 1;
  const relic = input.drownedBell ? s.drownedBellMult : 1;
  const night = input.nightSailing ? s.nightSailingMult : 1;
  const traits = Math.max(0, 1 + input.chancePct / 100);
  return Math.min(1, Math.max(0, skill * omen * relic * night * traits));
}

// ---------------------------------------------------------------------------------------------
// Severity.

export interface SeverityWeights {
  minor: number;
  moderate: number;
  severe: number;
}

/**
 * Moves `shift` of probability from minor to severe (negative: back toward minor), taking from
 * moderate once minor is exhausted; the result stays a distribution.
 */
export function shiftSeverity(base: SeverityWeights, shift: number): SeverityWeights {
  let { minor, moderate, severe } = base;
  if (shift >= 0) {
    const fromMinor = Math.min(minor, shift);
    const fromModerate = Math.min(moderate, shift - fromMinor);
    minor -= fromMinor;
    moderate -= fromModerate;
    severe += fromMinor + fromModerate;
  } else {
    const take = Math.min(severe, -shift);
    severe -= take;
    minor += take;
  }
  return { minor, moderate, severe };
}

/** The severity shift for a catch: winter, an undermanned fleet, and the cell's intensity. */
export function severityShift(balance: Balance, t: WeatherTunables, winter: boolean, undermanned: boolean, intensity: number): number {
  const s = balance.storms;
  return (winter ? s.winterSevereShift : 0) + (undermanned ? s.undermannedSevereShift : 0) + t.storms.intensitySevereShift * (2 * intensity - 1);
}

/** One draw: minor, moderate or severe. */
export function rollSeverity(w: SeverityWeights, rng: RandomSource): StormSeverity {
  const total = w.minor + w.moderate + w.severe;
  const u = rng.float() * total;
  if (u < w.minor) return 'minor';
  if (u < w.minor + w.moderate) return 'moderate';
  return 'severe';
}

// ---------------------------------------------------------------------------------------------
// Consequences.

/** The fleet fields the planner reads. */
export interface FleetSnapshot {
  id: FleetId;
  men: Readonly<Record<string, number>>;
  cargo: Readonly<Partial<Record<GoodId, number>>>;
  rations: number;
  silver: number;
}

/** The ship fields the planner reads. */
export interface ShipSnapshot {
  id: ShipId;
  type: ShipTypeId;
  hullHp: number;
  sailHp: number;
}

export interface StormPlanInput {
  fleet: FleetSnapshot;
  ships: readonly ShipSnapshot[];
  severity: StormSeverity;
  sheltered: boolean;
  /** The party's `storm.damagePct`. */
  damagePct: number;
  balance: Balance;
  t: WeatherTunables;
}

/** What a storm does to one fleet, as effect data plus a summary for the StormHit event. */
export interface StormPlan {
  effects: EffectData[];
  menLost: number;
  shipsLost: ShipId[];
  shipsDamaged: number;
  cargoLostPct: number;
  rationsLost: number;
  silverLost: number;
  delayHours: number;
  lost: boolean;
}

/** Total men in a men record. */
export function menTotal(men: Readonly<Record<string, number>>): number {
  let n = 0;
  for (const k of Object.keys(men)) n += Math.max(0, men[k] ?? 0);
  return n;
}

/** True when the fleet has fewer men than its ships' minimum crews. */
export function isUndermanned(balance: Balance, men: number, ships: readonly ShipSnapshot[]): boolean {
  let need = 0;
  for (const s of ships) need += balance.ships[s.type]?.crewMin ?? 0;
  return men < need;
}

/**
 * Splits `total` losses over the unit counts in proportion (largest remainder, ties by unit id),
 * never taking more men of a unit than there are.
 */
export function distributeLosses(total: number, men: Readonly<Record<string, number>>): Record<string, number> {
  const units = Object.keys(men)
    .filter((u) => (men[u] ?? 0) > 0)
    .sort();
  const all = units.reduce((n, u) => n + (men[u] ?? 0), 0);
  const out: Record<string, number> = {};
  const want = Math.min(Math.max(0, Math.round(total)), all);
  if (want === 0 || all === 0) return out;
  let given = 0;
  const rema: { unit: string; frac: number }[] = [];
  for (const u of units) {
    const exact = (want * (men[u] ?? 0)) / all;
    const whole = Math.floor(exact);
    out[u] = whole;
    given += whole;
    rema.push({ unit: u, frac: exact - whole });
  }
  rema.sort((a, b) => b.frac - a.frac || (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0));
  for (let i = 0; given < want && i < rema.length; i++) {
    const u = (rema[i] as { unit: string }).unit;
    if ((out[u] ?? 0) < (men[u] ?? 0)) {
      out[u] = (out[u] ?? 0) + 1;
      given++;
    }
  }
  for (const u of Object.keys(out)) if (out[u] === 0) delete out[u];
  return out;
}

function draw(rng: RandomSource, r: readonly [number, number]): number {
  return rng.range(r[0], r[1]);
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Plans a storm's consequences for one caught fleet (§8.4, §31.3):
 *   minor    — sail damage; +`balance.storms.minorDelayDays`;
 *   moderate — hull and sail damage, `moderateMenLost` of the men overboard, `moderateCargoJettison`
 *              of the cargo and some rations lost;
 *   severe   — each ship founders with `founderBase × founderSize × (undermanned ? 1.5 : 1)`, the
 *              rest take heavy damage; men, cargo, rations and silver go down with foundered ships.
 * A sheltered fleet suffers only `1 − shelterAvoid` of every effect (and founder chance) and loses
 * `shelterDelayDays` instead of the storm's delay. Surviving ships are never sunk by damage alone.
 * Draws a fixed number of values per ship, then one for the men.
 */
export function planStormHit(input: StormPlanInput, rng: RandomSource): StormPlan {
  const { fleet, ships, severity, balance, t } = input;
  const s = balance.storms;
  const shelter = input.sheltered ? 1 - s.shelterAvoid : 1;
  const harm = Math.max(0, 1 + input.damagePct / 100) * shelter;
  const men = menTotal(fleet.men);
  let crewMaxAll = 0;
  let cargoAll = 0;
  for (const sh of ships) {
    crewMaxAll += balance.ships[sh.type]?.crewMax ?? 0;
    cargoAll += balance.ships[sh.type]?.cargoT ?? 0;
  }
  const manning = crewMaxAll > 0 ? men / crewMaxAll : 0;

  const sailPct = severity === 'minor' ? t.consequences.minor.sailDamagePct : t.consequences[severity].sailDamagePct;
  const hullPct = severity === 'minor' ? undefined : t.consequences[severity].hullDamagePct;

  const foundered: ShipSnapshot[] = [];
  const damage: { ship: ShipSnapshot; hull: number; sail: number }[] = [];
  for (const sh of ships) {
    const def = balance.ships[sh.type];
    const founderRoll = rng.float();
    const hullRoll = hullPct !== undefined ? draw(rng, hullPct) : 0;
    const sailRoll = draw(rng, sailPct);
    if (def === undefined) continue;
    if (severity === 'severe') {
      const under = def.crewMax > 0 && manning < def.crewMin / def.crewMax;
      const p = s.founderBase * def.founderSize * (under ? s.undermannedFounderMult : 1) * shelter;
      if (founderRoll < p) {
        foundered.push(sh);
        continue;
      }
    }
    const k = def.stormDamageMult * harm;
    const hull = Math.min(Math.max(0, sh.hullHp - 1), Math.round(def.hull * hullRoll * k));
    const sail = Math.min(Math.max(0, sh.sailHp), Math.round(def.sail * sailRoll * k));
    if (hull > 0 || sail > 0) damage.push({ ship: sh, hull, sail });
  }
  const menRoll = severity === 'moderate' ? draw(rng, s.moderateMenLost) : severity === 'severe' ? draw(rng, t.consequences.severe.menLostPct) : 0;

  const lost = ships.length > 0 && foundered.length === ships.length;
  // Share of crew and cargo room that went down with foundered ships.
  let crewShareLost = 0;
  let cargoShareLost = 0;
  for (const sh of foundered) {
    crewShareLost += crewMaxAll > 0 ? (balance.ships[sh.type]?.crewMax ?? 0) / crewMaxAll : 0;
    cargoShareLost += cargoAll > 0 ? (balance.ships[sh.type]?.cargoT ?? 0) / cargoAll : 0;
  }
  if (lost) {
    crewShareLost = 1;
    cargoShareLost = 1;
  }

  let menLost: number;
  if (lost) menLost = men;
  else {
    let drowned = Math.round(men * crewShareLost);
    if (drowned > 0) {
      let room = 0;
      for (const sh of ships) if (!foundered.includes(sh)) room += balance.ships[sh.type]?.crewMax ?? 0;
      const rescued = Math.min(Math.round(drowned * t.consequences.severe.founderRescueShare), Math.max(0, room - (men - drowned)));
      drowned -= Math.max(0, rescued);
    }
    const overboard = Math.round((men - drowned) * menRoll * harm);
    menLost = Math.min(men, drowned + overboard);
  }

  const jettison = severity === 'moderate' ? s.moderateCargoJettison * shelter : severity === 'severe' ? t.consequences.severe.cargoLossPct * shelter : 0;
  const rationsPct = severity === 'moderate' ? t.consequences.moderate.rationsLossPct * shelter : severity === 'severe' ? t.consequences.severe.rationsLossPct * shelter : 0;
  const cargoLostPct = lost ? 1 : 1 - (1 - cargoShareLost) * (1 - jettison);
  const rationsLostPct = lost ? 1 : 1 - (1 - cargoShareLost) * (1 - rationsPct);
  const rationsLost = Math.min(fleet.rations, Math.round(fleet.rations * rationsLostPct));
  const silverLost = Math.min(fleet.silver, Math.round(fleet.silver * (lost ? 1 : cargoShareLost)));

  const effects: EffectData[] = [];
  const losses = distributeLosses(menLost, fleet.men);
  for (const unit of Object.keys(losses)) effects.push({ op: 'killMen', unit, count: losses[unit], fleetId: fleet.id });
  if (cargoLostPct > 0) {
    for (const good of Object.keys(fleet.cargo).sort() as GoodId[]) {
      if (good === 'rations') continue;
      const tons = round2((fleet.cargo[good] ?? 0) * cargoLostPct);
      if (tons > 0) effects.push({ op: 'addGoods', good, tons: -tons, fleetId: fleet.id });
    }
  }
  if (rationsLost > 0) effects.push({ op: 'addRations', count: -rationsLost, fleetId: fleet.id });
  if (silverLost > 0) effects.push({ op: 'addSilver', amount: -silverLost, fleetId: fleet.id });
  for (const sh of foundered) effects.push({ op: 'sinkShip', shipId: sh.id, cause: 'storm' });
  for (const d of damage) {
    const e: EffectData = { op: 'damageShip', shipId: d.ship.id, cause: 'storm' };
    if (d.hull > 0) e['hull'] = d.hull;
    if (d.sail > 0) e['sail'] = d.sail;
    effects.push(e);
  }

  const delayDays = input.sheltered ? s.shelterDelayDays : severity === 'minor' ? s.minorDelayDays : t.consequences[severity].delayDays;
  return {
    effects,
    menLost,
    shipsLost: foundered.map((sh) => sh.id),
    shipsDamaged: damage.length,
    cargoLostPct: round2(cargoLostPct),
    rationsLost,
    silverLost,
    delayHours: lost ? 0 : Math.round(delayDays * HOURS_PER_DAY),
    lost,
  };
}
