/**
 * Sea-battle fixtures for tests and tools (other modules' tests may import them): build a
 * SeaBattleSetup directly, without GameState.
 *
 *   const setup = makeSeaSetup({ attacker: { ships: ['snekkja', 'snekkja'] }, defender: { ships: ['galley'], culture: 'saraleonese' } });
 *   const result = new SeaBattleEngine(setup, testSeaContent(), { aiControlsPlayer: true }).runToEnd();
 */
import { getContent, type Content } from '@content/index';
import type { CharId, CultureId, FactionId, SeaBattleSetup, SeaShipSetup, SeaSideSetup, ShipId, ShipTypeId, WindStrength } from '@sim/core/state';
import type { SeaEngineContent } from './engineTypes';
import { defaultDeck } from './setup';
import type { SeaSideRole } from './types';

/** Engine content from the bundled catalogs (or a substitute). */
export function testSeaContent(content: Pick<Content, 'balance' | 'tunables'> = getContent()): SeaEngineContent {
  return { balance: content.balance, tunables: content.tunables.seabattle };
}

export interface TestSeaShip {
  type: ShipTypeId;
  crew?: number;
  archers?: number;
  boarders?: number;
  hullHp?: number;
  sailHp?: number;
  atk?: number;
  def?: number;
  rangedAtk?: number;
}

export interface TestSeaSide {
  ships: (ShipTypeId | TestSeaShip)[];
  factionId?: FactionId;
  role?: SeaSideRole;
  culture?: CultureId;
  isPlayer?: boolean;
  morale?: number;
  armourTier?: number;
  weaponTier?: number;
  pitchT?: number;
  captainId?: CharId;
  seafaring?: number;
  command?: number;
  archery?: number;
  dread?: number;
  stamina?: number;
  fireArrows?: boolean;
  /** Default crew as a share of crewMax (default 0.85). */
  crewShare?: number;
}

export interface TestSeaSetupOptions {
  seed?: string;
  attacker: TestSeaSide;
  defender: TestSeaSide;
  wind?: { dir: number; str: WindStrength };
  arena?: string;
  coastBearing?: number;
  playerCharId?: CharId;
  gentleMode?: boolean;
}

function side(spec: TestSeaSide, prefix: string, fallbackFaction: FactionId, content: SeaEngineContent): SeaSideSetup {
  const role = spec.role ?? 'warfleet';
  const ships: SeaShipSetup[] = spec.ships.map((raw, k) => {
    const s: TestSeaShip = typeof raw === 'string' ? { type: raw } : raw;
    const def = content.balance.ships[s.type];
    const crew = s.crew ?? Math.round(def.crewMax * (spec.crewShare ?? 0.85));
    const deck = defaultDeck(content.tunables, role, crew, 0);
    const archers = Math.min(crew, s.archers ?? deck.archers);
    const boarders = Math.min(crew - archers, s.boarders ?? deck.boarders);
    return {
      shipId: `shp_${prefix}${k}` as ShipId,
      type: s.type,
      hullHp: s.hullHp ?? def.hull,
      sailHp: s.sailHp ?? def.sail,
      crew,
      archers,
      boarders,
      atk: s.atk ?? 4,
      def: s.def ?? 4,
      rangedAtk: s.rangedAtk ?? 5,
      name: `${def.name} ${prefix}${k}`,
      cargoShare: 1 / spec.ships.length,
    };
  });
  const out: SeaSideSetup = {
    factionId: spec.factionId ?? fallbackFaction,
    ships,
    armourTier: spec.armourTier ?? 1,
    weaponTier: spec.weaponTier ?? 1,
    morale: spec.morale ?? 70,
    isPlayer: spec.isPlayer ?? false,
    hasPitch: (spec.pitchT ?? 0) > 0,
    role,
    pitchT: spec.pitchT ?? 0,
  };
  if (spec.culture !== undefined) out.culture = spec.culture;
  if (spec.captainId !== undefined) out.captainId = spec.captainId;
  if (spec.seafaring !== undefined) out.seafaring = spec.seafaring;
  if (spec.command !== undefined) out.command = spec.command;
  if (spec.archery !== undefined) out.archery = spec.archery;
  if (spec.dread !== undefined) out.dread = spec.dread;
  if (spec.stamina !== undefined) out.stamina = spec.stamina;
  if (spec.fireArrows !== undefined) out.fireArrows = spec.fireArrows;
  return out;
}

/**
 * Engine content with an extra obstacle-free arena template 'testEmpty' and optional deep overrides
 * of the sea tunables (e.g. `{ boarding: { cutFreeMax: 0 } }`), for white-box physics tests.
 */
export function testSeaContentWith(overrides: DeepPartial<SeaEngineContent['tunables']> = {}, base: SeaEngineContent = testSeaContent()): SeaEngineContent {
  const t = JSON.parse(JSON.stringify(base.tunables)) as SeaEngineContent['tunables'];
  t.arenas.testEmpty = {
    coasts: 0,
    coastDepthM: [0, 0],
    coastRoughnessM: 0,
    islands: [0, 0],
    islandRadiusM: [10, 10],
    rocks: [0, 0],
    rockRadiusM: [1, 1],
    shoals: [0, 0],
    shoalRadiusM: [10, 10],
    shallowsM: 0,
    rockShallowsM: 0,
  };
  merge(t as unknown as Record<string, unknown>, overrides as Record<string, unknown>);
  return { balance: base.balance, tunables: t };
}

/** Recursive Partial for tunable overrides. */
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

function merge(into: Record<string, unknown>, from: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(from)) {
    const cur = into[k];
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && cur !== null && typeof cur === 'object' && !Array.isArray(cur)) {
      merge(cur as Record<string, unknown>, v as Record<string, unknown>);
    } else into[k] = v;
  }
}

/** A complete setup from short specs (deterministic ship ids shp_a0…, shp_d0…). */
export function makeSeaSetup(opts: TestSeaSetupOptions, content: SeaEngineContent = testSeaContent()): SeaBattleSetup {
  const setup: SeaBattleSetup = {
    id: 'sea_test',
    seed: opts.seed ?? 'sea-test-seed',
    attacker: side(opts.attacker, 'a', 'fac_9001' as FactionId, content),
    defender: side(opts.defender, 'd', 'fac_9002' as FactionId, content),
    wind: opts.wind ?? { dir: 90, str: 'fresh' },
    arena: opts.arena ?? 'openSea',
    origin: 'test',
  };
  if (opts.coastBearing !== undefined) setup.coastBearing = opts.coastBearing;
  if (opts.playerCharId !== undefined) setup.playerCharId = opts.playerCharId;
  if (opts.gentleMode !== undefined) setup.gentleMode = opts.gentleMode;
  return setup;
}
