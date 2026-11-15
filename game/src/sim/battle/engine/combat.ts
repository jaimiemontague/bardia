/**
 * Combat each tick: melee contacts (first flanked contact, charge impact, waking sleepers),
 * melee casualties (§31.8 exactly), ranged volleys every reload (§31.10) as projectiles whose hits
 * land on arrival, area volleys with fire arrows, and the great bear's area maul.
 */
import { clamp } from '@sim/core/dmath';
import { fortDefMult } from '../data';
import {
  chargeMult,
  effStat,
  flankArc,
  flankMult,
  formationDef,
  meleeCasualtiesPerS,
  moraleMult,
  rangedAccuracy,
  volleyHits,
} from '../formulas';
import { TERRAIN_INFO, Z } from '../map/grid';
import { emit } from './events';
import { canFight, distToRect, gapBetween, gapToPoint, onField } from './geometry';
import { isElevated, shotRange } from './sense';
import { igniteBuilding, igniteGate } from './world';
import type { BattleState, BSquad, Impact } from './types';

function tileOf(state: BattleState, x: number, y: number): number {
  const m = state.map;
  return Math.min(m.h - 1, Math.max(0, Math.floor(y))) * m.w + Math.min(m.w - 1, Math.max(0, Math.floor(x)));
}

/** Command of the squad's present leader (0 for an unnamed sergeant). */
export function leaderCommand(s: BSquad): number {
  return s.leaderPresent && s.leader ? s.leader.command : 0;
}

/** atk_eff of `a` striking `b` (§31.8). */
export function attackEff(state: BattleState, a: BSquad, b: BSquad): number {
  const bal = state.data.b;
  const side = state.sides[a.side];
  let extra = moraleMult(bal, a.morale, a.status === 'routing') * side.omenAtk;
  if (a.frenzyT > 0) extra *= bal.frenzy.atkMult;
  if (a.unformedT > 0 || a.status === 'asleep') extra *= state.data.t.asleep.unformedMult;
  if (a.leaderPresent && a.leader) extra *= 1 + state.data.balance.character.skillEffects.meleeSquadAtk * a.leader.melee;
  if (b.unit.cavalry) extra *= a.unit.vsCavalryAtkMult;
  if (b.formation === 'shieldWall') extra *= a.unit.vsShieldWallAtkMult;
  return effStat(bal, { base: a.unit.atk, equipMult: side.weaponMult, command: leaderCommand(a), vetStars: a.vet, stamina: a.stamina, extra });
}

/** Terrain defence of `b` attacked by `a` (§31.9): woods, ford, marsh, hill (upslope attacker), stakes. */
export function terrainDef(state: BattleState, b: BSquad, a: BSquad): number {
  const bal = state.data.b;
  const map = state.map;
  const tb = tileOf(state, b.x, b.y);
  const ta = tileOf(state, a.x, a.y);
  let v = bal.terrain[TERRAIN_INFO[map.terrain[tb]!]!.combat].def;
  const hb = map.height[tb]!;
  if (hb >= state.data.t.hillHeight && hb > map.height[ta]!) v *= bal.terrain.hill.def;
  const zb = map.zone[tb]!;
  const za = map.zone[ta]!;
  if ((zb & Z.wallCover) !== 0 && (zb & Z.inside) === 0 && (za & Z.wallCover) === 0) v *= bal.terrain.palisade.def;
  return v;
}

/** def_eff of `b` attacked by `a` (§31.8). */
export function defenceEff(state: BattleState, b: BSquad, a: BSquad): number {
  const bal = state.data.b;
  const side = state.sides[b.side];
  let extra = formationDef(bal, b.formation, b.unit) * terrainDef(state, b, a);
  if (b.side === 1 && (state.map.zone[tileOf(state, b.x, b.y)]! & Z.inside) !== 0) extra *= fortDefMult(state.data.balance, state.map.fortTier);
  if (b.leaderPresent && b.leader) extra *= 1 + b.leader.defPct / 100;
  if (b.unformedT > 0 || b.status === 'asleep') extra *= state.data.t.asleep.unformedMult;
  return effStat(bal, { base: b.unit.def, equipMult: side.armourMult, command: leaderCommand(b), vetStars: b.vet, stamina: b.stamina, extra });
}

/** Wakes a sleeping squad (unformed for a few seconds, night-surprise morale). */
export function wake(state: BattleState, s: BSquad): void {
  if (s.status !== 'asleep') return;
  s.status = 'active';
  s.unformedT = state.data.t.asleep.unformedS;
  s.morale = clamp(s.morale + state.data.b.morale.nightSurprise, 0, 100);
  if (state.alarmT < 0) state.alarmT = state.timeS;
  emit(state, 'awake', { squad: s });
}

/** Contact masks of the previous tick (scratch, by squad index; at most 31 squads). */
const prevContacts = new Int32Array(32);

/**
 * Finds melee contacts, applies first-flanked morale, charge impacts and reveals/wakes squads.
 * Contact has hysteresis (tunables.contactHoldMult): squads already locked together stay in contact
 * until their gap opens past reach × that multiple, so the jostling of footprints (separation,
 * turning) does not flicker a fight on and off every tick. A flanker is forgotten (its "first
 * flanked contact" shock may strike again) only once it has drawn off past tunables.flankForgetTiles.
 */
export function updateContacts(state: BattleState): void {
  const sq = state.squads;
  const reach = state.data.t.meleeReachTiles;
  const holdReach = reach * state.data.t.contactHoldMult;
  const forget = state.data.t.flankForgetTiles;
  const bal = state.data.b;
  for (const s of sq) {
    prevContacts[s.idx] = s.contacts;
    s.contacts = 0;
    s.fighting = false;
  }
  for (let i = 0; i < sq.length; i++) {
    const a = sq[i]!;
    if (!canFight(a)) continue;
    const was = prevContacts[a.idx]!;
    for (let j = i + 1; j < sq.length; j++) {
      const b = sq[j]!;
      if (b.side === a.side || !canFight(b)) continue;
      const r = (was & (1 << b.idx)) !== 0 ? holdReach : reach;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const far = a.hw + a.hd + b.hw + b.hd + r;
      if (dx * dx + dy * dy > far * far) continue;
      if (gapBetween(a, b) > r) continue;
      a.contacts |= 1 << b.idx;
      b.contacts |= 1 << a.idx;
    }
  }
  for (const s of sq) {
    // Forget flankers that drew off (not those merely jostled out of reach for a tick).
    if ((s.flankedBy & ~s.contacts) !== 0) {
      for (const o of sq) {
        const bit = 1 << o.idx;
        if ((s.flankedBy & bit) === 0 || (s.contacts & bit) !== 0) continue;
        if (!canFight(o) || gapBetween(s, o) > forget) s.flankedBy &= ~bit;
      }
    }
    if (s.contacts === 0) {
      if (s.meleeTarget >= 0 && !(s.task.kind === 'attack' && s.task.target === s.meleeTarget)) s.meleeTarget = -1;
      continue;
    }
    if (s.status === 'asleep') wake(state, s);
    s.hidden = false;
    // Primary target: the ordered one if in contact, else keep, else the nearest.
    const ordered = s.task.kind === 'attack' ? s.task.target : -1;
    if (ordered >= 0 && (s.contacts & (1 << ordered)) !== 0) s.meleeTarget = ordered;
    else if (s.meleeTarget < 0 || (s.contacts & (1 << s.meleeTarget)) === 0) {
      let best = -1;
      let bestGap = Infinity;
      for (const o of sq) {
        if ((s.contacts & (1 << o.idx)) === 0) continue;
        const g = gapBetween(s, o);
        if (g < bestGap) {
          bestGap = g;
          best = o.idx;
        }
      }
      s.meleeTarget = best;
    }
    // First flanked contact: −10 once per flanking enemy.
    for (const o of sq) {
      const bit = 1 << o.idx;
      if ((s.contacts & bit) === 0 || (s.flankedBy & bit) !== 0) continue;
      const arc = flankArc(s.fx, s.fy, o.x - s.x, o.y - s.y, state.cosFront, state.cosRear);
      if (arc !== 0) {
        s.flankedBy |= bit;
        if (s.frenzyT <= 0) s.morale = clamp(s.morale + bal.morale.firstFlanked, 0, 100);
      }
    }
    // Charge impact.
    if (s.chargeArmed && s.task.kind === 'attack' && (s.contacts & (1 << s.task.target)) !== 0) {
      const target = sq[s.task.target]!;
      s.chargeArmed = false;
      if (s.runDist >= bal.charge.runTiles) {
        const arc = flankArc(target.fx, target.fy, s.x - target.x, s.y - target.y, state.cosFront, state.cosRear);
        s.chargeT = bal.charge.durationS;
        if (target.formation === 'shieldWall' && arc === 0 && target.status !== 'routing') {
          s.chargeBlockedT = 1;
          emit(state, 'chargeBroken', { squad: s, target: target.id });
        }
      }
      s.runDist = 0;
    }
  }
}

/** Melee casualties for one tick (§31.8). */
export function resolveMelee(state: BattleState): void {
  const bal = state.data.b;
  const dt = state.dt;
  const [lo, hi] = bal.randRange;
  for (const a of state.squads) {
    if (a.contacts === 0 || a.meleeTarget < 0) continue;
    if (a.status !== 'active' && a.status !== 'routing' && a.status !== 'asleep') continue;
    if (a.unit.nonCombatant || a.unit.maulDamage > 0) continue;
    const b = state.squads[a.meleeTarget]!;
    if (!canFight(b)) continue;
    // Routing squads only defend themselves against those striking them.
    if (a.status === 'routing' && b.meleeTarget !== a.idx) continue;
    const atk = attackEff(state, a, b);
    const def = defenceEff(state, b, a);
    const arc = flankArc(b.fx, b.fy, a.x - b.x, a.y - b.y, state.cosFront, state.cosRear);
    const flank = flankMult(bal, arc, b.formation);
    const vsWall = b.formation === 'shieldWall' && arc === 0 && b.status !== 'routing';
    const charge = a.chargeT > 0 ? chargeMult(bal, a.unit, a.formation, vsWall || a.chargeBlockedT > 0) : 1;
    let cas = meleeCasualtiesPerS(bal, a.men, a.formation, atk, def, flank, charge) * state.rng.range(lo, hi) * dt;
    if (b.frenzyT > 0) cas *= bal.frenzy.damageTakenMult;
    if (b.chargeBlockedT > 0 && b.task.target === a.idx) cas *= bal.charge.chargerCasualtyMult;
    b.casAcc += cas;
    b.casTick += cas;
    a.fighting = true;
    b.fighting = true;
    a.quietT = 0;
    b.quietT = 0;
  }
}

/** The great bear's area maul: every few seconds, damage to every enemy squad within its radius. */
export function resolveMaul(state: BattleState): void {
  const t = state.data.t;
  for (const s of state.squads) {
    if (s.unit.maulDamage <= 0 || s.status !== 'active') continue;
    if (s.maulT > 0) s.maulT -= state.dt;
    if (s.contacts === 0 || s.maulT > 0) continue;
    s.maulT = t.maulIntervalS;
    const radius = s.unit.maulRadiusTiles;
    for (const o of state.squads) {
      if (o.side === s.side || !canFight(o)) continue;
      if (gapBetween(s, o) > radius) continue;
      const cas = s.unit.maulDamage / t.singleHpPerMan / state.sides[o.side].armourMult;
      o.casAcc += cas;
      o.casTick += cas;
      o.quietT = 0;
    }
    s.fighting = true;
    s.quietT = 0;
  }
}

function smokeAt(state: BattleState, x: number, y: number): boolean {
  return state.smoke[tileOf(state, x, y)] === 1;
}

/** Multipliers of one volley on one target (cover, shield wall, smoke, loose order, terrain). */
function volleyMods(state: BattleState, s: BSquad, target: BSquad): number {
  const bal = state.data.b;
  const map = state.map;
  const tt = tileOf(state, target.x, target.y);
  const ts = tileOf(state, s.x, s.y);
  let mods = bal.terrain[TERRAIN_INFO[map.terrain[tt]!]!.combat].rangedAcc;
  const zt = map.zone[tt]!;
  const zs = map.zone[ts]!;
  if ((zt & Z.wallCover) !== 0 && (zt & Z.inside) !== (zs & Z.inside)) mods *= bal.terrain.palisade.rangedAcc;
  else if ((zt & Z.wallCover) !== 0 && (zt & Z.inside) === 0 && (zs & Z.wallCover) === 0) mods *= bal.terrain.palisade.rangedAcc;
  if (target.formation === 'shieldWall' && flankArc(target.fx, target.fy, s.x - target.x, s.y - target.y, state.cosFront, state.cosRear) === 0) {
    mods *= bal.formations.shieldWall.frontRangedMult;
  }
  if (target.formation === 'loose') mods *= bal.formations.loose.rangedAgainstMult;
  if (smokeAt(state, target.x, target.y) || smokeAt(state, s.x, s.y)) mods *= bal.ranged.smokeMult;
  if (target.formation === 'shieldWall') mods *= s.unit.vsShieldWallAtkMult;
  mods *= moraleMult(bal, s.morale, false);
  return mods;
}

/** Hits of a volley from `s` at `target` (§31.10). */
export function volleyAgainst(state: BattleState, s: BSquad, target: BSquad, shooters: number, accMult: number): number {
  const bal = state.data.b;
  const side = state.sides[s.side];
  const d = Math.max(0, gapBetween(s, target));
  const elevated = isElevated(state, s, target.x, target.y);
  const acc = clamp(rangedAccuracy(bal, d, s.unit.range, elevated) + s.unit.accuracyBonus, 0, 1) * accMult;
  return volleyHits(bal, {
    shooters,
    rangedAtk: s.unit.rangedAtk,
    weaponMult: side.weaponMult,
    leaderArchery: s.leaderPresent && s.leader ? s.leader.archery : 0,
    def: target.unit.def,
    armourMult: state.sides[target.side].armourMult,
    accuracy: acc,
    mods: volleyMods(state, s, target),
  });
}

function spawnArrows(state: BattleState, s: BSquad, x: number, y: number, dur: number, fire: boolean, spread: number): void {
  const p = state.projectiles;
  const n = state.data.t.visualArrowsPerVolley;
  for (let k = 0; k < n; k++) {
    if (p.n >= p.x0.length) return;
    const i = p.n++;
    const off = ((k * 7919) % 13) / 13 - 0.5;
    const off2 = ((k * 104729) % 11) / 11 - 0.5;
    p.x0[i] = s.x + off * s.hw;
    p.y0[i] = s.y + off2 * s.hd;
    p.x1[i] = x + off * spread;
    p.y1[i] = y + off2 * spread;
    p.t0[i] = state.timeS;
    p.dur[i] = dur;
    p.fire[i] = fire ? 1 : 0;
  }
}

function schedule(state: BattleState, imp: Impact): void {
  state.impacts.push(imp);
}

/** Picks the target of a squad's next volley (ordered target if in range, else the nearest seen). */
function pickRangedTarget(state: BattleState, s: BSquad): BSquad | undefined {
  const vis = state.sides[s.side].visible;
  if (s.task.kind === 'attack') {
    const t = state.squads[s.task.target];
    if (t && onField(t) && vis[t.idx] === 1 && gapBetween(s, t) <= shotRange(state, s, t.x, t.y)) return t;
  }
  let best: BSquad | undefined;
  let bestD = Infinity;
  for (const o of state.squads) {
    if (o.side === s.side || !onField(o) || vis[o.idx] !== 1) continue;
    const d = gapBetween(s, o);
    if (d > shotRange(state, s, o.x, o.y)) continue;
    // Do not shoot into a melee our own side is fighting in.
    if (o.contacts !== 0 && o.status !== 'routing') {
      let friends = false;
      for (const f of state.squads) if (f.side === s.side && (o.contacts & (1 << f.idx)) !== 0) friends = true;
      if (friends) continue;
    }
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

/** Fires every ready ranged squad (§31.10: a volley every reload, bows and javelins alike). */
export function resolveRanged(state: BattleState): void {
  const t = state.data.t;
  const dt = state.dt;
  for (const s of state.squads) {
    if (!s.unit.hasRanged || s.status !== 'active') continue;
    if (s.reloadT > 0) s.reloadT -= dt;
    if (s.contacts !== 0 || s.unformedT > 0) continue;
    if (s.moving && !s.unit.shootWhileMoving) continue;
    if (s.reloadT > 0) continue;
    if (s.task.kind === 'volley') {
      const x = s.task.x;
      const y = s.task.y;
      if (gapToPoint(s, x, y) > shotRange(state, s, x, y)) continue;
      fireAreaVolley(state, s, x, y, s.task.fire);
      continue;
    }
    const target = pickRangedTarget(state, s);
    if (!target) continue;
    s.reloadT = s.unit.reloadS;
    s.hidden = false;
    s.quietT = 0;
    const hits = volleyAgainst(state, s, target, s.men, 1);
    const d = Math.sqrt((target.x - s.x) * (target.x - s.x) + (target.y - s.y) * (target.y - s.y));
    const dur = d / t.projectileSpeedTilesPerS;
    schedule(state, { t: state.timeS + dur, side: s.side, shooter: s.idx, target: target.idx, x: target.x, y: target.y, hits, area: false, fire: false });
    spawnArrows(state, s, target.x, target.y, dur, false, Math.max(target.hw, target.hd));
  }
}

/** An area volley at a point (the Volley ability), optionally with fire arrows (needs pitch). */
export function fireAreaVolley(state: BattleState, s: BSquad, x: number, y: number, fire: boolean): void {
  const t = state.data.t;
  s.reloadT = s.unit.reloadS;
  s.hidden = false;
  s.quietT = 0;
  const radius = t.volleyRadiusTiles;
  const inArea: BSquad[] = [];
  let menIn = 0;
  for (const o of state.squads) {
    if (o.side === s.side || !onField(o)) continue;
    if (gapToPoint(o, x, y) > radius) continue;
    inArea.push(o);
    menIn += o.men;
  }
  const d = Math.sqrt((x - s.x) * (x - s.x) + (y - s.y) * (y - s.y));
  const dur = d / t.projectileSpeedTilesPerS;
  for (const o of inArea) {
    const share = menIn > 0 ? o.men / menIn : 0;
    const hits = volleyAgainst(state, s, o, s.men * share, t.volleyAreaAccMult);
    schedule(state, { t: state.timeS + dur, side: s.side, shooter: s.idx, target: o.idx, x, y, hits, area: true, fire: false });
  }
  const side = state.sides[s.side];
  const lit = fire && side.pitchUsed + t.pitchPerFireVolleyT <= side.pitchT + 1e-9;
  if (lit) {
    side.pitchUsed += t.pitchPerFireVolleyT;
    schedule(state, { t: state.timeS + dur, side: s.side, shooter: s.idx, target: -1, x, y, hits: 0, area: true, fire: true });
  }
  spawnArrows(state, s, x, y, dur, lit, radius);
  emit(state, 'volley', { squad: s, x, y, vars: { fire: lit } });
}

/** Lands volleys whose arrows have arrived; retires arrow sprites. */
export function resolveImpacts(state: BattleState): void {
  const now = state.timeS;
  if (state.impacts.length > 0) {
    let w = 0;
    for (let i = 0; i < state.impacts.length; i++) {
      const imp = state.impacts[i]!;
      if (imp.t > now) {
        state.impacts[w++] = imp;
        continue;
      }
      if (imp.target >= 0) {
        const o = state.squads[imp.target]!;
        if (onField(o)) {
          o.casAcc += imp.hits;
          o.casTick += imp.hits;
          o.quietT = 0;
          if (o.status === 'asleep') wake(state, o);
        }
      } else if (imp.fire) {
        const radius = state.data.t.volleyRadiusTiles;
        const p = state.data.b.ranged.fireArrowIgnite;
        for (const b of state.buildings) {
          if (b.burning || b.collapsed) continue;
          if (distToRect(imp.x, imp.y, b.x, b.y, b.w, b.h) > radius) continue;
          if (state.rng.chance(p)) igniteBuilding(state, b, imp.side);
        }
        for (const g of state.gates) {
          if (g.broken || g.burning) continue;
          if (distToRect(imp.x, imp.y, g.x, g.y, g.w, g.h) > radius) continue;
          if (state.rng.chance(p * state.data.t.gateFlammability)) igniteGate(state, g);
        }
      }
    }
    state.impacts.length = w;
  }
  // Retire arrow sprites that have landed.
  const p = state.projectiles;
  let w = 0;
  for (let i = 0; i < p.n; i++) {
    if (p.t0[i]! + p.dur[i]! < now) continue;
    if (w !== i) {
      p.x0[w] = p.x0[i]!;
      p.y0[w] = p.y0[i]!;
      p.x1[w] = p.x1[i]!;
      p.y1[w] = p.y1[i]!;
      p.t0[w] = p.t0[i]!;
      p.dur[w] = p.dur[i]!;
      p.fire[w] = p.fire[i]!;
    }
    w++;
  }
  p.n = w;
}
