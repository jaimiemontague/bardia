import { describe, expect, it } from 'vitest';
import { AudioAssetSource, parseFinalIndex } from './assetSource';
import { AudioManager, type AudioManagerOptions } from './audioManager';
import { OUTPUT_BUSES, sfxDef } from './catalog';
import { buildAudioManifest } from './manifestSpec';
import { DUCK_DB, dbToGain, effectiveGain } from './settings';
import { testAudioContext, TestFinalBackend, TestGain, type TestAudioContext } from './testFakes';

const MANIFEST = buildAudioManifest();

function setup(opts: Partial<AudioManagerOptions> & { finals?: string[] } = {}) {
  const { fake, ctx } = testAudioContext();
  const backend = new TestFinalBackend();
  const assets = new AudioAssetSource(MANIFEST, parseFinalIndex(opts.finals ?? []), '/');
  const m = new AudioManager({ createContext: () => ctx, finalBackend: backend, assets, loadIndex: null, storage: null, window: null, document: null, autoTick: false, ...opts });
  return { m, fake, backend };
}

/** The bus gain nodes: the gains feeding the master gain (which feeds the limiter). */
function busNodes(fake: TestAudioContext): TestGain[] {
  const limiter = fake.nodes.find((n) => n.kind === 'compressor');
  const master = fake.gainsInto(limiter)[0];
  return fake.gainsInto(master);
}

describe('AudioManager unlock and buses', () => {
  it('starts locked; unlock builds five buses at the effective gains', async () => {
    const { m, fake } = setup();
    expect(m.getStatus()).toMatchObject({ unlocked: false, supported: true });
    expect(await m.unlock()).toBe(true);
    expect(m.getStatus().unlocked).toBe(true);
    const buses = busNodes(fake);
    expect(buses).toHaveLength(OUTPUT_BUSES.length);
    const want = OUTPUT_BUSES.map((b) => effectiveGain(m.settings, b, { voiceActive: false, blurred: false }));
    expect(buses.map((g) => g.gain.value)).toEqual(want);
  });

  it('reports failure when the browser blocks the resume (no gesture yet)', async () => {
    const { m, fake } = setup();
    fake.blockResume = true;
    expect(await m.unlock()).toBe(false);
    expect(m.getStatus().unlocked).toBe(false);
    fake.blockResume = false;
    expect(await m.unlock()).toBe(true);
  });

  it('is unsupported where no AudioContext exists', async () => {
    const m = new AudioManager({ createContext: () => undefined, finalBackend: null, loadIndex: null, storage: null, window: null, document: null });
    expect(await m.unlock()).toBe(false);
    expect(m.playSfx('ui.click').source).toBe('dropped');
  });

  it('applies volume changes to the bus nodes', async () => {
    const { m, fake } = setup();
    await m.unlock();
    m.setSettings({ volumes: { music: 0.2 } });
    const [music] = busNodes(fake);
    expect(music!.gain.value).toBeCloseTo(m.busGain('music'), 12);
    m.setSettings({ muted: true });
    for (const g of busNodes(fake)) expect(g.gain.value).toBe(0);
  });

  it('ducks music/ambience/SFX while voice plays and restores after', async () => {
    const { m, fake } = setup();
    await m.unlock();
    const [music, sfx, ambience, voice] = busNodes(fake);
    const plain = m.busGain('music');
    m.beginVoice();
    m.beginVoice();
    expect(m.getStatus().voiceActive).toBe(true);
    expect(music!.gain.value).toBeCloseTo(plain * dbToGain(DUCK_DB.music), 12);
    expect(sfx!.gain.value).toBeLessThan(m.settings.volumes.sfx);
    expect(ambience!.gain.value).toBeCloseTo(m.busGain('ambience'), 12);
    expect(voice!.gain.value).toBeCloseTo(effectiveGain(m.settings, 'voice', { voiceActive: false, blurred: false }), 12);
    m.endVoice();
    expect(m.getStatus().voiceActive).toBe(true);
    m.endVoice();
    m.endVoice(); // extra end is harmless
    expect(m.getStatus().voiceActive).toBe(false);
    expect(music!.gain.value).toBeCloseTo(plain, 12);
  });

  it('mutes on blur (when enabled) and restores on focus', async () => {
    const { m, fake } = setup();
    await m.unlock();
    m.setFocusState({ focused: false });
    expect(m.getStatus().blurred).toBe(true);
    for (const g of busNodes(fake)) expect(g.gain.value).toBe(0);
    m.setFocusState({ focused: true });
    expect(busNodes(fake)[0]!.gain.value).toBeGreaterThan(0);
    m.setSettings({ muteOnBlur: false });
    m.setFocusState({ hidden: true });
    expect(busNodes(fake)[0]!.gain.value).toBeGreaterThan(0);
    m.dispose();
  });

  it('notifies subscribers with a new snapshot on change and keeps it stable otherwise', async () => {
    const { m } = setup();
    let calls = 0;
    const off = m.subscribe(() => calls++);
    const s0 = m.getStatus();
    expect(m.getStatus()).toBe(s0);
    m.setIntensity(0.9);
    expect(calls).toBeGreaterThan(0);
    expect(m.getStatus()).not.toBe(s0);
    expect(m.getStatus().music.intensity).toBe(0.9);
    off();
  });
});

describe('AudioManager music', () => {
  it('stacks requests: the latest push wins, popping returns to the one below, then the base', async () => {
    const { m } = setup();
    m.setMusic('homeHvarn');
    const a = m.pushMusic('sailingCalm');
    const b = m.pushMusic('battleRaid');
    expect(m.effectiveMusicRequest()).toBe('battleRaid');
    m.updateMusic(a, 'sailingStorm');
    m.popMusic(b);
    expect(m.effectiveMusicRequest()).toBe('sailingStorm');
    m.popMusic(a);
    expect(m.effectiveMusicRequest()).toBe('homeHvarn');
    expect(m.getStatus().music.state).toBeUndefined(); // locked: nothing plays yet
    await m.unlock();
    expect(m.getStatus().music).toMatchObject({ state: 'homeHvarn', source: 'placeholder' });
  });

  it('schedules notes from the ticker as time passes', async () => {
    const { m, fake } = setup();
    m.setMusic('meadHallRowdy');
    await m.unlock();
    const n0 = fake.sources.length;
    for (let t = 0; t < 4; t += 0.025) {
      fake.currentTime = t;
      m.tick();
    }
    expect(fake.sources.length).toBeGreaterThan(n0 + 20);
  });

  it('plays the final track when the index lists it', async () => {
    const { m, backend } = setup({ finals: ['music/main-theme.ogg'] });
    m.setMusic('mainTheme');
    await m.unlock();
    expect(m.getStatus().music.source).toBe('final');
    expect(backend.played[0]).toMatchObject({ url: '/assets/music/main-theme.ogg', loop: true });
  });
});

describe('AudioManager sound effects', () => {
  it('drops one-shots before the unlock but starts loops once unlocked', async () => {
    const { m, fake } = setup();
    expect(m.playSfx('ui.coin').source).toBe('dropped');
    const loop = m.playSfx('weather.rain', { intensity: 0.8 });
    expect(loop.source).toBe('pending');
    expect(loop.playing).toBe(true);
    const cancelled = m.playSfx('town.gulls');
    cancelled.stop();
    await m.unlock();
    expect(loop.source).toBe('placeholder');
    expect(m.activeSfxCount('weather.rain')).toBe(1);
    expect(m.activeSfxCount('town.gulls')).toBe(0);
    loop.stop(0.1);
    fake.currentTime = 1;
    m.tick();
    expect(m.activeSfxCount('weather.rain')).toBe(0);
  });

  it('limits simultaneous voices per id', async () => {
    const { m, fake } = setup();
    await m.unlock();
    const max = sfxDef('battle.shieldBash').maxVoices;
    const handles = Array.from({ length: max + 3 }, () => m.playSfx('battle.shieldBash'));
    fake.currentTime = 0.2;
    m.tick();
    expect(m.activeSfxCount('battle.shieldBash')).toBeLessThanOrEqual(max);
    expect(handles.at(-1)!.playing).toBe(true);
  });

  it('one-shots expire from the active list', async () => {
    const { m, fake } = setup();
    await m.unlock();
    m.playSfx('ui.click');
    expect(m.activeSfxCount()).toBe(1);
    fake.currentTime = 2;
    m.tick();
    expect(m.activeSfxCount()).toBe(0);
  });

  it('uses the final file for the selected variant, through the bus gain', async () => {
    const { m, backend } = setup({ finals: ['sfx/sea/waves-gale.ogg'] });
    await m.unlock();
    const calm = m.playSfx('sea.waves', { wind: 'calm' });
    expect(calm.source).toBe('placeholder');
    const gale = m.playSfx('sea.waves', { wind: 'gale', volume: 0.5 });
    expect(gale.source).toBe('final');
    expect(backend.played[0]).toMatchObject({ url: '/assets/sfx/sea/waves-gale.ogg', loop: true });
    expect(backend.played[0]!.volume).toBeCloseTo(0.5 * m.busGain('ambience'), 12);
    m.setSettings({ volumes: { ambience: 0.1 } });
    expect(backend.played[0]!.sound.volume).toBeCloseTo(0.5 * m.busGain('ambience'), 12);
  });

  it('falls back to the placeholder when a final file fails', async () => {
    const { m, backend } = setup({ finals: ['sfx/ui/coin.ogg'] });
    backend.failing.add('/assets/sfx/ui/coin.ogg');
    await m.unlock();
    const h = m.playSfx('ui.coin');
    expect(h.source).toBe('final');
    await Promise.resolve();
    await Promise.resolve();
    expect(h.source).toBe('placeholder');
  });
});
