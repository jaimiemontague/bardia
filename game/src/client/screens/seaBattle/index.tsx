/**
 * The sea battle (game mode 'seaBattle', design §15.2): the fight the player chose to command on the
 * Before-the-Sea-Battle card. Builds a SeaController from `state.subsims.seaBattle.setup`, plays it in
 * real time with pause, and hands the engine's result back with the seabattle module's own
 * `applySeaBattleResult` command, which writes the losses, prizes and plunder and returns the game to
 * the scene it came from. If the module ever refused the result, the summary offers the
 * auto-resolved outcome instead, so no sea battle can strand the player.
 */
import { useCallback, type ReactElement } from 'react';
import type { Content } from '@content/index';
import { Rng } from '@sim/core/rng';
import type { GameState, SeaBattleSetup } from '@sim/core/state';
import { autoResolveSea, seaContent } from '@sim/seabattle/index';
import { loadContent } from '../../app/content';
import { useGame } from '../../app/gameStore';
import { navigation } from '../../app/navigation';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { t as translate, useT } from '../../i18n/index';
import { Button } from '../../ui/index';
import { SeaController } from './controller';
import { SeaBattleScene } from './SeaBattleScene';
import { seaTitle } from './ResultScene';
import './seaBattle.css';

export { SeaBattleScene } from './SeaBattleScene';
export { SeaController } from './controller';
/** The outcome of a sea fight the captains settled (route 'seaBattleResult'), and the waters' name. */
export { seaBattleResultScreen, seaTitle } from './ResultScene';

/**
 * One controller per running sea battle id, kept outside React so a remount (StrictMode, an error
 * boundary reset) continues the same battle instead of restarting it.
 */
let live: { id: string; controller: SeaController } | null = null;

export function seaControllerFor(id: string, setup: SeaBattleSetup, content: Content): SeaController {
  if (live?.id !== id) live = { id, controller: new SeaController(setup, content, translate) };
  return live.controller;
}

export function releaseSeaController(id: string): void {
  if (live?.id === id) live = null;
}

/** The auto-resolved result of a setup (the module's own §15.5 resolution, same seed). */
export function autoSeaResult(setup: SeaBattleSetup, content: Content) {
  return autoResolveSea(seaContent(content), setup, Rng.derive(setup.seed, 'autoresolve'));
}

function CampaignSeaBattle({ state, content }: { state: GameState; content: Content }): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const slot = state.subsims.seaBattle!;
  const setup = slot.setup;
  const c = seaControllerFor(slot.id, setup, content);
  const nameOf = useCallback((id: string) => (Object.hasOwn(state.characters, id) ? state.characters[id as keyof typeof state.characters]?.name : undefined), [state.characters]);

  const done = (): string | null => {
    const result = c.result();
    if (!result) return t('seaView.error.noResult');
    const r = dispatch({ type: 'applySeaBattleResult', seaBattleId: setup.id, result } as never);
    if (!r) return t('seaView.error.noSession');
    if (r.error) return t('seaView.error.refused', { message: r.error.message });
    releaseSeaController(slot.id);
    return null;
  };
  const fallback = (
    <Button
      variant="secondary"
      icon="dice"
      onClick={() => {
        const r = dispatch({ type: 'applySeaBattleResult', seaBattleId: setup.id, result: autoSeaResult(setup, content) } as never);
        if (r && !r.error) releaseSeaController(slot.id);
      }}
      data-testid="sea-return-auto"
    >
      {t('seaView.returnAuto')}
    </Button>
  );
  return (
    <SeaBattleScene
      controller={c}
      title={seaTitle(setup, t)}
      nameOf={nameOf}
      doneLabelKey="seaView.returnVoyage"
      onDone={done}
      leave={{ labelKey: 'seaView.menuCard.gameMenu', onClick: () => navigation.open('gameMenu') }}
      fallback={fallback}
    />
  );
}

function SeaBattleScreen(_props: ScreenProps): ReactElement {
  const t = useT();
  const state = useGame((s) => s.state);
  const loaded = loadContent();
  const slot = state?.subsims.seaBattle;
  if (!state || !slot || slot.status !== 'running' || !loaded.ok) {
    return (
      <div className="sv-root sv-missing" data-testid="sea-battle-screen" data-status="missing">
        <p>{t('seaView.error.noBattle')}</p>
      </div>
    );
  }
  return <CampaignSeaBattle key={slot.id} state={state} content={loaded.content} />;
}

export const screen: ScreenDescriptor = { id: 'seaBattle', mode: 'seaBattle', component: SeaBattleScreen, layout: 'fullscreen', realtime: false, titleKey: 'seaView.title' };
