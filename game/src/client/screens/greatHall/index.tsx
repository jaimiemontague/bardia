/**
 * The Great hall (route 'building.greatHall'; SCR-06 for the ruler's seat): entering it shows the inside of the
 * hall (render/interiors/rooms/greatHall.tsx). Its menus wait behind three people (ARCHITECTURE §20):
 *   - the Hirdmaster, who keeps the high seat for the ruler: the realm in five plain sentences (the rest behind
 *     Details), the Muster (a tab in his panel; also route 'muster') and the Expedition Planner
 *     ('expeditionPlanner');
 *   - the Steward by the strongbox: the treasury and this month's reckoning in words, then the Ledger ('ledger');
 *   - the Lawspeaker with his staff: taxes and the folk's mood, then Affairs of State ('affairs').
 * Route params `{ person: 'hirdmaster' | 'steward' | 'lawspeaker', view?: 'muster' }` open a panel at once.
 * Numbers come from state and the military and economy modules' pure helpers.
 */
import { useMemo, useState, type ReactElement } from 'react';
import type { Content } from '@content/index';
import type { GameState } from '@sim/core/state';
import { computeLedger } from '@sim/modules/economy/ledger';
import { lieutenantCapacity, realmMen, shipsOf, trackTier } from '@sim/modules/military';
import { loadContent } from '../../app/content';
import { useGame } from '../../app/gameStore';
import { navigation } from '../../app/navigation';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatNumber, tOr, useT } from '../../i18n/index';
import { InteriorRoom, useRoutePerson } from '../../render/interiors/index';
import { greatHallRoom } from '../../render/interiors/rooms/greatHall';
import { ambienceOf } from '../../render/scenes/ambience';
import { Button, ChoiceCard, ChoiceGrid, Disclosure, Icon, StatLine, Tabs } from '../../ui/index';
import { capitalOf, garrisonMen } from '../hub/counsel';
import { shipsAtHome } from '../hub/village';
import { MusterPanel } from './muster';
import './greatHall.css';

/** Tabs of the Hirdmaster's panel. */
export type GreatHallTab = 'realm' | 'muster';

/** The people of the hall (route param `person`). */
export type GreatHallPerson = 'hirdmaster' | 'steward' | 'lawspeaker';

const ROUTES = ['building.greatHall', 'muster'] as const;

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
      </ChoiceGrid>
    </div>
  );
}

/** The Hirdmaster's panel: the realm and the muster, as two tabs. */
export function HirdmasterWork({ state, initialTab = 'realm' }: { state: GameState; initialTab?: GreatHallTab }): ReactElement | null {
  const t = useT();
  const [tab, setTab] = useState<GreatHallTab>(initialTab);
  const loaded = loadContent();
  const content = loaded.ok ? loaded.content : null;
  const capital = capitalOf(state);
  if (!content) return null;
  return (
    <div className="gh-work" data-testid="great-hall-hirdmaster">
      <Tabs
        label={t('hub.interior.greatHall.hirdmaster.name')}
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
    </div>
  );
}

/** The Steward's panel: the treasury and this month's reckoning in words, and the way to the ledger. */
export function StewardWork({ state }: { state: GameState }): ReactElement {
  const t = useT();
  const loaded = loadContent();
  const fac = state.player.factionId;
  const treasury = Math.floor(state.factions[fac]?.treasury ?? 0);
  const net = useMemo(() => (loaded.ok ? Math.round(computeLedger(state, loaded.content, fac)?.net ?? 0) : 0), [state, loaded, fac]);
  const monthKey = net > 0 ? 'hub.interior.steward.gain' : net < 0 ? 'hub.interior.steward.loss' : 'hub.interior.steward.even';
  return (
    <div className="gh-person" data-testid="great-hall-steward">
      <p className="gh-line">
        <Icon name="silver" />
        <span>{t('hub.hall.treasury', { silver: formatNumber(treasury) })}</span>
      </p>
      <p className={`gh-line${net < 0 ? ' tone-bad' : ''}`} data-testid="steward-month">
        <Icon name="ledger" />
        <span>{t(monthKey, { silver: formatNumber(Math.abs(net)) })}</span>
      </p>
      <div className="gh-person-go">
        <Button variant="primary" size="lg" icon="ledger" onClick={() => navigation.open('ledger')} data-testid="hall-ledger">
          {t('hub.interior.steward.open')}
        </Button>
        <p className="gh-note">{t('military.ui.go.ledgerInfo')}</p>
      </div>
    </div>
  );
}

/** The Lawspeaker's panel: the taxes and the folk's loyalty at home, and the way to Affairs of State. */
export function LawspeakerWork({ state }: { state: GameState }): ReactElement {
  const t = useT();
  const capital = capitalOf(state);
  const holding = capital?.holding;
  return (
    <div className="gh-person" data-testid="great-hall-lawspeaker">
      <p className="gh-line">
        <Icon name="crown" />
        <span>{t('hub.interior.lawspeaker.line', { place: capital?.name ?? '' })}</span>
      </p>
      {holding && (
        <div className="gh-person-stats">
          <StatLine icon="ledger" label={t('military.ui.realm.tax')} value={tOr(`holdings.tax.${holding.tax}`, holding.tax)} />
          <StatLine icon="favor" label={t('military.ui.realm.loyalty')} value={formatNumber(Math.round(holding.loyalty))} tone={holding.loyalty < 40 ? 'bad' : undefined} />
        </div>
      )}
      <div className="gh-person-go">
        <Button variant="primary" size="lg" icon="crown" onClick={() => navigation.open('affairs')} data-testid="hall-affairs">
          {t('hub.interior.lawspeaker.open')}
        </Button>
        <p className="gh-note">{t('military.ui.go.affairsInfo')}</p>
      </div>
    </div>
  );
}

/**
 * The Great hall for a state (exported for tests): the room, with the panel of `person` open (controlled) or of
 * `initialPerson` (the room keeps it). `initialTab` opens the Hirdmaster's panel on the muster.
 */
export function GreatHall({
  state,
  onClose,
  person,
  initialPerson,
  onPersonChange,
  initialTab = 'realm',
}: {
  state: GameState;
  onClose(): void;
  person?: string | null;
  initialPerson?: GreatHallPerson;
  onPersonChange?(id: string | null): void;
  initialTab?: GreatHallTab;
}): ReactElement {
  const t = useT();
  const capital = capitalOf(state);
  const ambience = ambienceOf(state);
  const firstPerson = initialPerson ?? (initialTab === 'muster' ? 'hirdmaster' : null);
  return (
    <InteriorRoom
      room={greatHallRoom}
      ambience={ambience}
      subtitle={capital ? t('military.ui.greatHall.subtitle', { place: capital.name }) : undefined}
      {...(person !== undefined ? { person } : { initialPerson: firstPerson })}
      onPersonChange={onPersonChange}
      stageTestId="great-hall"
      onLeave={onClose}
      panel={(id) =>
        id === 'steward' ? <StewardWork state={state} /> : id === 'lawspeaker' ? <LawspeakerWork state={state} /> : <HirdmasterWork state={state} initialTab={initialTab} />
      }
    />
  );
}

function HallRoute({ params, close, muster }: ScreenProps & { muster: boolean }): ReactElement {
  const state = useGame((s) => s.state);
  // The muster route opens the Hirdmaster's panel on the muster.
  const routeParams = muster ? { person: 'hirdmaster', view: 'muster', ...(params ?? {}) } : params;
  const [person, setPerson] = useRoutePerson(greatHallRoom, ROUTES, routeParams);
  const [tab] = useState<GreatHallTab>(routeParams?.['view'] === 'muster' ? 'muster' : 'realm');
  if (!state) return <div />;
  return <GreatHall state={state} person={person} onPersonChange={setPerson} initialTab={tab} onClose={close} />;
}

function GreatHallScreen(props: ScreenProps): ReactElement {
  return <HallRoute {...props} muster={false} />;
}

function MusterScreen(props: ScreenProps): ReactElement {
  return <HallRoute {...props} muster />;
}

export const screens: ScreenDescriptor[] = [
  {
    id: 'greatHall',
    route: 'building.greatHall', staysUnder: true,
    component: GreatHallScreen,
    layout: 'overlay',
    titleKey: 'military.ui.greatHall.title',
  },
  {
    id: 'muster',
    route: 'muster', staysUnder: true,
    component: MusterScreen,
    layout: 'overlay',
    titleKey: 'military.ui.tab.muster',
  },
];
