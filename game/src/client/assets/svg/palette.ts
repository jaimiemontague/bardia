/**
 * Colour helpers and the shared placeholder palette ("carved and painted", design §27.1): dark oak,
 * iron and bone for chrome; warm firelit interiors; cold blue exteriors; faction colours on sails
 * and shields. Every generator draws its colours from here so the placeholder set stays coherent.
 */
import type { CultureId } from '@content/schemas/ids';

/** Parses #rgb / #rrggbb into [r, g, b] (0–255). Invalid input yields mid grey. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [128, 128, 128];
  const v = parseInt(h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function clamp255(x: number): number {
  return Math.max(0, Math.min(255, Math.round(x)));
}

/** [r, g, b] → #rrggbb. */
export function rgbToHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) | (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b)).toString(16).slice(1)}`;
}

/** Linear mix of two colours (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const k = Math.max(0, Math.min(1, t));
  return rgbToHex(ar + (br - ar) * k, ag + (bg - ag) * k, ab + (bb - ab) * k);
}

/** Darkens (amount < 0) or lightens (amount > 0) towards black/white. */
export function shade(c: string, amount: number): string {
  return amount < 0 ? mix(c, '#000000', -amount) : mix(c, '#ffffff', amount);
}

/** HSL (h in degrees, s/l in 0..1) → hex. */
export function hsl(h: number, s: number, l: number): string {
  const hh = (((h % 360) + 360) % 360) / 360;
  const f = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  if (s === 0) return rgbToHex(l * 255, l * 255, l * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return rgbToHex(f(p, q, hh + 1 / 3) * 255, f(p, q, hh) * 255, f(p, q, hh - 1 / 3) * 255);
}

/** Relative luminance (0..1) for contrast decisions. */
export function luminance(c: string): number {
  const [r, g, b] = hexToRgb(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Desaturates a colour by t (0..1). */
export function desaturate(c: string, t: number): string {
  const [r, g, b] = hexToRgb(c);
  const grey = 0.3 * r + 0.59 * g + 0.11 * b;
  return rgbToHex(r + (grey - r) * t, g + (grey - g) * t, b + (grey - b) * t);
}

/** True for a #rgb/#rrggbb string. */
export function isHex(c: unknown): c is string {
  return typeof c === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c.trim());
}

/** UI chrome palette (dark oak, iron, bone, firelight). */
export const CHROME = {
  oakDark: '#2a1d14',
  oak: '#4a3322',
  oakLight: '#7a5636',
  iron: '#5b6066',
  ironDark: '#2f3337',
  bone: '#e8dcc0',
  boneDim: '#bfae8a',
  parchment: '#efe2c4',
  ink: '#22180f',
  gold: '#c9a227',
  goldLight: '#f0d778',
  bronze: '#a8743a',
  silver: '#c9ccd1',
  ember: '#e0702a',
  fire: '#f6b04a',
  blood: '#8e2a23',
  sea: '#2e5a6e',
  seaDeep: '#173543',
  frost: '#cfe1ea',
} as const;

/** Visual culture groups (cultures.json `portraitGroup`). */
export type CultureGroup = 'north' | 'west' | 'south' | 'east' | 'steppe' | 'far';

/** Culture → visual group (mirrors cultures.json `portraitGroup`; checked by a test). */
export const CULTURE_GROUP: Readonly<Record<CultureId, CultureGroup>> = {
  skarn: 'north',
  hvarn: 'north',
  eyjar: 'north',
  isafolder: 'north',
  albric: 'west',
  cael: 'west',
  corvani: 'south',
  saraleonese: 'south',
  velkar: 'east',
  kurgai: 'steppe',
  rime: 'far',
};

/** Per-culture colours: banner/sail/shield primary + secondary, cloth, trim and metal. */
export interface CulturePalette {
  primary: string;
  secondary: string;
  cloth: readonly string[];
  trim: string;
  metal: string;
}

/** Faction/culture colours used on sails, shields, clothing and banners. */
export const CULTURE_PALETTE: Readonly<Record<CultureId, CulturePalette>> = {
  skarn: { primary: '#9b2f2a', secondary: '#e8dcc0', cloth: ['#7a3b2a', '#5d4a36', '#3f4f5c', '#6b6f45', '#8a6a3c'], trim: '#c9a227', metal: '#a8743a' },
  hvarn: { primary: '#2f5f3a', secondary: '#d9c58a', cloth: ['#3d5a3a', '#5a4630', '#6b5a3a', '#44505a', '#7a5a35'], trim: '#b98b3c', metal: '#9a7a4a' },
  eyjar: { primary: '#2b4f86', secondary: '#e3d3a4', cloth: ['#3b4f78', '#6a5038', '#7d6a4a', '#4f5f5f', '#8b4c33'], trim: '#c9a227', metal: '#b08850' },
  isafolder: { primary: '#5a6470', secondary: '#c8b88a', cloth: ['#5c5f5a', '#6b5b45', '#4a4f55', '#7a6a50'], trim: '#a89060', metal: '#8a7a5a' },
  albric: { primary: '#6b2f5a', secondary: '#e6c86a', cloth: ['#5a6a3a', '#7a4a2a', '#5a3f5f', '#3f5a6a', '#8a7a4a'], trim: '#d4af37', metal: '#b89a50' },
  cael: { primary: '#2f6a5a', secondary: '#d8d0b8', cloth: ['#4f6a4a', '#6a4a3a', '#7a6f50', '#4a5a6a', '#8a5a3a'], trim: '#b8a070', metal: '#a08a60' },
  corvani: { primary: '#2a3f7a', secondary: '#c9a227', cloth: ['#3a4a7a', '#7a2f2f', '#6a5a3a', '#4a3a5a', '#8a7a5a'], trim: '#e0c050', metal: '#c0a050' },
  saraleonese: { primary: '#6a1f4a', secondary: '#e8c45a', cloth: ['#6a1f4a', '#e8dcc8', '#2a4a6a', '#8a3a2a', '#c8b890'], trim: '#f0d060', metal: '#e0b840' },
  velkar: { primary: '#8a5a1f', secondary: '#e8dcc0', cloth: ['#8a3a2a', '#5a5a3a', '#6a4a2a', '#3a4a5a', '#9a7a4a'], trim: '#c8a050', metal: '#a08060' },
  kurgai: { primary: '#2f6a8a', secondary: '#e0b040', cloth: ['#3a5a7a', '#7a5a2a', '#5a3a2a', '#6a6a3a', '#8a3a3a'], trim: '#e0b040', metal: '#c09040' },
  rime: { primary: '#4a5a6a', secondary: '#e8e4dc', cloth: ['#6a5a48', '#5a4a3a', '#7a6a58', '#4a4a48'], trim: '#c8c0b0', metal: '#9a9a9a' },
};

/** Skin tones (light → deep), indexed by the portrait generator per culture group. */
export const SKIN_TONES = ['#f3dccb', '#ecc9b0', '#e2b896', '#d8a882', '#c8936c', '#b07a56', '#93623f', '#7a4f33'] as const;

/** Per group: weighted skin-tone indices. Bardia is a trading world, so ranges overlap. */
export const SKIN_BY_GROUP: Readonly<Record<CultureGroup, readonly (readonly [number, number])[]>> = {
  north: [[0, 4], [1, 5], [2, 2], [3, 0.5]],
  west: [[0, 5], [1, 4], [2, 2], [3, 0.5]],
  south: [[2, 2], [3, 4], [4, 4], [5, 2], [6, 0.6]],
  east: [[1, 3], [2, 4], [3, 2], [4, 0.6]],
  steppe: [[3, 3], [4, 4], [5, 3], [6, 1]],
  far: [[3, 2], [4, 4], [5, 3], [6, 1]],
};

/** Natural hair colours. */
export const HAIR_COLOURS = {
  flaxen: '#d8c18a',
  blond: '#c8a35e',
  strawberry: '#c88a52',
  red: '#a8532a',
  auburn: '#7e3a22',
  lightBrown: '#8a6440',
  brown: '#5e4028',
  darkBrown: '#3e2a1a',
  black: '#1f1712',
} as const;
export type HairColourId = keyof typeof HAIR_COLOURS;

export const HAIR_BY_GROUP: Readonly<Record<CultureGroup, readonly (readonly [HairColourId, number])[]>> = {
  north: [['flaxen', 3], ['blond', 4], ['strawberry', 1.5], ['red', 2], ['lightBrown', 3], ['brown', 2], ['darkBrown', 1]],
  west: [['red', 3], ['auburn', 3], ['strawberry', 1], ['blond', 1.5], ['lightBrown', 2], ['brown', 3], ['darkBrown', 2], ['black', 1]],
  south: [['brown', 3], ['darkBrown', 4], ['black', 4], ['lightBrown', 1], ['auburn', 0.5]],
  east: [['blond', 2], ['lightBrown', 4], ['brown', 4], ['darkBrown', 2], ['flaxen', 1]],
  steppe: [['black', 5], ['darkBrown', 4], ['brown', 1]],
  far: [['black', 5], ['darkBrown', 3], ['brown', 1]],
};

export const EYE_COLOURS = {
  blue: '#5f86a8',
  grey: '#7d8a92',
  green: '#6a8a5a',
  hazel: '#8a7448',
  brown: '#5a3c24',
  dark: '#2f2016',
} as const;
export type EyeColourId = keyof typeof EYE_COLOURS;

export const EYES_BY_GROUP: Readonly<Record<CultureGroup, readonly (readonly [EyeColourId, number])[]>> = {
  north: [['blue', 5], ['grey', 3], ['green', 1.5], ['hazel', 1], ['brown', 0.6]],
  west: [['blue', 3], ['grey', 2], ['green', 3], ['hazel', 2], ['brown', 1]],
  south: [['brown', 5], ['dark', 3], ['hazel', 2], ['green', 0.5]],
  east: [['blue', 2], ['grey', 3], ['hazel', 2], ['brown', 3]],
  steppe: [['dark', 5], ['brown', 4], ['hazel', 1]],
  far: [['dark', 5], ['brown', 4]],
};

/** Hair greying target. */
export const GREY_HAIR = '#cfcac2';

export type SeasonKey = 'spring' | 'summer' | 'autumn' | 'winter';
export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';
export const SEASONS: readonly SeasonKey[] = ['spring', 'summer', 'autumn', 'winter'];
export const TIMES_OF_DAY: readonly TimeOfDay[] = ['dawn', 'day', 'dusk', 'night'];

/** Sky gradient (zenith, mid, horizon), sun colour, ambient tint and darkness for a time of day. */
export interface SkyLook {
  zenith: string;
  mid: string;
  horizon: string;
  sun: string;
  /** Multiply tint applied to the whole landscape. */
  ambient: string;
  /** 0 = full day, 1 = deep night. */
  dark: number;
  /** Colour of distant haze. */
  haze: string;
}

const SKY_BASE: Readonly<Record<TimeOfDay, SkyLook>> = {
  dawn: { zenith: '#3d4f78', mid: '#9a8aa0', horizon: '#f0b48a', sun: '#ffd9a0', ambient: '#e8c8b8', dark: 0.25, haze: '#d8b0a0' },
  day: { zenith: '#4f7fae', mid: '#86acc8', horizon: '#d6e2e6', sun: '#fff6dc', ambient: '#ffffff', dark: 0, haze: '#b8ccd6' },
  dusk: { zenith: '#2a2f55', mid: '#8a5a6a', horizon: '#f08a4a', sun: '#ffb060', ambient: '#e0a890', dark: 0.35, haze: '#b07a78' },
  night: { zenith: '#070b18', mid: '#141d36', horizon: '#26324e', sun: '#dfe6f0', ambient: '#5a6a90', dark: 0.82, haze: '#2a3550' },
};

/** Sky look for a season and time of day (winter is paler and colder, autumn warmer and hazier). */
export function skyLook(season: SeasonKey, time: TimeOfDay): SkyLook {
  const b = SKY_BASE[time];
  switch (season) {
    case 'winter':
      return {
        ...b,
        zenith: mix(b.zenith, '#5a6a80', time === 'night' ? 0.1 : 0.35),
        mid: mix(b.mid, '#b8c4d0', time === 'night' ? 0.05 : 0.35),
        horizon: mix(b.horizon, '#e4e8ec', time === 'night' ? 0.05 : 0.4),
        ambient: mix(b.ambient, '#c8d4e4', 0.4),
        haze: mix(b.haze, '#d8dee6', 0.4),
      };
    case 'autumn':
      return {
        ...b,
        mid: mix(b.mid, '#b8a088', 0.25),
        horizon: mix(b.horizon, '#e8c89a', 0.3),
        ambient: mix(b.ambient, '#f0dcc0', 0.3),
        haze: mix(b.haze, '#c8b8a0', 0.35),
      };
    case 'spring':
      return { ...b, horizon: mix(b.horizon, '#e8eedc', 0.15), haze: mix(b.haze, '#c8d4c8', 0.2) };
    default:
      return b;
  }
}

/** Ground colours (grass/heath/earth) by season. */
export function groundLook(season: SeasonKey, group: CultureGroup): { grass: string; grassDark: string; earth: string; snow: number } {
  const warm = group === 'south' || group === 'steppe';
  const base = warm ? { grass: '#8a9a52', grassDark: '#5a6a36', earth: '#9a7a52' } : { grass: '#5f7f46', grassDark: '#3a5230', earth: '#6a5238' };
  if (group === 'far') return { grass: '#8a8f80', grassDark: '#5a6058', earth: '#6a6258', snow: season === 'summer' ? 0.35 : 0.85 };
  switch (season) {
    case 'spring':
      return { grass: mix(base.grass, '#7aa04e', 0.4), grassDark: base.grassDark, earth: base.earth, snow: group === 'north' ? 0.1 : 0 };
    case 'summer':
      return { ...base, snow: 0 };
    case 'autumn':
      return { grass: mix(base.grass, '#a88a3e', 0.55), grassDark: mix(base.grassDark, '#6a4a26', 0.5), earth: base.earth, snow: 0 };
    default:
      return {
        grass: mix(base.grass, '#8a8a78', 0.6),
        grassDark: mix(base.grassDark, '#4a4a40', 0.5),
        earth: base.earth,
        snow: group === 'south' ? 0.05 : group === 'steppe' ? 0.5 : 0.75,
      };
  }
}

/**
 * CSS filter string that grades a FINAL (owner-supplied) image to a season and time of day, so final
 * panoramas get the same look as the placeholders (design §27.2: "season and time-of-day via grading").
 */
export function gradingFilter(season: SeasonKey, time: TimeOfDay): string {
  const parts: string[] = [];
  if (time === 'night') parts.push('brightness(0.5)', 'saturate(0.55)', 'sepia(0.35)', 'hue-rotate(185deg)');
  if (time === 'dusk') parts.push('brightness(0.85)', 'sepia(0.25)', 'saturate(1.1)');
  if (time === 'dawn') parts.push('brightness(0.92)', 'sepia(0.15)');
  if (season === 'winter') parts.push('saturate(0.7)', 'brightness(1.04)');
  if (season === 'autumn') parts.push('sepia(0.18)', 'saturate(1.05)');
  if (season === 'spring') parts.push('saturate(1.05)');
  return parts.length > 0 ? parts.join(' ') : 'none';
}
