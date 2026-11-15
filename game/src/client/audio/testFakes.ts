/**
 * Test doubles for the audio code (test-only; never imported by the app): a recording fake of the
 * WebAudio API sufficient for the synth, engine, manager and SFX renderers, and a fake final-file
 * backend. AudioParam automation is simplified: every scheduled value is applied immediately, so a
 * test reads the latest target from `param.value` and the full history from `param.events`.
 */
import type { FinalBackend, FinalPlayOptions, FinalSound } from './finalPlayer';

export interface TestParamEvent {
  readonly type: 'set' | 'linear' | 'exp' | 'target' | 'cancel';
  readonly value: number;
  readonly time: number;
}

export class TestParam {
  value: number;
  readonly events: TestParamEvent[] = [];
  constructor(value = 0) {
    this.value = value;
  }
  private push(type: TestParamEvent['type'], value: number, time: number): this {
    if (!Number.isFinite(value) || !Number.isFinite(time)) throw new Error(`non-finite automation ${type}(${value}, ${time})`);
    this.events.push({ type, value, time });
    if (type !== 'cancel') this.value = value;
    return this;
  }
  setValueAtTime(v: number, t: number): this {
    return this.push('set', v, t);
  }
  linearRampToValueAtTime(v: number, t: number): this {
    return this.push('linear', v, t);
  }
  exponentialRampToValueAtTime(v: number, t: number): this {
    if (v <= 0) throw new Error('exponential ramp to a non-positive value');
    return this.push('exp', v, t);
  }
  setTargetAtTime(v: number, t: number, tc: number): this {
    if (!(tc > 0)) throw new Error('setTargetAtTime needs a positive time constant');
    return this.push('target', v, t);
  }
  cancelScheduledValues(t: number): this {
    return this.push('cancel', 0, t);
  }
}

export class TestNode {
  readonly outputs: (TestNode | TestParam)[] = [];
  readonly numberOfInputs = 1;
  constructor(
    readonly context: TestAudioContext,
    readonly kind: string,
  ) {
    context.created[kind] = (context.created[kind] ?? 0) + 1;
    context.nodes.push(this);
  }
  connect<T extends TestNode | TestParam>(dest: T): T {
    if (!(dest instanceof TestNode) && !(dest instanceof TestParam)) throw new Error(`${this.kind}.connect: bad destination`);
    this.outputs.push(dest);
    return dest;
  }
  disconnect(): void {
    this.outputs.length = 0;
  }
}

export class TestGain extends TestNode {
  readonly gain = new TestParam(1);
}

export class TestFilter extends TestNode {
  type = 'lowpass';
  readonly frequency = new TestParam(350);
  readonly Q = new TestParam(1);
  readonly gain = new TestParam(0);
  readonly detune = new TestParam(0);
}

export class TestSource extends TestNode {
  startedAt: number | undefined;
  stoppedAt: number | undefined;
  onended: (() => void) | null = null;
  start(when = 0): void {
    if (this.startedAt !== undefined) throw new Error(`${this.kind} started twice`);
    if (!Number.isFinite(when)) throw new Error('start time must be finite');
    this.startedAt = when;
    this.context.sources.push(this);
  }
  stop(when = 0): void {
    if (this.startedAt === undefined) throw new Error(`${this.kind} stopped before start`);
    if (!Number.isFinite(when)) throw new Error('stop time must be finite');
    this.stoppedAt = when;
  }
}

export class TestOscillator extends TestSource {
  type = 'sine';
  readonly frequency = new TestParam(440);
  readonly detune = new TestParam(0);
}

export class TestBufferSource extends TestSource {
  buffer: TestBuffer | null = null;
  loop = false;
  readonly playbackRate = new TestParam(1);
}

export class TestBuffer {
  private readonly data: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number): Float32Array {
    const d = this.data[c];
    if (!d) throw new Error('bad channel');
    return d;
  }
}

export class TestAudioContext {
  currentTime = 0;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  readonly created: Record<string, number> = {};
  readonly nodes: TestNode[] = [];
  readonly sources: TestSource[] = [];
  readonly destination: TestNode;
  /** Resume fails (autoplay blocked) while true. */
  blockResume = false;
  constructor(readonly sampleRate = 8000) {
    this.destination = new TestNode(this, 'destination');
  }
  resume(): Promise<void> {
    if (!this.blockResume) this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
  addEventListener(): void {}
  createGain(): TestGain {
    return new TestGain(this, 'gain');
  }
  createBiquadFilter(): TestFilter {
    return new TestFilter(this, 'biquad');
  }
  createOscillator(): TestOscillator {
    return new TestOscillator(this, 'oscillator');
  }
  createBufferSource(): TestBufferSource {
    return new TestBufferSource(this, 'bufferSource');
  }
  createStereoPanner(): TestNode & { pan: TestParam } {
    return Object.assign(new TestNode(this, 'panner'), { pan: new TestParam(0) });
  }
  createConvolver(): TestNode & { buffer: TestBuffer | null; normalize: boolean } {
    return Object.assign(new TestNode(this, 'convolver'), { buffer: null as TestBuffer | null, normalize: true });
  }
  createDynamicsCompressor(): TestNode & Record<'threshold' | 'knee' | 'ratio' | 'attack' | 'release', TestParam> {
    return Object.assign(new TestNode(this, 'compressor'), {
      threshold: new TestParam(-24),
      knee: new TestParam(30),
      ratio: new TestParam(12),
      attack: new TestParam(0.003),
      release: new TestParam(0.25),
    });
  }
  createBuffer(channels: number, length: number, sampleRate: number): TestBuffer {
    return new TestBuffer(channels, length, sampleRate);
  }
  /** OfflineAudioContext stand-in: resolves with an empty buffer of the context's length. */
  startRendering(): Promise<TestBuffer> {
    return Promise.resolve(new TestBuffer(2, Math.max(1, Math.round(this.sampleRate)), this.sampleRate));
  }
  /** Gain nodes that feed `dest`. */
  gainsInto(dest: unknown): TestGain[] {
    return this.nodes.filter((n): n is TestGain => n instanceof TestGain && n.outputs.includes(dest as TestNode));
  }
  /** Sources started at or after `t`. */
  sourcesFrom(t: number): TestSource[] {
    return this.sources.filter((s) => (s.startedAt ?? 0) >= t);
  }
}

/** A fake AudioContext typed as the real one (for code under test). */
export function testAudioContext(sampleRate = 8000): { fake: TestAudioContext; ctx: AudioContext } {
  const fake = new TestAudioContext(sampleRate);
  return { fake, ctx: fake as unknown as AudioContext };
}

/** A recording fake final-file backend. */
export class TestFinalBackend implements FinalBackend {
  readonly played: (FinalPlayOptions & { sound: TestFinalSound })[] = [];
  /** URLs that fail to load. */
  readonly failing = new Set<string>();
  play(opts: FinalPlayOptions): FinalSound {
    const sound = new TestFinalSound(opts.volume);
    this.played.push({ ...opts, sound });
    if (this.failing.has(opts.url)) queueMicrotask(() => sound.fail(new Error('load failed')));
    return sound;
  }
}

export class TestFinalSound implements FinalSound {
  volume: number;
  readonly volumes: { volume: number; fadeS: number | undefined }[] = [];
  ended = false;
  private endCbs: (() => void)[] = [];
  private errCbs: ((e: unknown) => void)[] = [];
  constructor(volume: number) {
    this.volume = volume;
  }
  setVolume(volume: number, fadeS?: number): void {
    this.volume = volume;
    this.volumes.push({ volume, fadeS });
  }
  stop(): void {
    this.finish();
  }
  onEnd(cb: () => void): void {
    if (this.ended) cb();
    else this.endCbs.push(cb);
  }
  onError(cb: (err: unknown) => void): void {
    this.errCbs.push(cb);
  }
  duration(): number {
    return 3;
  }
  /** Simulates the natural end of playback. */
  finish(): void {
    if (this.ended) return;
    this.ended = true;
    for (const cb of this.endCbs.splice(0)) cb();
  }
  fail(err: unknown): void {
    for (const cb of this.errCbs.splice(0)) cb(err);
    this.finish();
  }
}
