import { describe, expect, it } from 'vitest';
import { AudioAssetSource, parseFinalIndex, voiceLinePath } from './assetSource';
import { AudioManager } from './audioManager';
import { buildAudioManifest } from './manifestSpec';
import { testAudioContext, TestFinalBackend } from './testFakes';
import { pickSystemVoice, readingSeconds, ttsParams, VoiceManager, type SpeechLike, type SubtitleEvent } from './voiceManager';
import { VOICE_PROFILES } from './voiceTones';

class FakeTimers {
  now = 0;
  private next = 1;
  private readonly timers = new Map<number, { at: number; cb: () => void }>();
  set = (cb: () => void, ms: number): unknown => {
    const id = this.next++;
    this.timers.set(id, { at: this.now + ms, cb });
    return id;
  };
  clear = (h: unknown): void => void this.timers.delete(h as number);
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      let first: [number, { at: number; cb: () => void }] | undefined;
      for (const e of this.timers) if (e[1].at <= end && (!first || e[1].at < first[1].at)) first = e;
      if (!first) break;
      this.timers.delete(first[0]);
      this.now = first[1].at;
      first[1].cb();
    }
    this.now = end;
  }
}

class FakeUtterance {
  rate = 1;
  pitch = 1;
  volume = 1;
  lang = '';
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly text: string) {}
}

class FakeSpeech implements SpeechLike {
  readonly spoken: FakeUtterance[] = [];
  cancelled = 0;
  speak(u: SpeechSynthesisUtterance): void {
    this.spoken.push(u as unknown as FakeUtterance);
  }
  cancel(): void {
    this.cancelled++;
  }
  getVoices(): SpeechSynthesisVoice[] {
    return [
      { name: 'Zed', lang: 'de-DE' },
      { name: 'Beta', lang: 'en-GB' },
      { name: 'Alpha', lang: 'en-US' },
    ] as unknown as SpeechSynthesisVoice[];
  }
}

const TEXT: Record<string, string> = { 'narrative.intro': 'The fjord was quiet that morning.', 'narrative.two': 'Second line here.', 'narrative.three': 'Third.' };

function setup(o: { finals?: string[]; unlocked?: boolean } = {}) {
  const { fake, ctx } = testAudioContext();
  const backend = new TestFinalBackend();
  const assets = new AudioAssetSource(buildAudioManifest(), parseFinalIndex(o.finals ?? []), '/');
  const audio = new AudioManager({ createContext: () => ctx, finalBackend: backend, assets, loadIndex: null, storage: null, window: null, document: null, autoTick: false });
  const timers = new FakeTimers();
  const speech = new FakeSpeech();
  const vm = new VoiceManager(audio, {
    format: (k, vars) => (TEXT[k] ?? k) + (vars.name ? ` ${String(vars.name)}` : ''),
    speech,
    createUtterance: (t) => new FakeUtterance(t) as unknown as SpeechSynthesisUtterance,
    setTimer: timers.set,
    clearTimer: timers.clear,
  });
  const events: SubtitleEvent[] = [];
  vm.onSubtitle((e) => events.push(e));
  return { audio, vm, timers, speech, backend, events, fake };
}

describe('VoiceManager', () => {
  it('always emits subtitles: silent lines are timed for reading', () => {
    const { vm, timers, events, audio } = setup();
    vm.say({ key: 'narrative.intro', vars: { name: 'Sigrun' }, voice: 'narrator' });
    expect(events[0]).toMatchObject({ type: 'start', line: { key: 'narrative.intro', text: 'The fjord was quiet that morning. Sigrun', role: 'narrator', source: 'silent', placeholder: false } });
    expect(audio.getStatus().voiceActive).toBe(false);
    const dur = readingSeconds('The fjord was quiet that morning. Sigrun', 1);
    timers.advance(dur * 1000 - 10);
    expect(events).toHaveLength(1);
    timers.advance(20);
    expect(events[1]).toMatchObject({ type: 'end', skipped: false });
    expect(vm.currentLine).toBeUndefined();
  });

  it('queues lines in order; interrupt clears the queue; skip advances', () => {
    const { vm, timers, events } = setup();
    vm.say({ key: 'narrative.intro' });
    vm.say({ key: 'narrative.two' });
    vm.say({ key: 'narrative.three' });
    expect(vm.queued).toBe(2);
    vm.skip();
    expect(events.map((e) => e.type)).toEqual(['start', 'end', 'start']);
    expect(vm.currentLine?.key).toBe('narrative.two');
    vm.say({ key: 'narrative.intro', interrupt: true });
    expect(vm.currentLine?.key).toBe('narrative.intro');
    expect(vm.queued).toBe(0);
    timers.advance(60_000);
    expect(vm.currentLine).toBeUndefined();
    const starts = events.filter((e) => e.type === 'start').map((e) => e.line.key);
    expect(starts).toEqual(['narrative.intro', 'narrative.two', 'narrative.intro']);
  });

  it('maps unknown sim voices to npc', () => {
    const { vm } = setup();
    vm.say({ key: 'narrative.intro', voice: 'jarlOfSomewhere' });
    expect(vm.currentLine?.role).toBe('npc');
    expect(vm.currentLine?.voice).toBe('jarlOfSomewhere');
  });

  it('speaks with labelled placeholder TTS only when enabled, with per-role rate/pitch, and ducks', async () => {
    const { vm, audio, speech, events, timers } = setup();
    vm.say({ key: 'narrative.intro', voice: 'hirdmaster' });
    expect(speech.spoken).toHaveLength(0);
    vm.stopAll();
    audio.setSettings({ placeholderVoice: 'tts', narrationSpeed: 1.25 });
    await audio.unlock();
    vm.say({ key: 'narrative.intro', voice: 'hirdmaster' });
    const u = speech.spoken[0]!;
    expect(u.text).toBe(TEXT['narrative.intro']);
    expect(u.rate).toBeCloseTo(VOICE_PROFILES.hirdmaster.ttsRate * 1.25, 12);
    expect(u.pitch).toBe(VOICE_PROFILES.hirdmaster.ttsPitch);
    expect(vm.currentLine).toMatchObject({ source: 'tts', placeholder: true });
    expect(audio.getStatus().voiceActive).toBe(true);
    u.onend?.();
    expect(audio.getStatus().voiceActive).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'end', skipped: false });
    // Watchdog ends a line whose TTS never reports the end.
    vm.say({ key: 'narrative.two', voice: 'seer' });
    timers.advance(120_000);
    expect(vm.currentLine).toBeUndefined();
    expect(audio.getStatus().voiceActive).toBe(false);
  });

  it('narration off: subtitles only, even with TTS selected', () => {
    const { vm, audio, speech } = setup();
    audio.setSettings({ placeholderVoice: 'tts', narration: false });
    vm.say({ key: 'narrative.intro' });
    expect(speech.spoken).toHaveLength(0);
    expect(vm.currentLine?.source).toBe('silent');
  });

  it('plays the tone-coded murmur when selected and audio is unlocked', async () => {
    const { vm, audio, fake, timers } = setup();
    audio.setSettings({ placeholderVoice: 'tones' });
    vm.say({ key: 'narrative.intro', voice: 'skald' });
    expect(vm.currentLine?.source).toBe('silent'); // locked: no sound possible
    vm.stopAll();
    await audio.unlock();
    const before = fake.sources.length;
    vm.say({ key: 'narrative.intro', voice: 'skald' });
    expect(vm.currentLine).toMatchObject({ source: 'tones', placeholder: true });
    expect(fake.sources.length).toBeGreaterThan(before);
    expect(audio.getStatus().voiceActive).toBe(true);
    timers.advance(30_000);
    expect(audio.getStatus().voiceActive).toBe(false);
  });

  it('prefers the final VO file (manifest line key or conventional path)', async () => {
    const path = voiceLinePath('narrative.intro', 'narrator');
    const { vm, audio, backend, events } = setup({ finals: [path, 'voice/skald/music-voice-skald-sample.ogg'] });
    audio.setSettings({ placeholderVoice: 'tts' });
    await audio.unlock();
    vm.say({ key: 'narrative.intro', voice: 'narrator' });
    expect(vm.currentLine).toMatchObject({ source: 'final', placeholder: false });
    expect(backend.played[0]?.url).toBe(`/assets/${path}`);
    expect(audio.getStatus().voiceActive).toBe(true);
    backend.played[0]!.sound.finish();
    expect(events.at(-1)).toMatchObject({ type: 'end', skipped: false });
    expect(audio.getStatus().voiceActive).toBe(false);
    vm.say({ key: 'music.voice.skald.sample', voice: 'skald' });
    expect(backend.played[1]?.url).toBe('/assets/voice/skald/music-voice-skald-sample.ogg');
    vm.skip();
    const sound = backend.played[1]!.sound;
    expect(sound.volumes).toContainEqual({ volume: 0, fadeS: 0.15 }); // fades out, then stops
    expect(sound.volume).toBe(0); // the un-duck refresh keeps a stopping sound silent
    expect(audio.getStatus().voiceActive).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'end', skipped: true });
  });
});

describe('voice helpers', () => {
  it('reading time grows with words and shrinks with speed', () => {
    expect(readingSeconds('one')).toBe(2);
    expect(readingSeconds('a b c d e f g h i j k l m n o p')).toBeGreaterThan(readingSeconds('a b c d'));
    expect(readingSeconds('a b c d e f g h i j k l', 1.5)).toBeLessThan(readingSeconds('a b c d e f g h i j k l', 1));
  });

  it('TTS params stay in the Web Speech ranges', () => {
    for (const role of Object.keys(VOICE_PROFILES) as (keyof typeof VOICE_PROFILES)[]) {
      const p = ttsParams(role, 1.5);
      expect(p.rate).toBeGreaterThan(0);
      expect(p.rate).toBeLessThanOrEqual(10);
      expect(p.pitch).toBeGreaterThanOrEqual(0);
      expect(p.pitch).toBeLessThanOrEqual(2);
    }
  });

  it('picks English system voices deterministically per role', () => {
    const voices = new FakeSpeech().getVoices();
    expect(pickSystemVoice(voices, 'narrator')?.name).toBe('Alpha');
    expect(pickSystemVoice(voices, 'skald')?.name).toBe('Beta');
    expect(pickSystemVoice([], 'npc')).toBeUndefined();
  });
});
