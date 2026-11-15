/**
 * Client entry point. Boot order: theme and fonts → the registry-bound session factory → settings
 * applied to <html> (and kept in sync) → client services on the sim-event bus → keyboard shortcuts
 * and controller polling → the screen registry → React.
 */
import './theme/fonts';
import './theme/theme.css';
import './ui/index';
import './shell/shell.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GameSession } from '@sim/index';
import { App } from './app/App';
import { setSessionFactory } from './app/gameStore';
import { getShortcutManager } from './app/inputRuntime';
import { getScreenRegistry } from './app/registry';
import { installGameServices } from './app/services';
import { installEventLog } from './devtools/eventLog';
import { setLanguage } from './i18n/index';
import { actionBus } from './input/actions';
import { startGamepadPolling } from './input/gamepad';
import { applySettingsToDocument } from './settings/apply';
import { useSettings } from './settings/store';
import { MapPreview } from './screens/worldMap/preview';

/** A carved-rune tab icon (inline, so no /favicon.ico request); the owner's icon can replace it in index.html. */
function installFavicon(): void {
  if (document.querySelector('link[rel~="icon"]')) return;
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='12' fill='#1d140d'/><rect x='3' y='3' width='58' height='58' rx='10' fill='none' stroke='#6f6a62' stroke-width='3'/><path d='M22 12v40M22 12l18 10-18 10 18 10-18 10' fill='none' stroke='#e2b85d' stroke-width='6' stroke-linejoin='round' stroke-linecap='round'/></svg>";
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  document.head.appendChild(link);
}

setSessionFactory({
  newGame: (options) => GameSession.newGame(options),
  load: (blob) => GameSession.load(blob),
});

applySettingsToDocument(useSettings.getState().settings);
setLanguage(useSettings.getState().settings.language);
useSettings.subscribe((s, prev) => {
  if (s.settings !== prev.settings) {
    applySettingsToDocument(s.settings);
    setLanguage(s.settings.language);
  }
});

installFavicon();
installGameServices();
installEventLog();
getShortcutManager().attach(window);
startGamepadPolling(actionBus, () => useSettings.getState().settings.controls.gamepad);

const container = document.getElementById('root');
if (!container) throw new Error('#root missing');
const mapPreview = new URLSearchParams(window.location.search).has('mapPreview');
createRoot(container).render(
  <StrictMode>{mapPreview ? <MapPreview /> : <App registry={getScreenRegistry()} />}</StrictMode>,
);
