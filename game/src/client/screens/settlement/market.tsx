/**
 * The market board shared by the home Market (route 'building.market') and the settlement visit abroad,
 * laid out by ARCHITECTURE §20: the goods that matter here as large tiles (a picture, the name, the price in a
 * word with the number beside it), and one deal at a time.
 *
 * Picking a good opens one big two-sided `TransferSlider` (rule 6): the player's side (the house storehouse at
 * home, the ships' holds abroad) on the left, the market on the right; the handle sits between the two piles.
 * Moving goods onto the market's pile sells them, taking from it buys; the silver gained or paid and the purse
 * afterwards update live in words. Buying stops at the first limit (the market's stock, the holds, the purse),
 * and the limit's reason shows when the handle rests on it. "Strike the deal" dispatches one `trade`.
 *
 * Every number is the economy's own: prices from `marketPrice`, every quote and every limit from `priceDeal`
 * (via ./knownMarkets: spread, Speechcraft, tariffs, the price moving as the stock runs down). Where else the
 * chosen good sells best and is cheapest (the markets the player knows) sits behind "Other ports".
 * Haggling has no screen: the economy's `haggle` command is not offered here.
 * A war-band on the march (`fleet.overland`) trades from what its men carry: the same limits (the economy's
 * `holdOf` gives its carrying limit), with words for packs instead of holds.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { Content } from '@content/index';
import type { GameState, GoodId, SettlementId } from '@sim/core/state';
import { useGame } from '../../app/gameStore';
import { formatNumber, tOr, useT } from '../../i18n/index';
import { Button, ChoiceCard, Disclosure, Icon, TransferSlider, type TransferMark } from '../../ui/index';
import { formatTons, goodName } from '../expedition/names';
import { GoodArt } from '../market/goodArt';
import {
  bestPrice,
  dealQuote,
  goodIds,
  heldTons,
  holderFields,
  knownMarkets,
  marketClosedCode,
  maxBuy,
  priceAt,
  priceSignal,
  purseOf,
  type Holder,
} from './knownMarkets';
import './trade.css';

export interface MarketBoardProps {
  state: GameState;
  content: Content;
  settlementId: SettlementId;
  /** The player's side: the fleet in the harbour (abroad) or the house storehouse (the capital). */
  holder: Holder;
  /** Other markets to compare prices with (default: every market the player knows but this one). */
  elsewhere?: readonly SettlementId[];
  /** Shown in place of the deal panel (the home Market's "Sell all loot" confirmation). */
  aside?: ReactNode;
  /** Called when the player picks (or puts down) a good. */
  onPick?(good: GoodId | undefined): void;
}

type T = ReturnType<typeof useT>;

function errorText(t: T, code: string, onFoot = false): string {
  const plain = tOr(`economy.error.${code}`, t('economy.ui.market.cannot'));
  return onFoot ? tOr(`economy.error.${code}.march`, plain) : plain;
}

/** The player's side is a war-band on the march (it carries its goods; no ships). */
function onFootOf(holder: Holder): boolean {
  return holder.kind === 'fleet' && (holder.fleet as { overland?: unknown }).overland !== undefined;
}

/** Tons with the ration count beside them for rations ("2.7 t (2,700)"). */
export function heldLabel(content: Content, good: GoodId, tons: number): string {
  if (good !== 'rations') return formatTons(tons);
  return `${formatTons(tons)} (${formatNumber(Math.round(tons * content.balance.economy.rationsPerTon))})`;
}

const kg = (v: number) => Math.floor(v * 1000 + 1e-6) / 1000;

/**
 * The slider snaps the market's side to a grid from zero, but a market's stock rarely sits on it; the deal is
 * kept on a grid from where the stock stands instead: each move is whole steps (at least one, so every key
 * press moves it), and ten presses of a 0.1 t step trade exactly one ton.
 */
function onStepGrid(current: number, moved: number, step: number): number {
  if (Math.abs(moved) < 1e-9) return current;
  const steps = Math.max(1, Math.round(Math.abs(moved) / step));
  return Math.round((current + Math.sign(moved) * steps * step) * 1000) / 1000;
}

/** The deal for one good: the two-sided slider, the live quote and the button (see the file header). */
function DealPanel({
  state,
  content,
  settlementId,
  holder,
  good,
  elsewhere,
  onDone,
}: {
  state: GameState;
  content: Content;
  settlementId: SettlementId;
  holder: Holder;
  good: GoodId;
  elsewhere: readonly SettlementId[];
  onDone(text: string): void;
}): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const [delta, setDelta] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  // A newly picked good's deal comes into view (the visit panel abroad stacks it above the goods).
  useEffect(() => {
    // (Some browsers return a promise from scrollIntoView: never hand it to React as a clean-up.)
    if (holder.kind === 'fleet') panel.current?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const home = holder.kind === 'storehouse';
  const onFoot = onFootOf(holder);
  const stock = kg(state.markets[settlementId]?.stock[good] ?? 0);
  const held = kg(heldTons(state, content, holder, good));
  const total = kg(stock + held);
  const step = total > 60 ? 0.5 : 0.1;
  const closed = marketClosedCode(state, content, settlementId, holder);
  const limit = useMemo(() => maxBuy(state, content, settlementId, good, holder), [state, content, settlementId, good, holder]);
  const lowest = kg(Math.max(0, stock - limit.tons));
  const value = Math.min(total, Math.max(lowest, kg(stock + delta)));
  const sell = kg(value - stock);
  const buy = kg(stock - value);
  const side: 'sell' | 'buy' | 'none' = sell > 0 ? 'sell' : buy > 0 ? 'buy' : 'none';
  const quote = side === 'none' ? undefined : dealQuote(state, content, settlementId, side, good, side === 'sell' ? sell : buy, holder);
  const purse = purseOf(state, settlementId, holder);
  const busy = state.pending !== null;
  const price = priceAt(state, content, settlementId, good);
  const word = t(`economy.ui.market.signal.${priceSignal(content, good, price)}`);
  const tons = (n: number) => t('economy.ui.trade.tons', { tons: formatTons(n) });
  const rationsNote = good === 'rations' ? (n: number) => t('economy.ui.trade.rations', { rations: formatNumber(Math.round(n * content.balance.economy.rationsPerTon)) }) : undefined;

  const strike = () => {
    if (side === 'none' || !quote?.ok) return;
    const amount = side === 'sell' ? sell : buy;
    const r = dispatch({ type: 'trade', settlementId, [side]: { [good]: amount }, ...holderFields(holder) });
    if (!r || r.error) return;
    setDelta(0);
    onDone(t(side === 'sell' ? 'economy.ui.trade.done.sold' : 'economy.ui.trade.done.bought', { tons: formatTons(amount), good: goodName(good), silver: quote.silver }));
  };

  const marks: TransferMark[] = [];
  if (held > 0) marks.push({ value: total, label: t('economy.ui.trade.mark.sellAll'), testId: 'market-slider-mark-sellall' });
  if (limit.tons > 0) marks.push({ value: lowest, label: t('economy.ui.trade.mark.buyMost'), testId: 'market-slider-mark-buymost' });
  if (side !== 'none') marks.push({ value: stock, label: t('economy.ui.trade.mark.reset'), testId: 'market-slider-mark-reset' });

  const limitReason = limit.limit === 'hold' ? t(onFoot ? 'economy.ui.trade.limit.carry' : 'economy.ui.trade.limit.hold') : limit.limit === 'silver' ? t('economy.ui.trade.limit.silver') : t('economy.ui.market.cannot');
  const markets = elsewhere.filter((id) => id !== settlementId);
  const bestSell = bestPrice(state, content, good, markets, 'sell');
  const bestBuy = bestPrice(state, content, good, markets, 'buy');
  const place = (id: SettlementId) => state.settlements[id]?.name ?? id;
  const cmp = (p: number, better: boolean) => (p === price ? 'same' : better ? 'better' : 'worse');

  return (
    <div ref={panel} className="trd-deal" data-testid="market-deal" data-good={good}>
      <header className="trd-deal-head">
        <GoodArt good={good} size="lg" />
        <div>
          <h3 className="trd-deal-title">{goodName(good)}</h3>
          <p className="trd-deal-price" data-testid="market-price">
            {t('economy.ui.trade.priceHere', { word, silver: price })}
          </p>
        </div>
      </header>
      {closed !== undefined ? (
        <p className="trd-why tone-bad" data-testid="market-closed">
          <Icon name="warning" /> {errorText(t, closed, onFoot)}
        </p>
      ) : (
        <>
          <TransferSlider
            label={goodName(good)}
            total={total}
            value={value}
            onChange={(v) => setDelta(v >= total || v <= lowest ? kg(v - stock) : onStepGrid(value - stock, v - value, step))}
            left={{ label: home ? t('economy.ui.market.yours') : onFoot ? t('economy.ui.trade.packs') : t('economy.ui.trade.holds'), icon: home ? 'crown' : onFoot ? 'men' : 'ship', ...(rationsNote ? { note: rationsNote } : {}) }}
            right={{ label: t('economy.ui.trade.market'), icon: 'silver', note: (n: number) => (n <= 0 ? t('economy.ui.trade.soldOut') : '') }}
            step={step}
            min={lowest}
            minReason={limitReason}
            marks={marks}
            format={tons}
            slots={0}
            data-testid="market-slider"
          />
          <div className="trd-quote" data-testid="market-quote" data-side={side} role="status">
            {side === 'none' ? (
              <p className="trd-quote-hint">{t('economy.ui.trade.line.none')}</p>
            ) : quote?.ok ? (
              <>
                <p className="trd-quote-main">{t(side === 'sell' ? 'economy.ui.trade.line.sell' : 'economy.ui.trade.line.buy', { tons: formatTons(side === 'sell' ? sell : buy), silver: quote.silver })}</p>
                <p className="trd-quote-after">{t(home || state.settlements[settlementId]?.factionId === state.player.factionId ? 'economy.ui.trade.after.treasury' : 'economy.ui.trade.after.purse', { silver: Math.max(0, purse + (side === 'sell' ? quote.silver : -quote.silver)) })}</p>
              </>
            ) : (
              <p className="tone-bad">
                <Icon name="warning" /> {quote ? errorText(t, quote.code, onFoot) : ''}
              </p>
            )}
          </div>
          <div className="trd-deal-go">
            <Button variant="primary" size="lg" icon="check" disabled={busy || side === 'none' || !quote?.ok} onClick={strike} data-testid="market-strike">
              {t('economy.ui.trade.strike')}
            </Button>
            {busy && (
              <span className="trd-why muted">
                <Icon name="hourglass" /> {t('economy.ui.market.decisionFirst')}
              </span>
            )}
          </div>
        </>
      )}
      <Disclosure summary={t('economy.ui.trade.elsewhere')} className="trd-elsewhere" data-testid="market-elsewhere">
        {markets.length === 0 ? (
          <p className="faint" data-testid="known-empty">
            {t('economy.ui.known.none')}
          </p>
        ) : (
          <div className="trd-elsewhere-lines" data-testid="known-markets">
            <p>
              {bestSell
                ? t('economy.ui.trade.bestSell', { place: place(bestSell.id), silver: bestSell.price, cmp: cmp(bestSell.price, bestSell.price > price) })
                : t('economy.ui.trade.noSell')}
            </p>
            <p>
              {bestBuy
                ? t('economy.ui.trade.bestBuy', { place: place(bestBuy.id), silver: bestBuy.price, cmp: cmp(bestBuy.price, bestBuy.price < price) })
                : t('economy.ui.trade.noBuy')}
            </p>
          </div>
        )}
      </Disclosure>
    </div>
  );
}

/** The goods tiles and the deal panel (see the file header). */
export function MarketBoard({ state, content, settlementId, holder, elsewhere, aside, onPick }: MarketBoardProps): ReactElement {
  const t = useT();
  const market = state.markets[settlementId];
  const held = (g: GoodId) => heldTons(state, content, holder, g);
  const goods = goodIds(content).filter((g) => (market?.stock[g] ?? 0) > 0.005 || held(g) > 0.0005);
  const [picked, setPicked] = useState<GoodId | undefined>(undefined);
  const [done, setDone] = useState<string | undefined>(undefined);
  const selected = picked !== undefined && goods.includes(picked) ? picked : undefined;
  const others = elsewhere ?? knownMarkets(state, content, settlementId);

  if (!market) return <p className="faint">{t('economy.ui.market.none')}</p>;
  if (goods.length === 0)
    return (
      <p className="faint" data-testid="market-empty">
        {t('economy.ui.market.empty')}
      </p>
    );

  const pick = (g: GoodId) => {
    const next = g === selected ? undefined : g;
    setPicked(next);
    setDone(undefined);
    onPick?.(next);
  };

  return (
    <div className="trd-board" data-testid="market">
      <div className="trd-goods" role="group" aria-label={t('economy.ui.trade.goods')}>
        {goods.map((g) => {
          const price = priceAt(state, content, settlementId, g);
          const signal = priceSignal(content, g, price);
          const mine = held(g);
          return (
            <ChoiceCard
              key={g}
              size="sm"
              className={`trd-tile trd-${signal}`}
              picture={<GoodArt good={g} />}
              title={goodName(g)}
              line={
                <>
                  <span className={`trd-word trd-word-${signal}`}>{t(`economy.ui.market.signal.${signal}`)}</span>
                  {mine > 0.0005 && (
                    <span className="trd-held" data-testid={`held-${g}`}>
                      {t(holder.kind === 'storehouse' ? 'economy.ui.trade.held.home' : onFootOf(holder) ? 'economy.ui.trade.held.carried' : 'economy.ui.trade.held.abroad', { tons: formatTons(mine) })}
                    </span>
                  )}
                </>
              }
              selected={g === selected}
              onClick={() => pick(g)}
              data-good={g}
              data-testid={`market-row-${g}`}
            />
          );
        })}
      </div>
      <div className="trd-side">
        {aside ??
          (selected ? (
            <DealPanel key={selected} state={state} content={content} settlementId={settlementId} holder={holder} good={selected} elsewhere={others} onDone={setDone} />
          ) : (
            <div className="trd-pick">
              <p className="trd-pick-main">{t('economy.ui.trade.pick')}</p>
              <p className="trd-pick-sub">{t(holder.kind === 'storehouse' ? 'economy.ui.trade.hint.home' : onFootOf(holder) ? 'economy.ui.trade.hint.march' : 'economy.ui.trade.hint.abroad')}</p>
            </div>
          ))}
        {done !== undefined && aside === undefined && (
          <p className="trd-done" role="status" data-testid="market-done">
            <Icon name="check" /> {done}
          </p>
        )}
      </div>
    </div>
  );
}
