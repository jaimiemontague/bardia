import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkInvariants } from './core/env';
import { missingEventKeys, testWorld } from './testing';

describe('test helpers', () => {
  it('testing.ts imports only the kernel and content (never the registry, session or game)', () => {
    const code = readFileSync(fileURLToPath(new URL('./testing.ts', import.meta.url)), 'utf8');
    const specifiers = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] as string);
    expect(specifiers.filter((s) => !s.startsWith('./core/') && !s.startsWith('@content/'))).toEqual([]);
  });

  it('testWorld builds a deterministic multi-faction world with markets, fleets and relations', () => {
    const a = testWorld({ factions: 4, settlementsPerFaction: 3, fleetsPerFaction: 2 });
    const b = testWorld({ factions: 4, settlementsPerFaction: 3, fleetsPerFaction: 2 });
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.factionIds).toHaveLength(4);
    expect(a.factionIds[0]).toBe(a.state.player.factionId);
    for (const f of a.factionIds) {
      expect(a.settlementIds[f]).toHaveLength(3);
      expect(a.fleetIds[f]).toHaveLength(2);
      for (const s of a.settlementIds[f]!) {
        expect(a.state.settlements[s]?.coastal).toBe(true);
        expect(a.state.markets[s]?.stock.iron).toBeGreaterThan(0);
      }
      for (const fl of a.fleetIds[f]!) expect(a.state.fleets[fl]?.shipIds).toHaveLength(2);
    }
    expect(Object.keys(a.state.relations)).toHaveLength(6);
    for (const s of a.settlementIds[a.factionIds[0]!]!) expect(a.state.settlements[s]?.holding).toBeDefined();
    expect(checkInvariants(a.state, a.env)).toEqual([]);
    // World entities use their own streams: the player's placeholder generation is untouched.
    expect(Object.keys(a.state.rng)).toEqual(expect.arrayContaining(['testWorld:factory', 'testWorld:names']));
  });

  it('missingEventKeys lists localisation keys without an English string', () => {
    expect(missingEventKeys([{ type: 'Notification', priority: 'normal', key: 'core.surelyMissing', vars: {} }])).toEqual(['core.surelyMissing']);
    expect(missingEventKeys([{ type: 'WeekStarted', hour: 0 }])).toEqual([]);
  });
});
