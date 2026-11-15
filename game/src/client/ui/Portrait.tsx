/**
 * Portrait slot: renders a character portrait from its recipe (seed, sex, culture, age, rank,
 * traits, explicit layer picks). The procedural painter belongs to the asset library
 * (src/client/assets/generators/portrait.ts); it is discovered at build time so the shell keeps
 * working while that library is being built, falling back to a heraldic monogram.
 */
import { memo, useMemo, type ReactElement } from 'react';
import type { Character, GameState } from '@sim/core/state';
import { ageInYears } from '@sim/core/time';

export interface PortraitRecipe {
  seed: number | string;
  sex?: 'male' | 'female';
  culture?: string;
  age?: number;
  rank?: 'common' | 'warrior' | 'noble' | 'ruler' | 'clergy' | 'seer';
  faith?: string;
  traits?: readonly string[];
  layers?: Readonly<Record<string, number>>;
  wounded?: boolean;
  dead?: boolean;
}

type PortraitPainter = (params: Record<string, unknown>, opts: Record<string, unknown>) => string;

const painterModules = import.meta.glob('../assets/generators/portrait.ts', { eager: true }) as Record<string, Record<string, unknown>>;

function painter(): PortraitPainter | null {
  for (const mod of Object.values(painterModules)) if (typeof mod.portraitSvg === 'function') return mod.portraitSvg as PortraitPainter;
  return null;
}

const cache = new Map<string, string>();
const CACHE_LIMIT = 96;

function toDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const MONOGRAM_FIELDS = ['#6e2a20', '#2f4a6b', '#3d5a2c', '#5b3d6e', '#6b5320', '#2f5e5a'];

/** Heraldic stand-in used when the portrait painter is unavailable. */
export function monogramSvg(seed: string, initial: string): string {
  const h = hash(seed);
  const field = MONOGRAM_FIELDS[h % MONOGRAM_FIELDS.length] ?? '#6e2a20';
  const letter = (initial || '?').slice(0, 1).toUpperCase().replace(/[<>&"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 200"><defs><radialGradient id="v" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="#3a2a1c"/><stop offset="1" stop-color="#120c08"/></radialGradient><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${field}"/><stop offset="1" stop-color="#140d09"/></linearGradient></defs><rect width="160" height="200" fill="url(#v)"/><path d="M30 34h100v58c0 44-26 70-50 82-24-12-50-38-50-82z" fill="url(#s)" stroke="#c9a14f" stroke-width="5"/><text x="80" y="122" font-family="Cinzel, Georgia, serif" font-size="64" font-weight="700" text-anchor="middle" fill="#ead9a8">${letter}</text></svg>`;
}

/** The SVG data URL for a recipe (cached). */
export function portraitUrl(recipe: PortraitRecipe, initial = ''): string {
  const key = JSON.stringify(recipe);
  const hit = cache.get(key);
  if (hit) return hit;
  const paint = painter();
  let svg: string;
  try {
    svg = paint ? paint({ ...recipe }, { width: 256, height: 320, watermark: 'off' }) : monogramSvg(String(recipe.seed), initial);
  } catch {
    svg = monogramSvg(String(recipe.seed), initial);
  }
  const url = toDataUrl(svg);
  if (cache.size >= CACHE_LIMIT) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, url);
  return url;
}

/** Builds a portrait recipe from a simulation character. */
export function recipeForCharacter(c: Character, state: GameState): PortraitRecipe {
  const isRuler = Object.values(state.factions).some((f) => f.rulerId === c.id);
  return {
    seed: c.portrait.seed,
    sex: c.sex,
    culture: c.culture,
    age: ageInYears(c.birthHour, state.time.hour),
    rank: isRuler ? 'ruler' : c.role?.kind === 'lieutenant' ? 'warrior' : 'noble',
    faith: c.faith,
    traits: c.traits,
    ...(c.portrait.layers ? { layers: c.portrait.layers } : {}),
    ...(c.health.wound !== 'none' ? { wounded: true } : {}),
    ...(!c.alive ? { dead: true } : {}),
  };
}

export interface PortraitProps {
  recipe: PortraitRecipe;
  /** Accessible description ("Portrait of Sigrun"). */
  alt: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Initial for the monogram fallback. */
  initial?: string;
  className?: string;
}

/** A framed portrait. */
export const Portrait = memo(function Portrait({ recipe, alt, size = 'md', initial, className }: PortraitProps): ReactElement {
  const url = useMemo(() => portraitUrl(recipe, initial ?? alt.slice(0, 1)), [recipe, initial, alt]);
  return (
    <span className={['portrait', `portrait-${size}`, recipe.dead && 'is-dead', className].filter(Boolean).join(' ')}>
      <img src={url} alt={alt} draggable={false} />
    </span>
  );
});
