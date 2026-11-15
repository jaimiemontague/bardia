/**
 * The home Market's two shortcuts (design §11.3), as two big cards above the goods:
 *   Sell all loot — every trade good in the house storehouse (rations stay), priced as one `trade` by the
 *                   economy's `priceDeal`; the lines and the total are shown before the player confirms.
 *   Buy provisions for the next voyage — the rations the next expedition needs (the last plan, else the
 *                   planner's default 30-day plan) minus what the storehouse holds, bought from the market.
 * Picking a card puts its confirmation where the deal panel stands (QuickConfirm); one button carries it out.
 */
import type { ReactElement } from 'react';
import type { Content } from '@content/index';
import type { GameState, SettlementId } from '@sim/core/state';
import { readStorehouse, storedGoods } from '@sim/modules/economy/storehouse';
import type { GoodTons } from '@sim/modules/economy/types';
import { suggestPlan } from '@sim/modules/expeditions/plan';
import { useGame } from '../../app/gameStore';
import { formatNumber, tOr, useT } from '../../i18n/index';
import { Button, ChoiceCard } from '../../ui/index';
import { formatTons, goodName } from '../expedition/names';
import { quoteTrade, rationsToTons, type Quote } from '../settlement/knownMarkets';
import { GoodArt } from './goodArt';

const STORE = { kind: 'storehouse' } as const;

export type QuickKind = 'sell' | 'buy';

/** Rations the next voyage needs: the last plan's, else the planner's default plan for 30 days. */
export function nextVoyageRations(state: GameState, content: Content): number {
  const last = state.expeditions?.lastPlan;
  if (last && last.rations > 0) return last.rations;
  return suggestPlan(state, content, 30, { ignoreStores: true }).rations;
}

/** Everything in the storehouse but rations, as a sell list. */
export function lootToSell(state: GameState): GoodTons {
  const sell: GoodTons = {};
  for (const [g, v] of storedGoods(readStorehouse(state))) sell[g] = Math.floor(v * 1000) / 1000;
  return sell;
}

/** Both shortcuts priced by the economy, with what they would move. */
export function quickQuotes(state: GameState, content: Content, homeId: SettlementId) {
  const sell = lootToSell(state);
  const kinds = Object.keys(sell).length;
  const sellQuote: Quote | undefined = kinds > 0 ? quoteTrade(state, content, homeId, STORE, { sell }) : undefined;
  const stored = readStorehouse(state).rations;
  const need = nextVoyageRations(state, content);
  const short = Math.max(0, need - stored);
  const tons = rationsToTons(content, short);
  const buyQuote: Quote | undefined = short > 0 ? quoteTrade(state, content, homeId, STORE, { buy: { rations: tons } }) : undefined;
  return { sell, kinds, sellQuote, stored, need, short, tons, buyQuote };
}

function reason(t: ReturnType<typeof useT>, q: Quote | undefined): string {
  return q && !q.ok ? tOr(`economy.error.${q.code}`, t('economy.ui.market.cannot')) : '';
}

/** The two shortcut cards. */
export function QuickCards({ state, content, homeId, open, onOpen }: { state: GameState; content: Content; homeId: SettlementId; open: QuickKind | undefined; onOpen(kind: QuickKind | undefined): void }): ReactElement {
  const t = useT();
  const q = quickQuotes(state, content, homeId);
  const busy = state.pending !== null;
  const sellWhy =
    q.kinds === 0 ? t('economy.ui.quick.noLoot') : q.sellQuote?.ok ? t('economy.ui.trade.quick.sellLine', { goods: q.kinds, silver: q.sellQuote.silver }) : busy ? t('economy.ui.market.decisionFirst') : reason(t, q.sellQuote);
  const buyWhy =
    q.short === 0
      ? t('economy.ui.trade.quick.provisioned')
      : q.buyQuote?.ok
        ? t('economy.ui.trade.quick.buyLine', { silver: -q.buyQuote.silver })
        : busy
          ? t('economy.ui.market.decisionFirst')
          : reason(t, q.buyQuote);
  const sellLine = <span data-testid="sell-all-why">{sellWhy}</span>;
  const buyLine = <span data-testid="buy-provisions-why">{buyWhy}</span>;
  return (
    <div className="trd-quick" data-testid="quick-deals">
      <ChoiceCard
        icon="silver"
        title={t('economy.ui.quick.sellAll')}
        line={sellLine}
        reason={sellLine}
        disabled={busy || !q.sellQuote?.ok}
        selected={open === 'sell'}
        onClick={() => onOpen(open === 'sell' ? undefined : 'sell')}
        data-testid="sell-all"
      />
      <ChoiceCard
        icon="food"
        title={t('economy.ui.trade.quick.buyTitle')}
        line={buyLine}
        reason={buyLine}
        disabled={busy || !q.buyQuote?.ok}
        selected={open === 'buy'}
        onClick={() => onOpen(open === 'buy' ? undefined : 'buy')}
        data-testid="buy-provisions"
      />
    </div>
  );
}

/** The confirmation of one shortcut, shown where the deal panel stands. */
export function QuickConfirm({ state, content, homeId, kind, onClose }: { state: GameState; content: Content; homeId: SettlementId; kind: QuickKind; onClose(result?: string): void }): ReactElement | null {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const q = quickQuotes(state, content, homeId);
  const quote = kind === 'sell' ? q.sellQuote : q.buyQuote;
  if (!quote?.ok) return null;

  const run = () => {
    const r = kind === 'sell' ? dispatch({ type: 'trade', settlementId: homeId, storehouse: true, sell: q.sell }) : dispatch({ type: 'trade', settlementId: homeId, storehouse: true, buy: { rations: q.tons } });
    if (!r || r.error) return onClose();
    const ev = r.events.find((e) => e.type === 'TradeCompleted');
    const earned = ev && ev.type === 'TradeCompleted' ? ev.earned : 0;
    const spent = ev && ev.type === 'TradeCompleted' ? ev.spent : 0;
    onClose(kind === 'sell' ? t('economy.ui.quick.soldAll', { silver: earned }) : t('economy.ui.quick.boughtProvisions', { rations: formatNumber(Math.round(q.tons * content.balance.economy.rationsPerTon)), silver: spent }));
  };

  if (kind === 'sell') {
    const lines = quote.deal.sells;
    const shown = lines.slice(0, 6);
    return (
      <div className="trd-confirm" role="dialog" aria-label={t('economy.ui.quick.sellAll')} data-testid="sell-all-panel">
        <h3 className="trd-deal-title">{t('economy.ui.quick.sellAll')}</h3>
        <p className="trd-confirm-lead">{t('economy.ui.trade.quick.sellLead')}</p>
        <ul className="trd-confirm-lines">
          {shown.map((l) => (
            <li key={l.good}>
              <GoodArt good={l.good} size="sm" />
              <span className="trd-confirm-good">{t('economy.ui.trade.quick.line', { good: goodName(l.good), tons: formatTons(l.tons) })}</span>
              <span className="trd-num">{t('economy.ui.market.silver', { silver: l.value })}</span>
            </li>
          ))}
          {lines.length > shown.length && <li className="faint">{t('economy.ui.trade.quick.more', { count: lines.length - shown.length })}</li>}
        </ul>
        <p className="trd-confirm-total" data-testid="sell-all-total">
          {t('economy.ui.quick.total', { silver: quote.silver })}
        </p>
        <div className="trd-deal-go">
          <Button variant="primary" size="lg" icon="check" onClick={run} data-testid="sell-all-confirm">
            {t('economy.ui.quick.confirmSell', { silver: quote.silver })}
          </Button>
          <Button variant="ghost" onClick={() => onClose()} data-testid="sell-all-cancel">
            {t('economy.ui.quick.cancel')}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="trd-confirm" role="dialog" aria-label={t('economy.ui.trade.quick.buyTitle')} data-testid="buy-provisions-panel">
      <h3 className="trd-deal-title">{t('economy.ui.trade.quick.buyTitle')}</h3>
      <p className="trd-confirm-lead">{t('economy.ui.trade.quick.buyLead', { short: formatNumber(q.short) })}</p>
      <p className="trd-confirm-total">{t('economy.ui.quick.cost', { silver: -quote.silver })}</p>
      <div className="trd-deal-go">
        <Button variant="primary" size="lg" icon="check" onClick={run} data-testid="buy-provisions-confirm">
          {t('economy.ui.quick.confirmBuy', { silver: -quote.silver })}
        </Button>
        <Button variant="ghost" onClick={() => onClose()} data-testid="buy-provisions-cancel">
          {t('economy.ui.quick.cancel')}
        </Button>
      </div>
    </div>
  );
}
