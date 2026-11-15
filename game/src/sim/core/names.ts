/**
 * Culture name generators (design §32.4). Deterministic: every draw comes from a RandomSource.
 * Pass either a RandomSource (inside kernel operations: `ctx.rng(namesStream(ctx))`) or a plain
 * mutable host (GameState outside an operation), in which case the shared 'names' stream is used.
 */
import type { Naming, NamesData } from '@content/index';
import { hostStream, type RandomSource, type RngHost } from './rng';

/** RNG stream used by name generation on a plain host (and by kernel code in operations). */
export const NAMES_STREAM = 'names';

/** A RandomSource, or a host whose 'names' stream is used. */
export type NameRandom = RandomSource | RngHost;

function toSource(r: NameRandom): RandomSource {
  return typeof (r as RandomSource).pick === 'function' ? (r as RandomSource) : hostStream(r as RngHost, NAMES_STREAM);
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/** Joins two syllables, collapsing a doubled letter at the seam ("Brand" + "dis" → "Brandis"). */
export function joinSyllables(a: string, b: string): string {
  if (b.length === 0) return a;
  if (a.length === 0) return b;
  const seamA = a.charAt(a.length - 1).toLowerCase();
  const seamB = b.charAt(0).toLowerCase();
  if (seamA === seamB && !'aeiouy'.includes(seamA)) return a + b.slice(1);
  return a + b;
}

/** A personal name for the given culture naming table and sex. */
export function generatePersonalName(random: NameRandom, naming: Naming, sex: 'male' | 'female'): string {
  const rng = toSource(random);
  const examples = sex === 'male' ? naming.examples.male : naming.examples.female;
  // One draw decides whether to use a hand-authored example (keeps names varied and natural).
  if (examples.length > 0 && rng.chance(0.15)) return rng.pick(examples);
  const endings = sex === 'male' ? naming.maleEndings : naming.femaleEndings;
  let name = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const start = rng.pick(naming.starts);
    const ending = rng.pick(endings);
    name = capitalize(joinSyllables(start, ending.toLowerCase()));
    // Reject stutters such as "Ulfulf".
    if (ending.length === 0 || !start.toLowerCase().endsWith(ending.toLowerCase())) break;
  }
  return name;
}

/** A place name for the given culture (root + suffix, or prefix + root). */
export function generatePlaceName(random: NameRandom, naming: Naming): string {
  const rng = toSource(random);
  const roots = naming.placeRoots;
  const usePrefix = naming.placePrefixes.length > 0 && (naming.placeSuffixes.length === 0 || rng.chance(0.5));
  const root = rng.pick(roots);
  if (usePrefix) {
    const prefix = rng.pick(naming.placePrefixes);
    const joined = prefix.endsWith(' ') ? prefix + capitalize(root) : joinSyllables(prefix, root.toLowerCase());
    return capitalize(joined);
  }
  const suffix = rng.pick(naming.placeSuffixes);
  return capitalize(joinSyllables(root, suffix.toLowerCase()));
}

/** A ship name ("Sea-Wolf", "Gray Goose", "Raven-Wing of Brimstad"). */
export function generateShipName(random: NameRandom, names: NamesData, homeName?: string): string {
  const rng = toSource(random);
  const pattern = rng.pick(names.ships.patterns);
  const first = rng.pick(names.ships.firsts);
  let second = rng.pick(names.ships.seconds);
  if (second === first) second = names.ships.seconds[0] === first ? (names.ships.seconds[1] as string) : (names.ships.seconds[0] as string);
  let name = pattern.replace('{first}', first).replace('{second}', second);
  const ofHome = rng.chance(names.ships.ofHomeChance);
  if (homeName && ofHome) name = `${name} of ${homeName}`;
  return name;
}

/** An NPC byname ("the Stout", "Crow-Eye"). */
export function generateByname(random: NameRandom, names: NamesData): string {
  return toSource(random).pick(names.bynames);
}
