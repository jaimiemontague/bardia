import { describe, expect, it } from 'vitest';
import type { GameState, JsonValue } from '@sim/core/state';
import { capitalOf, edit, militaryEnv, militaryState, mustDispatch } from './testing';

const env = militaryEnv();

function call(state: GameState, name: string, args: JsonValue[], scope: Record<string, string> = {}): JsonValue {
  const entry = env.conditionFns.get(name);
  if (!entry) throw new Error(`no condition fn ${name}`);
  const parsed = entry.fn.args.safeParse(args);
  if (!parsed.success) throw new Error(`bad args for ${name}: ${parsed.error.message}`);
  return entry.fn.evaluate(args, { state, env, scope });
}

describe('condition functions', () => {
  it('are registered by the military module', () => {
    for (const name of ['menOfType', 'menTotal', 'woundedMen', 'armouryTier', 'weaponTier', 'shipCount', 'lieutenantCount', 'lieutenantSlots', 'recruitPool', 'musterReady', 'vetStars']) {
      expect(env.conditionFns.get(name)?.moduleId).toBe('military');
    }
  });

  it('read men, wounded, tiers, ships, lieutenants and pools of the player realm', () => {
    const s0 = militaryState();
    const cap = capitalOf(s0);
    expect(call(s0, 'menOfType', ['bondi'])).toBe(40);
    expect(call(s0, 'menOfType', ['archers', cap])).toBe(20);
    expect(call(s0, 'menTotal', [])).toBe(60);
    expect(call(s0, 'menTotal', [cap])).toBe(60);
    expect(call(s0, 'armouryTier', [])).toBe(1);
    expect(call(s0, 'weaponTier', [])).toBe(1);
    expect(call(s0, 'shipCount', [])).toBe(2);
    expect(call(s0, 'shipCount', ['snekkja'])).toBe(2);
    expect(call(s0, 'shipCount', ['drakkar'])).toBe(0);
    expect(call(s0, 'lieutenantCount', [])).toBe(2);
    expect(call(s0, 'lieutenantSlots', [])).toBe(0);
    expect(call(s0, 'recruitPool', [])).toBe(220);
    expect(call(s0, 'recruitPool', [], { holding: cap })).toBe(220);
    expect(call(s0, 'musterReady', [])).toBe(true);
    const s1 = edit(mustDispatch(s0, env, { type: 'muster', holdingId: cap, units: { bondi: 10 } }).state, env, (d, ctx) => {
      ctx.applyEffects([{ op: 'killMen', unit: 'bondi', count: 0, wounded: 5, settlementId: d.player.capitalId }]);
      const c = d.settlements[d.player.capitalId];
      if (c) c.vetBattles = { archers: 6 };
    });
    expect(call(s1, 'musterReady', [cap])).toBe(false);
    expect(call(s1, 'recruitPool', [cap])).toBe(210);
    expect(call(s1, 'woundedMen', [])).toBe(5);
    expect(call(s1, 'menOfType', ['bondi'])).toBe(35);
    expect(call(s1, 'vetStars', ['archers', cap])).toBe(3);
    expect(call(s1, 'vetStars', ['bondi', cap])).toBe(0);
  });

  it('validate their arguments', () => {
    expect(env.conditionFns.get('menOfType')?.fn.args.safeParse([]).success).toBe(false);
    expect(env.conditionFns.get('shipCount')?.fn.args.safeParse(['longship']).success).toBe(false);
    expect(env.conditionFns.get('vetStars')?.fn.args.safeParse(['bondi']).success).toBe(false);
  });
});
