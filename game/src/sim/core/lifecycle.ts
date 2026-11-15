/**
 * Campaign lifecycle as pure kernel operations: building a new game's state and bringing a loaded
 * save up to date with the current module set. They take a SimEnv (built from whatever modules the
 * caller passes) and never import the module registry, so tests of one module load only the kernel
 * plus that module. GameSession (src/sim/session.ts) wraps these.
 */
import type { DifficultyId } from '@content/schemas/ids';
import { runOperation } from './context';
import type { SimEvent } from './events';
import { createPlaceholderPlayer, type PlaceholderPlayerOptions } from './factory';
import { createEmptyState } from './initialState';
import type { SimEnv } from './module';
import type { GameOptions, GameState } from './state';

export interface NewGameOptions {
  seed: string;
  difficulty?: DifficultyId;
  options?: Partial<GameOptions>;
  player?: PlaceholderPlayerOptions;
}

/** Thrown when a save cannot be brought up to date with the running module set. */
export class ModuleVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModuleVersionError';
  }
}

/**
 * New campaign: empty state → placeholder player → every module's `init` in module order (with
 * reactions drained after each), recording each module's data version.
 */
export function createNewGameState(options: NewGameOptions, env: SimEnv): { state: GameState; events: SimEvent[] } {
  const base = createEmptyState({
    seed: options.seed,
    ...(options.difficulty !== undefined ? { difficulty: options.difficulty } : {}),
    ...(options.options !== undefined ? { options: options.options } : {}),
  });
  base.meta.options.duelAssist = options.options?.duelAssist ?? env.balance.difficulty[base.meta.difficulty].duelAssistDefault;
  const r = runOperation(base, env, (draft, ctx) => {
    createPlaceholderPlayer(draft, ctx, options.player ?? {});
    ctx.drainReactions();
    for (const m of env.modules) {
      draft.meta.moduleVersions[m.id] = m.version ?? 0;
      if (m.init) {
        const init = m.init;
        ctx.runAs(m.id, () => init(draft, ctx));
        ctx.drainReactions();
      }
    }
  });
  return { state: r.state, events: r.events };
}

/**
 * Brings a (core-migrated) saved state up to date with the running modules, in module order:
 *  - a module the save has never seen (`meta.moduleVersions[id]` missing) gets its `init`;
 *  - an older module version gets `migrate(draft, savedVersion)`;
 *  - a newer module version than the running code is refused (ModuleVersionError);
 * and every module's version is recorded.
 */
export function upgradeLoadedState(state: GameState, env: SimEnv): { state: GameState; events: SimEvent[] } {
  for (const m of env.modules) {
    const saved = state.meta.moduleVersions[m.id];
    const target = m.version ?? 0;
    if (saved !== undefined && saved > target) {
      throw new ModuleVersionError(`Save was made with a newer '${m.id}' module (v${saved} > v${target})`);
    }
  }
  const r = runOperation(state, env, (draft, ctx) => {
    for (const m of env.modules) {
      const target = m.version ?? 0;
      const saved = Object.hasOwn(draft.meta.moduleVersions, m.id) ? draft.meta.moduleVersions[m.id] : undefined;
      if (saved === undefined) {
        if (m.init) {
          const init = m.init;
          ctx.runAs(m.id, () => init(draft, ctx));
        }
        draft.meta.moduleVersions[m.id] = target;
      } else if (saved < target) {
        if (m.migrate) {
          const migrate = m.migrate;
          ctx.runAs(m.id, () => migrate(draft, saved, ctx));
        }
        draft.meta.moduleVersions[m.id] = target;
      }
      ctx.drainReactions();
    }
  });
  return { state: r.state, events: r.events };
}
