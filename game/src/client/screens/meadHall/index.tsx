/**
 * The home Mead-hall (route 'building.meadHall', opened from the home hub's mead-hall hotspot; design SCR-19,
 * §20): entering it shows the smoky hall by firelight (render/interiors/rooms/meadHall.tsx). The hall's four
 * choices wait behind three people (ARCHITECTURE §20), each answered in the result area of their panel:
 *   - the Hall-keeper: ask for news and buy a round, then the latest few things heard and, behind a toggle,
 *     what is known of other places;
 *   - the Travellers at their table: hear what they say of the ports nearby (and Other places);
 *   - the Sellswords at the back: this month's fighters for hire as cards.
 * The pieces are the shared ../settlement/meadHall.tsx, which the visit abroad uses too. Route params
 * `{ person: 'keeper' | 'travellers' | 'sellswords' }` open a panel at once.
 *
 * Not here, because the simulation has no source for it: maps for sale (intel's `buyMap` takes any site and
 * price, but nothing generates map-holders' offers), rapport, banter, tips and the skald's tales.
 *
 * Test ids: home-meadhall (the room's picture), meadhall-keeper, meadhall-travellers, meadhall-sellswords, and
 * those of the shared pieces (meadhall, tavern-<action>, tavern-result, news-log, hall-places, sellswords,
 * hire-<n>).
 */
import type { ReactElement } from 'react';
import type { Content } from '@content/index';
import type { GameState, SettlementId } from '@sim/core/state';
import { loadContent } from '../../app/content';
import { useGame } from '../../app/gameStore';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { useT } from '../../i18n/index';
import { InteriorRoom, useRoutePerson } from '../../render/interiors/index';
import { meadHallRoom } from '../../render/interiors/rooms/meadHall';
import { ambienceOf } from '../../render/scenes/ambience';
import { Disclosure } from '../../ui/index';
import { IntelPanel, NewsLog, SellswordPanel, TavernPanel } from '../settlement/meadHall';
import './meadHall.css';

/** The people of the hall (route param `person`). */
export type MeadHallPerson = 'keeper' | 'travellers' | 'sellswords';

function OtherPlaces({ state, content }: { state: GameState; content: Content }): ReactElement {
  const t = useT();
  return (
    <Disclosure summary={t('news.ui.places.title')} className="hall-places" data-testid="hall-places">
      <IntelPanel state={state} content={content} />
    </Disclosure>
  );
}

/** One person's panel in the hall at `settlementId`. */
export function MeadHallWork({ state, content, settlementId, person }: { state: GameState; content: Content; settlementId: SettlementId; person: string }): ReactElement {
  if (person === 'sellswords')
    return (
      <div className="mh-work" data-testid="meadhall-sellswords">
        <SellswordPanel state={state} content={content} settlementId={settlementId} />
      </div>
    );
  if (person === 'travellers')
    return (
      <div className="mh-work" data-testid="meadhall-travellers">
        <TavernPanel state={state} content={content} settlementId={settlementId} actions={['travellers']} />
        <OtherPlaces state={state} content={content} />
      </div>
    );
  return (
    <div className="mh-work" data-testid="meadhall-keeper">
      <TavernPanel state={state} content={content} settlementId={settlementId} actions={['anyNews', 'buyRound']} />
      <NewsLog state={state} content={content} />
      <OtherPlaces state={state} content={content} />
    </div>
  );
}

/**
 * The home Mead-hall for a state (exported for tests): the hall with its three people; the panel of `person`
 * open (controlled) or of `initialPerson` (the room keeps it).
 */
export function HomeMeadHall({
  state,
  onClose,
  person,
  initialPerson,
  onPersonChange,
}: {
  state: GameState;
  onClose(): void;
  person?: string | null;
  initialPerson?: MeadHallPerson;
  onPersonChange?(id: string | null): void;
}): ReactElement {
  const t = useT();
  const loaded = loadContent();
  const homeId = state.player.capitalId;
  const s = state.settlements[homeId];
  return (
    <InteriorRoom
      room={meadHallRoom}
      ambience={ambienceOf(state)}
      subtitle={s ? t('hub.interior.at', { place: s.name }) : undefined}
      {...(person !== undefined ? { person } : { initialPerson: initialPerson ?? null })}
      onPersonChange={onPersonChange}
      stageTestId="home-meadhall"
      onLeave={onClose}
      panel={(id) => (!loaded.ok || !s ? <p className="faint">{t('settlements.ui.hall.closed')}</p> : <MeadHallWork state={state} content={loaded.content} settlementId={homeId} person={id} />)}
    />
  );
}

function HomeMeadHallScreen({ params, close }: ScreenProps): ReactElement {
  const state = useGame((s) => s.state);
  const [person, setPerson] = useRoutePerson(meadHallRoom, ['building.meadHall'], params);
  if (!state) return <div />;
  return <HomeMeadHall state={state} person={person} onPersonChange={setPerson} onClose={close} />;
}

export const screen: ScreenDescriptor = { id: 'homeMeadHall', route: 'building.meadHall', staysUnder: true, component: HomeMeadHallScreen, layout: 'overlay', titleKey: 'settlements.tavern.title' };
