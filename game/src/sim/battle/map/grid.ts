/**
 * The tactical battle map: a tile grid (1 tile = 2 m) stored in typed arrays, plus the static
 * entities placed by the generator (buildings, gates, ships, zones, guard posts). Generated once
 * per battle from the place's map seed; the engine copies the mutable parts (struct/terrain change
 * when gates break and buildings collapse).
 */
import type { BattleBuildingKind, BattleMapStyle, BattleTemplateId } from '@content/schemas/tunables/battle';

/** Ground kinds. Passability and speed come from `terrainInfo`. */
export const T = {
  open: 0,
  farm: 1,
  road: 2,
  woods: 3,
  marsh: 4,
  sand: 5,
  ford: 6,
  water: 7,
  rubble: 8,
  ditch: 9,
  rock: 10,
  bridge: 11,
  floor: 12,
} as const;
export type TerrainKind = (typeof T)[keyof typeof T];
export const TERRAIN_NAMES = ['open', 'farm', 'road', 'woods', 'marsh', 'sand', 'ford', 'water', 'rubble', 'ditch', 'rock', 'bridge', 'floor'] as const;
export type TerrainName = (typeof TERRAIN_NAMES)[number];

/** Structures standing on a tile. */
export const S = {
  none: 0,
  building: 1,
  wall: 2,
  gate: 3,
  /** Archer platform inside a wall (walkable, raised). */
  tower: 4,
  /** Field stakes (a camp's palisade line): impassable, gives the palisade terrain bonus next to it. */
  stakes: 5,
  /** A beached ship's hull. */
  ship: 6,
} as const;
export type StructKind = (typeof S)[keyof typeof S];

/** Zone bit flags. */
export const Z = {
  deployA: 1,
  deployD: 2,
  extractA: 4,
  extractD: 8,
  /** Inside the fortification ring (fort-ring defence applies). */
  inside: 16,
  /** Next to a wall or stakes on the inner side (cover against shots from outside). */
  wallCover: 32,
  /** Hiding ground for ambushers at deployment. */
  ambush: 64,
} as const;

export interface MapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A building placed by the generator. */
export interface MapBuilding {
  id: string;
  kind: BattleBuildingKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Walkable tile in front of the door (where loot is gathered and torches are set). */
  doorX: number;
  doorY: number;
  /** 0..1 after the style multiplier. */
  flammability: number;
  /** Relative share of the site's portable wealth held here (0 = no cache). */
  lootWeight: number;
  stone: boolean;
  /** The chief's hall / keep. */
  isKeep: boolean;
  /** The reliquary / treasury (cloister objective). */
  isTreasury: boolean;
}

/** A gate in the wall ring. */
export interface MapGate {
  id: string;
  /** Tiles covered (a horizontal or vertical run). */
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  /** Walkable tile just outside the gate (rams and torches work from here). */
  outX: number;
  outY: number;
  /** Walkable tile just inside the gate. */
  inX: number;
  inY: number;
}

/** Where the generator wants a defender squad to stand. */
export type GuardRole = 'chief' | 'gate' | 'tower' | 'cache' | 'patrol' | 'line' | 'reserve' | 'monks' | 'objective';
export interface GuardPost {
  x: number;
  y: number;
  role: GuardRole;
  /** Facing in radians (0 = +x, π/2 = +y). */
  facing: number;
}

/** A special objective (barrow entrance, cave mouth). */
export interface MapObjective {
  kind: 'barrow' | 'cave' | 'keep' | 'reliquary' | 'none';
  x: number;
  y: number;
}

export interface BattleMap {
  w: number;
  h: number;
  template: BattleTemplateId;
  style: BattleMapStyle;
  seed: string;
  fortTier: number;
  /** Ground per tile (TerrainKind). */
  terrain: Uint8Array;
  /** 0..3; ≥ tunables.hillHeight counts as hill. */
  height: Uint8Array;
  /** StructKind per tile. */
  struct: Uint8Array;
  /** Building index for S.building, gate index for S.gate, else −1. */
  structId: Int16Array;
  /** Z bit flags. */
  zone: Uint8Array;
  buildings: MapBuilding[];
  gates: MapGate[];
  ships: MapRect[];
  /** Ring rectangle (outer edge) when walls exist. */
  ring: MapRect | null;
  /** Deployment spots per side (attacker 0, defender 1), centre points ordered by preference. */
  deploy: [GuardPost[], GuardPost[]];
  /** Defender guard plan (chief, gates, towers, caches, patrols). */
  guards: GuardPost[];
  /** Where defender reinforcements (raid waves) enter. */
  waveSpawns: GuardPost[];
  objective: MapObjective;
  /** Direction attackers come from: 'south' (sea or overland edge), or 'sides' for ambushes. */
  attackFrom: 'south' | 'sides';
}

/** Speed and combat properties per terrain kind (combat values are balance.battle.terrain rows). */
export interface TerrainInfo {
  walkable: boolean;
  /** Key into balance.battle.terrain for def/acc/speed, or tunables.terrainSpeed for road/sand/rubble/ditch. */
  combat: 'open' | 'woods' | 'ford' | 'marsh';
  speedKey: 'open' | 'woods' | 'ford' | 'marsh' | 'road' | 'sand' | 'rubble' | 'ditch';
  hiding: boolean;
}

export const TERRAIN_INFO: readonly TerrainInfo[] = [
  { walkable: true, combat: 'open', speedKey: 'open', hiding: false }, // open
  { walkable: true, combat: 'open', speedKey: 'open', hiding: false }, // farm
  { walkable: true, combat: 'open', speedKey: 'road', hiding: false }, // road
  { walkable: true, combat: 'woods', speedKey: 'woods', hiding: true }, // woods
  { walkable: true, combat: 'marsh', speedKey: 'marsh', hiding: true }, // marsh
  { walkable: true, combat: 'open', speedKey: 'sand', hiding: false }, // sand
  { walkable: true, combat: 'ford', speedKey: 'ford', hiding: false }, // ford
  { walkable: false, combat: 'ford', speedKey: 'ford', hiding: false }, // water
  { walkable: true, combat: 'open', speedKey: 'rubble', hiding: false }, // rubble
  { walkable: true, combat: 'open', speedKey: 'ditch', hiding: false }, // ditch
  { walkable: false, combat: 'open', speedKey: 'open', hiding: false }, // rock
  { walkable: true, combat: 'open', speedKey: 'road', hiding: false }, // bridge
  { walkable: true, combat: 'open', speedKey: 'road', hiding: false }, // floor
];

/** Creates an empty (all open) map. */
export function createGrid(w: number, h: number, template: BattleTemplateId, style: BattleMapStyle, seed: string): BattleMap {
  const n = w * h;
  return {
    w,
    h,
    template,
    style,
    seed,
    fortTier: 0,
    terrain: new Uint8Array(n),
    height: new Uint8Array(n),
    struct: new Uint8Array(n),
    structId: new Int16Array(n).fill(-1),
    zone: new Uint8Array(n),
    buildings: [],
    gates: [],
    ships: [],
    ring: null,
    deploy: [[], []],
    guards: [],
    waveSpawns: [],
    objective: { kind: 'none', x: 0, y: 0 },
    attackFrom: 'south',
  };
}

/** Tile index of (x, y) (no bounds check). */
export function tileIndex(map: BattleMap, x: number, y: number): number {
  return y * map.w + x;
}

/** True when (x, y) is inside the map. */
export function inBounds(map: BattleMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.w && y < map.h;
}

/** Ground walkability ignoring structures. */
export function terrainWalkable(kind: number): boolean {
  return TERRAIN_INFO[kind]?.walkable === true;
}

/** Walkable for everyone right now: walkable ground and no blocking structure. */
export function tileWalkable(map: BattleMap, i: number): boolean {
  const s = map.struct[i]!;
  if (s !== S.none && s !== S.tower) return false;
  return terrainWalkable(map.terrain[i]!);
}

/** Tile of a world position (tiles are unit squares; centre of tile (x, y) is (x + 0.5, y + 0.5)). */
export function tileAt(map: BattleMap, x: number, y: number): number {
  const tx = Math.min(map.w - 1, Math.max(0, Math.floor(x)));
  const ty = Math.min(map.h - 1, Math.max(0, Math.floor(y)));
  return ty * map.w + tx;
}

/** Deep copy (the engine mutates struct/terrain as gates break and buildings collapse). */
export function cloneMap(map: BattleMap): BattleMap {
  return {
    ...map,
    terrain: map.terrain.slice(),
    height: map.height.slice(),
    struct: map.struct.slice(),
    structId: map.structId.slice(),
    zone: map.zone.slice(),
    buildings: map.buildings.map((b) => ({ ...b })),
    gates: map.gates.map((g) => ({ ...g })),
    ships: map.ships.map((s) => ({ ...s })),
    ring: map.ring ? { ...map.ring } : null,
    deploy: [map.deploy[0].map((p) => ({ ...p })), map.deploy[1].map((p) => ({ ...p }))],
    guards: map.guards.map((p) => ({ ...p })),
    waveSpawns: map.waveSpawns.map((p) => ({ ...p })),
    objective: { ...map.objective },
  };
}
