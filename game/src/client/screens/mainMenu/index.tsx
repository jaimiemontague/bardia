/**
 * SCR-01 Main Menu: Continue (latest save) · New Saga · Skirmish (a standalone battle) · Load Saga · Options · Credits.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { continueLatest, latestSave } from '../../app/lifecycle';
import { navigation } from '../../app/navigation';
import { formatGameDate } from '../../i18n/calendar';
import { useT } from '../../i18n/index';
import type { SaveMeta } from '../../saves/saveManager';
import { MenuBackdrop } from '../../shell/MenuBackdrop';
import { Icon, type IconName } from '../../ui/index';
import { GAME_VERSION } from '@sim/core/version';
import './mainMenu.css';

interface Entry {
  id: string;
  icon: IconName;
  labelKey: string;
  detail?: string;
  disabled?: boolean;
  primary?: boolean;
  onClick(): void;
}

function MainMenu(_props: ScreenProps): ReactElement {
  const t = useT();
  const [latest, setLatest] = useState<SaveMeta | undefined | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void latestSave().then((m) => {
      if (alive) setLatest(m);
    });
    return () => {
      alive = false;
    };
  }, []);

  const entries: Entry[] = [
    {
      id: 'continue',
      icon: 'arrowRight',
      labelKey: 'menu.main.continue',
      detail: latest ? t('menu.main.continueDetail', { name: latest.rulerName || latest.name, date: formatGameDate(latest.hour) }) : undefined,
      disabled: !latest || busy,
      primary: Boolean(latest),
      onClick: () => {
        setBusy(true);
        void continueLatest().finally(() => setBusy(false));
      },
    },
    { id: 'newSaga', icon: 'ship', labelKey: 'menu.main.newSaga', primary: !latest, onClick: () => navigation.showMenu('newSaga') },
    { id: 'skirmish', icon: 'sword', labelKey: 'menu.main.skirmish', detail: t('menu.main.skirmishDetail'), onClick: () => navigation.showMenu('skirmish') },
    { id: 'load', icon: 'load', labelKey: 'menu.main.load', onClick: () => navigation.showMenu('saveLoad', { mode: 'load' }) },
    { id: 'options', icon: 'gear', labelKey: 'menu.main.options', onClick: () => navigation.showMenu('options') },
    { id: 'credits', icon: 'quill', labelKey: 'menu.main.credits', onClick: () => navigation.showMenu('credits') },
  ];

  return (
    <div className="main-menu" data-testid="main-menu">
      <MenuBackdrop />
      <div className="main-menu-column">
        <header className="main-menu-title">
          <div className="main-menu-rune" aria-hidden="true">
            ᛒ
          </div>
          <h1 className="main-menu-wordmark">{t('menu.main.title')}</h1>
          <p className="main-menu-tagline">{t('menu.main.tagline')}</p>
        </header>
        <nav className="main-menu-nav" aria-label={t('menu.main.navLabel')}>
          {entries.map((e, i) => (
            <button
              key={e.id}
              type="button"
              className={['main-menu-item', e.primary && 'is-primary'].filter(Boolean).join(' ')}
              disabled={e.disabled}
              onClick={e.onClick}
              data-testid={`menu-${e.id}`}
              data-autofocus={(e.primary && !e.disabled) || undefined}
              style={{ animationDelay: `${120 + i * 70}ms` }}
            >
              <Icon name={e.icon} className="main-menu-icon" />
              <span className="main-menu-label">
                <span>{t(e.labelKey)}</span>
                {e.detail && <span className="main-menu-detail">{e.detail}</span>}
              </span>
            </button>
          ))}
        </nav>
        <footer className="main-menu-footer">
          <span>{t('menu.main.version', { version: GAME_VERSION })}</span>
          <span aria-hidden="true">·</span>
          <span>{t('menu.main.placeholderNotice')}</span>
        </footer>
      </div>
    </div>
  );
}

export const screen: ScreenDescriptor = { id: 'mainMenu', route: 'mainMenu', component: MainMenu, layout: 'fullscreen', titleKey: 'menu.main.title' };
