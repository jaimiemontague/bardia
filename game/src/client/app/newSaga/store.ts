/**
 * Wizard state (zustand) shared by the New Saga screen and any external step component (e.g. a
 * map-based jarldom picker registered for the route 'jarldomPicker', which writes
 * `startProvinceId` with `useNewSaga.getState().update({ startProvinceId })`).
 */
import { create } from 'zustand';
import type { Content } from '@content/index';
import { Rng } from '@sim/core/rng';
import { initialChoices, randomizeStep, recommendStep, reconcile, WIZARD_STEPS, type NewSagaChoices, type WizardStep } from './model';
import type { JarldomOption } from './provinces';

export interface NewSagaStore {
  choices: NewSagaChoices | null;
  step: WizardStep;
  /** Steps the player has opened (the step rail marks them). */
  visited: WizardStep[];
  /** Starts a fresh wizard (random identity, recommended mechanics). */
  begin(content: Content, diceSeed?: string): void;
  /** Merges a patch and keeps dependent choices valid. */
  update(patch: Partial<NewSagaChoices>, content?: Content): void;
  goTo(step: WizardStep): void;
  next(): void;
  back(): void;
  random(content: Content, jarldoms: readonly JarldomOption[]): void;
  recommend(content: Content, jarldoms: readonly JarldomOption[]): void;
  reset(): void;
}

let dice = new Rng('wizard');

/** The wizard's dice (client-side randomness, seeded per wizard). */
export function wizardDice(): Rng {
  return dice;
}

function freshSeed(): string {
  // Client-side only: a new wizard gets new dice. Tests pass an explicit seed.
  return `wizard-${Math.floor(Math.random() * 0x7fffffff).toString(36)}`;
}

export const useNewSaga = create<NewSagaStore>()((set, get) => ({
  choices: null,
  step: 'identity',
  visited: ['identity'],

  begin(content, diceSeed) {
    dice = new Rng(diceSeed ?? freshSeed());
    set({ choices: initialChoices(content, dice), step: 'identity', visited: ['identity'] });
  },

  update(patch, content) {
    const c = get().choices;
    if (!c) return;
    const merged = { ...c, ...patch };
    set({ choices: content ? reconcile(merged, content) : merged });
  },

  goTo(step) {
    set((s) => ({ step, visited: s.visited.includes(step) ? s.visited : [...s.visited, step] }));
  },

  next() {
    const i = WIZARD_STEPS.indexOf(get().step);
    const step = WIZARD_STEPS[Math.min(WIZARD_STEPS.length - 1, i + 1)];
    if (step) get().goTo(step);
  },

  back() {
    const i = WIZARD_STEPS.indexOf(get().step);
    const step = WIZARD_STEPS[Math.max(0, i - 1)];
    if (step) get().goTo(step);
  },

  random(content, jarldoms) {
    const { choices, step } = get();
    if (choices) set({ choices: randomizeStep(step, choices, content, dice, jarldoms) });
  },

  recommend(content, jarldoms) {
    const { choices, step } = get();
    if (choices) set({ choices: recommendStep(step, choices, content, jarldoms) });
  },

  reset() {
    set({ choices: null, step: 'identity', visited: ['identity'] });
  },
}));
