/**
 * The home Mead-hall (route 'building.meadHall', opened from the home hub's mead-hall hotspot; design SCR-19,
 * §20), laid out by ARCHITECTURE §20 as a warm scene on a large framed screen: four big choices (ask for
 * news, hear the travellers, buy a round, look for sellswords) answered in a result area below them, and
 * beside them the latest few things heard and, behind a toggle, what is known of other places. All of it is
 * the shared ../settlement/meadHall.tsx (`MeadHallScene`), which the visit abroad uses too.
 *
 * Not here, because the simulation has no source for it: maps for sale (intel's `buyMap` takes any site and
 * price, but nothing generates map-holders' offers), rapport, banter, tips and the skald's tales.
 */
import type { ReactElement } from 'react';
import type { GameState } from '@sim/core/state';
import { loadContent } from '../../app/content';
import { useGame } from '../../app/gameStore';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { useT } from '../../i18n/index';
import { Frame, IconButton } from '../../ui/index';
import { MeadHallScene } from '../settlement/meadHall';

/** The home Mead-hall overlay. */
export function HomeMeadHall({ state, onClose }: { state: GameState; onClose(): void }): ReactElement {
  const t = useT();
  const loaded = loadContent();
  const homeId = state.player.capitalId;
  const s = state.settlements[homeId];
  const close = <IconButton icon="close" label={t('settlements.ui.close')} onClick={onClose} data-testid="meadhall-close" />;
  return (
    <Frame size="screen" title={t('settlements.tavern.title')} subtitle={s?.name} ornate className="hall-screen" actions={close} data-testid="home-meadhall">
      {!loaded.ok || !s ? <p className="faint">{t('settlements.ui.hall.closed')}</p> : <MeadHallScene state={state} content={loaded.content} settlementId={homeId} />}
    </Frame>
  );
}

function HomeMeadHallScreen({ close }: ScreenProps): ReactElement {
  const state = useGame((s) => s.state);
  if (!state) return <div />;
  return <HomeMeadHall state={state} onClose={close} />;
}

export const screen: ScreenDescriptor = { id: 'homeMeadHall', route: 'building.meadHall', component: HomeMeadHallScreen, layout: 'overlay', titleKey: 'settlements.tavern.title' };
