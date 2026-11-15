/**
 * SeaController: the client-side driver of one sea battle (no React, no Pixi, unit tested in node).
 * It owns the sea-battle engine (src/sim/seabattle, fixed 20 Hz), runs it from real frame time at the
 * chosen speed (1×, 2×, 4×) with pause, keeps the latest render snapshot and the interpolation
 * factor, and turns the player's hand into engine inputs:
 *   - the helm (owner play-test 2026-11-15): the held W A S D / arrow keys become one 'helm' input
 *     per change (throttle and rudder of the steered ship), never one per frame;
 *   - the broadside: holding Space draws the bows and runs an aim marker out from the side facing the
 *     nearest enemy, between the shortest and the longest bowshot and back (the sweep is presentation
 *     only); letting go sends one 'loose' input with that side and range;
 *   - the number keys and Tab take the helm of another ship, G throws grapnels (or cuts them);
 *   - the mouse still commands the other ships (select them, right click to sail there or to attack in
 *     each ship's style, hold, withdraw).
 * It keeps a short log and the visual effects of engine events, settles captain duels, and can hand
 * the player's side to the AI to fight the rest out quickly ("let your captains finish it").
 *
 * The controller never decides a rule: every order goes through the engine's input API, and the
 * result comes from the engine.
 */
import type { Content } from '@content/index';
import type { SeaBattleResult, SeaBattleSetup } from '@sim/core/state';
import { hasKey } from '../../i18n/index';
import { SeaBattleEngine, seaContent, seaEventTextKey, type SeaBroadside, type SeaEvent, type SeaOrderKind, type SeaRenderState, type SeaShipView, type SeaSideKey } from '@sim/seabattle/index';
import type { SteerKeyDir } from '../../input/steering';
import {
  canRam,
  defaultStyle,
  formationTargets,
  isLandAt,
  orderForStyle,
  shipAt,
  shipsInRect,
  summarizeSea,
  type AttackStyle,
  type SeaSummary,
} from './logic';

export type SeaSpeed = 1 | 2 | 4;
export type Translate = (key: string, vars?: Readonly<Record<string, string | number | boolean>>) => string;

/** One line of the battle log. */
export interface SeaLogLine {
  id: number;
  timeS: number;
  text: string;
  tone: 'good' | 'bad' | 'neutral';
  at: number;
  ship?: number;
}

/** A visual effect started by an engine event (the view animates it from `born`, real seconds). */
export interface SeaFx {
  id: number;
  kind: 'arrows' | 'ram' | 'splash' | 'sink' | 'grapple' | 'caption' | 'seaFire' | 'fall';
  born: number;
  from?: number;
  to?: number;
  x: number;
  y: number;
  fire?: boolean;
  n?: number;
  text?: string;
  tone?: 'good' | 'bad' | 'neutral';
}

/** A sound to play (audio catalog id and parameters), collected for the scene. */
export interface SeaCue {
  id: 'battle.arrowVolley' | 'battle.clash' | 'battle.shieldBash' | 'sea.splash' | 'sea.hullCreak' | 'battle.warHorn' | 'battle.seaFire' | 'battle.warCry';
  params?: Record<string, string | number>;
}

/** The aim marker while the player draws (world metres; the view draws it at the steered ship). */
export interface SeaAim {
  ship: number;
  side: SeaBroadside;
  rangeM: number;
  /** Where the arrows would fall if loosed now (from the current engine pose). */
  x: number;
  y: number;
  /** 0 at the shortest bowshot, 1 at the longest. */
  reach: number;
}

/** The numbers the aim and the helm strip read (seabattle tunables `aim`). */
export interface SeaAimConfig {
  minRangeM: number;
  maxRangeM: number;
  sweepRealS: number;
  fallRadiusM: number;
  nockS: number;
}

/** What the steered ship's bows can do now. */
export type SeaVolleyState = 'ready' | 'nocking' | 'boarding' | 'none';

/** Throttle and rudder for a held steering direction (W ahead, S astern, A port, D starboard). */
export function helmFor(dir: SteerKeyDir | null): { throttle: number; rudder: number } {
  if (dir === null) return { throttle: 0, rudder: 0 };
  const throttle = dir.startsWith('n') ? 1 : dir.startsWith('s') ? -1 : 0;
  const rudder = dir.endsWith('e') ? 1 : dir.endsWith('w') ? -1 : 0;
  return { throttle, rudder };
}

/**
 * The aim marker's range after `heldS` real seconds of drawing: it runs out from the shortest to the
 * longest bowshot in `sweepRealS`, then back, and so on, so a release has to be timed.
 */
export function sweepRange(heldS: number, cfg: Pick<SeaAimConfig, 'minRangeM' | 'maxRangeM' | 'sweepRealS'>): number {
  const u = Math.max(0, heldS) / Math.max(1e-6, cfg.sweepRealS);
  const leg = u % 2;
  const f = leg <= 1 ? leg : 2 - leg;
  return cfg.minRangeM + (cfg.maxRangeM - cfg.minRangeM) * f;
}

/** The side of a ship (compass heading in degrees) that faces a point: starboard is right of the bow. */
export function sideFacing(ship: Pick<SeaShipView, 'x' | 'y' | 'heading'>, x: number, y: number): SeaBroadside {
  const h = (ship.heading * Math.PI) / 180;
  // Starboard unit vector (x east, y south): the heading turned 90° clockwise.
  return (x - ship.x) * Math.cos(h) + (y - ship.y) * Math.sin(h) >= 0 ? 'starboard' : 'port';
}

/** Unit vector out of a ship's side (x east, y south). */
export function broadsideOf(headingDeg: number, side: SeaBroadside): [number, number] {
  const h = (headingDeg * Math.PI) / 180;
  return side === 'starboard' ? [Math.cos(h), Math.sin(h)] : [-Math.cos(h), -Math.sin(h)];
}

const OTHER: Record<SeaSideKey, SeaSideKey> = { attacker: 'defender', defender: 'attacker' };
/** Steps run at most per frame in normal play (a slow frame drops time rather than stalling). */
const MAX_STEPS_PER_FRAME = 8;
/** Real milliseconds a fast-forward frame may spend stepping. */
const FAST_BUDGET_MS = 12;

/** Events worth a line in the log (volleys and per-round deck losses are shown, not written). */
const LOGGED: ReadonlySet<SeaEvent['kind']> = new Set<SeaEvent['kind']>([
  'ignite',
  'sailDestroyed',
  'ram',
  'seaFire',
  'grounded',
  'grapple',
  'cutFree',
  'boardingWon',
  'struck',
  'captured',
  'sunk',
  'fled',
  'routed',
  'flagshipLost',
  'transfer',
  'retreat',
  'duelRequested',
  'duelResolved',
  'ended',
  'fall',
]);

/** Floating caption per event kind (locale key under seaView.fx). */
const CAPTIONS: Readonly<Partial<Record<SeaEvent['kind'], string>>> = {
  grapple: 'grapple',
  ram: 'ram',
  sunk: 'sunk',
  struck: 'struck',
  captured: 'captured',
  routed: 'routed',
  ignite: 'fire',
  fled: 'fled',
};

export class SeaController {
  readonly engine: SeaBattleEngine;
  readonly setup: SeaBattleSetup;
  readonly content: Content;
  readonly side: SeaSideKey;
  readonly enemySide: SeaSideKey;
  readonly sideIdx: 0 | 1;
  readonly galleyTypes: readonly string[];
  paused = true;
  speed: SeaSpeed = 1;
  /** The player handed the battle to the AI and it is being fought out quickly. */
  fastForward = false;
  snap: SeaRenderState;
  /** Interpolation between the previous and the current engine pose (0..1). */
  alpha = 1;
  selected: number[] = [];
  readonly styles: Record<number, AttackStyle> = {};
  readonly log: SeaLogLine[] = [];
  readonly fx: SeaFx[] = [];
  /** When a ship went down (real seconds), for the sinking animation. */
  readonly sunkAt: Record<number, number> = {};
  notice: { key: string; at: number } | null = null;
  /** Seconds of real time since the battle opened (animation clock). */
  realTime = 0;
  /** The aim and helm numbers (seabattle tunables). */
  readonly aimCfg: SeaAimConfig;
  /** Throttle and rudder the held keys ask for. */
  private wanted = { throttle: 0, rudder: 0 };
  /** Real time the player began to draw (Space held), or null. */
  private drawFrom: number | null = null;
  private readonly t: Translate;
  private cues: SeaCue[] = [];
  private acc = 0;
  private nextId = 1;
  private version = 0;
  private notifyAt = 0;
  private readonly listeners = new Set<() => void>();

  constructor(setup: SeaBattleSetup, content: Content, t: Translate) {
    this.setup = JSON.parse(JSON.stringify(setup)) as SeaBattleSetup;
    this.content = content;
    this.t = t;
    this.engine = new SeaBattleEngine(this.setup, seaContent(content));
    this.side = this.setup.defender.isPlayer && !this.setup.attacker.isPlayer ? 'defender' : 'attacker';
    this.enemySide = OTHER[this.side];
    this.sideIdx = this.side === 'attacker' ? 0 : 1;
    const ships = content.balance.ships as Readonly<Record<string, { tags: readonly string[] }>>;
    this.galleyTypes = Object.keys(ships).filter((k) => ships[k]!.tags.includes('ram'));
    const aim = content.tunables.seabattle.aim;
    this.aimCfg = { minRangeM: aim.minRangeM, maxRangeM: aim.maxRangeM, sweepRealS: aim.sweepRealS, fallRadiusM: aim.fallRadiusM, nockS: aim.nockS };
    this.snap = this.engine.snapshot();
    for (const s of this.snap.ships) if (s.side === this.side) this.styles[s.idx] = defaultStyle(s, this.galleyTypes);
    // Nothing is selected at first: the player steers the flagship with the keys; the mouse selects
    // the other ships when they are wanted.
  }

  // ---- subscription (React reads through useSyncExternalStore) ----------------------------------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  // ---- ships -----------------------------------------------------------------------------------

  ship(idx: number): SeaShipView | undefined {
    return idx >= 0 ? this.snap.ships[idx] : undefined;
  }

  /** The player's ships in roster order (the number keys follow it), also those gone. */
  roster(): SeaShipView[] {
    return this.snap.ships.filter((s) => s.side === this.side);
  }

  /** Selected ships still able to take orders. */
  selectedShips(): SeaShipView[] {
    return this.selected.map((i) => this.ship(i)).filter((s): s is SeaShipView => s !== undefined && s.status === 'active' && s.side === this.side);
  }

  /** Display name of a ship by engine index. */
  shipName(idx: number): string {
    return this.ship(idx)?.name ?? '';
  }

  /** Display name of a ship type. */
  typeName(type: string): string {
    const key = `seaView.hull.${type}`;
    return hasKey(key) ? this.t(key) : ((this.content.balance.ships as Readonly<Record<string, { name?: string }>>)[type]?.name ?? type);
  }

  canRam(s: Pick<SeaShipView, 'type'>): boolean {
    return canRam(s, this.galleyTypes);
  }

  /** The style of a ship (its default until the player changes it). */
  styleOf(idx: number): AttackStyle {
    const s = this.ship(idx);
    return this.styles[idx] ?? (s ? defaultStyle(s, this.galleyTypes) : 'board');
  }

  /** The ship the grapple holds this ship to, or −1. */
  grappledTo(idx: number): number {
    return this.ship(idx)?.grappledTo ?? -1;
  }

  // ---- time ------------------------------------------------------------------------------------

  setPaused(paused: boolean): void {
    if (this.snap.status === 'ended') return;
    this.paused = paused;
    this.changed();
  }

  togglePause(): void {
    this.setPaused(!this.paused);
  }

  setSpeed(speed: SeaSpeed): void {
    this.speed = speed;
    if (this.snap.status !== 'ended') this.paused = false;
    this.changed();
  }

  /** The engine has finished (read fresh: the engine changes it while stepping). */
  isOver(): boolean {
    return this.engine.status === 'ended';
  }

  /**
   * Advances the battle by `dtS` seconds of real time (one animation frame). Returns true when the
   * engine stepped (the view refreshes its snapshot).
   */
  frame(dtS: number): boolean {
    const dt = Math.min(0.25, Math.max(0, dtS));
    this.realTime += dt;
    while (this.fx.length > 0 && this.realTime - this.fx[0]!.born > 4) this.fx.shift();
    const engine = this.engine;
    if (engine.status === 'ended') return false;
    const before = engine.tick;
    if (this.fastForward) {
      const t0 = now();
      while (!this.isOver() && now() - t0 < FAST_BUDGET_MS) {
        if (engine.status === 'duelRequested') engine.autoResolveCaptainDuel();
        engine.step();
      }
      this.alpha = 1;
    } else if (engine.status === 'duelRequested') {
      if (this.snap.duel === null) this.refresh();
      return false;
    } else if (!this.paused) {
      const hz = this.content.balance.seaBattle.tickHz;
      this.acc += dt * hz * this.speed;
      let n = 0;
      while (this.acc >= 1 && n < MAX_STEPS_PER_FRAME && engine.status === 'running') {
        engine.step();
        this.acc -= 1;
        n++;
      }
      if (n >= MAX_STEPS_PER_FRAME) this.acc = Math.min(this.acc, 0.99);
      this.alpha = Math.max(0, Math.min(1, this.acc));
    }
    if (engine.tick === before) return false;
    this.refresh();
    return true;
  }

  /** Takes a new snapshot and digests the events since the last one. */
  refresh(): void {
    const engine = this.engine;
    this.snap = engine.snapshot();
    for (const e of engine.drainEvents()) this.digest(e);
    this.selected = this.selected.filter((i) => this.snap.ships[i]?.status === 'active');
    this.syncHelm();
    if (this.drawFrom !== null && this.volleyState() !== 'ready') this.drawFrom = null;
    if (engine.status === 'ended') {
      this.paused = true;
      this.fastForward = false;
      this.alpha = 1;
    }
    if (this.fastForward) {
      if (this.realTime >= this.notifyAt) {
        this.notifyAt = this.realTime + 0.2;
        this.changed();
      }
      return;
    }
    // React re-renders at most ~10 times a second; the canvas reads the controller every frame.
    if (this.realTime >= this.notifyAt || engine.status !== 'running') {
      this.notifyAt = this.realTime + 0.1;
      this.changed();
    }
  }

  // ---- events ----------------------------------------------------------------------------------

  private mine(ship: number | undefined): boolean {
    return ship !== undefined && this.ship(ship)?.side === this.side;
  }

  private toneOf(e: SeaEvent): SeaLogLine['tone'] {
    switch (e.kind) {
      case 'sunk':
      case 'struck':
      case 'captured':
      case 'routed':
      case 'fled':
      case 'grounded':
      case 'ignite':
      case 'sailDestroyed':
        return this.mine(e.ship) ? 'bad' : 'good';
      case 'ram':
      case 'grapple':
        return this.mine(e.from) ? 'good' : 'bad';
      case 'fall':
        return e.hits > 0 ? (this.mine(e.from) ? 'good' : 'bad') : 'neutral';
      case 'boardingWon':
        return this.mine(e.winner) ? 'good' : 'bad';
      case 'cutFree':
        return this.mine(e.ship) ? 'good' : 'bad';
      case 'flagshipLost':
      case 'retreat':
        return e.side === this.sideIdx ? 'bad' : 'good';
      case 'ended':
        return e.winner === this.side ? 'good' : e.winner === 'none' ? 'neutral' : 'bad';
      case 'duelResolved':
        return e.playerWon === true ? 'good' : e.playerWon === false ? 'bad' : 'neutral';
      default:
        return 'neutral';
    }
  }

  /** The locale variables of an event's log line. */
  eventVars(e: SeaEvent): Record<string, string | number> {
    const n = (i: number) => this.shipName(i);
    switch (e.kind) {
      case 'volley':
        return { ship: n(e.from), target: n(e.to), hits: Math.round(e.hits) };
      case 'loose':
        return { ship: n(e.from) };
      case 'fall':
        return { ship: n(e.from), target: e.struck.map(n).join(', '), hits: Math.round(e.hits) };
      case 'ram':
        return { ship: n(e.from), target: n(e.to), damage: Math.round(e.damage) };
      case 'seaFire':
        return { ship: n(e.from) };
      case 'collision':
        return { ship: n(e.a), target: n(e.b) };
      case 'grapple':
        return { ship: n(e.from), target: n(e.to) };
      case 'cutFree':
      case 'cutFailed':
        return { ship: n(e.ship), target: n(e.from) };
      case 'boardingRound':
        return { ship: n(e.attacker), target: n(e.defender), round: e.round, attackerLoss: Math.round(e.attackerLoss), defenderLoss: Math.round(e.defenderLoss) };
      case 'boardingWon':
        return { ship: n(e.winner), target: n(e.loser) };
      case 'captured':
        return { ship: n(e.ship) };
      case 'flagshipLost':
      case 'retreat':
        return { side: e.side === 0 ? 'attacker' : 'defender' };
      case 'transfer':
        return { ship: n(e.from), target: n(e.to) };
      case 'duelRequested':
        return { ship: n(e.playerShip), target: n(e.enemyShip) };
      case 'ended':
      case 'duelResolved':
        return {};
      default:
        return 'ship' in e ? { ship: n(e.ship) } : {};
    }
  }

  /** Where an event happened (for effects and the log's focus), or null. */
  private placeOf(e: SeaEvent): { x: number; y: number; ship: number } | null {
    const i = 'ship' in e ? e.ship : 'to' in e ? e.to : 'defender' in e ? e.defender : 'loser' in e ? e.loser : 'from' in e ? e.from : -1;
    const s = this.ship(i);
    return s ? { x: s.x, y: s.y, ship: i } : null;
  }

  private addFx(fx: Omit<SeaFx, 'id' | 'born'>): void {
    if (this.fastForward) return;
    this.fx.push({ ...fx, id: this.nextId++, born: this.realTime });
    if (this.fx.length > 160) this.fx.shift();
  }

  private cue(c: SeaCue): void {
    if (this.fastForward) return;
    if (this.cues.length < 12) this.cues.push(c);
  }

  /** Sounds collected since the last call (the scene plays them). */
  drainCues(): SeaCue[] {
    const out = this.cues;
    this.cues = [];
    return out;
  }

  private digest(e: SeaEvent): void {
    const place = this.placeOf(e);
    switch (e.kind) {
      case 'volley': {
        const from = this.ship(e.from);
        if (from) this.addFx({ kind: 'arrows', from: e.from, to: e.to, x: from.x, y: from.y, fire: e.fire, n: Math.min(9, 3 + Math.round(e.hits)) });
        this.cue({ id: 'battle.arrowVolley', params: { size: Math.min(1, 0.3 + e.hits / 10) } });
        break;
      }
      case 'loose':
        this.cue({ id: 'battle.arrowVolley', params: { size: 1 } });
        break;
      case 'fall': {
        this.addFx({ kind: 'fall', from: e.from, x: e.x, y: e.y, fire: e.fire, n: Math.round(e.hits) });
        if (this.mine(e.from)) {
          const text = e.struck.length === 0 ? this.t('seaView.fx.miss') : this.t('seaView.fx.hit', { n: Math.round(e.hits) });
          this.addFx({ kind: 'caption', x: e.x, y: e.y, text, tone: e.struck.length === 0 ? 'neutral' : 'good' });
        }
        break;
      }
      case 'ram':
        if (place) this.addFx({ kind: 'ram', to: e.to, from: e.from, x: place.x, y: place.y });
        this.cue({ id: 'sea.hullCreak' });
        break;
      case 'collision':
        this.cue({ id: 'sea.hullCreak' });
        break;
      case 'seaFire': {
        const from = this.ship(e.from);
        if (from) this.addFx({ kind: 'seaFire', from: e.from, x: from.x, y: from.y });
        this.cue({ id: 'battle.seaFire' });
        break;
      }
      case 'grapple':
        if (place) this.addFx({ kind: 'grapple', from: e.from, to: e.to, x: place.x, y: place.y });
        this.cue({ id: 'battle.warCry' });
        break;
      case 'boardingRound':
        this.cue({ id: 'battle.clash', params: { count: Math.min(8, 2 + e.round * 2) } });
        break;
      case 'sunk':
        this.sunkAt[e.ship] = this.realTime;
        if (place) this.addFx({ kind: 'sink', x: place.x, y: place.y, from: e.ship });
        this.cue({ id: 'sea.splash', params: { size: 1 } });
        break;
      case 'retreat':
        this.cue({ id: 'battle.warHorn', params: { call: 'retreat' } });
        break;
      default:
        break;
    }
    const caption = CAPTIONS[e.kind];
    if (caption !== undefined && place && !(e.kind === 'ignite' && e.part === 'hull' && e.cause === 'burnout')) {
      this.addFx({ kind: 'caption', x: place.x, y: place.y, from: place.ship, text: this.t(`seaView.fx.${caption}`), tone: this.toneOf(e) });
    }
    if (!LOGGED.has(e.kind)) return;
    if (e.kind === 'fall' && !this.mine(e.from)) return;
    const line: SeaLogLine = { id: this.nextId++, timeS: e.t, text: this.t(seaEventTextKey(e), this.eventVars(e)), tone: this.toneOf(e), at: this.realTime };
    if (place) line.ship = place.ship;
    this.log.push(line);
    if (this.log.length > 120) this.log.shift();
  }

  private say(key: string): void {
    this.notice = { key, at: this.realTime };
    this.changed();
  }

  // ---- the helm and the broadside --------------------------------------------------------------

  /** The ship the player steers, or undefined. */
  helmShip(): SeaShipView | undefined {
    const s = this.ship(this.snap.helm);
    return s && s.status === 'active' ? s : undefined;
  }

  /** The held steering keys changed (W ahead, S astern, A port, D starboard; null: none held). */
  setHelmDir(dir: SteerKeyDir | null): void {
    this.wanted = helmFor(dir);
    if (this.snap.status === 'ended' || this.fastForward || !this.helmShip()) return;
    this.engine.input({ kind: 'helm', throttle: this.wanted.throttle, rudder: this.wanted.rudder });
    this.ordered();
  }

  /** What the held keys ask of the helm now. */
  get helmWanted(): { throttle: number; rudder: number } {
    return { ...this.wanted };
  }

  /**
   * Puts the held keys back on the helm when the engine let go of them (the helm passed to another
   * ship, a grapple was cut or won, an autopilot arrived): one input, only when they differ.
   */
  private syncHelm(): void {
    if (this.fastForward || this.engine.status === 'ended') return;
    const i = this.engine.helmShip;
    const s = i >= 0 ? this.engine.w.ships[i] : undefined;
    if (!s || s.status !== 'active' || s.controller !== 'player' || s.hasMove || s.grapple >= 0) return;
    if (s.throttle === this.wanted.throttle && s.rudder === this.wanted.rudder) return;
    this.engine.input({ kind: 'helm', throttle: this.wanted.throttle, rudder: this.wanted.rudder });
  }

  /** Takes the helm of the k-th ship of the roster (number keys, 1-based). */
  takeHelmIndex(k: number): void {
    const s = this.roster()[k - 1];
    if (s && s.status === 'active') this.takeHelm(s.idx);
  }

  /** Takes the helm of a ship (engine index). */
  takeHelm(idx: number): void {
    const s = this.ship(idx);
    if (!s || s.side !== this.side || s.status !== 'active' || this.fastForward || this.snap.status === 'ended') return;
    this.drawFrom = null;
    this.engine.input({ kind: 'takeHelm', ship: idx });
    this.syncHelm();
    this.ordered();
  }

  /** Tab: the helm passes to the next ship of the fleet still in the fight. */
  cycleHelm(): void {
    const live = this.roster().filter((s) => s.status === 'active');
    if (live.length < 2) return;
    const at = live.findIndex((s) => s.idx === this.snap.helm);
    this.takeHelm(live[(at + 1) % live.length]!.idx);
  }

  /** What the steered ship's bows can do now. */
  volleyState(): SeaVolleyState {
    const s = this.helmShip();
    if (!s || s.archers < 0.5) return 'none';
    if (s.grappledTo >= 0) return 'boarding';
    return s.volleyIn > 1e-9 ? 'nocking' : 'ready';
  }

  /** Share of the nocking done (1 = ready). */
  nockProgress(): number {
    const s = this.helmShip();
    if (!s) return 0;
    return Math.max(0, Math.min(1, 1 - s.volleyIn / Math.max(1e-6, this.aimCfg.nockS)));
  }

  /** Is the player drawing (Space held, the marker out)? */
  get drawing(): boolean {
    return this.drawFrom !== null;
  }

  /** The enemy ship still fighting nearest to the steered ship, or undefined. */
  nearestEnemy(): SeaShipView | undefined {
    const me = this.helmShip();
    if (!me) return undefined;
    let best: SeaShipView | undefined;
    let bestD = Infinity;
    for (const s of this.snap.ships) {
      if (s.side === this.side || s.status !== 'active') continue;
      const d = Math.hypot(s.x - me.x, s.y - me.y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** The side the bows would loose over now: the one facing the nearest enemy. */
  aimSide(): SeaBroadside {
    const me = this.helmShip();
    const foe = this.nearestEnemy();
    return me && foe ? sideFacing(me, foe.x, foe.y) : 'starboard';
  }

  /** The aim marker while drawing, else null. */
  get aim(): SeaAim | null {
    if (this.drawFrom === null) return null;
    const me = this.helmShip();
    if (!me) return null;
    const side = this.aimSide();
    const rangeM = sweepRange(this.realTime - this.drawFrom, this.aimCfg);
    const [ux, uy] = broadsideOf(me.heading, side);
    const span = Math.max(1e-6, this.aimCfg.maxRangeM - this.aimCfg.minRangeM);
    return { ship: me.idx, side, rangeM, x: me.x + ux * rangeM, y: me.y + uy * rangeM, reach: (rangeM - this.aimCfg.minRangeM) / span };
  }

  /** Space pressed: the archers draw (when their bows are nocked). Returns true when drawing began. */
  beginDraw(): boolean {
    if (this.drawFrom !== null) return true;
    if (this.paused || this.fastForward || this.engine.status !== 'running') return false;
    const state = this.volleyState();
    if (state !== 'ready') {
      this.say(state === 'nocking' ? 'seaView.notice.nocking' : state === 'boarding' ? 'seaView.notice.boarding' : 'seaView.notice.noArchers');
      return false;
    }
    this.drawFrom = this.realTime;
    this.changed();
    return true;
  }

  /** Space let go: the archers loose where the marker is. */
  releaseDraw(): void {
    const aim = this.aim;
    this.drawFrom = null;
    if (!aim || this.paused || this.fastForward || this.engine.status !== 'running') {
      this.changed();
      return;
    }
    this.engine.input({ kind: 'loose', side: aim.side, rangeM: aim.rangeM, ship: aim.ship });
    this.refresh();
    this.changed();
  }

  /** The draw is let down without loosing (a card opened, the window lost focus). */
  cancelDraw(): void {
    if (this.drawFrom === null) return;
    this.drawFrom = null;
    this.changed();
  }

  /** G: throw grapnels at the enemy alongside, or (being boarded) cut the lines. */
  grapnels(): void {
    const s = this.helmShip();
    if (!s || this.fastForward || this.snap.status === 'ended') return;
    if (s.grappledTo >= 0) {
      this.engine.input({ kind: 'cutFree' });
      return this.ordered();
    }
    if (this.snap.helmGrapple < 0) return this.say('seaView.notice.notAlongside');
    this.engine.input({ kind: 'grapple', target: this.snap.helmGrapple });
    this.refresh();
    this.changed();
  }

  // ---- selection -------------------------------------------------------------------------------

  select(ids: readonly number[], add = false): void {
    const own = ids.filter((i) => this.ship(i)?.side === this.side && this.ship(i)?.status === 'active');
    if (add) {
      const next = [...this.selected];
      for (const i of own) {
        const k = next.indexOf(i);
        if (k >= 0 && own.length === 1) next.splice(k, 1);
        else if (k < 0) next.push(i);
      }
      this.selected = next;
    } else this.selected = own;
    this.changed();
  }

  /** Left click on the water: select the own ship there, or clear the selection. */
  clickAt(x: number, y: number, tolM: number, inflate: number, add: boolean): void {
    const hit = shipAt(this.snap, x, y, tolM, inflate, this.side);
    const s = this.ship(hit);
    if (s && s.side === this.side && s.status === 'active') this.select([hit], add);
    else if (!add && !s) {
      this.selected = [];
      this.changed();
    }
  }

  /** Double click on an own ship: the whole fleet. */
  doubleClickAt(x: number, y: number, tolM: number, inflate: number): void {
    const hit = shipAt(this.snap, x, y, tolM, inflate, this.side);
    if (this.ship(hit)?.side === this.side) this.selectAll();
  }

  selectBox(x0: number, y0: number, x1: number, y1: number, add: boolean): void {
    this.select(shipsInRect(this.snap, this.side, x0, y0, x1, y1), add);
  }

  /** Number key k (1-based) in roster order. */
  selectIndex(k: number, add = false): void {
    const s = this.roster()[k - 1];
    if (s && s.status === 'active') this.select([s.idx], add);
  }

  selectAll(): void {
    this.select(this.roster().filter((s) => s.status === 'active').map((s) => s.idx));
  }

  // ---- orders ----------------------------------------------------------------------------------

  private orderShip(s: SeaShipView, order: SeaOrderKind, extra: { target?: number; x?: number; y?: number } = {}): void {
    const input: Parameters<SeaBattleEngine['input']>[0] = { kind: 'order', ship: s.idx, order };
    if (extra.target !== undefined) input.target = extra.target;
    if (extra.x !== undefined) input.x = extra.x;
    if (extra.y !== undefined) input.y = extra.y;
    this.engine.input(input);
  }

  /** Re-reads the snapshot after an order so the view and the cards show it at once (also paused). */
  private ordered(): void {
    this.snap = this.engine.snapshot();
    this.changed();
  }

  /**
   * Right click: attack the enemy ship there in each selected ship's style, or sail the selection to
   * the spot (keeping their formation). The flagship sails there under the player's own helm.
   */
  commandAt(x: number, y: number, tolM: number, inflate: number): void {
    if (this.snap.status === 'ended' || this.fastForward) return;
    const ships = this.selectedShips();
    if (ships.length === 0) return this.say('seaView.notice.selectFirst');
    const hit = shipAt(this.snap, x, y, tolM, inflate, this.enemySide);
    const foe = this.ship(hit);
    if (foe && foe.side !== this.side && (foe.status === 'active' || foe.status === 'struck')) {
      // The ship under the player's own hand is fought with the keys, not sent off by its captain.
      const sent = ships.filter((s) => !(s.isHelm && s.controller === 'player'));
      if (sent.length === 0) return this.say('seaView.notice.atHelm');
      for (const s of sent) this.orderShip(s, orderForStyle(this.styleOf(s.idx), this.canRam(s)), { target: foe.idx });
      return this.ordered();
    }
    if (isLandAt(this.snap.arena, x, y)) return this.say('seaView.notice.land');
    for (const p of formationTargets(ships, x, y)) {
      const s = this.ship(p.idx)!;
      if (s.isHelm && s.controller !== 'ai') this.engine.input({ kind: 'moveTo', x: p.x, y: p.y });
      else this.orderShip(s, 'move', { x: p.x, y: p.y });
    }
    this.ordered();
  }

  /** Sets the attack style of the selection; ships already attacking switch to it at once. */
  setStyle(style: AttackStyle): void {
    const ships = this.selectedShips();
    if (ships.length === 0) return this.say('seaView.notice.selectFirst');
    for (const s of ships) {
      this.styles[s.idx] = style;
      const attacking = s.order === 'attack' || s.order === 'board' || s.order === 'shoot';
      if (attacking && s.orderTarget >= 0) this.orderShip(s, orderForStyle(style, this.canRam(s)), { target: s.orderTarget });
    }
    if (style === 'ram' && !ships.some((s) => this.canRam(s))) this.say('seaView.notice.noRam');
    this.ordered();
  }

  /** The selection stops where it is. */
  holdSelected(): void {
    const ships = this.selectedShips();
    if (ships.length === 0) return this.say('seaView.notice.selectFirst');
    for (const s of ships) this.orderShip(s, 'hold');
    this.ordered();
  }

  /** The selection makes for open water and slips away. */
  withdrawSelected(): void {
    const ships = this.selectedShips();
    if (ships.length === 0) return this.say('seaView.notice.selectFirst');
    for (const s of ships) this.orderShip(s, 'withdraw');
    this.ordered();
  }

  /** Every ship of the fleet breaks off (the horns sound the retreat). */
  withdrawAll(): void {
    if (this.snap.status === 'ended') return;
    for (const s of this.roster()) if (s.status === 'active') this.orderShip(s, 'withdraw');
    this.engine.input({ kind: 'retreat' });
    this.paused = false;
    this.ordered();
  }

  // ---- duels, captains, the end ----------------------------------------------------------------

  /** The player crosses blades with the enemy captain (settled at once). */
  fightDuel(): void {
    if (this.engine.status !== 'duelRequested') return;
    this.engine.autoResolveCaptainDuel();
    this.refresh();
    this.changed();
  }

  /** The deck fight decides without the captains. */
  declineDuel(): void {
    if (this.engine.status !== 'duelRequested') return;
    this.engine.resolveCaptainDuel(null);
    this.refresh();
    this.changed();
  }

  /** Hands the player's side to the AI and fights the rest out quickly. */
  letCaptainsFinish(): void {
    if (this.engine.status === 'ended') return;
    if (this.engine.status === 'duelRequested') this.engine.autoResolveCaptainDuel();
    this.engine.input({ kind: 'captains' });
    this.drawFrom = null;
    this.fastForward = true;
    this.paused = false;
    this.selected = [];
    this.changed();
  }

  /** The result once the battle has ended. */
  result(): SeaBattleResult | null {
    return this.engine.result();
  }

  /** The after-battle summary (once ended). */
  summary(): SeaSummary | null {
    const r = this.result();
    return r ? summarizeSea(this.setup, r, this.side) : null;
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
