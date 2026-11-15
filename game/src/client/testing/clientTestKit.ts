/**
 * Test kit for the client's component tests (jsdom) and unit tests. Never imported by the app.
 *
 *   const session = testShellSession({ script: [{ day: 2, notify: { key: 'ui.notify.criticalTitle', priority: 'critical' } }] });
 *   resetClientState();                    // fresh stores, in-memory saves, a core-only session factory
 *   useGame.getState().attach(session);    // or beginSaga(…) through the factory
 *
 * Sessions run the kernel plus one scripted test module (`testShellScript`), so tests never depend
 * on other agents' gameplay modules while those are being built.
 */
import type { EntityLink, VoiceId } from '@sim/core/events';
import type { SimModule } from '@sim/core/module';
import type { NewGameOptions } from '@sim/core/lifecycle';
import type { NotificationPriority } from '@sim/core/state';
import { dayIndex } from '@sim/core/time';
import { GameSession } from '@sim/session';
import { useFeeds } from '../app/chronicleFeeds';
import { useDevFlags } from '../app/devFlags';
import { setSessionFactory, useGame } from '../app/gameStore';
import { useNavigation } from '../app/navigation';
import { useNewSaga } from '../app/newSaga/store';
import { useNotifications } from '../app/notifications';
import { setMissingKeyWarnings } from '../i18n/index';
import { MemorySaveBackend } from '../saves/backend';
import { SaveManager, setSaveManager } from '../saves/saveManager';
import { defaultSettings } from '../settings/schema';
import { STORAGE_KEY, useSettings } from '../settings/store';

/** Something the scripted module does on a game day (`dayIndex`; the first daily tick is day 1). */
export interface TestScriptStep {
  day: number;
  notify?: { key: string; priority: NotificationPriority; link?: EntityLink };
  message?: { key: string; priority?: NotificationPriority };
  narrate?: { key: string; voice?: VoiceId };
  renown?: number;
}

/** A module that replays a script of notifications, messages, narration and standing changes. */
export function testShellScript(script: readonly TestScriptStep[]): SimModule {
  return {
    id: 'testShellScript',
    order: 5000,
    version: 1,
    systems: {
      daily(_draft, ctx) {
        const day = dayIndex(ctx.hour);
        for (const step of script) {
          if (step.day !== day) continue;
          if (step.narrate) ctx.narrate(step.narrate.key, {}, step.narrate.voice ?? 'skald');
          if (step.renown) ctx.applyEffects([{ op: 'changeRenown', amount: step.renown }]);
          if (step.notify) ctx.notify(step.notify.key, { priority: step.notify.priority, ...(step.notify.link ? { link: step.notify.link } : {}) });
          if (step.message) ctx.pend({ kind: 'message', payload: { key: step.message.key, vars: {}, ...(step.message.priority ? { priority: step.message.priority } : {}) } });
        }
      },
    },
  };
}

/** A core-only session (plus an optional script). */
export function testShellSession(opts: { seed?: string; script?: readonly TestScriptStep[]; options?: Partial<NewGameOptions> } = {}): GameSession {
  const modules = opts.script ? [testShellScript(opts.script)] : [];
  return GameSession.newGame({ seed: opts.seed ?? 'shell-test', player: { name: 'Sigrun', sex: 'female', culture: 'skarn' }, ...opts.options }, { modules });
}

/**
 * Resets every client store between tests: no campaign, default settings (and empty storage),
 * empty inbox/feeds/navigation, closed console, in-memory saves, and a core-only session factory.
 * Returns the save manager in use.
 */
export function resetClientState(script?: readonly TestScriptStep[]): SaveManager {
  setMissingKeyWarnings(false);
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // No storage in this environment.
  }
  useGame.getState().quit();
  useGame.setState({ paused: true, pauseReason: null, speed: 1, error: null });
  useSettings.setState({ settings: defaultSettings() });
  useNotifications.getState().clear();
  useFeeds.getState().clear();
  useNavigation.setState({ menuPage: { id: 'mainMenu', key: 0 }, stack: [], focusRequest: null });
  useDevFlags.setState({ revealMap: false, showIds: false, forceRealtime: false, consoleOpen: false });
  useNewSaga.getState().reset();
  const modules = script ? [testShellScript(script)] : [];
  setSessionFactory({
    newGame: (options) => GameSession.newGame(options, { modules }),
    load: (blob) => GameSession.load(blob, { modules }),
  });
  const saves = new SaveManager(new MemorySaveBackend());
  setSaveManager(saves);
  return saves;
}
