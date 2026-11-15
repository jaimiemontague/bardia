/**
 * Narrative augmentations of the kernel types (ARCHITECTURE.md §4) and the module's public contracts.
 * Every augmented field is optional: core factories, old saves and other modules' tests build these
 * objects without knowing about them. `init`/`migrate` fill them in (see slice.ts).
 */
import type { StoryletChoice, StoryletDef } from '@sim/core/defs';
import type { Hour, JsonValue, PendingId, StoryletScope, StoryletTrigger, TextVars } from '@sim/core/state';

// ---------------------------------------------------------------------------------------------
// Content contracts (core/defs.ts StoryletDef plus the narrative module's optional extensions).

/** A storylet choice as the narrative module reads it. */
export interface StoryletChoiceSpec extends StoryletChoice {
  /** Chronicle entry written when this choice is taken (overrides the storylet's `chronicleKey`). */
  chronicleKey?: string;
}

/** A storylet as the narrative module reads it (src/content/storylets.ts validates the JSON shape). */
export interface StoryletSpec extends StoryletDef {
  choices: StoryletChoiceSpec[];
  /** Short title for inbox lists and notifications. */
  titleKey?: string;
  /** May the steward settle it under the petitions policy? Default: holding scope with a default choice. */
  delegable?: boolean;
  /** Chronicle importance of the outcome. */
  importance?: number;
  /** Chronicle entry written when the storylet resolves (a choice's own key overrides it). */
  chronicleKey?: string;
  /** Instance variables: name → expression, evaluated once when the storylet fires. */
  vars?: Record<string, string>;
}

/** A storylet's scope reference (same shape as the core pending payload's `scope`). */
export interface StoryletScopeRef {
  kind: StoryletScope;
  id?: string;
}

/** Entity roots of the condition language that are bound to ids (ConditionEvalContext.scope). */
export type EntityRoot = 'settlement' | 'holding' | 'faction' | 'character' | 'fleet';
/** Root → entity id. */
export type ScopeBindings = Partial<Record<EntityRoot, string>>;

/** How a fired storylet reached the player. */
export type StoryletDelivery = 'pending' | 'inbox' | 'delegated';
/** How a storylet instance ended. */
export type StoryletResolution = 'chosen' | 'default' | 'delegated' | 'expired' | 'lapsed';

/** A fired storylet that has not been resolved yet: the current/queued decision, or waiting in the inbox. */
export interface StoryletInstance {
  /** 'stl_<n>' */
  id: string;
  storyletId: string;
  trigger: StoryletTrigger;
  scope: StoryletScopeRef;
  /** Condition-language bindings (root → id) captured when it fired. */
  bindings: ScopeBindings;
  /** Text variables (standard vars, scheduler vars and the storylet's own `vars`). */
  vars: TextVars;
  /** Copy of the triggering event's payload (scalars, shallow), for `event.*` paths. */
  event?: Record<string, JsonValue>;
  firedHour: Hour;
  /** Hour the default choice is applied while waiting in the inbox. */
  expiresHour?: Hour;
  /** 'pending': a 'storylet' decision exists (current or queued); 'waiting': in the Affairs of State inbox. */
  status: 'pending' | 'waiting';
  pendingId?: PendingId;
  /** Follow-up depth (0 for a storylet fired by its trigger). */
  chain: number;
}

/** What the client shows for one choice of a pending storylet. */
export interface StoryletChoiceView {
  index: number;
  labelKey: string;
  previewKey?: string;
  /** Snapshot of the choice's `when` when the decision was raised (recompute with storyletView()). */
  available: boolean;
}

/** Per-session anti-repetition memory of the line pools (§26.3). */
export interface LineMemory {
  /** Bumped by the `narrativeSession` command (the client sends it after a new game or a load). */
  session: number;
  /** Lines spoken in total (seeds the pure line draw). */
  draws: number;
  /** Pool id → line ids spoken this session, oldest first. */
  recent: Record<string, string[]>;
  /** `${poolId}:${lineId}` → times spoken ever (weights decay with use). */
  uses: Record<string, number>;
  /** Pool id → the line spoken last (lets the UI re-render the line it showed). */
  last: Record<string, string>;
}

/** Verse kinds the skald composes. */
export type VerseKind = 'yearEnd' | 'epitaph';

/** A deed to be sung (the saga module passes the year's or the life's top deeds). */
export interface VerseDeed {
  /** battle | raid | duel | voyage | marriage | birth | death | relic | crown | thing | feud | … (else 'default'). */
  kind: string;
  importance?: number;
  /** Plain values for the template: place, foe, spouse, child, deceased, relic, crown … */
  vars?: TextVars;
}

/** One composed verse line: a template key, its vars, and which vars hold kenning keys to resolve first. */
export interface VerseLine {
  key: string;
  vars: TextVars;
  keyVars: string[];
}

/** A composed verse stored for its requester. */
export interface ComposedVerse {
  kind: VerseKind;
  hour: Hour;
  lines: VerseLine[];
}

/** Parameters of the `composeVerse` effect op. */
export interface ComposeVerseParams {
  kind: VerseKind;
  deeds: VerseDeed[];
  /** Where the verse is stored: `state.storylets.verses[targetKey]` (e.g. 'yearEnd:813', 'epitaph:chr_5'). */
  targetKey: string;
  /** Who the verse is about (fills {name}). */
  subject?: { name: string; sex?: 'male' | 'female' };
  /** Fills {year} (year-end verses). */
  year?: number;
  /** Epitaph tier 0–4 (§23.6); picks 'epitaph.close.tier<N>' templates when the bank has them. */
  tier?: number;
}

/** Parameters of the `fireStoryletTrigger` effect op. */
export interface FireStoryletTriggerParams {
  /** A storylet trigger (onEnterBuilding, onLanding, onThing, …). */
  trigger: string;
  /** The entity the firing is about (merged into `bindings`). */
  scope?: { kind: string; id?: string };
  /** Further entity bindings (settlement, holding, faction, character, fleet → id). */
  bindings?: Record<string, string>;
  /** Matched by equality against storylets' `triggerParams` (e.g. { building: 'meadhall' }); also `event.*`. */
  params?: Record<string, string | number | boolean>;
  /** Extra text vars for the fired storylet. */
  vars?: TextVars;
}

// ---------------------------------------------------------------------------------------------
// Kernel augmentations.

declare module '@sim/core/state' {
  interface StoryletsState {
    /** Active (unresolved) storylet instances by id. */
    instances?: Record<string, StoryletInstance>;
    /** daysSince() marks: storylet id / domain event type / `chronicle:<kind>` → last hour. */
    marks?: Record<string, Hour>;
    /** count('fired' | 'event' | 'chronicle', key) tallies, same keys as `marks`. */
    tallies?: Record<string, number>;
    /** Line-pool memory. */
    lines?: LineMemory;
    /** Composed verses by target key. */
    verses?: Record<string, ComposedVerse>;
  }
  interface StoryletPayload {
    instanceId?: string;
    textKey?: string;
    titleKey?: string;
    illustration?: string;
    choices?: StoryletChoiceView[];
    /** Index applied by `storyletChoice { choice: 'default' }`, when the storylet has one. */
    defaultChoice?: number;
    /** True when `storyletChoice { choice: 'later' }` may defer it to the inbox. */
    canDefer?: boolean;
  }
}

/** `storyletChoice`: resolve a storylet (the current decision or one waiting in the inbox). */
export interface StoryletChoiceCommand {
  instanceId: string;
  /** A choice index; 'default' = ignore/delegate (applies defaultChoice); 'later' = defer to the inbox. */
  choice: number | 'default' | 'later';
}

/** `sayLine`: pick, record and announce a line from a pool (emits LineSpoken). */
export interface SayLineCommand {
  pool: string;
  /** Entity bindings for the pool's scope roots, e.g. { settlement: 'set_4', character: 'chr_9' }. */
  scope?: Record<string, string>;
  /** Extra text vars. */
  vars?: TextVars;
}

/** `narrativeSession`: start a new line-memory session (after a new game or a load). */
export interface NarrativeSessionCommand {
  reason?: 'newGame' | 'load';
}

declare module '@sim/core/commands' {
  interface CommandMap {
    storyletChoice: StoryletChoiceCommand;
    sayLine: SayLineCommand;
    narrativeSession: NarrativeSessionCommand;
  }
}

declare module '@sim/core/events' {
  interface EventMap {
    /** A storylet fired and reached the player (or the steward). */
    StoryletFired: { instanceId: string; storyletId: string; trigger: string; delivery: StoryletDelivery; scope: StoryletScopeRef };
    /** A storylet instance ended. `choice` is null when it lapsed. */
    StoryletResolved: { instanceId: string; storyletId: string; choice: number | null; how: StoryletResolution; scope: StoryletScopeRef };
    /** A line was chosen from a pool by `sayLine`. */
    LineSpoken: { pool: string; lineId: string; textKey: string; vars: TextVars; voice?: string };
    /** The skald composed a verse into `state.storylets.verses[targetKey]`. */
    VerseComposed: { targetKey: string; kind: VerseKind; lines: number };
  }
}

declare module '@sim/core/effects' {
  interface EffectMap {
    fireStoryletTrigger: FireStoryletTriggerParams;
    composeVerse: ComposeVerseParams;
  }
}

declare module '@sim/core/ids' {
  interface IdPrefixMap {
    /** Storylet instances. */
    stl: `stl_${string}`;
  }
}
