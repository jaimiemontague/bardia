/**
 * The Great hall (route 'building.greatHall'; SCR-06 for the ruler's seat), laid out by ARCHITECTURE §20: the
 * realm in five plain sentences (the rest behind Details) and four big doors: the Muster (a tab here; also
 * route 'muster'), the Expedition Planner ('expeditionPlanner'), Affairs of State ('affairs') and the Ledger
 * ('ledger'). Numbers come from state and the military module's pure helpers.
 */
import { useState, type ReactElement } from 'react';
import type { Content } from '@content/index';
import type { GameState } from '@sim/core/state';
import { lieutenantCapacity, realmMen, shipsOf, trackTier } from '@sim/modules/military';
import { loadContent } from '../../app/content';
import { useGame } from '../../app/gameStore';
import { navigation } from '../../app/navigation';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatNumber, tOr, useT } from '../../i18n/index';
import { ChoiceCard, ChoiceGrid, Disclosure, Icon, StatLine, Tabs } from '../../ui/index';
import { BuildingFrame } from '../hub/BuildingFrame';
import { capitalOf, garrisonMen } from '../hub/counsel';
import { shipsAtHome } from '../hub/village';
import { MusterPanel } from './muster';
import './greatHall.css';

/** Tabs of the Great hall. */
export type GreatHallTab = 'realm' | 'muster';

function Realm({ state, content, onMuster }: { state: GameState; content: Content; onMuster(): void }): ReactElement {
  const t = useT();
  const fac = state.player.factionId;
  const faction = state.factions[fac];
  const capital = capitalOf(state);
  const ruler = state.characters[state.player.rulerId];
  const men = realmMen(state, fac);
  const ships = shipsOf(state, fac).length;
  const shipsHome = capital ? shipsAtHome(state, capital.id).length : 0;
  const lts = lieutenantCapacity(state, content, fac);
  const armour = trackTier(state, fac, 'armour');
  const weapons = trackTier(state, fac, 'weapons');
  const atSea = state.player.expeditionFleetId !== undefined;
  const holding = capital?.holding;
  const lowFood = holding !== undefined && holding.foodMonths < 3;
  return (
    <div className="gh-realm" data-testid="great-hall-realm">
      <section className="gh-words" aria-label={t('military.ui.realm.title')}>
        <p className="gh-line">
          <Icon name="crown" />
          <span>
            {t('hub.hall.rules', {
              ruler: ruler?.name ?? '',
              place: capital?.name ?? '',
              holdings: faction?.holdingIds.length ?? 0,
            })}
          </span>
        </p>
        <p className="gh-line">
          <Icon name="silver" />
          <span>{t('hub.hall.treasury', { silver: formatNumber(Math.floor(faction?.treasury ?? 0)) })}</span>
        </p>
        <p className="gh-line">
          <Icon name="men" />
          <span>{t('hub.hall.men', { total: men.total, home: garrisonMen(capital) })}</span>
        </p>
        <p className="gh-line">
          <Icon name="ship" />
          <span>{t('hub.hall.ships', { total: ships, home: shipsHome })}</span>
        </p>
        {holding && (
          <p className={`gh-line${lowFood ? ' tone-bad' : ''}`}>
            <Icon name="food" />
            <span>{t('hub.hall.food', { months: Math.round(holding.foodMonths * 10) / 10 })}</span>
          </p>
        )}
        <Disclosure className="gh-details" data-testid="great-hall-details">
          <StatLine icon="renown" label={t('military.ui.realm.renown')} value={formatNumber(Math.round(state.player.house.renown))} />
          <StatLine icon="star" label={t('military.ui.realm.lieutenants')} value={t('military.ui.realm.lieutenantsValue', { used: lts.used, capacity: lts.capacity })} />
          <StatLine icon="shieldRound" label={t('military.ui.realm.armour')} value={tOr(`military.tier.armour.${armour}`, String(armour))} />
          <StatLine icon="sword" label={t('military.ui.realm.weapons')} value={tOr(`military.tier.weapons.${weapons}`, String(weapons))} />
          {holding && (
            <>
              <StatLine icon="favor" label={t('military.ui.realm.loyalty')} value={formatNumber(Math.round(holding.loyalty))} />
              <StatLine icon="ledger" label={t('military.ui.realm.tax')} value={tOr(`holdings.tax.${holding.tax}`, holding.tax)} />
            </>
          )}
        </Disclosure>
      </section>
      <ChoiceGrid columns={2} label={t('military.ui.go.title')} className="gh-doors">
        <ChoiceCard size="lg" icon="men" title={t('military.ui.go.muster')} line={t('military.ui.go.musterInfo')} onClick={onMuster} data-testid="hall-muster" />
        <ChoiceCard
          size="lg"
          icon="ship"
          title={t('military.ui.go.planner')}
          line={t('military.ui.go.plannerInfo')}
          reason={atSea ? t('military.ui.go.plannerAtSea') : t('hub.hall.waitDecision')}
          onClick={() => navigation.open('expeditionPlanner')}
          disabled={atSea || state.pending !== null}
          data-testid="hall-planner"
        />
        <ChoiceCard size="lg" icon="crown" title={t('military.ui.go.affairs')} line={t('military.ui.go.affairsInfo')} onClick={() => navigation.open('affairs')} data-testid="hall-affairs" />
        <ChoiceCard size="lg" icon="ledger" title={t('military.ui.go.ledger')} line={t('military.ui.go.ledgerInfo')} onClick={() => navigation.open('ledger')} data-testid="hall-ledger" />
      </ChoiceGrid>
    </div>
  );
}

/** The Great hall for a state (exported for tests). */
export function GreatHall({ state, initialTab = 'realm', onClose }: { state: GameState; initialTab?: GreatHallTab; onClose(): void }): ReactElement {
  const t = useT();
  const [tab, setTab] = useState<GreatHallTab>(initialTab);
  const loaded = loadContent();
  const content = loaded.ok ? loaded.content : null;
  const capital = capitalOf(state);
  return (
    <BuildingFrame
      title={t('military.ui.greatHall.title')}
      subtitle={capital ? t('military.ui.greatHall.subtitle', { place: capital.name }) : undefined}
      onClose={onClose}
      testId="great-hall"
      className="gh-frame"
    >
      {content && (
        <Tabs
          label={t('military.ui.greatHall.title')}
          tabs={[
            { id: 'realm', label: t('military.ui.tab.realm'), icon: 'crown' },
            { id: 'muster', label: t('military.ui.tab.muster'), icon: 'men' },
          ]}
          value={tab}
          onChange={(id) => setTab(id === 'muster' ? 'muster' : 'realm')}
        >
          {(active) =>
            active === 'muster' ? (
              capital ? (
                <MusterPanel state={state} content={content} capital={capital} />
              ) : (
                <p className="faint">{t('military.ui.muster.noHolding')}</p>
              )
            ) : (
              <Realm state={state} content={content} onMuster={() => setTab('muster')} />
            )
          }
        </Tabs>
      )}
    </BuildingFrame>
  );
}

function GreatHallScreen({ close }: ScreenProps): ReactElement {
  const state = useGame((s) => s.state);
  if (!state) return <div />;
  return <GreatHall state={state} onClose={close} />;
}

function MusterScreen({ close }: ScreenProps): ReactElement {
  const state = useGame((s) => s.state);
  if (!state) return <div />;
  return <GreatHall state={state} initialTab="muster" onClose={close} />;
}

export const screens: ScreenDescriptor[] = [
  {
    id: 'greatHall',
    route: 'building.greatHall',
    component: GreatHallScreen,
    layout: 'overlay',
    titleKey: 'military.ui.greatHall.title',
  },
  {
    id: 'muster',
    route: 'muster',
    component: MusterScreen,
    layout: 'overlay',
    titleKey: 'military.ui.tab.muster',
  },
];
