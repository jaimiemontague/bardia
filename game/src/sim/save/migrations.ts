/**
 * Save migrations (design §29.9).
 *
 * Two layers:
 * 1. CORE migrations (this file, kernel-owned): ordered pure functions vN → vN+1 over the raw
 *    save state, keyed by `meta.schemaVersion`. Only the kernel owner edits this list.
 * 2. MODULE migrations (parallel-safe): each SimModule declares `version` and
 *    `migrate(draft, fromVersion, ctx)`; GameSession.load runs them for every module whose saved
 *    `meta.moduleVersions[id]` is older. Module agents never touch this file.
 */

/** Current core schema version written into new states. */
export const CURRENT_SCHEMA_VERSION = 1;

/** A pure transformation of the raw (parsed JSON) state from `from` to `to = from + 1`. */
export interface SaveMigration {
  from: number;
  to: number;
  describe: string;
  migrate(state: Record<string, unknown>): Record<string, unknown>;
}

/** Ordered core migrations. Empty: version 1 is the first schema. */
export const CORE_MIGRATIONS: readonly SaveMigration[] = [];

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

/** Validates that migrations form a contiguous chain (each `to === from + 1`, no gaps or duplicates). */
export function validateMigrations(migrations: readonly SaveMigration[]): void {
  for (let i = 0; i < migrations.length; i++) {
    const m = migrations[i] as SaveMigration;
    if (m.to !== m.from + 1) throw new MigrationError(`migration ${m.from}->${m.to} must step by exactly 1`);
    const prev = migrations[i - 1];
    if (prev && prev.to !== m.from) throw new MigrationError(`migration chain broken between ${prev.to} and ${m.from}`);
  }
}

/** Applies migrations in order from `fromVersion` up to `target`, stamping meta.schemaVersion. */
export function migrateState(
  state: Record<string, unknown>,
  fromVersion: number,
  migrations: readonly SaveMigration[] = CORE_MIGRATIONS,
  target: number = CURRENT_SCHEMA_VERSION,
): Record<string, unknown> {
  validateMigrations(migrations);
  if (fromVersion > target) throw new MigrationError(`save schema ${fromVersion} is newer than this game (${target})`);
  let current = state;
  let version = fromVersion;
  while (version < target) {
    const step = migrations.find((m) => m.from === version);
    if (!step) throw new MigrationError(`no migration from schema ${version}`);
    current = step.migrate(current);
    version = step.to;
    const meta = current.meta as Record<string, unknown> | undefined;
    if (meta) current = { ...current, meta: { ...meta, schemaVersion: version } };
  }
  return current;
}
