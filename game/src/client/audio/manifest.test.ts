/**
 * Manifest coverage (§28.5): every music state, stem, stinger, SFX id/variant and voice role has a
 * valid entry in src/content/assets/manifest/music.json, in sync with the catalog.
 *
 * Regenerate the file after a catalog change:
 *   BARDIA_WRITE_AUDIO_MANIFEST=1 npx vitest run src/client/audio/manifest.test.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateAssetManifest } from '@content/assets/index';
import { AssetManifestFragmentSchema } from '@content/schemas/assets';
import musicStrings from '@content/locales/en/music.json';
import { expectedAudioAssetIds, MUSIC_STATES, SFX, SFX_IDS, sfxDef, STINGERS, VOICE_ROLES, voiceRoleAssetId } from './catalog';
import { AUDIO_GENERATORS, buildAudioManifest, FINAL_TRACK_SECONDS } from './manifestSpec';
import { SFX_SYNTHS } from './sfxSynth';
import { STINGER_DEFS } from './stingers';
import { MUSIC_STYLES } from './styles';

const FILE = fileURLToPath(new URL('../../content/assets/manifest/music.json', import.meta.url));
const built = buildAudioManifest();
if (process.env.BARDIA_WRITE_AUDIO_MANIFEST === '1') writeFileSync(FILE, `${JSON.stringify(built, null, 2)}\n`);
const onDisk = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, unknown>;
const strings = musicStrings as Record<string, string>;

describe('audio manifest (music.json)', () => {
  it('is a valid fragment of the music area', () => {
    expect(validateAssetManifest({ music: onDisk })).toEqual([]);
    expect(AssetManifestFragmentSchema.safeParse(onDisk).success).toBe(true);
  });

  it('has an entry for every catalog id and nothing else', () => {
    const expected = expectedAudioAssetIds().sort();
    expect(Object.keys(onDisk).sort()).toEqual(expected);
    expect(new Set(expected).size).toBe(expected.length);
  });

  it('matches the catalog exactly (regenerate with BARDIA_WRITE_AUDIO_MANIFEST=1)', () => {
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(built)));
  });

  it('covers at least the 16 design music states with loops, durations and briefs', () => {
    expect(MUSIC_STATES.length).toBeGreaterThanOrEqual(16);
    for (const s of MUSIC_STATES) {
      const e = built[`music.track.${s}`];
      expect(e?.kind).toBe('music');
      if (e?.kind !== 'music') continue;
      expect(e.loop).toBe(true);
      // Placeholder loops are whole phrases near 2½ minutes; a delivered track keeps its own length
      // (the new-saga sting is about half a minute).
      expect(e.durationS).toBeGreaterThan(FINAL_TRACK_SECONDS[s] === undefined ? 60 : 20);
      expect(String(e.placeholder.params?.brief ?? '').length).toBeGreaterThan(20);
      expect(e.placeholder.generator).toBe(AUDIO_GENERATORS.music);
    }
    for (const id of STINGERS) expect(built[`music.stinger.${id}`]).toMatchObject({ kind: 'music', loop: false });
  });

  it('gives every SFX its loop flag and duration from the catalog, one file per variant', () => {
    for (const id of SFX_IDS) {
      const def = sfxDef(id);
      const entries = Object.entries(built).filter(([k]) => k === `music.sfx.${id}` || k.startsWith(`music.sfx.${id}.`));
      expect(entries.length).toBeGreaterThan(0);
      for (const [, e] of entries) {
        expect(e).toMatchObject({ kind: 'sfx', loop: def.loop, durationS: def.durationS });
        if (e.kind === 'sfx') expect(e.placeholder.params?.brief).toBe(def.brief);
      }
    }
  });

  it('uses unique, lower-case final-file paths', () => {
    const paths = Object.values(built).map((e) => e.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) expect(p).toMatch(/^(music|sfx|voice)\/[a-z0-9/_-]+\.ogg$/);
  });

  it('gives every voice role an audition line that exists in the locale file', () => {
    for (const role of VOICE_ROLES) {
      const e = built[voiceRoleAssetId(role)];
      expect(e?.kind).toBe('voice');
      if (e?.kind !== 'voice') continue;
      expect(e.voice).toBe(role);
      expect(strings[e.lineKey]).toBeTruthy();
      expect(e.placeholder.label).toMatch(/placeholder voice/i);
    }
  });
});

describe('catalog completeness', () => {
  it('every state has a style, every stinger a definition, every SFX a renderer', () => {
    for (const s of MUSIC_STATES) expect(MUSIC_STYLES[s].id).toBe(s);
    for (const id of STINGERS) expect(STINGER_DEFS[id].id).toBe(id);
    expect(Object.keys(SFX_SYNTHS).sort()).toEqual([...SFX_IDS].sort());
  });

  it('every state, stinger, SFX, group, parameter, enum value and voice role has a locale string', () => {
    const missing: string[] = [];
    const need = (k: string) => {
      if (!strings[k]) missing.push(k);
    };
    for (const s of MUSIC_STATES) need(`music.state.${s}`);
    for (const id of STINGERS) need(`music.stinger.${id}`);
    for (const id of SFX_IDS) {
      need(`music.sfx.${id}`);
      need(`music.sfx.group.${id.split('.')[0]}`);
      for (const [name, p] of Object.entries(SFX[id].params)) {
        need(`music.sfx.param.${name}`);
        if (p.kind === 'enum') for (const v of p.values) need(`music.sfx.value.${v}`);
      }
    }
    for (const role of VOICE_ROLES) {
      need(`music.voice.${role}.name`);
      need(`music.voice.${role}.sample`);
    }
    expect(missing).toEqual([]);
  });
});
