/**
 * Test fixtures of the narrative module (other modules' tests may import them):
 *
 *   const { env, module } = narrativeTestEnv({ storylets: [storylet({ id: 'x', choices: [choice()] })] });
 *   const world = narrativeWorld({ storylets, tunables: { monthly: { holding: { chance: 1, max: 1 } } } });
 *   const state = resolvePendingStorylets(world.state, world.env);   // auto-pick like a headless runner
 */
import { getLinePools, getVerseBank, type LinePoolContent, type VerseBankContent } from '@content/lines';
import { getContent, type Content } from '@content/index';
import { dispatch } from '@sim/core/dispatch';
import type { SimEnv, SimModule } from '@sim/core/module';
import type { GameState } from '@sim/core/state';
import { testEnv, testWorld, type TestWorld, type TestWorldOptions } from '../../testing';
import { headlessStoryletCommand } from './api';
import { createNarrativeModule, type NarrativeModule } from './index';
import { bundledContent } from './library';
import type { StoryletChoiceSpec, StoryletSpec } from './types';

type NarrativeTunables = Content['tunables']['narrative'];

/** Partial tunables override (one level deep for objects). */
export type TunablesOverride = { [K in keyof NarrativeTunables]?: NarrativeTunables[K] extends Record<string, unknown> ? Partial<NarrativeTunables[K]> : NarrativeTunables[K] };

/** Content with the narrative tunables overridden (everything else as bundled). */
export function contentWith(override: TunablesOverride = {}): Content {
  const base = getContent();
  const n = base.tunables.narrative;
  const merged = { ...n } as Record<string, unknown>;
  for (const [k, v] of Object.entries(override)) {
    const cur = (n as Record<string, unknown>)[k];
    merged[k] = v !== null && typeof v === 'object' && !Array.isArray(v) && cur !== null && typeof cur === 'object' ? { ...(cur as object), ...(v as object) } : v;
  }
  return { ...base, tunables: { ...base.tunables, narrative: merged as NarrativeTunables } };
}

/** A storylet with sensible test defaults (player scope, scheduled trigger, one empty choice). */
export function storylet(partial: Partial<StoryletSpec> & { id: string }): StoryletSpec {
  return {
    scope: 'player',
    trigger: 'scheduled',
    textKey: 'narrative.test.text',
    choices: [choice()],
    ...partial,
  } as StoryletSpec;
}

/** A choice with sensible test defaults (no effects). */
export function choice(partial: Partial<StoryletChoiceSpec> = {}): StoryletChoiceSpec {
  return { labelKey: 'narrative.test.label', effects: [], ...partial };
}

export interface NarrativeTestOptions {
  storylets?: readonly StoryletSpec[];
  pools?: readonly LinePoolContent[];
  verse?: VerseBankContent;
  tunables?: TunablesOverride;
  /** Further modules (fakes) to register next to core + narrative. */
  modules?: readonly SimModule[];
}

function moduleFor(opts: NarrativeTestOptions): NarrativeModule {
  if (opts.storylets === undefined && opts.pools === undefined && opts.verse === undefined) return createNarrativeModule();
  return createNarrativeModule({
    content: () => ({
      storylets: opts.storylets ?? bundledContent().storylets,
      pools: opts.pools ?? getLinePools(),
      verse: opts.verse ?? getVerseBank(),
    }),
  });
}

/** An env with core + a narrative module playing the given content. */
export function narrativeTestEnv(opts: NarrativeTestOptions = {}): { env: SimEnv; module: NarrativeModule; content: Content } {
  const module = moduleFor(opts);
  const content = contentWith(opts.tunables);
  return { env: testEnv([module, ...(opts.modules ?? [])], content), module, content };
}

/** A multi-faction test world (testWorld) with a narrative module playing the given content. */
export function narrativeWorld(opts: NarrativeTestOptions & Omit<TestWorldOptions, 'modules' | 'content'> = {}): TestWorld & { module: NarrativeModule } {
  const { storylets, pools, verse, tunables, modules, ...rest } = opts;
  const module = moduleFor({ ...(storylets ? { storylets } : {}), ...(pools ? { pools } : {}), ...(verse ? { verse } : {}) });
  const w = testWorld({ ...rest, modules: [module, ...(modules ?? [])], content: contentWith(tunables) });
  return { ...w, module };
}

/** Resolves pending storylet decisions the way a headless runner would (default, else first available). */
export function resolvePendingStorylets(state: GameState, env: SimEnv, max = 32): GameState {
  let s = state;
  for (let i = 0; i < max; i++) {
    const cmd = headlessStoryletCommand(s);
    if (!cmd) break;
    const r = dispatch(s, cmd, env);
    if (r.error) throw new Error(`storyletChoice failed: ${r.error.code} ${r.error.message}`);
    s = r.state;
  }
  return s;
}
