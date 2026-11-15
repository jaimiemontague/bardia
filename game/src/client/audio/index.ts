/**
 * Bardia audio (design §28, §26.6, §25.7–§25.8): music, sound effects and voice, all addressed by
 * asset-manifest ids. Final files dropped under public/assets/ (listed in final-index.json) play
 * through Howler; everything else is a procedural placeholder (WebAudio).
 *
 * Screens use the hooks:
 *   useMusicState(state) · useMusicIntensity(v) · useSfxLoop(id, params) · playSfx(id, params)
 *   playStinger(id) · sayLine({ key, vars, voice }) · useSubtitle() · useAudioSettings() · useAudioStatus()
 * The app shell calls `bootAudio()` once. The audio lab (route 'audioLab') auditions everything.
 */
export {
  BUS_IDS,
  OUTPUT_BUSES,
  MUSIC_STATES,
  STEM_LEVELS,
  STEMMED_STATES,
  STINGERS,
  SFX,
  SFX_IDS,
  VOICE_ROLES,
  homeHallState,
  regionalState,
  resolveSfxParams,
  sfxDef,
  sfxVariant,
  voiceRoleOf,
  musicTrackAssetId,
  musicStemAssetId,
  stingerAssetId,
  sfxAssetId,
  voiceRoleAssetId,
  expectedAudioAssetIds,
  isStemmed,
  type BusId,
  type OutputBus,
  type MusicState,
  type MusicRequest,
  type StemLevel,
  type StemmedState,
  type StingerId,
  type SfxId,
  type SfxDef,
  type SfxParams,
  type SfxParamBag,
  type CommonSfxParams,
  type VoiceRole,
} from './catalog';
export {
  DEFAULT_AUDIO_SETTINGS,
  PLACEHOLDER_VOICE_MODES,
  NARRATION_SPEED_RANGE,
  busGain,
  duckGain,
  effectiveGain,
  sliderToGain,
  dbToGain,
  gainToDb,
  mergeAudioSettings,
  parseAudioSettings,
  type AudioSettings,
  type AudioSettingsPatch,
  type PlaceholderVoiceMode,
} from './settings';
export { AudioManager, TICK_MS, type AudioManagerOptions, type AudioStatus, type SfxHandle } from './audioManager';
export { VoiceManager, readingSeconds, ttsParams, pickSystemVoice, type SubtitleLine, type SubtitleEvent, type SayRequest, type VoiceSource, type VoiceManagerOptions } from './voiceManager';
export { AudioAssetSource, audioManifest, loadFinalIndex, parseFinalIndex, voiceLinePath, finalAssetUrl, type AudioAssetInfo, type AudioAssetStatus, type FinalIndex } from './assetSource';
export { HowlerBackend, FinalMixer, type FinalBackend, type FinalSound, type MixedSound } from './finalPlayer';
export { MusicEngine, stemLevels, type MusicSource } from './musicEngine';
export { composeBar, composeSpan, barContext, type NoteEvent } from './composer';
export { MUSIC_STYLES, type MusicStyle } from './styles';
export { STINGER_DEFS, stingerEvents, stingerSeconds } from './stingers';
export { VOICE_PROFILES, syllablePlan } from './voiceTones';
export { buildAudioManifest, AUDIO_GENERATORS, MUSIC_BRIEFS, STINGER_BRIEFS, VOICE_BRIEFS } from './manifestSpec';
export { renderPlaceholder, renderPlaceholderWav, specFromRecipe, AUDIO_PLACEHOLDER_GENERATORS, type PlaceholderSpec, type AudioPlaceholderGenerator } from './render';
export { encodeWav } from './wav';
export {
  configureAudio,
  getAudioManager,
  getVoiceManager,
  playSfx,
  playStinger,
  sayLine,
  useMusicState,
  useMusicIntensity,
  useSfxLoop,
  useAudioStatus,
  useAudioSettings,
  useSubtitle,
  useAudioAutoUnlock,
} from './hooks';
export { cuesForEvents, installSimAudioCues, type AudioCue } from './simCues';
export { connectAudioSettings, patchFromClientSettings, clientAudioFromSettings, NARRATION_SPEED_FACTORS } from './settingsBridge';
export { bootAudio, type BootAudioOptions } from './boot';
export { menuMusic, hubMusic, battleMusic, outcomeMusic, voyageMusic, meadHallMusic, eventMusic } from './screenMusic';
