/**
 * The AudioManager (§28.4): five volume buses (master, music, SFX, ambience, voice), ducking under
 * voice, mute-on-blur, autoplay-policy unlock on the first user gesture, the adaptive music engine,
 * sound effects and the hooks the VoiceManager uses.
 *
 * Final files (Howler) and procedural placeholders (WebAudio) share one bus model: WebAudio buses
 * are GainNodes set to `effectiveGain(settings, bus, conditions)`; final sounds get the same number
 * as their Howler volume through `FinalMixer`.
 *
 *   const audio = getAudioManager();
 *   audio.installAutoUnlock();                 // first click/key starts the AudioContext
 *   const token = audio.pushMusic('homeSkarn'); // a screen's music; popMusic(token) on leave
 *   audio.playSfx('ui.coin');
 *   audio.playSfx('sea.waves', { wind: 'gale' }).stop(2);
 */
import { BUS_IDS, OUTPUT_BUSES, sfxAssetId, sfxDef, sfxVariant, resolveSfxParams, type MusicRequest, type MusicState, type OutputBus, type SfxId, type SfxParamBag, type SfxParams, type StingerId, type VoiceRole } from './catalog';
import { AudioAssetSource, audioManifest, loadFinalIndex, type FinalIndex } from './assetSource';
import { impulseResponse, noiseSource as seededRandom } from './dsp';
import { FinalMixer, HowlerBackend, type FinalBackend, type MixedSound } from './finalPlayer';
import { MusicEngine, LOOKAHEAD_HIDDEN_S, LOOKAHEAD_S, type MusicSource } from './musicEngine';
import { cachedBuffer } from './samples';
import {
  DEFAULT_AUDIO_SETTINGS,
  DUCK_ATTACK_S,
  DUCK_RELEASE_S,
  effectiveGain,
  loadAudioSettings,
  mergeAudioSettings,
  saveAudioSettings,
  type AudioSettings,
  type AudioSettingsPatch,
} from './settings';
import type { SfxEnv, SfxVoice } from './sfxKit';
import { SFX_SYNTHS } from './sfxSynth';
import { playVoiceTones } from './voiceTones';

/** Reverb per bus: impulse length (s) and wet return level. Voice stays dry. */
const REVERBS: Readonly<Partial<Record<OutputBus, { seconds: number; wet: number; seed: string }>>> = {
  music: { seconds: 2.8, wet: 0.32, seed: 'hall' },
  sfx: { seconds: 1.3, wet: 0.25, seed: 'room' },
  ambience: { seconds: 2.2, wet: 0.3, seed: 'open' },
};

/** Ticker interval (ms) for music scheduling and SFX loops. */
export const TICK_MS = 25;

/** Handle of a playing sound effect. */
export interface SfxHandle {
  readonly id: SfxId;
  /** Fades out over `fadeS` seconds (default 0.12) and stops. */
  stop(fadeS?: number): void;
  /** Changes the sound's own volume (0..1). */
  setVolume(volume: number, fadeS?: number): void;
  /** True until the sound ends or is stopped. */
  readonly playing: boolean;
  /** 'final', 'placeholder', or 'pending' (a loop waiting for the audio unlock) / 'dropped'. */
  readonly source: 'final' | 'placeholder' | 'pending' | 'dropped';
}

/** A snapshot of the audio system for UI (stable object between changes). */
export interface AudioStatus {
  readonly supported: boolean;
  readonly unlocked: boolean;
  readonly blurred: boolean;
  readonly voiceActive: boolean;
  readonly settings: AudioSettings;
  readonly music: { readonly requested: MusicRequest; readonly state: MusicState | undefined; readonly source: MusicSource; readonly intensity: number };
  readonly activeSfx: number;
  readonly finalFiles: number;
}

/** A minimal event target (window / document) for focus and visibility tracking. */
interface EventSourceLike {
  addEventListener(type: string, cb: (e: Event) => void, opts?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, cb: (e: Event) => void, opts?: boolean | EventListenerOptions): void;
}

export interface AudioManagerOptions {
  /** Creates the AudioContext (default: the browser's; undefined where unsupported). */
  createContext?: () => AudioContext | undefined;
  /** Final-file playback (default Howler; null disables final files). */
  finalBackend?: FinalBackend | null;
  /** Asset resolution (default: the manifest; the final index loads asynchronously). */
  assets?: AudioAssetSource;
  /** Loads the final-file index (default: fetch public/assets/final-index.json). */
  loadIndex?: (() => Promise<FinalIndex>) | null;
  /** Settings persistence (default localStorage; null: in-memory only). */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Window/document for focus and visibility (defaults: the globals when present). */
  window?: EventSourceLike | null;
  document?: (EventSourceLike & { hidden?: boolean; hasFocus?: () => boolean }) | null;
  /** Composer seed (same seed → same music). */
  seed?: string;
  /** Start the scheduling interval automatically after unlock (tests drive `tick()` by hand). */
  autoTick?: boolean;
}

interface ActiveSfx {
  id: SfxId;
  bus: OutputBus;
  voice?: SfxVoice;
  final?: MixedSound;
  gain?: GainNode;
  ended: boolean;
  handle: SfxHandle;
}

interface PendingLoop {
  id: SfxId;
  params: SfxParamBag;
  handle: MutableHandle;
}

interface MutableHandle extends SfxHandle {
  bind(target: { stop(fadeS?: number): void; setVolume(v: number, fadeS?: number): void; playing(): boolean; source: 'final' | 'placeholder' }): void;
}

function defaultContextFactory(): AudioContext | undefined {
  const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) return undefined;
  try {
    return new Ctor({ latencyHint: 'interactive' });
  } catch {
    return undefined;
  }
}

function clamp(v: unknown, lo: number, hi: number, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
}

function makeHandle(id: SfxId, initial: 'pending' | 'dropped'): MutableHandle {
  let target: Parameters<MutableHandle['bind']>[0] | undefined;
  let stopped = false;
  let volume: number | undefined;
  return {
    id,
    bind(t) {
      target = t;
      if (stopped) t.stop(0);
      else if (volume !== undefined) t.setVolume(volume);
    },
    stop(fadeS) {
      stopped = true;
      target?.stop(fadeS);
    },
    setVolume(v, fadeS) {
      volume = v;
      target?.setVolume(v, fadeS);
    },
    get playing() {
      return target ? target.playing() : !stopped && initial === 'pending';
    },
    get source() {
      return target ? target.source : initial;
    },
  };
}

export class AudioManager {
  private settingsValue: AudioSettings;
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private readonly buses: Partial<Record<OutputBus, GainNode>> = {};
  private readonly reverbs: Partial<Record<OutputBus, ConvolverNode>> = {};
  private engine: MusicEngine | undefined;
  private mixer: FinalMixer | undefined;
  private readonly backend: FinalBackend | null;
  readonly assets: AudioAssetSource;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  private readonly createContext: () => AudioContext | undefined;
  private readonly win: EventSourceLike | null;
  private readonly doc: (EventSourceLike & { hidden?: boolean; hasFocus?: () => boolean }) | null;
  private readonly autoTick: boolean;
  private readonly seed: string;
  private timer: ReturnType<typeof setInterval> | undefined;
  private suspendTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly active: ActiveSfx[] = [];
  private readonly pendingLoops: PendingLoop[] = [];
  private readonly musicStack: { token: number; req: MusicRequest }[] = [];
  private baseMusic: MusicRequest = 'silence';
  private nextToken = 1;
  private intensity = 0.5;
  private voiceCount = 0;
  private focused = true;
  private hiddenPage = false;
  private sfxCounter = 0;
  private everRan = false;
  private unlocking: Promise<boolean> | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly cleanups: (() => void)[] = [];
  private snapshot: AudioStatus;
  private disposed = false;

  constructor(opts: AudioManagerOptions = {}) {
    this.storage = opts.storage === undefined ? safeStorage() : opts.storage;
    this.settingsValue = this.storage ? loadAudioSettings(this.storage) : mergeAudioSettings(DEFAULT_AUDIO_SETTINGS, {});
    this.createContext = opts.createContext ?? defaultContextFactory;
    this.backend = opts.finalBackend === undefined ? new HowlerBackend() : opts.finalBackend;
    this.assets = opts.assets ?? new AudioAssetSource(audioManifest().entries);
    this.win = opts.window === undefined ? ((globalThis as { window?: EventSourceLike }).window ?? null) : opts.window;
    this.doc = opts.document === undefined ? ((globalThis as { document?: AudioManagerOptions['document'] }).document ?? null) : opts.document;
    this.autoTick = opts.autoTick ?? true;
    this.seed = opts.seed ?? 'bardia';
    this.hiddenPage = this.doc?.hidden === true;
    try {
      this.focused = this.doc?.hasFocus ? this.doc.hasFocus() : true;
    } catch {
      this.focused = true;
    }
    this.installFocusTracking();
    this.snapshot = this.buildSnapshot();
    const loader = opts.loadIndex === undefined ? () => loadFinalIndex() : opts.loadIndex;
    if (loader) {
      void loader()
        .then((index) => {
          if (this.disposed) return;
          this.assets.setIndex(index);
          this.emit();
        })
        .catch(() => undefined);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Status and subscription

  /** Subscribes to status changes (React: useSyncExternalStore). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The current status (same object until something changes). */
  getStatus(): AudioStatus {
    return this.snapshot;
  }

  private buildSnapshot(): AudioStatus {
    const m = this.engine?.status;
    return {
      supported: this.ctx !== undefined || this.createContextSupported(),
      unlocked: this.ctx?.state === 'running',
      blurred: this.blurred,
      voiceActive: this.voiceCount > 0,
      settings: this.settingsValue,
      music: { requested: this.effectiveMusicRequest(), state: m?.state, source: m?.source ?? 'none', intensity: this.intensity },
      activeSfx: this.active.length,
      finalFiles: this.assets.finalCount,
    };
  }

  private createContextSupported(): boolean {
    const g = globalThis as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown };
    return this.createContext !== defaultContextFactory || g.AudioContext !== undefined || g.webkitAudioContext !== undefined;
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const l of [...this.listeners]) l();
  }

  // -------------------------------------------------------------------------------------------
  // Settings

  get settings(): AudioSettings {
    return this.settingsValue;
  }

  /** Applies a settings patch (persisted) and updates every bus. */
  setSettings(patch: AudioSettingsPatch): void {
    const next = mergeAudioSettings(this.settingsValue, patch);
    if (JSON.stringify(next) === JSON.stringify(this.settingsValue)) return;
    this.settingsValue = next;
    if (this.storage) saveAudioSettings(next, this.storage);
    this.applyGains(0.03);
    this.updateSuspension();
    this.emit();
  }

  /** The gain a sound on `bus` gets right now (bus math incl. ducking and blur). */
  busGain(bus: OutputBus): number {
    return effectiveGain(this.settingsValue, bus, { voiceActive: this.voiceCount > 0, blurred: this.blurred });
  }

  private get blurred(): boolean {
    return this.hiddenPage || !this.focused;
  }

  private applyGains(timeConstantS: number, mixerFadeS = timeConstantS * 3): void {
    const ctx = this.ctx;
    if (ctx) {
      const now = ctx.currentTime;
      for (const bus of OUTPUT_BUSES) {
        const g = this.buses[bus];
        if (!g) continue;
        g.gain.cancelScheduledValues(now);
        g.gain.setTargetAtTime(this.busGain(bus), now, Math.max(0.005, timeConstantS));
      }
    }
    this.mixer?.refresh(mixerFadeS);
  }

  // -------------------------------------------------------------------------------------------
  // Unlock and graph

  /** True once the AudioContext is running. */
  get unlocked(): boolean {
    return this.ctx?.state === 'running';
  }

  /** The AudioContext (after unlock), for the audio lab and placeholder renders. */
  get context(): AudioContext | undefined {
    return this.ctx;
  }

  /**
   * Creates/resumes the AudioContext. Browsers only allow this during a user gesture (autoplay
   * policy), so call it from a click/key handler or use `installAutoUnlock`. Resolves true when
   * audio is running.
   */
  unlock(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.unlocked) return Promise.resolve(true);
    if (this.unlocking) return this.unlocking;
    if (!this.ctx) {
      this.ctx = this.createContext();
      if (!this.ctx) return Promise.resolve(false);
      this.buildGraph(this.ctx);
      this.ctx.addEventListener?.('statechange', () => this.emit());
    }
    const ctx = this.ctx;
    this.unlocking = Promise.resolve()
      .then(() => (ctx.state === 'running' ? undefined : ctx.resume()))
      .then(() => {
        this.unlocking = undefined;
        if (ctx.state !== 'running') {
          this.emit();
          return false;
        }
        this.onRunning();
        return true;
      })
      .catch(() => {
        this.unlocking = undefined;
        this.emit();
        return false;
      });
    return this.unlocking;
  }

  /**
   * Unlocks on the first pointer/key/touch gesture (capture phase, so the gesture's own click sound
   * already plays). Returns the uninstall function.
   */
  installAutoUnlock(target: EventSourceLike | null = this.win): () => void {
    if (!target) return () => {};
    const types = ['pointerdown', 'mousedown', 'keydown', 'touchend'];
    const handler = () => {
      void this.unlock().then((ok) => {
        if (ok) off();
      });
    };
    const off = () => {
      for (const t of types) target.removeEventListener(t, handler, true);
    };
    for (const t of types) target.addEventListener(t, handler, true);
    this.cleanups.push(off);
    return off;
  }

  private buildGraph(ctx: AudioContext): void {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(limiter);
    for (const bus of OUTPUT_BUSES) {
      const g = ctx.createGain();
      g.gain.value = this.busGain(bus);
      g.connect(this.master);
      this.buses[bus] = g;
      const rv = REVERBS[bus];
      if (rv) {
        const conv = ctx.createConvolver();
        conv.buffer = cachedBuffer(ctx, `ir|${rv.seed}|${rv.seconds}`, (sr) => impulseResponse(sr, rv.seconds, rv.seed));
        const wet = ctx.createGain();
        wet.gain.value = rv.wet;
        conv.connect(wet);
        wet.connect(g);
        this.reverbs[bus] = conv;
      }
    }
    if (this.backend) this.mixer = new FinalMixer(this.backend, (bus) => this.busGain(bus));
    const musicBus = this.buses.music as GainNode;
    this.engine = new MusicEngine(
      {
        ctx,
        bus: musicBus,
        reverb: this.reverbs.music,
        finalUrl: (id) => this.finalUrl(id),
        playFinal: (url, o) => this.mixer?.play('music', url, o),
        hidden: () => this.hiddenPage,
      },
      this.seed,
    );
    this.engine.setIntensity(this.intensity);
  }

  private onRunning(): void {
    this.everRan = true;
    if (this.autoTick && this.timer === undefined) this.timer = setInterval(() => this.tick(), TICK_MS);
    this.applyGains(0.01);
    this.syncMusic();
    for (const p of this.pendingLoops.splice(0)) {
      if (p.handle.playing) this.startSfx(p.id, p.params, p.handle);
    }
    this.emit();
  }

  /** Scheduler step: music lookahead, SFX loop events, cleanup. Runs every TICK_MS after unlock. */
  tick(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.engine?.tick();
    const now = ctx.currentTime;
    const until = now + (this.hiddenPage ? LOOKAHEAD_HIDDEN_S : LOOKAHEAD_S);
    let changed = false;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i] as ActiveSfx;
      if (a.voice) {
        a.voice.advance(until);
        if (now > a.voice.endsAt) a.ended = true;
      }
      if (a.final?.ended) a.ended = true;
      if (a.ended) {
        try {
          a.gain?.disconnect();
        } catch {
          /* already disconnected */
        }
        this.active.splice(i, 1);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  // -------------------------------------------------------------------------------------------
  // Focus / visibility

  private installFocusTracking(): void {
    const onVis = () => {
      this.hiddenPage = this.doc?.hidden === true;
      this.onFocusChange();
    };
    const onBlur = () => {
      this.focused = false;
      this.onFocusChange();
    };
    const onFocus = () => {
      this.focused = true;
      this.onFocusChange();
    };
    if (this.doc) {
      this.doc.addEventListener('visibilitychange', onVis);
      this.cleanups.push(() => this.doc?.removeEventListener('visibilitychange', onVis));
    }
    if (this.win) {
      this.win.addEventListener('blur', onBlur);
      this.win.addEventListener('focus', onFocus);
      this.cleanups.push(() => {
        this.win?.removeEventListener('blur', onBlur);
        this.win?.removeEventListener('focus', onFocus);
      });
    }
  }

  /** Tells the manager the window lost/regained focus or visibility (tests; normally automatic). */
  setFocusState(state: { focused?: boolean; hidden?: boolean }): void {
    if (state.focused !== undefined) this.focused = state.focused;
    if (state.hidden !== undefined) this.hiddenPage = state.hidden;
    this.onFocusChange();
  }

  private onFocusChange(): void {
    this.applyGains(0.05);
    this.updateSuspension();
    this.emit();
  }

  /** Suspends the context shortly after a muted blur (saves CPU); resumes on focus. */
  private updateSuspension(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const shouldSuspend = this.blurred && this.settingsValue.muteOnBlur;
    if (this.suspendTimer !== undefined) {
      clearTimeout(this.suspendTimer);
      this.suspendTimer = undefined;
    }
    if (shouldSuspend && ctx.state === 'running') {
      this.suspendTimer = setTimeout(() => {
        this.suspendTimer = undefined;
        if (this.blurred && this.settingsValue.muteOnBlur && ctx.state === 'running') void ctx.suspend?.().then(() => this.emit()).catch(() => undefined);
      }, 400);
    } else if (!shouldSuspend && ctx.state === 'suspended' && this.everRan && this.unlocking === undefined) {
      // Resuming after our own suspend needs no gesture (the page already has user activation).
      void ctx.resume().then(() => this.emit()).catch(() => undefined);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Music

  /** URL of an asset's final file, when present. */
  finalUrl(id: string): string | undefined {
    const r = this.assets.resolve(id);
    return r.status === 'final' ? r.url : undefined;
  }

  /** Sets the base music (bottom of the request stack: the scene's music). */
  setMusic(req: MusicRequest): void {
    this.baseMusic = req;
    this.syncMusic();
  }

  /** Pushes a music request on top (overlay screens, battles); returns the token for `popMusic`. */
  pushMusic(req: MusicRequest): number {
    const token = this.nextToken++;
    this.musicStack.push({ token, req });
    this.syncMusic();
    return token;
  }

  /** Changes a pushed request in place. */
  updateMusic(token: number, req: MusicRequest): void {
    const e = this.musicStack.find((m) => m.token === token);
    if (!e || e.req === req) return;
    e.req = req;
    this.syncMusic();
  }

  /** Removes a pushed request; the next one down (or the base) plays. */
  popMusic(token: number): void {
    const i = this.musicStack.findIndex((m) => m.token === token);
    if (i < 0) return;
    this.musicStack.splice(i, 1);
    this.syncMusic();
  }

  /** The request that wins: the most recent push, else the base. */
  effectiveMusicRequest(): MusicRequest {
    return this.musicStack[this.musicStack.length - 1]?.req ?? this.baseMusic;
  }

  private syncMusic(): void {
    if (this.engine && this.unlocked) this.engine.setState(this.effectiveMusicRequest());
    this.emit();
  }

  /** Restarts the current state from bar 0 (audio lab). */
  restartMusic(): void {
    const req = this.effectiveMusicRequest();
    if (this.engine && this.unlocked && req !== 'silence') this.engine.setState(req, { restart: true, crossfadeS: 0.6 });
    this.emit();
  }

  /** Sets the music intensity 0..1 (battle stems, drum grooves). */
  setIntensity(v: number): void {
    const next = clamp(v, 0, 1, this.intensity);
    if (next === this.intensity) return;
    this.intensity = next;
    this.engine?.setIntensity(next);
    this.emit();
  }

  /** Plays a stinger over the music (§28.1 omens, births, deaths). */
  playStinger(id: StingerId): void {
    if (!this.engine || !this.unlocked) return;
    this.engine.stinger(id);
  }

  /** The music engine (lab visualisation). */
  get music(): MusicEngine | undefined {
    return this.engine;
  }

  // -------------------------------------------------------------------------------------------
  // Sound effects

  /** Plays a sound effect by catalog id with typed parameters. */
  playSfx<I extends SfxId>(id: I, params?: SfxParams<I>): SfxHandle {
    const bag = (params ?? {}) as SfxParamBag;
    const def = sfxDef(id);
    if (!this.ctx || !this.unlocked) {
      // Autoplay policy: one-shots before the first gesture are dropped; loops start on unlock.
      const h = makeHandle(id, def.loop ? 'pending' : 'dropped');
      if (def.loop) this.pendingLoops.push({ id, params: bag, handle: h });
      return h;
    }
    const h = makeHandle(id, 'pending');
    this.startSfx(id, bag, h);
    return h;
  }

  /** Stops every playing instance of an id. */
  stopSfx(id: SfxId, fadeS = 0.12): void {
    for (const a of this.active) if (a.id === id) a.handle.stop(fadeS);
    for (const p of this.pendingLoops) if (p.id === id) p.handle.stop(0);
  }

  /** Stops every sound effect (music and voice continue). */
  stopAllSfx(fadeS = 0.12): void {
    for (const a of [...this.active]) a.handle.stop(fadeS);
    for (const p of this.pendingLoops.splice(0)) p.handle.stop(0);
  }

  private startSfx(id: SfxId, bag: SfxParamBag, handle: MutableHandle): void {
    const ctx = this.ctx;
    const bus = this.buses[sfxDef(id).bus];
    if (!ctx || !bus) return;
    const def = sfxDef(id);
    const volume = clamp(bag.volume, 0, 1, 1);
    const pan = clamp(bag.pan, -1, 1, 0);
    const rate = clamp(bag.rate, 0.25, 4, 1);
    // Voice limit: stop the oldest instances beyond maxVoices.
    const same = this.active.filter((a) => a.id === id && !a.ended);
    for (let i = 0; i <= same.length - def.maxVoices; i++) same[i]?.handle.stop(0.05);

    const entry: ActiveSfx = { id, bus: def.bus, ended: false, handle };
    const url = this.finalUrl(sfxAssetId(id, sfxVariant(id, bag)));
    const final = url && this.mixer ? this.mixer.play(def.bus, url, { loop: def.loop, level: volume, rate, pan }) : undefined;
    if (final) {
      entry.final = final;
      final.onError(() => {
        // The file failed to load: play the placeholder instead.
        if (entry.ended) return;
        entry.ended = true;
        this.startPlaceholderSfx(id, bag, handle, volume, pan, rate);
      });
      handle.bind({
        stop: (f) => {
          entry.ended = true;
          final.stop(f ?? 0.12);
        },
        setVolume: (v, f) => final.setLevel(clamp(v, 0, 1, 1), f),
        playing: () => !entry.ended && !final.ended,
        source: 'final',
      });
      this.active.push(entry);
      this.emit();
      return;
    }
    this.startPlaceholderSfx(id, bag, handle, volume, pan, rate);
  }

  private startPlaceholderSfx(id: SfxId, bag: SfxParamBag, handle: MutableHandle, volume: number, pan: number, rate: number): void {
    const ctx = this.ctx;
    const def = sfxDef(id);
    const bus = this.buses[def.bus];
    if (!ctx || !bus) return;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      gain.connect(p);
      p.connect(bus);
    } else gain.connect(bus);
    const env: SfxEnv = { ctx, out: gain, wet: this.reverbs[def.bus], rnd: seededRandom(`${this.seed}|${id}|${this.sfxCounter++}`), rate };
    const now = ctx.currentTime;
    const voice = SFX_SYNTHS[id](env, resolveSfxParams(id, bag), now + 0.005);
    voice.advance(now + LOOKAHEAD_S);
    const entry: ActiveSfx = { id, bus: def.bus, voice, gain, ended: false, handle };
    handle.bind({
      stop: (f) => {
        if (entry.ended) return;
        voice.stop(ctx.currentTime, f ?? 0.12);
      },
      setVolume: (v, f) => {
        const t = ctx.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setTargetAtTime(clamp(v, 0, 1, 1), t, Math.max(0.005, (f ?? 0.05) / 3));
      },
      playing: () => !entry.ended && ctx.currentTime <= voice.endsAt,
      source: 'placeholder',
    });
    this.active.push(entry);
    this.emit();
  }

  /** Number of sound effects playing per id (lab). */
  activeSfxCount(id?: SfxId): number {
    return id === undefined ? this.active.length : this.active.filter((a) => a.id === id && !a.ended).length;
  }

  // -------------------------------------------------------------------------------------------
  // Voice support (used by VoiceManager)

  /** Marks a voice line as playing (ducks music/ambience/SFX while any line plays). */
  beginVoice(): void {
    this.voiceCount++;
    if (this.voiceCount === 1) {
      this.applyGains(DUCK_ATTACK_S / 3, DUCK_ATTACK_S);
      this.emit();
    }
  }

  /** Marks a voice line as finished. */
  endVoice(): void {
    if (this.voiceCount === 0) return;
    this.voiceCount--;
    if (this.voiceCount === 0) {
      this.applyGains(DUCK_RELEASE_S / 3, DUCK_RELEASE_S);
      this.emit();
    }
  }

  /** Plays a final voice-over file on the voice bus (undefined if audio is locked/unavailable). */
  playVoiceFile(url: string): MixedSound | undefined {
    if (!this.unlocked || !this.mixer) return undefined;
    return this.mixer.play('voice', url, { loop: false, level: 1 });
  }

  /** Plays the tone-coded placeholder murmur for a line on the voice bus. */
  playVoiceTones(role: VoiceRole, text: string, speed: number): { stop(): void; durationS: number } | undefined {
    const ctx = this.ctx;
    const bus = this.buses.voice;
    if (!ctx || !bus || !this.unlocked) return undefined;
    const env: SfxEnv = { ctx, out: bus, rnd: seededRandom(`${this.seed}|voice|${role}|${this.sfxCounter++}`), rate: 1 };
    const { voice, durationS } = playVoiceTones(env, role, text, speed, ctx.currentTime + 0.02);
    return { stop: () => voice.stop(ctx.currentTime, 0.08), durationS };
  }

  // -------------------------------------------------------------------------------------------

  /** Stops all audio, closes the context and removes listeners. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    if (this.suspendTimer !== undefined) clearTimeout(this.suspendTimer);
    this.timer = undefined;
    this.engine?.stopAll();
    this.mixer?.stopAll();
    for (const a of this.active) a.handle.stop(0);
    this.active.length = 0;
    for (const c of this.cleanups.splice(0)) c();
    void this.ctx?.close?.().catch(() => undefined);
    this.listeners.clear();
  }

  /** Bus ids (for settings UIs). */
  static readonly BUS_IDS = BUS_IDS;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
