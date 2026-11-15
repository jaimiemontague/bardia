/**
 * Sea-battle colours. The sides use the battle view's colours (design §25.2: the player's side a cold
 * blue, the enemy a hot red, never confused); the sea, coasts and ships stay in the game's earthy,
 * desaturated palette so the fleets read on the water.
 */

export type Rgb = readonly [number, number, number];

export const SIDE = {
  player: { fill: 0x3d7fe0, dark: 0x0f2a5c, light: 0xa8ccff, sail: 0x2f63b8 },
  enemy: { fill: 0xd2412f, dark: 0x4f0f08, light: 0xffb3a6, sail: 0xa8321f },
} as const;

export type SidePalette = (typeof SIDE)['player'] | (typeof SIDE)['enemy'];

export const SEA = {
  deep: [26, 70, 88] as Rgb,
  deeper: [18, 52, 68] as Rgb,
  shallow: [64, 132, 128] as Rgb,
  sand: [194, 176, 124] as Rgb,
  land: [86, 104, 58] as Rgb,
  landDark: [64, 80, 44] as Rgb,
  rock: [104, 100, 96] as Rgb,
  rockDark: [70, 66, 62] as Rgb,
  outside: 0x112f3d,
  crest: 0xd8eef0,
  foam: 0xf2fbfb,
} as const;

export const SHIP = {
  hull: 0x5e3d22,
  hullDark: 0x3a2412,
  deck: 0x9a7448,
  deckLine: 0x6e4f2e,
  oar: 0x2e1d0f,
  mast: 0x2a1a0c,
  sailCloth: 0xe9dfc6,
  bronze: 0xb08a3e,
  gold: 0xf2c94c,
  white: 0xf5f1e6,
  struck: 0xc9c3b6,
} as const;

export const FX = {
  select: 0xfff2a8,
  hover: 0xffffff,
  move: 0x9be37a,
  attack: 0xff6a4f,
  shoot: 0xffc857,
  fire: 0xff8a1e,
  fireCore: 0xffd56a,
  smoke: 0x4a4744,
  arrow: 0x1d140c,
  rope: 0xd2ad6a,
  splinter: 0x7a5228,
  ink: 0x1a120c,
} as const;

export function rgbHex(c: Rgb): number {
  return (c[0] << 16) | (c[1] << 8) | c[2];
}

export function mixHex(a: number, b: number, t: number): number {
  const ra = (a >> 16) & 255;
  const ga = (a >> 8) & 255;
  const ba = a & 255;
  const rb = (b >> 16) & 255;
  const gb = (b >> 8) & 255;
  const bb = b & 255;
  return (Math.round(ra + (rb - ra) * t) << 16) | (Math.round(ga + (gb - ga) * t) << 8) | Math.round(ba + (bb - ba) * t);
}

/** Stable pseudo-random 0..1 for integer-ish inputs (animation jitter, never gameplay). */
export function hash01(a: number, b: number, c = 0): number {
  let h = Math.imul(Math.floor(a) | 0, 374761393) ^ Math.imul(Math.floor(b) | 0, 668265263) ^ Math.imul(Math.floor(c) | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
