import { describe, expect, it } from 'vitest';
import { busyFactor } from './physics';
import { startDouse, updateArchery, updateFire, updateSeaFire, volleyHits } from './combat';
import { SeaBattleEngine } from './engine';
import type { SeaShip } from './engineTypes';
import { DEG } from './geom';
import { updateTrig } from './physics';
import { makeSeaSetup, testSeaContentWith, type TestSeaSide } from './testing';

const content = testSeaContentWith();
const sb = content.balance.seaBattle;

function duo(attacker: TestSeaSide, defender: TestSeaSide, gap: number, seed = 'fire') {
  const e = new SeaBattleEngine(makeSeaSetup({ seed, arena: 'testEmpty', attacker, defender }, content), content);
  const a = e.w.ships[0]!;
  const d = e.w.ships.find((s) => s.side === 1)!;
  place(a, 1000, 1000, 90);
  place(d, 1000 + gap, 1000, 0);
  return { e, a, d };
}

function place(s: SeaShip, x: number, y: number, headingDeg: number): void {
  s.x = x;
  s.y = y;
  s.h = headingDeg * DEG;
  s.v = 0;
  updateTrig(s);
}

describe('archery', () => {
  it('volleys hit within 80 m and not beyond; nearer is deadlier', () => {
    const near = duo({ ships: ['snekkja'] }, { ships: ['snekkja'] }, 20);
    const far = duo({ ships: ['snekkja'] }, { ships: ['snekkja'] }, 75);
    expect(volleyHits(near.e.w, near.a, near.d, false)).toBeGreaterThan(volleyHits(far.e.w, far.a, far.d, false));
    const out = duo({ ships: ['snekkja'] }, { ships: ['snekkja'] }, sb.archeryRangeM + 10);
    out.a.volleyT = 0;
    updateArchery(out.e.w, out.a);
    expect(out.e.drainEvents().filter((ev) => ev.kind === 'volley')).toHaveLength(0);
    near.a.volleyT = 0;
    const crew = near.d.archers + near.d.rowers + near.d.boarders;
    updateArchery(near.e.w, near.a);
    expect(near.d.archers + near.d.rowers + near.d.boarders).toBeLessThan(crew);
    expect(near.a.volleyT).toBeCloseTo(content.balance.battle.ranged.volleyS, 6);
  });

  it('hold fire stops the volleys', () => {
    const { e, a } = duo({ ships: ['snekkja'] }, { ships: ['snekkja'] }, 30);
    a.holdFire = true;
    a.volleyT = 0;
    updateArchery(e.w, a);
    expect(e.drainEvents()).toHaveLength(0);
  });

  it('fire arrows use pitch and ignite a set sail about 25 % of volleys at close range', () => {
    const { e, a, d } = duo({ ships: ['snekkja'], pitchT: 1000 }, { ships: ['snekkja'] }, 10);
    const side = e.w.sides[0];
    let ignitions = 0;
    const n = 3000;
    for (let i = 0; i < n; i++) {
      a.volleyT = 0;
      a.archers = 15;
      d.sailBurning = false;
      d.sail = d.sailMax;
      d.sailSet = true;
      d.archers = 12;
      d.rowers = 24;
      d.boarders = 15;
      updateArchery(e.w, a);
      if (d.sailBurning) ignitions++;
    }
    const r = content.balance.battle.ranged;
    const acc = 1 - (r.accSlope * 10) / sb.archeryRangeM;
    expect(ignitions / n).toBeGreaterThan(sb.fireArrowSailIgnite * acc - 0.03);
    expect(ignitions / n).toBeLessThan(sb.fireArrowSailIgnite * acc + 0.03);
    expect(side.pitchUsedT).toBeCloseTo(n * content.tunables.archery.pitchPerVolleyT, 6);
  });

  it('no pitch, no fire arrows; a furled sail is harder to light', () => {
    const dry = duo({ ships: ['snekkja'], pitchT: 0 }, { ships: ['snekkja'] }, 10);
    for (let i = 0; i < 200; i++) {
      dry.a.volleyT = 0;
      dry.a.archers = 15;
      updateArchery(dry.e.w, dry.a);
    }
    expect(dry.d.sailBurning).toBe(false);
    expect(dry.e.drainEvents().every((ev) => ev.kind !== 'volley' || !ev.fire)).toBe(true);

    const furled = duo({ ships: ['snekkja'], pitchT: 1000 }, { ships: ['snekkja'] }, 10);
    let lit = 0;
    for (let i = 0; i < 3000; i++) {
      furled.a.volleyT = 0;
      furled.a.archers = 15;
      furled.d.sailBurning = false;
      furled.d.sailSet = false;
      furled.d.archers = 12;
      furled.d.rowers = 24;
      furled.d.boarders = 15;
      updateArchery(furled.e.w, furled.a);
      if (furled.d.sailBurning) lit++;
    }
    expect(lit / 3000).toBeLessThan(sb.fireArrowSailIgnite * content.tunables.fire.furledIgniteMult + 0.03);
  });
});

describe('burning and dousing', () => {
  it('a burning sail loses 3 HP/s and costs morale', () => {
    const { e, d } = duo({ ships: ['snekkja'] }, { ships: ['snekkja'] }, 200);
    d.sailBurning = true;
    const sail = d.sail;
    const morale = d.morale;
    for (let i = 0; i < 25; i++) updateFire(e.w, d); // 5 battle seconds
    expect(sail - d.sail).toBeCloseTo(sb.burningSailDps * 5, 6);
    expect(d.morale).toBeLessThan(morale);
  });

  it('a sail that burns away is destroyed and may set the hull alight', () => {
    const { e, d } = duo({ ships: ['snekkja'] }, { ships: ['snekkja'] }, 200);
    d.sailBurning = true;
    d.sail = 1;
    for (let i = 0; i < 5; i++) updateFire(e.w, d);
    expect(d.sail).toBe(0);
    expect(d.sailBurning).toBe(false);
    expect(e.drainEvents().some((ev) => ev.kind === 'sailDestroyed')).toBe(true);
  });

  it('dousing keeps half the crew busy for 10 s and succeeds about 80 % of the time', () => {
    const { e, d } = duo({ ships: ['snekkja'] }, { ships: ['snekkja'] }, 200);
    let ok = 0;
    const n = 1500;
    for (let i = 0; i < n; i++) {
      d.sailBurning = true;
      d.sail = d.sailMax;
      d.douseS = 0;
      expect(startDouse(e.w, d)).toBe(true);
      expect(busyFactor(e.w, d)).toBe(1 - sb.douse.crewShare);
      const steps = Math.round(sb.douse.seconds / e.w.dt);
      for (let k = 0; k < steps; k++) updateFire(e.w, d);
      expect(d.douseS).toBe(0);
      if (!d.sailBurning) ok++;
    }
    expect(ok / n).toBeGreaterThan(sb.douse.success - 0.04);
    expect(ok / n).toBeLessThan(sb.douse.success + 0.04);
    expect(startDouse(e.w, d)).toBe(d.sailBurning);
  });
});

describe('sea-fire siphon (§15.2)', () => {
  const saraleon = (gap: number) => duo({ ships: ['galley'], culture: 'saraleonese' }, { ships: ['snekkja'] }, gap, 'siphon');

  it('only Saraleon galleys carry it', () => {
    expect(saraleon(30).a.seaFire).toBe(true);
    expect(duo({ ships: ['galley'] }, { ships: ['snekkja'] }, 30).a.seaFire).toBe(false);
  });

  it('a 30 m cone sets the hull burning 4 HP/s for 15 s and costs 15 morale', () => {
    const { e, a, d } = saraleon(a0Gap());
    const morale = d.morale;
    updateSeaFire(e.w, a);
    expect(d.hullBurnS).toBe(sb.seaFire.seconds);
    expect(d.hullBurnDps).toBe(sb.seaFire.hullDps);
    expect(d.seaFireBurning).toBe(true);
    expect(d.morale).toBeLessThanOrEqual(morale + sb.seaFire.morale + 1e-9);
    expect(a.siphonCharges).toBe(content.tunables.fire.seaFireCharges - 1);
    const hull = d.hull;
    for (let i = 0; i < Math.round(15 / e.w.dt) + 5; i++) updateFire(e.w, d);
    expect(hull - d.hull).toBeCloseTo(sb.seaFire.hullDps * sb.seaFire.seconds, 0);
    expect(d.hullBurnS).toBe(0);
  });

  it('not out of the cone, not over a friendly hull', () => {
    const behind = saraleon(-60);
    updateSeaFire(behind.e.w, behind.a);
    expect(behind.d.hullBurnS).toBe(0);
    const far = saraleon(120);
    updateSeaFire(far.e.w, far.a);
    expect(far.d.hullBurnS).toBe(0);
    const friendly = duo({ ships: ['galley', 'snekkja'], culture: 'saraleonese' }, { ships: ['snekkja'] }, a0Gap(), 'siphon2');
    const mate = friendly.e.w.ships[1]!;
    place(mate, friendly.a.x + friendly.a.halfSeg + 12, friendly.a.y + 2, 90);
    updateSeaFire(friendly.e.w, friendly.a);
    expect(friendly.d.hullBurnS).toBe(0);
  });

  it('naphtha is harder to douse', () => {
    const { e, a, d } = saraleon(a0Gap());
    let ok = 0;
    for (let i = 0; i < 800; i++) {
      a.siphonCd = 0;
      a.siphonCharges = 3;
      d.hullBurnS = 0;
      d.seaFireBurning = false;
      updateSeaFire(e.w, a);
      d.hull = d.hullMax;
      d.sailBurning = false;
      d.douseS = 0;
      startDouse(e.w, d);
      for (let k = 0; k < Math.round(sb.douse.seconds / e.w.dt); k++) updateFire(e.w, d);
      d.hull = d.hullMax;
      d.morale = 70;
      d.archers = 12;
      d.rowers = 24;
      d.boarders = 15;
      if (d.hullBurnS <= 0) ok++;
    }
    expect(ok / 800).toBeLessThan(sb.douse.success * content.tunables.fire.seaFireDouseMult + 0.06);
  });
});

/** Centre distance putting the target's hull ~15 m off the galley's bow. */
function a0Gap(): number {
  const g = content.tunables.ships.galley;
  const s = content.tunables.ships.snekkja;
  return (g.lengthM - g.beamM) / 2 + s.beamM / 2 + 15;
}
