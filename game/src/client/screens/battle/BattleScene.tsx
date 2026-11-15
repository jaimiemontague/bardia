/**
 * The battle scene: the Pixi battlefield (render/battle/BattleView) under the HUD, driven by one
 * BattleController. Shared by the campaign's battle screen (mode 'battle') and the Skirmish route; the
 * host decides what the end-of-battle button does (`onDone`) and what "leave" means in the pause menu.
 *
 * Keys. Direct control (keys.ts, owner play-test 2026-11-15): W A S D or the arrows drive the
 * selected squads (Shift runs), Space charges ahead or draws an aimed volley, P pauses, Tab steps
 * through the squads, C brings the camera back. Rebindable through the shell's bindings (read in the
 * 'battle' context so they also work in a Skirmish outside a campaign): 1/2/3… squads, F formation,
 * Q shield wall, E volley or torch, R rally, T challenge, Backspace retreat. Esc cancels or opens
 * the pause menu, +/- zoom, Ctrl+A selects all. Right-click orders stay as a second way to command.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { comboFromEvent, type InputContext } from '../../input/bindings';
import { getShortcutManager } from '../../app/inputRuntime';
import { useNavigation } from '../../app/navigation';
import { useDevFlags } from '../../app/devFlags';
import { useMusicState } from '../../audio/hooks';
import { battleMusic, outcomeMusic } from '../../audio/screenMusic';
import { useT } from '../../i18n/index';
import { BattleView, type BattleHover } from '../../render/battle/BattleView';
import { Button } from '../../ui/index';
import type { BattleController } from './controller';
import { BattleLog, ConfirmRetreat, DuelCard, FastForward, HowTo, MoraleExplain, Objectives, PauseMenu, Roster, SquadPanel, TopBar } from './hud';
import { BattleResultScene } from './ResultScene';
import { BattleKeys } from './keys';
import { summarize } from './summary';
import './battle.css';

const BATTLE_CONTEXTS: ReadonlySet<InputContext> = new Set<InputContext>(['global', 'battle']);

export interface BattleSceneProps {
  controller: BattleController;
  /** Title in the top bar ("Raid at Fennow"). */
  title: string;
  /** Leader id → display name (campaign characters); the setup's own names otherwise. */
  nameOf?(id: string): string | undefined;
  /** Label of the summary's main button and what it does with the result. Returns an error text to show, or null. */
  doneLabelKey: string;
  onDone(): string | null;
  /** Extra buttons on the summary (Skirmish: fight again). */
  summaryExtra?: ReactNode;
  /** The pause menu's last entry (campaign: the game menu; Skirmish: leave). */
  leave: { labelKey: string; onClick(): void };
  /** Shown when `onDone` failed: a fallback button (campaign: return with the auto-resolved result). */
  fallback?: ReactNode;
}

/** The playable battle scene. */
export function BattleScene({ controller: c, title, nameOf, doneLabelKey, onDone, summaryExtra, leave, fallback }: BattleSceneProps): ReactElement {
  const t = useT();
  useSyncExternalStore(c.subscribe, c.getVersion);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<BattleView | null>(null);
  const [howTo, setHowTo] = useState(c.snap.tick === 0);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [hover, setHover] = useState<{ target: BattleHover; x: number; y: number } | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keys = useMemo(() => new BattleKeys(c), [c]);

  // The running battle is exposed for the browser tests and the console (as the sea battle does), in every build:
  // the browser tests run against the production build and drive the battle with the keys.
  useEffect(() => {
    const w = window as unknown as { __bardiaBattle?: BattleController };
    w.__bardiaBattle = c;
    return () => {
      if (w.__bardiaBattle === c) delete w.__bardiaBattle;
    };
  }, [c]);

  // Pixi view: created once per controller.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const view = new BattleView(
      c,
      {
        click: (x, y, add) => c.clickAt(x, y, add),
        doubleClick: (x, y) => c.doubleClickAt(x, y),
        box: (x0, y0, x1, y1, add) => c.selectBox(x0, y0, x1, y1, add),
        command: (x, y, opts) => c.commandAt(x, y, opts),
        hover: (target, x, y) => setHover(target ? { target, x, y } : null),
        cancel: () => c.cancelTargeting(),
        lookAround: () => c.setFollow(false),
        frame: (dt) => c.frame(dt),
      },
      c.content,
    );
    viewRef.current = view;
    void view.mount(host);
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [c]);

  const ended = c.snap.status === 'ended';
  // Give the field a moment to show the end before the summary covers it.
  useEffect(() => {
    if (!ended) return undefined;
    const timer = setTimeout(() => setShowSummary(true), 1200);
    return () => clearTimeout(timer);
  }, [ended]);

  const anyCard = howTo || menu || confirm || showSummary || c.snap.duel !== null;

  // A card coming up (or the window losing focus) lets go of every held key: the squads halt.
  useEffect(() => {
    if (anyCard) keys.releaseAll();
  }, [anyCard, keys]);
  useEffect(() => {
    const up = (e: KeyboardEvent) => {
      if (keys.keyUp(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const blur = () => keys.releaseAll();
    const vis = () => {
      if (document.visibilityState === 'hidden') keys.releaseAll();
    };
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', vis);
      keys.releaseAll();
    };
  }, [keys]);

  // Keyboard (capture phase: the battle's keys win over the shell's while the scene has no card up).
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
        if (c.targeting !== null) c.cancelTargeting();
        else if (confirm) setConfirm(false);
        else if (howTo) setHowTo(false);
        else if (menu) setMenu(false);
        else if (!showSummary) {
          c.setPaused(true);
          setMenu(true);
        }
        return;
      }
      if (anyCard) return;
      // Direct control first: W A S D / arrows, Shift, Space, P, Tab, C.
      if (keys.keyDown(e)) {
        stop();
        return;
      }
      const v = viewRef.current;
      if (combo === 'Equal' || combo === 'NumpadAdd' || combo === 'Shift+Equal') {
        stop();
        v?.zoomBy(1.2);
        return;
      }
      if (combo === 'Minus' || combo === 'NumpadSubtract') {
        stop();
        v?.zoomBy(1 / 1.2);
        return;
      }
      if (combo === 'Ctrl+KeyA') {
        stop();
        c.selectAll();
        return;
      }
      const digit = /^(Shift\+)?Digit([1-8])$/.exec(combo);
      const action = getShortcutManager().resolve(combo, BATTLE_CONTEXTS)?.id;
      const squadAction = action !== undefined ? /^battle\.squad([1-8])$/.exec(action) : null;
      if (squadAction || digit) {
        stop();
        const k = Number(squadAction ? squadAction[1] : digit![2]);
        c.selectIndex(k, e.shiftKey);
        return;
      }
      switch (action) {
        case 'time.togglePause':
          stop();
          c.togglePause();
          return;
        case 'battle.cycleFormation':
          stop();
          c.cycleFormation();
          return;
        case 'battle.shieldWall':
          stop();
          c.useAbility('shieldWall');
          return;
        case 'battle.charge':
          stop();
          c.useAbility('charge');
          return;
        case 'battle.torchVolley':
          stop();
          c.useAbility(c.abilityReady('volley').has ? 'volley' : 'torch');
          return;
        case 'battle.rally':
          stop();
          c.useAbility('rally');
          return;
        case 'battle.challenge':
          stop();
          c.useAbility('challenge');
          return;
        case 'battle.retreat':
          stop();
          c.retreatSelected();
          return;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [c, keys, anyCard, confirm, howTo, menu, showSummary]);

  const summary = useMemo(() => {
    const r = c.result();
    return r && showSummary ? summarize(c.setup, r, c.side, (id) => nameOf?.(id)) : null;
  }, [c, showSummary, nameOf]);
  // The fight's music, then victory (or the funeral music for a loss) when the result scene is up.
  useMusicState((summary && outcomeMusic(summary.outcome)) ?? battleMusic(c.setup.kind));

  const focus = (x: number, y: number) => {
    c.setFollow(false);
    viewRef.current?.centreOn(x, y);
  };
  const notice = c.notice && c.realTime - c.notice.at < 2.5 ? c.notice.key : null;

  return (
    <div className={`bv-root${c.targeting !== null ? ' is-targeting' : ''}`} data-testid="battle-screen" data-status={c.snap.status} data-paused={c.paused ? 'true' : 'false'}>
      <div className="bv-field" ref={hostRef} />
      <TopBar
        c={c}
        title={title}
        onMenu={() => {
          c.setPaused(true);
          setMenu(true);
        }}
        onRetreatAll={() => setConfirm(true)}
      />
      <div className="bv-left">
        <Objectives c={c} />
      </div>
      <div className="bv-right">
        <BattleLog c={c} onFocus={focus} />
      </div>
      <div className="bv-bottom">
        <Roster c={c} onFocus={focus} />
        <SquadPanel c={c} />
      </div>
      {c.paused && !anyCard && !ended && (
        <button type="button" className="bv-paused" onClick={() => c.setPaused(false)} data-testid="battle-paused-banner">
          {t('battleView.pausedBanner')}
        </button>
      )}
      {notice && (
        <div className="bv-notice" role="status" data-testid="battle-notice">
          {t(notice)}
        </div>
      )}
      {hover && !anyCard && <HoverTip c={c} target={hover.target} x={hover.x} y={hover.y} />}
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
          onRetreat={() => {
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
        <ConfirmRetreat
          c={c}
          onNo={() => setConfirm(false)}
          onYes={() => {
            setConfirm(false);
            c.retreatAll();
          }}
        />
      )}
      {!showSummary && !c.fastForward && <DuelCard c={c} />}
      {summary && (
        <div className="bv-result-host">
          <BattleResultScene summary={summary} side={c.side} title={title} reasonKey={c.endReasonKey()} error={error}>
            <div className="bc-actions">
              {summaryExtra}
              {error && fallback}
              <Button
                variant="primary"
                size="lg"
                icon="arrowRight"
                busy={busy}
                onClick={() => {
                  setBusy(true);
                  const err = onDone();
                  setBusy(false);
                  setError(err);
                }}
                data-autofocus
                data-testid="battle-return"
              >
                {t(doneLabelKey)}
              </Button>
            </div>
          </BattleResultScene>
        </div>
      )}
    </div>
  );
}

function HoverTip({ c, target, x, y }: { c: BattleController; target: BattleHover; x: number; y: number }): ReactElement | null {
  const t = useT();
  let body: ReactNode = null;
  if (target.kind === 'squad') {
    const s = c.squad(target.id);
    if (!s) return null;
    const own = s.side === c.side;
    body = (
      <>
        <div className="bv-tip-title">
          <span className={`bv-swatch ${own ? 'is-own' : 'is-foe'}`} /> {c.squadName(s.id)}
        </div>
        <div className="muted">
          {c.unitName(s.unit)} · {t('battleView.tip.menShort', { men: s.men, start: s.startMen })} · {t(`battleView.activity.${s.activity}`)}
        </div>
        <MoraleExplain c={c} s={s} />
        {!own && c.selected.length > 0 && <div className="bv-tip-hint">{t('battleView.hint.attack')}</div>}
      </>
    );
  } else if (target.kind === 'building') {
    const b = c.snap.buildings.find((q) => q.id === target.id);
    if (!b) return null;
    body = (
      <>
        <div className="bv-tip-title">{c.structureName(b.id)}</div>
        {b.loot > 0 && <div>{t('battleView.tip.buildingLoot', { value: b.loot })}</div>}
        {b.burning && <div>{t('battleView.tip.burning', { pct: Math.round(b.burnPct * 100) })}</div>}
        {b.collapsed && <div>{t('battleView.tip.collapsed')}</div>}
        {c.selected.length > 0 && !b.collapsed && <div className="bv-tip-hint">{t(b.loot > 0 && c.side === 'attacker' ? 'battleView.hint.plunder' : 'battleView.hint.torch')}</div>}
      </>
    );
  } else if (target.kind === 'gate') {
    const g = c.snap.gates.find((q) => q.id === target.id);
    if (!g) return null;
    body = (
      <>
        <div className="bv-tip-title">{t('battleView.structure.gate')}</div>
        <div>{t(g.broken ? 'battleView.tip.gateBroken' : 'battleView.tip.gate', { pct: Math.round(g.hpPct * 100) })}</div>
        {c.selected.length > 0 && !g.broken && c.side === 'attacker' && <div className="bv-tip-hint">{t('battleView.hint.gate')}</div>}
      </>
    );
  } else if (target.kind === 'cache') {
    const k = c.snap.caches.find((q) => q.id === target.id);
    if (!k) return null;
    body = (
      <>
        <div className="bv-tip-title">{t('battleView.structure.loot')}</div>
        <div>{t('battleView.tip.cache', { value: k.value })}</div>
        {c.selected.length > 0 && <div className="bv-tip-hint">{t('battleView.hint.pickUp')}</div>}
      </>
    );
  }
  if (body === null) return null;
  const left = Math.min(x + 18, (typeof window !== 'undefined' ? window.innerWidth : 1600) - 300);
  return (
    <div className="bv-tip" style={{ left, top: y + 18 }} role="tooltip" data-testid="battle-hover-tip">
      {body}
    </div>
  );
}
