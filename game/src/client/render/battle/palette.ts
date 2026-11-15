/**
 * Battle-view colours (design §25.2 readability: friend and foe must never be confused). The player's
 * side is a cold blue, the enemy a hot red; neutral map colours stay earthy and desaturated so the
 * armies read on every kind of ground.
 */

export type Rgb = readonly [number, number, number];

/** Ground colours per terrain kind (index = TerrainKind of src/sim/battle/map/grid.ts). */
export const TERRAIN_RGB: readonly Rgb[] = [
  [104, 128, 70], // open
  [150, 138, 82], // farm
  [150, 128, 96], // road
  [56, 88, 52], // woods
  [86, 106, 88], // marsh
  [206, 190, 146], // sand
  [96, 140, 160], // ford
  [44, 84, 128], // water
  [112, 104, 94], // rubble
  [86, 76, 60], // ditch
  [92, 88, 90], // rock
  [134, 104, 70], // bridge
  [124, 114, 104], // floor
];

export const WALL_RGB: Rgb = [70, 66, 62];
export const WALL_TOP_RGB: Rgb = [118, 112, 104];
export const TOWER_RGB: Rgb = [96, 90, 84];
export const STAKES_RGB: Rgb = [112, 80, 46];
export const SHIP_RGB: Rgb = [96, 64, 36];
export const EXTRACT_RGB: Rgb = [90, 200, 220];

/** Building roof colours by kind (stone buildings are greyed). */
export const BUILDING_RGB: Readonly<Record<string, Rgb>> = {
  longhall: [128, 76, 44],
  keep: [120, 118, 122],
  house: [150, 96, 62],
  storehouse: [136, 106, 62],
  church: [190, 184, 170],
  shrine: [126, 66, 96],
  barracks: [118, 86, 58],
  workshop: [142, 110, 80],
  stable: [156, 118, 70],
  granary: [178, 146, 80],
  tent: [196, 178, 140],
  cloisterHall: [176, 168, 146],
  boathouse: [110, 84, 60],
};

/** Side colours: [fill, outline, light] as 0xRRGGBB. */
export const SIDE_COLORS = {
  player: { fill: 0x3d7fe0, dark: 0x0f2a5c, light: 0xa8ccff },
  enemy: { fill: 0xd2412f, dark: 0x4f0f08, light: 0xffb3a6 },
} as const;

export const COLORS = {
  select: 0xfff2a8,
  hover: 0xffffff,
  move: 0x9be37a,
  attack: 0xff6a4f,
  loot: 0xf2c94c,
  torch: 0xff9a2e,
  waver: 0xf2c94c,
  rout: 0xffffff,
  fire: 0xff8a1e,
  fireCore: 0xffd56a,
  smoke: 0x55524e,
  gold: 0xf2c94c,
  ink: 0x1a120c,
  night: 0x0b1530,
  extract: 0x5ac8dc,
  /** Aim marker of a volley being drawn (Space held). */
  aim: 0xffd84a,
} as const;

/** 0xRRGGBB from an RGB triple. */
export function rgbHex(c: Rgb): number {
  return (c[0] << 16) | (c[1] << 8) | c[2];
}

/** Mixes two RGB triples (t = 0 → a, 1 → b). */
export function mixRgb(a: Rgb, b: Rgb, t: number): [number, number, number] {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}
