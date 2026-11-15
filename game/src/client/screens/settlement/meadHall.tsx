/**
 * The mead-hall, shared by the home Mead-hall (route 'building.meadHall') and the settlement visit abroad, laid
 * out by ARCHITECTURE §20 as a warm scene rather than a form: a few big choices, each answered in one or two
 * readable lines in the result area below them.
 *
 *   TavernPanel    — the choices: ask for news, hear the travellers, buy a round (settlements' `tavernAction`;
 *                    `actions` picks which, so each person in the home hall offers their own), and, when
 *                    `sellswords` is set, look for sellswords; then the result area
 *   SellswordPanel — this month's sellswords as cards: who, the price, one Hire button (military
 *                    `sellswordOffers`, validated by `hireIssues`)
 *   NewsLog        — the latest few things heard (news `playerNews`); the rest behind Details
 *   IntelPanel     — what the house believes about other places (intel `intelSummary`) and the maps it holds
 * The home Mead-hall (../meadHall) puts them behind its Hall-keeper, Travellers and Sellswords.
 *
 * The settlements module's "have a drink" is not offered: it costs silver for a small chance of one rumour,
 * while "ask for news" is free and hears it all. Every rule (costs, presence, availability) is read from the
 * modules or their tunables; nothing is decided here.
 */
import { useState, type ReactElement } from 'react';
import type { Content } from '@content/index';
import type { SimEvent } from '@sim/core/events';
import type { FactionId, GameState, SettlementId } from '@sim/core/state';
import { intelSummary, knownSettlements, type IntelFactView } from '@sim/modules/intel/query';
import { hireIssues, lieutenantCapacity, sellswordOffers } from '@sim/modules/military/lieutenants';
import { keeperNews, playerNews, type NewsView, type PlayerNewsView } from '@sim/modules/news/query';
import { useGame } from '../../app/gameStore';
import { formatNumber, tOr, useT } from '../../i18n/index';
import { Button, ChoiceCard, ChoiceGrid, Disclosure, Icon, Portrait, type IconName } from '../../ui/index';
import './hall.css';

type T = ReturnType<typeof useT>;

/** The four tavern actions of the settlements module. */
export const TAVERN_ACTIONS = ['anyNews', 'travellers', 'drink', 'buyRound'] as const;
export type TavernActionId = (typeof TAVERN_ACTIONS)[number];
/** The ones the hall offers (see the file header for the drink). */
export const HALL_ACTIONS: readonly TavernActionId[] = ['anyNews', 'travellers', 'buyRound'];

const ACTION_ICON: Record<TavernActionId, IconName> = { anyNews: 'quill', travellers: 'eye', drink: 'favor', buyRound: 'renown' };

/** How many of the latest news items are in view; the rest are behind Details. */
const RECENT = 3;

function placeName(state: GameState, id: string): string {
  return state.settlements[id as SettlementId]?.name ?? id;
}

function factionName(state: GameState, id: string): string {
  return state.factions[id as FactionId]?.name ?? id;
}

/** Silver an action costs at a settlement (settlements tunables). */
export function tavernCost(state: GameState, content: Content, settlementId: SettlementId, action: TavernActionId): number {
  const t = content.tunables.settlements.tavern;
  if (action === 'drink') return t.drinkCost;
  if (action === 'buyRound') {
    const tier = state.settlements[settlementId]?.tier;
    return (tier !== undefined ? t.roundCost[tier] : undefined) ?? 20;
  }
  return 0;
}

/**
 * Why a tavern action cannot be taken right now (a locale key), or undefined. Mirrors the command's
 * checks: someone of the house must be there, and the purse (the fleet's abroad, else the treasury) must pay.
 */
export function tavernBlock(state: GameState, content: Content, settlementId: SettlementId, action: TavernActionId): string | undefined {
  if (state.pending !== null) return 'settlements.ui.hall.decisionFirst';
  const s = state.settlements[settlementId];
  if (!s) return 'settlements.error.unknownSettlement';
  const home = s.factionId === state.player.factionId;
  const ruler = state.characters[state.player.rulerId];
  const rulerHere = ruler?.location.kind === 'settlement' && ruler.location.id === settlementId;
  const fleet = state.player.expeditionFleetId !== undefined ? state.fleets[state.player.expeditionFleetId] : undefined;
  const r = content.tunables.settlements.presenceRadius;
  const fleetHere = fleet !== undefined && fleet.mode !== 'sailing' && (fleet.pos.x - s.mapPos.x) ** 2 + (fleet.pos.y - s.mapPos.y) ** 2 <= r * r;
  if (!home && state.settlementsState?.inside !== settlementId) return 'settlements.error.notInside';
  if (!rulerHere && !fleetHere) return 'settlements.error.notThere';
  const cost = tavernCost(state, content, settlementId, action);
  if (cost > 0) {
    const treasury = state.factions[state.player.factionId]?.treasury ?? 0;
    if (!((fleet !== undefined && !home && fleet.silver >= cost) || treasury >= cost)) return 'settlements.error.notEnoughSilver';
  }
  return undefined;
}

/** What came of a tavern action, from the events the command returned. */
function resultLine(state: GameState, action: TavernActionId, events: readonly SimEvent[], cost: number, t: T): string {
  if (action === 'anyNews') return t('settlements.ui.hall.result.news', { count: events.filter((e) => e.type === 'NewsHeard').length });
  if (action === 'travellers') {
    const places = events.flatMap((e) => (e.type === 'IntelGained' && e.observer === state.player.factionId ? [placeName(state, e.settlementId)] : []));
    return t('news.ui.hall.result.travellers', { count: places.length, places: places.join(', ') });
  }
  if (action === 'drink') return t('settlements.ui.hall.result.drinkHeard', { silver: cost, heard: events.filter((e) => e.type === 'NewsHeard').length });
  const renown = events.reduce((n, e) => n + (e.type === 'StandingChanged' && e.stat === 'renown' ? e.delta : 0), 0);
  const loyalty = events.some((e) => e.type === 'LoyaltyChanged');
  return t('settlements.ui.hall.result.round', { silver: cost, renown, loyalty: loyalty ? 'yes' : 'no' });
}

function when(state: GameState, view: NewsView | PlayerNewsView, t: T): string {
  return t('news.label.happened', { days: Math.floor(view.ageDays), place: placeName(state, view.originId) });
}

/** One news item: the headline, then one quiet line (rumour or confirmed, when and where). */
export function NewsRow({ state, view }: { state: GameState; view: NewsView | PlayerNewsView }): ReactElement {
  const t = useT();
  const heard = 'via' in view ? view : undefined;
  const label = heard?.witnessed ? 'witnessed' : view.rumour ? 'rumour' : 'confirmed';
  return (
    <li className={`hall-news hall-news-${label}`} data-testid="news-item" data-news={view.id} data-importance={view.importance}>
      <p className="hall-headline">{tOr(view.textKey, t('news.item.generic'), view.vars)}</p>
      <p className="hall-news-meta">{t('news.ui.meta', { label: t(`news.label.${label}`), when: when(state, view, t) })}</p>
    </li>
  );
}

type HallResult = { kind: 'tavern'; action: TavernActionId; text: string } | { kind: 'sellswords' };

/**
 * The hall's choices and the result area (see the file header). `actions` picks which of the hall's choices are
 * offered (default all three: the visit abroad); the home Mead-hall's people each offer their own.
 */
export function TavernPanel({
  state,
  content,
  settlementId,
  sellswords = false,
  actions = HALL_ACTIONS,
}: {
  state: GameState;
  content: Content;
  settlementId: SettlementId;
  sellswords?: boolean;
  actions?: readonly TavernActionId[];
}): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const [result, setResult] = useState<HallResult | undefined>(undefined);
  const home = state.settlements[settlementId]?.factionId === state.player.factionId;
  const act = (a: TavernActionId) => {
    const cost = tavernCost(state, content, settlementId, a);
    const r = dispatch({ type: 'tavernAction', settlementId, action: a });
    if (!r || r.error) return;
    setResult({ kind: 'tavern', action: a, text: resultLine(r.state, a, r.events, cost, t) });
  };
  const tidings = result?.kind === 'tavern' && result.action === 'anyNews' ? keeperNews(state, settlementId, content) : [];
  const offers = sellswords ? sellswordOffers(state, content, settlementId).filter((o) => !o.hired).length : 0;
  const line = (a: TavernActionId) => {
    const cost = tavernCost(state, content, settlementId, a);
    if (a === 'buyRound') return t('news.ui.hall.line.buyRound', { silver: cost, home: home ? 'yes' : 'no' });
    return t(`news.ui.hall.line.${a}`);
  };
  const count = actions.length + (sellswords ? 1 : 0);
  return (
    <div className="hall-scene" data-testid="meadhall">
      <ChoiceGrid columns={count >= 4 ? 2 : Math.max(1, count)} label={t('settlements.tavern.title')} className="hall-choices">
        {actions.map((a) => {
          const block = tavernBlock(state, content, settlementId, a);
          return (
            <ChoiceCard
              key={a}
              icon={ACTION_ICON[a]}
              title={t(`news.ui.hall.${a}`)}
              line={line(a)}
              reason={
                block !== undefined ? (
                  <span data-testid={`tavern-${a}-why`}>
                    <Icon name="warning" /> {t(block)}
                  </span>
                ) : undefined
              }
              disabled={block !== undefined}
              onClick={() => act(a)}
              data-testid={`tavern-${a}`}
            />
          );
        })}
        {sellswords && (
          <ChoiceCard
            icon="sword"
            title={t('news.ui.hall.sellswords')}
            line={t('news.ui.hall.line.sellswords', { count: offers })}
            selected={result?.kind === 'sellswords'}
            onClick={() => setResult(result?.kind === 'sellswords' ? undefined : { kind: 'sellswords' })}
            data-testid="hall-sellswords"
          />
        )}
      </ChoiceGrid>
      <div className="hall-result" data-testid="hall-result">
        {result === undefined ? (
          <p className="hall-result-hint">{t('news.ui.hall.pick')}</p>
        ) : result.kind === 'sellswords' ? (
          <SellswordPanel state={state} content={content} settlementId={settlementId} />
        ) : (
          <>
            <p className="hall-result-line" role="status" data-testid="tavern-result">
              {result.text}
            </p>
            {result.action === 'anyNews' && (
              <div className="hall-keeper" data-testid="keeper-news">
                {tidings.length > 0 ? (
                  <ul className="hall-news-list">
                    {tidings.slice(0, RECENT).map((v) => (
                      <NewsRow key={v.id} state={state} view={v} />
                    ))}
                  </ul>
                ) : (
                  <p className="hall-quiet">{t('news.keeper.none')}</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The latest few things heard, the rest behind Details. */
export function NewsLog({ state, content }: { state: GameState; content: Content }): ReactElement {
  const t = useT();
  const all = playerNews(state, content);
  const recent = all.slice(0, RECENT);
  const rest = all.slice(RECENT);
  return (
    <section className="hall-log" data-testid="news-log" aria-label={t('news.ui.recent')}>
      <h3 className="hall-side-title">{t('news.ui.recent')}</h3>
      {all.length === 0 ? (
        <p className="hall-quiet" data-testid="news-empty">
          {t('news.ui.empty')}
        </p>
      ) : (
        <ul className="hall-news-list">
          {recent.map((v) => (
            <NewsRow key={v.id} state={state} view={v} />
          ))}
        </ul>
      )}
      {rest.length > 0 && (
        <Disclosure summary={t('news.ui.older', { count: rest.length })} data-testid="news-older" lazy>
          <ul className="hall-news-list">
            {rest.map((v) => (
              <NewsRow key={v.id} state={state} view={v} />
            ))}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}

/** A sellsword's level in a word. */
function levelWord(level: number, t: T): string {
  return t(`news.ui.merc.level.${Math.max(1, Math.min(5, Math.round(level)))}`);
}

/** This month's sellswords at a mead-hall as cards, each with the reason it cannot be hired. */
export function SellswordPanel({ state, content, settlementId }: { state: GameState; content: Content; settlementId: SettlementId }): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const offers = sellswordOffers(state, content, settlementId);
  const cap = lieutenantCapacity(state, content, state.player.factionId);
  if (offers.length === 0)
    return (
      <p className="hall-quiet" data-testid="sellswords-empty">
        {t('settlements.ui.sellswords.none')}
      </p>
    );
  return (
    <div className="hall-mercs" data-testid="sellswords">
      <p className={cap.free <= 0 ? 'hall-quiet hall-merc-why' : 'hall-quiet'} data-testid="sellswords-room">
        {t('news.ui.merc.room', { free: cap.free })}
      </p>
      <ul className="hall-merc-list">
        {offers.map((o) => {
          const { issues } = hireIssues(state, content, { settlementId, offer: o.index });
          // A full hall is said once above the cards, not on every card.
          const first = state.pending !== null ? undefined : issues.find((i) => i !== 'alreadyHired' && !(i === 'capacity' && cap.free <= 0));
          const skills = (Object.entries(o.skills) as [string, number][])
            .filter(([, v]) => v > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2)
            .map(([k]) => tOr(`ui.skill.${k}`, k));
          const culture = tOr(`core.culture.${o.culture}.name`, content.cultures[o.culture]?.name ?? o.culture);
          return (
            <li key={o.index} className={`hall-merc${o.hired ? ' is-hired' : ''}`} data-testid={`sellsword-${o.index}`}>
              <Portrait recipe={{ seed: o.portraitSeed, sex: o.sex, culture: o.culture, age: o.age, rank: 'warrior', traits: o.traits }} alt={o.name} size="sm" />
              <div className="hall-merc-text">
                <strong className="hall-merc-name">{o.name}</strong>
                <span className="hall-merc-who">{t('news.ui.merc.who', { culture, age: o.age, level: levelWord(o.level, t) })}</span>
                {skills.length > 0 && <span className="hall-merc-best">{t('news.ui.merc.best', { skills: skills.join(t('news.ui.merc.and')) })}</span>}
                {first !== undefined && !o.hired && (
                  <span className="hall-merc-why" data-testid={`hire-${o.index}-why`}>
                    <Icon name="warning" /> {tOr(`military.error.${first}`, t('settlements.ui.sellswords.cannot'))}
                  </span>
                )}
              </div>
              <div className="hall-merc-deal">
                <span className="hall-merc-price">{t('settlements.ui.sellswords.price', { silver: o.price })}</span>
                {o.hired ? (
                  <span className="hall-merc-hired">{t('settlements.ui.sellswords.hired')}</span>
                ) : (
                  <Button disabled={state.pending !== null || issues.length > 0} onClick={() => dispatch({ type: 'hireSellsword', settlementId, offer: o.index })} data-testid={`hire-${o.index}`}>
                    {t('settlements.ui.sellswords.hire')}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function factValue(state: GameState, v: IntelFactView, t: T): string {
  if (v.range !== undefined && v.key !== 'economy') {
    const [lo, hi] = v.range;
    return Math.round(lo) === Math.round(hi) ? formatNumber(Math.round(lo)) : t('intel.range', { lo, hi });
  }
  const value = v.value;
  if (v.key === 'economy' && typeof value === 'string') return tOr(`economy.economyState.${value}`, value);
  if (v.key === 'leader' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const name = (value as Record<string, unknown>)['name'];
    return typeof name === 'string' ? name : t('intel.ui.unknownValue');
  }
  if (v.key === 'wars' && Array.isArray(value)) return value.length === 0 ? t('intel.ui.atPeace') : value.map((id) => factionName(state, String(id))).join(', ');
  if (v.key === 'relicRumor') return t('intel.ui.relicHeard');
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return t('intel.ui.unknownValue');
}

/** What the house has been told of other places (one short paragraph each), and the maps it holds. */
export function IntelPanel({ state, content }: { state: GameState; content: Content }): ReactElement {
  const t = useT();
  const ids = knownSettlements(state).filter((id) => state.settlements[id]?.factionId !== state.player.factionId);
  const records = ids
    .map((id) => ({ id, facts: intelSummary(state, content, id) }))
    .filter((r) => r.facts.length > 0)
    .map((r) => ({ ...r, age: Math.min(...r.facts.map((f) => f.ageDays)) }))
    .sort((a, b) => a.age - b.age);
  const maps = Object.values(state.player.house.maps ?? {});
  return (
    <div className="hall-intel" data-testid="intel-panel">
      {records.length === 0 ? (
        <p className="hall-quiet" data-testid="intel-empty">
          {t('intel.ui.empty')}
        </p>
      ) : (
        <ul className="hall-intel-list">
          {records.map((r) => (
            <li key={r.id} className="hall-place" data-testid={`intel-${r.id}`}>
              <strong className="hall-place-name">{placeName(state, r.id)}</strong>
              <span className="hall-place-facts">
                {r.facts
                  .map((f) => t('news.ui.places.fact', { fact: t(`intel.fact.${f.key}`), value: factValue(state, f, t), conflict: f.conflict ? 'yes' : 'no' }))
                  .join(t('news.ui.places.sep'))}
              </span>
              <span className="hall-place-age">{t('news.ui.places.heard', { days: Math.floor(r.age) })}</span>
            </li>
          ))}
        </ul>
      )}
      {maps.length === 0 ? (
        <p className="hall-quiet" data-testid="maps-empty">
          {t('intel.ui.noMaps')}
        </p>
      ) : (
        <ul className="hall-maps" data-testid="maps-held">
          {maps.map((m) => (
            <li key={m.siteId}>
              {t('intel.ui.mapLine', { site: state.sites[m.siteId]?.name ?? m.siteId, place: m.fromSettlementId !== undefined ? placeName(state, m.fromSettlementId) : 'none', price: m.price })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
