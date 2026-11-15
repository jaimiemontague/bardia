import { describe, expect, it } from 'vitest';
import type { SeaBattleResult } from '@sim/core/state';
import type { SeaShipView } from '@sim/seabattle/index';
import { makeSeaSetup, testSeaContent } from '@sim/seabattle/testing';
import {
  balanceWord,
  compassPoint,
  defaultStyle,
  doingKey,
  formationTargets,
  hullDistance,
  isLandAt,
  orderForStyle,
  outcomeFor,
  shipAt,
  shipsInRect,
  strengthShare,
  summarizeSea,
  wayWord,
} from './logic';

function ship(p: Partial<SeaShipView> & { idx: number }): SeaShipView {
  return {
    shipId: `shp_${p.idx}`,
    name: `S${p.idx}`,
    side: 'attacker',
    type: 'snekkja',
    x: 0,
    y: 0,
    heading: 0,
    prevX: 0,
    prevY: 0,
    prevHeading: 0,
    speedMs: 0,
    maxSpeedMs: 3,
    lengthM: 20,
    beamM: 4,
    hullPct: 1,
    sailPct: 1,
    sailSet: true,
    propulsion: 'sail',
    rowing: false,
    sailBurning: false,
    hullBurning: false,
    dousing: false,
    grounded: false,
    grappledTo: -1,
    status: 'active',
    crew: 50,
    archers: 10,
    rowers: 25,
    boarders: 15,
    morale: 70,
    stamina: 100,
    routed: false,
    isFlagship: false,
    isPlayer: false,
    controller: 'orders',
    order: 'follow',
    orderTarget: -1,
    moveTo: null,
    goal: 'idle',
    holdFire: false,
    volleyIn: 0,
    ramReady: false,
    seaFireCharges: 0,
    ...p,
  } as SeaShipView;
}

describe('picking ships', () => {
  const a = ship({ idx: 0, x: 100, y: 100, heading: 0 });
  const b = ship({ idx: 1, x: 100, y: 140, heading: 90, side: 'defender' });
  const snap = { ships: [a, b] };

  it('measures the distance to a hull capsule along its heading', () => {
    expect(hullDistance(a, 100, 92)).toBe(0); // on the keel, toward the bow (north)
    expect(hullDistance(a, 100, 125)).toBeCloseTo(15, 5); // 10 m past the stern tip
    expect(hullDistance(a, 110, 100)).toBeCloseTo(8, 5); // abeam: 10 m − half the beam
  });

  it('finds the ship under the pointer, within the tolerance, with inflation', () => {
    expect(shipAt(snap, 101, 101, 2)).toBe(0);
    expect(shipAt(snap, 100, 140, 2)).toBe(1);
    expect(shipAt(snap, 300, 300, 5)).toBe(-1);
    // Drawn twice as large, a click 4.5 m abeam still hits.
    expect(shipAt(snap, 104.5, 100, 1, 2)).toBe(0);
    expect(shipAt(snap, 104.5, 100, 1, 1)).toBe(-1);
  });

  it('ignores ships that left the water', () => {
    expect(shipAt({ ships: [{ ...a, status: 'fled' }] }, 100, 100, 5)).toBe(-1);
    expect(shipAt({ ships: [{ ...a, status: 'sunk' }] }, 100, 100, 5)).toBe(-1);
  });

  it('box-selects own active ships only', () => {
    const c = ship({ idx: 2, x: 120, y: 110, status: 'captured' });
    expect(shipsInRect({ ships: [a, b, c] }, 'attacker', 50, 50, 150, 150)).toEqual([0]);
  });

  it('knows land and rock cells from the arena grid', () => {
    const terrain = new Uint8Array([0, 1, 2, 3]);
    const arena = { sizeM: 20, cellM: 10, w: 2, h: 2, terrain, template: 'x' };
    expect(isLandAt(arena, 5, 5)).toBe(false);
    expect(isLandAt(arena, 15, 5)).toBe(false);
    expect(isLandAt(arena, 5, 15)).toBe(true);
    expect(isLandAt(arena, 15, 15)).toBe(true);
    expect(isLandAt(arena, -5, 5)).toBe(false);
  });
});

describe('formation targets', () => {
  it('sends one ship exactly where it was sent', () => {
    expect(formationTargets([{ idx: 3, x: 0, y: 0 }], 50, 60)).toEqual([{ idx: 3, x: 50, y: 60 }]);
  });

  it('keeps a group in formation, squeezed into the spread but never closer than the gap', () => {
    const out = formationTargets(
      [
        { idx: 0, x: 0, y: 0 },
        { idx: 1, x: 600, y: 0 },
      ],
      1000,
      1000,
      45,
      160,
    );
    expect(out[0]!.x).toBeCloseTo(840, 5);
    expect(out[1]!.x).toBeCloseTo(1160, 5);
    const tight = formationTargets(
      [
        { idx: 0, x: 0, y: 0 },
        { idx: 1, x: 10, y: 0 },
      ],
      0,
      0,
      45,
    );
    expect(Math.abs(tight[1]!.x - tight[0]!.x)).toBeCloseTo(45, 5);
  });

  it('fans out ships stacked on one point', () => {
    const out = formationTargets(
      [
        { idx: 0, x: 5, y: 5 },
        { idx: 1, x: 5, y: 5 },
        { idx: 2, x: 5, y: 5 },
      ],
      100,
      100,
      40,
    );
    expect(out.map((p) => p.x)).toEqual([60, 100, 140]);
  });
});

describe('attack styles and orders', () => {
  it('maps styles to engine orders', () => {
    expect(orderForStyle('board', false)).toBe('board');
    expect(orderForStyle('shoot', false)).toBe('shoot');
    expect(orderForStyle('ram', true)).toBe('attack');
    expect(orderForStyle('ram', false)).toBe('board');
  });

  it('picks a starting style from the ship and its crew', () => {
    expect(defaultStyle(ship({ idx: 0, type: 'galley' }), ['galley'])).toBe('ram');
    expect(defaultStyle(ship({ idx: 0, boarders: 20, archers: 10 }), ['galley'])).toBe('board');
    expect(defaultStyle(ship({ idx: 0, boarders: 0, archers: 4 }), ['galley'])).toBe('shoot');
  });

  it('describes what a ship is doing', () => {
    expect(doingKey(ship({ idx: 0, goal: 'range' }), false)).toBe('seaView.doing.shoot');
    expect(doingKey(ship({ idx: 0, goal: 'board' }), true)).toBe('seaView.doing.boarding');
    expect(doingKey(ship({ idx: 0, goal: 'idle', moveTo: { x: 1, y: 2 } }), false)).toBe('seaView.doing.sail');
    expect(doingKey(ship({ idx: 0, status: 'struck' }), false)).toBe('seaView.doing.status.struck');
    // The ship at the player's helm, and a fresh order shown before the captain has planned it.
    expect(doingKey(ship({ idx: 0, isHelm: true, controller: 'player' }), false)).toBe('seaView.doing.helm');
    expect(doingKey(ship({ idx: 0, order: 'board', goal: 'follow' }), false)).toBe('seaView.doing.board');
    expect(doingKey(ship({ idx: 0, order: 'shoot', goal: 'idle' }), false)).toBe('seaView.doing.shoot');
  });

  it('puts the way on a ship in a word', () => {
    expect(wayWord(-0.5, 3)).toBe('astern');
    expect(wayWord(0.1, 3)).toBe('stopped');
    expect(wayWord(0.8, 3)).toBe('slow');
    expect(wayWord(1.8, 3)).toBe('half');
    expect(wayWord(2.9, 3)).toBe('full');
  });
});

describe('who is winning', () => {
  it('weighs crews by hull and spirit', () => {
    const own = ship({ idx: 0, crew: 60 });
    const foe = ship({ idx: 1, crew: 60, side: 'defender', hullPct: 0.2, routed: true });
    const share = strengthShare({ ships: [own, foe] }, 'attacker');
    expect(share).toBeGreaterThan(0.72);
    expect(balanceWord(share)).toBe('winning');
    expect(balanceWord(strengthShare({ ships: [own, foe] }, 'defender'))).toBe('losing');
    expect(balanceWord(0.5)).toBe('even');
    expect(strengthShare({ ships: [] }, 'attacker')).toBe(0.5);
  });

  it('names the wind by the compass', () => {
    expect(compassPoint(0)).toBe('n');
    expect(compassPoint(95)).toBe('e');
    expect(compassPoint(225)).toBe('sw');
    expect(compassPoint(-30)).toBe('nw');
  });
});

describe('the summary', () => {
  const setup = makeSeaSetup(
    {
      attacker: { ships: ['drakkar', 'snekkja'], isPlayer: true },
      defender: { ships: ['knarr', 'snekkja'], role: 'merchant' },
    },
    testSeaContent(),
  );
  setup.defender.silver = 200;
  setup.defender.cargo = { cloth: 10 };
  setup.defender.ships[0]!.cargoShare = 0.75;
  setup.defender.ships[1]!.cargoShare = 0.25;
  const result: SeaBattleResult = {
    winner: 'attacker',
    retreated: false,
    shipsSunk: ['shp_d1', 'shp_a1'],
    shipsCaptured: ['shp_d0'],
    crewLost: [
      { side: 'attacker', killed: 12, wounded: 5, captured: 0 },
      { side: 'defender', killed: 20, wounded: 0, captured: 8 },
    ],
    durationS: 301.6,
    xp: {},
    autoResolved: false,
    capturedBy: { shp_d0: 'attacker' },
    ships: [],
  };

  it('counts sunk, taken and lost ships, men and plunder from the player side', () => {
    const s = summarizeSea(setup, result, 'attacker');
    expect(s.outcome).toBe('victory');
    expect(s.enemySunk).toBe(1);
    expect(s.enemyTaken).toBe(1);
    expect(s.ownLost).toBe(1);
    expect(s.own.killed).toBe(12);
    expect(s.enemy.captured).toBe(8);
    expect(s.plunderSilver).toBe(150);
    expect(s.plunderGoods).toEqual([{ good: 'cloth', tons: 7.5 }]);
    expect(s.durationS).toBe(302);
    expect(s.own.fates.map((f) => f.fate)).toEqual(['fine', 'sunk']);
    expect(s.enemy.fates.map((f) => f.fate)).toEqual(['taken', 'sunk']);
  });

  it('reads the same battle from the other side', () => {
    const s = summarizeSea(setup, result, 'defender');
    expect(s.outcome).toBe('defeat');
    expect(s.enemyTaken).toBe(0);
    expect(s.ownLost).toBe(2);
    expect(s.plunderSilver).toBe(0);
  });

  it('calls a broken-off fight an escape', () => {
    expect(outcomeFor({ winner: 'defender', retreated: true }, 'attacker')).toBe('escaped');
    expect(outcomeFor({ winner: 'none', retreated: false }, 'attacker')).toBe('draw');
  });
});
