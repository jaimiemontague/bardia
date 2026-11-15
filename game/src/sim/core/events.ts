/**
 * Simulation event registry (design §30.10). Events are emitted by handlers/systems through
 * `ctx.emit(...)` and returned from dispatch/advance; the client turns them into narration,
 * notifications, audio cues and Chronicle UI. They are NOT stored in GameState.
 *
 *   declare module '@sim/core/events' {
 *     interface EventMap { StormHit: { fleetId: FleetId; severity: 'minor' | 'moderate' | 'severe' } }
 *   }
 *
 * Event names are PascalCase; payloads must not use the key `type`.
 * This interface is intentionally empty here; core events are declared in builtins.ts.
 */
import type { MapPos } from './state';

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface EventMap {}

export type EventType = keyof EventMap;

/** The full event object for one type: `{ type: K } & payload`. */
export type SimEventOf<K extends EventType> = { type: K } & EventMap[K];

/** Discriminated union of every registered event. */
export type SimEvent = { [K in EventType]: SimEventOf<K> }[EventType];

/** Kinds of things a notification can link to. Augment to add kinds. */
export interface EntityLinkKinds {
  settlement: true;
  fleet: true;
  character: true;
  faction: true;
  site: true;
  province: true;
  army: true;
  map: true;
  screen: true;
}
export type EntityLinkKind = keyof EntityLinkKinds;

/** Something the UI can jump to from a notification. */
export interface EntityLink {
  kind: EntityLinkKind;
  id?: string;
  pos?: MapPos;
}

/** Narration voices (§26.2). Final voice-over is attached per line key via the asset manifest. */
export type VoiceId = 'skald' | 'hirdmaster' | 'steward' | 'seer' | 'narrator' | (string & {});
