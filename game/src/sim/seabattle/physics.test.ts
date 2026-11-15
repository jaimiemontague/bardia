import { describe, expect, it } from 'vitest';
import type { WindStrength } from '@sim/core/state';
import { TERRAIN, terrainAt } from './arena';
import { SeaBattleEngine } from './engine';
import type { SeaShip } from './engineTypes';
import { DEG } from './geom';
import {
  benchFactor,
  crewSailFactor,
  hullSpeedFactor,
  integrateShip,
  offWindDeg,
  pointOfSail,
  ramDamage,
  resolveCollisions,
  rowSpeed,
  sailHpFactor,
  updateTrig,
  windFactor,
} from './physics';
import { makeSeaSetup, testSeaContentWith } from './testing';

const content = testSeaContentWith();
const b = content.balance;
const knot = content.tunables.physics.knotMs;

/** A battle in an empty arena; the player's flagship (index 0) is driven by the test. */
function lab(type: 'snekkja' | 'drakkar' | 'knarr' | 'galley' | 'karvi' = 'snekkja', windDir = 0, str: WindStrength = 'fresh', crew?: number) {
  const setup = makeSeaSetup({
    seed: 'physics',
    arena: 'testEmpty',
    wind: { dir: windDir, str },
    attacker: { ships: [crew === undefined ? type : { type, crew }], isPlayer: true },
    defender: { ships: ['karvi'] },
  }, content);
  const e = new SeaBattleEngine(setup, content);
  return { e, s: e.w.ships[0]! };
}

/** Integrates one ship only, pinned to the arena centre (no edges), for `seconds`. */
function drive(e: SeaBattleEngine, s: SeaShip, seconds: number): void {
  const steps = Math.round(seconds / e.w.dt);
  for (let i = 0; i < steps; i++) {
    integrateShip(e.w, s);
    s.x = 1000;
    s.y = 1000;
    s.safeX = 1000;
    s.safeY = 1000;
  }
}

describe('wind polar (§31.2)', () => {
  it('maps the off-the-wind angle to the point-of-sail bands', () => {
    const bands = b.sailing.pointOfSailDeg;
    expect(pointOfSail(0, bands)).toBe('inIrons');
    expect(pointOfSail(39, bands)).toBe('inIrons');
    expect(pointOfSail(45, bands)).toBe('closeHauled');
    expect(pointOfSail(60, bands)).toBe('closeHauled');
    expect(pointOfSail(90, bands)).toBe('beamReach');
    expect(pointOfSail(130, bands)).toBe('broadReach');
    expect(pointOfSail(151, bands)).toBe('running');
    expect(pointOfSail(180, bands)).toBe('running');
    expect(offWindDeg(350 * DEG, 10 * DEG)).toBeCloseTo(20, 9);
    expect(offWindDeg(190 * DEG, 10 * DEG)).toBeCloseTo(180, 9);
  });

  it('reproduces every cell of the §31.2 wind-factor table', () => {
    const headings = { running: 180, broadReach: 130, beamReach: 90, closeHauled: 50, inIrons: 10 } as const;
    for (const [pos, deg] of Object.entries(headings)) {
      for (const str of ['calm', 'light', 'fresh', 'strong', 'gale'] as const) {
        expect(windFactor(b, deg * DEG, 0, str)).toBe(b.sailing.windFactor[pos as keyof typeof headings][str]);
      }
    }
    expect(windFactor(b, 180 * DEG, 0, 'fresh')).toBe(1);
    expect(windFactor(b, 130 * DEG, 0, 'strong')).toBe(1.25);
    expect(windFactor(b, 50 * DEG, 0, 'light')).toBe(0.3);
  });

  it('a ship under sail settles at sailKn × windFactor on every point of sail', () => {
    for (const [deg, pos] of [
      [180, 'running'],
      [130, 'broadReach'],
      [90, 'beamReach'],
      [55, 'closeHauled'],
    ] as const) {
      const { e, s } = lab('snekkja', 0, 'fresh');
      s.h = deg * DEG;
      updateTrig(s);
      s.propulsion = 'sail';
      s.throttle = 1;
      drive(e, s, 120);
      const expected = b.ships.snekkja.sailKn * knot * b.sailing.windFactor[pos].fresh;
      if (expected >= rowSpeed(e.w, s) * b.sailing.autoRowRatio) {
        expect(s.rowing).toBe(false);
        expect(s.v).toBeCloseTo(expected, 2);
      } else {
        // Close-hauled in a fresh wind the snekkja rows instead (§31.2 auto-row).
        expect(s.rowing).toBe(true);
      }
    }
  });

  it('in irons the sail gives nothing and the ship rows automatically', () => {
    const { e, s } = lab('snekkja', 0, 'strong');
    s.h = 5 * DEG;
    updateTrig(s);
    s.propulsion = 'sail';
    s.throttle = 1;
    drive(e, s, 60);
    expect(s.rowing).toBe(true);
    expect(s.sailSet).toBe(true);
    expect(s.v).toBeGreaterThan(1.5);
    expect(s.v).toBeCloseTo(rowSpeed(e.w, s), 2);
  });

  it('speed factors follow §31.2 (crew, hull) and the sail damage curve', () => {
    expect(crewSailFactor(b, 60, 60)).toBe(1);
    expect(crewSailFactor(b, 36, 60)).toBe(1);
    expect(crewSailFactor(b, 30, 60)).toBeCloseTo(0.7 + 0.5 * 0.5, 9);
    expect(hullSpeedFactor(b, 80, 80)).toBe(1);
    expect(hullSpeedFactor(b, 40, 80)).toBeCloseTo(0.85, 9);
    expect(sailHpFactor(content.tunables, 0, 40)).toBe(0);
    expect(sailHpFactor(content.tunables, 40, 40)).toBe(1);
    expect(sailHpFactor(content.tunables, 20, 40)).toBeGreaterThan(0.5);
  });
});

describe('rowing and stamina', () => {
  it('rows at rowKn with a full bench and slower with fewer rowers', () => {
    const t = content.tunables;
    expect(benchFactor(t, 30, 60)).toBe(1);
    expect(benchFactor(t, 15, 60)).toBeCloseTo(Math.sqrt(0.5), 9);
    expect(benchFactor(t, 0, 60)).toBe(0);
    const { e, s } = lab('galley', 0, 'calm');
    s.rowers = 100;
    s.archers = 20;
    s.boarders = 16;
    s.propulsion = 'oars';
    s.throttle = 1;
    drive(e, s, 40);
    expect(s.rowing).toBe(true);
    expect(s.v).toBeCloseTo(b.ships.galley.rowKn * knot, 1);
  });

  it('hard rowing drains stamina and slows the stroke; rest under sail restores it', () => {
    const { e, s } = lab('snekkja', 0, 'fresh');
    s.h = 180 * DEG;
    updateTrig(s);
    s.propulsion = 'oars';
    s.throttle = 1;
    drive(e, s, 30);
    const fresh = s.v;
    const before = s.stamina;
    expect(before).toBeLessThan(100);
    drive(e, s, 400);
    expect(s.stamina).toBeLessThan(b.sailing.lowStamina);
    expect(s.v).toBeCloseTo(fresh * b.sailing.lowStaminaRowMult, 1);
    const tired = s.stamina;
    s.propulsion = 'sail';
    drive(e, s, 60);
    expect(s.rowing).toBe(false);
    expect(s.stamina).toBeGreaterThan(tired + 20);
  });

  it('easy rowing costs less stamina per metre than a full stroke', () => {
    const a = lab('snekkja', 0, 'calm');
    a.s.propulsion = 'oars';
    a.s.throttle = 1;
    drive(a.e, a.s, 100);
    const fullCost = (100 - a.s.stamina) / a.s.v;
    const c = lab('snekkja', 0, 'calm');
    c.s.propulsion = 'oars';
    c.s.throttle = 0.6;
    drive(c.e, c.s, 100);
    const easyCost = (100 - c.s.stamina) / c.s.v;
    expect(easyCost).toBeLessThan(fullCost);
  });

  it('oars turn the hull faster than a slow ship under sail', () => {
    const turn = (prop: 'oars' | 'sail') => {
      const { e, s } = lab('snekkja', 0, 'fresh');
      s.h = 90 * DEG;
      updateTrig(s);
      s.propulsion = prop;
      s.v = 0.5;
      s.throttle = 0;
      s.rudder = 1;
      drive(e, s, 2);
      return s.h / DEG - 90;
    };
    expect(turn('oars')).toBeGreaterThan(turn('sail') * 1.5);
  });
});

describe('terrain and collisions', () => {
  it('a deep-draft hull grounds on shallows, takes damage, then backs off', () => {
    const { e, s } = lab('drakkar', 0, 'fresh');
    const a = e.w.arena;
    // A shallow bank 40 m north of the ship.
    for (let cy = 0; cy < a.h; cy++) for (let cx = 0; cx < a.w; cx++) if (cy * a.cellM < 960 && cy * a.cellM > 900) a.terrain[cy * a.w + cx] = TERRAIN.shallow;
    s.x = 1000;
    s.y = 1000;
    s.safeX = 1000;
    s.safeY = 1000;
    s.h = 0;
    updateTrig(s);
    s.propulsion = 'oars';
    s.throttle = 1;
    s.v = 2;
    const hull = s.hull;
    let grounded = false;
    for (let i = 0; i < 400 && !grounded; i++) {
      integrateShip(e.w, s);
      grounded = s.groundedS > 0;
    }
    expect(grounded).toBe(true);
    expect(s.hull).toBeLessThan(hull);
    expect(e.drainEvents().some((ev) => ev.kind === 'grounded')).toBe(true);
    for (let i = 0; i < 200 && s.groundedS > 0; i++) integrateShip(e.w, s);
    expect(s.groundedS).toBe(0);
    expect(s.backOffS).toBeGreaterThan(0);
  });

  /** Paints land over [x0, x1] × [y0, y1] metres. */
  function land(e: SeaBattleEngine, x0: number, x1: number, y0: number, y1: number): void {
    const a = e.w.arena;
    for (let cy = 0; cy < a.h; cy++) {
      for (let cx = 0; cx < a.w; cx++) {
        const x = (cx + 0.5) * a.cellM;
        const y = (cy + 0.5) * a.cellM;
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) a.terrain[cy * a.w + cx] = TERRAIN.land;
      }
    }
  }

  function place(s: SeaShip, x: number, y: number, headingDeg: number): void {
    s.x = x;
    s.y = y;
    s.safeX = x;
    s.safeY = y;
    s.h = headingDeg * DEG;
    s.safeH = s.h;
    s.v = 0;
    updateTrig(s);
  }

  it('a hull pivoting onto land is stopped and fends off without running aground', () => {
    const { e, s } = lab('snekkja', 0, 'calm');
    land(e, 1004, 1100, 940, 1060); // land from x = 1000 m
    place(s, 995, 1000, 0); // the bow reaches the land once it swings 30 degrees to the east
    s.propulsion = 'oars';
    s.throttle = 0;
    s.rudder = 1;
    let backedOff = false;
    for (let i = 0; i < 300; i++) {
      integrateShip(e.w, s);
      backedOff ||= s.backOffS > 0 && s.backOffDir < 0;
      expect(s.groundedS).toBe(0);
      expect(terrainAt(e.w.arena, s.x + s.sinH * 10, s.y - s.cosH * 10)).not.toBe(TERRAIN.land);
      if (s.backOffS > 0) s.backOffS = Math.max(0, s.backOffS - e.w.dt); // the engine step's timer
    }
    expect(backedOff).toBe(true);
    expect(e.drainEvents().filter((ev) => ev.kind === 'grounded')).toEqual([]);
  });

  it('a hull that ran aground refloats on its safe heading and does not strand itself again', () => {
    const { e, s } = lab('snekkja', 0, 'calm');
    land(e, 900, 1100, 900, 960);
    place(s, 1000, 1010, 0);
    s.propulsion = 'oars';
    s.v = 3;
    s.throttle = 1;
    s.rudder = 0;
    let grounded = 0;
    for (let i = 0; i < 200 && grounded === 0; i++) {
      integrateShip(e.w, s);
      for (const ev of e.drainEvents()) if (ev.kind === 'grounded') grounded++;
    }
    expect(grounded).toBe(1);
    expect(s.hull).toBeLessThan(s.hullMax);
    expect(s.h).toBe(s.safeH);
    // Stranded, then refloated: the helm stops but keeps swinging the bow about against the shore
    // (the old engine put the hull back on the bank at once and stranded it again every groundedS).
    s.throttle = 0;
    for (let i = 0; i < 1500; i++) {
      s.rudder = i % 200 < 100 ? 1 : -1;
      integrateShip(e.w, s);
      if (s.backOffS > 0) s.backOffS = Math.max(0, s.backOffS - e.w.dt);
      for (const ev of e.drainEvents()) if (ev.kind === 'grounded') grounded++;
    }
    expect(grounded).toBe(1);
    expect(s.groundedS).toBe(0);
  });

  it('a shallow-draft hull crosses shallows slowly instead of grounding', () => {
    const { e, s } = lab('snekkja', 0, 'calm');
    const a = e.w.arena;
    a.terrain.fill(TERRAIN.shallow);
    s.propulsion = 'oars';
    s.throttle = 1;
    drive(e, s, 30);
    expect(s.groundedS).toBe(0);
    expect(s.v).toBeLessThan(rowSpeed(e.w, s) * content.tunables.physics.shallowSpeedMult + 1e-6);
  });

  it('colliding hulls are pushed apart and damaged above the minimum speed', () => {
    const { e } = lab('snekkja', 0, 'calm');
    const a = e.w.ships[0]!;
    const d = e.w.ships[1]!;
    a.x = 1000;
    a.y = 1000;
    a.h = 90 * DEG;
    a.v = 3;
    d.x = 1003;
    d.y = 1000;
    d.h = 270 * DEG;
    d.v = 3;
    updateTrig(a);
    updateTrig(d);
    const ha = a.hull;
    const hd = d.hull;
    resolveCollisions(e.w, () => {
      throw new Error('no ram expected');
    });
    expect(a.hull).toBeLessThan(ha);
    expect(d.hull).toBeLessThan(hd);
    expect(a.v).toBeLessThan(3);
    // Separated along the line between them.
    expect(Math.abs(a.x - d.x)).toBeGreaterThan(3);
  });

  it('a ready galley ramming bow-first deals 40–80 hull (§15.2)', () => {
    const setup = makeSeaSetup({ seed: 'ram', arena: 'testEmpty', attacker: { ships: ['snekkja'], isPlayer: true }, defender: { ships: ['galley'] } }, content);
    const e = new SeaBattleEngine(setup, content);
    const target = e.w.ships[0]!;
    const galley = e.w.ships[1]!;
    target.x = 1000;
    target.y = 1000;
    target.h = 0;
    target.v = 0;
    galley.x = 1000 - galley.halfSeg - galley.radius - target.radius + 0.6;
    galley.y = 1000;
    galley.h = 90 * DEG;
    galley.v = 3;
    updateTrig(target);
    updateTrig(galley);
    let rammed = 0;
    resolveCollisions(e.w, (r, t, closing) => {
      expect(r).toBe(galley);
      expect(t).toBe(target);
      rammed = ramDamage(e.w, closing);
    });
    expect(rammed).toBeGreaterThanOrEqual(40);
    expect(rammed).toBeLessThanOrEqual(80);
    expect(ramDamage(e.w, 0)).toBe(40);
    expect(ramDamage(e.w, 10)).toBe(80);
  });
});
