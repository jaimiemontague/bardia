/**
 * The sea-battle scene's orders (engine extensions): move to a point, stand off and shoot, withdraw,
 * orders for the flagship (leaving and retaking the helm), "let your captains finish it", and the
 * captain duel settled by the blades. Every one of them is logged and replays exactly.
 */
import { describe, expect, it } from 'vitest';
import type { CharId } from '@sim/core/state';
import { replaySeaBattle, SeaBattleEngine } from './engine';
import { makeSeaSetup, testSeaContent, testSeaContentWith } from './testing';

const content = testSeaContent();
const empty = testSeaContentWith();

function twoFleets(seed: string, arena = 'testEmpty') {
  return makeSeaSetup(
    {
      seed,
      arena,
      wind: { dir: 90, str: 'fresh' },
      attacker: { ships: ['drakkar', 'snekkja', 'snekkja'], isPlayer: true },
      defender: { ships: ['snekkja', 'snekkja'] },
    },
    empty,
  );
}

function steps(e: SeaBattleEngine, n: number): void {
  for (let i = 0; i < n && e.status === 'running'; i++) e.step();
}

describe('move orders', () => {
  it('sends a ship to a point, where it holds', () => {
    const e = new SeaBattleEngine(twoFleets('move-1'), empty);
    const ship = e.w.ships[1]!;
    const tx = ship.x - 150;
    const ty = ship.y + 120;
    e.input({ kind: 'order', ship: 1, order: 'move', x: tx, y: ty });
    expect(e.snapshot().ships[1]!.moveTo).toEqual({ x: tx, y: ty });
    steps(e, 900);
    const d = Math.hypot(ship.x - tx, ship.y - ty);
    expect(d).toBeLessThan(40);
    expect(ship.order.kind).toBe('hold');
    expect(e.snapshot().ships[1]!.moveTo).toBeNull();
  });

  it('a move without a point is refused', () => {
    const e = new SeaBattleEngine(twoFleets('move-2'), empty);
    e.input({ kind: 'order', ship: 1, order: 'move' });
    expect(e.w.ships[1]!.order.kind).toBe('follow');
  });

  it('the flagship leaves the helm for an order and takes it back on moveTo', () => {
    const e = new SeaBattleEngine(twoFleets('move-3'), empty);
    const flag = e.w.ships[e.playerShip]!;
    expect(flag.controller).toBe('player');
    e.input({ kind: 'order', ship: flag.idx, order: 'move', x: flag.x + 100, y: flag.y });
    expect(flag.controller).toBe('orders');
    steps(e, 10);
    expect(flag.goal).toBe('moveTo');
    e.input({ kind: 'moveTo', x: flag.x - 100, y: flag.y });
    expect(flag.controller).toBe('player');
    expect(e.snapshot().ships[flag.idx]!.moveTo).toEqual({ x: flag.moveX, y: flag.moveY });
  });
});

describe('attack styles', () => {
  it("'shoot' keeps archery range and never grapples", () => {
    const setup = makeSeaSetup(
      { seed: 'shoot', arena: 'testEmpty', attacker: { ships: ['snekkja'], isPlayer: true }, defender: { ships: ['knarr'], role: 'patrol' } },
      empty,
    );
    const e = new SeaBattleEngine(setup, empty);
    // A free-roaming escort would not do: order the flagship itself.
    e.input({ kind: 'order', ship: 0, order: 'shoot', target: 1 });
    let volleys = 0;
    for (let i = 0; i < 3000 && e.status === 'running'; i++) {
      e.step();
      for (const ev of e.drainEvents()) {
        if (ev.kind === 'grapple') expect(ev.from).not.toBe(0);
        if (ev.kind === 'volley' && ev.from === 0) volleys++;
      }
      expect(['board', 'ram', 'seaFire']).not.toContain(e.w.ships[0]!.goal);
    }
    expect(volleys).toBeGreaterThan(0);
  });

  it("'board' closes and grapples the target", () => {
    const setup = makeSeaSetup(
      { seed: 'board', arena: 'testEmpty', attacker: { ships: [{ type: 'snekkja', crew: 58, boarders: 26, archers: 6 }], isPlayer: true }, defender: { ships: [{ type: 'knarr', crew: 12 }], role: 'patrol' } },
      empty,
    );
    const e = new SeaBattleEngine(setup, empty);
    e.input({ kind: 'order', ship: 0, order: 'board', target: 1 });
    let grappled = false;
    for (let i = 0; i < 6000 && e.status === 'running' && !grappled; i++) {
      e.step();
      grappled = e.drainEvents().some((ev) => ev.kind === 'grapple' && ev.from === 0);
    }
    expect(grappled).toBe(true);
  });
});

describe('withdraw', () => {
  it('a withdrawing ship leaves the arena while the rest fight on', () => {
    const e = new SeaBattleEngine(twoFleets('withdraw'), empty);
    e.input({ kind: 'order', ship: 2, order: 'withdraw' });
    for (let i = 0; i < 9000 && e.status === 'running' && e.w.ships[2]!.status === 'active'; i++) e.step();
    expect(e.w.ships[2]!.status).toBe('fled');
    expect(e.w.sides[0].retreating).toBe(false);
  });
});

describe("let your captains finish it", () => {
  it('hands the side to the AI, ends the battle and replays exactly', () => {
    const setup = makeSeaSetup(
      {
        seed: 'captains',
        arena: 'skerries',
        playerCharId: 'chr_1' as CharId,
        attacker: { ships: ['drakkar', 'snekkja'], isPlayer: true, captainId: 'chr_1' as CharId },
        defender: { ships: ['snekkja', 'karvi'], captainId: 'chr_2' as CharId },
      },
      content,
    );
    const e = new SeaBattleEngine(setup, content);
    e.input({ kind: 'order', ship: 1, order: 'move', x: 1000, y: 1000 });
    steps(e, 100);
    e.input({ kind: 'captains' });
    expect(e.w.aiControlsPlayer).toBe(true);
    expect(e.w.ships.filter((s) => s.side === 0).every((s) => s.controller === 'ai')).toBe(true);
    // Later inputs are ignored.
    e.input({ kind: 'retreat' });
    expect(e.w.sides[0].retreating).toBe(false);
    for (let i = 0; i < 12000 && e.status !== 'ended'; i++) {
      if (e.status === 'duelRequested') e.autoResolveCaptainDuel();
      e.step();
    }
    expect(e.status).toBe('ended');
    const replayed = replaySeaBattle(setup, content, e.inputLog);
    expect(JSON.stringify(replayed.result())).toBe(JSON.stringify(e.result()));
  });
});

describe('captain duel by the blades', () => {
  it('settles a pending duel deterministically and logs it', () => {
    const player = 'chr_7' as CharId;
    const setup = makeSeaSetup(
      {
        seed: 'duel-auto',
        arena: 'testEmpty',
        playerCharId: player,
        attacker: { ships: [{ type: 'drakkar', crew: 88, boarders: 60, archers: 10 }], isPlayer: true, captainId: player },
        defender: { ships: [{ type: 'snekkja', crew: 40 }], captainId: 'chr_8' as CharId, role: 'patrol' },
      },
      empty,
    );
    const run = () => {
      const e = new SeaBattleEngine(JSON.parse(JSON.stringify(setup)), empty);
      e.input({ kind: 'order', ship: 0, order: 'board', target: 1 });
      let asked = false;
      for (let i = 0; i < 12000 && e.status !== 'ended'; i++) {
        if (e.status === 'duelRequested') {
          asked = true;
          e.autoResolveCaptainDuel();
          expect(e.status).toBe('running');
        }
        e.step();
      }
      return { e, asked };
    };
    const a = run();
    const b = run();
    expect(a.asked).toBe(true);
    expect(a.e.result()?.captainDuel?.autoResolved).toBe(true);
    expect(JSON.stringify(a.e.result())).toBe(JSON.stringify(b.e.result()));
    expect(a.e.inputLog.some((x) => 'duel' in x)).toBe(true);
    const replayed = replaySeaBattle(setup, empty, a.e.inputLog);
    expect(JSON.stringify(replayed.result())).toBe(JSON.stringify(a.e.result()));
  });

  it('does nothing when no duel is pending', () => {
    const e = new SeaBattleEngine(twoFleets('duel-none'), empty);
    e.autoResolveCaptainDuel();
    expect(e.inputLog).toEqual([]);
    expect(e.status).toBe('running');
  });
});

describe('a side is on the water before the first step', () => {
  it('the snapshot shows every ship of both sides at tick 0', () => {
    const e = new SeaBattleEngine(twoFleets('tick0', 'coastal'), content);
    const snap = e.snapshot();
    expect(snap.tick).toBe(0);
    expect(snap.ships.filter((s) => s.side === 'attacker')).toHaveLength(3);
    expect(snap.ships.filter((s) => s.side === 'defender')).toHaveLength(2);
    for (const s of snap.ships) expect(Number.isFinite(s.x) && Number.isFinite(s.y)).toBe(true);
  });
});
