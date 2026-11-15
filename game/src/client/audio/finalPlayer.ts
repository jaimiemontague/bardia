/**
 * Playback of the owner's FINAL audio files (§28.4 Howler.js, OGG/Opus, music streaming) behind a
 * small interface, so the AudioManager's logic is testable with a fake backend.
 *
 * Bus volumes, ducking and mute-on-blur are applied by `FinalMixer`: each final sound's Howler
 * volume is its own level × the effective gain of its bus (the same `effectiveGain` the WebAudio
 * buses use), re-applied whenever a bus gain changes.
 */
import { Howl } from 'howler';
import type { OutputBus } from './catalog';

/** Options for one final-file playback. */
export interface FinalPlayOptions {
  readonly url: string;
  readonly loop: boolean;
  /** Howler volume 0..1 at start. */
  readonly volume: number;
  readonly rate?: number;
  /** Stereo pan −1..1. */
  readonly pan?: number;
  /** Stream through an HTML5 audio element (long music tracks) instead of decoding up front. */
  readonly stream?: boolean;
}

/** One playing final sound. */
export interface FinalSound {
  /** Sets the Howler volume, fading over `fadeS` seconds when given. */
  setVolume(volume: number, fadeS?: number): void;
  stop(): void;
  readonly ended: boolean;
  /** Called once when playback ends (non-looping) or is stopped. */
  onEnd(cb: () => void): void;
  /** Called if the file fails to load or play (callers fall back to the placeholder). */
  onError(cb: (err: unknown) => void): void;
  /** Duration in seconds once known (0 before load). */
  duration(): number;
}

export interface FinalBackend {
  play(opts: FinalPlayOptions): FinalSound;
}

function formatOf(url: string): string[] | undefined {
  const m = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url);
  return m?.[1] ? [m[1].toLowerCase()] : undefined;
}

/** Howler-backed final playback (one cached Howl per URL and streaming mode). */
export class HowlerBackend implements FinalBackend {
  private readonly howls = new Map<string, Howl>();

  private howl(url: string, stream: boolean): Howl {
    const key = `${stream ? 's' : 'b'}|${url}`;
    let h = this.howls.get(key);
    if (!h) {
      const format = formatOf(url);
      h = new Howl({ src: [url], html5: stream, preload: true, ...(format ? { format } : {}) });
      this.howls.set(key, h);
    }
    return h;
  }

  play(opts: FinalPlayOptions): FinalSound {
    const howl = this.howl(opts.url, opts.stream === true);
    const endCbs: (() => void)[] = [];
    const errCbs: ((e: unknown) => void)[] = [];
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      for (const cb of endCbs.splice(0)) cb();
    };
    const fail = (err: unknown) => {
      for (const cb of errCbs.splice(0)) cb(err);
      finish();
    };
    const id = howl.play();
    let current = opts.volume;
    howl.loop(opts.loop, id);
    howl.volume(opts.volume, id);
    if (opts.rate !== undefined && opts.rate !== 1) howl.rate(opts.rate, id);
    if (opts.pan !== undefined && opts.pan !== 0) howl.stereo(opts.pan, id);
    howl.once('end', () => finish(), id);
    howl.once('stop', () => finish(), id);
    howl.once('loaderror', (_id, err) => fail(err));
    howl.once('playerror', (_id, err) => fail(err), id);
    return {
      setVolume(volume, fadeS) {
        if (ended) return;
        // Howler queues these while the file is still loading.
        if (fadeS && fadeS > 0) howl.fade(current, volume, Math.round(fadeS * 1000), id);
        else howl.volume(volume, id);
        current = volume;
      },
      stop() {
        if (ended) return;
        howl.stop(id);
        finish();
      },
      get ended() {
        return ended;
      },
      onEnd(cb) {
        if (ended) cb();
        else endCbs.push(cb);
      },
      onError(cb) {
        errCbs.push(cb);
      },
      duration() {
        // Howler throws for a per-sound duration while the file is still loading.
        if (howl.state() !== 'loaded') return 0;
        try {
          return howl.duration(id) || howl.duration() || 0;
        } catch {
          return 0;
        }
      },
    };
  }
}

/** A final sound routed to a bus by the mixer. */
export interface MixedSound {
  readonly bus: OutputBus;
  /** Sets the sound's own level (0..1, before the bus gain), fading over `fadeS`. */
  setLevel(level: number, fadeS?: number): void;
  /** Fades out over `fadeS` (default 0) and stops. */
  stop(fadeS?: number): void;
  readonly ended: boolean;
  onEnd(cb: () => void): void;
  onError(cb: (err: unknown) => void): void;
  duration(): number;
}

interface Live {
  sound: FinalSound;
  bus: OutputBus;
  level: number;
}

/** Applies bus gains to final sounds. */
export class FinalMixer {
  private readonly live: Live[] = [];

  constructor(
    private readonly backend: FinalBackend,
    private readonly gainOf: (bus: OutputBus) => number,
  ) {}

  /** Number of final sounds currently playing. */
  get active(): number {
    return this.live.length;
  }

  play(bus: OutputBus, url: string, o: { loop: boolean; level: number; rate?: number; pan?: number; stream?: boolean }): MixedSound {
    const entry: Live = { sound: undefined as unknown as FinalSound, bus, level: clamp01(o.level) };
    const sound = this.backend.play({
      url,
      loop: o.loop,
      volume: entry.level * this.gainOf(bus),
      ...(o.rate !== undefined ? { rate: o.rate } : {}),
      ...(o.pan !== undefined ? { pan: o.pan } : {}),
      ...(o.stream !== undefined ? { stream: o.stream } : {}),
    });
    entry.sound = sound;
    this.live.push(entry);
    sound.onEnd(() => {
      const i = this.live.indexOf(entry);
      if (i >= 0) this.live.splice(i, 1);
    });
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    return {
      bus,
      setLevel: (level, fadeS) => {
        entry.level = clamp01(level);
        sound.setVolume(entry.level * this.gainOf(bus), fadeS);
      },
      stop: (fadeS = 0) => {
        if (sound.ended) return;
        if (fadeS <= 0) return sound.stop();
        entry.level = 0;
        sound.setVolume(0, fadeS);
        if (stopTimer === undefined) stopTimer = setTimeout(() => sound.stop(), Math.round(fadeS * 1000) + 30);
      },
      get ended() {
        return sound.ended;
      },
      onEnd: (cb) => sound.onEnd(cb),
      onError: (cb) => sound.onError(cb),
      duration: () => sound.duration(),
    };
  }

  /** Re-applies bus gains (after a settings, ducking or focus change), fading over `fadeS`. */
  refresh(fadeS = 0.05): void {
    for (const l of this.live) l.sound.setVolume(l.level * this.gainOf(l.bus), fadeS);
  }

  /** Stops every final sound. */
  stopAll(): void {
    for (const l of [...this.live]) l.sound.stop();
    this.live.length = 0;
  }
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}
