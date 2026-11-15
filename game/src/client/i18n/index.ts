/**
 * Client i18n: ICU MessageFormat (intl-messageformat) over the per-area locale files
 * (src/content/locales/en/<area>.json, merged by `englishStrings()`).
 *
 *   t('ui.topbar.silver', { amount: 4210 })     → "4,210"
 *   useT()                                       → the same function, re-rendering on locale change
 *   tOr('core.trait.brave.name', def.name)       → a locale string when one exists, else the fallback
 *
 * Missing keys never crash: `t` returns the key itself and, in development, warns once per key so
 * the gap is visible in the console (and in `missingKeysSeen()` for tests/dev tools).
 */
import IntlMessageFormat from 'intl-messageformat';
import { englishStrings } from '@content/locales/index';
import type { TextVars } from '@sim/core/state';
import { useSyncExternalStore } from 'react';

/** Supported UI languages (only English ships in v1; the table registry is ready for more). */
export type LanguageId = 'en';

/** Values accepted by `t` (ICU arguments). */
export type MessageVars = Readonly<Record<string, string | number | boolean | null | undefined | Date>>;

type Table = Readonly<Record<string, string>>;

const tables: Record<LanguageId, () => Table> = { en: englishStrings };

let language: LanguageId = 'en';
let version = 0;
const listeners = new Set<() => void>();
const cache = new Map<string, IntlMessageFormat | string>();
const warned = new Set<string>();

/** Whether to print a console warning the first time a key is missing (on in dev builds). */
let warnOnMissing: boolean = isDev();

function isDev(): boolean {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

function localeTag(lang: LanguageId): string {
  return lang === 'en' ? 'en' : lang;
}

/** Enables or disables the dev warning for missing keys (tests turn it off to keep output clean). */
export function setMissingKeyWarnings(on: boolean): void {
  warnOnMissing = on;
}

/** Keys requested by `t` that had no string, in first-seen order. */
export function missingKeysSeen(): string[] {
  return [...warned];
}

/** The active language. */
export function getLanguage(): LanguageId {
  return language;
}

/** Switches the UI language (re-renders every `useT` consumer). */
export function setLanguage(lang: LanguageId): void {
  if (lang === language) return;
  language = lang;
  cache.clear();
  version++;
  for (const l of [...listeners]) l();
}

/** True if the active language has a string for `key`. */
export function hasKey(key: string): boolean {
  return Object.hasOwn(tables[language](), key);
}

function compiled(key: string): IntlMessageFormat | string | undefined {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const table = tables[language]();
  if (!Object.hasOwn(table, key)) return undefined;
  const source = table[key] as string;
  let entry: IntlMessageFormat | string;
  // Plain strings without ICU syntax skip the parser entirely.
  if (!/[{}]/.test(source)) entry = source.replace(/''/g, "'");
  else {
    try {
      entry = new IntlMessageFormat(source, localeTag(language), undefined, { ignoreTag: true });
    } catch {
      entry = source;
    }
  }
  cache.set(key, entry);
  return entry;
}

function reportMissing(key: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  if (warnOnMissing) console.warn(`[i18n] missing locale key '${key}'`);
}

function cleanVars(vars: MessageVars | TextVars | undefined): Record<string, string | number | boolean | Date> {
  const out: Record<string, string | number | boolean | Date> = {};
  if (!vars) return out;
  for (const [k, v] of Object.entries(vars)) {
    if (v === null || v === undefined) out[k] = '';
    else out[k] = v as string | number | boolean | Date;
  }
  return out;
}

/** Formats the message for `key` with ICU `vars`. Missing keys return the key (and warn in dev). */
export function t(key: string, vars?: MessageVars | TextVars): string {
  const entry = compiled(key);
  if (entry === undefined) {
    reportMissing(key);
    return key;
  }
  if (typeof entry === 'string') return entry;
  try {
    const out = entry.format(cleanVars(vars));
    return Array.isArray(out) ? out.join('') : String(out);
  } catch {
    return key;
  }
}

/** A locale string when `key` exists, otherwise `fallback` (used for content names that ship in data). */
export function tOr(key: string, fallback: string, vars?: MessageVars | TextVars): string {
  return hasKey(key) ? t(key, vars) : fallback;
}

/** Formats a number for display in the active locale ("4,210"). */
export function formatNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(localeTag(language), opts).format(n);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook: the `t` function, re-rendering the component when the language changes. */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, () => version, () => version);
  return t;
}
