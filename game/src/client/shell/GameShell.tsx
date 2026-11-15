/**
 * The in-game shell (§25.1 consistent layout): top bar · scene (the screen registered for
 * `state.meta.mode`) · bottom strip (narration + notification feed), with the pending-decision host,
 * Critical notifications and overlay routes above it. Owns the real-time loop.
 */
import type { ReactElement } from 'react';
import { useDevFlags } from '../app/devFlags';
import { useGame } from '../app/gameStore';
import { useNavigation } from '../app/navigation';
import { useNotifications } from '../app/notifications';
import { isRealtimeMode, useRealtimeLoop } from '../app/realtime';
import type { ScreenRegistry } from '../app/screenRegistry';
import { ComingSoonScene } from './ComingSoon';
import { CriticalHost } from './CriticalHost';
import { DecisionHost } from './DecisionHost';
import { ErrorBoundary } from './ErrorBoundary';
import { NarrationBar } from './NarrationBar';
import { NotificationFeed } from './NotificationFeed';
import { RouteHost } from './RouteHost';
import { TopBar } from './TopBar';

/** Locale key for why time is soft-paused, or null. */
function useBlockedKey(): string | null {
  const pending = useGame((s) => (s.state?.pending ?? null) !== null);
  const critical = useNotifications((s) => s.critical.length > 0);
  const overlay = useNavigation((s) => s.stack.length > 0);
  const consoleOpen = useDevFlags((s) => s.consoleOpen);
  if (pending) return 'ui.time.pausedForDecision';
  if (critical) return 'ui.time.pausedForCritical';
  if (overlay) return 'ui.time.pausedForOverlay';
  if (consoleOpen) return 'ui.time.pausedForConsole';
  return null;
}

/** The game shell. */
export function GameShell({ registry }: { registry: ScreenRegistry }): ReactElement {
  const mode = useGame((s) => s.state?.meta.mode ?? 'hub');
  const forceRealtime = useDevFlags((s) => s.forceRealtime);
  const blockedKey = useBlockedKey();
  useRealtimeLoop(registry);
  const scene = registry.forMode(mode);
  const layout = scene?.layout ?? 'scene';
  const chrome = layout !== 'fullscreen';
  const realtime = isRealtimeMode(mode, registry, forceRealtime);
  const SceneComponent = scene?.component;

  return (
    <div className={`shell shell-${layout}`} data-mode={mode} data-testid="game-shell">
      {chrome && <TopBar realtime={realtime} blockedKey={blockedKey} />}
      <main className="shell-scene" id="scene">
        <ErrorBoundary key={mode} where={scene?.id ?? mode}>
          {SceneComponent ? <SceneComponent params={{ mode }} close={() => {}} /> : <ComingSoonScene mode={mode} />}
        </ErrorBoundary>
      </main>
      {chrome && (
        <footer className="shell-bottom">
          <NarrationBar />
          <NotificationFeed />
        </footer>
      )}
      <ErrorBoundary where="decision">
        <DecisionHost registry={registry} />
      </ErrorBoundary>
      <CriticalHost />
      <ErrorBoundary where="route" onDismiss={() => useNavigation.getState().back()}>
        <RouteHost registry={registry} />
      </ErrorBoundary>
    </div>
  );
}
