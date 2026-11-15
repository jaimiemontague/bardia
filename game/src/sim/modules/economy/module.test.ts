import { getContent } from '@content/index';
import { dispatch } from '@sim/core/dispatch';
import { validateEffects } from '@sim/core/effects';
import { checkInvariants } from '@sim/core/env';
import type { SimEvent } from '@sim/core/events';
import { createShip, getOrCreateRelation } from '@sim/core/factory';
import { createNewGameState } from '@sim/core/lifecycle';
import { advance } from '@sim/core/scheduler';
import type { FactionId, FleetId, GameState, SettlementId, ShipId } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { inDraft, missingEventKeys, testEnv, testWorld } from '@sim/testing';
import { describe, expect, it } from 'vitest';
import { module as world } from '../world/index';
import { computeLedger, haggleChance, marketPrice, module as economy, portableWealth, priceDeal, priceFormula, routeSlots } from './index';
import { buyValue, goodPriceInput, sellValue } from './price';
import { readEconomy } from './slice';

/** Timing budgets hold as written in a dedicated run (BARDIA_STRICT_PERF=1, e.g. `npm run perf`); the parallel full suite gets slack. */
const PERF_SLACK = process.env['BARDIA_STRICT_PERF'] === '1' ? 1 : 4;

const content = getContent();
const balance = content.balance;

function eventsOf<K extends SimEvent['type']>(events: readonly SimEvent[], type: K): Extract<SimEvent, { type: K }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);
}

function tw(seed = 'eco') {
  const w = testWorld({ modules: [economy], factions: 3, seed });
  const player = w.factionIds[0] as FactionId;
  const rival = w.factionIds[1] as FactionId;
  const home = w.state.player.capitalId;
  const foreign = (w.settlementIds[rival] as SettlementId[])[0] as SettlementId;
  const fleetId = (w.fleetIds[player] as FleetId[])[0] as FleetId;
  return { ...w, player, rival, home, foreign, fleetId };
}

/** Moves the player's fleet to a settlement's harbour (docked). */
function dockAt(state: GameState, env: ReturnType<typeof tw>['env'], fleetId: FleetId, at: SettlementId): GameState {
  return inDraft(state, env, (d) => {
    const f = d.fleets[fleetId];
    const s = d.settlements[at];
    if (f && s) {
      f.pos = { ...s.mapPos };
      f.mode = 'docked';
    }
  }).state;
}

describe('prices (§11.2)', () => {
  it('price = base × clamp((T / max(S, 1))^0.6, 0.4, 3) × region × event', () => {
    expect(priceFormula(balance, 100, 10, 10)).toBeCloseTo(100);
    expect(priceFormula(balance, 100, 40, 10)).toBeCloseTo(100 * 4 ** 0.6, 6);
    expect(priceFormula(balance, 100, 10, 0)).toBe(300); // (10 / 1)^0.6 ≈ 3.98, clamped to 3
    expect(priceFormula(balance, 100, 5, 0)).toBeCloseTo(100 * 5 ** 0.6, 6);
    expect(priceFormula(balance, 100, 1000, 1)).toBe(300);
    expect(priceFormula(balance, 100, 1, 1000)).toBe(40);
    expect(priceFormula(balance, 100, 10, 10, 1.2, 3)).toBeCloseTo(360);
  });

  it('a trade moves the price while it happens; buying and selling back always loses silver', () => {
    const input = { base: 100, target: 20, stock: 20, mod: 1 };
    const buy = buyValue(balance, input, 10);
    expect(buy).toBeGreaterThan(100 * 10); // the stock falls: dearer as you buy
    const after = { ...input, stock: 10 };
    const sell = sellValue(balance, after, 10);
    expect(sell).toBeCloseTo(buy, 6); // the integral is path-independent …
    const w = tw();
    const s = dockAt(w.state, w.env, w.fleetId, w.home);
    const deal = priceDeal(s, content, { settlementId: w.home, buy: { salt: 3 } });
    const s2 = dispatch(s, { type: 'trade', settlementId: w.home, buy: { salt: 3 } }, w.env).state;
    const back = priceDeal(s2, content, { settlementId: w.home, sell: { salt: 3 } });
    expect(back.earned).toBeLessThan(deal.spent); // … but the spread is paid twice
  });
});

describe('markets', () => {
  it('exist for every settlement after init, and stay valid through a year', () => {
    const env = testEnv([world, economy]);
    let s = createNewGameState({ seed: 'markets' }, env).state;
    for (const id of Object.keys(s.settlements)) expect(Object.hasOwn(s.markets, id), id).toBe(true);
    expect(checkInvariants(s, env)).toEqual([]);
    const events: SimEvent[] = [];
    for (let m = 0; m < 12; m++) {
      const r = advance(s, 30 * HOURS_PER_DAY, env);
      s = r.state;
      events.push(...r.events);
    }
    expect(checkInvariants(s, env)).toEqual([]);
    expect(eventsOf(events, 'LedgerReport')).toHaveLength(12);
    expect(missingEventKeys(events)).toEqual([]);
  });

  it('merchants carry goods between markets along the world lanes (prices converge)', () => {
    const env = testEnv([world, economy]);
    const s0 = createNewGameState({ seed: 'flows' }, env).state;
    const spread = (s: GameState) => {
      const prices = Object.keys(s.settlements)
        .filter((id) => s.settlements[id as SettlementId]?.tier === 'town')
        .map((id) => marketPrice(s, content, id as SettlementId, 'salt'));
      const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
      return Math.sqrt(prices.reduce((a, b) => a + (b - mean) ** 2, 0) / prices.length) / mean;
    };
    expect(spread(s0)).toBeLessThan(0.6);
    expect(Object.values(s0.markets).some((m) => (m.tradeVolume ?? 0) > 0)).toBe(true);
  });

  it('a monthly market pass and the ledgers of every house fit the month budget (≤ 10 ms, §29.8)', () => {
    const env = testEnv([world, economy]);
    let s = createNewGameState({ seed: 'perf' }, env).state;
    s = advance(s, 29 * HOURS_PER_DAY, env).state;
    const t0 = performance.now();
    s = advance(s, HOURS_PER_DAY, env).state;
    const ms = performance.now() - t0;
    expect(readEconomy(s).lastReport).toBeDefined();
    expect(ms).toBeLessThan(10 * PERF_SLACK);
  });
});

describe('trade (§11.3)', () => {
  it('buys at home from the treasury into the hold, and sells back', () => {
    const w = tw();
    let s = dockAt(w.state, w.env, w.fleetId, w.home);
    const before = s.factions[w.player]?.treasury ?? 0;
    const stock = s.markets[w.home]?.stock.salt ?? 0;
    const r = dispatch(s, { type: 'trade', settlementId: w.home, buy: { salt: 2 } }, w.env);
    expect(r.error).toBeUndefined();
    s = r.state;
    const done = eventsOf(r.events, 'TradeCompleted')[0];
    expect(done?.bought).toEqual({ salt: 2 });
    expect(s.factions[w.player]?.treasury).toBe(before - (done?.spent ?? 0));
    expect(s.fleets[w.fleetId]?.cargo.salt).toBe(2);
    expect(s.markets[w.home]?.stock.salt).toBeCloseTo(stock - 2, 3);
    const r2 = dispatch(s, { type: 'trade', settlementId: w.home, sell: { salt: 2 } }, w.env);
    expect(r2.state.fleets[w.fleetId]?.cargo.salt).toBeUndefined();
    expect(r2.state.factions[w.player]?.treasury).toBeGreaterThan(s.factions[w.player]?.treasury ?? 0);
  });

  it('abroad, the fleet pays and carries the proceeds; a tariff applies', () => {
    const w = tw();
    const s = dockAt(w.state, w.env, w.fleetId, w.foreign);
    const silver = s.fleets[w.fleetId]?.silver ?? 0;
    const home = dockAt(w.state, w.env, w.fleetId, w.home);
    const priceHome = priceDeal(home, content, { settlementId: w.home, buy: { salt: 0.5 } });
    const priceAway = priceDeal(s, content, { settlementId: w.foreign, buy: { salt: 0.5 } });
    expect(priceAway.tariff).toBeGreaterThan(0);
    expect(priceHome.tariff).toBe(0);
    const r = dispatch(s, { type: 'trade', settlementId: w.foreign, buy: { salt: 0.5 } }, w.env);
    expect(r.error).toBeUndefined();
    expect(r.state.fleets[w.fleetId]?.silver).toBe(silver - priceAway.spent);
    expect(r.state.factions[w.player]?.treasury).toBe(s.factions[w.player]?.treasury);
  });

  it('rations are carried as a count', () => {
    const w = tw();
    const s = dockAt(w.state, w.env, w.fleetId, w.home);
    const r = dispatch(s, { type: 'trade', settlementId: w.home, buy: { rations: 1 } }, w.env);
    expect(r.error).toBeUndefined();
    expect(r.state.fleets[w.fleetId]?.rations).toBe((s.fleets[w.fleetId]?.rations ?? 0) + balance.economy.rationsPerTon);
    expect(r.state.fleets[w.fleetId]?.cargo.rations).toBeUndefined();
  });

  it('refuses: no fleet in the harbour, empty stock, a full hold, an empty purse, war', () => {
    const w = tw();
    const at = dockAt(w.state, w.env, w.fleetId, w.home);
    const sailing = inDraft(at, w.env, (d) => {
      const f = d.fleets[w.fleetId];
      if (f) f.mode = 'sailing';
    }).state;
    expect(dispatch(sailing, { type: 'trade', settlementId: w.home, buy: { salt: 1 } }, w.env).error?.code).toBe('notInHarbour');
    expect(dispatch(at, { type: 'trade', settlementId: w.home, buy: { salt: 9999 } }, w.env).error?.code).toMatch(/tooMuch|notInStock/);
    expect(dispatch(at, { type: 'trade', settlementId: w.home, sell: { silk: 1 } }, w.env).error?.code).toBe('notAboard');
    const full = inDraft(at, w.env, (d) => {
      const m = d.markets[w.home];
      if (m) m.stock.timber = 500;
    }).state;
    expect(dispatch(full, { type: 'trade', settlementId: w.home, buy: { timber: 100 } }, w.env).error?.code).toBe('holdFull');
    const poor = inDraft(at, w.env, (d) => {
      const f = d.factions[w.player];
      if (f) f.treasury = 0;
    }).state;
    expect(dispatch(poor, { type: 'trade', settlementId: w.home, buy: { salt: 1 } }, w.env).error?.code).toBe('notEnoughSilver');
    const away = dockAt(w.state, w.env, w.fleetId, w.foreign);
    const war = inDraft(away, w.env, (d) => {
      getOrCreateRelation(d, w.player, w.rival).stance = 'war';
    }).state;
    expect(dispatch(war, { type: 'trade', settlementId: w.foreign, buy: { salt: 1 } }, w.env).error?.code).toBe('embargo');
  });
});

describe('haggling (§11.3)', () => {
  it('offers get a response; accepting closes the deal at the offer; at most 3 rounds', () => {
    const w = tw('haggle');
    let s = dockAt(w.state, w.env, w.fleetId, w.home);
    const plain = priceDeal(s, content, { settlementId: w.home, buy: { salt: 2 } });
    let last: Extract<SimEvent, { type: 'HaggleResponse' }> | undefined;
    for (let round = 1; round <= 3; round++) {
      const r = dispatch(s, { type: 'haggle', settlementId: w.home, action: 'offer', buy: { salt: 2 }, askPct: 4 }, w.env);
      if (r.error?.code === 'haggleFinal') break;
      expect(r.error).toBeUndefined();
      s = r.state;
      last = eventsOf(r.events, 'HaggleResponse')[0];
      expect(last?.round).toBe(round);
      if (last?.final) break;
    }
    expect(last?.final).toBe(true);
    expect(dispatch(s, { type: 'haggle', settlementId: w.home, action: 'offer', askPct: 4 }, w.env).error?.code).toBe('haggleFinal');
    const r = dispatch(s, { type: 'haggle', settlementId: w.home, action: 'accept' }, w.env);
    expect(r.error).toBeUndefined();
    const done = eventsOf(r.events, 'TradeCompleted')[0];
    expect(done?.haggledPct).toBe(last?.offerPct);
    if ((last?.offerPct ?? 0) > 0) expect(done?.spent).toBeLessThan(plain.spent);
    expect(readEconomy(r.state).haggle).toBeUndefined();
    expect(missingEventKeys(r.events)).toEqual([]);
  });

  it('the acceptance chance rises with Speechcraft and rapport, falls with greed and the ask', () => {
    const base = haggleChance(content, 3, 0, 0.5, 5, 1);
    expect(haggleChance(content, 6, 0, 0.5, 5, 1)).toBeGreaterThan(base);
    expect(haggleChance(content, 3, 30, 0.5, 5, 1)).toBeGreaterThan(base);
    expect(haggleChance(content, 3, 0, 0.8, 5, 1)).toBeLessThan(base);
    expect(haggleChance(content, 3, 0, 0.5, 12, 1)).toBeLessThan(base);
    expect(haggleChance(content, 3, 0, 0.5, 5, 3)).toBeLessThan(base);
  });

  it('walking away ends the session; a bad ask is refused', () => {
    const w = tw('walk');
    let s = dockAt(w.state, w.env, w.fleetId, w.home);
    expect(dispatch(s, { type: 'haggle', settlementId: w.home, action: 'offer', buy: { salt: 1 }, askPct: 99 }, w.env).error?.code).toBe('badAsk');
    s = dispatch(s, { type: 'haggle', settlementId: w.home, action: 'offer', buy: { salt: 1 }, askPct: 3 }, w.env).state;
    const r = dispatch(s, { type: 'haggle', settlementId: w.home, action: 'walkAway' }, w.env);
    expect(r.error).toBeUndefined();
    expect(readEconomy(r.state).haggle).toBeUndefined();
    expect(dispatch(r.state, { type: 'haggle', settlementId: w.home, action: 'accept' }, w.env).error?.code).toBe('noHaggle');
  });
});

describe('trade routes (§11.4)', () => {
  function withKnarr(w: ReturnType<typeof tw>): { state: GameState; shipId: ShipId } {
    let shipId = '' as ShipId;
    const state = inDraft(w.state, w.env, (d, ctx) => {
      shipId = createShip(d, ctx, { type: 'knarr', ownerId: w.player, dockedAt: w.home }).id;
      const f = d.factions[w.player];
      if (f) f.treasury = 5000;
    }).state;
    return { state, shipId };
  }

  it('runs monthly, puts its profit in the ledger, and can be cleared', () => {
    const w = tw('route');
    const { state, shipId } = withKnarr(w);
    const r = dispatch(state, { type: 'setTradeRoute', shipId, fromId: w.home, toId: w.foreign, outbound: ['salt', 'timber'], inbound: ['cloth'] }, w.env);
    expect(r.error).toBeUndefined();
    const set = eventsOf(r.events, 'TradeRouteChanged')[0];
    expect(set?.change).toBe('set');
    const routeId = set?.routeId as string;
    expect(r.state.ships[shipId]?.tradeRouteId).toBe(routeId);
    const month = advance(r.state, 30 * HOURS_PER_DAY, w.env);
    const report = eventsOf(month.events, 'LedgerReport')[0]?.report;
    expect(report?.breakdown.tradeRoutes.map((i) => i.id)).toContain(routeId);
    expect(report?.breakdown.factors.map((i) => i.id)).toContain(routeId);
    const route = readEconomy(month.state).routes[routeId as never];
    if (route) expect(route.trips).toBeGreaterThan(0);
    expect(checkInvariants(month.state, w.env)).toEqual([]);
    const cleared = dispatch(month.state, { type: 'clearTradeRoute', routeId: routeId as never }, w.env);
    expect(cleared.error).toBeUndefined();
    expect(readEconomy(cleared.state).routes[routeId as never]).toBeUndefined();
    expect(cleared.state.ships[shipId]?.tradeRouteId).toBeUndefined();
  });

  it('refuses a snekkja, a second route beyond the slots, and the same market twice; war suspends', () => {
    const w = tw('route2');
    const { state, shipId } = withKnarr(w);
    const snekkja = Object.values(state.ships).find((s) => s.ownerId === w.player && s.type === 'snekkja' && s.locationFleetId === undefined);
    if (snekkja) expect(dispatch(state, { type: 'setTradeRoute', shipId: snekkja.id, fromId: w.home, toId: w.foreign, outbound: ['salt'] }, w.env).error?.code).toBe('wrongShip');
    expect(dispatch(state, { type: 'setTradeRoute', shipId, fromId: w.home, toId: w.home, outbound: ['salt'] }, w.env).error?.code).toBe('sameMarket');
    const one = dispatch(state, { type: 'setTradeRoute', shipId, fromId: w.home, toId: w.foreign, outbound: ['salt'] }, w.env).state;
    expect(routeSlots(one, content)).toBe(1);
    const second = inDraft(one, w.env, (d, ctx) => {
      createShip(d, ctx, { type: 'knarr', ownerId: w.player, dockedAt: w.home });
    }).state;
    const other = Object.values(second.ships).find((s) => s.type === 'knarr' && s.tradeRouteId === undefined) as { id: ShipId };
    expect(dispatch(second, { type: 'setTradeRoute', shipId: other.id, fromId: w.home, toId: w.foreign, outbound: ['salt'] }, w.env).error?.code).toBe('noSlot');
    const war = inDraft(one, w.env, (d) => {
      getOrCreateRelation(d, w.player, w.rival).stance = 'war';
    }).state;
    const month = advance(war, 30 * HOURS_PER_DAY, w.env);
    expect(eventsOf(month.events, 'TradeRouteChanged').some((e) => e.change === 'suspended' && e.reason === 'war')).toBe(true);
  });
});

describe('ledger and arrears (§11.5, §11.7)', () => {
  it('the starting Raider jarldom roughly breaks even-plus (§31.1 sanity ≈ +67 s/month)', () => {
    const env = testEnv([world, economy]);
    const s = createNewGameState({ seed: 'ledger', difficulty: 'raider' }, env).state;
    const l = computeLedger(s, content, s.player.factionId);
    expect(l).toBeDefined();
    expect(l?.income.taxes).toBeGreaterThan(0);
    expect(l?.expenses.wages).toBeGreaterThan(0);
    expect(l?.net).toBeGreaterThan(-40);
    expect(l?.net).toBeLessThan(300);
  });

  it('an empty treasury runs up arrears; the men desert and grumble; paying clears it', () => {
    const w = tw('arrears');
    const broke = inDraft(w.state, w.env, (d) => {
      const f = d.factions[w.player];
      if (f) f.treasury = 0;
      for (const sid of f?.holdingIds ?? []) {
        const s = d.settlements[sid];
        if (s) {
          s.pop = 10;
          s.garrison = { huscarls: 200 };
        }
      }
    }).state;
    const r = advance(broke, 30 * HOURS_PER_DAY, w.env);
    const a = readEconomy(r.state).arrears[w.player];
    expect(a?.amount).toBeGreaterThan(0);
    expect(eventsOf(r.events, 'ArrearsChanged').length).toBeGreaterThan(0);
    const men = Object.values(r.state.settlements[w.home]?.garrison ?? {}).reduce((x, y) => x + y, 0);
    expect(men).toBeLessThan(200);
    expect(missingEventKeys(r.events)).toEqual([]);
    const rich = inDraft(r.state, w.env, (d) => {
      const f = d.factions[w.player];
      if (f) f.treasury = 100000;
    }).state;
    const r2 = advance(rich, 30 * HOURS_PER_DAY, w.env);
    expect(readEconomy(r2.state).arrears[w.player]?.amount ?? 0).toBe(0);
  });
});

describe('the ledger pause card', () => {
  it('with the policy set, the monthly tally stops time on a message card with the storehouse picture', () => {
    const w = tw('ledger-pause');
    const s = inDraft(w.state, w.env, (d) => {
      d.player.policies.ledgerPause = 'always';
    }).state;
    const r = advance(s, 40 * HOURS_PER_DAY, w.env);
    const p = r.state.pending;
    expect(p?.kind).toBe('message');
    if (p?.kind !== 'message') throw new Error('no ledger card');
    expect(p.payload).toMatchObject({ key: 'economy.ledger.pause', illustration: 'narrative.vignette.storehouse' });
  });
});

describe('changeEconomy', () => {
  it('validates and applies state steps, famine prices, stock losses and blockades', () => {
    const w = tw('change');
    expect(validateEffects(w.env, [{ op: 'changeEconomy', settlementId: w.home, steps: 1 }])).toEqual([]);
    expect(validateEffects(w.env, [{ op: 'changeEconomy', settlementId: w.home }])).not.toEqual([]);
    const s0 = w.state.settlements[w.home];
    const rationsBefore = marketPrice(w.state, content, w.home, 'rations');
    const r = inDraft(w.state, w.env, (_d, ctx) =>
      ctx.applyEffects([
        { op: 'changeEconomy', settlementId: w.home, set: 'poor' },
        { op: 'changeEconomy', settlementId: w.home, preset: 'famine' },
        { op: 'changeEconomy', settlementId: w.home, stockPct: -50 },
        { op: 'changeEconomy', settlementId: w.foreign, blockadeDays: 10 },
      ]),
    );
    if (s0?.economy !== 'poor') expect(eventsOf(r.events, 'EconomyChanged')[0]).toMatchObject({ settlementId: w.home, to: 'poor' });
    expect(r.state.settlements[w.home]?.economy).toBe('poor');
    expect(marketPrice(r.state, content, w.home, 'rations')).toBeGreaterThan(rationsBefore * 2);
    expect(r.state.markets[w.home]?.stock.salt).toBeCloseTo((w.state.markets[w.home]?.stock.salt ?? 0) * 0.5, 2);
    const away = dockAt(r.state, w.env, w.fleetId, w.foreign);
    expect(dispatch(away, { type: 'trade', settlementId: w.foreign, buy: { salt: 0.5 } }, w.env).error?.code).toBe('blockaded');
    expect(missingEventKeys(r.events)).toEqual([]);
  });

  it('portable wealth = silver + 0.7 × goods value (§31.20)', () => {
    const w = tw('loot');
    const s = w.state.settlements[w.home];
    const pw = portableWealth(w.state, content, w.home);
    expect(pw).toBeGreaterThan(s?.silver ?? 0);
    const input = goodPriceInput(w.state, content, w.home, 'salt');
    expect(input.base).toBe(balance.goods.salt.basePerTon);
  });
});

describe('determinism', () => {
  it('two runs from one seed match', () => {
    const run = () => {
      const w = tw('det');
      let s = dockAt(w.state, w.env, w.fleetId, w.home);
      s = dispatch(s, { type: 'haggle', settlementId: w.home, action: 'offer', buy: { salt: 1 }, askPct: 5 }, w.env).state;
      s = advance(s, 90 * HOURS_PER_DAY, w.env).state;
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });
});
