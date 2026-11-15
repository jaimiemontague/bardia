/**
 * Auto-pause rules (design §7.2, §25.9): decides from an event batch whether real-time play should
 * pause, honouring the player's settings. Pending decisions always stop time (the simulation
 * guarantees it); these rules cover everything else. Events of modules that are not built yet are
 * matched by type name, so the rules work as soon as their owners emit them.
 */
import type { SimEvent } from '@sim/core/events';
import type { GameState } from '@sim/core/state';
import type { AutoPauseRules } from '../settings/schema';
import { eventField } from './simEvents';

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** True when the event concerns the player's house (fleet, settlement or character of the player). */
function concernsPlayer(e: SimEvent, state: GameState): boolean {
  const fac = state.player.factionId;
  const fleetId = str(eventField(e, 'fleetId'));
  if (fleetId !== undefined) {
    const f = Object.hasOwn(state.fleets, fleetId) ? state.fleets[fleetId as keyof typeof state.fleets] : undefined;
    return f ? f.ownerId === fac : false;
  }
  for (const k of ['charId', 'characterId', 'childId', 'deceasedId']) {
    const id = str(eventField(e, k));
    if (id === undefined) continue;
    const c = Object.hasOwn(state.characters, id) ? state.characters[id as keyof typeof state.characters] : undefined;
    return c ? c.factionId === fac || id === state.player.rulerId : false;
  }
  for (const k of ['settlementId', 'holdingId']) {
    const id = str(eventField(e, k));
    if (id === undefined) continue;
    const s = Object.hasOwn(state.settlements, id) ? state.settlements[id as keyof typeof state.settlements] : undefined;
    return s ? s.factionId === fac : false;
  }
  return true;
}

/**
 * The locale key explaining why time should pause for this batch, or null. Checked in priority
 * order so the most serious reason is shown.
 */
export function autoPauseReason(events: readonly SimEvent[], rules: AutoPauseRules, state: GameState): string | null {
  const best: { reason: string | null; rank: number } = { reason: null, rank: 99 };
  const consider = (r: string, k: number) => {
    if (k < best.rank) {
      best.rank = k;
      best.reason = r;
    }
  };
  for (const e of events) {
    const type = e.type as string;
    switch (type) {
      case 'Notification': {
        const p = eventField(e, 'priority');
        const key = str(eventField(e, 'key')) ?? '';
        if (p === 'critical' && rules.critical) consider('ui.time.autoPause.critical', 0);
        else if (p === 'high' && rules.important) consider('ui.time.autoPause.important', 5);
        if (rules.lowFood && /lowFood|food\.low|starv/i.test(key)) consider('ui.time.autoPause.lowFood', 4);
        break;
      }
      case 'HoldingAttacked':
        if (rules.holdingAttacked) consider('ui.time.autoPause.holdingAttacked', 1);
        break;
      case 'StormWarning':
        if (rules.storms && concernsPlayer(e, state)) consider('ui.time.autoPause.storm', 2);
        break;
      case 'EncounterSighted':
        if (rules.encounters && concernsPlayer(e, state)) consider('ui.time.autoPause.encounter', 2);
        break;
      case 'Arrived':
        if (rules.arrival && concernsPlayer(e, state)) consider('ui.time.autoPause.arrival', 3);
        break;
      case 'EnvoyArrived':
        if (rules.envoys) consider('ui.time.autoPause.envoy', 3);
        break;
      case 'Birth':
      case 'Death':
        if (rules.birthsDeaths && concernsPlayer(e, state)) consider('ui.time.autoPause.birthDeath', 3);
        break;
      case 'PendingRaised':
        consider('ui.time.pausedForDecision', 0);
        break;
      default:
        break;
    }
  }
  return best.reason;
}
