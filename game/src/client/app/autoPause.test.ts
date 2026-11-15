import { describe, expect, it } from 'vitest';
import type { SimEvent } from '@sim/core/events';
import { testWorld } from '@sim/testing';
import { defaultSettings } from '../settings/schema';
import { autoPauseReason } from './autoPause';

const world = testWorld({ factions: 2, fleetsPerFaction: 1 });
const playerFaction = world.factionIds[0] as `fac_${string}`;
const otherFaction = world.factionIds[1] as `fac_${string}`;
const myFleet = world.fleetIds[playerFaction]?.[0] as string;
const theirFleet = world.fleetIds[otherFaction]?.[0] as string;
const rules = defaultSettings().gameplay.autoPause;
const ev = (e: Record<string, unknown>): SimEvent => e as unknown as SimEvent;

describe('auto-pause rules (§7.2, §25.9)', () => {
  it('pauses on Critical notifications by default and on Important ones only when asked', () => {
    expect(autoPauseReason([{ type: 'Notification', priority: 'critical', key: 'core.x', vars: {} }], rules, world.state)).toBe('ui.time.autoPause.critical');
    expect(autoPauseReason([{ type: 'Notification', priority: 'high', key: 'core.x', vars: {} }], rules, world.state)).toBeNull();
    expect(autoPauseReason([{ type: 'Notification', priority: 'high', key: 'core.x', vars: {} }], { ...rules, important: true }, world.state)).toBe('ui.time.autoPause.important');
    expect(autoPauseReason([{ type: 'Notification', priority: 'critical', key: 'core.x', vars: {} }], { ...rules, critical: false }, world.state)).toBeNull();
  });

  it('pauses for the player’s own fleet only (arrival, storms, encounters)', () => {
    expect(autoPauseReason([ev({ type: 'Arrived', fleetId: myFleet })], rules, world.state)).toBe('ui.time.autoPause.arrival');
    expect(autoPauseReason([ev({ type: 'Arrived', fleetId: theirFleet })], rules, world.state)).toBeNull();
    expect(autoPauseReason([ev({ type: 'StormWarning', fleetId: myFleet })], rules, world.state)).toBe('ui.time.autoPause.storm');
    expect(autoPauseReason([ev({ type: 'EncounterSighted', fleetId: myFleet })], { ...rules, encounters: false }, world.state)).toBeNull();
  });

  it('pauses for births and deaths in the player’s house, envoys and attacks on holdings', () => {
    const ruler = world.state.player.rulerId;
    expect(autoPauseReason([ev({ type: 'Death', charId: ruler })], rules, world.state)).toBe('ui.time.autoPause.birthDeath');
    expect(autoPauseReason([ev({ type: 'EnvoyArrived', factionId: otherFaction })], rules, world.state)).toBe('ui.time.autoPause.envoy');
    expect(autoPauseReason([ev({ type: 'HoldingAttacked', settlementId: world.state.player.capitalId })], rules, world.state)).toBe('ui.time.autoPause.holdingAttacked');
  });

  it('picks the most serious reason in a batch, and a raised decision always counts', () => {
    const batch = [ev({ type: 'Arrived', fleetId: myFleet }), { type: 'Notification', priority: 'critical', key: 'core.x', vars: {} } as SimEvent];
    expect(autoPauseReason(batch, rules, world.state)).toBe('ui.time.autoPause.critical');
    expect(autoPauseReason([ev({ type: 'PendingRaised', decision: {} })], { ...rules, critical: false }, world.state)).toBe('ui.time.pausedForDecision');
    expect(autoPauseReason([{ type: 'Notification', priority: 'normal', key: 'expeditions.lowFood', vars: {} }], rules, world.state)).toBe('ui.time.autoPause.lowFood');
  });
});
