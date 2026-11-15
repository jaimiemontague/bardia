/**
 * Locale coverage for the shell's areas (ui, menu): every literal key in the shell's source exists,
 * and every templated key family (`ui.route.${id}`, `ui.action.${id}`, …) is complete for the
 * values it is used with. A missing key never crashes the game (t() falls back to the key), so
 * this test is what keeps raw keys off the screen.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { MANIFEST_FRAGMENTS } from '@content/assets/index';
import { EN_TABLES } from '@content/locales/index';
import { ATTRIBUTE_IDS, DIFFICULTY_IDS, FAITH_IDS, SETTLEMENT_TIER_IDS, SKILL_IDS } from '@content/schemas/ids';
import { PENDING_OWNERS } from '@sim/core/ownership';
import { MONTHS, WEEKDAYS } from '@sim/core/time';
import { WIZARD_STEPS, TOGGLE_IDS, PORTRAIT_LAYERS } from '../app/newSaga/model';
import { OPEN_ACTION_ROUTES } from '../app/globalActions';
import { ACTIONS } from '../input/bindings';
import { GAMEPAD_BUTTON_ACTIONS } from '../input/gamepad';
import { AUTOSAVE_MODES, COLOR_BLIND_MODES, FONTS, LANGUAGES, NARRATION_SPEEDS, THEMES, defaultSettings } from '../settings/schema';
import { DEV_COMMANDS } from '../devtools/commands';
import { HALL_BUILDINGS } from '../screens/hubPlaceholder/index';

const strings: Record<string, string> = { ...(EN_TABLES.ui as Record<string, string>), ...(EN_TABLES.menu as Record<string, string>) };
const has = (k: string) => Object.hasOwn(strings, k);
const missing = (keys: readonly string[]) => keys.filter((k) => !has(k));

/** The folders this agent owns (other client areas have their own locale files and tests). */
const OWNED = ['app', 'devtools', 'i18n', 'input', 'saves', 'settings', 'shell', 'theme', 'ui', 'testing', join('screens', 'mainMenu'), join('screens', 'newSaga'), join('screens', 'options'), join('screens', 'saveLoad'), join('screens', 'hubPlaceholder'), join('screens', 'inbox'), join('screens', 'gameMenu'), join('screens', 'credits')];
const CLIENT = join(process.cwd(), 'src', 'client');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Action ids ('ui.back') and asset-manifest ids ('menu.backdrop.main') look like keys but are not. */
const NOT_KEYS = new Set<string>([
  ...ACTIONS.map((a) => a.id),
  ...Object.values(GAMEPAD_BUTTON_ACTIONS),
  ...Object.keys((MANIFEST_FRAGMENTS.ui ?? {}) as object),
  ...Object.keys((MANIFEST_FRAGMENTS.menu ?? {}) as object),
]);

describe('shell locale coverage', () => {
  it('every literal ui./menu. key in the shell source has a string', () => {
    const problems: string[] = [];
    for (const folder of OWNED) {
      const dir = join(CLIENT, folder);
      let files: string[];
      try {
        files = statSync(dir).isDirectory() ? sourceFiles(dir) : [];
      } catch {
        continue;
      }
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(/['"`]((?:ui|menu)\.[A-Za-z0-9_.]+)['"`]/g)) {
          const key = m[1] as string;
          if (NOT_KEYS.has(key) || key.endsWith('.') || /\.(css|tsx?|json)$/.test(key)) continue;
          if (!has(key)) problems.push(`${relative(CLIENT, file)}: ${key}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('templated key families are complete', () => {
    const content = getContent();
    const settings = defaultSettings();
    const families: string[] = [
      ...ACTIONS.map((a) => a.labelKey),
      ...Object.values(GAMEPAD_BUTTON_ACTIONS).map((a) => `ui.action.${a}`),
      ...Object.values(OPEN_ACTION_ROUTES).map((r) => `ui.route.${r}`),
      ...['character', 'family', 'ledger', 'chronicle', 'sagaLedger', 'codex', 'inbox', 'gameMenu', 'options', 'saveLoad', 'credits', 'mainMenu', 'newSaga'].map((r) => `ui.route.${r}`),
      ...HALL_BUILDINGS.flatMap((b) => [`ui.hubPlaceholder.building.${b.id}`, `ui.route.building.${b.id}`]),
      ...content.balance.renown.tiers.map((t) => `ui.renownTier.${t.id}`),
      ...DIFFICULTY_IDS.flatMap((d) => [`ui.difficulty.${d}`, `ui.difficultyDesc.${d}`]),
      ...SKILL_IDS.flatMap((s) => [`ui.skill.${s}`, `ui.skillDesc.${s}`]),
      ...ATTRIBUTE_IDS.flatMap((a) => [`ui.attribute.${a}`, `ui.attributeDesc.${a}`]),
      ...FAITH_IDS.map((f) => `ui.faith.${f}`),
      ...SETTLEMENT_TIER_IDS.map((t) => `ui.tier.${t}`),
      ...[0, 1, 2, 3, 4].map((n) => `ui.fortTier.${n}`),
      ...Object.keys(content.balance.startBuildings).map((b) => `ui.building.${b}`),
      ...['renown', 'honor', 'dread', 'favor', 'faithWrath', 'piety'].flatMap((s) => [`ui.standing.${s}`, `ui.standing.${s}Desc`]),
      ...['critical', 'important', 'info'].map((t) => `ui.notify.tier.${t}`),
      ...['skald', 'hirdmaster', 'steward', 'seer', 'narrator'].map((v) => `ui.voice.${v}`),
      ...Object.keys(PENDING_OWNERS).map((k) => `ui.decision.kind.${k}`),
      ...['settlement', 'fleet', 'character', 'faction', 'site', 'province', 'army', 'map', 'screen'].map((k) => `ui.link.${k}`),
      ...MONTHS.map((m) => `ui.calendar.month.${m.charAt(0).toLowerCase()}${m.slice(1)}`),
      ...WEEKDAYS.map((d) => `ui.calendar.weekday.${d.charAt(0).toLowerCase()}${d.slice(1)}`),
      ...['spring', 'summer', 'autumn', 'winter'].map((s) => `ui.calendar.season.${s}`),
      ...['all', 'unread', 'critical', 'important', 'info'].map((f) => `ui.inbox.filter.${f}`),
      ...WIZARD_STEPS.flatMap((s) => [`menu.newSaga.step.${s}`, `menu.newSaga.intro.${s}`]),
      ...TOGGLE_IDS.flatMap((id) => [`menu.newSaga.option.${id}`, `menu.newSaga.option.${id}Hint`]),
      ...PORTRAIT_LAYERS.map((k) => `menu.newSaga.identity.layer.${k}`),
      ...['father', 'mother'].flatMap((p) => [`menu.newSaga.parentage.${p}`, `menu.newSaga.parentage.${p}Desc`]),
      ...['video', 'audio', 'gameplay', 'accessibility', 'controls', 'language'].map((id) => `menu.options.tab.${id}`),
      ...THEMES.map((th) => `menu.options.video.theme.${th}`),
      ...LANGUAGES.map((l) => `menu.options.language.${l}`),
      ...AUTOSAVE_MODES.map((m) => `menu.options.gameplay.autosave.${m}`),
      ...Object.keys(settings.gameplay.autoPause).map((k) => `menu.options.gameplay.autoPause.${k}`),
      ...['tutorialTips', 'counsel', 'haggling', 'flirt', 'blood', 'confirmDialogs'].flatMap((k) => [`menu.options.gameplay.${k}`, `menu.options.gameplay.${k}Hint`]),
      ...['global', 'map', 'battle', 'duel', 'menu'].filter((c) => ACTIONS.some((a) => a.context === c)).map((c) => `menu.options.controls.context.${c}`),
      ...['master', 'music', 'sfx', 'ambience', 'voice'].map((c) => `menu.options.audio.${c}`),
      ...['good', 'bad', 'warn', 'info'].map((s) => `menu.options.access.state.${s}`),
      ...NARRATION_SPEEDS.map((s) => `menu.options.access.speed.${s}`),
      ...FONTS.map((f) => `menu.options.access.font.${f}`),
      ...COLOR_BLIND_MODES.map((m) => `menu.options.access.cb.${m}`),
      ...['manual', 'auto', 'ironman'].map((k) => `menu.saves.kind.${k}`),
      ...['delete', 'overwrite', 'load'].flatMap((k) => [`menu.saves.confirm.${k}`, `menu.saves.confirm.${k}Title`, `menu.saves.confirm.${k}Body`]),
      ...['design', 'engineering', 'art', 'music', 'writing', 'testing'].flatMap((s) => [`menu.credits.section.${s}`, `menu.credits.body.${s}`]),
      ...DEV_COMMANDS.map((c) => c.descKey),
    ];
    expect(missing(families)).toEqual([]);
  });

  it('every province tag in the world pack has a label', () => {
    // Read raw: the world pack is another agent's and may be mid-edit.
    const dir = join(process.cwd(), 'src', 'content', 'data', 'world', 'regions');
    let tags: string[] = [];
    try {
      for (const f of readdirSync(dir)) {
        const pack = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { provinces?: { tags?: unknown }[] };
        for (const p of pack.provinces ?? []) if (Array.isArray(p.tags)) tags.push(...p.tags.filter((t): t is string => typeof t === 'string'));
      }
    } catch {
      tags = [];
    }
    const unlabelled = [...new Set(tags)].filter((t) => t !== 'royalSeat' && !has(`ui.provinceTag.${t}`));
    expect(unlabelled).toEqual([]);
  });
});
