/**
 * Direct control (drive orders): deterministic and replayed from the order log, blocked tiles and
 * sliding, halting and holding ground, a group keeping its shape at the slowest pace, fighting on
 * contact, a charge "ahead", and an aimed area volley.
 */
import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { S, T } from '../map/grid';
import { battleDigest, makeTestSetup, type FixtureSquad } from '../testing';
import { rebuildCosts } from './costs';
import { BattleEngine, replayBattle } from './engine';
import { gapToPoint, setFacing, updateFootprint } from './geometry';
import { applyOrder } from './orders';
import type { BattleState, BSquad } from './types';

const content = getContent();

function engineFor(attacker: FixtureSquad[], defender: FixtureSquad[], seed = 'drive', humanSides: ('attacker' | 'defender')[] = ['attacker', 'defender']): BattleEngine {
  return BattleEngine.create(makeTestSetup(content, { kind: 'field', template: 'field', seed, attacker, defender, playerSide: 'attacker' }), content, { humanSides });
}

/** Open level ground everywhere (no walls, woods or water), costs rebuilt. */
function flattenAll(st: BattleState): void {
  const m = st.map;
  for (let i = 0; i < m.w * m.h; i++) {
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

/** Flat field, squads placed by hand; every enemy far off in a corner unless placed. */
function arena(attacker: FixtureSquad[], defender: FixtureSquad[] = [{ unit: 'bondi', men: 30 }]): { e: BattleEngine; st: BattleState; A: BSquad[]; D: BSquad[] } {
  const e = engineFor(attacker, defender);
  const st = e.state;
  flattenAll(st);
  const A = st.squads.filter((s) => s.side === 0);
  const D = st.squads.filter((s) => s.side === 1);
  A.forEach((s, k) => put(s, 30 + k * 8, 40, -Math.PI / 2));
  D.forEach((s, k) => put(s, 88 - k * 6, 6, Math.PI / 2));
  for (const s of st.squads) updateFootprint(st.data, s);
  st.sides[0].visible.fill(1);
  st.sides[1].visible.fill(1);
  return { e, st, A, D };
}

describe('drive orders (direct control)', () => {
  it('moves the squads while held, faces the way they go, and stops at once when let go', () => {
    const { e, A } = arena([{ unit: 'bondi', men: 40 }]);
    const s = A[0]!;
    const x0 = s.x;
    e.order({ kind: 'drive', squads: [s.id], dx: 1, dy: 0 }, 'attacker');
    e.step(20);
    expect(s.task.kind).toBe('drive');
    expect(s.x).toBeGreaterThan(x0 + 1);
    expect(Math.abs(s.facing)).toBeLessThan(1e-9);
    const speed = s.unit.speed * e.state.data.t.drive.speedMult;
    expect(s.x - x0).toBeCloseTo(speed * 20 * e.state.dt, 6);
    e.order({ kind: 'drive', squads: [s.id], dx: 0, dy: 0 }, 'attacker');
    e.step(1);
    const stopX = s.x;
    e.step(40);
    expect(s.x).toBe(stopX);
    expect(s.task.kind).toBe('none');
    expect(s.driveHeld).toBe(true);
    expect(e.snapshot('attacker').squads.find((q) => q.id === s.id)!.held).toBe(true);
  });

  it('runs with Shift (faster, and tiring)', () => {
    const walk = arena([{ unit: 'bondi', men: 40 }]);
    const run = arena([{ unit: 'bondi', men: 40 }]);
    walk.e.order({ kind: 'drive', squads: ['a0'], dx: 0, dy: -1 }, 'attacker');
    run.e.order({ kind: 'drive', squads: ['a0'], dx: 0, dy: -1, run: true }, 'attacker');
    walk.e.step(60);
    run.e.step(60);
    const dWalk = 40 - walk.A[0]!.y;
    const dRun = 40 - run.A[0]!.y;
    expect(dRun / dWalk).toBeCloseTo(walk.st.data.t.runSpeedMult, 1);
    expect(run.A[0]!.stamina).toBeLessThan(walk.A[0]!.stamina);
  });

  it('a held squad stands its ground: its stance does not send it after a nearby enemy', () => {
    const { e, st, A, D } = arena([{ unit: 'bondi', men: 40 }]);
    const s = A[0]!;
    e.order({ kind: 'drive', squads: [s.id], dx: 0, dy: -1 }, 'attacker');
    e.step(10);
    e.order({ kind: 'drive', squads: [s.id], dx: 0, dy: 0 }, 'attacker');
    e.step(1);
    // An enemy well inside the engage range, standing still under orders to hold.
    put(D[0]!, s.x, s.y - st.data.t.autoEngageRangeTiles * 0.6, Math.PI / 2);
    D[0]!.stance = 'hold';
    const x = s.x;
    const y = s.y;
    e.step(40);
    expect(s.task.kind).toBe('none');
    expect(Math.hypot(s.x - x, s.y - y)).toBeLessThan(0.05);
    // Without the drive, an idle engage-stance squad goes for him.
    s.driveHeld = false;
    e.step(10);
    expect(s.task.kind).toBe('attack');
  });

  it('does not walk into blocked tiles; head-on it slips past a single obstacle, along a wall it slides', () => {
    const { e, st, A } = arena([{ unit: 'bondi', men: 20 }]);
    const s = A[0]!;
    const m = st.map;
    // A long wall of houses across the way north at y = 30, a single post at (30, 50).
    for (let x = 10; x <= 60; x++) m.struct[30 * m.w + x] = S.building;
    rebuildCosts(st);
    put(s, 30.5, 34.5, -Math.PI / 2);
    e.order({ kind: 'drive', squads: [s.id], dx: 0, dy: -1 }, 'attacker');
    for (let k = 0; k < 120; k++) {
      e.step(1);
      expect(Number.isFinite(st.sides[0].cost[Math.floor(s.y) * m.w + Math.floor(s.x)]!)).toBe(true);
    }
    expect(s.y).toBeGreaterThanOrEqual(31);
    // Diagonal into the wall: slides east along it.
    const x0 = s.x;
    e.order({ kind: 'drive', squads: [s.id], dx: 1, dy: -1 }, 'attacker');
    e.step(60);
    expect(s.x).toBeGreaterThan(x0 + 2);
    expect(s.y).toBeGreaterThanOrEqual(31);
    // A single blocked tile straight ahead: it goes round it and carries on north.
    m.struct[45 * m.w + 30] = S.building;
    rebuildCosts(st);
    put(s, 30.5, 48.5, -Math.PI / 2);
    e.order({ kind: 'drive', squads: [s.id], dx: 0, dy: -1 }, 'attacker');
    e.step(160);
    expect(s.y).toBeLessThan(43);
  });

  it('keeps the edge of the field', () => {
    const { e, A } = arena([{ unit: 'bondi', men: 20 }]);
    const s = A[0]!;
    put(s, 2, 40, Math.PI);
    e.order({ kind: 'drive', squads: [s.id], dx: -1, dy: 0, run: true }, 'attacker');
    e.step(80);
    expect(s.x).toBeGreaterThanOrEqual(0.5);
    expect(s.status).toBe('active');
  });

  it('a group keeps its shape and the pace of its slowest squad', () => {
    const { e, A } = arena([
      { unit: 'skirmishers', men: 30 },
      { unit: 'huscarls', men: 30 },
      { unit: 'berserkers', men: 30 },
    ]);
    const ids = A.map((s) => s.id);
    const offsets = A.map((s) => [s.x - A[0]!.x, s.y - A[0]!.y]);
    const start = A.map((s) => [s.x, s.y]);
    e.order({ kind: 'drive', squads: ids, dx: 1, dy: -1 }, 'attacker');
    e.step(100);
    A.forEach((s, k) => {
      expect(s.x - A[0]!.x).toBeCloseTo(offsets[k]![0]!, 6);
      expect(s.y - A[0]!.y).toBeCloseTo(offsets[k]![1]!, 6);
    });
    // Everyone travelled as far as the huscarls (the slowest) could.
    const slowest = Math.min(...A.map((s) => s.unit.speed)) * e.state.data.t.drive.speedMult;
    const moved = Math.hypot(A[0]!.x - start[0]![0]!, A[0]!.y - start[0]![1]!);
    expect(moved).toBeCloseTo(slowest * 100 * e.state.dt, 6);
  });

  it('meets the enemy and fights without another order, and keeps fighting when let go', () => {
    const { e, A, D } = arena([{ unit: 'bondi', men: 40 }], [{ unit: 'bondi', men: 40 }]);
    const s = A[0]!;
    put(D[0]!, s.x, s.y - 10, Math.PI / 2);
    D[0]!.stance = 'hold';
    e.order({ kind: 'drive', squads: [s.id], dx: 0, dy: -1 }, 'attacker');
    let t = 0;
    while (s.contacts === 0 && t++ < 200) e.step(1);
    expect(s.contacts).not.toBe(0);
    e.step(20);
    expect(s.contacts).not.toBe(0);
    expect(s.fighting).toBe(true);
    e.order({ kind: 'drive', squads: [s.id], dx: 0, dy: 0 }, 'attacker');
    e.step(40);
    expect(s.contacts).not.toBe(0);
    const lostD = D[0]!.lost + D[0]!.casAcc;
    e.step(40);
    expect(D[0]!.lost + D[0]!.casAcc).toBeGreaterThan(lostD);
    // Steering away breaks off.
    e.order({ kind: 'drive', squads: [s.id], dx: 0, dy: 1, run: true }, 'attacker');
    e.step(60);
    expect(s.contacts).toBe(0);
  });

  it('a later order replaces the drive, and a stop leaves squads that are no longer driving alone', () => {
    const { e, st, A, D } = arena([{ unit: 'bondi', men: 40 }, { unit: 'bondi', men: 40 }]);
    e.order({ kind: 'drive', squads: ['a0', 'a1'], dx: 0, dy: -1 }, 'attacker');
    e.step(5);
    e.order({ kind: 'move', squads: ['a1'], x: 70, y: 40 }, 'attacker');
    e.step(5);
    expect(A[1]!.task.kind).toBe('move');
    e.order({ kind: 'drive', squads: ['a0', 'a1'], dx: 0, dy: 0 }, 'attacker');
    e.step(1);
    expect(A[0]!.task.kind).toBe('none');
    expect(A[1]!.task.kind).toBe('move');
    // A drive replaces an attack order.
    st.sides[0].visible.fill(1);
    expect(applyOrder(st, 0, { kind: 'attack', squads: ['a0'], target: D[0]!.id })).toBeNull();
    expect(applyOrder(st, 0, { kind: 'drive', squads: ['a0'], dx: 1, dy: 1 })).toBeNull();
    expect(A[0]!.task.kind).toBe('drive');
    expect(applyOrder(st, 0, { kind: 'drive', squads: ['a0'], dx: 2 as 1, dy: 0 })).toBe('badTarget');
    expect(applyOrder(st, 0, { kind: 'drive', squads: ['d0'], dx: 1, dy: 0 })).toBe('noSquads');
  });

  it('Space charges the enemy ahead, not the one behind; with no one ahead there is nothing to charge', () => {
    const { st, A, D } = arena([{ unit: 'huscarls', men: 40 }], [{ unit: 'bondi', men: 30 }, { unit: 'bondi', men: 30 }]);
    const s = A[0]!;
    put(s, 40, 36, 0); // facing east
    put(D[0]!, 52, 36, Math.PI); // ahead
    put(D[1]!, 32, 36, 0); // closer, but behind
    expect(applyOrder(st, 0, { kind: 'ability', squad: s.id, ability: 'charge', ahead: true })).toBeNull();
    expect(s.task.kind).toBe('attack');
    expect(s.task.target).toBe(D[0]!.idx);
    expect(s.chargeArmed).toBe(true);
    const { st: st2, A: A2, D: D2 } = arena([{ unit: 'huscarls', men: 40 }]);
    put(A2[0]!, 40, 36, 0);
    put(D2[0]!, 20, 36, 0);
    expect(applyOrder(st2, 0, { kind: 'ability', squad: A2[0]!.id, ability: 'charge', ahead: true })).toBe('noTarget');
    expect(A2[0]!.cooldowns.every((c) => c === 0)).toBe(true);
  });

  it('an aimed volley falls where the marker was, along the facing, within range', () => {
    const { e, st, A, D } = arena([{ unit: 'archers', men: 30 }], [{ unit: 'bondi', men: 40 }]);
    const s = A[0]!;
    put(s, 40, 40, -Math.PI / 2);
    const range = s.unit.range;
    put(D[0]!, 40, 40 - s.hd - range * 0.7 - D[0]!.hd, Math.PI / 2);
    D[0]!.stance = 'hold';
    // The marker's spot: straight ahead, 70% of the range in front of the archers.
    const gap = range * 0.7;
    const x = s.x + s.fx * (s.hd + gap);
    const y = s.y + s.fy * (s.hd + gap);
    expect(gapToPoint(s, x, y)).toBeCloseTo(gap, 6);
    e.order({ kind: 'ability', squad: s.id, ability: 'volley', x, y, fire: true }, 'attacker');
    e.step(1);
    expect(s.task.kind).toBe('volley');
    const before = D[0]!.lost + D[0]!.casAcc;
    e.step(60);
    const volleys = st.events.filter((ev) => ev.kind === 'volley' && ev.squad === s.id);
    expect(volleys.length).toBeGreaterThan(0);
    expect(volleys[0]!.x).toBeCloseTo(x, 6);
    expect(volleys[0]!.y).toBeCloseTo(y, 6);
    expect(D[0]!.lost + D[0]!.casAcc).toBeGreaterThan(before);
    // Beyond the longest shot the order is refused.
    expect(applyOrder(st, 0, { kind: 'ability', squad: s.id, ability: 'volley', x: s.x, y: s.y - s.hd - range * 1.5 })).not.toBeNull();
  });

  it('the same drive orders give the same battle, and the replay log rebuilds it', () => {
    const play = (seed: string) => {
      const e = engineFor(
        [
          { unit: 'huscarls', men: 40, leader: { name: 'H', command: 4, isPlayer: true, role: 'player' } },
          { unit: 'bondi', men: 50 },
          { unit: 'archers', men: 30 },
        ],
        [{ unit: 'bondi', men: 60 }, { unit: 'fyrdSpearmen', men: 40 }],
        seed,
        ['attacker'],
      );
      const ids = ['a0', 'a1', 'a2'];
      const script: [number, () => void][] = [
        [0, () => e.order({ kind: 'drive', squads: ids, dx: 0, dy: -1 })],
        [40, () => e.order({ kind: 'drive', squads: ids, dx: 1, dy: -1, run: true })],
        [90, () => e.order({ kind: 'drive', squads: ['a2'], dx: 0, dy: 0 })],
        [120, () => e.order({ kind: 'ability', squad: 'a0', ability: 'charge', ahead: true })],
        [160, () => e.order({ kind: 'drive', squads: ids, dx: -1, dy: 0 })],
        [220, () => e.order({ kind: 'drive', squads: ids, dx: 0, dy: 0 })],
      ];
      for (let tick = 0; tick < 600 && e.status !== 'ended'; tick++) {
        for (const [at, fn] of script) if (at === tick) fn();
        if (e.status === 'duelRequested') e.autoResolveDuel();
        else e.step(1);
      }
      return e;
    };
    const a = play('drive-det');
    const b = play('drive-det');
    expect(battleDigest(a.state)).toBe(battleDigest(b.state));
    const rep = a.replay();
    expect(rep.orders.filter((o) => o.order.kind === 'drive').length).toBeGreaterThanOrEqual(4);
    const again = replayBattle(a.state.setup, content, rep);
    expect(battleDigest(again.state)).toBe(battleDigest(a.state));
  });
});
