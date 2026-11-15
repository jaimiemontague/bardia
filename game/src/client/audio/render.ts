/**
 * Offline rendering of audio placeholders (OfflineAudioContext): the same synth code the live
 * engine uses, rendered to a buffer or a WAV object URL. Registered with the asset library as
 * `AUDIO_PLACEHOLDER_GENERATORS` (generator ids in manifest `placeholder.generator`), so the asset
 * gallery can play any audio id's placeholder and tools can export them.
 */
import { isStemmed, MUSIC_STATES, SFX_IDS, sfxDef, resolveSfxParams, STINGERS, VOICE_ROLES, type MusicState, type SfxId, type StemLevel, type StingerId, type VoiceRole } from './catalog';
import { MusicDeck } from './deck';
import { impulseResponse, noiseSource as seededRandom } from './dsp';
import { AUDIO_GENERATORS, trackLoopSeconds } from './manifestSpec';
import { cachedBuffer } from './samples';
import { SFX_SYNTHS } from './sfxSynth';
import { stingerEvents, stingerPulseSeconds, stingerSeconds, STINGER_DEFS } from './stingers';
import { MUSIC_STYLES } from './styles';
import { playDrum, playInstrumentNote } from './synth';
import { playVoiceTones } from './voiceTones';
import { encodeWav } from './wav';

/** What to render. */
export type PlaceholderSpec =
  | { readonly kind: 'music'; readonly state: MusicState; readonly intensity?: number; readonly seed?: string }
  | { readonly kind: 'stem'; readonly state: MusicState; readonly level: StemLevel; readonly seed?: string }
  | { readonly kind: 'stinger'; readonly id: StingerId }
  | { readonly kind: 'sfx'; readonly id: SfxId; readonly params?: Readonly<Record<string, string | number>> }
  | { readonly kind: 'voice'; readonly role: VoiceRole; readonly text: string; readonly speed?: number };

export interface RenderOptions {
  /** Length to render (default: a sensible length per kind, capped at 60 s). */
  readonly seconds?: number;
  readonly sampleRate?: number;
  /** OfflineAudioContext factory (default: the browser's). */
  readonly createOffline?: (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
}

function defaultOffline(channels: number, length: number, sampleRate: number): OfflineAudioContext {
  const g = globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext };
  const Ctor = g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
  if (!Ctor) throw new Error('OfflineAudioContext is not available');
  return new Ctor(channels, length, sampleRate);
}

/** Default render length of a spec (seconds). */
export function defaultRenderSeconds(spec: PlaceholderSpec): number {
  switch (spec.kind) {
    case 'music':
    case 'stem':
      return Math.min(30, trackLoopSeconds(spec.state));
    case 'stinger':
      return stingerSeconds(STINGER_DEFS[spec.id]) + 2;
    case 'sfx': {
      const def = sfxDef(spec.id);
      return def.loop ? 8 : def.durationS + 0.8;
    }
    case 'voice':
      return 12;
  }
}

/** Renders a placeholder offline. */
export async function renderPlaceholder(spec: PlaceholderSpec, opts: RenderOptions = {}): Promise<AudioBuffer> {
  const sr = opts.sampleRate ?? 44100;
  const seconds = Math.min(60, Math.max(0.2, opts.seconds ?? defaultRenderSeconds(spec)));
  const ctx = (opts.createOffline ?? defaultOffline)(2, Math.ceil(seconds * sr), sr);
  const out = ctx.createGain();
  out.gain.value = 0.85;
  out.connect(ctx.destination);
  const reverb = ctx.createConvolver();
  reverb.buffer = cachedBuffer(ctx, 'ir|render|2.4', (rate) => impulseResponse(rate, 2.4, 'render'));
  const wet = ctx.createGain();
  wet.gain.value = 0.3;
  reverb.connect(wet);
  wet.connect(out);

  switch (spec.kind) {
    case 'music':
    case 'stem': {
      const style = MUSIC_STYLES[spec.state];
      const stem = spec.kind === 'stem' ? spec.level : undefined;
      const deck = new MusicDeck({
        ctx,
        style,
        seed: spec.seed ?? 'bardia',
        out,
        reverb,
        start: 0.02,
        intensity: stem ? 1 : spec.kind === 'music' ? (spec.intensity ?? 0.6) : 0.6,
        level: 1,
        ...(stem ? { layerFilter: (l) => (isStemmed(spec.state) ? l.stem === stem : stem === 'low') } : {}),
      });
      deck.schedule(seconds, 0);
      deck.fade(0, 1.2, Math.max(0, seconds - 1.2));
      break;
    }
    case 'stinger': {
      const def = STINGER_DEFS[spec.id];
      const pulse = stingerPulseSeconds(def);
      const send = ctx.createGain();
      send.gain.value = def.reverb;
      out.connect(send);
      send.connect(reverb);
      for (const n of stingerEvents(spec.id)) {
        const t = 0.02 + n.at * pulse;
        if (n.instrument === 'drums') {
          if (n.hit) playDrum({ ctx, out }, n.hit, t, n.vel);
        } else playInstrumentNote({ ctx, out }, n.instrument, n.midi, t, n.len * pulse * 0.96, n.vel);
      }
      break;
    }
    case 'sfx': {
      const def = sfxDef(spec.id);
      const voice = SFX_SYNTHS[spec.id]({ ctx, out, wet: reverb, rnd: seededRandom(`render|${spec.id}`), rate: 1 }, resolveSfxParams(spec.id, spec.params ?? {}), 0.01);
      voice.advance(seconds);
      if (def.loop) voice.stop(Math.max(0, seconds - 0.8), 0.7);
      break;
    }
    case 'voice': {
      playVoiceTones({ ctx, out, rnd: seededRandom(`render|voice|${spec.role}`), rate: 1 }, spec.role, spec.text, spec.speed ?? 1, 0.05);
      break;
    }
  }
  return ctx.startRendering();
}

/** Renders a placeholder to a WAV Blob. */
export async function renderPlaceholderWav(spec: PlaceholderSpec, opts: RenderOptions = {}): Promise<Blob> {
  const buf = await renderPlaceholder(spec, opts);
  const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  const bytes = encodeWav(chans, buf.sampleRate);
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' });
}

/** Shape of an audio placeholder generator in the asset library (`src/client/assets`). */
export interface AudioPlaceholderGenerator {
  readonly id: string;
  readonly kind: 'audio';
  render(params: Readonly<Record<string, unknown>>, ctx: { durationS?: number; loop?: boolean; label?: string }): Promise<string>;
}

const s = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined);

/** Builds a render spec from a manifest placeholder recipe (undefined when the params do not fit). */
export function specFromRecipe(generator: string, params: Readonly<Record<string, unknown>>, label?: string): PlaceholderSpec | undefined {
  switch (generator) {
    case AUDIO_GENERATORS.music: {
      const state = oneOf(params.state, MUSIC_STATES);
      return state ? { kind: 'music', state } : undefined;
    }
    case AUDIO_GENERATORS.stem: {
      const state = oneOf(params.state, MUSIC_STATES);
      const level = oneOf(params.level, ['low', 'mid', 'high'] as const);
      return state && level ? { kind: 'stem', state, level } : undefined;
    }
    case AUDIO_GENERATORS.stinger: {
      const id = oneOf(params.stinger, STINGERS);
      return id ? { kind: 'stinger', id } : undefined;
    }
    case AUDIO_GENERATORS.sfx: {
      const id = oneOf(params.sfx, SFX_IDS);
      if (!id) return undefined;
      const p: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(params)) if (typeof v === 'string' || typeof v === 'number') p[k] = v;
      return { kind: 'sfx', id, params: p };
    }
    case AUDIO_GENERATORS.voice: {
      const role = oneOf(params.role, VOICE_ROLES) ?? 'npc';
      return { kind: 'voice', role, text: s(params.text) ?? label ?? 'placeholder voice line' };
    }
    default:
      return undefined;
  }
}

/** The audio placeholder generators, keyed by the manifest's generator ids. */
export const AUDIO_PLACEHOLDER_GENERATORS: readonly AudioPlaceholderGenerator[] = Object.values(AUDIO_GENERATORS).map((id) => ({
  id,
  kind: 'audio' as const,
  async render(params, ctx) {
    const spec = specFromRecipe(id, params, ctx.label);
    if (!spec) throw new Error(`audio placeholder '${id}': unsupported params`);
    const seconds = ctx.durationS !== undefined ? Math.min(30, ctx.durationS + (ctx.loop ? 0 : 0.8)) : undefined;
    const blob = await renderPlaceholderWav(spec, seconds !== undefined ? { seconds } : {});
    return URL.createObjectURL(blob);
  },
}));
