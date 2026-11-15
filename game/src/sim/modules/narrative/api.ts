/**
 * Pure helpers for the client, tools and the integrator's headless runner. None of them changes state.
 */
import type { CommandOf } from '@sim/core/commands';
import type { SimEnv } from '@sim/core/module';
import type { GameState, Hour } from '@sim/core/state';
import { viewChoices } from './engine';
import { buildLibrary, bundledContent, bundledLibrary, type NarrativeContent, type NarrativeLibrary } from './library';
import { sortedInstances } from './slice';
import type { StoryletChoiceView, StoryletInstance } from './types';

/** What a screen needs to show one active storylet (current decision or inbox item). */
export interface StoryletView {
  instance: StoryletInstance;
  textKey: string;
  titleKey?: string;
  illustration?: string;
  /** Availability recomputed against the current state. */
  choices: StoryletChoiceView[];
  defaultChoice?: number;
  canDefer: boolean;
  expiresHour?: Hour;
}

/** Active storylet instances, oldest first. */
export function activeStorylets(state: GameState): StoryletInstance[] {
  return sortedInstances(state.storylets.instances ?? {});
}

/** Storylets waiting in the Affairs of State inbox, oldest first. */
export function storyletInbox(state: GameState): StoryletInstance[] {
  return activeStorylets(state).filter((i) => i.status === 'waiting');
}

/** A view of an active storylet, or undefined when the id is unknown (or its content is gone). */
export function storyletView(state: GameState, env: SimEnv, instanceId: string, lib: NarrativeLibrary = bundledLibrary(env)): StoryletView | undefined {
  const instances = state.storylets.instances ?? {};
  const inst = Object.hasOwn(instances, instanceId) ? instances[instanceId] : undefined;
  if (!inst) return undefined;
  const c = lib.storylets.byId[inst.storyletId];
  if (!c) return undefined;
  const view: StoryletView = {
    instance: inst,
    textKey: c.def.textKey,
    choices: viewChoices({ state, env }, lib, inst),
    canDefer: c.def.expiresInDays !== undefined && inst.status === 'pending',
  };
  if (c.def.titleKey !== undefined) view.titleKey = c.def.titleKey;
  if (c.def.illustration !== undefined) view.illustration = c.def.illustration;
  if (c.def.defaultChoice !== undefined) view.defaultChoice = c.def.defaultChoice;
  if (inst.expiresHour !== undefined) view.expiresHour = inst.expiresHour;
  return view;
}

/**
 * The command a headless runner (npm run sim, bots, e2e) sends for a pending storylet: the default choice
 * when there is one, else the first available choice. Undefined when no storylet decision is pending.
 */
export function headlessStoryletCommand(state: GameState): CommandOf<'storyletChoice'> | undefined {
  const p = state.pending;
  if (!p || p.kind !== 'storylet' || p.payload.instanceId === undefined) return undefined;
  if (p.payload.defaultChoice !== undefined) return { type: 'storyletChoice', instanceId: p.payload.instanceId, choice: 'default' };
  const first = (p.payload.choices ?? []).find((c) => c.available);
  return { type: 'storyletChoice', instanceId: p.payload.instanceId, choice: first?.index ?? 0 };
}

/** Every content problem of the narrative packs against an env (empty = valid). */
export function validateNarrativeContent(env: SimEnv, content: NarrativeContent = bundledContent()): string[] {
  return [...buildLibrary(env, content).issues];
}
