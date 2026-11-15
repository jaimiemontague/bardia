/**
 * The holdings module with the modules that consume its fields: economy (tax → ledger, building upkeep and
 * market tolls), military (garrison → pool through moveMen, Hall tier → lieutenant capacity, loyalty → pool
 * size). Checks that each field is read where it was already read and nothing is counted twice.
 */
import { getContent } from '@content/index';
import { dispatch } from '@sim/core/dispatch';
import { advance } from '@sim/core/scheduler';
import type { GameState } from '@sim/core/state';
import { createNewGameState } from '@sim/core/lifecycle';
import { HOURS_PER_DAY, HOURS_PER_MONTH } from '@sim/core/time';
import { inDraft, testEnv, testWorld } from '@sim/testing';
import { describe, expect, it } from 'vitest';
import { computeLedger, module as economy, settlementTax } from '../economy/index';
import { module as military } from '../military/index';
import { lieutenantCapacity } from '../military/lieutenants';
import { poolMax } from '../military/pools';
import { module as world } from '../world/index';
import { holdingsInvariants, holdingUpkeep, loyaltyForecast, menAtHome, module as holdings, neededGarrison, tierInfo, withTax } from './index';

const content = getContent();

function realm() {
  const w = testWorld({ modules: [economy, holdings, military], factions: 2, settlementsPerFaction: 2, seed: 'holdings-int' });
  const capital = w.state.player.capitalId;
  const state = inDraft(w.state, w.env, (d) => {
    const f = d.factions[d.player.factionId];
    if (f) f.treasury = 50000;
  }).state;
  return { ...w, state, capital };
}

describe('holdings with economy and military', () => {
  it('the tax level set here is the one the ledger taxes; the preview equals the ledger line', () => {
    const w = realm();
    const fair = computeLedger(w.state, content, w.state.player.factionId);
    const s = w.state.settlements[w.capital]!;
    const preview = Math.round(settlementTax(w.state, content, withTax(s, 'crushing')).amount);
    const r = dispatch(w.state, { type: 'setTax', holdingId: w.capital, tax: 'crushing' }, w.env);
    const crushing = computeLedger(r.state, content, r.state.player.factionId);
    const line = crushing?.breakdown.taxes.find((x) => x.id === w.capital)?.amount;
    expect(line).toBe(preview);
    const before = fair?.breakdown.taxes.find((x) => x.id === w.capital)?.amount ?? 0;
    expect(line).toBe(Math.round(before * 2));
  });

  it('a finished building is charged once by the ledger and read by military (Hall → lieutenants)', () => {
    const w = realm();
    const s0 = w.state.settlements[w.capital]!;
    const hall = s0.buildings['hall'] ?? 0;
    const start = hall >= 3 ? inDraft(w.state, w.env, (d) => void (d.settlements[w.capital]!.buildings['hall'] = 2)).state : w.state;
    const tier = (start.settlements[w.capital]!.buildings['hall'] ?? 0) + 1;
    const capBefore = lieutenantCapacity(start, content, start.player.factionId).capacity;
    const upkeepBefore = computeLedger(start, content, start.player.factionId)?.expenses.buildings ?? 0;
    const q = dispatch(start, { type: 'queueBuilding', holdingId: w.capital, buildingId: 'hall' }, w.env);
    expect(q.error).toBeUndefined();
    const done = advance(q.state, (tierInfo(content, 'hall', tier)?.days ?? 0) * HOURS_PER_DAY + 1, w.env).state;
    expect(done.settlements[w.capital]?.buildings['hall']).toBe(tier);
    expect(lieutenantCapacity(done, content, done.player.factionId).capacity).toBeGreaterThan(capBefore);
    const upkeepAfter = computeLedger(done, content, done.player.factionId)?.expenses.buildings ?? 0;
    const delta = (tierInfo(content, 'hall', tier)?.upkeep ?? 0) - (tierInfo(content, 'hall', tier - 1)?.upkeep ?? 0);
    expect(upkeepAfter - upkeepBefore).toBe(delta);
    expect(holdingUpkeep(content, done.settlements[w.capital]!)).toBe(holdingUpkeep(content, start.settlements[w.capital]!) + delta);
    expect(holdingsInvariants(done)).toEqual([]);
  });

  it('sending men home moves them to the pool once (military moveMen) and their wages stop', () => {
    const w = realm();
    const s = w.state.settlements[w.capital]!;
    const [unit, have] = Object.entries(s.garrison).find(([, n]) => n > 2) as [string, number];
    const wagesBefore = computeLedger(w.state, content, w.state.player.factionId)?.expenses.wages ?? 0;
    const pool = s.holding!.pool.current;
    const r = dispatch(w.state, { type: 'setGarrison', holdingId: w.capital, units: { [unit]: have - 2 } }, w.env);
    expect(r.error).toBeUndefined();
    const after = r.state.settlements[w.capital]!;
    expect(after.garrison[unit]).toBe(have - 2);
    expect(after.holding?.pool.current).toBe(pool + 2);
    const wagesAfter = computeLedger(r.state, content, r.state.player.factionId)?.expenses.wages ?? 0;
    expect(wagesAfter).toBeLessThan(wagesBefore);
  });

  it('loyalty set by the monthly pass sizes military’s recruitment pool', () => {
    const w = realm();
    const low = inDraft(w.state, w.env, (d) => {
      const h = d.settlements[w.capital]?.holding;
      if (h) {
        h.loyalty = 10;
        h.tax = 'crushing';
      }
    }).state;
    const month = advance(low, 30 * HOURS_PER_DAY, w.env).state as GameState;
    const h = month.settlements[w.capital]!.holding!;
    expect(h.loyalty).toBeLessThan(10);
    expect(h.pool.max).toBe(poolMax(content.balance, month.settlements[w.capital]!.pop, h.loyalty));
    expect(holdingsInvariants(month)).toEqual([]);
  });

  it('a fresh game at default settings (Fair tax, the men at home) does not lose capital loyalty over 6 months', () => {
    const env = testEnv([world, economy, holdings, military]);
    for (const seed of ['fresh-a', 'fresh-b', 'fresh-c']) {
      let state = createNewGameState({ seed, difficulty: 'raider' }, env).state;
      const capital = state.player.capitalId;
      const s0 = state.settlements[capital]!;
      expect(s0.holding?.tax).toBe('fair');
      expect(menAtHome(state, content, s0).total).toBeGreaterThanOrEqual(neededGarrison(content, s0));
      expect(loyaltyForecast(state, content, capital).delta).toBeGreaterThanOrEqual(0);
      const start = s0.holding?.loyalty ?? 0;
      // Other modules' rules (economy's arrears, −5 a month) are reported as `external` and kept apart:
      // the holdings pass itself must never lower a fresh capital's loyalty.
      let external = 0;
      for (let m = 0; m < 6; m++) {
        state = advance(state, HOURS_PER_MONTH, env).state;
        expect(state.pending).toBeNull();
        const report = state.holdingsState?.reports[capital];
        expect(report).toBeDefined();
        expect(report!.after).toBeGreaterThanOrEqual(report!.before);
        expect(report!.reasons.some((r) => r.id === 'lowGarrison')).toBe(false);
        external += report!.external;
        expect(state.settlements[capital]?.holding?.loyalty).toBeGreaterThanOrEqual(start + external);
      }
      expect(holdingsInvariants(state)).toEqual([]);
    }
  });
});
