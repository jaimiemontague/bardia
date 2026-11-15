/**
 * Duel augmentations of the kernel types (ARCHITECTURE.md §4) and the duel sub-simulation's public
 * contracts (design §14). Every augmented field is optional: core factories, old saves and other
 * modules' tests build these objects without knowing about them.
 *
 * Other modules may `import type` from this file (only types cross module folders at runtime).
 */
import type {
  ActiveSubSim,
  CharId,
  DifficultyId,
  DuelId,
  DuelResult,
  DuelSetup,
  DuelWeaponId,
  FactionId,
} from '@sim/core/state';

// ---------------------------------------------------------------------------------------------
// Vocabularies

/** Where a duel came from (§14.1); echoed in DuelEnded so the originating module can react. */
export const DUEL_ORIGINS = ['battle', 'boarding', 'tavern', 'thing', 'nemesis', 'guardian', 'storylet', 'practice', 'other'] as const;
export type DuelOrigin = (typeof DUEL_ORIGINS)[number];

export const DUEL_ARENAS = ['hall', 'deck', 'beach', 'holmgang', 'field'] as const;
export type DuelArena = DuelSetup['arena'];
export const DUEL_STAKES = ['firstBlood', 'yield', 'death'] as const;
export type DuelStakes = DuelSetup['stakes'];

/** One of the two fighters of a duel. */
export type DuelSide = 'a' | 'b';
/** How the player fights it (§14.2 real time, §14.7 Assisted Mode, §14.8 auto-resolve). */
export const DUEL_MODES = ['realtime', 'assisted', 'auto'] as const;
export type DuelMode = (typeof DUEL_MODES)[number];
/** Why a fight ended. 'auto' = auto-resolved. */
export const DUEL_END_REASONS = ['down', 'yield', 'firstBlood', 'ringOut', 'timeout', 'auto'] as const;
export type DuelEndReason = (typeof DUEL_END_REASONS)[number];
/** What the winner does with the beaten foe (§14.9). `kill` only in duels to the death. */
export const DUEL_CHOICES = ['spare', 'capture', 'kill'] as const;
export type DuelChoice = (typeof DUEL_CHOICES)[number];
export type DuelLoserFate = DuelResult['loserFate'];

/** Real-time and Assisted AI personalities (§14 task: Aggressive, Defensive, Tricky, Brute). */
export const AI_STYLES = ['aggressive', 'defensive', 'tricky', 'brute'] as const;
export type AiStyle = (typeof AI_STYLES)[number];

export type StrikeHeight = 'high' | 'low';
/** Intent glyph shown over a fighter winding up (§14.6). */
export type GlyphKind = 'high' | 'low' | 'heavy' | 'bash';

/** The six secret choices of an Assisted-Mode exchange (§14.7). */
export const ASSISTED_CHOICES = ['highStrike', 'lowStrike', 'guardHigh', 'guardLow', 'bash', 'feint'] as const;
export type AssistedChoice = (typeof ASSISTED_CHOICES)[number];
/** The category of a choice revealed by Initiative (§14.7: "see their category next exchange"). */
export type AssistedCategory = 'strike' | 'guard' | 'bash' | 'feint';

// ---------------------------------------------------------------------------------------------
// Fighter profile (everything the pure engines need; JSON-serialisable, stored in the setup)

/**
 * A duelist's derived numbers (§14.3–§14.5, §14.8), computed once from the character, gear,
 * traits, feats, wounds and injuries by `buildProfile` (stats.ts). The engines never read GameState.
 */
export interface DuelistProfile {
  charId: CharId;
  name: string;
  /** For pronouns in tells and barks (absent for synthetic fighters). */
  sex?: 'male' | 'female';
  weapon: DuelWeaponId;
  armourTier: number;
  weaponTier: number;
  /** Effective attributes/skill after traits, feats, wounds and injuries (may be fractional). */
  might: number;
  agility: number;
  wits: number;
  vigor: number;
  melee: number;
  level: number;
  hpMax: number;
  /** HP at the start (an already hurt fighter starts lower; floor `fighter.minStartHpPct`). */
  hpStart: number;
  staminaMax: number;
  /** Shield HP of one shield (0 = no shield: two-handed weapon). */
  shieldMax: number;
  /** Shields carried (holmgang: 3 — the Shield HP refills twice; otherwise 1, or 0 without a shield). */
  shields: number;
  /** Parry window without the accessibility extension (§14.5: 180 ms + 10 ms/Agility + 8 ms/Melee + feats). */
  parryWindowMs: number;
  /** Wind-up of a light strike (weapon wind-up × the Agility/Melee tempo multiplier, stats.ts `windupSpeedMult`). */
  windupMs: number;
  /** Strike reach in metres. */
  reachM: number;
  /**
   * Damage of a ×1.0 strike before the target's armour: weaponDmg × (1 + 0.04 × (Might − 4)) ×
   * (1 + 0.03 × Melee) × (1 + damagePct/100), damagePct = traits/feats `duel.damagePct` + weapon tier + bonus.
   */
  damageBase: number;
  /** Share of the target's armour reduction ignored (spear thrust 0.3, hammer 0.5). */
  armourIgnore: number;
  /** Armour reduction this fighter's armour gives: 0.06 × (armourTier − 1). */
  armourReduction: number;
  /** Dodge invulnerability and distance multiplier (Lame −30%). */
  dodgeMult: number;
  /** §14.8 DuelRating (+ the nerve term). */
  rating: number;
  /** Nerve in percent (duel omen + traits; absent when 0): scales stamina and the rating (tunables `nerve`). */
  nervePct?: number;
  /** AI personality (real time and Assisted Mode). */
  style: AiStyle;
  /** Chance this fighter grants quarter / spares a beaten foe when it decides (NPCs). */
  mercy: number;
  /** HP share below which this fighter (as an NPC) may ask for quarter; 0 = never. */
  yieldHp: number;
  /** Chance this fighter (as an NPC winner) takes the beaten foe captive where allowed. */
  captureChance: number;
}

// ---------------------------------------------------------------------------------------------
// Fight summary (what the client hands back after a real-time or Assisted duel)

/** The result of the fight itself, before §14.9 consequences are decided. */
export interface DuelFightSummary {
  winner: DuelSide;
  reason: Exclude<DuelEndReason, 'auto'>;
  durationS: number;
  /** Remaining HP as a percentage of max HP (0–100). */
  hpPct: { a: number; b: number };
  /** Taunts held for the full second without being hit (§14.5). */
  tauntsLanded: { a: number; b: number };
  /** Assisted Mode: exchanges fought. */
  exchanges?: number;
}

// ---------------------------------------------------------------------------------------------
// Effect, commands and events

/** A duelist reference in a `startDuel` effect: a character id, 'player' (the player's ruler), or gear overrides. */
export type DuelistRef =
  | CharId
  | 'player'
  | {
      charId: CharId | 'player';
      /** Default: the culture's weapon if the fighter's weapon tier allows it. */
      weapon?: DuelWeaponId;
      /** Default: the fighter's faction armoury tier (1 without a faction). */
      armourTier?: number;
      weaponTier?: number;
      /** Relic or special-gear DuelRating bonus (§14.8 "+ relics"). */
      ratingBonus?: number;
      /** Relic or special-gear duel damage bonus in percent (a famous sword, §12.4). */
      damagePct?: number;
    };

/**
 * Parameters of the `startDuel` effect op (owned by the duel module). Used by the battle Challenge,
 * boarding captains, tavern challenges, Thing holmgangs, the Nemesis and relic guardians.
 * A duel that involves the player's house raises the `duel` decision; a duel between two NPCs is
 * auto-resolved at once and only emits DuelEnded.
 */
export interface StartDuelEffect {
  /** The challenger (or the player's side). */
  a: DuelistRef;
  b: DuelistRef;
  stakes: DuelStakes;
  arena: DuelArena;
  origin: DuelOrigin;
  /** The originator's reference (battle id, quest id, Thing case …), echoed in DuelEnded/DuelDeclined. */
  ref?: string;
  /** May the player decline? Default: the origin is listed in tunables `outcome.declineRenown`. */
  declinable?: boolean;
}

/** `startDuel` command: confirm the duel setup (weapon, mode), or decline it. */
export interface StartDuelCommand {
  duelId: DuelId;
  mode: DuelMode | 'decline';
  /** The player's side's weapon (must be allowed by its weapon tier); default: the setup's. */
  weapon?: DuelWeaponId;
  /** Auto-resolve only: what to do with a beaten foe (default spare; `kill` only to the death). */
  onWin?: DuelChoice;
}

/** `applyDuelResult` command: the client hands back a finished real-time or Assisted fight. */
export interface ApplyDuelResultCommand {
  duelId: DuelId;
  outcome: DuelFightSummary;
  /** The player's decision when the player's side won (default spare; `kill` only when the foe went down in a duel to the death). */
  choice?: DuelChoice;
}

/** Domain event (duel module): a duel is over and its consequences were applied. */
export interface DuelEndedEvent {
  duelId: DuelId;
  origin: DuelOrigin;
  ref?: string;
  /** The player's side in this duel, or null for a duel between two NPCs. */
  playerSide: DuelSide | null;
  winnerId: CharId;
  loserId: CharId;
  setup: DuelSetup;
  result: DuelResult;
}

/** The player declined a declinable duel (tavern challenge …). */
export interface DuelDeclinedEvent {
  duelId: DuelId;
  origin: DuelOrigin;
  ref?: string;
  declinerId: CharId;
  challengerId: CharId;
  /** Renown change applied for refusing (negative or 0). */
  renown: number;
}

/** The duel slot type. */
export type DuelSlot = ActiveSubSim<DuelSetup, DuelResult>;

declare module '@sim/core/state' {
  interface Duelist {
    /** Relic / special-gear DuelRating bonus (§14.8). */
    ratingBonus?: number;
    /** Relic / special-gear duel damage bonus (percent). */
    damagePct?: number;
  }
  interface DuelSetup {
    origin?: DuelOrigin;
    ref?: string;
    /** §14.1/L9: the duel is to the death (always shown before it starts). */
    lethal?: boolean;
    /** Gentle Mode was on when the duel was set up: the player character is captured rather than killed. */
    gentle?: boolean;
    /** Game difficulty (duel AI reaction times; ADR-003: never stats). */
    difficulty?: DifficultyId;
    /** The player's house fights as this side (null/absent: NPC duel). */
    playerSide?: DuelSide | null;
    /** The player's side is a champion standing in for the ruler (§14.1). */
    champion?: boolean;
    declinable?: boolean;
    /** Chosen by the startDuel command. */
    mode?: DuelMode;
    /** Derived fighter numbers; the engines run from these alone. */
    profiles?: { a: DuelistProfile; b: DuelistProfile };
    /** Renown tier of each fighter (§14.9: commoner 0 … Nemesis 4). */
    tiers?: { a: number; b: number };
  }
  interface DuelResult {
    loserId?: CharId;
    reason?: DuelEndReason;
    mode?: DuelMode;
    durationS?: number;
    /** XP earned (people awards it reacting to DuelEnded; §22.1 duel win 50 + 10 × opponent level). */
    xp?: Record<CharId, number>;
    /** Honor and Dread changes applied to the player's house. */
    honor?: number;
    dread?: number;
    /** Taunts that paid Renown (§14.5). */
    tauntsPaid?: number;
  }
  interface DuelPayload {
    origin?: DuelOrigin;
    stakes?: DuelStakes;
    lethal?: boolean;
    declinable?: boolean;
    /** The player's fighter and the opponent. */
    fighterId?: CharId;
    opponentId?: CharId;
  }
  interface SubSimSlots {
    /** Duels set up while another one occupied the slot (their decisions wait in the pending queue). */
    duelQueue?: ActiveSubSim<DuelSetup, DuelResult>[];
  }
}

declare module '@sim/core/effects' {
  interface EffectMap {
    startDuel: StartDuelEffect;
  }
}

declare module '@sim/core/commands' {
  interface CommandMap {
    startDuel: StartDuelCommand;
    applyDuelResult: ApplyDuelResultCommand;
  }
}

declare module '@sim/core/events' {
  interface EventMap {
    DuelEnded: DuelEndedEvent;
    DuelDeclined: DuelDeclinedEvent;
  }
}

/** Helper type: a faction id or nothing (commoners and outlaws have no house). */
export type MaybeFaction = FactionId | undefined;
