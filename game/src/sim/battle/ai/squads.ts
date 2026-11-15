/**
 * Squad layer (§13.7, §18.10): each think, every squad scores its options — Engage a target (by
 * threat, isolation, flank opportunity, matchup and distance), Hold its post, Reposition, Fight
 * Fire, Guard the Chief, fall back (Retreat) — plus its mission's own jobs: raiders loot caches
 * and extract before the horns, stormers break a gate and take the objective, raid defenders carry
 * threatened loot off and hunt the loot carriers, monks run. The best job (with hysteresis) becomes
 * an order through the same validated API the player uses; abilities follow (abilities.ts).
 */
import { clamp } from '@sim/core/dmath';
import { flankArc } from '../formulas';
import { Z } from '../map/grid';
import { angleOf, gapBetween, onField } from '../engine/geometry';
import type { BattleOrder, BattleState, BCache, BGate, BSquad } from '../engine/types';
import { useAbilities, wantsCharge } from './abilities';
import type { Brain, JobKind } from './brain';
import { chiefOf } from './commander';
import { carryCap, dirTo, dist, homeOf, insideWalls, nearestWalkable, reachable, timeToSafety, wallsClosed } from './geo';

export type Issue = (o: BattleOrder) => string | null;

/** What a squad decided this think. */
export interface Decision {
  job: JobKind;
  score: number;
  /** Enemy squad, cache, building or gate index (by job), else −1. */
  target: number;
  x: number;
  y: number;
}

/** Shared facts for one think. */
interface ThinkCtx {
  enemies: BSquad[];
  ownMask: number;
  chief: BSquad | null;
  /** Raids: seconds until the horns. */
  remaining: number;
  /** Capacity already sent to each cache this think (raiders spread out). */
  claimed: Float64Array;
  closed: boolean;
  gate: BGate | null;
  breachers: number[];
  objective: [number, number] | null;
  homeX: number;
  homeY: number;
}

/** Ranged-first squads (archers, horse archers, outlaws) keep their distance; skirmishers and javelins close in. */
export function rangedFirst(s: BSquad): boolean {
  return s.unit.hasRanged && (s.unit.range >= 10 || s.unit.atk < 5);
}

function decision(job: JobKind, score: number, target = -1, x = 0, y = 0): Decision {
  return { job, score, target, x, y };
}

// ---------------------------------------------------------------------------------------------
// Orders (deduplicated so a squad's path is not re-planned every think)

/** Attack a squad (or charge it when the run-up is there). */
export function orderEngage(state: BattleState, b: Brain, s: BSquad, e: BSquad, issue: Issue): void {
  if (wantsCharge(state, b, s, e)) {
    if (issue({ kind: 'ability', squad: s.id, ability: 'charge', target: e.id }) === null) return;
  }
  if (s.task.kind === 'attack' && s.task.target === e.idx) return;
  issue({ kind: 'attack', squads: [s.id], target: e.id });
}

/** Walk (or run) to a point, facing `facing` on arrival; no re-issue for a goal that barely moved. */
export function orderMove(state: BattleState, b: Brain, s: BSquad, x: number, y: number, run: boolean, facing?: number, issue?: Issue): void {
  if (!issue) return;
  const [wx, wy] = nearestWalkable(state, s.side, x, y);
  const r = b.t.squad.reissueTiles;
  if (s.task.kind === 'move' && dist(s.task.x, s.task.y, wx, wy) < r && s.task.run === run) return;
  if (s.task.kind === 'none' && dist(s.x, s.y, wx, wy) < Math.max(1.5, r * 0.6)) {
    if (facing === undefined || Math.abs(angleDiff(s.facing, facing)) < 0.6) return;
  }
  const o: BattleOrder = { kind: 'move', squads: [s.id], x: wx, y: wy, run };
  if (facing !== undefined) o.facing = facing;
  issue(o);
}

function angleDiff(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function faceAngle(x0: number, y0: number, x1: number, y1: number): number {
  return angleOf(x1 - x0, y1 - y0);
}

/** Stand still (stop a running move or attack). */
function orderHalt(s: BSquad, issue: Issue): void {
  if (s.task.kind === 'none') return;
  issue({ kind: 'halt', squads: [s.id] });
}

// ---------------------------------------------------------------------------------------------
// Scoring

/** Expected exchange of `s` against `e` in melee: (our blows per their defence) / (theirs per ours). */
function meleeMatchup(state: BattleState, s: BSquad, e: BSquad): number {
  const ss = state.sides[s.side];
  const es = state.sides[e.side];
  const ours = (s.unit.atk * ss.weaponMult * (e.unit.cavalry ? s.unit.vsCavalryAtkMult : 1) * (e.formation === 'shieldWall' ? s.unit.vsShieldWallAtkMult : 1)) / Math.max(0.5, e.unit.def * es.armourMult);
  const theirs = (Math.max(0.5, e.unit.atk) * es.weaponMult * (s.unit.cavalry ? e.unit.vsCavalryAtkMult : 1)) / Math.max(0.5, s.unit.def * ss.armourMult);
  const menS = Math.max(1, s.unit.single ? s.hp / state.data.t.singleHpPerMan : s.men);
  const menE = Math.max(1, e.unit.single ? e.hp / state.data.t.singleHpPerMan : e.men);
  return clamp(Math.sqrt(ours / Math.max(1e-6, theirs)) * Math.sqrt(Math.sqrt(menS / menE)) * Math.sqrt(Math.max(5, s.morale) / Math.max(5, e.morale)), 0.3, 2.5);
}

/** The player's squad stands alone (no friend within 8 tiles). */
function exposed(state: BattleState, e: BSquad): boolean {
  for (const o of state.squads) if (o !== e && o.side === e.side && o.status === 'active' && gapBetween(o, e) < 8) return false;
  return true;
}

/** Utility of attacking `e` with `s`. */
export function engageScore(state: BattleState, b: Brain, s: BSquad, e: BSquad, ctx: ThinkCtx): number {
  const q = b.t.squad;
  const d = Math.max(0, gapBetween(s, e));
  if (!reachable(state, s, e.x, e.y)) return 0;
  let val = 1;
  if (e.status === 'routing') {
    if (d > q.pursuitTiles) return 0;
    val *= q.routingTargetMult;
  }
  if (e.unit.nonCombatant) val *= e.loot > 0 ? 1.2 : 0.2;
  if (e.unit.hasRanged && rangedFirst(e)) val *= q.archerPriority;
  if (e.isChief) val *= q.chiefPriority * (b.mission === 'storm' ? 1.3 : 1);
  if (e.isPlayer && exposed(state, e)) val *= q.playerPriority;
  if (e.loot > 0 && (b.mission === 'protect' || b.mission === 'garrison')) val *= 1 + (q.lootCarrierPriority - 1) * Math.min(1, e.loot / Math.max(1, carryCap(state, e)) + 0.3);
  if (e.status === 'asleep') val *= 1.3;
  if (ctx.chief && ctx.chief !== s && dist(e.x, e.y, ctx.chief.x, ctx.chief.y) < q.guardChiefRadiusTiles) val *= q.guardChiefBonus;
  const mu = meleeMatchup(state, s, e);
  // Isolation: the enemy strength standing by the target.
  let support = 0;
  const r = q.isolationRadiusTiles;
  for (const o of ctx.enemies) {
    if (o === e || o.status !== 'active') continue;
    if (Math.abs(o.x - e.x) > r || Math.abs(o.y - e.y) > r) continue;
    if (dist(o.x, o.y, e.x, e.y) <= r) support += b.cv[o.idx]!;
  }
  const iso = 1 / (1 + 0.6 * (support / Math.max(1, b.cv[e.idx]!)));
  // Flank opportunity: from where we come relative to its facing.
  const arc = flankArc(e.fx, e.fy, s.x - e.x, s.y - e.y, state.cosFront, state.cosRear);
  let flank = arc === 2 ? 1 + q.flankBonus : arc === 1 ? 1 + 0.6 * q.flankBonus : 1;
  if ((e.contacts & ctx.ownMask & ~(1 << s.idx)) !== 0) flank *= 1 + q.focusBonus * b.coordination;
  if ((s.contacts & (1 << e.idx)) !== 0) flank *= 1.3;
  const df = 1 / (1 + d / q.falloffTiles);
  // Leash: a squad holding a post only fights what comes near it (enemies inside our walls always).
  let leash = 1;
  const holding = b.anchored[s.idx] === 1 && (b.plan === 'hold' || b.plan === 'defendInDepth' || b.phase === 'form' || b.role[s.idx] === 'chief');
  if (holding && b.role[s.idx] !== 'flankL' && b.role[s.idx] !== 'flankR') {
    const lim = q.leashTiles * (b.role[s.idx] === 'reserve' ? 2 : 1) * (b.mission === 'garrison' && insideWalls(state, e.x, e.y) ? 3 : 1);
    const da = dist(b.anchorX[s.idx]!, b.anchorY[s.idx]!, e.x, e.y);
    if (da > lim && d > 2) leash = 0.08;
  }
  const aggro = b.plan === 'counterattack' || b.plan === 'encircle' ? (b.phase === 'go' ? 1.25 : d < 8 ? 1 : 0.5) : 1;
  return val * mu * iso * flank * df * leash * aggro;
}

/** Utility of shooting at `e` from where a ranged squad can get to. */
function shootScore(state: BattleState, b: Brain, s: BSquad, e: BSquad, ctx: ThinkCtx): number {
  const q = b.t.squad;
  const d = Math.max(0, gapBetween(s, e));
  if (e.status === 'routing' && d > s.unit.range) return 0;
  // Behind a closed wall the defenders on it can still be shot at from outside: no reach test.
  let val = 1;
  if (e.unit.hasRanged && rangedFirst(e)) val *= 1.15;
  if (e.formation === 'shieldWall') val *= 0.55;
  if (e.formation === 'loose') val *= 0.7;
  if (e.isChief) val *= 1.15;
  if (e.loot > 0 && (b.mission === 'protect' || b.mission === 'garrison')) val *= q.lootCarrierPriority;
  if (ctx.chief && dist(e.x, e.y, ctx.chief.x, ctx.chief.y) < q.guardChiefRadiusTiles) val *= 1.3;
  if (e.status === 'routing') val *= q.routingTargetMult;
  const over = Math.max(0, d - s.unit.range);
  const df = 1 / (1 + over / (q.falloffTiles * 0.5));
  let leash = 1;
  if (b.anchored[s.idx] === 1 && (b.plan === 'hold' || b.plan === 'defendInDepth' || b.phase === 'form')) {
    const da = dist(b.anchorX[s.idx]!, b.anchorY[s.idx]!, e.x, e.y) - s.unit.range;
    if (da > q.leashTiles) leash = 0.1;
  }
  return val * df * leash;
}

/** Local strength around a point: own minus enemy combat value within the radius. */
function localRatio(state: BattleState, b: Brain, x: number, y: number): number {
  const r = b.t.squad.localRadiusTiles;
  let own = 0;
  let foe = 0;
  for (const o of state.squads) {
    if (!onField(o) || o.unit.nonCombatant) continue;
    if (Math.abs(o.x - x) > r || Math.abs(o.y - y) > r || dist(o.x, o.y, x, y) > r) continue;
    if (o.side === b.side) own += b.cv[o.idx]!;
    else if (state.sides[b.side].visible[o.idx] === 1) foe += b.cv[o.idx]!;
  }
  return foe > 0 ? own / foe : 9;
}

// ---------------------------------------------------------------------------------------------
// Mission helpers

function openCaches(state: BattleState): BCache[] {
  const out: BCache[] = [];
  for (const c of state.caches) {
    if (c.value <= 1) continue;
    if (c.building >= 0) {
      const bld = state.buildings[c.building]!;
      if (bld.burning || bld.collapsed) continue;
    }
    out.push(c);
  }
  return out;
}

/** The gate the side breaks: nearest to its centre, preferring one already burning or battered. */
function pickGate(state: BattleState, b: Brain): BGate | null {
  if (state.gates.length === 0) return null;
  const cur = b.targetGate >= 0 ? state.gates[b.targetGate] : undefined;
  if (cur && !cur.broken) return cur;
  let best: BGate | null = null;
  let bestV = Infinity;
  for (const g of state.gates) {
    if (g.broken) continue;
    let v = dist(b.pic.ownX, b.pic.ownY, g.outX, g.outY) * (g.burning ? 0.5 : 1) * (0.5 + g.hp / Math.max(1, g.hpMax));
    // Defenders massed inside this gate make it a worse choice.
    for (const o of state.squads) if (o.side === b.foe && onField(o) && state.sides[b.side].visible[o.idx] === 1 && dist(o.x, o.y, g.inX, g.inY) < 8) v += o.men * 0.15;
    if (v < bestV) {
      bestV = v;
      best = g;
    }
  }
  b.targetGate = best ? best.idx : -1;
  return best;
}

/** Where attackers wait for a gate to open: out from the gate, away from the wall. */
function waitPoint(state: BattleState, b: Brain, g: BGate): [number, number] {
  const [ux, uy] = dirTo(g.inX, g.inY, g.outX, g.outY);
  const k = b.t.assault.waitOffWallTiles;
  return nearestWalkable(state, b.side, g.outX + ux * k, g.outY + uy * k);
}

function objectivePoint(state: BattleState, b: Brain): [number, number] | null {
  if (b.side !== 0) return null;
  const kind: string = state.setup.kind;
  const o = state.map.objective;
  if (kind === 'fortress') {
    if (o.kind !== 'none') return [o.x, o.y];
    const keep = state.buildings.find((x) => x.isKeep);
    return keep ? [keep.doorX + 0.5, keep.doorY + 0.5] : null;
  }
  if (kind === 'guardian' && o.kind !== 'none' && !state.objectiveBreached) return [o.x, o.y];
  return null;
}

// ---------------------------------------------------------------------------------------------
// The squad layer

function buildCtx(state: BattleState, b: Brain, own: readonly BSquad[]): ThinkCtx {
  const vis = state.sides[b.side].visible;
  const enemies: BSquad[] = [];
  let ownMask = 0;
  for (const o of state.squads) {
    if (o.side === b.side) {
      if (onField(o)) ownMask |= 1 << o.idx;
    } else if (vis[o.idx] === 1 && onField(o)) enemies.push(o);
  }
  const [hx, hy] = homeOf(state, b.side);
  const ctx: ThinkCtx = {
    enemies,
    ownMask,
    chief: chiefOf(state, b),
    remaining: state.raidTimerS - state.timeS,
    claimed: new Float64Array(state.caches.length),
    closed: wallsClosed(state) && !state.sides[b.side].ladders,
    gate: null,
    breachers: [],
    objective: objectivePoint(state, b),
    homeX: hx,
    homeY: hy,
  };
  if (b.mission === 'storm' && ctx.closed) {
    ctx.gate = pickGate(state, b);
    const g = ctx.gate;
    if (g) {
      // Breachers: the squads nearest the gate (rams first), outside the walls.
      const cand = own.filter((s) => !s.unit.hasRanged && !s.unit.cavalry && !s.isChief && !insideWalls(state, s.x, s.y));
      const ram = state.sides[b.side].hasRam;
      cand.sort((x, y) => {
        const rx = ram && x.unit.abilities.includes('ram') ? 0 : 1;
        const ry = ram && y.unit.abilities.includes('ram') ? 0 : 1;
        return rx - ry || dist(x.x, x.y, g.outX, g.outY) - dist(y.x, y.y, g.outX, g.outY) || x.idx - y.idx;
      });
      ctx.breachers = cand.slice(0, b.t.assault.breachers).map((s) => s.idx);
    }
  } else b.targetGate = -1;
  return ctx;
}

/** Runs the squad layer for every commandable squad of the side. */
export function runSquads(state: BattleState, b: Brain, own: readonly BSquad[], issue: Issue): void {
  const ctx = buildCtx(state, b, own);
  // Non-combatants (monks) run for the edge once the alarm is up.
  for (const s of state.squads) {
    if (s.side !== b.side || s.status !== 'active' || !s.unit.nonCombatant || s.retreating) continue;
    if (b.pic.alarm) issue({ kind: 'retreat', squads: [s.id] });
  }
  // Raiders sail when the horns are near (everyone, so nobody is left behind).
  if (b.mission === 'raid' && b.plan !== 'withdraw') {
    let latest = 0;
    for (const s of own) latest = Math.max(latest, timeToSafety(state, s));
    if (own.length > 0 && ctx.remaining < latest * b.t.raid.extractSafety + b.t.raid.extractMarginS) {
      if (!state.sides[b.side].retreatAll) issue({ kind: 'retreatAll' });
      return;
    }
  }
  for (const s of own) {
    const d = decide(state, b, s, ctx);
    const prev = b.job[s.idx];
    if (prev !== d.job || b.jobTarget[s.idx] !== d.target) b.jobSinceT[s.idx] = state.timeS;
    b.job[s.idx] = d.job;
    b.jobTarget[s.idx] = d.target;
    execute(state, b, s, d, ctx, issue);
    useAbilities(state, b, s, d, ctx.enemies, ctx.gate, issue);
  }
}

/** Picks the squad's job for this think. */
export function decide(state: BattleState, b: Brain, s: BSquad, ctx: ThinkCtx): Decision {
  const q = b.t.squad;
  const p = b.pic;
  const inertia = q.jobInertia;
  const cur = b.job[s.idx];
  const curT = b.jobTarget[s.idx];
  const keep = (d: Decision) => (d.job === cur && d.target === curT ? d.score + inertia : d.score);
  let best = decision('hold', 0);
  let bestV = -Infinity;
  const offer = (d: Decision) => {
    const v = keep(d);
    if (v > bestV) {
      bestV = v;
      best = d;
    }
  };

  // Retreat (fall back to recover): low morale out of the fight, or locally beaten in it.
  const frenzied = s.frenzyT > 0;
  const recoverAt = Math.max(q.fallBackMorale + 5, s.moraleStart * q.recoverShare);
  if (b.recovering[s.idx] && (s.morale >= recoverAt || s.contacts !== 0)) b.recovering[s.idx] = 0;
  if (!frenzied && !s.unit.neverRoutWhileObjective && !s.unit.single && b.mission !== 'garrison') {
    if (s.contacts === 0 && (s.morale < q.fallBackMorale || b.recovering[s.idx])) {
      b.recovering[s.idx] = 1;
      const rx = (b.anchored[s.idx] ? b.anchorX[s.idx]! : p.ownX) - p.ax * 8;
      const ry = (b.anchored[s.idx] ? b.anchorY[s.idx]! : p.ownY) - p.ay * 8;
      offer(decision('fallBack', 2, -1, rx, ry));
    } else if (s.contacts !== 0 && s.morale < q.fallBackMorale * 0.8 && localRatio(state, b, s.x, s.y) < q.fallBackLocalRatio) {
      let cover = false;
      for (const o of state.squads) if (o.side === b.side && o !== s && o.status === 'active' && o.contacts === 0 && gapBetween(o, s) < 10) cover = true;
      if (cover) offer(decision('fallBack', 1.8, -1, s.x - p.ax * 10, s.y - p.ay * 10));
    }
  }

  // Mission jobs.
  if (b.mission === 'raid' || b.mission === 'seize') offerLoot(state, b, s, ctx, offer);
  if (b.mission === 'protect') offerSecureLoot(state, b, s, ctx, offer);
  if (b.mission === 'protect' || b.mission === 'garrison' || b.mission === 'guard') offerFire(state, b, s, ctx, offer);
  if (b.mission === 'storm' && ctx.closed && ctx.gate && !insideWalls(state, s.x, s.y)) {
    if (ctx.breachers.includes(s.idx)) offer(decision('breach', 1.15, ctx.gate.idx, ctx.gate.outX, ctx.gate.outY));
    else if (!s.unit.hasRanged) {
      const [wx, wy] = waitPoint(state, b, ctx.gate);
      offer(decision('hold', 0.55, -1, wx, wy));
    }
  }
  if (ctx.objective) {
    const [ox, oy] = ctx.objective;
    if (reachable(state, s, ox, oy)) {
      let clear = true;
      for (const e of ctx.enemies) if (e.status === 'active' && !e.unit.nonCombatant && dist(e.x, e.y, ox, oy) < b.t.assault.objectiveClearTiles) clear = false;
      if (clear) offer(decision('objective', 1.0 + 0.4 * (1 / (1 + dist(s.x, s.y, ox, oy) / 20)), -1, ox, oy));
    }
  }

  // Fight: the best target.
  if (rangedFirst(s)) {
    let tv = 0;
    let tgt: BSquad | null = null;
    for (const e of ctx.enemies) {
      const v = shootScore(state, b, s, e, ctx);
      if (v > tv) {
        tv = v;
        tgt = e;
      }
    }
    if (tgt) offer(decision('shoot', 0.3 + tv, tgt.idx, tgt.x, tgt.y));
  } else {
    let tv = 0;
    let tgt: BSquad | null = null;
    for (const e of ctx.enemies) {
      const v = engageScore(state, b, s, e, ctx);
      if (v > tv) {
        tv = v;
        tgt = e;
      }
    }
    if (tgt) {
      const guard = ctx.chief && ctx.chief !== s && dist(tgt.x, tgt.y, ctx.chief.x, ctx.chief.y) < q.guardChiefRadiusTiles;
      offer(decision(guard ? 'guardChief' : 'engage', tv, tgt.idx, tgt.x, tgt.y));
    }
  }

  // Hold the post / reposition to it; or (free squads) advance on the enemy.
  if (b.anchored[s.idx]) {
    const far = dist(s.x, s.y, b.anchorX[s.idx]!, b.anchorY[s.idx]!) > 2.5;
    const holdPlan = b.plan === 'hold' || b.plan === 'defendInDepth' || b.phase === 'form';
    offer(decision(far ? 'reposition' : 'hold', holdPlan ? 0.6 : 0.35, -1, b.anchorX[s.idx]!, b.anchorY[s.idx]!));
  } else {
    // Free squads with nothing in sight move toward where the enemy was last seen.
    const advance = b.plan === 'counterattack' || b.plan === 'encircle' || b.side === 0;
    if (advance && ctx.enemies.length === 0) offer(decision('reposition', 0.2, -1, p.enemyX, p.enemyY));
    else if (rangedFirst(s)) {
      // Ranged squads keep behind the nearest friendly melee squad.
      let near: BSquad | null = null;
      let nd = Infinity;
      for (const o of state.squads) {
        if (o.side !== b.side || o.status !== 'active' || o.unit.hasRanged || o.unit.nonCombatant) continue;
        const dd = dist(o.x, o.y, s.x, s.y);
        if (dd < nd) {
          nd = dd;
          near = o;
        }
      }
      if (near) offer(decision('reposition', 0.2, -1, near.x - p.ax * 6, near.y - p.ay * 6));
      else offer(decision('hold', 0.1, -1, s.x, s.y));
    } else offer(decision('hold', 0.1, -1, s.x, s.y));
  }
  return best;
}

function offerLoot(state: BattleState, b: Brain, s: BSquad, ctx: ThinkCtx, offer: (d: Decision) => void): void {
  const cap = carryCap(state, s);
  const r = b.t.raid;
  const caches = openCaches(state);
  // Loaded raiders head for the ships (raids); cloister raiders keep going until the reliquary falls.
  if (b.mission === 'raid' && s.loot > 0 && (s.loot >= cap * r.loadedShare || caches.every((c) => c.value <= 1))) {
    offer(decision('extract', 3, -1, ctx.homeX, ctx.homeY));
    return;
  }
  const need = cap - s.loot;
  if (need < 1) return;
  let best: BCache | null = null;
  let bestV = 0;
  for (const c of caches) {
    if (s.unit.cavalry && c.building >= 0) continue;
    if (!reachable(state, s, c.x, c.y)) continue;
    const left = c.value - ctx.claimed[c.idx]!;
    if (left < 1 && b.jobTarget[s.idx] !== c.idx) continue;
    let danger = 0;
    for (const e of ctx.enemies) if (e.status === 'active' && !e.unit.nonCombatant && dist(e.x, e.y, c.x, c.y) < r.cacheDangerTiles) danger += b.cv[e.idx]!;
    const d = dist(s.x, s.y, c.x, c.y);
    let v = r.lootWeight * (0.5 + 0.5 * Math.min(1, Math.max(0, left) / need)) / (1 + d / b.t.squad.falloffTiles) / (1 + (1.5 * danger) / Math.max(1, b.cv[s.idx]!));
    if (b.mission === 'seize' && c.treasury) v *= 2.5;
    if (v > bestV) {
      bestV = v;
      best = c;
    }
  }
  if (best) {
    ctx.claimed[best.idx] = (ctx.claimed[best.idx] ?? 0) + need;
    offer(decision('loot', bestV, best.idx, best.x, best.y));
  }
}

function offerSecureLoot(state: BattleState, b: Brain, s: BSquad, ctx: ThinkCtx, offer: (d: Decision) => void): void {
  if (s.unit.cavalry || s.contacts !== 0) return;
  const r = b.t.raid;
  for (const c of openCaches(state)) {
    if (!reachable(state, s, c.x, c.y)) continue;
    const mine = dist(s.x, s.y, c.x, c.y);
    let raider = Infinity;
    for (const e of ctx.enemies) if (e.status === 'active' && !e.unit.nonCombatant) raider = Math.min(raider, dist(e.x, e.y, c.x, c.y));
    if (raider > r.secureLootTiles || mine >= raider - 2) continue;
    const v = 0.9 + 0.3 * Math.min(1, c.value / Math.max(1, state.lootTotal * 0.2));
    if (ctx.claimed[c.idx]! > 0) continue;
    ctx.claimed[c.idx] = 1;
    offer(decision('secureLoot', v / (1 + mine / 30), c.idx, c.x, c.y));
    return;
  }
}

function offerFire(state: BattleState, b: Brain, s: BSquad, ctx: ThinkCtx, offer: (d: Decision) => void): void {
  if (s.unit.cavalry || s.unit.single || s.contacts !== 0) return;
  const q = b.t.squad;
  for (const e of ctx.enemies) if (e.status === 'active' && reachable(state, s, e.x, e.y) && gapBetween(s, e) < q.safeWorkTiles) return;
  let best = -1;
  let gate = false;
  let bestV = 0;
  for (const bld of state.buildings) {
    if (!bld.burning) continue;
    const d = dist(s.x, s.y, bld.doorX + 0.5, bld.doorY + 0.5);
    if (d > q.douseRadiusTiles || !reachable(state, s, bld.doorX + 0.5, bld.doorY + 0.5)) continue;
    const cache = bld.cache >= 0 ? state.caches[bld.cache]!.value : 0;
    const worth = (bld.isKeep ? 1 : 0.35) + Math.min(1, cache / Math.max(1, state.lootTotal * 0.15)) + 0.1 * bld.neighbors.length;
    const v = (0.5 * worth) / (1 + d / 12);
    if (v > bestV) {
      bestV = v;
      best = bld.idx;
      gate = false;
    }
  }
  for (const g of state.gates) {
    if (!g.burning || g.broken) continue;
    const d = dist(s.x, s.y, g.inX, g.inY);
    if (d > q.douseRadiusTiles || !insideWalls(state, s.x, s.y)) continue;
    const v = 1.1 / (1 + d / 12);
    if (v > bestV) {
      bestV = v;
      best = g.idx;
      gate = true;
    }
  }
  if (best >= 0) {
    const x = gate ? state.gates[best]!.inX : state.buildings[best]!.doorX + 0.5;
    const y = gate ? state.gates[best]!.inY : state.buildings[best]!.doorY + 0.5;
    offer(decision('fightFire', bestV, gate ? -2 - best : best, x, y));
  }
}

// ---------------------------------------------------------------------------------------------
// Execution

function execute(state: BattleState, b: Brain, s: BSquad, d: Decision, ctx: ThinkCtx, issue: Issue): void {
  const p = b.pic;
  switch (d.job) {
    case 'engage':
    case 'guardChief': {
      const e = state.squads[d.target]!;
      orderEngage(state, b, s, e, issue);
      return;
    }
    case 'shoot': {
      const e = state.squads[d.target]!;
      shootFrom(state, b, s, e, ctx, issue);
      return;
    }
    case 'hold': {
      const [fx, fy] = ctx.enemies.length > 0 ? nearestEnemyPos(s, ctx.enemies) : [p.enemyX, p.enemyY];
      const face = faceAngle(d.x, d.y, fx, fy);
      if (s.contacts !== 0) return;
      orderMove(state, b, s, d.x, d.y, false, face, issue);
      return;
    }
    case 'reposition':
    case 'objective': {
      const run = dist(s.x, s.y, d.x, d.y) > 24 && s.stamina > 60;
      const face = faceAngle(d.x, d.y, p.enemyX, p.enemyY);
      orderMove(state, b, s, d.x, d.y, run, face, issue);
      return;
    }
    case 'fallBack': {
      const face = faceAngle(s.x, s.y, p.enemyX, p.enemyY);
      orderMove(state, b, s, d.x, d.y, s.contacts !== 0, face, issue);
      return;
    }
    case 'loot':
    case 'secureLoot': {
      const c = state.caches[d.target]!;
      if (s.task.kind === 'loot' && s.task.target === c.idx) return;
      issue({ kind: 'loot', squads: [s.id], cache: c.id });
      return;
    }
    case 'extract':
      issue({ kind: 'retreat', squads: [s.id] });
      return;
    case 'fightFire': {
      const gate = d.target <= -2;
      const id = gate ? state.gates[-2 - d.target]!.id : state.buildings[d.target]!.id;
      const idx = gate ? -2 - d.target : d.target;
      if (s.task.kind === 'douse' && s.task.target === idx && s.task.gateTarget === gate) return;
      issue({ kind: 'ability', squad: s.id, ability: 'douse', target: id });
      return;
    }
    case 'breach': {
      const g = state.gates[d.target]!;
      breach(state, b, s, g, issue);
      return;
    }
    default:
      return;
  }
}

function nearestEnemyPos(s: BSquad, enemies: readonly BSquad[]): [number, number] {
  let best = enemies[0]!;
  let bd = Infinity;
  for (const e of enemies) {
    const d = Math.abs(e.x - s.x) + Math.abs(e.y - s.y);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return [best.x, best.y];
}

/** Ram, torch or hack the gate. */
function breach(state: BattleState, b: Brain, s: BSquad, g: BGate, issue: Issue): void {
  const sd = state.sides[s.side];
  if (sd.hasRam && s.unit.abilities.includes('ram')) {
    if (s.task.kind === 'gate' && s.task.target === g.idx) return;
    issue({ kind: 'ability', squad: s.id, ability: 'ram', target: g.id });
    return;
  }
  // Fire first (a burning gate falls by itself), then the axes.
  if (!g.burning && s.unit.abilities.includes('torch') && !s.unit.cavalry) {
    if (s.task.kind === 'torch' && s.task.gateTarget && s.task.target === g.idx) return;
    issue({ kind: 'ability', squad: s.id, ability: 'torch', target: g.id });
    return;
  }
  if (s.task.kind === 'gate' && s.task.target === g.idx) return;
  issue({ kind: 'attack', squads: [s.id], target: g.id });
}

/**
 * Ranged squads: walk to a firing spot short of their range, stand to shoot (they cannot loose on
 * the move), and step back from melee enemies closing in.
 */
function shootFrom(state: BattleState, b: Brain, s: BSquad, e: BSquad, ctx: ThinkCtx, issue: Issue): void {
  const q = b.t.squad;
  const gap = gapBetween(s, e);
  // Melee threat closing in: fall back toward our lines (unless on a wall or tower, or fast enough to kite).
  let threat: BSquad | null = null;
  let tg = Infinity;
  for (const o of ctx.enemies) {
    if (o.status !== 'active' || rangedFirst(o) || o.unit.nonCombatant) continue;
    const g2 = gapBetween(s, o);
    if (g2 < q.rangedDangerTiles && g2 < tg && reachable(state, o, s.x, s.y)) {
      tg = g2;
      threat = o;
    }
  }
  const covered = (state.map.zone[Math.floor(s.y) * state.map.w + Math.floor(s.x)]! & Z.wallCover) !== 0;
  if (threat && !covered && s.contacts === 0) {
    const [ux, uy] = dirTo(threat.x, threat.y, s.x, s.y);
    const [hx, hy] = dirTo(s.x, s.y, ctx.homeX, ctx.homeY);
    const vx = ux * 0.7 + hx * 0.3;
    const vy = uy * 0.7 + hy * 0.3;
    orderMove(state, b, s, s.x + vx * 8, s.y + vy * 8, true, faceAngle(s.x, s.y, threat.x, threat.y), issue);
    return;
  }
  const range = s.unit.range;
  if (gap > range) {
    // Firing spot: on the line from the target to us, at the standoff distance.
    const [ux, uy] = dirTo(e.x, e.y, s.x, s.y);
    const k = range * q.rangedStandoffFrac + Math.max(e.hw, e.hd) + Math.max(s.hw, s.hd);
    let x = e.x + ux * k;
    let y = e.y + uy * k;
    // Holding squads do not leave their post by more than the leash.
    if (b.anchored[s.idx] && (b.plan === 'hold' || b.plan === 'defendInDepth' || b.phase === 'form')) {
      const da = dist(x, y, b.anchorX[s.idx]!, b.anchorY[s.idx]!);
      if (da > q.leashTiles) {
        x = b.anchorX[s.idx]!;
        y = b.anchorY[s.idx]!;
      }
    }
    orderMove(state, b, s, x, y, false, faceAngle(x, y, e.x, e.y), issue);
    return;
  }
  // In range: stand and loose (the engine picks the nearest clear target each volley).
  if (s.task.kind === 'move' || s.task.kind === 'attack') orderHalt(s, issue);
  else if (s.task.kind === 'none' && Math.abs(angleDiff(s.facing, faceAngle(s.x, s.y, e.x, e.y))) > 0.8) orderMove(state, b, s, s.x, s.y, false, faceAngle(s.x, s.y, e.x, e.y), issue);
}

/** Used by tests: the job and target a squad was given at the last think. */
export function jobOf(b: Brain, s: BSquad): { job: JobKind; target: number } {
  return { job: b.job[s.idx]!, target: b.jobTarget[s.idx]! };
}
