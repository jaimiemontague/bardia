/**
 * The player's hand: W A S D steer one ship ('helm'), Space looses its archers over the side
 * ('loose'), number keys take the helm of another ship ('takeHelm'). A loosed volley falls where it
 * was aimed and strikes only the hulls under it; the steered ship never shoots by itself; everything
 * is logged and replays exactly; and a well-judged volley beats a careless one.
 */
import { describe, expect, it } from 'vitest';
import { dsin, dcos } from '@sim/core/dmath';
import { replaySeaBattle, SeaBattleEngine } from './engine';
import type { SeaBroadside, SeaEvent, SeaShip } from './engineTypes';
import { bearingOf, wrapPi } from './geom';
import { updateTrig } from './physics';
import { makeSeaSetup, testSeaContentWith } from './testing';
import { broadsideDir } from './volley';

const content = testSeaContentWith();

function place(s: SeaShip, x: number, y: number, headingDeg: number): void {
  s.x = s.px = s.safeX = x;
  s.y = s.py = s.safeY = y;
  s.h = s.ph = s.safeH = (headingDeg * Math.PI) / 180;
  s.v = 0;
  updateTrig(s);
}

function steps(e: SeaBattleEngine, n: number, sink?: (ev: SeaEvent) => void): void {
  for (let i = 0; i < n && e.status === 'running'; i++) {
    e.step();
    for (const ev of e.drainEvents()) sink?.(ev);
  }
}

/** The player's snekkja at the centre heading north; one enemy 60 m to starboard, one 70 m astern-port. */
function range(seed = 'aim') {
  const setup = makeSeaSetup(
    {
      seed,
      arena: 'testEmpty',
      wind: { dir: 90, str: 'light' },
      attacker: { ships: [{ type: 'snekkja', crew: 50, archers: 20, boarders: 10 }, 'snekkja'], isPlayer: true, pitchT: 0 },
      defender: { ships: ['karvi', 'karvi'], role: 'patrol' },
    },
    content,
  );
  const e = new SeaBattleEngine(setup, content);
  const [me, mate, a, b] = e.w.ships as [SeaShip, SeaShip, SeaShip, SeaShip];
  place(me, 1000, 1000, 0);
  place(mate, 1000, 1150, 0);
  place(a, 1060, 1000, 0);
  place(b, 930, 1060, 180);
  return { e, me, mate, a, b };
}

describe('a volley loosed by hand', () => {
  it('falls on the ship under the marker and spares the one that is not', () => {
    const { e, me, a, b } = range();
    expect(e.helmShip).toBe(me.idx);
    e.input({ kind: 'loose', side: 'starboard', rangeM: 60 });
    const falls: Extract<SeaEvent, { kind: 'fall' }>[] = [];
    const looses: Extract<SeaEvent, { kind: 'loose' }>[] = [];
    // The loose event is pushed by the input itself.
    for (const ev of e.drainEvents()) if (ev.kind === 'loose') looses.push(ev);
    const crewA = a.archers + a.rowers + a.boarders;
    const crewB = b.archers + b.rowers + b.boarders;
    steps(e, 40, (ev) => {
      if (ev.kind === 'fall') falls.push(ev);
    });
    expect(looses).toHaveLength(1);
    expect(looses[0]!.x).toBeCloseTo(1060, 6);
    expect(looses[0]!.y).toBeCloseTo(1000, 6);
    expect(falls).toHaveLength(1);
    expect(falls[0]!.struck).toEqual([a.idx]);
    expect(falls[0]!.hits).toBeGreaterThan(1);
    expect(a.archers + a.rowers + a.boarders).toBeLessThan(crewA - 1);
    // b was only shot at by the other ship's captains, if at all: never by the hand volley.
    expect(falls[0]!.struck).not.toContain(b.idx);
    expect(crewB).toBeGreaterThan(0);
  });

  it('a volley over the empty side falls into the sea', () => {
    const { e } = range('aim-miss');
    e.input({ kind: 'loose', side: 'port', rangeM: 60 });
    const falls: Extract<SeaEvent, { kind: 'fall' }>[] = [];
    steps(e, 40, (ev) => {
      if (ev.kind === 'fall') falls.push(ev);
    });
    expect(falls).toHaveLength(1);
    expect(falls[0]!.struck).toEqual([]);
    expect(falls[0]!.hits).toBe(0);
  });

  it('takes time to fly, then the crew must nock again', () => {
    const { e, me } = range('aim-nock');
    e.input({ kind: 'loose', side: 'starboard', rangeM: 60 });
    const ev = e.drainEvents().find((x) => x.kind === 'loose') as Extract<SeaEvent, { kind: 'loose' }>;
    expect(ev.flightS).toBeCloseTo(content.tunables.aim.flightBaseS + 60 / content.tunables.aim.arrowSpeedMs, 9);
    expect(e.snapshot().shots).toHaveLength(1);
    expect(me.volleyT).toBe(content.tunables.aim.nockS);
    // A second loose while nocking is ignored (but logged).
    e.input({ kind: 'loose', side: 'starboard', rangeM: 60 });
    expect(e.drainEvents().filter((x) => x.kind === 'loose')).toHaveLength(0);
    expect(e.inputLog.filter((x) => 'input' in x && x.input.kind === 'loose')).toHaveLength(2);
    steps(e, Math.ceil(content.tunables.aim.nockS / e.w.dt) + 1);
    expect(me.volleyT).toBe(0);
    expect(e.snapshot().ships[me.idx]!.volleyIn).toBe(0);
  });

  it('a well-centred volley strikes harder than one that only clips the hull', () => {
    const hitsAt = (rangeM: number) => {
      const { e } = range('aim-centre');
      e.input({ kind: 'loose', side: 'starboard', rangeM });
      let hits = 0;
      steps(e, 40, (ev) => {
        if (ev.kind === 'fall') hits = ev.hits;
      });
      return hits;
    };
    const centred = hitsAt(60);
    const clipped = hitsAt(71);
    const wide = hitsAt(90);
    expect(centred).toBeGreaterThan(clipped * 1.5);
    expect(clipped).toBeGreaterThan(0);
    expect(wide).toBe(0);
  });

  it('fire arrows use pitch and can set the sail alight', () => {
    let lit = 0;
    for (let k = 0; k < 12; k++) {
      const { e, a } = range(`aim-fire-${k}`);
      e.w.sides[0].pitchT = 1;
      e.w.sides[0].fireArrows = true;
      e.input({ kind: 'loose', side: 'starboard', rangeM: 60 });
      const pitch = e.w.sides[0].pitchT;
      expect(pitch).toBeCloseTo(1 - content.tunables.archery.pitchPerVolleyT, 9);
      steps(e, 40);
      if (a.sailBurning) lit++;
    }
    expect(lit).toBeGreaterThan(0);
  });
});

describe('the steered ship', () => {
  it('never shoots by itself; the other ships do', () => {
    const { e, me, mate } = range('auto');
    const from: Record<number, number> = {};
    steps(e, 400, (ev) => {
      if (ev.kind === 'volley') from[ev.from] = (from[ev.from] ?? 0) + 1;
    });
    expect(from[me.idx] ?? 0).toBe(0);
    expect(from[mate.idx] ?? 0).toBeGreaterThan(0);
  });

  it('the number keys take the helm of another ship: it answers W A S D, the old one keeps station and shoots', () => {
    const { e, me, mate } = range('take');
    e.input({ kind: 'takeHelm', ship: mate.idx });
    expect(e.helmShip).toBe(mate.idx);
    expect(mate.controller).toBe('player');
    expect(me.controller).toBe('orders');
    expect(e.snapshot().ships[mate.idx]!.isHelm).toBe(true);
    expect(e.snapshot().ships[me.idx]!.isHelm).toBe(false);
    e.input({ kind: 'helm', throttle: 1, rudder: 1 });
    expect(mate.throttle).toBe(1);
    expect(me.throttle).not.toBe(1);
    const h0 = mate.h;
    const from: Record<number, number> = {};
    const count = (ev: SeaEvent) => {
      if (ev.kind === 'volley') from[ev.from] = (from[ev.from] ?? 0) + 1;
    };
    // The helm answers at once: from rest she pivots to starboard under oars within a second.
    steps(e, 5, count);
    expect(wrapPi(mate.h - h0)).toBeGreaterThan(0.1);
    expect(mate.rowing).toBe(true);
    steps(e, 295, count);
    expect(me.goal === 'follow' || me.goal === 'flee').toBe(true);
    expect(from[mate.idx] ?? 0).toBe(0);
    expect(from[me.idx] ?? 0).toBeGreaterThan(0);
    // An enemy ship can never be taken in hand.
    e.input({ kind: 'takeHelm', ship: 2 });
    expect(e.helmShip).toBe(mate.idx);
  });

  it('the helm passes to the ship carrying the player when the steered one is lost', () => {
    const { e, me, mate } = range('lost');
    e.input({ kind: 'takeHelm', ship: mate.idx });
    mate.hull = 0;
    e.step();
    expect(mate.status === 'sunk' || mate.status === 'burned').toBe(true);
    expect(e.helmShip).toBe(me.idx);
    expect(me.controller).toBe('player');
  });

  it("the captains take it all: no helm, every ship shoots for itself", () => {
    const { e, me } = range('captains');
    e.input({ kind: 'captains' });
    expect(e.helmShip).toBe(-1);
    expect(me.controller).toBe('ai');
    let mine = 0;
    steps(e, 400, (ev) => {
      if (ev.kind === 'volley' && ev.from === me.idx) mine++;
    });
    expect(mine).toBeGreaterThan(0);
  });
});

// ---- the player's hand, played by a script ------------------------------------------------------

/**
 * A test helmsman: brings the nearest enemy onto the beam at about 55 m and looses when the enemy's
 * place at the fall of shot lies on the line square to the keel (`aim` true). `aim` false looses as
 * soon as the bows are nocked, at a fixed 60 m, wherever the enemy is ('careless'). `shoot` false
 * never looses.
 */
function helmsman(e: SeaBattleEngine, mode: 'aim' | 'careless' | 'never'): void {
  const w = e.w;
  const me = w.ships[e.helmShip];
  if (!me || me.status !== 'active') return;
  let foe: SeaShip | undefined;
  let bestD = Infinity;
  for (const s of w.ships) {
    if (s.side === me.side || s.status !== 'active') continue;
    const d = Math.sqrt((s.x - me.x) ** 2 + (s.y - me.y) ** 2);
    if (d < bestD) {
      bestD = d;
      foe = s;
    }
  }
  if (!foe) return;
  // Steer: close to 55 m, then run with the enemy on the beam.
  const toFoe = bearingOf(foe.x - me.x, foe.y - me.y);
  const beamA = wrapPi(toFoe - Math.PI / 2);
  const beamB = wrapPi(toFoe + Math.PI / 2);
  const want = bestD > 75 ? toFoe : bestD < 35 ? wrapPi(toFoe + Math.PI) : Math.abs(wrapPi(beamA - me.h)) < Math.abs(wrapPi(beamB - me.h)) ? beamA : beamB;
  const rudder = Math.max(-1, Math.min(1, wrapPi(want - me.h) * 2));
  const throttle = bestD > 75 ? 1 : 0.6;
  if (Math.abs(me.rudder - rudder) > 0.2 || me.throttle !== throttle) e.input({ kind: 'helm', throttle, rudder: Math.round(rudder * 5) / 5 });
  if (mode === 'never' || me.volleyT > 0 || me.grapple >= 0) return;
  const a = w.t.aim;
  if (mode === 'careless') {
    e.input({ kind: 'loose', side: 'starboard', rangeM: 60 });
    return;
  }
  for (const side of ['port', 'starboard'] as SeaBroadside[]) {
    const [ux, uy] = broadsideDir(me, side);
    // Lead: where the enemy will be when the arrows come down, seen from where they leave.
    const guess = Math.max(a.minRangeM, Math.min(a.maxRangeM, bestD));
    const flight = a.flightBaseS + guess / a.arrowSpeedMs;
    const fx = foe.x + dsin(foe.h) * foe.v * flight - me.x;
    const fy = foe.y - dcos(foe.h) * foe.v * flight - me.y;
    const out = fx * ux + fy * uy;
    const along = fx * -uy + fy * ux;
    if (out >= a.minRangeM && out <= a.maxRangeM && Math.abs(along) < 6) {
      e.input({ kind: 'loose', side, rangeM: out });
      return;
    }
  }
}

function duel(seed: string, mode: 'aim' | 'careless' | 'never') {
  const setup = makeSeaSetup(
    {
      seed,
      arena: 'testEmpty',
      wind: { dir: 45, str: 'fresh' },
      attacker: { ships: [{ type: 'snekkja', crew: 50, archers: 24, boarders: 6 }], isPlayer: true },
      defender: { ships: [{ type: 'snekkja', crew: 50, archers: 24, boarders: 6 }] },
    },
    content,
  );
  const e = new SeaBattleEngine(setup, content);
  for (let i = 0; i < 9100 && e.status !== 'ended'; i++) {
    if (e.status === 'duelRequested') e.resolveCaptainDuel(null);
    helmsman(e, mode);
    e.step();
    e.drainEvents();
  }
  const enemy = e.w.ships[1]!;
  return { e, enemyLost: enemy.startCrew - (enemy.archers + enemy.rowers + enemy.boarders), result: e.result() };
}

describe('judging the volley', () => {
  it('a helmsman who aims beats one who looses carelessly, who beats one who never shoots', () => {
    let aim = 0;
    let careless = 0;
    let never = 0;
    for (const seed of ['j1', 'j2', 'j3']) {
      const a = duel(seed, 'aim');
      const n = duel(seed, 'never');
      aim += a.enemyLost;
      careless += duel(seed, 'careless').enemyLost;
      never += n.enemyLost;
      // Ship for ship, the player who shoots well wins; the one who never shoots loses.
      expect(a.result?.winner).toBe('attacker');
      expect(n.result?.winner).not.toBe('attacker');
    }
    expect(aim).toBeGreaterThan(careless * 1.3);
    expect(aim).toBeGreaterThan(never * 2);
  });

  it('the same hand gives the same battle, and its input log replays it', () => {
    const a = duel('same', 'aim');
    const b = duel('same', 'aim');
    expect(JSON.stringify(a.result)).toBe(JSON.stringify(b.result));
    expect(a.e.inputLog.some((x) => 'input' in x && x.input.kind === 'loose')).toBe(true);
    const replayed = replaySeaBattle(a.e.w.setup, content, a.e.inputLog);
    expect(JSON.stringify(replayed.result())).toBe(JSON.stringify(a.e.result() ?? a.e.runToEnd()));
  });
});
