/**
 * Architecture boundary test (design §29.2, ARCHITECTURE.md §1/§4/§8). Fails if simulation code
 * (src/sim, excluding *.test.ts):
 *   - imports the client, a package outside the allow-list (zod, immer, fflate), or — from a module
 *     folder — another module's RUNTIME code (only `import type` may cross module folders);
 *   - (kernel) imports any module folder, the registry, the session or the test helpers;
 *   - uses wall-clock time or Date at all, timers, unseeded randomness, browser/Node globals, or
 *     engine-dependent transcendental Math functions outside core/dmath.ts;
 *   - (module folders) constructs Map/Set/WeakMap/WeakSet (they cannot live in JSON state);
 * or if the content layer imports anything but zod and relative paths, tools import the client, or
 * a file with `declare module …` is a script instead of a module (the augmentation would silently
 * shadow the kernel file instead of extending it).
 *
 * Comments and string literals are stripped before token scans, so prose is allowed.
 * BARDIA_BOUNDARY_SCOPE=<folder> limits the src/sim scan to one folder (used by verify:module).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(SRC, '..');
const SCOPE = process.env.BARDIA_BOUNDARY_SCOPE;

function walk(dir: string, includeTests = false): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, includeTests));
    else if (/\.tsx?$/.test(name) && (includeTests || !/\.test\.tsx?$/.test(name))) out.push(p);
  }
  return out;
}

const REGEX_PRECEDERS = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);

/**
 * Removes comments (and, unless keepStrings, the contents of string/template literals), skipping
 * over regex literals. A small lexer, good enough for a lint-style scan.
 */
export function stripCode(code: string, keepStrings: boolean): string {
  let out = '';
  let i = 0;
  const n = code.length;
  let prev = ''; // previous significant character
  while (i < n) {
    const c = code[i] as string;
    const d = code[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      out += ' ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && code[j] !== c) j += code[j] === '\\' ? 2 : 1;
      out += keepStrings ? code.slice(i, j + 1) : c + c;
      i = j + 1;
      prev = c;
      continue;
    }
    if (c === '/' && REGEX_PRECEDERS.has(prev)) {
      let j = i + 1;
      let inClass = false;
      while (j < n && code[j] !== '\n') {
        const ch = code[j];
        if (ch === '\\') j += 2;
        else {
          if (ch === '[') inClass = true;
          else if (ch === ']') inClass = false;
          else if (ch === '/' && !inClass) break;
          j++;
        }
      }
      out += '/r/';
      i = j + 1;
      prev = '/';
      continue;
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

interface ImportRef {
  specifier: string;
  typeOnly: boolean;
}

/** Static, side-effect, re-export and dynamic imports of a (comment-stripped) source. */
export function importsOf(code: string): ImportRef[] {
  const out: ImportRef[] = [];
  const stat = /(?:^|[;}\n])\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(stat)) {
    const typeKeyword = m[2] !== undefined;
    const clause = (m[3] ?? '').trim();
    const braces = /^\{([\s\S]*)\}$/.exec(clause);
    const inlineAllTypes =
      braces !== null &&
      (braces[1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .every((s) => s.startsWith('type '));
    out.push({ specifier: m[4] as string, typeOnly: typeKeyword || inlineAllTypes });
  }
  for (const m of code.matchAll(/(?:^|[;}\n])\s*import\s*['"]([^'"]+)['"]/g)) out.push({ specifier: m[1] as string, typeOnly: false });
  for (const m of code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push({ specifier: m[1] as string, typeOnly: false });
  return out;
}

/** Resolves a specifier to an absolute path (relative or @sim/@content/@client alias), else undefined. */
function resolveSpecifier(file: string, specifier: string): string | undefined {
  if (specifier.startsWith('.')) return resolve(dirname(file), specifier);
  const alias = /^@(sim|content|client)(?:\/(.*))?$/.exec(specifier);
  if (alias) return join(SRC, alias[1] as string, alias[2] ?? '');
  return undefined;
}

const MODULE_ROOTS = [join(SRC, 'sim', 'modules'), join(SRC, 'sim')];
const SUB_SIMS = ['battle', 'duel', 'seabattle'];

/** The module folder id a path belongs to ('economy', 'battle', …) or undefined. */
export function moduleOf(path: string): string | undefined {
  const rel = relative(MODULE_ROOTS[0] as string, path).replaceAll('\\', '/');
  if (!rel.startsWith('..') && rel.length > 0) return rel.split('/')[0];
  const relSim = relative(MODULE_ROOTS[1] as string, path).replaceAll('\\', '/');
  const first = relSim.split('/')[0] as string;
  return !relSim.startsWith('..') && SUB_SIMS.includes(first) ? first : undefined;
}

const SIM_PACKAGES = ['zod', 'immer', 'fflate'];

const FORBIDDEN_TOKENS: [RegExp, string][] = [
  [/\bMath\.random\b/, 'Math.random'],
  [/\bDate\b/, 'Date (no wall-clock or calendar objects; game time is state.time.hour)'],
  [/\bsetTimeout\b/, 'setTimeout'],
  [/\bsetInterval\b/, 'setInterval'],
  [/\bsetImmediate\b/, 'setImmediate'],
  [/\bqueueMicrotask\b/, 'queueMicrotask'],
  [/\brequestAnimationFrame\b/, 'requestAnimationFrame'],
  [/\bwindow\./, 'window.'],
  [/\bdocument\./, 'document.'],
  [/\bperformance\./, 'performance.'],
  [/\bglobalThis\b/, 'globalThis'],
  [/(?<![\w$.])process\./, 'process.'],
  [/(?<![\w$.])crypto\b/, 'crypto'],
  [/\bfetch\s*\(/, 'fetch('],
  [/\b(?:localStorage|sessionStorage|indexedDB)\b/, 'browser storage'],
  [/\bnavigator\./, 'navigator.'],
];

/** Engine-dependent Math functions: use core/dmath.ts instead (allowed only inside dmath.ts). */
const NON_DETERMINISTIC_MATH: [RegExp, string] = [
  /\bMath\.(?:exp|expm1|log|log2|log10|log1p|pow|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|hypot|cbrt)\b/,
  'an engine-dependent Math function (use core/dmath.ts)',
];

const MODULE_COLLECTIONS: [RegExp, string] = [/\bnew\s+(?:Map|Set|WeakMap|WeakSet)\b/, 'new Map/Set (state must be plain JSON; use records/arrays)'];

const KERNEL_FILES_FORBIDDEN_TO_CORE = ['modules.ts', 'session.ts', 'game.ts', 'testing.ts', 'index.ts'].map((f) => join(SRC, 'sim', f));

const CLIENT_IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)['"](?:@client(?:\/[^'"]*)?|(?:\.\.?\/)+(?:[^'"]*\/)?client(?:\/[^'"]*)?)['"]/;
const SIM_IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)['"](?:@sim(?:\/[^'"]*)?|(?:\.\.?\/)+(?:[^'"]*\/)?sim(?:\/[^'"]*)?)['"]/;

function rel(file: string): string {
  return relative(SRC, file).replaceAll('\\', '/');
}

/** All violations for one src/sim file. Exported shape kept small for the scanner self-test. */
function simViolations(file: string, source: string): string[] {
  const out: string[] = [];
  const name = rel(file);
  const noComments = stripCode(source, true);
  const code = stripCode(source, false);
  if (CLIENT_IMPORT.test(noComments)) out.push(`${name}: imports client code`);
  for (const [re, label] of FORBIDDEN_TOKENS) if (re.test(code)) out.push(`${name}: uses ${label}`);
  const isDmath = file === join(SRC, 'sim', 'core', 'dmath.ts');
  if (!isDmath && NON_DETERMINISTIC_MATH[0].test(code)) out.push(`${name}: uses ${NON_DETERMINISTIC_MATH[1]}`);
  const ownModule = moduleOf(file);
  if (ownModule !== undefined && !SUB_SIMS.includes(ownModule) && MODULE_COLLECTIONS[0].test(code)) out.push(`${name}: uses ${MODULE_COLLECTIONS[1]}`);
  const inCore = !relative(join(SRC, 'sim', 'core'), file).startsWith('..');
  for (const imp of importsOf(noComments)) {
    const target = resolveSpecifier(file, imp.specifier);
    if (target === undefined) {
      if (!SIM_PACKAGES.includes(imp.specifier)) out.push(`${name}: imports '${imp.specifier}' (sim may import only ${SIM_PACKAGES.join(', ')}, @sim/*, @content/* and relative paths)`);
      continue;
    }
    const targetModule = moduleOf(target);
    if (inCore && (targetModule !== undefined || KERNEL_FILES_FORBIDDEN_TO_CORE.some((f) => target === f || target === f.replace(/\.ts$/, '')))) {
      out.push(`${name}: the kernel imports '${imp.specifier}' (core must not depend on modules, the registry, the session or test helpers)`);
    }
    if (ownModule !== undefined && targetModule !== undefined && targetModule !== ownModule && !imp.typeOnly) {
      out.push(`${name}: imports runtime code from module '${targetModule}' ('${imp.specifier}'); only \`import type\` may cross module folders`);
    }
  }
  return out;
}

/** A file containing `declare module '…'` must itself be a module (top-level import/export). */
function augmentationViolation(file: string, source: string): string | undefined {
  const code = stripCode(source, true);
  if (!/\bdeclare\s+module\s+['"]/.test(code)) return undefined;
  if (/(?:^|\n)\s*(?:import|export)\b/.test(code)) return undefined;
  return `${relative(ROOT, file).replaceAll('\\', '/')}: contains \`declare module\` but has no top-level import/export, so it shadows the kernel module instead of augmenting it (add \`export {};\`)`;
}

describe('architecture boundaries', () => {
  const allSimFiles = walk(join(SRC, 'sim'));
  const simFiles = SCOPE ? allSimFiles.filter((f) => !relative(resolve(ROOT, SCOPE), f).startsWith('..')) : allSimFiles;
  const contentFiles = walk(join(SRC, 'content'));
  const toolFiles = walk(join(ROOT, 'tools'));

  it('finds the sources to scan', () => {
    if (SCOPE) expect(simFiles.length).toBeGreaterThan(0);
    else {
      expect(simFiles.length).toBeGreaterThan(20);
      expect(contentFiles.length).toBeGreaterThan(3);
    }
  });

  it('src/sim: imports, clocks, timers, randomness, globals, dmath and module isolation', () => {
    const violations: string[] = [];
    for (const file of simFiles) violations.push(...simViolations(file, readFileSync(file, 'utf8')));
    expect(violations).toEqual([]);
  });

  it.skipIf(SCOPE !== undefined)('src/content imports only zod and relative paths', () => {
    const violations: string[] = [];
    for (const file of contentFiles) {
      const code = stripCode(readFileSync(file, 'utf8'), true);
      if (CLIENT_IMPORT.test(code)) violations.push(`${rel(file)}: imports client code`);
      if (SIM_IMPORT.test(code)) violations.push(`${rel(file)}: imports sim code`);
      for (const imp of importsOf(code)) {
        if (!imp.specifier.startsWith('.') && imp.specifier !== 'zod') violations.push(`${rel(file)}: imports '${imp.specifier}'`);
      }
    }
    expect(violations).toEqual([]);
  });

  it.skipIf(SCOPE !== undefined)('tools/ never import the client', () => {
    const violations = toolFiles.filter((f) => CLIENT_IMPORT.test(stripCode(readFileSync(f, 'utf8'), true))).map(rel);
    expect(violations).toEqual([]);
  });

  it('files that augment kernel types are modules, not scripts', () => {
    const files = SCOPE
      ? walk(resolve(ROOT, SCOPE), true)
      : [...walk(join(SRC, 'sim'), true), ...walk(join(SRC, 'content'), true), ...walk(join(ROOT, 'tools'), true)];
    const violations = files.map((f) => augmentationViolation(f, readFileSync(f, 'utf8'))).filter((v): v is string => v !== undefined);
    expect(violations).toEqual([]);
  });

  it('the scanner itself catches violations', () => {
    expect(CLIENT_IMPORT.test(`import { x } from '@client/app';`)).toBe(true);
    expect(CLIENT_IMPORT.test(`import { x } from '../../client/ui';`)).toBe(true);
    expect(CLIENT_IMPORT.test(`import { x } from './clientele';`)).toBe(false);
    // Comments and strings are ignored; regex literals do not confuse the lexer.
    expect(stripCode(`const a = 'Date'; // Date.now()\nconst r = /'"\\/\\//g; /* Math.random */ const b = 1;`, false)).not.toMatch(/Date|random/);
    const sim = (path: string, code: string) => simViolations(join(SRC, ...path.split('/')), code);
    const econ = 'sim/modules/economy/index.ts';
    expect(sim(econ, `const t = Date.now();`)).toHaveLength(1);
    expect(sim(econ, `const d = Date();`)).toHaveLength(1);
    expect(sim(econ, `const u = Date.UTC(2020, 1);`)).toHaveLength(1);
    expect(sim(econ, `const formatDate = 1; const nextDate = 2;`)).toEqual([]);
    expect(sim(econ, `const x = Math.exp(1) + Math.pow(2, 0.5) + Math.sin(1);`)).toHaveLength(1);
    expect(sim('sim/core/dmath.ts', `const x = Math.sqrt(2);`)).toEqual([]);
    expect(sim(econ, `const m = new Map(); const s = new Set();`)).toHaveLength(1);
    expect(sim('sim/battle/index.ts', `const m = new Map();`)).toEqual([]);
    expect(sim(econ, `const g = globalThis; const p = process.env; const c = crypto.randomUUID();`)).toHaveLength(3);
    expect(sim(econ, `const p = this.process.x; const k = foo.crypto;`)).toEqual([]);
    expect(sim(econ, `import { create } from 'zustand';`)).toHaveLength(1);
    expect(sim(econ, `import { produce } from 'immer';\nimport { z } from 'zod';\nimport type { X } from '@sim/core/state';`)).toEqual([]);
    expect(sim(econ, `import { module as w } from '../world/index';`)).toHaveLength(1);
    expect(sim(econ, `import type { WorldState } from '../world/types';`)).toEqual([]);
    expect(sim(econ, `import { type WorldState, type Lane } from '@sim/modules/world/types';`)).toEqual([]);
    expect(sim(econ, `import { autoResolve } from '@sim/battle/autoresolve';`)).toHaveLength(1);
    expect(sim(econ, `export { helper } from '../world/helpers';`)).toHaveLength(1);
    expect(sim(econ, `import { helper } from './helpers';`)).toEqual([]);
    expect(sim('sim/core/env.ts', `import { MODULES } from '../modules';`)).toHaveLength(1);
    expect(sim('sim/core/env.ts', `import type { X } from '../modules/economy/types';`)).toHaveLength(1);
    expect(augmentationViolation('x.ts', `declare module '@sim/core/commands' { interface CommandMap { a: { n: number } } }`)).toBeDefined();
    expect(augmentationViolation('x.ts', `export {};\ndeclare module '@sim/core/commands' { interface CommandMap { a: { n: number } } }`)).toBeUndefined();
    expect(augmentationViolation('x.ts', `import type { A } from './a';\ndeclare module '@sim/core/state' {}`)).toBeUndefined();
  });
});
