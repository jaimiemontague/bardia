import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { dispatch } from '@sim/core/dispatch';
import type { GameState } from '@sim/core/state';
import { missingEventKeys } from '../../testing';
import { upgradePreview } from './equipment';
import { capitalOf, edit, militaryEnv, militaryState, mustDispatch, withMarket } from './testing';

const content = getContent();
const env = militaryEnv();

/** Placeholder capital: Smithy I, 40 bondi + 20 archers = 60 men. */
function rich(treasury = 50000): GameState {
  return edit(militaryState(), env, (d) => {
    const f = d.factions[d.player.factionId];
    if (f) f.treasury = treasury;
  });
}

describe('upgradeArmoury (§12.4)', () => {
  it('costs flat + per man (men under arms) plus iron, raises the realm tier and equips the holdings', () => {
    const base = rich();
    const s = withMarket(base, env, capitalOf(base), { iron: 5 });
    const p = upgradePreview(s, content, { track: 'armour' });
    expect(p.ok).toBe(true);
    expect(p.men).toBe(60);
    expect(p.silver).toBe(1600 + 6 * 60);
    expect(p.ironT).toBe(2);
    expect(p.ironFromMarket).toBe(2);
    expect(p.ironCost).toBe(0);
    const r = mustDispatch(s, env, { type: 'upgradeArmoury', track: 'armour' });
    const f = r.state.factions[r.state.player.factionId];
    expect(f?.armouryTier).toBe(2);
    expect(f?.weaponTier).toBe(1);
    expect(f?.treasury).toBe(50000 - 1960);
    expect(r.state.markets[capitalOf(s)]?.stock.iron).toBe(3);
    expect(r.state.settlements[capitalOf(s)]?.armourTier).toBe(2);
    expect(r.events.find((e) => e.type === 'ArmouryUpgraded')).toMatchObject({ track: 'armour', tier: 2, cost: 1960 });
    expect(missingEventKeys(r.events)).toEqual([]);
  });

  it('buys missing iron from the treasury at the markup, or refuses when told not to', () => {
    const s = rich();
    const p = upgradePreview(s, content, { track: 'weapons' });
    const ironCost = Math.ceil(2 * content.balance.goods.iron.basePerTon * content.tunables.military.armoury.ironBuyMarkup);
    expect(p.ironBought).toBe(2);
    expect(p.ironCost).toBe(ironCost);
    expect(p.total).toBe(1960 + ironCost);
    expect(dispatch(s, { type: 'upgradeArmoury', track: 'weapons', buyIron: false }, env).error?.code).toBe('iron');
    const r = mustDispatch(s, env, { type: 'upgradeArmoury', track: 'weapons' });
    expect(r.state.factions[r.state.player.factionId]?.treasury).toBe(50000 - 1960 - ironCost);
  });

  it('counts wounded, gathering and travelling men in the per-man cost', () => {
    let s = rich();
    s = mustDispatch(s, env, { type: 'muster', holdingId: capitalOf(s), units: { bondi: 15 } }).state;
    expect(upgradePreview(s, content, { track: 'armour' }).men).toBe(75);
  });

  it('gates tiers by Smithy tier: tier 3 needs Smithy II, tiers 4–5 Smithy III', () => {
    let s = edit(rich(), env, (d) => {
      const f = d.factions[d.player.factionId];
      if (f) f.armouryTier = 2;
    });
    expect(dispatch(s, { type: 'upgradeArmoury', track: 'armour' }, env).error?.code).toBe('smithy');
    s = edit(s, env, (d) => {
      const c = d.settlements[d.player.capitalId];
      if (c) c.buildings.smithy = 2;
    });
    s = mustDispatch(s, env, { type: 'upgradeArmoury', track: 'armour' }).state;
    expect(s.factions[s.player.factionId]?.armouryTier).toBe(3);
    expect(dispatch(s, { type: 'upgradeArmoury', track: 'armour' }, env).error?.code).toBe('smithy');
    s = edit(s, env, (d) => {
      const c = d.settlements[d.player.capitalId];
      if (c) c.buildings.smithy = 3;
    });
    s = mustDispatch(s, env, { type: 'upgradeArmoury', track: 'armour' }).state;
    expect(s.factions[s.player.factionId]?.armouryTier).toBe(4);
  });

  it('tier 5 needs a master smith; tier 6 the Anvil-Shard relic; nothing beyond', () => {
    let s = edit(rich(200000), env, (d) => {
      const f = d.factions[d.player.factionId];
      if (f) f.weaponTier = 4;
      const c = d.settlements[d.player.capitalId];
      if (c) c.buildings.smithy = 3;
    });
    const blocked = upgradePreview(s, content, { track: 'weapons' });
    expect(blocked.issues).toEqual(['requirement']);
    expect(blocked.unmet).toEqual(['masterSmith']);
    s = edit(s, env, (d) => {
      d.flags.masterSmith = true;
    });
    s = mustDispatch(s, env, { type: 'upgradeArmoury', track: 'weapons' }).state;
    expect(s.factions[s.player.factionId]?.weaponTier).toBe(5);
    expect(upgradePreview(s, content, { track: 'weapons' }).unmet).toEqual(['relic:anvilShard']);
    s = edit(s, env, (d) => {
      d.flags['relic:anvilShard'] = true;
    });
    const relic = upgradePreview(s, content, { track: 'weapons' });
    expect(relic.ok).toBe(true);
    expect(relic.silver).toBe(14400 + 18 * 60);
    s = mustDispatch(s, env, { type: 'upgradeArmoury', track: 'weapons' }).state;
    expect(s.factions[s.player.factionId]?.weaponTier).toBe(6);
    expect(dispatch(s, { type: 'upgradeArmoury', track: 'weapons' }, env).error?.code).toBe('maxTier');
  });

  it('rejects an unaffordable upgrade and a foreign smithy without touching state', () => {
    const s = rich(100);
    const r = dispatch(s, { type: 'upgradeArmoury', track: 'armour' }, env);
    expect(r.error?.code).toBe('treasury');
    expect(r.state).toBe(s);
    expect(dispatch(s, { type: 'upgradeArmoury', track: 'armour', holdingId: 'set_424242' }, env).error?.code).toBe('notYourHolding');
  });
});
