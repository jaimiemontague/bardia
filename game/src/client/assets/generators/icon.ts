/**
 * `icon` generator: renders a glyph from iconGlyphs.ts in one of four styles —
 *   carved   — bone glyph inlaid in an oak-and-iron badge (default; "carved and painted", §27.1)
 *   flat     — the glyph alone in one colour (UI buttons; `color` param, or currentColor inline)
 *   ink      — dark ink glyph for parchment panels
 *   outlined — light glyph with a dark outline, readable on the painted world map
 */
import type { CultureId } from '@content/schemas/ids';
import type { GeneratorParams, ImageGenerator, RenderContext } from '../types';
import { el, g, n, n2, radialGradient, linearGradient, svgDoc } from '../svg/svg';
import { CHROME, CULTURE_PALETTE, isHex, mix, shade } from '../svg/palette';
import { watermark, type WatermarkMode } from '../svg/paint';
import { CATEGORY_DEFAULT, GLYPH_IDS, GLYPHS, glyphFor, type Glyph, type IconCategory } from './iconGlyphs';
import { oneOf, str } from './params';

export const ICON_STYLES = ['carved', 'flat', 'ink', 'outlined'] as const;
export type IconStyle = (typeof ICON_STYLES)[number];
export const ICON_BADGES = ['auto', 'none', 'disc', 'shield', 'square', 'diamond'] as const;
export type IconBadge = (typeof ICON_BADGES)[number];

const ALL_CULTURES: readonly CultureId[] = ['skarn', 'hvarn', 'eyjar', 'albric', 'cael', 'corvani', 'velkar', 'kurgai', 'saraleonese', 'isafolder', 'rime'];

/** Options for `iconSvg`. */
export interface IconOptions {
  style?: IconStyle;
  badge?: IconBadge;
  /** Glyph colour (flat style; 'currentColor' for inline SVG). */
  color?: string;
  /** Badge field colour (carved style). */
  field?: string;
  /** Output size in px. */
  size?: number;
  /** Prefix for element ids (inline SVGs in one document need unique ids). */
  idPrefix?: string;
  title?: string;
  watermark?: WatermarkMode;
  label?: string;
}

function badgeFor(cat: IconCategory, style: IconStyle): Exclude<IconBadge, 'auto'> {
  if (style !== 'carved') return 'none';
  switch (cat) {
    case 'unit':
    case 'skill':
    case 'attribute':
      return 'shield';
    case 'good':
    case 'resource':
    case 'building':
      return 'square';
    case 'omen':
    case 'trait':
      return 'diamond';
    default:
      return 'disc';
  }
}

function badgeShape(kind: Exclude<IconBadge, 'auto' | 'none'>, inset: number): string {
  const a = inset;
  const b = 64 - inset;
  switch (kind) {
    case 'disc':
      return el('circle', { cx: 32, cy: 32, r: 32 - inset });
    case 'square':
      return el('rect', { x: a, y: a, width: b - a, height: b - a, rx: 8 - inset * 0.4 });
    case 'diamond':
      return el('polygon', { points: `32,${n(a - 1)} ${n(b + 1)},32 32,${n(b + 1)} ${n(a - 1)},32` });
    case 'shield':
      return el('path', { d: `M${n(a)} ${n(a + 2)}Q32 ${n(a - 2)} ${n(b)} ${n(a + 2)}V${n(34)}Q${n(b)} ${n(b - 4)} 32 ${n(b + 1)}Q${n(a)} ${n(b - 4)} ${n(a)} 34Z` });
    default:
      return '';
  }
}

/** Glyph group markup (fills, strokes, mask cut-outs, top layer) with the given paint. */
function glyphBody(gl: Glyph, paint: string, maskId: string): string {
  const masked = g({ mask: gl.cut && gl.cut.length > 0 ? `url(#${maskId})` : undefined }, [
    gl.f.length ? g({ fill: paint }, gl.f) : '',
    gl.s && gl.s.length ? g({ fill: 'none', stroke: paint }, gl.s) : '',
  ]);
  const top = gl.top && gl.top.length ? g({ fill: paint, stroke: 'none' }, gl.top) : '';
  return masked + top;
}

function glyphMask(gl: Glyph, id: string): string {
  if (!gl.cut || gl.cut.length === 0) return '';
  return el('mask', { id, maskUnits: 'userSpaceOnUse', x: -8, y: -8, width: 80, height: 80 }, [
    el('rect', { x: -8, y: -8, width: 80, height: 80, fill: '#ffffff' }),
    g({ fill: '#000000', stroke: '#000000' }, gl.cut),
  ]);
}

/** Renders a glyph (id or content alias) to a standalone SVG document. */
export function iconSvg(glyphId: string, opts: IconOptions = {}): string {
  const gl = glyphFor(glyphId) ?? (GLYPHS[CATEGORY_DEFAULT.ui] as Glyph);
  const style: IconStyle = opts.style ?? 'carved';
  const badge = opts.badge === undefined || opts.badge === 'auto' ? badgeFor(gl.cat, style) : opts.badge;
  const p = opts.idPrefix ?? 'i';
  const size = opts.size ?? 64;
  const defs: string[] = [];
  const body: string[] = [];
  const maskId = `${p}-m`;
  defs.push(glyphMask(gl, maskId));
  const k = badge === 'none' ? 0.94 : badge === 'shield' ? 0.6 : badge === 'diamond' ? 0.56 : 0.66;
  const ty = badge === 'shield' ? -2 : 0;
  const place = `translate(${n2(32 - 32 * k)} ${n2(32 - 32 * k + ty)}) scale(${n2(k)})`;

  if (style === 'carved') {
    const field = isHex(opts.field) ? opts.field : CHROME.oak;
    if (badge !== 'none') {
      defs.push(radialGradient(`${p}-fld`, [[0, shade(field, 0.18)], [0.7, field], [1, shade(field, -0.45)]], { cx: 0.4, cy: 0.35, r: 0.75 }));
      defs.push(linearGradient(`${p}-rim`, [[0, '#9aa0a6'], [0.45, CHROME.iron], [1, CHROME.ironDark]], { x1: 0, y1: 0, x2: 0.4, y2: 1 }));
      body.push(g({ fill: `url(#${p}-rim)` }, badgeShape(badge, 1)));
      body.push(g({ fill: `url(#${p}-fld)` }, badgeShape(badge, 4.2)));
      body.push(g({ fill: 'none', stroke: '#000000', 'stroke-opacity': '0.35', 'stroke-width': 1.5 }, badgeShape(badge, 5)));
      for (const [x, y] of badge === 'disc' ? [[32, 2.6], [61.4, 32], [32, 61.4], [2.6, 32]] : badge === 'square' ? [[5, 5], [59, 5], [59, 59], [5, 59]] : []) {
        body.push(el('circle', { cx: x, cy: y, r: 1.4, fill: '#c9ccd1', 'fill-opacity': '0.8' }));
      }
    }
    defs.push(linearGradient(`${p}-ink`, [[0, '#fbf3df'], [0.55, CHROME.bone], [1, CHROME.boneDim]], { x1: 0, y1: 0, x2: 0.3, y2: 1 }));
    body.push(g({ transform: `${place} translate(1.3 1.8)`, opacity: '0.6' }, glyphBody(gl, '#0c0806', maskId)));
    body.push(g({ transform: place }, glyphBody(gl, `url(#${p}-ink)`, maskId)));
  } else if (style === 'outlined') {
    const col = isHex(opts.color) ? opts.color : CHROME.bone;
    defs.push(
      el('filter', { id: `${p}-o`, x: '-20%', y: '-20%', width: '140%', height: '140%' }, [
        el('feMorphology', { in: 'SourceAlpha', operator: 'dilate', radius: 2.2, result: 'd' }),
        el('feFlood', { 'flood-color': '#120c08', 'flood-opacity': '0.9' }),
        el('feComposite', { in2: 'd', operator: 'in', result: 'o' }),
        el('feMerge', {}, [el('feMergeNode', { in: 'o' }), el('feMergeNode', { in: 'SourceGraphic' })]),
      ]),
    );
    body.push(g({ transform: place, filter: `url(#${p}-o)` }, glyphBody(gl, col, maskId)));
  } else {
    const col = style === 'ink' ? (isHex(opts.color) ? opts.color : CHROME.ink) : opts.color === 'currentColor' ? 'currentColor' : isHex(opts.color) ? opts.color : CHROME.bone;
    if (badge !== 'none') body.push(g({ fill: 'none', stroke: col, 'stroke-width': 2.4 }, badgeShape(badge, 2.4)));
    body.push(g({ transform: place }, glyphBody(gl, col, maskId)));
  }
  if (opts.watermark && opts.watermark !== 'off') body.push(g({ transform: `scale(${n2(64 / size)})` }, watermark(size, size, opts.label, opts.watermark === 'full' ? 'corner' : opts.watermark)));
  return svgDoc({ width: size, height: size, viewBox: [0, 0, 64, 64], defs: defs.filter((d) => d !== ''), body, title: opts.title });
}

/** Inline-SVG markup for React (currentColor, unique ids, no XML title). */
export function inlineIconMarkup(glyphId: string, idPrefix: string, style: IconStyle = 'flat'): string {
  return iconSvg(glyphId, { style, color: style === 'flat' ? 'currentColor' : undefined, idPrefix, size: 64 });
}

/** Every glyph id (gallery, tests). */
export function iconIds(): readonly string[] {
  return GLYPH_IDS;
}

export const iconGenerator: ImageGenerator = {
  id: 'icon',
  kind: 'image',
  defaultSize: [64, 64],
  params: [
    { name: 'glyph', type: 'enum', values: GLYPH_IDS, default: 'uiInfo', note: 'glyph id, or a content id alias (good, ship type, skill, god, building, unit…)' },
    { name: 'style', type: 'enum', values: ICON_STYLES, default: 'carved' },
    { name: 'badge', type: 'enum', values: ICON_BADGES, default: 'auto' },
    { name: 'color', type: 'string', note: '#rrggbb glyph colour (flat/ink/outlined)' },
    { name: 'field', type: 'string', note: '#rrggbb badge colour (carved)' },
    { name: 'culture', type: 'enum', values: ALL_CULTURES, note: 'tints the carved badge with the culture colour' },
  ],
  render(params: GeneratorParams, ctx: RenderContext): string {
    const culture = oneOf<CultureId | ''>(params, 'culture', ALL_CULTURES, '');
    const field = typeof params.field === 'string' ? params.field : culture !== '' ? mix(CULTURE_PALETTE[culture].primary, CHROME.oakDark, 0.35) : undefined;
    return iconSvg(str(params, 'glyph', 'uiInfo'), {
      style: oneOf(params, 'style', ICON_STYLES, 'carved'),
      badge: oneOf(params, 'badge', ICON_BADGES, 'auto'),
      color: typeof params.color === 'string' ? params.color : undefined,
      field,
      size: Math.round(Math.min(ctx.width, ctx.height)),
      watermark: ctx.watermark,
      label: ctx.label,
      title: ctx.label,
    });
  },
  variants(): GeneratorParams[] {
    return GLYPH_IDS.map((glyph) => ({ glyph }));
  },
};
