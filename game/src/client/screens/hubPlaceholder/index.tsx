/**
 * Placeholder Home Hall hub for game mode 'hub' (priority −100: the hub agent's real SCR-05 screen
 * replaces it by registering for mode 'hub' with a higher priority). Shows the capital, a panorama
 * with the hall's buildings (each opens its route; unbuilt ones show "Coming soon"), a counsel panel
 * of calendar facts, and the time-at-home waits (§7.3) through the core `wait` command.
 */
import { useMemo, type ReactElement } from 'react';
import { MONTHS, daysBetween, nextDate } from '@sim/core/time';
import { loadContent } from '../../app/content';
import { useGame } from '../../app/gameStore';
import { navigation } from '../../app/navigation';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatGameDate } from '../../i18n/calendar';
import { formatNumber, tOr, useT } from '../../i18n/index';
import { Button, Frame, Icon, Panel, Tooltip, type IconName } from '../../ui/index';
import { HallPanorama } from './HallPanorama';
import './hub.css';

/** The hall's buildings (§10.2) and the routes they open. */
export const HALL_BUILDINGS: readonly { id: string; icon: IconName; x: number; y: number }[] = [
  { id: 'greatHall', icon: 'crown', x: 50, y: 40 },
  { id: 'longhouse', icon: 'family', x: 30, y: 52 },
  { id: 'meadHall', icon: 'chronicle', x: 68, y: 55 },
  { id: 'smithy', icon: 'sword', x: 16, y: 66 },
  { id: 'shipyard', icon: 'ship', x: 84, y: 72 },
  { id: 'market', icon: 'silver', x: 58, y: 72 },
  { id: 'seer', icon: 'eye', x: 82, y: 38 },
  { id: 'grove', icon: 'feather', x: 12, y: 40 },
];

const WAITS: readonly { days: number; key: string }[] = [
  { days: 1, key: 'ui.hubPlaceholder.wait.day' },
  { days: 7, key: 'ui.hubPlaceholder.wait.week' },
  { days: 30, key: 'ui.hubPlaceholder.wait.month' },
];

/** Annual dates shown in the wait preview (§7.1 annual events). */
const ANNUAL: readonly { key: string; month: (typeof MONTHS)[number]; day: number }[] = [
  { key: 'ui.hubPlaceholder.annual.allthing', month: 'Highsun', day: 15 },
  { key: 'ui.hubPlaceholder.annual.harvest', month: 'Reaping', day: 1 },
  { key: 'ui.hubPlaceholder.annual.yule', month: 'Yuledark', day: 15 },
];

function HubPlaceholder(_props: ScreenProps): ReactElement {
  const t = useT();
  const state = useGame((s) => s.state);
  const dispatch = useGame((s) => s.dispatch);
  const content = loadContent();
  const hour = state?.time.hour ?? 0;
  const capital = state && Object.hasOwn(state.settlements, state.player.capitalId) ? state.settlements[state.player.capitalId] : undefined;
  const annual = useMemo(
    () =>
      ANNUAL.map((a) => {
        const at = nextDate(hour, MONTHS.indexOf(a.month), a.day);
        return { ...a, at, days: daysBetween(hour, at) };
      }).sort((x, y) => x.days - y.days),
    [hour],
  );
  if (!state) return <div />;
  const garrison = capital ? Object.entries(capital.garrison).filter(([, n]) => n > 0) : [];
  // The walls building is the fortification tier, already shown on its own row.
  const buildings = capital ? Object.entries(capital.buildings).filter(([id, n]) => n > 0 && id !== 'walls') : [];
  const unitName = (id: string) => tOr(`core.unit.${id}.name`, content.ok ? (content.content.balance.units[id]?.name ?? id) : id);
  const pending = state.pending !== null;

  return (
    <div className="hub-ph" data-testid="hub">
      <aside className="hub-ph-left">
        <Frame title={capital?.name ?? t('ui.hubPlaceholder.home')} subtitle={capital ? t('ui.hubPlaceholder.capitalLine', { tier: t(`ui.tier.${capital.tier}`), pop: formatNumber(capital.pop) }) : undefined} ornate data-testid="hub-capital">
          <Panel title={t('ui.hubPlaceholder.garrison')}>
            {garrison.length === 0 ? (
              <span className="faint">—</span>
            ) : (
              <ul className="hub-ph-list">
                {garrison.map(([id, n]) => (
                  <li key={id}>
                    <span>{unitName(id)}</span>
                    <span className="num">{formatNumber(n)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={t('ui.hubPlaceholder.defences')} className="hub-ph-gap">
            <ul className="hub-ph-list">
              <li>
                <span>{t('ui.hubPlaceholder.walls')}</span>
                <span>{t(`ui.fortTier.${capital?.fortTier ?? 0}`)}</span>
              </li>
              {buildings.map(([id, tier]) => (
                <li key={id}>
                  <span>{tOr(`core.building.${id}.name`, t(`ui.building.${id}`))}</span>
                  <span className="num">{t('ui.hubPlaceholder.tier', { tier })}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </Frame>
      </aside>

      <section className="hub-ph-scene" aria-label={t('ui.hubPlaceholder.panorama')}>
        <HallPanorama />
        {HALL_BUILDINGS.map((b) => (
          <Tooltip key={b.id} content={t(`ui.hubPlaceholder.building.${b.id}`)}>
            <button type="button" className="hub-hotspot" style={{ left: `${b.x}%`, top: `${b.y}%` }} onClick={() => navigation.open(`building.${b.id}`)} data-testid={`hotspot-${b.id}`}>
              <Icon name={b.icon} />
              <span className="hub-hotspot-label">{t(`ui.hubPlaceholder.building.${b.id}`)}</span>
            </button>
          </Tooltip>
        ))}
        <div className="hub-ph-banner">
          <Icon name="quill" /> {t('ui.hubPlaceholder.banner')}
        </div>
        <div className="hub-ph-chart">
          <Button variant="primary" icon="ship" disabled={pending || state.player.expeditionFleetId !== undefined} onClick={() => navigation.open('expeditionPlanner')} data-testid="hub-expedition">
            {t('ui.hubPlaceholder.expedition')}
          </Button>
          <Button icon="eye" onClick={() => navigation.open('chart')} data-testid="hub-chart">
            {t('ui.hubPlaceholder.seaChart')}
          </Button>
        </div>
      </section>

      <aside className="hub-ph-right">
        <Frame title={t('ui.hubPlaceholder.counsel')} ornate>
          <ul className="counsel-list">
            {annual.map((a) => (
              <li key={a.key}>
                <Icon name="hourglass" />
                <span>{t(a.key, { days: a.days, date: formatGameDate(a.at) })}</span>
              </li>
            ))}
            {capital?.holding && (
              <li className={capital.holding.foodMonths < 3 ? 'tone-bad' : undefined}>
                <Icon name="food" />
                <span>{t('ui.hubPlaceholder.food', { months: Math.round(capital.holding.foodMonths * 10) / 10 })}</span>
              </li>
            )}
          </ul>
        </Frame>
        <Frame title={t('ui.hubPlaceholder.timeAtHome')} className="hub-ph-gap">
          <p className="muted hub-ph-note">{t('ui.hubPlaceholder.timeNote')}</p>
          <div className="hub-ph-waits">
            {WAITS.map((w) => (
              <Button key={w.days} icon="hourglass" disabled={pending} onClick={() => dispatch({ type: 'wait', days: w.days })} data-testid={`wait-${w.days}`}>
                {t(w.key)}
              </Button>
            ))}
            <Button variant="primary" icon="bell" disabled={pending} onClick={() => dispatch({ type: 'wait', untilEvent: true, maxDays: 90 })} data-testid="wait-event">
              {t('ui.hubPlaceholder.wait.event')}
            </Button>
          </div>
        </Frame>
      </aside>
    </div>
  );
}

export const screen: ScreenDescriptor = { id: 'hubPlaceholder', mode: 'hub', component: HubPlaceholder, priority: -100, titleKey: 'ui.hubPlaceholder.home' };
