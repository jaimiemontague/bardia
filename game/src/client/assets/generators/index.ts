/**
 * Built-in placeholder generators. Importing this module registers them all (idempotent); the
 * resolver imports it, so any code that resolves assets has the full set available.
 */
import type { ImageGenerator } from '../types';
import { cardGenerator, terrainTileGenerator } from './misc';
import { iconGenerator } from './icon';
import { interiorGenerator } from './interior';
import { panoramaGenerator } from './panorama';
import { portraitGenerator, portraitLayerGenerator, silhouetteGenerator } from './portrait';
import { getGenerator, registerGenerator } from './registry';
import { relicGenerator } from './relic';
import { shipSpriteGenerator, unitSpriteGenerator } from './sprites';
import { menuBackdropGenerator, vignetteGenerator } from './vignette';

/** Every built-in image generator, in gallery order. */
export const BUILTIN_GENERATORS: readonly ImageGenerator[] = [
  portraitGenerator,
  portraitLayerGenerator,
  silhouetteGenerator,
  panoramaGenerator,
  interiorGenerator,
  vignetteGenerator,
  menuBackdropGenerator,
  iconGenerator,
  relicGenerator,
  unitSpriteGenerator,
  shipSpriteGenerator,
  terrainTileGenerator,
  cardGenerator,
];

/** Registers the built-ins (safe to call repeatedly). */
export function registerBuiltinGenerators(): void {
  for (const gen of BUILTIN_GENERATORS) {
    if (getGenerator(gen.id) !== gen) registerGenerator(gen, { replace: true });
  }
}

registerBuiltinGenerators();

export { getGenerator, getImageGenerator, getAudioGenerator, registerGenerator, generatorIds, checkRecipe } from './registry';
