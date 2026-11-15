/**
 * The home Market (route 'building.market', opened from the home hub's market hotspot; design SCR-16, §11),
 * laid out by ARCHITECTURE §20 as a large framed screen with one question at a time:
 *
 *   one sentence of what the house holds (treasury, storehouse);
 *   the two shortcuts as big cards ("Sell all loot", "Buy provisions for the next voyage", ./quickDeals.tsx);
 *   the goods as tiles beside one deal at a time (the shared ../settlement/market.tsx: a two-sided slider
 *   between the house storehouse and the town's market, every price and limit the economy's own).
 *
 * Where else a good sells best sits behind "Other ports" in the deal panel. Trade routes are a second view
 * (the "Trade routes" button in the header; ./routes.tsx).
 */
import { useState, type ReactElement } from 'react';
import type { GameState, GoodId } from '@sim/core/state';
import { readStorehouse, storedGoods } from '@sim/modules/economy/storehouse';
import { loadContent } from '../../app/content';
import { useGame } from '../../app/gameStore';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatNumber, tOr, useT } from '../../i18n/index';
import { Button, Frame, Icon, IconButton } from '../../ui/index';
import { hasMarket, knownMarkets } from '../settlement/knownMarkets';
import { MarketBoard } from '../settlement/market';
import { QuickCards, QuickConfirm, type QuickKind } from './quickDeals';
import { RoutesPanel } from './routes';

type View = 'goods' | 'routes';

/** The home Market overlay. */
export function HomeMarket({ state, onClose }: { state: GameState; onClose(): void }): ReactElement {
  const t = useT();
  const [view, setView] = useState<View>('goods');
  const [confirm, setConfirm] = useState<QuickKind | undefined>(undefined);
  const [result, setResult] = useState<string | undefined>(undefined);
  const loaded = loadContent();
  const homeId = state.player.capitalId;
  const s = state.settlements[homeId];
  const close = <IconButton icon="close" label={t('economy.ui.close')} onClick={onClose} data-testid="market-close" />;
  if (!loaded.ok || !s)
    return (
      <Frame size="screen" title={t('economy.ui.market.title')} className="trd-screen" actions={close} data-testid="home-market">
        <p className="faint">{t('economy.ui.market.none')}</p>
      </Frame>
    );
  const content = loaded.content;
  const open = hasMarket(state, content, homeId);
  const routes = Object.values(state.economy?.routes ?? {}).filter((r) => r.factionId === state.player.factionId).length;
  const treasury = Math.floor(state.factions[state.player.factionId]?.treasury ?? 0);
  const store = readStorehouse(state);
  let goodsTons = 0;
  for (const [, v] of storedGoods(store)) goodsTons += v;
  const switchView =
    view === 'goods' ? (
      <Button variant="ghost" size="sm" icon="ship" disabled={!open} onClick={() => setView('routes')} data-testid="market-view-routes">
        {routes > 0 ? t('economy.ui.trade.view.routesCount', { count: routes }) : t('economy.ui.market.tab.routes')}
      </Button>
    ) : (
      <Button variant="ghost" size="sm" icon="arrowLeft" onClick={() => setView('goods')} data-testid="market-view-goods">
        {t('economy.ui.trade.view.goods')}
      </Button>
    );
  const openQuick = (kind: QuickKind | undefined) => {
    setConfirm(kind);
    setResult(undefined);
  };
  const closeQuick = (text?: string) => {
    setConfirm(undefined);
    setResult(text);
  };
  return (
    <Frame
      size="screen"
      title={view === 'routes' ? t('economy.ui.market.tab.routes') : t('economy.ui.market.title')}
      subtitle={t('economy.ui.market.subtitle', { place: s.name, state: tOr(`economy.economyState.${s.economy}`, s.economy) })}
      ornate
      className="trd-screen"
      actions={
        <div className="trd-actions">
          {switchView}
          {close}
        </div>
      }
      data-testid="home-market"
    >
      <p className="trd-stores" data-testid="home-stores">
        {t('economy.ui.market.storehouseLine', { silver: formatNumber(treasury), rations: formatNumber(store.rations), tons: Math.round(goodsTons * 10) / 10 })}
      </p>
      {!open ? (
        <p className="faint" data-testid="market-closed">
          {t('economy.ui.market.none')}
        </p>
      ) : view === 'routes' ? (
        <RoutesPanel state={state} content={content} homeId={homeId} />
      ) : (
        <>
          <QuickCards state={state} content={content} homeId={homeId} open={confirm} onOpen={openQuick} />
          {result !== undefined && (
            <p className="trd-done" role="status" data-testid="quick-result">
              <Icon name="check" /> {result}
            </p>
          )}
          <MarketBoard
            state={state}
            content={content}
            settlementId={homeId}
            holder={{ kind: 'storehouse' }}
            elsewhere={knownMarkets(state, content, homeId)}
            aside={confirm !== undefined ? <QuickConfirm state={state} content={content} homeId={homeId} kind={confirm} onClose={closeQuick} /> : undefined}
            onPick={(_g: GoodId | undefined) => {
              setConfirm(undefined);
              setResult(undefined);
            }}
          />
        </>
      )}
    </Frame>
  );
}

function HomeMarketScreen({ close }: ScreenProps): ReactElement {
  const state = useGame((s) => s.state);
  if (!state) return <div />;
  return <HomeMarket state={state} onClose={close} />;
}

export const screen: ScreenDescriptor = { id: 'homeMarket', route: 'building.market', component: HomeMarketScreen, layout: 'overlay', titleKey: 'economy.ui.market.title' };
