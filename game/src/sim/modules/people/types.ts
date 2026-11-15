/**
 * People module: kernel augmentations (ARCHITECTURE.md §4) and the module's public contracts.
 * Every augmented field is OPTIONAL — core factories, older saves and other modules' tests build
 * characters without knowing about them. Other modules may `import type` from this file.
 */
import type { AttributeId } from '@content/schemas/ids';
import type {
  CharacterRole,
  CharId,
  FactionId,
  FleetId,
  Hour,
  PendingId,
  RoleKind,
  SettlementId,
  SkillId,
  TextVars,
  WoundState,
} from '@sim/core/state';

/** A wound worse than none (ordered: minor < serious < mortal). */
export type WoundSeverity = Exclude<WoundState, 'none'>;
/** Upbringing arrangements for children aged 6–15 (§23.3). */
export type FosterMode = 'tutor' | 'lieutenant' | 'ally';
/** How the player handles a minor heir's regency (§23.4). */
export type RegencyMode = 'play' | 'skip';
/** Weekly captivity choices (§23.5). */
export type CaptivityChoice = 'wait' | 'escape' | 'bargain' | 'sendWord' | 'swearFealty';
/** Paid healing (§22.5). Resting at home is the default recovery and needs no command. */
export type HealMethod = 'seer' | 'church';
/** Child stages (§23.2). */
export type LifeStage = 'infant' | 'child' | 'youth' | 'adult';
/** How a succession was settled. */
export type SuccessionKind = 'heir' | 'regency' | 'kin' | 'spouse' | 'newLine' | 'comingOfAge' | 'regentReplaced';
/** Roles the player may hand out with `assignRole` (ruler and regent come only from succession). */
export type AssignableRole = Exclude<RoleKind, 'ruler' | 'regent'>;

export interface Pregnancy {
  fatherId?: CharId;
  conceivedHour: Hour;
  dueHour: Hour;
  twins: boolean;
}

export interface Upbringing {
  mode: FosterMode;
  /** Skill improved every `dynasty.tutorYearsPerSkillPoint` years. */
  focusSkill: SkillId;
  /** The fostering lieutenant (mode 'lieutenant'). */
  mentorId?: CharId;
  /** The allied court (mode 'ally'). */
  factionId?: FactionId;
  sinceHour: Hour;
  /** Days of tutoring accumulated toward the next skill point. */
  progressDays: number;
}

export interface CaptivityRecord {
  byFactionId: FactionId;
  at: SettlementId;
  sinceHour: Hour;
  /** Current asking ransom (silver); bargaining lowers it. */
  ransom: number;
  /** Ransom when captured (§31.15); bargaining never goes below `bargain.ransomFloor` of it. */
  baseRansom: number;
  /** Tightened after failed escapes. */
  guard: number;
  /** Consecutive failed monthly Vigor checks. */
  vigorFails: number;
  bargains: number;
  sentWord?: boolean;
  /** Held as a hostage (a fosterling whose host turned hostile). */
  hostage?: boolean;
}

/** A deed-name that overrides the level title, e.g. "{name}'s-Bane" (§22.2). */
export interface DeedName {
  /** Localisation key (any area). */
  key: string;
  vars?: TextVars;
  hour: Hour;
}

export interface RegencyState {
  heirId: CharId;
  /** The acting ruler (player.rulerId while the regency lasts); absent: the minor rules alone. */
  regentId?: CharId;
  mode: RegencyMode;
  deceasedId: CharId;
  sinceHour: Hour;
  /** The regent's role before the regency, restored when the heir comes of age. */
  regentPrevRole?: CharacterRole;
  /** Settlements whose leadership/governorship the acting ruler holds for the heir. */
  offices?: SettlementId[];
}

/** Root slice owned by the people module (indices kept by the module's own ops). */
export interface PeopleState {
  pregnantIds: CharId[];
  /** Characters with a wound or a temporary injury. */
  woundedIds: CharId[];
  captiveIds: CharId[];
  /** Children in tutoring or fosterage. */
  fosterIds: CharId[];
  regency?: RegencyState;
  /** The player's house has fallen silent (no heir, no kin). */
  houseFallen?: boolean;
}

/** Pending kind 'featChoice': pick one Saga Feat of those offered at levels 5/10/15/20 (§22.2). */
export interface FeatChoicePayload {
  charId: CharId;
  level: number;
  options: string[];
  /** Text and buttons for the shell's generic decision modal (until a dedicated feat screen exists). */
  titleKey?: string;
  key?: string;
  vars?: Record<string, string | number>;
  choices?: { id: string; labelKey: string; vars: Record<string, string>; command: { type: 'chooseFeat'; pendingId: string; featId: string } }[];
  /** Asset id of the picture at the top of the decision card (an optional `*.illus.*` manifest id). */
  illustration?: string;
}

declare module '@sim/core/state' {
  interface Character {
    /** Locale key of the current level title (`people.title.<level>[.v<i>]`). */
    title?: string;
    deedName?: DeedName;
    unspentSkillPoints?: number;
    unspentAttributePoints?: number;
    pregnancy?: Pregnancy;
    /** Hour of the character's last delivery (postpartum interval). */
    lastBirthHour?: Hour;
    upbringing?: Upbringing;
    captivity?: CaptivityRecord;
    /** Last age whose §22.7 effects were applied. */
    agedTo?: number;
    /** Set by the first failed natural-death check (the old-age warning). */
    oldAgeWarnedHour?: Hour;
    /** The Gray Queen's Comb already saved this lieutenant from a mortal wound. */
    combSaved?: boolean;
    /** Lieutenants and courts already credited for fostering this child (no repeat bonuses). */
    fosteredWith?: string[];
    /** Childhood upbringing chosen at creation (upbringings.json id; §5.1 step 4). Not the fosterage `upbringing`. */
    upbringingId?: string;
    /** Personal standing carried into a succession (§23.4); absent = 0. */
    personalRenown?: number;
    personalHonor?: number;
  }
  interface Health {
    /** The current wound was already treated by a seer or church. */
    treated?: boolean;
    /** Daily death rolls already survived with the current mortal wound. */
    mortalChecks?: number;
    cause?: string;
  }
  interface GameState {
    people?: PeopleState;
  }
  interface PlayerPolicies {
    /** Lieutenants' and kin's level-up points: auto-assigned by inclination, or left for the player. */
    levelUpPoints?: 'auto' | 'manual';
    /**
     * Whether the steward pays ransoms: the ruler's own when the ruler chooses to wait, and the house's
     * captive kin and lieutenants once word reaches home (`captivity.houseRansomDays`).
     */
    captivityRansom?: 'payIfAffordable' | 'refuse';
  }
  interface RoleKinds {
    /** Household seer: heals (Runecraft) and tends sick children. */
    seer: true;
  }
  interface CaptivityPayload {
    ransom?: number;
    weeks?: number;
    escapeChance?: number;
    bargainChance?: number;
    canPay?: boolean;
    hostage?: boolean;
    /** Text and buttons for the shell's generic decision modal (until a dedicated captivity screen exists). */
    titleKey?: string;
    key?: string;
    vars?: Record<string, string | number>;
    choices?: { id: CaptivityChoice; labelKey: string; command: { type: 'captivityAction'; pendingId: string; choice: CaptivityChoice }; tone?: 'primary' | 'danger' | 'secondary'; disabled?: boolean }[];
    /** Asset id of the picture at the top of the decision card (an optional `*.illus.*` manifest id). */
    illustration?: string;
  }
  interface SuccessionPayload {
    factionId?: FactionId;
    minor?: boolean;
    regentCandidates?: CharId[];
    regentId?: CharId;
    mode?: RegencyMode;
    /** Text and buttons for the shell's generic decision modal (until a dedicated succession screen exists). */
    titleKey?: string;
    key?: string;
    vars?: Record<string, string | number>;
    choices?: { id: RegencyMode; labelKey: string; command: { type: 'designateHeir'; heirId: CharId; pendingId: string; regency: RegencyMode; regentId?: CharId }; tone?: 'primary' | 'secondary' }[];
    /** Asset id of the picture at the top of the decision card (an optional `*.illus.*` manifest id). */
    illustration?: string;
  }
  interface PendingPayloads {
    featChoice: FeatChoicePayload;
  }
}

/** `allocatePoints`: spend unspent level-up points (player ruler, or kin/lieutenants with the manual policy). */
export interface AllocatePointsCommand {
  charId: CharId;
  skills?: Partial<Record<SkillId, number>>;
  attributes?: Partial<Record<AttributeId, number>>;
}

declare module '@sim/core/commands' {
  interface CommandMap {
    assignRole: { charId: CharId; role: AssignableRole; holdingId?: SettlementId; fleetId?: FleetId };
    heal: { charId: CharId; method: HealMethod; healerId?: CharId };
    /**
     * Name an heir; with `pendingId`, resolve a succession decision (choose the heir and the regency).
     * During a regency, `{ heirId: <the regency's heir>, regency }` switches between playing as the
     * regent and skipping to the coming of age (resuming a skip another decision interrupted).
     */
    designateHeir: { heirId: CharId; pendingId?: PendingId; regency?: RegencyMode; regentId?: CharId };
    adopt: { childId: CharId };
    /** Tutor at home, foster with a lieutenant or an allied court, or bring the child home (`mode: 'home'`). */
    foster: { childId: CharId; mode: FosterMode | 'home'; focusSkill?: SkillId; lieutenantId?: CharId; factionId?: FactionId };
    captivityAction: { pendingId: PendingId; choice: CaptivityChoice };
    allocatePoints: AllocatePointsCommand;
    chooseFeat: { pendingId: PendingId; featId: string };
  }
}

declare module '@sim/core/events' {
  interface EventMap {
    Birth: { childId: CharId; motherId?: CharId; fatherId?: CharId; factionId?: FactionId; twin: boolean };
    Death: {
      charId: CharId;
      cause: string;
      age: number;
      factionId?: FactionId;
      killerId?: CharId;
      byFactionId?: FactionId;
      /** The faction this character ruled. */
      rulerOf?: FactionId;
      wasPlayerRuler: boolean;
    };
    Marriage: { aId: CharId; bId: CharId; factionAId?: FactionId; factionBId?: FactionId };
    ComingOfAge: { charId: CharId; age: number; traitsGained: string[] };
    LevelUp: { charId: CharId; level: number; skillPoints: number; attributePoints: number; featLevel: boolean };
    TitleChanged: { charId: CharId; titleKey: string; previousKey?: string; deedNameKey?: string };
    CaptureStarted: { charId: CharId; byFactionId: FactionId; at: SettlementId; ransom: number; cause?: string };
    Released: { charId: CharId; byFactionId: FactionId; reason: string; to?: SettlementId };
    SuccessionOccurred: {
      factionId: FactionId;
      deceasedId: CharId;
      heirId: CharId;
      regentId?: CharId;
      kind: SuccessionKind;
      isPlayer: boolean;
    };
    XpGained: { charId: CharId; amount: number; source: string };
    FeatChosen: { charId: CharId; featId: string };
    CharacterWounded: { charId: CharId; severity: WoundState; injury?: string; cause?: string };
    CharacterHealed: { charId: CharId; method: 'rest' | HealMethod | 'relic' | 'survived' };
    TraitGained: { charId: CharId; trait: string; source: string };
    TraitLost: { charId: CharId; trait: string };
    CharacterAged: { charId: CharId; age: number };
    OldAgeWarned: { charId: CharId; age: number };
    ChildConceived: { motherId: CharId; fatherId?: CharId; dueHour: Hour };
    ChildFellIll: { charId: CharId; died: boolean };
    ChildAdopted: { childId: CharId; parentId: CharId };
    ChildFostered: { childId: CharId; mode: FosterMode | 'home'; mentorId?: CharId; factionId?: FactionId };
    FosterlingTakenHostage: { childId: CharId; factionId: FactionId };
    HeirDesignated: { rulerId: CharId; heirId: CharId };
    RoleAssigned: { charId: CharId; role: RoleKind; previousRole?: RoleKind; holdingId?: SettlementId; fleetId?: FleetId };
    ItemGiven: { charId: CharId; itemId: string; fromCharId?: CharId };
    RegencyStarted: { heirId: CharId; regentId?: CharId; mode: RegencyMode };
    RegencyEnded: { heirId: CharId; regentId?: CharId };
    /** No heir and no adult kin: game over with the dynasty saga (§23.4, §24). */
    HouseFallsSilent: { factionId: FactionId; deceasedId: CharId };
    CaptivityChoiceMade: { charId: CharId; choice: CaptivityChoice; success: boolean };
    /** The captive asked allies for a rescue (AI-driven). */
    CaptiveSentWord: { charId: CharId; captorFactionId: FactionId };
    /** The captive swore fealty to the captor (diplomacy turns this into a vassal pact). */
    FealtySworn: { charId: CharId; factionId: FactionId; liegeFactionId: FactionId };
    /** A settlement's leader died and was replaced. */
    LeaderReplaced: { settlementId: SettlementId; previousId: CharId; leaderId: CharId };
  }
}

declare module '@sim/core/effects' {
  interface EffectMap {
    /**
     * Wound a character (default: the player's ruler) and/or apply or roll an injury (§22.5). Wounds never
     * stack below the current severity. `wound` is accepted as an alias of `severity`.
     */
    woundCharacter: { charId?: CharId; severity?: WoundSeverity; wound?: WoundState; injury?: string; rollInjury?: boolean; cause?: string };
    /** Add a trait (an injury-table id such as 'lostEye' applies that injury instead). */
    addTrait: { charId?: CharId; trait: string; source?: string };
    removeTrait: { charId?: CharId; trait: string };
    /** Marry two characters (callers check the `canMarry` condition first; an ineligible pair throws). */
    marry: { charId?: CharId; spouseId: CharId };
    /** A child is born now (to the given parents, or a foundling of the player's house). */
    birth: { motherId?: CharId; fatherId?: CharId; sex?: 'male' | 'female'; name?: string; twins?: boolean };
    kill: { charId?: CharId; cause: string; killerId?: CharId; byFactionId?: FactionId };
    /** Take a character captive (`captorFactionId` is accepted as an alias of `byFactionId`; one is required). */
    capture: { charId?: CharId; byFactionId?: FactionId; captorFactionId?: FactionId; at?: SettlementId; ransom?: number; cause?: string; hostage?: boolean };
    giveItem: { charId?: CharId; itemId: string; fromCharId?: CharId };
    /** Experience (Wits bonus and the lieutenant multiplier applied here; §22.1). */
    grantXp: { charId?: CharId; amount: number; source?: string };
    /** Free a captive (ransom paid by others, release, exchange, rescue). */
    releaseCharacter: { charId: CharId; reason?: string; to?: SettlementId };
    /** Grant a deed-name that overrides the level title (§22.2). */
    grantDeedName: { charId?: CharId; key: string; vars?: TextVars };
  }
}
