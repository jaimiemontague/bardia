/**
 * Placeholder voices (§26.6, §28.5 "labelled TTS or tone-coded stand-ins for VO"). Each voice role
 * (§26.2) has a profile: Web Speech rate/pitch for the optional TTS placeholder and a pitch/contour
 * for the tone-coded murmur, a wordless formant "speech" whose rhythm follows the line's syllables
 * and punctuation so the subtitle and the sound stay in step.
 */
import type { VoiceRole } from './catalog';
import { between, gainNode, Voice, type SfxEnv, type SfxVoice } from './sfxKit';
import { formantBank, glideVowel, type Vowel } from './synth';

export interface VoiceProfile {
  /** Web Speech rate (before the narration-speed multiplier). */
  readonly ttsRate: number;
  /** Web Speech pitch (0..2). */
  readonly ttsPitch: number;
  /** Mean pitch of the tone-coded murmur (Hz). */
  readonly toneHz: number;
  /** Melodic contour of the murmur: spoken declination, a lilting storyteller, or the skald's chant. */
  readonly contour: 'spoken' | 'lilt' | 'chant';
  /** Breathiness 0..1. */
  readonly breath: number;
  /** Seconds per syllable at narration speed 1. */
  readonly syllableS: number;
}

/** Voice-role profiles (§26.2 registers: narrator warm and wry; hirdmaster blunt; skald in verse; …). */
export const VOICE_PROFILES: Readonly<Record<VoiceRole, VoiceProfile>> = {
  narrator: { ttsRate: 0.95, ttsPitch: 1, toneHz: 128, contour: 'lilt', breath: 0.15, syllableS: 0.17 },
  skald: { ttsRate: 0.85, ttsPitch: 0.9, toneHz: 140, contour: 'chant', breath: 0.1, syllableS: 0.21 },
  hirdmaster: { ttsRate: 1.05, ttsPitch: 0.72, toneHz: 98, contour: 'spoken', breath: 0.2, syllableS: 0.15 },
  steward: { ttsRate: 1, ttsPitch: 1, toneHz: 118, contour: 'spoken', breath: 0.1, syllableS: 0.16 },
  seer: { ttsRate: 0.8, ttsPitch: 1.25, toneHz: 196, contour: 'lilt', breath: 0.45, syllableS: 0.22 },
  rival: { ttsRate: 1.08, ttsPitch: 1.1, toneHz: 145, contour: 'lilt', breath: 0.12, syllableS: 0.15 },
  npc: { ttsRate: 1, ttsPitch: 1.05, toneHz: 160, contour: 'spoken', breath: 0.15, syllableS: 0.16 },
};

/** One syllable of the murmur plan (times in seconds from the line start). */
export interface Syllable {
  readonly vowel: Vowel;
  readonly at: number;
  readonly dur: number;
  /** Pitch multiplier relative to the profile's mean. */
  readonly pitch: number;
  readonly level: number;
}

const VOWEL_OF: Readonly<Record<string, Vowel>> = { a: 'a', e: 'e', i: 'i', o: 'o', u: 'u', y: 'i' };
/** Pentatonic steps (semitones) the skald's chant moves on. */
const CHANT_STEPS = [0, 2, 4, 7, 9, 7, 4, 2] as const;

/**
 * The syllable plan of a line (pure): vowel groups of each word become syllables; commas, colons
 * and dashes pause briefly, sentence ends pause longer; pitch falls across each sentence (rises at a
 * question) and the first syllable of a word is accented.
 */
export function syllablePlan(text: string, profile: VoiceProfile, speed = 1): Syllable[] {
  const sp = Math.max(0.25, speed);
  const out: Syllable[] = [];
  const tokens = text.normalize('NFKD').toLowerCase().match(/[a-z']+|[.!?;:,—–-]/g) ?? [];
  let t = 0;
  let sentence: Syllable[] = [];
  let chant = 0;
  const closeSentence = (question: boolean) => {
    const n = sentence.length;
    sentence.forEach((s, i) => {
      const progress = n <= 1 ? 0 : i / (n - 1);
      let pitch = s.pitch;
      if (profile.contour !== 'chant') pitch *= 1.08 - 0.18 * progress;
      if (question && i >= n - 2) pitch *= 1.18;
      out.push({ ...s, pitch: Math.round(pitch * 1000) / 1000 });
    });
    sentence = [];
  };
  for (const tok of tokens) {
    if (/^[.!?]$/.test(tok)) {
      closeSentence(tok === '?');
      t += 0.45 / sp;
      continue;
    }
    if (/^[;:,—–-]$/.test(tok)) {
      t += 0.22 / sp;
      continue;
    }
    const groups = tok.match(/[aeiouy]+/g) ?? ['a'];
    groups.slice(0, 4).forEach((g, i) => {
      const accent = i === 0;
      const dur = (profile.syllableS + (accent ? 0.04 : 0)) / sp;
      let pitch = accent ? 1.06 : 1;
      if (profile.contour === 'lilt') pitch *= i % 2 === 0 ? 1.04 : 0.97;
      if (profile.contour === 'chant') pitch = 2 ** ((CHANT_STEPS[chant++ % CHANT_STEPS.length] ?? 0) / 12);
      sentence.push({ vowel: VOWEL_OF[g[0] ?? 'a'] ?? 'a', at: Math.round(t * 1000) / 1000, dur: Math.round(dur * 1000) / 1000, pitch, level: accent ? 1 : 0.8 });
      t += dur;
    });
    t += 0.04 / sp;
  }
  closeSentence(false);
  return out;
}

/** Length of a syllable plan in seconds (0 for an empty plan). */
export function planSeconds(plan: readonly Syllable[]): number {
  let end = 0;
  for (const s of plan) end = Math.max(end, s.at + s.dur);
  return end;
}

/** Plays the tone-coded murmur of a line; returns the voice and its length. */
export function playVoiceTones(env: SfxEnv, role: VoiceRole, text: string, speed: number, when: number): { voice: SfxVoice; durationS: number } {
  const profile = VOICE_PROFILES[role];
  const plan = syllablePlan(text, profile, speed);
  const durationS = Math.max(0.3, planSeconds(plan));
  const v = new Voice(env, when, when + durationS + 0.4);
  const amp = gainNode(v.ctx, 0, v.gain);
  const bank = formantBank(v.ctx, plan[0]?.vowel ?? 'a', 3, amp);
  const o = v.ctx.createOscillator();
  o.type = 'sawtooth';
  const base = profile.toneHz * env.rate * between(env, 0.98, 1.02);
  o.frequency.value = base;
  o.connect(bank);
  o.start(when);
  o.stop(when + durationS + 0.3);
  v.track(o);
  if (profile.breath > 0) {
    const n = v.ctx.createBufferSource();
    // Breath: the formant bank also filters a little noise.
    const noise = v.ctx.createGain();
    noise.gain.value = profile.breath * 0.25;
    noise.connect(bank);
    n.buffer = v.ctx.createBuffer(1, Math.floor(v.ctx.sampleRate * 0.5), v.ctx.sampleRate);
    const d = n.buffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = env.rnd() * 2 - 1;
    n.loop = true;
    n.connect(noise);
    n.start(when);
    n.stop(when + durationS + 0.3);
    v.track(n);
  }
  amp.gain.setValueAtTime(0, when);
  for (const s of plan) {
    const t = when + s.at;
    o.frequency.setTargetAtTime(base * s.pitch, t, 0.03);
    glideVowel(bank, s.vowel, t, Math.min(0.06, s.dur / 2));
    amp.gain.setTargetAtTime(0.32 * s.level, t, 0.015);
    amp.gain.setTargetAtTime(0.04, t + s.dur * 0.75, 0.025);
  }
  amp.gain.setTargetAtTime(0, when + durationS, 0.04);
  return { voice: v, durationS };
}
