/**
 * Save slots (design §29.9, SCR-03): manual slots, three rotating autosaves, and Ironman — one slot
 * per campaign, written on every autosave trigger and on quit; manual saving is disabled.
 * The simulation produces the blob (`session.save()`); this layer only stores and labels it.
 */
import type { GameState } from '@sim/core/state';
import { createDefaultBackend, type SaveBackend, type SaveMeta } from './backend';

export type { SaveMeta } from './backend';

/** Rotating autosave slots (§29.9: 3). */
export const AUTOSAVE_SLOTS = 3;

/** What a save needs from a session. */
export interface Saveable {
  save(): string;
  getState(): GameState;
  readonly playtimeSec: number;
}

export class SaveError extends Error {
  constructor(
    readonly code: 'ironmanManualSave' | 'notFound' | 'storageFailed',
    message: string,
  ) {
    super(message);
    this.name = 'SaveError';
  }
}

/** Labels describing a game state (shown in the slot list). */
export function describeState(state: GameState): Pick<SaveMeta, 'hour' | 'rulerName' | 'houseName' | 'capitalName' | 'seed' | 'difficulty' | 'ironman' | 'gameVersion'> {
  const ruler = Object.hasOwn(state.characters, state.player.rulerId) ? state.characters[state.player.rulerId] : undefined;
  const faction = Object.hasOwn(state.factions, state.player.factionId) ? state.factions[state.player.factionId] : undefined;
  const capital = Object.hasOwn(state.settlements, state.player.capitalId) ? state.settlements[state.player.capitalId] : undefined;
  return {
    hour: state.time.hour,
    rulerName: ruler ? (ruler.byname ? `${ruler.name} ${ruler.byname}` : ruler.name) : '',
    houseName: faction?.name ?? '',
    capitalName: capital?.name ?? '',
    seed: state.meta.seed,
    difficulty: state.meta.difficulty,
    ironman: state.meta.options.ironman === true,
    gameVersion: state.meta.gameVersion,
  };
}

/** The Ironman slot id of a campaign. */
export function ironmanSlotId(state: GameState): string {
  return `ironman-${state.meta.seed}`;
}

export class SaveManager {
  constructor(
    readonly backend: SaveBackend = createDefaultBackend(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Every save, newest first. */
  async list(): Promise<SaveMeta[]> {
    const all = await this.backend.list();
    return all.sort((a, b) => b.savedAt - a.savedAt || a.id.localeCompare(b.id));
  }

  /** The most recent save (Continue). */
  async latest(): Promise<SaveMeta | undefined> {
    return (await this.list())[0];
  }

  private async write(id: string, kind: SaveMeta['kind'], name: string, session: Saveable): Promise<SaveMeta> {
    const blob = session.save();
    const meta: SaveMeta = {
      id,
      kind,
      name,
      savedAt: this.now(),
      playtimeSec: Math.round(session.playtimeSec),
      size: blob.length,
      ...describeState(session.getState()),
    };
    try {
      await this.backend.put(meta, blob);
    } catch (err) {
      throw new SaveError('storageFailed', err instanceof Error ? err.message : String(err));
    }
    return meta;
  }

  /** A manual save into `slotId` (new slot when omitted). Refused in Ironman campaigns. */
  async saveManual(session: Saveable, name: string, slotId?: string): Promise<SaveMeta> {
    const state = session.getState();
    if (state.meta.options.ironman) throw new SaveError('ironmanManualSave', 'Ironman campaigns keep a single save.');
    const id = slotId ?? (await this.nextManualId());
    return this.write(id, 'manual', name.trim() || describeState(state).rulerName, session);
  }

  /**
   * An autosave: Ironman campaigns overwrite their single slot; others rotate through
   * auto-1…auto-N, replacing the empty or oldest slot.
   */
  async autosave(session: Saveable): Promise<SaveMeta> {
    const state = session.getState();
    if (state.meta.options.ironman) return this.ironmanSave(session);
    const all = await this.backend.list();
    let target = 'auto-1';
    let oldest = Infinity;
    for (let i = 1; i <= AUTOSAVE_SLOTS; i++) {
      const id = `auto-${i}`;
      const m = all.find((x) => x.id === id);
      if (!m) {
        target = id;
        break;
      }
      if (m.savedAt < oldest) {
        oldest = m.savedAt;
        target = id;
      }
    }
    return this.write(target, 'auto', describeState(state).rulerName, session);
  }

  /** Writes the campaign's Ironman slot. */
  async ironmanSave(session: Saveable): Promise<SaveMeta> {
    const state = session.getState();
    return this.write(ironmanSlotId(state), 'ironman', describeState(state).rulerName, session);
  }

  /** The blob of a save (throws SaveError 'notFound'). */
  async loadBlob(id: string): Promise<string> {
    const blob = await this.backend.getBlob(id);
    if (blob === undefined) throw new SaveError('notFound', `No save '${id}'`);
    return blob;
  }

  async delete(id: string): Promise<void> {
    await this.backend.delete(id);
  }

  /** The next free manual slot id ('manual-1', 'manual-2', …). */
  async nextManualId(): Promise<string> {
    const all = await this.backend.list();
    let max = 0;
    for (const m of all) {
      const match = /^manual-(\d+)$/.exec(m.id);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return `manual-${max + 1}`;
  }
}

let shared: SaveManager | undefined;

/** The app-wide save manager (IndexedDB when available). */
export function getSaveManager(): SaveManager {
  shared ??= new SaveManager();
  return shared;
}

/** Replaces the app-wide save manager (tests). */
export function setSaveManager(m: SaveManager): void {
  shared = m;
}
