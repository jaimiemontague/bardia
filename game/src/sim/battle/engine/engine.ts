/**
 * BattleEngine: the API the battle view (and tools/tests) drive.
 *
 *   const engine = BattleEngine.create(setup, content);           // the player's side is human
 *   engine.order({ kind: 'move', squads: ['a0'], x: 40, y: 30 });  // queued for the next tick
 *   const ticks = engine.advance(frameDtS, speed);                 // 0 (paused), 0.5, 1, 2
 *   const view = engine.snapshot('attacker', lastTick);            // interpolate with engine.alpha
 *   if (engine.status === 'duelRequested') runDuel(engine.duelRequest()!) → engine.resolveDuel(outcome)
 *   if (engine.status === 'ended') dispatch({ type: 'applyBattleResult', battleId, result: engine.result()! })
 *
 * Client orders are recorded with the tick they took effect, so `replay()` + `replayBattle` rebuild
 * the identical battle from the setup (AI decisions are re-derived, they are deterministic).
 */
import type { Content } from '@content/index';
import { Rng } from '@sim/core/rng';
import type { BattleResult, BattleSetup } from '@sim/core/state';
import type { BattleSideKey } from '../types';
import { createBattleState } from './create';
import { buildResult, finish } from './end';
import { gapToPoint, onField } from './geometry';
import { autoDuelOutcome, type DuelOutcome } from './leaders';
import { queueOrder } from './orders';
import { snapshot, type BattleRenderState } from './snapshot';
import { stepBattle } from './step';
import type { BattleEngineEvent, BattleOrder, BattleReplay, BattleState, BSquad, DuelRequest, EngineOptions, EngineStatus } from './types';
import { sideIdx, SIDE_KEYS } from './types';

/** Simulation speeds offered by the battle view (§13.5). */
export type BattleSpeed = 0 | 0.5 | 1 | 2;

export class BattleEngine {
  private acc = 0;

  private constructor(readonly state: BattleState) {}

  /** Creates the engine for a setup (map generated from the setup's map seed). */
  static create(setup: BattleSetup, content: Content, opts: EngineOptions = {}): BattleEngine {
    return new BattleEngine(createBattleState(setup, content, opts));
  }

  get status(): EngineStatus {
    return this.state.status;
  }
  get tick(): number {
    return this.state.tick;
  }
  get timeS(): number {
    return this.state.timeS;
  }
  /** Interpolation fraction between the last two ticks for rendering (0..1). */
  get alpha(): number {
    return Math.min(1, this.acc / this.state.dt);
  }

  /** The side orders default to: the first human side, else the attacker. */
  get defaultSide(): BattleSideKey {
    return this.state.humanSides[0] ? 'attacker' : this.state.humanSides[1] ? 'defender' : 'attacker';
  }

  /** Queues an order for the next tick (validated and recorded when it takes effect). */
  order(order: BattleOrder, side: BattleSideKey = this.defaultSide): void {
    queueOrder(this.state, sideIdx(side), order);
  }

  /** Runs `ticks` fixed steps. */
  step(ticks = 1): void {
    for (let k = 0; k < ticks; k++) {
      if (this.state.status === 'ended') return;
      const before = this.state.tick;
      stepBattle(this.state);
      if (this.state.tick === before) return; // paused (duel requested)
    }
  }

  /**
   * Advances by real time at a speed (0 = paused); returns the ticks run. At most 8 ticks per call
   * so a stalled frame never spirals.
   */
  advance(realDtS: number, speed: BattleSpeed): number {
    if (speed === 0 || this.state.status !== 'running') return 0;
    this.acc += Math.max(0, realDtS) * speed;
    let n = 0;
    while (this.acc >= this.state.dt && n < 8 && this.state.status === 'running') {
      this.acc -= this.state.dt;
      const before = this.state.tick;
      stepBattle(this.state);
      if (this.state.tick === before) break;
      n++;
    }
    if (n === 8) this.acc = Math.min(this.acc, this.state.dt);
    return n;
  }

  /** Render state for a viewer ('attacker' / 'defender'; null = everything). */
  snapshot(viewer: BattleSideKey | null = this.defaultSide, sinceTick = -1): BattleRenderState {
    return snapshot(this.state, viewer === null ? null : sideIdx(viewer), sinceTick);
  }

  /** Engine events after `sinceTick`. */
  events(sinceTick = -1): BattleEngineEvent[] {
    return this.state.events.filter((e) => e.tick > sinceTick);
  }

  duelRequest(): DuelRequest | null {
    return this.state.duel ? { ...this.state.duel } : null;
  }

  /** Feeds back the outcome of the duel the client ran (recorded; applied at the next step). */
  resolveDuel(outcome: DuelOutcome): void {
    if (this.state.status !== 'duelRequested') return;
    queueOrder(this.state, 0, { kind: 'duelOutcome', winnerId: outcome.winnerId, loserFate: outcome.loserFate });
    stepBattle(this.state);
  }

  /** Settles a pending duel with the placeholder auto-resolve (seeded per tick; recorded as an order). */
  autoResolveDuel(): void {
    const req = this.state.duel;
    if (!req || this.state.status !== 'duelRequested') return;
    const rng = new Rng(`${this.state.setup.seed}|duel|${this.state.tick}`);
    this.resolveDuel(autoDuelOutcome(this.state, req, rng));
  }

  /** Runs until the battle ends (duels auto-resolved) or `maxTicks` pass; returns the result. */
  runToEnd(maxTicks = Infinity): BattleResult {
    let guard = 0;
    while (this.state.status !== 'ended' && guard < maxTicks) {
      if (this.state.status === 'duelRequested') this.autoResolveDuel();
      else this.step(1);
      guard++;
    }
    return this.result() ?? buildResult(this.state);
  }

  /** Stops the battle now (e.g. the player quits to auto-resolve); the result reflects the field. */
  concede(winner: 'attacker' | 'defender' | 'none'): BattleResult {
    if (!this.state.end) finish(this.state, winner, 'timeout');
    return this.result()!;
  }

  /** The result once the battle has ended (null before). */
  result(): BattleResult | null {
    return this.state.result;
  }

  /** The replay record (setup id, seed, human sides and every accepted client order). */
  replay(): BattleReplay {
    return {
      battleId: this.state.setup.id,
      seed: this.state.setup.seed,
      humanSides: SIDE_KEYS.filter((_, i) => this.state.humanSides[i]),
      orders: this.state.log.map((o) => ({ tick: o.tick, side: o.side, order: JSON.parse(JSON.stringify(o.order)) as BattleOrder })),
      ticks: this.state.tick,
    };
  }

  // ---- selection helpers for the client (no effect on the simulation) -----------------------

  /** Squads of `side` on the field whose centre lies in the rectangle. */
  squadsInRect(side: BattleSideKey, x0: number, y0: number, x1: number, y1: number): string[] {
    const sx = Math.min(x0, x1);
    const ex = Math.max(x0, x1);
    const sy = Math.min(y0, y1);
    const ey = Math.max(y0, y1);
    const si = sideIdx(side);
    return this.state.squads.filter((s) => s.side === si && onField(s) && s.x >= sx && s.x <= ex && s.y >= sy && s.y <= ey).map((s) => s.id);
  }

  /** The visible squad under a point (within its footprint plus `slack` tiles), or null. */
  squadAt(x: number, y: number, viewer: BattleSideKey = this.defaultSide, slack = 0.5): string | null {
    const vis = this.state.sides[sideIdx(viewer)].visible;
    let best: BSquad | null = null;
    let bestGap = slack;
    for (const s of this.state.squads) {
      if (!onField(s) || vis[s.idx] !== 1) continue;
      const g = gapToPoint(s, x, y);
      if (g <= bestGap) {
        bestGap = g;
        best = s;
      }
    }
    return best?.id ?? null;
  }

  /** Every own squad of the same unit type as `squadId` (double-click selection). */
  squadsOfType(squadId: string): string[] {
    const s = this.state.squads.find((q) => q.id === squadId);
    if (!s) return [];
    return this.state.squads.filter((q) => q.side === s.side && q.unitId === s.unitId && onField(q)).map((q) => q.id);
  }
}

/**
 * Rebuilds a battle from its setup and replay record: the same orders at the same ticks with the
 * AI re-deriving its decisions. Runs to `replay.ticks` (or the end); returns the engine.
 */
export function replayBattle(setup: BattleSetup, content: Content, replay: BattleReplay, opts: Omit<EngineOptions, 'humanSides'> = {}): BattleEngine {
  const engine = BattleEngine.create(setup, content, { ...opts, humanSides: replay.humanSides });
  const st = engine.state;
  let k = 0;
  const orders = [...replay.orders].sort((a, b) => a.tick - b.tick);
  let guard = 0;
  while (st.tick < replay.ticks && st.status !== 'ended' && guard < replay.ticks * 4 + 100) {
    guard++;
    while (k < orders.length && orders[k]!.tick === st.tick) {
      const o = orders[k++]!;
      queueOrder(st, sideIdx(o.side), o.order);
    }
    const before = st.tick;
    stepBattle(st);
    if (st.tick === before && st.status === 'duelRequested' && (k >= orders.length || orders[k]!.tick !== st.tick)) break;
  }
  return engine;
}
