/**
 * Audio cues for simulation events (§28.1 stingers for omens, births and deaths): a pure mapping
 * from an event batch to cues, and an installer that plays them from the client's sim-event bus.
 * Only events that concern the player's house trigger stingers, so a busy world stays quiet.
 * Event payloads are read defensively (modules may still be mid-work).
 */
import { eventField, onSimEvents } from '@client/app/simEvents';
import type { SimEvent } from '@sim/core/events';
import type { GameState } from '@sim/core/state';
import type { SfxId, SfxParamBag, StingerId } from './catalog';
import type { AudioManager } from './audioManager';

export type AudioCue = { readonly kind: 'stinger'; readonly id: StingerId } | { readonly kind: 'sfx'; readonly id: SfxId; readonly params?: SfxParamBag };

/** The minimal state the cue rules read. */
export type CueState = { readonly player: Pick<GameState['player'], 'factionId' | 'rulerId'> & { expeditionFleetId?: string } };

function isPlayerFaction(e: SimEvent, key: string, state: CueState): boolean {
  return eventField(e, key) === state.player.factionId;
}

/** Stingers outrank each other: one per batch, the most significant. */
const STINGER_RANK: Readonly<Record<StingerId, number>> = { death: 6, defeat: 5, victory: 4, relicFound: 3, birth: 2, omen: 1 };

/** Cues for one event batch (at most one stinger; SFX cues in event order). */
export function cuesForEvents(events: readonly SimEvent[], state: CueState): AudioCue[] {
  let stinger: StingerId | undefined;
  const sfx: AudioCue[] = [];
  const offer = (id: StingerId) => {
    if (stinger === undefined || STINGER_RANK[id] > STINGER_RANK[stinger]) stinger = id;
  };
  for (const e of events) {
    switch ((e as unknown as { type: string }).type) {
      case 'Death':
        if (isPlayerFaction(e, 'factionId', state) || eventField(e, 'wasPlayerRuler') === true) offer('death');
        break;
      case 'Birth':
        if (isPlayerFaction(e, 'factionId', state)) offer('birth');
        break;
      case 'OmenRead':
        if (isPlayerFaction(e, 'factionId', state)) offer('omen');
        break;
      case 'RelicFound': {
        const f = eventField(e, 'factionId');
        if (f === undefined || f === state.player.factionId) offer('relicFound');
        break;
      }
      case 'BattleEnded': {
        const side = eventField(e, 'playerSide');
        const result = eventField(e, 'result') as { winner?: unknown } | undefined;
        if ((side === 'attacker' || side === 'defender') && result && (result.winner === 'attacker' || result.winner === 'defender')) offer(result.winner === side ? 'victory' : 'defeat');
        break;
      }
      case 'StormHit': {
        const fleet = eventField(e, 'fleetId');
        if (fleet !== undefined && fleet === state.player.expeditionFleetId) sfx.push({ kind: 'sfx', id: 'weather.thunder', params: { distance: 0.15 } });
        break;
      }
      case 'BuildingCompleted':
      case 'ShipCompleted':
        if (isPlayerFaction(e, 'factionId', state)) sfx.push({ kind: 'sfx', id: 'ui.confirm' });
        break;
      default:
        break;
    }
  }
  return stinger === undefined ? sfx : [{ kind: 'stinger', id: stinger }, ...sfx];
}

/** Plays cues for every sim-event batch (not for the startup batch). Returns the uninstall function. */
export function installSimAudioCues(manager: AudioManager): () => void {
  return onSimEvents((batch) => {
    if (batch.origin === 'startup') return;
    for (const cue of cuesForEvents(batch.events, batch.state)) {
      if (cue.kind === 'stinger') manager.playStinger(cue.id);
      else manager.playSfx(cue.id, cue.params);
    }
  });
}
