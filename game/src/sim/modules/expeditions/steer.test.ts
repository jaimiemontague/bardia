/**
 * The player steers the expedition (the `steer` command, world's steerEntity) with the full module registry:
 * launching does not touch the home harbour, steering back into it after leaving ends the voyage, the war-band
 * ashore is steered by the same command and boards again when it walks back to the ships, a set course and
 * steering cancel each other, and the same commands replay to the same state.
 */
import { getContent } from '@content/index';
import type { Command } from '@sim/core/commands';
import { checkInvariants } from '@sim/core/env';
import type { SimEvent } from '@sim/core/events';
import type { ArmyId, FleetId, GameState, MapPos } from '@sim/core/state';
import { GameSession } from '@sim/game';
import { headlessCommand } from '@sim/headless';
import { describe, expect, it } from 'vitest';
import { worldData } from '../world/data';
import { NAV_SEA } from '../world/map';
import type { SteerDir } from '../world/types';
import { suggestPlan } from './plan';

type Session = ReturnType<typeof GameSession.newGame>;
const content = getContent();
const sw = worldData().sw;
const W = sw.width;
const VEC: Record<SteerDir, [number, number]> = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] };
const OPPOSITE: Record<SteerDir, SteerDir> = { n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e', nw: 'se' };
const DIRS = Object.keys(VEC) as SteerDir[];
const cellOf = (p: MapPos) => Math.floor(p.y) * W + Math.floor(p.x);
const sea = (c: number) => c >= 0 && ((sw.nav[c] as number) & NAV_SEA) !== 0;

function ok(s: Session, command: Command): ReturnType<Session['dispatch']> {
  const r = s.dispatch(command);
  if (r.error) throw new Error(`${command.type}: ${r.error.code} ${r.error.message}`);
  return r;
}

/** Answers whatever decision is up with the headless default. */
function answer(s: Session): void {
  for (let i = 0; i < 20 && s.getState().pending; i++) {
    const h = headlessCommand(s.getState());
    if (!('command' in h)) throw new Error(h.error);
    s.dispatch(h.command);
  }
}

/** A new saga two months in (past the ice), with the expedition launched from the capital. */
function launched(seed = 'slice-1'): { s: Session; fleetId: FleetId } {
  const s = GameSession.newGame({ seed });
  for (let d = 0; d < 60; d++) {
    s.advance(24);
    answer(s);
  }
  ok(s, { type: 'launchExpedition', ...suggestPlan(s.getState(), content, 30) });
  return { s, fleetId: s.getState().player.expeditionFleetId as FleetId };
}

/** Steers for up to `n` hours (answering decisions); stops early when `until` holds. Returns the events. */
function sail(s: Session, n: number, until: (st: GameState) => boolean = () => false): SimEvent[] {
  const events: SimEvent[] = [];
  for (let h = 0; h < n && !until(s.getState()); h++) {
    events.push(...s.advance(1).events);
    if (s.getState().pending) {
      answer(s);
      return events;
    }
  }
  return events;
}

/** A heading with open water for `cells` cells from a point. */
function openHeading(from: MapPos, cells: number): SteerDir | undefined {
  return DIRS.find((d) => {
    const [vx, vy] = VEC[d];
    const n = Math.hypot(vx, vy);
    for (let k = 1; k <= cells * 2; k++) if (!sea(cellOf({ x: from.x + (k * 0.5 * vx) / n, y: from.y + (k * 0.5 * vy) / n }))) return false;
    return true;
  });
}

describe('steering the expedition', () => {
  it('sets out without touching home, and steering back into the home harbour ends the voyage', () => {
    const { s, fleetId } = launched();
    // First a heading to get off the berth, then one with open water ahead.
    ok(s, { type: 'steer', dir: 'n' });
    const berth = { ...(s.getState().fleets[fleetId]?.pos as MapPos) };
    expect(s.getState().world?.touch?.[fleetId]).toContain(s.getState().player.capitalId);
    const out = openHeading(berth, 5);
    expect(out).toBeDefined();
    if (!out) return;
    ok(s, { type: 'steer', dir: out });
    const away = (st: GameState) => {
      const p = st.fleets[fleetId]?.pos;
      return p !== undefined && Math.hypot(p.x - berth.x, p.y - berth.y) > 3.5;
    };
    sail(s, 12, away);
    expect(s.getState().player.expeditionFleetId).toBe(fleetId);
    expect(away(s.getState())).toBe(true);
    expect(s.getState().world?.touch?.[fleetId]).not.toContain(s.getState().player.capitalId);
    ok(s, { type: 'steer', dir: 'stop' });
    expect(s.getState().fleets[fleetId]?.steer).toBeUndefined();
    // Back the way it came: the voyage ends at home.
    ok(s, { type: 'steer', dir: OPPOSITE[out] });
    const events = sail(s, 24, (st) => st.player.expeditionFleetId === undefined);
    expect(s.getState().player.expeditionFleetId).toBeUndefined();
    expect(s.getState().meta.mode).toBe('hub');
    expect(events.some((e) => e.type === 'ExpeditionReturned')).toBe(true);
    expect(checkInvariants(s.getState(), s.env)).toEqual([]);
  });

  it('a set course cancels the steering and the steering cancels a course (and a homecoming)', () => {
    const { s, fleetId } = launched();
    ok(s, { type: 'steer', dir: 'n' });
    ok(s, { type: 'returnHome' });
    // At home already: the voyage may have ended at once; otherwise the fleet is homeward bound.
    if (s.getState().player.expeditionFleetId === undefined) return;
    expect(s.getState().fleets[fleetId]?.steer).toBeUndefined();
    const out = openHeading(s.getState().fleets[fleetId]?.pos as MapPos, 2) ?? 'n';
    ok(s, { type: 'steer', dir: out });
    const f = s.getState().fleets[fleetId] as GameState['fleets'][FleetId] & { homeward?: boolean };
    expect(f.steer).toBe(out);
    expect(f.homeward).toBeUndefined();
  });

  it('refuses to steer when there is no expedition', () => {
    const s = GameSession.newGame({ seed: 'slice-1' });
    expect(s.dispatch({ type: 'steer', dir: 'n' }).error?.code).toBe('noFleet');
  });

  it('steers the war-band ashore; walking back onto the ships boards it again', () => {
    const { s, fleetId } = launched();
    ok(s, { type: 'makeLandfall' });
    const armyId = Object.keys(s.getState().expeditions?.landParties ?? {})[0] as ArmyId;
    expect(armyId).toBeDefined();
    // The fleet cannot be steered while its men are ashore; the command steers the war-band.
    expect(s.dispatch({ type: 'steer', dir: 'n', fleetId }).error?.code).toBe('partyAshore');
    const start = { ...(s.getState().armies[armyId]?.pos as MapPos) };
    const inland = DIRS.find((d) => {
      const [vx, vy] = VEC[d];
      const n = Math.hypot(vx, vy);
      for (let k = 1; k <= 8; k++) if (sw.kind[cellOf({ x: start.x + (k * 0.5 * vx) / n, y: start.y + (k * 0.5 * vy) / n })] !== 1) return false;
      return true;
    });
    expect(inland).toBeDefined();
    if (!inland) return;
    ok(s, { type: 'steer', dir: inland });
    expect(s.getState().armies[armyId]?.steer).toBe(inland);
    sail(s, 24, (st) => {
      const p = st.armies[armyId]?.pos;
      return p !== undefined && Math.hypot(p.x - start.x, p.y - start.y) > 2.5;
    });
    expect(Object.hasOwn(s.getState().armies, armyId)).toBe(true);
    ok(s, { type: 'steer', dir: OPPOSITE[inland] });
    const events = sail(s, 24, (st) => !Object.hasOwn(st.armies, armyId));
    expect(events.some((e) => e.type === 'PartyReturned')).toBe(true);
    expect(s.getState().expeditions?.landParties).toEqual({});
    expect(checkInvariants(s.getState(), s.env)).toEqual([]);
  });

  it('is deterministic: the same commands replay to the same state', () => {
    const run = (): Session => {
      const { s } = launched('steer-det');
      for (const dir of ['n', 'e', 'stop', 's', 'w', 'nw'] as const) {
        const r = s.dispatch({ type: 'steer', dir });
        if (r.error && s.getState().player.expeditionFleetId !== undefined) throw new Error(r.error.code);
        sail(s, 8);
      }
      return s;
    };
    const a = run();
    const b = run();
    expect(JSON.stringify(b.getState())).toBe(JSON.stringify(a.getState()));
    const replayed = GameSession.replay(a.newGameOptions!, a.commandLog);
    expect(JSON.stringify(replayed.getState())).toBe(JSON.stringify(a.getState()));
  });
});
