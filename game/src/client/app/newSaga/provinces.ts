/**
 * Eligible starting jarldoms for the wizard's step 8 (§5.1: 5 per homeland kingdom; royal seats are
 * locked). Read from the world geography pack when it exists; the pack is discovered with
 * `import.meta.glob`, so the wizard builds and works before the cartographer's files land (the step
 * then lets the world module choose). A map-based picker can replace the list later by registering
 * a screen for the route 'jarldomPicker' and writing `startProvinceId` into the wizard store.
 */

/** One starting province card. */
export interface JarldomOption {
  provinceId: string;
  name: string;
  culture: string;
  kingdomId: string;
  kingdomName: string;
  capitalName: string | null;
  capitalTier: string | null;
  tags: string[];
  /** Expected difficulty, 1 (gentle) – 3 (hard). */
  difficultyPips: 1 | 2 | 3;
}

/** Eligible provinces per homeland kingdom (§5.1). */
export const JARLDOMS_PER_KINGDOM = 5;

interface LooseKingdom {
  id?: unknown;
  name?: unknown;
  culture?: unknown;
  homeland?: unknown;
  seatProvinceId?: unknown;
}
interface LooseProvince {
  id?: unknown;
  name?: unknown;
  kingdomId?: unknown;
  homeland?: unknown;
  capital?: unknown;
  colonized?: unknown;
  tags?: unknown;
}
interface LooseSettlement {
  name?: unknown;
  provinceId?: unknown;
  tier?: unknown;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Tags that make a start harder (exposed coasts, contested straits, frontiers). */
const HARD_TAGS = ['straits', 'border', 'frontier', 'contested', 'exposed', 'raided', 'iceInIcebreak', 'gatewayEast'];
/** Tags that make a start gentler (rich or sheltered land). */
const EASY_TAGS = ['iron', 'ironBogs', 'furs', 'fertile', 'sheltered', 'emporium', 'fishing'];

/** Expected-difficulty pips from province tags and its capital's tier. */
export function difficultyPips(tags: readonly string[], capitalTier: string | null): 1 | 2 | 3 {
  let score = 2;
  if (tags.some((t) => HARD_TAGS.includes(t))) score += 1;
  if (tags.some((t) => EASY_TAGS.includes(t))) score -= 1;
  if (capitalTier === 'village' || capitalTier === 'hamlet') score += 1;
  if (capitalTier === 'city') score -= 1;
  return Math.max(1, Math.min(3, score)) as 1 | 2 | 3;
}

/**
 * Builds the jarldom list from raw geography JSON (`base` with kingdoms, `packs` with provinces and
 * settlements). Pure; tolerant of partial data.
 */
export function jarldomsFromGeography(base: unknown, packs: readonly unknown[]): JarldomOption[] {
  const kingdoms = arr((base as { kingdoms?: unknown } | null)?.kingdoms) as LooseKingdom[];
  const provinces: LooseProvince[] = [];
  const settlements: LooseSettlement[] = [];
  for (const p of packs) {
    if (p === null || typeof p !== 'object') continue;
    provinces.push(...(arr((p as { provinces?: unknown }).provinces) as LooseProvince[]));
    settlements.push(...(arr((p as { settlements?: unknown }).settlements) as LooseSettlement[]));
  }
  const out: JarldomOption[] = [];
  for (const k of kingdoms) {
    const kid = str(k.id);
    const culture = str(k.culture);
    if (!kid || !culture || k.homeland !== true) continue;
    const seat = str(k.seatProvinceId);
    const eligible = provinces.filter((p) => str(p.kingdomId) === kid && str(p.id) !== seat && p.colonized !== false && str(p.capital) !== null);
    for (const p of eligible.slice(0, JARLDOMS_PER_KINGDOM)) {
      const pid = str(p.id) as string;
      const capitalName = str(p.capital);
      const capital = settlements.find((s) => str(s.provinceId) === pid && str(s.name) === capitalName);
      const capitalTier = capital ? str(capital.tier) : null;
      const tags = arr(p.tags).filter((t): t is string => typeof t === 'string');
      out.push({
        provinceId: pid,
        name: str(p.name) ?? pid,
        culture,
        kingdomId: kid,
        kingdomName: str(k.name) ?? kid,
        capitalName,
        capitalTier,
        tags,
        difficultyPips: difficultyPips(tags, capitalTier),
      });
    }
  }
  return out;
}

let cached: JarldomOption[] | undefined;

/** The bundled jarldom options ([] until the world geography pack exists). */
export function bundledJarldoms(): JarldomOption[] {
  if (cached) return cached;
  try {
    const files = import.meta.glob('/src/content/data/world/**/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
    const base = Object.entries(files).find(([path]) => path.endsWith('/world/base.json'))?.[1];
    const packs = Object.entries(files)
      .filter(([path]) => path.includes('/world/regions/'))
      .map(([, v]) => v);
    cached = base ? jarldomsFromGeography(base, packs) : [];
  } catch {
    cached = [];
  }
  return cached;
}
