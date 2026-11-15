/**
 * Credits: the saga's makers, the placeholder notice (procedural art, music and voice until the
 * owner's final assets arrive) and the open-source libraries with their licences.
 */
import type { ReactElement } from 'react';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { useT } from '../../i18n/index';
import { MenuBackdrop } from '../../shell/MenuBackdrop';
import { Button, ButtonRow, Divider, Frame, ScrollArea } from '../../ui/index';
import './credits.css';

/** Libraries shipped in the game (name, licence). */
export const LIBRARIES: readonly [string, string][] = [
  ['React', 'MIT'],
  ['PixiJS', 'MIT'],
  ['Zustand', 'MIT'],
  ['Immer', 'MIT'],
  ['Zod', 'MIT'],
  ['Howler.js', 'MIT'],
  ['fflate', 'MIT'],
  ['intl-messageformat (FormatJS)', 'BSD-3-Clause'],
  ['Cinzel', 'SIL OFL 1.1'],
  ['EB Garamond', 'SIL OFL 1.1'],
  ['Atkinson Hyperlegible', 'SIL OFL 1.1'],
];

const SECTIONS = ['design', 'engineering', 'art', 'music', 'writing', 'testing'] as const;

function CreditsScreen({ close }: ScreenProps): ReactElement {
  const t = useT();
  return (
    <div className="credits-page">
      <MenuBackdrop dim />
      <Frame className="credits-frame" title={t('menu.credits.title')} ornate footer={<ButtonRow><Button variant="primary" icon="arrowLeft" onClick={close} data-autofocus>{t('ui.common.back')}</Button></ButtonRow>} data-testid="credits">
        <ScrollArea label={t('menu.credits.title')} className="credits-scroll">
          <p className="credits-lede">{t('menu.credits.lede')}</p>
          {SECTIONS.map((s) => (
            <section key={s} className="credits-section">
              <h3>{t(`menu.credits.section.${s}`)}</h3>
              <p>{t(`menu.credits.body.${s}`)}</p>
            </section>
          ))}
          <Divider label={t('menu.credits.placeholders')} />
          <p className="muted">{t('menu.credits.placeholderBody')}</p>
          <Divider label={t('menu.credits.libraries')} />
          <ul className="credits-libs">
            {LIBRARIES.map(([name, licence]) => (
              <li key={name}>
                <span>{name}</span>
                <span className="faint">{licence}</span>
              </li>
            ))}
          </ul>
          <p className="credits-end">{t('menu.credits.end')}</p>
        </ScrollArea>
      </Frame>
    </div>
  );
}

export const screen: ScreenDescriptor = { id: 'credits', route: 'credits', component: CreditsScreen, layout: 'fullscreen', titleKey: 'menu.credits.title' };
