import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { CommandError } from '@sim/core/commands';
import { dispatch } from '@sim/core/dispatch';
import { validateEffects } from '@sim/core/effects';
import { createFleet } from '@sim/core/factory';
import type { SimContext, SimModule } from '@sim/core/module';
import type { ArmyId, FleetId, GameState } from '@sim/core/state';
import { missingEventKeys } from '../../testing';
import { militaryInvariants } from './invariants';
import { containerVeterancy, realmMen } from './men';
import { capitalOf, days, edit, militaryEnv, militaryState } from './testing';

const content = getContent();
const env = militaryEnv();

function withFleet(s: GameState, mode: 'docked' | 'sailing' = 'sailing', men: Record<string, number> = { bondi: 30 }): { state: GameState; fleetId: FleetId } {
  let fleetId: FleetId = 'flt_0';
  const state = edit(s, env, (d, ctx) => {
    const cap = d.settlements[d.player.capitalId];
    const f = createFleet(d, ctx, {
      ownerId: d.player.factionId,
      leaderId: d.player.rulerId,
      pos: mode === 'docked' && cap ? { ...cap.mapPos } : { x: 50, y: 50 },
      men,
      mode,
    });
    fleetId = f.id;
  });
  return { state, fleetId };
}

describe('addMen / killMen', () => {
  it('addMen defaults to the capital garrison without an expedition fleet; negative counts remove men', () => {
    const s0 = militaryState();
    const cap = capitalOf(s0);
    const s1 = edit(s0, env, (_d, ctx) => ctx.applyEffects([{ op: 'addMen', unit: 'skirmishers', count: 7 }]));
    expect(s1.settlements[cap]?.garrison.skirmishers).toBe(7);
    const s2 = edit(s1, env, (_d, ctx) => ctx.applyEffects([{ op: 'addMen', unit: 'skirmishers', count: -10 }]));
    expect(s2.settlements[cap]?.garrison.skirmishers).toBeUndefined();
  });

  it('addMen goes to the expedition fleet when the player has one', () => {
    const { state, fleetId } = withFleet(militaryState());
    const s1 = edit(state, env, (d, ctx) => {
      d.player.expeditionFleetId = fleetId;
      ctx.applyEffects([{ op: 'addMen', unit: 'archers', count: 4, battles: 2 }]);
    });
    expect(s1.fleets[fleetId]?.men).toEqual({ bondi: 30, archers: 4 });
    expect(s1.fleets[fleetId]?.vetBattles?.archers).toBe(2);
  });

  it('killMen: killed and captured men leave the home population; wounded recover; MenLost is emitted', () => {
    const s0 = militaryState();
    const cap = capitalOf(s0);
    const pop = s0.settlements[cap]?.pop ?? 0;
    const r = (() => {
      let events: unknown[] = [];
      const st = edit(s0, env, (_d, ctx) => {
        ctx.applyEffects([{ op: 'killMen', unit: 'bondi', count: 10, wounded: 6, captured: 2, settlementId: cap }]);
        events = [...ctx.events];
      });
      return { st, events };
    })();
    expect(r.st.settlements[cap]?.garrison.bondi).toBe(40 - 18);
    expect(r.st.settlements[cap]?.pop).toBe(pop - 12);
    expect(r.st.settlements[cap]?.woundedMen).toEqual([{ unit: 'bondi', count: 6, progress: 0, battles: 0, sinceHour: 0, rate: 1 / 30 }]);
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'MenLost', unit: 'bondi', killed: 10, wounded: 6, captured: 2, homeId: cap }));
  });

  it('killMen clamps to the men present and kills from a fleet against the capital population', () => {
    const { state, fleetId } = withFleet(militaryState(), 'sailing', { bondi: 5 });
    const cap = capitalOf(state);
    const pop = state.settlements[cap]?.pop ?? 0;
    const s1 = edit(state, env, (_d, ctx) => ctx.applyEffects([{ op: 'killMen', unit: 'bondi', count: 9, wounded: 4, fleetId }]));
    expect(s1.fleets[fleetId]?.men).toEqual({});
    expect(s1.fleets[fleetId]?.woundedMen).toBeUndefined();
    expect(s1.settlements[cap]?.pop).toBe(pop - 5);
    const noPop = edit(state, env, (_d, ctx) => ctx.applyEffects([{ op: 'killMen', unit: 'bondi', count: 2, fleetId, popLoss: false }]));
    expect(noPop.settlements[cap]?.pop).toBe(pop);
  });

  it('wounded recover in 30 days at home and 60 at sea (30 when docked)', () => {
    const s0 = militaryState();
    const cap = capitalOf(s0);
    const home = edit(s0, env, (_d, ctx) => ctx.applyEffects([{ op: 'killMen', unit: 'archers', count: 0, wounded: 8, settlementId: cap }]));
    expect(days(home, env, 29).state.settlements[cap]?.garrison.archers).toBe(12);
    const healed = days(home, env, 30);
    expect(healed.state.settlements[cap]?.garrison.archers).toBe(20);
    expect(healed.state.settlements[cap]?.woundedMen).toEqual([]);
    expect(healed.events.find((e) => e.type === 'WoundedRecovered')).toMatchObject({ men: { archers: 8 } });

    const { state, fleetId } = withFleet(s0, 'sailing', { bondi: 10 });
    const sea = edit(state, env, (_d, ctx) => ctx.applyEffects([{ op: 'killMen', unit: 'bondi', count: 0, wounded: 4, fleetId }]));
    expect(days(sea, env, 59).state.fleets[fleetId]?.men.bondi).toBe(6);
    expect(days(sea, env, 60).state.fleets[fleetId]?.men.bondi).toBe(10);
    const docked = edit(state, env, (d, ctx) => {
      const f = d.fleets[fleetId];
      if (f) f.mode = 'docked';
      ctx.applyEffects([{ op: 'killMen', unit: 'bondi', count: 0, wounded: 4, fleetId }]);
    });
    expect(days(docked, env, 29).state.fleets[fleetId]?.men.bondi).toBe(6);
    expect(days(docked, env, 30).state.fleets[fleetId]?.men.bondi).toBe(10);
    // Docked after 15 days at sea: the mode is seen at the day-16 pass (16/60 healed); the remaining
    // 44/60 take 22 days at the home rate, so the men are back on day 38 instead of day 60.
    const halfway = days(sea, env, 15).state;
    const moored = edit(halfway, env, (d) => {
      const f = d.fleets[fleetId];
      if (f) f.mode = 'docked';
    });
    const day37 = days(moored, env, 22).state;
    expect(day37.fleets[fleetId]?.men.bondi).toBe(6);
    expect(day37.fleets[fleetId]?.woundedMen?.[0]?.rate).toBe(1 / 30);
    expect(days(moored, env, 23).state.fleets[fleetId]?.men.bondi).toBe(10);
  });

  it('men wounded in the middle of one long operation still heal during it', () => {
    /** Wounds archers at the capital on day 2, inside the same advance as the healing. */
    const wounder: SimModule = {
      id: 'testWounder',
      order: 300,
      systems: {
        daily(draft, ctx) {
          if (ctx.hour === 48) ctx.applyEffects([{ op: 'killMen', unit: 'archers', count: 0, wounded: 5, settlementId: draft.player.capitalId }]);
        },
      },
    };
    const wenv = militaryEnv([wounder]);
    const s0 = militaryState({ extra: [wounder] });
    const cap = capitalOf(s0);
    const r = days(s0, wenv, 40).state;
    expect(r.settlements[cap]?.garrison.archers).toBe(20);
    expect(r.settlements[cap]?.woundedMen).toEqual([]);
    const mid = days(s0, wenv, 31).state;
    expect(mid.settlements[cap]?.garrison.archers).toBe(15);
  });

  it('wounded keep their veterancy and count in the realm totals', () => {
    const s0 = edit(militaryState(), env, (d) => {
      const c = d.settlements[d.player.capitalId];
      if (c) c.vetBattles = { bondi: 3 };
    });
    const cap = capitalOf(s0);
    const s1 = edit(s0, env, (_d, ctx) => ctx.applyEffects([{ op: 'killMen', unit: 'bondi', count: 0, wounded: 10, settlementId: cap }]));
    expect(realmMen(s1, s1.player.factionId)).toMatchObject({ active: 50, wounded: 10, total: 60 });
    const s2 = days(s1, env, 30).state;
    expect(s2.settlements[cap]?.vetBattles?.bondi).toBe(3);
    expect(containerVeterancy(s2, content.balance, cap, 'bondi')).toEqual({ battles: 3, stars: 2 });
  });
});

describe('moveMen and pools', () => {
  it('moves men between containers merging veterancy by weight', () => {
    const { state, fleetId } = withFleet(
      edit(militaryState(), env, (d) => {
        const c = d.settlements[d.player.capitalId];
        if (c) c.vetBattles = { bondi: 6 };
      }),
      'docked',
      { bondi: 30 },
    );
    const cap = capitalOf(state);
    const s1 = edit(state, env, (_d, ctx) => ctx.applyEffects([{ op: 'moveMen', from: { settlementId: cap }, to: { fleetId }, men: { bondi: 10, archers: 50 } }]));
    expect(s1.settlements[cap]?.garrison).toEqual({ bondi: 30 });
    expect(s1.fleets[fleetId]?.men).toEqual({ bondi: 40, archers: 20 });
    expect(s1.fleets[fleetId]?.vetBattles?.bondi).toBe(1.5); // (30 × 0 + 10 × 6) / 40
  });

  it('men going home join the pool; veterans are tracked per unit type', () => {
    const { state, fleetId } = withFleet(militaryState(), 'docked', { bondi: 10, archers: 4 });
    const cap = capitalOf(state);
    const s1 = edit(state, env, (d, ctx) => {
      const f = d.fleets[fleetId];
      if (f) f.vetBattles = { bondi: 2 };
      ctx.applyEffects([{ op: 'moveMen', from: { fleetId }, to: { settlementId: cap, pool: true }, men: { bondi: 10, archers: 4 } }]);
    });
    const h = s1.settlements[cap]?.holding;
    expect(h?.pool.current).toBe(220 + 14);
    expect(h?.pool.veterans).toEqual({ bondi: 10 });
    expect(h?.veteranBattles).toEqual({ bondi: 2 });
  });

  it('a disbanding fleet carries its wounded home, keeping their recovery progress', () => {
    const { state, fleetId } = withFleet(militaryState(), 'sailing', { bondi: 10 });
    const cap = capitalOf(state);
    const hurt = edit(state, env, (_d, ctx) => ctx.applyEffects([{ op: 'killMen', unit: 'bondi', count: 0, wounded: 6, fleetId }]));
    // 30 days at sea: half healed. Then everyone goes ashore at the capital (home rate).
    const later = days(hurt, env, 30).state;
    const ashore = edit(later, env, (_d, ctx) =>
      ctx.applyEffects([{ op: 'moveMen', from: { fleetId }, to: { settlementId: cap }, men: { bondi: 4 }, wounded: true }]),
    );
    expect(ashore.fleets[fleetId]?.woundedMen).toEqual([]);
    expect(ashore.settlements[cap]?.garrison.bondi).toBe(44);
    const batch = ashore.settlements[cap]?.woundedMen?.[0];
    expect(batch).toMatchObject({ unit: 'bondi', count: 6, rate: 1 / 30 });
    expect(batch?.progress).toBeCloseTo(0.5, 9);
    expect(days(ashore, env, 14).state.settlements[cap]?.garrison.bondi).toBe(44);
    expect(days(ashore, env, 15).state.settlements[cap]?.garrison.bondi).toBe(50);
    expect(militaryInvariants(days(ashore, env, 15).state, content.balance)).toEqual([]);
  });

  it('rejects bad effect parameters at content-load time', () => {
    expect(validateEffects(env, [{ op: 'addMen', unit: 'bondi', count: 1.5 }])).toHaveLength(1);
    expect(validateEffects(env, [{ op: 'killMen', unit: 'bondi', count: -1 }])).toHaveLength(1);
    expect(validateEffects(env, [{ op: 'spawnArmy', squads: [] }])).toHaveLength(1);
    expect(validateEffects(env, [{ op: 'damageShip', shipId: 'flt_1', hull: 3 }])).toHaveLength(1);
    expect(validateEffects(env, [{ op: 'addMen', unit: 'bondi', count: 3, settlementId: 'set_1', pool: true }])).toEqual([]);
    expect(() => edit(militaryState(), env, (_d, ctx) => ctx.applyEffects([{ op: 'addMen', unit: 'trolls', count: 3 }]))).toThrow(/unknown unit/);
  });
});

describe('spawnArmy', () => {
  it('creates an army with squads, announces it and remembers its id', () => {
    const s0 = militaryState();
    let events: unknown[] = [];
    const s1 = edit(s0, env, (_d, ctx) => {
      ctx.applyEffects([
        {
          op: 'spawnArmy',
          settlementId: capitalOf(s0),
          tag: 'rebels',
          squads: [
            { unit: 'bondi', men: 40, vetStars: 1 },
            { unit: 'outlaws', men: 15, formation: 'loose' },
          ],
        },
      ]);
      events = [...ctx.events];
    });
    const armyId = s1.military?.lastSpawnedArmyId as ArmyId;
    const army = s1.armies[armyId];
    expect(army).toMatchObject({ ownerId: s0.player.factionId, leaderId: s0.player.rulerId, spawnTag: 'rebels', homeId: capitalOf(s0) });
    expect(army?.squads).toEqual([
      { leaderId: s0.player.rulerId, unit: 'bondi', men: 40, vetStars: 1, formation: 'line', battles: 1 },
      { leaderId: s0.player.rulerId, unit: 'outlaws', men: 15, vetStars: 0, formation: 'loose', battles: 0 },
    ]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'ArmySpawned', armyId, tag: 'rebels' }));
    // Army casualties fall on squads (last first) and empty squads disappear.
    const s2 = edit(s1, env, (_d, ctx) => ctx.applyEffects([{ op: 'killMen', unit: 'outlaws', count: 15, armyId, popLoss: false }]));
    expect(s2.armies[armyId]?.squads.map((q) => q.unit)).toEqual(['bondi']);
  });
});

describe('veterancy after battles', () => {
  /** A stand-in for the battle module: a command that emits BattleEnded like the real sub-sim. */
  const testFight = (draft: GameState, cmd: { battleId: string; fleetId: FleetId; winner: string }, ctx: SimContext): void => {
    if (!draft.fleets[cmd.fleetId]) throw new CommandError('noFleet');
    ctx.emit({
      type: 'BattleEnded',
      battleId: cmd.battleId,
      attackerFactionId: draft.player.factionId,
      defenderFactionId: 'fac_999',
      result: { winner: cmd.winner },
      setup: {
        attacker: { squads: [{ unit: 'bondi', men: 20, sources: [{ kind: 'fleet', id: cmd.fleetId, men: 20 }] }] },
        defender: { squads: [] },
      },
    } as never);
  };
  const fakeBattle: SimModule = { id: 'testBattle', order: 200, handlers: { testFight } as unknown as SimModule['handlers'] };
  const benv = militaryEnv([fakeBattle]);

  it('every source container gains a battle per unit type; victories count for lieutenant loyalty', () => {
    const { state, fleetId } = withFleet(militaryState({ extra: [fakeBattle] }), 'sailing', { bondi: 20, archers: 5 });
    const r1 = dispatch(state, { type: 'testFight', battleId: 'bat_1', fleetId, winner: 'attacker' } as never, benv);
    expect(r1.error).toBeUndefined();
    expect(r1.state.fleets[fleetId]?.vetBattles).toEqual({ bondi: 1 });
    expect(r1.state.military?.monthBattles).toEqual({ won: 1, lost: 0 });
    // The same battle is applied once.
    const r2 = dispatch(r1.state, { type: 'testFight', battleId: 'bat_1', fleetId, winner: 'attacker' } as never, benv);
    expect(r2.state.fleets[fleetId]?.vetBattles).toEqual({ bondi: 1 });
    const r3 = dispatch(r2.state, { type: 'testFight', battleId: 'bat_2', fleetId, winner: 'defender' } as never, benv);
    expect(r3.state.fleets[fleetId]?.vetBattles).toEqual({ bondi: 2 });
    expect(r3.state.military?.monthBattles).toEqual({ won: 1, lost: 1 });
    expect(containerVeterancy(r3.state, content.balance, fleetId, 'bondi').stars).toBe(1);
    expect(missingEventKeys(r3.events)).toEqual([]);
  });
});
