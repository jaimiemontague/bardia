/**
 * The battlefield (game mode 'battle', design §13.5, ADR-003): the tactical battle the player chose to
 * fight on the Before-the-Battle card. Builds a BattleController from `state.subsims.battle.setup`,
 * plays it in real time with pause, and hands the engine's result back with the battle module's own
 * `applyBattleResult` command, which returns the game to the scene it came from. If the module ever
 * refused the result, the summary offers the auto-resolved outcome instead, so no battle can strand
 * the player.
 */
import { useCallback, type ReactElement } from 'react';
import type { Content } from '@content/index';
import { autoResolveBattle } from '@sim/battle/autoresolve';
import { Rng } from '@sim/core/rng';
import type { BattleSetup, GameState } from '@sim/core/state';
import { loadContent } from '../../app/content';
import { useGame } from '../../app/gameStore';
import { navigation } from '../../app/navigation';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { t as translate, useT } from '../../i18n/index';
import { Button } from '../../ui/index';
import { BattleScene } from './BattleScene';
import { BattleController } from './controller';

export { BattleScene } from './BattleScene';
export { BattleController } from './controller';

/**
 * One controller per running battle id, kept outside React so a remount (StrictMode, an error
 * boundary reset) continues the same battle instead of restarting it.
 */
let live: { id: string; controller: BattleController } | null = null;

/** The controller of a running campaign battle (created on first use). */
export function controllerFor(id: string, setup: BattleSetup, content: Content): BattleController {
  if (live?.id !== id) live = { id, controller: new BattleController(setup, content, translate) };
  return live.controller;
}

/** Forgets the controller of a finished battle. */
export function releaseController(id: string): void {
  if (live?.id === id) live = null;
}

function battleTitle(state: GameState, setup: BattleSetup, t: ReturnType<typeof useT>): string {
  const kind = t(`battle.kind.${setup.kind}`);
  const place = setup.settlementId !== undefined ? state.settlements[setup.settlementId]?.name : undefined;
  return place !== undefined ? t('battle.setup.titleAt', { kind, place }) : kind;
}

function CampaignBattle({ state, content }: { state: GameState; content: Content }): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const slot = state.subsims.battle!;
  const setup = slot.setup;
  const c = controllerFor(slot.id, setup, content);
  const nameOf = useCallback((id: string) => (Object.hasOwn(state.characters, id) ? state.characters[id as keyof typeof state.characters]?.name : undefined), [state.characters]);

  const done = (): string | null => {
    const result = c.result();
    if (!result) return t('battleView.error.noResult');
    const r = dispatch({ type: 'applyBattleResult', battleId: setup.id, result });
    if (!r) return t('battleView.error.noSession');
    if (r.error) return t('battleView.error.refused', { message: r.error.message });
    releaseController(slot.id);
    return null;
  };
  const fallback = (
    <Button
      variant="secondary"
      icon="dice"
      onClick={() => {
        const result = autoResolveBattle(setup, content, Rng.derive(setup.seed, 'autoresolve'));
        const r = dispatch({ type: 'applyBattleResult', battleId: setup.id, result });
        if (r && !r.error) releaseController(slot.id);
      }}
      data-testid="battle-return-auto"
    >
      {t('battleView.returnAuto')}
    </Button>
  );
  return (
    <BattleScene
      controller={c}
      title={battleTitle(state, setup, t)}
      nameOf={nameOf}
      doneLabelKey="battleView.returnSaga"
      onDone={done}
      leave={{ labelKey: 'battleView.gameMenu', onClick: () => navigation.open('gameMenu') }}
      fallback={fallback}
    />
  );
}

function BattleScreen(_props: ScreenProps): ReactElement {
  const t = useT();
  const state = useGame((s) => s.state);
  const loaded = loadContent();
  const slot = state?.subsims.battle;
  if (!state || !slot || slot.status !== 'running' || !loaded.ok) {
    return (
      <div className="bv-root bv-missing" data-testid="battle-screen" data-status="missing">
        <p>{t('battleView.error.noBattle')}</p>
      </div>
    );
  }
  return <CampaignBattle key={slot.id} state={state} content={loaded.content} />;
}

export const screen: ScreenDescriptor = { id: 'battle', mode: 'battle', component: BattleScreen, layout: 'fullscreen', realtime: false, titleKey: 'battleView.title' };
