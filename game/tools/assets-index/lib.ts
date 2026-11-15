/**
 * Library of the assets-index tool: scans public/assets/ for the owner's final files, measures them
 * (image size, audio duration), builds public/assets/final-index.json for the client's resolver and
 * the human-readable ASSET_LIST.md (every manifest id with its status). Pure functions over buffers
 * and plain data, so they are unit-testable; index.ts does the file I/O.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** One file of public/assets/ as recorded in final-index.json. */
export interface FinalFileInfo {
  bytes: number;
  hash: string;
  width?: number;
  height?: number;
  durationS?: number;
}

export interface FinalIndexJson {
  format: 1;
  files: Record<string, FinalFileInfo>;
}

/** A manifest entry as the tool needs it (structurally compatible with AssetEntry). */
export interface ManifestEntryLike {
  kind: 'image' | 'music' | 'sfx' | 'voice';
  path: string;
  size?: readonly [number, number];
  frames?: number;
  durationS?: number;
  loop?: boolean;
  lineKey?: string;
  voice?: string;
  placeholder: { generator: string; params?: Readonly<Record<string, string | number | boolean>>; label?: string };
}

/** Files in public/assets/ that are documentation or generated, never final art. */
export const RESERVED_FILES: readonly string[] = ['README.md', 'final-index.json'];

export const IMAGE_EXTENSIONS: readonly string[] = ['png', 'webp', 'jpg', 'jpeg', 'avif', 'svg'];
export const AUDIO_EXTENSIONS: readonly string[] = ['ogg', 'opus', 'mp3', 'm4a', 'wav', 'flac'];

// ---------------------------------------------------------------------------------------------
// Hashing

let CRC_TABLE: Uint32Array | undefined;

/** CRC-32 (IEEE) of a buffer as 8 hex digits. */
export function crc32(buf: Uint8Array): string {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (CRC_TABLE[(crc ^ (buf[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------------------------
// Measuring

function u16be(b: Uint8Array, o: number): number {
  return ((b[o] as number) << 8) | (b[o + 1] as number);
}
function u32be(b: Uint8Array, o: number): number {
  return (((b[o] as number) << 24) >>> 0) + ((b[o + 1] as number) << 16) + ((b[o + 2] as number) << 8) + (b[o + 3] as number);
}
function u16le(b: Uint8Array, o: number): number {
  return (b[o] as number) | ((b[o + 1] as number) << 8);
}
function u32le(b: Uint8Array, o: number): number {
  return ((b[o] as number) | ((b[o + 1] as number) << 8) | ((b[o + 2] as number) << 16)) + (((b[o + 3] as number) << 24) >>> 0);
}
function ascii(b: Uint8Array, o: number, len: number): string {
  let s = '';
  for (let i = 0; i < len && o + i < b.length; i++) s += String.fromCharCode(b[o + i] as number);
  return s;
}

/** Pixel size of a PNG, JPEG, WebP, GIF or SVG file (undefined when unknown). */
export function imageSize(buf: Uint8Array, ext: string): { width: number; height: number } | undefined {
  const e = ext.toLowerCase();
  if (buf.length >= 24 && ascii(buf, 1, 3) === 'PNG' && ascii(buf, 12, 4) === 'IHDR') return { width: u32be(buf, 16), height: u32be(buf, 20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = buf[o + 1] as number;
      const len = u16be(buf, o + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: u16be(buf, o + 7), height: u16be(buf, o + 5) };
      o += 2 + len;
    }
    return undefined;
  }
  if (buf.length >= 30 && ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') {
    const chunk = ascii(buf, 12, 4);
    if (chunk === 'VP8X') return { width: 1 + (u32le(buf, 24) & 0xffffff), height: 1 + ((u32le(buf, 27) >>> 0) & 0xffffff) };
    if (chunk === 'VP8 ') return { width: u16le(buf, 26) & 0x3fff, height: u16le(buf, 28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = u32le(buf, 21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
  }
  if (buf.length >= 10 && ascii(buf, 0, 3) === 'GIF') return { width: u16le(buf, 6), height: u16le(buf, 8) };
  if (e === 'svg') {
    const head = new TextDecoder().decode(buf.subarray(0, 4096));
    const tag = /<svg[^>]*>/i.exec(head)?.[0] ?? '';
    const w = /\swidth="([\d.]+)(px)?"/.exec(tag);
    const h = /\sheight="([\d.]+)(px)?"/.exec(tag);
    if (w && h) return { width: Number(w[1]), height: Number(h[1]) };
    const vb = /viewBox="[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)"/.exec(tag);
    if (vb) return { width: Number(vb[1]), height: Number(vb[2]) };
  }
  return undefined;
}

/** Duration in seconds of a WAV, OGG (Vorbis/Opus) or FLAC file (undefined when unknown, e.g. MP3). */
export function audioDuration(buf: Uint8Array, ext: string): number | undefined {
  const e = ext.toLowerCase();
  if (buf.length >= 44 && ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WAVE') {
    let o = 12;
    let byteRate = 0;
    while (o + 8 <= buf.length) {
      const id = ascii(buf, o, 4);
      const size = u32le(buf, o + 4);
      if (id === 'fmt ') byteRate = u32le(buf, o + 16);
      if (id === 'data' && byteRate > 0) return round3(size / byteRate);
      o += 8 + size + (size % 2);
    }
    return undefined;
  }
  if (buf.length >= 42 && ascii(buf, 0, 4) === 'fLaC') {
    // STREAMINFO: sample rate (20 bits) and total samples (36 bits) at offset 8 + 10.
    const o = 8 + 10;
    const rate = ((buf[o] as number) << 12) | ((buf[o + 1] as number) << 4) | ((buf[o + 2] as number) >>> 4);
    const total = ((buf[o + 3] as number) & 0x0f) * 2 ** 32 + u32be(buf, o + 4);
    return rate > 0 ? round3(total / rate) : undefined;
  }
  if (buf.length >= 58 && ascii(buf, 0, 4) === 'OggS') {
    const headerLen = 27 + (buf[26] as number);
    const packet = headerLen;
    let rate = 0;
    let preSkip = 0;
    if (ascii(buf, packet + 1, 6) === 'vorbis') rate = u32le(buf, packet + 12);
    else if (ascii(buf, packet, 8) === 'OpusHead') {
      rate = 48000;
      preSkip = u16le(buf, packet + 10);
    }
    if (rate <= 0) return undefined;
    // The last page's granule position = total samples.
    for (let o = buf.length - 14; o >= 0; o--) {
      if (buf[o] === 0x4f && ascii(buf, o, 4) === 'OggS') {
        const lo = u32le(buf, o + 6);
        const hi = u32le(buf, o + 10);
        const granule = hi * 2 ** 32 + lo;
        return round3(Math.max(0, granule - preSkip) / rate);
      }
    }
    return undefined;
  }
  void e;
  return undefined;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Measures one file. */
export function measureFile(buf: Uint8Array, path: string): FinalFileInfo {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const info: FinalFileInfo = { bytes: buf.length, hash: crc32(buf) };
  if (IMAGE_EXTENSIONS.includes(ext)) {
    const s = imageSize(buf, ext);
    if (s) {
      info.width = s.width;
      info.height = s.height;
    }
  } else if (AUDIO_EXTENSIONS.includes(ext)) {
    const d = audioDuration(buf, ext);
    if (d !== undefined) info.durationS = d;
  }
  return info;
}

// ---------------------------------------------------------------------------------------------
// Scanning

/** Recursively lists files under `root` (posix relative paths, sorted), skipping reserved files and dotfiles. */
export function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith('.')) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else {
        const rel = relative(root, full).split(sep).join('/');
        if (!RESERVED_FILES.includes(rel)) out.push(rel);
      }
    }
  };
  walk(root);
  return out.sort();
}

/** Scans `root` into a final-file index. */
export function scanFinalFiles(root: string): FinalIndexJson {
  const files: Record<string, FinalFileInfo> = {};
  for (const rel of listFiles(root)) files[rel] = measureFile(readFileSync(join(root, rel)), rel);
  return { format: 1, files };
}

/** Serialises an index deterministically (sorted keys, no timestamps). */
export function serializeIndex(index: FinalIndexJson): string {
  const files: Record<string, FinalFileInfo> = {};
  for (const k of Object.keys(index.files).sort()) {
    const f = index.files[k] as FinalFileInfo;
    const row: FinalFileInfo = { bytes: f.bytes, hash: f.hash };
    if (f.width !== undefined) row.width = f.width;
    if (f.height !== undefined) row.height = f.height;
    if (f.durationS !== undefined) row.durationS = f.durationS;
    files[k] = row;
  }
  return `${JSON.stringify({ format: 1, files }, null, 1)}\n`;
}

// ---------------------------------------------------------------------------------------------
// Matching manifest entries to files

function stem(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot > 0 ? path.slice(0, dot) : path;
}

/** The file that serves a manifest path: the exact path, else the same stem with an accepted extension. */
export function matchFinal(entryPath: string, kind: ManifestEntryLike['kind'], files: Readonly<Record<string, FinalFileInfo>>): string | undefined {
  if (Object.hasOwn(files, entryPath)) return entryPath;
  const exts = kind === 'image' ? IMAGE_EXTENSIONS : AUDIO_EXTENSIONS;
  const s = stem(entryPath);
  for (const ext of exts) {
    const p = `${s}.${ext}`;
    if (Object.hasOwn(files, p)) return p;
  }
  return undefined;
}

/** Checks a final file against its manifest entry; returns warnings. */
export function checkFinal(id: string, entry: ManifestEntryLike, file: string, info: FinalFileInfo): string[] {
  const w: string[] = [];
  const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
  if (entry.kind === 'image') {
    if (!IMAGE_EXTENSIONS.includes(ext)) w.push(`${id}: '${file}' is not an image format (${IMAGE_EXTENSIONS.join(', ')})`);
    if (entry.size && info.width !== undefined && info.height !== undefined && ext !== 'svg') {
      const frames = entry.frames ?? 1;
      const ew = entry.size[0] * frames;
      const eh = entry.size[1];
      const sameAspect = Math.abs(info.width / info.height - ew / eh) < 0.01;
      if (info.width !== ew || info.height !== eh) {
        w.push(`${id}: '${file}' is ${info.width}×${info.height}, the manifest expects ${ew}×${eh}${frames > 1 ? ` (${frames} frames of ${entry.size[0]}×${eh})` : ''}${sameAspect ? ' (same aspect ratio: it will be scaled)' : ''}`);
      }
    }
  } else {
    if (!AUDIO_EXTENSIONS.includes(ext)) w.push(`${id}: '${file}' is not an audio format (${AUDIO_EXTENSIONS.join(', ')})`);
    if (entry.durationS !== undefined && info.durationS !== undefined && Math.abs(info.durationS - entry.durationS) > Math.max(1, entry.durationS * 0.15)) {
      w.push(`${id}: '${file}' lasts ${info.durationS}s, the manifest expects about ${entry.durationS}s`);
    }
  }
  return w;
}

/** A one-line brief of an entry: its label, else its generator and params. */
export function describeEntry(entry: ManifestEntryLike): string {
  const brief = entry.placeholder.params?.brief;
  if (entry.placeholder.label) return typeof brief === 'string' && brief !== '' ? `${entry.placeholder.label}. Brief: ${brief}` : entry.placeholder.label;
  if (typeof brief === 'string' && brief !== '') return brief;
  const params = entry.placeholder.params ? Object.entries(entry.placeholder.params).map(([k, v]) => `${k}=${String(v)}`).join(', ') : '';
  if (entry.kind === 'voice') return `Voice line '${entry.lineKey ?? ''}' (${entry.voice ?? 'narrator'})`;
  return `${entry.placeholder.generator}${params ? ` (${params})` : ''}`;
}

function sizeText(entry: ManifestEntryLike): string {
  if (entry.kind === 'image' && entry.size) {
    const frames = entry.frames ?? 1;
    return frames > 1 ? `${entry.size[0]}×${entry.size[1]} ×${frames} frames (strip ${entry.size[0] * frames}×${entry.size[1]})` : `${entry.size[0]}×${entry.size[1]}`;
  }
  if (entry.kind === 'voice') return `voice: ${entry.voice ?? ''}`;
  const parts: string[] = [];
  if (entry.durationS !== undefined) parts.push(`~${entry.durationS} s`);
  if (entry.loop) parts.push('loop');
  return parts.join(', ');
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export interface AssetListResult {
  markdown: string;
  total: number;
  final: number;
  placeholder: number;
  orphans: string[];
  warnings: string[];
}

/**
 * Builds ASSET_LIST.md: a summary, problems, unreferenced files, then one table per area listing
 * every manifest id with kind, final path, size/duration, brief and status.
 */
export function buildAssetList(fragments: Readonly<Record<string, Readonly<Record<string, ManifestEntryLike>>>>, index: FinalIndexJson, manifestIssues: readonly string[] = []): AssetListResult {
  const used: Record<string, true> = {};
  const warnings: string[] = [];
  const sections: string[] = [];
  let total = 0;
  let final = 0;
  const kinds: Record<string, number> = { image: 0, music: 0, sfx: 0, voice: 0 };
  for (const area of Object.keys(fragments)) {
    const entries = fragments[area] as Readonly<Record<string, ManifestEntryLike>>;
    const ids = Object.keys(entries).sort();
    if (ids.length === 0) continue;
    const rows: string[] = [];
    let areaFinal = 0;
    for (const id of ids) {
      const e = entries[id] as ManifestEntryLike;
      total++;
      kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
      const file = matchFinal(e.path, e.kind, index.files);
      if (file) {
        used[file] = true;
        final++;
        areaFinal++;
        warnings.push(...checkFinal(id, e, file, index.files[file] as FinalFileInfo));
      }
      const status = file ? (file === e.path ? 'final' : `final (${file.slice(file.lastIndexOf('.') + 1)})`) : 'placeholder';
      rows.push(`| \`${id}\` | ${e.kind} | \`${e.path}\` | ${cell(sizeText(e))} | ${cell(describeEntry(e))} | ${status} |`);
    }
    sections.push(
      [`## ${area} (${ids.length}: ${areaFinal} final, ${ids.length - areaFinal} placeholder)`, '', '| Asset id | Kind | Final file (under public/assets/) | Size / duration | Brief | Status |', '|---|---|---|---|---|---|', ...rows, ''].join('\n'),
    );
  }
  const orphans = Object.keys(index.files).filter((f) => !used[f]).sort();
  const lines: string[] = [
    '# Bardia: asset list',
    '',
    '_Generated by `npm run tool -- assets-index` from `src/content/assets/manifest/*.json` and the files in `public/assets/`. Do not edit by hand; see ASSET_DROP_IN.md._',
    '',
    `**${total} assets: ${final} final, ${total - final} placeholder.** Images ${kinds.image ?? 0} · music ${kinds.music ?? 0} · sound effects ${kinds.sfx ?? 0} · voice ${kinds.voice ?? 0}.`,
    '',
  ];
  if (manifestIssues.length > 0 || warnings.length > 0) {
    lines.push('## Problems', '');
    for (const i of manifestIssues) lines.push(`- manifest: ${cell(i)}`);
    for (const w of warnings) lines.push(`- ${cell(w)}`);
    lines.push('');
  }
  if (orphans.length > 0) {
    lines.push('## Files no manifest entry uses', '', 'Check the name and folder against the table below (paths are lower-case, with hyphens).', '');
    for (const o of orphans) lines.push(`- \`${o}\``);
    lines.push('');
  }
  lines.push(...sections);
  return { markdown: `${lines.join('\n').trimEnd()}\n`, total, final, placeholder: total - final, orphans, warnings };
}
