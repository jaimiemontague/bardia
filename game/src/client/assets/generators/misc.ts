/**
 * Utility generators:
 *   card        — a labelled placeholder card (oak, parchment or iron) with an optional glyph. The
 *                 resolver also uses it for unknown ids and unknown generators, so nothing is blank.
 *   terrainTile — seamless battle-map ground tiles per biome (§27.2 battle tilesets): grass, forest
 *                 floor, marsh, sand, snow, rock, mud, field, road, shallows and deep water.
 */
import type { GeneratorParams, ImageGenerator, RenderContext } from '../types';
import { el, esc, g, linearGradient, n, n2, path, radialGradient, rect, svgDoc } from '../svg/svg';
import { CHROME, shade } from '../svg/palette';
import { grainFilter, watermark } from '../svg/paint';
import { ArtRng } from '../svg/rng';
import { iconSvg } from './icon';
import { oneOf, seedOf, str } from './params';

export const CARD_TONES = ['oak', 'parchment', 'iron'] as const;
export type CardTone = (typeof CARD_TONES)[number];

/** Wraps text into at most `maxLines` lines of about `width` characters. */
function wrap(text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter((w) => w !== '');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > width && cur !== '') {
      lines.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur !== '') lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${(kept[maxLines - 1] as string).slice(0, Math.max(0, width - 1))}…`;
    return kept;
  }
  return lines;
}

/** A labelled card. Text is data (asset ids, labels), never localised UI copy. */
export function cardSvg(opts: { title: string; subtitle?: string; glyph?: string; tone?: CardTone; width: number; height: number; seed?: number }): string {
  const { width: w, height: h } = opts;
  const tone = opts.tone ?? 'oak';
  const bg = tone === 'parchment' ? CHROME.parchment : tone === 'iron' ? CHROME.ironDark : CHROME.oakDark;
  const ink = tone === 'parchment' ? CHROME.ink : CHROME.bone;
  const m = Math.max(4, Math.min(w, h) * 0.04);
  const defs = [
    radialGradient('c-bg', [[0, shade(bg, 0.15)], [1, shade(bg, -0.3)]], { cx: 0.45, cy: 0.4, r: 0.8 }),
    linearGradient('c-rim', [[0, '#8a9096'], [1, CHROME.ironDark]], { x1: 0, y1: 0, x2: 0, y2: 1 }),
    grainFilter('c-grain', opts.seed ?? 3, 0.9, 0.18),
  ];
  const fs = Math.max(9, Math.min(w / 14, h / 7));
  const titleLines = wrap(opts.title, Math.max(6, Math.floor((w - m * 4) / (fs * 0.55))), 3);
  const body: string[] = [
    rect(0, 0, w, h, { fill: 'url(#c-rim)', rx: m * 1.5 }),
    rect(m * 0.7, m * 0.7, w - m * 1.4, h - m * 1.4, { fill: 'url(#c-bg)', rx: m }),
    rect(m * 1.6, m * 1.6, w - m * 3.2, h - m * 3.2, { fill: 'none', stroke: ink, 'stroke-opacity': '0.35', 'stroke-width': Math.max(1, m * 0.25), 'stroke-dasharray': `${n(m * 1.2)} ${n(m * 0.6)}`, rx: m * 0.6 }),
  ];
  let textTop = h / 2 - (titleLines.length * fs * 1.2) / 2 + fs * 0.8;
  if (opts.glyph && h > 80) {
    const size = Math.min(w, h) * 0.34;
    const inner = iconSvg(opts.glyph, { style: tone === 'parchment' ? 'ink' : 'flat', color: ink, size: 64, idPrefix: 'cg' }).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    body.push(el('svg', { x: w / 2 - size / 2, y: h * 0.14, width: size, height: size, viewBox: '0 0 64 64', opacity: '0.85' }, inner));
    textTop = h * 0.14 + size + fs * 1.3;
  }
  titleLines.forEach((line, i) => {
    body.push(el('text', { x: w / 2, y: textTop + i * fs * 1.2, 'text-anchor': 'middle', 'font-family': 'Cinzel, Georgia, serif', 'font-size': n(fs), fill: ink }, esc(line)));
  });
  if (opts.subtitle) {
    body.push(el('text', { x: w / 2, y: h - m * 3, 'text-anchor': 'middle', 'font-family': 'Georgia, serif', 'font-size': n(Math.max(8, fs * 0.6)), fill: ink, opacity: '0.7' }, esc(opts.subtitle.slice(0, 64))));
  }
  body.push(rect(0, 0, w, h, { filter: 'url(#c-grain)', style: 'mix-blend-mode:multiply', opacity: '0.6', rx: m * 1.5 }));
  return svgDoc({ width: w, height: h, viewBox: [0, 0, w, h], defs, body });
}

export const cardGenerator: ImageGenerator = {
  id: 'card',
  kind: 'image',
  defaultSize: [320, 200],
  params: [
    { name: 'title', type: 'string', note: 'text shown on the card (defaults to the placeholder label)' },
    { name: 'subtitle', type: 'string' },
    { name: 'glyph', type: 'string', note: 'icon glyph id' },
    { name: 'tone', type: 'enum', values: CARD_TONES, default: 'oak' },
  ],
  render(params: GeneratorParams, ctx: RenderContext): string {
    const svg = cardSvg({
      title: str(params, 'title', ctx.label ?? 'placeholder'),
      subtitle: typeof params.subtitle === 'string' ? params.subtitle : undefined,
      glyph: typeof params.glyph === 'string' ? params.glyph : undefined,
      tone: oneOf(params, 'tone', CARD_TONES, 'oak'),
      width: Math.round(ctx.width),
      height: Math.round(ctx.height),
      seed: seedOf(params, 'card'),
    });
    return ctx.watermark === 'off' ? svg : svg.replace(/<\/svg>$/, `${watermark(ctx.width, ctx.height, ctx.label, 'corner')}</svg>`);
  },
  variants(): GeneratorParams[] {
    return [{ title: 'Placeholder card', tone: 'oak', glyph: 'uiInfo' }, { title: 'A parchment note', tone: 'parchment', subtitle: 'subtitle' }, { title: 'Iron plate', tone: 'iron', glyph: 'uiWarning' }];
  },
};

// ---------------------------------------------------------------------------------------------
// Terrain tiles

export const BIOMES = ['grass', 'forest', 'marsh', 'sand', 'snow', 'rock', 'mud', 'field', 'road', 'shallows', 'water', 'heath'] as const;
export type Biome = (typeof BIOMES)[number];

const BIOME_LOOK: Readonly<Record<Biome, { base: string; dark: string; light: string; freq: number }>> = {
  grass: { base: '#5f7f46', dark: '#3a5230', light: '#8aa860', freq: 0.08 },
  forest: { base: '#3e5a32', dark: '#24361e', light: '#5a7a42', freq: 0.06 },
  marsh: { base: '#5a6a42', dark: '#34402a', light: '#7a8a5a', freq: 0.05 },
  sand: { base: '#c8b48a', dark: '#a8946a', light: '#e0d0a8', freq: 0.09 },
  snow: { base: '#e4eaee', dark: '#b8c4cc', light: '#ffffff', freq: 0.05 },
  rock: { base: '#7d786c', dark: '#4a463e', light: '#a8a498', freq: 0.07 },
  mud: { base: '#6a5238', dark: '#4a3a28', light: '#8a7050', freq: 0.06 },
  field: { base: '#a8943e', dark: '#7a6a2a', light: '#c8b45a', freq: 0.07 },
  road: { base: '#8a7a5a', dark: '#6a5a40', light: '#a89a7a', freq: 0.1 },
  shallows: { base: '#4a8a8a', dark: '#2e6a6e', light: '#8ac0b8', freq: 0.05 },
  water: { base: '#1d4a5a', dark: '#123440', light: '#3a6a7a', freq: 0.04 },
  heath: { base: '#6a5a4a', dark: '#4a3a32', light: '#8a6a5a', freq: 0.08 },
};

/** A seamless square ground tile (turbulence with stitchTiles, plus a few period-appropriate marks). */
export function terrainTileSvg(biome: Biome, size: number, seed: number): string {
  const L = BIOME_LOOK[biome];
  const V = 128;
  const r = new ArtRng(`tile|${biome}|${seed}`);
  const fid = 't-noise';
  const defs = [
    el('filter', { id: fid, x: 0, y: 0, width: '100%', height: '100%', filterUnits: 'userSpaceOnUse' }, [
      el('feTurbulence', { type: 'fractalNoise', baseFrequency: n2(L.freq), numOctaves: 4, seed: seed % 1000, stitchTiles: 'stitch' }),
      el('feColorMatrix', { type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.8 -0.7' }),
    ]),
  ];
  const body: string[] = [rect(0, 0, V, V, { fill: L.base }), g({ opacity: '0.55' }, rect(0, 0, V, V, { fill: L.dark, filter: `url(#${fid})` }))];
  // Marks wrap around the edges so tiles stay seamless.
  const marks: string[] = [];
  const count = biome === 'water' || biome === 'snow' ? 6 : 26;
  for (let i = 0; i < count; i++) {
    const x = r.next() * V;
    const y = r.next() * V;
    let m = '';
    if (biome === 'grass' || biome === 'heath' || biome === 'marsh') m = path(`M${n(x)} ${n(y)}l${n(r.jitter(2))} ${n(-r.range(3, 7))}M${n(x + 2)} ${n(y)}l${n(r.jitter(2))} ${n(-r.range(3, 6))}`, { stroke: r.chance(0.5) ? L.light : L.dark, 'stroke-width': 1.2, opacity: '0.7' });
    else if (biome === 'forest') m = el('circle', { cx: n(x), cy: n(y), r: n(r.range(1.5, 4)), fill: r.chance(0.5) ? '#7a5a32' : L.light, opacity: '0.6' });
    else if (biome === 'rock' || biome === 'sand' || biome === 'road') m = el('ellipse', { cx: n(x), cy: n(y), rx: n(r.range(1, biome === 'rock' ? 7 : 2.5)), ry: n(r.range(1, biome === 'rock' ? 5 : 2)), fill: r.chance(0.5) ? L.light : L.dark, opacity: '0.6' });
    else if (biome === 'field') m = path(`M${n(x - 6)} ${n(y)}h12`, { stroke: L.dark, 'stroke-width': 1.4, opacity: '0.5' });
    else if (biome === 'mud') m = el('ellipse', { cx: n(x), cy: n(y), rx: n(r.range(2, 6)), ry: n(r.range(1, 3)), fill: '#3a2a1a', opacity: '0.35' });
    else m = path(`M${n(x - 8)} ${n(y)}q4 -2 8 0t8 0`, { stroke: L.light, 'stroke-width': 1.2, fill: 'none', opacity: '0.6' });
    marks.push(m);
  }
  const tiled: string[] = [];
  for (const dx of [-V, 0, V]) for (const dy of [-V, 0, V]) tiled.push(g({ transform: `translate(${dx} ${dy})` }, marks));
  body.push(g({}, tiled));
  if (biome === 'field') for (let i = 0; i < 8; i++) body.push(rect(0, i * 16, V, 2, { fill: L.dark, opacity: '0.35' }));
  if (biome === 'road') body.push(rect(0, V * 0.3, V, 3, { fill: L.dark, opacity: '0.4' }), rect(0, V * 0.66, V, 3, { fill: L.dark, opacity: '0.4' }));
  if (biome === 'marsh') for (let i = 0; i < 3; i++) body.push(el('ellipse', { cx: n(r.next() * V), cy: n(r.next() * V), rx: n(r.range(8, 18)), ry: n(r.range(4, 8)), fill: '#3a5a5a', opacity: '0.55' }));
  return svgDoc({ width: size, height: size, viewBox: [0, 0, V, V], defs, body });
}

export const terrainTileGenerator: ImageGenerator = {
  id: 'terrainTile',
  kind: 'image',
  defaultSize: [128, 128],
  params: [
    { name: 'biome', type: 'enum', values: BIOMES, default: 'grass' },
    { name: 'seed', type: 'number', note: 'variant of the same biome' },
  ],
  render(params: GeneratorParams, ctx: RenderContext): string {
    return terrainTileSvg(oneOf(params, 'biome', BIOMES, 'grass'), Math.round(Math.min(ctx.width, ctx.height)), seedOf(params, 'tile'));
  },
  variants(): GeneratorParams[] {
    return BIOMES.map((biome) => ({ biome }));
  },
};
