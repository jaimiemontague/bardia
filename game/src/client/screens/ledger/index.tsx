/**
 * The Ledger (top-bar route 'ledger', design §11.5), laid out by ARCHITECTURE §20: the treasury large, what
 * came in and what went out last month as at most three lines each in words with amounts (before the first
 * monthly tally: what the steward expects this month), and the month's result in one sentence. Every line,
 * this month's expectation beside last month's report, sits behind Details. Numbers come from the economy
 * module (`computeLedger`, the function the monthly tally runs, and `state.economy.lastReport`).
 *
 * Test ids: ledger, ledger-close, ledger-treasury, ledger-in, ledger-out, ledger-group-<id>, ledger-net,
 * ledger-arrears, ledger-details, ledger-table.
 */
import { useMemo, type ReactElement } from 'react';
import type { GameState } from '@sim/core/state';
import { computeLedger } from '@sim/modules/economy/ledger';
import { LEDGER_EXPENSE_KEYS, LEDGER_INCOME_KEYS, type LedgerExpenseKey, type LedgerIncomeKey } from '@sim/modules/economy/types';
import { loadContent } from '../../app/content';
import { useGame } from '../../app/gameStore';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatNumber, useT } from '../../i18n/index';
import { Disclosure, Frame, Icon, IconButton, type IconName } from '../../ui/index';
import './ledger.css';

type Lines = { income: Record<LedgerIncomeKey, number>; expenses: Record<LedgerExpenseKey, number>; totalIncome: number; totalExpenses: number; net: number };

/** The ledger's lines folded into a few groups a player reads at a glance. */
const IN_GROUPS: readonly { id: string; icon: IconName; keys: readonly LedgerIncomeKey[] }[] = [
  { id: 'taxes', icon: 'crown', keys: ['taxes'] },
  { id: 'trade', icon: 'ship', keys: ['marketTolls', 'straitsTolls', 'tradeRoutes'] },
  { id: 'tribute', icon: 'silver', keys: ['tribute', 'vassalDues'] },
];
const OUT_GROUPS: readonly { id: string; icon: IconName; keys: readonly LedgerExpenseKey[] }[] = [
  { id: 'wages', icon: 'men', keys: ['wages', 'lieutenants'] },
  { id: 'upkeep', icon: 'reset', keys: ['ships', 'buildings'] },
  { id: 'other', icon: 'quill', keys: ['factors', 'tributePaid'] },
];

function sum(rec: Readonly<Record<string, number>>, keys: readonly string[]): number {
  let n = 0;
  for (const k of keys) n += rec[k] ?? 0;
  return n;
}

export function Ledger({ state, onClose }: { state: GameState; onClose(): void }): ReactElement {
  const t = useT();
  const loaded = loadContent();
  const faction = state.player.factionId;
  const projected = useMemo<Lines | undefined>(() => (loaded.ok ? computeLedger(state, loaded.content, faction) : undefined), [state, loaded, faction]);
  const last = state.economy?.lastReport as Lines | undefined;
  const arrears = state.economy?.arrears[faction];
  const treasury = state.factions[faction]?.treasury ?? 0;
  const shown = last ?? projected;
  const expected = last === undefined;
  const silver = (v: number) => t('holdings.ui.ledger.silver', { silver: formatNumber(Math.round(Math.abs(v))) });
  const n = (v: number | undefined) => (v === undefined ? '–' : formatNumber(Math.round(v)));

  const group = (g: { id: string; icon: IconName; keys: readonly string[] }, rec: Readonly<Record<string, number>>) => {
    const amount = sum(rec, g.keys);
    if (Math.round(amount) === 0) return null;
    return (
      <li key={g.id} className="lg-line" data-testid={`ledger-group-${g.id}`}>
        <Icon name={g.icon} className="lg-line-icon" />
        <span className="lg-line-label">{t(`holdings.ui.ledger.group.${g.id}`)}</span>
        <span className="lg-line-value num">{silver(amount)}</span>
      </li>
    );
  };
  const column = (title: string, groups: typeof IN_GROUPS | typeof OUT_GROUPS, rec: Readonly<Record<string, number>> | undefined, tone: 'in' | 'out', testId: string) => {
    const items = rec ? groups.map((g) => group(g, rec)).filter(Boolean) : [];
    return (
      <section className={`lg-col lg-col-${tone}`} data-testid={testId} aria-label={title}>
        <h3 className="lg-col-h">{title}</h3>
        {items.length === 0 ? <p className="lg-nothing">{t('holdings.ui.ledger.nothing')}</p> : <ul className="lg-lines">{items}</ul>}
      </section>
    );
  };

  const net = shown?.net ?? 0;
  const netText =
    Math.round(net) > 0
      ? t(expected ? 'holdings.ui.ledger.netGainExpected' : 'holdings.ui.ledger.netGain', { silver: formatNumber(Math.round(net)) })
      : Math.round(net) < 0
        ? t(expected ? 'holdings.ui.ledger.netLossExpected' : 'holdings.ui.ledger.netLoss', { silver: formatNumber(Math.round(-net)) })
        : t(expected ? 'holdings.ui.ledger.netEvenExpected' : 'holdings.ui.ledger.netEven');

  const rows = (keys: readonly string[], pick: (l: Lines, k: string) => number) =>
    keys
      .filter((k) => (projected ? pick(projected, k) : 0) !== 0 || (last ? pick(last, k) : 0) !== 0)
      .map((k) => (
        <tr key={k} data-line={k}>
          <td>{t(`economy.line.${k}`)}</td>
          <td className="num">{projected ? n(pick(projected, k)) : '–'}</td>
          <td className="num">{last ? n(pick(last, k)) : '–'}</td>
        </tr>
      ));

  return (
    <Frame
      size="screen"
      title={t('ui.route.ledger')}
      ornate
      className="lg-ledger"
      actions={<IconButton icon="close" label={t('economy.ui.close')} onClick={onClose} data-testid="ledger-close" />}
      data-testid="ledger"
    >
      <div className="lg-screen">
        <div className="lg-treasury" data-testid="ledger-treasury">
          <span className="lg-treasury-label">{t('holdings.ui.ledger.treasury')}</span>
          <span className="lg-treasury-value num">
            <Icon name="silver" /> {silver(Math.floor(treasury))}
          </span>
        </div>
        <div className="lg-cols">
          {column(t(expected ? 'holdings.ui.ledger.inExpected' : 'holdings.ui.ledger.in'), IN_GROUPS, shown?.income, 'in', 'ledger-in')}
          {column(t(expected ? 'holdings.ui.ledger.outExpected' : 'holdings.ui.ledger.out'), OUT_GROUPS, shown?.expenses, 'out', 'ledger-out')}
        </div>
        <p className={`lg-net ${Math.round(net) < 0 ? 'tone-bad' : Math.round(net) > 0 ? 'tone-good' : ''}`} data-testid="ledger-net">
          {netText}
        </p>
        {arrears && arrears.amount > 0 ? (
          <p className="lg-arrears tone-bad" data-testid="ledger-arrears">
            <Icon name="warning" /> {t('economy.ui.arrears', { silver: formatNumber(arrears.amount), months: arrears.months })}
          </p>
        ) : null}
        {expected && <p className="lg-note">{t('holdings.ui.ledger.firstMonth')}</p>}
        <Disclosure className="lg-details" summary={t('holdings.ui.ledger.details')} data-testid="ledger-details">
          <table className="lg-table" data-testid="ledger-table">
            <thead>
              <tr>
                <th />
                <th className="num">{t('economy.ui.thisMonth')}</th>
                <th className="num">{t('economy.ui.lastMonth')}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="lg-head">
                <th colSpan={3}>{t('economy.ui.income')}</th>
              </tr>
              {rows(LEDGER_INCOME_KEYS, (l, k) => l.income[k as LedgerIncomeKey] ?? 0)}
              <tr className="lg-total">
                <td>{t('economy.ui.totalIncome')}</td>
                <td className="num">{n(projected?.totalIncome)}</td>
                <td className="num">{n(last?.totalIncome)}</td>
              </tr>
              <tr className="lg-head">
                <th colSpan={3}>{t('economy.ui.expenses')}</th>
              </tr>
              {rows(LEDGER_EXPENSE_KEYS, (l, k) => l.expenses[k as LedgerExpenseKey] ?? 0)}
              <tr className="lg-total">
                <td>{t('economy.ui.totalExpenses')}</td>
                <td className="num">{n(projected?.totalExpenses)}</td>
                <td className="num">{n(last?.totalExpenses)}</td>
              </tr>
              <tr className="lg-total">
                <td>{t('economy.ui.net')}</td>
                <td className="num">{n(projected?.net)}</td>
                <td className="num">{n(last?.net)}</td>
              </tr>
            </tbody>
          </table>
        </Disclosure>
      </div>
    </Frame>
  );
}

function LedgerScreen({ close }: ScreenProps): ReactElement {
  const state = useGame((s) => s.state);
  if (!state) return <div />;
  return <Ledger state={state} onClose={close} />;
}

export const screen: ScreenDescriptor = { id: 'ledger', route: 'ledger', component: LedgerScreen, layout: 'overlay', titleKey: 'ui.route.ledger' };
