/**
 * Shared painting helpers for the full-screen scenes (encounters, arrivals, visits, aftermaths): colour
 * mixing for atmospheric depth, a small deterministic random stream for layouts, and the light of the
 * hour (sky, sea, land and haze colours for dawn, day, dusk and night, darkened by weather).
 *
 * Every scene paints into the same 1600 × 900 viewBox (shown with `slice`, so the edges may be cropped on
 * narrow or tall windows: keep the subject between x 140 and 1460). The palette continues the home village
 * picture (screens/hub/VillageScene.tsx): oak browns, bone, a gold glow, a dusk of plum and ember.
 */
import type { SeasonId } from '@content/schemas/ids';

export const VIEW_W = 1600;
export const VIEW_H = 900;

export const INK = '#0f0b08';
export const GLOW = '#f0a04a';
export const BONE = '#e8d6a0';
export const WOOD = '#3d2a1a';
export const WOOD_DARK = '#2a1c12';
export const WOOD_HI = '#6b4b2c';

/** Banner colours by faction colour index (the map's palette, theme `--faction-1..8`). */
export const FACTION_COLOURS = ['#b8402f', '#3f70aa', '#d4a74f', '#4f8a3c', '#7c51a3', '#c96d2a', '#3d8f89', '#8d8d8d'] as const;
/** The player's own banner (the chart's rubric red). */
export const PLAYER_COLOUR = '#a8321f';

/** A faction's banner colour: its colour index, else a stable hash of its id. */
export function bannerColour(f: { id: string; colorIndex?: number } | undefined, playerFactionId?: string): string {
  if (!f) return '#6a5f52';
  if (f.id === playerFactionId) return PLAYER_COLOUR;
  const n = FACTION_COLOURS.length;
  if (typeof f.colorIndex === 'number' && Number.isFinite(f.colorIndex)) return FACTION_COLOURS[((Math.floor(f.colorIndex) % n) + n) % n] ?? '#6a5f52';
  return FACTION_COLOURS[hashString(f.id) % n] ?? '#6a5f52';
}

/** FNV-1a hash of a string (layout seeds). */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** A small deterministic random stream (mulberry32): same seed, same picture. */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parse(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(v.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mixes two #rrggbb colours: t = 0 gives a, t = 1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const k = Math.max(0, Math.min(1, t));
  return hex(ar + (br - ar) * k, ag + (bg - ag) * k, ab + (bb - ab) * k);
}

/** Darkens (t > 0) a colour toward ink. */
export function shade(c: string, t: number): string {
  return mix(c, '#000000', t);
}

// ---------------------------------------------------------------------------------------------
// The light of the hour.

export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';
export type WindWord = 'calm' | 'light' | 'fresh' | 'strong' | 'gale';

/** The hour of the day (0..23) → time of day. */
export function timeOfDay(hourOfDay: number): TimeOfDay {
  const h = ((Math.floor(hourOfDay) % 24) + 24) % 24;
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 18) return 'day';
  if (h >= 18 && h < 21) return 'dusk';
  return 'night';
}

/** What the scene knows of the weather where the crew is. */
export interface SceneWeather {
  fog: boolean;
  wind: WindWord;
  /** A storm cell over the fleet. */
  storm: boolean;
}

export const FAIR_WEATHER: SceneWeather = { fog: false, wind: 'fresh', storm: false };

/** Every colour a scene layer needs, for one hour, season and weather. */
export interface Light {
  tod: TimeOfDay;
  /** Sky gradient, top → horizon. */
  sky: readonly [string, string, string, string];
  /** Sea gradient, horizon → foreground. */
  sea: readonly [string, string, string];
  /** Far hills, middle land, near land. */
  far: string;
  mid: string;
  near: string;
  /** Atmospheric haze (distant things fade toward it). */
  haze: string;
  /** How much haze lies on far things (0..1): more in fog. */
  hazeAmount: number;
  /** Cloud body and its lit underside. */
  cloud: string;
  cloudLit: string;
  cloudOpacity: number;
  /** Sun or moon: position in the viewBox, colour, radius; glitter on the water below it. */
  orb: { x: number; y: number; r: number; colour: string; glow: string; moon: boolean };
  /** Stars (opacity 0 by day). */
  stars: number;
  /** Window and torch glow strength (0 by day, 1 at night). */
  lamps: number;
  /** Rim light on silhouettes (the sky behind them). */
  rim: string;
  /** Snow on the land (winter). */
  snow: boolean;
  /** Rain streaks (storm). */
  rain: boolean;
  /** Whitecaps and swell height (0..1). */
  rough: number;
}

const BASE: Record<TimeOfDay, Omit<Light, 'tod' | 'hazeAmount' | 'snow' | 'rain' | 'rough' | 'cloudOpacity'>> = {
  dawn: {
    sky: ['#1d2340', '#4f4566', '#b9776a', '#efc089'],
    sea: ['#a98a80', '#3f4150', '#12161e'],
    far: '#3c3549',
    mid: '#2b2735',
    near: '#1b1820',
    haze: '#c99a86',
    cloud: '#4c4060',
    cloudLit: '#e2a07e',
    orb: { x: 1240, y: 392, r: 34, colour: '#ffe0a8', glow: 'rgba(255,200,140,0.6)', moon: false },
    stars: 0.18,
    lamps: 0.55,
    rim: '#f0b88a',
  },
  day: {
    sky: ['#3e5a78', '#6f8ba2', '#a7b5b4', '#d7d0b6'],
    sea: ['#93a3a0', '#41606a', '#15232a'],
    far: '#66737a',
    mid: '#465357',
    near: '#2c3433',
    haze: '#c6c8bc',
    cloud: '#9aa4aa',
    cloudLit: '#eee6d0',
    orb: { x: 1320, y: 120, r: 30, colour: '#fff4d6', glow: 'rgba(255,244,214,0.45)', moon: false },
    stars: 0,
    lamps: 0,
    rim: '#efe6cc',
  },
  dusk: {
    sky: ['#171c2c', '#3e3346', '#a35a3a', '#e2a058'],
    sea: ['#7a5848', '#3a3338', '#12171a'],
    far: '#2e2a34',
    mid: '#231f27',
    near: '#17141a',
    haze: '#a8705a',
    cloud: '#4a3a48',
    cloudLit: '#c27a4e',
    orb: { x: 1180, y: 404, r: 40, colour: '#f8d08a', glow: 'rgba(255,190,110,0.55)', moon: false },
    stars: 0.35,
    lamps: 0.85,
    rim: '#e7a065',
  },
  night: {
    sky: ['#04060c', '#0a1120', '#14203a', '#26364e'],
    sea: ['#2c3c52', '#111a26', '#05080c'],
    far: '#151b28',
    mid: '#0e121b',
    near: '#08090d',
    haze: '#2a3a52',
    cloud: '#141c2c',
    cloudLit: '#3c4c66',
    orb: { x: 1260, y: 150, r: 26, colour: '#e8ecf2', glow: 'rgba(200,214,240,0.35)', moon: true },
    stars: 0.85,
    lamps: 1,
    rim: '#8a9ab8',
  },
};

/** The light for an hour of the day, season and weather. */
export function lightFor(hourOfDay: number, season: SeasonId = 'summer', weather: SceneWeather = FAIR_WEATHER): Light {
  const tod = timeOfDay(hourOfDay);
  const b = BASE[tod];
  const grey = weather.storm || weather.wind === 'gale' ? 0.45 : weather.wind === 'strong' ? 0.2 : 0;
  const greyTo = tod === 'night' ? '#0a0d12' : '#5d6266';
  const g = (c: string) => (grey > 0 ? mix(c, greyTo, grey) : c);
  const light: Light = {
    ...b,
    tod,
    sky: [g(b.sky[0]), g(b.sky[1]), g(b.sky[2]), g(b.sky[3])],
    sea: [g(b.sea[0]), g(b.sea[1]), g(b.sea[2])],
    cloud: g(b.cloud),
    cloudLit: g(b.cloudLit),
    haze: weather.fog ? mix(b.haze, tod === 'night' ? '#3a4658' : '#d8dad2', 0.5) : g(b.haze),
    hazeAmount: weather.fog ? 0.72 : grey > 0 ? 0.42 : 0.28,
    cloudOpacity: weather.storm ? 0.95 : weather.wind === 'gale' || weather.wind === 'strong' ? 0.8 : weather.wind === 'calm' ? 0.35 : 0.55,
    orb: grey > 0.3 || weather.fog ? { ...b.orb, glow: 'rgba(0,0,0,0)', colour: mix(b.orb.colour, b.haze, 0.6) } : b.orb,
    stars: weather.fog || grey > 0.3 ? 0 : b.stars,
    snow: season === 'winter',
    rain: weather.storm,
    rough: weather.storm ? 1 : weather.wind === 'gale' ? 0.9 : weather.wind === 'strong' ? 0.65 : weather.wind === 'fresh' ? 0.4 : weather.wind === 'light' ? 0.22 : 0.1,
  };
  if (light.snow) {
    light.far = mix(light.far, tod === 'night' ? '#3a4558' : '#d9dde0', 0.45);
    light.mid = mix(light.mid, tod === 'night' ? '#2a3240' : '#b8bec2', 0.3);
  }
  return light;
}

/** Fades a colour toward the haze by distance (0 near … 1 far). */
export function aerial(light: Light, colour: string, distance: number): string {
  return mix(colour, light.haze, Math.max(0, Math.min(1, distance)) * light.hazeAmount * 1.25);
}
