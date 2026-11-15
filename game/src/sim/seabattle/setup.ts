/**
 * Builds a SeaBattleSetup from GameState for the `startSeaBattle` / `autoResolveSeaBattle` effects:
 * ships and hull/sail HP from the fleet, crews distributed over the ships by crewMax, unit quality,
 * trained archers on the bow, captain skills, equipment tiers, morale, pitch, cargo and wind.
 * Reads state only; never writes it.
 */
import type { Content } from '@content/index';
import type { Balance } from '@content/schemas/balance';
import type { Tunables as SeaTunables } from '@content/schemas/tunables/seabattle';
import { clamp } from '@sim/core/dmath';
import { EffectError } from '@sim/core/effects';
import type { RandomSource } from '@sim/core/rng';
import type {
  CharId,
  Fleet,
  GameState,
  SeaBattleId,
  SeaBattleSetup,
  SeaShipSetup,
  SeaSideSetup,
  ShipId,
  ShipTypeId,
  WindStrength,
} from '@sim/core/state';
import type { SeaSideRef, SeaSideRole, StartSeaBattleEffect } from './types';

const WIND_STRENGTHS: readonly WindStrength[] = ['calm', 'light', 'fresh', 'strong', 'gale'];

/** Ids and randomness the builder needs from the operation context. */
export interface SeaSetupIds {
  id: SeaBattleId;
  seed: string;
  rng: RandomSource;
  /** Mints a ship id for explicit (virtual) ships. */
  newShipId: () => ShipId;
}

/** Role from a fleet's intent (§15.3 behaviours). */
export function roleForFleet(fleet: Fleet | undefined): SeaSideRole {
  switch (fleet?.intent) {
    case 'trade':
      return 'merchant';
    case 'patrol':
      return 'patrol';
    case 'raid':
    case 'expedition':
      return 'raider';
    default:
      return 'warfleet';
  }
}

/** Men-weighted unit statistics of a crew (unknown unit ids count as the default unit). */
export function crewStats(balance: Balance, men: Record<string, number>, defaultUnit: string): { total: number; atk: number; def: number; trained: number; trainedAtk: number } {
  let total = 0;
  let atk = 0;
  let def = 0;
  let trained = 0;
  let trainedAtk = 0;
  const fallback = balance.units[defaultUnit];
  for (const [unit, raw] of Object.entries(men)) {
    const n = Math.max(0, Math.floor(raw));
    if (n <= 0) continue;
    const u = balance.units[unit] ?? fallback;
    total += n;
    atk += n * (u?.atk ?? 4);
    def += n * (u?.def ?? 4);
    if (u?.ranged) {
      trained += n;
      trainedAtk += n * u.ranged.atk;
    }
  }
  return {
    total,
    atk: total > 0 ? atk / total : (fallback?.atk ?? 4),
    def: total > 0 ? def / total : (fallback?.def ?? 4),
    trained,
    trainedAtk: trained > 0 ? trainedAtk / trained : 0,
  };
}

/** Splits `total` men over ships in proportion to their crewMax (largest remainder, deterministic). */
export function distributeCrew(total: number, crewMax: readonly number[]): number[] {
  const cap = crewMax.reduce((a, b) => a + b, 0);
  if (cap <= 0 || total <= 0) return crewMax.map(() => 0);
  const exact = crewMax.map((c) => (total * c) / cap);
  const out = exact.map((x) => Math.floor(x));
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) out[order[k]!.i]! += 1;
  return out;
}

/**
 * Default deck assignment of one ship (§15.2 slider): trained archers take the bow first, then the
 * role's default shares; rowers are the remainder.
 */
export function defaultDeck(t: SeaTunables, role: SeaSideRole, crew: number, trainedOnShip: number): { archers: number; boarders: number } {
  const share = role === 'merchant' ? t.deck.merchant : t.deck.default;
  const archers = Math.min(crew, Math.max(Math.round(share.archers * crew), Math.round(trainedOnShip)));
  const boarders = Math.min(crew - archers, Math.round(share.boarders * crew));
  return { archers, boarders };
}

function buildSide(state: GameState, content: Content, ref: SeaSideRef, ids: SeaSetupIds, what: string): SeaSideSetup & { fleetLeader?: CharId } {
  const balance = content.balance;
  const t = content.tunables.seabattle;
  const fleet = ref.fleetId !== undefined ? state.fleets[ref.fleetId] : undefined;
  if (ref.fleetId !== undefined && !fleet) throw new EffectError(`startSeaBattle.${what}: unknown fleet ${ref.fleetId}`);
  const factionId = ref.factionId ?? fleet?.ownerId;
  if (factionId === undefined) throw new EffectError(`startSeaBattle.${what}: needs fleetId or factionId`);
  const faction = state.factions[factionId];
  if (!faction) throw new EffectError(`startSeaBattle.${what}: unknown faction ${factionId}`);
  const culture = ref.culture ?? faction.culture;

  // Ships: the fleet's afloat ships, then explicit ones.
  const raw: { shipId: ShipId; type: ShipTypeId; hullHp: number; sailHp: number; name?: string; virtual: boolean; crew?: number }[] = [];
  for (const shipId of fleet?.shipIds ?? []) {
    const ship = state.ships[shipId];
    if (!ship || ship.hullHp <= 0) continue;
    raw.push({ shipId, type: ship.type, hullHp: ship.hullHp, sailHp: ship.sailHp, name: ship.name, virtual: false });
  }
  for (const x of ref.ships ?? []) {
    const def = balance.ships[x.type];
    const existing = x.shipId !== undefined ? state.ships[x.shipId] : undefined;
    raw.push({
      shipId: existing ? existing.id : ids.newShipId(),
      type: x.type,
      hullHp: clamp(x.hullHp ?? existing?.hullHp ?? def.hull, 1, def.hull),
      sailHp: clamp(x.sailHp ?? existing?.sailHp ?? def.sail, 0, def.sail),
      name: existing?.name ?? def.name,
      virtual: !existing,
      crew: x.crew ?? Math.round(def.crewMax * t.setup.explicitCrewShare),
    });
  }
  if (raw.length === 0) throw new EffectError(`startSeaBattle.${what}: no ships afloat`);
  // Flagship first: the strongest hull (stable for ties).
  const order = raw.map((r, i) => ({ r, i })).sort((a, b) => balance.ships[b.r.type].hull - balance.ships[a.r.type].hull || a.i - b.i);
  const ships = order.map((o) => o.r);

  // Men: the fleet's muster plus explicit crews.
  const men: Record<string, number> = { ...(fleet?.men ?? {}) };
  if (ref.men) for (const [u, n] of Object.entries(ref.men)) men[u] = (men[u] ?? 0) + Math.max(0, Math.floor(n));
  else {
    const explicit = ships.reduce((n, s) => n + (s.crew ?? 0), 0);
    if (explicit > 0) men[t.setup.defaultUnit] = (men[t.setup.defaultUnit] ?? 0) + explicit;
  }
  const stats = crewStats(balance, men, t.setup.defaultUnit);
  if (stats.total <= 0) throw new EffectError(`startSeaBattle.${what}: no men aboard`);
  const crews = distributeCrew(stats.total, ships.map((s) => balance.ships[s.type].crewMax));
  const role: SeaSideRole = ref.role ?? roleForFleet(fleet);
  const shipSetups: SeaShipSetup[] = ships.map((s, k) => {
    const crew = crews[k] ?? 0;
    const trainedOnShip = stats.total > 0 ? (stats.trained * crew) / stats.total : 0;
    const deck = defaultDeck(t, role, crew, trainedOnShip);
    const trained = Math.min(deck.archers, trainedOnShip);
    const rangedAtk = deck.archers > 0 ? (trained * stats.trainedAtk + (deck.archers - trained) * t.archery.levyRangedAtk) / deck.archers : t.archery.levyRangedAtk;
    const setup: SeaShipSetup = {
      shipId: s.shipId,
      type: s.type,
      hullHp: s.hullHp,
      sailHp: s.sailHp,
      crew,
      archers: deck.archers,
      boarders: deck.boarders,
      atk: stats.atk,
      def: stats.def,
      rangedAtk,
      cargoShare: 0,
    };
    if (s.name !== undefined) setup.name = s.name;
    if (s.virtual) setup.virtual = true;
    return setup;
  });
  const cargoCap = shipSetups.reduce((n, s) => n + balance.ships[s.type].cargoT, 0);
  for (const s of shipSetups) s.cargoShare = cargoCap > 0 ? balance.ships[s.type].cargoT / cargoCap : 1 / shipSetups.length;

  const captainId = ref.captainId ?? fleet?.leaderId;
  const captain = captainId !== undefined ? state.characters[captainId] : undefined;
  const pitchT = Math.max(0, ref.pitchT ?? fleet?.cargo.pitch ?? 0);
  const isPlayer = factionId === state.player.factionId;
  const side: SeaSideSetup & { fleetLeader?: CharId } = {
    factionId,
    ships: shipSetups,
    armourTier: faction.armouryTier,
    weaponTier: faction.weaponTier,
    morale: clamp(ref.morale ?? fleet?.morale ?? balance.defaults.fleetMorale, 0, 100),
    isPlayer,
    hasPitch: pitchT >= t.archery.pitchPerVolleyT,
    culture,
    role,
    pitchT,
    stamina: fleet?.crewStamina ?? 100,
    cargo: { ...(fleet?.cargo ?? {}) },
    silver: fleet?.silver ?? 0,
    men,
    fireArrows: t.archery.fireArrowsDefault,
    captainWeapon: content.cultures[captain?.culture ?? culture]?.defaultWeapon ?? content.cultures[culture]?.defaultWeapon ?? 'axe',
  };
  if (fleet) side.fleetId = fleet.id;
  if (captain && captain.alive) {
    side.captainId = captain.id;
    side.seafaring = captain.skills.seafaring ?? 0;
    side.command = captain.skills.command ?? 0;
    side.archery = captain.skills.archery ?? 0;
  }
  if (isPlayer) {
    side.dread = state.player.house.dread;
    side.playerPenalty = balance.autoresolve.playerPenalty[state.meta.difficulty] ?? 0;
  }
  return side;
}

/** Builds the setup; throws EffectError for impossible battles (no ships, same faction …). */
export function buildSeaSetup(state: GameState, content: Content, e: Omit<StartSeaBattleEffect, 'mode'>, ids: SeaSetupIds): SeaBattleSetup {
  const attacker = buildSide(state, content, e.attacker, ids, 'attacker');
  const defender = buildSide(state, content, e.defender, ids, 'defender');
  if (attacker.factionId === defender.factionId) throw new EffectError('startSeaBattle: both sides belong to the same faction');
  const t = content.tunables.seabattle;
  let wind = e.wind;
  if (!wind && e.zoneId !== undefined && Object.hasOwn(state.weather.zones, e.zoneId)) {
    const z = state.weather.zones[e.zoneId]!;
    wind = { dir: z.windDir, str: z.windStr };
  }
  if (!wind) {
    const str = ids.rng.weighted(WIND_STRENGTHS, (s) => t.setup.windWeights[s]) ?? 'fresh';
    wind = { dir: Math.floor(ids.rng.range(0, 360)), str };
  }
  const setup: SeaBattleSetup = {
    id: ids.id,
    seed: ids.seed,
    attacker,
    defender,
    wind: { dir: ((wind.dir % 360) + 360) % 360, str: wind.str },
    arena: e.arena ?? t.arenaGen.fallback,
    origin: e.origin,
    gentleMode: state.meta.options.gentleMode,
    duelAssist: state.meta.options.duelAssist,
    difficulty: state.meta.difficulty,
    returnMode: state.meta.mode,
  };
  if (e.coastBearing !== undefined) setup.coastBearing = e.coastBearing;
  if (e.omen !== undefined) setup.omen = e.omen;
  // The player aboard: the ruler commands the player's fleet when present.
  const ruler = state.characters[state.player.rulerId];
  for (const side of [attacker, defender]) {
    if (!side.isPlayer || !ruler || !ruler.alive) continue;
    const aboard = side.captainId === ruler.id || (ruler.location.kind === 'fleet' && side.fleetId !== undefined && ruler.location.id === side.fleetId);
    if (aboard) {
      setup.playerCharId = ruler.id;
      side.captainId = ruler.id;
      side.seafaring = ruler.skills.seafaring ?? 0;
      side.command = ruler.skills.command ?? 0;
      side.archery = ruler.skills.archery ?? 0;
      side.captainWeapon = content.cultures[ruler.culture]?.defaultWeapon ?? side.captainWeapon;
    }
  }
  delete attacker.fleetLeader;
  delete defender.fleetLeader;
  return setup;
}
