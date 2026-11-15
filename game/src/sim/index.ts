/**
 * Public simulation API for the client and tools. The client talks to the simulation ONLY through
 * GameSession (dispatch / advance / subscribe / save / load) and reads the frozen GameState.
 * `GameSession` here is bound to the full module registry; `GameSessionWithDeps` takes modules
 * explicitly (tests, tools that run a subset).
 */
export * from './core/index';
export { MODULES, selectModules } from './modules';
export { GameSession } from './game';
export type { DefaultSessionDeps } from './game';
export { GameSession as GameSessionWithDeps, ReplayDivergenceError } from './session';
export type { NewGameOptions, ReplayEntry, SessionDeps, SessionListener } from './session';
export { deserialize, serialize, SaveError } from './save/index';
export type { SaveEnvelope } from './save/index';
