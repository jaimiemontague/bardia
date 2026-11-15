/**
 * Every dead end of an expedition ends at the hall (lost.ts): no ship afloat (at sea, with a party ashore,
 * taken in a fight), no crew (killed, starved), no one to lead (dead, taken), the ruler dying at sea, no sea
 * road home, ice at home, a vanished fleet record. Then determinism and a fuzz run of many voyages broken at
 * random points, each of which must reach the hall within a bounded number of days with nothing left pending.
 * Runs against the full module registry (the real military, people, world and weather rules).
 */
import { getContent } from '@content/index';
import { getGeography, icePeriodCovers } from '@content/world';
import type { Command } from '@sim/core/commands';
import { dispatch } from '@sim/core/dispatch';
import { checkInvariants } from '@sim/core/env';
import type { SimEnv } from '@sim/core/module';
import { Rng } from '@sim/core/rng';
import { advance } from '@sim/core/scheduler';
import type { CharId, FactionId, FleetId, GameState, ShipId } from '@sim/core/state';
import { HOURS_PER_DAY, toCalendar } from '@sim/core/time';
import type { SimEvent } from '@sim/core/events';
import { GameSession } from '@sim/game';
import { headlessCommand } from '@sim/headless';
import { inDraft, missingEventKeys } from '@sim/testing';
import { describe, expect, it } from 'vitest';
import { expeditionBlock } from './lost';
import { suggestPlan } from './plan';

const content = getContent();
const lost = content.tunables.expeditions.lost;

/** A running game: the state, the registry, and every event seen since the voyage began. */
interface Run {
  state: GameState;
  env: SimEnv;
  fleetId: FleetId;
  events: SimEvent[];
}

const sumMen = (men: Readonly<Record<string, number>> | undefined): number => Object.values(men ?? {}).reduce((a, b) => a + Math.max(0, b), 0);

function cmd(run: Run, command: Command): string | undefined {
  const r = dispatch(run.state, command, run.env);
  if (r.error) return r.error.code;
  run.state = r.state;
  run.events.push(...r.events);
  return undefined;
}

function ok(run: Run, command: Command): void {
  const err = cmd(run, command);
  if (err !== undefined) throw new Error(`${command.type}: ${err}`);
}

/** Answers the pending decision (if any) the way a headless run does. */
function answer(run: Run): boolean {
  const p = run.state.pending;
  if (!p) return false;
  const h = headlessCommand(run.state, p);
  if (!('command' in h)) throw new Error(`no headless answer: ${h.error}`);
  ok(run, h.command);
  return true;
}

/** Advances up to `hours`, answering every decision on the way. */
function run(r: Run, hours: number): void {
  let left = hours;
  for (let guard = 0; left > 0 && guard < 10_000; guard++) {
    if (answer(r)) continue;
    const a = advance(r.state, left, r.env);
    r.state = a.state;
    r.events.push(...a.events);
    left -= a.hoursAdvanced;
  }
  while (answer(r));
}

function sabotage(r: Run, fn: Parameters<typeof inDraft>[2]): void {
  const res = inDraft(r.state, r.env, fn);
  r.state = res.state;
  r.events.push(...res.events);
}

/** A launched expedition, a day out to sea towards the nearest foreign harbour (`sail: false`: still in harbour). */
function voyage(seed = 'lost-1', opts: { sail?: boolean; rations?: number; noWait?: boolean } = {}): Run {
  const s = GameSession.newGame({ seed });
  const plan = suggestPlan(s.getState(), content, 60);
  const launch = s.dispatch({ type: 'launchExpedition', ...plan, ...(opts.rations !== undefined ? { rations: opts.rations } : {}) });
  if (launch.error) throw new Error(`launch: ${launch.error.code}`);
  const r: Run = { state: s.getState(), env: s.env, fleetId: s.getState().player.expeditionFleetId as FleetId, events: [...launch.events] };
  if (opts.sail === false) return r;
  const home = r.state.settlements[r.state.player.capitalId];
  const d2 = (x: number, y: number) => (x - (home?.mapPos.x ?? 0)) ** 2 + (y - (home?.mapPos.y ?? 0)) ** 2;
  const targets = Object.values(r.state.settlements)
    .filter((x) => x.coastal && x.factionId !== r.state.player.factionId)
    .sort((a, b) => d2(b.mapPos.x, b.mapPos.y) - d2(a.mapPos.x, a.mapPos.y) || (a.id < b.id ? -1 : 1));
  // A harbour some way off (the middle of the list), so the fleet is still at sea after a day.
  const ordered = [...targets.slice(Math.floor(targets.length / 2)), ...targets];
  // (a harbour iced in at the start of the year: wait in harbour for the thaw)
  let to: (typeof ordered)[number] | undefined;
  for (let wait = 0; wait < (opts.noWait ? 1 : 40) && !to; wait++) {
    to = ordered.find((x) => cmd(r, { type: 'setRoute', to: { settlementId: x.id } }) === undefined);
    if (!to) run(r, 5 * HOURS_PER_DAY);
  }
  if (!to) throw new Error('no harbour to sail for');
  run(r, HOURS_PER_DAY);
  return r;
}

/** The game is back at the hall and consistent. */
function expectHome(r: Run): void {
  const st = r.state;
  expect(st.player.expeditionFleetId).toBeUndefined();
  expect(st.fleets[r.fleetId]).toBeUndefined();
  expect(st.meta.mode).toBe('hub');
  expect(st.pending).toBeNull();
  expect(Object.values(st.expeditions?.landParties ?? {})).not.toContain(r.fleetId);
  for (const c of Object.values(st.characters)) {
    expect(c.location.kind === 'fleet' && c.location.id === r.fleetId).toBe(false);
  }
  for (const ship of Object.values(st.ships)) expect(ship.locationFleetId).not.toBe(r.fleetId);
  expect(checkInvariants(st, r.env)).toEqual([]);
  expect(missingEventKeys(r.events)).toEqual([]);
}

const lostEvent = (r: Run) => r.events.find((e) => e.type === 'ExpeditionLost') as (SimEvent & { cause: string; survivors: number; menLost: number; silverLost: number }) | undefined;

function sinkAll(r: Run): void {
  sabotage(r, (d, ctx) => {
    for (const shipId of [...(d.fleets[r.fleetId]?.shipIds ?? [])]) ctx.applyEffects([{ op: 'sinkShip', shipId, cause: 'storm' } as never]);
  });
}

function otherFaction(st: GameState): FactionId {
  return Object.keys(st.factions).find((id) => id !== st.player.factionId) as FactionId;
}

function garrison(st: GameState): number {
  return sumMen(st.settlements[st.player.capitalId]?.garrison);
}

describe('no ship left afloat', () => {
  it('ships foundered at sea: survivors home, cargo and silver lost, the scene back at the hall', () => {
    const r = voyage();
    sabotage(r, (d) => {
      const f = d.fleets[r.fleetId];
      if (f) f.silver = 120;
    });
    const men = { ...r.state.fleets[r.fleetId]?.men };
    const g0 = garrison(r.state);
    const t0 = r.state.factions[r.state.player.factionId]?.treasury ?? 0;
    sinkAll(r);
    expect(r.state.player.expeditionFleetId).toBe(r.fleetId); // nothing yet: the next hour brings them home
    expect(expeditionBlock(r.state)).toBe('noShips');
    run(r, 1);
    expectHome(r);
    const ev = lostEvent(r);
    expect(ev?.cause).toBe('shipsLost');
    expect(ev?.silverLost).toBe(120);
    let expected = 0;
    for (const n of Object.values(men)) expected += Math.floor(n * lost.survivorShare);
    expect(ev?.survivors).toBe(expected);
    expect(garrison(r.state)).toBe(g0 + expected);
    expect(r.state.factions[r.state.player.factionId]?.treasury).toBe(t0);
    const ruler = r.state.characters[r.state.player.rulerId];
    expect(ruler?.alive).toBe(true);
    expect(ruler?.location).toEqual({ kind: 'settlement', id: r.state.player.capitalId });
    expect(r.events.some((e) => e.type === 'ExpeditionReturned')).toBe(true);
  });

  it('a storm that took every man and ship: no one comes home but the leaders', () => {
    const r = voyage();
    sabotage(r, (d, ctx) => {
      const f = d.fleets[r.fleetId];
      for (const [unit, count] of Object.entries({ ...f?.men })) ctx.applyEffects([{ op: 'killMen', fleetId: r.fleetId, unit, count } as never]);
      for (const shipId of [...(f?.shipIds ?? [])]) ctx.applyEffects([{ op: 'sinkShip', shipId, cause: 'storm' } as never]);
    });
    run(r, 1);
    expectHome(r);
    expect(lostEvent(r)?.survivors).toBe(0);
  });

  it('ships taken in a fight are lost at once when the decision is answered', () => {
    const r = voyage();
    const enemy = otherFaction(r.state);
    sabotage(r, (d, ctx) => {
      for (const shipId of [...(d.fleets[r.fleetId]?.shipIds ?? [])]) ctx.applyEffects([{ op: 'captureShip', shipId, factionId: enemy } as never]);
      ctx.pend({ kind: 'message', payload: { key: 'expeditions.notify.lowFood', vars: { days: 1 } } });
    });
    expect(r.state.player.expeditionFleetId).toBe(r.fleetId);
    const hour = r.state.time.hour;
    answer(r); // no time passes: the PendingResolved check brings them home
    expect(r.state.time.hour).toBe(hour);
    expectHome(r);
  });

  it('"Sail home" on a fleet with no ship brings the survivors home', () => {
    const r = voyage();
    sinkAll(r);
    ok(r, { type: 'returnHome' });
    expectHome(r);
    expect(cmd(r, { type: 'setRoute', to: { x: 1, y: 1 } })).toBe('noFleet');
  });

  it('ships lost while a party is ashore: the party marches home too', () => {
    const r = voyage('lost-1', { sail: false });
    ok(r, { type: 'makeLandfall' });
    const armyId = Object.keys(r.state.expeditions?.landParties ?? {})[0] as string;
    const party = (r.state.armies[armyId as never]?.squads ?? []).reduce((n, sq) => n + sq.men, 0);
    expect(party).toBeGreaterThan(0);
    sinkAll(r);
    expect(cmd(r, { type: 'setRoute', to: { x: 1, y: 1 } })).toBe('partyAshore');
    run(r, 1);
    expectHome(r);
    expect(r.state.armies[armyId as never]).toBeUndefined();
    expect(lostEvent(r)?.survivors).toBeGreaterThanOrEqual(Math.floor(party * lost.overlandSurvivorShare) - 2);
  });
});

describe('no men left', () => {
  it('a crew killed to the last man: the ships are scuttled, the leaders come home', () => {
    const r = voyage();
    const ships = [...(r.state.fleets[r.fleetId]?.shipIds ?? [])];
    sabotage(r, (d, ctx) => {
      for (const [unit, count] of Object.entries({ ...d.fleets[r.fleetId]?.men })) ctx.applyEffects([{ op: 'killMen', fleetId: r.fleetId, unit, count } as never]);
    });
    expect(expeditionBlock(r.state)).toBe('noCrew');
    run(r, 1);
    expectHome(r);
    expect(lostEvent(r)?.cause).toBe('noCrew');
    for (const id of ships) expect(r.state.ships[id as ShipId]).toBeUndefined();
  });

  it('a crew starved to the last man ends at the hall', () => {
    const r = voyage('lost-1', { rations: 0 });
    sabotage(r, (d) => {
      const f = d.fleets[r.fleetId];
      if (f) f.men = { [Object.keys(f.men)[0] as string]: 3 };
    });
    run(r, 20 * HOURS_PER_DAY);
    expectHome(r);
    expect(r.events.some((e) => e.type === 'FleetStarving')).toBe(true);
  });
});

describe('no one left to lead', () => {
  it('every leader dead (the ruler among them): succession, then the crews sail home on their own', () => {
    const r = voyage();
    const f0 = r.state.fleets[r.fleetId];
    const leaders = [f0?.leaderId, ...(f0?.lieutenantIds ?? [])] as CharId[];
    const men = sumMen(f0?.men);
    const g0 = garrison(r.state);
    sabotage(r, (d, ctx) => {
      for (const charId of leaders) ctx.applyEffects([{ op: 'kill', charId, cause: 'test' } as never]);
    });
    while (answer(r));
    expect(r.state.player.rulerId).not.toBe(leaders[0]);
    run(r, HOURS_PER_DAY);
    expect(expeditionBlock(r.state)).toBe('noLeader');
    expect(cmd(r, { type: 'setRoute', to: { x: 1, y: 1 } })).toBe('noLeader');
    expect(r.events.some((e) => e.type === 'ExpeditionLeaderless')).toBe(true);
    for (let d = 0; d < 120 && r.state.player.expeditionFleetId !== undefined; d++) run(r, HOURS_PER_DAY);
    expectHome(r);
    // A homecoming, not a loss: the men stand down whole (less any lost to encounters on the way).
    expect(lostEvent(r)).toBeUndefined();
    expect(garrison(r.state)).toBeGreaterThan(g0 + men / 2);
  });

  it('every leader taken captive: the captivity flow runs from the hall', () => {
    const r = voyage();
    const f0 = r.state.fleets[r.fleetId];
    const leaders = [f0?.leaderId, ...(f0?.lieutenantIds ?? [])] as CharId[];
    const enemy = otherFaction(r.state);
    sabotage(r, (d, ctx) => {
      for (const charId of leaders) ctx.applyEffects([{ op: 'capture', charId, byFactionId: enemy, cause: 'test' } as never]);
    });
    for (let d = 0; d < 120 && r.state.player.expeditionFleetId !== undefined; d++) run(r, HOURS_PER_DAY);
    expectHome(r);
    expect(r.state.characters[leaders[0] as CharId]?.location.kind === 'captive' || r.state.characters[leaders[0] as CharId]?.location.kind === 'settlement').toBe(true);
  });

  it('the leader dies but a lieutenant takes command and the voyage goes on', () => {
    const r = voyage();
    const ruler = r.state.player.rulerId;
    // A second leader aboard: any living adult of the house at the capital.
    const mate = Object.values(r.state.characters).find(
      (c) => c.alive && c.id !== ruler && c.factionId === r.state.player.factionId && c.location.kind === 'settlement' && (r.state.time.hour - c.birthHour) / (360 * 24) >= 18,
    )?.id as CharId;
    expect(mate).toBeDefined();
    sabotage(r, (d, ctx) => {
      const f = d.fleets[r.fleetId];
      const c = d.characters[mate];
      if (!f || !c) return;
      f.leaderId = ruler;
      f.lieutenantIds = [mate];
      c.location = { kind: 'fleet', id: r.fleetId };
      ctx.applyEffects([{ op: 'kill', charId: ruler, cause: 'test' } as never]);
    });
    while (answer(r));
    run(r, HOURS_PER_DAY);
    expect(r.state.player.expeditionFleetId).toBe(r.fleetId);
    expect(r.state.fleets[r.fleetId]?.leaderId).toBe(mate);
    expect(expeditionBlock(r.state)).toBeUndefined();
    ok(r, { type: 'returnHome' });
    for (let d = 0; d < 120 && r.state.player.expeditionFleetId !== undefined; d++) run(r, HOURS_PER_DAY);
    expectHome(r);
    expect(r.state.characters[mate]?.location).toEqual({ kind: 'settlement', id: r.state.player.capitalId });
  });

  it('the ruler dies at sea in the same storm that takes the fleet', () => {
    const r = voyage();
    const ruler = r.state.player.rulerId;
    sabotage(r, (d, ctx) => {
      ctx.applyEffects([{ op: 'kill', charId: ruler, cause: 'storm' } as never]);
      for (const shipId of [...(d.fleets[r.fleetId]?.shipIds ?? [])]) ctx.applyEffects([{ op: 'sinkShip', shipId, cause: 'storm' } as never]);
    });
    run(r, 1);
    expectHome(r);
    expect(r.state.player.rulerId).not.toBe(ruler);
  });
});

describe('a way home that cannot be sailed', () => {
  it('no sea road from where the fleet lies: the crews walk home', () => {
    const r = voyage();
    // Somewhere far inland (an inland settlement's spot, where no water is within reach).
    const inland = Object.values(r.state.settlements)
      .filter((s) => !s.coastal)
      .map((s) => s.mapPos)
      .find((pos) => {
        const probe = inDraft(r.state, r.env, (d) => {
          const f = d.fleets[r.fleetId];
          if (f) {
            f.pos = { ...pos };
            f.route = [];
            f.mode = 'beached';
          }
        });
        const res = dispatch(probe.state, { type: 'setRoute', to: { settlementId: r.state.player.capitalId } }, r.env);
        return res.error?.code === 'route.noStart' || res.error?.code === 'route.unreachable';
      });
    expect(inland).toBeDefined();
    sabotage(r, (d) => {
      const f = d.fleets[r.fleetId];
      if (f && inland) {
        f.pos = { ...inland };
        f.route = [];
        f.mode = 'beached';
      }
    });
    ok(r, { type: 'returnHome' });
    expectHome(r);
    expect(lostEvent(r)?.cause).toBe('noWayHome');
  });

  it('home iced in: Sail home says so and the voyage waits; after the thaw it comes home', () => {
    // A seed whose capital lies in a sea that ices over, and the first icing day ahead.
    const geo = getGeography();
    // Open water on `day`, ice from three days later.
    let found: { seed: string; day: number } | undefined;
    for (let i = 0; i < 12 && !found; i++) {
      const seed = `ice-${i}`;
      const st = GameSession.newGame({ seed }).getState();
      const zone = geo.seaZones.find((z) => z.id === st.worldIndex?.settlements[st.player.capitalId]?.seaZoneId);
      if (!zone || zone.ice.length === 0) continue;
      const icedOn = (d: number) => {
        const c = toCalendar(d * HOURS_PER_DAY);
        return zone.ice.some((p) => icePeriodCovers(p, c.monthIndex, c.day));
      };
      for (let d = 2; d < 357; d++) {
        if (!icedOn(d) && icedOn(d + 3)) {
          found = { seed, day: d };
          break;
        }
      }
    }
    if (!found) return; // no icy home in these worlds: nothing to wait out
    const s = GameSession.newGame({ seed: found.seed });
    const r: Run = { state: s.getState(), env: s.env, fleetId: '' as FleetId, events: [] };
    run(r, found.day * HOURS_PER_DAY - r.state.time.hour);
    const plan = suggestPlan(r.state, content, 60);
    ok(r, { type: 'launchExpedition', ...plan, rations: 0 });
    r.fleetId = r.state.player.expeditionFleetId as FleetId;
    // Keep the crew fed and small so the wait is about the ice, not the food.
    sabotage(r, (d) => {
      const f = d.fleets[r.fleetId];
      if (f) f.rations = 1_000_000;
    });
    const far = Object.values(r.state.settlements).find((x) => x.coastal && x.factionId !== r.state.player.factionId && cmd(r, { type: 'setRoute', to: { settlementId: x.id } }) === undefined);
    expect(far).toBeDefined();
    run(r, 3 * HOURS_PER_DAY);
    // The ice has closed the home harbour by now: Sail home says so (not "unreachable") and nothing is lost.
    let iced = false;
    const first = cmd(r, { type: 'returnHome' });
    expect(['route.iced', undefined]).toContain(first);
    if (first === 'route.iced') {
      iced = true;
      expect(r.state.player.expeditionFleetId).toBe(r.fleetId);
    }
    for (let d = 0; d < 360 && r.state.player.expeditionFleetId !== undefined; d++) {
      const err = r.state.fleets[r.fleetId]?.homeward ? undefined : cmd(r, { type: 'returnHome' });
      if (err === 'route.iced') iced = true;
      else if (err === 'partyAshore') ok(r, { type: 'returnToShips' });
      else if (err !== undefined) throw new Error(err);
      run(r, HOURS_PER_DAY);
    }
    expectHome(r);
    expect(lostEvent(r)).toBeUndefined();
    expect(iced).toBe(true);
  });
});

describe('a vanished fleet record', () => {
  it('the dangling expedition is cleared and everyone aboard comes home', () => {
    const r = voyage();
    const ships = [...(r.state.fleets[r.fleetId]?.shipIds ?? [])];
    sabotage(r, (d) => {
      delete d.fleets[r.fleetId];
    });
    run(r, 1);
    expectHome(r);
    expect(lostEvent(r)?.cause).toBe('vanished');
    for (const id of ships) expect(r.state.ships[id]?.dockedAt).toBe(r.state.player.capitalId);
    expect(r.state.characters[r.state.player.rulerId]?.location).toEqual({ kind: 'settlement', id: r.state.player.capitalId });
  });
});

// ---------------------------------------------------------------------------------------------
// Determinism and fuzz.

type Breakage = 'sinkAll' | 'sinkSome' | 'killCrew' | 'killLeaders' | 'captureLeaders' | 'landThenSink' | 'none';
const BREAKAGES: Breakage[] = ['sinkAll', 'sinkSome', 'killCrew', 'killLeaders', 'captureLeaders', 'landThenSink', 'none'];

/** One voyage broken at a random point; the player presses Sail home on a random later day. Returns days taken. */
function brokenVoyage(seed: string, maxDays: number): { r: Run; days: number; kind: Breakage } | undefined {
  const rng = new Rng(`fuzz|${seed}`);
  const kind = rng.pick(BREAKAGES);
  let r: Run;
  try {
    // Worlds whose home harbour lies in ice at the start of the year are skipped (the ice test covers them).
    r = voyage(seed, { sail: kind !== 'landThenSink', noWait: true });
  } catch {
    return undefined;
  }
  const breakDay = rng.int(0, 6);
  const homeDay = breakDay + rng.int(1, 10);
  let day = 0;
  for (; day < maxDays && r.state.player.expeditionFleetId !== undefined; day++) {
    if (day === breakDay) {
      const f = r.state.fleets[r.fleetId];
      const enemy = otherFaction(r.state);
      if (kind === 'landThenSink' && cmd(r, { type: 'makeLandfall' }) === undefined) sinkAll(r);
      sabotage(r, (d, ctx) => {
        const g = d.fleets[r.fleetId];
        if (!g || !f) return;
        if (kind === 'sinkAll') for (const shipId of [...g.shipIds]) ctx.applyEffects([{ op: 'sinkShip', shipId, cause: 'storm' } as never]);
        if (kind === 'sinkSome') for (const shipId of [...g.shipIds]) if (rng.chance(0.6)) ctx.applyEffects([{ op: 'sinkShip', shipId, cause: 'seaBattle' } as never]);
        if (kind === 'killCrew') for (const [unit, count] of Object.entries({ ...g.men })) ctx.applyEffects([{ op: 'killMen', fleetId: r.fleetId, unit, count } as never]);
        if (kind === 'killLeaders') for (const charId of [g.leaderId, ...g.lieutenantIds]) ctx.applyEffects([{ op: 'kill', charId, cause: 'test' } as never]);
        if (kind === 'captureLeaders') for (const charId of [g.leaderId, ...g.lieutenantIds]) ctx.applyEffects([{ op: 'capture', charId, byFactionId: enemy, cause: 'test' } as never]);
      });
    }
    if (day >= homeDay && r.state.pending === null && r.state.player.expeditionFleetId !== undefined && !r.state.fleets[r.fleetId]?.homeward) {
      const err = cmd(r, { type: 'returnHome' });
      if (err === 'partyAshore') cmd(r, { type: 'returnToShips' });
      else if (err !== undefined && err !== 'route.iced' && err !== 'noFleet') throw new Error(`${seed}: returnHome ${err}`);
    }
    run(r, HOURS_PER_DAY);
  }
  return { r, days: day, kind };
}

describe('determinism and fuzz', () => {
  it('the same voyage lost the same way gives the same game', () => {
    const play = (kind: 'wreck' | 'leaderless'): string => {
      const r = voyage('lost-1');
      if (kind === 'wreck') sinkAll(r);
      else
        sabotage(r, (d, ctx) => {
          const f = d.fleets[r.fleetId];
          for (const charId of [f?.leaderId, ...(f?.lieutenantIds ?? [])] as CharId[]) ctx.applyEffects([{ op: 'kill', charId, cause: 'test' } as never]);
        });
      for (let d = 0; d < 30 && r.state.player.expeditionFleetId !== undefined; d++) run(r, HOURS_PER_DAY);
      expectHome(r);
      return JSON.stringify(r.state);
    };
    expect(play('wreck')).toBe(play('wreck'));
    expect(play('leaderless')).toBe(play('leaderless'));
    expect(play('wreck')).not.toBe(play('leaderless'));
  }, 60_000);

  it('many voyages broken at random points all end at the hall within 150 days', () => {
    const MAX_DAYS = 150;
    const seen: Record<string, number> = {};
    let voyages = 0;
    for (let i = 0; i < 48 && voyages < 16; i++) {
      const seed = `fuzz-${i}`;
      const b = brokenVoyage(seed, MAX_DAYS);
      if (!b) continue;
      voyages += 1;
      const { r, days, kind } = b;
      seen[kind] = (seen[kind] ?? 0) + 1;
      expect({ seed, kind, away: r.state.player.expeditionFleetId !== undefined, days: days <= MAX_DAYS }).toEqual({ seed, kind, away: false, days: true });
      expectHome(r);
    }
    expect(voyages).toBe(16);
    expect(Object.keys(seen).length).toBeGreaterThanOrEqual(4);
  }, 240_000);
});
