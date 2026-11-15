/**
 * Sea-battle augmentations of the kernel types (ARCHITECTURE.md §4) and the module's public
 * contracts (design §15, §31.2, §31.13). Every augmented field is optional: core factories, old
 * saves and other modules' tests build these objects without knowing about them.
 *
 * Conventions used throughout the sea battle:
 *   - Side 0 is the attacker, side 1 the defender. `ships[0]` of a side is its flagship (it carries
 *     the side's `captainId`; the player's flagship carries the player).
 *   - Arena coordinates are metres, x east and y SOUTH (screen order), origin at the north-west
 *     corner. Headings and wind directions are compass degrees (0 = north, clockwise); the wind
 *     direction is where the wind blows FROM.
 *   - One engine step is 1/tickHz real seconds and `timeScale/tickHz` battle seconds (§15.2: 4×).
 */
import type {
  CharId,
  CultureId,
  DifficultyId,
  DuelResult,
  DuelSetup,
  DuelWeaponId,
  FactionId,
  FleetId,
  GameMode,
  GoodId,
  OmenId,
  SeaBattleId,
  SeaBattleResult,
  SeaBattleSetup,
  SettlementId,
  ShipId,
  ShipTypeId,
  WindStrength,
} from '@sim/core/state';

/** Which side of a sea battle. */
export type SeaSideKey = 'attacker' | 'defender';

/**
 * How a side's AI behaves (§15.3): war fleets and raiders fight and run at 30 % or when outnumbered
 * 2:1; patrols fight until 50 % losses; merchants flee from the start and strike when caught.
 */
export type SeaSideRole = 'warfleet' | 'raider' | 'patrol' | 'merchant';

/**
 * Player orders for the player's ships (§15.2 Follow / Attack target / Screen / Hold / Board target,
 * plus the sea-battle scene's orders): 'move' sails to a point and holds there, 'shoot' keeps archery
 * range of the target and never rams or boards, 'withdraw' makes for the arena edge and slips away.
 * The flagship takes these orders too (it leaves the direct helm until the next helm or moveTo input).
 */
export type SeaOrderKind = 'follow' | 'attack' | 'screen' | 'hold' | 'board' | 'move' | 'shoot' | 'withdraw';

/** Sail or oars (R toggles). Under 'sail' a ship still rows automatically in irons (§31.2). */
export type SeaPropulsion = 'sail' | 'oars';

/** What became of a ship. 'struck' = surrendered, awaiting a prize crew (captured at the end). */
export type SeaShipStatus = 'active' | 'struck' | 'captured' | 'sunk' | 'burned' | 'fled';

/** What became of a named captain (or the player). */
export type SeaCaptainFate = 'fine' | 'wounded' | 'captured' | 'dead';

/** Final condition of one ship, written back with the military ship effects. */
export interface SeaShipOutcome {
  shipId: ShipId;
  side: SeaSideKey;
  status: SeaShipStatus;
  hullHp: number;
  sailHp: number;
  /** Men still aboard and able (0 for sunk/captured ships). */
  crew: number;
  capturedBy?: SeaSideKey;
}

/** Deck assignment chosen on the pre-battle screen (§15.2 slider); rowers are the remainder. */
export interface SeaDeckAssignment {
  shipId: ShipId;
  archers: number;
  boarders: number;
}

/** A side of the `startSeaBattle` / `autoResolveSeaBattle` effects: references into GameState. */
export interface SeaSideRef {
  /** The fleet that fights: its ships, men, captain, cargo (pitch) and morale. */
  fleetId?: FleetId;
  /** Owner (defaults to the fleet's owner). */
  factionId?: FactionId;
  /** Extra explicit ships (encounters/storylets without a fleet): type, crew and optional HP. */
  ships?: { type: ShipTypeId; crew?: number; hullHp?: number; sailHp?: number; shipId?: ShipId }[];
  /** Unit mix for explicit ships (default: the culture's bondi-like levy). */
  men?: Record<string, number>;
  /** Named captain aboard the flagship (default: the fleet leader). */
  captainId?: CharId;
  role?: SeaSideRole;
  /** Morale override (default fleet morale). */
  morale?: number;
  /** Pitch in tons (default: fleet cargo). */
  pitchT?: number;
  culture?: CultureId;
}

/** Parameters of the `startSeaBattle` effect op (owned by seabattle). */
export interface StartSeaBattleEffect {
  attacker: SeaSideRef;
  defender: SeaSideRef;
  /** Who started it (module id or `quests:qst_4`); echoed in SeaBattleEnded. */
  origin: string;
  /** Arena template id (tunables.seabattle.arenas: openSea, coastal, skerries, strait, fjord, river). */
  arena?: string;
  /** Compass bearing from the arena centre to the nearest land (coastal templates). */
  coastBearing?: number;
  /** Wind at the battle (default: the weather zone `zoneId`, else drawn from the battle seed). */
  wind?: { dir: number; str: WindStrength };
  zoneId?: string;
  omen?: OmenId;
  /** 'ask' raises the pre-battle decision for the player (default); 'auto' resolves at once. */
  mode?: 'ask' | 'auto';
}

/** Parameters of the `autoResolveSeaBattle` effect op (NEW; owned by seabattle). */
export type AutoResolveSeaBattleEffect = Omit<StartSeaBattleEffect, 'mode'>;

/** `startSeaBattle` command: confirm the pre-battle screen. */
export interface StartSeaBattleCommand {
  seaBattleId: SeaBattleId;
  /** 'fight' hands the battle to the engine (client); 'auto' resolves it now (§15.5). */
  mode: 'fight' | 'auto';
  /** Per-ship deck assignment for the player's ships. */
  deck?: SeaDeckAssignment[];
  /** Or one assignment for every player ship, as shares of each crew. */
  deckShares?: { archers: number; boarders: number };
  /** Loose fire arrows when pitch is aboard (default true). */
  fireArrows?: boolean;
}

/** `applySeaBattleResult` command: the client hands back the finished engine battle. */
export interface ApplySeaBattleResultCommand {
  seaBattleId: SeaBattleId;
  result: SeaBattleResult;
}

/** Engine pause state for the optional captain duel (§14.1 "after a successful boarding"). */
export interface SeaDuelRequest {
  /** Index of the player's ship and of the enemy ship in the engine. */
  playerShip: number;
  enemyShip: number;
  playerCharId: CharId;
  enemyCaptainId: CharId;
  /** true: the player's crew won the deck fight (the enemy captain fights you); false: last stand. */
  playerWonDeck: boolean;
  /** A ready DuelSetup for the duel engine (arena 'deck'). */
  setup: DuelSetup;
}

declare module '@sim/core/state' {
  interface SeaShipSetup {
    /** Men-weighted melee attack/defence of the crew before equipment tiers. */
    atk?: number;
    def?: number;
    /** Mean ranged attack of the men assigned to the bow. */
    rangedAtk?: number;
    /** Ship name (for logs and the HUD). */
    name?: string;
    /** Not a GameState ship (explicit encounter ship): no ship effects are written for it. */
    virtual?: boolean;
    /** Share of the fleet's cargo stowed in this ship (for loss/capture of cargo). */
    cargoShare?: number;
  }
  interface SeaSideSetup {
    culture?: CultureId;
    /** The captain's duel weapon (culture default) for the captain-duel hand-off. */
    captainWeapon?: DuelWeaponId;
    role?: SeaSideRole;
    /** Captain skills (seafaring: speed; command: morale; archery: volleys). */
    seafaring?: number;
    command?: number;
    archery?: number;
    /** The player's Dread (§31.10: −5 enemy morale with Dread ≥ 50 and a drakkar). */
    dread?: number;
    /** Pitch aboard (tons); fire arrows consume it. */
    pitchT?: number;
    /** Crew stamina at the start (fleet.crewStamina). */
    stamina?: number;
    /** Fleet cargo and silver at the start (for plunder and losses). */
    cargo?: Partial<Record<GoodId, number>>;
    silver?: number;
    /** Men per unit type at the start (for writing casualties back with killMen). */
    men?: Record<string, number>;
    /** Loose fire arrows (pre-battle toggle; default on when pitch is aboard). */
    fireArrows?: boolean;
    /** Auto-resolve player penalty (§5.5). */
    playerPenalty?: number;
  }
  interface SeaBattleSetup {
    origin?: string;
    /** Compass bearing from the arena centre to the nearest land (coastal templates). */
    coastBearing?: number;
    omen?: OmenId;
    gentleMode?: boolean;
    difficulty?: DifficultyId;
    /** The player character aboard the player's flagship (absent when the ruler is not there). */
    playerCharId?: CharId;
    /** Ask the player before a captain duel (Assisted Mode preference passes to the duel). */
    duelAssist?: boolean;
    /** Screen to return to after the battle. */
    returnMode?: GameMode;
    /** Settlement nearby (news, chronicle). */
    nearSettlementId?: SettlementId;
  }
  interface SeaBattleResult {
    shipsBurned?: ShipId[];
    shipsFled?: ShipId[];
    capturedBy?: Record<string, SeaSideKey>;
    ships?: SeaShipOutcome[];
    captainFates?: Record<string, SeaCaptainFate>;
    playerFate?: SeaCaptainFate;
    /** Pitch burned by each side's fire arrows (tons). */
    pitchUsedT?: { attacker: number; defender: number };
    /** The loser struck its colours (merchants, routed crews). */
    surrendered?: boolean;
    /** The player changed ships after losing the flagship. */
    playerTransferredTo?: ShipId;
    /** Men of the losing crews taken alive (§16.5 ransom). */
    crewCaptives?: { attacker: number; defender: number };
  }
}

declare module '@sim/core/effects' {
  interface EffectMap {
    startSeaBattle: StartSeaBattleEffect;
    autoResolveSeaBattle: AutoResolveSeaBattleEffect;
  }
}

declare module '@sim/core/commands' {
  interface CommandMap {
    startSeaBattle: StartSeaBattleCommand;
    applySeaBattleResult: ApplySeaBattleResultCommand;
  }
}

declare module '@sim/core/events' {
  interface EventMap {
    SeaBattleEnded: {
      seaBattleId: SeaBattleId;
      origin: string;
      attackerFactionId: FactionId;
      defenderFactionId: FactionId;
      playerSide?: SeaSideKey;
      result: SeaBattleResult;
      setup: SeaBattleSetup;
      /** Effects that could not be applied (op not registered or invalid), for integration checks. */
      unapplied: string[];
    };
  }
}

/** Re-exported for engine consumers. */
export type { DuelResult, DuelSetup };
