/**
 * Internal state of the sea-battle engine (mutable, outside Immer) and its public input, event and
 * render-snapshot contracts. Ships are addressed by their engine index (stable for a battle).
 */
import type { Balance } from '@content/schemas/balance';
import type { Tunables as SeaTunables } from '@content/schemas/tunables/seabattle';
import type { Rng } from '@sim/core/rng';
import type { CharId, DuelResult, SeaBattleSetup, SeaSideSetup, ShipId, ShipTypeId, WindStrength } from '@sim/core/state';
import type { SeaArena } from './arena';
import type { SeaCaptainFate, SeaDuelRequest, SeaOrderKind, SeaPropulsion, SeaShipStatus, SeaSideKey, SeaSideRole } from './types';

/** The content the engine reads (from `ctx.content` / `getContent()`). */
export interface SeaEngineContent {
  balance: Balance;
  tunables: SeaTunables;
}

export interface SeaEngineOptions {
  /** Pause for the optional captain duel after boardings involving the player (default true). */
  offerCaptainDuels?: boolean;
  /** The AI also commands the player's side (headless runs, balance harness). Default false. */
  aiControlsPlayer?: boolean;
}

export type SideIdx = 0 | 1;

/** A ship's side for a broadside volley: port (left of the bow) or starboard (right). */
export type SeaBroadside = 'port' | 'starboard';

/**
 * A volley loosed by hand from a ship's side, in flight until `landT` (battle seconds). Its power
 * (men struck per unit of centring before the target's defence) is fixed when it is loosed.
 */
export interface SeaShot {
  from: number;
  side: SideIdx;
  broadside: SeaBroadside;
  /** Where the archers stood and where the arrows fall (arena metres). */
  fromX: number;
  fromY: number;
  x: number;
  y: number;
  rangeM: number;
  firedT: number;
  landT: number;
  power: number;
  fire: boolean;
}

/** What a ship's controller is trying to do. */
export type SeaGoal =
  | 'idle'
  | 'flee'
  | 'ram'
  | 'seaFire'
  | 'board'
  | 'range'
  | 'capture'
  | 'follow'
  | 'screen'
  | 'hold'
  | 'moveTo'
  | 'grappled';

export interface SeaOrder {
  kind: SeaOrderKind;
  /** Engine index of the target ship (attack, board, shoot). */
  target: number;
  /** Destination of a 'move' order (arena metres). */
  x?: number;
  y?: number;
}

export interface SeaShip {
  idx: number;
  side: SideIdx;
  shipId: ShipId;
  type: ShipTypeId;
  name: string;
  virtual: boolean;
  // Static handling.
  lengthM: number;
  beamM: number;
  /** Half the length of the hull capsule's spine ((length − beam) / 2) and its radius (beam / 2). */
  halfSeg: number;
  radius: number;
  mass: number;
  turnRate: number;
  deepDraft: boolean;
  sailMs: number;
  rowMs: number;
  hullMax: number;
  sailMax: number;
  crewMax: number;
  benches: number;
  atkEff: number;
  defEff: number;
  rangedAtk: number;
  drakkar: boolean;
  galley: boolean;
  seaFire: boolean;
  // Kinematics.
  x: number;
  y: number;
  h: number;
  sinH: number;
  cosH: number;
  v: number;
  pvx: number;
  pvy: number;
  px: number;
  py: number;
  ph: number;
  /** Last pose clear of land, rocks and (deep-draft) shallows: a ship that touches them is put back here. */
  safeX: number;
  safeY: number;
  safeH: number;
  throttle: number;
  rudder: number;
  propulsion: SeaPropulsion;
  rowing: boolean;
  sailSet: boolean;
  /** Current top forward speed (m/s) under the chosen propulsion (for AI and the HUD). */
  vmax: number;
  // Condition.
  hull: number;
  sail: number;
  sailBurning: boolean;
  hullBurnS: number;
  hullBurnDps: number;
  seaFireBurning: boolean;
  douseS: number;
  groundedS: number;
  // Crew (floats; rounded in results).
  archers: number;
  rowers: number;
  boarders: number;
  startCrew: number;
  killed: number;
  wounded: number;
  captured: number;
  rescued: number;
  morale: number;
  startMorale: number;
  stamina: number;
  routed: boolean;
  // Combat.
  volleyT: number;
  holdFire: boolean;
  /** Player-chosen archery target (engine index) or −1. */
  target: number;
  ramCd: number;
  /** Seconds left backing away (after a ram, a grounding or a touch), and the direction: −1 astern, +1 ahead. */
  backOffS: number;
  backOffDir: number;
  siphonCharges: number;
  siphonCd: number;
  /** Index into `grapples` or −1. */
  grapple: number;
  regrappleCd: number;
  // Control.
  controller: 'player' | 'orders' | 'ai';
  order: SeaOrder;
  moveX: number;
  moveY: number;
  hasMove: boolean;
  goal: SeaGoal;
  goalTarget: number;
  replanT: number;
  fleeHeading: number;
  /** Distance to the nearest active enemy hull centre (refreshed when planning). */
  nearestEnemyD: number;
  status: SeaShipStatus;
  capturedBy: SideIdx | -1;
  /** Named captain aboard (side flagship) or the player. */
  captainId: CharId | undefined;
  /** Prize enemy ships taken or sunk by this ship (xp). */
  prizes: number;
}

export interface SideState {
  idx: SideIdx;
  key: SeaSideKey;
  setup: SeaSideSetup;
  isPlayer: boolean;
  role: SeaSideRole;
  retreating: boolean;
  retreatS: number;
  flagshipLost: boolean;
  /** Engine index of the current flagship (−1 none). */
  flagship: number;
  pitchT: number;
  pitchUsedT: number;
  fireArrows: boolean;
  startCrew: number;
  startShips: number;
  archeryBonus: number;
  seafaringMult: number;
  startMorale: number;
  captainId: CharId | undefined;
  replanT: number;
}

export interface Grapple {
  /** Boarding ship (attacker) and the grappled ship (defender), engine indices. */
  a: number;
  d: number;
  phase: 'lashing' | 'fighting';
  t: number;
  cutT: number;
  /** The player asked the (player's) defender to cut free at the next attempt. */
  cutRequested: boolean;
  round: number;
  roundT: number;
  aStartMen: number;
  dStartMen: number;
  done: boolean;
}

/** A pending boarding outcome waiting for the captain duel. */
export interface PendingBoarding {
  grapple: Grapple;
  attackerWonDeck: boolean;
}

export interface SeaWorld {
  setup: SeaBattleSetup;
  balance: Balance;
  t: SeaTunables;
  arena: SeaArena;
  /** Battle seconds per step. */
  dt: number;
  tick: number;
  timeS: number;
  rng: Rng;
  windFrom: number;
  windStr: WindStrength;
  ships: SeaShip[];
  sides: [SideState, SideState];
  grapples: Grapple[];
  events: SeaEvent[];
  status: 'running' | 'duelRequested' | 'ended';
  duel: SeaDuelRequest | null;
  pendingBoarding: PendingBoarding | null;
  duelCount: number;
  captainDuel: DuelResult | undefined;
  /** Side of the player (−1: no player side). */
  playerSide: SideIdx | -1;
  playerCharId: CharId | undefined;
  /** Engine index of the ship carrying the player, or −1 (player not in the fight any more). */
  playerShip: number;
  /**
   * Engine index of the ship under the player's own hand (W A S D and the hand-loosed volleys), or
   * −1. The flagship at the start; any of the player's ships after a 'takeHelm'. Only this ship can
   * have the 'player' controller.
   */
  helm: number;
  /** Hand-loosed volleys in flight (insertion order). */
  shots: SeaShot[];
  offerDuels: boolean;
  aiControlsPlayer: boolean;
  captainFates: Record<string, SeaCaptainFate>;
  playerTransferredTo: ShipId | undefined;
  scratch: Float64Array;
  winner: SideIdx | -1;
  endReason: string;
}

// ---------------------------------------------------------------------------------------------
// Inputs (the client calls engine.input(...) between steps; every input is logged with its tick).

export type SeaInput =
  /** Direct helm of the steered ship: throttle −1..1 (negative backs water under oars), rudder −1..1 (+ = starboard). */
  | { kind: 'helm'; throttle: number; rudder: number }
  /** The player takes the helm of another of their ships (the one steered so far follows the fleet). */
  | { kind: 'takeHelm'; ship: number }
  /**
   * The archers of the steered ship (or `ship`) loose a volley over its side, square to the keel,
   * `rangeM` out (clamped to tunables.aim). Ignored while they are still nocking (the volley timer).
   */
  | { kind: 'loose'; side: SeaBroadside; rangeM: number; ship?: number }
  /** Click-to-move for the steered ship (autopilot with hazard avoidance). */
  | { kind: 'moveTo'; x: number; y: number }
  /** Sail/oars toggle (default the flagship). */
  | { kind: 'propulsion'; mode: SeaPropulsion; ship?: number }
  /** Hold-fire toggle for one ship or (ship omitted) every player ship. */
  | { kind: 'holdFire'; on: boolean; ship?: number }
  /** Fire arrows on/off for the player's side (needs pitch). */
  | { kind: 'fireArrows'; on: boolean }
  /** Douse the flagship's (or a ship's) fire: half the crew busy for 10 s, 80 % success. */
  | { kind: 'douse'; ship?: number }
  /** The flagship throws grapnels at a target (nearest valid enemy when omitted). */
  | { kind: 'grapple'; target?: number }
  /** The flagship, being boarded, tries to cut the lines at the next attempt. */
  | { kind: 'cutFree' }
  /**
   * Order for one ship ('move' needs x, y). Given to the flagship it leaves the direct helm and
   * follows the order like any captain until the next 'helm' or 'moveTo' input.
   */
  | { kind: 'order'; ship: number; order: SeaOrderKind; target?: number; x?: number; y?: number }
  /** Fleet order for every player ship except the flagship. */
  | { kind: 'orderAll'; order: SeaOrderKind; target?: number }
  /** The flagship archers' preferred target (null = nearest). */
  | { kind: 'target'; target: number | null }
  /** Sound the retreat: every player ship makes for the arena edge. */
  | { kind: 'retreat' }
  /**
   * "Let your captains finish it": the AI takes over the player's side for the rest of the battle
   * (no further captain duels are offered; later inputs are ignored).
   */
  | { kind: 'captains' };

// ---------------------------------------------------------------------------------------------
// Combat events (for the HUD log, audio cues and visual effects). `t` is battle seconds.

export type SeaEvent = { t: number } & (
  | { kind: 'volley'; from: number; to: number; hits: number; fire: boolean }
  /** A hand-loosed volley leaves the ship; it falls at (x, y) after `flightS` battle seconds. */
  | { kind: 'loose'; from: number; side: SeaBroadside; x: number; y: number; rangeM: number; fire: boolean; flightS: number }
  /** A hand-loosed volley falls: `struck` ships under it, `hits` men struck in all (0 = into the sea). */
  | { kind: 'fall'; from: number; x: number; y: number; fire: boolean; hits: number; struck: number[]; centred: number }
  | { kind: 'ignite'; ship: number; part: 'sail' | 'hull'; cause: 'arrows' | 'seaFire' | 'burnout' }
  | { kind: 'douseStarted'; ship: number }
  | { kind: 'extinguished'; ship: number }
  | { kind: 'douseFailed'; ship: number }
  | { kind: 'sailDestroyed'; ship: number }
  | { kind: 'ram'; from: number; to: number; damage: number }
  | { kind: 'seaFire'; from: number; targets: number[] }
  | { kind: 'collision'; a: number; b: number; damage: number }
  | { kind: 'grounded'; ship: number; rock: boolean; damage: number }
  | { kind: 'grapple'; from: number; to: number }
  | { kind: 'cutFree'; ship: number; from: number }
  | { kind: 'cutFailed'; ship: number; from: number }
  | { kind: 'boardingRound'; attacker: number; defender: number; round: number; attackerLoss: number; defenderLoss: number }
  | { kind: 'boardingWon'; winner: number; loser: number; attackerWon: boolean }
  | { kind: 'struck'; ship: number }
  | { kind: 'captured'; ship: number; by: SideIdx }
  | { kind: 'sunk'; ship: number; burned: boolean }
  | { kind: 'fled'; ship: number }
  | { kind: 'routed'; ship: number }
  | { kind: 'rallied'; ship: number }
  | { kind: 'flagshipLost'; side: SideIdx }
  | { kind: 'transfer'; from: number; to: number }
  | { kind: 'retreat'; side: SideIdx }
  | { kind: 'duelRequested'; playerShip: number; enemyShip: number }
  | { kind: 'duelResolved'; playerWon: boolean | null }
  | { kind: 'ended'; winner: SeaSideKey | 'none' }
);

export type SeaEventKind = SeaEvent['kind'];

// ---------------------------------------------------------------------------------------------
// Render snapshot (the future sea view reads this every frame; previous pose for interpolation).

export interface SeaShipView {
  idx: number;
  shipId: ShipId;
  name: string;
  side: SeaSideKey;
  type: ShipTypeId;
  x: number;
  y: number;
  /** Compass heading in degrees. */
  heading: number;
  prevX: number;
  prevY: number;
  prevHeading: number;
  speedMs: number;
  maxSpeedMs: number;
  lengthM: number;
  beamM: number;
  hullPct: number;
  sailPct: number;
  sailSet: boolean;
  propulsion: SeaPropulsion;
  rowing: boolean;
  sailBurning: boolean;
  hullBurning: boolean;
  dousing: boolean;
  grounded: boolean;
  grappledTo: number;
  status: SeaShipStatus;
  crew: number;
  archers: number;
  rowers: number;
  boarders: number;
  morale: number;
  stamina: number;
  routed: boolean;
  isFlagship: boolean;
  isPlayer: boolean;
  /** The ship the player steers by hand (W A S D, hold Space to loose). */
  isHelm: boolean;
  controller: SeaShip['controller'];
  order: SeaOrderKind;
  orderTarget: number;
  /** Where the ship is sailing to on a move (the flagship's click-to-move or a 'move' order), or null. */
  moveTo: { x: number; y: number } | null;
  goal: SeaGoal;
  holdFire: boolean;
  /** Seconds until the next volley (0 = ready). */
  volleyIn: number;
  ramReady: boolean;
  seaFireCharges: number;
}

export interface SeaRenderState {
  tick: number;
  timeS: number;
  /** Battle seconds per step (the previous pose is `stepS` earlier). */
  stepS: number;
  /** The ship the player steers (−1 none). */
  helm: number;
  /** An enemy the steered ship could throw grapnels at right now (−1 none). */
  helmGrapple: number;
  /** Hand-loosed volleys in flight. */
  shots: { from: number; fromX: number; fromY: number; x: number; y: number; firedT: number; landT: number; fire: boolean }[];
  status: SeaWorld['status'];
  wind: { dir: number; str: WindStrength };
  arena: { sizeM: number; cellM: number; w: number; h: number; terrain: Uint8Array; template: string };
  ships: SeaShipView[];
  sides: {
    key: SeaSideKey;
    isPlayer: boolean;
    retreating: boolean;
    pitchT: number;
    fireArrows: boolean;
    morale: number;
    crew: number;
    activeShips: number;
  }[];
  boardings: { attacker: number; defender: number; phase: Grapple['phase']; round: number }[];
  duel: SeaDuelRequest | null;
  winner: SeaSideKey | 'none' | null;
}
