/**
 * Battle augmentations of the kernel types (ARCHITECTURE.md §4) and the battle module's own
 * public contracts. Every augmented field is optional: core factories, old saves and other
 * modules' tests build these objects without knowing about them.
 */
import type {
  ArmyId,
  BattleId,
  BattleKind,
  BattleResult,
  BattleSetup,
  BattleWeather,
  CharId,
  CultureId,
  DifficultyId,
  FactionId,
  FleetId,
  FormationId,
  GameMode,
  GoodId,
  OmenId,
  SettlementId,
  SettlementTierId,
  SiteId,
  SiteKind,
  Squad,
  UnitTypeId,
} from '@sim/core/state';

/** Which side of a battle. */
export type BattleSideKey = 'attacker' | 'defender';
/** Squad stance (§13.5): Hold never pursues, Engage (default), Skirmish keeps distance. */
export type SquadStance = 'hold' | 'engage' | 'skirmish';
export type BattleApproach = BattleSetup['approach'];

/** Where a squad's men came from, so casualties can be written back to the right container. */
export interface SquadSourceShare {
  kind: 'fleet' | 'army' | 'settlement' | 'explicit';
  id?: string;
  men: number;
}

/**
 * Everything the pure engine needs to know about a named leader (the engine never reads
 * GameState). Built by the startBattle effect from the character's skills, traits, feats and items.
 */
export interface BattleLeaderInfo {
  name: string;
  command: number;
  melee: number;
  archery: number;
  wildcraft: number;
  /** Σ `morale.ownSquad` over traits and feats (Brave +10, Craven −10 …). */
  moraleMod: number;
  /** Σ `squad.ownDefPct` (Shield-Brother +10). */
  defPct: number;
  hpPct: number;
  isPlayer: boolean;
  /** Always accepts a Challenge (Brave/Proud). */
  acceptsChallenge: boolean;
  /** Carries a war-horn (+morale at start). */
  warHorn: boolean;
  role: 'player' | 'lieutenant' | 'chief' | 'leader';
}

/** Portable wealth present at the battle site (silver + goods in tons). */
export interface BattleLootPool {
  silver: number;
  goods: Partial<Record<GoodId, number>>;
}

/**
 * One side of a `startBattle` effect: references into GameState that the effect gathers squads
 * from, plus optional explicit squads (guardians, storylets) and flags known to the caller.
 */
export interface BattleSideRef {
  factionId?: FactionId;
  /** Men from `fleet.men`, leaders from the fleet leader and lieutenants. */
  fleetId?: FleetId;
  /** Squads from `army.squads`. */
  armyId?: ArmyId;
  /** Garrison from `settlement.garrison` (+ militia when walls ≥ 1 in assaults/defences). */
  settlementId?: SettlementId;
  /** Named leaders present (player, lieutenants); default: the fleet/army leaders. */
  characterIds?: CharId[];
  chiefId?: CharId;
  squads?: Squad[];
  moraleMods?: number;
  isPlayer?: boolean;
  hasRam?: boolean;
  hasPitch?: boolean;
  /** Siege ladders were built (sieges): squads may climb the walls. */
  ladders?: boolean;
  /** Overrides (default: the settlement's culture, else the faction's). */
  culture?: CultureId;
  /** Overrides (default: the garrison's settlement tiers, else the faction's armoury). */
  armourTier?: number;
  weaponTier?: number;
}

/** Parameters of the `startBattle` effect op (owned by the battle module). */
export interface StartBattleEffect {
  kind: BattleKind;
  attacker: BattleSideRef;
  defender: BattleSideRef;
  settlementId?: SettlementId;
  siteId?: SiteId;
  approach?: BattleApproach;
  timerS?: number;
  /** Who started the battle (module id or `quests:qst_4`); echoed in BattleStarted/BattleEnded. */
  origin: string;
  mapTemplate?: string;
  /** Overrides the omen (default: the player's battle omen in force, else the attacker faction's). */
  omen?: OmenId;
  /** Overrides parts of the weather (default: the place's sea zone in state.weather). */
  weather?: Partial<BattleWeather>;
  /** Overrides the portable wealth at stake (default: the settlement's silver and market goods). */
  loot?: BattleLootPool;
  /** Overrides the place's fortification tier. */
  fortTier?: 0 | 1 | 2 | 3 | 4;
  /** Overrides whether the attackers come by sea (default: they have a fleet and the place is coastal). */
  coastal?: boolean;
}

/** A squad as laid out by the player on the pre-battle Groups screen. */
export interface PlannedSquad {
  leaderId: CharId;
  unit: UnitTypeId;
  men: number;
  formation?: FormationId;
  stance?: SquadStance;
}

/** `startBattle` command: confirm the pre-battle screen. */
export interface StartBattleCommand {
  battleId: BattleId;
  /** 'fight' hands the battle to the tactical engine; 'auto' resolves it now. */
  mode: 'fight' | 'auto';
  approach?: BattleApproach;
  /** The player's squad layout; omitted = the default assignment built at setup. */
  squads?: PlannedSquad[];
}

/** `applyBattleResult` command: the client hands back the finished tactical battle. */
export interface ApplyBattleResultCommand {
  battleId: BattleId;
  result: BattleResult;
}

/** Casualties per (side, source container, unit type), for writing back with killMen. */
export interface BattleSquadLoss {
  side: BattleSideKey;
  unit: UnitTypeId;
  source: { kind: SquadSourceShare['kind']; id?: string };
  killed: number;
  wounded: number;
  captured: number;
}

/** What happened to a named leader. */
export type BattleLeaderFate = 'fine' | 'wounded' | 'seriouslyWounded' | 'mortallyWounded' | 'captured' | 'dead';

/** A duel fought during the battle (Challenge ability). */
export interface BattleDuelRecord {
  challengerId: CharId;
  chiefId: CharId;
  winnerId: CharId;
  loserFate: 'spared' | 'yielded' | 'killed' | 'captured';
}

declare module '@sim/core/state' {
  interface Squad {
    sources?: SquadSourceShare[];
    /** The leaderId is only a reference (an unnamed sergeant leads the squad). */
    unnamed?: boolean;
    stance?: SquadStance;
  }
  interface SideSetup {
    culture?: CultureId;
    /** Containers the side's men came from (loot is carried to the fleet). */
    fleetId?: FleetId;
    armyId?: ArmyId;
    settlementId?: SettlementId;
    hasPitch?: boolean;
    hasRam?: boolean;
    /** Siege ladders (built during a siege): this side's squads may climb the walls. */
    ladders?: boolean;
    /** This side's Dread is ≥ 50 and it sails drakkars (enemy morale −5, §31.10). */
    dreadDrakkar?: boolean;
    /** `fire.spreadPct` of the side's leader (Hall-Burner). */
    fireSpreadPct?: number;
    /** Pitch carried for fire arrows (tons; omitted = not counted). */
    pitchT?: number;
    /** Skell's Ember-Cloak (fire spread ×2). */
    emberCloak?: boolean;
    /** `battle.cavalryMoralePct` of the side's culture. */
    cavalryMoralePct?: number;
    /** Men per unit type that may be re-assigned on the Groups screen (the player's side). */
    available?: Record<UnitTypeId, number>;
    /** Every source container's men per unit type (for re-assignment). */
    pools?: { kind: SquadSourceShare['kind']; id?: string; men: Record<UnitTypeId, number> }[];
    /** Named leaders who may lead squads on this side. */
    leaderIds?: CharId[];
  }
  interface BattleSetup {
    origin?: string;
    /** Screen to return to after a fought battle (set when the fight starts). */
    returnMode?: GameMode;
    /** Seeds the map: campaign seed + settlement/site id, so a place always looks the same. */
    mapSeed?: string;
    /** The attackers come by sea (ships on a beach at the bottom of the map). */
    coastal?: boolean;
    culture?: CultureId;
    fortTier?: 0 | 1 | 2 | 3 | 4;
    oldStoneWalls?: boolean;
    church?: boolean;
    settlementTier?: SettlementTierId;
    siteKind?: SiteKind;
    loot?: BattleLootPool;
    /** Share of `loot` that can be carried off (raid 0.6, assault 0.9). */
    lootCeiling?: number;
    leaders?: Record<string, BattleLeaderInfo>;
    gentleMode?: boolean;
    difficulty?: DifficultyId;
    /** Auto-resolve player penalty (§5.5). */
    playerPenalty?: number;
  }
  interface BattleResult {
    squadLosses?: BattleSquadLoss[];
    leaderFates?: Record<string, BattleLeaderFate>;
    surrendered?: boolean;
    /** The silver part of lootValue (the rest is lootGoods). */
    lootSilver?: number;
    /** Share of the site's portable wealth destroyed by fire. */
    lootBurnedShare?: number;
    duels?: BattleDuelRecord[];
    /** Pitch burned by fire arrows (tons per side), taken from the sides' fleets. */
    pitchUsedT?: { attacker: number; defender: number };
  }
}

declare module '@sim/core/effects' {
  interface EffectMap {
    startBattle: StartBattleEffect;
    /**
     * Resolve a battle off-screen at once with the §31.11 auto-resolve, whoever fights it (the player's
     * ship-guard attacked while the party is inland, §8.7; AI-against-AI wars). Same parameters as
     * startBattle; emits BattleStarted (mode 'auto') and BattleEnded with the given origin.
     */
    autoResolveBattle: StartBattleEffect;
  }
}

declare module '@sim/core/commands' {
  interface CommandMap {
    startBattle: StartBattleCommand;
    applyBattleResult: ApplyBattleResultCommand;
  }
}

declare module '@sim/core/events' {
  interface EventMap {
    BattleStarted: {
      battleId: BattleId;
      kind: BattleKind;
      origin: string;
      settlementId?: SettlementId;
      siteId?: SiteId;
      attackerFactionId: FactionId;
      defenderFactionId: FactionId;
      playerSide?: BattleSideKey;
      /** 'fight': the tactical battle begins; 'auto': it is being auto-resolved now. */
      mode: 'fight' | 'auto';
    };
    BattleEnded: {
      battleId: BattleId;
      kind: BattleKind;
      origin: string;
      settlementId?: SettlementId;
      siteId?: SiteId;
      attackerFactionId: FactionId;
      defenderFactionId: FactionId;
      playerSide?: BattleSideKey;
      result: BattleResult;
      setup: BattleSetup;
      /** True when the battle module already moved the loot (place → winner's fleet/treasury) with effects. */
      lootApplied: boolean;
      /** Result effects that could not be applied (owner module missing or rejected them): `op: reason`. */
      unapplied: string[];
    };
  }
}
