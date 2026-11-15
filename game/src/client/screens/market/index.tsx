/**
 * The home Market (route 'building.market', opened from the home hub's market hotspot; design SCR-16, §11):
 * entering it shows the merchant's storehouse open to the harbour (render/interiors/rooms/market.tsx). The whole
 * market waits behind the Merchant (ARCHITECTURE §20), one question at a time:
 *
 *   one sentence of what the house holds (treasury, storehouse);
 *   the two shortcuts as big cards ("Sell all loot", "Buy provisions for the next voyage", ./quickDeals.tsx);
 *   the goods as tiles beside one deal at a time (the shared ../settlement/market.tsx: a two-sided slider
 *   between the house storehouse and the town's market, every price and limit the economy's own).
 *
 * Where else a good sells best sits behind "Other ports" in the deal panel. Trade routes are a second view of
 * his panel (the "Trade routes" button at its top; ./routes.tsx). Route params `{ person: 'merchant' }` open
 * his panel at once.
 *
 * Test ids: home-market (the room's picture), market-work, home-stores, market-view-routes, market-view-goods,
 * market-closed, and those of the shortcuts, the board and the routes.
 */
import { useState, type ReactElement } from 'react';
import type { GameState, GoodId } from '@sim/core/state';
import { readStorehouse, storedGoods } from '@sim/modules/economy/storehouse';
import { loadContent } from '../../app/content';
import { useGame } from '../../app/gameStore';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatNumber, tOr, useT } from '../../i18n/index';
import { InteriorRoom, useRoutePerson } from '../../render/interiors/index';
import { marketRoom } from '../../render/interiors/rooms/market';
import { ambienceOf } from '../../render/scenes/ambience';
import { Button, Icon } from '../../ui/index';
import { hasMarket, knownMarkets } from '../settlement/knownMarkets';
import { MarketBoard } from '../settlement/market';
import { QuickCards, QuickConfirm, type QuickKind } from './quickDeals';
import { RoutesPanel } from './routes';
import './market.css';

type View = 'goods' | 'routes';

/** Everything the home Market offers (the Merchant's panel): the stores line, the shortcuts, the goods, routes. */
export function MerchantWork({ state }: { state: GameState }): ReactElement {
  const t = useT();
  const [view, setView] = useState<View>('goods');
  const [confirm, setConfirm] = useState<QuickKind | undefined>(undefined);
  const [result, setResult] = useState<string | undefined>(undefined);
  const loaded = loadContent();
  const homeId = state.player.capitalId;
  const s = state.settlements[homeId];
  if (!loaded.ok || !s)
    return (
      <p className="faint" data-testid="market-closed">
        {t('economy.ui.market.none')}
      </p>
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
    <div className="mkt-work" data-testid="market-work" data-view={view}>
      <div className="mkt-top">
        <div className="mkt-top-text">
          {view === 'routes' && <p className="mkt-place">{t('economy.ui.market.tab.routes')}</p>}
          <p className="trd-stores" data-testid="home-stores">
            {t('economy.ui.market.storehouseLine', { silver: formatNumber(treasury), rations: formatNumber(store.rations), tons: Math.round(goodsTons * 10) / 10 })}
          </p>
        </div>
        {switchView}
      </div>
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
    </div>
  );
}

/**
 * The home Market for a state (exported for tests): the storehouse with the Merchant in it; his panel open when
 * `person` (controlled) or `initialPerson` says so.
 */
export function HomeMarket({ state, onClose, person, initialPerson, onPersonChange }: { state: GameState; onClose(): void; person?: string | null; initialPerson?: 'merchant'; onPersonChange?(id: string | null): void }): ReactElement {
  const t = useT();
  const s = state.settlements[state.player.capitalId];
  return (
    <InteriorRoom
      room={marketRoom}
      ambience={ambienceOf(state)}
      subtitle={s ? t('economy.ui.market.subtitle', { place: t('hub.interior.at', { place: s.name }), state: tOr(`economy.economyState.${s.economy}`, s.economy) }) : undefined}
      {...(person !== undefined ? { person } : { initialPerson: initialPerson ?? null })}
      onPersonChange={onPersonChange}
      stageTestId="home-market"
      onLeave={onClose}
      panel={() => <MerchantWork state={state} />}
    />
  );
}

function HomeMarketScreen({ params, close }: ScreenProps): ReactElement {
  const state = useGame((s) => s.state);
  const [person, setPerson] = useRoutePerson(marketRoom, ['building.market'], params);
  if (!state) return <div />;
  return <HomeMarket state={state} person={person} onPersonChange={setPerson} onClose={close} />;
}

export const screen: ScreenDescriptor = { id: 'homeMarket', route: 'building.market', staysUnder: true, component: HomeMarketScreen, layout: 'overlay', titleKey: 'economy.ui.market.title' };
