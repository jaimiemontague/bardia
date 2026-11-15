import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { EN_TABLES, missingLocaleKeys } from '@content/locales/index';
import type { Command } from '@sim/core/commands';
import { coreInvariants } from '@sim/core/builtins';
import { dispatch } from '@sim/core/dispatch';
import type { SimEvent } from '@sim/core/events';
import { advance } from '@sim/core/scheduler';
import type { GameState, SettlementId, ShipId } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { inDraft, missingEventKeys, testWorld } from '../../testing';
import { module as military } from './index';
import { militaryInvariants } from './invariants';
import { realmMen } from './men';
import { sellswordOffers } from './lieutenants';
import { edit, militaryEnv, withMarket } from './testing';

/** Timing budgets hold as written in a dedicated run (BARDIA_STRICT_PERF=1, e.g. `npm run perf`); the parallel full suite gets slack. */
const PERF_SLACK = process.env['BARDIA_STRICT_PERF'] === '1' ? 1 : 4;

const content = getContent();

function campaign() {
  const w = testWorld({ modules: [military], factions: 4, settlementsPerFaction: 3, fleetsPerFaction: 1, seed: 'military-campaign' });
  const [capital, second] = w.settlementIds[w.state.player.factionId] as [SettlementId, SettlementId];
  const state = edit(w.state, w.env, (d) => {
    const f = d.factions[d.player.factionId];
    if (f) f.treasury = 100000;
    const c = d.settlements[capital];
    if (c) {
      c.buildings.hall = 3;
      c.buildings.shipyard = 2;
      c.buildings.smithy = 2;
    }
    d.player.house.renown = 150;
  });
  return { ...w, state: withMarket(state, w.env, capital, { iron: 20, timber: 200 }), capital, second };
}

/** A scripted season exercising every command, effect and system. */
function script(start: ReturnType<typeof campaign>): { state: GameState; events: SimEvent[]; errors: string[] } {
  const { env, capital, second } = start;
  let state = start.state;
  const events: SimEvent[] = [];
  const errors: string[] = [];
  const run = (cmd: Command) => {
    const r = dispatch(state, cmd, env);
    if (r.error) errors.push(`${cmd.type}:${r.error.code}`);
    state = r.state;
    events.push(...r.events);
  };
  const wait = (days: number) => {
    const r = advance(state, days * HOURS_PER_DAY, env);
    state = r.state;
    events.push(...r.events);
  };
  run({ type: 'muster', holdingId: capital, units: { bondi: 30, archers: 10, fjordWallHuscarls: 8, berserkers: 5 } });
  run({ type: 'queueShip', holdingId: capital, shipType: 'snekkja' });
  run({ type: 'queueShip', holdingId: capital, shipType: 'karvi', name: 'Storm-Petrel' });
  run({ type: 'upgradeArmoury', track: 'armour' });
  wait(4);
  const docked = Object.values(state.ships).find((s) => s.dockedAt === capital && s.ownerId === state.player.factionId);
  run({ type: 'transfer', fromId: capital, toId: second, men: { bondi: 20 }, ...(docked ? { shipIds: [docked.id] } : {}) });
  const fx = inDraft(state, env, (_d, ctx) => {
    ctx.applyEffects([
      { op: 'killMen', unit: 'bondi', count: 6, wounded: 9, settlementId: capital },
      { op: 'spawnArmy', settlementId: second, squads: [{ unit: 'bondi', men: 12 }], tag: 'test' },
    ]);
  });
  state = fx.state;
  events.push(...fx.events);
  wait(25);
  const offer = sellswordOffers(state, content, capital)[0];
  if (offer) run({ type: 'hireSellsword', settlementId: capital, offer: offer.index });
  state = edit(state, env, (d) => {
    const c = d.settlements[capital];
    if (c) c.vetBattles = { ...(c.vetBattles ?? {}), bondi: 4 };
  });
  run({ type: 'promoteLieutenant', unit: 'bondi', settlementId: capital });
  run({ type: 'muster', holdingId: capital, units: { bondi: 25 } });
  wait(60);
  const atHome = Object.values(state.ships).find((s) => s.ownerId === state.player.factionId && s.dockedAt === capital);
  if (atHome) {
    const id: ShipId = atHome.id;
    state = edit(state, env, (_d, ctx) => ctx.applyEffects([{ op: 'damageShip', shipId: id, hull: 20, sail: 5 }]));
    run({ type: 'repairShip', shipIds: [id] });
  }
  wait(40);
  return { state, events, errors };
}

describe('military module', () => {
  it('runs a scripted season with every command accepted and all invariants holding', () => {
    const start = campaign();
    const { state, events, errors } = script(start);
    expect(errors).toEqual([]);
    expect(militaryInvariants(state, content.balance)).toEqual([]);
    expect(coreInvariants(state)).toEqual([]);
    expect(military.invariants?.(state)).toEqual([]);
    expect(missingEventKeys(events)).toEqual([]);
    const kinds = new Set(events.map((e) => e.type));
    const expected = ['MusterCompleted', 'ShipCompleted', 'ArmouryUpgraded', 'TransferArrived', 'MenLost', 'WoundedRecovered', 'ArmySpawned', 'LieutenantJoined'];
    expect(expected.filter((k) => !kinds.has(k as SimEvent['type']))).toEqual([]);
    // The state stays plain JSON.
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('is deterministic: same seed and inputs give identical JSON', () => {
    const a = script(campaign());
    const b = script(campaign());
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });

  it('init works on a campaign already under way (old save without the module)', () => {
    const w = testWorld({ modules: [], factions: 2 });
    const s = edit(w.state, militaryEnv(), (d, ctx) => military.init?.(d, ctx));
    expect(s.military).toBeDefined();
    const cap = s.settlements[s.player.capitalId];
    expect(cap?.holding?.pool.current).toBe(cap?.holding?.pool.max);
    expect(militaryInvariants(s, content.balance)).toEqual([]);
  });

  it('keeps every invariant under random command and effect sequences', () => {
    const start = campaign();
    const { env, capital, second } = start;
    const unitArb = fc.constantFrom('bondi', 'archers', 'skirmishers', 'fjordWallHuscarls', 'berserkers', 'wolfcoats');
    const holdingArb = fc.constantFrom(capital, second);
    const step = fc.oneof(
      fc.record({ k: fc.constant('muster' as const), h: holdingArb, u: unitArb, n: fc.integer({ min: 0, max: 60 }) }),
      fc.record({ k: fc.constant('ship' as const), t: fc.constantFrom('karvi', 'knarr', 'snekkja', 'drakkar') }),
      fc.record({ k: fc.constant('armoury' as const), w: fc.boolean() }),
      fc.record({ k: fc.constant('transfer' as const), n: fc.integer({ min: 0, max: 40 }), back: fc.boolean() }),
      fc.record({ k: fc.constant('kill' as const), u: unitArb, n: fc.integer({ min: 0, max: 50 }), w: fc.integer({ min: 0, max: 30 }) }),
      fc.record({ k: fc.constant('damage' as const), i: fc.nat(10), hull: fc.integer({ min: 0, max: 200 }) }),
      fc.record({ k: fc.constant('wait' as const), d: fc.integer({ min: 1, max: 20 }) }),
    );
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 25 }), (steps) => {
        let s = start.state;
        for (const st of steps) {
          if (st.k === 'muster') s = dispatch(s, { type: 'muster', holdingId: st.h, units: { [st.u]: st.n } }, env).state;
          else if (st.k === 'ship') s = dispatch(s, { type: 'queueShip', holdingId: capital, shipType: st.t }, env).state;
          else if (st.k === 'armoury') s = dispatch(s, { type: 'upgradeArmoury', track: st.w ? 'weapons' : 'armour' }, env).state;
          else if (st.k === 'transfer') {
            const [from, to] = st.back ? [second, capital] : [capital, second];
            s = dispatch(s, { type: 'transfer', fromId: from, toId: to, men: { bondi: st.n } }, env).state;
          } else if (st.k === 'kill') {
            s = edit(s, env, (_d, ctx) => ctx.applyEffects([{ op: 'killMen', unit: st.u, count: st.n, wounded: st.w, settlementId: capital }]));
          } else if (st.k === 'damage') {
            const ids = Object.keys(s.ships) as ShipId[];
            const id = ids[st.i % Math.max(1, ids.length)];
            if (id) s = edit(s, env, (_d, ctx) => ctx.applyEffects([{ op: 'damageShip', shipId: id, hull: st.hull }]));
          } else s = advance(s, st.d * HOURS_PER_DAY, env).state;
        }
        expect(militaryInvariants(s, content.balance)).toEqual([]);
        expect(coreInvariants(s)).toEqual([]);
        expect(realmMen(s, s.player.factionId).total).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 30 },
    );
  });

  it('has a string for every error code a command can return', () => {
    const codes = [
      'notYourHolding', 'cooldown', 'noUnits', 'badCount', 'unknownUnit', 'notRecruitable', 'requirement', 'berserkerCap', 'poolExhausted',
      'treasury', 'fleetNotInHarbour', 'maxTier', 'smithy', 'iron', 'unknownShip', 'notBuildable', 'shipyard', 'queueFull', 'timber',
      'notYourShip', 'noShipyard', 'nothingToRepair', 'sameHolding', 'nothingToSend', 'notEnoughMen', 'shipNotHere', 'noMarket',
      'notEnoughGoods', 'noSellswords', 'notPresent', 'unknownOffer', 'alreadyHired', 'capacity', 'badSource', 'notYours', 'noMen', 'tooGreen',
    ];
    expect(missingLocaleKeys(codes.map((c) => `military.error.${c}`))).toEqual([]);
    const table = EN_TABLES.military as Record<string, string>;
    for (const unit of Object.keys(content.balance.units).filter((u) => content.balance.units[u]?.side === 'player')) {
      expect(table[`military.unit.${unit}`]).toBeTypeOf('string');
    }
  });

  it('stays within the per-day budget on a large world', () => {
    const w = testWorld({ modules: [military], factions: 30, settlementsPerFaction: 5, fleetsPerFaction: 5, seed: 'military-perf' });
    let s = edit(w.state, w.env, (d) => {
      // Wounded everywhere and beached fleets: the daily passes have real work.
      for (const f of Object.values(d.fleets)) {
        f.woundedMen = [{ unit: 'bondi', count: 3, progress: 0, battles: 1, sinceHour: d.time.hour, rate: 1 / 60 }];
        f.mode = 'beached';
        f.cargo.timber = 50;
      }
      for (const st of Object.values(d.settlements)) st.woundedMen = [{ unit: 'bondi', count: 2, progress: 0, battles: 0, sinceHour: d.time.hour, rate: 1 / 30 }];
    });
    s = advance(s, HOURS_PER_DAY, w.env).state; // warm-up
    const t0 = performance.now();
    const daysRun = 60;
    s = advance(s, daysRun * HOURS_PER_DAY, w.env).state;
    const perDay = (performance.now() - t0) / daysRun;
    console.info(`military perf: ${perDay.toFixed(3)} ms/day (core + military, 150 settlements, 150 fleets, all wounded/beached)`);
    expect(militaryInvariants(s, content.balance)).toEqual([]);
    // Core + military only, on a load far heavier than play (every settlement and fleet wounded, every
    // fleet beached); the §29.8 budget for the whole registry is 2 ms/day. Measured ≈ 0.3 ms/day.
    expect(perDay).toBeLessThan(1 * PERF_SLACK);
  });
});
