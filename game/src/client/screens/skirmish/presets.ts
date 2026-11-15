/**
 * Skirmish match-ups: standalone battles built with the battle module's own setup fixture
 * (`makeTestSetup`), so they run on exactly the engine, maps and AI a campaign battle uses, with no
 * campaign state and no consequences. The player always leads the attackers. Names are invented.
 */
import type { Content } from '@content/index';
import { makeTestSetup, type FixtureOptions } from '@sim/battle/testing';
import type { BattleSetup, CharId, SeaBattleSetup } from '@sim/core/state';
import { seaContent } from '@sim/seabattle/index';
import { makeSeaSetup, type TestSeaSetupOptions } from '@sim/seabattle/testing';

export type SkirmishPresetId = 'raid' | 'field' | 'assault' | 'cloister';

export interface SkirmishPreset {
  id: SkirmishPresetId;
  /** Locale keys (menu.skirmish.preset.<id>.title / .body). */
  titleKey: string;
  bodyKey: string;
  icon: 'ship' | 'sword' | 'shieldRound' | 'crown';
  options: FixtureOptions;
}

const WARBAND: NonNullable<FixtureOptions['attacker']> = [
  { unit: 'huscarls', men: 40, leader: { name: 'Haldrek', command: 4, melee: 5, isPlayer: true, role: 'player', warHorn: true } },
  { unit: 'bondi', men: 50, leader: { name: 'Torvin', command: 3, role: 'lieutenant' } },
  { unit: 'archers', men: 30, leader: { name: 'Asmira', command: 2, archery: 4, role: 'lieutenant' } },
  { unit: 'berserkers', men: 20, leader: { name: 'Grimhald', command: 2, role: 'lieutenant' } },
];

export const SKIRMISH_PRESETS: readonly SkirmishPreset[] = [
  {
    id: 'raid',
    titleKey: 'menu.skirmish.preset.raid.title',
    bodyKey: 'menu.skirmish.preset.raid.body',
    icon: 'ship',
    options: { kind: 'raid', template: 'village', culture: 'albric', attacker: WARBAND, hasPitch: true, windDir: 200, windStr: 0.45 },
  },
  {
    id: 'field',
    titleKey: 'menu.skirmish.preset.field.title',
    bodyKey: 'menu.skirmish.preset.field.body',
    icon: 'sword',
    options: {
      kind: 'field',
      template: 'field',
      culture: 'albric',
      coastal: false,
      attacker: [
        { unit: 'huscarls', men: 40, leader: { name: 'Haldrek', command: 4, melee: 5, isPlayer: true, role: 'player' } },
        { unit: 'bondi', men: 50, leader: { name: 'Torvin', command: 3, role: 'lieutenant' } },
        { unit: 'bondi', men: 40, leader: { name: 'Vermar', command: 2, role: 'lieutenant' } },
        { unit: 'archers', men: 30, leader: { name: 'Asmira', command: 2, archery: 4, role: 'lieutenant' } },
        { unit: 'skirmishers', men: 25 },
      ],
      defender: [
        { unit: 'thegns', men: 30, leader: { name: 'Cedrow of Fennow', command: 3, role: 'chief' }, chief: true },
        { unit: 'fyrdSpearmen', men: 45 },
        { unit: 'fyrdSpearmen', men: 45 },
        { unit: 'albricBowmen', men: 30 },
        { unit: 'horsemen', men: 20 },
      ],
    },
  },
  {
    id: 'assault',
    titleKey: 'menu.skirmish.preset.assault.title',
    bodyKey: 'menu.skirmish.preset.assault.body',
    icon: 'shieldRound',
    options: {
      kind: 'assault',
      template: 'town',
      culture: 'albric',
      fortTier: 2,
      hasRam: true,
      hasPitch: true,
      attacker: [
        { unit: 'huscarls', men: 45, leader: { name: 'Haldrek', command: 4, melee: 5, isPlayer: true, role: 'player' } },
        { unit: 'bondi', men: 60, leader: { name: 'Torvin', command: 3, role: 'lieutenant' } },
        { unit: 'bondi', men: 50, leader: { name: 'Vermar', command: 2, role: 'lieutenant' } },
        { unit: 'archers', men: 35, leader: { name: 'Asmira', command: 2, archery: 4, role: 'lieutenant' } },
        { unit: 'berserkers', men: 25, leader: { name: 'Grimhald', command: 2, role: 'lieutenant' } },
      ],
      defender: [
        { unit: 'thegns', men: 30, leader: { name: 'Cedrow of Fennow', command: 3, role: 'chief' }, chief: true },
        { unit: 'fyrdSpearmen', men: 40 },
        { unit: 'fyrdSpearmen', men: 40 },
        { unit: 'albricBowmen', men: 30 },
      ],
    },
  },
  {
    id: 'cloister',
    titleKey: 'menu.skirmish.preset.cloister.title',
    bodyKey: 'menu.skirmish.preset.cloister.body',
    icon: 'crown',
    options: { kind: 'cloister', template: 'cloister', culture: 'albric', fortTier: 1, attacker: WARBAND.slice(0, 3), hasPitch: true, church: true },
  },
];

/** The battle setup of a preset; `run` varies the seed so each try is a fresh field. */
export function skirmishSetup(content: Content, id: SkirmishPresetId, run = 0): BattleSetup {
  const preset = SKIRMISH_PRESETS.find((p) => p.id === id) ?? SKIRMISH_PRESETS[0]!;
  const seed = `skirmish-${preset.id}-${run}`;
  const setup = makeTestSetup(content, { ...preset.options, seed, mapSeed: `${seed}|map`, playerSide: 'attacker' });
  setup.id = `bat_skirmish_${run}`;
  setup.origin = 'skirmish';
  return setup;
}

// ---- at sea ---------------------------------------------------------------------------------------

export type SeaSkirmishPresetId = 'seaPair' | 'seaMerchant' | 'seaStand';

export interface SeaSkirmishPreset {
  id: SeaSkirmishPresetId;
  /** Locale keys (seaView.skirmish.preset.<id>.title / .body). */
  titleKey: string;
  bodyKey: string;
  icon: 'ship' | 'sword' | 'shieldRound' | 'silver';
  options: Omit<TestSeaSetupOptions, 'seed'>;
  /** Ship names (keys under seaView.skirmish.ship), the player's side first, in setup order. */
  names: { own: string[]; foe: string[] };
  /** The enemy flagship carries a named captain the player may face on deck. */
  enemyCaptain?: boolean;
  /** The defenders' hold (plunder for prizes). */
  cargo?: { silver: number; goods: Record<string, number> };
}

const PLAYER_CHAR = 'chr_skirmish_player' as CharId;
const ENEMY_CHAR = 'chr_skirmish_enemy' as CharId;

export const SEA_SKIRMISH_PRESETS: readonly SeaSkirmishPreset[] = [
  {
    id: 'seaPair',
    titleKey: 'seaView.skirmish.preset.seaPair.title',
    bodyKey: 'seaView.skirmish.preset.seaPair.body',
    icon: 'ship',
    options: {
      arena: 'skerries',
      wind: { dir: 230, str: 'fresh' },
      attacker: { ships: ['drakkar', 'snekkja'], isPlayer: true, culture: 'skarn', morale: 75, armourTier: 2, weaponTier: 2, pitchT: 1, command: 3, archery: 2 },
      defender: { ships: ['snekkja', 'snekkja'], culture: 'hvarn', role: 'raider', morale: 70, armourTier: 2, weaponTier: 2 },
    },
    names: { own: ['wolf', 'gull'], foe: ['raven', 'thorn'] },
    enemyCaptain: true,
  },
  {
    id: 'seaMerchant',
    titleKey: 'seaView.skirmish.preset.seaMerchant.title',
    bodyKey: 'seaView.skirmish.preset.seaMerchant.body',
    icon: 'silver',
    options: {
      arena: 'coastal',
      wind: { dir: 160, str: 'light' },
      attacker: { ships: ['snekkja', 'snekkja', 'karvi'], isPlayer: true, culture: 'skarn', morale: 72, armourTier: 1, weaponTier: 2, command: 2 },
      defender: { ships: ['knarr', 'snekkja'], culture: 'albric', role: 'merchant', morale: 55, armourTier: 1, weaponTier: 1 },
    },
    names: { own: ['wolf', 'otter', 'tern'], foe: ['whale', 'hawk'] },
    cargo: { silver: 240, goods: { cloth: 6, salt: 4 } },
  },
  {
    id: 'seaStand',
    titleKey: 'seaView.skirmish.preset.seaStand.title',
    bodyKey: 'seaView.skirmish.preset.seaStand.body',
    icon: 'shieldRound',
    options: {
      arena: 'openSea',
      wind: { dir: 20, str: 'strong' },
      attacker: { ships: ['snekkja', 'snekkja', 'drakkar', 'karvi'], culture: 'hvarn', role: 'warfleet', morale: 70, armourTier: 2, weaponTier: 2 },
      defender: { ships: ['drakkar', 'snekkja'], isPlayer: true, culture: 'skarn', morale: 78, armourTier: 2, weaponTier: 2, pitchT: 1, command: 3 },
    },
    names: { own: ['bear', 'gull'], foe: ['lance', 'ember', 'keel', 'ash'] },
    enemyCaptain: true,
  },
];

/**
 * The sea-battle setup of a preset (the seabattle module's own fixture, so it runs on exactly the
 * engine and AI a campaign sea battle uses); `run` varies the seed so each try is fresh water.
 * `name` turns a ship-name key into the displayed name.
 */
export function seaSkirmishSetup(content: Content, id: SeaSkirmishPresetId, run: number, name: (key: string) => string): SeaBattleSetup {
  const preset = SEA_SKIRMISH_PRESETS.find((p) => p.id === id) ?? SEA_SKIRMISH_PRESETS[0]!;
  const seed = `skirmish-${preset.id}-${run}`;
  const playerIsAttacker = preset.options.attacker.isPlayer === true;
  const opts: TestSeaSetupOptions = JSON.parse(JSON.stringify({ ...preset.options, seed })) as TestSeaSetupOptions;
  const own = playerIsAttacker ? opts.attacker : opts.defender;
  const foe = playerIsAttacker ? opts.defender : opts.attacker;
  own.captainId = PLAYER_CHAR;
  opts.playerCharId = PLAYER_CHAR;
  if (preset.enemyCaptain) foe.captainId = ENEMY_CHAR;
  const setup = makeSeaSetup(opts, seaContent(content));
  setup.id = `sea_skirmish_${run}` as SeaBattleSetup['id'];
  setup.origin = 'skirmish';
  const ownSide = playerIsAttacker ? setup.attacker : setup.defender;
  const foeSide = playerIsAttacker ? setup.defender : setup.attacker;
  ownSide.ships.forEach((s, i) => {
    const k = preset.names.own[i];
    if (k !== undefined) s.name = name(`seaView.skirmish.ship.${k}`);
  });
  foeSide.ships.forEach((s, i) => {
    const k = preset.names.foe[i];
    if (k !== undefined) s.name = name(`seaView.skirmish.ship.${k}`);
  });
  if (preset.cargo) {
    foeSide.silver = preset.cargo.silver;
    foeSide.cargo = { ...preset.cargo.goods } as NonNullable<typeof foeSide.cargo>;
    // The laden knarr carries most of it.
    foeSide.ships.forEach((s, i) => (s.cargoShare = i === 0 ? 0.8 : 0.2 / Math.max(1, foeSide.ships.length - 1)));
  }
  return setup;
}

/** Display names of the skirmish's invented captains. */
export function seaSkirmishCaptainName(id: string, name: (key: string) => string): string | undefined {
  if (id === PLAYER_CHAR) return name('seaView.skirmish.captain.player');
  if (id === ENEMY_CHAR) return name('seaView.skirmish.captain.enemy');
  return undefined;
}
