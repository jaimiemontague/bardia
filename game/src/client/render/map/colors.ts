/**
 * Colour helpers and the sea-chart palette. Colours are 0xRRGGBB numbers (what Pixi takes); the state colours used
 * by map modes come from the theme's colour-blind-aware CSS variables (`--cb-*`, `--faction-1…8`, §25.7), read once
 * per settings change by `readMapPalette` and passed to the pure overlay builders.
 */

/** Parses '#rgb', '#rrggbb' or 'rgb(r, g, b)'; returns `fallback` for anything else. */
export function parseColor(input: string | null | undefined, fallback: number): number {
  if (!input) return fallback;
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(s);
  if (m?.[1]) return parseInt(m[1], 16);
  m = /^#([0-9a-f]{3})$/.exec(s);
  if (m?.[1]) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16)) as [number, number, number];
    return (r << 16) | (g << 8) | b;
  }
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(s);
  if (rgb) return (clampByte(Number(rgb[1])) << 16) | (clampByte(Number(rgb[2])) << 8) | clampByte(Number(rgb[3]));
  return fallback;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** '#rrggbb' of a colour number. */
export function toCss(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** 'rgba(r, g, b, a)' of a colour number. */
export function toCssRgba(color: number, alpha: number): string {
  return `rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}, ${Math.max(0, Math.min(1, alpha))})`;
}

/** Channel triple of a colour number. */
export function rgbOf(color: number): [number, number, number] {
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255];
}

/** Colour number of channels (clamped, rounded). */
export function rgb(r: number, g: number, b: number): number {
  return (clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b);
}

/** Linear blend a → b by t ∈ [0, 1]. */
export function mix(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const [ar, ag, ab] = rgbOf(a);
  const [br, bg, bb] = rgbOf(b);
  return rgb(ar + (br - ar) * k, ag + (bg - ag) * k, ab + (bb - ab) * k);
}

/** Multiplies every channel by f (darken < 1 < lighten, clamped). */
export function scale(color: number, f: number): number {
  const [r, g, b] = rgbOf(color);
  return rgb(r * f, g * f, b * f);
}

/** Relative luminance (WCAG) of a colour, 0–1. */
export function luminance(color: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgbOf(color);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours (1–21). */
export function contrast(a: number, b: number): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Parses a kingdom's '#rrggbb' banner colour. */
export function hexColor(hex: string, fallback = 0x8d8d8d): number {
  return parseColor(hex, fallback);
}

// ---------------------------------------------------------------------------------------------
// The state palette (colour-blind aware).

/** Theme colours the map modes use (`--cb-*` and `--faction-1…8`). */
export interface MapPalette {
  good: number;
  bad: number;
  warn: number;
  info: number;
  neutral: number;
  /** Banner colours by faction colour index (8 entries). */
  factions: readonly number[];
  /** Colour-blind mode the palette was read under ('none', 'deuteranopia', …). */
  mode: string;
}

/** The default theme values (theme.css :root); tests and non-DOM callers use these. */
export const DEFAULT_PALETTE: MapPalette = {
  good: 0x86a352,
  bad: 0xc2493a,
  warn: 0xdf9136,
  info: 0x5a9b95,
  neutral: 0x978a70,
  factions: [0xb8402f, 0x3f70aa, 0xd4a74f, 0x4f8a3c, 0x7c51a3, 0xc96d2a, 0x3d8f89, 0x8d8d8d],
  mode: 'none',
};

/** Reads the palette from the document's computed CSS variables (falls back to the defaults). */
export function readMapPalette(root: Element | null = typeof document === 'undefined' ? null : document.documentElement): MapPalette {
  if (!root || typeof getComputedStyle !== 'function') return DEFAULT_PALETTE;
  const cs = getComputedStyle(root);
  const v = (name: string, fallback: number) => parseColor(cs.getPropertyValue(name), fallback);
  return {
    good: v('--cb-good', DEFAULT_PALETTE.good),
    bad: v('--cb-bad', DEFAULT_PALETTE.bad),
    warn: v('--cb-warn', DEFAULT_PALETTE.warn),
    info: v('--cb-info', DEFAULT_PALETTE.info),
    neutral: v('--cb-neutral', DEFAULT_PALETTE.neutral),
    factions: DEFAULT_PALETTE.factions.map((c, i) => v(`--faction-${i + 1}`, c)),
    mode: (root as HTMLElement).dataset?.cb ?? 'none',
  };
}

// ---------------------------------------------------------------------------------------------
// The sea-chart palette (art direction §27.1: an illuminated sea-chart). Placeholder art: the owner's painted base
// replaces the procedural chart wholesale (asset `map.base.painted`).

export const CHART = {
  /** Unknown lands (blank parchment) and the frame around the world. */
  parchment: 0xe9dcb8,
  parchmentDark: 0xd8c597,
  parchmentEdge: 0xc4a874,
  /** Iron-gall ink for coastlines, symbols and labels. */
  ink: 0x3a2a1b,
  inkSoft: 0x6b5238,
  /** Red ink (rubrication) for the player's routes and capitals. */
  rubric: 0x9a2f20,
  /** Gilding for the player's own marks. */
  gold: 0xc9993f,
  /** Painted sea: shore → deep. */
  seaShore: 0xc9d8bf,
  seaShallow: 0xa5c6b6,
  seaMid: 0x7aa5a6,
  seaDeep: 0x5f8a98,
  seaAbyss: 0x557d8e,
  /** Ink of sea labels and water lines. */
  seaInk: 0x2a4d5c,
  lake: 0x8db5b0,
  lakeInk: 0x3d6470,
  river: 0x4f7f97,
  road: 0x7a4a2a,
  roadImperial: 0x8a3a24,
  /** Province borders (dotted) and realm borders. */
  border: 0x5a4430,
  /** Storm clouds. */
  storm: 0x4a4458,
  stormSevere: 0x5a2d3a,
};
