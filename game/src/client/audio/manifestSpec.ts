/**
 * The audio part of the asset manifest, derived from the catalog: every music state (and battle
 * stem), stinger, SFX id/variant and voice role gets an entry naming where the owner's final file
 * goes (under public/assets/), its loop length or duration, its loop flag, the placeholder generator
 * and a brief for the composer / sound designer / voice actor.
 *
 * `src/content/assets/manifest/music.json` is this function's output; `manifest.test.ts` fails when
 * the file drifts from the catalog and rewrites it when run with BARDIA_WRITE_AUDIO_MANIFEST=1.
 */
import type { AssetEntry } from '@content/schemas/assets';
import {
  expectedAudioAssetIds,
  isStemmed,
  MUSIC_STATES,
  musicStemAssetId,
  musicTrackAssetId,
  SFX_IDS,
  sfxAssetId,
  sfxDef,
  STEM_LEVELS,
  stingerAssetId,
  STINGERS,
  VOICE_ROLES,
  voiceRoleAssetId,
  type MusicState,
  type StemLevel,
  type StingerId,
  type VoiceRole,
} from './catalog';
import { kebabKey, voiceLinePath } from './assetSource';
import { STINGER_DEFS, stingerSeconds } from './stingers';
import { barSeconds, MUSIC_STYLES } from './styles';
import { VOICE_PROFILES } from './voiceTones';

/** Placeholder generator ids used by the audio entries (`placeholder.generator`). */
export const AUDIO_GENERATORS = {
  music: 'audio.music',
  stem: 'audio.stem',
  stinger: 'audio.stinger',
  sfx: 'audio.sfx',
  voice: 'audio.voice',
} as const;

/** Composer briefs per music state (§28.1). */
export const MUSIC_BRIEFS: Readonly<Record<MusicState, string>> = {
  mainTheme: 'Main theme: a proud, weathered horn melody over lyre and frame drum; D dorian; the motif returns in the coronation cue.',
  homeSkarn: 'Skarn home hall: hearth-warm aeolian lyre and bone flute, steady frame drum; fjord-cold but familiar.',
  homeHvarn: 'Hvarn home hall: slow triple-time dorian with bowed strings and harp, forest-dark and stubborn.',
  homeEyjar: 'Eyjar home hall: lilting compound-time mixolydian with flute and lyre, salt wind and island pride.',
  sailingCalm: 'Sailing, calm seas: wide open drones, gently rocking 6/8, flute phrases far apart; the long whale-road.',
  sailingStorm: 'Sailing, storm: driving string ostinato, war drums and horn calls; spray and danger, not despair.',
  albrennCael: 'Albrenn and Cael lands: harp and chant over drones, dorian, monastery stillness and green hills.',
  corvaine: 'Corvaine: courtly mixolydian dance in three, fiddle and lyre, the confidence of horsemen.',
  velkarSaraleon: 'Velkar river markets and Saraleon: phrygian oud and flute over a busy drum, wealth and old empire.',
  meadHallRowdy: 'Mead-hall, rowdy (diegetic): fast jig-like fiddle and lyre with clapping; a hall band in full cry.',
  meadHallLament: 'Mead-hall, lament (diegetic): a single hummed voice and lyre, late-night memory of the fallen.',
  battleShieldwall: 'Battle, shield wall: aeolian war drums and drone (low stem), string ostinato and choir (mid), horn calls and fiddle (high). Stems loop in sync.',
  battleRaid: 'Battle, raid: fast phrygian assault; drums and drone (low), ostinato and choir (mid), horn, flute and driving slaps (high). Stems loop in sync.',
  duel: 'Duel: heartbeat drums and a tense phrygian pedal; the fiddle enters as the fight intensifies.',
  delve: 'Delve / mystery: cave reverb, sparse flute and harp over a low drone; wonder and unease without anything supernatural.',
  allthing: 'Allthing: dignified dorian procession with horn calls and steady drum; law spoken on the rock.',
  funeral: 'Funeral / epitaph: slow aeolian dirge, choir and horn, a single toll per bar.',
  coronation: 'Coronation / victory: the main-theme motif reborn in mixolydian with fanfare, choir and full drums.',
  newSaga: 'New saga: a short, hopeful opening as a founder and homeland are chosen; the main-theme motif in waiting.',
  worldMap: 'World map: broad and searching, horn and strings over a slow drum; the whole whale-road laid out.',
  greatHall: 'Great hall: stately hearth-hall music for the jarl’s seat, lyre and strings with a measured drum.',
  longhouse: 'Longhouse: homely and close, lyre and soft flute by the family fire.',
  smithy: 'Smithy: steady working rhythm, low strings and drum keeping time like a hammer.',
  shipyard: 'Shipyard: busy and salt-bright, lilting lyre and flute over the craft of keel and strake.',
  market: 'Market: bustling trade music, oud-like plucking, flute and quick hand drums.',
  meadHallWarm: 'Mead-hall, warm (diegetic): a gentle hall band playing for friends; lyre and humming, cups and fire.',
  battleSea: 'Battle at sea: rowing drums and driving strings, horn calls across the water; one full track, no stems.',
  arrival: 'Arrival: landfall at a new shore; wide strings and horn, wonder and wariness.',
  expedition: 'Expedition: planning a voyage; purposeful, rocking compound time with lyre and drone.',
  victory: 'Victory: triumphant fanfare, choir and full drums after the battle is won.',
  chronicle: 'Chronicle: reflective saga-telling music for reading the deeds of the house; lyre and voice.',
  wedding: 'Wedding: festive and tender, lyre, flute and clapping drum for a marriage feast.',
  birth: 'Birth: soft and luminous, harp and humming for a child born to the house.',
  settlement: 'Settlement: steady building music for a growing steading; lyre, flute and drum.',
  affairs: 'Affairs of the realm: measured, thoughtful council music; strings and lyre over a quiet drum.',
};

/** Briefs for the stingers. */
export const STINGER_BRIEFS: Readonly<Record<StingerId, string>> = {
  omen: 'Omen read: phrygian choir cluster and high flute over a deep drum; an uneasy sign.',
  birth: 'Birth in the family: rising harp arpeggio, flute and warm strings.',
  death: 'Death: falling horn line over choir and three slow drum strokes.',
  victory: 'Victory: horn fanfare to the octave with drums and strings.',
  defeat: 'Defeat: falling strings and a low horn over a war-drum hit.',
  relicFound: 'Relic found: shimmering harp ascent with choir; awe and weight of history.',
};

/** Casting briefs per voice role (§26.2). */
export const VOICE_BRIEFS: Readonly<Record<VoiceRole, string>> = {
  narrator: 'Narrator: warm, wry, a little ironic; an old storyteller by the fire.',
  skald: 'Skald: declaimed alliterative verse with kennings; measured, ringing, proud.',
  hirdmaster: 'Hirdmaster: blunt, loyal, dry and practical; few words, low voice.',
  steward: 'Steward: careful, precise, slightly anxious about the stores.',
  seer: 'Seer: quiet, breathy, unhurried; speaks of omens as signs to be weighed.',
  rival: 'The Rival: venomous wit, amused contempt.',
  npc: 'Townsfolk and leaders: culture-specific; Albric formal-pious, Corvani courtly, Velkar mercantile-proud, Saraleonese imperial-bored.',
};

const TARGET_LOOP_S = 150;

/** Loop length guidance for a state's final file: whole phrases close to 2½ minutes. */
export function trackLoopSeconds(state: MusicState): number {
  const style = MUSIC_STYLES[state];
  const phraseS = style.phraseBars * barSeconds(style);
  const phrases = Math.max(1, Math.round(TARGET_LOOP_S / phraseS));
  return Math.round(phrases * phraseS * 10) / 10;
}

function label(text: string): string {
  return `Placeholder: ${text}`;
}

function humanize(id: string): string {
  return kebabKey(id).replace(/-/g, ' ');
}

/** Final-file path of a music state's full track. */
export function musicTrackPath(state: MusicState): string {
  return `music/${kebabKey(state)}.ogg`;
}

/** Final-file path of a battle stem. */
export function musicStemPath(state: MusicState, level: StemLevel): string {
  return `music/stems/${kebabKey(state)}-${level}.ogg`;
}

/** Final-file path of a stinger. */
export function stingerPath(id: StingerId): string {
  return `music/stingers/${kebabKey(id)}.ogg`;
}

/** Final-file path of an SFX (variant files for variant ids). */
export function sfxPath(id: string, variant?: string): string {
  const [group, ...rest] = id.split('.');
  const name = kebabKey(rest.join('-'));
  return `sfx/${kebabKey(group ?? 'misc')}/${name}${variant === undefined ? '' : `-${kebabKey(variant)}`}.ogg`;
}

/** Locale key of a voice role's audition line. */
export function voiceSampleKey(role: VoiceRole): string {
  return `music.voice.${role}.sample`;
}

/**
 * Real lengths of the owner's delivered final tracks. A final track need not match the generative
 * placeholder's loop length, so the manifest records the delivered length for the assets-index check.
 */
export const FINAL_TRACK_SECONDS: Partial<Record<MusicState, number>> = {
  affairs: 160.1,
  allthing: 148.1,
  arrival: 147.3,
  battleRaid: 66.1,
  battleSea: 71.3,
  battleShieldwall: 167.7,
  birth: 157.7,
  chronicle: 214.9,
  coronation: 154.8,
  delve: 199.7,
  expedition: 185,
  funeral: 180,
  greatHall: 157.6,
  homeEyjar: 188.4,
  homeHvarn: 198.5,
  homeSkarn: 202.5,
  longhouse: 192.5,
  mainTheme: 128.4,
  market: 193.3,
  meadHallLament: 238.8,
  meadHallRowdy: 173.4,
  meadHallWarm: 141.9,
  newSaga: 34.8,
  sailingCalm: 197.2,
  settlement: 196.9,
  shipyard: 172.5,
  smithy: 159.7,
  victory: 269.9,
  wedding: 177.5,
  worldMap: 175,
};

/** Builds every audio manifest entry from the catalog (deterministic order). */
export function buildAudioManifest(): Record<string, AssetEntry> {
  const out: Record<string, AssetEntry> = {};
  for (const state of MUSIC_STATES) {
    const style = MUSIC_STYLES[state];
    const durationS = FINAL_TRACK_SECONDS[state] ?? trackLoopSeconds(state);
    const params = { state, mode: style.mode, tonic: style.tonic, bpm: style.bpm, meter: `${style.beats}x${style.sub}`, brief: MUSIC_BRIEFS[state] };
    out[musicTrackAssetId(state)] = {
      kind: 'music',
      path: musicTrackPath(state),
      durationS,
      loop: true,
      placeholder: { generator: AUDIO_GENERATORS.music, params, label: label(`${humanize(state)} (generative score)`) },
    };
    if (isStemmed(state)) {
      for (const level of STEM_LEVELS) {
        out[musicStemAssetId(state, level)] = {
          kind: 'music',
          path: musicStemPath(state, level),
          durationS,
          loop: true,
          placeholder: {
            generator: AUDIO_GENERATORS.stem,
            params: { state, level, layers: style.layers.filter((l) => l.stem === level).map((l) => l.id).join(','), brief: `${level} intensity stem of ${humanize(state)}; same length and tempo as the other stems.` },
            label: label(`${humanize(state)} ${level} stem`),
          },
        };
      }
    }
  }
  for (const id of STINGERS) {
    out[stingerAssetId(id)] = {
      kind: 'music',
      path: stingerPath(id),
      durationS: Math.round((stingerSeconds(STINGER_DEFS[id]) + 1.5) * 10) / 10,
      loop: false,
      placeholder: { generator: AUDIO_GENERATORS.stinger, params: { stinger: id, brief: STINGER_BRIEFS[id] }, label: label(`${humanize(id)} stinger`) },
    };
  }
  for (const id of SFX_IDS) {
    const def = sfxDef(id);
    const vp = def.variantParam === undefined ? undefined : def.params[def.variantParam];
    const variants = vp && vp.kind === 'enum' ? vp.values : [undefined];
    for (const variant of variants) {
      const params: Record<string, string> = { sfx: id, bus: def.bus, brief: def.brief };
      if (variant !== undefined && def.variantParam !== undefined) params[def.variantParam] = variant;
      out[sfxAssetId(id, variant)] = {
        kind: 'sfx',
        path: sfxPath(id, variant),
        durationS: def.durationS,
        loop: def.loop,
        placeholder: { generator: AUDIO_GENERATORS.sfx, params, label: label(`${humanize(id)}${variant === undefined ? '' : ` (${variant})`}`) },
      };
    }
  }
  for (const role of VOICE_ROLES) {
    const p = VOICE_PROFILES[role];
    const key = voiceSampleKey(role);
    out[voiceRoleAssetId(role)] = {
      kind: 'voice',
      path: voiceLinePath(key, role),
      lineKey: key,
      voice: role,
      placeholder: {
        generator: AUDIO_GENERATORS.voice,
        params: { role, ttsRate: p.ttsRate, ttsPitch: p.ttsPitch, toneHz: p.toneHz, brief: VOICE_BRIEFS[role], linePathPattern: `voice/${role}/<locale-key-in-kebab-case>.ogg` },
        label: `Placeholder voice: ${role}`,
      },
    };
  }
  // Sanity: the builder covers exactly the catalog's expected ids.
  const expected = expectedAudioAssetIds();
  if (expected.length !== Object.keys(out).length) throw new Error('buildAudioManifest: catalog/manifest id mismatch');
  return out;
}
