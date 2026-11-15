/**
 * Save files (design §29.9): GameState → JSON → gzip (fflate, fixed mtime so output is
 * byte-identical for identical states) → base64, prefixed with a CRC-32 of the JSON:
 *
 *   BARDIA1:<crc32 hex>:<base64 of gzip(envelope JSON)>
 *
 * deserialize() verifies the checksum, runs CORE migrations and returns the envelope. Module
 * migrations need the module registry and are applied by GameSession.load.
 */
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import type { GameState, Hour } from '../core/state';
import { GAME_VERSION } from '../core/version';
import { base64Decode, base64Encode, crc32 } from './codec';
import { CORE_MIGRATIONS, CURRENT_SCHEMA_VERSION, migrateState, type SaveMigration } from './migrations';

export * from './codec';
export * from './migrations';

export const SAVE_PREFIX = 'BARDIA1';

/** The serialized save document. */
export interface SaveEnvelope {
  format: 'bardia-save';
  schemaVersion: number;
  gameVersion: string;
  seed: string;
  playtimeSec: number;
  savedAtHour: Hour;
  state: GameState;
}

export type SaveErrorCode = 'badFormat' | 'checksum' | 'corrupt' | 'tooNew';

export class SaveError extends Error {
  constructor(
    public readonly code: SaveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SaveError';
  }
}

export interface SerializeOptions {
  playtimeSec?: number;
  gameVersion?: string;
}

/** Serializes a state into a save blob string. */
export function serialize(state: GameState, opts: SerializeOptions = {}): string {
  const envelope: SaveEnvelope = {
    format: 'bardia-save',
    schemaVersion: state.meta.schemaVersion,
    gameVersion: opts.gameVersion ?? GAME_VERSION,
    seed: state.meta.seed,
    playtimeSec: opts.playtimeSec ?? 0,
    savedAtHour: state.time.hour,
    state,
  };
  const json = JSON.stringify(envelope);
  const bytes = strToU8(json);
  const checksum = crc32(bytes).toString(16).padStart(8, '0');
  const gz = gzipSync(bytes, { level: 6, mtime: 0 });
  return `${SAVE_PREFIX}:${checksum}:${base64Encode(gz)}`;
}

export interface DeserializeOptions {
  /** Override the core migration list (tests). */
  migrations?: readonly SaveMigration[];
  /** Override the target schema version (tests). */
  targetVersion?: number;
}

/** Parses, verifies and core-migrates a save blob. */
export function deserialize(blob: string, opts: DeserializeOptions = {}): SaveEnvelope {
  const parts = blob.split(':');
  if (parts.length !== 3 || parts[0] !== SAVE_PREFIX) throw new SaveError('badFormat', 'Not a Bardia save');
  const checksum = parts[1] as string;
  const payload = parts[2] as string;
  let bytes: Uint8Array;
  try {
    bytes = gunzipSync(base64Decode(payload));
  } catch (err) {
    throw new SaveError('corrupt', `Save payload could not be decompressed: ${(err as Error).message}`);
  }
  const actual = crc32(bytes).toString(16).padStart(8, '0');
  if (actual !== checksum) throw new SaveError('checksum', `Save checksum mismatch (expected ${checksum}, got ${actual})`);
  let envelope: SaveEnvelope;
  try {
    envelope = JSON.parse(strFromU8(bytes)) as SaveEnvelope;
  } catch (err) {
    throw new SaveError('corrupt', `Save JSON is invalid: ${(err as Error).message}`);
  }
  if (envelope.format !== 'bardia-save' || typeof envelope.state !== 'object' || envelope.state === null) {
    throw new SaveError('badFormat', 'Save envelope is malformed');
  }
  const target = opts.targetVersion ?? CURRENT_SCHEMA_VERSION;
  const from = envelope.state.meta?.schemaVersion ?? envelope.schemaVersion;
  if (from > target) throw new SaveError('tooNew', `Save schema ${from} is newer than this game (${target})`);
  if (from < target) {
    const migrated = migrateState(
      envelope.state as unknown as Record<string, unknown>,
      from,
      opts.migrations ?? CORE_MIGRATIONS,
      target,
    );
    envelope = { ...envelope, schemaVersion: target, state: migrated as unknown as GameState };
  }
  return envelope;
}
