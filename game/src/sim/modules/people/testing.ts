/**
 * Test fixtures for the people module (other modules' tests may import these). Everything is built
 * through kernel factories inside one operation, so results are deterministic for a given seed.
 */
import { createCharacter, type CreateCharacterOptions } from '@sim/core/factory';
import type { SimContext, SimEnv, SimModule } from '@sim/core/module';
import type { Character, CharId, GameState } from '@sim/core/state';
import { HOURS_PER_YEAR } from '@sim/core/time';
import { inDraft, testEnv, testState, type TestStateOptions } from '@sim/testing';
import { module as peopleModule } from './index';
import { peopleState, pushUnique } from './util';

/** An env with the people module (plus any extra test modules). */
export function peopleTestEnv(extra: readonly SimModule[] = []): SimEnv {
  return testEnv([peopleModule, ...extra]);
}

/** A new-game state with the people module initialised. */
export function peopleTestState(opts: TestStateOptions = {}): GameState {
  return testState({ ...opts, modules: [peopleModule, ...(opts.modules ?? [])] });
}

/** Options for a test character: kernel options plus an exact age in whole years (birthday at day start). */
export type TestPersonOptions = Partial<CreateCharacterOptions> & { ageYears?: number };

/** Creates a character inside an operation (exact age in years when `ageYears` is given). */
export function makePerson(draft: GameState, ctx: SimContext, opts: TestPersonOptions = {}): Character {
  const { ageYears, ...rest } = opts;
  const birthHour = rest.birthHour ?? (ageYears !== undefined ? draft.time.hour - ageYears * HOURS_PER_YEAR : undefined);
  const c = createCharacter(draft, ctx, {
    culture: 'skarn',
    ...rest,
    ...(birthHour !== undefined ? { birthHour } : {}),
  });
  return c;
}

/** Links a parent and a child (both directions). */
export function linkParent(parent: Character, child: Character): void {
  if (parent.sex === 'female') child.family.motherId = parent.id;
  else child.family.fatherId = parent.id;
  pushUnique(parent.family.childIds, child.id);
}

/** Links two spouses (both directions). */
export function linkSpouses(a: Character, b: Character): void {
  pushUnique(a.family.spouseIds, b.id);
  pushUnique(b.family.spouseIds, a.id);
}

/** Runs `build` in one operation; returns the new state, its events and whatever `build` returned. */
export function build<T>(state: GameState, env: SimEnv, fn: (draft: GameState, ctx: SimContext) => T): { state: GameState; value: T; events: ReturnType<typeof inDraft>['events'] } {
  let value: T | undefined;
  const r = inDraft(state, env, (draft, ctx) => {
    value = fn(draft, ctx);
  });
  return { state: r.state, value: value as T, events: r.events };
}

export interface TestHouse {
  state: GameState;
  rulerId: CharId;
  spouseId: CharId;
  childIds: CharId[];
}

/**
 * The player's ruler (aged `rulerAge`) married to a spouse of the opposite sex, with children of
 * the given ages (eldest first), all of the player's house and at the capital.
 */
export function testHouse(state: GameState, env: SimEnv, opts: { rulerAge?: number; childAges?: number[] } = {}): TestHouse {
  const r = build(state, env, (draft, ctx) => {
    const ruler = draft.characters[draft.player.rulerId] as Character;
    const at = draft.player.capitalId;
    if (opts.rulerAge !== undefined) ruler.birthHour = draft.time.hour - opts.rulerAge * HOURS_PER_YEAR;
    ruler.agedTo = Math.floor((draft.time.hour - ruler.birthHour) / HOURS_PER_YEAR);
    const spouse = makePerson(draft, ctx, {
      sex: ruler.sex === 'male' ? 'female' : 'male',
      ageYears: Math.max(16, (opts.rulerAge ?? 30) - 2),
      factionId: draft.player.factionId,
      location: { kind: 'settlement', id: at },
    });
    linkSpouses(ruler, spouse);
    const mother = ruler.sex === 'female' ? ruler : spouse;
    const father = ruler.sex === 'female' ? spouse : ruler;
    const kids: CharId[] = [];
    for (const age of opts.childAges ?? []) {
      const k = makePerson(draft, ctx, { ageYears: age, factionId: draft.player.factionId, location: { kind: 'settlement', id: at } });
      k.agedTo = age;
      linkParent(mother, k);
      linkParent(father, k);
      kids.push(k.id);
    }
    peopleState(draft);
    return { rulerId: ruler.id, spouseId: spouse.id, childIds: kids };
  });
  return { state: r.state, ...r.value };
}
