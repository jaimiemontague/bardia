/**
 * Shared types of the asset library: generator parameters, render context and resolution results.
 */
import type { WatermarkMode } from './svg/paint';

export type { WatermarkMode } from './svg/paint';

/** A generator parameter value (manifest params are primitives; runtime callers may pass lists). */
export type ParamValue = string | number | boolean | readonly string[] | undefined;

/** Generator parameters: the manifest's `placeholder.params` merged with the caller's params. */
export type GeneratorParams = Readonly<Record<string, ParamValue>>;

/** Everything a generator needs besides its params. */
export interface RenderContext {
  /** Output size in px (one frame for sprite strips). */
  width: number;
  height: number;
  /** Frames laid out horizontally (sprite strips); default 1. */
  frames: number;
  /** Pivot in [0,1]² (sprites are centred on it). */
  anchor: readonly [number, number];
  /** Placeholder label (manifest `placeholder.label`, or a generated description). */
  label?: string;
  /** Placeholder watermark mode. */
  watermark: WatermarkMode;
}

/** One documented generator parameter (gallery, ASSET_DROP_IN.md and recipe validation). */
export interface GeneratorParamDoc {
  name: string;
  type: 'enum' | 'number' | 'string' | 'boolean' | 'list';
  /** Allowed values (enums and lists). */
  values?: readonly string[];
  default?: string | number | boolean;
  /** One line for developers (not player-visible). */
  note?: string;
}

/** A procedural image generator: params → standalone SVG markup (deterministic, DOM-free). */
export interface ImageGenerator {
  readonly id: string;
  readonly kind: 'image';
  /** Natural size used when neither the manifest nor the caller gives one. */
  readonly defaultSize: readonly [number, number];
  /** Parameter documentation (unknown params are ignored; bad values fall back to defaults). */
  readonly params?: readonly GeneratorParamDoc[];
  render(params: GeneratorParams, ctx: RenderContext): string;
  /** Every interesting variant, for the dev gallery (each is a full param set). */
  variants?(): GeneratorParams[];
  /**
   * Layered generators (portraits): the manifest ids of the layer pieces this image is built from.
   * When any of them has a final file, the resolver composes the image from final pieces.
   */
  layers?(params: GeneratorParams): string[];
  /** Renders with final layer pieces (manifest id → self-contained data URL). */
  renderWithLayers?(params: GeneratorParams, ctx: RenderContext, finals: Readonly<Record<string, string>>): string;
  /** CSS filter applied to a FINAL file so it matches params the file cannot encode (season, time of day). */
  finalFilter?(params: GeneratorParams): string | undefined;
}

/**
 * A procedural audio placeholder (registered by the audio/music system): returns a playable URL
 * (object URL of a synthesised WAV, for example).
 */
export interface AudioGenerator {
  readonly id: string;
  readonly kind: 'audio';
  readonly params?: readonly GeneratorParamDoc[];
  render(params: GeneratorParams, ctx: { durationS?: number; loop?: boolean; label?: string }): Promise<string>;
}

export type PlaceholderGenerator = ImageGenerator | AudioGenerator;

/** Asset kinds (manifest `kind`). */
export type AssetKind = 'image' | 'music' | 'sfx' | 'voice';

/**
 * Where a resolved URL came from:
 *   final       — the owner's file at the manifest path
 *   composite   — a layered image built (partly) from final layer pieces
 *   placeholder — the procedural stand-in
 *   missing     — the id is not in the manifest (a labelled card is shown)
 */
export type AssetStatus = 'final' | 'composite' | 'placeholder' | 'missing';

/** The outcome of resolving an asset id. */
export interface ResolvedAsset {
  id: string;
  /** Data URL (placeholder SVG / composite) or URL of the final file. Empty for audio without a placeholder. */
  url: string;
  status: AssetStatus;
  kind: AssetKind;
  /** True when the id is registered in the manifest. */
  registered: boolean;
  width?: number;
  height?: number;
  frames?: number;
  anchor?: readonly [number, number];
  /** Path under public/assets/ where the final file goes (registered ids only). */
  path?: string;
  /** Placeholder generator id used (or that would be used). */
  generator?: string;
  /** CSS filter to apply when showing a final file (season/time grading). */
  filter?: string;
}
