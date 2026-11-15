/**
 * art-prompts: writes ../ART_PROMPTS.md, one image-generator prompt for every painted scene in the game
 * (everything except the map), each opening with the same style block (style.ts).
 *
 *   npm run tool -- art-prompts
 *
 * The scenes are data in home.ts, travel.ts and events.ts. Scenes marked 'manifest' are checked against the
 * asset manifest (id, path and size), so a prompt can never name a file the game would not load.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST_FRAGMENTS } from '../../src/content/assets/index';
import { EVENT_GROUPS } from './events';
import { HOME_GROUPS } from './home';
import { HOW_TO, promptFor, type Anchor, type ArtGroup, type ArtScene } from './style';
import { TRAVEL_GROUPS } from './travel';

const GAME_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_FILE = join(GAME_ROOT, '..', 'ART_PROMPTS.md');

/** The order the owner works through the groups: what is seen most comes first. */
const ORDER: readonly string[] = [
  'The home village',
  'Inside the buildings',
  'Meetings at sea',
  'Title picture and homeland cards',
  'Arriving at a settlement',
  'Ashore: on the quay',
  'After the assault',
  'Meetings on the march',
  'Battle and voyage cards',
  'Event pictures: the household and the realm',
  'Event pictures: stories',
  'Event pictures: sea, weather and omens',
  'Event pictures: the life of the realm',
  'Arriving in other lands',
];

const WHEN: Readonly<Record<ArtGroup['priority'], string>> = { 1: 'First', 2: 'Second', 3: 'Third', 4: 'Can wait' };

interface Numbered {
  n: number;
  group: ArtGroup;
  scene: ArtScene;
}

function pad(n: number): string {
  return String(n).padStart(3, '0');
}

function orderedGroups(): ArtGroup[] {
  const all = [...HOME_GROUPS, ...TRAVEL_GROUPS, ...EVENT_GROUPS];
  const out: ArtGroup[] = [];
  for (const title of ORDER) {
    const g = all.find((x) => x.title === title);
    if (!g) throw new Error(`art-prompts: no group titled '${title}'`);
    out.push(g);
  }
  const missing = all.filter((g) => !ORDER.includes(g.title));
  if (missing.length > 0) throw new Error(`art-prompts: groups missing from ORDER: ${missing.map((g) => g.title).join(', ')}`);
  return out;
}

interface ManifestImage {
  kind?: string;
  path?: string;
  size?: readonly number[];
}

function manifestEntry(id: string): ManifestImage | undefined {
  for (const raw of Object.values(MANIFEST_FRAGMENTS)) {
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && Object.hasOwn(raw, id)) {
      return (raw as Record<string, ManifestImage>)[id];
    }
  }
  return undefined;
}

/** Problems with the scene data (duplicate ids or files, a 'manifest' scene that does not match the manifest). */
export function validate(list: readonly Numbered[]): string[] {
  const issues: string[] = [];
  const ids: Record<string, number> = {};
  const files: Record<string, number> = {};
  for (const { n, scene } of list) {
    if (files[scene.file] !== undefined) issues.push(`#${pad(n)} repeats the file of #${pad(files[scene.file] ?? 0)}: ${scene.file}`);
    files[scene.file] = n;
    const entry = manifestEntry(scene.id);
    if (scene.season) {
      // A season's own painting of an id: the id must exist and the file is its path with the season added.
      const want = entry?.path?.replace(/(\.[a-z]+)?$/, (ext) => `-${scene.season}${ext}`);
      if (!entry) issues.push(`#${pad(n)} ${scene.id}: a ${scene.season} painting of an id that is not in the asset manifest`);
      else if (want !== scene.file) issues.push(`#${pad(n)} ${scene.id}: ${scene.season} painting should be ${String(want)}, not ${scene.file}`);
      continue;
    }
    if (ids[scene.id] !== undefined) issues.push(`#${pad(n)} repeats the id of #${pad(ids[scene.id] ?? 0)}: ${scene.id}`);
    ids[scene.id] = n;
    if (scene.status === 'manifest') {
      if (!entry) issues.push(`#${pad(n)} ${scene.id}: marked 'manifest' but not in the asset manifest`);
      else {
        if (entry.path !== scene.file) issues.push(`#${pad(n)} ${scene.id}: file ${scene.file} but the manifest says ${String(entry.path)}`);
        if (entry.size?.[0] !== scene.size[0] || entry.size?.[1] !== scene.size[1]) issues.push(`#${pad(n)} ${scene.id}: size ${scene.size.join('×')} but the manifest says ${String(entry.size?.join('×'))}`);
      }
    } else if (entry && (entry.path !== scene.file || entry.size?.[0] !== scene.size[0] || entry.size?.[1] !== scene.size[1])) {
      issues.push(`#${pad(n)} ${scene.id}: is in the manifest with a different path or size`);
    }
  }
  for (const anchor of ['outdoor', 'indoor', 'sea'] as const) {
    if (list.filter((x) => x.scene.isAnchor && x.scene.anchor === anchor).length !== 1) issues.push(`there must be exactly one ${anchor} anchor picture`);
  }
  return issues;
}

function saveName(n: number, scene: ArtScene): string {
  const base = (scene.file.split('/').pop() ?? scene.file).replace(/\.[a-z]+$/, '');
  return `${pad(n)}-${base}.png`;
}

function attachLine(scene: ArtScene): string {
  if (!scene.isAnchor) return `\`anchor-${scene.anchor}.png\``;
  if (scene.anchor === 'outdoor') return 'nothing. This picture becomes `anchor-outdoor.png`';
  return `\`anchor-outdoor.png\`. Then save a copy of the result as \`anchor-${scene.anchor}.png\``;
}

function sceneBlock({ n, scene }: Numbered): string {
  const lines = [
    `### ${pad(n)} · ${scene.title}`,
    '',
    `- **Attach:** ${attachLine(scene)}`,
    `- **Save as:** \`art\\incoming\\${saveName(n, scene)}\``,
    `- **In the game:** \`${scene.id}\`, ${scene.size[0]}×${scene.size[1]}, \`public/assets/${scene.file}\` (${scene.season ? `its own ${scene.season} painting` : scene.status === 'manifest' ? 'the slot exists today' : 'new slot'})`,
  ];
  if (scene.note) lines.push(`- **Note:** ${scene.note}`);
  lines.push('', '```text', promptFor(scene), '```', '');
  return lines.join('\n');
}

function build(): string {
  const groups = orderedGroups();
  const list: Numbered[] = [];
  let n = 0;
  for (const group of groups) for (const scene of group.scenes) list.push({ n: ++n, group, scene });
  const issues = validate(list);
  if (issues.length > 0) throw new Error(`art-prompts: fix the scene data first:\n  ${issues.join('\n  ')}`);

  const anchorNo = (a: Anchor): string => pad(list.find((x) => x.scene.isAnchor && x.scene.anchor === a)?.n ?? 0);
  const howTo = HOW_TO.replaceAll('{outdoor}', anchorNo('outdoor')).replaceAll('{indoor}', anchorNo('indoor')).replaceAll('{sea}', anchorNo('sea'));

  const out: string[] = [
    '# Bardia: art prompts',
    '',
    '_Built by `npm run tool -- art-prompts` (in the `game` folder) from `game/tools/art-prompts/`. Change the style or a scene there and run it again; do not edit this file by hand._',
    '',
    `**${list.length} pictures**, every painted scene in the game except the map. Each prompt opens with the same style block, so the pictures match even when you make them one at a time.`,
    '',
    howTo,
    '',
    '## The groups',
    '',
    '| Group | Pictures | Numbers | When |',
    '|---|---|---|---|',
  ];
  for (const group of groups) {
    const mine = list.filter((x) => x.group === group);
    const first = mine[0]?.n ?? 0;
    const last = mine[mine.length - 1]?.n ?? 0;
    out.push(`| ${group.title} | ${mine.length} | ${pad(first)}${last !== first ? ` to ${pad(last)}` : ''} | ${WHEN[group.priority]} |`);
  }
  out.push('');
  for (const group of groups) {
    out.push(`## ${group.title}`, '', group.intro, '');
    for (const item of list.filter((x) => x.group === group)) out.push(sceneBlock(item));
  }
  return `${out.join('\n').trimEnd()}\n`;
}

const text = build();
writeFileSync(OUT_FILE, text, 'utf8');
const count = (text.match(/^### \d{3} /gm) ?? []).length;
console.log(`art-prompts: wrote ${count} prompts to ${OUT_FILE}`);
