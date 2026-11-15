import { describe, expect, it } from 'vitest';
import { resolveSfxParams, SFX_IDS, sfxDef, type SfxId } from './catalog';
import { noiseSource as seeded } from './dsp';
import type { SfxEnv } from './sfxKit';
import { SFX_SYNTHS } from './sfxSynth';
import { testAudioContext, TestGain, type TestAudioContext } from './testFakes';
import { playDrum, playInstrumentNote } from './synth';
import { syllablePlan, VOICE_PROFILES, playVoiceTones, planSeconds } from './voiceTones';

function env(fake: TestAudioContext, ctx: AudioContext, id: string): SfxEnv {
  const out = ctx.createGain();
  out.connect(ctx.destination);
  return { ctx, out, wet: ctx.createGain(), rnd: seeded(`t|${id}`), rate: 1 };
}

function variantsOf(id: SfxId): Record<string, string | number>[] {
  const def = sfxDef(id);
  const out: Record<string, string | number>[] = [{}];
  for (const [name, p] of Object.entries(def.params)) {
    if (p.kind === 'enum') for (const v of p.values) out.push({ [name]: v });
    else out.push({ [name]: p.min }, { [name]: p.max });
  }
  return out;
}

describe('procedural SFX', () => {
  it('every id and parameter extreme builds a graph without errors', () => {
    for (const id of SFX_IDS) {
      for (const params of variantsOf(id)) {
        const { fake, ctx } = testAudioContext();
        const before = fake.sources.length;
        const voice = SFX_SYNTHS[id](env(fake, ctx, id), resolveSfxParams(id, params), 0.01);
        voice.advance(2);
        expect(fake.sources.length, `${id} ${JSON.stringify(params)}`).toBeGreaterThan(before);
        for (const s of fake.sources) {
          expect(Number.isFinite(s.startedAt)).toBe(true);
          if (s.stoppedAt !== undefined) expect(s.stoppedAt).toBeGreaterThanOrEqual(s.startedAt ?? 0);
        }
      }
    }
  });

  it('one-shots end in time; loops run until stopped', () => {
    for (const id of SFX_IDS) {
      const def = sfxDef(id);
      const { fake, ctx } = testAudioContext();
      const voice = SFX_SYNTHS[id](env(fake, ctx, id), resolveSfxParams(id), 0);
      if (def.loop) {
        expect(voice.endsAt).toBe(Infinity);
        voice.advance(1);
        voice.stop(1, 0.3);
        expect(voice.endsAt).toBeLessThan(2);
        for (const s of fake.sources) expect(s.stoppedAt ?? Infinity).toBeLessThanOrEqual(1.4);
      } else {
        expect(Number.isFinite(voice.endsAt)).toBe(true);
        expect(voice.endsAt).toBeLessThanOrEqual(def.durationS * 2.5 + 3);
      }
    }
  });

  it('event loops keep scheduling as time advances', () => {
    for (const id of ['sea.oars', 'town.smithy', 'animal.hoofbeats', 'town.gulls', 'town.market'] as const) {
      const { fake, ctx } = testAudioContext();
      const voice = SFX_SYNTHS[id](env(fake, ctx, id), resolveSfxParams(id), 0);
      voice.advance(3);
      const n3 = fake.sources.length;
      voice.advance(20);
      expect(fake.sources.length, id).toBeGreaterThan(n3);
      voice.stop(20, 0.2);
      const n = fake.sources.length;
      voice.advance(40);
      expect(fake.sources.length, `${id} after stop`).toBe(n);
    }
  });

  it('oars follow the stroke rate', () => {
    const count = (spm: number) => {
      const { fake, ctx } = testAudioContext();
      const voice = SFX_SYNTHS['sea.oars'](env(fake, ctx, 'oars'), resolveSfxParams('sea.oars', { strokesPerMin: spm }), 0);
      voice.advance(30);
      return fake.created.oscillator ?? 0; // one knock thump per stroke
    };
    expect(count(36)).toBeGreaterThan(count(12) * 2);
  });

  it('the same seed renders the same sound graph', () => {
    const shape = () => {
      const { fake, ctx } = testAudioContext();
      SFX_SYNTHS['battle.clash'](env(fake, ctx, 'same'), resolveSfxParams('battle.clash', { count: 5 }), 0);
      return fake.sources.map((s) => s.startedAt);
    };
    expect(shape()).toEqual(shape());
  });
});

describe('instruments', () => {
  it('every instrument and drum schedules sources at the requested time', () => {
    const { fake, ctx } = testAudioContext();
    const out = ctx.createGain();
    for (const inst of ['lyre', 'harp', 'oud', 'strings', 'fiddle', 'flute', 'horn', 'drone', 'choir', 'hum'] as const) {
      const before = fake.sources.length;
      playInstrumentNote({ ctx, out }, inst, 60, 1.5, 0.5, 0.7);
      const added = fake.sources.slice(before);
      expect(added.length, inst).toBeGreaterThan(0);
      for (const s of added) expect(s.startedAt).toBeGreaterThanOrEqual(1.5);
    }
    for (const hit of ['boom', 'war', 'slap', 'tap', 'shaker', 'clap'] as const) playDrum({ ctx, out }, hit, 2, 0.8);
    expect(fake.sources.filter((s) => s.startedAt === 2).length).toBe(6);
    expect((out as unknown as TestGain).outputs.length).toBe(0);
  });
});

describe('tone-coded voice placeholder', () => {
  it('plans syllables deterministically with pauses and a question rise', () => {
    const p = VOICE_PROFILES.narrator;
    const a = syllablePlan('Men are fed, shields are mended. Are we ready?', p);
    expect(a).toEqual(syllablePlan('Men are fed, shields are mended. Are we ready?', p));
    expect(a.length).toBeGreaterThan(8);
    for (let i = 1; i < a.length; i++) expect(a[i]!.at).toBeGreaterThan(a[i - 1]!.at);
    const last = a[a.length - 1]!;
    const firstOfLastSentence = a.find((s) => s.at > 2)!;
    expect(last.pitch).toBeGreaterThan(firstOfLastSentence.pitch * 0.95);
    expect(planSeconds(syllablePlan('one two three', p, 2))).toBeLessThan(planSeconds(syllablePlan('one two three', p, 1)));
    expect(syllablePlan('', p)).toEqual([]);
  });

  it('the skald chants on pentatonic steps', () => {
    const plan = syllablePlan('wave steed wind wing ring giver whale road', VOICE_PROFILES.skald);
    const steps = new Set(plan.map((s) => Math.round(12 * Math.log2(s.pitch))));
    for (const st of steps) expect([0, 2, 4, 7, 9]).toContain(st);
  });

  it('plays a murmur whose length follows the plan', () => {
    const { fake, ctx } = testAudioContext();
    const { durationS } = playVoiceTones(env(fake, ctx, 'v'), 'hirdmaster', 'Say the word and we row.', 1, 0);
    expect(durationS).toBeCloseTo(planSeconds(syllablePlan('Say the word and we row.', VOICE_PROFILES.hirdmaster)), 6);
  });
});
