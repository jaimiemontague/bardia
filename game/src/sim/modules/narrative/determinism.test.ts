import { describe, expect, it } from 'vitest';
import type { Command } from '@sim/core/commands';
import { checkInvariants } from '@sim/core/env';
import { dispatch } from '@sim/core/dispatch';
import type { SimEvent } from '@sim/core/events';
import { upgradeLoadedState } from '@sim/core/lifecycle';
import { advance } from '@sim/core/scheduler';
import type { FactionId, FleetId, GameState } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { deserialize, serialize } from '@sim/save/index';
import { inDraft, missingEventKeys, testEnv, testState } from '../../testing';
import { headlessStoryletCommand } from './api';
import { bundledContent } from './library';
import { narrativeWorld } from './testing';

/** A two-year headless campaign with the bundled content: storylets auto-answered, lines spoken, a battle fought. */
function campaign(seed: string) {
  const w = narrativeWorld({ seed, factions: 3, settlementsPerFaction: 2, tunables: { monthly: { player: { chance: 1, max: 1 } } } });
  const fleetId = (w.fleetIds[w.factionIds[0] as FactionId] as FleetId[])[0] as FleetId;
  let s = inDraft(w.state, w.env, (d) => {
    d.player.expeditionFleetId = fleetId;
  }).state;
  const events: SimEvent[] = [];
  const violations: string[] = [];
  const step = (r: { state: GameState; events: SimEvent[] }) => {
    s = r.state;
    events.push(...r.events);
  };
  for (let day = 1; day <= 720; day++) {
    // The expedition is at sea from day 40 to day 100 (voyage-day storylets), home otherwise.
    if (day === 40 || day === 100) {
      step(
        inDraft(s, w.env, (d) => {
          const f = d.fleets[fleetId];
          if (f) {
            f.mode = day === 40 ? 'sailing' : 'docked';
            f.voyageDays = day === 40 ? 3 : 0;
          }
        }),
      );
    }
    if (day === 150) {
      const other = w.factionIds[1] as FactionId;
      step(inDraft(s, w.env, (d, ctx) => ctx.emit({ type: 'BattleEnded', battleId: 'bat_1', winner: 'attacker', setup: { attacker: { factionId: d.player.factionId }, defender: { factionId: other } } } as unknown as SimEvent)));
    }
    step(advance(s, HOURS_PER_DAY, w.env));
    for (let guard = 0; s.pending !== null; guard++) {
      if (guard > 50) throw new Error('decision loop');
      const cmd = headlessStoryletCommand(s);
      if (!cmd) throw new Error(`unexpected decision ${s.pending.kind}`);
      const out = dispatch(s, cmd, w.env);
      if (out.error) throw new Error(`${out.error.code}: ${out.error.message}`);
      step(out);
      if (s.pending === null) step(advance(s, 0, w.env)); // finish the interrupted tick (it may raise more decisions)
    }
    if (day % 30 === 0) {
      for (const pool of ['smith.greeting', 'keeper.greeting']) {
        const cmd = { type: 'sayLine', pool, scope: { settlement: s.player.capitalId } } as Command;
        const out = dispatch(s, cmd, w.env);
        if (out.error) throw new Error(out.error.message);
        step(out);
      }
      violations.push(...checkInvariants(s, w.env));
    }
  }
  return { state: s, events, violations, env: w.env };
}

describe('determinism and invariants', () => {
  it('same seed + same inputs → identical state over two years of bundled content', () => {
    const a = campaign('saga-one');
    const b = campaign('saga-one');
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.violations).toEqual([]);
    expect(missingEventKeys(a.events)).toEqual([]);
    const resolved = a.events.filter((e) => e.type === 'StoryletResolved');
    const ids = new Set(resolved.map((e) => (e.type === 'StoryletResolved' ? e.storyletId : '')));
    expect(resolved.length).toBeGreaterThanOrEqual(6);
    for (const id of ['ratsInTheStores', 'boundaryStone', 'drunkenBoast', 'boastReckoning', 'afterTheShieldWall', 'skaldsDraft']) expect(ids).toContain(id);
    const c = campaign('saga-two');
    expect(JSON.stringify(c.state)).not.toBe(JSON.stringify(a.state));
  });

  it('chunking does not matter: one long operation equals day-by-day advances (delegated and inbox petitions)', () => {
    const petitions = bundledContent().storylets.filter((d) => d.scope === 'holding');
    for (const abroad of [false, true]) {
      const w = narrativeWorld({ storylets: petitions, settlementsPerFaction: 3, tunables: { monthly: { holding: { chance: 1, max: 2 } } } });
      let s0 = w.state;
      if (abroad) {
        const fleetId = (w.fleetIds[w.factionIds[0] as FactionId] as FleetId[])[0] as FleetId;
        s0 = inDraft(s0, w.env, (d) => {
          const ruler = d.characters[d.player.rulerId];
          if (ruler) ruler.location = { kind: 'fleet', id: fleetId };
        }).state;
      } else {
        s0 = dispatch(s0, { type: 'setPolicy', policy: 'petitions', value: 'delegate' }, w.env).state;
      }
      const days = 400;
      const big = advance(s0, days * HOURS_PER_DAY, w.env);
      expect(big.pending).toBeNull();
      let small = s0;
      for (let d = 0; d < days; d++) small = advance(small, HOURS_PER_DAY, w.env).state;
      expect(JSON.stringify(big.state)).toBe(JSON.stringify(small));
      expect(big.events.filter((e) => e.type === 'StoryletResolved').length).toBeGreaterThan(2);
      expect(checkInvariants(big.state, w.env)).toEqual([]);
    }
  });

  it('state is JSON-clean: save → load → save is byte-identical with active storylets, memory and verses', () => {
    const { state, env } = campaign('saga-save');
    const busy = inDraft(state, env, (_d, ctx) =>
      ctx.applyEffects([
        { op: 'composeVerse', kind: 'yearEnd', deeds: [{ kind: 'raid', vars: { place: 'Tarnwick' } }], targetKey: 'yearEnd:813', year: 813 },
        { op: 'scheduleStorylet', storyletId: 'boastReckoning', inDays: 0 },
      ]),
    ).state;
    const withPending = advance(busy, 1, env).state;
    expect(withPending.pending?.kind).toBe('storylet');
    expect(withPending.storylets.verses?.['yearEnd:813']?.lines.length).toBeGreaterThan(1);
    expect(Object.keys(withPending.storylets.instances ?? {})).toHaveLength(1);
    const blob = serialize(withPending);
    const loaded = deserialize(blob).state;
    expect(serialize(loaded)).toBe(blob);
    expect(JSON.parse(JSON.stringify(withPending))).toEqual(withPending);
    expect(checkInvariants(loaded, env)).toEqual([]);
  });

  it('init works on a campaign already under way (back-fills chronicle marks)', () => {
    const w = narrativeWorld();
    const before = testState({ modules: [] });
    const withChronicle = inDraft(before, testEnv([]), (d, ctx) => {
      d.time.hour = 100;
      ctx.chronicle({ kind: 'raid', textKey: 'core.test', hour: 30 });
      ctx.chronicle({ kind: 'raid', textKey: 'core.test', hour: 60 });
    }).state;
    expect(withChronicle.storylets.marks).toBeUndefined();
    const up = upgradeLoadedState(withChronicle, w.env).state;
    expect(up.meta.moduleVersions.narrative).toBe(1);
    expect(up.storylets.marks?.['chronicle:raid']).toBe(60);
    expect(up.storylets.tallies?.['chronicle:raid']).toBe(2);
    expect(up.storylets.lines).toEqual({ session: 1, draws: 0, recent: {}, uses: {}, last: {} });
    expect(checkInvariants(up, w.env)).toEqual([]);
  });
});
