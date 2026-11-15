import { describe, expect, it } from 'vitest';
import { GameSession } from '@sim/session';
import { MemorySaveBackend } from './backend';
import { AUTOSAVE_SLOTS, describeState, ironmanSlotId, SaveError, SaveManager } from './saveManager';

function session(seed = 'saves', ironman = false): GameSession {
  return GameSession.newGame({ seed, options: { ironman }, player: { name: 'Asa', sex: 'female', culture: 'eyjar' } }, { modules: [] });
}

function manager(): { m: SaveManager; tick: () => void } {
  let now = 1_000;
  return { m: new SaveManager(new MemorySaveBackend(), () => now), tick: () => (now += 1_000) };
}

describe('save manager (§29.9)', () => {
  it('writes manual saves with readable metadata and loads the exact blob back', async () => {
    const { m } = manager();
    const s = session();
    const meta = await m.saveManual(s, '  Before the raid ');
    expect(meta).toMatchObject({ id: 'manual-1', kind: 'manual', name: 'Before the raid', rulerName: expect.stringContaining('Asa'), seed: 'saves', ironman: false });
    const blob = await m.loadBlob('manual-1');
    expect(blob).toBe(s.save());
    expect(GameSession.load(blob, { modules: [] }).getState()).toEqual(s.getState());
    expect((await m.saveManual(s, 'second')).id).toBe('manual-2');
  });

  it('rotates autosaves through three slots, replacing the oldest', async () => {
    const { m, tick } = manager();
    const s = session();
    const ids: string[] = [];
    for (let i = 0; i < AUTOSAVE_SLOTS + 2; i++) {
      tick();
      ids.push((await m.autosave(s)).id);
    }
    expect(ids).toEqual(['auto-1', 'auto-2', 'auto-3', 'auto-1', 'auto-2']);
    expect((await m.list()).filter((x) => x.kind === 'auto')).toHaveLength(AUTOSAVE_SLOTS);
    expect((await m.latest())?.id).toBe('auto-2');
  });

  it('keeps one slot per Ironman campaign and refuses manual saves', async () => {
    const { m } = manager();
    const s = session('iron', true);
    await expect(m.saveManual(s, 'cheat')).rejects.toBeInstanceOf(SaveError);
    const a = await m.autosave(s);
    const b = await m.autosave(s);
    expect(a.id).toBe(ironmanSlotId(s.getState()));
    expect(b.id).toBe(a.id);
    expect((await m.list()).map((x) => x.kind)).toEqual(['ironman']);
  });

  it('reports missing saves and deletes', async () => {
    const { m } = manager();
    await expect(m.loadBlob('nope')).rejects.toMatchObject({ code: 'notFound' });
    const s = session();
    await m.saveManual(s, 'x');
    await m.delete('manual-1');
    expect(await m.list()).toEqual([]);
  });

  it('describes a state for the slot list', () => {
    const d = describeState(session('desc').getState());
    expect(d).toMatchObject({ hour: 0, seed: 'desc', difficulty: 'raider' });
    expect(d.capitalName.length).toBeGreaterThan(0);
  });
});
