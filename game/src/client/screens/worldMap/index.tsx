/**
 * The world map / sea chart (SCR-12, design §8.10, §25.4): the Pixi chart (render/map/MapView) with a HUD — map
 * modes and legend, zoom bands, centre-on-home, a wind rose, hover tooltips and the selection card. Serves game
 * mode 'map' (the expedition scene) and the route 'chart' (consulting the sea chart from the hall). Selection is
 * reported through `onSelect`; in mode 'map' (`orders`) the expedition HUD gives the fleet its orders and the
 * settlement hub / cargo panels open while the fleet lies at a settlement.
 *
 * Steering (owner play-test 2026-11-14): in the expedition scene W A S D and the arrow keys steer the ship (or the
 * war-band ashore). One `steer` command goes out per change of the held direction; time runs at the chosen speed
 * while a direction is held and stops when every key is released. The camera follows the ship (dragging the map
 * detaches it; the follow button or a steering key brings it back). Shift + the keys pans the chart instead.
 * On a march (a land expedition) the same keys steer the war-band and the camera follows it.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { GameState } from '@sim/core/state';
import { getStaticWorld, type StaticWorld } from '@sim/modules/world/map/index';
import { useDevFlags } from '../../app/devFlags';
import { useGame } from '../../app/gameStore';
import { useNavigation } from '../../app/navigation';
import { useNotifications } from '../../app/notifications';
import { SteerKeys, type SteerKeyDir } from '../../input/steering';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { useT } from '../../i18n/index';
import { toCss } from '../../render/map/colors';
import { describeTarget, type TooltipContent } from '../../render/map/describe';
import { MapView } from '../../render/map/MapView';
import { mapModes } from '../../render/map/overlays';
import { buildMapScene } from '../../render/map/scene';
import type { MapModeId, MapTarget, OverlayData, ZoomBand } from '../../render/map/types';
import { Button, IconButton } from '../../ui/index';
import { ExpeditionHud, markSteerHintSeen } from '../expedition/hud';
import { CargoPanel, SettlementHub } from '../settlement/hub';
import '../expedition/expedition.css';
import '../settlement/settlement.css';
import './worldMap.css';

let worldMemo: StaticWorld | undefined;
function staticWorld(): StaticWorld {
  worldMemo ??= getStaticWorld();
  return worldMemo;
}

function Tip({ content, x, y }: { content: TooltipContent; x: number; y: number }): ReactElement {
  return (
    <div className="wm-tip" style={{ left: x + 16, top: y + 16 }} role="tooltip" data-testid="map-tooltip">
      <div className="wm-tip-title">{content.title}</div>
      {content.subtitle !== undefined && <div className="wm-tip-sub">{content.subtitle}</div>}
      {content.rows.length > 0 && (
        <dl className="wm-tip-rows">
          {content.rows.map((r) => (
            <div key={r.label}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** The chart for a given state (the screen, and the ?mapPreview page). */
export function WorldMap({ state, onClose, orders = false }: { state: GameState | null; onClose?: () => void; orders?: boolean }): ReactElement {
  const t = useT();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<MapView | null>(null);
  const [progress, setProgress] = useState(0);
  const [mode, setMode] = useState<MapModeId>('political');
  const [overlay, setOverlay] = useState<OverlayData | null>(null);
  const [band, setBand] = useState<ZoomBand>('world');
  const [hover, setHover] = useState<{ target: MapTarget; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<MapTarget | null>(null);
  const [following, setFollowing] = useState(false);
  const revealMap = useDevFlags((s) => s.revealMap);
  const hasExpedition = orders && state?.player.expeditionFleetId !== undefined;
  // A march (a land expedition): the camera follows the war-band.
  const expeditionFleet = state?.player.expeditionFleetId !== undefined ? state.fleets[state.player.expeditionFleetId] : undefined;
  const marching = expeditionFleet?.overland !== undefined;
  const world = staticWorld();
  const scene = useMemo(() => buildMapScene(world, state, {}), [world, state]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new MapView(world, {
      onProgress: setProgress,
      onOverlay: setOverlay,
      onBand: setBand,
      onHover: (target, x, y) => setHover(target && target.kind !== 'land' && target.kind !== 'sea' ? { target, x, y } : null),
      onSelect: setSelected,
      onFollow: setFollowing,
    });
    viewRef.current = view;
    let alive = true;
    void view.mount(host).then(() => {
      if (!alive) return;
      view.setState(useGame.getState().state ?? state);
      // The expedition scene follows the ship; the chart from the hall shows the player's attention once.
      if (orders && useGame.getState().state?.player.expeditionFleetId !== undefined) view.setFollow(true);
      else view.centreOnFocus();
    });
    return () => {
      alive = false;
      view.destroy();
      viewRef.current = null;
    };
    // The view is created once per mount; state changes flow through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  useEffect(() => {
    viewRef.current?.setState(state);
  }, [state]);
  useEffect(() => {
    viewRef.current?.setMode(mode);
  }, [mode]);
  useEffect(() => {
    viewRef.current?.setRevealAll(revealMap);
  }, [revealMap]);

  // Steering: W A S D / arrows hold a heading while the expedition is out (see the file header).
  const steerRef = useRef<SteerKeys | null>(null);
  useEffect(() => {
    if (!hasExpedition) return undefined;
    let sent: SteerKeyDir | null = null;
    const keys = new SteerKeys({
      blocked: () => {
        const g = useGame.getState();
        return (
          g.state?.pending != null ||
          useNavigation.getState().stack.length > 0 ||
          useNotifications.getState().critical.length > 0 ||
          useDevFlags.getState().consoleOpen
        );
      },
      onChange: (dir) => {
        const g = useGame.getState();
        const out = g.state?.player.expeditionFleetId !== undefined;
        if (dir !== null) {
          if (!out) return;
          const r = g.dispatch({ type: 'steer', dir });
          if (!r || r.error) return;
          sent = dir;
          markSteerHintSeen();
          viewRef.current?.setFollow(true);
          // Time runs while a heading is held (at the chosen speed).
          g.setPaused(false);
          return;
        }
        if (sent !== null) {
          sent = null;
          if (out) g.dispatch({ type: 'steer', dir: 'stop' });
          useGame.getState().setPaused(true);
        }
      },
    });
    steerRef.current = keys;
    const detach = keys.attach(window);
    return () => {
      detach();
      steerRef.current = null;
    };
  }, [hasExpedition]);

  // A decision, an overlay or a critical alert takes the keys: let go of the helm.
  const pendingNow = state?.pending != null;
  const overlays = useNavigation((s) => s.stack.length);
  const criticals = useNotifications((s) => s.critical.length);
  const consoleOpen = useDevFlags((s) => s.consoleOpen);
  useEffect(() => {
    if (pendingNow || overlays > 0 || criticals > 0 || consoleOpen) steerRef.current?.releaseAll();
  }, [pendingNow, overlays, criticals, consoleOpen]);

  // Keyboard: arrows/WASD pan (Shift + them while the expedition is out), +/- zoom, H home.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const v = viewRef.current;
      if (!v) return;
      const step = 80;
      const k = e.key.toLowerCase();
      const steerKey = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's'].includes(k);
      // While the expedition is out the plain keys steer; Shift + them pans the chart.
      if (steerKey && hasExpedition && !e.shiftKey) return;
      if (k === 'arrowleft' || k === 'a') v.panScreen(-step, 0);
      else if (k === 'arrowright' || k === 'd') v.panScreen(step, 0);
      else if (k === 'arrowup' || k === 'w') v.panScreen(0, -step);
      else if (k === 'arrowdown' || k === 's') v.panScreen(0, step);
      else if (k === '+' || k === '=') v.zoomBy(1.25);
      else if (k === '-' || k === '_') v.zoomBy(0.8);
      else if (k === 'h') v.centreOnFocus();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasExpedition]);

  const ctx = { world, scene, state };
  const hoverTip = hover ? describeTarget(hover.target, ctx) : null;
  const selectedTip = selected && selected.kind !== 'sea' && selected.kind !== 'land' ? describeTarget(selected, ctx) : null;
  const focusZone = scene.focus ? world.zoneOf[Math.floor(scene.focus[1]) * world.width + Math.floor(scene.focus[0])] : -1;
  const wind = scene.winds.find((w) => w.zoneIndex === focusZone) ?? scene.winds[0];

  return (
    <div className="wm" data-testid="world-map" data-band={band} data-mode={mode}>
      <div className="wm-canvas" ref={hostRef} data-testid="world-map-canvas" />
      {progress < 1 && (
        <div className="wm-loading" data-testid="world-map-loading">
          <div>{t('map.ui.loading')}</div>
          <div className="wm-loading-bar">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      )}
      <div className="wm-hud wm-hud-modes" role="toolbar" aria-label={t('map.ui.modes')}>
        {mapModes().map((m) => (
          <Button key={m.id} size="sm" variant={mode === m.id ? 'primary' : 'ghost'} pressed={mode === m.id} onClick={() => setMode(m.id as MapModeId)} data-testid={`map-mode-${m.id}`}>
            {t(m.labelKey)}
          </Button>
        ))}
        {onClose && <IconButton icon="close" label={t('map.ui.close')} onClick={onClose} data-testid="map-close" />}
      </div>
      <div className="wm-hud wm-hud-zoom">
        <IconButton icon="plus" label={t('map.ui.zoomIn')} onClick={() => viewRef.current?.zoomBy(1.4)} data-testid="map-zoom-in" />
        <IconButton icon="minus" label={t('map.ui.zoomOut')} onClick={() => viewRef.current?.zoomBy(1 / 1.4)} data-testid="map-zoom-out" />
        {(['world', 'region', 'local'] as const).map((b) => (
          <Button key={b} size="sm" variant={band === b ? 'primary' : 'ghost'} pressed={band === b} onClick={() => viewRef.current?.zoomToBand(b)} data-testid={`map-band-${b}`}>
            {t(`map.ui.zoom${b[0]?.toUpperCase()}${b.slice(1)}`)}
          </Button>
        ))}
        <IconButton icon="crown" label={t('map.ui.home')} onClick={() => viewRef.current?.centreOnFocus()} data-testid="map-home" />
        {hasExpedition && (
          <IconButton
            icon={marching ? 'men' : 'ship'}
            label={marching ? t('map.ui.followBand') : t('map.ui.followShip')}
            pressed={following}
            onClick={() => viewRef.current?.setFollow(true)}
            data-testid="map-follow"
          />
        )}
      </div>
      {overlay && overlay.legend.length > 0 && (
        <div className="wm-hud wm-legend" data-testid="map-legend" aria-label={t('map.ui.legend')}>
          <div className="wm-legend-title">{t(`map.mode.${mode}`)}</div>
          <ul>
            {overlay.legend.slice(0, 12).map((item, i) => (
              <li key={`${item.labelKey ?? item.label ?? ''}-${i}`}>
                <span className={`wm-swatch${item.line ? ` wm-swatch-${item.line}` : ''}`} style={{ background: item.line ? 'transparent' : toCss(item.color), borderColor: toCss(item.color) }} />
                <span>{item.label ?? (item.labelKey ? t(item.labelKey, item.vars) : '')}</span>
              </li>
            ))}
          </ul>
          {overlay.noteKey !== undefined && <p className="wm-legend-note">{t(overlay.noteKey)}</p>}
        </div>
      )}
      {wind && (
        <div className="wm-hud wm-wind" title={t('map.ui.windRose')} data-testid="map-wind">
          <svg viewBox="-20 -20 40 40" width="56" height="56" aria-hidden="true">
            <circle r="17" fill="none" stroke="currentColor" strokeOpacity="0.5" />
            <text y="-11" textAnchor="middle" fontSize="7" fill="currentColor">N</text>
            <g transform={`rotate(${wind.fromDeg + 180})`}>
              <path d="M0 -13 L4 4 L0 1 L-4 4 Z" fill="currentColor" />
            </g>
          </svg>
          <div>{t(`map.wind.${wind.strength}`)}</div>
        </div>
      )}
      {revealMap && <div className="wm-hud wm-reveal">{t('map.ui.revealed')}</div>}
      {selectedTip && (
        <div className="wm-hud wm-selected" data-testid="map-selected">
          <div className="wm-tip-title">{selectedTip.title}</div>
          {selectedTip.subtitle !== undefined && <div className="wm-tip-sub">{selectedTip.subtitle}</div>}
          <dl className="wm-tip-rows">
            {selectedTip.rows.map((r) => (
              <div key={r.label}>
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {orders && state && <ExpeditionHud state={state} selected={selected} />}
      {orders && state && <SettlementHub state={state} />}
      {orders && state && state.settlementsState?.inside === undefined && <CargoPanel state={state} />}
      {hoverTip && hover && <Tip content={hoverTip} x={hover.x} y={hover.y} />}
    </div>
  );
}

function WorldMapScreen({ close }: ScreenProps): ReactElement {
  const state = useGame((s) => s.state);
  return <WorldMap state={state} onClose={close} />;
}

/** The expedition scene: the chart with the fleet's orders, the settlement hub and the cargo screen. */
function ExpeditionScene(_props: ScreenProps): ReactElement {
  const state = useGame((s) => s.state);
  return <WorldMap state={state} orders />;
}

/** The expedition scene (mode 'map') and the sea chart opened from the hall (route 'chart'). */
export const screens: ScreenDescriptor[] = [
  { id: 'worldMap', mode: 'map', component: ExpeditionScene, layout: 'scene', titleKey: 'map.ui.title' },
  { id: 'seaChart', route: 'chart', component: WorldMapScreen, layout: 'fullscreen', titleKey: 'map.ui.title' },
];
