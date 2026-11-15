/**
 * Battle fixtures for tests and tools: synthetic BattleSetups without a GameState. Other modules'
 * tests may import these (e.g. to feed BattleEnded reactions a realistic setup/result).
 */
import type { Content } from '@content/index';
import type { BattleTemplateId } from '@content/schemas/tunables/battle';
import type { BattleKind, BattleSetup, CharId, CultureId, FormationId, OmenId, SettlementTierId, SiteKind, Squad } from '@sim/core/state';
import { unitOf, battleData } from './data';
import type { BattleEngine } from './engine/engine';
import type { BattleState } from './engine/types';
import type { BattleLeaderInfo, BattleLootPool } from './types';

/** One squad in a fixture: unit, men, and optionally a named leader. */
export interface FixtureSquad {
  unit: string;
  men: number;
  leader?: Partial<BattleLeaderInfo> & { id?: CharId };
  formation?: FormationId;
  vet?: 0 | 1 | 2 | 3;
  chief?: boolean;
}

export interface FixtureOptions {
  kind?: BattleKind;
  template?: BattleTemplateId;
  seed?: string;
  mapSeed?: string;
  culture?: CultureId;
  fortTier?: 0 | 1 | 2 | 3 | 4;
  settlementTier?: SettlementTierId;
  siteKind?: SiteKind;
  approach?: 'night' | 'dawn' | 'challenge';
  attacker?: FixtureSquad[];
  defender?: FixtureSquad[];
  playerSide?: 'attacker' | 'defender' | null;
  loot?: BattleLootPool;
  lootCeiling?: number;
  timerS?: number;
  windDir?: number;
  windStr?: number;
  rain?: boolean;
  coastal?: boolean;
  hasRam?: boolean;
  hasPitch?: boolean;
  ladders?: boolean;
  omen?: OmenId;
  armourTier?: [number, number];
  weaponTier?: [number, number];
  church?: boolean;
}

const DEFAULT_ATTACKERS: FixtureSquad[] = [
  { unit: 'huscarls', men: 40, leader: { name: 'Hallvard', command: 4, melee: 5, isPlayer: true, role: 'player' } },
  { unit: 'bondi', men: 50, leader: { name: 'Eyvind', command: 3, role: 'lieutenant' } },
  { unit: 'archers', men: 30, leader: { name: 'Sigrun', command: 2, archery: 4, role: 'lieutenant' } },
  { unit: 'berserkers', men: 20, leader: { name: 'Ulfgeir', command: 2, role: 'lieutenant' } },
];
const DEFAULT_DEFENDERS: FixtureSquad[] = [
  { unit: 'thegns', men: 30, leader: { name: 'Aldred', command: 3, role: 'chief' }, chief: true },
  { unit: 'fyrdSpearmen', men: 40 },
  { unit: 'fyrdSpearmen', men: 40 },
  { unit: 'albricBowmen', men: 30 },
];

/** The template a battle kind is usually fought on (relic sites by their kind). */
export function defaultTemplate(kind: BattleKind, site?: SiteKind): BattleTemplateId {
  switch (kind) {
    case 'field':
    case 'sortie':
      return 'field';
    case 'guardian':
      return site === 'shrine' || site === 'grove' ? 'forest' : site === 'wreck' || site === 'seaStack' ? 'beach' : site === 'tower' || site === 'ruinedHall' ? 'field' : 'caveMouth';
    case 'beach':
      return 'beach';
    case 'ambush':
      return 'forest';
    case 'cloister':
      return 'cloister';
    case 'fortress':
      return 'fortress';
    case 'assault':
    case 'defense':
      return 'town';
    default:
      return 'village';
  }
}

/** Default defenders for a kind: a chief's warband, cloister guards and monks, or site guardians. */
export function defaultDefenders(kind: BattleKind, site?: SiteKind): FixtureSquad[] {
  if (kind === 'cloister') return [{ unit: 'cloisterGuard', men: 25, leader: { name: 'Prior', command: 1, role: 'chief' }, chief: true }, { unit: 'cloisterGuard', men: 15 }, { unit: 'monks', men: 12 }];
  if (kind === 'guardian') {
    if (site === 'barrow') return [{ unit: 'barrowWardens', men: 30 }, { unit: 'barrowWardens', men: 20 }];
    if (site === 'shrine') return [{ unit: 'hermitClan', men: 30 }, { unit: 'hermitClan', men: 20 }];
    if (site === 'wreck' || site === 'seaStack') return [{ unit: 'wreckers', men: 30 }, { unit: 'wreckers', men: 20 }];
    if (site === 'tower' || site === 'ruinedHall') return [{ unit: 'outlaws', men: 35 }, { unit: 'outlaws', men: 25 }];
    return [{ unit: 'greatBear', men: 1 }, { unit: 'wolfPack', men: 12 }];
  }
  return DEFAULT_DEFENDERS;
}

function leaderInfo(p: Partial<BattleLeaderInfo>, fallbackName: string): BattleLeaderInfo {
  return {
    name: p.name ?? fallbackName,
    command: p.command ?? 2,
    melee: p.melee ?? 3,
    archery: p.archery ?? 1,
    wildcraft: p.wildcraft ?? 1,
    moraleMod: p.moraleMod ?? 0,
    defPct: p.defPct ?? 0,
    hpPct: p.hpPct ?? 100,
    isPlayer: p.isPlayer ?? false,
    acceptsChallenge: p.acceptsChallenge ?? false,
    warHorn: p.warHorn ?? false,
    role: p.role ?? 'leader',
  };
}

/** A synthetic BattleSetup (deterministic in its options). */
export function makeTestSetup(content: Content, opts: FixtureOptions = {}): BattleSetup {
  const data = battleData(content);
  const kind = opts.kind ?? 'raid';
  const template = opts.template ?? defaultTemplate(kind, opts.siteKind);
  const seed = opts.seed ?? 'fixture';
  const leaders: Record<string, BattleLeaderInfo> = {};
  let nextChar = 9000;
  const playerSide = opts.playerSide === undefined ? 'attacker' : opts.playerSide;
  const build = (list: FixtureSquad[], side: 'attacker' | 'defender'): { squads: Squad[]; chiefId?: CharId } => {
    let chiefId: CharId | undefined;
    const squads = list.map((f, k): Squad => {
      const unit = unitOf(data, f.unit);
      const named = f.leader !== undefined;
      const id: CharId = f.leader?.id ?? (`chr_${nextChar++}` as CharId);
      if (named) {
        const info = leaderInfo(f.leader!, `${side}${k}`);
        if (side !== playerSide) info.isPlayer = false;
        leaders[id] = info;
      }
      if (f.chief) chiefId = id;
      const sq: Squad = {
        leaderId: id,
        unit: f.unit,
        men: f.men,
        vetStars: f.vet ?? 0,
        formation: f.formation ?? unit.formations[0] ?? 'line',
        sources: [{ kind: 'explicit', men: f.men }],
      };
      if (!named) sq.unnamed = true;
      return sq;
    });
    return chiefId !== undefined ? { squads, chiefId } : { squads };
  };
  const att = build(opts.attacker ?? DEFAULT_ATTACKERS, 'attacker');
  const def = build(opts.defender ?? defaultDefenders(kind, opts.siteKind), 'defender');
  const setup: BattleSetup = {
    id: 'bat_test',
    kind,
    mapTemplate: template,
    seed,
    approach: opts.approach ?? 'dawn',
    attacker: {
      factionId: 'fac_a',
      squads: att.squads,
      armourTier: opts.armourTier?.[0] ?? 1,
      weaponTier: opts.weaponTier?.[0] ?? 1,
      moraleMods: 0,
      isPlayer: playerSide === 'attacker',
      culture: 'skarn',
      hasRam: opts.hasRam ?? false,
      hasPitch: opts.hasPitch ?? false,
      ladders: opts.ladders ?? false,
    },
    defender: {
      factionId: 'fac_d',
      squads: def.squads,
      armourTier: opts.armourTier?.[1] ?? 1,
      weaponTier: opts.weaponTier?.[1] ?? 1,
      moraleMods: 0,
      isPlayer: playerSide === 'defender',
      culture: opts.culture ?? 'albric',
    },
    weather: { windDir: opts.windDir ?? 270, windStr: opts.windStr ?? 0.25, rain: opts.rain ?? false, night: opts.approach === 'night' },
    mapSeed: opts.mapSeed ?? `${seed}|map`,
    culture: opts.culture ?? 'albric',
    fortTier: opts.fortTier ?? 0,
    leaders,
    difficulty: 'raider',
    gentleMode: false,
    lootCeiling: opts.lootCeiling ?? (kind === 'raid' ? content.balance.loot.raidMaxShare : content.balance.loot.assaultMaxShare),
    loot: opts.loot ?? { silver: 2000, goods: { furs: 2, cloth: 3 } },
  };
  if (att.chiefId) setup.attacker.chiefId = att.chiefId;
  if (def.chiefId) setup.defender.chiefId = def.chiefId;
  if (opts.timerS !== undefined) setup.timerS = opts.timerS;
  if (opts.settlementTier !== undefined) setup.settlementTier = opts.settlementTier;
  if (opts.siteKind !== undefined) setup.siteKind = opts.siteKind;
  if (opts.coastal !== undefined) setup.coastal = opts.coastal;
  if (opts.omen !== undefined) setup.omen = opts.omen;
  if (opts.church !== undefined) setup.church = opts.church;
  return setup;
}

/**
 * A compact, order-independent digest of an engine state (squad numbers, positions, morale,
 * buildings, gates, caches, tick) for determinism tests: equal digests ⇔ the same battle.
 */
export function battleDigest(state: BattleState): string {
  const r = (x: number) => Math.round(x * 1e6) / 1e6;
  return JSON.stringify({
    tick: state.tick,
    status: state.status,
    squads: state.squads.map((s) => [s.id, s.status, s.men, s.lost, r(s.x), r(s.y), r(s.facing), r(s.morale), r(s.stamina), r(s.loot), s.formation, s.task.kind]),
    buildings: state.buildings.map((b) => [b.burning, b.collapsed, r(b.burnT)]),
    gates: state.gates.map((g) => [r(g.hp), g.broken]),
    caches: state.caches.map((c) => r(c.value)),
    rng: state.rng.getState(),
    end: state.end,
  });
}

/** Steps an engine until it ends (auto-resolving duels) or `maxTicks` pass; returns ticks run. */
export function runEngine(engine: BattleEngine, maxTicks = 20 * 60 * 30): number {
  const start = engine.tick;
  let guard = 0;
  while (engine.status !== 'ended' && engine.tick - start < maxTicks && guard++ < maxTicks * 2) {
    if (engine.status === 'duelRequested') engine.autoResolveDuel();
    else engine.step(1);
  }
  return engine.tick - start;
}
