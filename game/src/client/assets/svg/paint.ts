/**
 * Shared "painted" look for placeholder scenes: paper/canvas grain, brush-edge displacement, soft
 * blur, vignette and the optional placeholder watermark. Filters are seeded so equal params give
 * byte-identical SVG.
 */
import { el, esc, n, n2, rect } from './svg';

/** Brush-edge roughening: displaces shapes slightly with low-frequency noise. */
export function roughenFilter(id: string, seed: number, scale = 3, freq = 0.035): string {
  return el('filter', { id, x: '-5%', y: '-5%', width: '110%', height: '110%' }, [
    el('feTurbulence', { type: 'fractalNoise', baseFrequency: n2(freq), numOctaves: 2, seed: seed % 1000, result: 'noise' }),
    el('feDisplacementMap', { in: 'SourceGraphic', in2: 'noise', scale: n(scale), xChannelSelector: 'R', yChannelSelector: 'G' }),
  ]);
}

/**
 * Canvas grain: a full-size noise texture with low alpha, composited over a scene with
 * `mix-blend-mode: multiply` / `overlay` to break up flat vector fills into something paint-like.
 */
export function grainFilter(id: string, seed: number, freq = 0.9, alpha = 0.22): string {
  return el('filter', { id, x: 0, y: 0, width: '100%', height: '100%', filterUnits: 'objectBoundingBox' }, [
    el('feTurbulence', { type: 'fractalNoise', baseFrequency: n2(freq), numOctaves: 3, seed: seed % 1000, stitchTiles: 'stitch' }),
    el('feColorMatrix', { type: 'matrix', values: `0 0 0 0 0.5  0 0 0 0 0.45  0 0 0 0 0.4  0 0 0 ${n2(alpha * 3)} ${n2(-alpha)}` }),
  ]);
}

/** Large mottled variation (pigment pooling); use with multiply at low opacity. */
export function mottleFilter(id: string, seed: number, freq = 0.012): string {
  return el('filter', { id, x: 0, y: 0, width: '100%', height: '100%', filterUnits: 'objectBoundingBox' }, [
    el('feTurbulence', { type: 'fractalNoise', baseFrequency: n2(freq), numOctaves: 4, seed: (seed + 7) % 1000 }),
    el('feColorMatrix', { type: 'matrix', values: '0 0 0 0 0.35  0 0 0 0 0.3  0 0 0 0 0.25  0 0 0 1.4 -0.55' }),
  ]);
}

/** Gaussian blur filter. */
export function blurFilter(id: string, std: number): string {
  return el('filter', { id, x: '-50%', y: '-50%', width: '200%', height: '200%' }, el('feGaussianBlur', { stdDeviation: n2(std) }));
}

/** Soft glow: blurred copy under the source. */
export function glowFilter(id: string, std: number): string {
  return el('filter', { id, x: '-100%', y: '-100%', width: '300%', height: '300%' }, [
    el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: n2(std), result: 'b' }),
    el('feMerge', {}, [el('feMergeNode', { in: 'b' }), el('feMergeNode', { in: 'SourceGraphic' })]),
  ]);
}

/** Radial vignette gradient (use as fill on a full-size rect). */
export function vignetteGradient(id: string, strength = 0.55, colour = '#120c08'): string {
  return el('radialGradient', { id, cx: '0.5', cy: '0.48', r: '0.75' }, [
    el('stop', { offset: '0.55', 'stop-color': colour, 'stop-opacity': '0' }),
    el('stop', { offset: '1', 'stop-color': colour, 'stop-opacity': n2(strength) }),
  ]);
}

/** Full-frame overlays: grain + mottle + vignette. Ids must be defined by `paintDefs`. */
export function paintOverlay(w: number, h: number, prefix: string, opts: { grain?: number; mottle?: number; vignette?: boolean } = {}): string {
  const out: string[] = [];
  if ((opts.mottle ?? 0.5) > 0) out.push(rect(0, 0, w, h, { filter: `url(#${prefix}-mottle)`, opacity: n2(opts.mottle ?? 0.5), style: 'mix-blend-mode:multiply' }));
  if ((opts.grain ?? 1) > 0) out.push(rect(0, 0, w, h, { filter: `url(#${prefix}-grain)`, opacity: n2(opts.grain ?? 1), style: 'mix-blend-mode:multiply' }));
  if (opts.vignette !== false) out.push(rect(0, 0, w, h, { fill: `url(#${prefix}-vig)` }));
  return out.join('');
}

/** Definitions used by paintOverlay. */
export function paintDefs(prefix: string, seed: number, opts: { grainFreq?: number; vignette?: number } = {}): string[] {
  return [grainFilter(`${prefix}-grain`, seed, opts.grainFreq ?? 0.9), mottleFilter(`${prefix}-mottle`, seed), vignetteGradient(`${prefix}-vig`, opts.vignette ?? 0.55)];
}

/** Watermark modes for placeholders (§27.3: placeholders are labelled). */
export type WatermarkMode = 'off' | 'corner' | 'full';

/**
 * The placeholder watermark: a small corner tag ("corner") or a diagonal banner ("full") showing the
 * label, so screenshots make clear which art is still a stand-in.
 */
export function watermark(w: number, h: number, label: string | undefined, mode: WatermarkMode): string {
  if (mode === 'off') return '';
  const text = esc((label ?? 'placeholder').slice(0, 48));
  const fs = Math.max(8, Math.min(w, h) * (mode === 'full' ? 0.07 : 0.055));
  if (mode === 'corner') {
    const tw = Math.min(w - 4, text.length * fs * 0.56 + fs * 1.2);
    const th = fs * 1.6;
    return el('g', { 'pointer-events': 'none' }, [
      rect(w - tw - 2, h - th - 2, tw, th, { rx: fs * 0.3, fill: '#120c08', 'fill-opacity': '0.62', stroke: '#e8dcc0', 'stroke-opacity': '0.5', 'stroke-width': 1 }),
      el(
        'text',
        { x: w - tw / 2 - 2, y: h - th / 2 - 2 + fs * 0.35, 'font-family': 'Georgia, serif', 'font-size': fs, fill: '#e8dcc0', 'text-anchor': 'middle' },
        text,
      ),
    ]);
  }
  const angle = (-Math.atan2(h, w) * 180) / Math.PI;
  return el('g', { 'pointer-events': 'none', transform: `rotate(${n(angle)} ${n(w / 2)} ${n(h / 2)})` }, [
    rect(-w, h / 2 - fs, w * 3, fs * 2, { fill: '#120c08', 'fill-opacity': '0.45' }),
    el(
      'text',
      { x: w / 2, y: h / 2 + fs * 0.35, 'font-family': 'Georgia, serif', 'font-size': fs, fill: '#f3e6c8', 'text-anchor': 'middle', 'letter-spacing': n(fs * 0.08) },
      `PLACEHOLDER · ${text}`,
    ),
  ]);
}
