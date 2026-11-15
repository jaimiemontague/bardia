import { describe, expect, it } from 'vitest';
import { composeBar } from './composer';
import { MusicDeck } from './deck';
import { FinalMixer } from './finalPlayer';
import { MusicEngine, PLACEHOLDER_TRIM, stemLevels, type MusicHost } from './musicEngine';
import { dbToGain } from './settings';
import { stingerEvents, stingerSeconds, STINGER_DEFS } from './stingers';
import { STINGERS } from './catalog';
import { barSeconds, MUSIC_STYLES } from './styles';
import { testAudioContext, TestFinalBackend, type TestAudioContext } from './testFakes';

function host(fake: TestAudioContext, ctx: AudioContext, finals: Record<string, string> = {}, backend = new TestFinalBackend()): MusicHost & { backend: TestFinalBackend } {
  const mixer = new FinalMixer(backend, () => 1);
  return {
    ctx,
    bus: ctx.createGain(),
    reverb: ctx.createGain(),
    finalUrl: (id) => finals[id],
    playFinal: (url, o) => mixer.play('music', url, o),
    hidden: () => false,
    backend,
  };
}

describe('MusicDeck', () => {
  it('schedules exactly the composer’s notes for each bar, bar by bar', () => {
    const { fake, ctx } = testAudioContext();
    const style = MUSIC_STYLES.homeEyjar;
    const deck = new MusicDeck({ ctx, style, seed: 's', out: ctx.createGain(), start: 0, intensity: 0.5, level: 1 });
    const bar = barSeconds(style);
    const n = deck.schedule(bar * 3 - 0.001, 0);
    const expected = [0, 1, 2].reduce((sum, b) => sum + composeBar(style, 's', b, 0.5).length, 0);
    expect(n).toBe(expected);
    expect(deck.cursor.bar).toBe(3);
    expect(fake.sources.length).toBeGreaterThan(0);
  });

  it('skips ahead instead of bursting when it falls behind', () => {
    const { ctx } = testAudioContext();
    const style = MUSIC_STYLES.duel;
    const deck = new MusicDeck({ ctx, style, seed: 's', out: ctx.createGain(), start: 0, intensity: 0.5, level: 1 });
    const bar = barSeconds(style);
    deck.schedule(bar * 10.5, bar * 10.2);
    expect(deck.cursor.bar).toBe(11);
  });

  it('stops scheduling after a fade-out', () => {
    const { ctx } = testAudioContext();
    const deck = new MusicDeck({ ctx, style: MUSIC_STYLES.delve, seed: 's', out: ctx.createGain(), start: 0, intensity: 0.5, level: 1 });
    deck.fadeOutAndStop(2, 0);
    deck.schedule(100, 0);
    expect(deck.isFinished(2.1)).toBe(true);
    expect(deck.cursor.time).toBeLessThan(2 + barSeconds(MUSIC_STYLES.delve));
  });
});

describe('MusicEngine', () => {
  it('plays the placeholder, crossfades, and retires the old deck after the fade', () => {
    const { fake, ctx } = testAudioContext();
    const engine = new MusicEngine(host(fake, ctx));
    engine.setState('homeSkarn');
    expect(engine.status).toMatchObject({ state: 'homeSkarn', source: 'placeholder' });
    const first = engine.deck;
    engine.setState('homeSkarn');
    expect(engine.deck).toBe(first);
    fake.currentTime = 1;
    engine.setState('sailingStorm');
    expect(engine.status.state).toBe('sailingStorm');
    expect(engine.deck).not.toBe(first);
    fake.currentTime = 1 + MUSIC_STYLES.sailingStorm.crossfadeS + 0.1;
    engine.tick();
    expect(first?.isFinished(fake.currentTime)).toBe(true);
    engine.setState('silence');
    expect(engine.status).toMatchObject({ state: undefined, source: 'none' });
  });

  it('prefers a final track, and all three stems for a battle state', () => {
    const { fake, ctx } = testAudioContext();
    const h = host(fake, ctx, {
      'music.track.duel': '/assets/music/duel.ogg',
      'music.stem.battleRaid.low': '/l.ogg',
      'music.stem.battleRaid.mid': '/m.ogg',
      'music.stem.battleRaid.high': '/h.ogg',
      'music.track.battleShieldwall': '/sw.ogg',
      'music.stem.battleShieldwall.low': '/only-low.ogg',
    });
    const engine = new MusicEngine(h);
    engine.setState('duel');
    expect(engine.status.source).toBe('final');
    expect(h.backend.played.at(-1)).toMatchObject({ url: '/assets/music/duel.ogg', loop: true, stream: true });
    engine.setState('battleRaid');
    expect(engine.status.source).toBe('stems');
    expect(h.backend.played.slice(-3).map((p) => p.url)).toEqual(['/l.ogg', '/m.ogg', '/h.ogg']);
    expect(h.backend.played.slice(-3).every((p) => p.stream === false)).toBe(true);
    engine.setState('battleShieldwall');
    expect(engine.status.source).toBe('final'); // incomplete stems → full track
  });

  it('drives stem levels by intensity', () => {
    const lowI = stemLevels('battleShieldwall', 0.1);
    const highI = stemLevels('battleShieldwall', 1);
    expect(lowI).toEqual({ low: 1, mid: 0, high: 0 });
    expect(highI).toEqual({ low: 1, mid: 1, high: 1 });
    const m = stemLevels('battleRaid', 0.45);
    expect(m.mid).toBeGreaterThan(0);
    expect(m.high).toBe(0);
  });

  it('falls back to the placeholder when a final file fails to load', async () => {
    const { fake, ctx } = testAudioContext();
    const backend = new TestFinalBackend();
    backend.failing.add('/bad.ogg');
    const engine = new MusicEngine(host(fake, ctx, { 'music.track.funeral': '/bad.ogg' }, backend));
    engine.setState('funeral');
    expect(engine.status.source).toBe('final');
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.status.source).toBe('placeholder');
  });

  it('dips the music under a stinger and restores it afterwards', () => {
    const { fake, ctx } = testAudioContext();
    const h = host(fake, ctx);
    const engine = new MusicEngine(h);
    engine.setState('allthing');
    const mix = fake.gainsInto(h.bus)[0];
    expect(mix).toBeDefined();
    const before = fake.sources.length;
    engine.stinger('omen');
    // Every stinger note starts at least one source.
    expect(fake.sources.length - before).toBeGreaterThanOrEqual(stingerEvents('omen').length);
    const targets = mix!.gain.events.filter((e) => e.type === 'target').map((e) => e.value);
    expect(targets[0]).toBeCloseTo(dbToGain(STINGER_DEFS.omen.duckDb) * PLACEHOLDER_TRIM, 6);
    expect(targets.at(-1)).toBe(PLACEHOLDER_TRIM);
  });
});

describe('stingers', () => {
  it('every stinger has sorted events, a positive length and a dip', () => {
    for (const id of STINGERS) {
      const ev = stingerEvents(id);
      expect(ev.length).toBeGreaterThan(0);
      for (let i = 1; i < ev.length; i++) expect(ev[i]!.at).toBeGreaterThanOrEqual(ev[i - 1]!.at);
      expect(stingerSeconds(STINGER_DEFS[id])).toBeGreaterThan(1);
      expect(STINGER_DEFS[id].duckDb).toBeLessThan(0);
    }
  });
});
