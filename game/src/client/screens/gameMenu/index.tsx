/**
 * The in-game menu (Esc / top-bar Menu): Resume · Save · Load · Options · Codex · Quit to main menu
 * (with a confirm step; Ironman campaigns are saved on quit).
 */
import { useState, type ReactElement } from 'react';
import { useGame } from '../../app/gameStore';
import { quitToMenu } from '../../app/lifecycle';
import { navigation } from '../../app/navigation';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatGameDate } from '../../i18n/calendar';
import { useT } from '../../i18n/index';
import { Button, ButtonRow, Frame, Modal } from '../../ui/index';
import './gameMenu.css';

function GameMenu({ close }: ScreenProps): ReactElement {
  const t = useT();
  const state = useGame((s) => s.state);
  const ironman = state?.meta.options.ironman === true;
  const [confirmQuit, setConfirmQuit] = useState(false);
  return (
    <div className="game-menu-wrap">
      <Frame className="game-menu" title={t('ui.gameMenu.title')} subtitle={state ? t('ui.gameMenu.subtitle', { date: formatGameDate(state.time.hour), seed: state.meta.seed }) : undefined} ornate data-testid="game-menu">
        <nav className="game-menu-list" aria-label={t('ui.gameMenu.title')}>
          <Button variant="primary" size="lg" block icon="play" onClick={close} data-autofocus data-testid="gm-resume">
            {t('ui.gameMenu.resume')}
          </Button>
          <Button size="lg" block icon="save" onClick={() => navigation.open('saveLoad', { mode: 'save' })} data-testid="gm-save">
            {ironman ? t('ui.gameMenu.ironmanSaves') : t('ui.gameMenu.save')}
          </Button>
          <Button size="lg" block icon="load" onClick={() => navigation.open('saveLoad', { mode: 'load' })} data-testid="gm-load">
            {t('ui.gameMenu.load')}
          </Button>
          <Button size="lg" block icon="gear" onClick={() => navigation.open('options')} data-testid="gm-options">
            {t('ui.gameMenu.options')}
          </Button>
          <Button size="lg" block icon="codex" onClick={() => navigation.open('codex')} keyHint="open.codex">
            {t('ui.route.codex')}
          </Button>
          <Button size="lg" block variant="danger" icon="arrowLeft" onClick={() => setConfirmQuit(true)} data-testid="gm-quit">
            {t('ui.gameMenu.quit')}
          </Button>
        </nav>
      </Frame>
      <Modal
        open={confirmQuit}
        onClose={() => setConfirmQuit(false)}
        title={t('ui.gameMenu.quitTitle')}
        size="sm"
        footer={
          <ButtonRow>
            <Button onClick={() => setConfirmQuit(false)}>{t('ui.common.cancel')}</Button>
            <Button variant="danger" onClick={() => void quitToMenu()} data-autofocus data-testid="gm-quit-confirm">
              {t('ui.gameMenu.quitConfirm')}
            </Button>
          </ButtonRow>
        }
      >
        <p>{ironman ? t('ui.gameMenu.quitBodyIronman') : t('ui.gameMenu.quitBody')}</p>
      </Modal>
    </div>
  );
}

export const screen: ScreenDescriptor = { id: 'gameMenu', route: 'gameMenu', component: GameMenu, layout: 'modal', titleKey: 'ui.gameMenu.title' };
