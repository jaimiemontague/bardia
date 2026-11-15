/**
 * The AI's use of abilities (§13.5), after the squad layer picked a job: Shield Wall against
 * archers, charges and in a standing fight (and back to line to move); Charge with run-up at a
 * target whose front is not a shield wall; Frenzy just before contact; Rally when the men around a
 * leader are shaken or running; Hide for Wolf-coats moving unseen; area Volleys into melees our own
 * men are in, and fire arrows at gates and at buildings the enemy holds; a Challenge when the
 * leader is the better fighter (or his side is losing).
 */
import { ABILITY_IDS, type AbilityId } from '../data';
import { flankArc } from '../formulas';
import { gapBetween, gapToPoint, onField } from '../engine/geometry';
import { shotRange } from '../engine/sense';
import type { BattleOrder, BattleState, BGate, BSquad } from '../engine/types';
import type { Brain } from './brain';
import type { Decision } from './squads';
import { dist, insideWalls } from './geo';

type Issue = (o: BattleOrder) => string | null;

function ready(s: BSquad, a: AbilityId): boolean {
  return s.cooldowns[ABILITY_IDS.indexOf(a)]! <= 0;
}

/** True when `s` should charge `e` now (run-up, cooldown, no intact shield wall in front, fresh enough). */
export function wantsCharge(state: BattleState, b: Brain, s: BSquad, e: BSquad): boolean {
  if (!s.unit.canCharge || s.contacts !== 0 || s.status !== 'active' || !ready(s, 'charge')) return false;
  if (s.formation === 'shieldWall' && !state.data.b.formations.shieldWall.canCharge) return false;
  if (e.status === 'routing' || e.unit.nonCombatant || s.stamina < 35) return false;
  const gap = gapBetween(s, e);
  if (gap < state.data.b.charge.runTiles + 1 || gap > b.t.abilities.chargeMaxGapTiles) return false;
  const arc = flankArc(e.fx, e.fy, s.x - e.x, s.y - e.y, state.cosFront, state.cosRear);
  if (e.formation === 'shieldWall' && arc === 0) return false;
  return true;
}

/** An enemy charge is coming at `s` (seen running at it with its charge armed). */
function chargeIncoming(state: BattleState, s: BSquad): boolean {
  const vis = state.sides[s.side].visible;
  for (const o of state.squads) {
    if (o.side === s.side || o.status !== 'active' || vis[o.idx] !== 1 || !o.chargeArmed) continue;
    if (o.task.kind === 'attack' && o.task.target === s.idx && gapBetween(o, s) < 18) return true;
  }
  return false;
}

/** Whether the squad should stand in a shield wall for this job. */
function wantsWall(state: BattleState, b: Brain, s: BSquad, d: Decision): boolean {
  if (chargeIncoming(state, s)) return true;
  const a = b.t.abilities;
  const firedOn = state.timeS - b.firedOnT[s.idx]! < a.shieldWallFireS;
  switch (d.job) {
    case 'engage':
    case 'guardChief': {
      if (s.contacts !== 0) return s.chargeT <= 0;
      const e = state.squads[d.target];
      // About to meet them: brace (unless we are the ones charging).
      return e !== undefined && gapBetween(s, e) < 2.5 && !wantsCharge(state, b, s, e);
    }
    case 'hold': {
      if (s.contacts !== 0 || firedOn) return true;
      const vis = state.sides[s.side].visible;
      for (const o of state.squads) if (o.side !== s.side && o.status === 'active' && vis[o.idx] === 1 && gapBetween(s, o) < a.shieldWallThreatTiles) return true;
      return false;
    }
    case 'objective':
      return s.contacts !== 0 || (firedOn && dist(s.x, s.y, d.x, d.y) < 3);
    default:
      return s.contacts !== 0 && d.job !== 'fallBack';
  }
}

function backFormation(s: BSquad): 'line' | 'wedge' | 'loose' | 'shieldWall' {
  return s.unit.formations.includes('line') ? 'line' : (s.unit.formations.find((f) => f !== 'shieldWall') ?? 'line');
}

/** Duel rating used by the placeholder duel resolution (melee + command/4 + health). */
function rating(state: BattleState, s: BSquad): number {
  const l = s.leader;
  if (!l) return 0;
  return l.melee + l.command * 0.25 + (l.hpPct / 100) * 2;
}

/** Abilities for the job just chosen. */
export function useAbilities(state: BattleState, b: Brain, s: BSquad, d: Decision, enemies: readonly BSquad[], gate: BGate | null, issue: Issue): void {
  if (s.status !== 'active' || s.retreating) return;
  const a = b.t.abilities;
  const target = d.target >= 0 && (d.job === 'engage' || d.job === 'guardChief' || d.job === 'shoot') ? state.squads[d.target] : undefined;

  // Frenzy on contact (berserkers).
  if (s.unit.abilities.includes('frenzy') && s.frenzyT <= 0 && ready(s, 'frenzy')) {
    if (s.contacts !== 0 || (target && gapBetween(s, target) < a.frenzyGapTiles)) issue({ kind: 'ability', squad: s.id, ability: 'frenzy' });
  }

  // Shield wall in and out.
  if (s.unit.abilities.includes('shieldWall') && s.unit.formations.includes('shieldWall')) {
    const want = wantsWall(state, b, s, d);
    if (want && s.formation !== 'shieldWall' && ready(s, 'shieldWall') && s.chargeT <= 0) issue({ kind: 'formation', squads: [s.id], formation: 'shieldWall' });
    else if (!want && s.formation === 'shieldWall' && s.contacts === 0) {
      // Leave the wall only to move somewhere (it halves speed and forbids the charge).
      const moving = d.job !== 'hold' && dist(s.x, s.y, d.x, d.y) > 4;
      if (moving) issue({ kind: 'formation', squads: [s.id], formation: backFormation(s) });
    }
  }

  // Rally: the men around a leader are shaken, or some are running.
  if (!s.unnamed && s.leaderPresent && s.contacts === 0 && ready(s, 'rally')) {
    const r = state.data.t.rallyRadiusTiles;
    let deficit = 0;
    let routing = false;
    for (const o of state.squads) {
      if (o.side !== s.side || !onField(o) || o.unit.nonCombatant) continue;
      if (dist(o.x, o.y, s.x, s.y) > r) continue;
      if (o.status === 'routing') routing = true;
      deficit += Math.max(0, o.moraleStart - o.morale);
    }
    if (routing || deficit >= a.rallyDeficit) issue({ kind: 'ability', squad: s.id, ability: 'rally' });
  }

  // Hide while moving unseen (Wolf-coats and the like).
  if (s.unit.abilities.includes('hide') && !s.hidden && s.contacts === 0 && ready(s, 'hide')) {
    let near = Infinity;
    for (const e of enemies) near = Math.min(near, gapBetween(s, e));
    if (near >= a.hideMinEnemyGapTiles) issue({ kind: 'ability', squad: s.id, ability: 'hide' });
  }

  // Volleys: into a melee our own men are in (direct fire will not shoot there), fire at gates and halls.
  if (s.unit.hasRanged && s.unit.abilities.includes('volley') && s.contacts === 0) volleys(state, b, s, d, target, gate, issue);

  // Challenge the enemy chief when the odds favour our leader (or we are losing anyway).
  if (!s.unnamed && s.leaderPresent && !s.isPlayer && ready(s, 'challenge')) {
    const foe = state.sides[b.foe];
    const chief = foe.chiefIdx >= 0 ? state.squads[foe.chiefIdx] : undefined;
    if (chief && foe.chiefFate === 'fine' && chief.leaderPresent && onField(chief) && gapBetween(s, chief) <= state.data.b.challengeRangeTiles) {
      const edge = rating(state, s) - rating(state, chief);
      if (edge >= a.challengeEdge || (s.isChief && b.pic.forceRatio < 0.6)) issue({ kind: 'ability', squad: s.id, ability: 'challenge' });
    }
  }
}

function volleys(state: BattleState, b: Brain, s: BSquad, d: Decision, target: BSquad | undefined, gate: BGate | null, issue: Issue): void {
  const a = b.t.abilities;
  const sd = state.sides[s.side];
  const canVolley = ready(s, 'volley');
  const fireOk = sd.hasPitch && s.unit.abilities.includes('fireArrows') && sd.pitchUsed + state.data.t.pitchPerFireVolleyT <= sd.pitchT + 1e-9;
  // 1. A gate between us and the enemy: set it alight.
  if (fireOk && gate && !gate.burning && !gate.broken && !insideWalls(state, s.x, s.y)) {
    if (gapToPoint(s, gate.cx, gate.cy) <= shotRange(state, s, gate.cx, gate.cy)) {
      if (canVolley) issue({ kind: 'ability', squad: s.id, ability: 'volley', x: gate.cx, y: gate.cy, fire: true });
      return;
    }
  }
  // 2. The chosen target is locked in melee with our men: arrows over their heads.
  if (target && d.job === 'shoot' && target.status === 'active') {
    let friends = false;
    for (const f of state.squads) if (f.side === s.side && (target.contacts & (1 << f.idx)) !== 0) friends = true;
    if (friends && target.men >= a.volleyMinMen * 0.5 && gapToPoint(s, target.x, target.y) <= shotRange(state, s, target.x, target.y)) {
      if (canVolley) issue({ kind: 'ability', squad: s.id, ability: 'volley', x: target.x, y: target.y });
      return;
    }
  }
  // 3. Fire arrows on a building the enemy stands by (not where the loot still is, on a raid).
  if (fireOk && canVolley && b.mission !== 'protect' && b.mission !== 'garrison') {
    const lootDone = state.lootTotal <= 0 || sd.lootSecured >= a.fireArrowLootDone * state.lootTotal;
    const range = s.unit.range;
    for (const bld of state.buildings) {
      if (bld.burning || bld.collapsed || bld.flammability < 0.6) continue;
      if (bld.cache >= 0 && state.caches[bld.cache]!.value > 1 && !lootDone) continue;
      if (gapToPoint(s, bld.cx, bld.cy) > range) continue;
      let enemyNear = false;
      let friendNear = false;
      for (const o of state.squads) {
        if (!onField(o)) continue;
        const dd = dist(o.x, o.y, bld.cx, bld.cy) - Math.max(bld.w, bld.h) / 2;
        if (o.side === s.side && dd < 5) friendNear = true;
        else if (o.side !== s.side && state.sides[s.side].visible[o.idx] === 1 && dd < 3) enemyNear = true;
      }
      if (enemyNear && !friendNear) {
        issue({ kind: 'ability', squad: s.id, ability: 'volley', x: bld.cx, y: bld.cy, fire: true });
        return;
      }
    }
  }
  // Nothing worth a volley: back to direct fire.
  if (s.task.kind === 'volley' && canVolley) issue({ kind: 'halt', squads: [s.id] });
}
