/**
 * Skirmish (route 'skirmish', from the main menu): a standalone battle from a few preset match-ups on
 * the same battle screen, engine and AI as the campaign, with no campaign state and no consequences.
 * The land match-ups play on the battle scene, the sea match-ups on the sea-battle scene. After the
 * battle: fight the same match-up again on fresh ground or water, pick another, or go back to the
 * main menu.
 */
import { useState, type ReactElement } from 'react';
import { loadContent } from '../../app/content';
import { navigation } from '../../app/navigation';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { t as translate, useT } from '../../i18n/index';
import { MenuBackdrop } from '../../shell/MenuBackdrop';
import { Button, Icon } from '../../ui/index';
import { BattleScene } from '../battle/BattleScene';
import { BattleController } from '../battle/controller';
import { SeaController } from '../seaBattle/controller';
import { SeaBattleScene } from '../seaBattle/SeaBattleScene';
import { seaTitle } from '../seaBattle/index';
import { SEA_SKIRMISH_PRESETS, seaSkirmishCaptainName, seaSkirmishSetup, SKIRMISH_PRESETS, skirmishSetup, type SeaSkirmishPresetId, type SkirmishPresetId } from './presets';
import './skirmish.css';

let runCounter = 0;

function Skirmish(_props: ScreenProps): ReactElement {
  const t = useT();
  const loaded = loadContent();
  const [game, setGame] = useState<{ id: SkirmishPresetId; controller: BattleController } | null>(null);
  const [seaGame, setSeaGame] = useState<{ id: SeaSkirmishPresetId; controller: SeaController } | null>(null);

  if (!loaded.ok) {
    return (
      <div className="skirmish" data-testid="skirmish">
        <p>{loaded.error}</p>
      </div>
    );
  }
  const content = loaded.content;
  const start = (id: SkirmishPresetId) => setGame({ id, controller: new BattleController(skirmishSetup(content, id, runCounter++), content, translate) });
  const startSea = (id: SeaSkirmishPresetId) => setSeaGame({ id, controller: new SeaController(seaSkirmishSetup(content, id, runCounter++, (k) => translate(k)), content, translate) });
  const toMenu = () => navigation.showMenu('mainMenu');

  if (seaGame) {
    const setup = seaGame.controller.setup;
    const arena = `seabattle.arena.${setup.arena}`;
    return (
      <div className="skirmish-battle" data-testid="skirmish-sea-battle">
        <SeaBattleScene
          key={setup.id}
          controller={seaGame.controller}
          title={setup.arena ? t('seaView.skirmish.battleTitle', { arena: t(arena) }) : seaTitle(setup, t)}
          nameOf={(id) => seaSkirmishCaptainName(id, (k) => translate(k))}
          doneLabelKey="menu.skirmish.toMenu"
          onDone={() => {
            toMenu();
            return null;
          }}
          summaryExtra={
            <>
              <Button variant="secondary" icon="reset" onClick={() => startSea(seaGame.id)} data-testid="skirmish-again">
                {t('menu.skirmish.again')}
              </Button>
              <Button variant="secondary" icon="arrowLeft" onClick={() => setSeaGame(null)} data-testid="skirmish-another">
                {t('menu.skirmish.another')}
              </Button>
            </>
          }
          leave={{ labelKey: 'menu.skirmish.leave', onClick: () => setSeaGame(null) }}
        />
      </div>
    );
  }

  if (game) {
    const setup = game.controller.setup;
    return (
      <div className="skirmish-battle" data-testid="skirmish-battle">
        <BattleScene
          key={setup.id}
          controller={game.controller}
          title={t('menu.skirmish.battleTitle', { kind: t(`battle.kind.${setup.kind}`) })}
          doneLabelKey="menu.skirmish.toMenu"
          onDone={() => {
            toMenu();
            return null;
          }}
          summaryExtra={
            <>
              <Button variant="secondary" icon="reset" onClick={() => start(game.id)} data-testid="skirmish-again">
                {t('menu.skirmish.again')}
              </Button>
              <Button variant="secondary" icon="arrowLeft" onClick={() => setGame(null)} data-testid="skirmish-another">
                {t('menu.skirmish.another')}
              </Button>
            </>
          }
          leave={{ labelKey: 'menu.skirmish.leave', onClick: () => setGame(null) }}
        />
      </div>
    );
  }

  return (
    <div className="skirmish" data-testid="skirmish">
      <MenuBackdrop />
      <div className="skirmish-column">
        <header>
          <h1>{t('menu.skirmish.title')}</h1>
          <p className="muted">{t('menu.skirmish.intro')}</p>
        </header>
        <h2 className="skirmish-heading">{t('seaView.skirmish.landHeading')}</h2>
        <div className="skirmish-grid">
          {SKIRMISH_PRESETS.map((p) => (
            <button key={p.id} type="button" className="skirmish-card" onClick={() => start(p.id)} data-testid={`skirmish-preset-${p.id}`}>
              <Icon name={p.icon} className="skirmish-icon" />
              <span className="skirmish-card-title">{t(p.titleKey)}</span>
              <span className="skirmish-card-body">{t(p.bodyKey)}</span>
            </button>
          ))}
        </div>
        <h2 className="skirmish-heading">{t('seaView.skirmish.seaHeading')}</h2>
        <div className="skirmish-grid is-sea" data-testid="skirmish-sea-presets">
          {SEA_SKIRMISH_PRESETS.map((p) => (
            <button key={p.id} type="button" className="skirmish-card is-sea" onClick={() => startSea(p.id)} data-testid={`skirmish-preset-${p.id}`}>
              <Icon name={p.icon} className="skirmish-icon" />
              <span className="skirmish-card-title">{t(p.titleKey)}</span>
              <span className="skirmish-card-body">{t(p.bodyKey)}</span>
            </button>
          ))}
        </div>
        <Button variant="ghost" icon="arrowLeft" onClick={toMenu} data-testid="skirmish-back">
          {t('menu.skirmish.back')}
        </Button>
      </div>
    </div>
  );
}

export const screen: ScreenDescriptor = { id: 'skirmish', route: 'skirmish', component: Skirmish, layout: 'fullscreen', titleKey: 'menu.skirmish.title' };
