/**
 * The Home Hall hub (SCR-05, game mode 'hub'; replaces the placeholder at priority 0), laid out by ARCHITECTURE
 * §20: the village picture is the screen. Its buildings and labels share one layout table (village.ts) inside a
 * box that keeps the viewBox aspect. Beside it, small and calm: the First Voyage (the current step large, the
 * rest folded away), the town in three numbers, the Hirdmaster's Counsel one piece of advice at a time
 * (counsel.ts: most important first, each with its one action, "next" for the rest), the one gold button
 * (plan an expedition) and the time-at-home control (§7.3 waits through the core `wait` command).
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { Content } from '@content/index';
import type { GameState } from '@sim/core/state';
import { loadContent } from '../../app/content';
import { useGame } from '../../app/gameStore';
import { navigation } from '../../app/navigation';
import { useNotifications } from '../../app/notifications';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatGameDate } from '../../i18n/calendar';
import { formatNumber, tOr, useT } from '../../i18n/index';
import { Button, Disclosure, Icon, IconButton, StatLine, Tooltip, type IconName } from '../../ui/index';
import { shipTypeName, unitName } from '../expedition/names';
import { harbourIce } from '../expedition/seaIce';
import {
  capitalOf,
  computeCounsel,
  firstVoyage,
  garrisonMen,
  nextVoyageStep,
  voyageFacts,
  type CounselAction,
  type CounselLine,
  type CounselTone,
} from './counsel';
import { VillageScene, type VillageModel } from './VillageScene';
import { VIEW_H, VIEW_W, VILLAGE, shipsAtHome, spotTier, type HallBuildingId } from './village';
import './hub.css';

const WAITS: readonly { days: number; key: string }[] = [
  { days: 1, key: 'hub.wait.dayShort' },
  { days: 7, key: 'hub.wait.weekShort' },
  { days: 30, key: 'hub.wait.monthShort' },
];

const TONE_ICON: Readonly<Record<CounselTone, IconName | null>> = {
  urgent: 'critical',
  warn: 'warning',
  advice: null,
  info: null,
};

/** Turns a Counsel line's vars into message vars: `…At` hours become dates, unit and ship ids become names. */
export function counselVars(
  vars: Readonly<Record<string, string | number>> | undefined,
  content: Content | null,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(vars ?? {})) {
    if (k.endsWith('At') && typeof v === 'number') out[k.slice(0, -2)] = formatGameDate(v);
    else if ((k === 'silver' || k === 'cost') && typeof v === 'number') out[k] = formatNumber(v);
    else if (k === 'unit' && typeof v === 'string') out[k] = unitName(content, v);
    else if (k === 'shipType' && typeof v === 'string') out[k] = shipTypeName(content, v);
    else out[k] = v;
  }
  return out;
}

/** Runs a Counsel or checklist action. */
function runAction(action: CounselAction, dispatch: ReturnType<typeof useGame.getState>['dispatch']): void {
  if (action.kind === 'route') navigation.open(action.route);
  else dispatch({ type: 'wait', days: action.days });
}

function sameAction(a: CounselAction | undefined, b: CounselAction | undefined): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === 'route' ? a.route === (b as typeof a).route : a.days === (b as typeof a).days;
}

function ActionButton({ action, disabled, testId }: { action: CounselAction; disabled: boolean; testId: string }): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const isWait = action.kind === 'wait';
  return (
    <Button
      size="sm"
      icon={isWait ? 'hourglass' : 'arrowRight'}
      disabled={disabled && isWait}
      onClick={() => runAction(action, dispatch)}
      data-testid={testId}
    >
      {t(action.labelKey, action.vars)}
    </Button>
  );
}

/** The Counsel: one piece of advice at a time, the most important first, with "next" for the rest. */
function Counsel({ lines, pending, content }: { lines: readonly CounselLine[]; pending: boolean; content: Content | null }): ReactElement {
  const t = useT();
  const [index, setIndex] = useState(0);
  const firstId = lines[0]?.id;
  // When the most important advice changes, show it again.
  useEffect(() => setIndex(0), [firstId]);
  const at = lines.length === 0 ? 0 : Math.min(index, lines.length - 1);
  const line = lines[at];
  const toneIcon = line ? TONE_ICON[line.tone] : null;
  return (
    <section className="hub-card hub-counsel-card" aria-labelledby="hub-counsel-title">
      <header className="hub-card-head">
        <h2 id="hub-counsel-title">{t('hub.counsel.title')}</h2>
        {lines.length > 1 && (
          <span className="hub-counsel-nav">
            <span className="hub-counsel-count num" data-testid="counsel-count">
              {t('hub.counsel.count', { at: at + 1, of: lines.length })}
            </span>
            <IconButton icon="chevronRight" size="sm" label={t('hub.counsel.next')} onClick={() => setIndex((at + 1) % lines.length)} data-testid="counsel-next" />
          </span>
        )}
      </header>
      <div className="hub-counsel" data-testid="hub-counsel" aria-live="polite">
        {line ? (
          <div key={line.id} className={`hub-counsel-line hub-tone-${line.tone}`} data-counsel={line.id}>
            <Icon name={toneIcon ?? (line.id.startsWith('annual-') ? 'hourglass' : line.icon)} className="hub-counsel-icon" />
            <div className="hub-counsel-body">
              <p>{t(line.key, counselVars(line.vars, content))}</p>
              {line.action && <ActionButton action={line.action} disabled={pending} testId={`counsel-${line.id}`} />}
            </div>
          </div>
        ) : (
          <p className="muted">{t('hub.counsel.quiet')}</p>
        )}
      </div>
    </section>
  );
}

/** The First Voyage: the current step large, the whole checklist folded away. */
function FirstVoyage({ state, pending, counselAction }: { state: GameState; pending: boolean; counselAction?: CounselAction }): ReactElement {
  const t = useT();
  const steps = firstVoyage(state, voyageFacts(state));
  const next = nextVoyageStep(steps);
  const nextStep = steps[next];
  const done = steps.filter((s) => s.done).length;
  return (
    <section className="hub-card hub-voyage" data-testid="hub-voyage" aria-labelledby="hub-voyage-title">
      <header className="hub-card-head">
        <h2 id="hub-voyage-title">{t('hub.voyage.title')}</h2>
        <span className="hub-voyage-progress num">{t('hub.voyage.progress', { done, of: steps.length })}</span>
      </header>
      {nextStep ? (
        <div className="hub-voyage-next" data-testid="voyage-next">
          <p className="hub-voyage-step">
            <Icon name="arrowRight" /> {t(nextStep.key)}
          </p>
          <p className="hub-voyage-hint">{t(`hub.voyage.hint.${nextStep.id}`)}</p>
          {nextStep.action && !sameAction(nextStep.action, counselAction) && (
            <ActionButton action={nextStep.action} disabled={pending} testId="voyage-action" />
          )}
        </div>
      ) : (
        <p className="hub-voyage-next hub-voyage-hint" data-testid="voyage-next">
          {t('hub.voyage.done')}
        </p>
      )}
      <Disclosure summary={t('hub.voyage.allSteps')} className="hub-voyage-all" data-testid="hub-voyage-steps">
        <ol className="hub-voyage-steps">
          {steps.map((s, i) => (
            <li
              key={s.id}
              className={s.done ? 'is-done' : i === next ? 'is-next' : 'is-todo'}
              data-step={s.id}
              data-done={s.done ? 'true' : 'false'}
              data-testid={`voyage-${s.id}`}
            >
              <Icon name={s.done ? 'check' : i === next ? 'arrowRight' : 'minus'} label={t(s.done ? 'hub.voyage.stepDone' : 'hub.voyage.stepTodo')} />
              <span>{t(s.key)}</span>
            </li>
          ))}
        </ol>
      </Disclosure>
    </section>
  );
}

/** The town in three numbers (the rest lives in the Great hall). */
function Town({ state }: { state: GameState }): ReactElement {
  const t = useT();
  const capital = capitalOf(state);
  const holding = capital?.holding;
  const months = holding ? Math.round(holding.foodMonths * 10) / 10 : 0;
  return (
    <section className="hub-card hub-town" data-testid="hub-capital" aria-labelledby="hub-town-title">
      <header className="hub-card-head">
        <h2 id="hub-town-title">{capital?.name ?? t('hub.home')}</h2>
        {capital && <span className="hub-town-tier">{tOr(`ui.tier.${capital.tier}`, capital.tier)}</span>}
      </header>
      <StatLine icon="men" label={t('hub.town.men')} value={formatNumber(garrisonMen(capital))} tone={garrisonMen(capital) === 0 ? 'bad' : undefined} />
      {holding && <StatLine icon="food" label={t('hub.town.food')} value={t('hub.capital.foodValue', { months })} tone={holding.foodMonths < 3 ? 'bad' : undefined} />}
      <StatLine icon="ship" label={t('hub.town.ships')} value={formatNumber(capital ? shipsAtHome(state, capital.id).length : 0)} />
    </section>
  );
}

/** Time at home: three short waits and "until something happens", the standing note in a tooltip. */
function TimeAtHome({ pending }: { pending: boolean }): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  return (
    <section className="hub-card hub-time" aria-labelledby="hub-time-title">
      <header className="hub-card-head">
        <Tooltip content={t('hub.time.note')}>
          <h2 id="hub-time-title" tabIndex={0}>
            <Icon name="hourglass" /> {t('hub.time.title')}
          </h2>
        </Tooltip>
      </header>
      <div className="hub-waits" role="group" aria-labelledby="hub-time-title">
        {WAITS.map((w) => (
          <button key={w.days} type="button" className="hub-wait" disabled={pending} onClick={() => dispatch({ type: 'wait', days: w.days })} data-testid={`wait-${w.days}`}>
            {t(w.key)}
          </button>
        ))}
      </div>
      <button type="button" className="hub-wait hub-wait-event" disabled={pending} onClick={() => dispatch({ type: 'wait', untilEvent: true, maxDays: 90 })} data-testid="wait-event">
        <Icon name="bell" /> {t('hub.wait.eventShort')}
      </button>
    </section>
  );
}

/** The village picture with its hotspots: the box that holds them keeps the viewBox aspect, centred like the SVG. */
function Village({ state, iced }: { state: GameState; iced: boolean }): ReactElement {
  const t = useT();
  const capital = capitalOf(state);
  const shipsKey = capital
    ? shipsAtHome(state, capital.id)
        .map((s) => `${s.id}:${s.type}`)
        .join(',')
    : '';
  const queued = capital?.holding?.shipQueue.length ?? 0;
  const buildings = capital?.buildings;
  const fortTier = capital?.fortTier ?? 0;
  const model = useMemo<VillageModel>(() => {
    const tiers = {} as Record<HallBuildingId, number>;
    for (const spot of VILLAGE) tiers[spot.id] = spotTier(buildings, spot);
    const ships =
      shipsKey === ''
        ? []
        : shipsKey.split(',').map((p) => ({ id: p.split(':')[0] ?? p, type: p.split(':')[1] ?? '' }));
    return { tiers, ships, building: queued > 0, fortTier, iced };
  }, [buildings, shipsKey, queued, fortTier, iced]);
  const open = (id: HallBuildingId) => navigation.open(`building.${id}`);
  return (
    <div className="hub-stage">
      <VillageScene model={model} onOpen={open} />
      {/* Exactly the viewBox's area of the scene (the SVG is centred with "meet"): the hotspots live here. */}
      <div className="hub-picture" style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}>
        {VILLAGE.map((spot) => {
          const tier = model.tiers[spot.id];
          const name = t(`hub.building.${spot.id}.name`);
          const tiered = spot.building !== null;
          return (
            <Tooltip
              key={spot.id}
              content={
                <>
                  <strong>{name}</strong>
                  <div>{t(`hub.building.${spot.id}.info`)}</div>
                  {tiered && <div className="muted">{t('hub.hotspot.status', { tier })}</div>}
                </>
              }
            >
              <button
                type="button"
                className={`hub-hotspot${tier <= 0 ? ' is-unbuilt' : ''}`}
                style={{ left: `${(spot.labelX / VIEW_W) * 100}%`, top: `${(spot.labelY / VIEW_H) * 100}%` }}
                onClick={() => open(spot.id)}
                aria-label={tiered ? t('hub.hotspot.aria', { name, tier }) : name}
                data-testid={`hotspot-${spot.id}`}
                data-tier={tier}
              >
                <Icon name={spot.icon} />
                <span className="hub-hotspot-name">{name}</span>
                {tiered && (
                  <span className="hub-hotspot-tier">
                    {tier > 0 ? t('hub.hotspot.tier', { tier }) : t('hub.hotspot.notBuilt')}
                  </span>
                )}
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

/**
 * While the sea is iced in and no expedition is out, the Counsel adds that a war-band can march overland now
 * (right after the ice), with the planner one click away.
 */
function withMarchCounsel(state: GameState, lines: CounselLine[], iced: boolean): CounselLine[] {
  if (!iced || state.player.expeditionFleetId !== undefined || garrisonMen(capitalOf(state)) <= 0) return lines;
  const march: CounselLine = {
    id: 'march',
    tone: 'advice',
    icon: 'men',
    key: 'hub.counsel.march',
    action: { kind: 'route', route: 'expeditionPlanner', labelKey: 'hub.counsel.marchAction' },
  };
  const at = lines.findIndex((l) => l.id === 'iced');
  return at < 0 ? [...lines, march] : [...lines.slice(0, at + 1), march, ...lines.slice(at + 1)];
}

function HubScreen(_props: ScreenProps): ReactElement {
  const t = useT();
  const state = useGame((s) => s.state);
  const unreadImportant = useNotifications((s) => s.inbox.filter((n) => !n.read && n.tier !== 'info').length);
  const loaded = loadContent();
  const content = loaded.ok ? loaded.content : null;
  const ice = useMemo(() => (state ? harbourIce(state) : { iced: false }), [state]);
  const lines = useMemo(
    () => (state && content ? withMarchCounsel(state, computeCounsel(state, content, { unreadImportant }, ice), ice.iced) : []),
    [state, content, unreadImportant, ice],
  );
  if (!state) return <div />;
  const pending = state.pending !== null;
  const atSea = state.player.expeditionFleetId !== undefined;

  return (
    <div className="hub" data-testid="hub">
      <aside className="hub-col hub-left">
        <FirstVoyage state={state} pending={pending} counselAction={lines[0]?.action} />
        <Town state={state} />
      </aside>

      <section className="hub-centre" aria-label={t('hub.panorama')}>
        <Village state={state} iced={ice.iced} />
      </section>

      <aside className="hub-col hub-right">
        <Counsel lines={lines} pending={pending} content={content} />
        <div className="hub-go">
          <Button
            variant="primary"
            size="lg"
            block
            icon="ship"
            disabled={pending || atSea}
            onClick={() => navigation.open('expeditionPlanner')}
            data-testid="hub-expedition"
          >
            {t('hub.expedition')}
          </Button>
          <div className="hub-go-row">
            <Button icon="eye" onClick={() => navigation.open('chart')} data-testid="hub-chart">
              {t('hub.seaChartShort')}
            </Button>
            <span className={`hub-bar-note${ice.iced ? ' hub-warn' : ''}`} data-testid="hub-sea-state">
              <Icon name={ice.iced ? 'warning' : atSea ? 'ship' : 'check'} />
              {atSea
                ? t('hub.expedition.atSea')
                : ice.iced && ice.thawHour !== undefined
                  ? t('hub.expedition.iced', { thaw: formatGameDate(ice.thawHour) })
                  : t('hub.expedition.ready')}
            </span>
          </div>
        </div>
        <TimeAtHome pending={pending} />
      </aside>
    </div>
  );
}

export const screen: ScreenDescriptor = {
  id: 'hub',
  mode: 'hub',
  component: HubScreen,
  priority: 0,
  titleKey: 'hub.title',
};
