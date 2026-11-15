import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { audioDuration, buildAssetList, checkFinal, crc32, imageSize, matchFinal, measureFile, scanFinalFiles, serializeIndex, type ManifestEntryLike } from './lib';

function png(w: number, h: number): Uint8Array {
  const p = new PNG({ width: w, height: h });
  p.data.fill(200);
  return new Uint8Array(PNG.sync.write(p));
}

function wav(seconds: number, rate = 8000): Uint8Array {
  const samples = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  return new Uint8Array(buf);
}

const icon: ManifestEntryLike = { kind: 'image', path: 'ui/icons/silver.png', size: [64, 64], placeholder: { generator: 'icon', params: { glyph: 'silver' }, label: 'Silver coin icon' } };
const strip: ManifestEntryLike = { kind: 'image', path: 'battle/axe-walk.png', size: [48, 48], frames: 6, placeholder: { generator: 'unitSprite' } };
const theme: ManifestEntryLike = { kind: 'music', path: 'music/main-theme.ogg', durationS: 120, loop: true, placeholder: { generator: 'audio.music' } };

describe('measuring', () => {
  it('computes the standard CRC-32 check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe('cbf43926');
  });

  it('reads PNG, SVG, JPEG headers and WAV durations', () => {
    expect(imageSize(png(37, 21), 'png')).toEqual({ width: 37, height: 21 });
    expect(imageSize(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"></svg>'), 'svg')).toEqual({ width: 120, height: 80 });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(imageSize(jpeg, 'jpg')).toEqual({ width: 64, height: 32 });
    expect(audioDuration(wav(1.5), 'wav')).toBe(1.5);
    expect(measureFile(wav(2), 'x.wav')).toMatchObject({ durationS: 2 });
    expect(measureFile(png(4, 4), 'x.png')).toMatchObject({ width: 4, height: 4 });
  });
});

describe('matching manifest entries to files', () => {
  it('takes the exact path, else the same stem in another accepted format', () => {
    expect(matchFinal('ui/icons/silver.png', 'image', { 'ui/icons/silver.png': { bytes: 1, hash: 'a' } })).toBe('ui/icons/silver.png');
    expect(matchFinal('ui/icons/silver.png', 'image', { 'ui/icons/silver.webp': { bytes: 1, hash: 'a' } })).toBe('ui/icons/silver.webp');
    expect(matchFinal('ui/icons/silver.png', 'image', { 'ui/icons/silver.ogg': { bytes: 1, hash: 'a' } })).toBeUndefined();
    expect(matchFinal('music/main-theme.ogg', 'music', { 'music/main-theme.mp3': { bytes: 1, hash: 'a' } })).toBe('music/main-theme.mp3');
  });

  it('warns about wrong sizes, strips and durations', () => {
    expect(checkFinal('i', icon, 'ui/icons/silver.png', { bytes: 1, hash: 'a', width: 64, height: 64 })).toEqual([]);
    expect(checkFinal('i', icon, 'ui/icons/silver.png', { bytes: 1, hash: 'a', width: 128, height: 128 })[0]).toContain('same aspect ratio');
    expect(checkFinal('s', strip, 'battle/axe-walk.png', { bytes: 1, hash: 'a', width: 48, height: 48 })[0]).toContain('6 frames');
    expect(checkFinal('s', strip, 'battle/axe-walk.png', { bytes: 1, hash: 'a', width: 288, height: 48 })).toEqual([]);
    expect(checkFinal('m', theme, 'music/main-theme.ogg', { bytes: 1, hash: 'a', durationS: 30 })[0]).toContain('120');
    expect(checkFinal('m', theme, 'music/main-theme.ogg', { bytes: 1, hash: 'a', durationS: 118 })).toEqual([]);
  });
});

describe('ASSET_LIST.md', () => {
  it('lists every id with kind, path, size, brief and status; reports stray files', () => {
    const index = { format: 1 as const, files: { 'ui/icons/silver.png': { bytes: 10, hash: 'a', width: 64, height: 64 }, 'ui/icons/silvr.png': { bytes: 10, hash: 'b' } } };
    const r = buildAssetList({ ui: { 'ui.icon.silver': icon, 'ui.anim.axe': strip }, music: { 'music.theme': theme }, empty: {} }, index);
    expect(r).toMatchObject({ total: 3, final: 1, placeholder: 2, orphans: ['ui/icons/silvr.png'] });
    expect(r.markdown).toContain('| `ui.icon.silver` | image | `ui/icons/silver.png` | 64×64 | Silver coin icon | final |');
    expect(r.markdown).toContain('48×48 ×6 frames (strip 288×48)');
    expect(r.markdown).toContain('~120 s, loop');
    expect(r.markdown).toContain('`ui/icons/silvr.png`');
    expect(r.markdown).not.toContain('## empty');
    // Deterministic.
    expect(buildAssetList({ ui: { 'ui.icon.silver': icon, 'ui.anim.axe': strip }, music: { 'music.theme': theme } }, index).markdown).toBe(
      buildAssetList({ ui: { 'ui.anim.axe': strip, 'ui.icon.silver': icon }, music: { 'music.theme': theme } }, index).markdown,
    );
  });
});

describe('scanning public/assets', () => {
  it('indexes files recursively (posix paths, sorted), skipping README, the index itself and dotfiles', () => {
    const root = mkdtempSync(join(tmpdir(), 'bardia-assets-'));
    try {
      mkdirSync(join(root, 'portraits', 'layers'), { recursive: true });
      writeFileSync(join(root, 'portraits', 'layers', 'face.png'), png(8, 10));
      writeFileSync(join(root, 'theme.wav'), wav(0.5));
      writeFileSync(join(root, 'README.md'), '# readme');
      writeFileSync(join(root, 'final-index.json'), '{}');
      writeFileSync(join(root, '.DS_Store'), 'x');
      const idx = scanFinalFiles(root);
      expect(Object.keys(idx.files)).toEqual(['portraits/layers/face.png', 'theme.wav']);
      expect(idx.files['portraits/layers/face.png']).toMatchObject({ width: 8, height: 10 });
      expect(idx.files['theme.wav']).toMatchObject({ durationS: 0.5 });
      const text = serializeIndex(idx);
      expect(text).toBe(serializeIndex(scanFinalFiles(root)));
      expect(JSON.parse(text)).toMatchObject({ format: 1 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
