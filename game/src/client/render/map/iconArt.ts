/**
 * Procedural placeholder art of the world map (design §27.2 "~40 settlement icons, 8 fleet icons, weather FX"):
 * inked, watercoloured miniatures in the manner of an illuminated sea-chart. Every piece is an ImageGenerator
 * registered with the asset library, referenced only through `map.*` asset-manifest ids, so the owner's final files
 * replace them without code changes (src/content/assets/manifest/map.json).
 *
 * Generators are DOM-free and deterministic (SVG strings).
 */
import { getGeography } from '@content/world';
import type { SettlementTierId } from '@content/schemas/ids';
import { SETTLEMENT_TIER_IDS } from '@content/schemas/ids';
import { oneOf, str } from '../../assets/generators/params';
import { getGenerator, registerGenerator } from '../../assets/generators/registry';
import { el, esc, g, n, path, rect, circle, ellipse, polygon, radialGradient, svgDoc } from '../../assets/svg/svg';
import { watermark } from '../../assets/svg/paint';
import type { GeneratorParams, ImageGenerator, RenderContext } from '../../assets/types';
import { FLEET_ICON_KINDS, ICON_STYLES, type FleetIconKind, type IconStyle } from './types';

const INK = '#3a2a1b';
const SW = 2.2;
const SITE_KINDS = ['cave', 'barrow', 'tower', 'seaStack', 'shrine', 'wreck', 'ruinedHall', 'grove'] as const;
type SiteKindId = (typeof SITE_KINDS)[number];

interface StyleLook {
  wall: string;
  roof: string;
  roofDark: string;
  stone: string;
  accent: string;
}

const LOOK: Readonly<Record<IconStyle, StyleLook>> = {
  north: { wall: '#9a7650', roof: '#6d7448', roofDark: '#4f5634', stone: '#a49a88', accent: '#b8402f' },
  west: { wall: '#e6dbbd', roof: '#c49a52', roofDark: '#99743a', stone: '#c8bea6', accent: '#3f70aa' },
  south: { wall: '#efe3c6', roof: '#b65b3b', roofDark: '#8a3f28', stone: '#ddd1b3', accent: '#d4a74f' },
  east: { wall: '#8a6a48', roof: '#5a4634', roofDark: '#3d2f22', stone: '#9c9282', accent: '#7c51a3' },
};

function doc(w: number, h: number, body: readonly string[], defs: readonly string[] = [], label?: string, ctx?: RenderContext): string {
  const mark = ctx && ctx.watermark !== 'off' && Math.min(ctx.width, ctx.height) >= 128 ? watermark(64, 64 * (h / w), label, 'corner') : '';
  return svgDoc({ width: ctx?.width ?? w, height: ctx?.height ?? h, viewBox: [0, 0, 64, 64 * (h / w)], defs, body: [...body, mark] });
}

/** A gabled house: ground-centre (x, y), width w, wall height h, roof height r. */
function house(x: number, y: number, w: number, h: number, r: number, look: StyleLook, opts: { dark?: boolean; crossed?: boolean; hip?: boolean } = {}): string {
  const l = x - w / 2;
  const roofColor = opts.dark ? look.roofDark : look.roof;
  const parts = [
    rect(l, y - h, w, h, { fill: look.wall, stroke: INK, 'stroke-width': SW, 'stroke-linejoin': 'round' }),
    opts.hip
      ? polygon([l - 1.5, y - h, l + w * 0.18, y - h - r, l + w * 0.82, y - h - r, l + w + 1.5, y - h], { fill: roofColor, stroke: INK, 'stroke-width': SW, 'stroke-linejoin': 'round' })
      : polygon([l - 1.5, y - h, x, y - h - r, l + w + 1.5, y - h], { fill: roofColor, stroke: INK, 'stroke-width': SW, 'stroke-linejoin': 'round' }),
    rect(x - w * 0.12, y - h * 0.62, w * 0.24, h * 0.62, { fill: INK, opacity: '0.75' }),
  ];
  if (opts.crossed) {
    parts.push(path(`M${n(x - 3)} ${n(y - h - r - 3.5)}L${n(x)} ${n(y - h - r)}L${n(x + 3)} ${n(y - h - r - 3.5)}`, { fill: 'none', stroke: INK, 'stroke-width': SW, 'stroke-linecap': 'round' }));
  }
  return g({}, parts);
}

function tower(x: number, y: number, w: number, h: number, look: StyleLook, crenel: boolean): string {
  const l = x - w / 2;
  const parts = [rect(l, y - h, w, h, { fill: look.stone, stroke: INK, 'stroke-width': SW })];
  if (crenel) {
    const c = w / 5;
    parts.push(path(`M${n(l)} ${n(y - h)}v-3h${n(c)}v3h${n(c)}v-3h${n(c)}v3h${n(c)}v-3h${n(c)}v3`, { fill: look.stone, stroke: INK, 'stroke-width': SW, 'stroke-linejoin': 'round' }));
  } else {
    parts.push(polygon([l - 1.5, y - h, x, y - h - w * 0.9, l + w + 1.5, y - h], { fill: look.roofDark, stroke: INK, 'stroke-width': SW, 'stroke-linejoin': 'round' }));
  }
  parts.push(rect(x - 1.2, y - h * 0.7, 2.4, 4, { fill: INK }));
  return g({}, parts);
}

function ground(x: number, y: number, w: number): string {
  return ellipse(x, y + 1.5, w / 2, 3.2, { fill: '#5a4430', opacity: '0.22' });
}

function palisade(x0: number, x1: number, y: number, h: number, look: StyleLook): string {
  const stakes: string[] = [];
  for (let x = x0; x <= x1 + 0.1; x += 3.2) stakes.push(`M${n(x)} ${n(y)}v${n(-h)}l1.4 -2l1.4 2v${n(h)}`);
  return path(stakes.join(''), { fill: look.wall, stroke: INK, 'stroke-width': 1.5, 'stroke-linejoin': 'round' });
}

function wall(x0: number, x1: number, y: number, h: number, look: StyleLook): string {
  const w = x1 - x0;
  const merlons: string[] = [];
  for (let x = x0; x < x1 - 2; x += 4) merlons.push(`M${n(x)} ${n(y - h)}v-2.5h2.2v2.5`);
  return g({}, [rect(x0, y - h, w, h, { fill: look.stone, stroke: INK, 'stroke-width': SW }), path(merlons.join(''), { fill: look.stone, stroke: INK, 'stroke-width': 1.4 }), path(`M${n((x0 + x1) / 2 - 3)} ${n(y)}v-5a3 3 0 0 1 6 0v5z`, { fill: INK, opacity: '0.85' })]);
}

function banner(x: number, y: number, h: number, color: string): string {
  return g({}, [path(`M${n(x)} ${n(y)}v${n(-h)}`, { stroke: INK, 'stroke-width': 1.8, 'stroke-linecap': 'round' }), path(`M${n(x)} ${n(y - h)}l11 2.5l-11 3.5z`, { fill: color, stroke: INK, 'stroke-width': 1.2, 'stroke-linejoin': 'round' })]);
}

function lantern(x: number, y: number): string {
  return g({}, [rect(x - 2.5, y - 6, 5, 6, { fill: '#f3d58a', stroke: INK, 'stroke-width': 1.3 }), path(`M${n(x - 3.5)} ${n(y - 6)}l3.5 -3l3.5 3z`, { fill: INK })]);
}

/** Settlement icon body for a tier and style (64×64 design grid, ground line at y = 48). */
export function settlementSvgBody(tier: SettlementTierId, style: IconStyle): string[] {
  const L = LOOK[style];
  const y = 48;
  const crossed = style === 'north';
  const out: string[] = [];
  switch (tier) {
    case 'hamlet':
      out.push(ground(32, y, 22), house(32, y, 16, 9, 8, L, { crossed }));
      break;
    case 'village':
      out.push(ground(32, y, 36), house(23, y, 15, 9, 8, L, { crossed }), house(41, y, 14, 8, 7, L, { dark: true }));
      break;
    case 'town':
      out.push(ground(32, y, 46), house(32, y - 3, 16, 10, 9, L, { crossed }), house(19, y, 13, 8, 7, L, { dark: true }), house(45, y, 13, 8, 7, L), palisade(10, 54, y + 1, 6, L));
      break;
    case 'city':
      out.push(
        ground(32, y, 54),
        house(24, y - 6, 14, 10, 9, L, { dark: true }),
        house(40, y - 6, 14, 11, 9, L, { crossed }),
        tower(11, y, 9, 20, L, style !== 'north' && style !== 'east'),
        tower(53, y, 9, 20, L, style !== 'north' && style !== 'east'),
        wall(14, 50, y, 9, L),
      );
      break;
    case 'capital':
      out.push(
        ground(32, y, 58),
        house(20, y - 7, 13, 10, 9, L, { dark: true }),
        house(44, y - 7, 13, 10, 9, L),
        house(32, y - 9, 18, 14, 13, L, { crossed, hip: style === 'south' }),
        tower(8, y, 9, 22, L, style !== 'north' && style !== 'east'),
        tower(56, y, 9, 22, L, style !== 'north' && style !== 'east'),
        wall(11, 53, y, 9, L),
        banner(32, y - 36, 14, '#d4a74f'),
      );
      break;
    case 'cloister':
      out.push(ground(32, y, 44), house(28, y, 22, 11, 9, { ...L, roof: L.roofDark }), tower(43, y, 9, 22, { ...L, stone: L.wall }, false), lantern(43, y - 30), palisade(12, 54, y + 1, 4, L));
      break;
    case 'fortress':
      out.push(ground(32, y, 52), wall(10, 54, y, 11, L), tower(32, y - 8, 14, 22, L, true), banner(32, y - 32, 10, L.accent));
      break;
    case 'emporium':
      out.push(
        ground(30, y, 52),
        house(18, y, 14, 9, 8, L, { crossed }),
        house(33, y, 13, 10, 8, L, { dark: true }),
        // Market booth with a striped awning.
        rect(42, y - 7, 12, 7, { fill: L.wall, stroke: INK, 'stroke-width': 1.6 }),
        path(`M40 ${y - 7}l2 -5h12l2 5z`, { fill: L.accent, stroke: INK, 'stroke-width': 1.6, 'stroke-linejoin': 'round' }),
        path(`M45 ${y - 12}l-1 5M49 ${y - 12}l1 5`, { stroke: '#f1e8d4', 'stroke-width': 1.4 }),
        // Jetty with a mast.
        path(`M4 ${y + 4}h18`, { stroke: INK, 'stroke-width': 2.2, 'stroke-linecap': 'round' }),
        path(`M9 ${y + 3}v-16`, { stroke: INK, 'stroke-width': 1.6 }),
      );
      break;
    case 'templeStead':
      out.push(
        ground(32, y, 50),
        house(32, y, 24, 10, 13, { ...L, roof: L.roofDark }, { crossed: true }),
        path(`M10 ${y}v-14M14 ${y}v-10M50 ${y}v-14M54 ${y}v-10`, { stroke: INK, 'stroke-width': 3, 'stroke-linecap': 'round' }),
        circle(32, y - 24, 2.4, { fill: '#d4a74f', stroke: INK, 'stroke-width': 1.2 }),
      );
      break;
  }
  return out;
}

export const settlementIconGenerator: ImageGenerator = {
  id: 'mapSettlement',
  kind: 'image',
  defaultSize: [64, 64],
  params: [
    { name: 'tier', type: 'enum', values: SETTLEMENT_TIER_IDS, default: 'town' },
    { name: 'style', type: 'enum', values: ICON_STYLES, default: 'north', note: 'culture family: north (Skarn, Hvarn, Eyjar, Rime, Isafold), west (Albric, Cael), south (Corvani, Saraleon), east (Velkar, Kurgai)' },
  ],
  render(params: GeneratorParams, ctx: RenderContext): string {
    const tier = oneOf(params, 'tier', SETTLEMENT_TIER_IDS, 'town');
    const style = oneOf(params, 'style', ICON_STYLES, 'north');
    return doc(64, 64, settlementSvgBody(tier, style), [], ctx.label, ctx);
  },
  variants(): GeneratorParams[] {
    return ICON_STYLES.flatMap((style) => SETTLEMENT_TIER_IDS.map((tier) => ({ tier, style })));
  },
};

// ---------------------------------------------------------------------------------------------
// Fleets.

interface FleetLook {
  sail: string;
  stripe: string | null;
  hull: string;
  dragon: boolean;
  oars: boolean;
  emblem?: 'lantern' | 'bough' | 'sheaf' | 'shield';
}

const FLEET_LOOK: Readonly<Record<FleetIconKind, FleetLook>> = {
  expedition: { sail: '#f1e4c4', stripe: '#9a2f20', hull: '#5a3e26', dragon: true, oars: true, emblem: 'shield' },
  merchant: { sail: '#ece0c2', stripe: null, hull: '#6b4b2e', dragon: false, oars: false },
  raider: { sail: '#7a2a20', stripe: '#2a1a12', hull: '#3d2a1c', dragon: true, oars: true },
  patrol: { sail: '#d9d6c8', stripe: '#3f5f7a', hull: '#5a4630', dragon: false, oars: true },
  war: { sail: '#2f2622', stripe: '#a33a2a', hull: '#3a2a1e', dragon: true, oars: true, emblem: 'shield' },
  envoy: { sail: '#f6f1e2', stripe: null, hull: '#6b4b2e', dragon: false, oars: false, emblem: 'bough' },
  muster: { sail: '#f4ecd6', stripe: '#c9993f', hull: '#5a4630', dragon: false, oars: true, emblem: 'lantern' },
  colony: { sail: '#e8dcb8', stripe: '#6b8a4c', hull: '#6b4b2e', dragon: false, oars: false, emblem: 'sheaf' },
};

/** A side-view ship (bow to the right) on a 64×64 grid. */
export function fleetSvgBody(kind: FleetIconKind): string[] {
  const L = FLEET_LOOK[kind];
  const deep = kind === 'merchant' || kind === 'colony';
  const out: string[] = [];
  // Water.
  out.push(path('M4 52q6 -3 12 0t12 0t12 0t12 0t8 0', { fill: 'none', stroke: '#2a4d5c', 'stroke-width': 1.6, opacity: '0.7', 'stroke-linecap': 'round' }));
  // Hull: a clinker-built curve with raised stem and stern.
  const hull = deep ? 'M8 38Q10 50 32 50Q54 50 57 37L52 40Q32 44 13 41Z' : 'M6 36Q10 48 32 48Q55 48 59 34L53 39Q32 42 12 40Z';
  out.push(path(hull, { fill: L.hull, stroke: INK, 'stroke-width': SW, 'stroke-linejoin': 'round' }));
  out.push(path(deep ? 'M12 43Q32 47 54 41' : 'M11 42Q32 45 55 39', { fill: 'none', stroke: '#f1e8d4', 'stroke-width': 0.9, opacity: '0.45' }));
  // Stem and stern posts; a dragon head for warships.
  if (L.dragon) {
    out.push(path('M57 36q4 -6 1 -12q-1 -3 2 -4l2 2l-3 1q2 5 -1 12', { fill: L.hull, stroke: INK, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }));
    out.push(path('M8 37q-4 -5 -1 -10q1 -2 -1 -4', { fill: 'none', stroke: INK, 'stroke-width': 2.2, 'stroke-linecap': 'round' }));
  } else {
    out.push(path('M57 36q3 -4 2 -9', { fill: 'none', stroke: INK, 'stroke-width': 2.2, 'stroke-linecap': 'round' }));
    out.push(path('M8 37q-3 -4 -2 -8', { fill: 'none', stroke: INK, 'stroke-width': 2.2, 'stroke-linecap': 'round' }));
  }
  // Oars.
  if (L.oars) out.push(path('M18 44l-4 7M25 45l-3 7M32 45l-2 7M39 45l-2 7M46 44l-2 7', { stroke: INK, 'stroke-width': 1.3, 'stroke-linecap': 'round', opacity: '0.85' }));
  // Mast and the square sail.
  out.push(path('M32 40V8', { stroke: INK, 'stroke-width': 2, 'stroke-linecap': 'round' }));
  out.push(path('M17 12h30', { stroke: INK, 'stroke-width': 1.8, 'stroke-linecap': 'round' }));
  out.push(path('M18 12h28q2 10 -1 22h-26q-3 -12 -1 -22z', { fill: L.sail, stroke: INK, 'stroke-width': SW, 'stroke-linejoin': 'round' }));
  if (L.stripe) out.push(path('M23.5 12.5v21.5M32 12.5v21.5M40.5 12.5v21.5', { stroke: L.stripe, 'stroke-width': 3.6, opacity: '0.9' }));
  switch (L.emblem) {
    case 'lantern':
      out.push(lantern(32, 28));
      break;
    case 'bough':
      out.push(path('M26 30q6 -10 12 -12M29 26l-3 -2M32 23l-2 -3M35 21l1 -3M30 27l2 2M34 23l3 1', { fill: 'none', stroke: '#4f7a3a', 'stroke-width': 1.8, 'stroke-linecap': 'round' }));
      break;
    case 'sheaf':
      out.push(path('M32 31v-11M32 24l-4 -5M32 24l4 -5M32 27l-5 -3M32 27l5 -3', { fill: 'none', stroke: '#8a6a2a', 'stroke-width': 1.8, 'stroke-linecap': 'round' }));
      break;
    default:
      break;
  }
  // Shields along the rail.
  if (L.emblem === 'shield') {
    for (const x of [16, 23, 30, 37, 44, 51]) out.push(circle(x, 39.5, 2.6, { fill: x % 2 === 0 ? '#d4a74f' : '#9a2f20', stroke: INK, 'stroke-width': 1 }));
  }
  // Masthead pennant (tinted at runtime by the banner layer, drawn neutral here).
  out.push(path('M32 8l8 2l-8 2z', { fill: '#f1e8d4', stroke: INK, 'stroke-width': 1 }));
  return out;
}

export const fleetIconGenerator: ImageGenerator = {
  id: 'mapFleet',
  kind: 'image',
  defaultSize: [64, 64],
  params: [{ name: 'kind', type: 'enum', values: FLEET_ICON_KINDS, default: 'expedition' }],
  render(params: GeneratorParams, ctx: RenderContext): string {
    return doc(64, 64, fleetSvgBody(oneOf(params, 'kind', FLEET_ICON_KINDS, 'expedition')), [], ctx.label, ctx);
  },
  variants(): GeneratorParams[] {
    return FLEET_ICON_KINDS.map((kind) => ({ kind }));
  },
};

// ---------------------------------------------------------------------------------------------
// Sites.

/** A site vignette on a parchment roundel (64×64 grid). */
export function siteSvgBody(kind: SiteKindId): string[] {
  const out: string[] = [circle(32, 32, 24, { fill: '#efe3c3', stroke: INK, 'stroke-width': 2.4 }), circle(32, 32, 20.5, { fill: 'none', stroke: '#9a2f20', 'stroke-width': 1.2, opacity: '0.7' })];
  const s = { stroke: INK, 'stroke-width': 2, 'stroke-linejoin': 'round' as const, 'stroke-linecap': 'round' as const };
  switch (kind) {
    case 'cave':
      out.push(path('M14 44q2 -18 18 -22q16 4 18 22z', { fill: '#a49a88', ...s }), path('M25 44q1 -11 7 -12q6 1 7 12z', { fill: '#2a1f17' }));
      break;
    case 'barrow':
      out.push(path('M12 44q20 -26 40 0z', { fill: '#7f8f58', ...s }), path('M20 44v-5M44 44v-5M32 44v-3', { ...s, 'stroke-width': 3 }), path('M28 31l4 -4l4 4', { fill: 'none', ...s }));
      break;
    case 'tower':
      out.push(path('M24 46V20l3 -3l3 3l2 -2l3 3l3 -2v27z', { fill: '#b8ad98', ...s }), path('M29 46v-7a3 3 0 0 1 6 0v7', { fill: '#2a1f17' }), path('M26 28h4M33 33h4', { ...s, 'stroke-width': 1.4 }));
      break;
    case 'seaStack':
      out.push(path('M12 44q10 -3 20 0t20 0', { fill: 'none', stroke: '#2a4d5c', 'stroke-width': 2 }), path('M25 44l2 -22l5 -4l4 5l2 21z', { fill: '#9c9282', ...s }), path('M29 26l3 -2M30 32l4 0', { ...s, 'stroke-width': 1.3 }));
      break;
    case 'shrine':
      out.push(path('M22 44h20M24 44V30h16v14M21 30l11 -9l11 9z', { fill: '#c4a070', ...s }), circle(32, 37, 2.6, { fill: '#d4a74f', stroke: INK, 'stroke-width': 1.2 }));
      break;
    case 'wreck':
      out.push(path('M12 44q10 -3 20 0t20 0', { fill: 'none', stroke: '#2a4d5c', 'stroke-width': 2 }), path('M16 40q12 6 26 -4l4 -6', { fill: '#6b4b2e', ...s }), path('M30 39l6 -22M36 17l-7 2', { fill: 'none', ...s }));
      break;
    case 'ruinedHall':
      out.push(path('M14 44V32l9 -10l4 4M37 22l13 10v12', { fill: 'none', ...s, 'stroke-width': 2.4 }), path('M14 44h36', s), path('M20 44v-8h6v8M38 44v-10h6v10', { fill: '#b8ad98', ...s }));
      break;
    case 'grove':
      out.push(circle(22, 32, 6, { fill: '#5f7f46', ...s }), circle(42, 32, 6, { fill: '#5f7f46', ...s }), circle(32, 25, 7, { fill: '#6f8a4e', ...s }), path('M22 38v6M42 38v6M32 32v12', s));
      break;
  }
  return out;
}

export const siteIconGenerator: ImageGenerator = {
  id: 'mapSite',
  kind: 'image',
  defaultSize: [48, 48],
  params: [{ name: 'kind', type: 'enum', values: SITE_KINDS, default: 'cave' }],
  render(params: GeneratorParams, ctx: RenderContext): string {
    return doc(64, 64, siteSvgBody(oneOf(params, 'kind', SITE_KINDS, 'cave')), [], ctx.label, ctx);
  },
  variants(): GeneratorParams[] {
    return SITE_KINDS.map((kind) => ({ kind }));
  },
};

// ---------------------------------------------------------------------------------------------
// Weather FX, sparkle, compass rose, ETA flag.

/** A storm: a dark swirl of cloud with spiral bands (greys, tinted per severity at runtime). */
export function stormSvg(w: number, h: number): string {
  const defs = [radialGradient('st-core', [[0, '#3b3846', 0.95], [0.55, '#5c5866', 0.75], [1, '#8a8794', 0]])];
  const arms: string[] = [];
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const pts: string[] = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      const r = 4 + t * 27;
      const ang = a + t * 2.6;
      pts.push(`${i === 0 ? 'M' : 'L'}${n(32 + Math.cos(ang) * r)} ${n(32 + Math.sin(ang) * r)}`);
    }
    arms.push(path(pts.join(''), { fill: 'none', stroke: '#2b2834', 'stroke-width': 4.2 - k * 0.3, 'stroke-linecap': 'round', opacity: '0.55' }));
    arms.push(path(pts.join(''), { fill: 'none', stroke: '#e9e6ef', 'stroke-width': 1.1, 'stroke-linecap': 'round', opacity: '0.45', transform: 'translate(1.2 -1)' }));
  }
  return svgDoc({ width: w, height: h, viewBox: [0, 0, 64, 64], defs, body: [circle(32, 32, 31, { fill: 'url(#st-core)' }), ...arms, circle(32, 32, 4, { fill: '#26232e', opacity: '0.8' })] });
}

export const stormGenerator: ImageGenerator = {
  id: 'mapStorm',
  kind: 'image',
  defaultSize: [256, 256],
  render(_params: GeneratorParams, ctx: RenderContext): string {
    return stormSvg(ctx.width, ctx.height);
  },
};

export const glintGenerator: ImageGenerator = {
  id: 'mapGlint',
  kind: 'image',
  defaultSize: [32, 32],
  render(_params: GeneratorParams, ctx: RenderContext): string {
    const defs = [radialGradient('gl-halo', [[0, '#ffffff', 0.9], [0.35, '#f4f8f2', 0.35], [1, '#ffffff', 0]])];
    return svgDoc({
      width: ctx.width,
      height: ctx.height,
      viewBox: [0, 0, 32, 32],
      defs,
      body: [circle(16, 16, 15, { fill: 'url(#gl-halo)' }), path('M16 3L17.3 14.7L29 16L17.3 17.3L16 29L14.7 17.3L3 16L14.7 14.7Z', { fill: '#ffffff', opacity: '0.95' })],
    });
  },
};

/** A portolan compass rose: 16 inked points, 8 gilded and red, ringed. */
export function compassRoseSvg(w: number, h: number): string {
  const body: string[] = [circle(64, 64, 58, { fill: 'none', stroke: INK, 'stroke-width': 1.6 }), circle(64, 64, 52, { fill: 'none', stroke: INK, 'stroke-width': 0.8 })];
  for (let i = 0; i < 32; i++) {
    const a = (i * Math.PI) / 16;
    const r0 = 52;
    const r1 = i % 2 === 0 ? 58 : 55;
    body.push(path(`M${n(64 + Math.sin(a) * r0)} ${n(64 - Math.cos(a) * r0)}L${n(64 + Math.sin(a) * r1)} ${n(64 - Math.cos(a) * r1)}`, { stroke: INK, 'stroke-width': 1 }));
  }
  const point = (a: number, len: number, wid: number, fillL: string, fillR: string) => {
    const tipX = 64 + Math.sin(a) * len;
    const tipY = 64 - Math.cos(a) * len;
    const lx = 64 + Math.sin(a - Math.PI / 2) * wid;
    const ly = 64 - Math.cos(a - Math.PI / 2) * wid;
    const rx = 64 + Math.sin(a + Math.PI / 2) * wid;
    const ry = 64 - Math.cos(a + Math.PI / 2) * wid;
    return [
      polygon([64, 64, lx, ly, tipX, tipY], { fill: fillL, stroke: INK, 'stroke-width': 0.9, 'stroke-linejoin': 'round' }),
      polygon([64, 64, rx, ry, tipX, tipY], { fill: fillR, stroke: INK, 'stroke-width': 0.9, 'stroke-linejoin': 'round' }),
    ];
  };
  for (let i = 0; i < 8; i++) body.push(...point(((i * 2 + 1) * Math.PI) / 8, 34, 5, '#e8dcbc', '#9a7a4a'));
  for (let i = 0; i < 4; i++) body.push(...point(((i * 2 + 1) * Math.PI) / 4, 42, 7, '#f3e6c4', '#9a2f20'));
  for (let i = 0; i < 4; i++) body.push(...point((i * Math.PI) / 2, 56, 8.5, '#f3d58a', i === 0 ? '#9a2f20' : '#3a2a1b'));
  body.push(circle(64, 64, 5, { fill: '#f3d58a', stroke: INK, 'stroke-width': 1.2 }), circle(64, 64, 2, { fill: INK }));
  // North marker: a small spearhead above the rose.
  body.push(path('M64 0l4 7h-8z', { fill: '#9a2f20', stroke: INK, 'stroke-width': 0.9 }));
  return svgDoc({ width: w, height: h, viewBox: [0, 0, 128, 128], body });
}

export const compassRoseGenerator: ImageGenerator = {
  id: 'mapCompassRose',
  kind: 'image',
  defaultSize: [256, 256],
  render(_params: GeneratorParams, ctx: RenderContext): string {
    return compassRoseSvg(ctx.width, ctx.height);
  },
};

export const flagGenerator: ImageGenerator = {
  id: 'mapFlag',
  kind: 'image',
  defaultSize: [32, 48],
  render(_params: GeneratorParams, ctx: RenderContext): string {
    return svgDoc({
      width: ctx.width,
      height: ctx.height,
      viewBox: [0, 0, 32, 48],
      body: [path('M8 46V4', { stroke: INK, 'stroke-width': 2.4, 'stroke-linecap': 'round' }), path('M8 5h20l-5 7l5 7h-20z', { fill: '#ffffff', stroke: INK, 'stroke-width': 1.6, 'stroke-linejoin': 'round' }), circle(8, 46, 2.5, { fill: INK })],
    });
  },
};

/** The painted-base placeholder for the gallery: the geography's landmasses on parchment and painted sea. */
export function chartPreviewSvg(w: number, h: number, label?: string): string {
  let geo;
  try {
    geo = getGeography();
  } catch {
    geo = null;
  }
  const gw = geo?.grid.width ?? 800;
  const gh = geo?.grid.height ?? 600;
  const body: string[] = [rect(0, 0, gw, gh, { fill: '#6f98a3' })];
  for (const lm of geo?.landmasses ?? []) {
    const d = lm.polygon.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${n(x)} ${n(y)}`).join('') + 'Z';
    body.push(path(d, { fill: '#e3d3a3', stroke: INK, 'stroke-width': 1.2, 'stroke-linejoin': 'round' }));
  }
  if (label) body.push(el('text', { x: gw / 2, y: gh - 18, 'text-anchor': 'middle', 'font-family': 'Georgia, serif', 'font-size': 22, fill: INK, opacity: '0.7' }, esc(label)));
  return svgDoc({ width: w, height: h, viewBox: [0, 0, gw, gh], body });
}

export const chartGenerator: ImageGenerator = {
  id: 'mapChart',
  kind: 'image',
  defaultSize: [800, 600],
  params: [{ name: 'note', type: 'string', note: 'the in-game placeholder is the procedural chart baked from the static world; this preview only shows the landmasses' }],
  render(params: GeneratorParams, ctx: RenderContext): string {
    return chartPreviewSvg(ctx.width, ctx.height, str(params, 'note', ctx.label ?? ''));
  },
};

/** Every map generator. */
export const MAP_GENERATORS: readonly ImageGenerator[] = [settlementIconGenerator, fleetIconGenerator, siteIconGenerator, stormGenerator, glintGenerator, compassRoseGenerator, flagGenerator, chartGenerator];

/** Registers the map's placeholder generators with the asset library (idempotent). */
export function registerMapGenerators(): void {
  for (const gen of MAP_GENERATORS) if (getGenerator(gen.id) !== gen) registerGenerator(gen, { replace: true });
}

/** Icon style of a culture (asset id family). */
export function iconStyleOf(culture: string): IconStyle {
  switch (culture) {
    case 'albric':
    case 'cael':
      return 'west';
    case 'corvani':
    case 'saraleonese':
      return 'south';
    case 'velkar':
    case 'kurgai':
      return 'east';
    default:
      return 'north';
  }
}

/** Manifest id of a settlement icon. */
export function settlementAssetId(tier: SettlementTierId, style: IconStyle): string {
  return `map.settlement.${style}.${tier}`;
}

/** Manifest id of a fleet icon. */
export function fleetAssetId(kind: FleetIconKind): string {
  return `map.fleet.${kind}`;
}

/** Manifest id of a site icon. */
export function siteAssetId(kind: string): string {
  return `map.site.${(SITE_KINDS as readonly string[]).includes(kind) ? kind : 'cave'}`;
}

export { SITE_KINDS as MAP_SITE_KINDS };
