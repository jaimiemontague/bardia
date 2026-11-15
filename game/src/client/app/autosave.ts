/**
 * Autosave triggers (design §29.9): arrival, departure, battle start and month start, honouring the
 * autosave setting ('off' | 'monthly' | 'standard'); Ironman campaigns save on every trigger
 * regardless of the setting (and on quit, see the game menu). Saving is asynchronous; the blob is
 * taken synchronously at the trigger so it reflects exactly that moment.
 */
import type { AutosaveMode } from '../settings/schema';
import type { Saveable, SaveManager, SaveMeta } from '../saves/saveManager';
import { eventField, type SimEventBatch } from './simEvents';

export type AutosaveTrigger = 'monthStart' | 'arrival' | 'departure' | 'battleStart';

/** Commands whose success means the player's fleet departed. */
export const DEPARTURE_COMMANDS: readonly string[] = ['launchExpedition'];

/** Which autosave trigger (if any) a batch contains. */
export function autosaveTrigger(batch: SimEventBatch): AutosaveTrigger | null {
  if (batch.origin === 'startup') return null;
  if (batch.origin === 'dispatch' && batch.command && DEPARTURE_COMMANDS.includes(batch.command.type)) return 'departure';
  const fac = batch.state.player.factionId;
  let trigger: AutosaveTrigger | null = null;
  for (const e of batch.events) {
    const type = e.type as string;
    if (type === 'BattleStarted') return 'battleStart';
    if (type === 'Arrived') {
      const fleetId = eventField(e, 'fleetId');
      const fleet = typeof fleetId === 'string' && Object.hasOwn(batch.state.fleets, fleetId) ? batch.state.fleets[fleetId as `flt_${string}`] : undefined;
      if (!fleet || fleet.ownerId === fac) trigger = 'arrival';
    } else if (type === 'MonthStarted' && trigger === null) trigger = 'monthStart';
  }
  return trigger;
}

/** Whether a trigger saves under the given setting. */
export function shouldAutosave(trigger: AutosaveTrigger, mode: AutosaveMode, ironman: boolean): boolean {
  if (ironman) return true;
  if (mode === 'off') return false;
  if (mode === 'monthly') return trigger === 'monthStart';
  return true;
}

/** Serialises autosave writes: at most one in flight, the newest request wins the next slot. */
export class AutosaveQueue {
  private running = false;
  private queued: Saveable | null = null;

  constructor(
    private readonly manager: () => SaveManager,
    private readonly onSaved: (meta: SaveMeta) => void = () => {},
    private readonly onError: (err: unknown) => void = (err) => console.error('[autosave] failed', err),
  ) {}

  /** Requests an autosave of the session's current state. */
  request(session: Saveable): void {
    // Snapshot now: the session keeps advancing while the previous write finishes.
    const blob = session.save();
    const state = session.getState();
    const snapshot: Saveable = { save: () => blob, getState: () => state, playtimeSec: session.playtimeSec };
    if (this.running) {
      this.queued = snapshot;
      return;
    }
    void this.run(snapshot);
  }

  get busy(): boolean {
    return this.running;
  }

  private async run(s: Saveable): Promise<void> {
    this.running = true;
    try {
      const meta = await this.manager().autosave(s);
      this.onSaved(meta);
    } catch (err) {
      this.onError(err);
    } finally {
      this.running = false;
      const next = this.queued;
      this.queued = null;
      if (next) void this.run(next);
    }
  }
}
