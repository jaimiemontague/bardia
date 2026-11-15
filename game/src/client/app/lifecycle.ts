/**
 * Campaign lifecycle actions used by menus and the game menu: begin a saga, continue/load a save,
 * quick-save, save to a slot, and quit to the main menu (Ironman campaigns save on quit, §29.9).
 * Every failure becomes a toast; nothing here throws into React.
 */
import type { NewGameOptions } from '@sim/core/lifecycle';
import { getSaveManager, SaveError, type SaveMeta } from '../saves/saveManager';
import { useFeeds } from './chronicleFeeds';
import { useGame } from './gameStore';
import { useNavigation } from './navigation';
import { useNotifications } from './notifications';

/**
 * Opens a narrative line-memory session after a new game or a load, as the narrative module asks
 * (`narrativeSession` command), when that module is present. Logged like any command.
 */
export function startNarrativeSession(reason: 'newGame' | 'load'): void {
  const game = useGame.getState();
  if (game.session?.env.handlers.has('narrativeSession')) game.dispatch({ type: 'narrativeSession', reason });
}

function toast(key: string, tone: 'info' | 'success' | 'warning' | 'danger', vars?: Record<string, string | number>): void {
  useNotifications.getState().pushToast(key, { tone, ...(vars ? { vars } : {}) });
}

/** Starts a new campaign and enters the game; returns false (with a toast) on failure. */
export function beginSaga(options: NewGameOptions): boolean {
  try {
    useGame.getState().startNewGame(options);
    startNarrativeSession('newGame');
  } catch (err) {
    console.error('[lifecycle] new game failed', err);
    toast('ui.toast.newGameFailed', 'danger', { reason: err instanceof Error ? err.message.split('\n')[0] ?? '' : String(err) });
    return false;
  }
  useNavigation.getState().reset();
  return true;
}

/** Loads a save slot and enters the game. */
export async function loadSlot(id: string): Promise<boolean> {
  try {
    const blob = await getSaveManager().loadBlob(id);
    useGame.getState().loadFromBlob(blob, { slotId: id });
    startNarrativeSession('load');
  } catch (err) {
    console.error('[lifecycle] load failed', err);
    toast('ui.toast.loadFailed', 'danger', { reason: err instanceof Error ? err.message.split('\n')[0] ?? '' : String(err) });
    return false;
  }
  useNavigation.getState().reset();
  toast('ui.toast.loaded', 'success');
  return true;
}

/** Loads a save blob (an imported file) and enters the game. */
export function loadBlob(blob: string): boolean {
  try {
    useGame.getState().loadFromBlob(blob.trim(), { slotId: null });
    startNarrativeSession('load');
  } catch (err) {
    toast('ui.toast.loadFailed', 'danger', { reason: err instanceof Error ? err.message.split('\n')[0] ?? '' : String(err) });
    return false;
  }
  useNavigation.getState().reset();
  return true;
}

/** The most recent save (for Continue), or undefined. */
export async function latestSave(): Promise<SaveMeta | undefined> {
  try {
    return await getSaveManager().latest();
  } catch {
    return undefined;
  }
}

/** Continues the most recent save. */
export async function continueLatest(): Promise<boolean> {
  const meta = await latestSave();
  if (!meta) {
    toast('ui.toast.noSaves', 'warning');
    return false;
  }
  return loadSlot(meta.id);
}

/** Saves the current campaign to a manual slot (new slot when `slotId` is omitted). */
export async function saveToSlot(name: string, slotId?: string): Promise<SaveMeta | null> {
  const session = useGame.getState().session;
  if (!session) return null;
  try {
    const meta = await getSaveManager().saveManual(session, name, slotId);
    useGame.getState().setOrigin({ slotId: meta.id });
    toast('ui.toast.saved', 'success', { name: meta.name });
    return meta;
  } catch (err) {
    if (err instanceof SaveError && err.code === 'ironmanManualSave') toast('ui.toast.ironmanNoManual', 'warning');
    else toast('ui.toast.saveFailed', 'danger', { reason: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Quick save (F5) into the dedicated quick slot; Ironman campaigns write their own slot instead. */
export async function quickSave(): Promise<void> {
  const session = useGame.getState().session;
  if (!session) return;
  const state = session.getState();
  try {
    if (state.meta.options.ironman) {
      await getSaveManager().ironmanSave(session);
      toast('ui.toast.ironmanSaved', 'success');
      return;
    }
    await getSaveManager().saveManual(session, '', 'manual-quick');
    toast('ui.toast.quickSaved', 'success');
  } catch (err) {
    toast('ui.toast.saveFailed', 'danger', { reason: err instanceof Error ? err.message : String(err) });
  }
}

/** Leaves the campaign for the main menu; Ironman campaigns are saved first. */
export async function quitToMenu(): Promise<void> {
  const game = useGame.getState();
  const session = game.session;
  if (session && session.getState().meta.options.ironman) {
    try {
      await getSaveManager().ironmanSave(session);
    } catch (err) {
      toast('ui.toast.saveFailed', 'danger', { reason: err instanceof Error ? err.message : String(err) });
    }
  }
  game.quit();
  useFeeds.getState().clear();
  useNotifications.getState().clear();
  useNavigation.getState().reset();
  useNavigation.getState().showMenu('mainMenu');
}
