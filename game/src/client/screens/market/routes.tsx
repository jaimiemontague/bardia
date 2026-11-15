/**
 * Trade routes (design §11.4), the home Market's second view, laid out by ARCHITECTURE §20: the house's routes
 * as short cards (where, how it goes, what it has earned; end one with `clearTradeRoute`), and "Send a knarr":
 * which knarr, to which port, carrying which goods (each marked in a word: dearer or cheaper at the far end).
 * The rarer choices (sailing from a port other than home, a captain of the house instead of a hired factor,
 * goods to bring back) sit behind "More choices". The economy module decides whether the route can be set
 * (`setTradeRoute`); the round trip is its `roundTripDays`.
 */
import { useState, type ReactElement } from 'react';
import type { Content } from '@content/index';
import type { CharId, GameState, GoodId, SettlementId, ShipId } from '@sim/core/state';
import { roundTripDays, routeSlots } from '@sim/modules/economy/routes';
import type { TradeRoute } from '@sim/modules/economy/types';
import { lieutenantsOf } from '@sim/modules/military/lieutenants';
import { useGame } from '../../app/gameStore';
import { tOr, useT } from '../../i18n/index';
import { Button, ChoiceCard, Disclosure, Icon, Select } from '../../ui/index';
import { goodName, shipTypeName } from '../expedition/names';
import { goodIds, knownMarkets, priceAt } from '../settlement/knownMarkets';
import { GoodArt } from './goodArt';

/** Knarrs of the house that can take a route (idle, not with a fleet, not already on a route). */
export function freeKnarrs(state: GameState, content: Content): ShipId[] {
  const types: readonly string[] = content.tunables.economy.routes.shipTypes;
  return Object.values(state.ships)
    .filter((s) => s.ownerId === state.player.factionId && types.includes(s.type) && s.locationFleetId === undefined && s.tradeRouteId === undefined)
    .map((s) => s.id)
    .sort();
}

/** Whether a route can reach a settlement (the economy's rule: coastal, or a port in the world index). */
export function hasHarbour(state: GameState, id: SettlementId): boolean {
  const s = state.settlements[id];
  if (!s) return false;
  return s.coastal || (state.worldIndex?.settlements[id]?.port ?? -1) !== -1;
}

/** Lieutenants free to captain a route (not the ruler, not captive, not already captaining one). */
export function freeCaptains(state: GameState, content: Content): CharId[] {
  const busy = new Set(Object.values(state.economy?.routes ?? {}).flatMap((r) => (r.captainId !== undefined ? [r.captainId] : [])));
  return lieutenantsOf(state, content, state.player.factionId)
    .filter((c) => c.location.kind !== 'captive' && !busy.has(c.id))
    .map((c) => c.id);
}

/** How a good's price at the far end compares with where it is bought, in a word (undefined: not priced at both). */
export type PriceGap = 'dearer' | 'cheaper' | 'same';
export function priceGap(state: GameState, content: Content, from: SettlementId | undefined, to: SettlementId | undefined, g: GoodId): PriceGap | undefined {
  if (from === undefined || to === undefined) return undefined;
  const a = priceAt(state, content, from, g);
  const b = priceAt(state, content, to, g);
  if (!(a > 0) || !(b > 0)) return undefined;
  const pct = (b - a) / a;
  return pct >= 0.1 ? 'dearer' : pct <= -0.1 ? 'cheaper' : 'same';
}

function RouteCard({ state, route }: { state: GameState; route: TradeRoute }): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const ship = state.ships[route.shipId];
  const place = (id: SettlementId) => state.settlements[id]?.name ?? id;
  const active = route.status === 'active';
  return (
    <li className="trd-route" data-testid={`route-${route.id}`}>
      <div className="trd-route-text">
        <strong className="trd-route-path">{t('economy.ui.routes.path', { from: place(route.fromId), to: place(route.toId) })}</strong>
        <span className={active ? 'trd-route-state' : 'trd-route-state tone-bad'}>
          {active ? t('economy.ui.routes.active') : tOr(`economy.route.suspended.${route.suspended ?? 'market'}`, t('economy.ui.routes.suspended'))}
        </span>
        <span className="trd-route-line">{t('economy.ui.trade.routes.line', { ship: ship?.name ?? route.shipId, goods: route.outbound.map(goodName).join(', '), total: route.profit })}</span>
      </div>
      <Button size="sm" variant="danger" disabled={state.pending !== null} onClick={() => dispatch({ type: 'clearTradeRoute', routeId: route.id })} data-testid={`route-clear-${route.id}`}>
        {t('economy.ui.routes.end')}
      </Button>
    </li>
  );
}

function GoodChips({ goods, chosen, onToggle, testId, groupId, gap }: { goods: GoodId[]; chosen: GoodId[]; onToggle(g: GoodId): void; testId: string; groupId?: string; gap(g: GoodId): PriceGap | undefined }): ReactElement {
  const t = useT();
  return (
    <div className="trd-chips" data-testid={groupId ?? testId}>
      {goods.map((g) => {
        const word = gap(g);
        return (
          <ChoiceCard
            key={g}
            size="sm"
            className={`trd-chip${word ? ` trd-gap-${word}` : ''}`}
            picture={<GoodArt good={g} size="sm" />}
            title={goodName(g)}
            line={t(`economy.ui.trade.gap.${word ?? 'unknown'}`)}
            selected={chosen.includes(g)}
            onClick={() => onToggle(g)}
            data-testid={`${testId}-${g}`}
          />
        );
      })}
    </div>
  );
}

/** The trade-routes view of the home Market. */
export function RoutesPanel({ state, content, homeId }: { state: GameState; content: Content; homeId: SettlementId }): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const routes = Object.values(state.economy?.routes ?? {}).filter((r) => r.factionId === state.player.factionId);
  const slots = routeSlots(state, content);
  const knarrs = freeKnarrs(state, content);
  const captains = freeCaptains(state, content);
  const markets = knownMarkets(state, content).filter((id) => hasHarbour(state, id));
  const all = markets.includes(homeId) ? markets : [homeId, ...markets];
  const [shipId, setShipId] = useState<ShipId | ''>('');
  const [captainId, setCaptainId] = useState<CharId | ''>('');
  const [fromId, setFromId] = useState<SettlementId>(homeId);
  const [toId, setToId] = useState<SettlementId | ''>('');
  const [outbound, setOutbound] = useState<GoodId[]>([]);
  const [inbound, setInbound] = useState<GoodId[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const ship = shipId !== '' && knarrs.includes(shipId) ? shipId : knarrs[0];
  const to = toId !== '' && toId !== fromId ? toId : all.find((id) => id !== fromId);
  const goods = goodIds(content).filter((g) => g !== 'rations');
  const rank: Record<PriceGap | 'none', number> = { dearer: 0, same: 1, cheaper: 2, none: 3 };
  const outGap = (g: GoodId) => priceGap(state, content, fromId, to, g);
  const inGap = (g: GoodId) => priceGap(state, content, to, fromId, g);
  const byGap = (gap: (g: GoodId) => PriceGap | undefined) => [...goods].sort((a, b) => rank[gap(a) ?? 'none'] - rank[gap(b) ?? 'none']);
  const outSorted = byGap(outGap);
  const toggle = (list: GoodId[], set: (v: GoodId[]) => void) => (g: GoodId) => set(list.includes(g) ? list.filter((x) => x !== g) : [...list, g]);
  const block =
    routes.length >= slots
      ? 'economy.error.noSlot'
      : ship === undefined
        ? 'economy.ui.routes.noKnarr'
        : to === undefined
          ? 'economy.ui.routes.noDestination'
          : outbound.length === 0
            ? 'economy.ui.trade.routes.pickGoods'
            : state.pending !== null
              ? 'economy.ui.market.decisionFirst'
              : undefined;
  const submit = () => {
    if (ship === undefined || to === undefined) return;
    const r = dispatch({ type: 'setTradeRoute', shipId: ship, fromId, toId: to, outbound, ...(inbound.length > 0 ? { inbound } : {}), ...(captainId !== '' ? { captainId } : {}) });
    if (r?.error) setError(tOr(`economy.error.${r.error.code}`, r.error.message));
    else if (r) {
      setError(undefined);
      setOutbound([]);
      setInbound([]);
    }
  };
  const place = (id: SettlementId) => state.settlements[id]?.name ?? id;
  return (
    <div className="trd-routes" data-testid="routes">
      <p className="trd-lead">{t('economy.ui.trade.routes.lead', { used: routes.length, slots })}</p>
      {routes.length === 0 ? (
        <p className="faint trd-routes-none" data-testid="routes-empty">
          {t('economy.ui.routes.none')}
        </p>
      ) : (
        <ul className="trd-route-list">
          {routes.map((r) => (
            <RouteCard key={r.id} state={state} route={r} />
          ))}
        </ul>
      )}
      <section className="trd-route-form" data-testid="route-form" aria-label={t('economy.ui.trade.routes.send')}>
        <h3 className="trd-section-title">{t('economy.ui.trade.routes.send')}</h3>
        {knarrs.length === 0 ? (
          <div className="trd-deal-go">
            <Button variant="primary" size="lg" icon="ship" disabled data-testid="route-set">
              {t('economy.ui.routes.set')}
            </Button>
            <span className="trd-why tone-bad" data-testid="route-why">
              <Icon name="warning" /> {t(routes.length >= slots ? 'economy.error.noSlot' : 'economy.ui.routes.noKnarr')}
            </span>
          </div>
        ) : (
          <>
            <div className="trd-route-pickers">
              <label className="trd-field">
                <span>{t('economy.ui.routes.ship')}</span>
                <Select value={ship ?? ''} disabled={knarrs.length === 0} onChange={(e) => setShipId(e.target.value as ShipId)} data-testid="route-ship">
                  {knarrs.length === 0 && <option value="">{t('economy.ui.routes.noKnarrShort')}</option>}
                  {knarrs.map((id) => (
                    <option key={id} value={id}>
                      {`${state.ships[id]?.name ?? id} (${shipTypeName(content, state.ships[id]?.type ?? '')})`}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="trd-field">
                <span>{t('economy.ui.trade.routes.to')}</span>
                <Select value={to ?? ''} disabled={to === undefined} onChange={(e) => setToId(e.target.value as SettlementId)} data-testid="route-to">
                  {to === undefined && <option value="">{t('economy.ui.routes.noDestinationShort')}</option>}
                  {all
                    .filter((id) => id !== fromId)
                    .map((id) => (
                      <option key={id} value={id}>
                        {place(id)}
                      </option>
                    ))}
                </Select>
              </label>
              {to !== undefined && <p className="trd-route-trip">{t('economy.ui.routes.trip', { days: roundTripDays(state, content, fromId, to) })}</p>}
            </div>
            <p className="trd-field-label">{t('economy.ui.trade.routes.carry', { to: to !== undefined ? place(to) : t('economy.ui.routes.farPort') })}</p>
            <GoodChips goods={outSorted.slice(0, 6)} chosen={outbound} onToggle={toggle(outbound, setOutbound)} testId="route-out" gap={outGap} />
            <Disclosure summary={t('economy.ui.trade.routes.more')} className="trd-route-more" data-testid="route-more">
              <GoodChips goods={outSorted.slice(6)} chosen={outbound} onToggle={toggle(outbound, setOutbound)} testId="route-out" groupId="route-out-more" gap={outGap} />
              <div className="trd-route-pickers">
                <label className="trd-field">
                  <span>{t('economy.ui.routes.from')}</span>
                  <Select value={fromId} onChange={(e) => setFromId(e.target.value as SettlementId)} data-testid="route-from">
                    {all.map((id) => (
                      <option key={id} value={id}>
                        {place(id)}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="trd-field">
                  <span>{t('economy.ui.routes.captain')}</span>
                  <Select value={captainId} onChange={(e) => setCaptainId(e.target.value as CharId | '')} data-testid="route-captain">
                    <option value="">{t('economy.ui.routes.hireFactor', { wage: content.balance.economy.factorWage })}</option>
                    {captains.map((id) => (
                      <option key={id} value={id}>
                        {state.characters[id]?.name ?? id}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
              <p className="trd-field-label">{t('economy.ui.trade.routes.bringBack', { from: to !== undefined ? place(to) : t('economy.ui.routes.farPort') })}</p>
              <GoodChips goods={byGap(inGap)} chosen={inbound} onToggle={toggle(inbound, setInbound)} testId="route-in" gap={inGap} />
            </Disclosure>
            <div className="trd-deal-go">
              <Button variant="primary" size="lg" icon="ship" disabled={block !== undefined} onClick={submit} data-testid="route-set">
                {t('economy.ui.routes.set')}
              </Button>
              {block !== undefined && (
                <span className="trd-why tone-bad" data-testid="route-why">
                  <Icon name="warning" /> {t(block)}
                </span>
              )}
              {error !== undefined && block === undefined && (
                <span className="trd-why tone-bad" role="alert">
                  <Icon name="warning" /> {error}
                </span>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
