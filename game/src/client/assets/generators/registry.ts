/**
 * The placeholder-generator registry: manifest `placeholder.generator` id → generator. The image
 * generators of this library register themselves in `generators/index.ts`; other client systems
 * (the audio manager's synthesised music/SFX/voice stand-ins) call `registerGenerator` at boot.
 */
import type { AudioGenerator, GeneratorParams, ImageGenerator, PlaceholderGenerator } from '../types';

const REGISTRY: Record<string, PlaceholderGenerator> = {};
let version = 0;

/**
 * Registers a generator. Registering an id twice throws unless `replace` is set (hot reload, tests,
 * or a deliberate override such as a richer audio placeholder).
 */
export function registerGenerator(gen: PlaceholderGenerator, opts: { replace?: boolean } = {}): void {
  if (!/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)*$/.test(gen.id)) throw new Error(`generator id '${gen.id}' must be camelCase (dotted namespaces allowed, e.g. audio.sfx)`);
  if (Object.hasOwn(REGISTRY, gen.id) && REGISTRY[gen.id] !== gen && !opts.replace) {
    throw new Error(`placeholder generator '${gen.id}' is already registered`);
  }
  REGISTRY[gen.id] = gen;
  version++;
}

/** The generator with this id, if registered. */
export function getGenerator(id: string): PlaceholderGenerator | undefined {
  return Object.hasOwn(REGISTRY, id) ? REGISTRY[id] : undefined;
}

/** The image generator with this id, if registered. */
export function getImageGenerator(id: string): ImageGenerator | undefined {
  const g = getGenerator(id);
  return g && g.kind === 'image' ? g : undefined;
}

/** The audio generator with this id, if registered. */
export function getAudioGenerator(id: string): AudioGenerator | undefined {
  const g = getGenerator(id);
  return g && g.kind === 'audio' ? g : undefined;
}

/** Registered generator ids, sorted. */
export function generatorIds(): string[] {
  return Object.keys(REGISTRY).sort();
}

/** Bumped on every registration (lets caches notice a late-registered generator). */
export function registryVersion(): number {
  return version;
}

/**
 * Checks a placeholder recipe against the generator's parameter docs: unknown generator, unknown
 * parameter names and enum values outside the documented set. Returns human-readable issues.
 */
export function checkRecipe(generator: string, params: GeneratorParams | undefined, kind: 'image' | 'audio'): string[] {
  const gen = getGenerator(generator);
  if (!gen) return kind === 'image' ? [`unknown placeholder generator '${generator}'`] : [];
  if (gen.kind !== kind) return [`generator '${generator}' makes ${gen.kind}, not ${kind}`];
  const docs = gen.params;
  if (!docs || !params) return [];
  const issues: string[] = [];
  for (const [name, value] of Object.entries(params)) {
    const doc = docs.find((d) => d.name === name || (d.name.endsWith('*') && name.startsWith(d.name.slice(0, -1))));
    if (!doc) {
      issues.push(`'${generator}' has no parameter '${name}'`);
      continue;
    }
    if (doc.type === 'enum' && doc.values && typeof value === 'string' && !doc.values.includes(value)) {
      issues.push(`'${generator}.${name}' = '${value}' is not one of ${doc.values.join(', ')}`);
    }
    if (doc.type === 'number' && typeof value !== 'number' && !(typeof value === 'string' && Number.isFinite(Number(value)))) {
      issues.push(`'${generator}.${name}' should be a number`);
    }
  }
  return issues;
}
