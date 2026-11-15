/**
 * The battle AI's state and perception (§13.7, §18.10): one Brain per AI-controlled side. It keeps
 * what the side knows about the enemy (squads seen, and where; an estimate of those never seen),
 * the commander's plan and the per-squad roles, posts and jobs the commander and the squad layer
 * share. Everything here is plain mutable data rebuilt from the engine state each "think"; the
 * engine is never written except through orders (squads.ts).
 */
import { Rng } from '@sim/core/rng';
import type { BattleKind } from '@sim/core/state';
import type { BattleTunables } from '../data';
import { onField } from '../engine/geometry';
import type { BattleState, BSquad, SideIdx } from '../engine/types';
import { combatValue, dirTo, dist, homeOf, perManWorth } from './geo';

/** Commander plans (§18.10). */
export type PlanKind = 'hold' | 'defendInDepth' | 'counterattack' | 'encircle' | 'withdraw';
export const PLAN_KINDS: readonly PlanKind[] = ['hold', 'defendInDepth', 'counterattack', 'encircle', 'withdraw'];

/** What winning means for this side (from the battle kind). */
export type Mission =
  /** Raiders: loot the caches, get the loot to the ships before the horns. */
  | 'raid'
  /** Cloister raiders: seize the reliquary. */
  | 'seize'
  /** Assault, fortress, attack on a hall: break in, take the chief or the keep, or rout them. */
  | 'storm'
  /** Raid defenders: protect the loot and the chief, hunt the loot carriers. */
  | 'protect'
  /** Settlement defenders (assault, fortress, cloister, defence of a hall): hold walls, gates, keep and chief. */
  | 'garrison'
  /** Relic-site guardians: hold the place. */
  | 'guard'
  /** Open battle: rout the enemy. */
  | 'field';

/** A squad's part in the commander's plan. */
export type Role = 'line' | 'reserve' | 'flankL' | 'flankR' | 'ranged' | 'chief' | 'post';

/** Squad-layer jobs (§18.10: Engage, Hold, Reposition, Fight Fire, Guard Chief, Retreat; plus the missions' own). */
export type JobKind =
  | 'none'
  | 'engage'
  | 'shoot'
  | 'hold'
  | 'reposition'
  | 'fightFire'
  | 'guardChief'
  | 'fallBack'
  | 'loot'
  | 'extract'
  | 'breach'
  | 'objective'
  | 'secureLoot'
  | 'flee'
  | 'torch';

/** One recorded commander decision (debug view §18.11, tests). */
export interface PlanRecord {
  t: number;
  plan: PlanKind;
  forceRatio: number;
  utilities: Record<PlanKind, number>;
}

/** Per-think picture of the battle from this side. */
export interface Picture {
  /** Own strength now / enemy strength as known or estimated (§31.11 shape). */
  forceRatio: number;
  ownCv: number;
  enemyCv: number;
  /** Share of the side's starting men lost so far. */
  lossShare: number;
  ownX: number;
  ownY: number;
  enemyX: number;
  enemyY: number;
  /** Unit vector from own centre toward the enemy, and its left-hand normal. */
  ax: number;
  ay: number;
  px: number;
  py: number;
  /** Half-width of the enemy array across the axis (tiles), and its front's distance from us. */
  enemySpread: number;
  enemyDist: number;
  /** Any enemy is seen or the alarm has sounded. */
  alarm: boolean;
  /** Share of known enemy strength that is routing. */
  enemyRouting: number;
  /** Mean defensive ground score under own squads. */
  ground: number;
  /** Own squads still able to act. */
  active: number;
}

/** Everything one AI side remembers between thinks. */
export interface Brain {
  side: SideIdx;
  foe: SideIdx;
  t: BattleTunables['ai'];
  reactionS: number;
  coordination: number;
  /** Per-battle temperament: < 0 bold, > 0 cautious (seeded, fixed for the battle). */
  boldness: number;
  rng: Rng;
  mission: Mission;
  nextThinkT: number;
  nextPlanT: number;
  plan: PlanKind;
  planSinceT: number;
  /** Counterattack/encircle form up before going in ('form'), then fight ('go'). */
  phase: 'form' | 'go';
  history: PlanRecord[];
  startMen: number;
  /** Gate the side is breaking (index) or −1. */
  targetGate: number;
  // ---- per squad (indexed by squad idx) ----
  seenT: Float64Array;
  seenX: Float32Array;
  seenY: Float32Array;
  seenMen: Float32Array;
  seenMorale: Float32Array;
  worth: Float32Array;
  cv: Float32Array;
  role: Role[];
  anchored: Uint8Array;
  anchorX: Float32Array;
  anchorY: Float32Array;
  postX: Float32Array;
  postY: Float32Array;
  job: JobKind[];
  jobTarget: Int32Array;
  jobSinceT: Float32Array;
  /** Last time the squad was struck while not in melee (volleys). */
  firedOnT: Float32Array;
  lastLost: Float32Array;
  /** The squad pulled back to recover morale. */
  recovering: Uint8Array;
  pic: Picture;
}

/** The side's mission for a battle kind. */
export function missionOf(kind: BattleKind, side: SideIdx): Mission {
  const k: string = kind;
  if (side === 0) {
    if (k === 'raid') return 'raid';
    if (k === 'cloister') return 'seize';
    if (k === 'assault' || k === 'fortress' || k === 'defense') return 'storm';
    return 'field';
  }
  if (k === 'raid') return 'protect';
  if (k === 'assault' || k === 'fortress' || k === 'cloister' || k === 'defense') return 'garrison';
  if (k === 'guardian') return 'guard';
  return 'field';
}

function emptyPicture(): Picture {
  return {
    forceRatio: 1,
    ownCv: 0,
    enemyCv: 0,
    lossShare: 0,
    ownX: 0,
    ownY: 0,
    enemyX: 0,
    enemyY: 0,
    ax: 0,
    ay: -1,
    px: 1,
    py: 0,
    enemySpread: 8,
    enemyDist: 40,
    alarm: false,
    enemyRouting: 0,
    ground: 0,
    active: 0,
  };
}

/** Creates the brain of one side (reaction time and coordination from the setup's difficulty). */
export function createBrain(state: BattleState, side: SideIdx, opts: { reactionS?: number; coordination?: number } = {}): Brain {
  const t = state.data.t;
  const diff = state.setup.difficulty ?? 'raider';
  const n = state.squads.length;
  const rng = Rng.derive(state.setup.seed, `ai|${side}`);
  const a = t.ai;
  const boldness = a.commander.boldnessSd > 0 ? Math.max(-2, Math.min(2, rng.normal(0, 1))) * a.commander.boldnessSd : 0;
  const b: Brain = {
    side,
    foe: (1 - side) as SideIdx,
    t: a,
    reactionS: opts.reactionS ?? t.aiReactionS[diff] ?? t.aiReactionS.raider ?? 0.8,
    coordination: opts.coordination ?? a.coordination[diff] ?? a.coordination.raider ?? 0.6,
    boldness,
    rng,
    mission: missionOf(state.setup.kind, side),
    // Sides think on different ticks; the first thought comes one reaction time in (they are
    // just as surprised by the start as anyone).
    nextThinkT: side * 0.05,
    nextPlanT: 0,
    plan: side === 1 ? 'defendInDepth' : 'counterattack',
    planSinceT: 0,
    phase: 'form',
    history: [],
    startMen: 0,
    targetGate: -1,
    seenT: new Float64Array(n).fill(-1),
    seenX: new Float32Array(n),
    seenY: new Float32Array(n),
    seenMen: new Float32Array(n),
    seenMorale: new Float32Array(n),
    worth: new Float32Array(n),
    cv: new Float32Array(n),
    role: new Array<Role>(n).fill('line'),
    anchored: new Uint8Array(n),
    anchorX: new Float32Array(n),
    anchorY: new Float32Array(n),
    postX: new Float32Array(n),
    postY: new Float32Array(n),
    job: new Array<JobKind>(n).fill('none'),
    jobTarget: new Int32Array(n).fill(-1),
    jobSinceT: new Float32Array(n),
    firedOnT: new Float32Array(n).fill(-1e9),
    lastLost: new Float32Array(n),
    recovering: new Uint8Array(n),
    pic: emptyPicture(),
  };
  for (const s of state.squads) {
    b.postX[s.idx] = s.x;
    b.postY[s.idx] = s.y;
    if (s.side === side) b.startMen += s.unit.nonCombatant ? 0 : s.startMen;
  }
  return b;
}

/** Strength estimate of an enemy squad the side has never seen (scouts' estimate at its start). */
function unseenCv(state: BattleState, b: Brain, o: BSquad): number {
  return o.startMen * b.worth[o.idx]! * (o.moraleStart / state.data.balance.autoresolve.moraleDivisor) * b.t.unseenEstimate;
}

/**
 * Updates memory and the per-think picture: combat values, force ratio, centres, the axis of the
 * battle, the enemy's spread and whether the enemy is breaking.
 */
export function perceive(state: BattleState, b: Brain): void {
  const vis = state.sides[b.side].visible;
  const now = state.timeS;
  const p = b.pic;
  let ownCv = 0;
  let ownMen = 0;
  let ox = 0;
  let oy = 0;
  let ow = 0;
  let enemyCv = 0;
  let ex = 0;
  let ey = 0;
  let ew = 0;
  let routingCv = 0;
  let active = 0;
  for (const o of state.squads) {
    const i = o.idx;
    b.worth[i] = perManWorth(state, o);
    if (o.side === b.side) {
      // Squads struck while out of melee are under fire (shield wall, cover).
      if (o.lost + o.casAcc > b.lastLost[i]! + 1e-6 && o.contacts === 0) b.firedOnT[i] = now;
      b.lastLost[i] = o.lost + o.casAcc;
      const cv = o.status === 'reserve' ? o.men * b.worth[i]! * (o.moraleStart / 60) : combatValue(state, o, b.worth[i]!);
      b.cv[i] = cv;
      if (o.unit.nonCombatant || o.retreating) continue;
      if (onField(o) || o.status === 'reserve') {
        ownCv += cv;
        ownMen += o.men;
      }
      if (o.status === 'active' || o.status === 'asleep') {
        active++;
        const w = Math.max(1, o.men);
        ox += o.x * w;
        oy += o.y * w;
        ow += w;
      }
      continue;
    }
    if (vis[i] === 1 && onField(o)) {
      b.seenT[i] = now;
      b.seenX[i] = o.x;
      b.seenY[i] = o.y;
      b.seenMen[i] = o.unit.single ? Math.max(0, o.hp) / state.data.t.singleHpPerMan : o.men;
      b.seenMorale[i] = o.status === 'routing' ? Math.min(o.morale, 8) : o.morale;
    }
    let cv = 0;
    if (o.unit.nonCombatant) cv = 0;
    else if (!onField(o)) cv = o.status === 'reserve' ? unseenCv(state, b, o) : 0;
    else if (b.seenT[i]! >= 0) {
      const routing = vis[i] === 1 ? o.status === 'routing' : b.seenMorale[i]! < state.data.b.routAt;
      cv = b.seenMen[i]! * b.worth[i]! * (Math.max(5, b.seenMorale[i]!) / 60) * (routing ? 0.3 : 1);
      if (routing) routingCv += cv;
      if (now - b.seenT[i]! <= b.t.memoryS) {
        const w = Math.max(1, b.seenMen[i]!);
        ex += b.seenX[i]! * w;
        ey += b.seenY[i]! * w;
        ew += w;
      }
    } else cv = unseenCv(state, b, o);
    b.cv[i] = cv;
    enemyCv += cv;
  }
  if (b.startMen <= 0) b.startMen = Math.max(1, ownMen);
  p.ownCv = ownCv;
  p.enemyCv = enemyCv;
  p.forceRatio = enemyCv > 1e-6 ? ownCv / enemyCv : ownCv > 0 ? 9 : 1;
  p.lossShare = Math.max(0, 1 - ownMen / Math.max(1, b.startMen));
  p.active = active;
  p.enemyRouting = enemyCv > 1e-6 ? routingCv / enemyCv : 0;
  if (ow > 0) {
    p.ownX = ox / ow;
    p.ownY = oy / ow;
  } else [p.ownX, p.ownY] = homeOf(state, b.side);
  if (ew > 0) {
    p.enemyX = ex / ew;
    p.enemyY = ey / ew;
  } else [p.enemyX, p.enemyY] = enemyGuess(state, b);
  const [ax, ay] = dirTo(p.ownX, p.ownY, p.enemyX, p.enemyY);
  p.ax = ax;
  p.ay = ay;
  p.px = -ay;
  p.py = ax;
  // Enemy spread across the axis and the distance to its nearest known squad.
  let spread = 0;
  let near = Infinity;
  for (const o of state.squads) {
    if (o.side === b.side || b.seenT[o.idx]! < 0 || now - b.seenT[o.idx]! > b.t.memoryS || !onField(o)) continue;
    const dx = b.seenX[o.idx]! - p.enemyX;
    const dy = b.seenY[o.idx]! - p.enemyY;
    spread = Math.max(spread, Math.abs(dx * p.px + dy * p.py) + Math.max(o.hw, o.hd));
    near = Math.min(near, dist(p.ownX, p.ownY, b.seenX[o.idx]!, b.seenY[o.idx]!));
  }
  p.enemySpread = Math.max(6, spread);
  p.enemyDist = Number.isFinite(near) ? near : dist(p.ownX, p.ownY, p.enemyX, p.enemyY);
  let seen = false;
  for (const o of state.squads) if (o.side !== b.side && vis[o.idx] === 1 && onField(o)) seen = true;
  p.alarm = seen || state.alarmT >= 0;
}

/** Where the enemy probably is when none has been seen: its keep/objective, else its deployment. */
function enemyGuess(state: BattleState, b: Brain): [number, number] {
  if (b.side === 0) {
    const o = state.map.objective;
    if (o.kind !== 'none') return [o.x, o.y];
    const keep = state.buildings.find((x) => x.isKeep);
    if (keep) return [keep.cx, keep.cy];
  }
  return homeOf(state, b.foe);
}
