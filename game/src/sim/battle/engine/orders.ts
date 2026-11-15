/**
 * The order API (§13.5): move (with Shift waypoints and a facing), attack, formation, stance,
 * abilities, loot, halt, retreat and the global Retreat to Ships. The client's orders are queued
 * and applied at the start of the next tick (and recorded with that tick for replays); the AI's
 * orders are applied immediately inside the tick (and regenerated on replay).
 */
import { clamp, dcos, dsin } from '@sim/core/dmath';
import type { FormationId } from '@sim/core/state';
import { ABILITY_IDS, abilityCooldownS, type AbilityId } from '../data';
import { effectiveRange } from '../formulas';
import { emit } from './events';
import { angleOf, gapBetween, gapToPoint, onField, updateFootprint } from './geometry';
import { resolveDuel, sideMorale } from './leaders';
import type { BattleOrder, BattleState, BSquad, SideIdx, SquadTaskKind } from './types';

/** Result of issuing an order: null = accepted, else an error code. */
export type OrderError = string | null;

function abilityIndex(a: AbilityId): number {
  return ABILITY_IDS.indexOf(a);
}

/** Squad by id (any side), or undefined. */
export function squadById(state: BattleState, id: string): BSquad | undefined {
  const side = id.charAt(0) === 'a' ? 0 : id.charAt(0) === 'd' ? 1 : -1;
  if (side < 0) return undefined;
  for (const s of state.squads) if (s.id === id) return s;
  return undefined;
}

function indexFromId(id: string, prefix: string, max: number): number {
  if (!id.startsWith(prefix)) return -1;
  const n = Number(id.slice(prefix.length));
  return Number.isInteger(n) && n >= 0 && n < max ? n : -1;
}

/** Own squads that can take orders. */
function own(state: BattleState, side: SideIdx, ids: readonly string[]): BSquad[] {
  const out: BSquad[] = [];
  for (const id of ids) {
    const s = squadById(state, id);
    if (!s || s.side !== side) continue;
    if (s.status !== 'active') continue;
    if (s.retreating && state.sides[side].retreatAll) continue;
    out.push(s);
  }
  return out;
}

/** Sets a squad's task and requests a path when it must move. */
export function setTask(state: BattleState, s: BSquad, kind: SquadTaskKind, x: number, y: number, opts: { facing?: number | null; run?: boolean; target?: number; gateTarget?: boolean; fire?: boolean } = {}): void {
  const t = s.task;
  t.kind = kind;
  t.x = clamp(x, 0.5, state.map.w - 0.5);
  t.y = clamp(y, 0.5, state.map.h - 0.5);
  t.facing = opts.facing ?? null;
  t.run = opts.run === true;
  t.target = opts.target ?? -1;
  t.gateTarget = opts.gateTarget === true;
  t.fire = opts.fire === true;
  s.gatherT = 0;
  s.actT = 0;
  s.path.length = 0;
  s.pathPos = 0;
  s.pathGoal = -1;
  s.pathRetreat = kind === 'retreat';
  if (kind === 'none' || kind === 'retreat') {
    s.pathPending = false;
  } else requestPath(state, s);
}

/** Queues a path search for a squad (processed under the per-tick budget). */
export function requestPath(state: BattleState, s: BSquad): void {
  if (!s.pathPending) {
    s.pathPending = true;
    state.pathQueue.push(s.idx);
  }
}

/** Puts a squad into its retreat (to the extraction zone; saved on arrival). */
export function orderRetreat(state: BattleState, s: BSquad): void {
  s.retreating = true;
  s.chargeArmed = false;
  s.waypoints.length = 0;
  setTask(state, s, 'retreat', s.x, s.y, { run: true });
}

/** Changes formation (validates the unit's formations and the shield-wall cooldown). */
export function changeFormation(state: BattleState, s: BSquad, formation: FormationId): OrderError {
  if (!s.unit.formations.includes(formation)) return 'formationUnavailable';
  if (s.formation === formation) return null;
  if (formation === 'shieldWall') {
    const k = abilityIndex('shieldWall');
    if (s.cooldowns[k]! > 0) return 'cooldown';
    s.cooldowns[k] = abilityCooldownS(state.data, 'shieldWall');
    s.chargeArmed = false;
  }
  s.formation = formation;
  updateFootprint(state.data, s);
  return null;
}

function moveGroup(state: BattleState, squads: BSquad[], x: number, y: number, facing: number | undefined, run: boolean, queue: boolean): void {
  if (squads.length === 0) return;
  let cx = 0;
  let cy = 0;
  for (const s of squads) {
    cx += s.x;
    cy += s.y;
  }
  cx /= squads.length;
  cy /= squads.length;
  const face = facing ?? (Math.abs(x - cx) + Math.abs(y - cy) > 0.5 ? angleOf(x - cx, y - cy) : squads[0]!.facing);
  // Lay the group out in a line across the facing, ordered by their current lateral position.
  const right = [-dsin(face), dcos(face)] as const;
  const sorted = [...squads].sort((a, b) => a.x * right[0] + a.y * right[1] - (b.x * right[0] + b.y * right[1]) || a.idx - b.idx);
  const widths = sorted.map((s) => s.hw * 2 + 1.5);
  const total = widths.reduce((a, w) => a + w, 0);
  let off = -total / 2;
  sorted.forEach((s, k) => {
    const lat = off + widths[k]! / 2;
    off += widths[k]!;
    const dx = squads.length > 1 ? right[0] * lat : 0;
    const dy = squads.length > 1 ? right[1] * lat : 0;
    if (queue && (s.task.kind === 'move' || s.waypoints.length > 0)) {
      s.waypoints.push(x + dx, y + dy);
      return;
    }
    s.waypoints.length = 0;
    s.chargeArmed = false;
    s.retreating = false;
    setTask(state, s, 'move', x + dx, y + dy, { facing: face, run });
  });
}

/** Nearest visible enemy squad on the field to `s` (optionally within `maxGap`). */
export function nearestEnemy(state: BattleState, s: BSquad, maxGap = Infinity, filter?: (o: BSquad) => boolean): BSquad | undefined {
  let best: BSquad | undefined;
  let bestGap = maxGap;
  const vis = state.sides[s.side].visible;
  for (const o of state.squads) {
    if (o.side === s.side || !onField(o) || vis[o.idx] !== 1) continue;
    if (filter && !filter(o)) continue;
    const g = gapBetween(s, o);
    if (g < bestGap) {
      bestGap = g;
      best = o;
    }
  }
  return best;
}

function ability(state: BattleState, side: SideIdx, order: Extract<BattleOrder, { kind: 'ability' }>): OrderError {
  const s = squadById(state, order.squad);
  if (!s || s.side !== side) return 'unknownSquad';
  if (s.status !== 'active') return 'squadUnavailable';
  const a = order.ability;
  const k = abilityIndex(a);
  if (k < 0) return 'unknownAbility';
  if (s.cooldowns[k]! > 0) return 'cooldown';
  const data = state.data;
  const sd = state.sides[side];
  const cd = abilityCooldownS(data, a);
  switch (a) {
    case 'shieldWall': {
      if (!s.unit.abilities.includes('shieldWall')) return 'abilityUnavailable';
      if (s.formation === 'shieldWall') {
        const back = s.unit.formations.find((f) => f !== 'shieldWall') ?? 'line';
        s.formation = back;
        updateFootprint(data, s);
        return null;
      }
      return changeFormation(state, s, 'shieldWall');
    }
    case 'charge': {
      if (!s.unit.canCharge) return 'abilityUnavailable';
      if (s.formation === 'shieldWall' && !data.b.formations.shieldWall.canCharge) return 'formationForbids';
      const target = order.target !== undefined ? squadById(state, order.target) : nearestEnemy(state, s, 30);
      if (!target || target.side === side || !onField(target) || sd.visible[target.idx] !== 1) return 'noTarget';
      setTask(state, s, 'attack', target.x, target.y, { run: true, target: target.idx });
      s.chargeArmed = true;
      s.runDist = 0;
      s.cooldowns[k] = cd;
      emit(state, 'charge', { squad: s, target: target.id });
      return null;
    }
    case 'volley': {
      if (!s.unit.hasRanged || !s.unit.abilities.includes('volley')) return 'abilityUnavailable';
      if (order.x === undefined || order.y === undefined) return 'noTarget';
      const range = effectiveRange(data.b, s.unit.range, true);
      if (gapToPoint(s, order.x, order.y) > range) return 'outOfRange';
      const fire = order.fire === true && sd.hasPitch && s.unit.abilities.includes('fireArrows') && sd.pitchUsed + data.t.pitchPerFireVolleyT <= sd.pitchT + 1e-9;
      setTask(state, s, 'volley', order.x, order.y, { fire });
      s.task.kind = 'volley';
      s.pathPending = false;
      s.cooldowns[k] = Math.max(cd, 0);
      return null;
    }
    case 'torch':
    case 'douse': {
      if (s.unit.cavalry || s.unit.nonCombatant || s.unit.single) return 'abilityUnavailable';
      if (order.target === undefined) return 'noTarget';
      const bi = indexFromId(order.target, 'b', state.buildings.length);
      const gi = indexFromId(order.target, 'g', state.gates.length);
      if (bi >= 0) {
        const b = state.buildings[bi]!;
        if (b.collapsed) return 'noTarget';
        if (a === 'douse' && !b.burning) return 'notBurning';
        setTask(state, s, a, b.doorX + 0.5, b.doorY + 0.5, { target: bi });
        return null;
      }
      if (gi >= 0) {
        const g = state.gates[gi]!;
        if (g.broken) return 'noTarget';
        if (a === 'douse' && !g.burning) return 'notBurning';
        const outside = side === 0;
        setTask(state, s, a, outside ? g.outX : g.inX, outside ? g.outY : g.inY, { target: gi, gateTarget: true });
        return null;
      }
      return 'noTarget';
    }
    case 'ram': {
      if (!sd.hasRam || !s.unit.abilities.includes('ram')) return 'abilityUnavailable';
      const gi = order.target !== undefined ? indexFromId(order.target, 'g', state.gates.length) : -1;
      if (gi < 0 || state.gates[gi]!.broken) return 'noTarget';
      const g = state.gates[gi]!;
      setTask(state, s, 'gate', side === 0 ? g.outX : g.inX, side === 0 ? g.outY : g.inY, { target: gi, gateTarget: true });
      return null;
    }
    case 'rally': {
      if (s.unnamed || !s.leaderPresent) return 'noLeader';
      if (s.contacts !== 0) return 'engaged';
      const r = data.t.rallyRadiusTiles;
      for (const o of state.squads) {
        if (o.side !== side || !onField(o)) continue;
        const dx = o.x - s.x;
        const dy = o.y - s.y;
        if (o === s || dx * dx + dy * dy <= r * r) o.morale = clamp(o.morale + data.b.morale.rally, 0, 100);
      }
      s.cooldowns[k] = cd;
      emit(state, 'rally', { squad: s });
      return null;
    }
    case 'frenzy': {
      if (!s.unit.abilities.includes('frenzy')) return 'abilityUnavailable';
      s.frenzyT = data.b.frenzy.durationS;
      s.cooldowns[k] = cd;
      emit(state, 'frenzy', { squad: s });
      return null;
    }
    case 'hide': {
      if (!s.unit.abilities.includes('hide')) return 'abilityUnavailable';
      s.hidden = true;
      s.cooldowns[k] = cd;
      emit(state, 'hide', { squad: s });
      return null;
    }
    case 'challenge': {
      if (s.unnamed || !s.leaderPresent) return 'noLeader';
      const enemy = state.sides[(1 - side) as SideIdx];
      const chief = enemy.chiefIdx >= 0 ? state.squads[enemy.chiefIdx] : undefined;
      if (!chief || !chief.leaderPresent || enemy.chiefFate !== 'fine' || !onField(chief) || enemy.chiefId === null) return 'noChief';
      if (gapBetween(s, chief) > data.b.challengeRangeTiles) return 'outOfRange';
      s.cooldowns[k] = cd;
      const c = data.t.challenge;
      const accepts = chief.leader?.acceptsChallenge === true || state.rng.chance(c.acceptChance);
      if (!accepts) {
        sideMorale(state, chief.side, c.refusedMorale);
        emit(state, 'challengeRefused', { squad: s, target: chief.id });
        return null;
      }
      state.duel = { challengerId: s.leaderId, challengerSquad: s.id, chiefId: enemy.chiefId, chiefSquad: chief.id, side: state.sides[side].key };
      state.status = 'duelRequested';
      emit(state, 'duelRequested', { squad: s, target: chief.id });
      return null;
    }
    default:
      return 'unknownAbility';
  }
}

/** Applies an order immediately (validated). */
export function applyOrder(state: BattleState, side: SideIdx, order: BattleOrder): OrderError {
  if (state.status === 'ended') return 'ended';
  if (order.kind === 'duelOutcome') return resolveDuel(state, { winnerId: order.winnerId, loserFate: order.loserFate });
  if (state.status !== 'running') return 'paused';
  switch (order.kind) {
    case 'move': {
      if (!Number.isFinite(order.x) || !Number.isFinite(order.y)) return 'badTarget';
      const squads = own(state, side, order.squads);
      if (squads.length === 0) return 'noSquads';
      moveGroup(state, squads, order.x, order.y, order.facing, order.run === true, order.queue === true);
      return null;
    }
    case 'attack': {
      const squads = own(state, side, order.squads);
      if (squads.length === 0) return 'noSquads';
      const gi = indexFromId(order.target, 'g', state.gates.length);
      if (gi >= 0) {
        const g = state.gates[gi]!;
        if (g.broken) return 'noTarget';
        for (const s of squads) setTask(state, s, 'gate', side === 0 ? g.outX : g.inX, side === 0 ? g.outY : g.inY, { target: gi, gateTarget: true, run: order.run === true });
        return null;
      }
      const bi = indexFromId(order.target, 'b', state.buildings.length);
      if (bi >= 0) {
        const b = state.buildings[bi]!;
        if (b.collapsed) return 'noTarget';
        for (const s of squads) if (!s.unit.cavalry) setTask(state, s, 'torch', b.doorX + 0.5, b.doorY + 0.5, { target: bi });
        return null;
      }
      const target = squadById(state, order.target);
      if (!target || target.side === side || !onField(target)) return 'noTarget';
      if (state.sides[side].visible[target.idx] !== 1) return 'notVisible';
      for (const s of squads) {
        s.waypoints.length = 0;
        s.retreating = false;
        setTask(state, s, 'attack', target.x, target.y, { run: order.run === true, target: target.idx });
      }
      return null;
    }
    case 'formation': {
      const squads = own(state, side, order.squads);
      if (squads.length === 0) return 'noSquads';
      let err: OrderError = null;
      for (const s of squads) err = changeFormation(state, s, order.formation) ?? err;
      return squads.length === 1 ? err : null;
    }
    case 'stance': {
      const squads = own(state, side, order.squads);
      if (squads.length === 0) return 'noSquads';
      for (const s of squads) s.stance = order.stance;
      return null;
    }
    case 'ability':
      return ability(state, side, order);
    case 'loot': {
      const squads = own(state, side, order.squads);
      const ci = indexFromId(order.cache, 'c', state.caches.length);
      if (ci < 0) return 'noTarget';
      const c = state.caches[ci]!;
      if (c.value <= 0) return 'empty';
      for (const s of squads) if (!(s.unit.cavalry && c.building >= 0)) setTask(state, s, 'loot', c.x, c.y, { target: ci });
      return squads.length === 0 ? 'noSquads' : null;
    }
    case 'halt': {
      const squads = own(state, side, order.squads);
      for (const s of squads) {
        s.waypoints.length = 0;
        s.chargeArmed = false;
        s.retreating = false;
        setTask(state, s, 'none', s.x, s.y, { facing: s.facing });
      }
      return squads.length === 0 ? 'noSquads' : null;
    }
    case 'retreat': {
      const squads = own(state, side, order.squads);
      for (const s of squads) orderRetreat(state, s);
      return squads.length === 0 ? 'noSquads' : null;
    }
    case 'retreatAll': {
      const sd = state.sides[side];
      if (!sd.retreatAll) {
        sd.retreatAll = true;
        emit(state, 'retreatSounded', { side });
      }
      for (const s of state.squads) if (s.side === side && s.status === 'active') orderRetreat(state, s);
      return null;
    }
    default:
      return 'unknownOrder';
  }
}

/** Queues a client order for the next tick (validated then, and recorded). */
export function queueOrder(state: BattleState, side: SideIdx, order: BattleOrder): void {
  state.queued.push({ side, order: structuredCopy(order) });
}

/** Applies the queued client orders at the start of a tick, recording the accepted ones. */
export function applyQueued(state: BattleState): void {
  if (state.queued.length === 0) return;
  const q = state.queued;
  state.queued = [];
  for (const { side, order } of q) {
    const err = applyOrder(state, side, order);
    if (err === null) state.log.push({ tick: state.tick, side: state.sides[side].key, order });
  }
}

/** JSON-safe copy of an order (the caller may reuse its object). */
function structuredCopy(order: BattleOrder): BattleOrder {
  return JSON.parse(JSON.stringify(order)) as BattleOrder;
}
