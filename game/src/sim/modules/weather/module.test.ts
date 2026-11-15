import { getContent } from '@content/index';
import type { SimEvent } from '@sim/core/events';
import { Rng } from '@sim/core/rng';
import { advance } from '@sim/core/scheduler';
import type { FactionId, FleetId, GameState, ShipId } from '@sim/core/state';
import { HOURS_PER_DAY, season, toCalendar } from '@sim/core/time';
import { missingEventKeys, testEnv, testState, testWorld } from '@sim/testing';
import { describe, expect, it } from 'vitest';
import { catchChance, module as weather, stormEta, warningHorizon, weatherGeography, windAt } from './index';
import { zoneIcedOn } from './zones';
import { distributeLosses, planStormHit, rollSeverity, shiftSeverity, type ShipSnapshot } from './rules';
import { testMilitaryFakes, withFleetAt, withStorm, withWind } from './testing';

/** Timing budgets hold as written in a dedicated run (BARDIA_STRICT_PERF=1, e.g. `npm run perf`); the parallel full suite gets slack. */
const PERF_SLACK = process.env['BARDIA_STRICT_PERF'] === '1' ? 1 : 4;

const content = getContent();
const balance = content.balance;
const t = content.tunables.weather;
const wg = weatherGeography();
const MODULES = [weather, testMilitaryFakes];

function invariants(state: GameState): string[] {
  return weather.invariants?.(state) ?? [];
}

/** A sea point well inside a zone (its first seed). */
function seaPoint(zoneId: string): { x: number; y: number } {
  const z = wg.zones[wg.byId[zoneId] as number];
  const seed = z?.seeds[0];
  if (!seed) throw new Error(`no seed for ${zoneId}`);
  return { x: seed[0] + 0.5, y: seed[1] + 0.5 };
}

function eventsOf<K extends SimEvent['type']>(events: readonly SimEvent[], type: K): Extract<SimEvent, { type: K }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);
}

describe('init', () => {
  it('gives every geography sea zone wind, fog, rain and ice keyframed on the 6-hour window', () => {
    const s = testState({ modules: [weather] });
    expect(Object.keys(s.weather.zones).sort()).toEqual(wg.zones.map((z) => z.id).sort());
    for (const z of Object.values(s.weather.zones)) {
      expect(z.track).toBeDefined();
      expect(z.windDir).toBeGreaterThanOrEqual(0);
      expect(z.windDir).toBeLessThan(360);
      expect(typeof z.fog).toBe('boolean');
    }
    expect(s.weather.lastUpdateHour % balance.sailing.windUpdateHours).toBe(0);
    expect(invariants(s)).toEqual([]);
  });

  it('is deterministic: same seed, same weather; another seed differs', () => {
    const a = testState({ modules: [weather], seed: 'w1' });
    const b = testState({ modules: [weather], seed: 'w1' });
    const c = testState({ modules: [weather], seed: 'w2' });
    expect(JSON.stringify(a.weather)).toBe(JSON.stringify(b.weather));
    expect(JSON.stringify(a.weather)).not.toBe(JSON.stringify(c.weather));
  });
});

describe('a year of weather', () => {
  const env = testEnv([weather]);
  let s = testState({ modules: [weather], seed: 'year' });
  const births: Record<string, number> = { spring: 0, summer: 0, autumn: 0, winter: 0 };
  const classes: Record<string, Record<string, number>> = {};
  const iced: Record<string, boolean> = {};
  const violations: string[] = [];
  const allEvents: SimEvent[] = [];
  let prevSeq = s.weather.seq ?? 1;
  for (let day = 0; day < 360; day++) {
    const r = advance(s, HOURS_PER_DAY, env);
    s = r.state;
    allEvents.push(...r.events);
    const seq = s.weather.seq ?? 1;
    births[season(s.time.hour - 1)] = (births[season(s.time.hour - 1)] ?? 0) + (seq - prevSeq);
    prevSeq = seq;
    for (const [id, z] of Object.entries(s.weather.zones)) {
      const bag = (classes[id] ??= {});
      bag[z.windStr] = (bag[z.windStr] ?? 0) + 1;
      if (z.ice) iced[id] = true;
    }
    violations.push(...invariants(s));
  }

  it('keeps the weather state valid every day', () => {
    expect(violations).toEqual([]);
  });

  it('varies the wind: every zone sees at least three strength classes', () => {
    for (const [id, bag] of Object.entries(classes)) expect(Object.keys(bag).length, id).toBeGreaterThanOrEqual(3);
  });

  it('breeds more storms in autumn and winter than in summer (§31.3 seasons)', () => {
    expect(births['winter']).toBeGreaterThan(births['summer'] as number);
    expect(births['autumn']).toBeGreaterThan(births['summer'] as number);
    expect(Object.values(births).reduce((a, b) => a + b, 0)).toBeGreaterThan(20);
  });

  it('closes exactly the zones with ice months', () => {
    for (const zone of wg.zones) {
      const hasIce = zone.def.ice.length > 0;
      expect(iced[zone.id] === true, zone.id).toBe(hasIce);
    }
  });

  it('emits only events with locale strings', () => {
    expect(missingEventKeys(allEvents)).toEqual([]);
  });
});

describe('ice', () => {
  it('follows the geography ice periods day by day', () => {
    const zone = wg.zones.find((z) => z.def.ice.length > 0);
    if (!zone) return;
    let seen = false;
    for (let m = 0; m < 12; m++) for (let d = 1; d <= 30; d++) if (zoneIcedOn(zone, m, d)) seen = true;
    expect(seen).toBe(true);
  });
});

describe('storm warnings (§8.4)', () => {
  it('warns the player once when a cell will reach a sailing fleet within the horizon', () => {
    const w = testWorld({ modules: MODULES, factions: 2, seed: 'warn' });
    const fleetId = w.fleetIds[w.factionIds[0] as FactionId]?.[0] as FleetId;
    const p = seaPoint('whaleRoad');
    let s = withFleetAt(w.state, w.env, fleetId, p, 'sailing');
    s = withStorm(s, w.env, { id: 'storm_900', x: p.x - 40, y: p.y, radius: 20, velocity: { x: 4, y: 0 } });
    const r1 = advance(s, 1, w.env);
    const warnings = eventsOf(r1.events, 'StormWarning').filter((e) => e.stormId === 'storm_900');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.fleetId).toBe(fleetId);
    expect(warnings[0]?.etaHours).toBeGreaterThan(0);
    expect(warnings[0]?.etaHours).toBeLessThanOrEqual(warnings[0]?.horizonHours as number);
    const r2 = advance(r1.state, 1, w.env);
    expect(eventsOf(r2.events, 'StormWarning').filter((e) => e.stormId === 'storm_900')).toHaveLength(0);
    expect(missingEventKeys([...r1.events, ...r2.events])).toEqual([]);
  });

  it('does not warn about a cell beyond the horizon or a docked fleet', () => {
    const w = testWorld({ modules: MODULES, factions: 2, seed: 'warn2' });
    const fleetId = w.fleetIds[w.factionIds[0] as FactionId]?.[0] as FleetId;
    const p = seaPoint('whaleRoad');
    let s = withFleetAt(w.state, w.env, fleetId, p, 'docked');
    s = withStorm(s, w.env, { id: 'storm_901', x: p.x - 40, y: p.y, radius: 20, velocity: { x: 4, y: 0 } });
    expect(eventsOf(advance(s, 1, w.env).events, 'StormWarning').filter((e) => e.stormId === 'storm_901')).toHaveLength(0);
    let far = withFleetAt(w.state, w.env, fleetId, p, 'sailing');
    far = withStorm(far, w.env, { id: 'storm_902', x: p.x - 300, y: p.y, radius: 20, velocity: { x: 1, y: 0 }, ttl: 400 });
    expect(eventsOf(advance(far, 1, w.env).events, 'StormWarning').filter((e) => e.stormId === 'storm_902')).toHaveLength(0);
  });

  it('gives skilled seamen a longer horizon (24–48 h at Seafaring ≥ 4, else 12 h)', () => {
    const base = { chancePct: 0, damagePct: 0, warningHours: 0 };
    expect(warningHorizon(balance, { ...base, seafaring: 2 })).toBe(balance.storms.lateWarningHours);
    const lo = warningHorizon(balance, { ...base, seafaring: 4 });
    const hi = warningHorizon(balance, { ...base, seafaring: 10 });
    expect(lo).toBeGreaterThanOrEqual(balance.storms.earlyWarningHours[0]);
    expect(hi).toBeLessThanOrEqual(balance.storms.earlyWarningHours[1]);
    expect(hi).toBeGreaterThanOrEqual(lo);
    expect(warningHorizon(balance, { ...base, seafaring: 2, warningHours: 24 })).toBe(balance.storms.lateWarningHours + 24);
  });

  it('stormEta: hours until a moving cell reaches a point, null beyond the horizon', () => {
    const s = withStorm(testState({ modules: [weather] }), testEnv([weather]), { id: 'storm_5', x: 100, y: 100, radius: 10, velocity: { x: 5, y: 0 } });
    const cell = s.weather.storms.find((c) => c.id === 'storm_5');
    if (!cell) throw new Error('no cell');
    const eta = stormEta(cell, s.time.hour, 150, 100, 48, t);
    expect(eta).not.toBeNull();
    expect(eta as number).toBeGreaterThanOrEqual(7);
    expect(eta as number).toBeLessThanOrEqual(9);
    expect(stormEta(cell, s.time.hour, 150, 100, 4, t)).toBeNull();
    expect(stormEta(cell, s.time.hour, 50, 100, 48, t)).toBeNull();
  });
});

describe('storm hits (§31.3)', () => {
  function hitRun(seed: string): { events: SimEvent[]; before: GameState; after: GameState; fleetId: FleetId } {
    const w = testWorld({ modules: MODULES, factions: 2, seed });
    const fleetId = w.fleetIds[w.factionIds[0] as FactionId]?.[0] as FleetId;
    const p = seaPoint('westernOcean');
    let s = withFleetAt(w.state, w.env, fleetId, p, 'sailing');
    s = withStorm(s, w.env, { id: 'storm_950', x: p.x, y: p.y, radius: 30, intensity: 0.95 });
    const r = advance(s, 6, w.env);
    return { events: r.events, before: s, after: r.state, fleetId };
  }

  it('rolls exactly once per fleet a cell reaches (hit or weathered), never again', () => {
    for (const seed of ['h1', 'h2', 'h3', 'h4']) {
      const { events, after, fleetId } = hitRun(seed);
      const mine = [...eventsOf(events, 'StormHit'), ...eventsOf(events, 'StormWeathered')].filter((e) => e.stormId === 'storm_950' && e.fleetId === fleetId);
      expect(mine).toHaveLength(1);
      const cell = after.weather.storms.find((c) => c.id === 'storm_950');
      expect(cell?.met).toContain(fleetId);
      expect(missingEventKeys(events)).toEqual([]);
    }
  });

  it('damages ships and costs men or supplies through effects when it catches a fleet', () => {
    let checked = 0;
    for (let i = 0; i < 24 && checked < 3; i++) {
      const { events, before, after, fleetId } = hitRun(`hit${i}`);
      const hit = eventsOf(events, 'StormHit').find((e) => e.stormId === 'storm_950' && e.fleetId === fleetId);
      if (!hit) continue;
      checked++;
      const shipsBefore = before.fleets[fleetId]?.shipIds ?? [];
      const hpBefore = shipsBefore.reduce((n, id) => n + (before.ships[id]?.hullHp ?? 0) + (before.ships[id]?.sailHp ?? 0), 0);
      const shipsAfter = after.fleets[fleetId]?.shipIds ?? [];
      const hpAfter = shipsAfter.reduce((n, id) => n + (after.ships[id]?.hullHp ?? 0) + (after.ships[id]?.sailHp ?? 0), 0);
      expect(hpAfter).toBeLessThanOrEqual(hpBefore);
      if (hit.shipsDamaged > 0 || hit.shipsLost.length > 0) expect(hpAfter).toBeLessThan(hpBefore);
      expect(shipsAfter.length).toBe(shipsBefore.length - hit.shipsLost.length);
      const menBefore = Object.values(before.fleets[fleetId]?.men ?? {}).reduce((a, b) => a + b, 0);
      const menAfter = Object.values(after.fleets[fleetId]?.men ?? {}).reduce((a, b) => a + b, 0);
      expect(menBefore - menAfter).toBe(hit.menLost);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('catch chance: (1 − 0.04 × Seafaring) × omen × relic × night × traits, clamped', () => {
    const base = { seafaring: 0, chancePct: 0, drownedBell: false, nightSailing: false };
    expect(catchChance(balance, base)).toBeCloseTo(1);
    expect(catchChance(balance, { ...base, seafaring: 5 })).toBeCloseTo(0.8);
    expect(catchChance(balance, { ...base, seafaring: 5, omen: 'blessed' })).toBeCloseTo(0.56);
    expect(catchChance(balance, { ...base, seafaring: 5, drownedBell: true })).toBeCloseTo(0.4);
    expect(catchChance(balance, { ...base, seafaring: 5, chancePct: -20 })).toBeCloseTo(0.64);
    expect(catchChance(balance, { ...base, omen: 'ill', nightSailing: true })).toBe(1);
    expect(catchChance(balance, { ...base, seafaring: 40 })).toBe(0);
  });

  it('severity weights shift toward severe in winter / undermanned and stay a distribution', () => {
    const w = shiftSeverity(balance.storms.severity, 0.2);
    expect(w.minor + w.moderate + w.severe).toBeCloseTo(1);
    expect(w.severe).toBeCloseTo(balance.storms.severity.severe + 0.2);
    const big = shiftSeverity(balance.storms.severity, 0.8);
    expect(big.minor).toBeGreaterThanOrEqual(0);
    expect(big.moderate).toBeGreaterThanOrEqual(0);
    expect(big.minor + big.moderate + big.severe).toBeCloseTo(1);
    const rng = new Rng('sev');
    const counts = { minor: 0, moderate: 0, severe: 0 };
    for (let i = 0; i < 4000; i++) counts[rollSeverity(balance.storms.severity, rng)]++;
    expect(counts.minor / 4000).toBeCloseTo(0.6, 1);
    expect(counts.severe / 4000).toBeCloseTo(0.1, 1);
  });

  it('shelter takes the worst of it (§8.4: beached/docked fleets suffer 30 %)', () => {
    const ships: ShipSnapshot[] = ['shp_1', 'shp_2', 'shp_3'].map((id) => ({ id: id as ShipId, type: 'snekkja', hullHp: balance.ships['snekkja']?.hull ?? 100, sailHp: balance.ships['snekkja']?.sail ?? 100 }));
    const fleet = { id: 'flt_1' as FleetId, men: { bondi: 60, archers: 20 }, cargo: { furs: 10 }, rations: 1000, silver: 500 };
    let exposedHarm = 0;
    let shelteredHarm = 0;
    for (let i = 0; i < 50; i++) {
      for (const sheltered of [false, true]) {
        const plan = planStormHit({ fleet, ships, severity: 'severe', sheltered, damagePct: 0, balance, t }, new Rng(`plan${i}`));
        const harm = plan.menLost + plan.rationsLost + plan.shipsLost.length * 100 + plan.shipsDamaged;
        if (sheltered) shelteredHarm += harm;
        else exposedHarm += harm;
        expect(plan.menLost).toBeLessThanOrEqual(80);
        expect(plan.rationsLost).toBeLessThanOrEqual(1000);
        expect(plan.silverLost).toBeLessThanOrEqual(500);
      }
    }
    expect(shelteredHarm).toBeLessThan(exposedHarm * 0.6);
  });

  it('distributes losses over units in proportion and never below zero', () => {
    expect(distributeLosses(10, { bondi: 60, archers: 20 })).toEqual({ archers: 3, bondi: 7 });
    expect(distributeLosses(500, { bondi: 6, archers: 2 })).toEqual({ archers: 2, bondi: 6 });
    expect(distributeLosses(0, { bondi: 6 })).toEqual({});
    const out = distributeLosses(7, { a: 1, b: 1, c: 1, d: 10 });
    expect(Object.values(out).reduce((x, y) => x + y, 0)).toBe(7);
  });
});

describe('queries and conditions', () => {
  it('windAt reads the zone under a point; conditions read zone weather', () => {
    const env = testEnv([weather]);
    let s = testState({ modules: [weather] });
    const p = seaPoint('grayFirth');
    s = withWind(s, env, 'grayFirth', 225, 'gale');
    const w = windAt(s, content, p.x, p.y);
    expect(w?.zoneId).toBe('grayFirth');
    expect(w?.strength).toBe('gale');
    const fns = weather.conditionFns ?? {};
    const ctx = { state: s, env, scope: { zone: 'grayFirth' } };
    expect(fns['windStrength']?.evaluate([], ctx)).toBe('gale');
    expect(fns['windStrength']?.evaluate(['grayFirth'], { ...ctx, scope: {} })).toBe('gale');
    expect(typeof fns['foggy']?.evaluate([], ctx)).toBe('boolean');
    expect(fns['stormRisk']?.evaluate(['westernOcean'], ctx)).toBeCloseTo(balance.storms.season[season(s.time.hour)] * 1.5);
    expect(fns['stormSeason']?.evaluate([], ctx)).toBe(balance.storms.season[season(s.time.hour)] >= t.storms.stormSeasonMin);
  });

  it('stormNear is true for a fleet under a live cell or within n cells of it', () => {
    const w = testWorld({ modules: MODULES, factions: 2, seed: 'near' });
    const fleetId = w.fleetIds[w.factionIds[1] as FactionId]?.[0] as FleetId;
    const p = seaPoint('whaleRoad');
    let s = withFleetAt(w.state, w.env, fleetId, p, 'sailing');
    const fn = weather.conditionFns?.['stormNear'];
    const ctx = () => ({ state: s, env: w.env, scope: { fleet: fleetId } });
    expect(fn?.evaluate([], ctx())).toBe(false);
    s = withStorm(s, w.env, { x: p.x + 25, y: p.y, radius: 10 });
    expect(fn?.evaluate([], ctx())).toBe(false);
    expect(fn?.evaluate([20], ctx())).toBe(true);
    s = withStorm(s, w.env, { x: p.x + 2, y: p.y, radius: 10 });
    expect(fn?.evaluate([], ctx())).toBe(true);
  });
});

describe('determinism and performance', () => {
  it('two runs from one seed with fleets and storms produce identical states and events', () => {
    const run = () => {
      const w = testWorld({ modules: MODULES, factions: 4, fleetsPerFaction: 2, seed: 'det' });
      let s = w.state;
      const p = seaPoint('westernOcean');
      for (const ids of Object.values(w.fleetIds)) for (const id of ids) s = withFleetAt(s, w.env, id, p, 'sailing');
      s = withStorm(s, w.env, { x: p.x - 20, y: p.y, radius: 25, velocity: { x: 3, y: 0 } });
      const r = advance(s, 24 * 20, w.env);
      return JSON.stringify(r.state) + JSON.stringify(r.events);
    };
    expect(run()).toBe(run());
  });

  it('costs well under 0.1 ms per hour for every zone (§29.8)', () => {
    const env = testEnv([weather]);
    let s = testState({ modules: [weather], seed: 'perf' });
    s = advance(s, 24 * 30, env).state; // warm up; storms alive
    const hours = 24 * 60;
    const t0 = performance.now();
    s = advance(s, hours, env).state;
    const perHour = (performance.now() - t0) / hours;
    expect(invariants(s)).toEqual([]);
    expect(perHour).toBeLessThan(0.1 * PERF_SLACK);
  });

  it('a calendar day starts at hour 24 × n (sanity of the day loop above)', () => {
    expect(toCalendar(24).day).toBe(2);
  });
});
