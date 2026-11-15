/**
 * Audio catalogs (design §28): the music states, stingers, sound effects and voice roles the game
 * can ask for, the five volume buses (§28.4), and the asset-manifest ids each of them resolves to.
 *
 * Code and content refer to audio ONLY through these ids (§28.5). Every id below has an entry in
 * src/content/assets/manifest/music.json naming where the owner's final file goes; until that file
 * exists the client plays a procedural placeholder (generative music, synthesized SFX, labelled TTS
 * or tone-coded voice). `catalog.test.ts` proves the manifest covers the whole catalog.
 */
import type { CultureId } from '@content/schemas/ids';
import type { WindStrength } from '@sim/core/state';

// ---------------------------------------------------------------------------------------------
// Buses

/** The five volume buses (§28.4, §25.8). `master` scales the other four. */
export const BUS_IDS = ['master', 'music', 'sfx', 'ambience', 'voice'] as const;
export type BusId = (typeof BUS_IDS)[number];
/** A bus that sounds are routed to (everything except master). */
export type OutputBus = Exclude<BusId, 'master'>;
export const OUTPUT_BUSES: readonly OutputBus[] = ['music', 'sfx', 'ambience', 'voice'];

// ---------------------------------------------------------------------------------------------
// Music (§28.1)

/**
 * Music states (§28.1: main theme, home hall ×3, sailing calm/storm, three regional themes,
 * mead-hall ×2 (diegetic), battle ×2 with intensity stems, duel, delve, Allthing, funeral,
 * coronation). Screens request one with `useMusicState(state)`.
 */
export const MUSIC_STATES = [
  'mainTheme',
  'homeSkarn',
  'homeHvarn',
  'homeEyjar',
  'sailingCalm',
  'sailingStorm',
  'albrennCael',
  'corvaine',
  'velkarSaraleon',
  'meadHallRowdy',
  'meadHallLament',
  'battleShieldwall',
  'battleRaid',
  'duel',
  'delve',
  'allthing',
  'funeral',
  'coronation',
] as const;
export type MusicState = (typeof MUSIC_STATES)[number];
/** A music request: a state, or explicit silence. */
export type MusicRequest = MusicState | 'silence';

/** Battle tracks are delivered as three synchronised intensity stems (§28.1 "intensity stems"). */
export const STEM_LEVELS = ['low', 'mid', 'high'] as const;
export type StemLevel = (typeof STEM_LEVELS)[number];
export const STEMMED_STATES = ['battleShieldwall', 'battleRaid'] as const satisfies readonly MusicState[];
export type StemmedState = (typeof STEMMED_STATES)[number];

/** Short musical cues laid over the current music (§28.1 "stingers for omens, births and deaths"). */
export const STINGERS = ['omen', 'birth', 'death', 'victory', 'defeat', 'relicFound'] as const;
export type StingerId = (typeof STINGERS)[number];

/** The music state for a homeland culture's hall (§28.1 Home Hall ×3). */
export function homeHallState(culture: CultureId): MusicState {
  if (culture === 'hvarn') return 'homeHvarn';
  if (culture === 'eyjar') return 'homeEyjar';
  return 'homeSkarn';
}

/** The regional theme for a culture's lands (§28.1: Albrenn and Cael, Corvaine, Velkar and Saraleon). */
export function regionalState(culture: CultureId): MusicState {
  switch (culture) {
    case 'albric':
    case 'cael':
      return 'albrennCael';
    case 'corvani':
      return 'corvaine';
    case 'velkar':
    case 'saraleonese':
    case 'kurgai':
      return 'velkarSaraleon';
    default:
      return homeHallState(culture);
  }
}

// ---------------------------------------------------------------------------------------------
// Sound effects (§28.2)

/** A numeric SFX parameter. */
export interface NumberParamDef {
  readonly kind: 'number';
  readonly min: number;
  readonly max: number;
  readonly default: number;
  readonly step?: number;
}
/** An enumerated SFX parameter. */
export interface EnumParamDef {
  readonly kind: 'enum';
  readonly values: readonly string[];
  readonly default: string;
}
export type SfxParamDef = NumberParamDef | EnumParamDef;

/** One sound effect's catalog entry. */
export interface SfxDef {
  /** Bus the sound is routed to. */
  readonly bus: OutputBus;
  /** Loops until stopped (ambience beds, fire, oars) instead of playing once. */
  readonly loop: boolean;
  /** Typical length (one-shots) or loop length for the owner's final file, in seconds. */
  readonly durationS: number;
  /** Most simultaneous voices of this id; the oldest is stopped beyond it. */
  readonly maxVoices: number;
  /** Parameters (besides the common `volume`, `pan`, `rate`). */
  readonly params: { readonly [name: string]: SfxParamDef };
  /** An enum parameter whose value selects a separate final file (`music.sfx.<id>.<value>`). */
  readonly variantParam?: string;
  /** One-line brief for the sound designer (manifest). */
  readonly brief: string;
}

const WIND_VALUES = ['calm', 'light', 'fresh', 'strong', 'gale'] as const satisfies readonly WindStrength[];
const CULTURE_VALUES = [
  'skarn',
  'hvarn',
  'eyjar',
  'albric',
  'cael',
  'corvani',
  'velkar',
  'kurgai',
  'saraleonese',
  'isafolder',
  'rime',
] as const satisfies readonly CultureId[];

const unit = (def: number): NumberParamDef => ({ kind: 'number', min: 0, max: 1, default: def, step: 0.05 });

/**
 * Every sound effect id (§28.2 groups: UI, sea, weather, battle, duel, town ambience, animals).
 * Play with `playSfx(id, params)`.
 */
export const SFX = {
  'ui.click': { bus: 'sfx', loop: false, durationS: 0.08, maxVoices: 4, params: {}, brief: 'Dry wooden click, a peg seated in a carved board.' },
  'ui.coin': { bus: 'sfx', loop: false, durationS: 0.5, maxVoices: 4, params: {}, brief: 'Two or three hacksilver pieces dropped into a palm.' },
  'ui.parchment': { bus: 'sfx', loop: false, durationS: 0.45, maxVoices: 3, params: {}, brief: 'Vellum unrolled or a page turned.' },
  'ui.confirm': { bus: 'sfx', loop: false, durationS: 0.25, maxVoices: 3, params: {}, brief: 'Two rising wood knocks: accepted.' },
  'ui.deny': { bus: 'sfx', loop: false, durationS: 0.3, maxVoices: 3, params: {}, brief: 'A dull low thud: not possible.' },

  'sea.waves': {
    bus: 'ambience',
    loop: true,
    durationS: 30,
    maxVoices: 2,
    params: { wind: { kind: 'enum', values: WIND_VALUES, default: 'light' } },
    variantParam: 'wind',
    brief: 'Open-water bed heard from a low hull; one loop per wind class, from glassy swell to breaking gale seas.',
  },
  'sea.oars': {
    bus: 'ambience',
    loop: true,
    durationS: 20,
    maxVoices: 2,
    params: { strokesPerMin: { kind: 'number', min: 12, max: 40, default: 24, step: 1 } },
    brief: 'Thirty oars in time: catch splash, oar-port knock, wash. Tempo follows the stroke rate.',
  },
  'sea.sailFlap': { bus: 'sfx', loop: false, durationS: 1.2, maxVoices: 3, params: { strength: unit(0.5) }, brief: 'Woollen square sail luffing and filling.' },
  'sea.hullCreak': { bus: 'ambience', loop: false, durationS: 1.5, maxVoices: 3, params: {}, brief: 'Clinker planks and rivets working in a swell.' },
  'sea.splash': { bus: 'sfx', loop: false, durationS: 1.0, maxVoices: 4, params: { size: unit(0.5) }, brief: 'Anchor stone, a man overboard, a keel run onto shingle.' },

  'weather.rain': { bus: 'ambience', loop: true, durationS: 30, maxVoices: 2, params: { intensity: unit(0.5) }, brief: 'Rain on water and wool; drizzle to downpour.' },
  'weather.wind': { bus: 'ambience', loop: true, durationS: 30, maxVoices: 2, params: { strength: unit(0.5) }, brief: 'Gusting wind in rigging, rising to a howl.' },
  'weather.thunder': { bus: 'ambience', loop: false, durationS: 6, maxVoices: 2, params: { distance: unit(0.4) }, brief: 'Thunder from a sharp overhead crack to a far roll.' },

  'battle.clash': { bus: 'sfx', loop: false, durationS: 1.0, maxVoices: 6, params: { count: { kind: 'number', min: 1, max: 8, default: 3, step: 1 } }, brief: 'Iron on iron, axe on rim: a flurry of blows.' },
  'battle.shieldBash': { bus: 'sfx', loop: false, durationS: 0.5, maxVoices: 4, params: {}, brief: 'Linden-board shield driven into another; boss clank.' },
  'battle.arrowVolley': { bus: 'sfx', loop: false, durationS: 2.4, maxVoices: 3, params: { size: unit(0.5) }, brief: 'A volley of self-bow arrows: release, whistle, thuds.' },
  'battle.fire': { bus: 'sfx', loop: true, durationS: 20, maxVoices: 3, params: { size: unit(0.5) }, brief: 'Burning thatch and timber: roar and crackle.' },
  'battle.seaFire': { bus: 'sfx', loop: false, durationS: 3, maxVoices: 2, params: {}, brief: 'Saraleonese sea-fire siphon: pressurised whoosh, then clinging flame.' },
  'battle.warHorn': {
    bus: 'sfx',
    loop: false,
    durationS: 3.5,
    maxVoices: 2,
    params: { call: { kind: 'enum', values: ['muster', 'charge', 'retreat'], default: 'muster' } },
    variantParam: 'call',
    brief: 'Cow-horn or bronze lur signals: one long muster, three rising charge blasts, two falling retreat calls.',
  },
  'battle.crowdRoar': {
    bus: 'sfx',
    loop: false,
    durationS: 3.5,
    maxVoices: 3,
    params: { culture: { kind: 'enum', values: CULTURE_VALUES, default: 'skarn' }, size: unit(0.6) },
    variantParam: 'culture',
    brief: 'A host roaring or chanting; each culture has its own cadence and vowel.',
  },
  'battle.warCry': {
    bus: 'sfx',
    loop: false,
    durationS: 1.6,
    maxVoices: 3,
    params: { culture: { kind: 'enum', values: CULTURE_VALUES, default: 'skarn' } },
    variantParam: 'culture',
    brief: 'A short culture-specific war cry from a handful of throats.',
  },

  'duel.impact': {
    bus: 'sfx',
    loop: false,
    durationS: 0.6,
    maxVoices: 4,
    params: { material: { kind: 'enum', values: ['wood', 'metal', 'flesh'], default: 'metal' } },
    variantParam: 'material',
    brief: 'A single blow landing on shield-wood, mail or iron, or a body (no gore).',
  },
  'duel.grunt': { bus: 'sfx', loop: false, durationS: 0.4, maxVoices: 2, params: { effort: unit(0.5) }, brief: 'Effort grunt of a fighter (placeholder is a tone-coded formant burst).' },

  'town.market': { bus: 'ambience', loop: true, durationS: 30, maxVoices: 2, params: {}, brief: 'Harbour market murmur: haggling, calls, carts.' },
  'town.smithy': { bus: 'ambience', loop: true, durationS: 20, maxVoices: 2, params: {}, brief: 'Hammer on anvil in threes, bellows, forge roar.' },
  'town.hallChatter': { bus: 'ambience', loop: true, durationS: 30, maxVoices: 2, params: {}, brief: 'Mead-hall talk and laughter, cups, the hearth.' },
  'town.gulls': { bus: 'ambience', loop: true, durationS: 30, maxVoices: 2, params: {}, brief: 'Herring gulls over a harbour.' },
  'town.churchBell': {
    bus: 'ambience',
    loop: false,
    durationS: 8,
    maxVoices: 2,
    params: { tolls: { kind: 'number', min: 1, max: 6, default: 3, step: 1 } },
    brief: 'A hand-cast bronze bell of a Lantern house tolling (Lantern lands only).',
  },

  'animal.wolfHowl': { bus: 'ambience', loop: false, durationS: 3.5, maxVoices: 2, params: {}, brief: 'A distant wolf howl across a valley.' },
  'animal.raven': { bus: 'ambience', loop: false, durationS: 1.2, maxVoices: 2, params: {}, brief: 'Raven calls from a tree line.' },
  'animal.hoofbeats': {
    bus: 'sfx',
    loop: true,
    durationS: 10,
    maxVoices: 2,
    params: { pace: { kind: 'enum', values: ['walk', 'trot', 'gallop'], default: 'trot' } },
    brief: 'Horses on turf; Corvani horsemen or steppe riders. Tempo follows the pace.',
  },
} as const satisfies { readonly [id: string]: SfxDef };

export type SfxId = keyof typeof SFX;
export const SFX_IDS = Object.keys(SFX) as SfxId[];

type ParamValueOf<D> = D extends { readonly kind: 'enum'; readonly values: readonly (infer V)[] } ? V : number;

/** Parameters every sound accepts. */
export interface CommonSfxParams {
  /** Linear gain multiplier 0..1 (default 1). */
  volume?: number;
  /** Stereo position −1..1 (default 0). */
  pan?: number;
  /** Playback-rate / pitch multiplier (default 1; final files and placeholders). */
  rate?: number;
}

/** The typed parameter bag for one SFX id. */
export type SfxParams<I extends SfxId> = CommonSfxParams & {
  -readonly [K in keyof (typeof SFX)[I]['params']]?: ParamValueOf<(typeof SFX)[I]['params'][K]>;
};

/** Loose parameter bag used internally (validated against the catalog by `resolveSfxParams`). */
export type SfxParamBag = Readonly<Record<string, number | string | undefined>>;

/** The catalog entry for an id (widened to `SfxDef`). */
export function sfxDef(id: SfxId): SfxDef {
  return SFX[id];
}

/**
 * Fills defaults and clamps/validates a parameter bag against the catalog: numbers are clamped to
 * their range, unknown enum values fall back to the default, unknown keys are dropped.
 */
export function resolveSfxParams(id: SfxId, params: SfxParamBag = {}): Record<string, number | string> {
  const def = sfxDef(id);
  const out: Record<string, number | string> = {};
  for (const [name, p] of Object.entries(def.params)) {
    const v = params[name];
    if (p.kind === 'number') {
      const n = typeof v === 'number' && Number.isFinite(v) ? v : p.default;
      out[name] = Math.min(p.max, Math.max(p.min, n));
    } else {
      out[name] = typeof v === 'string' && p.values.includes(v) ? v : p.default;
    }
  }
  return out;
}

/** The variant value a parameter bag selects (or undefined for ids without variants). */
export function sfxVariant(id: SfxId, params: SfxParamBag = {}): string | undefined {
  const def = sfxDef(id);
  if (def.variantParam === undefined) return undefined;
  const v = resolveSfxParams(id, params)[def.variantParam];
  return typeof v === 'string' ? v : undefined;
}

// ---------------------------------------------------------------------------------------------
// Voice (§26.2, §26.6)

/**
 * Voice roles (§26.2 voices; the sim's `VoiceId` names narrator, skald, hirdmaster, steward and
 * seer). `npc` covers leaders and townsfolk; `rival` is the Rival's venomous wit.
 */
export const VOICE_ROLES = ['narrator', 'skald', 'hirdmaster', 'steward', 'seer', 'rival', 'npc'] as const;
export type VoiceRole = (typeof VOICE_ROLES)[number];

/** Maps any voice id from the sim (open string union) onto a known role (unknown → npc). */
export function voiceRoleOf(voice: string | undefined): VoiceRole {
  return (VOICE_ROLES as readonly string[]).includes(voice ?? '') ? (voice as VoiceRole) : 'npc';
}

// ---------------------------------------------------------------------------------------------
// Asset ids (manifest area 'music')

export const musicTrackAssetId = (state: MusicState): string => `music.track.${state}`;
export const musicStemAssetId = (state: StemmedState, level: StemLevel): string => `music.stem.${state}.${level}`;
export const stingerAssetId = (id: StingerId): string => `music.stinger.${id}`;
/** `music.sfx.<id>` or, for a variant, `music.sfx.<id>.<variant>`. */
export const sfxAssetId = (id: SfxId, variant?: string): string => (variant === undefined ? `music.sfx.${id}` : `music.sfx.${id}.${variant}`);
export const voiceRoleAssetId = (role: VoiceRole): string => `music.voice.${role}`;

/** True for a stemmed (battle) state. */
export function isStemmed(state: MusicState): state is StemmedState {
  return (STEMMED_STATES as readonly string[]).includes(state);
}

/** Every asset id the audio catalog expects in the manifest (coverage test, CI placeholder report). */
export function expectedAudioAssetIds(): string[] {
  const ids: string[] = [];
  for (const s of MUSIC_STATES) {
    ids.push(musicTrackAssetId(s));
    if (isStemmed(s)) for (const l of STEM_LEVELS) ids.push(musicStemAssetId(s, l));
  }
  for (const s of STINGERS) ids.push(stingerAssetId(s));
  for (const id of SFX_IDS) {
    const def = sfxDef(id);
    const vp = def.variantParam === undefined ? undefined : def.params[def.variantParam];
    if (vp !== undefined && vp.kind === 'enum') for (const v of vp.values) ids.push(sfxAssetId(id, v));
    else ids.push(sfxAssetId(id));
  }
  for (const r of VOICE_ROLES) ids.push(voiceRoleAssetId(r));
  return ids;
}
