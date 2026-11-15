/**
 * GameSession: the object the client (and headless tools) hold. It owns the current immutable
 * GameState, the validated module environment, the replay log and subscribers.
 *
 * This class takes its modules as an explicit dependency and never imports the module registry,
 * so kernel and module tests can use it without loading every module. The client and tools use the
 * registry-bound subclass exported from '@sim/index' (src/sim/game.ts):
 *
 *   const session = GameSession.newGame({ seed: 'ketil', difficulty: 'raider' });
 *   session.subscribe((state, events) => store.setState({ state }));
 *   session.dispatch({ type: 'wait', days: 3 });
 *   session.advance(24);            // real-time play: the client converts dt to whole hours
 *   const blob = session.save();    // → GameSession.load(blob)
 *
 * Every successful command and every state-changing advance is appended to `commandLog`
 * (consecutive advances are merged into one entry), so `GameSession.replay(options, log)`
 * reproduces the exact same state (determinism, §7.4).
 */
import { getContent, type Content } from '@content/index';
import type { Command } from './core/commands';
import { dispatch, type DispatchResult } from './core/dispatch';
import { createSimEnv } from './core/env';
import type { SimEvent } from './core/events';
import { createNewGameState, upgradeLoadedState, type NewGameOptions } from './core/lifecycle';
import type { SimEnv, SimModule } from './core/module';
import { advance as advanceState, type AdvanceResult } from './core/scheduler';
import type { GameState, Hour } from './core/state';
import { deserialize, serialize } from './save/index';

export type { NewGameOptions } from './core/lifecycle';

export interface SessionDeps {
  /** Gameplay modules (the registry-bound GameSession in src/sim/game.ts defaults this to MODULES). */
  modules: readonly SimModule[];
  /** Content catalogs (default: bundled content). */
  content?: Content;
}

/** One entry of the replay log. `hour` is the game hour when it was issued. */
export type ReplayEntry =
  | { kind: 'command'; hour: Hour; command: Command }
  | { kind: 'advance'; hour: Hour; hours: number };

export type SessionListener = (state: GameState, events: readonly SimEvent[]) => void;

export class ReplayDivergenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayDivergenceError';
  }
}

export class GameSession {
  private state: GameState;
  private readonly listeners = new Set<SessionListener>();
  private readonly log: ReplayEntry[] = [];
  private playtime = 0;
  /** Events produced while creating/loading the game (module init, migrations). */
  readonly startupEvents: readonly SimEvent[];
  /** The options this game was created with (needed to replay it). */
  readonly newGameOptions: NewGameOptions | undefined;

  protected constructor(
    state: GameState,
    readonly env: SimEnv,
    startupEvents: SimEvent[],
    newGameOptions?: NewGameOptions,
  ) {
    this.state = state;
    this.startupEvents = startupEvents;
    this.newGameOptions = newGameOptions;
  }

  /** Creates a new campaign: empty state → placeholder player → every module's init in order. */
  static newGame(options: NewGameOptions, deps: SessionDeps): GameSession {
    const env = createSimEnv({ modules: deps.modules, content: deps.content ?? getContent() });
    const { state, events } = createNewGameState(options, env);
    return new GameSession(state, env, events, cloneOptions(options));
  }

  /**
   * Loads a save blob: verify + core migrations, then module catch-up in module order (`init` for
   * modules the save has never seen, `migrate` for outdated ones; newer module data is refused).
   */
  static load(blob: string, deps: SessionDeps): GameSession {
    const env = createSimEnv({ modules: deps.modules, content: deps.content ?? getContent() });
    const envelope = deserialize(blob);
    const { state, events } = upgradeLoadedState(envelope.state, env);
    const session = new GameSession(state, env, events);
    session.playtime = envelope.playtimeSec;
    return session;
  }

  /** Recreates a game from its new-game options and replay log; throws on divergence. */
  static replay(options: NewGameOptions, log: readonly ReplayEntry[], deps: SessionDeps): GameSession {
    const session = GameSession.newGame(options, deps);
    for (const [i, entry] of log.entries()) {
      if (session.state.time.hour !== entry.hour) {
        throw new ReplayDivergenceError(`replay entry ${i}: expected hour ${entry.hour}, state is at ${session.state.time.hour}`);
      }
      if (entry.kind === 'command') {
        const r = session.dispatch(entry.command);
        if (r.error) throw new ReplayDivergenceError(`replay entry ${i}: command '${entry.command.type}' failed: ${r.error.message}`);
      } else {
        session.advance(entry.hours);
      }
    }
    return session;
  }

  /** The current (frozen) state. */
  getState(): GameState {
    return this.state;
  }

  /** Successful commands and state-changing advances, in order (consecutive advances merged). */
  get commandLog(): readonly ReplayEntry[] {
    return this.log;
  }

  /** Accumulated play time reported by the client (seconds); stored in saves, not in GameState. */
  get playtimeSec(): number {
    return this.playtime;
  }

  /** The client reports wall-clock play time here (the simulation itself never reads clocks). */
  addPlaytime(seconds: number): void {
    if (Number.isFinite(seconds) && seconds > 0) this.playtime += seconds;
  }

  /** Validates and applies a command. On error the state is unchanged and nothing is logged. */
  dispatch(command: Command): DispatchResult {
    const hour = this.state.time.hour;
    const result = dispatch(this.state, command, this.env);
    if (!result.error) {
      this.log.push({ kind: 'command', hour, command });
      this.commit(result.state, result.events);
    }
    return result;
  }

  /** Advances time by up to `hours` whole hours; stops early at a pending decision. */
  advance(hours: number): AdvanceResult {
    const hour = this.state.time.hour;
    const result = advanceState(this.state, hours, this.env);
    if (result.state !== this.state) {
      this.logAdvance(hour, hours);
      this.commit(result.state, result.events);
    }
    return result;
  }

  /** Subscribe to state changes; returns an unsubscribe function. */
  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Serializes the current state (with play time) into a save blob. */
  save(): string {
    return serialize(this.state, { playtimeSec: this.playtime });
  }

  /**
   * Appends an advance to the log, merging it into the previous entry when that entry is an
   * advance that ran to completion and ended exactly where this one starts. Ticks are per hour and
   * resumable, so advance(a) then advance(b) from the same state equals advance(a + b) — including
   * stopping at the same pending decision — and the client's many small real-time advances cost
   * one log entry instead of one per frame.
   */
  private logAdvance(hour: Hour, hours: number): void {
    const last = this.log[this.log.length - 1];
    if (last?.kind === 'advance' && last.hour + last.hours === hour) {
      this.log[this.log.length - 1] = { kind: 'advance', hour: last.hour, hours: last.hours + hours };
      return;
    }
    this.log.push({ kind: 'advance', hour, hours });
  }

  private commit(state: GameState, events: readonly SimEvent[]): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener(state, events);
  }
}

function cloneOptions(options: NewGameOptions): NewGameOptions {
  return JSON.parse(JSON.stringify(options)) as NewGameOptions;
}
