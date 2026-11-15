/**
 * SCR-04 Options (§25.7 accessibility, §25.8 settings): Video · Audio · Gameplay · Accessibility ·
 * Controls · Language. Changes apply and persist immediately (settings store → localStorage → <html>
 * data attributes and CSS variables). Opened from the main menu (full page) or in game (overlay).
 */
import { useState, type ReactElement } from 'react';
import { useGame } from '../../app/gameStore';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { useT } from '../../i18n/index';
import { syncFullscreen } from '../../settings/apply';
import {
  AUTOSAVE_MODES,
  COLOR_BLIND_MODES,
  FONTS,
  FPS_CAPS,
  LANGUAGES,
  NARRATION_SPEEDS,
  TEXT_SIZE_RANGE,
  THEMES,
  UI_SCALE_RANGE,
  type AutoPauseRules,
  type Settings,
} from '../../settings/schema';
import { useSettings, type SettingsPatch } from '../../settings/store';
import { MenuBackdrop } from '../../shell/MenuBackdrop';
import { Button, ButtonRow, Field, Frame, Icon, IconButton, Panel, Segmented, Select, Slider, Tabs, Toggle, type IconName } from '../../ui/index';
import { ControlsTab } from './Controls';
import './options.css';

type TabId = 'video' | 'audio' | 'gameplay' | 'accessibility' | 'controls' | 'language';
const TAB_ICONS: Readonly<Record<TabId, IconName>> = { video: 'eye', audio: 'sound', gameplay: 'shieldRound', accessibility: 'feather', controls: 'keyboard', language: 'chronicle' };
const TABS: readonly TabId[] = ['video', 'audio', 'gameplay', 'accessibility', 'controls', 'language'];
const AUTO_PAUSE_KEYS: readonly (keyof AutoPauseRules)[] = ['critical', 'important', 'encounters', 'arrival', 'storms', 'envoys', 'birthsDeaths', 'holdingAttacked', 'lowFood'];
const SECTION_OF_TAB: Readonly<Partial<Record<TabId, keyof Settings>>> = { video: 'video', audio: 'audio', gameplay: 'gameplay', accessibility: 'accessibility', controls: 'controls', language: 'language' };

function useSection<K extends keyof Settings>(key: K): [Settings[K], (patch: Partial<Settings[K]>) => void] {
  const value = useSettings((s) => s.settings[key]);
  const update = useSettings((s) => s.update);
  return [value, (patch) => update({ [key]: patch } as SettingsPatch)];
}

function VideoTab(): ReactElement {
  const t = useT();
  const [video, set] = useSection('video');
  return (
    <div className="options-grid">
      <Slider label={t('menu.options.video.uiScale')} value={video.uiScale} min={UI_SCALE_RANGE.min} max={UI_SCALE_RANGE.max} step={UI_SCALE_RANGE.step} unit="%" onChange={(v) => set({ uiScale: v })} hint={t('menu.options.video.uiScaleHint')} data-testid="options-ui-scale" />
      <Segmented
        label={t('menu.options.video.theme')}
        value={video.theme}
        onChange={(theme) => set({ theme })}
        options={THEMES.map((th) => ({ value: th, label: t(`menu.options.video.theme.${th}`) }))}
      />
      <Toggle
        checked={video.fullscreen}
        onChange={(v) => {
          set({ fullscreen: v });
          syncFullscreen(v);
        }}
        label={t('menu.options.video.fullscreen')}
      />
      <Toggle checked={video.vsync} onChange={(v) => set({ vsync: v })} label={t('menu.options.video.vsync')} hint={t('menu.options.video.vsyncHint')} />
      <Segmented label={t('menu.options.video.fpsCap')} value={video.fpsCap} onChange={(fpsCap) => set({ fpsCap })} options={FPS_CAPS.map((f) => ({ value: f, label: f === 'unlimited' ? t('menu.options.video.unlimited') : f }))} />
    </div>
  );
}

function AudioTab(): ReactElement {
  const t = useT();
  const [audio, set] = useSection('audio');
  const channels = ['master', 'music', 'sfx', 'ambience', 'voice'] as const;
  return (
    <div className="options-grid">
      {channels.map((ch) => (
        <Slider key={ch} label={t(`menu.options.audio.${ch}`)} value={audio[ch]} min={0} max={100} unit="%" onChange={(v) => set({ [ch]: v })} data-testid={`options-audio-${ch}`} />
      ))}
      <Toggle checked={audio.narration} onChange={(v) => set({ narration: v })} label={t('menu.options.audio.narration')} hint={t('menu.options.audio.narrationHint')} />
    </div>
  );
}

function GameplayTab(): ReactElement {
  const t = useT();
  const [gp, set] = useSection('gameplay');
  const [dev, setDev] = useSection('dev');
  const flags = ['tutorialTips', 'counsel', 'haggling', 'flirt', 'blood', 'confirmDialogs'] as const;
  return (
    <div className="stack">
      <Panel title={t('menu.options.gameplay.autoPause')}>
        <p className="muted options-note">{t('menu.options.gameplay.autoPauseNote')}</p>
        <div className="options-toggles">
          {AUTO_PAUSE_KEYS.map((k) => (
            <Toggle key={k} checked={gp.autoPause[k]} onChange={(v) => set({ autoPause: { ...gp.autoPause, [k]: v } })} label={t(`menu.options.gameplay.autoPause.${k}`)} data-testid={`autopause-${k}`} />
          ))}
        </div>
      </Panel>
      <Panel title={t('menu.options.gameplay.general')}>
        <div className="options-toggles">
          {flags.map((k) => (
            <Toggle key={k} checked={gp[k]} onChange={(v) => set({ [k]: v })} label={t(`menu.options.gameplay.${k}`)} hint={t(`menu.options.gameplay.${k}Hint`)} />
          ))}
        </div>
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <Segmented label={t('menu.options.gameplay.autosave')} value={gp.autosave} onChange={(autosave) => set({ autosave })} options={AUTOSAVE_MODES.map((m) => ({ value: m, label: t(`menu.options.gameplay.autosave.${m}`) }))} />
        </div>
      </Panel>
      <Panel title={t('menu.options.gameplay.developer')}>
        <Toggle checked={dev.console} onChange={(v) => setDev({ console: v })} label={t('menu.options.gameplay.devConsole')} hint={t('menu.options.gameplay.devConsoleHint')} />
      </Panel>
    </div>
  );
}

function Swatches(): ReactElement {
  const t = useT();
  const states: { key: string; icon: IconName; v: string }[] = [
    { key: 'good', icon: 'check', v: '--cb-good' },
    { key: 'bad', icon: 'critical', v: '--cb-bad' },
    { key: 'warn', icon: 'warning', v: '--cb-warn' },
    { key: 'info', icon: 'info', v: '--cb-info' },
  ];
  return (
    <div className="swatches" aria-label={t('menu.options.access.palettePreview')}>
      {states.map((s) => (
        <span key={s.key} className="swatch" style={{ color: `var(${s.v})` }}>
          <Icon name={s.icon} />
          <span>{t(`menu.options.access.state.${s.key}`)}</span>
        </span>
      ))}
      <span className="swatch-factions" aria-hidden="true">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <span key={i} className="faction-dot" style={{ background: `var(--faction-${i})` }} />
        ))}
      </span>
    </div>
  );
}

function AccessibilityTab(): ReactElement {
  const t = useT();
  const [a, set] = useSection('accessibility');
  return (
    <div className="stack">
      <div className="options-grid">
        <Slider label={t('menu.options.access.textSize')} value={a.textSize} min={TEXT_SIZE_RANGE.min} max={TEXT_SIZE_RANGE.max} step={TEXT_SIZE_RANGE.step} unit="%" onChange={(v) => set({ textSize: v })} data-testid="options-text-size" />
        <Segmented label={t('menu.options.access.font')} value={a.font} onChange={(font) => set({ font })} options={FONTS.map((f) => ({ value: f, label: t(`menu.options.access.font.${f}`) }))} />
        <Field label={t('menu.options.access.colorBlind')} hint={t('menu.options.access.colorBlindHint')}>
          {(id, described) => (
            <Select id={id} aria-describedby={described} value={a.colorBlind} onChange={(e) => set({ colorBlind: e.currentTarget.value as Settings['accessibility']['colorBlind'] })} data-testid="options-colorblind">
              {COLOR_BLIND_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`menu.options.access.cb.${m}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Swatches />
        <Segmented label={t('menu.options.access.narrationSpeed')} value={a.narrationSpeed} onChange={(narrationSpeed) => set({ narrationSpeed })} options={NARRATION_SPEEDS.map((s) => ({ value: s, label: t(`menu.options.access.speed.${s}`) }))} />
        <Slider label={t('menu.options.access.parryWindow')} value={a.parryWindowBonus} min={0} max={100} step={5} unit="%" onChange={(v) => set({ parryWindowBonus: v })} />
      </div>
      <div className="options-toggles">
        <Toggle checked={a.highContrast} onChange={(v) => set({ highContrast: v })} label={t('menu.options.access.highContrast')} data-testid="options-high-contrast" />
        <Toggle checked={a.reducedMotion} onChange={(v) => set({ reducedMotion: v })} label={t('menu.options.access.reducedMotion')} />
        <Toggle checked={a.cameraShake} onChange={(v) => set({ cameraShake: v })} label={t('menu.options.access.cameraShake')} />
        <Toggle checked={a.speakerLabels} onChange={(v) => set({ speakerLabels: v })} label={t('menu.options.access.speakerLabels')} />
        <Toggle checked={a.autoAdvance} onChange={(v) => set({ autoAdvance: v })} label={t('menu.options.access.autoAdvance')} />
        <Toggle checked={a.holdToToggle} onChange={(v) => set({ holdToToggle: v })} label={t('menu.options.access.holdToToggle')} />
        <Toggle checked={a.duelSlowMotion} onChange={(v) => set({ duelSlowMotion: v })} label={t('menu.options.access.duelSlowMotion')} />
      </div>
      <Panel title={t('menu.options.access.preview')} className="options-preview">
        <p className="options-preview-display">{t('menu.options.access.previewTitle')}</p>
        <p>{t('menu.options.access.previewBody')}</p>
      </Panel>
    </div>
  );
}

function LanguageTab(): ReactElement {
  const t = useT();
  const language = useSettings((s) => s.settings.language);
  const setKey = useSettings((s) => s.set);
  return (
    <div className="options-grid">
      <Field label={t('menu.options.language.label')} hint={t('menu.options.language.hint')}>
        {(id, described) => (
          <Select id={id} aria-describedby={described} value={language} onChange={(e) => setKey('language', e.currentTarget.value as Settings['language'])}>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {t(`menu.options.language.${l}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}

function OptionsScreen({ close }: ScreenProps): ReactElement {
  const t = useT();
  const inGame = useGame((s) => s.session !== null);
  const [tab, setTab] = useState<TabId>('video');
  const reset = useSettings((s) => s.reset);
  const section = SECTION_OF_TAB[tab];
  const frame = (
    <Frame
      className="options-frame"
      title={t('menu.options.title')}
      ornate
      actions={<IconButton icon="close" label={t('ui.common.close')} keyHint="ui.back" onClick={close} data-testid="options-close" />}
      footer={
        <ButtonRow align="between">
          <Button variant="ghost" icon="reset" onClick={() => section && reset(section)} data-testid="options-reset">
            {t('menu.options.resetTab')}
          </Button>
          <Button variant="primary" onClick={close} data-testid="options-done">
            {t('ui.common.done')}
          </Button>
        </ButtonRow>
      }
      data-testid="options"
    >
      <Tabs label={t('menu.options.title')} value={tab} onChange={(id) => setTab(id as TabId)} orientation="vertical" tabs={TABS.map((id) => ({ id, label: t(`menu.options.tab.${id}`), icon: TAB_ICONS[id] }))}>
        {(active) => {
          switch (active as TabId) {
            case 'video':
              return <VideoTab />;
            case 'audio':
              return <AudioTab />;
            case 'gameplay':
              return <GameplayTab />;
            case 'accessibility':
              return <AccessibilityTab />;
            case 'controls':
              return <ControlsTab />;
            case 'language':
              return <LanguageTab />;
          }
        }}
      </Tabs>
    </Frame>
  );
  if (inGame) return <div className="options-overlay">{frame}</div>;
  return (
    <div className="options-page">
      <MenuBackdrop dim />
      {frame}
    </div>
  );
}

export const screen: ScreenDescriptor = { id: 'options', route: 'options', component: OptionsScreen, layout: 'overlay', titleKey: 'menu.options.title' };
