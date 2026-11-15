/**
 * Voice-over (§26.6, §28.3, §28.5). `say({ key, vars, voice })` queues a narration line:
 *
 *   1. the owner's final VO file for that locale key, when present (manifest `voice` entry with this
 *      `lineKey`, or `voice/<role>/<key>.ogg` listed in the final index);
 *   2. otherwise a placeholder — off by default; when enabled in settings either the browser's Web
 *      Speech TTS (rate/pitch per voice role, always flagged as a placeholder voice) or the
 *      tone-coded murmur;
 *   3. otherwise silence, timed for reading.
 *
 * Whatever plays, a subtitle event is emitted for the UI (§26.6 "subtitles are always on by
 * default"), and voice playback ducks the other buses through the AudioManager.
 */
import type { TextVars } from '@sim/core/state';
import { voiceRoleOf, type VoiceRole } from './catalog';
import type { AudioManager } from './audioManager';
import { VOICE_PROFILES } from './voiceTones';

/** How a subtitle line is being voiced. */
export type VoiceSource = 'final' | 'tts' | 'tones' | 'silent';

/** A subtitle line (one narration line being presented). */
export interface SubtitleLine {
  /** Increasing id. */
  readonly id: number;
  readonly key: string;
  readonly vars: TextVars;
  /** The sim's voice id as given (open union). */
  readonly voice: string;
  /** The voice role it maps to. */
  readonly role: VoiceRole;
  /** Formatted text. */
  readonly text: string;
  readonly source: VoiceSource;
  /** True when a placeholder voice (TTS or tones) speaks it — the UI must label it. */
  readonly placeholder: boolean;
  /** Expected length in seconds (for subtitle timing). */
  readonly durationS: number;
}

export type SubtitleEvent = { readonly type: 'start'; readonly line: SubtitleLine } | { readonly type: 'end'; readonly line: SubtitleLine; readonly skipped: boolean };

/** A line request. */
export interface SayRequest {
  readonly key: string;
  readonly vars?: TextVars;
  /** Sim voice id (narrator, skald, hirdmaster, steward, seer, or any other → npc). */
  readonly voice?: string;
  /** Interrupt the current line and clear the queue instead of queueing. */
  readonly interrupt?: boolean;
}

/** The subset of the Web Speech API the manager uses. */
export interface SpeechLike {
  speak(u: SpeechSynthesisUtterance): void;
  cancel(): void;
  getVoices(): SpeechSynthesisVoice[];
}

export interface VoiceManagerOptions {
  /** Formats a locale key (default: the client i18n `t`). */
  format: (key: string, vars: TextVars) => string;
  /** Web Speech (default: window.speechSynthesis when present; null disables TTS). */
  speech?: SpeechLike | null;
  /** Creates an utterance (default: `new SpeechSynthesisUtterance`). */
  createUtterance?: ((text: string) => SpeechSynthesisUtterance) | null;
  /** Timer functions (tests use fakes). */
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Most lines kept waiting; older queued lines are dropped beyond it. */
  maxQueue?: number;
}

/** Reading time of a line at a narration speed: ~2.6 words/s plus a beat, at least 2 s. */
export function readingSeconds(text: string, speed = 1): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2, (words / 2.6 + 1.1) / Math.max(0.25, speed));
}

/** TTS rate and pitch for a role at a narration speed (Web Speech ranges: rate 0.1..10, pitch 0..2). */
export function ttsParams(role: VoiceRole, speed = 1): { rate: number; pitch: number } {
  const p = VOICE_PROFILES[role];
  return { rate: Math.min(10, Math.max(0.1, p.ttsRate * speed)), pitch: Math.min(2, Math.max(0, p.ttsPitch)) };
}

const ROLE_ORDER: readonly VoiceRole[] = ['narrator', 'skald', 'hirdmaster', 'steward', 'seer', 'rival', 'npc'];

/** Picks a system voice for a role (English voices first; deterministic spread over roles). */
export function pickSystemVoice(voices: readonly SpeechSynthesisVoice[], role: VoiceRole): SpeechSynthesisVoice | undefined {
  const english = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  const pool = english.length > 0 ? english : voices;
  if (pool.length === 0) return undefined;
  const sorted = [...pool].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return sorted[ROLE_ORDER.indexOf(role) % sorted.length];
}

interface Queued {
  req: SayRequest;
  id: number;
}

export class VoiceManager {
  private readonly queue: Queued[] = [];
  private current: { line: SubtitleLine; cancel: () => void } | undefined;
  private readonly listeners = new Set<(e: SubtitleEvent) => void>();
  private nextId = 1;
  private readonly speech: SpeechLike | null;
  private readonly createUtterance: ((text: string) => SpeechSynthesisUtterance) | null;
  private readonly setTimer: (cb: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;
  private readonly maxQueue: number;

  constructor(
    private readonly audio: AudioManager,
    private readonly opts: VoiceManagerOptions,
  ) {
    const g = globalThis as unknown as { speechSynthesis?: SpeechLike; SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtterance };
    this.speech = opts.speech === undefined ? (g.speechSynthesis ?? null) : opts.speech;
    const Utter = g.SpeechSynthesisUtterance;
    this.createUtterance = opts.createUtterance === undefined ? (Utter ? (text: string) => new Utter(text) : null) : opts.createUtterance;
    this.setTimer = opts.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.maxQueue = opts.maxQueue ?? 8;
  }

  /** Whether the browser offers TTS (the settings UI disables the TTS option otherwise). */
  get ttsAvailable(): boolean {
    return this.speech !== null && this.createUtterance !== null;
  }

  /** Subscribes to subtitle start/end events. */
  onSubtitle(listener: (e: SubtitleEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The line being presented, if any. */
  get currentLine(): SubtitleLine | undefined {
    return this.current?.line;
  }

  /** Lines waiting. */
  get queued(): number {
    return this.queue.length;
  }

  /** Queues (or, with `interrupt`, immediately presents) a narration line. Returns its subtitle id (dropped if the queue overflows). */
  say(req: SayRequest): number {
    const id = this.nextId++;
    if (req.interrupt) {
      this.queue.length = 0;
      this.queue.push({ req, id });
      this.finishCurrent(true);
      return id;
    }
    this.queue.push({ req, id });
    while (this.queue.length > this.maxQueue) this.queue.shift();
    if (!this.current) this.next();
    return id;
  }

  /** Skips the current line (the next queued one starts). */
  skip(): void {
    this.finishCurrent(true);
  }

  /** Stops the current line and clears the queue. */
  stopAll(): void {
    this.queue.length = 0;
    this.finishCurrent(true);
  }

  private emit(e: SubtitleEvent): void {
    for (const l of [...this.listeners]) {
      try {
        l(e);
      } catch (err) {
        console.error('[voice] subtitle listener failed', err);
      }
    }
  }

  private finishCurrent(skipped: boolean): void {
    const cur = this.current;
    if (!cur) {
      if (this.queue.length > 0) this.next();
      return;
    }
    this.current = undefined;
    cur.cancel();
    this.emit({ type: 'end', line: cur.line, skipped });
    this.next();
  }

  private next(): void {
    if (this.current) return;
    const q = this.queue.shift();
    if (!q) return;
    this.present(q.req, q.id);
  }

  private present(req: SayRequest, id: number): void {
    const settings = this.audio.settings;
    const role = voiceRoleOf(req.voice);
    const vars = req.vars ?? {};
    const text = this.opts.format(req.key, vars);
    const speed = settings.narrationSpeed;
    const base = { id, key: req.key, vars, voice: req.voice ?? role, role, text };
    const voiceOn = settings.narration && !settings.muted;

    // 1. Final VO file.
    const asset = voiceOn ? this.audio.assets.voiceLine(req.key, role) : undefined;
    if (asset?.status === 'final' && asset.url) {
      const sound = this.audio.playVoiceFile(asset.url);
      if (sound) {
        const line: SubtitleLine = { ...base, source: 'final', placeholder: false, durationS: sound.duration() || readingSeconds(text, speed) };
        this.audio.beginVoice();
        let done = false;
        const watchdog = this.setTimer(() => end(false), (readingSeconds(text, speed) * 3 + 10) * 1000);
        const end = (skipped: boolean) => {
          if (done) return;
          done = true;
          this.clearTimer(watchdog);
          this.audio.endVoice();
          if (this.current?.line === line) {
            this.current = undefined;
            this.emit({ type: 'end', line, skipped });
            this.next();
          }
        };
        this.current = {
          line,
          cancel: () => {
            if (done) return;
            done = true;
            this.clearTimer(watchdog);
            sound.stop(0.15);
            this.audio.endVoice();
          },
        };
        sound.onEnd(() => end(false));
        this.emit({ type: 'start', line });
        return;
      }
    }

    // 2a. Placeholder TTS (opt-in, clearly labelled).
    if (voiceOn && settings.placeholderVoice === 'tts' && this.speech && this.createUtterance) {
      const u = this.createUtterance(text);
      const { rate, pitch } = ttsParams(role, speed);
      u.rate = rate;
      u.pitch = pitch;
      u.volume = Math.min(1, this.audio.busGain('voice'));
      u.lang = 'en';
      const sys = pickSystemVoice(this.speech.getVoices(), role);
      if (sys) u.voice = sys;
      const est = readingSeconds(text, speed) / Math.max(0.5, rate);
      const line: SubtitleLine = { ...base, source: 'tts', placeholder: true, durationS: est };
      this.startTimed(line, est * 2 + 4, () => this.speech?.cancel(), (finish) => {
        u.onend = () => finish();
        u.onerror = () => finish();
        this.speech?.speak(u);
      });
      return;
    }

    // 2b. Placeholder tone-coded murmur.
    if (voiceOn && settings.placeholderVoice === 'tones') {
      const tones = this.audio.playVoiceTones(role, text, speed);
      if (tones) {
        const line: SubtitleLine = { ...base, source: 'tones', placeholder: true, durationS: Math.max(tones.durationS, readingSeconds(text, speed) * 0.6) };
        this.startTimed(line, line.durationS + 0.3, () => tones.stop(), () => undefined);
        return;
      }
    }

    // 3. Silent: subtitle only, timed for reading.
    const durationS = readingSeconds(text, speed);
    const line: SubtitleLine = { ...base, source: 'silent', placeholder: false, durationS };
    this.startTimed(line, durationS, () => undefined, () => undefined, false);
  }

  /** Presents a line that ends on a timer (or earlier via `finish`). */
  private startTimed(line: SubtitleLine, seconds: number, stopSound: () => void, begin: (finish: () => void) => void, ducks = true): void {
    let done = false;
    if (ducks) this.audio.beginVoice();
    const finish = () => {
      if (done) return;
      done = true;
      this.clearTimer(timer);
      if (ducks) this.audio.endVoice();
      if (this.current?.line === line) {
        this.current = undefined;
        this.emit({ type: 'end', line, skipped: false });
        this.next();
      }
    };
    const timer = this.setTimer(finish, Math.round(seconds * 1000));
    this.current = {
      line,
      cancel: () => {
        if (done) return;
        done = true;
        this.clearTimer(timer);
        stopSound();
        if (ducks) this.audio.endVoice();
      },
    };
    this.emit({ type: 'start', line });
    begin(finish);
  }
}
