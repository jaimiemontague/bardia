/**
 * A music deck: one music style being played by the placeholder synth. The deck owns a fader (for
 * crossfades), one gain per layer (intensity mix, §28.1 adaptive stems) and a reverb send, and
 * schedules whole bars ahead of time from the deterministic composer. The real-time engine calls
 * `schedule(now + lookahead)` from its ticker; an offline render calls it once for the whole span.
 */
import { composeBar } from './composer';
import { barPulses, layerIntensityGain, pulseSeconds, type LayerSpec, type MusicStyle } from './styles';
import { playDrum, playInstrumentNote } from './synth';

/** Seconds of crossfade/ramp used for intensity changes. */
export const INTENSITY_RAMP_S = 1.2;

/** Gain of a layer at an intensity (layer mix × intensity window × style level). */
export function layerGainAt(style: MusicStyle, layer: LayerSpec, intensity: number): number {
  return layer.gain * layerIntensityGain(layer, intensity) * style.gain;
}

export interface DeckOptions {
  readonly ctx: BaseAudioContext;
  readonly style: MusicStyle;
  readonly seed: string;
  /** Node the deck's fader feeds (the engine's music mix). */
  readonly out: AudioNode;
  /** Reverb input (optional). */
  readonly reverb?: AudioNode | undefined;
  /** Context time of bar `startBar`'s downbeat. */
  readonly start: number;
  readonly intensity: number;
  /** Initial fader level (0 for a fade-in). */
  readonly level: number;
  readonly startBar?: number;
  /** Plays only the layers this accepts (single-stem renders); others stay silent. */
  readonly layerFilter?: (layer: LayerSpec) => boolean;
}

export class MusicDeck {
  readonly style: MusicStyle;
  readonly seed: string;
  readonly fader: GainNode;
  private readonly ctx: BaseAudioContext;
  private readonly send: GainNode | undefined;
  private readonly layerGains: Record<string, GainNode> = {};
  private nextBar: number;
  private nextBarTime: number;
  private intensity: number;
  private stopAt = Infinity;
  private disposed = false;
  /** Notes scheduled so far (stats, tests). */
  notesScheduled = 0;

  constructor(o: DeckOptions) {
    this.ctx = o.ctx;
    this.style = o.style;
    this.seed = o.seed;
    this.intensity = clamp01(o.intensity);
    this.nextBar = Math.max(0, Math.floor(o.startBar ?? 0));
    this.nextBarTime = o.start;
    this.fader = o.ctx.createGain();
    this.fader.gain.setValueAtTime(o.level, o.ctx.currentTime);
    this.fader.connect(o.out);
    if (o.reverb && o.style.reverb > 0) {
      this.send = o.ctx.createGain();
      this.send.gain.value = o.style.reverb;
      this.fader.connect(this.send);
      this.send.connect(o.reverb);
    }
    for (const layer of o.style.layers) {
      if (o.layerFilter && !o.layerFilter(layer)) continue;
      const g = o.ctx.createGain();
      g.gain.value = layerGainAt(o.style, layer, this.intensity);
      g.connect(this.fader);
      this.layerGains[layer.id] = g;
    }
  }

  /** Seconds per bar of this deck's style. */
  get barSeconds(): number {
    return barPulses(this.style) * pulseSeconds(this.style);
  }

  /** The next bar to be scheduled and its downbeat time. */
  get cursor(): { bar: number; time: number } {
    return { bar: this.nextBar, time: this.nextBarTime };
  }

  get currentIntensity(): number {
    return this.intensity;
  }

  /** True once the deck has faded out and stopped (the engine may dispose it). */
  isFinished(now: number): boolean {
    return now >= this.stopAt;
  }

  /**
   * Schedules every bar whose downbeat is before `until`. When the cursor has fallen behind `now`
   * (a throttled tab), it skips forward to the current bar instead of playing a burst of late notes.
   * Returns the number of notes scheduled.
   */
  schedule(until: number, now = this.ctx.currentTime): number {
    if (this.disposed) return 0;
    const barS = this.barSeconds;
    if (this.nextBarTime + barS < now) {
      const behind = Math.floor((now - this.nextBarTime) / barS);
      this.nextBar += behind;
      this.nextBarTime += behind * barS;
    }
    let count = 0;
    const pulse = pulseSeconds(this.style);
    while (this.nextBarTime < until && this.nextBarTime < this.stopAt) {
      const barStart = this.nextBarTime;
      for (const n of composeBar(this.style, this.seed, this.nextBar, this.intensity)) {
        const out = this.layerGains[n.layer];
        if (!out) continue;
        const t = Math.max(barStart, barStart + n.at * pulse + n.nudge / 1000);
        if (t < now - 0.005 || t >= this.stopAt) continue;
        if (n.instrument === 'drums') {
          if (n.hit) playDrum({ ctx: this.ctx, out }, n.hit, t, n.vel);
        } else {
          playInstrumentNote({ ctx: this.ctx, out }, n.instrument, n.midi, t, n.len * pulse * 0.96, n.vel);
        }
        count++;
      }
      this.nextBar += 1;
      this.nextBarTime = barStart + barS;
    }
    this.notesScheduled += count;
    return count;
  }

  /** Ramps every layer to its gain at `intensity` (drum grooves follow from the next bar). */
  setIntensity(intensity: number, at = this.ctx.currentTime, rampS = INTENSITY_RAMP_S): void {
    this.intensity = clamp01(intensity);
    for (const layer of this.style.layers) {
      const g = this.layerGains[layer.id];
      if (!g) continue;
      g.gain.cancelScheduledValues(at);
      g.gain.setTargetAtTime(layerGainAt(this.style, layer, this.intensity), at, Math.max(0.01, rampS / 3));
    }
  }

  /** Fades the deck's fader to `level` over `seconds` (equal-power-ish exponential approach). */
  fade(level: number, seconds: number, at = this.ctx.currentTime): void {
    const g = this.fader.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(g.value, at);
    g.linearRampToValueAtTime(level, at + Math.max(0.01, seconds));
  }

  /** Fades out and stops scheduling; finished after the fade plus the longest release tail. */
  fadeOutAndStop(seconds: number, at = this.ctx.currentTime): void {
    this.fade(0, seconds, at);
    this.stopAt = at + Math.max(0.01, seconds);
  }

  /** Disconnects the deck from the graph (scheduled notes stop sounding). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopAt = Math.min(this.stopAt, this.ctx.currentTime);
    try {
      this.fader.disconnect();
      this.send?.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}
