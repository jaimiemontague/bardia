/**
 * Panels on the sea chart while the expedition is at a settlement:
 *   SettlementHub — after Enter/Trade (settlementsState.inside): a full-screen scene of the place seen from its
 *                   quay (§20.7), with three big places: the Market (economy's trade, priced with its own
 *                   priceDeal), the Mead-hall (settlements' tavernAction, military's sellswords) and Back to
 *                   the ships. Opening a place shows its panel beside the picture. The market board and
 *                   mead-hall panels are shared with the home screens: ./market.tsx and ./meadHall.tsx.
 *   CargoPanel    — after a won raid or a plundering fate (settlementsState.loot): load, burn or give away
 *                   what is left in the storehouses (settlements' loadCargo, §16.2).
 * The hub covers the viewport with fixed positioning wherever the map mounts it (the top bar stays above).
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import type { Content } from '@content/index';
import type { Fleet, GameState, GoodId } from '@sim/core/state';
import { loadContent } from '../../app/content';
import { useGame } from '../../app/gameStore';
import { formatNumber, useT } from '../../i18n/index';
import { ambienceOf, bannerColour, Painting, PLAYER_COLOUR, SceneStage, SettlementPicture, styleOfCulture, timeOfDay, type SettlementPictureModel } from '../../render/scenes/index';
import { hashString } from '../../render/scenes/paint';
import { Button, Frame, IconButton } from '../../ui/index';
import { isScarred } from '../arrivalScene/model';
import { formatTons, goodName } from '../expedition/names';
import { settlementLine } from './index';
import { hasMarket } from './knownMarkets';
import { MarketBoard } from './market';
import { SellswordPanel, TavernPanel } from './meadHall';
import '../../render/scenes/scenes.css';

/** Hold capacity and tons in use (rations count by weight). */
export function holdUse(state: GameState, content: Content, fleet: Fleet): { used: number; capacity: number } {
  let capacity = 0;
  for (const id of fleet.shipIds) capacity += content.balance.ships[state.ships[id]?.type ?? 'snekkja']?.cargoT ?? 0;
  // A war-band on the march has no ships: its men carry the load (expeditions' fleet.overland).
  capacity += fleet.overland?.carryT ?? 0;
  let used = fleet.rations / content.balance.economy.rationsPerTon;
  for (const [g, v] of Object.entries(fleet.cargo)) if (g !== 'rations') used += Math.max(0, v ?? 0);
  return { used, capacity };
}

/** One of the big places to go: a tab when it opens a panel, a plain button for leaving. */
function PlaceCard({ id, title, line, glyph, selected, disabled, onPick, testId, tab }: { id: string; title: string; line: string; glyph: ReactNode; selected?: boolean; disabled?: boolean; onPick(): void; testId: string; tab: boolean }): ReactElement {
  return (
    <button
      type="button"
      className={`st-place${selected ? ' is-open' : ''}${id === 'leave' ? ' is-leave' : ''}`}
      {...(tab ? { role: 'tab', 'aria-selected': selected === true, 'aria-controls': 'st-visit-panel' } : {})}
      disabled={disabled}
      onClick={onPick}
      data-testid={testId}
    >
      <span className="st-place-glyph" aria-hidden="true">
        {glyph}
      </span>
      <span className="st-place-text">
        <span className="st-place-title">{title}</span>
        <span className="st-place-line">{line}</span>
      </span>
    </button>
  );
}

const GLYPHS: Record<'market' | 'meadHall' | 'leave', ReactNode> = {
  market: (
    <svg viewBox="0 0 48 48">
      <path d="M6 18 L24 8 L42 18 Z" fill="currentColor" opacity="0.85" />
      <rect x="9" y="20" width="30" height="18" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="18" cy="31" r="4" fill="currentColor" />
      <circle cx="29" cy="31" r="4" fill="currentColor" opacity="0.6" />
    </svg>
  ),
  meadHall: (
    <svg viewBox="0 0 48 48">
      <path d="M12 12 h20 v6 a10 10 0 0 1 -20 0 Z" fill="currentColor" opacity="0.9" />
      <path d="M32 14 q 8 0 6 8 q -2 6 -8 4" stroke="currentColor" strokeWidth="3" fill="none" />
      <rect x="18" y="28" width="8" height="10" fill="currentColor" />
      <rect x="12" y="38" width="20" height="4" rx="2" fill="currentColor" />
    </svg>
  ),
  leave: (
    <svg viewBox="0 0 48 48">
      <path d="M6 30 Q 24 40 42 30 L38 36 Q 24 42 10 36 Z" fill="currentColor" />
      <line x1="24" y1="30" x2="24" y2="6" stroke="currentColor" strokeWidth="3" />
      <path d="M12 9 L36 9 L38 26 Q 24 30 10 26 Z" fill="currentColor" opacity="0.8" />
    </svg>
  ),
};

export type VisitPlace = 'market' | 'meadHall';

export interface VisitSceneProps {
  name: string;
  /** One line of what the place is (tier, lord, people). */
  line: string;
  kicker: string;
  /** Silver and hold, when the fleet is here. */
  facts?: string;
  picture: SettlementPictureModel;
  assetId: string;
  marketOpen: boolean;
  /** Why the market is shut (shown on its card). */
  marketShut: string;
  place: VisitPlace | null;
  onPlace(place: VisitPlace | null): void;
  onLeave(): void;
  /** The open place's panel (market board, or the mead-hall and its sellswords). */
  panel?: ReactNode;
}

/** The visit as a scene: the place from its quay, three big places, the open place's panel beside it. */
export function VisitScene(p: VisitSceneProps): ReactElement {
  const t = useT();
  const toggle = (x: VisitPlace) => p.onPlace(p.place === x ? null : x);
  const title = p.place === 'market' ? t('settlements.hub.market') : t('settlements.tavern.title');
  return (
    <div className={`st-visit${p.place ? ' has-panel' : ''}`} data-testid="settlement-hub" data-place={p.place ?? 'quay'}>
      <SceneStage cue={null}>
        <div className="scn-root">
          <Painting assetId={p.assetId}>
            <SettlementPicture model={p.picture} testId="visit-picture" />
          </Painting>
          <div className="scn-scrim" aria-hidden="true" />
          <section className="scn-panel st-visit-side" aria-label={p.name}>
            <p className="scn-kicker">{p.kicker}</p>
            <h1 className="scn-title">{p.name}</h1>
            <p className="scn-text">{p.line}</p>
            {p.facts && <p className="scn-facts">{p.facts}</p>}
            <div className="st-places" role="tablist" aria-label={p.name}>
              <PlaceCard id="market" tab title={t('settlements.hub.market')} line={p.marketOpen ? t('settlements.scene.place.market') : p.marketShut} glyph={GLYPHS.market} selected={p.place === 'market'} disabled={!p.marketOpen} onPick={() => toggle('market')} testId="visit-market" />
              <PlaceCard id="meadHall" tab title={t('settlements.tavern.title')} line={t('settlements.scene.place.meadHall')} glyph={GLYPHS.meadHall} selected={p.place === 'meadHall'} onPick={() => toggle('meadHall')} testId="visit-meadHall" />
              <PlaceCard id="leave" tab={false} title={t('settlements.hub.leave')} line={t('settlements.scene.place.leave')} glyph={GLYPHS.leave} onPick={p.onLeave} testId="hub-leave" />
            </div>
          </section>
          {p.place && (
            <section className="st-visit-panel" id="st-visit-panel" role="tabpanel" aria-label={title} data-testid={`visit-panel-${p.place}`}>
              <header className="st-visit-panel-head">
                <h2>{title}</h2>
                <IconButton icon="close" label={t('settlements.scene.backToQuay')} onClick={() => p.onPlace(null)} data-testid="visit-close" />
              </header>
              <div className="st-visit-panel-body">{p.panel}</div>
            </section>
          )}
        </div>
      </SceneStage>
    </div>
  );
}

/** The settlement hub abroad (see the file header). */
export function SettlementHub({ state }: { state: GameState }): ReactElement | null {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const [place, setPlace] = useState<VisitPlace | null>(null);
  const id = state.settlementsState?.inside;
  const s = id !== undefined ? state.settlements[id] : undefined;
  const fleet = state.player.expeditionFleetId !== undefined ? state.fleets[state.player.expeditionFleetId] : undefined;
  const loaded = loadContent();
  if (!s || id === undefined || !loaded.ok) return null;
  const content = loaded.content;
  const marketOpen = hasMarket(state, content, id) && fleet !== undefined;
  const hold = fleet ? holdUse(state, content, fleet) : undefined;
  const ambience = ambienceOf(state, { pos: fleet?.pos ?? s.mapPos });
  const picture: SettlementPictureModel = {
    ambience,
    tier: s.tier,
    fortTier: s.fortTier,
    style: styleOfCulture(s.culture),
    lantern: s.faith === 'lantern' || s.faith === 'goldenLantern',
    seed: hashString(s.id),
    colour: bannerColour(state.factions[s.factionId], state.player.factionId),
    ourColour: PLAYER_COLOUR,
    raided: isScarred(state, s),
    coastal: s.coastal,
    view: 'quay',
  };
  const panel =
    place === 'market' && marketOpen && fleet ? (
      <MarketBoard state={state} content={content} settlementId={id} holder={{ kind: 'fleet', fleet }} />
    ) : place === 'market' ? (
      <p className="muted">{t('settlements.reason.noMarket')}</p>
    ) : place === 'meadHall' ? (
      <>
        <TavernPanel state={state} content={content} settlementId={id} />
        <h3 className="mh-subhead">{t('settlements.ui.sellswords.title')}</h3>
        <SellswordPanel state={state} content={content} settlementId={id} />
      </>
    ) : null;
  return (
    <VisitScene
      name={s.name}
      line={settlementLine(state, s, t)}
      kicker={t('settlements.scene.visitKicker', { tod: timeOfDay(ambience.hourOfDay) })}
      {...(fleet ? { facts: t(fleet.overland ? 'settlements.scene.purseCarry' : 'settlements.scene.purseHold', { silver: formatNumber(Math.floor(fleet.silver)), used: Math.round((hold?.used ?? 0) * 10) / 10, capacity: hold?.capacity ?? 0 }) } : {})}
      picture={picture}
      assetId={`settlements.scene.visit.${s.tier}`}
      marketOpen={marketOpen}
      marketShut={t('settlements.reason.noMarket')}
      place={place}
      onPlace={setPlace}
      onLeave={() => dispatch({ type: 'leaveSettlement' })}
      panel={panel}
    />
  );
}

export function CargoPanel({ state }: { state: GameState }): ReactElement | null {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const loot = state.settlementsState?.loot;
  const loaded = loadContent();
  if (!loot || !loaded.ok || state.pending !== null || loot.untilHour < state.time.hour) return null;
  const fleet = state.fleets[loot.fleetId];
  const s = state.settlements[loot.settlementId];
  const market = state.markets[loot.settlementId];
  if (!fleet || !s || !market) return null;
  const content = loaded.content;
  const { used, capacity } = holdUse(state, content, fleet);
  const room = Math.max(0, capacity - used);
  const goods = (Object.entries(market.stock) as [GoodId, number][]).filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]);
  const amount = (v: number, cap = Infinity) => Math.floor(Math.min(v, cap) * 100) / 100;
  return (
    <Frame
      title={t('settlements.cargo.title')}
      subtitle={s.name}
      className="st-hub st-cargo"
      footer={
        <Button variant="primary" icon="check" onClick={() => dispatch({ type: 'leaveSettlement' })} data-testid="cargo-done">
          {t('settlements.cargo.done')}
        </Button>
      }
      data-testid="cargo-panel"
    >
      <p className="st-cargo-hold">{t('settlements.cargo.hold', { used: Math.round(used * 10) / 10, capacity })}</p>
      {goods.length === 0 ? (
        <p className="faint">{t('settlements.cargo.empty')}</p>
      ) : (
        <table className="st-market st-cargo-table">
          <tbody>
            {goods.map(([g, v]) => {
              const take = amount(v, room);
              const all = amount(v);
              return (
                <tr key={g} data-good={g}>
                  <td>{goodName(g)}</td>
                  <td className="num">{t('settlements.cargo.tons', { tons: formatTons(v) })}</td>
                  <td className="st-market-actions">
                    <Button size="sm" variant="primary" disabled={take <= 0} onClick={() => dispatch({ type: 'loadCargo', take: { [g]: take } })} data-testid={`cargo-take-${g}`}>
                      {t('settlements.cargo.take')}
                    </Button>
                    <Button size="sm" variant="danger" disabled={all <= 0} onClick={() => dispatch({ type: 'loadCargo', burn: { [g]: all } })} data-testid={`cargo-burn-${g}`}>
                      {t('settlements.cargo.burn')}
                    </Button>
                    <Button size="sm" disabled={all <= 0} onClick={() => dispatch({ type: 'loadCargo', givePoor: { [g]: all } })} data-testid={`cargo-give-${g}`}>
                      {t('settlements.cargo.givePoor')}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Frame>
  );
}
