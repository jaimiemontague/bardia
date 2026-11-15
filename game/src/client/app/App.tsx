/**
 * The root component: the menu pages while no campaign is open, the game shell during one, plus the
 * toast stack and the developer console on top of either. Provides the screen registry as context.
 */
import type { ReactElement } from 'react';
import { DevConsole } from '../devtools/DevConsole';
import { GameShell } from '../shell/GameShell';
import { MenuHost } from '../shell/RouteHost';
import { Toasts } from '../shell/Toasts';
import { ErrorBoundary } from '../shell/ErrorBoundary';
import { useGame } from './gameStore';
import { useGlobalActions } from './globalActions';
import { ScreenRegistryContext } from './registryContext';
import type { ScreenRegistry } from './screenRegistry';

/** The application. */
export function App({ registry }: { registry: ScreenRegistry }): ReactElement {
  const inGame = useGame((s) => s.session !== null);
  useGlobalActions(registry);
  return (
    <ScreenRegistryContext.Provider value={registry}>
      <ErrorBoundary where={inGame ? 'game' : 'menu'}>{inGame ? <GameShell registry={registry} /> : <MenuHost registry={registry} />}</ErrorBoundary>
      <Toasts />
      <DevConsole registry={registry} />
    </ScreenRegistryContext.Provider>
  );
}
