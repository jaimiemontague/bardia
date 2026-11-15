/**
 * The asset library (design §27.3–27.4, §28.5): every image, music track, sound and voice line is
 * referenced by its asset-manifest id; this library resolves an id to the owner's final file when it
 * exists under public/assets/ and to a deterministic procedural placeholder otherwise.
 *
 *   resolveAsset(id, params?, opts?)      → ResolvedAsset { url, status: final|composite|placeholder|missing, … }
 *   resolveAssetAsync(id, params?, opts?) → waits for composites / audio placeholders
 *   useAsset(id, params?)                 → React hook
 *   <AssetImage id params altKey />       → <img> (or one frame of a sprite strip)
 *   <GlyphIcon glyph="silver" />          → inline currentColor icon from the placeholder set
 *   registerGenerator(gen)                → add a generator (the audio system registers its synths)
 *
 * See ASSET_DROP_IN.md for the owner's workflow and every generator's parameters.
 */
export type { AssetKind, AssetStatus, AudioGenerator, GeneratorParamDoc, GeneratorParams, ImageGenerator, ParamValue, PlaceholderGenerator, RenderContext, ResolvedAsset, WatermarkMode } from './types';
export { BUILTIN_GENERATORS, registerBuiltinGenerators } from './generators/index';
export { checkRecipe, generatorIds, getAudioGenerator, getGenerator, getImageGenerator, registerGenerator } from './generators/registry';
export {
  assetCacheSize,
  clearAssetCache,
  fetchAsDataUrl,
  finalAssetUrl,
  loadAssetImage,
  paramsKey,
  placeholderSvg,
  placeholderUrl,
  resolveAsset,
  resolveAssetAsync,
  type ResolveOptions,
} from './resolver/resolve';
export { resolvePlaceholderUrl } from './resolver/index';
export { assetsBaseUrl, finalFileUrl, finalIndexStatus, findFinalFile, getFinalIndex, loadFinalIndex, parseFinalIndex, setFinalIndex, type FinalFileInfo, type FinalIndex } from './resolver/finalIndex';
export { manifest as assetManifestView, manifestEntry, manifestIssues } from './resolver/manifest';
export { assetsVersion, getAssetSettings, setAssetSettings, setPlaceholderWatermark, subscribeAssets, type AssetSettings } from './resolver/store';
export { AssetImage, GlyphIcon, ensureFinalIndex, useAsset, useAssetSettings, useAssetsVersion, type AssetImageProps, type GlyphIconProps } from './react';
export { iconSvg, iconIds, ICON_STYLES, type IconStyle } from './generators/icon';
export { GLYPH_ALIASES, GLYPH_IDS, glyphFor, type IconCategory } from './generators/iconGlyphs';
export { RELIC_KEYS, relicSvg, type RelicKey } from './generators/relic';
export { portraitSvg, decidePortraitLook, portraitLayerCatalog, portraitLayerPlan, portraitParamsFrom, ageStage, PORTRAIT_SIZE, type PortraitParams, type PortraitLook } from './generators/portrait';
export { portraitParamsForCharacter } from './portraitSpec';
export { panoramaSvg, PANORAMA_SIZE, TERRAINS } from './generators/panorama';
export { interiorSvg, INTERIOR_KINDS, INTERIOR_OF_BUILDING } from './generators/interior';
export { vignetteSvg, VIGNETTE_SCENES } from './generators/vignette';
export { unitSpriteSvg, shipSpriteSvg, UNIT_KIND_OF, TEAM_COLOURS } from './generators/sprites';
export { cardSvg, terrainTileSvg, BIOMES } from './generators/misc';
export { gradingFilter } from './svg/palette';
export { svgToDataUrl } from './svg/svg';
