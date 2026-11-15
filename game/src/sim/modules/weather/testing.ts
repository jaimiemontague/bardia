/**
 * Weather test fixtures (ARCHITECTURE.md §16). Other modules' tests may import these to put a storm
 * or a wind into a state without running the weather rules.
 *
 *   const env = testEnv([weather, testMilitaryFakes]);
 *   let s = testState({ modules: [weather, testMilitaryFakes] });
 *   s = withStorm(s, env, { x: 300, y: 200, radius: 30 });
 *   s = withWind(s, env, 'whaleRoad', 270, 'gale');
 */
import type { EffectHandlers, SimEnv, SimModule } from '@sim/core/module';
import type { FleetId, FleetMode, GameState, MapPos, ShipId, StormCell, WindStrength } from '@sim/core/state';
import { inDraft } from '@sim/testing';
import './types';

type Loose = Record<string, unknown>;

/**
 * Stand-ins for the military module's killMen / damageShip / sinkShip effects (weather's tests do
 * not load the real military module). Minimal semantics: men removed from the fleet's record,
 * ship points reduced (a hull at 0 sinks), sunk ships leave their fleet and the world.
 */
export const testMilitaryFakes: SimModule = {
  id: 'testMilitary',
  order: 9001,
  effects: {
    killMen(draft: GameState, e: Loose) {
      const fleet = draft.fleets[e['fleetId'] as FleetId];
      if (!fleet) throw new Error(`killMen: unknown fleet ${String(e['fleetId'])}`);
      const unit = String(e['unit']);
      const left = Math.max(0, (fleet.men[unit] ?? 0) - Number(e['count']));
      if (left > 0) fleet.men[unit] = left;
      else delete fleet.men[unit];
    },
    damageShip(draft: GameState, e: Loose) {
      const ship = draft.ships[e['shipId'] as ShipId];
      if (!ship) throw new Error(`damageShip: unknown ship ${String(e['shipId'])}`);
      ship.hullHp = Math.max(0, ship.hullHp - Number(e['hull'] ?? 0));
      ship.sailHp = Math.max(0, ship.sailHp - Number(e['sail'] ?? 0));
      if (ship.hullHp <= 0) sink(draft, ship.id);
    },
    sinkShip(draft: GameState, e: Loose) {
      if (!draft.ships[e['shipId'] as ShipId]) throw new Error(`sinkShip: unknown ship ${String(e['shipId'])}`);
      sink(draft, e['shipId'] as ShipId);
    },
  } as unknown as EffectHandlers,
};

function sink(draft: GameState, shipId: ShipId): void {
  const ship = draft.ships[shipId];
  if (!ship) return;
  const fleetId = ship.locationFleetId;
  if (fleetId !== undefined) {
    const fleet = draft.fleets[fleetId];
    if (fleet) fleet.shipIds = fleet.shipIds.filter((id) => id !== shipId);
  }
  delete draft.ships[shipId];
}

/** Fields of a test storm cell (position and radius required; the rest default to a mature cell). */
export interface TestStormSpec {
  x: number;
  y: number;
  radius: number;
  id?: string;
  velocity?: MapPos;
  intensity?: number;
  /** Hours the cell has left (default 48). */
  ttl?: number;
  /** Hours it has lived (default `ttl`: mid-life, at peak, for the next ~40 % of `ttl`). */
  age?: number;
  met?: FleetId[];
  warned?: FleetId[];
}

/** Returns `state` with one more storm cell (at peak by default: radius and intensity as given). */
export function withStorm(state: GameState, env: SimEnv, spec: TestStormSpec): GameState {
  return inDraft(state, env, (draft) => {
    const w = draft.weather;
    const seq = w.seq ?? 1;
    w.seq = seq + 1;
    const hour = draft.time.hour;
    const ttl = spec.ttl ?? 48;
    const age = spec.age ?? ttl;
    const intensity = spec.intensity ?? 0.8;
    const cell: StormCell = {
      id: spec.id ?? `storm_${seq}`,
      pos: { x: spec.x, y: spec.y },
      radius: spec.radius,
      severity: intensity >= 0.75 ? 'severe' : intensity >= 0.45 ? 'moderate' : 'minor',
      velocity: spec.velocity ?? { x: 0, y: 0 },
      untilHour: hour + ttl,
      intensity,
      peakIntensity: intensity,
      peakRadius: spec.radius,
      bornHour: hour - age,
      zoneId: 'test',
      met: spec.met ?? [],
      warned: spec.warned ?? [],
    };
    w.storms.push(cell);
  }).state;
}

/** Returns `state` with no storm cells. */
export function withoutStorms(state: GameState, env: SimEnv): GameState {
  return inDraft(state, env, (draft) => {
    draft.weather.storms = [];
  }).state;
}

/** Returns `state` with a zone's current wind set (its keyframes held at that wind until the next sample). */
export function withWind(state: GameState, env: SimEnv, zoneId: string, dirDeg: number, strength: WindStrength, speedKn?: number): GameState {
  return inDraft(state, env, (draft) => {
    const z = draft.weather.zones[zoneId];
    const kn = speedKn ?? env.content.tunables.weather.wind.strengthKn[strength];
    if (!z) {
      draft.weather.zones[zoneId] = { windDir: dirDeg, windStr: strength, speed: kn, fog: false, ice: false };
      return;
    }
    z.windDir = dirDeg;
    z.windStr = strength;
    z.speed = kn;
    if (z.track) z.track = { ...z.track, fromDir: dirDeg, fromKn: kn, toDir: dirDeg, toKn: kn };
  }).state;
}

/** Returns `state` with a fleet moved to `pos` in `mode` (and its route cleared). */
export function withFleetAt(state: GameState, env: SimEnv, fleetId: FleetId, pos: MapPos, mode: FleetMode = 'sailing'): GameState {
  return inDraft(state, env, (draft) => {
    const f = draft.fleets[fleetId];
    if (!f) throw new Error(`withFleetAt: unknown fleet ${fleetId}`);
    f.pos = { x: pos.x, y: pos.y };
    f.mode = mode;
    f.route = [];
  }).state;
}
