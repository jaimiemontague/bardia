/**
 * App-wide action handlers (design §25.6). Mounted once by the App; screens and modals mounted later
 * take precedence (newest handler first) and may return false to pass an action on.
 *
 *   Space/1/2/3/−/=   time controls (only while a real-time scene is shown)
 *   C F L J G I F1    Character, Family, Ledger, Chronicle, Saga Ledger, Inbox, Codex (toggle)
 *   Esc               back: close the console / pop an overlay / open the game menu / main menu
 *   F5                quick save      `  dev console      D-pad/A  controller focus navigation
 */
import { useEffect } from 'react';
import { actionBus } from '../input/actions';
import { moveFocus } from '../input/gamepad';
import { useSettings } from '../settings/store';
import { devToolsAllowed, useDevFlags } from './devFlags';
import { useGame } from './gameStore';
import { quickSave } from './lifecycle';
import { useNavigation } from './navigation';
import { isRealtimeMode } from './realtime';
import type { ScreenRegistry } from './screenRegistry';
import type { TimeSpeed } from './clock';

/** Top-bar routes opened by the global keys. */
export const OPEN_ACTION_ROUTES: Readonly<Record<string, string>> = {
  'open.character': 'character',
  'open.family': 'family',
  'open.ledger': 'ledger',
  'open.chronicle': 'chronicle',
  'open.sagaLedger': 'sagaLedger',
  'open.inbox': 'inbox',
  'open.codex': 'codex',
};

function inGame(): boolean {
  return useGame.getState().session !== null;
}

function realtimeNow(registry: ScreenRegistry | null): boolean {
  const st = useGame.getState().state;
  return st !== null && isRealtimeMode(st.meta.mode, registry, useDevFlags.getState().forceRealtime);
}

/** Installs the global handlers on the action bus; returns the uninstall function. */
export function installGlobalActions(registry: ScreenRegistry | null): () => void {
  const offs: (() => void)[] = [];
  const on = (action: string, fn: () => boolean | void) => offs.push(actionBus.on(action, (info) => (info.phase === 'up' ? false : fn())));

  on('time.togglePause', () => {
    if (!inGame() || !realtimeNow(registry)) return false;
    useGame.getState().togglePause();
    return true;
  });
  const speeds: [string, TimeSpeed][] = [
    ['time.speed1', 1],
    ['time.speed2', 2],
    ['time.speed4', 4],
  ];
  for (const [action, speed] of speeds) {
    on(action, () => {
      if (!inGame() || !realtimeNow(registry)) return false;
      useGame.getState().setSpeed(speed);
      return true;
    });
  }
  on('time.slower', () => {
    if (!inGame() || !realtimeNow(registry)) return false;
    useGame.getState().stepSpeed(-1);
    return true;
  });
  on('time.faster', () => {
    if (!inGame() || !realtimeNow(registry)) return false;
    useGame.getState().stepSpeed(1);
    return true;
  });

  for (const [action, route] of Object.entries(OPEN_ACTION_ROUTES)) {
    on(action, () => {
      if (!inGame()) return false;
      useNavigation.getState().toggle(route);
      return true;
    });
  }

  on('game.quicksave', () => {
    if (!inGame()) return false;
    void quickSave();
    return true;
  });

  on('ui.back', () => {
    const dev = useDevFlags.getState();
    if (dev.consoleOpen) {
      dev.toggleConsole(false);
      return true;
    }
    const nav = useNavigation.getState();
    if (inGame()) {
      if (nav.back()) return true;
      nav.open('gameMenu');
      return true;
    }
    if (nav.menuPage.id !== 'mainMenu') {
      nav.showMenu('mainMenu');
      return true;
    }
    return false;
  });

  on('dev.console', () => {
    if (!devToolsAllowed(useSettings.getState().settings.dev.console)) return false;
    useDevFlags.getState().toggleConsole();
    return true;
  });

  const nav = (dir: 'up' | 'down' | 'left' | 'right') => () => (typeof document === 'undefined' ? false : moveFocus(dir));
  on('ui.navUp', nav('up'));
  on('ui.navDown', nav('down'));
  on('ui.navLeft', nav('left'));
  on('ui.navRight', nav('right'));
  on('ui.confirm', () => {
    const el = typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);
    if (!el || el === document.body) return moveFocus('down');
    el.click();
    return true;
  });

  return () => {
    for (const off of offs) off();
  };
}

/** React wrapper: installs the global handlers for the lifetime of the component. */
export function useGlobalActions(registry: ScreenRegistry | null): void {
  useEffect(() => installGlobalActions(registry), [registry]);
}
