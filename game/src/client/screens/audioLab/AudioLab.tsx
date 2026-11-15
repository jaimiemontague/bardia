/**
 * The audio lab: auditions every music state (with intensity and a live piano roll), stinger, sound
 * effect (with its parameters), voice role and audio setting. Shows for each id whether the owner's
 * final file or the procedural placeholder is used.
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useT } from '@client/i18n/index';
import type { ScreenProps } from '@client/app/screenTypes';
import {
  BUS_IDS,
  isStemmed,
  MUSIC_STATES,
  musicStemAssetId,
  musicTrackAssetId,
  sfxDef,
  SFX_IDS,
  sfxAssetId,
  sfxVariant,
  STEM_LEVELS,
  stingerAssetId,
  STINGERS,
  VOICE_ROLES,
  type CommonSfxParams,
  type MusicRequest,
  type MusicState,
  type SfxId,
  type SfxParamBag,
} from '@client/audio/catalog';
import type { SfxHandle } from '@client/audio/audioManager';
import { getAudioManager, getVoiceManager, useAudioAutoUnlock, useAudioSettings, useAudioStatus, useMusicState, useSubtitle } from '@client/audio/hooks';
import { NARRATION_SPEED_RANGE, PLACEHOLDER_VOICE_MODES, type PlaceholderVoiceMode } from '@client/audio/settings';
import { PianoRoll } from './PianoRoll';
import './audioLab.css';

type Translate = ReturnType<typeof useT>;

const GROUPS = ['ui', 'sea', 'weather', 'battle', 'duel', 'town', 'animal'] as const;

function StatusBadge({ final, t }: { final: boolean; t: Translate }) {
  return <span className={final ? 'al-badge al-badge-final' : 'al-badge'}>{t(final ? 'music.lab.status.final' : 'music.lab.status.placeholder')}</span>;
}

function isFinal(id: string): boolean {
  return getAudioManager().assets.resolve(id).status === 'final';
}

function musicIsFinal(state: MusicState): boolean {
  if (isFinal(musicTrackAssetId(state))) return true;
  return isStemmed(state) && STEM_LEVELS.every((l) => isFinal(musicStemAssetId(state, l)));
}

function defaultParams(id: SfxId): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [name, p] of Object.entries(sfxDef(id).params)) out[name] = p.default;
  return out;
}

function SfxRow({ id, common, t }: { id: SfxId; common: CommonSfxParams; t: Translate }) {
  const def = sfxDef(id);
  const [params, setParams] = useState(() => defaultParams(id));
  const [looping, setLooping] = useState(false);
  const handle = useRef<SfxHandle | undefined>(undefined);
  const bag = useMemo<SfxParamBag>(() => ({ ...params, ...common }), [params, common]);
  const bagKey = JSON.stringify(bag);

  useEffect(() => () => handle.current?.stop(0.2), []);
  // A running loop restarts when its parameters change.
  useEffect(() => {
    if (!def.loop || !looping) return;
    const h = getAudioManager().playSfx(id, JSON.parse(bagKey) as SfxParamBag);
    handle.current = h;
    return () => h.stop(0.4);
  }, [def.loop, looping, id, bagKey]);

  const onPlay = () => {
    if (def.loop) setLooping((v) => !v);
    else getAudioManager().playSfx(id, bag);
  };
  const final = isFinal(sfxAssetId(id, sfxVariant(id, bag)));
  return (
    <div className="al-sfx" data-testid={`sfx-${id}`}>
      <div className="al-sfx-head">
        <span className="al-sfx-name">{t(`music.sfx.${id}`)}</span>
        {def.loop ? <span className="al-tag">{t('music.lab.loop')}</span> : null}
        <StatusBadge final={final} t={t} />
        <button type="button" className={looping ? 'al-btn al-btn-on' : 'al-btn'} onClick={onPlay} aria-pressed={def.loop ? looping : undefined}>
          {t(def.loop && looping ? 'music.lab.stop' : 'music.lab.play')}
        </button>
      </div>
      {Object.entries(def.params).map(([name, p]) => (
        <label key={name} className="al-param">
          <span>{t(`music.sfx.param.${name}`)}</span>
          {p.kind === 'enum' ? (
            <select value={String(params[name])} onChange={(e: ChangeEvent<HTMLSelectElement>) => setParams((v) => ({ ...v, [name]: e.target.value }))}>
              {p.values.map((v) => (
                <option key={v} value={v}>
                  {t(`music.sfx.value.${v}`)}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="range"
              min={p.min}
              max={p.max}
              step={p.step ?? 0.01}
              value={Number(params[name])}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setParams((v) => ({ ...v, [name]: Number(e.target.value) }))}
            />
          )}
        </label>
      ))}
    </div>
  );
}

function Slider({ label, value, min = 0, max = 1, step = 0.01, onChange, format }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label className="al-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{format ? format(value) : `${Math.round(value * 100)}%`}</output>
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="al-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** The audio lab screen (route 'audioLab'). */
export function AudioLabScreen({ close }: ScreenProps) {
  const t = useT();
  useAudioAutoUnlock();
  const status = useAudioStatus();
  const [settings, update] = useAudioSettings();
  const subtitle = useSubtitle();
  const [music, setMusic] = useState<MusicRequest | null>(null);
  const [common, setCommon] = useState<CommonSfxParams>({ volume: 1, pan: 0, rate: 1 });
  const [bar, setBar] = useState(0);
  useMusicState(music);

  // Follow the playing deck's bar for the piano roll.
  useEffect(() => {
    const id = setInterval(() => {
      const deck = getAudioManager().music?.deck;
      setBar(deck ? deck.cursor.bar : 0);
    }, 400);
    return () => clearInterval(id);
  }, []);

  useEffect(() => () => getVoiceManager().stopAll(), []);

  const playing = status.music.state;
  const rollState: MusicState = music && music !== 'silence' ? music : (playing ?? 'mainTheme');
  const voice = getVoiceManager();
  const sourceKey = `music.lab.source.${status.music.source}`;

  return (
    <div className="al-root" data-testid="audio-lab">
      <header className="al-header">
        <div>
          <h1>{t('music.lab.title')}</h1>
          <p className="al-sub">{t('music.lab.subtitle')}</p>
        </div>
        <div className="al-header-actions">
          {!status.unlocked ? (
            <button type="button" className="al-btn al-btn-primary" onClick={() => void getAudioManager().unlock()} disabled={!status.supported} title={t('music.lab.unlockHint')}>
              {t(status.supported ? 'music.lab.unlock' : 'music.lab.unsupported')}
            </button>
          ) : null}
          <button type="button" className="al-btn" onClick={() => getAudioManager().stopAllSfx(0.2)}>
            {t('music.lab.stopAll')}
          </button>
          <button type="button" className="al-btn" onClick={close}>
            {t('music.lab.close')}
          </button>
        </div>
      </header>
      <p className="al-status" aria-live="polite">
        {t('music.lab.nowPlaying', { state: playing ? t(`music.state.${playing}`) : t('music.state.silence') })} · {t(sourceKey)} · {t('music.lab.activeSfx', { count: status.activeSfx })} ·{' '}
        {t('music.lab.finalFiles', { count: status.finalFiles })}
      </p>

      <div className="al-grid">
        <section className="al-card al-wide">
          <h2>{t('music.lab.section.music')}</h2>
          <div className="al-states">
            {MUSIC_STATES.map((s) => (
              <button key={s} type="button" className={playing === s ? 'al-state al-state-on' : 'al-state'} onClick={() => setMusic(s)} data-testid={`music-${s}`}>
                <span>{t(`music.state.${s}`)}</span>
                <StatusBadge final={musicIsFinal(s)} t={t} />
              </button>
            ))}
            <button type="button" className={music === 'silence' ? 'al-state al-state-on' : 'al-state'} onClick={() => setMusic('silence')}>
              <span>{t('music.state.silence')}</span>
            </button>
          </div>
          <div className="al-row">
            <Slider label={t('music.lab.intensity')} value={status.music.intensity} onChange={(v) => getAudioManager().setIntensity(v)} />
            <button type="button" className="al-btn" onClick={() => getAudioManager().restartMusic()}>
              {t('music.lab.restart')}
            </button>
          </div>
          <figure className="al-roll-wrap">
            <PianoRoll state={rollState} seed={getAudioManager().music?.seed ?? 'bardia'} fromBar={bar} bars={4} intensity={status.music.intensity} label={t('music.lab.pianoRoll')} />
            <figcaption>
              {t('music.lab.pianoRoll')} · {t(`music.state.${rollState}`)} · {t('music.lab.bar', { bar: bar + 1 })}
            </figcaption>
          </figure>
        </section>

        <section className="al-card">
          <h2>{t('music.lab.section.stingers')}</h2>
          <div className="al-buttons">
            {STINGERS.map((s) => (
              <button key={s} type="button" className="al-btn" onClick={() => getAudioManager().playStinger(s)}>
                {t(`music.stinger.${s}`)} <StatusBadge final={isFinal(stingerAssetId(s))} t={t} />
              </button>
            ))}
          </div>
        </section>

        <section className="al-card">
          <h2>{t('music.lab.section.settings')}</h2>
          {BUS_IDS.map((b) => (
            <Slider key={b} label={t(`music.bus.${b}`)} value={settings.volumes[b]} onChange={(v) => update({ volumes: { [b]: v } })} />
          ))}
          <Toggle label={t('music.settings.muted')} checked={settings.muted} onChange={(v) => update({ muted: v })} />
          <Toggle label={t('music.settings.muteOnBlur')} checked={settings.muteOnBlur} onChange={(v) => update({ muteOnBlur: v })} />
          <Toggle label={t('music.settings.ducking')} checked={settings.ducking} onChange={(v) => update({ ducking: v })} />
          <Toggle label={t('music.settings.narration')} checked={settings.narration} onChange={(v) => update({ narration: v })} />
          <label className="al-param">
            <span>{t('music.settings.placeholderVoice')}</span>
            <select value={settings.placeholderVoice} onChange={(e) => update({ placeholderVoice: e.target.value as PlaceholderVoiceMode })}>
              {PLACEHOLDER_VOICE_MODES.map((m) => (
                <option key={m} value={m} disabled={m === 'tts' && !voice.ttsAvailable}>
                  {t(`music.settings.placeholderVoice.${m}`)}
                </option>
              ))}
            </select>
          </label>
          {!voice.ttsAvailable ? <p className="al-note">{t('music.settings.ttsUnavailable')}</p> : null}
          <Slider
            label={t('music.settings.narrationSpeed')}
            value={settings.narrationSpeed}
            min={NARRATION_SPEED_RANGE[0]}
            max={NARRATION_SPEED_RANGE[1]}
            step={0.05}
            onChange={(v) => update({ narrationSpeed: v })}
            format={(v) => `${v.toFixed(2)}×`}
          />
        </section>

        <section className="al-card al-wide">
          <h2>{t('music.lab.section.voice')}</h2>
          <div className="al-voices">
            {VOICE_ROLES.map((role) => (
              <div key={role} className="al-voice">
                <div className="al-sfx-head">
                  <span className="al-sfx-name">{t(`music.voice.${role}.name`)}</span>
                  <button type="button" className="al-btn" onClick={() => voice.say({ key: `music.voice.${role}.sample`, voice: role, interrupt: true })}>
                    {t('music.lab.speak')}
                  </button>
                </div>
                <p className="al-line">{t(`music.voice.${role}.sample`)}</p>
              </div>
            ))}
          </div>
          <div className="al-subtitle" aria-live="polite" data-testid="audio-lab-subtitle">
            <h3>{t('music.lab.section.subtitles')}</h3>
            {subtitle ? (
              <p>
                <strong>{t(`music.voice.${subtitle.role}.name`)}:</strong> {subtitle.text}{' '}
                {subtitle.placeholder ? <span className="al-tag al-tag-warn">{t('music.voice.placeholderLabel')}</span> : null}
                <span className="al-tag">{t(`music.voice.source.${subtitle.source}`)}</span>
                <button type="button" className="al-btn al-btn-small" onClick={() => voice.skip()}>
                  {t('music.lab.skip')}
                </button>
              </p>
            ) : (
              <p className="al-note">{t('music.lab.subtitleEmpty')}</p>
            )}
          </div>
        </section>

        <section className="al-card al-wide">
          <h2>{t('music.lab.section.sfx')}</h2>
          <div className="al-row">
            <Slider label={t('music.sfx.param.volume')} value={common.volume ?? 1} onChange={(v) => setCommon((c) => ({ ...c, volume: v }))} />
            <Slider label={t('music.sfx.param.pan')} value={common.pan ?? 0} min={-1} max={1} onChange={(v) => setCommon((c) => ({ ...c, pan: v }))} format={(v) => v.toFixed(2)} />
            <Slider label={t('music.sfx.param.rate')} value={common.rate ?? 1} min={0.5} max={2} onChange={(v) => setCommon((c) => ({ ...c, rate: v }))} format={(v) => `${v.toFixed(2)}×`} />
          </div>
          {GROUPS.map((g) => (
            <div key={g} className="al-group">
              <h3>{t(`music.sfx.group.${g}`)}</h3>
              <div className="al-sfx-grid">
                {SFX_IDS.filter((id) => id.startsWith(`${g}.`)).map((id) => (
                  <SfxRow key={id} id={id} common={common} t={t} />
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
