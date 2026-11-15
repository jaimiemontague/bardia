/**
 * The registry-bound GameSession used by the client and tools: identical to the class in
 * session.ts, except that `modules` defaults to the full registry (src/sim/modules.ts). Kernel and
 * module tests import the explicit-dependency class from './session' instead, so they never load
 * every module.
 */
import type { Content } from '@content/index';
import type { SimModule } from './core/module';
import { MODULES } from './modules';
import { GameSession as SessionWithDeps, type NewGameOptions, type ReplayEntry, type SessionDeps } from './session';

/** Optional dependencies of the registry-bound session. */
export interface DefaultSessionDeps {
  /** Default: the full registry, MODULES. */
  modules?: readonly SimModule[];
  content?: Content;
}

function withDefaults(deps: DefaultSessionDeps): SessionDeps {
  const out: SessionDeps = { modules: deps.modules ?? MODULES };
  if (deps.content !== undefined) out.content = deps.content;
  return out;
}

/** GameSession bound to the module registry (the class the client and tools use). */
export class GameSession extends SessionWithDeps {
  static override newGame(options: NewGameOptions, deps: DefaultSessionDeps = {}): SessionWithDeps {
    return SessionWithDeps.newGame(options, withDefaults(deps));
  }

  static override load(blob: string, deps: DefaultSessionDeps = {}): SessionWithDeps {
    return SessionWithDeps.load(blob, withDefaults(deps));
  }

  static override replay(options: NewGameOptions, log: readonly ReplayEntry[], deps: DefaultSessionDeps = {}): SessionWithDeps {
    return SessionWithDeps.replay(options, log, withDefaults(deps));
  }
}
