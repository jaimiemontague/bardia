import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { strToU8 } from 'fflate';
import { GameSession } from '../game';
import type { SimModule } from '../core/module';
import { base64Decode, base64Encode, crc32 } from './codec';
import { CURRENT_SCHEMA_VERSION, MigrationError, migrateState, validateMigrations, type SaveMigration } from './migrations';
import { deserialize, SaveError, serialize } from './index';

describe('codecs', () => {
  it('base64 round-trips arbitrary bytes and matches the standard encoding', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        expect(Array.from(base64Decode(base64Encode(bytes)))).toEqual(Array.from(bytes));
        expect(base64Encode(bytes)).toBe(Buffer.from(bytes).toString('base64'));
      }),
    );
    expect(() => base64Decode('ab$d')).toThrow();
  });

  it('crc32 matches the standard check value', () => {
    expect(crc32(strToU8('123456789')).toString(16)).toBe('cbf43926');
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('save / load', () => {
  it('save → load → save is byte-identical (fresh and advanced games)', () => {
    const session = GameSession.newGame({ seed: 'roundtrip', difficulty: 'seaKing' });
    const blob1 = session.save();
    expect(GameSession.load(blob1).save()).toBe(blob1);
    session.advance(24 * 40);
    session.dispatch({ type: 'setPolicy', policy: 'petitions', value: 'delegate' });
    session.addPlaytime(123.5);
    const blob2 = session.save();
    const loaded = GameSession.load(blob2);
    expect(loaded.save()).toBe(blob2);
    expect(loaded.getState()).toEqual(session.getState());
    expect(loaded.playtimeSec).toBe(123.5);
  });

  it('serialize is deterministic for equal states', () => {
    const a = GameSession.newGame({ seed: 'same' }).save();
    const b = GameSession.newGame({ seed: 'same' }).save();
    expect(a).toBe(b);
    expect(a.startsWith('BARDIA1:')).toBe(true);
  });

  it('detects tampering, bad formats and saves from newer versions', () => {
    const state = GameSession.newGame({ seed: 'tamper' }).getState();
    const blob = serialize(state);
    const [prefix, crc, payload] = blob.split(':') as [string, string, string];
    const badCrc = `${prefix}:${crc === '00000000' ? '00000001' : '00000000'}:${payload}`;
    expect(() => deserialize(badCrc)).toThrow(SaveError);
    expect(() => deserialize(badCrc)).toThrow(/checksum/);
    expect(() => deserialize('hello')).toThrow(/Not a Bardia save/);
    expect(() => deserialize(`${prefix}:${crc}:AAAA`)).toThrow(/decompressed/);
    const future = serialize({ ...state, meta: { ...state.meta, schemaVersion: CURRENT_SCHEMA_VERSION + 1 } });
    expect(() => deserialize(future)).toThrow(/newer/);
  });

  it('runs ordered core migrations (pure functions) up to the target version', () => {
    const state = GameSession.newGame({ seed: 'migrate' }).getState();
    const old = serialize({ ...state, meta: { ...state.meta, schemaVersion: 1 } });
    const migrations: SaveMigration[] = [
      { from: 1, to: 2, describe: 'add flag', migrate: (s) => ({ ...s, flags: { ...(s.flags as object), v2: true } }) },
      { from: 2, to: 3, describe: 'rename flag', migrate: (s) => ({ ...s, flags: { ...(s.flags as object), v3: true } }) },
    ];
    const env = deserialize(old, { migrations, targetVersion: 3 });
    expect(env.schemaVersion).toBe(3);
    expect(env.state.meta.schemaVersion).toBe(3);
    expect(env.state.flags).toMatchObject({ v2: true, v3: true });
    expect(() => validateMigrations([{ from: 1, to: 3, describe: 'skip', migrate: (s) => s }])).toThrow(MigrationError);
    expect(() => migrateState({}, 1, [], 2)).toThrow(/no migration from schema 1/);
  });

  it('runs module migrations for modules whose saved version is older', () => {
    const v1: SimModule = { id: 'ledger', order: 70, version: 1, init: (d) => void (d.flags.ledgerShape = 'v1') };
    const blob = GameSession.newGame({ seed: 'modmig' }, { modules: [v1] }).save();
    const calls: number[] = [];
    const v2: SimModule = {
      id: 'ledger',
      order: 70,
      version: 2,
      migrate: (d, from) => {
        calls.push(from);
        d.flags.ledgerShape = 'v2';
      },
    };
    const loaded = GameSession.load(blob, { modules: [v2] });
    expect(calls).toEqual([1]);
    expect(loaded.getState().flags.ledgerShape).toBe('v2');
    expect(loaded.getState().meta.moduleVersions.ledger).toBe(2);
    const v0: SimModule = { id: 'ledger', order: 70, version: 0 };
    expect(() => GameSession.load(blob, { modules: [v0] })).toThrow(/newer 'ledger' module/);
  });
});
