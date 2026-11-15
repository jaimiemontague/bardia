/**
 * The sea-battle scene: the Pixi sea (render/seaBattle/SeaView) under the HUD, driven by one
 * SeaController. Shared by the campaign's sea-battle screen (mode 'seaBattle') and the Skirmish
 * route; the host decides what the summary's button does (`onDone`) and what "leave" means in the
 * battle menu.
 *
 * Keys (read in the 'battle' input context, so they also work in a Skirmish outside a campaign):
 * Space pause, 1 to 9 ships, Ctrl+A every ship, H hold, C follow the fight, Esc the battle menu,
 * arrows pan, + and - zoom.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { playSfx, useSfxLoop } from '../../audio/index';
import { getShortcutManager } from '../../app/inputRuntime';
import { useDevFlags } from '../../app/devFlags';
import { useNavigation } from '../../app/navigation';
import { comboFromEvent, type InputContext } from '../../input/bindings';
import { useT } from '../../i18n/index';
import { SeaView } from '../../render/seaBattle/SeaView';
import { Button } from '../../ui/index';
import type { SeaController } from './controller';
import { ConfirmWithdraw, DuelCard, FastForward, FleetBar, HowTo, PauseMenu, ShipCards, Summary, Ticker, TopBar } from './hud';
import './seaBattle.css';

const CONTEXTS: ReadonlySet<InputContext> = new Set<InputContext>(['global', 'battle']);

export interface SeaBattleSceneProps {
  controller: SeaController;
  title: string;
  /** Character id → display name (the enemy captain in a duel). */
  nameOf?(id: string): string | undefined;
  doneLabelKey: string;
  /** Hands the result back; returns an error text to show, or null. */
  onDone(): string | null;
  summaryExtra?: ReactNode;
  leave: { labelKey: string; onClick(): void };
  fallback?: ReactNode;
}

export function SeaBattleScene({ controller: c, title, nameOf, doneLabelKey, onDone, summaryExtra, leave, fallback }: SeaBattleSceneProps): ReactElement {
  const t = useT();
  useSyncExternalStore(c.subscribe, c.getVersion);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<SeaView | null>(null);
  const [howTo, setHowTo] = useState(c.snap.tick === 0);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [hover, setHover] = useState<{ ship: number; x: number; y: number } | null>(null);
  const [following, setFollowing] = useState(true);
  const [showSummary, setShowSummary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The running battle is exposed for the browser tests and the console (as the land battle does).
  useEffect(() => {
    const w = window as unknown as { __bardiaSeaBattle?: SeaController };
    w.__bardiaSeaBattle = c;
    return () => {
      if (w.__bardiaSeaBattle === c) delete w.__bardiaSeaBattle;
    };
  }, [c]);

  // Pixi view: created once per controller.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const view = new SeaView(c, {
      click: (x, y, tol, inf, add) => c.clickAt(x, y, tol, inf, add),
      doubleClick: (x, y, tol, inf) => c.doubleClickAt(x, y, tol, inf),
      box: (x0, y0, x1, y1, add) => c.selectBox(x0, y0, x1, y1, add),
      command: (x, y, tol, inf) => c.commandAt(x, y, tol, inf),
      hover: (ship, x, y) => setHover(ship >= 0 ? { ship, x, y } : null),
      frame: (dt) => {
        c.frame(dt);
        for (const cue of c.drainCues()) {
          try {
            playSfx(cue.id as never, cue.params as never);
          } catch {
            // audio unavailable: silent
          }
        }
      },
      follow: (on) => setFollowing(on),
    });
    viewRef.current = view;
    void view.mount(host);
    const w = window as unknown as { __bardiaSeaView?: SeaView };
    w.__bardiaSeaView = view;
    return () => {
      if (w.__bardiaSeaView === view) delete w.__bardiaSeaView;
      view.destroy();
      viewRef.current = null;
    };
  }, [c]);

  // The sea under the fight.
  useSfxLoop('sea.waves', { wind: c.snap.wind.str }, true, 1.2);

  const ended = c.snap.status === 'ended';
  useEffect(() => {
    if (!ended) return undefined;
    const timer = setTimeout(() => setShowSummary(true), 1400);
    return () => clearTimeout(timer);
  }, [ended]);

  const anyCard = howTo || menu || confirm || showSummary || (c.snap.duel !== null && !c.fastForward);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useNavigation.getState().stack.length > 0 || useDevFlags.getState().consoleOpen) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const combo = comboFromEvent(e);
      if (combo === '') return;
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.code === 'Escape') {
        stop();
        if (confirm) setConfirm(false);
        else if (howTo) setHowTo(false);
        else if (menu) {
          setMenu(false);
          c.setPaused(false);
        } else if (!showSummary && !ended) {
          c.setPaused(true);
          setMenu(true);
        }
        return;
      }
      if (anyCard) return;
      const v = viewRef.current;
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        stop();
        const step = 110;
        v?.panScreen(e.code === 'ArrowLeft' ? -step : e.code === 'ArrowRight' ? step : 0, e.code === 'ArrowUp' ? -step : e.code === 'ArrowDown' ? step : 0);
        return;
      }
      if (combo === 'Equal' || combo === 'NumpadAdd' || combo === 'Shift+Equal') {
        stop();
        v?.zoomBy(1.25);
        return;
      }
      if (combo === 'Minus' || combo === 'NumpadSubtract') {
        stop();
        v?.zoomBy(1 / 1.25);
        return;
      }
      if (combo === 'Ctrl+KeyA') {
        stop();
        c.selectAll();
        return;
      }
      if (combo === 'KeyC' || combo === 'Home') {
        stop();
        v?.setFollow(true);
        return;
      }
      if (combo === 'KeyH') {
        stop();
        c.holdSelected();
        return;
      }
      const digit = /^(Shift\+)?(?:Digit|Numpad)([1-9])$/.exec(combo);
      if (digit) {
        stop();
        c.selectIndex(Number(digit[2]), e.shiftKey);
        return;
      }
      const action = getShortcutManager().resolve(combo, CONTEXTS)?.id;
      if (action === 'time.togglePause' || e.code === 'Space') {
        stop();
        c.togglePause();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [c, anyCard, confirm, howTo, menu, showSummary, ended]);

  const summary = useMemo(() => (showSummary ? c.summary() : null), [c, showSummary]);
  const focus = (x: number, y: number) => viewRef.current?.centreOn(x, y);
  const notice = c.notice && c.realTime - c.notice.at < 2.6 ? c.notice.key : null;
  const openMenu = () => {
    c.setPaused(true);
    setMenu(true);
  };

  return (
    <div className="sv-root" data-testid="sea-battle-screen" data-status={c.snap.status} data-paused={c.paused ? 'true' : 'false'}>
      <div className="sv-field" ref={hostRef} />
      <TopBar c={c} title={title} onMenu={openMenu} onWithdraw={() => setConfirm(true)} />
      {!showSummary && <FleetBar c={c} />}
      {!showSummary && <ShipCards c={c} onFocus={focus} />}
      {!showSummary && <Ticker c={c} onFocus={focus} />}
      {!following && !anyCard && (
        <button type="button" className="sv-follow" onClick={() => viewRef.current?.setFollow(true)} data-testid="sea-follow">
          {t('seaView.follow')}
        </button>
      )}
      {c.paused && !anyCard && !ended && (
        <button type="button" className="sv-paused" onClick={() => c.setPaused(false)} data-testid="sea-paused-banner">
          {t('seaView.pausedBanner')}
        </button>
      )}
      {notice && (
        <div className="sv-notice" role="status" data-testid="sea-notice">
          {t(notice)}
        </div>
      )}
      {hover && !anyCard && <HoverTip c={c} ship={hover.ship} x={hover.x} y={hover.y} />}
      {c.fastForward && !ended && <FastForward />}
      {howTo && (
        <HowTo
          onPlan={() => setHowTo(false)}
          onStart={() => {
            setHowTo(false);
            c.setPaused(false);
          }}
        />
      )}
      {menu && !showSummary && (
        <PauseMenu
          onResume={() => {
            setMenu(false);
            c.setPaused(false);
          }}
          onCaptains={() => {
            setMenu(false);
            c.letCaptainsFinish();
          }}
          onWithdraw={() => {
            setMenu(false);
            setConfirm(true);
          }}
          onHelp={() => {
            setMenu(false);
            setHowTo(true);
          }}
          leave={leave}
        />
      )}
      {confirm && !showSummary && (
        <ConfirmWithdraw
          onNo={() => setConfirm(false)}
          onYes={() => {
            setConfirm(false);
            c.withdrawAll();
          }}
        />
      )}
      {!showSummary && <DuelCard c={c} captainName={(id) => nameOf?.(id)} />}
      {summary && (
        <Summary summary={summary} error={error}>
          {summaryExtra}
          {error && fallback}
          <Button
            variant="primary"
            icon="arrowRight"
            busy={busy}
            onClick={() => {
              setBusy(true);
              const err = onDone();
              setBusy(false);
              setError(err);
            }}
            data-autofocus
            data-testid="sea-return"
          >
            {t(doneLabelKey)}
          </Button>
        </Summary>
      )}
    </div>
  );
}

function HoverTip({ c, ship, x, y }: { c: SeaController; ship: number; x: number; y: number }): ReactElement | null {
  const t = useT();
  const s = c.ship(ship);
  if (!s) return null;
  const own = s.side === c.side;
  const sel = c.selectedShips();
  const left = Math.min(x + 18, (typeof window !== 'undefined' ? window.innerWidth : 1600) - 280);
  return (
    <div className="sv-tip" style={{ left, top: y + 18 }} role="tooltip" data-testid="sea-hover-tip">
      <div className="sv-tip-title">
        <span className={`sv-swatch ${own ? 'is-own' : 'is-foe'}`} /> {s.name}
      </div>
      <div className="muted">
        {c.typeName(s.type)} · {t('seaView.card.crew', { crew: Math.round(s.crew) })}
      </div>
      {!own && sel.length > 0 && s.status === 'active' && <div className="sv-tip-hint">{t('seaView.hint.attack', { style: t(`seaView.style.${c.styleOf(sel[0]!.idx)}`) })}</div>}
    </div>
  );
}
