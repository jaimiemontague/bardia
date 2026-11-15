/**
 * The top bar (§25.3 "Top bar (always)", wireframe SCR-05), on one row at the §20 type scale: the ruler's
 * portrait (its tooltip holds Renown, Honor and Dread in words with the numbers and why they last changed;
 * the character sheet shows them too), name and seat, silver, men and food with their breakdowns, the date
 * (the season in its tooltip), time controls on real-time scenes, and buttons to Character · Family · Ledger ·
 * Chronicle · Saga Ledger · Codex · Inbox · Menu.
 */
import { memo, useMemo, type ReactElement, type ReactNode } from 'react';
import { loadContent } from '../app/content';
import { useFeeds, type StandingChange, type StandingStat } from '../app/chronicleFeeds';
import { useGame } from '../app/gameStore';
import { navigation, useNavigation } from '../app/navigation';
import { unreadCount, useNotifications } from '../app/notifications';
import { playerSummary, type PlayerSummary, type Tally } from '../app/playerSummary';
import { dreadWord, honorWord } from '../screens/character/standing';
import { useSettings } from '../settings/store';
import { formatGameDate, seasonLabel } from '../i18n/calendar';
import { formatNumber, useT } from '../i18n/index';
import {
  FormulaBreakdown,
  Icon,
  IconButton,
  Portrait,
  recipeForCharacter,
  Tooltip,
  type IconName,
} from '../ui/index';
import { TimeControls } from './TimeControls';
import { useOverflowCompact } from './useOverflowCompact';

interface StatProps {
  icon: IconName;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tip: ReactNode;
  testId: string;
  tone?: 'good' | 'bad' | 'warn';
}

function Stat({ icon, label, value, sub, tip, testId, tone }: StatProps): ReactElement {
  return (
    <Tooltip content={tip} placement="bottom">
      <div
        className={['topbar-stat', tone && `tone-${tone}`].filter(Boolean).join(' ')}
        tabIndex={0}
        aria-label={`${label}: ${typeof value === 'string' || typeof value === 'number' ? value : ''}`}
        data-testid={testId}
      >
        <Icon name={icon} className="topbar-stat-icon" />
        <span className="topbar-stat-text">
          <span className="topbar-stat-value num">{value}</span>
          {sub && <span className="topbar-stat-sub">{sub}</span>}
        </span>
      </div>
    </Tooltip>
  );
}

function TallyTip({
  titleKey,
  tally,
  unit,
}: {
  titleKey: string;
  tally: Tally;
  unit?: string;
}): ReactElement {
  const t = useT();
  return (
    <FormulaBreakdown
      title={t(titleKey)}
      total={`${formatNumber(tally.total)}${unit ?? ''}`}
      rows={tally.lines.map((l, i) => ({
        label: t(l.labelKey, l.vars),
        value: formatNumber(l.value),
        op: i === 0 ? undefined : '+',
      }))}
    />
  );
}

/**
 * The ruler's portrait tooltip (ARCHITECTURE §20: the bar keeps silver, men, food and the date): who rules, and
 * the house's Renown, Honor and Dread in words with the numbers beside them, then why they last changed. The
 * character sheet shows the same standings.
 */
function StandingsTip({ summary }: { summary: PlayerSummary }): ReactElement {
  const t = useT();
  const renown = useFeeds((s) => s.standings.renown);
  const honor = useFeeds((s) => s.standings.honor);
  const dread = useFeeds((s) => s.standings.dread);
  const recent = useMemo(
    () => [...renown, ...honor, ...dread].sort((a, b) => b.hour - a.hour || b.id - a.id).slice(0, 5),
    [renown, honor, dread],
  );
  const rows: { stat: StandingStat; word: string; value: number }[] = [
    { stat: 'renown', word: t(`ui.renownTier.${summary.renownTier}`), value: summary.renown },
    {
      stat: 'honor',
      word: t('people.ui.word.honor', { band: honorWord(summary.honor) }),
      value: summary.honor,
    },
    {
      stat: 'dread',
      word: t('people.ui.word.dread', { band: dreadWord(summary.dread) }),
      value: summary.dread,
    },
  ];
  return (
    <div className="standing-tip topbar-tip" data-testid="topbar-standings">
      <div className="formula-head">
        <span className="formula-title">
          {summary.epithet ? `${summary.rulerName} ${summary.epithet}` : summary.rulerName}
        </span>
      </div>
      <table className="formula-rows">
        <tbody>
          {rows.map((r) => (
            <tr key={r.stat} data-testid={`tip-${r.stat}`}>
              <td className="formula-label">{t(`ui.standing.${r.stat}`)}</td>
              <td className="formula-label topbar-tip-word">{r.word}</td>
              <td className="formula-value num">{formatNumber(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {recent.length === 0 ? (
        <div className="formula-note">{t('ui.standing.noChanges')}</div>
      ) : (
        <table className="formula-rows">
          <tbody>
            {recent.map((c: StandingChange) => (
              <tr key={`${c.stat}-${c.id}`} className={c.delta > 0 ? 'tone-good' : 'tone-bad'}>
                <td className="formula-value num" style={{ textAlign: 'left', width: '3em' }}>
                  {c.delta > 0 ? `+${c.delta}` : c.delta}
                </td>
                <td className="formula-label">
                  {t(`ui.standing.${c.stat}`)}:{' '}
                  {c.reasonKey ? t(c.reasonKey, c.reasonVars) : t('ui.standing.unknownReason')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="formula-note">{t('ui.topbar.standingsHint')}</div>
    </div>
  );
}

const NAV_BUTTONS: readonly { route: string; icon: IconName; action: string }[] = [
  { route: 'character', icon: 'character', action: 'open.character' },
  { route: 'family', icon: 'family', action: 'open.family' },
  { route: 'ledger', icon: 'ledger', action: 'open.ledger' },
  { route: 'chronicle', icon: 'chronicle', action: 'open.chronicle' },
  { route: 'sagaLedger', icon: 'saga', action: 'open.sagaLedger' },
  { route: 'codex', icon: 'codex', action: 'open.codex' },
];

export interface TopBarProps {
  /** Show the time controls (real-time scenes). */
  realtime: boolean;
  /** Locale key of a soft pause (overlay, pending decision) shown on the pause button. */
  blockedKey: string | null;
}

/** The always-visible top bar. */
export const TopBar = memo(function TopBar({ realtime, blockedKey }: TopBarProps): ReactElement | null {
  const t = useT();
  const state = useGame((s) => s.state);
  const unread = useNotifications((s) => unreadCount(s.inbox));
  const topRoute = useNavigation((s) => s.stack[s.stack.length - 1]?.id);
  const content = loadContent();
  const summary = useMemo(
    () => (state ? playerSummary(state, content.ok ? content.content : null) : null),
    [state, content],
  );
  const recipe = useMemo(
    () => (state && summary?.ruler ? recipeForCharacter(summary.ruler, state) : null),
    [state, summary?.ruler],
  );
  const layoutKey = useSettings(
    (s) =>
      `${s.settings.video.uiScale}|${s.settings.accessibility.textSize}|${s.settings.accessibility.font}|${realtime}`,
  );
  const [barRef, compact] = useOverflowCompact<HTMLElement>(layoutKey, '.topbar-plate');
  if (!state || !summary) return null;
  const hour = state.time.hour;
  const capitalName = summary.capital?.name ?? '';

  return (
    <header ref={barRef} className={compact ? 'topbar is-compact' : 'topbar'} data-testid="topbar">
      <div className="topbar-plate topbar-who">
        <Tooltip content={<StandingsTip summary={summary} />} placement="bottom">
          <button
            type="button"
            className="topbar-portrait"
            onClick={() => navigation.toggle('character')}
            aria-label={t('ui.topbar.openCharacter', { name: summary.rulerName })}
            data-testid="topbar-portrait"
          >
            {recipe ? (
              <Portrait
                recipe={recipe}
                alt={t('ui.topbar.portraitAlt', { name: summary.rulerName })}
                size="sm"
                initial={summary.rulerName.slice(0, 1)}
              />
            ) : (
              <span className="portrait portrait-sm" />
            )}
          </button>
        </Tooltip>
        <div className="topbar-name">
          <div
            className="topbar-ruler"
            data-testid="topbar-ruler"
            title={summary.epithet ? `${summary.rulerName} ${summary.epithet}` : summary.rulerName}
          >
            <span className="topbar-ruler-name">{summary.rulerName}</span>
          </div>
          <div className="topbar-title">
            {capitalName ? t('ui.topbar.jarlOf', { place: capitalName }) : summary.houseName}
          </div>
        </div>
      </div>

      <div className="topbar-plate topbar-stats">
        <Stat
          icon="silver"
          label={t('ui.topbar.silver')}
          value={formatNumber(summary.silver.total)}
          tip={<TallyTip titleKey="ui.topbar.silver" tally={summary.silver} />}
          testId="stat-silver"
        />
        <Stat
          icon="men"
          label={t('ui.topbar.men')}
          value={formatNumber(summary.men.total)}
          tip={<TallyTip titleKey="ui.topbar.men" tally={summary.men} />}
          testId="stat-men"
        />
        <Stat
          icon="food"
          label={t('ui.topbar.food')}
          value={
            summary.foodMonths === null
              ? t('ui.topbar.unknown')
              : t('ui.topbar.months', { months: summary.foodMonths })
          }
          tone={summary.foodMonths !== null && summary.foodMonths < 3 ? 'bad' : undefined}
          tip={
            <TallyTip
              titleKey="ui.topbar.foodTitle"
              tally={summary.food}
              unit={` ${t('ui.topbar.monthsUnit')}`}
            />
          }
          testId="stat-food"
        />
      </div>

      <div className="topbar-plate topbar-when">
        <Tooltip content={t('ui.topbar.dateTip', { season: seasonLabel(hour) })} placement="bottom">
          <div className="topbar-date" tabIndex={0} data-testid="topbar-date">
            <Icon name={realtime ? 'hourglass' : 'sun'} className="topbar-stat-icon" />
            <span className="topbar-date-text num">{formatGameDate(hour)}</span>
          </div>
        </Tooltip>
        {realtime && <TimeControls blockedKey={blockedKey} />}
      </div>

      <nav className="topbar-plate topbar-nav" aria-label={t('ui.topbar.navigation')}>
        {NAV_BUTTONS.map((b) => (
          <IconButton
            key={b.route}
            icon={b.icon}
            label={t(`ui.route.${b.route}`)}
            keyHint={b.action}
            pressed={topRoute === b.route}
            onClick={() => navigation.toggle(b.route)}
            data-testid={`nav-${b.route}`}
          />
        ))}
        <IconButton
          icon="inbox"
          label={t('ui.route.inbox')}
          keyHint="open.inbox"
          badge={unread}
          pressed={topRoute === 'inbox'}
          onClick={() => navigation.toggle('inbox')}
          data-testid="nav-inbox"
        />
        <IconButton
          icon="menu"
          label={t('ui.route.gameMenu')}
          keyHint="ui.back"
          pressed={topRoute === 'gameMenu'}
          onClick={() => navigation.toggle('gameMenu')}
          data-testid="nav-menu"
        />
      </nav>
    </header>
  );
});
