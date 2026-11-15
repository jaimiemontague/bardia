/**
 * Command registry (design §30.9). Commands are the ONLY way the player (and the replay runner)
 * changes the game. Modules register command types by augmenting `CommandMap`:
 *
 *   declare module '@sim/core/commands' {
 *     interface CommandMap { muster: { holdingId: SettlementId; units: Record<UnitTypeId, number> } }
 *   }
 *
 * and handle them in their SimModule `handlers`. Exactly one module may handle each type.
 * Payloads must be JSON-serialisable (they are logged for replays) and must not use the key `type`.
 * This interface is intentionally empty here; core commands are declared in builtins.ts.
 */
import type { JsonValue } from './state';

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface CommandMap {}

export type CommandType = keyof CommandMap;

/** The full command object for one type: `{ type: K } & payload`. */
export type CommandOf<K extends CommandType> = { type: K } & CommandMap[K];

/** Discriminated union of every registered command. */
export type Command = { [K in CommandType]: CommandOf<K> }[CommandType];

/** Why a command was rejected. */
export interface CommandFailure {
  code: string;
  message: string;
  details?: JsonValue;
}

/**
 * Throw from a command handler to reject the command: the state is left untouched and
 * `dispatch` returns `{ error }`. Any other exception is a bug and propagates.
 */
export class CommandError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
    public readonly details?: JsonValue,
  ) {
    super(message ?? code);
    this.name = 'CommandError';
  }
}
