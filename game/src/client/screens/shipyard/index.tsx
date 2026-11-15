/**
 * The Shipyard (route 'building.shipyard'), laid out by ARCHITECTURE §20:
 *   - your ships as picture cards: the name, where she lies and one line of state in words ("Sound",
 *     "Needs repair: 40 silver"), with repair as the card's one button (`repairShip`, priced and checked by
 *     the military module's `repairQuote`);
 *   - building a ship as one flow: pick a kind from cards (one plain line each), then one sentence of cost
 *     and time and one gold button (`queueShip`, priced and checked by `shipOrderPreview`);
 *   - what is on the slipways as one line each with a progress bar (`shipOrdersOf`).
 * Behind Details: hull and sail of every ship, the chosen kind's crew, hold, speed and yard, and the timber
 * surcharge. The client computes no rule of its own.
 *
 * Test ids: shipyard, shipyard-close, shipyard-ships, shipyard-ship-<shipId> (data-ship), repair-<shipId>,
 * repair-all, shipyard-orders (the kind picker), shipyard-type-<type> (data-ship-type), shipyard-cost,
 * shipyard-why, order-<type> (the gold button for the chosen kind), shipyard-queue, shipyard-details,
 * shipyard-fleet (the hull and sail table, rows tr[data-ship]).
 */
import { useState, type ReactElement } from 'react';
import type { Content } from '@content/index';
import { SHIP_TYPE_IDS, type ShipTypeId } from '@content/schemas/ids';
import type { GameState, Ship, ShipId } from '@sim/core/state';
import {
  buildingTier,
  findShipDef,
  repairQuote,
  shipOrderPreview,
  shipOrdersOf,
  shipsOf,
  shipyardSlots,
  type ShipOrderPreview,
} from '@sim/modules/military';
import { loadContent } from '../../app/content';
import { useGame } from '../../app/gameStore';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatGameDate } from '../../i18n/calendar';
import { formatNumber, t as tr, tOr, useT } from '../../i18n/index';
import { Button, ChoiceCard, Disclosure, Meter, ShipPicture, StatLine } from '../../ui/index';
import { shipTypeName } from '../expedition/names';
import { BuildingFrame, WhyNot } from '../hub/BuildingFrame';
import { capitalOf } from '../hub/counsel';
import './shipyard.css';

/** Plain words for a ship-order issue. */
export function orderIssueText(p: ShipOrderPreview, issue: ShipOrderPreview['issues'][number]): string {
  if (issue === 'shipyard')
    return tr('military.ui.shipyard.needsTier', { tier: p.requiredTier, have: p.shipyardTier });
  return tr(`military.error.${issue}`);
}

/** Issues that no amount of silver or waiting fixes here: the kind's card is closed and says why. */
const CLOSED: readonly ShipOrderPreview['issues'][number][] = ['shipyard', 'notBuildable', 'unknownShip', 'notYourHolding'];

function byName(a: Ship, b: Ship): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** One line of state for a ship, in words. */
function shipState(state: GameState, content: Content, ship: Ship): { text: string; tone: 'good' | 'warn' | 'bad'; cost: number; canRepair: boolean; issues: string[] } {
  const q = repairQuote(state, content, [ship.id]);
  if (q.issues.includes('nothingToRepair')) return { text: tr('military.ui.shipyard.sound'), tone: 'good', cost: 0, canRepair: false, issues: [] };
  const cost = q.ships[0]?.cost ?? 0;
  if (q.issues.includes('noShipyard')) return { text: tr('military.ui.shipyard.damagedAway'), tone: 'bad', cost, canRepair: false, issues: [] };
  return {
    text: tr('military.ui.shipyard.needsRepair', { silver: formatNumber(cost) }),
    tone: 'warn',
    cost,
    canRepair: q.ok,
    issues: q.issues.map((i) => tr(`military.error.${i}`)),
  };
}

function Ships({ state, content }: { state: GameState; content: Content }): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const ships = [...shipsOf(state, state.player.factionId)].sort(byName);
  const pending = state.pending !== null;
  const damaged = ships.filter((s) => {
    const def = findShipDef(content.balance, s.type);
    return def !== undefined && (s.hullHp < def.hull || s.sailHp < def.sail);
  });
  const all = damaged.length > 1 ? repairQuote(state, content, damaged.map((s) => s.id)) : null;
  const repair = (ids: ShipId[]) => dispatch({ type: 'repairShip', shipIds: ids });
  return (
    <section className="sy-section" aria-labelledby="sy-ships-h">
      <h3 className="sy-h" id="sy-ships-h">
        {t('military.ui.shipyard.ships')}
      </h3>
      {ships.length === 0 ? (
        <p className="sy-empty">{t('military.ui.shipyard.noShips')}</p>
      ) : (
        <ul className="sy-ships" data-testid="shipyard-ships">
          {ships.map((ship) => {
            const st = shipState(state, content, ship);
            const where = ship.dockedAt !== undefined ? t('military.ui.shipyard.inHarbour') : t('military.ui.shipyard.awayAtSea');
            return (
              <li key={ship.id} className="sy-ship" data-ship={ship.id} data-testid={`shipyard-ship-${ship.id}`}>
                <ShipPicture type={ship.type} size="lg" />
                <div className="sy-ship-text">
                  <span className="sy-ship-name">{ship.name}</span>
                  <span className="sy-ship-where">{t('military.ui.shipyard.shipWhere', { type: shipTypeName(content, ship.type), where })}</span>
                  <span className={`sy-ship-state tone-${st.tone}`}>{st.text}</span>
                  {st.issues.length > 0 && <WhyNot reasons={st.issues} />}
                </div>
                {st.tone === 'warn' && (
                  <Button
                    icon="reset"
                    disabled={!st.canRepair || pending}
                    aria-label={t('military.ui.shipyard.repairShip', { name: ship.name, silver: formatNumber(st.cost) })}
                    onClick={() => repair([ship.id])}
                    data-testid={`repair-${ship.id}`}
                  >
                    {t('military.ui.shipyard.repairGo')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {all && (
        <div className="sy-repair-all">
          <Button icon="reset" disabled={!all.ok || pending} onClick={() => repair(damaged.map((s) => s.id))} data-testid="repair-all">
            {t('military.ui.shipyard.repairAllShort', { silver: formatNumber(all.total) })}
          </Button>
        </div>
      )}
    </section>
  );
}

function Slipways({ state, content }: { state: GameState; content: Content }): ReactElement {
  const t = useT();
  const capital = capitalOf(state);
  const orders = capital ? shipOrdersOf(state, capital.id) : [];
  const now = state.time.hour;
  return (
    <section className="sy-section" aria-labelledby="sy-slip-h">
      <h3 className="sy-h" id="sy-slip-h">
        {t('military.ui.shipyard.queue')}
      </h3>
      <div className="sy-slips" data-testid="shipyard-queue">
        {orders.length === 0 ? (
          <p className="sy-empty">{t('military.ui.shipyard.queueEmpty')}</p>
        ) : (
          orders.map((o) => {
            const name = o.name ?? shipTypeName(content, o.type);
            const date = formatGameDate(o.doneHour);
            const building = o.startHour !== null;
            const span = building ? o.doneHour - (o.startHour as number) : 0;
            const done = building && span > 0 ? Math.min(1, Math.max(0, (now - (o.startHour as number)) / span)) : 0;
            return (
              <div key={o.id} className="sy-slip">
                <ShipPicture type={o.type} size="sm" />
                <div className="sy-slip-text">
                  <span>{building ? t('military.ui.shipyard.slipBuilding', { name, date }) : t('military.ui.shipyard.slipWaiting', { name, date })}</span>
                  {building && <Meter value={Math.round(done * 100)} max={100} label={name} showLabel={false} size="sm" tone="accent" />}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function Build({ state, content, picked, onPick }: { state: GameState; content: Content; picked: ShipTypeId | undefined; onPick(type: ShipTypeId): void }): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const capital = capitalOf(state);
  const types = SHIP_TYPE_IDS.filter((type: ShipTypeId) => content.balance.ships[type].buildable);
  if (!capital) return <section className="sy-section" />;
  const previews = new Map(types.map((type) => [type, shipOrderPreview(state, content, { holdingId: capital.id, shipType: type })]));
  const open = types.filter((type) => !previews.get(type)?.issues.some((i) => CLOSED.includes(i)));
  const type = picked !== undefined && open.includes(picked) ? picked : open[0];
  const p = type ? previews.get(type) : undefined;
  const pending = state.pending !== null;
  const reasons = p ? p.issues.map((i) => orderIssueText(p, i)) : [];
  return (
    <section className="sy-section sy-build" aria-labelledby="sy-build-h">
      <h3 className="sy-h" id="sy-build-h">
        {t('military.ui.shipyard.build')}
      </h3>
      <div className="sy-types" role="group" aria-label={t('military.ui.shipyard.build')} data-testid="shipyard-orders">
        {types.map((ty) => {
          const def = content.balance.ships[ty];
          const pv = previews.get(ty);
          const closed = pv?.issues.find((i) => CLOSED.includes(i));
          return (
            <ChoiceCard
              key={ty}
              size="sm"
              picture={<ShipPicture type={ty} size="md" />}
              title={shipTypeName(content, ty)}
              line={t('military.ui.shipyard.typeLine', { good: tOr(`military.ui.shipyard.goodFor.${ty}`, ''), men: def.crewMax, tons: def.cargoT })}
              reason={closed && pv ? orderIssueText(pv, closed) : undefined}
              disabled={closed !== undefined}
              selected={ty === type}
              onClick={() => onPick(ty)}
              data-ship-type={ty}
              data-testid={`shipyard-type-${ty}`}
            />
          );
        })}
      </div>
      <div className="sy-go">
        <p className="sy-cost" data-testid="shipyard-cost">
          {type && p
            ? t('military.ui.shipyard.costSentence', {
                type: shipTypeName(content, type),
                silver: formatNumber(p.total),
                days: p.buildDays,
                date: formatGameDate(p.projectedDoneHour),
              })
            : t('military.ui.shipyard.pickType')}
        </p>
        <div className="sy-go-row">
          <WhyNot reasons={reasons} ok={p?.ok ? t('military.ui.shipyard.ready') : undefined} testId="shipyard-why" />
          {type && (
            <Button
              variant="primary"
              size="lg"
              icon="ship"
              disabled={!p?.ok || pending}
              onClick={() => dispatch({ type: 'queueShip', holdingId: capital.id, shipType: type })}
              data-testid={`order-${type}`}
            >
              {t('military.ui.shipyard.buildGo', { type: shipTypeName(content, type) })}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function Details({ state, content, type }: { state: GameState; content: Content; type: ShipTypeId | undefined }): ReactElement {
  const t = useT();
  const capital = capitalOf(state);
  const ships = [...shipsOf(state, state.player.factionId)].sort(byName);
  const def = type ? content.balance.ships[type] : undefined;
  const p = type && capital ? shipOrderPreview(state, content, { holdingId: capital.id, shipType: type }) : undefined;
  return (
    <Disclosure className="sy-details" data-testid="shipyard-details">
      <div className="sy-details-grid">
        <div>
          <h4 className="sy-sub">{t('military.ui.shipyard.fleetDetails')}</h4>
          {ships.length === 0 ? (
            <p className="sy-note">{t('military.ui.shipyard.noShips')}</p>
          ) : (
            <table className="sy-table" data-testid="shipyard-fleet">
              <thead>
                <tr>
                  <th>{t('military.ui.shipyard.col.ship')}</th>
                  <th>{t('military.ui.shipyard.col.where')}</th>
                  <th>{t('military.ui.shipyard.col.hull')}</th>
                  <th>{t('military.ui.shipyard.col.sail')}</th>
                </tr>
              </thead>
              <tbody>
                {ships.map((ship) => {
                  const d = findShipDef(content.balance, ship.type);
                  return (
                    <tr key={ship.id} data-ship={ship.id}>
                      <td>{ship.name}</td>
                      <td>
                        {ship.dockedAt !== undefined
                          ? t('military.ui.shipyard.docked', { place: state.settlements[ship.dockedAt]?.name ?? '' })
                          : t('military.ui.shipyard.atSea')}
                      </td>
                      <td className="num">{t('military.ui.shipyard.hpValue', { hp: Math.round(ship.hullHp), max: d?.hull ?? 0 })}</td>
                      <td className="num">{t('military.ui.shipyard.hpValue', { hp: Math.round(ship.sailHp), max: d?.sail ?? 0 })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {type && def && (
          <div>
            <h4 className="sy-sub">{shipTypeName(content, type)}</h4>
            <StatLine icon="men" label={t('military.ui.shipyard.col.crew')} value={t('military.ui.shipyard.crewValue', { min: def.crewMin, max: def.crewMax })} />
            <StatLine icon="ship" label={t('military.ui.shipyard.col.hold')} value={t('military.ui.shipyard.holdValue', { tons: def.cargoT })} />
            <StatLine icon="wind" label={t('military.ui.shipyard.speed')} value={t('military.ui.shipyard.speedValue', { knots: def.sailKn })} />
            <StatLine icon="crown" label={t('military.ui.shipyard.yardNeeded')} value={t('military.ui.shipyard.tierValue', { tier: def.shipyardTier })} />
            {p && p.timberSurcharge > 0 && <p className="sy-note">{t('military.ui.shipyard.timberNote', { timber: formatNumber(p.timberSurcharge) })}</p>}
          </div>
        )}
      </div>
    </Disclosure>
  );
}

/** The Shipyard for a state (exported for tests). */
export function Shipyard({ state, onClose }: { state: GameState; onClose(): void }): ReactElement {
  const t = useT();
  const loaded = loadContent();
  const content = loaded.ok ? loaded.content : null;
  const capital = capitalOf(state);
  const tier = buildingTier(capital, 'shipyard');
  const slots = content && capital ? shipyardSlots(state, content.balance, capital.id) : 0;
  const [picked, setPicked] = useState<ShipTypeId | undefined>(undefined);
  // The kind the Build flow shows (its first open kind until the player picks one), for Details too.
  const shown = (() => {
    if (!content || !capital) return undefined;
    const types = SHIP_TYPE_IDS.filter((ty: ShipTypeId) => content.balance.ships[ty].buildable);
    const open = types.filter((ty) => !shipOrderPreview(state, content, { holdingId: capital.id, shipType: ty }).issues.some((i) => CLOSED.includes(i)));
    return picked !== undefined && open.includes(picked) ? picked : open[0];
  })();
  return (
    <BuildingFrame
      title={t('military.ui.shipyard.title')}
      subtitle={
        capital
          ? tier > 0
            ? t('military.ui.shipyard.subtitle', { place: capital.name, tier, slots })
            : t('military.ui.shipyard.none', { place: capital.name })
          : undefined
      }
      onClose={onClose}
      testId="shipyard"
      className="sy-frame"
    >
      {content && (
        <div className="sy-screen">
          <div className="sy-grid">
            <div className="sy-col">
              <Ships state={state} content={content} />
              <Slipways state={state} content={content} />
            </div>
            <Build state={state} content={content} picked={shown} onPick={setPicked} />
          </div>
          <Details state={state} content={content} type={shown} />
        </div>
      )}
    </BuildingFrame>
  );
}

function ShipyardScreen({ close }: ScreenProps): ReactElement {
  const state = useGame((s) => s.state);
  if (!state) return <div />;
  return <Shipyard state={state} onClose={close} />;
}

export const screen: ScreenDescriptor = {
  id: 'shipyard',
  route: 'building.shipyard',
  component: ShipyardScreen,
  layout: 'overlay',
  titleKey: 'military.ui.shipyard.title',
};
