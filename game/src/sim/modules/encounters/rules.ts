/**
 * Pure encounter rules (design §8.6, §15.1, §31.4): who is aboard and their best skill, speeds, a side's
 * strength, the evade / toll / flee / slip-away odds, and the options of an encounter card. Nothing here
 * writes state; the client may call these to explain a card.
 */
import type { Content } from '@content/index';
import { clamp, dlog2, dpow } from '@sim/core/dmath';
import { getRelation } from '@sim/core/factory';
import type { ArmyId, CharId, FactionId, Fleet, FleetId, GameState, GoodId, ShipTypeId, SkillId, TextVars } from '@sim/core/state';
import type { EncounterChoice, EncounterKind, EncounterOption, EncounterParty, EncounterPayloadExt, TollPayment, TradeDeal } from './types';

type Balance = Content['balance'];
type T = Content['tunables']['encounters'];

/** Total of a men record. */
export function menTotal(men: Readonly<Record<string, number>>): number {
  let n = 0;
  for (const v of Object.values(men)) n += Math.max(0, v);
  return n;
}

/** Men in a land party. */
export function armyMen(state: GameState, armyId: ArmyId | undefined): number {
  if (armyId === undefined) return 0;
  let n = 0;
  for (const sq of state.armies[armyId]?.squads ?? []) n += Math.max(0, sq.men);
  return n;
}

/** Men of a land party per unit type. */
export function armyMenByUnit(state: GameState, armyId: ArmyId | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (armyId === undefined) return out;
  for (const sq of state.armies[armyId]?.squads ?? []) if (sq.men > 0) out[sq.unit] = (out[sq.unit] ?? 0) + sq.men;
  return out;
}

/**
 * The house's people with the party: the fleet's leader and lieutenants and the ruler, when alive and
 * actually aboard (or, for a land party, on the march with it). Leader first.
 */
export function companions(state: GameState, fleetId: FleetId, armyId?: ArmyId): CharId[] {
  const f = state.fleets[fleetId];
  if (!f) return [];
  const out: CharId[] = [];
  for (const id of [f.leaderId, ...f.lieutenantIds, state.player.rulerId]) {
    const c = state.characters[id];
    if (!c?.alive || out.includes(id)) continue;
    const loc = c.location;
    const here = armyId !== undefined ? loc.kind === 'army' && loc.id === armyId : loc.kind === 'fleet' && loc.id === fleetId;
    if (here) out.push(id);
  }
  // A fleet whose leader's location was never set (tests, old saves) still has its leader.
  if (out.length === 0 && state.characters[f.leaderId]?.alive && armyId === undefined) out.push(f.leaderId);
  return out;
}

/** The companion with the best skill (first on ties) and that skill. */
export function bestAt(state: GameState, ids: readonly CharId[], skill: SkillId): { id: CharId | undefined; skill: number } {
  let id: CharId | undefined;
  let best = -1;
  for (const c of ids) {
    const v = state.characters[c]?.skills[skill] ?? 0;
    if (v > best) {
      best = v;
      id = c;
    }
  }
  return { id, skill: Math.max(0, best) };
}

/** Equipment multiplier of a tier (balance.equipment.tiers; 1 + 0.12 × (tier − 1) by default). */
export function tierMult(balance: Balance, tier: number): number {
  const row = balance.equipment.tiers.find((r) => r.tier === tier);
  return row ? row.mult : 1 + 0.12 * (Math.max(1, tier) - 1);
}

/** A side's strength (§31.11 shape): Σ men × avg(atk × weapon, def × armour) × morale / divisor. */
export function sidePower(balance: Balance, men: Readonly<Record<string, number>>, armourTier: number, weaponTier: number, morale: number): number {
  const wm = tierMult(balance, weaponTier);
  const am = tierMult(balance, armourTier);
  let p = 0;
  for (const [u, n] of Object.entries(men)) {
    if (!(n > 0)) continue;
    const unit = (balance.units as Record<string, { atk: number; def: number } | undefined>)[u];
    const atk = unit?.atk ?? 4;
    const def = unit?.def ?? 4;
    p += n * (atk * wm + def * am) * 0.5;
  }
  return (p * Math.max(1, morale)) / balance.autoresolve.moraleDivisor;
}

/** P(the stronger wins) on the §31.11 curve: r^e / (r^e + 1). */
export function winChance(balance: Balance, ours: number, theirs: number): number {
  if (ours <= 0 && theirs <= 0) return 0.5;
  if (theirs <= 0) return 1;
  if (ours <= 0) return 0;
  const rk = dpow(ours / theirs, balance.autoresolve.exponent);
  return rk / (rk + 1);
}

/** The fields of world's mover cache this module reads (state-resident contract, world/types.ts). */
export interface MoverView {
  kind: 'fleet' | 'army';
  sailKn: number;
  rowKn: number;
  mult: number;
  sight: number;
  sightNight: number;
}

/** World's cached movement inputs of a fleet or army (absent when the world module is not loaded). */
export function moverOf(state: GameState, id: string): MoverView | undefined {
  const movers = (state as GameState & { world?: { movers?: Record<string, MoverView> } }).world?.movers;
  return movers && Object.hasOwn(movers, id) ? movers[id] : undefined;
}

/** Sea zone of a fleet's position (world sets it; null on rivers and lakes, undefined without the world module). */
export function zoneOf(fleet: Fleet): string | null {
  const z = (fleet as Fleet & { seaZoneId?: string | null }).seaZoneId;
  return typeof z === 'string' ? z : null;
}

/** The land parties ashore: army → fleet (expeditions' state contract). */
export function landParties(state: GameState): Record<ArmyId, FleetId> {
  return (state as GameState & { expeditions?: { landParties?: Record<ArmyId, FleetId> } }).expeditions?.landParties ?? {};
}

/** One side of a sea fight as the sea battle sees it (§15.5 inputs). */
export interface SeaSideView {
  men: Readonly<Record<string, number>>;
  shipTypes: readonly ShipTypeId[];
  armourTier: number;
  weaponTier: number;
  morale: number;
  command: number;
  /** Deck archer share the sea battle assigns this role by default. */
  deckArchers: number;
  pitchT: number;
  penalty: number;
}

/**
 * The seabattle module's §15.5 fleet power without the weather gauge (unknown until the fight): crew ×
 * avg(atk, def after tiers) × start morale (fleet morale + 2 × Command + ship bonus) × archers × drakkar
 * Dread and weight × fire arrows × the player's auto-resolve penalty.
 */
export function seaSidePower(content: Content, s: SeaSideView): number {
  const balance = content.balance;
  const st = content.tunables.seabattle;
  const crew = menTotal(s.men);
  if (crew <= 0) return 0;
  let fleetMorale = 0;
  let drakkars = 0;
  for (const t of s.shipTypes) {
    const def = (balance.ships as Record<string, { fleetMorale: number } | undefined>)[t];
    fleetMorale = Math.max(fleetMorale, def?.fleetMorale ?? 0);
    if (t === 'drakkar') drakkars++;
  }
  const quality = sidePower(balance, s.men, s.armourTier, s.weaponTier, balance.autoresolve.moraleDivisor) / crew;
  const morale = clamp(s.morale + balance.battle.morale.perCommand * s.command + fleetMorale, 1, 100) / balance.autoresolve.moraleDivisor;
  const trained = (s.men['archers'] ?? 0) / crew;
  const archers = 1 + balance.seaBattle.autoresolve.archerShareBonus * Math.max(s.deckArchers, trained);
  const dread = 1 + Math.min(st.autoresolve.dreadCap, drakkars * balance.ships.drakkar.dread) / 100;
  const drakkarShare = s.shipTypes.length > 0 ? drakkars / s.shipTypes.length : 0;
  const weight = 1 + (st.autoresolve.drakkarMult - 1) * drakkarShare;
  const fire = s.pitchT >= st.archery.pitchPerVolleyT && st.archery.fireArrowsDefault ? st.autoresolve.fireArrowsMult : 1;
  return crew * quality * morale * archers * dread * weight * fire * (1 - s.penalty);
}

/** P(we win) of a sea fight on the seabattle module's curve: ((ours/theirs)^sharpness)^exponent. */
export function seaWinChance(content: Content, ours: number, theirs: number): number {
  if (ours <= 0 || theirs <= 0) return winChance(content.balance, ours, theirs);
  const k = content.tunables.seabattle.autoresolve.ratioSharpness;
  return winChance(content.balance, dpow(ours / theirs, k), 1);
}

/** The two sides of a sea fight between our fleet and the party. */
export function seaSides(state: GameState, content: Content, fleetId: FleetId, party: EncounterParty, kind: EncounterKind): { ours: SeaSideView; theirs: SeaSideView } {
  const balance = content.balance;
  const deck = content.tunables.seabattle.deck as Record<string, { archers: number } | undefined>;
  const f = state.fleets[fleetId];
  const faction = state.factions[state.player.factionId];
  const ruler = state.characters[state.player.rulerId];
  const rulerAboard = ruler?.alive === true && ruler.location.kind === 'fleet' && ruler.location.id === fleetId;
  const captain = rulerAboard ? ruler : f ? state.characters[f.leaderId] : undefined;
  const types: ShipTypeId[] = [];
  for (const id of f?.shipIds ?? []) {
    const s = state.ships[id];
    if (s && s.hullHp > 0) types.push(s.type);
  }
  const role = kind === 'merchant' ? 'merchant' : 'default';
  const realCaptain = party.fleetId !== undefined ? state.characters[state.fleets[party.fleetId]?.leaderId ?? ('' as CharId)] : undefined;
  return {
    ours: {
      men: f?.men ?? {},
      shipTypes: types,
      armourTier: faction?.armouryTier ?? 1,
      weaponTier: faction?.weaponTier ?? 1,
      morale: f?.morale ?? balance.defaults.fleetMorale,
      command: captain?.skills.command ?? 0,
      deckArchers: deck['default']?.archers ?? 0.25,
      pitchT: f?.cargo.pitch ?? 0,
      penalty: (balance.autoresolve.playerPenalty as Record<string, number>)[state.meta.difficulty] ?? 0,
    },
    theirs: {
      men: party.men,
      shipTypes: party.ships.map((s) => s.type),
      armourTier: party.armourTier,
      weaponTier: party.weaponTier,
      morale: party.morale,
      command: realCaptain?.skills.command ?? 0,
      deckArchers: deck[role]?.archers ?? deck['default']?.archers ?? 0.25,
      pitchT: party.cargo.pitch ?? 0,
      penalty: 0,
    },
  };
}

/**
 * Fighting speed of a side in this wind as the sea battle reckons the weather gauge: the slowest ship's best
 * of rowing (benches manned after the default deck of archers and boarders) and sailing.
 */
export function seaFightKn(content: Content, ships: readonly { type: ShipTypeId; crew: number; sailHp?: number }[], deck: { archers: number; boarders: number }, trainedShare: number, windStr: string): number {
  const balance = content.balance;
  const ph = content.tunables.seabattle.physics;
  const wf = balance.sailing.windFactor as Record<string, Record<string, number>>;
  const best = Math.max(wf['running']?.[windStr] ?? 1, wf['broadReach']?.[windStr] ?? 1, wf['beamReach']?.[windStr] ?? 1, wf['closeHauled']?.[windStr] ?? 1);
  let slowest = Infinity;
  for (const s of ships) {
    const def = (balance.ships as Record<string, { rowKn: number; sailKn: number; crewMax: number; sail: number } | undefined>)[s.type];
    if (!def) continue;
    const archers = Math.min(s.crew, Math.max(Math.round(deck.archers * s.crew), Math.round(trainedShare * s.crew)));
    const boarders = Math.min(s.crew - archers, Math.round(deck.boarders * s.crew));
    const benches = ph.oarsShareOfCrewMax * def.crewMax;
    const r = benches > 0 ? Math.max(0, s.crew - archers - boarders) / benches : 0;
    const bench = r <= 0 ? 0 : r >= 1 ? 1 : ph.rowPowerExp === 0.5 ? Math.sqrt(r) : dpow(r, ph.rowPowerExp);
    const sailHp = s.sailHp ?? def.sail;
    const hp = sailHp <= 0 || def.sail <= 0 ? 0 : ph.sailHpSpeedFloor + (1 - ph.sailHpSpeedFloor) * clamp(sailHp / def.sail, 0, 1);
    slowest = Math.min(slowest, Math.max(def.rowKn * bench, def.sailKn * best * hp));
  }
  return slowest === Infinity ? 0 : slowest;
}

/** Crew per hull, shared out by the hulls' size (how the sea battle mans explicit and fleet ships). */
function crewByHull(content: Content, types: readonly ShipTypeId[], total: number): { type: ShipTypeId; crew: number }[] {
  const max = types.map((t) => (content.balance.ships as Record<string, { crewMax: number } | undefined>)[t]?.crewMax ?? 1);
  const sum = max.reduce((a, b) => a + b, 0);
  let left = total;
  return types.map((type, i) => {
    const crew = i === types.length - 1 ? left : Math.min(left, Math.round((total * (max[i] ?? 0)) / Math.max(1, sum)));
    left -= crew;
    return { type, crew: Math.max(0, crew) };
  });
}

/** P(we win) a fight with the party: the sea battle's odds at sea, the land battle's (§31.11) ashore. */
export function fightChance(state: GameState, content: Content, fleetId: FleetId, armyId: ArmyId | undefined, party: EncounterParty, kind: EncounterKind): number {
  if (armyId === undefined) {
    const { ours, theirs } = seaSides(state, content, fleetId, party, kind);
    let po = seaSidePower(content, ours);
    let pt = seaSidePower(content, theirs);
    // The weather gauge (§15.5): the side faster in this wind by more than the edge gets ±windAdvantage.
    const f = state.fleets[fleetId];
    const zone = f ? zoneOf(f) : null;
    const windStr = zone !== null && Object.hasOwn(state.weather.zones, zone) ? (state.weather.zones[zone]?.windStr ?? 'fresh') : 'fresh';
    const deck = content.tunables.seabattle.deck as Record<string, { archers: number; boarders: number } | undefined>;
    const dDefault = deck['default'] ?? { archers: 0.25, boarders: 0.3 };
    const dTheirs = (kind === 'merchant' ? deck['merchant'] : undefined) ?? dDefault;
    const trained = (men: Readonly<Record<string, number>>) => (menTotal(men) > 0 ? (men['archers'] ?? 0) / menTotal(men) : 0);
    const afloat = (f?.shipIds ?? []).map((id) => state.ships[id]).filter((s): s is NonNullable<typeof s> => s !== undefined && s.hullHp > 0);
    const ourShips = crewByHull(content, afloat.map((s) => s.type), menTotal(ours.men)).map((s, i) => ({ ...s, sailHp: afloat[i]?.sailHp ?? 0 }));
    const theirShips = party.fleetId === undefined && party.ships.every((s) => s.crew > 0) ? party.ships : crewByHull(content, theirs.shipTypes, menTotal(theirs.men));
    const vo = seaFightKn(content, ourShips, dDefault, trained(ours.men), windStr);
    const vt = seaFightKn(content, theirShips, dTheirs, trained(theirs.men), windStr);
    const edge = 1 + content.tunables.seabattle.autoresolve.gaugeSpeedEdge;
    const wa = content.balance.seaBattle.autoresolve.windAdvantage;
    if (vo > vt * edge) {
      po *= 1 + wa;
      pt *= 1 - wa;
    } else if (vt > vo * edge) {
      po *= 1 - wa;
      pt *= 1 + wa;
    }
    return seaWinChance(content, po, pt);
  }
  return winChance(content.balance, ourPower(state, content.balance, fleetId, armyId), theirPower(content.balance, party));
}

/** The best speed (knots) of the slowest of these ship types. */
export function shipsKn(balance: Balance, types: readonly ShipTypeId[]): number {
  let slowest = Infinity;
  for (const t of types) {
    const s = (balance.ships as Record<string, { sailKn: number; rowKn: number } | undefined>)[t];
    if (s) slowest = Math.min(slowest, Math.max(s.sailKn, s.rowKn));
  }
  return slowest === Infinity ? 5 : slowest;
}

/** Our fleet's speed: the world module's cached mover inputs when sailing, else its ships. */
export function fleetKn(state: GameState, balance: Balance, fleet: Fleet): number {
  const m = moverOf(state, fleet.id);
  if (m && m.kind === 'fleet' && m.sailKn > 0) return Math.max(m.sailKn, m.rowKn) * (m.mult > 0 ? m.mult : 1);
  const types: ShipTypeId[] = [];
  for (const id of fleet.shipIds) {
    const s = state.ships[id];
    if (s) types.push(s.type);
  }
  return shipsKn(balance, types);
}

/** §31.4 Evade: clamp(0.5 + 0.6 × (ourKn/theirKn − 1) + 0.04 × (Seafaring − theirs), 0.05, 0.95). */
export function evadeChance(balance: Balance, ourKn: number, theirKn: number, ourSeafaring: number, theirSeafaring: number): number {
  const e = balance.encounters.evade;
  const ratio = theirKn > 0 ? ourKn / theirKn : 2;
  return clamp(e.base + e.speedSlope * (ratio - 1) + e.seafaringSlope * (ourSeafaring - theirSeafaring), e.min, e.max);
}

/**
 * §31.4 Toll acceptance: score = 20 × log2(ours/theirs) + 0.4 × Dread − pride + noise(±5), accepted when
 * ≥ 0. With uniform noise the chance is clamp((score₀ + noise) / (2 × noise), 0, 1).
 */
export function tollAcceptChance(balance: Balance, ours: number, theirs: number, dread: number, pride: number): number {
  const t = balance.encounters.toll;
  const ratio = theirs > 0 ? Math.max(1e-6, ours / theirs) : 64;
  const score = t.powerLog2Mult * dlog2(ratio) + t.dreadMult * dread - pride;
  if (t.noise <= 0) return score >= 0 ? 1 : 0;
  return clamp((score + t.noise) / (2 * t.noise), 0, 1);
}

/** Flee: the chance a faster, hostile party catches our slowest ship. */
export function catchChance(t: T, ourKn: number, theirKn: number, aggressive: boolean): number {
  if (!aggressive || theirKn <= ourKn) return 0;
  return clamp(t.flee.catchBase + t.flee.catchSlope * (theirKn / Math.max(0.1, ourKn) - 1), 0, t.flee.catchMax);
}

/** Land: the chance a party slips past unseen (Wildcraft, and big parties are hard to hide). */
export function slipChance(t: T, ourWildcraft: number, theirWildcraft: number, ourMen: number): number {
  const s = t.slipAway;
  return clamp(s.base + s.wildcraftSlope * (ourWildcraft - theirWildcraft) - s.sizeSlope * Math.max(0, ourMen - s.sizeFree), s.min, s.max);
}

/** Relations of the player's house with a faction. */
export function standingWith(state: GameState, t: T, factionId: FactionId | undefined): { war: boolean; hostile: boolean } {
  if (factionId === undefined) return { war: false, hostile: true };
  const player = state.player.factionId;
  if (factionId === player) return { war: false, hostile: false };
  const rel = getRelation(state, player, factionId);
  const war = rel?.stance === 'war';
  const hostile = war || rel?.stance === 'hostile' || (rel !== undefined && rel.opinion <= t.sea.hostileOpinion);
  return { war, hostile };
}

/** The player's party strength in an encounter (fleet men at sea, the land party ashore), after the §5.5 penalty. */
export function ourPower(state: GameState, balance: Balance, fleetId: FleetId, armyId?: ArmyId): number {
  const f = state.fleets[fleetId];
  const faction = state.factions[state.player.factionId];
  const men = armyId !== undefined ? armyMenByUnit(state, armyId) : (f?.men ?? {});
  const morale = f?.morale ?? balance.defaults.fleetMorale;
  const penalty = (balance.autoresolve.playerPenalty as Record<string, number>)[state.meta.difficulty] ?? 0;
  return sidePower(balance, men, faction?.armouryTier ?? 1, faction?.weaponTier ?? 1, morale) * (1 - penalty);
}

/** The other party's strength. */
export function theirPower(balance: Balance, party: EncounterParty): number {
  return sidePower(balance, party.men, party.armourTier, party.weaponTier, party.morale);
}

/** Value of goods in silver at base prices. */
export function goodsValue(balance: Balance, goods: Partial<Record<GoodId, number>>): number {
  let v = 0;
  for (const [g, tons] of Object.entries(goods)) {
    if (!(tons !== undefined && tons > 0) || g === 'rations') continue;
    v += tons * ((balance.goods as Record<string, { basePerTon: number } | undefined>)[g]?.basePerTon ?? 0);
  }
  return v;
}

/** Rations a party eats in a day. */
export function dailyFood(balance: Balance, men: number): number {
  return Math.max(1, Math.ceil(men * balance.food.rationsPerManPerDay));
}

/** The toll they ask, and how our ships would pay it (silver first, then provisions). */
export function tollFor(state: GameState, content: Content, kind: EncounterKind, fleetId: FleetId, speechcraft: number, ourMen: number): TollPayment & { asked: number } {
  const t = content.tunables.encounters;
  const k = t.kinds[kind];
  const asked = Math.max(1, Math.round((t.payToll.base + t.payToll.perMan * ourMen) * k.tollMult * clamp(1 - t.payToll.speechcraftDiscount * speechcraft, 0.3, 1)));
  const f = state.fleets[fleetId];
  const silver = Math.min(asked, Math.max(0, Math.floor(f?.silver ?? 0)));
  const short = asked - silver;
  let rations = 0;
  if (short > 0 && f) {
    const price = content.balance.economy.rationPrice;
    const cap = Math.floor(t.payToll.maxRationDays * dailyFood(content.balance, menTotal(f.men)));
    rations = Math.min(Math.max(0, Math.floor(f.rations)), cap, Math.ceil(short / Math.max(1e-6, price)));
  }
  return { asked, silver, rations };
}

/** The merchant's small deal: they buy some of our goods, else sell us provisions; null when nothing can change hands. */
export function tradeDealFor(state: GameState, content: Content, fleetId: FleetId, speechcraft: number, rationsOffered: number): TradeDeal | null {
  const t = content.tunables.encounters.trade;
  const balance = content.balance;
  const f = state.fleets[fleetId];
  if (!f) return null;
  let good: GoodId | undefined;
  let bestValue = 0;
  for (const [g, tons] of Object.entries(f.cargo) as [GoodId, number | undefined][]) {
    if (g === 'rations' || !(tons !== undefined && tons >= 0.5)) continue;
    const v = Math.min(tons, t.maxTons) * ((balance.goods as Record<string, { basePerTon: number } | undefined>)[g]?.basePerTon ?? 0);
    if (v > bestValue) {
      bestValue = v;
      good = g;
    }
  }
  if (good !== undefined) {
    const tons = Math.round(Math.min(f.cargo[good] ?? 0, t.maxTons) * 10) / 10;
    const price = ((balance.goods as Record<string, { basePerTon: number } | undefined>)[good]?.basePerTon ?? 0) * (t.sellBase + t.sellPerSpeechcraft * speechcraft);
    const silver = Math.round(tons * price);
    if (silver > 0) return { kind: 'sell', good, tons, silver };
  }
  const unit = balance.economy.rationPrice * Math.max(0.5, t.buyBase - t.buyPerSpeechcraft * speechcraft);
  const afford = Math.floor(Math.max(0, f.silver) / Math.max(1e-6, unit));
  const rations = Math.min(rationsOffered, afford);
  if (rations < t.minRations) return null;
  return { kind: 'buy', rations, silver: Math.max(1, Math.round(rations * unit)) };
}

/**
 * The options of an encounter card, safe default first, then the others in a fixed order. Unavailable
 * options are kept (greyed out) with their reason. `effects` = the effect ops registered (attack needs
 * the battle module).
 */
export function encounterOptions(state: GameState, content: Content, p: EncounterPayloadExt & { fleetId: FleetId }, effects: { has(op: string): boolean }): EncounterOption[] {
  const balance = content.balance;
  const t = content.tunables.encounters;
  const fleet = state.fleets[p.fleetId];
  const party = p.party;
  const land = p.domain === 'land';
  const ids = companions(state, p.fleetId, p.armyId);
  const speech = bestAt(state, ids, 'speechcraft');
  const sea = bestAt(state, ids, 'seafaring');
  const wild = bestAt(state, ids, 'wildcraft');
  const command = bestAt(state, ids, 'command');
  const ours = ourPower(state, balance, p.fleetId, p.armyId);
  const theirs = theirPower(balance, party);
  const ourMen = land ? armyMen(state, p.armyId) : menTotal(fleet?.men ?? {});
  const ourKn = fleet ? fleetKn(state, balance, fleet) : 5;
  const opts: EncounterOption[] = [];
  const add = (o: EncounterOption) => opts.push(o);
  const who = (id: CharId | undefined) => (id !== undefined ? { whoId: id } : {});
  const silverAboard = Math.max(0, Math.floor(fleet?.silver ?? 0));

  if (p.stage === 'caught') {
    if (land) {
      add({ id: 'fallBack', available: true, ...who(wild.id) });
      const win = fightChance(state, content, p.fleetId, p.armyId, party, p.kind);
      add({ id: 'fight', available: effects.has('startBattle') && ourMen > 0, ...(effects.has('startBattle') ? {} : { reason: 'noBattles' }), chance: win, ...who(command.id) });
    } else {
      add({ id: 'yield', available: true });
      const win = fightChance(state, content, p.fleetId, p.armyId, party, p.kind);
      const can = effects.has('startSeaBattle') && seaFoe(party);
      add({ id: 'fight', available: can, ...(can ? {} : { reason: 'noBattles' }), chance: win, ...who(command.id) });
    }
    return opts;
  }

  const kind = p.kind;
  const peaceful = !p.aggressive;
  // Hail.
  if (kind !== 'outlaws') {
    const reason = p.atWar ? 'atWar' : kind === 'raiders' ? 'noParley' : undefined;
    add({ id: 'hail', available: reason === undefined, ...(reason !== undefined ? { reason } : {}), ...who(speech.id) });
  } else add({ id: 'hail', available: false, reason: 'noParley' });
  // Trade (merchants only).
  if (kind === 'merchant') {
    const deal = p.deal;
    const reason = p.atWar ? 'atWar' : !deal ? (silverAboard > 0 ? 'noRoom' : 'nothingToTrade') : undefined;
    const vars: TextVars | undefined = deal ? (deal.kind === 'sell' ? { deal: 'sell', good: deal.good, tons: deal.tons, silver: deal.silver } : { deal: 'buy', good: 'rations', rations: deal.rations, silver: deal.silver }) : undefined;
    add({ id: 'trade', available: reason === undefined, ...(reason !== undefined ? { reason } : {}), ...who(speech.id), ...(vars ? { vars } : {}) });
  }
  // Pay a toll (patrols, raiders, war fleets, outlaws).
  if (kind !== 'merchant') {
    const toll = p.toll;
    const reason = toll.silver + toll.rations <= 0 ? 'nothingToPay' : undefined;
    add({ id: 'payToll', available: reason === undefined, ...(reason !== undefined ? { reason } : {}), ...who(speech.id), vars: { silver: toll.silver, rations: toll.rations } });
  }
  // Demand a toll (§15.1): from merchants and from patrols or war fleets that are not looking for a fight.
  if (kind === 'merchant' || ((kind === 'patrol' || kind === 'warfleet' || kind === 'landPatrol') && peaceful)) {
    const chance = tollAcceptChance(balance, ours, theirs, state.player.house.dread, party.pride);
    add({ id: 'demandToll', available: ourMen > 0, ...(ourMen > 0 ? {} : { reason: 'noMen' }), chance, ...who(command.id) });
  }
  // Attack.
  {
    const op = land ? 'startBattle' : 'startSeaBattle';
    const reason = !effects.has(op) || (!land && !seaFoe(party)) ? 'noBattles' : ourMen <= 0 ? 'noMen' : undefined;
    add({ id: 'attack', available: reason === undefined, ...(reason !== undefined ? { reason } : {}), chance: fightChance(state, content, p.fleetId, p.armyId, party, p.kind), ...who(command.id) });
  }
  // Evade / slip away.
  if (land) add({ id: 'slipAway', available: true, chance: slipChance(t, wild.skill, party.wildcraft, ourMen), ...who(wild.id) });
  else if (kind !== 'merchant') add({ id: 'evade', available: true, chance: evadeChance(balance, ourKn, party.kn, sea.skill, party.seafaring), ...who(sea.id) });
  // Flee (sea, always possible): the chance they catch us.
  if (!land && p.aggressive) add({ id: 'flee', available: true, chance: catchChance(t, ourKn, party.kn, p.aggressive), ...who(sea.id) });
  // Let them pass.
  if (peaceful) add({ id: 'pass', available: true });

  // The safe default goes first.
  const first = opts.findIndex((o) => o.id === p.defaultChoice && o.available);
  if (first > 0) opts.unshift(...opts.splice(first, 1));
  return opts;
}

/** A sea battle needs a lord or a real fleet on the other side. */
function seaFoe(party: EncounterParty): boolean {
  return party.fleetId !== undefined || (party.factionId !== undefined && party.ships.length > 0);
}

/**
 * The safe default of an encounter: never a fight, never a loss of ships or men at sea. Peaceful
 * parties are hailed (or passed by); hostile ones are evaded at sea (a failed evasion leads to the
 * "caught" card whose first choice is to yield goods) or slipped past ashore.
 */
export function safeDefault(kind: EncounterKind, aggressive: boolean, atWar: boolean, stage: 'sighted' | 'caught', domain: 'sea' | 'land'): EncounterChoice {
  if (stage === 'caught') return domain === 'land' ? 'fallBack' : 'yield';
  if (domain === 'land') return aggressive || atWar || kind === 'outlaws' ? 'slipAway' : 'hail';
  if (aggressive) return 'evade';
  if (atWar || kind === 'raiders') return kind === 'merchant' ? 'pass' : 'evade';
  return 'hail';
}

/** Percent for labels (0..100, whole). */
export function pct(x: number | undefined): number {
  return Math.round(clamp(x ?? 0, 0, 1) * 100);
}
