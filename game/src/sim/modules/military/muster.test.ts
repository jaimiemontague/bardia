import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { dispatch } from '@sim/core/dispatch';
import { createFleet } from '@sim/core/factory';
import type { FleetId, GameState } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { missingEventKeys } from '../../testing';
import { musterPreview } from './muster';
import { capitalOf, days, edit, militaryEnv, militaryState, mustDispatch } from './testing';

const content = getContent();
const env = militaryEnv();

function fresh(culture: 'skarn' | 'hvarn' | 'eyjar' = 'skarn'): GameState {
  return militaryState({ player: { culture } });
}

describe('muster', () => {
  it('several unit types in one transaction: bounty paid, pool drawn, men arrive after the gathering days', () => {
    const s0 = fresh();
    const cap = capitalOf(s0);
    const treasury = s0.factions[s0.player.factionId]?.treasury ?? 0;
    const r = mustDispatch(s0, env, { type: 'muster', holdingId: cap, units: { bondi: 20, archers: 10 } });
    const s1 = r.state;
    expect(s1.factions[s1.player.factionId]?.treasury).toBe(treasury - (20 * 10 + 10 * 25));
    expect(s1.settlements[cap]?.holding?.pool.current).toBe(220 - 30);
    expect(s1.settlements[cap]?.holding?.lastMusterHour).toBe(0);
    expect(s1.settlements[cap]?.garrison).toEqual({ bondi: 40, archers: 20 });
    expect(s1.military?.musters).toHaveLength(1);

    const before = days(s1, env, 2).state;
    expect(before.settlements[cap]?.garrison).toEqual({ bondi: 40, archers: 20 });
    const after = days(s1, env, 3);
    expect(after.state.settlements[cap]?.garrison).toEqual({ bondi: 60, archers: 30 });
    expect(after.state.military?.musters).toHaveLength(0);
    const done = after.events.find((e) => e.type === 'MusterCompleted');
    expect(done).toMatchObject({ type: 'MusterCompleted', holdingId: cap, total: 30, units: { bondi: 20, archers: 10 } });
    expect(missingEventKeys(after.events)).toEqual([]);
  });

  it('arrives exactly gatherDays after the muster', () => {
    const s0 = fresh();
    const s1 = mustDispatch(s0, env, { type: 'muster', holdingId: capitalOf(s0), units: { bondi: 5 } }).state;
    const gather = content.balance.recruit.gatherDays * HOURS_PER_DAY;
    expect(s1.military?.nextDueHour).toBe(gather);
  });

  it('enforces the 20-day cooldown per holding', () => {
    const s0 = fresh();
    const cap = capitalOf(s0);
    const s1 = mustDispatch(s0, env, { type: 'muster', holdingId: cap, units: { bondi: 5 } }).state;
    const again = dispatch(s1, { type: 'muster', holdingId: cap, units: { bondi: 5 } }, env);
    expect(again.error?.code).toBe('cooldown');
    expect(again.state).toBe(s1);
    const s2 = days(s1, env, 19).state;
    expect(dispatch(s2, { type: 'muster', holdingId: cap, units: { bondi: 5 } }, env).error?.code).toBe('cooldown');
    const s3 = days(s2, env, 1).state;
    expect(dispatch(s3, { type: 'muster', holdingId: cap, units: { bondi: 5 } }, env).error).toBeUndefined();
  });

  it('rejects more men than the pool holds, unaffordable bounties and empty musters', () => {
    const s0 = fresh();
    const cap = capitalOf(s0);
    expect(dispatch(s0, { type: 'muster', holdingId: cap, units: { bondi: 221 } }, env).error?.code).toBe('poolExhausted');
    const poor = edit(s0, env, (d) => {
      const f = d.factions[d.player.factionId];
      if (f) f.treasury = 99;
    });
    expect(dispatch(poor, { type: 'muster', holdingId: cap, units: { bondi: 10 } }, env).error?.code).toBe('treasury');
    expect(dispatch(s0, { type: 'muster', holdingId: cap, units: {} }, env).error?.code).toBe('noUnits');
    expect(dispatch(s0, { type: 'muster', holdingId: cap, units: { bondi: 0 } }, env).error?.code).toBe('noUnits');
    expect(dispatch(s0, { type: 'muster', holdingId: cap, units: { bondi: -3 } }, env).error?.code).toBe('invalidCommand');
    expect(dispatch(s0, { type: 'muster', holdingId: cap, units: { dragonRiders: 3 } }, env).error?.code).toBe('unknownUnit');
    expect(dispatch(s0, { type: 'muster', holdingId: 'set_999999', units: { bondi: 3 } }, env).error?.code).toBe('notYourHolding');
  });

  it('huscarls: the Skarn unique replaces the base type and needs Hall II', () => {
    const s0 = fresh('skarn');
    const cap = capitalOf(s0);
    const base = dispatch(s0, { type: 'muster', holdingId: cap, units: { huscarls: 5 } }, env);
    expect(base.error?.code).toBe('requirement');
    const noHall = dispatch(s0, { type: 'muster', holdingId: cap, units: { fjordWallHuscarls: 5 } }, env);
    expect(noHall.error?.code).toBe('requirement');
    expect(noHall.error?.details).toMatchObject({ detail: 'hall:2' });
    const hall2 = edit(s0, env, (d) => {
      const c = d.settlements[cap];
      if (c) c.buildings.hall = 2;
    });
    expect(dispatch(hall2, { type: 'muster', holdingId: cap, units: { fjordWallHuscarls: 5 } }, env).error).toBeUndefined();
    // Another culture's unique is never available.
    expect(dispatch(hall2, { type: 'muster', holdingId: cap, units: { strandRiders: 5 } }, env).error?.code).toBe('requirement');
  });

  it('Hvarn holdings raise Elk-Bow Archers (−20% bounty) instead of archers', () => {
    const s0 = fresh('hvarn');
    const cap = capitalOf(s0);
    expect(dispatch(s0, { type: 'muster', holdingId: cap, units: { archers: 5 } }, env).error?.code).toBe('requirement');
    const p = musterPreview(s0, content, { holdingId: cap, units: { elkBowArchers: 5 } });
    expect(p.ok).toBe(true);
    expect(p.lines[0]?.bountyEach).toBe(20);
    expect(p.bounty).toBe(100);
  });

  it('berserkers: cap = floor(renown / 10) and only with Old Ways Favor ≥ 0', () => {
    const s0 = fresh();
    const cap = capitalOf(s0);
    expect(dispatch(s0, { type: 'muster', holdingId: cap, units: { berserkers: 1 } }, env).error?.code).toBe('requirement');
    const famous = edit(s0, env, (d) => {
      d.player.house.renown = 200;
    });
    expect(dispatch(famous, { type: 'muster', holdingId: cap, units: { berserkers: 21 } }, env).error?.code).toBe('berserkerCap');
    const ok = mustDispatch(famous, env, { type: 'muster', holdingId: cap, units: { berserkers: 20 } }).state;
    // Berserkers already gathering count against the cap.
    const later = days(ok, env, 25).state;
    expect(dispatch(later, { type: 'muster', holdingId: cap, units: { berserkers: 1 } }, env).error?.code).toBe('berserkerCap');
    const faithless = edit(famous, env, (d) => {
      for (const god of Object.keys(d.player.house.favor) as (keyof typeof d.player.house.favor)[]) d.player.house.favor[god] = -10;
    });
    expect(dispatch(faithless, { type: 'muster', holdingId: cap, units: { berserkers: 1 } }, env).error?.code).toBe('requirement');
  });

  it('adds the equipment-tier surcharge to every bounty (+2 s per tier above 1 per track)', () => {
    const s0 = edit(fresh(), env, (d) => {
      const f = d.factions[d.player.factionId];
      if (f) {
        f.armouryTier = 3;
        f.weaponTier = 2;
      }
    });
    const p = musterPreview(s0, content, { holdingId: capitalOf(s0), units: { bondi: 10, archers: 2 } });
    expect(p.lines.find((l) => l.unit === 'bondi')?.bountyEach).toBe(10 + 6);
    expect(p.lines.find((l) => l.unit === 'archers')?.bountyEach).toBe(25 + 6);
    expect(p.bounty).toBe(160 + 62);
    expect(p.upkeepDelta).toBe(10 * 1 + 2 * 2);
  });

  it('veterans in the pool come first and keep their battles', () => {
    const s0 = edit(fresh(), env, (d) => {
      const h = d.settlements[d.player.capitalId]?.holding;
      if (!h) return;
      h.pool.veterans = { bondi: 5 };
      h.veteranBattles = { bondi: 4 };
    });
    const cap = capitalOf(s0);
    const p = musterPreview(s0, content, { holdingId: cap, units: { bondi: 10 } });
    expect(p.lines[0]?.veterans).toBe(5);
    const s1 = mustDispatch(s0, env, { type: 'muster', holdingId: cap, units: { bondi: 10 } }).state;
    expect(s1.settlements[cap]?.holding?.pool.veterans).toEqual({});
    const s2 = days(s1, env, 3).state;
    // 40 green + 5 green + 5 veterans of 4 battles → (5 × 4) / 50.
    expect(s2.settlements[cap]?.garrison.bondi).toBe(50);
    expect(s2.settlements[cap]?.vetBattles?.bondi).toBeCloseTo(0.4, 5);
  });

  it('recruits board a fleet in the harbour when one is named', () => {
    let fleetId: FleetId = 'flt_0';
    const s0 = edit(fresh(), env, (d, ctx) => {
      const cap = d.settlements[d.player.capitalId];
      if (!cap) return;
      const f = createFleet(d, ctx, { ownerId: d.player.factionId, leaderId: d.player.rulerId, pos: { ...cap.mapPos }, mode: 'docked' });
      fleetId = f.id;
    });
    const cap = capitalOf(s0);
    const s1 = mustDispatch(s0, env, { type: 'muster', holdingId: cap, units: { bondi: 12 }, fleetId }).state;
    const s2 = days(s1, env, 3);
    expect(s2.state.fleets[fleetId]?.men).toEqual({ bondi: 12 });
    expect(s2.state.settlements[cap]?.garrison.bondi).toBe(40);
    expect(s2.events.find((e) => e.type === 'MusterCompleted')).toMatchObject({ fleetId });
    // A fleet far away is refused.
    const away = edit(s0, env, (d) => {
      const f = d.fleets[fleetId];
      if (f) f.pos = { x: 100, y: 100 };
    });
    expect(dispatch(away, { type: 'muster', holdingId: cap, units: { bondi: 1 }, fleetId }, env).error?.code).toBe('fleetNotInHarbour');
  });

  it('the preview lists every requested line even when the command would fail', () => {
    const s0 = fresh();
    const p = musterPreview(s0, content, { holdingId: capitalOf(s0), units: { bondi: 0, archers: 0, huscarls: 0 } });
    expect(p.lines.map((l) => l.unit)).toEqual(['bondi', 'archers', 'huscarls']);
    expect(p.lines.find((l) => l.unit === 'huscarls')?.unmet).toEqual(['replaced']);
    expect(p.issues.map((i) => i.code)).toEqual(['noUnits']);
    expect(p.poolRemaining).toBe(220);
  });
});
