/**
 * The sea-battle engine (design §15.2): a deterministic fixed-step simulation outside Immer.
 *
 *   const engine = new SeaBattleEngine(setup, { balance, tunables: tunables.seabattle });
 *   // client loop at 20 Hz × speed (pause = stop calling step):
 *   engine.input({ kind: 'helm', throttle: 1, rudder: -0.5 });
 *   engine.step();
 *   const view = engine.snapshot();            // render state (interpolate prev → current pose)
 *   for (const e of engine.drainEvents()) …    // HUD log, sfx (SEA_EVENT_SFX), effects
 *   if (engine.status === 'duelRequested') { … run the duel … engine.resolveCaptainDuel(result) }
 *   if (engine.status === 'ended') dispatch({ type: 'applySeaBattleResult', seaBattleId, result: engine.result()! });
 *
 * One step = 1/tickHz real seconds = timeScale/tickHz battle seconds (§15.2: battle time runs at 4×).
 * Randomness: `Rng.derive(setup.seed, 'arena' | 'combat')`. Same setup + same inputs at the same
 * ticks → identical battle (the input log replays it).
 */
import type { CharId, DuelResult, SeaBattleResult, SeaBattleSetup, SeaShipSetup, ShipId } from '@sim/core/state';
import { clamp } from '@sim/core/dmath';
import { Rng } from '@sim/core/rng';
import { formationSpots, generateArena, type SeaArena } from './arena';
import { nearestGrappleTarget, planShip, soundRetreat, steerShip, updateSideAI } from './ai';
import { autoCaptainDuel, resolveCaptainDuel as resolveDuel, tryGrapple, updateGrapples } from './boarding';
import {
  applyRam,
  capture,
  centerDist,
  nearestEnemy,
  sink,
  startDouse,
  TIMER_EPS,
  updateArchery,
  updateFire,
  updateMorale,
  updateSeaFire,
} from './combat';
import { looseVolley, updateShots } from './volley';
import type {
  SeaEngineContent,
  SeaEngineOptions,
  SeaEvent,
  SeaInput,
  SeaOrder,
  SeaRenderState,
  SeaShip,
  SeaShipView,
  SeaWorld,
  SideIdx,
  SideState,
} from './engineTypes';
import { DEG } from './geom';
import { crewOf, integrateShip, potentialSpeed, resolveCollisions, updateTrig } from './physics';
import { shipAtkEff, shipDefEff, shipRangedAtk, sideStartMorale } from './rules';
import type { SeaCaptainFate, SeaDuelRequest, SeaOrderKind, SeaShipOutcome, SeaSideKey, SeaSideRole } from './types';

const KEYS: [SeaSideKey, SeaSideKey] = ['attacker', 'defender'];

export class SeaBattleEngine {
  /** The mutable world (read-only for consumers; use inputs to act). */
  readonly w: SeaWorld;
  /** Every input and duel resolution with the tick it was applied at (replays feed it back in order). */
  readonly inputLog: SeaLogEntry[] = [];
  private finalResult: SeaBattleResult | null = null;

  constructor(setup: SeaBattleSetup, content: SeaEngineContent, opts: SeaEngineOptions = {}) {
    const balance = content.balance;
    const t = content.tunables;
    const sb = balance.seaBattle;
    const chased: 0 | 1 | undefined = setup.defender.role === 'merchant' ? 1 : setup.attacker.role === 'merchant' ? 0 : undefined;
    const arena = generateArena({ seed: setup.seed, templateId: setup.arena, coastBearing: setup.coastBearing, sizeM: sb.arenaM, tunables: t, chased });
    const playerSide: SideIdx | -1 = setup.attacker.isPlayer ? 0 : setup.defender.isPlayer ? 1 : -1;
    const aiControlsPlayer = opts.aiControlsPlayer === true;
    const sides = [0, 1].map((i) => this.makeSide(setup, content, i as SideIdx)) as [SideState, SideState];
    this.w = {
      setup,
      balance,
      t,
      arena,
      dt: sb.timeScale / sb.tickHz,
      tick: 0,
      timeS: 0,
      rng: Rng.derive(setup.seed, 'combat'),
      windFrom: (((setup.wind.dir % 360) + 360) % 360) * DEG,
      windStr: setup.wind.str,
      ships: [],
      sides,
      grapples: [],
      events: [],
      status: 'running',
      duel: null,
      pendingBoarding: null,
      duelCount: 0,
      captainDuel: undefined,
      playerSide,
      playerCharId: playerSide >= 0 ? setup.playerCharId : undefined,
      playerShip: -1,
      helm: -1,
      shots: [],
      offerDuels: opts.offerCaptainDuels !== false && !aiControlsPlayer,
      aiControlsPlayer,
      captainFates: {},
      playerTransferredTo: undefined,
      scratch: new Float64Array(16),
      winner: -1,
      endReason: '',
    };
    const w = this.w;
    for (const side of sides) {
      const spots = formationSpots(arena, side.idx, side.setup.ships.length, t.battle.lineSpacingM, t.battle.rowSpacingM, t.battle.shipsPerRow);
      side.setup.ships.forEach((ss, k) => {
        const spot = spots[k]!;
        const ship = this.makeShip(content, side, ss, k, spot.x, spot.y, spot.heading);
        w.ships.push(ship);
        if (k === 0) side.flagship = ship.idx;
      });
      side.startCrew = w.ships.filter((s) => s.side === side.idx).reduce((n, s) => n + crewOf(s), 0);
      side.startShips = side.setup.ships.length;
      if (side.captainId !== undefined) w.captainFates[side.captainId] = 'fine';
    }
    if (playerSide !== -1) {
      const flag = w.sides[playerSide].flagship;
      w.playerShip = flag;
      const f = w.ships[flag];
      if (f) {
        if (!aiControlsPlayer) {
          f.controller = 'player';
          w.helm = flag;
        }
        if (w.playerCharId !== undefined) {
          f.captainId = w.playerCharId;
          w.captainFates[w.playerCharId] = 'fine';
        }
      }
    }
    // Stagger AI replans across ships.
    const n = Math.max(1, w.ships.length);
    for (const s of w.ships) s.replanT = (s.idx / n) * t.ai.replanS;
  }

  private makeSide(setup: SeaBattleSetup, content: SeaEngineContent, idx: SideIdx): SideState {
    const side = idx === 0 ? setup.attacker : setup.defender;
    const b = content.balance;
    const role: SeaSideRole = side.role ?? 'warfleet';
    const pitchT = side.hasPitch ? (side.pitchT ?? content.tunables.archery.defaultPitchT) : 0;
    return {
      idx,
      key: KEYS[idx],
      setup: side,
      isPlayer: side.isPlayer,
      role,
      retreating: false,
      retreatS: 0,
      flagshipLost: false,
      flagship: -1,
      pitchT,
      pitchUsedT: 0,
      fireArrows: side.fireArrows ?? content.tunables.archery.fireArrowsDefault,
      startCrew: 0,
      startShips: 0,
      archeryBonus: b.battle.ranged.leaderArcheryBonus * (side.archery ?? 0),
      seafaringMult: 1 + b.sailing.seafaringSpeedBonus * (side.seafaring ?? 0),
      startMorale: sideStartMorale(b, setup, idx),
      captainId: side.captainId,
      replanT: 0,
    };
  }

  private makeShip(content: SeaEngineContent, side: SideState, ss: SeaShipSetup, k: number, x: number, y: number, heading: number): SeaShip {
    const b = content.balance;
    const t = content.tunables;
    const def = b.ships[ss.type];
    const hand = t.ships[ss.type];
    const crew = Math.max(0, ss.crew);
    const archers = clamp(ss.archers, 0, crew);
    const boarders = clamp(ss.boarders, 0, crew - archers);
    const seaFireCulture = side.setup.culture !== undefined && t.fire.seaFireCultures.includes(side.setup.culture);
    const galley = def.tags.includes('ram');
    const seaFire = galley && def.tags.includes('seaFire') && seaFireCulture;
    const knot = t.physics.knotMs;
    const s: SeaShip = {
      idx: this.w ? this.w.ships.length : 0,
      side: side.idx,
      shipId: ss.shipId,
      type: ss.type,
      name: ss.name ?? def.name,
      virtual: ss.virtual === true,
      lengthM: hand.lengthM,
      beamM: hand.beamM,
      halfSeg: Math.max(0, (hand.lengthM - hand.beamM) / 2),
      radius: hand.beamM / 2,
      mass: def.hull,
      turnRate: hand.turnDegS * DEG,
      deepDraft: hand.deepDraft,
      sailMs: def.sailKn * knot,
      rowMs: def.rowKn * knot,
      hullMax: def.hull,
      sailMax: def.sail,
      crewMax: def.crewMax,
      benches: t.physics.oarsShareOfCrewMax * def.crewMax,
      atkEff: shipAtkEff(b, side.setup, ss),
      defEff: shipDefEff(b, side.setup, ss),
      rangedAtk: shipRangedAtk(b, side.setup, ss, t.archery.levyRangedAtk),
      drakkar: ss.type === 'drakkar',
      galley,
      seaFire,
      x,
      y,
      h: heading,
      sinH: 0,
      cosH: 1,
      v: 0,
      pvx: 0,
      pvy: 0,
      px: x,
      py: y,
      ph: heading,
      safeX: x,
      safeY: y,
      safeH: heading,
      throttle: 0,
      rudder: 0,
      propulsion: 'sail',
      rowing: false,
      sailSet: true,
      vmax: 0,
      hull: clamp(ss.hullHp, 1, def.hull),
      sail: clamp(ss.sailHp, 0, def.sail),
      sailBurning: false,
      hullBurnS: 0,
      hullBurnDps: 0,
      seaFireBurning: false,
      douseS: 0,
      groundedS: 0,
      archers,
      rowers: crew - archers - boarders,
      boarders,
      startCrew: crew,
      killed: 0,
      wounded: 0,
      captured: 0,
      rescued: 0,
      morale: side.startMorale,
      startMorale: side.startMorale,
      stamina: clamp(side.setup.stamina ?? 100, 0, 100),
      routed: false,
      volleyT: 0,
      holdFire: false,
      target: -1,
      ramCd: 0,
      backOffS: 0,
      backOffDir: -1,
      siphonCharges: seaFire ? t.fire.seaFireCharges : 0,
      siphonCd: 0,
      grapple: -1,
      regrappleCd: 0,
      controller: side.isPlayer ? 'orders' : 'ai',
      order: { kind: 'follow', target: -1 },
      moveX: x,
      moveY: y,
      hasMove: false,
      goal: 'idle',
      goalTarget: -1,
      replanT: 0,
      fleeHeading: heading,
      nearestEnemyD: Infinity,
      status: 'active',
      capturedBy: -1,
      captainId: k === 0 ? side.captainId : undefined,
      prizes: 0,
    };
    updateTrig(s);
    return s;
  }

  // -------------------------------------------------------------------------------------------
  // Read API.

  get status(): SeaWorld['status'] {
    return this.w.status;
  }
  get tick(): number {
    return this.w.tick;
  }
  get timeS(): number {
    return this.w.timeS;
  }
  get arena(): SeaArena {
    return this.w.arena;
  }
  get ships(): readonly SeaShip[] {
    return this.w.ships;
  }
  /** The pending captain duel (status 'duelRequested'). */
  get duel(): SeaDuelRequest | null {
    return this.w.duel;
  }
  /** Engine index of a ship id, or −1. */
  shipIndex(shipId: ShipId): number {
    const s = this.w.ships.find((x) => x.shipId === shipId);
    return s ? s.idx : -1;
  }
  /** The ship carrying the player (−1 when there is none, or the captains command the side). */
  get playerShip(): number {
    return this.w.playerSide >= 0 && !this.w.aiControlsPlayer ? this.w.playerShip : -1;
  }
  /** The ship the player steers by hand (−1 when there is none). */
  get helmShip(): number {
    return this.w.playerSide >= 0 && !this.w.aiControlsPlayer ? this.w.helm : -1;
  }

  /** Combat events since the last drain. */
  drainEvents(): SeaEvent[] {
    const out = this.w.events;
    this.w.events = [];
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // Inputs.

  /** Applies a player input (logged with the current tick). Invalid inputs are ignored. */
  input(input: SeaInput): void {
    const w = this.w;
    const ps = w.playerSide;
    if (w.status === 'ended' || ps === -1 || w.aiControlsPlayer) return;
    this.inputLog.push({ tick: w.tick, input: JSON.parse(JSON.stringify(input)) as SeaInput });
    const side = w.sides[ps];
    // The ship under the player's hand answers the helm, grapnel and default inputs.
    const flag = w.helm >= 0 ? w.ships[w.helm] : undefined;
    const own = (i: number | undefined): SeaShip | undefined => {
      const s = i === undefined ? flag : w.ships[i];
      return s && s.side === w.playerSide && s.status === 'active' ? s : undefined;
    };
    switch (input.kind) {
      case 'helm':
        if (flag && flag.status === 'active') {
          takeHelm(flag);
          flag.throttle = clamp(Number.isFinite(input.throttle) ? input.throttle : 0, -1, 1);
          flag.rudder = clamp(Number.isFinite(input.rudder) ? input.rudder : 0, -1, 1);
          flag.hasMove = false;
        }
        return;
      case 'takeHelm': {
        const s = Number.isInteger(input.ship) ? own(input.ship) : undefined;
        if (s) setHelm(w, s);
        return;
      }
      case 'loose': {
        const s = own(input.ship);
        if (s && (input.side === 'port' || input.side === 'starboard')) looseVolley(w, s, input.side, input.rangeM);
        return;
      }
      case 'moveTo':
        if (flag && flag.status === 'active' && Number.isFinite(input.x) && Number.isFinite(input.y)) {
          takeHelm(flag);
          flag.moveX = clamp(input.x, 0, w.arena.sizeM);
          flag.moveY = clamp(input.y, 0, w.arena.sizeM);
          flag.hasMove = true;
          flag.goal = 'moveTo';
        }
        return;
      case 'propulsion': {
        const s = own(input.ship);
        if (s) s.propulsion = input.mode;
        return;
      }
      case 'holdFire':
        if (input.ship !== undefined) {
          const s = own(input.ship);
          if (s) s.holdFire = input.on;
        } else for (const s of w.ships) if (s.side === w.playerSide) s.holdFire = input.on;
        return;
      case 'fireArrows':
        side.fireArrows = input.on;
        return;
      case 'douse': {
        const s = own(input.ship);
        if (s) startDouse(w, s);
        return;
      }
      case 'grapple': {
        if (!flag || flag.status !== 'active') return;
        const ti = input.target ?? nearestGrappleTarget(w, flag);
        const target = ti >= 0 ? w.ships[ti] : undefined;
        if (target) tryGrapple(w, flag, target);
        return;
      }
      case 'cutFree': {
        if (!flag || flag.grapple < 0) return;
        const g = w.grapples[flag.grapple];
        if (g && !g.done && g.d === flag.idx && g.phase === 'lashing') g.cutRequested = true;
        return;
      }
      case 'order': {
        const s = own(input.ship);
        if (!s) return;
        const order = makeOrder(w, input.order, input.target, input.x, input.y);
        if (!order) return;
        // The flagship leaves the direct helm and follows the order like any captain.
        if (s.controller === 'player') {
          s.controller = 'orders';
          s.hasMove = false;
        }
        s.order = order;
        s.replanT = 0;
        return;
      }
      case 'orderAll': {
        if (input.order === 'move') return;
        const order = makeOrder(w, input.order, input.target);
        if (!order) return;
        for (const s of w.ships) {
          if (s.side !== w.playerSide || s.status !== 'active' || s.controller === 'player') continue;
          s.order = { ...order };
          s.replanT = 0;
        }
        return;
      }
      case 'target':
        if (flag) flag.target = input.target ?? -1;
        return;
      case 'retreat':
        soundRetreat(w, ps);
        return;
      case 'captains':
        // The AI fights the rest of the battle for the player (the log keeps this entry, so a replay
        // hands over at the same tick).
        w.aiControlsPlayer = true;
        w.offerDuels = false;
        w.helm = -1;
        for (const s of w.ships) {
          if (s.side !== ps) continue;
          s.controller = 'ai';
          s.hasMove = false;
          s.replanT = 0;
        }
        side.replanT = 0;
        return;
    }
  }

  /**
   * Settles the pending captain duel by the blades without the duel scene (the sea-battle scene's
   * "Cross blades", and the captains' fast-forward): a deterministic draw from the duel's own seed,
   * logged like any duel result so a replay settles it the same way.
   */
  autoResolveCaptainDuel(): void {
    const req = this.duelRequest();
    if (!req) return;
    this.resolveCaptainDuel(autoCaptainDuel(this.w, req));
  }

  /**
   * Resolves the paused captain duel (null = the player declined). Ignored unless the engine is in
   * 'duelRequested' (a second click or a stale result never corrupts the battle or its log).
   */
  resolveCaptainDuel(result: DuelResult | null): void {
    if (this.w.status !== 'duelRequested' || !this.w.duel) return;
    resolveDuel(this.w, result);
    ensureHelm(this.w);
    this.inputLog.push({ tick: this.w.tick, duel: result === null ? null : (JSON.parse(JSON.stringify(result)) as DuelResult) });
  }

  /** The pending captain duel, or null (same contract as the land battle engine's `duelRequest()`). */
  duelRequest(): SeaDuelRequest | null {
    return this.w.status === 'duelRequested' ? this.w.duel : null;
  }

  /** Alias of `resolveCaptainDuel` (the land battle engine's name). */
  resolveDuel(result: DuelResult | null): void {
    this.resolveCaptainDuel(result);
  }

  // -------------------------------------------------------------------------------------------
  // Simulation.

  /** Advances one fixed step. No-op unless status is 'running'. */
  step(): void {
    const w = this.w;
    if (w.status !== 'running') return;
    const dt = w.dt;
    const t = w.t;
    w.tick += 1;
    w.timeS += dt;
    const ships = w.ships;

    for (const s of ships) {
      if (s.ramCd > 0) s.ramCd = s.ramCd - dt > TIMER_EPS ? s.ramCd - dt : 0;
      if (s.regrappleCd > 0) s.regrappleCd = s.regrappleCd - dt > TIMER_EPS ? s.regrappleCd - dt : 0;
      if (s.backOffS > 0) s.backOffS = s.backOffS - dt > TIMER_EPS ? s.backOffS - dt : 0;
    }
    for (const side of w.sides) {
      if (side.retreating) side.retreatS += dt;
      side.replanT -= dt;
      if (side.replanT <= 0) {
        side.replanT += t.ai.replanS;
        updateSideAI(w, side.idx);
      }
    }
    for (const s of ships) {
      if (s.status !== 'active') continue;
      s.replanT -= dt;
      if (s.replanT <= 0) {
        s.replanT += t.ai.replanS;
        s.nearestEnemyD = nearestEnemy(w, s, (e) => e.status === 'active').d;
        if (s.controller !== 'player') planShip(w, s);
      }
    }
    for (const s of ships) steerShip(w, s);
    for (const s of ships) integrateShip(w, s);
    resolveCollisions(w, (rammer, target, closing) => applyRam(w, rammer, target, closing));
    updateGrapples(w);
    if (w.status !== 'running') return;
    for (const s of ships) {
      if (s.status !== 'active') continue;
      updateArchery(w, s);
      updateSeaFire(w, s);
    }
    updateShots(w);
    for (const s of ships) {
      if (s.status === 'sunk' || s.status === 'burned' || s.status === 'fled') continue;
      updateFire(w, s);
      if (s.status === 'active' && s.controller !== 'player' && (s.sailBurning || s.hullBurnS > 0) && s.douseS <= 0 && s.grapple < 0) startDouse(w, s);
    }
    for (const s of ships) updateMorale(w, s);
    for (const s of ships) if (s.hull <= 0 && s.status !== 'sunk' && s.status !== 'burned' && s.status !== 'fled') sink(w, s);
    this.slipAway();
    ensureHelm(w);
    this.checkEnd();
  }

  /** Steps until the battle ends (or `maxSteps`). Captain duels go to `onDuel` (default: declined). */
  runToEnd(maxSteps?: number, onDuel?: (req: SeaDuelRequest) => DuelResult | null): SeaBattleResult {
    const w = this.w;
    const cap = maxSteps ?? Math.ceil(w.t.battle.maxBattleS / w.dt) + 10;
    for (let i = 0; i < cap && w.status !== 'ended'; i++) {
      if (w.status === 'duelRequested' && w.duel) this.resolveCaptainDuel(onDuel ? onDuel(w.duel) : null);
      this.step();
    }
    if (w.status !== 'ended') this.finish(-1, 'stepCap');
    return this.result()!;
  }

  private slipAway(): void {
    const w = this.w;
    for (const side of w.sides) {
      if (!side.retreating || side.retreatS < w.t.battle.retreatTimeoutS) continue;
      for (const s of w.ships) {
        if (s.side !== side.idx || s.status !== 'active' || s.grapple >= 0 || s.controller === 'player') continue;
        if (nearestEnemy(w, s, (e) => e.status === 'active').d <= w.t.battle.slipAwayClearM) continue;
        // Nobody slips away from a pursuer that can run it down.
        const mine = potentialSpeed(w, s);
        if (w.ships.some((e) => e.side !== s.side && e.status === 'active' && !e.routed && potentialSpeed(w, e) > mine * 1.05)) continue;
        s.status = 'fled';
        s.v = 0;
        w.events.push({ t: w.timeS, kind: 'fled', ship: s.idx });
      }
    }
  }

  private checkEnd(): void {
    const w = this.w;
    let a0 = 0;
    let a1 = 0;
    for (const s of w.ships) {
      if (s.status !== 'active') continue;
      if (s.side === 0) a0++;
      else a1++;
    }
    if (a0 === 0 || a1 === 0) this.finish(a0 > 0 ? 0 : a1 > 0 ? 1 : -1, a0 + a1 === 0 ? 'bothGone' : 'sideGone');
    else if (w.timeS >= w.t.battle.maxBattleS) this.finish(-1, 'timeout');
  }

  private finish(winner: SideIdx | -1, reason: string): void {
    const w = this.w;
    w.status = 'ended';
    w.winner = winner;
    w.endReason = reason;
    for (const s of w.ships) {
      if (s.status !== 'struck') continue;
      const other: SideIdx = s.side === 0 ? 1 : 0;
      const holder = winner === -1 ? (w.ships.some((x) => x.side === other && x.status === 'active') ? other : -1) : winner;
      if (holder === other) capture(w, s, other);
    }
    for (const g of w.grapples) g.done = true;
    w.duel = null;
    w.pendingBoarding = null;
    w.events.push({ t: w.timeS, kind: 'ended', winner: winner === -1 ? 'none' : KEYS[winner] });
    this.finalResult = this.buildResult();
  }

  /** The battle result once ended (null while running). */
  result(): SeaBattleResult | null {
    return this.finalResult;
  }

  private buildResult(): SeaBattleResult {
    const w = this.w;
    const t = w.t;
    const shipsSunk: ShipId[] = [];
    const shipsBurned: ShipId[] = [];
    const shipsCaptured: ShipId[] = [];
    const shipsFled: ShipId[] = [];
    const capturedBy: Record<string, SeaSideKey> = {};
    const outcomes: SeaShipOutcome[] = [];
    const lost = [
      { killed: 0, wounded: 0, captured: 0 },
      { killed: 0, wounded: 0, captured: 0 },
    ];
    let surrendered = false;
    for (const s of w.ships) {
      if (s.status === 'sunk' || s.status === 'burned') shipsSunk.push(s.shipId);
      if (s.status === 'burned') shipsBurned.push(s.shipId);
      if (s.status === 'captured') {
        shipsCaptured.push(s.shipId);
        capturedBy[s.shipId] = KEYS[s.capturedBy === -1 ? (s.side === 0 ? 1 : 0) : s.capturedBy];
      }
      if (s.status === 'fled') shipsFled.push(s.shipId);
      const l = lost[s.side]!;
      l.killed += s.killed;
      l.wounded += s.status === 'captured' ? 0 : s.wounded;
      l.captured += s.captured;
      const outcome: SeaShipOutcome = {
        shipId: s.shipId,
        side: KEYS[s.side],
        status: s.status === 'struck' ? 'active' : s.status,
        hullHp: Math.max(0, Math.round(s.hull)),
        sailHp: Math.max(0, Math.round(s.sail)),
        crew: s.status === 'captured' || s.status === 'sunk' || s.status === 'burned' ? 0 : Math.round(crewOf(s)),
      };
      if (s.status === 'captured') outcome.capturedBy = capturedBy[s.shipId] as SeaSideKey;
      outcomes.push(outcome);
    }
    const loser: SideIdx | -1 = w.winner === -1 ? -1 : w.winner === 0 ? 1 : 0;
    if (loser >= 0) surrendered = w.ships.some((s) => s.side === loser && s.status === 'captured');
    const crewLost: SeaBattleResult['crewLost'] = [0, 1].map((i) => {
      const l = lost[i]!;
      const start = w.sides[i as SideIdx].startCrew;
      const killed = Math.min(start, Math.round(l.killed));
      const wounded = Math.min(start - killed, Math.round(l.wounded));
      const captured = Math.min(start - killed - wounded, Math.round(l.captured));
      return { side: KEYS[i as SideIdx], killed, wounded, captured };
    });
    const xp: Record<string, number> = {};
    for (const side of w.sides) {
      const prizes = w.ships.filter((s) => s.side !== side.idx && (s.status === 'sunk' || s.status === 'burned' || (s.status === 'captured' && s.capturedBy === side.idx))).length;
      const gain = t.xp.base + (w.winner === side.idx ? t.xp.win : 0) + t.xp.perShip * prizes;
      if (side.captainId !== undefined) xp[side.captainId] = gain;
      if (side.idx === w.playerSide && w.playerCharId !== undefined) xp[w.playerCharId] = gain;
    }
    const fled = loser >= 0 ? w.ships.some((s) => s.side === loser && s.status === 'fled') : shipsFled.length > 0;
    const captainFates: Record<string, SeaCaptainFate> = { ...w.captainFates };
    const result: SeaBattleResult = {
      winner: w.winner === -1 ? 'none' : KEYS[w.winner],
      retreated: fled,
      shipsSunk,
      shipsCaptured,
      crewLost,
      durationS: Math.round(w.timeS),
      xp,
      autoResolved: false,
      shipsBurned,
      shipsFled,
      capturedBy,
      ships: outcomes,
      captainFates,
      pitchUsedT: { attacker: round2(w.sides[0].pitchUsedT), defender: round2(w.sides[1].pitchUsedT) },
      surrendered,
      crewCaptives: { attacker: crewLost[0]!.captured, defender: crewLost[1]!.captured },
    };
    if (w.captainDuel) result.captainDuel = w.captainDuel;
    if (w.playerCharId !== undefined) result.playerFate = captainFates[w.playerCharId as CharId] ?? 'fine';
    if (w.playerTransferredTo !== undefined) result.playerTransferredTo = w.playerTransferredTo;
    return result;
  }

  // -------------------------------------------------------------------------------------------
  // Render snapshot.

  /** Everything the sea view draws this frame (a fresh object; terrain is shared, never mutate it). */
  snapshot(): SeaRenderState {
    const w = this.w;
    const ships: SeaShipView[] = w.ships.map((s) => ({
      idx: s.idx,
      shipId: s.shipId,
      name: s.name,
      side: KEYS[s.side],
      type: s.type,
      x: s.x,
      y: s.y,
      heading: s.h / DEG,
      prevX: s.px,
      prevY: s.py,
      prevHeading: s.ph / DEG,
      speedMs: s.v,
      maxSpeedMs: s.vmax,
      lengthM: s.lengthM,
      beamM: s.beamM,
      hullPct: s.hullMax > 0 ? Math.max(0, s.hull) / s.hullMax : 0,
      sailPct: s.sailMax > 0 ? Math.max(0, s.sail) / s.sailMax : 0,
      sailSet: s.sailSet,
      propulsion: s.propulsion,
      rowing: s.rowing,
      sailBurning: s.sailBurning,
      hullBurning: s.hullBurnS > 0,
      dousing: s.douseS > 0,
      grounded: s.groundedS > 0,
      grappledTo: grappledTo(w, s),
      status: s.status,
      crew: crewOf(s),
      archers: s.archers,
      rowers: s.rowers,
      boarders: s.boarders,
      morale: s.morale,
      stamina: s.stamina,
      routed: s.routed,
      isFlagship: w.sides[s.side].flagship === s.idx,
      isPlayer: s.idx === w.playerShip && w.playerSide >= 0 && !w.aiControlsPlayer,
      isHelm: s.idx === w.helm && w.playerSide >= 0 && !w.aiControlsPlayer,
      controller: s.controller,
      order: s.order.kind,
      orderTarget: s.order.target,
      moveTo: moveTarget(s),
      goal: s.goal,
      holdFire: s.holdFire,
      volleyIn: Math.max(0, s.volleyT),
      ramReady: s.galley && s.ramCd <= 0,
      seaFireCharges: s.siphonCharges,
    }));
    const helm = w.helm >= 0 && !w.aiControlsPlayer ? w.ships[w.helm] : undefined;
    return {
      tick: w.tick,
      timeS: w.timeS,
      stepS: w.dt,
      helm: helm ? helm.idx : -1,
      helmGrapple: helm && helm.status === 'active' && helm.grapple < 0 ? nearestGrappleTarget(w, helm) : -1,
      shots: w.shots.map((x) => ({ from: x.from, fromX: x.fromX, fromY: x.fromY, x: x.x, y: x.y, firedT: x.firedT, landT: x.landT, fire: x.fire })),
      status: w.status,
      wind: { dir: w.windFrom / DEG, str: w.windStr },
      arena: { sizeM: w.arena.sizeM, cellM: w.arena.cellM, w: w.arena.w, h: w.arena.h, terrain: w.arena.terrain, template: w.arena.template },
      ships,
      sides: w.sides.map((side) => {
        let morale = 0;
        let crew = 0;
        let active = 0;
        for (const s of w.ships) {
          if (s.side !== side.idx || s.status !== 'active') continue;
          active++;
          crew += crewOf(s);
          morale += s.morale;
        }
        return { key: side.key, isPlayer: side.isPlayer, retreating: side.retreating, pitchT: side.pitchT, fireArrows: side.fireArrows, morale: active > 0 ? morale / active : 0, crew, activeShips: active };
      }),
      boardings: w.grapples.filter((g) => !g.done).map((g) => ({ attacker: g.a, defender: g.d, phase: g.phase, round: g.round })),
      duel: w.duel,
      winner: w.status === 'ended' ? (w.winner === -1 ? 'none' : KEYS[w.winner]) : null,
    };
  }

  /** Distance between two ships' centres (HUD helper). */
  distance(a: number, b: number): number {
    const sa = this.w.ships[a];
    const sb = this.w.ships[b];
    return sa && sb ? centerDist(sa, sb) : Infinity;
  }
}

/** The steered ship returns to the player's direct helm (from an order it was following). */
function takeHelm(s: SeaShip): void {
  if (s.controller !== 'orders') return;
  s.controller = 'player';
  s.order = { kind: 'follow', target: -1 };
}

/**
 * The player takes the helm of `s`: the ship steered so far goes back to its captain (keeping
 * station on the new one), and `s` comes under the player's hand with its way off the helm
 * (throttle and rudder at rest until the next 'helm' input).
 */
function setHelm(w: SeaWorld, s: SeaShip): void {
  const old = w.helm >= 0 ? w.ships[w.helm] : undefined;
  if (old === s) {
    takeHelm(s);
    return;
  }
  if (old && old.controller === 'player') {
    old.controller = 'orders';
    old.order = { kind: 'follow', target: -1 };
    old.hasMove = false;
    old.replanT = 0;
  }
  s.controller = 'player';
  s.order = { kind: 'follow', target: -1 };
  s.hasMove = false;
  s.throttle = 0;
  s.rudder = 0;
  s.goal = 'idle';
  s.goalTarget = -1;
  w.helm = s.idx;
}

/**
 * Keeps the helm on a ship that can be steered: when the steered ship is lost (sunk, struck, taken,
 * fled), the helm passes to the ship carrying the player, else to the player's first ship still in
 * the fight. No helm once the captains command the side or the player is out of the fight.
 */
function ensureHelm(w: SeaWorld): void {
  if (w.playerSide === -1 || w.aiControlsPlayer) {
    w.helm = -1;
    return;
  }
  const cur = w.helm >= 0 ? w.ships[w.helm] : undefined;
  if (cur && cur.status === 'active' && cur.side === w.playerSide && w.playerShip >= 0) return;
  if (cur && cur.controller === 'player') cur.controller = 'orders';
  w.helm = -1;
  if (w.playerShip < 0) return;
  const carrier = w.ships[w.playerShip];
  const next = carrier && carrier.status === 'active' ? carrier : w.ships.find((x) => x.side === w.playerSide && x.status === 'active');
  if (next) setHelm(w, next);
}

/** A validated order (null when it cannot be given: a move without a finite point). */
function makeOrder(w: SeaWorld, kind: SeaOrderKind, target?: number, x?: number, y?: number): SeaOrder | null {
  if (kind === 'move') {
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { kind, target: -1, x: clamp(x, 0, w.arena.sizeM), y: clamp(y, 0, w.arena.sizeM) };
  }
  return { kind, target: target !== undefined && Number.isInteger(target) ? target : -1 };
}

function moveTarget(s: SeaShip): { x: number; y: number } | null {
  if (s.status !== 'active') return null;
  if (s.controller === 'player') return s.hasMove ? { x: s.moveX, y: s.moveY } : null;
  if (s.controller === 'orders' && s.order.kind === 'move' && s.order.x !== undefined && s.order.y !== undefined) return { x: s.order.x, y: s.order.y };
  return null;
}

function grappledTo(w: SeaWorld, s: SeaShip): number {
  if (s.grapple < 0) return -1;
  const g = w.grapples[s.grapple];
  if (!g || g.done) return -1;
  return g.a === s.idx ? g.d : g.a;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** One entry of the engine's input log. */
export type SeaLogEntry = { tick: number; input: SeaInput } | { tick: number; duel: DuelResult | null };

/**
 * Replays an input log against a fresh engine (bug reports, determinism tests): every entry is
 * applied at its tick, before that tick's step, in the recorded order.
 */
export function replaySeaBattle(setup: SeaBattleSetup, content: SeaEngineContent, log: readonly SeaLogEntry[], opts: SeaEngineOptions = {}): SeaBattleEngine {
  const e = new SeaBattleEngine(setup, content, opts);
  let k = 0;
  const cap = Math.ceil(content.tunables.battle.maxBattleS / e.w.dt) + 10;
  for (let i = 0; i < cap && e.status !== 'ended'; i++) {
    while (k < log.length && log[k]!.tick === e.tick) {
      const entry = log[k++]!;
      if ('duel' in entry) {
        if (e.status === 'duelRequested') e.resolveCaptainDuel(entry.duel);
      } else e.input(entry.input);
    }
    if (e.status === 'duelRequested') break;
    e.step();
  }
  return e;
}
