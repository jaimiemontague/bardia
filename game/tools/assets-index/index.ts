/**
 * assets-index: indexes the owner's final art/music/voice files and reports every asset's status.
 *
 *   npm run tool -- assets-index            scan public/assets/, write public/assets/final-index.json
 *                                           and ASSET_LIST.md, print a summary
 *   npm run tool -- assets-index --check    write nothing; exit 1 if either file is out of date
 *                                           (for CI: "which ids are still placeholders", §27.4)
 *   npm run tool -- assets-index --strict   also exit 1 on size/duration mismatches or stray files
 *
 * The client loads final-index.json at runtime to prefer final files over placeholders, so after
 * dropping files into public/assets/ run this tool (dev builds also probe for new files directly).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST_FRAGMENTS, validateAssetManifest } from '../../src/content/assets/index';
import { buildAssetList, scanFinalFiles, serializeIndex, type ManifestEntryLike } from './lib';

const GAME_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSETS_DIR = join(GAME_ROOT, 'public', 'assets');
const INDEX_FILE = join(ASSETS_DIR, 'final-index.json');
const LIST_FILE = join(GAME_ROOT, 'ASSET_LIST.md');

function main(): void {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const strict = args.includes('--strict');
  const quiet = args.includes('--quiet');

  if (!existsSync(ASSETS_DIR)) mkdirSync(ASSETS_DIR, { recursive: true });
  const index = scanFinalFiles(ASSETS_DIR);
  const issues = validateAssetManifest();
  const fragments: Record<string, Record<string, ManifestEntryLike>> = {};
  for (const [area, raw] of Object.entries(MANIFEST_FRAGMENTS)) {
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) fragments[area] = raw as Record<string, ManifestEntryLike>;
  }
  const list = buildAssetList(fragments, index, issues);
  const indexText = serializeIndex(index);

  if (check) {
    const staleIndex = !existsSync(INDEX_FILE) || readFileSync(INDEX_FILE, 'utf8') !== indexText;
    const staleList = !existsSync(LIST_FILE) || readFileSync(LIST_FILE, 'utf8') !== list.markdown;
    if (staleIndex) console.error('public/assets/final-index.json is out of date: run `npm run tool -- assets-index`');
    if (staleList) console.error('ASSET_LIST.md is out of date: run `npm run tool -- assets-index`');
    if (staleIndex || staleList) process.exitCode = 1;
  } else {
    writeFileSync(INDEX_FILE, indexText);
    writeFileSync(LIST_FILE, list.markdown);
  }

  if (!quiet) {
    console.log(`assets: ${list.total} ids: ${list.final} final, ${list.placeholder} placeholder; ${Object.keys(index.files).length} file(s) in public/assets/`);
    if (!check) console.log('wrote public/assets/final-index.json and ASSET_LIST.md');
    for (const i of issues) console.warn(`manifest: ${i}`);
    for (const w of list.warnings) console.warn(`warning: ${w}`);
    for (const o of list.orphans) console.warn(`unused file: public/assets/${o}`);
  }
  if (strict && (issues.length > 0 || list.warnings.length > 0 || list.orphans.length > 0)) process.exitCode = 1;
}

main();
