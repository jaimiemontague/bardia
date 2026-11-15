import { getContent } from '@content/index';
import { dispatch } from '@sim/core/dispatch';
import { validateEffects } from '@sim/core/effects';
import { checkInvariants } from '@sim/core/env';
import type { FactionId, GameState, SettlementId } from '@sim/core/state';
import { inDraft, testWorld } from '@sim/testing';
import { describe, expect, it } from 'vitest';
import { module as economy, priceDeal } from './index';
import { readStorehouse } from './storehouse';

const content = getContent();
const perTon = content.balance.economy.rationsPerTon;

function world(seed = 'store') {
  const w = testWorld({ modules: [economy], factions: 2, seed });
  const home = w.state.player.capitalId;
  const rival = w.factionIds[1] as FactionId;
  const foreign = (w.settlementIds[rival] as SettlementId[])[0] as SettlementId;
  // No fleet in the home harbour: the hall trades from its storehouse.
  const state = inDraft(w.state, w.env, (d) => {
    for (const f of Object.values(d.fleets)) if (f.ownerId === d.player.factionId) f.pos = { x: f.pos.x + 50, y: f.pos.y + 50 };
  }).state;
  return { ...w, state, home, foreign };
}

const treasury = (s: GameState) => s.factions[s.player.factionId]?.treasury ?? 0;
const garrison = (s: GameState) => Object.values(s.settlements[s.player.capitalId]?.garrison ?? {}).reduce((a, b) => a + (b ?? 0), 0);

describe('the house storehouse', () => {
  it('starts with provisions for the capital garrison, apart from the market', () => {
    const w = world();
    const store = readStorehouse(w.state);
    const days = content.tunables.economy.storehouse.startRationDays;
    expect(store.rations).toBe(Math.ceil(garrison(w.state) * content.balance.food.rationsPerManPerDay * days));
    expect(store.goods.rations).toBeUndefined();
    expect(checkInvariants(w.state, w.env)).toEqual([]);
  });

  it('trades at the capital without a fleet: goods to and from the storehouse, silver to and from the treasury', () => {
    const w = world();
    const quote = priceDeal(w.state, content, { settlementId: w.home, buy: { salt: 1 } });
    expect(quote.holder).toBe('storehouse');
    expect(quote.purse).toBe('treasury');
    const r = dispatch(w.state, { type: 'trade', settlementId: w.home, buy: { salt: 1 } }, w.env);
    expect(r.error).toBeUndefined();
    expect(readStorehouse(r.state).goods.salt).toBe(1);
    expect(treasury(r.state)).toBe(treasury(w.state) - quote.spent);
    expect(r.state.markets[w.home]?.stock.salt).toBeCloseTo((w.state.markets[w.home]?.stock.salt ?? 0) - 1, 3);
    const done = r.events.find((e) => e.type === 'TradeCompleted') as { storehouse?: boolean; fleetId?: string } | undefined;
    expect(done?.storehouse).toBe(true);
    expect(done?.fleetId).toBeUndefined();
    // Selling it back brings silver (less than it cost: the spread).
    const r2 = dispatch(r.state, { type: 'trade', settlementId: w.home, storehouse: true, sell: { salt: 1 } }, w.env);
    expect(readStorehouse(r2.state).goods.salt).toBeUndefined();
    expect(treasury(r2.state)).toBeGreaterThan(treasury(r.state));
    expect(treasury(r2.state)).toBeLessThan(treasury(w.state));
    expect(checkInvariants(r2.state, w.env)).toEqual([]);
  });

  it('buys and sells rations as a count, converting tons at the market', () => {
    const w = world();
    const before = readStorehouse(w.state).rations;
    const r = dispatch(w.state, { type: 'trade', settlementId: w.home, storehouse: true, buy: { rations: 0.25 } }, w.env);
    expect(r.error).toBeUndefined();
    expect(readStorehouse(r.state).rations).toBe(before + 0.25 * perTon);
    expect(readStorehouse(r.state).goods.rations).toBeUndefined();
  });

  it('refuses what it cannot do', () => {
    const w = world();
    expect(dispatch(w.state, { type: 'trade', settlementId: w.home, storehouse: true, sell: { furs: 1 } }, w.env).error?.code).toBe('notStored');
    expect(dispatch(w.state, { type: 'trade', settlementId: w.foreign, storehouse: true, buy: { salt: 1 } }, w.env).error?.code).toBe('notCapital');
    const poor = inDraft(w.state, w.env, (d) => {
      const f = d.factions[d.player.factionId];
      if (f) f.treasury = 0;
    }).state;
    expect(dispatch(poor, { type: 'trade', settlementId: w.home, storehouse: true, buy: { salt: 1 } }, w.env).error?.code).toBe('notEnoughSilver');
  });

  it('haggles over a storehouse batch', () => {
    const w = world();
    const r = dispatch(w.state, { type: 'haggle', settlementId: w.home, action: 'offer', storehouse: true, buy: { salt: 1 }, askPct: 2 }, w.env);
    expect(r.error).toBeUndefined();
    expect(r.state.economy?.haggle?.storehouse).toBe(true);
    const a = dispatch(r.state, { type: 'haggle', settlementId: w.home, action: 'accept' }, w.env);
    expect(a.error).toBeUndefined();
    expect(readStorehouse(a.state).goods.salt).toBe(1);
  });

  it('changeStores adds and takes (floored at 0); rations never sit among the goods', () => {
    const w = world();
    expect(validateEffects(w.env, [{ op: 'changeStores', goods: { furs: 2 }, rations: 10 }], 'test')).toEqual([]);
    expect(validateEffects(w.env, [{ op: 'changeStores', goods: { rations: 2 } }], 'test').length).toBeGreaterThan(0);
    const r = inDraft(w.state, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'changeStores', goods: { furs: 2 }, rations: 10 }]));
    expect(readStorehouse(r.state).goods.furs).toBe(2);
    expect(readStorehouse(r.state).rations).toBe(readStorehouse(w.state).rations + 10);
    const r2 = inDraft(r.state, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'changeStores', goods: { furs: -5 }, rations: -1_000_000_000 }]));
    expect(readStorehouse(r2.state).goods.furs).toBeUndefined();
    expect(readStorehouse(r2.state).rations).toBe(0);
  });

  it('migrate gives an older save its storehouse and keeps an existing one', () => {
    const w = world();
    const old = structuredClone(w.state) as GameState;
    delete old.storehouse;
    const m = inDraft(old, w.env, (d, ctx) => economy.migrate?.(d, 1, ctx));
    expect(readStorehouse(m.state).rations).toBe(readStorehouse(w.state).rations);
    const kept = inDraft(w.state, w.env, (_d, ctx) => ctx.applyEffects([{ op: 'changeStores', goods: { amber: 1 } }]));
    const again = inDraft(kept.state, w.env, (d, ctx) => economy.migrate?.(d, 1, ctx));
    expect(readStorehouse(again.state).goods.amber).toBe(1);
  });

  it('is deterministic', () => {
    const a = world('det');
    const b = world('det');
    const ra = dispatch(a.state, { type: 'trade', settlementId: a.home, storehouse: true, buy: { iron: 0.5 } }, a.env);
    const rb = dispatch(b.state, { type: 'trade', settlementId: b.home, storehouse: true, buy: { iron: 0.5 } }, b.env);
    expect(JSON.stringify(ra.state)).toBe(JSON.stringify(rb.state));
  });
});
