/**
 * The adaptive music engine (§28.1, §28.4). One music state plays at a time; changing state
 * crossfades (the incoming style's `crossfadeS`). Each state plays the owner's final file when it is
 * present — for the battle tracks the three intensity stems when all three exist, else the full track
 * — and the procedural placeholder deck otherwise. Intensity (0..1) drives the placeholder's layer
 * mix and drum grooves, and the final stems' levels. Stingers dip the music while they sound.
 */
import { dbToGain } from './settings';
import { isStemmed, musicStemAssetId, musicTrackAssetId, STEM_LEVELS, stingerAssetId, type MusicRequest, type MusicState, type StemLevel, type StemmedState, type StingerId } from './catalog';
import { MusicDeck } from './deck';
import type { MixedSound } from './finalPlayer';
import { stingerEvents, stingerPulseSeconds, stingerSeconds, STINGER_DEFS } from './stingers';
import { MUSIC_STYLES } from './styles';
import { playDrum, playInstrumentNote } from './synth';

/** Seconds the scheduler looks ahead (visible tab / hidden tab, where timers are throttled). */
export const LOOKAHEAD_S = 0.35;
export const LOOKAHEAD_HIDDEN_S = 1.6;
/** Fade to silence when the request is 'silence'. */
export const SILENCE_FADE_S = 2.5;
/** Make-up gain of the procedural score (final files are mastered by the owner and get none). */
export const PLACEHOLDER_TRIM = dbToGain(8);

/** The levels of the three battle stems at an intensity: low always; mid and high fade in (smoothstep). */
export function stemLevels(state: StemmedState, intensity: number): Record<StemLevel, number> {
  const style = MUSIC_STYLES[state];
  const out: Record<StemLevel, number> = { low: 1, mid: 0, high: 0 };
  for (const level of ['mid', 'high'] as const) {
    const layers = style.layers.filter((l) => l.stem === level);
    const from = Math.min(...layers.map((l) => l.from ?? 0));
    const full = Math.max(...layers.map((l) => l.full ?? l.from ?? 0));
    out[level] = smoothstep(from, full, intensity);
  }
  return out;
}

function smoothstep(from: number, full: number, x: number): number {
  if (!Number.isFinite(from) || !Number.isFinite(full)) return 0;
  if (x >= full) return 1;
  if (x < from) return 0;
  const t = (x - from) / Math.max(1e-6, full - from);
  return t * t * (3 - 2 * t);
}

/** What the engine needs from the AudioManager. */
export interface MusicHost {
  readonly ctx: BaseAudioContext;
  /** Node every deck and stinger feeds (the music bus). */
  readonly bus: AudioNode;
  /** Reverb input on the music bus. */
  readonly reverb: AudioNode | undefined;
  /** URL of a final file for an asset id, when present. */
  finalUrl(id: string): string | undefined;
  /** Plays a final file on the music bus (undefined when final playback is unavailable). */
  playFinal(url: string, o: { loop: boolean; level: number; stream: boolean }): MixedSound | undefined;
  /** True while the page is hidden (longer lookahead). */
  hidden(): boolean;
}

/** Where the current music comes from. */
export type MusicSource = 'final' | 'stems' | 'placeholder' | 'none';

interface Playing {
  state: MusicState;
  source: Exclude<MusicSource, 'none'>;
  deck?: MusicDeck;
  track?: MixedSound;
  stems?: Partial<Record<StemLevel, MixedSound>>;
}

export class MusicEngine {
  private current: Playing | undefined;
  private readonly fading: Playing[] = [];
  private readonly mix: GainNode;
  private intensity = 0.5;
  private dip = 1;
  private dipUntil = 0;
  private plays = 0;
  /** Seed of the composer (same seed → same note sequence). */
  seed: string;

  constructor(
    private readonly host: MusicHost,
    seed = 'bardia',
  ) {
    this.seed = seed;
    this.mix = host.ctx.createGain();
    this.mix.gain.value = PLACEHOLDER_TRIM;
    this.mix.connect(host.bus);
  }

  /** The state playing (or undefined for silence) and its source. */
  get status(): { state: MusicState | undefined; source: MusicSource; intensity: number } {
    return { state: this.current?.state, source: this.current?.source ?? 'none', intensity: this.intensity };
  }

  /** The placeholder deck playing (lab visualisation, tests). */
  get deck(): MusicDeck | undefined {
    return this.current?.deck;
  }

  /** Switches to a state (crossfade) or to silence. Re-requesting the playing state is a no-op. */
  setState(req: MusicRequest, opts: { crossfadeS?: number; restart?: boolean } = {}): void {
    if (req === 'silence') {
      if (this.current) this.retire(this.current, opts.crossfadeS ?? SILENCE_FADE_S);
      this.current = undefined;
      return;
    }
    if (this.current?.state === req && !opts.restart) return;
    const style = MUSIC_STYLES[req];
    const fadeS = Math.max(0.05, opts.crossfadeS ?? style.crossfadeS);
    if (this.current) this.retire(this.current, fadeS);
    this.current = this.start(req, fadeS);
  }

  /** Sets the adaptive intensity (battle stems, drum grooves, layer windows). */
  setIntensity(intensity: number): void {
    const v = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : this.intensity;
    if (Math.abs(v - this.intensity) < 1e-4) return;
    this.intensity = v;
    const p = this.current;
    if (!p) return;
    p.deck?.setIntensity(v);
    if (p.stems && isStemmed(p.state)) {
      const lv = stemLevels(p.state, v);
      for (const l of STEM_LEVELS) p.stems[l]?.setLevel(lv[l] * this.dip, 1.2);
    }
  }

  /** Lays a stinger over the music (the music dips while it sounds). */
  stinger(id: StingerId): void {
    const def = STINGER_DEFS[id];
    const ctx = this.host.ctx;
    const now = ctx.currentTime;
    const seconds = stingerSeconds(def);
    const url = this.host.finalUrl(stingerAssetId(id));
    const sound = url ? this.host.playFinal(url, { loop: false, level: 1, stream: false }) : undefined;
    if (!sound) {
      const out = ctx.createGain();
      out.gain.value = 0.9 * PLACEHOLDER_TRIM;
      out.connect(this.host.bus);
      if (this.host.reverb && def.reverb > 0) {
        const send = ctx.createGain();
        send.gain.value = def.reverb;
        out.connect(send);
        send.connect(this.host.reverb);
      }
      const pulse = stingerPulseSeconds(def);
      const t0 = now + 0.04;
      for (const n of stingerEvents(id)) {
        const t = t0 + n.at * pulse;
        if (n.instrument === 'drums') {
          if (n.hit) playDrum({ ctx, out }, n.hit, t, n.vel);
        } else playInstrumentNote({ ctx, out }, n.instrument, n.midi, t, n.len * pulse * 0.96, n.vel);
      }
    }
    this.dipTo(dbToGain(def.duckDb), now, now + seconds);
  }

  private dipTo(level: number, now: number, until: number): void {
    this.dip = level;
    this.dipUntil = Math.max(this.dipUntil, until);
    const g = this.mix.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(level * PLACEHOLDER_TRIM, now, 0.08);
    g.setTargetAtTime(PLACEHOLDER_TRIM, this.dipUntil, 0.6);
    this.applyFinalLevels(0.25);
  }

  private applyFinalLevels(fadeS: number): void {
    const p = this.current;
    if (!p) return;
    p.track?.setLevel(this.dip, fadeS);
    if (p.stems && isStemmed(p.state)) {
      const lv = stemLevels(p.state, this.intensity);
      for (const l of STEM_LEVELS) p.stems[l]?.setLevel(lv[l] * this.dip, fadeS);
    }
  }

  /** Schedules ahead and expires finished fades; the manager calls this from its ticker. */
  tick(): void {
    const ctx = this.host.ctx;
    const now = ctx.currentTime;
    const until = now + (this.host.hidden() ? LOOKAHEAD_HIDDEN_S : LOOKAHEAD_S);
    this.current?.deck?.schedule(until, now);
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const f = this.fading[i] as Playing;
      f.deck?.schedule(until, now);
      if (f.deck && f.deck.isFinished(now)) {
        f.deck.dispose();
        this.fading.splice(i, 1);
      } else if (!f.deck) this.fading.splice(i, 1);
    }
    if (this.dip !== 1 && now >= this.dipUntil) {
      this.dip = 1;
      this.applyFinalLevels(0.8);
    }
  }

  /** Stops everything immediately. */
  stopAll(): void {
    for (const p of [this.current, ...this.fading]) {
      if (!p) continue;
      p.deck?.dispose();
      p.track?.stop(0);
      for (const s of Object.values(p.stems ?? {})) s?.stop(0);
    }
    this.current = undefined;
    this.fading.length = 0;
  }

  private start(state: MusicState, fadeS: number): Playing {
    this.plays++;
    const finals = this.startFinal(state, fadeS);
    if (finals) return finals;
    return this.startDeck(state, fadeS);
  }

  private startDeck(state: MusicState, fadeS: number): Playing {
    const ctx = this.host.ctx;
    const now = ctx.currentTime;
    const deck = new MusicDeck({
      ctx,
      style: MUSIC_STYLES[state],
      seed: this.seed,
      out: this.mix,
      reverb: this.host.reverb,
      start: now + 0.06,
      intensity: this.intensity,
      level: 0,
    });
    deck.fade(1, fadeS, now);
    deck.schedule(now + LOOKAHEAD_S, now);
    return { state, source: 'placeholder', deck };
  }

  private startFinal(state: MusicState, fadeS: number): Playing | undefined {
    if (isStemmed(state)) {
      const urls = STEM_LEVELS.map((l) => this.host.finalUrl(musicStemAssetId(state, l)));
      if (urls.every((u): u is string => u !== undefined)) {
        const lv = stemLevels(state, this.intensity);
        const stems: Partial<Record<StemLevel, MixedSound>> = {};
        let ok = true;
        STEM_LEVELS.forEach((l, i) => {
          const s = this.host.playFinal(urls[i] as string, { loop: true, level: 0, stream: false });
          if (!s) ok = false;
          else {
            stems[l] = s;
            s.setLevel(lv[l] * this.dip, fadeS);
          }
        });
        if (ok) {
          const playing: Playing = { state, source: 'stems', stems };
          for (const s of Object.values(stems)) s?.onError(() => this.fallBack(playing));
          return playing;
        }
        for (const s of Object.values(stems)) s?.stop(0);
      }
    }
    const url = this.host.finalUrl(musicTrackAssetId(state));
    if (!url) return undefined;
    const track = this.host.playFinal(url, { loop: true, level: 0, stream: true });
    if (!track) return undefined;
    track.setLevel(this.dip, fadeS);
    const playing: Playing = { state, source: 'final', track };
    track.onError(() => this.fallBack(playing));
    return playing;
  }

  /** A final file failed to load: switch that state to its placeholder. */
  private fallBack(p: Playing): void {
    if (this.current !== p) return;
    p.track?.stop(0);
    for (const s of Object.values(p.stems ?? {})) s?.stop(0);
    this.current = this.startDeck(p.state, 0.5);
  }

  private retire(p: Playing, fadeS: number): void {
    if (p.deck) {
      p.deck.fadeOutAndStop(fadeS);
      this.fading.push(p);
    }
    p.track?.stop(fadeS);
    for (const s of Object.values(p.stems ?? {})) s?.stop(fadeS);
  }

  /** Total plays started (stats). */
  get playCount(): number {
    return this.plays;
  }
}
