/**
 * Player settings (design §25.7 accessibility, §25.8 settings). Stored per browser profile in
 * localStorage as JSON and validated with zod on load: every field has a default and recovers on
 * its own (`.catch`), so an old, partial or hand-edited settings blob never resets everything.
 */
import { z } from 'zod';
import { defaultBindings, normalizeCombo } from '../input/bindings';

export const SETTINGS_VERSION = 1;

/** UI scale range (§25.1: 75–150 %). */
export const UI_SCALE_RANGE = { min: 75, max: 150, step: 5 } as const;
/** Text size range (§25.7: 90–150 %). */
export const TEXT_SIZE_RANGE = { min: 90, max: 150, step: 5 } as const;

const percent = (min: number, max: number, def: number) =>
  z
    .number()
    .finite()
    .transform((n) => Math.round(Math.min(max, Math.max(min, n))))
    .catch(def);
const volume = (def: number) => percent(0, 100, def);
const flag = (def: boolean) => z.boolean().catch(def);
function choice<const T extends readonly [string, ...string[]]>(values: T, def: T[number]) {
  return z.enum(values).catch(def);
}
const asObject = (v: unknown): unknown => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {});
/** An object section that never fails: non-objects become {}, every field recovers on its own. */
function section<S extends z.ZodRawShape>(shape: S) {
  return z.preprocess(asObject, z.object(shape));
}

export const THEMES = ['oak', 'parchment'] as const;
export const FONTS = ['standard', 'hyperlegible'] as const;
export const COLOR_BLIND_MODES = ['none', 'deuteranopia', 'protanopia', 'tritanopia'] as const;
export const NARRATION_SPEEDS = ['slow', 'normal', 'fast', 'instant'] as const;
export const AUTOSAVE_MODES = ['off', 'monthly', 'standard'] as const;
export const FPS_CAPS = ['30', '60', '120', 'unlimited'] as const;
export const LANGUAGES = ['en'] as const;

export type ThemeId = (typeof THEMES)[number];
export type FontChoice = (typeof FONTS)[number];
export type ColorBlindMode = (typeof COLOR_BLIND_MODES)[number];
export type NarrationSpeed = (typeof NARRATION_SPEEDS)[number];
export type AutosaveMode = (typeof AUTOSAVE_MODES)[number];

const BindingsSchema = z.preprocess(
  asObject,
  z.record(z.string(), z.unknown()).transform((stored) => {
    const out = defaultBindings();
    for (const [id, combos] of Object.entries(stored)) {
      if (!Object.hasOwn(out, id) || !Array.isArray(combos)) continue;
      out[id] = combos
        .filter((c): c is string => typeof c === 'string')
        .map(normalizeCombo)
        .filter((c) => c.length > 0)
        .slice(0, 3);
    }
    return out;
  }),
);

export const SettingsSchema = section({
  version: z.number().int().catch(SETTINGS_VERSION),
  video: section({
    uiScale: percent(UI_SCALE_RANGE.min, UI_SCALE_RANGE.max, 100),
    fullscreen: flag(false),
    fpsCap: choice(FPS_CAPS, '60'),
    vsync: flag(true),
    theme: choice(THEMES, 'oak'),
  }),
  audio: section({
    master: volume(80),
    music: volume(70),
    sfx: volume(80),
    ambience: volume(60),
    voice: volume(85),
    narration: flag(true),
  }),
  gameplay: section({
    /** Auto-pause rules (§7.2, §25.9). Pending decisions always stop time (the simulation enforces it). */
    autoPause: section({
      critical: flag(true),
      important: flag(false),
      encounters: flag(true),
      arrival: flag(true),
      storms: flag(true),
      envoys: flag(true),
      birthsDeaths: flag(true),
      holdingAttacked: flag(true),
      lowFood: flag(true),
    }),
    tutorialTips: flag(true),
    counsel: flag(true),
    haggling: flag(true),
    flirt: flag(true),
    blood: flag(true),
    autosave: choice(AUTOSAVE_MODES, 'standard'),
    confirmDialogs: flag(true),
  }),
  accessibility: section({
    textSize: percent(TEXT_SIZE_RANGE.min, TEXT_SIZE_RANGE.max, 100),
    font: choice(FONTS, 'standard'),
    highContrast: flag(false),
    colorBlind: choice(COLOR_BLIND_MODES, 'none'),
    reducedMotion: flag(false),
    cameraShake: flag(true),
    narrationSpeed: choice(NARRATION_SPEEDS, 'normal'),
    autoAdvance: flag(false),
    holdToToggle: flag(false),
    speakerLabels: flag(true),
    duelSlowMotion: flag(false),
    parryWindowBonus: percent(0, 100, 0),
  }),
  controls: section({
    bindings: BindingsSchema,
    gamepad: flag(true),
  }),
  language: choice(LANGUAGES, 'en'),
  dev: section({ console: flag(false) }),
});

export type Settings = z.output<typeof SettingsSchema>;
export type AutoPauseRules = Settings['gameplay']['autoPause'];
export type AudioSettings = Settings['audio'];

/** Parses stored settings (anything) into a complete, valid Settings object. */
export function parseSettings(raw: unknown): Settings {
  const parsed = SettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : SettingsSchema.parse({});
}

/** Factory defaults. */
export function defaultSettings(): Settings {
  return SettingsSchema.parse({});
}
