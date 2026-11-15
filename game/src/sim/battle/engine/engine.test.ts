import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import type { BattleKind } from '@sim/core/state';
import { S, T, Z } from '../map/grid';
import { battleDigest, makeTestSetup, runEngine, type FixtureOptions, type FixtureSquad } from '../testing';
import { rebuildCosts } from './costs';
import { BattleEngine, replayBattle } from './engine';
import { setFacing, updateFootprint } from './geometry';
import { applyOrder } from './orders';
import { stepBattle } from './step';
import type { BattleOrder, BattleState, BSquad } from './types';

const content = getContent();

function engineFor(opts: FixtureOptions, humanSides: ('attacker' | 'defender')[] = []): BattleEngine {
  return BattleEngine.create(makeTestSetup(content, opts), content, { humanSides });
}

/** Flattens a rectangle to open level ground and rebuilds the movement costs. */
function flatten(st: BattleState, x0: number, y0: number, x1: number, y1: number): void {
  const m = st.map;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = y * m.w + x;
      m.terrain[i] = T.open;
      m.height[i] = 0;
      m.struct[i] = S.none;
      m.zone[i] = 0;
    }
  rebuildCosts(st);
}

function put(s: BSquad, x: number, y: number, facing: number): void {
  s.x = s.px = x;
  s.y = s.py = y;
  setFacing(s, facing);
  s.task.kind = 'none';
  s.task.facing = facing;
}

/** Two squads facing each other in melee contact on flat ground (both sides human: no AI). */
function duelArena(a: FixtureSquad, d: FixtureSquad): { e: BattleEngine; A: BSquad; D: BSquad } {
  const e = engineFor({ kind: 'field', template: 'field', seed: 'arena', attacker: [a], defender: [d], playerSide: null }, ['attacker', 'defender']);
  const st = e.state;
  flatten(st, 20, 20, 76, 52);
  const A = st.squads[0]!;
  const D = st.squads[1]!;
  updateFootprint(st.data, A);
  updateFootprint(st.data, D);
  put(A, 48, 36 + A.hd + D.hd + 0.2, -Math.PI / 2);
  put(D, 48, 36, Math.PI / 2);
  for (const s of st.squads) s.hidden = false;
  st.sides[0].visible.fill(1);
  st.sides[1].visible.fill(1);
  return { e, A, D };
}

describe('melee in the engine (§31.8)', () => {
  it('50 vs 50 bondi in line lose about 0.6 men/s each', () => {
    const { e, A, D } = duelArena({ unit: 'bondi', men: 50 }, { unit: 'bondi', men: 50 });
    e.step(20 * 5);
    expect(A.contacts).not.toBe(0);
    // 5 s at 0.6/s (±10% randomness), whole men only.
    for (const s of [A, D]) {
      expect(s.lost + s.casAcc).toBeGreaterThan(0.6 * 5 * 0.85);
      expect(s.lost + s.casAcc).toBeLessThan(0.6 * 5 * 1.15);
    }
  });

  it('a charge with run-up hits ×1.5 for 3 s; an intact front shield wall breaks it and the charger bleeds ×1.5', () => {
    const run = (wall: boolean) => {
      const { e, A, D } = duelArena({ unit: 'huscarls', men: 40, leader: { name: 'H', command: 3 } }, { unit: 'bondi', men: 50, formation: wall ? 'shieldWall' : 'line' });
      const st = e.state;
      put(A, 48, 36 + 14, -Math.PI / 2);
      st.squads.forEach((s) => updateFootprint(st.data, s));
      expect(applyOrder(st, 0, { kind: 'ability', squad: A.id, ability: 'charge', target: D.id })).toBeNull();
      let t = 0;
      while (A.contacts === 0 && t++ < 400) e.step(1);
      const before = { a: A.lost + A.casAcc, d: D.lost + D.casAcc };
      const chargeT = A.chargeT;
      const blocked = A.chargeBlockedT;
      e.step(20);
      return { chargeT, blocked, dealt: D.lost + D.casAcc - before.d, taken: A.lost + A.casAcc - before.a };
    };
    const open = run(false);
    const wall = run(true);
    expect(open.chargeT).toBeGreaterThan(2.5);
    expect(open.blocked).toBe(0);
    expect(wall.blocked).toBeGreaterThan(0);
    // Huscarls in line vs bondi in line: 0.03 × 20 × (7×1.06 / 4) × 1.5 ≈ 1.67 men/s.
    expect(open.dealt).toBeGreaterThan(1.67 * 0.8);
    // Against the wall the charge is negated and def is ×1.3.
    expect(wall.dealt).toBeLessThan(open.dealt * 0.6);
    expect(wall.taken).toBeGreaterThan(open.taken * 1.3);
  });

  it('wavering below 30 and rout below 12; a routed squad flees toward its extraction zone', () => {
    const { e, D } = duelArena({ unit: 'huscarls', men: 80, leader: { name: 'H', command: 8 } }, { unit: 'bondi', men: 30 });
    let t = 0;
    while (D.status === 'active' && t++ < 20 * 60) e.step(1);
    expect(D.status).toBe('routing');
    expect(D.morale).toBeLessThan(e.state.data.b.routAt);
    const y0 = D.y;
    e.step(40);
    // Defenders escape north (−y).
    expect(D.y).toBeLessThan(y0);
  });
});

describe('determinism and replays', () => {
  const orders: [number, BattleOrder][] = [
    [0, { kind: 'formation', squads: ['a1'], formation: 'shieldWall' }],
    [10, { kind: 'move', squads: ['a0', 'a1'], x: 48, y: 40, run: true }],
    [40, { kind: 'stance', squads: ['a2'], stance: 'hold' }],
    [60, { kind: 'ability', squad: 'a3', ability: 'frenzy' }],
    [80, { kind: 'move', squads: ['a3'], x: 40, y: 30, queue: true }],
    [200, { kind: 'retreatAll' }],
  ];
  const scripted = (seed: string) => {
    const e = engineFor({ kind: 'raid', seed }, ['attacker']);
    let k = 0;
    while (e.status !== 'ended' && e.tick < 20 * 400) {
      while (k < orders.length && orders[k]![0] === e.tick) e.order(orders[k++]![1]);
      if (e.status === 'duelRequested') e.autoResolveDuel();
      else e.step(1);
    }
    return e;
  };

  it('same setup and orders give the identical battle', () => {
    const a = scripted('det');
    const b = scripted('det');
    expect(battleDigest(a.state)).toBe(battleDigest(b.state));
    expect(a.result()).toEqual(b.result());
    expect(JSON.parse(JSON.stringify(a.result()))).toEqual(a.result());
  });

  it('a different seed gives a different battle', () => {
    expect(battleDigest(scripted('det').state)).not.toBe(battleDigest(scripted('det2').state));
  });

  it('replaying the recorded orders rebuilds the battle exactly', () => {
    const live = scripted('replay');
    const rep = live.replay();
    expect(rep.orders.length).toBeGreaterThan(3);
    const again = replayBattle(makeTestSetup(content, { kind: 'raid', seed: 'replay' }), content, rep);
    expect(battleDigest(again.state)).toBe(battleDigest(live.state));
    expect(again.result()).toEqual(live.result());
  });
});

describe('battles end', () => {
  const kinds: BattleKind[] = ['raid', 'assault', 'cloister', 'fortress', 'sortie', 'field', 'ambush', 'beach', 'defense', 'guardian'];
  for (const kind of kinds) {
    it(`${kind}: AI against AI finishes with a winner or a stalemate`, () => {
      for (const seed of ['end-1', 'end-2']) {
        const e = engineFor({ kind, seed, playerSide: null, hasRam: true, hasPitch: true, fortTier: kind === 'assault' ? 1 : 0 });
        const ticks = runEngine(e, 20 * e.state.data.t.maxDurationS + 10);
        expect(e.status, `${kind} ${seed}`).toBe('ended');
        expect(ticks).toBeLessThanOrEqual(20 * e.state.data.t.maxDurationS + 1);
        const r = e.result()!;
        expect(['attacker', 'defender', 'none']).toContain(r.winner);
        // Men are conserved: losses never exceed the men who fought.
        for (const side of ['attacker', 'defender'] as const) {
          const men = (side === 'attacker' ? e.state.setup.attacker : e.state.setup.defender).squads.reduce((a, s) => a + s.men, 0);
          const lost = r.casualties.filter((c) => c.side === side).reduce((a, c) => a + c.killed + c.wounded + c.captured, 0);
          expect(lost).toBeLessThanOrEqual(men);
        }
        const rows = r.squadLosses ?? [];
        expect(rows.reduce((a, x) => a + x.killed + x.wounded + x.captured, 0)).toBe(r.casualties.reduce((a, c) => a + c.killed + c.wounded + c.captured, 0));
      }
    });
  }
});

describe('Retreat to Ships always works', () => {
  it('squads inside closed walls climb out and reach the ships, past an enemy squad on the road', () => {
    const e = engineFor({ kind: 'assault', template: 'town', seed: 'trapped', fortTier: 3, playerSide: 'attacker', defender: [{ unit: 'fyrdSpearmen', men: 30, leader: { name: 'C', command: 1 }, chief: true }] }, ['attacker', 'defender']);
    const st = e.state;
    const ring = st.map.ring!;
    expect(ring).not.toBeNull();
    // Every attacker squad starts deep inside the ring; the gates stay shut (no ladders, no ram).
    const att = st.squads.filter((s) => s.side === 0);
    att.forEach((s, k) => {
      let x = ring.x + 4 + k * 3;
      let y = ring.y + 4;
      for (let tries = 0; tries < 200; tries++) {
        const i = Math.floor(y) * st.map.w + Math.floor(x);
        if (Number.isFinite(st.sides[0].cost[i]!) && (st.map.zone[i]! & Z.inside) !== 0) break;
        x = ring.x + 3 + ((tries * 7) % (ring.w - 6));
        y = ring.y + 3 + Math.floor(tries / 9);
      }
      put(s, x + 0.5, y + 0.5, Math.PI / 2);
    });
    // An enemy squad holds the south gate road.
    const d = st.squads.find((s) => s.side === 1)!;
    const gate = st.gates.reduce((best, g) => (g.cy > best.cy ? g : best), st.gates[0]!);
    put(d, gate.inX, gate.inY - 2, Math.PI / 2);
    d.stance = 'hold';
    expect(st.gates.every((g) => !g.broken)).toBe(true);
    e.order({ kind: 'retreatAll' }, 'attacker');
    let t = 0;
    while (e.status !== 'ended' && t++ < 20 * 300) e.step(1);
    for (const s of att) expect(['escaped', 'destroyed']).toContain(s.status);
    expect(att.filter((s) => s.status === 'escaped').length).toBeGreaterThan(0);
    expect(e.state.end?.reason).toBe('retreat');
    expect(e.result()!.retreated).toBe(true);
  });

  it('every walkable tile of every template has a finite way to the extraction zone', () => {
    for (const kind of ['raid', 'fortress', 'cloister', 'guardian', 'ambush', 'field', 'beach'] as const) {
      const e = engineFor({ kind, seed: 'field-check', fortTier: kind === 'raid' ? 4 : 0, playerSide: null });
      const st = e.state;
      for (const side of st.sides) {
        let bad = 0;
        for (let i = 0; i < st.map.w * st.map.h; i++) if (Number.isFinite(side.cost[i]!) && !Number.isFinite(side.retreatField[i]!)) bad++;
        expect(bad, `${kind} ${side.key}`).toBe(0);
      }
    }
  });
});

describe('the battlefield', () => {
  it('a ram breaks a gate at 40 hp/s and the way opens', () => {
    const e = engineFor({ kind: 'assault', template: 'town', seed: 'ram', fortTier: 1, hasRam: true }, ['attacker', 'defender']);
    const st = e.state;
    const gate = st.gates.reduce((best, g) => (g.cy > best.cy ? g : best), st.gates[0]!);
    const hus = st.squads[0]!;
    put(hus, gate.outX, gate.outY + 1.5, -Math.PI / 2);
    expect(applyOrder(st, 0, { kind: 'ability', squad: hus.id, ability: 'ram', target: gate.id })).toBeNull();
    let t = 0;
    while (!gate.broken && t++ < 20 * 30) e.step(1);
    expect(gate.broken).toBe(true);
    expect(t / 20).toBeGreaterThan(300 / 40 - 0.5);
    expect(t / 20).toBeLessThan(300 / 40 + 5);
    expect(e.events().some((ev) => ev.kind === 'gateBroken')).toBe(true);
    // Paths are re-planned over the rubble from the next tick.
    e.step(1);
    const i = gate.y * st.map.w + gate.x;
    expect(Number.isFinite(st.sides[0].cost[i]!)).toBe(true);
  });

  it('fire burns 30 s, takes 10% of the loot per second, then the building collapses; wind carries it', () => {
    const e = engineFor({ kind: 'raid', template: 'town', seed: 'fire', windDir: 270, windStr: 1 }, ['attacker', 'defender']);
    const st = e.state;
    const holder = st.buildings.find((b) => b.cache >= 0)!;
    const value0 = st.caches[holder.cache]!.value;
    holder.burning = true;
    st.smokeDirty = true;
    e.step(20);
    expect(st.caches[holder.cache]!.value).toBeLessThan(value0 * 0.95);
    expect(st.caches[holder.cache]!.value).toBeGreaterThan(value0 * 0.85);
    e.step(20 * 30);
    expect(holder.collapsed).toBe(true);
    expect(st.buildingsBurned).toBeGreaterThanOrEqual(1);
    expect(st.lootBurned).toBeGreaterThan(0);
    const i = holder.y * st.map.w + holder.x;
    expect(st.map.terrain[i]).toBe(T.rubble);
  });

  it('fire arrows burn pitch and set roofs alight where they fall', () => {
    const base = getContent();
    const sure = { ...base, balance: { ...base.balance, battle: { ...base.balance.battle, ranged: { ...base.balance.battle.ranged, fireArrowIgnite: 1 } } } };
    const setup = makeTestSetup(sure, { kind: 'raid', template: 'town', seed: 'fire-arrows', hasPitch: true });
    setup.attacker.pitchT = 0.12;
    const e = BattleEngine.create(setup, sure, { humanSides: ['attacker', 'defender'] });
    const st = e.state;
    const archers = st.squads.find((s) => s.side === 0 && s.unit.hasRanged)!;
    const target = st.buildings.find((b) => !b.burning)!;
    put(archers, target.cx, target.cy + target.h / 2 + 8, -Math.PI / 2);
    expect(applyOrder(st, 0, { kind: 'ability', squad: archers.id, ability: 'volley', x: target.cx, y: target.cy, fire: true })).toBeNull();
    e.step(20 * 2);
    expect(target.burning).toBe(true);
    expect(st.sides[0].pitchUsed).toBeCloseTo(st.data.t.pitchPerFireVolleyT, 9);
    // The holds run dry after two volleys: later volleys are plain arrows.
    e.step(20 * 12);
    expect(st.sides[0].pitchUsed).toBeLessThanOrEqual(0.12 + 1e-9);
    const volleys = e.events().filter((ev) => ev.kind === 'volley');
    expect(volleys.some((v) => v.vars?.fire === true)).toBe(true);
    expect(volleys.some((v) => v.vars?.fire === false)).toBe(true);
    expect(e.concede('none').pitchUsedT?.attacker).toBeCloseTo(st.sides[0].pitchUsed, 2);
  });

  it('raiders gather a cache in 5 s and carry the loot to the ships', () => {
    const e = engineFor({ kind: 'raid', seed: 'loot', defender: [{ unit: 'fyrdSpearmen', men: 10 }] }, ['attacker', 'defender']);
    const st = e.state;
    const cache = st.caches.find((c) => c.value > 100)!;
    const squad = st.squads[1]!;
    put(squad, cache.x, cache.y + 1, -Math.PI / 2);
    // The lone defender stands aside (on the road it would be fought and routed, ending the raid first).
    const guard = st.squads.find((s) => s.side === 1)!;
    put(guard, cache.x < st.map.w / 2 ? st.map.w - 6 : 6, 8, Math.PI / 2);
    expect(applyOrder(st, 0, { kind: 'loot', squads: [squad.id], cache: cache.id })).toBeNull();
    e.step(20 * 4);
    expect(squad.loot).toBe(0);
    e.step(20 * 2);
    expect(squad.loot).toBeGreaterThan(0);
    const carried = squad.loot;
    expect(applyOrder(st, 0, { kind: 'retreat', squads: [squad.id] })).toBeNull();
    let t = 0;
    while (squad.status !== 'escaped' && t++ < 20 * 200) e.step(1);
    expect(squad.status).toBe('escaped');
    expect(st.sides[0].lootSecured).toBeCloseTo(carried, 6);
  });

  it('Challenge pauses the battle for a duel; the outcome comes back through the engine', () => {
    const e = engineFor({ kind: 'assault', seed: 'duel', playerSide: 'attacker' }, ['attacker']);
    const st = e.state;
    const chief = st.squads.find((s) => s.isChief)!;
    const player = st.squads.find((s) => s.isPlayer)!;
    put(player, chief.x, chief.y + chief.hd + player.hd + 3, -Math.PI / 2);
    chief.leader!.acceptsChallenge = true;
    e.order({ kind: 'ability', squad: player.id, ability: 'challenge' });
    e.step(1);
    expect(e.status).toBe('duelRequested');
    const req = e.duelRequest()!;
    expect(req.chiefId).toBe(st.setup.defender.chiefId);
    const tick = e.tick;
    e.step(10);
    expect(e.tick).toBe(tick);
    e.resolveDuel({ winnerId: req.challengerId, loserFate: 'killed' });
    expect(st.duels).toHaveLength(1);
    expect(st.sides[1].chiefFate).toBe('killed');
    runEngine(e, 200);
    expect(e.status).toBe('ended');
    expect(e.result()!.winner).toBe('attacker');
    expect(e.result()!.chief.killed).toBe(true);
    expect(e.result()!.duels).toHaveLength(1);
  });

  it('a downed player is carried off when friends are near, and never dies in Gentle Mode', () => {
    for (const gentle of [false, true]) {
      for (let k = 0; k < 6; k++) {
        const setup = makeTestSetup(content, { kind: 'field', seed: `safety-${k}` });
        setup.gentleMode = gentle;
        const e = BattleEngine.create(setup, content, { humanSides: ['attacker', 'defender'] });
        const st = e.state;
        const p = st.squads.find((s) => s.isPlayer)!;
        const friend = st.squads.find((s) => s.side === 0 && !s.isPlayer)!;
        put(friend, p.x + (k % 2 === 0 ? 3 : 40), p.y, 0);
        p.casAcc = p.men + 1;
        stepBattle(st);
        const fate = st.leaderFates[p.leaderId];
        if (k % 2 === 0) expect(['seriouslyWounded', 'mortallyWounded']).toContain(fate);
        else expect(['captured', 'dead']).toContain(fate);
        if (gentle) expect(fate).not.toBe('dead');
      }
    }
  });

  it('orders are validated', () => {
    const e = engineFor({ kind: 'raid', seed: 'orders' }, ['attacker']);
    const st = e.state;
    expect(applyOrder(st, 0, { kind: 'formation', squads: ['a2'], formation: 'shieldWall' })).toBe('formationUnavailable');
    expect(applyOrder(st, 0, { kind: 'ability', squad: 'a0', ability: 'volley', x: 1, y: 1 })).toBe('abilityUnavailable');
    expect(applyOrder(st, 0, { kind: 'ability', squad: 'a2', ability: 'volley', x: 1, y: 1 })).toBe('outOfRange');
    expect(applyOrder(st, 0, { kind: 'ability', squad: 'a1', ability: 'shieldWall' })).toBeNull();
    expect(applyOrder(st, 0, { kind: 'formation', squads: ['a1'], formation: 'line' })).toBeNull();
    expect(applyOrder(st, 0, { kind: 'formation', squads: ['a1'], formation: 'shieldWall' })).toBe('cooldown');
    expect(applyOrder(st, 0, { kind: 'ability', squad: 'd0', ability: 'rally' })).toBe('unknownSquad');
    expect(applyOrder(st, 0, { kind: 'move', squads: ['zz'], x: 3, y: 3 })).toBe('noSquads');
    expect(applyOrder(st, 0, { kind: 'ability', squad: 'a0', ability: 'rally' })).toBeNull();
    expect(applyOrder(st, 0, { kind: 'ability', squad: 'a0', ability: 'rally' })).toBe('cooldown');
    // Queued client orders are recorded with their tick; rejected ones are not.
    e.order({ kind: 'move', squads: ['a0'], x: 40, y: 40 });
    e.order({ kind: 'formation', squads: ['a2'], formation: 'shieldWall' });
    e.step(1);
    expect(e.replay().orders).toHaveLength(1);
  });

  it('snapshots hide enemies the viewer cannot see and stay within the figure budget', () => {
    const e = engineFor({ kind: 'raid', seed: 'snap', approach: 'night' }, ['attacker']);
    e.step(5);
    const own = e.snapshot('attacker');
    const all = e.snapshot(null);
    expect(all.squads.length).toBeGreaterThanOrEqual(own.squads.length);
    expect(own.squads.every((s) => s.side === 'attacker' || e.state.sides[0].visible[e.state.squads.find((q) => q.id === s.id)!.idx] === 1)).toBe(true);
    expect(own.figures.n).toBeLessThanOrEqual(e.state.data.b.maxFigures);
    expect(own.timeLeftS).toBeGreaterThan(0);
    expect(own.night).toBe(true);
    expect(JSON.parse(JSON.stringify({ ...own, figures: null }))).toBeTruthy();
  });

  it('a night raid finds half the defenders asleep; they wake to the alarm, unformed', () => {
    const e = engineFor({ kind: 'raid', seed: 'night', approach: 'night', defender: [{ unit: 'fyrdSpearmen', men: 20 }, { unit: 'fyrdSpearmen', men: 20 }, { unit: 'fyrdSpearmen', men: 20 }, { unit: 'fyrdSpearmen', men: 20 }] }, ['attacker', 'defender']);
    const st = e.state;
    const asleep = st.squads.filter((s) => s.status === 'asleep');
    const awake = st.squads.filter((s) => s.side === 1 && (s.status === 'active' || s.status === 'reserve'));
    expect(asleep.length).toBe(Math.round((asleep.length + awake.filter((s) => s.status === 'active').length) * st.data.b.nightRaidAsleepShare));
    expect(st.night).toBe(true);
    const sleeper = asleep[0]!;
    const raider = st.squads[0]!;
    put(raider, sleeper.x, sleeper.y + sleeper.hd + raider.hd + 2, -Math.PI / 2);
    e.step(10);
    expect(sleeper.status).toBe('active');
    expect(sleeper.unformedT).toBeGreaterThan(0);
    expect(sleeper.morale).toBeLessThan(sleeper.moraleStart);
    expect(e.events().some((ev) => ev.kind === 'awake')).toBe(true);
  });

  it('a town whose captured chief has lost its last standing men surrenders', () => {
    const e = engineFor({ kind: 'assault', seed: 'surrender', playerSide: 'attacker' }, ['attacker', 'defender']);
    const st = e.state;
    const chief = st.squads.find((s) => s.isChief)!;
    st.duel = { challengerId: st.squads[0]!.leaderId, challengerSquad: 'a0', chiefId: chief.leaderId, chiefSquad: chief.id, side: 'attacker' };
    st.status = 'duelRequested';
    e.resolveDuel({ winnerId: st.squads[0]!.leaderId, loserFate: 'captured' });
    expect(st.sides[1].chiefFate).toBe('captured');
    // The chief's capture ends an assault at once (§13.2); with the town broken it also surrenders.
    expect(e.status).toBe('ended');
    expect(e.state.end!.reason).toBe('chief');
    const e2 = engineFor({ kind: 'raid', seed: 'surrender', playerSide: 'attacker' }, ['attacker', 'defender']);
    const st2 = e2.state;
    const chief2 = st2.squads.find((s) => s.isChief)!;
    st2.sides[1].chiefFate = 'captured';
    // Every defender, the raid's later waves included, breaks at once.
    for (const s of st2.squads)
      if (s.side === 1 && s !== chief2) {
        s.morale = 0;
        s.arrivalT = 0;
      }
    chief2.morale = 0;
    e2.step(2);
    expect(e2.status).toBe('ended');
    expect(e2.state.end!.reason).toBe('surrender');
    const r = e2.result()!;
    expect(r.surrendered).toBe(true);
    expect(r.casualties.filter((c) => c.side === 'defender').reduce((n, c) => n + c.captured, 0)).toBeGreaterThan(0);
  });

  it('Wolf-coats in hiding are unseen until within 3 tiles', () => {
    const e = engineFor({ kind: 'field', seed: 'hide', attacker: [{ unit: 'wolfcoats', men: 20, leader: { name: 'W', command: 2 } }], defender: [{ unit: 'fyrdSpearmen', men: 30 }] }, ['attacker', 'defender']);
    const st = e.state;
    flatten(st, 10, 10, 86, 60);
    const [w, f] = [st.squads[0]!, st.squads[1]!];
    put(w, 40, 40, -Math.PI / 2);
    put(f, 40, 30, Math.PI / 2);
    expect(applyOrder(st, 0, { kind: 'ability', squad: w.id, ability: 'hide' })).toBeNull();
    e.step(5);
    expect(st.sides[1].visible[w.idx]).toBe(0);
    expect(e.snapshot('defender').squads.some((s) => s.id === w.id)).toBe(false);
    put(w, 40, 30 + f.hd + w.hd + 2, -Math.PI / 2);
    e.step(5);
    expect(st.sides[1].visible[w.idx]).toBe(1);
  });

  it('a raid ends when the horns sound and the raiders reach the ships', () => {
    const e = engineFor({ kind: 'raid', seed: 'horns', timerS: 180, playerSide: null, defender: [{ unit: 'fyrdSpearmen', men: 8 }] });
    runEngine(e, 20 * 600);
    expect(e.status).toBe('ended');
    expect(['raidTimer', 'extracted', 'rout']).toContain(e.state.end!.reason);
    expect(e.result()!.winner).toBe('attacker');
    expect(e.result()!.lootValue).toBeGreaterThan(0);
  });
});
