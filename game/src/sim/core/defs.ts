/**
 * Content-definition contracts shared by several modules (design §30.7): storylets (owned by the
 * narrative module) and relics (owned by the quests module). The content packs that hold these
 * definitions validate them with zod and the owning modules build on these types, so every agent
 * codes against ONE contract. Effects inside definitions are effect data, validated against the
 * effect registry with `validateEffects(env, effects)` when the pack loads.
 *
 * Text is never English here: every `*Key` is a localisation key (src/content/locales/en/*.json),
 * every `illustration` an asset-manifest id.
 */
import type { Effect, EffectData } from './effects';
import type { GodId, RelicId, SiteKind, StoryletScope, StoryletTrigger } from './state';

/** One choice of a storylet. */
export interface StoryletChoice {
  /** Localisation key of the button label. */
  labelKey: string;
  /** Condition-language expression (§29.7); the choice is hidden/disabled when false. */
  when?: string;
  /** Localisation key of the consequence preview shown on hover. */
  previewKey?: string;
  /** Applied in order when chosen. */
  effects: (Effect | EffectData)[];
  /** Storylet id to chain into. */
  followUp?: string;
}

/** A storylet (design §19.1, §30.7). */
export interface StoryletDef {
  id: string;
  scope: StoryletScope;
  trigger: StoryletTrigger;
  /** Trigger parameters, e.g. { building: 'meadhall' } for onEnterBuilding, { age: 50 } for onAgeReached. */
  triggerParams?: Record<string, string | number | boolean>;
  /** Condition-language expression (§29.7). */
  when?: string;
  weight?: number;
  cooldownDays?: number;
  once?: boolean;
  textKey: string;
  /** Asset-manifest id. */
  illustration?: string;
  expiresInDays?: number;
  /** Index into `choices` used when the storylet is ignored or delegated. */
  defaultChoice?: number;
  choices: StoryletChoice[];
}

/** A relic definition (design §21, §30.7). Relics are revered objects; their effects are practical. */
export interface RelicDef {
  id: RelicId;
  nameKey: string;
  /** The god the relic is associated with in the characters' belief (Favor abstraction only). */
  god?: GodId;
  siteKind: SiteKind | 'heldByRuler';
  allowedRegions: string[];
  /** Guardian unit id from balance.units (humans or natural animals only) or a hazard id. */
  guardian: string;
  attunementRunecraft?: number;
  /** Effects while held (prestige, morale, loyalty, know-how). */
  effects: (Effect | EffectData)[];
  /** Localisation keys of the two legend fragments. */
  legendKeys: [string, string];
}
