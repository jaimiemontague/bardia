/**
 * Command dispatch (design §29.3): validate → find the single owning handler → apply inside one
 * kernel operation (Immer `produce`) → return the new state plus the events emitted. A rejected
 * command (unknown type, schema failure, or a handler throwing CommandError) leaves the state
 * untouched.
 *
 * When the owning module declares a zod schema for the command, the handler receives the schema's
 * OUTPUT (defaults, trims, coercions and transforms applied, unknown keys stripped, `type` kept).
 * The replay log stores the raw input and replays re-parse it, so schemas must be deterministic.
 */
import { CommandError, type Command, type CommandFailure } from './commands';
import { runOperation } from './context';
import type { SimEvent } from './events';
import type { SimEnv } from './module';
import type { GameState } from './state';

export interface DispatchResult {
  state: GameState;
  events: SimEvent[];
  error?: CommandFailure;
}

export function dispatch(state: GameState, command: Command, env: SimEnv): DispatchResult {
  const type = (command as { type?: unknown }).type;
  if (typeof type !== 'string') {
    return { state, events: [], error: { code: 'invalidCommand', message: 'command.type must be a string' } };
  }
  const entry = env.handlers.get(type);
  if (!entry) {
    return { state, events: [], error: { code: 'unknownCommand', message: `No module handles command '${type}'` } };
  }
  let input: unknown = command;
  if (entry.schema) {
    const parsed = entry.schema.safeParse(command);
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      return { state, events: [], error: { code: 'invalidCommand', message } };
    }
    input = parsed.data !== null && typeof parsed.data === 'object' ? { ...(parsed.data as object), type } : parsed.data;
  }
  try {
    const r = runOperation(state, env, (draft, ctx) => {
      ctx.runAs(entry.moduleId, () => entry.handler(draft, input as never, ctx));
      ctx.drainReactions();
    });
    return { state: r.state, events: r.events };
  } catch (err) {
    if (err instanceof CommandError) {
      const error: CommandFailure = { code: err.code, message: err.message };
      if (err.details !== undefined) error.details = err.details;
      return { state, events: [], error };
    }
    throw err;
  }
}
