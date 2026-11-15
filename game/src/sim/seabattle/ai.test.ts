import { describe, expect, it } from 'vitest';
import { validateSeaResult } from './apply';
import { SeaBattleEngine } from './engine';
import { crewOf } from './physics';
import { makeSeaSetup, testSeaContentWith, type TestSeaSide } from './testing';

const content = testSeaContentWith();

function battle(attacker: TestSeaSide, defender: TestSeaSide, seed: string, arena = 'coastal', opts = { aiControlsPlayer: true }) {
  const setup = makeSeaSetup({ seed, arena, attacker, defender, wind: { dir: 70, str: 'fresh' } }, content);
  return { setup, e: new SeaBattleEngine(setup, content, opts) };
}

function steps(e: SeaBattleEngine, n: number): void {
  for (let i = 0; i < n && e.status === 'running'; i++) e.step();
}

describe('AI battles terminate with a valid result', () => {
  const cases: [string, TestSeaSide, TestSeaSide, string][] = [
    ['equal', { ships: ['snekkja', 'snekkja'] }, { ships: ['snekkja', 'snekkja'] }, 'openSea'],
    ['galley', { ships: ['snekkja', 'snekkja', 'karvi'] }, { ships: ['galley'], culture: 'saraleonese' }, 'strait'],
    ['skerries', { ships: ['drakkar', 'karvi'] }, { ships: ['snekkja', 'snekkja'] }, 'skerries'],
    ['river', { ships: ['karvi', 'karvi'] }, { ships: ['riverboat', 'riverboat', 'riverboat'] }, 'river'],
  ];
  for (const [name, a, d, arena] of cases) {
    it(name, () => {
      for (const seed of ['t1', 't2']) {
        const { setup, e } = battle(a, d, `${name}-${seed}`, arena);
        const result = e.runToEnd();
        expect(e.status).toBe('ended');
        expect(result.durationS).toBeLessThanOrEqual(content.tunables.battle.maxBattleS + 1);
        expect(validateSeaResult(setup, result)).toEqual([]);
        for (const s of e.ships) {
          expect(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.v)).toBe(true);
          expect(crewOf(s)).toBeGreaterThanOrEqual(0);
          expect(s.killed + s.wounded + s.captured + s.rescued + crewOf(s)).toBeLessThanOrEqual(s.startCrew + 1e-6);
        }
        // Ships keep off the rocks most of the time.
        const groundings = e.drainEvents().filter((ev) => ev.kind === 'grounded').length;
        expect(groundings).toBeLessThan(6 * e.ships.length);
      }
    });
  }
});

describe('§15.3 behaviours', () => {
  it('merchants flee and strike when run down by faster raiders', () => {
    let captured = 0;
    for (const seed of ['m1', 'm2', 'm3']) {
      const { e } = battle({ ships: ['drakkar', 'snekkja', 'snekkja'] }, { ships: ['knarr', 'knarr'], role: 'merchant' }, seed, 'openSea');
      steps(e, 2);
      expect(e.w.sides[1].retreating).toBe(true);
      const r = e.runToEnd();
      expect(r.winner).toBe('attacker');
      captured += r.shipsCaptured.length;
    }
    expect(captured).toBeGreaterThanOrEqual(4);
  });

  it('a fleet outnumbered 2:1 runs at once; a patrol stands', () => {
    const big = battle({ ships: ['snekkja', 'snekkja', 'snekkja', 'snekkja', 'snekkja'] }, { ships: ['karvi'] }, 'out');
    steps(big.e, 5);
    expect(big.e.w.sides[1].retreating).toBe(true);
    expect(big.e.w.ships.find((s) => s.side === 1)!.goal).toBe('flee');
    const patrol = battle({ ships: ['snekkja', 'snekkja', 'snekkja', 'snekkja', 'snekkja'] }, { ships: ['karvi'], role: 'patrol' }, 'out');
    steps(patrol.e, 5);
    expect(patrol.e.w.sides[1].retreating).toBe(false);
  });

  it('a patrol retreats after losing half its crew', () => {
    const { e } = battle({ ships: ['snekkja', 'snekkja'] }, { ships: ['snekkja', 'snekkja'], role: 'patrol' }, 'p50');
    for (const s of e.w.ships) if (s.side === 1) {
      s.rowers = 0;
      s.boarders = 0;
      s.archers = s.startCrew * 0.45;
    }
    steps(e, 5);
    expect(e.w.sides[1].retreating).toBe(true);
  });

  it('a badly holed ship runs (below 30 % hull)', () => {
    const { e } = battle({ ships: ['snekkja', 'snekkja'] }, { ships: ['snekkja', 'snekkja'] }, 'hull');
    const s = e.w.ships[3]!;
    s.hull = s.hullMax * 0.2;
    steps(e, 12);
    expect(s.goal).toBe('flee');
    expect(e.w.ships[2]!.goal).not.toBe('flee');
  });

  it('boards when it has the crew advantage, keeps range otherwise', () => {
    const { e } = battle({ ships: [{ type: 'drakkar', crew: 88, boarders: 50, archers: 15 }] }, { ships: [{ type: 'karvi', crew: 20 }] }, 'adv');
    steps(e, 12);
    expect(e.w.ships[0]!.goal).toBe('board');
    expect(['range', 'flee']).toContain(e.w.ships[1]!.goal);
  });

  it('a galley rams a ship that cannot get away', () => {
    const { e } = battle({ ships: ['snekkja'], isPlayer: true }, { ships: ['galley'] }, 'ram', 'testEmpty', { aiControlsPlayer: false });
    let rammed = false;
    for (let i = 0; i < 3000 && e.status === 'running' && !rammed; i++) {
      e.step();
      rammed = e.drainEvents().some((ev) => ev.kind === 'ram');
    }
    expect(rammed).toBe(true);
  });
});

describe('fleet orders and the flagship helm', () => {
  function fleet(seed = 'orders') {
    const setup = makeSeaSetup({ seed, arena: 'testEmpty', wind: { dir: 0, str: 'fresh' }, attacker: { ships: ['snekkja', 'snekkja', 'snekkja'], isPlayer: true }, defender: { ships: ['karvi'] } }, content);
    return new SeaBattleEngine(setup, content);
  }

  it('the player steers the flagship; others follow in station', () => {
    const e = fleet();
    const flag = e.w.ships[0]!;
    expect(e.playerShip).toBe(0);
    expect(flag.controller).toBe('player');
    e.input({ kind: 'helm', throttle: 1, rudder: 0 });
    e.input({ kind: 'holdFire', on: true });
    steps(e, 600);
    expect(flag.v).toBeGreaterThan(1);
    for (const s of e.w.ships.slice(1, 3)) {
      expect(s.goal).toBe('follow');
      expect(Math.hypot(s.x - flag.x, s.y - flag.y)).toBeLessThan(220);
    }
  });

  it('Hold stops a ship; Board target sends it alongside; Retreat sends everyone for the edge', () => {
    const e = fleet();
    e.input({ kind: 'order', ship: 1, order: 'hold' });
    e.input({ kind: 'order', ship: 2, order: 'board', target: 3 });
    steps(e, 100);
    expect(e.w.ships[1]!.goal).toBe('hold');
    expect(Math.abs(e.w.ships[1]!.v)).toBeLessThan(0.3);
    expect(['board', 'grappled', 'capture']).toContain(e.w.ships[2]!.goal);
    e.input({ kind: 'retreat' });
    steps(e, 5);
    expect(e.w.sides[0].retreating).toBe(true);
    expect(e.w.ships[1]!.goal).toBe('flee');
  });

  it('click-to-move drives the flagship to the point and stops it', () => {
    const e = fleet('move');
    const flag = e.w.ships[0]!;
    const tx = flag.x + 150;
    const ty = flag.y;
    e.input({ kind: 'moveTo', x: tx, y: ty });
    steps(e, 900);
    expect(Math.hypot(flag.x - tx, flag.y - ty)).toBeLessThan(40);
    expect(flag.hasMove).toBe(false);
  });

  it('ignores inputs when there is no player side', () => {
    const { e } = battle({ ships: ['snekkja'] }, { ships: ['snekkja'] }, 'none');
    e.input({ kind: 'retreat' });
    expect(e.w.sides[0].retreating).toBe(false);
    expect(e.inputLog).toHaveLength(0);
  });
});
